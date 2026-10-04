"""Generate PWA icons (pure Python, no Pillow): python make_icons.py"""
import math
import struct
import zlib
from pathlib import Path

BG = (57, 73, 171)      # indigo
FG = (255, 255, 255)
ACCENT = (57, 73, 171)


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def render(size: int) -> bytes:
    s = size
    cx = cy = s / 2
    r = s * 0.30                      # white disc, inside the maskable safe zone
    w = s * 0.045                     # check stroke half-width
    a, b, c = (s * .39, s * .51), (s * .47, s * .59), (s * .62, s * .42)
    rows = []
    for y in range(s):
        row = bytearray([0])
        for x in range(s):
            col = BG
            d = math.hypot(x + .5 - cx, y + .5 - cy)
            if d <= r:
                col = FG
                if min(seg_dist(x + .5, y + .5, *a, *b), seg_dist(x + .5, y + .5, *b, *c)) <= w:
                    col = ACCENT
            row += bytes(col)
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", s, s, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    out = Path(__file__).parent / "static" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        (out / f"icon-{size}.png").write_bytes(render(size))
        print("wrote", out / f"icon-{size}.png")
