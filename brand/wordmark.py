"""Draw the README header: the Weave mark beside the name, as outlines.

    .venv/bin/python brand/wordmark.py

Writes docs/figure/readme-header-light.svg and readme-header-dark.svg.
"""
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[1]
FONT = ROOT / "assets" / "RobotoFlex.ttf"
OUT = ROOT / "docs" / "figure"
NAME = "Weave"
AXES = {"wght": 700, "wdth": 112, "opsz": 96}
CANVAS = (480, 116)
TILE_PX = 88
GAP_PX = 22
CAP_PX = 64
TRACKING_EM = -0.02
MARK = ("M16 48.78 8 15.22H16.83L22.85 43.03L21.43 41.98H25.15L23.54 43.03L28.09 16.41H35.03L28.74 48.78Z"
        "M35.95 48.78 29.2 16.41H36.51L41.84 43.03L40.23 41.98H43.72L42.53 43.03L47.72 15.22H56L48.97 48.78Z")


def outlines() -> tuple[str, float]:
    font = instancer.instantiateVariableFont(TTFont(FONT), AXES)
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    upem = font["head"].unitsPerEm
    scale = CAP_PX / font["OS/2"].sCapHeight
    pen = SVGPathPen(glyphs)
    x = 0.0
    for char in NAME:
        name = cmap[ord(char)]
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, 0)))
        x += (glyphs[name].width + TRACKING_EM * upem) * scale
    return pen.getCommands(), x - TRACKING_EM * upem * scale


def header(ink: str, ground: str) -> str:
    path, width = outlines()
    total = TILE_PX + GAP_PX + width
    left = (CANVAS[0] - total) / 2
    top = (CANVAS[1] - TILE_PX) / 2
    baseline = top + (TILE_PX + CAP_PX) / 2
    k = TILE_PX / 64
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {CANVAS[0]} {CANVAS[1]}" '
        f'width="{CANVAS[0]}" height="{CANVAS[1]}" role="img" aria-label="{NAME}">'
        f'<g transform="translate({left:.2f} {top:.2f}) scale({k:.4f})">'
        f'<rect width="64" height="64" rx="14" fill="{ink}"/><path d="{MARK}" fill="{ground}"/></g>'
        f'<path transform="translate({left + TILE_PX + GAP_PX:.2f} {baseline:.2f})" d="{path}" fill="{ink}"/>'
        "</svg>\n"
    )


if __name__ == "__main__":
    (OUT / "readme-header-light.svg").write_text(header("#000000", "#ffffff"))
    (OUT / "readme-header-dark.svg").write_text(header("#ffffff", "#000000"))
    print("wrote", OUT / "readme-header-light.svg", "and readme-header-dark.svg")
