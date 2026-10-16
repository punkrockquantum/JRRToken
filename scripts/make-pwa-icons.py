#!/usr/bin/env python3
"""Generate FLUX PWA icons with no third-party dependencies.

Renders a monochrome "F" mark (white on a near-black tile) to match the
app's theme, supersampled for smooth edges, and writes PNG files used by
the web app manifest. Pure stdlib: zlib + struct, so it runs anywhere.
"""
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")

BG = (10, 10, 10)        # near-black tile, matches #0a0a0a panels
FG = (245, 245, 245)     # #f5f5f5 app text colour
SS = 4                   # supersampling factor for anti-aliasing


def _rects(n):
    """Return white rectangles (x0, y0, x1, y1) forming an 'F' for an n x n canvas.

    Glyph is kept inside the central ~56% so it stays within the maskable
    safe zone (OS masks may clip the outer 20%).
    """
    stem_w = 0.090 * n
    gx0 = 0.345 * n           # glyph left
    gx1 = 0.675 * n           # glyph right (top bar extent)
    gy0 = 0.300 * n           # glyph top
    gy1 = 0.700 * n           # glyph bottom
    bar_h = 0.088 * n
    mid_y = 0.482 * n
    mid_x1 = 0.620 * n        # middle bar is slightly shorter
    return [
        (gx0, gy0, gx1, gy0 + bar_h),          # top bar
        (gx0, mid_y, mid_x1, mid_y + bar_h),   # middle bar
        (gx0, gy0, gx0 + stem_w, gy1),         # vertical stem
    ]


def _render(n):
    big = n * SS
    rects = _rects(big)
    # coverage buffer at supersampled resolution
    cover = bytearray(big * big)
    for (x0, y0, x1, y1) in rects:
        ix0, iy0 = max(0, int(x0)), max(0, int(y0))
        ix1, iy1 = min(big, int(round(x1))), min(big, int(round(y1)))
        for y in range(iy0, iy1):
            row = y * big
            for x in range(ix0, ix1):
                cover[row + x] = 1
    # downsample to n x n, averaging coverage for anti-aliasing
    px = bytearray(n * n * 3)
    area = SS * SS
    for y in range(n):
        for x in range(n):
            c = 0
            by = y * SS
            bx = x * SS
            for dy in range(SS):
                base = (by + dy) * big + bx
                for dx in range(SS):
                    c += cover[base + dx]
            a = c / area
            r = round(BG[0] + (FG[0] - BG[0]) * a)
            g = round(BG[1] + (FG[1] - BG[1]) * a)
            b = round(BG[2] + (FG[2] - BG[2]) * a)
            i = (y * n + x) * 3
            px[i] = r
            px[i + 1] = g
            px[i + 2] = b
    return px


def _write_png(path, n, px):
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    raw = bytearray()
    for y in range(n):
        raw.append(0)  # filter type 0 (None)
        start = y * n * 3
        raw.extend(px[start:start + n * 3])
    ihdr = struct.pack(">IIBBBBB", n, n, 8, 2, 0, 0, 0)  # 8-bit RGB
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    targets = {
        "icon-192.png": 192,
        "icon-512.png": 512,
        "maskable-512.png": 512,
        "apple-touch-icon.png": 180,
        "favicon-32.png": 32,
    }
    rendered = {}
    for name, n in targets.items():
        if n not in rendered:
            rendered[n] = _render(n)
        _write_png(os.path.join(OUT_DIR, name), n, rendered[n])
        print("wrote", os.path.join("icons", name))


if __name__ == "__main__":
    main()
