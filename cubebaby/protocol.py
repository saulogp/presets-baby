"""Cube Baby SysEx protocol (framing only).

Reverse-engineered by github.com/pferreir/cuvave-midi and
github.com/walbertfreitas/cubebaby-editor (docs/PROTOCOL.md).

Clear frame:  00 59 | CMD u8 | LEN u24 LE | DATA[LEN] | CHK
              CHK = ~sum(DATA) & 0xFF
Wire:         F0 <clear frame packed LSB-first into 7-bit bytes> F7
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

MAGIC = b"\x00\x59"

CMD_ACK = 0x00
CMD_IDENTIFY = 0x11
CMD_STATUS = 0x12
CMD_ERASE = 0x21  # never sent by this project
CMD_WRITE = 0x22
CMD_READ = 0x23
CMD_SUM = 0x24

# Live (RAM-only) parameter writes use this bit on the address.
LIVE_BIT = 0x80000000
PRESET_SPACE = 0x05


class UnsafeOperation(Exception):
    pass


def pack7(data: bytes) -> bytes:
    """Pack 8-bit bytes into a 7-bit LSB-first bit stream."""
    out = []
    acc = 0
    nbits = 0
    for b in data:
        acc |= b << nbits
        nbits += 8
        while nbits >= 7:
            out.append(acc & 0x7F)
            acc >>= 7
            nbits -= 7
    # The device's encoder always emits a final byte, even with 0 leftover bits
    # (matches the published vectors: 7 clear bytes -> 9 wire bytes).
    out.append(acc & 0x7F)
    return bytes(out)


def unpack7(data: bytes) -> bytes:
    out = []
    acc = 0
    nbits = 0
    for b in data:
        if b & 0x80:
            raise ValueError(f"byte with high bit inside SysEx: {b:#x}")
        acc |= b << nbits
        nbits += 7
        if nbits >= 8:
            out.append(acc & 0xFF)
            acc >>= 8
            nbits -= 8
    # leftover bits (<8) are padding
    return bytes(out)


def checksum(data: bytes) -> int:
    return (~sum(data)) & 0xFF


def build_frame(cmd: int, data: bytes = b"") -> bytes:
    if len(data) >= 1 << 24:
        raise ValueError("payload too large")
    return MAGIC + bytes([cmd]) + len(data).to_bytes(3, "little") + data + bytes([checksum(data)])


def to_sysex(frame: bytes) -> bytes:
    return b"\xF0" + pack7(frame) + b"\xF7"


@dataclass
class Frame:
    cmd: int
    data: bytes
    checksum_ok: bool


def parse_sysex(msg: bytes) -> Frame:
    if not (msg[:1] == b"\xF0" and msg[-1:] == b"\xF7"):
        raise ValueError("not a SysEx message")
    clear = unpack7(msg[1:-1])
    if clear[:2] != MAGIC:
        raise ValueError(f"bad magic: {clear[:2].hex()}")
    cmd = clear[2]
    length = int.from_bytes(clear[3:6], "little")
    data = clear[6 : 6 + length]
    if len(data) != length or len(clear) < 7 + length:
        raise ValueError(f"truncated frame: want {length} bytes, clear={clear.hex()}")
    chk = clear[6 + length]
    return Frame(cmd, data, chk == checksum(data))


# ---- request builders -------------------------------------------------------

def identify() -> bytes:
    return to_sysex(build_frame(CMD_IDENTIFY))


def status() -> bytes:
    return to_sysex(build_frame(CMD_STATUS))


def read_mem(space: int, addr: int, length: int) -> bytes:
    data = bytes([space]) + struct.pack("<I", addr) + length.to_bytes(3, "little")
    return to_sysex(build_frame(CMD_READ, data))


def mem_sum(space: int, addr: int, length: int) -> bytes:
    data = bytes([space]) + struct.pack("<I", addr) + struct.pack("<I", length)
    return to_sysex(build_frame(CMD_SUM, data))


def check_write_allowed(space: int, addr: int) -> None:
    """Safety lock: the only write this project permits is a live (RAM-only)
    preset parameter write. Anything that could reach flash is refused."""
    if space != PRESET_SPACE or not (addr & LIVE_BIT):
        raise UnsafeOperation(
            f"refusing write to space {space:#x} addr {addr:#010x}: "
            "only live preset writes (space 0x05, addr >= 0x80000000) are allowed"
        )
    if (addr & ~LIVE_BIT) >= 0x30:
        raise UnsafeOperation(f"live address {addr:#010x} outside the 3x16-byte preset area")


def live_write(space: int, addr: int, data: bytes) -> bytes:
    check_write_allowed(space, addr)
    check_write_allowed(space, addr + len(data) - 1)
    payload = bytes([space]) + struct.pack("<I", addr) + len(data).to_bytes(3, "little") + data
    return to_sysex(build_frame(CMD_WRITE, payload))
