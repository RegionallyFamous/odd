#!/usr/bin/env python3
"""Compose the first-party ODD default desktop icon set.

ODD icon sets are ordinary raster assets passed to Desktop Mode by URL. The
default set only targets the visible Desktop Mode desktop shortcuts ODD owns or
themes: ODD, My WordPress, Content Graph, Recycle Bin, and the generic fallback.

    python3 _tools/compose-icon-set.py --extract-base
    python3 _tools/compose-icon-set.py --all

The public `.wp` bundle still contains plain PNG/WebP files. This script is an
authoring tool for the catalog source assets.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ICON_SETS = ROOT / "_tools" / "catalog-sources" / "icon-sets"
GLYPHS = ROOT / "_tools" / "icon-glyphs"
BASE = GLYPHS / "base"
SIZE = 512
SCALE = 3
WORK = SIZE * SCALE
TILE_X = 48
TILE_Y = 48
TILE_SIZE = 416
TILE_RADIUS = 96

ICON_KEYS = (
    "odd",
    "my-wordpress",
    "content-graph",
    "recycle-bin",
    "fallback",
)

ICON_DESCRIPTIONS = {
    "odd": "animated ODD eye launcher in the current logo style",
    "my-wordpress": "animated ODD-logo dashboard gauge",
    "content-graph": "animated ODD-logo content graph",
    "recycle-bin": "animated ODD-logo recycle bin",
    "fallback": "animated ODD-logo fallback portal",
}

ICON_ACCENTS = {
    "odd": ("#ff4fa8", "#7ee3ff", "#ffe9a8"),
    "my-wordpress": ("#ff4fa8", "#7ee3ff", "#ffe9a8"),
    "content-graph": ("#ff4fa8", "#7ee3ff", "#ffe9a8"),
    "recycle-bin": ("#ff4fa8", "#7ee3ff", "#ffe9a8"),
    "fallback": ("#ff4fa8", "#7ee3ff", "#ffe9a8"),
}


def s(value: float) -> int:
    return round(value * SCALE)


def box(values: tuple[float, float, float, float]) -> tuple[int, int, int, int]:
    return tuple(s(v) for v in values)


def clean_hex(value: str | None, fallback: str) -> str:
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


def rgb(value: str) -> tuple[int, int, int]:
    value = clean_hex(value, "#ffffff").lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def work_mask() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("L", (WORK, WORK), 0)
    return img, ImageDraw.Draw(img)


def downsample(mask: Image.Image) -> Image.Image:
    return mask.resize((SIZE, SIZE), Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(0.2))


def draw_my_wordpress_mask() -> Image.Image:
    img, draw = work_mask()
    draw.arc(box((58, 58, 454, 448)), 190, 350, fill=255, width=s(54))
    draw.line([s(256), s(252), s(358), s(136)], fill=255, width=s(50))
    draw.ellipse(box((214, 210, 298, 294)), fill=255)
    for x, y, r in ((154, 140, 20), (256, 104, 21), (358, 140, 20)):
        draw.ellipse(box((x - r, y - r, x + r, y + r)), fill=255)
    draw.rounded_rectangle(box((118, 350, 394, 420)), radius=s(34), fill=255)
    return downsample(img)


def draw_odd_mask() -> Image.Image:
    img, draw = work_mask()
    draw.rounded_rectangle(
        box((TILE_X, TILE_Y, TILE_X + TILE_SIZE, TILE_Y + TILE_SIZE)),
        radius=s(TILE_RADIUS),
        fill=255,
    )
    return downsample(img)


def draw_content_graph_mask() -> Image.Image:
    img, draw = work_mask()
    lines = [
        ((116, 346), (222, 226), (342, 286), (402, 134)),
        ((222, 226), (164, 132)),
        ((222, 226), (298, 394)),
    ]
    for pts in lines:
        flat = []
        for x, y in pts:
            flat.extend((s(x), s(y)))
        draw.line(flat, fill=255, width=s(38), joint="curve")
    for x, y, r in (
        (118, 346, 55),
        (222, 226, 58),
        (342, 286, 52),
        (402, 134, 50),
        (164, 132, 48),
        (298, 394, 50),
    ):
        draw.ellipse(box((x - r, y - r, x + r, y + r)), fill=255)
    return downsample(img)


def draw_recycle_bin_mask() -> Image.Image:
    img, draw = work_mask()
    draw.rounded_rectangle(box((114, 170, 398, 438)), radius=s(36), fill=255)
    draw.rounded_rectangle(box((82, 130, 430, 198)), radius=s(32), fill=255)
    draw.rounded_rectangle(box((190, 82, 322, 150)), radius=s(30), fill=255)
    draw.rectangle(box((218, 120, 294, 170)), fill=255)
    return downsample(img)


def draw_fallback_mask() -> Image.Image:
    img, draw = work_mask()
    points = [
        (256, 60),
        (394, 144),
        (452, 286),
        (342, 436),
        (168, 414),
        (78, 254),
        (132, 118),
    ]
    draw.polygon([(s(x), s(y)) for x, y in points], fill=255)
    draw.ellipse(box((194, 180, 318, 304)), fill=255)
    draw.rounded_rectangle(box((224, 326, 288, 416)), radius=s(28), fill=255)
    return downsample(img)


MASK_BUILDERS = {
    "odd": draw_odd_mask,
    "my-wordpress": draw_my_wordpress_mask,
    "content-graph": draw_content_graph_mask,
    "recycle-bin": draw_recycle_bin_mask,
    "fallback": draw_fallback_mask,
}


def material(mask: Image.Image) -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    top = (255, 255, 255)
    bottom = (219, 239, 255)
    for y in range(SIZE):
        t = y / (SIZE - 1)
        draw.line((0, y, SIZE, y), fill=(*mix(top, bottom, t), 255))
    body = img.filter(ImageFilter.GaussianBlur(0.2))
    body.putalpha(mask)
    return body


def shifted(layer: Image.Image, offset: tuple[int, int]) -> Image.Image:
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    out.alpha_composite(layer, offset)
    return out


def compose_icon(key: str, mask: Image.Image) -> Image.Image:
    del mask
    return compose_icon_frame(key, 0)


def gradient_round_rect(size: int, radius: int, colors: tuple[str, str, str]) -> Image.Image:
    rect = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(rect)
    c1, c2, c3 = [rgb(color) for color in colors]
    for y in range(size):
        t = y / max(1, size - 1)
        if t < 0.55:
            color = mix(c1, c2, t / 0.55)
        else:
            color = mix(c2, c3, (t - 0.55) / 0.45)
        draw.line((0, y, size, y), fill=(*color, 255))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    rect.putalpha(mask)
    return rect


LOGO_COLORS = ("#ff4fa8", "#b04be1", "#5a35d6")
INK = (26, 13, 50, 255)
INK_SOFT = (42, 11, 82, 96)
EYE_WHITE = (246, 248, 255, 255)
EYE_BLUE = (37, 137, 211, 255)
EYE_BLUE_DARK = (18, 53, 95, 255)
SPARK_YELLOW = (255, 233, 168, 242)
CYAN = (126, 227, 255, 230)


def phase_wave(phase: int, offset: float = 0) -> float:
    return math.sin((phase / 8) * math.tau + offset)


def draw_star(draw: ImageDraw.ImageDraw, cx: float, cy: float, radius: float, fill: tuple[int, int, int, int]) -> None:
    tight = radius * 0.34
    points = [
        (cx, cy - radius),
        (cx + tight, cy - tight),
        (cx + radius, cy),
        (cx + tight, cy + tight),
        (cx, cy + radius),
        (cx - tight, cy + tight),
        (cx - radius, cy),
        (cx - tight, cy - tight),
    ]
    draw.polygon(points, fill=fill)


def line_with_caps(draw: ImageDraw.ImageDraw, points, fill, width: int) -> None:
    draw.line(points, fill=fill, width=width, joint="curve")
    radius = width // 2
    for x, y in (points[0], points[-1]):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)


def logo_canvas(phase: int) -> Image.Image:
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    base_mask = draw_odd_mask()
    accent = rgb("#ff4fa8")
    cyan = rgb("#7ee3ff")
    pulse = phase_wave(phase)

    shadow_alpha = base_mask.filter(ImageFilter.GaussianBlur(12)).point(lambda p: min(92, p))
    shadow = Image.new("RGBA", (SIZE, SIZE), (5, 4, 12, 0))
    shadow.putalpha(shadow_alpha)
    out.alpha_composite(shifted(shadow, (0, 10)))

    for color, blur, limit, offset in (
        (accent, 7, 36 + round(4 * pulse), (2, 1)),
        (cyan, 7, 32 + round(3 * phase_wave(phase, 1.1)), (-2, 1)),
    ):
        glow = Image.new("RGBA", (SIZE, SIZE), (*color, 0))
        glow.putalpha(base_mask.filter(ImageFilter.GaussianBlur(blur)).point(lambda p: max(0, min(limit, p))))
        out.alpha_composite(shifted(glow, offset))

    plate = gradient_round_rect(TILE_SIZE, TILE_RADIUS, LOGO_COLORS)
    shine = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
    shine_draw = ImageDraw.Draw(shine)
    sweep = round(phase_wave(phase, -0.5) * 18)
    shine_draw.polygon(
        [
            (46 + sweep, 0),
            (136 + sweep, 0),
            (352 + sweep, TILE_SIZE),
            (262 + sweep, TILE_SIZE),
        ],
        fill=(255, 255, 255, 20),
    )
    shine.putalpha(ImageChops.multiply(shine.getchannel("A"), plate.getchannel("A")))
    plate.alpha_composite(shine)
    out.alpha_composite(plate, (TILE_X, TILE_Y))

    draw = ImageDraw.Draw(out)
    draw.ellipse((134, 368, 378, 396), fill=INK_SOFT)
    draw.arc((346, 52, 494, 196), 206, 292, fill=INK, width=18)
    draw_star(
        draw,
        386,
        382,
        19 + (3 if phase % 4 == 1 else 0),
        SPARK_YELLOW,
    )
    return out


def draw_eye_shell(draw: ImageDraw.ImageDraw) -> None:
    eye_box = (106, 114, 406, 414)
    draw.ellipse((132, 366, 380, 394), fill=INK_SOFT)
    draw.ellipse(eye_box, fill=EYE_WHITE, outline=INK, width=22)


def draw_iris(
    draw: ImageDraw.ImageDraw,
    cx: float,
    cy: float,
    radius: float = 68,
    pupil_radius: float = 29,
) -> None:
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=EYE_BLUE, outline=EYE_BLUE_DARK, width=12)
    draw.ellipse((cx - pupil_radius, cy - pupil_radius, cx + pupil_radius, cy + pupil_radius), fill=(8, 13, 25, 255))
    draw.ellipse((cx - 42, cy - 42, cx - 18, cy - 18), fill=(255, 255, 255, 238))
    draw.ellipse((cx + 28, cy + 26, cx + 40, cy + 38), fill=(224, 252, 255, 215))


def iris_position(phase: int) -> tuple[int, int]:
    positions = [(-22, -12), (-12, -7), (0, 0), (12, 6), (18, 8), (8, 4), (-8, -5), (-18, -10)]
    dx, dy = positions[phase % len(positions)]
    return 248 + dx, 266 + dy


def draw_iris_base(draw: ImageDraw.ImageDraw, cx: int, cy: int) -> None:
    draw.ellipse((cx - 70, cy - 70, cx + 70, cy + 70), fill=EYE_BLUE, outline=EYE_BLUE_DARK, width=13)
    draw.ellipse((cx - 45, cy - 45, cx + 45, cy + 45), fill=(41, 159, 223, 255))


def draw_odd_variant_iris(draw: ImageDraw.ImageDraw, key: str, phase: int) -> None:
    cx, cy = iris_position(phase)
    draw_iris_base(draw, cx, cy)

    if key == "odd":
        draw.ellipse((cx - 31, cy - 31, cx + 31, cy + 31), fill=(8, 13, 25, 255))
        draw.ellipse((cx - 44, cy - 44, cx - 20, cy - 20), fill=(255, 255, 255, 238))
        draw.ellipse((cx + 29, cy + 27, cx + 41, cy + 39), fill=(224, 252, 255, 215))
        return

    if key == "my-wordpress":
        draw.arc((cx - 48, cy - 48, cx + 48, cy + 48), 205, 335, fill=EYE_WHITE, width=16)
        for angle in (214, 270, 326):
            rad = math.radians(angle)
            x = cx + math.cos(rad) * 50
            y = cy + math.sin(rad) * 50
            draw.ellipse((x - 7, y - 7, x + 7, y + 7), fill=INK)
        needle_angle = -1.15 + 0.28 * phase_wave(phase, -0.35)
        end = (cx + math.cos(needle_angle) * 52, cy + math.sin(needle_angle) * 52)
        draw.line((cx, cy, end[0], end[1]), fill=INK, width=15)
        draw.line((cx, cy, end[0], end[1]), fill=SPARK_YELLOW, width=7)
        draw.ellipse((cx - 24, cy - 24, cx + 24, cy + 24), fill=INK)
        draw.ellipse((cx - 13, cy - 13, cx + 13, cy + 13), fill=EYE_WHITE)
        return

    if key == "content-graph":
        nodes = [
            (cx - 34, cy + 28, 16),
            (cx - 8, cy - 14, 18),
            (cx + 34, cy + 12, 17),
            (cx + 38, cy - 34, 15),
        ]
        line_with_caps(draw, [(nodes[0][0], nodes[0][1]), (nodes[1][0], nodes[1][1]), (nodes[2][0], nodes[2][1]), (nodes[3][0], nodes[3][1])], INK, 18)
        line_with_caps(draw, [(nodes[0][0], nodes[0][1]), (nodes[1][0], nodes[1][1]), (nodes[2][0], nodes[2][1]), (nodes[3][0], nodes[3][1])], EYE_WHITE, 8)
        for x, y, radius in nodes:
            pulse = round(2 * phase_wave(phase, (x + y) / 30))
            r = radius + pulse
            draw.ellipse((x - r - 6, y - r - 6, x + r + 6, y + r + 6), fill=INK)
            draw.ellipse((x - r, y - r, x + r, y + r), fill=EYE_WHITE)
            draw.ellipse((x - 7, y - 7, x + 7, y + 7), fill=EYE_BLUE)
        return

    if key == "recycle-bin":
        wobble = round(1.5 * phase_wave(phase, 0.8))
        draw.rounded_rectangle((cx - 37 + wobble, cy - 32, cx + 37 + wobble, cy + 39), radius=11, fill=INK)
        draw.rounded_rectangle((cx - 24 + wobble, cy - 18, cx + 24 + wobble, cy + 28), radius=6, fill=EYE_WHITE)
        draw.rounded_rectangle((cx - 45, cy - 45, cx + 45, cy - 22), radius=10, fill=INK)
        draw.rounded_rectangle((cx - 28, cy - 38, cx + 28, cy - 31), radius=4, fill=EYE_WHITE)
        draw.rounded_rectangle((cx - 20, cy - 63, cx + 20, cy - 40), radius=10, fill=INK)
        draw.rounded_rectangle((cx - 10, cy - 55, cx + 10, cy - 45), radius=4, fill=EYE_WHITE)
        for x in (cx - 12, cx + 12):
            draw.line((x + wobble, cy - 8, x + wobble, cy + 20), fill=(133, 148, 166, 220), width=6)
        return

    if key == "fallback":
        ring_shift = round(2 * phase_wave(phase, 0.5))
        draw.ellipse((cx - 50, cy - 50 + ring_shift, cx + 50, cy + 50 + ring_shift), fill=INK)
        draw.ellipse((cx - 38, cy - 38 + ring_shift, cx + 38, cy + 38 + ring_shift), fill=EYE_WHITE)
        draw.ellipse((cx - 24, cy - 24 + ring_shift, cx + 24, cy + 24 + ring_shift), fill=EYE_BLUE)
        draw.ellipse((cx - 10, cy - 10 + ring_shift, cx + 10, cy + 10 + ring_shift), fill=EYE_BLUE_DARK)


def draw_odd_eye(draw: ImageDraw.ImageDraw, phase: int) -> None:
    draw_eye_shell(draw)
    draw_odd_variant_iris(draw, "odd", phase)


def draw_gauge_glyph(draw: ImageDraw.ImageDraw, phase: int) -> None:
    draw_eye_shell(draw)
    draw_odd_variant_iris(draw, "my-wordpress", phase)


def draw_graph_glyph(draw: ImageDraw.ImageDraw, phase: int) -> None:
    draw_eye_shell(draw)
    draw_odd_variant_iris(draw, "content-graph", phase)


def draw_bin_glyph(draw: ImageDraw.ImageDraw, phase: int) -> None:
    draw_eye_shell(draw)
    draw_odd_variant_iris(draw, "recycle-bin", phase)


def draw_fallback_glyph(draw: ImageDraw.ImageDraw, phase: int) -> None:
    draw_eye_shell(draw)
    draw_odd_variant_iris(draw, "fallback", phase)


def compose_icon_frame(key: str, phase: int) -> Image.Image:
    if key == "odd":
        return compose_odd_frame(phase)

    out = logo_canvas(phase)
    glyph = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(glyph)
    bob = round(3 * phase_wave(phase, 0.75))
    if key == "my-wordpress":
        draw_gauge_glyph(draw, phase)
    elif key == "content-graph":
        draw_graph_glyph(draw, phase)
    elif key == "recycle-bin":
        draw_bin_glyph(draw, phase)
    elif key == "fallback":
        draw_fallback_glyph(draw, phase)
    if bob:
        shifted_glyph = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        shifted_glyph.alpha_composite(glyph, (0, bob))
        glyph = shifted_glyph
    out.alpha_composite(glyph)
    return out


def compose_odd_frame(phase: int) -> Image.Image:
    out = logo_canvas(phase)
    draw = ImageDraw.Draw(out)
    draw_odd_eye(draw, phase)
    return out


def detail_layer(mask: Image.Image) -> Image.Image:
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    layer.putalpha(mask)
    return layer


def clipped_details(detail: Image.Image, mask: Image.Image) -> Image.Image:
    alpha = ImageChops.multiply(detail.getchannel("A"), mask)
    detail.putalpha(alpha)
    return detail


def draw_icon_detail(
    out: Image.Image,
    key: str,
    mask: Image.Image,
    accent: tuple[int, int, int],
    secondary: tuple[int, int, int],
    spark: tuple[int, int, int],
) -> None:
    detail = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(detail)
    ink = (37, 39, 58, 132)
    if key == "my-wordpress":
        draw.arc((122, 118, 390, 386), 205, 338, fill=ink, width=18)
        draw.line((258, 250, 342, 156), fill=(37, 39, 58, 120), width=16)
    elif key == "content-graph":
        for x, y, r in ((118, 346, 24), (226, 226, 28), (350, 286, 24), (416, 132, 24)):
            draw.ellipse((x - r, y - r, x + r, y + r), fill=(37, 39, 58, 118))
    elif key == "recycle-bin":
        for x in (202, 256, 310):
            draw.line((x, 222, x, 388), fill=ink, width=18)
        draw.line((152, 178, 360, 178), fill=(255, 255, 255, 92), width=10)
    elif key == "fallback":
        draw.ellipse((194, 180, 318, 304), outline=(37, 39, 58, 124), width=18)
        draw.line((256, 84, 256, 150), fill=(255, 255, 255, 92), width=14)

    out.alpha_composite(clipped_details(detail, mask))

    sparks = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sparks)
    for x, y, r, color in (
        (408, 102, 7, spark),
        (430, 132, 4, accent),
        (86, 404, 5, secondary),
    ):
        sd.ellipse((x - r, y - r, x + r, y + r), fill=(*color, 172))
    out.alpha_composite(sparks)


def load_manifest(slug: str) -> dict:
    path = ICON_SETS / slug / "manifest.json"
    if not path.is_file():
        raise SystemExit(f"missing icon-set manifest: {path}")
    return json.loads(path.read_text())


def icon_paths(manifest: dict, required_keys: tuple[str, ...]) -> dict[str, str]:
    icons = manifest.get("icons")
    if not isinstance(icons, dict):
        raise SystemExit(f"icon-set {manifest.get('slug', '?')}: missing icons map")
    missing = [key for key in required_keys if key not in icons]
    if missing:
        raise SystemExit(f"icon-set {manifest.get('slug', '?')}: missing icons {missing}")
    return {key: icons[key] for key in required_keys}


def build_masks() -> dict[str, Image.Image]:
    return {key: MASK_BUILDERS[key]() for key in ICON_KEYS}


def extract_base(source_slug: str) -> None:
    BASE.mkdir(parents=True, exist_ok=True)
    masks = build_masks()
    glyphs = {}
    for key, mask in masks.items():
        mask.save(BASE / f"{key}.png")
        glyphs[key] = {
            "mask": f"base/{key}.png",
            "description": ICON_DESCRIPTIONS[key],
        }
    manifest = {
        "name": "ODD Canonical Desktop Icon Glyphs",
        "version": "1.0.0",
        "size": SIZE,
        "source": source_slug,
        "requiredKeys": list(ICON_KEYS),
        "contract": "desktop-default-raster-source",
        "glyphs": glyphs,
    }
    (GLYPHS / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"extracted base masks for {source_slug}", flush=True)


def write_contact_sheet(src_dir: Path, icons: dict[str, Image.Image]) -> None:
    gap = 48
    cell = SIZE
    cols = 3
    rows = (len(ICON_KEYS) + cols - 1) // cols
    sheet = Image.new("RGBA", (cell * cols + gap * (cols + 1), cell * rows + gap * (rows + 1)), (0, 0, 0, 0))
    for index, key in enumerate(ICON_KEYS):
        x = gap + (index % cols) * (cell + gap)
        y = gap + (index // cols) * (cell + gap)
        sheet.alpha_composite(icons[key], (x, y))
    sheet.save(src_dir / "source-contact-sheet.png", "PNG", optimize=True)


def write_source_map(src_dir: Path) -> None:
    source_map = {
        "contract": "desktop-default-raster-source",
        "source": "_tools/compose-icon-set.py",
        "icons": ICON_DESCRIPTIONS,
        "keys": list(ICON_KEYS),
    }
    (src_dir / "source-glyph-map.json").write_text(json.dumps(source_map, indent=2) + "\n")


def render_set(slug: str) -> None:
    manifest = load_manifest(slug)
    paths = icon_paths(manifest, ICON_KEYS)
    src_dir = ICON_SETS / slug
    if slug != "odd-default-icons":
        for key, rel in paths.items():
            if not isinstance(rel, str) or not rel.endswith((".webp", ".png")):
                raise SystemExit(f"icon-set {slug}: {key} path must be PNG or WebP")
            if not (src_dir / rel).is_file():
                raise SystemExit(f"icon-set {slug}: missing source raster {rel}")
        print(f"kept source rasters for {slug}", flush=True)
        return

    masks = build_masks()
    rendered = {key: compose_icon(key, mask) for key, mask in masks.items()}
    for key, rel in paths.items():
        if not isinstance(rel, str) or not rel.endswith((".webp", ".png")):
            raise SystemExit(f"icon-set {slug}: {key} path must be PNG or WebP")
        out = src_dir / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        icon = rendered[key]
        frames = [compose_icon_frame(key, i).convert("RGBA") for i in range(8)]
        if out.suffix.lower() == ".png":
            icon.save(out, "PNG", optimize=True)
        elif out.suffix.lower() == ".webp":
            frames[0].save(
                out,
                "WEBP",
                save_all=True,
                append_images=frames[1:],
                duration=[130, 130, 130, 90, 110, 150, 130, 130],
                loop=0,
                quality=84,
                method=4,
            )

    write_contact_sheet(src_dir, rendered)
    write_source_map(src_dir)
    print(f"rendered {slug}", flush=True)


def all_sets() -> list[str]:
    return sorted(path.name for path in ICON_SETS.iterdir() if (path / "manifest.json").is_file())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extract-base", action="store_true", help="Refresh _tools/icon-glyphs/base from the default icon masks.")
    parser.add_argument("--source-set", default="odd-default-icons", help="Set used by --extract-base metadata.")
    parser.add_argument("--set", dest="sets", action="append", default=[], help="Render one icon set slug. Repeatable.")
    parser.add_argument("--all", action="store_true", help="Render every first-party icon set.")
    args = parser.parse_args()

    if args.extract_base:
        extract_base(args.source_set)
    targets = all_sets() if args.all else args.sets
    if args.all and "odd-default-icons" in targets:
        targets = ["odd-default-icons"] + [slug for slug in targets if slug != "odd-default-icons"]
    for slug in targets:
        render_set(slug)
    if not args.extract_base and not targets:
        parser.error("choose --extract-base, --set, or --all")


if __name__ == "__main__":
    main()
