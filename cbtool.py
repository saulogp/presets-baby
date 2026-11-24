#!/usr/bin/env python3
"""Cube Baby diagnostic tool. Phase 1: READ-ONLY commands only."""

import argparse
import struct
import sys

from cubebaby import protocol as p
from cubebaby.transport import RawMidi


def hexdump(data: bytes, base: int = 0, width: int = 16):
    for i in range(0, len(data), width):
        row = data[i : i + width]
        asc = "".join(chr(b) if 32 <= b < 127 else "." for b in row)
        print(f"{base + i:08x}  {row.hex(' '):<{width * 3}} {asc}")


def cmd_probe(dev: RawMidi, a):
    f = dev.request(p.identify())
    print(f"identify: cmd={f.cmd:#04x} chk_ok={f.checksum_ok} len={len(f.data)}")
    hexdump(f.data)
    f = dev.request(p.status())
    print(f"status:   cmd={f.cmd:#04x} chk_ok={f.checksum_ok} data={f.data.hex(' ')}")


def cmd_info(dev: RawMidi, a):
    data = dev.read(0x00, 0x2100, 20)
    vals = struct.unpack("<5I", data)
    print("device info (bank 0 @ 0x2100):", " ".join(f"{v:#x}" for v in vals))


def cmd_presets(dev: RawMidi, a):
    data = dev.read(p.PRESET_SPACE, 0x0000, 48)
    for i, name in enumerate("ABC"):
        print(f"preset {name}: {data[i * 16 : i * 16 + 16].hex(' ')}")


def cmd_read(dev: RawMidi, a):
    space, addr, length = int(a.space, 0), int(a.addr, 0), int(a.length, 0)
    if not a.out:
        hexdump(dev.read(space, addr, length), addr)
        return
    chunk = 0x1000
    with open(a.out, "wb") as fh:
        for off in range(0, length, chunk):
            n = min(chunk, length - off)
            fh.write(dev.read(space, addr + off, n))
            fh.flush()
            print(f"\r{off + n:#x}/{length:#x} bytes ({100 * (off + n) // length}%)",
                  end="", file=sys.stderr, flush=True)
    print(f"\nwrote {length} bytes to {a.out}")


def cmd_live(dev: RawMidi, a):
    """RAM-only write of one preset parameter (safety lock in protocol.live_write)."""
    preset = "ABC".index(a.preset.upper())
    addr = p.LIVE_BIT + preset * 16 + int(a.offset, 0)
    f = dev.request(p.live_write(p.PRESET_SPACE, addr, bytes([int(a.value, 0)])))
    print(f"live write {a.preset.upper()}[{int(a.offset, 0):#04x}] = {int(a.value, 0)} -> "
          f"reply cmd={f.cmd:#04x} data={f.data.hex(' ')}")


def cmd_liveset(dev: RawMidi, a):
    """RAM-only write of a whole 16-byte preset in one message."""
    preset = "ABC".index(a.preset.upper())
    data = bytes.fromhex(a.hex)
    if len(data) != 16:
        raise SystemExit("preset must be exactly 16 bytes")
    f = dev.request(p.live_write(p.PRESET_SPACE, p.LIVE_BIT + preset * 16, data))
    print(f"live preset {a.preset.upper()} = {data.hex(' ')} -> reply cmd={f.cmd:#04x} data={f.data.hex(' ')}")


