#!/usr/bin/env python3
"""Generate the PWA icons (stdlib only): dark background, orange rounded
square with three stacked bars (banks of A/B/C presets)."""

import struct
import sys
import zlib
from pathlib import Path

BG = (0x12, 0x14, 0x18)
ACCENT = (0xFF, 0x8A, 0x3D)
INK = (0x1A, 0x0F, 0x06)


def inside_rounded(x, y, x0, y0, x1, y1, r):
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def render(size):
    s = size
    sq = (0.22 * s, 0.22 * s, 0.78 * s, 0.78 * s)  # inside maskable safe zone
    bars = [(0.32 * s, y * s, 0.68 * s, (y + 0.09) * s) for y in (0.32, 0.455, 0.59)]
    rows = []
    for y in range(s):
        row = bytearray([0])
        for x in range(s):
            px, py = x + 0.5, y + 0.5
            c = BG
            if inside_rounded(px, py, *sq, 0.1 * s):
                c = ACCENT
                for b in bars:
                    if inside_rounded(px, py, *b, 0.035 * s):
                        c = INK
            row += bytes(c)
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", s, s, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", raw) + chunk(b"IEND", b""))


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "app/icons")
    out.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        (out / f"icon-{size}.png").write_bytes(render(size))
        print(f"wrote {out / f'icon-{size}.png'}")
