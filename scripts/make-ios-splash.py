#!/usr/bin/env python3
"""Generate iOS PWA launch (splash) images with no third-party deps.

iOS shows these while a home-screen PWA boots, avoiding a white flash.
The mark is axis-aligned rectangles (a white 'F' on near-black), so hard
edges are already crisp and no anti-aliasing/supersampling is needed,
keeping large portrait canvases fast to render in pure Python.
"""
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "splash")

BG = (0, 0, 0)           # pure black, matches app <body> background
FG = (245, 245, 245)     # #f5f5f5

# Unique (css_width, css_height, device_pixel_ratio) covering iPhone SE..16 Pro Max.
DEVICES = [
    (375, 667, 2),
    (414, 736, 3),
    (375, 812, 3),
    (414, 896, 2),
    (414, 896, 3),
    (390, 844, 3),
    (428, 926, 3),
    (393, 852, 3),
    (430, 932, 3),
    (402, 874, 3),
    (440, 956, 3),
]


def _mark_rects(w, h):
    """White 'F' rectangles centred on a w x h canvas."""
    g = min(w, h) * 0.26          # glyph box size
    cx, cy = w / 2.0, h / 2.0
    gx0 = cx - g * 0.42
    gx1 = cx + g * 0.50
    gy0 = cy - g * 0.52
    gy1 = cy + g * 0.52
    stem_w = g * 0.17
    bar_h = g * 0.17
    mid_y = cy - g * 0.05
    mid_x1 = cx + g * 0.34
    return [
        (gx0, gy0, gx1, gy0 + bar_h),
        (gx0, mid_y, mid_x1, mid_y + bar_h),
        (gx0, gy0, gx0 + stem_w, gy1),
    ]


def _write_png(path, w, h):
    rects = [tuple(int(round(v)) for v in r) for r in _mark_rects(w, h)]
    bg_row = bytes(BG) * w
    fg_px = bytes(FG)
    raw = bytearray()
    for y in range(h):
        row = bytearray(bg_row)
        for (x0, y0, x1, y1) in rects:
            if y0 <= y < y1:
                for x in range(max(0, x0), min(w, x1)):
                    row[x * 3:x * 3 + 3] = fg_px
        raw.append(0)  # filter 0
        raw.extend(row)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    links = []
    seen = set()
    for (cw, ch, dpr) in DEVICES:
        pw, ph = cw * dpr, ch * dpr
        name = "splash-%dx%d.png" % (pw, ph)
        if (pw, ph) not in seen:
            _write_png(os.path.join(OUT_DIR, name), pw, ph)
            seen.add((pw, ph))
            print("wrote", os.path.join("splash", name))
        media = ("(device-width: %dpx) and (device-height: %dpx) and "
                 "(-webkit-device-pixel-ratio: %d) and (orientation: portrait)"
                 % (cw, ch, dpr))
        links.append('    <link rel="apple-touch-startup-image" media="%s" href="splash/%s" />' % (media, name))
    with open(os.path.join(OUT_DIR, "_links.html"), "w") as f:
        f.write("\n".join(links) + "\n")
    print("wrote splash/_links.html (%d link tags)" % len(links))


if __name__ == "__main__":
    main()
