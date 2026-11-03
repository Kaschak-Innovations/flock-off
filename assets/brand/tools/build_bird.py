"""
Flock Off brand builder (bird mark).

Inputs, next to this file:
  bird_path.txt        the bird (wing feathers that form a raised middle finger)
  fonts/orbitron-latin-500-normal.woff2   wordmark face (SIL OFL), converted to outlines

Writes SVG sources and renders every icon / store PNG through headless Chromium.

  python3 build_bird.py <out_dir>
"""
from __future__ import annotations

import math
import re
import sys
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else HERE / "out").resolve()
FONT = HERE.parent / "fonts" / "orbitron-latin-700-normal.woff2"
FONT_TAG = HERE.parent / "fonts" / "orbitron-latin-600-normal.woff2"

GREEN = "#22C55E"
RED = "#EF4444"
WHITE = "#FFFFFF"
BG = "#0A0B0E"
BG_LIFT = "#16181D"
TEXT_SECONDARY = "#B9BDC5"

PATHS = {
    "rude": (HERE / "bird_path.txt").read_text().strip(),
}

# Mark box in the traced coordinate space (the reference image's pixels), padded a touch.
VX, VY, VW, VH = 274.0, 163.0, 508.0, 530.0
EYE_X, EYE_Y = 683.0, 504.5


def path_points(d: str) -> list[tuple[float, float]]:
    nums = [float(v) for v in re.findall(r"-?\d+\.?\d*", d)]
    return list(zip(nums[0::2], nums[1::2]))


def eye(variant: str, uid: str) -> str:
    cx, cy = EYE_X, EYE_Y
    if variant == "mono":
        return ""  # punched out of the silhouette instead
    if variant == "icon":
        # survives small sizes: dark socket, red iris, dark pupil
        return (f'<circle cx="{cx}" cy="{cy}" r="25" fill="{BG}"/>'
                f'<circle cx="{cx}" cy="{cy}" r="18.5" fill="{RED}"/>'
                f'<circle cx="{cx}" cy="{cy}" r="7.5" fill="{BG}"/>')
    # full: a camera aperture, six blades
    blades = []
    for i in range(6):
        a = math.radians(i * 60 + 15)
        x0, y0 = cx + 5.2 * math.cos(a), cy + 5.2 * math.sin(a)
        b = a + math.radians(62)
        x1, y1 = x0 + 13 * math.cos(b), y0 + 13 * math.sin(b)
        blades.append(f'<line x1="{x0:.2f}" y1="{y0:.2f}" x2="{x1:.2f}" y2="{y1:.2f}"/>')
    hexagon = " ".join(f"{cx + 5.6 * math.cos(math.radians(i * 60 + 15)):.2f},{cy + 5.6 * math.sin(math.radians(i * 60 + 15)):.2f}" for i in range(6))
    return (f'<circle cx="{cx}" cy="{cy}" r="21" fill="{BG}"/>'
            f'<circle cx="{cx}" cy="{cy}" r="15.5" fill="{RED}"/>'
            f'<g stroke="{BG}" stroke-width="1.8" stroke-linecap="round">{"".join(blades)}</g>'
            f'<polygon points="{hexagon}" fill="{BG}"/>')


def mark_group(shape: str = "rude", variant: str = "full", uid: str = "m", fill: str = GREEN) -> str:
    """Bird in mark units (0..VW, 0..VH)."""
    d = PATHS[shape]
    if variant == "mono":
        hole = f"M{EYE_X - 17},{EYE_Y} a17,17 0 1,0 34,0 a17,17 0 1,0 -34,0 Z"
        body = f'<path fill="{WHITE}" fill-rule="evenodd" d="{d} {hole}"/>'
    else:
        body = f'<path fill="{fill}" d="{d}"/>'
    return f'<g transform="translate({-VX},{-VY})">{body}{eye(variant, uid)}</g>'


def placed(width: float, x: float, y: float, **kw) -> str:
    k = width / VW
    return f'<g transform="translate({x:.2f},{y:.2f}) scale({k:.6f})">{mark_group(**kw)}</g>'


def max_radius(shape: str) -> float:
    """Farthest outline point from the mark box center, in mark units (for the adaptive-icon circle)."""
    cx, cy = VX + VW / 2, VY + VH / 2
    return max(math.hypot(x - cx, y - cy) for x, y in path_points(PATHS[shape]))


# ------------------------------------------------------------- wordmark
def ttf(path: Path) -> Path:
    out = path.with_suffix(".ttf")
    if not out.exists():
        f = TTFont(str(path))
        f.flavor = None
        f.save(str(out))
    return out


def text_outline(text: str, font_path: Path, tracking_em: float) -> tuple[str, float, float]:
    tp = ttf(font_path)
    face = hb.Face(hb.Blob(tp.read_bytes()))
    font = hb.Font(face)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True})
    tt = TTFont(str(tp))
    gs, order = tt.getGlyphSet(), tt.getGlyphOrder()
    cap = tt["OS/2"].sCapHeight or tt["head"].unitsPerEm * 0.7
    track = tracking_em * face.upem
    parts, x = [], 0.0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        pen = SVGPathPen(gs)
        gs[order[info.codepoint]].draw(pen)
        if pen.getCommands():
            parts.append(f'<path transform="translate({x + pos.x_offset:.1f},0) scale(1,-1)" d="{pen.getCommands()}"/>')
        x += pos.x_advance + track
    return "".join(parts), x - track, cap


