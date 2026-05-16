#!/usr/bin/env python3
"""Generate first-party raster Shop card art.

The Shop uses small square tiles, so catalog cards should read like big,
direct glyph plates rather than dense illustrations. This script keeps the
first-party app, widget, and cursor-set cards in the same odd-flat raster
language as the default icon cards.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SIZE = 1024
CARD = (SIZE, SIZE)
INK = "#080511"
RIM = "#07050f"
PAPER = "#f3efe7"
PAPER_2 = "#ded7cc"
CYAN = "#56e7f4"
PINK = "#ff5aa8"
VIOLET = "#9068ff"
GOLD = "#ffd45a"
GREEN = "#77ef8b"
ORANGE = "#ff9f55"


THEMES = {
    "board": (GOLD, CYAN, PINK),
    "flow": (VIOLET, CYAN, PINK),
    "ledger": (CYAN, GOLD, GREEN),
    "mosaic": (PINK, CYAN, GOLD),
    "sine": (VIOLET, PINK, CYAN),
    "swatch": (PINK, GOLD, CYAN),
    "tome": (VIOLET, PINK, PAPER),
    "eight-ball": (VIOLET, "#22316f", CYAN),
    "spotify": (GREEN, CYAN, VIOLET),
    "sticky": (GOLD, PINK, CYAN),
    "odd-default-cursors": (CYAN, VIOLET, PINK),
    "oddlings-cursors": (PINK, CYAN, VIOLET),
}


def rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def rgba(value: str, alpha: int = 255) -> tuple[int, int, int, int]:
    return (*rgb(value), alpha)


def mix(a: str, b: str, t: float) -> tuple[int, int, int]:
    ar, ag, ab = rgb(a)
    br, bg, bb = rgb(b)
    return (
        round(ar + (br - ar) * t),
        round(ag + (bg - ag) * t),
        round(ab + (bb - ab) * t),
    )


def rounded(draw: ImageDraw.ImageDraw, xy, radius: int, fill, outline=None, width: int = 1) -> None:
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def line_round(draw: ImageDraw.ImageDraw, points, fill, width: int) -> None:
    draw.line(points, fill=fill, width=width, joint="curve")
    radius = width // 2
    for x, y in (points[0], points[-1]):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)


def shadow_paste(base: Image.Image, layer: Image.Image, offset=(0, 28), blur=28, alpha=150) -> None:
    mask = layer.getchannel("A")
    shadow = Image.new("RGBA", CARD, (0, 0, 0, 0))
    shadow.putalpha(mask.point(lambda p: min(alpha, p)))
    shifted = Image.new("RGBA", CARD, (0, 0, 0, 0))
    shifted.alpha_composite(shadow, offset)
    base.alpha_composite(shifted.filter(ImageFilter.GaussianBlur(blur)))
    base.alpha_composite(layer)


def plate(accent: str, secondary: str, warm: str) -> Image.Image:
    img = Image.new("RGBA", CARD, rgba(INK))
    draw = ImageDraw.Draw(img)
    for y in range(SIZE):
        t = y / (SIZE - 1)
        draw.line((0, y, SIZE, y), fill=(*mix("#171126", "#05030a", t), 255))

    glows = Image.new("RGBA", CARD, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glows)
    gd.ellipse((-270, -210, 680, 610), fill=rgba(accent, 92))
    gd.ellipse((450, 455, 1290, 1260), fill=rgba(secondary, 80))
    gd.ellipse((250, -320, 1120, 420), fill=rgba(warm, 38))
    img.alpha_composite(glows.filter(ImageFilter.GaussianBlur(76)))

    grid = Image.new("RGBA", CARD, (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    for x in range(64, SIZE, 96):
        gd.line((x, 0, x, SIZE), fill=(255, 255, 255, 24), width=2)
    for y in range(64, SIZE, 96):
        gd.line((0, y, SIZE, y), fill=(255, 255, 255, 22), width=2)
    for x in range(112, SIZE, 192):
        gd.line((x, 0, x, SIZE), fill=rgba(accent, 28), width=2)
    img.alpha_composite(grid)

    shine = Image.new("RGBA", CARD, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shine)
    sd.ellipse((90, 46, 410, 210), fill=(255, 255, 255, 24))
    sd.ellipse((748, 120, 842, 214), fill=rgba(warm, 72))
    sd.ellipse((824, 188, 872, 236), fill=(255, 255, 255, 70))
    img.alpha_composite(shine.filter(ImageFilter.GaussianBlur(5)))

    return img


def card_rect(layer: Image.Image, xy, fill: str, radius: int = 34, tilt: float = 0) -> None:
    card = Image.new("RGBA", CARD, (0, 0, 0, 0))
    draw = ImageDraw.Draw(card)
    x1, y1, x2, y2 = xy
    rounded(draw, (x1 - 14, y1 - 14, x2 + 14, y2 + 14), radius + 12, rgba(RIM, 255))
    rounded(draw, xy, radius, rgba(fill, 255))
    rounded(draw, (x1 + 22, y1 + 44, x2 - 34, y1 + 72), 14, rgba(INK, 120))
    rounded(draw, (x1 + 22, y1 + 102, x2 - 80, y1 + 130), 14, rgba(INK, 108))
    rounded(draw, (x1 + 22, y2 - 78, x1 + 76, y2 - 24), 17, (255, 255, 255, 64))
    if tilt:
        card = card.rotate(tilt, resample=Image.Resampling.BICUBIC, center=(SIZE // 2, SIZE // 2))
    layer.alpha_composite(card)


def draw_board(layer: Image.Image, colors) -> None:
    card_rect(layer, (184, 210, 412, 514), colors[0], tilt=-7)
    card_rect(layer, (424, 184, 656, 506), colors[2], tilt=5)
    card_rect(layer, (330, 520, 626, 820), colors[1], tilt=-3)
    d = ImageDraw.Draw(layer)
    line_round(d, [(684, 294), (754, 294), (754, 636), (682, 636)], rgba(PAPER, 245), 38)
    line_round(d, [(684, 294), (754, 294), (754, 636), (682, 636)], rgba(RIM, 255), 18)


def draw_flow(layer: Image.Image, colors) -> None:
    d = ImageDraw.Draw(layer)
    path = [(294, 260), (294, 482), (514, 482), (514, 704), (736, 704)]
    line_round(d, path, rgba(RIM, 255), 70)
    line_round(d, path, rgba(colors[0], 255), 38)
    nodes = [
        (294, 260, colors[2], 92),
        (514, 482, colors[1], 84),
        (294, 704, colors[0], 80),
        (736, 704, colors[2], 84),
    ]
    line_round(d, [(294, 704), (736, 704)], rgba(RIM, 255), 70)
    line_round(d, [(294, 704), (736, 704)], rgba(colors[0], 255), 38)
    for x, y, fill, radius in nodes:
        d.ellipse((x - radius - 18, y - radius - 18, x + radius + 18, y + radius + 18), fill=rgba(RIM, 255))
        d.ellipse((x - radius, y - radius, x + radius, y + radius), fill=rgba(fill, 255))
        d.ellipse((x - 26, y - 44, x + 22, y + 4), fill=(255, 255, 255, 74))


def draw_ledger(layer: Image.Image, colors) -> None:
    d = ImageDraw.Draw(layer)
    rounded(d, (222, 182, 780, 820), 48, rgba(RIM, 255))
    rounded(d, (252, 210, 750, 790), 36, rgba(PAPER, 255))
    for y in (318, 414, 510, 606):
        line_round(d, [(312, y), (688, y)], rgba(INK, 70), 14)
    bars = [
        (330, 636, 388, 718, colors[0]),
        (426, 562, 486, 718, colors[2]),
        (522, 472, 582, 718, colors[1]),
        (620, 380, 680, 718, colors[0]),
    ]
    for x1, y1, x2, y2, fill in bars:
        rounded(d, (x1 - 9, y1 - 9, x2 + 9, y2 + 9), 22, rgba(RIM, 255))
        rounded(d, (x1, y1, x2, y2), 16, rgba(fill, 255))
    d.ellipse((300, 250, 406, 356), fill=rgba(GOLD, 255))
    d.ellipse((322, 272, 384, 334), fill=rgba(INK, 210))


def draw_mosaic(layer: Image.Image, colors) -> None:
    d = ImageDraw.Draw(layer)
    fills = [colors[2], colors[1], colors[0], GOLD, VIOLET, CYAN, PINK, GREEN, PAPER]
    size = 132
    gap = 24
    start = 250
    idx = 0
    for row in range(3):
        for col in range(3):
            x = start + col * (size + gap)
            y = 236 + row * (size + gap)
            skew = -16 if (row + col) % 2 else 10
            tile = Image.new("RGBA", CARD, (0, 0, 0, 0))
            td = ImageDraw.Draw(tile)
            rounded(td, (x - 13, y - 13, x + size + 13, y + size + 13), 26, rgba(RIM, 255))
            rounded(td, (x, y, x + size, y + size), 18, rgba(fills[idx % len(fills)], 255))
            rounded(td, (x + 18, y + 18, x + 48, y + 48), 11, (255, 255, 255, 80))
            tile = tile.rotate(skew * 0.25, resample=Image.Resampling.BICUBIC, center=(x + size / 2, y + size / 2))
            layer.alpha_composite(tile)
            idx += 1


def draw_sine(layer: Image.Image, colors) -> None:
    d = ImageDraw.Draw(layer)
    points = []
    for x in range(166, 858, 14):
        t = (x - 166) / (858 - 166)
        y = 502 + math.sin(t * math.tau * 2.1 - 0.4) * 136
        points.append((x, y))
    line_round(d, points, rgba(RIM, 255), 74)
    line_round(d, points, rgba(colors[0], 255), 42)
    line_round(d, [(192, 730), (832, 730)], rgba(RIM, 255), 46)
    line_round(d, [(192, 730), (832, 730)], rgba(PAPER, 245), 22)
    for x, fill in ((312, colors[1]), (512, colors[2]), (714, colors[0])):
        d.ellipse((x - 58, 672, x + 58, 788), fill=rgba(RIM, 255))
        d.ellipse((x - 42, 688, x + 42, 772), fill=rgba(fill, 255))


def draw_swatch(layer: Image.Image, colors) -> None:
    d = ImageDraw.Draw(layer)
    blobs = [
        (340, 326, 146, colors[2]),
        (604, 328, 146, colors[1]),
        (354, 604, 148, colors[0]),
        (626, 612, 148, VIOLET),
        (500, 468, 118, PAPER),
    ]
    for x, y, radius, fill in blobs:
        d.ellipse((x - radius - 18, y - radius - 18, x + radius + 18, y + radius + 18), fill=rgba(RIM, 255))
        d.ellipse((x - radius, y - radius, x + radius, y + radius), fill=rgba(fill, 255))
        d.ellipse((x - 42, y - 64, x + 22, y - 2), fill=(255, 255, 255, 76))
    d.ellipse((462, 430, 540, 508), fill=rgba(INK, 210))


def draw_tome(layer: Image.Image, colors) -> None:
    d = ImageDraw.Draw(layer)
    left = [(180, 246), (492, 296), (492, 798), (180, 744)]
    right = [(532, 296), (844, 246), (844, 744), (532, 798)]
    d.polygon([(156, 218), (512, 276), (868, 218), (868, 776), (512, 842), (156, 776)], fill=rgba(RIM, 255))
    d.polygon(left, fill=rgba(colors[0], 255))
    d.polygon(right, fill=rgba(colors[1], 255))
    rounded(d, (488, 282, 536, 814), 20, rgba(INK, 245))
    for y in (382, 470, 558, 646):
        line_round(d, [(236, y), (432, y + 24)], rgba(PAPER, 190), 18)
        line_round(d, [(592, y + 24), (786, y)], rgba(PAPER, 190), 18)
    d.polygon([(526, 312), (590, 306), (572, 444), (536, 420)], fill=rgba(GOLD, 255))


def draw_eight_ball(layer: Image.Image, colors) -> None:
    d = ImageDraw.Draw(layer)
    d.ellipse((196, 182, 828, 814), fill=rgba(RIM, 255))
    d.ellipse((226, 210, 798, 782), fill=(8, 8, 13, 255))
    d.ellipse((336, 270, 520, 438), fill=(255, 255, 255, 62))
    d.ellipse((372, 314, 652, 594), fill=rgba(PAPER, 255))
    d.ellipse((426, 368, 598, 540), fill=rgba(RIM, 255))
    d.ellipse((442, 384, 582, 524), fill=rgba(PAPER, 255))
    d.ellipse((472, 430, 552, 510), fill=rgba(RIM, 255))
    d.ellipse((338, 558, 686, 838), fill=rgba("#07112d", 255))
    d.polygon([(402, 604), (624, 604), (512, 784)], fill=rgba(colors[1], 255))
    d.polygon([(434, 626), (590, 626), (512, 746)], fill=rgba(colors[2], 230))


def draw_spotify(layer: Image.Image, colors) -> None:
    d = ImageDraw.Draw(layer)
    rounded(d, (210, 232, 814, 792), 72, rgba(RIM, 255))
    rounded(d, (246, 268, 778, 756), 54, rgba("#111923", 255))
    d.ellipse((334, 374, 518, 558), fill=rgba(colors[0], 255))
    d.polygon([(414, 422), (414, 510), (492, 466)], fill=rgba(INK, 230))
    for y, w in ((398, 236), (484, 306), (570, 256), (656, 184)):
        line_round(d, [(548, y), (548 + w, y)], rgba(colors[0], 255), 34)
    d.ellipse((304, 628, 362, 686), fill=rgba(colors[1], 255))
    d.ellipse((396, 628, 454, 686), fill=rgba(colors[2], 255))


def draw_sticky(layer: Image.Image, colors) -> None:
    d = ImageDraw.Draw(layer)
    note = Image.new("RGBA", CARD, (0, 0, 0, 0))
    nd = ImageDraw.Draw(note)
    rounded(nd, (258, 196, 768, 790), 36, rgba(RIM, 255))
    rounded(nd, (286, 224, 740, 762), 24, rgba(colors[0], 255))
    nd.polygon([(654, 224), (740, 224), (740, 318)], fill=rgba("#ffef9a", 255))
    nd.polygon([(654, 224), (740, 318), (654, 318)], fill=rgba(ORANGE, 190))
    for y, w in ((382, 278), (488, 330), (594, 252)):
        line_round(nd, [(364, y), (364 + w, y + 28)], rgba(INK, 140), 22)
    nd.ellipse((450, 264, 576, 390), fill=rgba(colors[1], 255))
    nd.ellipse((486, 300, 540, 354), fill=rgba(RIM, 220))
    note = note.rotate(-5, resample=Image.Resampling.BICUBIC, center=(512, 512))
    layer.alpha_composite(note)


def cursor_shape(layer: Image.Image, x: int, y: int, scale: float, fill: str, accent: str, rotate: float = 0) -> None:
    points = [
        (x, y),
        (x + 210 * scale, y + 124 * scale),
        (x + 124 * scale, y + 154 * scale),
        (x + 176 * scale, y + 286 * scale),
        (x + 106 * scale, y + 312 * scale),
        (x + 56 * scale, y + 180 * scale),
        (x, y + 238 * scale),
    ]
    icon = Image.new("RGBA", CARD, (0, 0, 0, 0))
    d = ImageDraw.Draw(icon)
    d.polygon(points, fill=rgba(RIM, 255))
    inset = [(px + (512 - px) * 0.035, py + (512 - py) * 0.035) for px, py in points]
    d.polygon(inset, fill=rgba(fill, 255))
    d.ellipse((x + 48 * scale, y + 54 * scale, x + 104 * scale, y + 110 * scale), fill=rgba(accent, 255))
    d.ellipse((x + 65 * scale, y + 70 * scale, x + 88 * scale, y + 92 * scale), fill=rgba(INK, 210))
    if rotate:
        icon = icon.rotate(rotate, resample=Image.Resampling.BICUBIC, center=(x + 100 * scale, y + 148 * scale))
    layer.alpha_composite(icon)


def draw_cursors(layer: Image.Image, colors, oddlings: bool = False) -> None:
    d = ImageDraw.Draw(layer)
    line_round(d, [(220, 768), (806, 312)], rgba(colors[0], 94), 28)
    cursor_shape(layer, 214, 210, 1.24, PAPER, colors[0], -4)
    cursor_shape(layer, 560, 204, 0.9, colors[1] if oddlings else PAPER, colors[2], 8)
    cursor_shape(layer, 420, 570, 0.78, colors[2], colors[0], -18)
    for x, y, fill in ((724, 664, colors[0]), (694, 560, colors[2]), (792, 500, colors[1])):
        d.ellipse((x - 22, y - 22, x + 22, y + 22), fill=rgba(fill, 220))


DRAWERS = {
    "board": draw_board,
    "flow": draw_flow,
    "ledger": draw_ledger,
    "mosaic": draw_mosaic,
    "sine": draw_sine,
    "swatch": draw_swatch,
    "tome": draw_tome,
    "eight-ball": draw_eight_ball,
    "spotify": draw_spotify,
    "sticky": draw_sticky,
}


def render(slug: str) -> Image.Image:
    colors = THEMES[slug]
    base = plate(*colors)
    glyph = Image.new("RGBA", CARD, (0, 0, 0, 0))
    if slug in DRAWERS:
        DRAWERS[slug](glyph, colors)
    elif slug == "odd-default-cursors":
        draw_cursors(glyph, colors, False)
    elif slug == "oddlings-cursors":
        draw_cursors(glyph, colors, True)
    else:
        raise SystemExit(f"no drawer for {slug}")
    shadow_paste(base, glyph)
    return base.convert("RGB")


def write_card(path: Path, slug: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    render(slug).save(path, "WEBP", quality=88, method=6)
    print(path)


def main() -> None:
    for slug in ("board", "flow", "ledger", "mosaic", "sine", "swatch", "tome"):
        write_card(ROOT / "_tools" / "catalog-sources" / "apps" / slug / "card.webp", slug)
    for slug in ("eight-ball", "spotify", "sticky"):
        write_card(ROOT / "_tools" / "catalog-sources" / "widgets" / slug / "card.webp", slug)
    for slug in ("odd-default-cursors", "oddlings-cursors"):
        write_card(ROOT / "_tools" / "catalog-sources" / "cursor-sets" / slug / "card.webp", slug)


if __name__ == "__main__":
    main()