def cmd_sweep(dev: RawMidi, a):
    """Calibration: ramp one preset byte FROM..TO over SECONDS (RAM only), then restore it."""
    import time

    slot = "ABC".index(a.preset.upper())
    off, lo, hi = int(a.offset, 0), int(a.start, 0), int(a.end, 0)
    original = dev.read(p.PRESET_SPACE, slot * 16 + off, 1)[0]
    steps = list(range(lo, hi + 1)) if hi >= lo else list(range(lo, hi - 1, -1))
    delay = float(a.seconds) / max(1, len(steps))
    print(f"{a.preset.upper()}[{off:#04x}] original={original}; sweeping {lo}->{hi} in {a.seconds}s")
    try:
        for v in steps:
            dev.request(p.live_write(p.PRESET_SPACE, p.LIVE_BIT + slot * 16 + off, bytes([v])))
            print(f"\r  value {v:3d}", end="", flush=True)
            time.sleep(delay)
        if a.hold:
            time.sleep(float(a.hold))
    finally:
        dev.request(p.live_write(p.PRESET_SPACE, p.LIVE_BIT + slot * 16 + off, bytes([original])))
        print(f"\n  restored {original}")


def cmd_watch(dev: RawMidi, a):
    """Read-only: poll a memory range for SECONDS and log every 4-byte word that changes."""
    import time

    space, addr, length = int(a.space, 0), int(a.addr, 0), int(a.length, 0)
    t0 = time.monotonic()
    prev = dev.read(space, addr, length, block=a.block)
    print(f"# baseline read took {time.monotonic() - t0:.2f}s", flush=True)
    log = open(a.out, "w") if a.out else None
    while time.monotonic() - t0 < float(a.seconds):
        cur = dev.read(space, addr, length, block=a.block)
        t = time.monotonic() - t0
        for w in range(0, length - 3, 4):
            if cur[w : w + 4] != prev[w : w + 4]:
                old = struct.unpack("<f", prev[w : w + 4])[0]
                new = struct.unpack("<f", cur[w : w + 4])[0]
                line = (f"{t:6.2f}s {space:#04x}:{addr + w:#06x} {prev[w:w + 4].hex()} -> {cur[w:w + 4].hex()}"
                        f"  float {old:.4f} -> {new:.4f}")
                print(line, flush=True)
                if log:
                    log.write(line + "\n")
                    log.flush()
        prev = cur
    print(f"# done after {time.monotonic() - t0:.1f}s")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("-v", "--verbose", action="store_true", help="print raw SysEx")
    ap.add_argument("--device", help="raw MIDI device, e.g. /dev/snd/midiC2D0")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("probe", help="identify + status")
    sub.add_parser("info", help="read device info block")
    sub.add_parser("presets", help="read the 3 stored presets")
    r = sub.add_parser("read", help="read memory: SPACE ADDR LEN")
    r.add_argument("space")
    r.add_argument("addr")
    r.add_argument("length")
    r.add_argument("-o", "--out")
    lw = sub.add_parser("live", help="RAM-only parameter write: PRESET(A/B/C) OFFSET VALUE")
    lw.add_argument("preset")
    lw.add_argument("offset")
    lw.add_argument("value")
    ls = sub.add_parser("liveset", help="RAM-only whole preset write: PRESET(A/B/C) HEX(16 bytes)")
    ls.add_argument("preset")
    ls.add_argument("hex")
    sw = sub.add_parser("sweep", help="calibration ramp, then restore: PRESET OFFSET FROM TO SECONDS")
    sw.add_argument("preset")
    sw.add_argument("offset")
    sw.add_argument("start")
    sw.add_argument("end")
    sw.add_argument("seconds")
    sw.add_argument("--hold", help="seconds to hold the last value before restoring")
    wt = sub.add_parser("watch", help="read-only: log changing words: SPACE ADDR LEN SECONDS")
    wt.add_argument("space")
    wt.add_argument("addr")
    wt.add_argument("length")
    wt.add_argument("seconds")
    wt.add_argument("--block", type=int, default=64)
    wt.add_argument("-o", "--out")
    a = ap.parse_args()
    cmds = {"probe": cmd_probe, "info": cmd_info, "presets": cmd_presets, "read": cmd_read,
            "live": cmd_live, "liveset": cmd_liveset, "sweep": cmd_sweep, "watch": cmd_watch}
    with RawMidi(a.device, verbose=a.verbose) as dev:
        cmds[a.cmd](dev, a)


if __name__ == "__main__":
    sys.exit(main())
