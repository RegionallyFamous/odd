#!/usr/bin/env python3
"""Generate first-party raster Shop card art.

The Shop renders catalog artwork in a landscape card slot, so generated
cards should be 1024x576 plates with one clear central subject. This script
keeps first-party app, widget, cursor-set, and icon-set cards in the same
odd-flat raster language as the default icon cards.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SIZE = 1024
CARD = (1024, 576)
GLYPH_CANVAS = (SIZE, SIZE)
CURSOR_CARD = CARD
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


def clean_hex(value: str, fallback: str) -> str:
    value = (value or "").strip()
    if len(value) == 4 and value.startswith("#"):
        return "#" + "".join(ch * 2 for ch in value[1:])
    if len(value) in (7, 9) and value.startswith("#"):
        try:
            int(value[1:7], 16)
        except ValueError:
            return fallback
        return value[:7]
    return fallback


def rounded(draw: ImageDraw.ImageDraw, xy, radius: int, fill, outline=None, width: int = 1) -> None:
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def line_round(draw: ImageDraw.ImageDraw, points, fill, width: int) -> None:
    draw.line(points, fill=fill, width=width, joint="curve")
    radius = width // 2
    for x, y in (points[0], points[-1]):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)


def shadow_paste(
    base: Image.Image,
    layer: Image.Image,
    *,
    position: tuple[int, int] = (0, 0),
    offset=(0, 28),
    blur=28,
    alpha=150,
) -> None:
    mask = layer.getchannel("A")
    shadow = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    shadow.putalpha(mask.point(lambda p: min(alpha, p)))
    shifted = Image.new("RGBA", base.size, (0, 0, 0, 0))
    shifted.alpha_composite(shadow, (position[0] + offset[0], position[1] + offset[1]))
    base.alpha_composite(shifted.filter(ImageFilter.GaussianBlur(blur)))
    base.alpha_composite(layer, position)


def plate(accent: str, secondary: str, warm: str) -> Image.Image:
    width, height = CARD
    img = Image.new("RGBA", CARD, rgba(INK))
    draw = ImageDraw.Draw(img)
    for y in range(height):
        t = y / (height - 1)
        draw.line((0, y, width, y), fill=(*mix("#171126", "#05030a", t), 255))

    glows = Image.new("RGBA", CARD, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glows)
    gd.ellipse((-270, -210, 680, 610), fill=rgba(accent, 92))
    gd.ellipse((450, 455, 1290, 1260), fill=rgba(secondary, 80))
    gd.ellipse((250, -320, 1120, 420), fill=rgba(warm, 38))
    img.alpha_composite(glows.filter(ImageFilter.GaussianBlur(76)))

    grid = Image.new("RGBA", CARD, (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    for x in range(64, width, 96):
        gd.line((x, 0, x, height), fill=(255, 255, 255, 24), width=2)
    for y in range(64, height, 96):
        gd.line((0, y, width, y), fill=(255, 255, 255, 22), width=2)
    for x in range(112, width, 192):
        gd.line((x, 0, x, height), fill=rgba(accent, 28), width=2)
    img.alpha_composite(grid)

    shine = Image.new("RGBA", CARD, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shine)
    sd.ellipse((90, 46, 410, 210), fill=(255, 255, 255, 24))
    sd.ellipse((748, 120, 842, 214), fill=rgba(warm, 72))
    sd.ellipse((824, 188, 872, 236), fill=(255, 255, 255, 70))
    img.alpha_composite(shine.filter(ImageFilter.GaussianBlur(5)))
    return img


def card_rect(layer: Image.Image, xy, fill: str, radius: int = 34, tilt: float = 0) -> None:
    card = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(card)
    x1, y1, x2, y2 = xy
    rounded(draw, (x1 - 14, y1 - 14, x2 + 14, y2 + 14), radius + 12, rgba(RIM, 255))
    rounded(draw, xy, radius, rgba(fill, 255))
    rounded(draw, (x1 + 22, y1 + 44, x2 - 34, y1 + 72), 14, rgba(INK, 120))
    rounded(draw, (x1 + 22, y1 + 102, x2 - 80, y1 + 130), 14, rgba(INK, 108))
    rounded(draw, (x1 + 22, y2 - 78, x1 + 76, y2 - 24), 17, (255, 255, 255, 64))
    if tilt:
        card = card.rotate(tilt, resample=Image.Resampling.BICUBIC, center=(layer.width // 2, layer.height // 2))
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


def cursor_manifest_palette(src_dir: Path) -> tuple[str, str, str, str, str]:
    meta = json.loads((src_dir / "manifest.json").read_text())
    effects = meta.get("effects") if isinstance(meta.get("effects"), dict) else {}
    accent = clean_hex(effects.get("accent") or meta.get("accent") or CYAN, CYAN)
    spark = clean_hex(effects.get("spark") or PINK, PINK)
    warm = clean_hex(effects.get("warm") or GOLD, GOLD)
    ink = clean_hex(effects.get("ink") or INK, INK)
    recipe = str(effects.get("recipe") or ("oddlings" if meta.get("slug") == "oddlings-cursors" else "default"))
    return accent, spark, warm, ink, recipe


def cursor_card_plate(accent: str, spark: str, warm: str, ink: str) -> Image.Image:
    width, height = CURSOR_CARD
    img = Image.new("RGBA", CURSOR_CARD, rgba("#100719"))
    draw = ImageDraw.Draw(img)
    for y in range(height):
        t = y / (height - 1)
        draw.line((0, y, width, y), fill=(*mix("#1a0a24", ink, t * 0.78), 255))

    glows = Image.new("RGBA", CURSOR_CARD, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glows)
    gd.ellipse((-260, -210, 560, 560), fill=rgba(accent, 76))
    gd.ellipse((520, -220, 1280, 430), fill=rgba(spark, 56))
    gd.ellipse((180, 290, 960, 820), fill=rgba(warm, 34))
    img.alpha_composite(glows.filter(ImageFilter.GaussianBlur(62)))

    grain = Image.new("RGBA", CURSOR_CARD, (0, 0, 0, 0))
    gd = ImageDraw.Draw(grain)
    for x in range(26, width, 38):
        for y in range(22, height, 38):
            if (x * 13 + y * 7) % 5 == 0:
                gd.ellipse((x, y, x + 2, y + 2), fill=(255, 255, 255, 24))
    img.alpha_composite(grain)
    return img


def cursor_pointer_layer(x: int, y: int, scale: float, rotate: float = 0) -> Image.Image:
    layer = Image.new("RGBA", CURSOR_CARD, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    points = [
        (x, y),
        (x + 166 * scale, y + 98 * scale),
        (x + 98 * scale, y + 122 * scale),
        (x + 138 * scale, y + 226 * scale),
        (x + 82 * scale, y + 250 * scale),
        (x + 42 * scale, y + 144 * scale),
        (x, y + 188 * scale),
    ]
    d.polygon(points, fill=rgba(RIM, 255))
    d.line(points + [points[0]], fill=(255, 255, 255, 160), width=max(4, int(6 * scale)), joint="curve")
    inset = [(px + (512 - px) * 0.018, py + (288 - py) * 0.018) for px, py in points]
    d.polygon(inset, fill=rgba(PAPER, 255))
    d.line([(x + 88 * scale, y + 132 * scale), (x + 134 * scale, y + 230 * scale)], fill=rgba(RIM, 220), width=max(8, int(13 * scale)))
    d.line([(x + 101 * scale, y + 136 * scale), (x + 146 * scale, y + 220 * scale)], fill=rgba(PAPER_2, 245), width=max(5, int(7 * scale)))
    if rotate:
        layer = layer.rotate(rotate, resample=Image.Resampling.BICUBIC, center=(x + 84 * scale, y + 128 * scale))
    return layer


def paste_with_shadow(base: Image.Image, layer: Image.Image, offset=(0, 14), blur=18, alpha=150) -> None:
    mask = layer.getchannel("A")
    shadow = Image.new("RGBA", CURSOR_CARD, (0, 0, 0, 0))
    shadow.putalpha(mask.point(lambda p: min(alpha, p)))
    shifted = Image.new("RGBA", CURSOR_CARD, (0, 0, 0, 0))
    shifted.alpha_composite(shadow, offset)
    base.alpha_composite(shifted.filter(ImageFilter.GaussianBlur(blur)))
    base.alpha_composite(layer)


def draw_ring(draw: ImageDraw.ImageDraw, center: tuple[int, int], radius: int, color: str, width: int, alpha: int = 180) -> None:
    x, y = center
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), outline=rgba(color, alpha), width=width)


def draw_arc(draw: ImageDraw.ImageDraw, box, start: int, end: int, color: str, width: int, alpha: int = 210) -> None:
    draw.arc(box, start=start, end=end, fill=rgba(color, alpha), width=width)


def draw_cursor_effect(base: Image.Image, recipe: str, accent: str, spark: str, warm: str) -> None:
    d = ImageDraw.Draw(base)
    if recipe == "gel-pop":
        for x, y, r, fill, a in ((392, 278, 100, accent, 90), (488, 218, 58, spark, 78), (616, 336, 42, warm, 86), (284, 364, 28, accent, 120)):
            d.ellipse((x - r, y - r, x + r, y + r), fill=rgba(fill, a))
        line_round(d, [(248, 402), (346, 372), (446, 402), (550, 372)], rgba(accent, 150), 18)
        for x, y, r in ((682, 188, 9), (724, 232, 13), (196, 318, 11), (764, 378, 10)):
            d.ellipse((x - r, y - r, x + r, y + r), fill=rgba(spark if x % 2 else warm, 210))
    elif recipe == "moonlight-focus":
        for radius, color, width, alpha in ((132, accent, 8, 190), (188, spark, 4, 110), (236, warm, 3, 86)):
            draw_ring(d, (512, 288), radius, color, width, alpha)
        line_round(d, [(512, 58), (512, 154)], rgba(accent, 150), 4)
        line_round(d, [(512, 422), (512, 518)], rgba(accent, 150), 4)
        line_round(d, [(282, 288), (380, 288)], rgba(accent, 150), 4)
        line_round(d, [(644, 288), (742, 288)], rgba(accent, 150), 4)
        d.ellipse((704, 154, 734, 184), fill=rgba(spark, 170))
        d.ellipse((276, 390, 294, 408), fill=rgba(warm, 180))
    elif recipe == "paper-sparks":
        line_round(d, [(260, 408), (388, 362), (526, 390), (674, 336), (806, 362)], rgba(spark, 150), 12)
        for i, (x, y, fill) in enumerate(((270, 178, warm), (330, 244, accent), (410, 150, PAPER), (612, 190, warm), (688, 270, spark), (744, 174, PAPER), (792, 338, accent), (540, 418, PAPER), (212, 336, spark))):
            shard = Image.new("RGBA", CURSOR_CARD, (0, 0, 0, 0))
            sd = ImageDraw.Draw(shard)
            sd.rounded_rectangle((x - 12, y - 9, x + 12, y + 9), radius=3, fill=rgba(fill, 210))
            shard = shard.rotate((i * 17) % 42 - 20, resample=Image.Resampling.BICUBIC, center=(x, y))
            base.alpha_composite(shard)
    elif recipe == "signal-bloom":
        for radius, alpha in ((74, 210), (118, 150), (168, 100), (226, 68)):
            draw_ring(d, (512, 288), radius, accent, 5, alpha)
        for x in range(260, 790, 58):
            y = 376 + round(math.sin(x * 0.04) * 34)
            d.rounded_rectangle((x - 12, y - 12, x + 12, y + 12), radius=5, fill=rgba(spark if x % 3 else warm, 180))
        line_round(d, [(230, 420), (342, 420), (342, 456), (456, 456), (456, 424)], rgba(accent, 150), 10)
    elif recipe == "solar-orbit":
        draw_arc(d, (238, 86, 786, 574), 190, 350, warm, 18, 210)
        draw_arc(d, (330, 126, 888, 624), 208, 328, accent, 8, 170)
        d.ellipse((680, 132, 726, 178), fill=rgba(accent, 220))
        d.ellipse((704, 158, 718, 172), fill=(255, 255, 255, 210))
        for x, y, r in ((610, 212, 22), (760, 322, 12), (342, 410, 14)):
            d.ellipse((x - r, y - r, x + r, y + r), fill=rgba(spark, 190))
    else:
        for radius, color, width, alpha in ((92, accent, 12, 190), (150, spark, 6, 110), (214, warm, 3, 70)):
            draw_ring(d, (512, 288), radius, color, width, alpha)
        line_round(d, [(250, 410), (354, 384), (464, 408), (588, 386)], rgba(accent, 130), 13)
        for x, y, color in ((700, 188, warm), (308, 210, spark), (758, 364, accent), (228, 350, warm)):
            d.ellipse((x - 12, y - 12, x + 12, y + 12), fill=rgba(color, 200))

    if recipe == "oddlings":
        for x, y, color in ((330, 168, accent), (684, 184, spark), (744, 394, warm), (278, 392, accent), (618, 444, spark)):
            d.ellipse((x - 24, y - 24, x + 24, y + 24), fill=rgba(RIM, 210))
            d.ellipse((x - 15, y - 15, x + 15, y + 15), fill=rgba(color, 230))
            d.ellipse((x - 6, y - 6, x + 6, y + 6), fill=rgba(INK, 230))


def render_cursor_card(src_dir: Path) -> Image.Image:
    accent, spark, warm, ink, recipe = cursor_manifest_palette(src_dir)
    base = cursor_card_plate(accent, spark, warm, ink)
    draw_cursor_effect(base, recipe, accent, spark, warm)
    pointer = cursor_pointer_layer(454, 174, 1.16, -6 if recipe in ("gel-pop", "solar-orbit") else 0)
    paste_with_shadow(base, pointer, offset=(0, 18), blur=18, alpha=170)
    glow = Image.new("RGBA", CURSOR_CARD, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((400, 156, 650, 404), outline=rgba(accent, 110), width=10)
    base.alpha_composite(glow.filter(ImageFilter.GaussianBlur(4)))
    return base.convert("RGB")


def write_cursor_card(src_dir: Path) -> None:
    path = src_dir / "card.webp"
    render_cursor_card(src_dir).save(path, "WEBP", quality=88, method=6)
    print(path)


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
    glyph = Image.new("RGBA", GLYPH_CANVAS, (0, 0, 0, 0))
    if slug in DRAWERS:
        DRAWERS[slug](glyph, colors)
    else:
        raise SystemExit(f"no drawer for {slug}")
    glyph.thumbnail((520, 520), Image.Resampling.LANCZOS)
    position = ((CARD[0] - glyph.width) // 2, (CARD[1] - glyph.height) // 2 + 8)
    shadow_paste(base, glyph, position=position, offset=(0, 20), blur=18, alpha=132)
    return base.convert("RGB")


def write_card(path: Path, slug: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    render(slug).save(path, "WEBP", quality=88, method=6)
    print(path)


def render_iconset_card(src_dir: Path) -> Image.Image:
    meta = json.loads((src_dir / "manifest.json").read_text())
    accent = clean_hex(meta.get("accent") or CYAN, CYAN)
    base = plate(accent, PINK, GOLD)
    icons = meta.get("icons") or {}
    preview_keys = [key for key in ("odd", "my-wordpress", "content-graph", "recycle-bin", "fallback") if key in icons]
    preview_keys.extend([key for key in icons.keys() if key not in preview_keys])
    placements = [
        (preview_keys[0] if len(preview_keys) > 0 else "fallback", 388, 128, 300, 0),
        (preview_keys[1] if len(preview_keys) > 1 else "fallback", 112, 88, 214, -4),
        (preview_keys[2] if len(preview_keys) > 2 else "fallback", 700, 84, 214, 4),
        (preview_keys[3] if len(preview_keys) > 3 else "fallback", 184, 336, 188, 3),
        (preview_keys[4] if len(preview_keys) > 4 else "fallback", 652, 334, 188, -3),
    ]
    for key, x, y, size, rot in placements:
        rel = icons.get(key) or icons.get("fallback") or next(iter(icons.values()), "")
        if not rel:
            continue
        with Image.open(src_dir / rel) as src:
            icon = src.convert("RGBA")
            icon.thumbnail((size, size), Image.Resampling.LANCZOS)
            layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            layer.alpha_composite(icon, ((size - icon.width) // 2, (size - icon.height) // 2))
            if rot:
                layer = layer.rotate(rot, resample=Image.Resampling.BICUBIC, expand=True)
            shadow = Image.new("RGBA", layer.size, (0, 0, 0, 0))
            alpha = layer.getchannel("A").filter(ImageFilter.GaussianBlur(18))
            shadow.putalpha(alpha.point(lambda p: min(132, p)))
            px = x - (layer.width - size) // 2
            py = y - (layer.height - size) // 2
            base.alpha_composite(shadow, (px, py + 24))
            base.alpha_composite(layer, (px, py))
    return base.convert("RGB")


def write_iconset_card(src_dir: Path) -> None:
    path = src_dir / "card.webp"
    render_iconset_card(src_dir).save(path, "WEBP", quality=88, method=6)
    print(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "targets",
        nargs="*",
        choices=("all", "apps", "widgets", "cursors", "icon-sets"),
        default=("all",),
        help="Card groups to regenerate.",
    )
    args = parser.parse_args()
    targets = set(args.targets or ("all",))

    if "all" in targets or "icon-sets" in targets:
        for folder in sorted((ROOT / "_tools" / "catalog-sources" / "icon-sets").iterdir()):
            if folder.is_dir() and (folder / "manifest.json").is_file():
                write_iconset_card(folder)

    if "all" in targets or "apps" in targets:
        for slug in ("board", "flow", "ledger", "mosaic", "sine", "swatch", "tome"):
            write_card(ROOT / "_tools" / "catalog-sources" / "apps" / slug / "card.webp", slug)

    if "all" in targets or "widgets" in targets:
        for slug in ("eight-ball", "spotify", "sticky"):
            write_card(ROOT / "_tools" / "catalog-sources" / "widgets" / slug / "card.webp", slug)

    if "all" in targets or "cursors" in targets:
        for folder in sorted((ROOT / "_tools" / "catalog-sources" / "cursor-sets").iterdir()):
            if folder.is_dir() and (folder / "manifest.json").is_file():
                write_cursor_card(folder)


if __name__ == "__main__":
    main()