FLOCK = text_outline("FLOCK", FONT, 0.08)
SPACE_EM = 0.62
OFF = text_outline("OFF", FONT, 0.08)


def wordmark(cap_h: float, x: float, baseline: float) -> tuple[str, float]:
    """FLOCK in white, OFF in green, cap height = cap_h. Returns (svg, width)."""
    k = cap_h / FLOCK[2]
    gap = SPACE_EM * cap_h / 0.72
    w1 = FLOCK[1] * k
    svg = (f'<g fill="{WHITE}" transform="translate({x:.2f},{baseline:.2f}) scale({k:.6f})">{FLOCK[0]}</g>'
           f'<g fill="{GREEN}" transform="translate({x + w1 + gap:.2f},{baseline:.2f}) scale({k:.6f})">{OFF[0]}</g>')
    return svg, w1 + gap + OFF[1] * k


def wordmark_width(cap_h: float) -> float:
    return wordmark(cap_h, 0, 0)[1]


# ------------------------------------------------------------- documents
def svg(w: float, h: float, body: str) -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" width="{w:g}" height="{h:g}">{body}</svg>'


def lift(w: float, h: float, uid: str) -> str:
    return (f'<defs><radialGradient id="lift-{uid}" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="{BG_LIFT}"/>'
            f'<stop offset="1" stop-color="{BG}"/></radialGradient></defs><rect width="{w}" height="{h}" fill="url(#lift-{uid})"/>')


LOCK_MARK_W = 520.0
LOCK_CAP = 62.0
LOCK_GAP = 70.0


def lockup(shape: str) -> tuple[str, float, float]:
    mh = LOCK_MARK_W * VH / VW
    ww = wordmark_width(LOCK_CAP)
    W = max(LOCK_MARK_W, ww)
    H = mh + LOCK_GAP + LOCK_CAP
    wm, _ = wordmark(LOCK_CAP, (W - ww) / 2, H)
    return placed(LOCK_MARK_W, (W - LOCK_MARK_W) / 2, 0, shape=shape, variant="full", uid=f"lk{shape}") + wm, W, H


def icon_set(shape: str) -> dict[str, tuple[str, int, int, bool]]:
    N = 1024
    docs: dict[str, tuple[str, int, int, bool]] = {}
    # iOS / generic icon: optical centering nudges the bird a little left and up (its mass sits low-left)
    w = 0.88 * N
    h = w * VH / VW
    docs["icon"] = (svg(N, N, lift(N, N, "i") + placed(w, (N - w) / 2 + 8, (N - h) / 2 - 4, shape=shape, variant="icon", uid="i")), N, N, False)
    # Adaptive foreground: every outline point inside the 72dp visible circle (radius 0.3333 * N);
    # only feather tips reach past the stricter 66dp line
    r_safe = 0.3333 * N
    aw = VW * r_safe / max_radius(shape)
    ah = aw * VH / VW
    docs["android-icon-foreground"] = (svg(N, N, placed(aw, (N - aw) / 2, (N - ah) / 2, shape=shape, variant="icon", uid="af")), N, N, True)
    docs["android-icon-background"] = (svg(N, N, lift(N, N, "ab")), N, N, False)
    docs["android-icon-monochrome"] = (svg(N, N, placed(aw, (N - aw) / 2, (N - ah) / 2, shape=shape, variant="mono", uid="am")), N, N, True)
    fw = 0.86 * 48
    fh = fw * VH / VW
    docs["favicon"] = (svg(48, 48, f'<rect width="48" height="48" rx="9" fill="{BG}"/>' + placed(fw, (48 - fw) / 2, (48 - fh) / 2, shape=shape, variant="icon", uid="fv")), 48, 48, True)
    pw = 0.88 * 512
    ph = pw * VH / VW
    docs["play-icon-512"] = (svg(512, 512, lift(512, 512, "p") + placed(pw, (512 - pw) / 2 + 4, (512 - ph) / 2 - 2, shape=shape, variant="icon", uid="p")), 512, 512, False)
    return docs


