#!/usr/bin/env python3
"""Generate first-party raster Shop card art.

The Shop uses small square tiles, so catalog cards should read like big,
direct glyph plates rather than dense illustrations. This script keeps the
first-party app, widget, and cursor-set cards in the same odd-flat raster
language as the default icon cards.
"""

from __future__ import annotations

import argparse
import json
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

APP_CARD_LAYERS = {
    "board": "paper-fold",
    "flow": "line-loop",
    "ledger": "blueprint-grid",
    "mosaic": "misprint-dot",
    "sine": "filament-wire",
    "swatch": "blink-ring",
    "tome": "hologram-scan",
}

DEFAULT_ICONSET_FUN_LAYERS = {
    "arcade-tokens":     {"recipe": "coin-spark", "accent": "#f4c45f", "secondary": "#8a4a1b", "spark": "#fff36a"},
    "arctic":            {"recipe": "frost-rim", "accent": "#9eeaff", "secondary": "#d7f7ff", "spark": "#6aaefc"},
    "blueprint":         {"recipe": "blueprint-grid", "accent": "#4da3ff", "secondary": "#cfe6ff", "spark": "#7df7ff"},
    "botanical-plate":   {"recipe": "leaf-vein", "accent": "#88b957", "secondary": "#d5ef8c", "spark": "#fff0a6"},
    "brutalist-stencil": {"recipe": "stencil-spray", "accent": "#ff5f4f", "secondary": "#f0e4d2", "spark": "#24212a"},
    "circuit-bend":      {"recipe": "circuit-trace", "accent": "#2fb37a", "secondary": "#8dffcf", "spark": "#ffe66b"},
    "claymation":        {"recipe": "clay-smudge", "accent": "#ffb84d", "secondary": "#ff7c6d", "spark": "#ffe9a6"},
    "cross-stitch":      {"recipe": "stitch-cross", "accent": "#e87ca7", "secondary": "#ffe1ef", "spark": "#8ee7ff"},
    "eyeball-avenue":    {"recipe": "blink-ring", "accent": "#b35cff", "secondary": "#f36bff", "spark": "#7df7ff"},
    "filament":          {"recipe": "filament-wire", "accent": "#ffb000", "secondary": "#ff6bd6", "spark": "#50f2ff"},
    "fold":              {"recipe": "paper-fold", "accent": "#7c5cff", "secondary": "#c7b8ff", "spark": "#fff0a8"},
    "hologram":          {"recipe": "hologram-scan", "accent": "#9fd0ff", "secondary": "#8efff1", "spark": "#f0a7ff"},
    "lemonade-stand":    {"recipe": "citrus-pop", "accent": "#ffd64b", "secondary": "#b6ff66", "spark": "#ff8b4c"},
    "monoline":          {"recipe": "line-loop", "accent": "#00c2ff", "secondary": "#dff8ff", "spark": "#a66bff"},
    "odd-default-icons": {"recipe": "chroma-halo", "accent": "#38e8ff", "secondary": "#ff44b5", "spark": "#9556ff"},
    "risograph":         {"recipe": "misprint-dot", "accent": "#ff4fa8", "secondary": "#2ed3ff", "spark": "#ffdf57"},
    "stadium":           {"recipe": "pennant-stripe", "accent": "#d73a3a", "secondary": "#2e7eea", "spark": "#fff06a"},
    "tiki":              {"recipe": "carved-spark", "accent": "#c47a3c", "secondary": "#ffcf70", "spark": "#49e2a4"},
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


def shadow_paste(base: Image.Image, layer: Image.Image, offset=(0, 28), blur=28, alpha=150) -> None:
    mask = layer.getchannel("A")
    shadow = Image.new("RGBA", CARD, (0, 0, 0, 0))
    shadow.putalpha(mask.point(lambda p: min(alpha, p)))
    shifted = Image.new("RGBA", CARD, (0, 0, 0, 0))
    shifted.alpha_composite(shadow, offset)
    base.alpha_composite(shifted.filter(ImageFilter.GaussianBlur(blur)))
    base.alpha_composite(layer)


def draw_surface_layer(img: Image.Image, recipe: str, accent: str, secondary: str, spark: str) -> None:
    if not recipe:
        return
    layer = Image.new("RGBA", CARD, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    a = rgb(clean_hex(accent, CYAN))
    b = rgb(clean_hex(secondary, PINK))
    s = rgb(clean_hex(spark, GOLD))

    if recipe == "blueprint-grid":
        for pos in range(36, SIZE, 76):
            d.line((pos, 0, pos, SIZE), fill=(*a, 48), width=3)
            d.line((0, pos, SIZE, pos), fill=(*b, 34), width=2)
    elif recipe == "stitch-cross":
        for x in range(58, SIZE, 112):
            for y in range(58, SIZE, 112):
                d.line((x - 18, y - 18, x + 18, y + 18), fill=(*a, 56), width=7)
                d.line((x + 18, y - 18, x - 18, y + 18), fill=(*b, 46), width=7)
    elif recipe == "circuit-trace":
        for y in range(86, SIZE, 156):
            d.line((50, y, 350, y, 350, y + 66, 760, y + 66, 760, y + 22, 974, y + 22), fill=(*a, 52), width=8)
            d.ellipse((744, y + 50, 776, y + 82), fill=(*s, 90))
    elif recipe == "coin-spark":
        for r in range(140, 600, 92):
            d.ellipse((512 - r, 512 - r, 512 + r, 512 + r), outline=(*a, 42), width=8)
        for i in range(30):
            ang = math.tau * i / 30
            x = 512 + math.cos(ang) * 430
            y = 512 + math.sin(ang) * 430
            d.polygon([(x, y - 16), (x + 11, y), (x, y + 16), (x - 11, y)], fill=(*s, 92))
    elif recipe == "frost-rim":
        for i in range(0, SIZE, 84):
            d.line((i, 0, i - 230, SIZE), fill=(*b, 42), width=5)
            d.line((SIZE - i, 0, SIZE + 230 - i, SIZE), fill=(*a, 34), width=4)
        d.rounded_rectangle((58, 58, 966, 966), radius=116, outline=(*s, 66), width=14)
    elif recipe == "leaf-vein":
        for x in range(90, SIZE, 150):
            d.arc((x - 72, 100, x + 176, 896), 112, 244, fill=(*a, 54), width=8)
            d.line((x + 36, 184, x + 116, 412), fill=(*b, 38), width=5)
    elif recipe == "stencil-spray":
        for i in range(260):
            x = (i * 97) % SIZE
            y = (i * 211) % SIZE
            r = 2 + (i % 5)
            d.ellipse((x - r, y - r, x + r, y + r), fill=(*(a if i % 2 else b), 46))
    elif recipe == "clay-smudge":
        d.ellipse((-120, 80, 520, 640), fill=(*a, 42))
        d.ellipse((450, 260, 1170, 940), fill=(*b, 46))
        d.ellipse((210, -170, 880, 290), fill=(*s, 30))
        layer = layer.filter(ImageFilter.GaussianBlur(28))
    elif recipe == "blink-ring":
        for box, color in (((94, 260, 930, 764), a), ((244, 142, 780, 882), b), ((360, 360, 664, 664), s)):
            d.ellipse(box, outline=(*color, 62), width=16)
    elif recipe == "filament-wire":
        points = [(x, 512 + math.sin(x / 58) * 146) for x in range(-20, 1060, 24)]
        d.line(points, fill=(*a, 72), width=10, joint="curve")
        for x, y in points[::7]:
            d.ellipse((x - 13, y - 13, x + 13, y + 13), fill=(*s, 90))
    elif recipe == "paper-fold":
        d.polygon([(0, SIZE), (448, 0), (650, 0), (196, SIZE)], fill=(*a, 34))
        d.polygon([(554, 0), (SIZE, 0), (SIZE, 650)], fill=(*b, 44))
        d.line((448, 0, 196, SIZE), fill=(*s, 66), width=8)
    elif recipe == "hologram-scan":
        for y in range(34, SIZE, 42):
            d.line((0, y, SIZE, y), fill=(*a, 52), width=4)
        for x in range(-SIZE, SIZE, 172):
            d.line((x, SIZE, x + SIZE, 0), fill=(*b, 34), width=5)
    elif recipe == "citrus-pop":
        for i in range(18):
            ang = math.tau * i / 18
            p1 = (512 + math.cos(ang - .05) * 90, 512 + math.sin(ang - .05) * 90)
            p2 = (512 + math.cos(ang) * 560, 512 + math.sin(ang) * 560)
            p3 = (512 + math.cos(ang + .05) * 90, 512 + math.sin(ang + .05) * 90)
            d.polygon([p1, p2, p3], fill=(*(a if i % 2 else b), 36))
    elif recipe == "line-loop":
        for r in range(120, 670, 92):
            d.ellipse((512 - r, 512 - r, 512 + r, 512 + r), outline=(*(a if r % 184 else b), 50), width=9)
    elif recipe == "misprint-dot":
        for x in range(34, SIZE, 82):
            for y in range(34, SIZE, 82):
                d.ellipse((x - 9, y - 9, x + 9, y + 9), fill=(*a, 45))
                d.ellipse((x + 7, y - 2, x + 19, y + 10), fill=(*b, 35))
    elif recipe == "pennant-stripe":
        for x in range(-SIZE, SIZE, 108):
            d.polygon([(x, SIZE), (x + 56, SIZE), (x + 1080, 0), (x + 1024, 0)], fill=(*a, 46))
        d.polygon([(160, 140), (810, 248), (160, 356)], fill=(*s, 56))
    elif recipe == "carved-spark":
        for i in range(13):
            x = 90 + i * 76
            d.polygon([(x, 156), (x + 32, 238), (x - 44, 238)], fill=(*a, 46))
            d.polygon([(SIZE - x, 868), (990 - x, 786), (1068 - x, 786)], fill=(*b, 42))
        d.rounded_rectangle((70, 70, 954, 954), radius=92, outline=(*s, 48), width=12)
    else:
        d.ellipse((-160, 236, 452, 852), fill=(*a, 38))
        d.ellipse((570, 40, 1170, 620), fill=(*b, 36))
        d.line((150, 860, 884, 160), fill=(*s, 36), width=12)

    img.alpha_composite(layer)


def plate(accent: str, secondary: str, warm: str, layer_recipe: str | None = None) -> Image.Image:
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
    if layer_recipe:
        draw_surface_layer(img, layer_recipe, accent, secondary, warm)

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
    base = plate(*colors, layer_recipe=APP_CARD_LAYERS.get(slug))
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


def render_iconset_card(src_dir: Path) -> Image.Image:
    meta = json.loads((src_dir / "manifest.json").read_text())
    slug = meta["slug"]
    fun = meta.get("funLayer") if isinstance(meta.get("funLayer"), dict) else DEFAULT_ICONSET_FUN_LAYERS.get(slug, {})
    accent = clean_hex(fun.get("accent") or meta.get("accent") or CYAN, CYAN)
    secondary = clean_hex(fun.get("secondary") or PINK, PINK)
    spark = clean_hex(fun.get("spark") or GOLD, GOLD)
    recipe = str(fun.get("recipe") or "chroma-halo")
    base = plate(accent, secondary, spark, layer_recipe=recipe)
    icons = meta.get("icons") or {}
    placements = [
        ("dashboard", 118, 116, 330, -3),
        ("posts", 576, 116, 330, 3),
        ("pages", 118, 574, 330, 3),
        ("media", 576, 574, 330, -3),
    ]
    for key, x, y, size, rot in placements:
        rel = icons.get(key) or icons.get("fallback") or icons.get("dashboard")
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
        for slug in ("odd-default-cursors", "oddlings-cursors"):
            write_card(ROOT / "_tools" / "catalog-sources" / "cursor-sets" / slug / "card.webp", slug)


if __name__ == "__main__":
    main()
