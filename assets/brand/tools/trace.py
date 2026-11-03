"""Trace the bird silhouette from the reference into an SVG path (viewBox in reference pixels)."""
import sys

import numpy as np
import potrace
from PIL import Image, ImageDraw, ImageFilter

SRC = str(__import__("pathlib").Path(__file__).resolve().parent.parent / "reference-bird-concept.jpg")
X0, Y0, X1, Y1 = 260, 150, 800, 710          # crop around the bird
UP = 4                                        # trace at 4x for smooth curves
EYE = (683, 504, 21)                          # center x, y, radius of the eye hole in reference px


def bird_mask() -> np.ndarray:
    im = Image.open(SRC).convert("RGB").crop((X0, Y0, X1, Y1))
    im = im.resize((im.width * UP, im.height * UP), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))
    a = np.asarray(im).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = (g > 120) & (g - b > 70)
    # fill the eye so the body is one solid shape; the eye is drawn on top separately
    mi = Image.fromarray((m * 255).astype(np.uint8))
    d = ImageDraw.Draw(mi)
    cx, cy, rr = EYE
    d.ellipse([((cx - X0) - rr - 3) * UP, ((cy - Y0) - rr - 3) * UP, ((cx - X0) + rr + 3) * UP, ((cy - Y0) + rr + 3) * UP], fill=255)
    return np.asarray(mi) > 127


def to_path(mask: np.ndarray) -> str:
    bm = potrace.Bitmap(mask)
    plist = bm.trace(turdsize=200, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY, alphamax=0.9, opticurve=True, opttolerance=0.3)
    k = 1 / UP
    def p(pt):
        return f"{pt.x * k + X0:.2f},{pt.y * k + Y0:.2f}"
    out = []
    for curve in plist:
        out.append("M" + p(curve.start_point))
        for seg in curve.segments:
            if seg.is_corner:
                out.append("L" + p(seg.c) + " L" + p(seg.end_point))
            else:
                out.append("C" + p(seg.c1) + " " + p(seg.c2) + " " + p(seg.end_point))
        out.append("Z")
    return " ".join(out)


if __name__ == "__main__":
    d = to_path(bird_mask())
    open(sys.argv[1] if len(sys.argv) > 1 else str(__import__("pathlib").Path(__file__).resolve().parent / "bird_path.txt"), "w").write(d)
    print(len(d), "chars,", d.count("M"), "subpaths")
