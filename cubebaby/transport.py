"""ALSA raw MIDI transport (stdlib only)."""

from __future__ import annotations

import glob
import os
import select
import time

from . import protocol as p


def find_device() -> str:
    """Return /dev/snd/midiCxDy of the card named 'USB2.0 Device'."""
    for idfile in glob.glob("/proc/asound/card*/id"):
        card = idfile.split("/")[3][4:]
        name = open(f"/proc/asound/card{card}/usbid").read().strip() if os.path.exists(
            f"/proc/asound/card{card}/usbid"
        ) else ""
        if name == "301a:5555":
            devs = sorted(glob.glob(f"/dev/snd/midiC{card}D*"))
            if devs:
                return devs[0]
    raise RuntimeError("Cube Baby (USB 301a:5555) not found")


class RawMidi:
    def __init__(self, path: str | None = None, verbose: bool = False):
        self.path = path or find_device()
        self.fd = os.open(self.path, os.O_RDWR | os.O_NONBLOCK)
        self.buf = bytearray()
        self.verbose = verbose
        self._drain()

    def close(self):
        os.close(self.fd)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()

    def _drain(self):
        while select.select([self.fd], [], [], 0.05)[0]:
            if not os.read(self.fd, 4096):
                break
        self.buf.clear()

    def send(self, msg: bytes):
        if self.verbose:
            print(f">> {msg.hex(' ')}")
        os.write(self.fd, msg)

    def recv(self, timeout: float = 2.0) -> bytes | None:
        deadline = time.monotonic() + timeout
        while True:
            start = self.buf.find(0xF0)
            if start >= 0:
                end = self.buf.find(0xF7, start)
                if end >= 0:
                    msg = bytes(self.buf[start : end + 1])
                    del self.buf[: end + 1]
                    if self.verbose:
                        print(f"<< {msg.hex(' ')}")
                    return msg
            left = deadline - time.monotonic()
            if left <= 0:
                return None
            if select.select([self.fd], [], [], left)[0]:
                chunk = os.read(self.fd, 4096)
                # drop realtime bytes (clock, active sensing...)
                self.buf.extend(b for b in chunk if b < 0xF8)

    def request(self, msg: bytes, timeout: float = 2.0) -> p.Frame:
        self.send(msg)
        reply = self.recv(timeout)
        if reply is None:
            raise TimeoutError("no reply from device")
        return p.parse_sysex(reply)

    # ---- read-only helpers ----

    def read(self, space: int, addr: int, length: int, block: int = 64) -> bytes:
        out = bytearray()
        while len(out) < length:
            n = min(block, length - len(out))
            f = self.request(p.read_mem(space, addr + len(out), n))
            if f.cmd != p.CMD_READ or not f.checksum_ok:
                raise IOError(f"bad read reply cmd={f.cmd:#x} chk_ok={f.checksum_ok} data={f.data.hex()}")
            payload = f.data[8:]  # skip echoed space(1)+addr(4)+len(3)
            if len(payload) != n:
                raise IOError(f"short read: wanted {n}, got {len(payload)}")
            out += payload
        return bytes(out)