def preview(shape: str) -> str:
    body = [f'<rect width="1400" height="560" fill="#2A2D34"/>']
    x = 40
    for size in (48, 64, 96, 128, 180):
        w = 0.88 * size
        h = w * VH / VW
        body.append(f'<g transform="translate({x},40)"><clipPath id="c{size}"><rect width="{size}" height="{size}" rx="{size * 0.22}"/></clipPath>'
                    f'<g clip-path="url(#c{size})">{lift(size, size, f"pv{size}")}{placed(w, (size - w) / 2, (size - h) / 2, shape=shape, variant="icon", uid=f"pv{size}")}</g></g>')
        x += size + 40
    aw = VW * 0.3333 * 192 / max_radius(shape)
    ah = aw * VH / VW
    x = 40
    for name, clip in (("circle", '<circle cx="96" cy="96" r="85"/>'),
                       ("squircle", '<path d="M96,11 C160,11 181,32 181,96 C181,160 160,181 96,181 C32,181 11,160 11,96 C11,32 32,11 96,11 Z"/>'),
                       ("rounded", '<rect x="11" y="11" width="170" height="170" rx="40"/>')):
        body.append(f'<g transform="translate({x},280)"><clipPath id="a{name}">{clip}</clipPath><g clip-path="url(#a{name})">{lift(192, 192, "a" + name)}'
                    f'{placed(aw, (192 - aw) / 2, (192 - ah) / 2, shape=shape, variant="icon", uid="a" + name)}</g>'
                    f'<text x="96" y="215" fill="#DDD" font-family="sans-serif" font-size="14" text-anchor="middle">{name}</text></g>')
        x += 232
    body.append(f'<g transform="translate({x},280)"><circle cx="96" cy="96" r="85" fill="#D7E3F5"/>'
                f'<g style="filter:brightness(0) saturate(100%) invert(19%) sepia(28%) saturate(1500%) hue-rotate(195deg)">'
                f'{placed(aw, (192 - aw) / 2, (192 - ah) / 2, shape=shape, variant="mono", uid="th")}</g>'
                f'<text x="96" y="215" fill="#DDD" font-family="sans-serif" font-size="14" text-anchor="middle">themed (mono)</text></g>')
    lk, W, H = lockup(shape)
    k = 380 / W
    body.append(f'<g transform="translate(980,60) scale({k:.6f})">{lk}</g>')
    return svg(1400, 560, "".join(body))


def feature_graphic(shape: str) -> str:
    W, H = 1024, 500
    mw = 330
    mh = mw * VH / VW
    col_x = 470
    cap = 54
    ww = wordmark_width(cap)
    cap = min(cap, 500 * cap / ww)
    wm, ww = wordmark(cap, col_x, 0)
    tag, tw, tcap = text_outline("PLATE READER + SPEED CAMERA ALERTS", FONT_TAG, 0.06)
    tk = min(15 / tcap, ww / tw)
    block = cap + 28 + tcap * tk
    top = (H - block) / 2
    wm, _ = wordmark(cap, col_x, top + cap)
    return svg(W, H, lift(W, H, "fg") + placed(mw, 90, (H - mh) / 2, shape=shape, variant="full", uid="fg") + wm
               + f'<g fill="{TEXT_SECONDARY}" transform="translate({col_x},{top + block:.1f}) scale({tk:.6f})">{tag}</g>')


def build() -> dict[str, tuple[str, int, int, bool]]:
    docs: dict[str, tuple[str, int, int, bool]] = {}
    src = OUT / "brand"
    src.mkdir(parents=True, exist_ok=True)
    for shape in ("rude",):
        tag = ""
        (src / f"flock-off-bird{tag}.svg").write_text(svg(VW, VH, mark_group(shape, "full", "s" + shape)))
        (src / f"flock-off-bird{tag}-icon.svg").write_text(svg(VW, VH, mark_group(shape, "icon", "si" + shape)))
        (src / f"flock-off-bird{tag}-mono.svg").write_text(svg(VW, VH, mark_group(shape, "mono", "sm" + shape)))
        lk, W, H = lockup(shape)
        (src / f"flock-off-lockup{tag}.svg").write_text(svg(W, H, lk))
        (src / f"flock-off-lockup{tag}-dark.svg").write_text(svg(W + 160, H + 160, f'<rect width="{W + 160}" height="{H + 160}" fill="{BG}"/><g transform="translate(80,80)">{lk}</g>'))
        for name, doc in icon_set(shape).items():
            docs[f"{name}"] = doc
        docs[f"preview"] = (preview(shape), 1400, 560, False)
        docs[f"lockup-dark"] = (svg(W + 160, H + 160, f'<rect width="{W + 160}" height="{H + 160}" fill="{BG}"/><g transform="translate(80,80)">{lk}</g>'), int(W + 160), int(H + 160), False)
        sw = 1200
        sk = sw / W
        docs[f"splash-icon"] = (svg(sw, round(H * sk), f'<g transform="scale({sk:.6f})">{lk}</g>'), sw, round(H * sk), True)
        docs[f"feature-graphic"] = (feature_graphic(shape), 1024, 500, False)
    return docs


def render(docs: dict[str, tuple[str, int, int, bool]]) -> None:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(device_scale_factor=1)
        for name, (doc, w, h, transparent) in docs.items():
            out = OUT / "png" / f"{name}.png"
            out.parent.mkdir(parents=True, exist_ok=True)
            pg.set_viewport_size({"width": w, "height": h})
            pg.set_content(f"<!doctype html><html><head><style>html,body{{margin:0;background:transparent}}svg{{display:block}}</style></head><body>{doc}</body></html>")
            pg.screenshot(path=str(out), omit_background=transparent, clip={"x": 0, "y": 0, "width": w, "height": h})
        b.close()


if __name__ == "__main__":
    d = build()
    render(d)
    print("wrote", len(d), "PNGs to", OUT / "png")
