#!/usr/bin/env python3
"""Compose first-party ODD icon sets from canonical raster glyph masks.

ODD icon sets should share the same semantic glyph silhouettes and vary the
material layer around them. Each set's manifest.funLayer tokens select that
material. This tool keeps that authoring contract explicit:

    python3 _tools/compose-icon-set.py --extract-base
    python3 _tools/compose-icon-set.py --all

The public `.wp` bundle still contains ordinary PNG/WebP files. This script is
only an authoring tool for catalog sources.
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

ICON_KEYS = (
    "dashboard",
    "posts",
    "pages",
    "media",
    "comments",
    "appearance",
    "plugins",
    "users",
    "tools",
    "settings",
    "profile",
    "links",
    "recycle-bin",
    "fallback",
    "os-settings",
    "import",
    "classic-admin",
)

DEFAULT_DASHICONS = {
    "dashboard": "dashicons-dashboard",
    "posts": "dashicons-admin-post",
    "pages": "dashicons-admin-page",
    "media": "dashicons-admin-media",
    "comments": "dashicons-admin-comments",
    "appearance": "dashicons-admin-appearance",
    "plugins": "dashicons-buddicons-replies",
    "users": "dashicons-admin-users",
    "tools": "dashicons-admin-tools",
    "settings": "dashicons-admin-settings",
    "profile": "dashicons-businessman",
    "links": "dashicons-admin-links",
    "recycle-bin": "dashicons-trash",
    "fallback": "dashicons-admin-generic",
    "os-settings": "dashicons-desktop",
    "import": "dashicons-download",
    "classic-admin": "dashicons-arrow-left-alt",
}

DEFAULT_CODEPOINTS = {
    "dashboard": "f226",
    "posts": "f109",
    "pages": "f105",
    "media": "f104",
    "comments": "f101",
    "appearance": "f100",
    "plugins": "f451",
    "users": "f110",
    "tools": "f107",
    "settings": "f108",
    "profile": "f338",
    "links": "f103",
    "recycle-bin": "f182",
    "fallback": "f111",
    "os-settings": "f472",
    "import": "f316",
    "classic-admin": "f340",
}

RECIPE_DEFAULTS = {
    "chroma-halo": ("#38e8ff", "#ff44b5", "#9556ff"),
    "coin-spark": ("#f4c45f", "#8a4a1b", "#fff36a"),
    "frost-rim": ("#9eeaff", "#d7f7ff", "#6aaefc"),
    "blueprint-grid": ("#4da3ff", "#cfe6ff", "#7df7ff"),
    "leaf-vein": ("#88b957", "#d5ef8c", "#fff0a6"),
    "stencil-spray": ("#ff5f4f", "#f0e4d2", "#24212a"),
    "circuit-trace": ("#2fb37a", "#8dffcf", "#ffe66b"),
    "clay-smudge": ("#ffb84d", "#ff7c6d", "#ffe9a6"),
    "stitch-cross": ("#e87ca7", "#ffe1ef", "#8ee7ff"),
    "blink-ring": ("#b35cff", "#f36bff", "#7df7ff"),
    "filament-wire": ("#ffb000", "#ff6bd6", "#50f2ff"),
    "paper-fold": ("#7c5cff", "#c7b8ff", "#fff0a8"),
    "hologram-scan": ("#9fd0ff", "#8efff1", "#f0a7ff"),
    "citrus-pop": ("#ffd64b", "#b6ff66", "#ff8b4c"),
    "line-loop": ("#00c2ff", "#dff8ff", "#a66bff"),
    "misprint-dot": ("#ff4fa8", "#2ed3ff", "#ffdf57"),
    "pennant-stripe": ("#d73a3a", "#2e7eea", "#fff06a"),
    "carved-spark": ("#c47a3c", "#ffcf70", "#49e2a4"),
}


def rgb(value: str) -> tuple[int, int, int]:
    value = clean_hex(value, "#ffffff").lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


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


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def load_manifest(slug: str) -> dict:
    path = ICON_SETS / slug / "manifest.json"
    if not path.is_file():
        raise SystemExit(f"missing icon-set manifest: {path}")
    return json.loads(path.read_text())


def icon_paths(manifest: dict) -> dict[str, str]:
    icons = manifest.get("icons")
    if not isinstance(icons, dict):
        raise SystemExit(f"icon-set {manifest.get('slug', '?')}: missing icons map")
    missing = [key for key in ICON_KEYS if key not in icons]
    if missing:
        raise SystemExit(f"icon-set {manifest.get('slug', '?')}: missing icons {missing}")
    return {key: icons[key] for key in ICON_KEYS}


def fun_layer(manifest: dict) -> tuple[str, str, str, str]:
    raw = manifest.get("funLayer") if isinstance(manifest.get("funLayer"), dict) else {}
    recipe = str(raw.get("recipe") or "chroma-halo")
    defaults = RECIPE_DEFAULTS.get(recipe, RECIPE_DEFAULTS["chroma-halo"])
    accent = clean_hex(raw.get("accent") or manifest.get("accent") or defaults[0], defaults[0])
    secondary = clean_hex(raw.get("secondary") or defaults[1], defaults[1])
    spark = clean_hex(raw.get("spark") or defaults[2], defaults[2])
    return recipe, accent, secondary, spark


def load_mask(key: str) -> Image.Image:
    path = BASE / f"{key}.png"
    if not path.is_file():
        raise SystemExit(f"missing canonical glyph mask: {path}")
    mask = Image.open(path).convert("L")
    if mask.size != (SIZE, SIZE):
        mask = mask.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    return mask


def draw_recipe(draw: ImageDraw.ImageDraw, recipe: str, accent, secondary, spark) -> None:
    if recipe == "blueprint-grid":
        for pos in range(24, SIZE, 42):
            draw.line((pos, 0, pos, SIZE), fill=(*accent, 82), width=2)
            draw.line((0, pos, SIZE, pos), fill=(*secondary, 58), width=2)
    elif recipe == "stitch-cross":
        for x in range(30, SIZE, 56):
            for y in range(30, SIZE, 56):
                draw.line((x - 9, y - 9, x + 9, y + 9), fill=(*accent, 118), width=4)
                draw.line((x + 9, y - 9, x - 9, y + 9), fill=(*secondary, 96), width=4)
    elif recipe == "circuit-trace":
        for y in range(46, SIZE, 78):
            draw.line((18, y, 172, y, 172, y + 34, 376, y + 34, 376, y + 10, 502, y + 10), fill=(*accent, 120), width=5)
            draw.ellipse((368, y + 26, 388, y + 46), fill=(*spark, 150))
    elif recipe == "coin-spark":
        for r in range(74, 330, 48):
            draw.ellipse((256 - r, 256 - r, 256 + r, 256 + r), outline=(*accent, 84), width=4)
        for i in range(18):
            ang = math.tau * i / 18
            x = 256 + math.cos(ang) * 214
            y = 256 + math.sin(ang) * 214
            draw.polygon([(x, y - 8), (x + 6, y), (x, y + 8), (x - 6, y)], fill=(*spark, 160))
    elif recipe == "frost-rim":
        for i in range(-SIZE, SIZE * 2, 44):
            draw.line((i, 0, i - 110, SIZE), fill=(*secondary, 96), width=3)
            draw.line((SIZE - i, 0, SIZE + 110 - i, SIZE), fill=(*accent, 74), width=2)
    elif recipe == "leaf-vein":
        for x in range(42, SIZE, 74):
            draw.arc((x - 36, 52, x + 88, 448), 112, 244, fill=(*accent, 106), width=4)
            draw.line((x + 18, 92, x + 58, 206), fill=(*secondary, 84), width=3)
    elif recipe == "stencil-spray":
        for i in range(180):
            x = (i * 97) % SIZE
            y = (i * 211) % SIZE
            r = 1 + (i % 4)
            draw.ellipse((x - r, y - r, x + r, y + r), fill=(*(accent if i % 2 else secondary), 88))
    elif recipe == "clay-smudge":
        draw.ellipse((-60, 44, 260, 318), fill=(*accent, 90))
        draw.ellipse((224, 136, 600, 488), fill=(*secondary, 96))
        draw.ellipse((108, -80, 440, 150), fill=(*spark, 60))
    elif recipe == "blink-ring":
        for box, color in (((46, 130, 466, 382), accent), ((122, 70, 390, 442), secondary), ((180, 180, 332, 332), spark)):
            draw.ellipse(box, outline=(*color, 128), width=8)
    elif recipe == "filament-wire":
        points = [(x, 256 + math.sin(x / 30) * 74) for x in range(-20, 540, 12)]
        draw.line(points, fill=(*accent, 145), width=5, joint="curve")
        for x, y in points[::6]:
            draw.ellipse((x - 7, y - 7, x + 7, y + 7), fill=(*spark, 180))
    elif recipe == "paper-fold":
        draw.polygon([(0, SIZE), (224, 0), (326, 0), (98, SIZE)], fill=(*accent, 86))
        draw.polygon([(277, 0), (SIZE, 0), (SIZE, 326)], fill=(*secondary, 96))
        draw.line((224, 0, 98, SIZE), fill=(*spark, 128), width=5)
    elif recipe == "hologram-scan":
        for y in range(16, SIZE, 21):
            draw.line((0, y, SIZE, y), fill=(*accent, 100), width=2)
        for x in range(-SIZE, SIZE, 86):
            draw.line((x, SIZE, x + SIZE, 0), fill=(*secondary, 72), width=3)
    elif recipe == "citrus-pop":
        for i in range(18):
            ang = math.tau * i / 18
            p1 = (256 + math.cos(ang - 0.05) * 45, 256 + math.sin(ang - 0.05) * 45)
            p2 = (256 + math.cos(ang) * 280, 256 + math.sin(ang) * 280)
            p3 = (256 + math.cos(ang + 0.05) * 45, 256 + math.sin(ang + 0.05) * 45)
            draw.polygon([p1, p2, p3], fill=(*(accent if i % 2 else secondary), 78))
    elif recipe == "line-loop":
        for r in range(58, 340, 46):
            draw.ellipse((256 - r, 256 - r, 256 + r, 256 + r), outline=(*(accent if r % 92 else secondary), 112), width=5)
    elif recipe == "misprint-dot":
        for x in range(18, SIZE, 42):
            for y in range(18, SIZE, 42):
                draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill=(*accent, 105))
                draw.ellipse((x + 4, y - 1, x + 10, y + 5), fill=(*secondary, 82))
    elif recipe == "pennant-stripe":
        for x in range(-SIZE, SIZE, 54):
            draw.polygon([(x, SIZE), (x + 28, SIZE), (x + 540, 0), (x + 512, 0)], fill=(*accent, 94))
        draw.polygon([(80, 70), (405, 124), (80, 178)], fill=(*spark, 112))
    elif recipe == "carved-spark":
        for i in range(12):
            x = 44 + i * 38
            draw.polygon([(x, 78), (x + 16, 119), (x - 22, 119)], fill=(*accent, 96))
            draw.polygon([(SIZE - x, 434), (495 - x, 393), (534 - x, 393)], fill=(*secondary, 88))
    else:
        draw.ellipse((-80, 118, 226, 426), fill=(*accent, 80))
        draw.ellipse((285, 20, 585, 310), fill=(*secondary, 74))
        draw.line((75, 430, 442, 80), fill=(*spark, 74), width=6)


def material(recipe: str, accent_hex: str, secondary_hex: str, spark_hex: str) -> Image.Image:
    accent = rgb(accent_hex)
    secondary = rgb(secondary_hex)
    spark = rgb(spark_hex)
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if recipe == "chroma-halo":
        for y in range(SIZE):
            t = y / (SIZE - 1)
            draw.line((0, y, SIZE, y), fill=(*mix((255, 255, 255), (226, 243, 255), t), 255))
    else:
        for y in range(SIZE):
            t = y / (SIZE - 1)
            draw.line((0, y, SIZE, y), fill=(*mix(secondary, accent, t), 255))
    draw_recipe(draw, recipe, accent, secondary, spark)
    return img.filter(ImageFilter.GaussianBlur(0.25))


def compose_icon(mask: Image.Image, base_material: Image.Image, accent_hex: str, secondary_hex: str, spark_hex: str) -> Image.Image:
    accent = rgb(accent_hex)
    secondary = rgb(secondary_hex)
    spark = rgb(spark_hex)
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    shadow_mask = mask.filter(ImageFilter.GaussianBlur(8)).point(lambda p: min(110, p))
    shadow = Image.new("RGBA", (SIZE, SIZE), (5, 4, 10, 0))
    shadow.putalpha(shadow_mask)
    shifted_shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    shifted_shadow.alpha_composite(shadow, (0, 8))
    out.alpha_composite(shifted_shadow)

    glow_a = Image.new("RGBA", (SIZE, SIZE), (*accent, 0))
    glow_a.putalpha(mask.filter(ImageFilter.GaussianBlur(16)).point(lambda p: min(84, p)))
    out.alpha_composite(glow_a)
    glow_b = Image.new("RGBA", (SIZE, SIZE), (*secondary, 0))
    glow_b.putalpha(mask.filter(ImageFilter.GaussianBlur(5)).point(lambda p: min(62, p)))
    shifted_b = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    shifted_b.alpha_composite(glow_b, (-2, 1))
    out.alpha_composite(shifted_b)

    expanded = mask.filter(ImageFilter.MaxFilter(9))
    rim_mask = ImageChops.subtract(expanded, mask).point(lambda p: min(210, p * 2))
    rim = Image.new("RGBA", (SIZE, SIZE), (8, 5, 17, 0))
    rim.putalpha(rim_mask)
    out.alpha_composite(rim)

    body = base_material.copy()
    body.putalpha(mask)
    out.alpha_composite(body)

    shine_mask = mask.filter(ImageFilter.GaussianBlur(1)).point(lambda p: int(p * 0.28))
    shine = Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 0))
    shine.putalpha(shine_mask)
    top_clip = Image.new("L", (SIZE, SIZE), 0)
    td = ImageDraw.Draw(top_clip)
    td.ellipse((42, 28, 330, 180), fill=255)
    shine.putalpha(ImageChops.multiply(shine.getchannel("A"), top_clip))
    out.alpha_composite(shine)

    spark_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    sd = ImageDraw.Draw(spark_layer)
    for x, y, r in ((404, 95, 6), (438, 128, 3), (78, 414, 4)):
        sd.ellipse((x - r, y - r, x + r, y + r), fill=(*spark, 160))
    out.alpha_composite(spark_layer)
    return out


def extract_base(source_slug: str) -> None:
    source = ICON_SETS / source_slug
    source_map = source / "source-glyph-map.json"
    data = json.loads(source_map.read_text()) if source_map.is_file() else {}
    BASE.mkdir(parents=True, exist_ok=True)
    glyphs = {}
    for key in ICON_KEYS:
        path = source / f"{key}.webp"
        if not path.is_file():
            raise SystemExit(f"base source missing {path}")
        icon = Image.open(path).convert("RGBA").resize((SIZE, SIZE), Image.Resampling.LANCZOS)
        alpha = icon.getchannel("A")
        # The default set is already the normal glyph body. Keep only the
        # readable body alpha so future sets can place their own material layer.
        mask = alpha.point(lambda p: 255 if p > 18 else 0).filter(ImageFilter.GaussianBlur(0.35))
        mask.save(BASE / f"{key}.png")
        glyphs[key] = {
            "mask": f"base/{key}.png",
            "dashicon": (data.get("icons") or DEFAULT_DASHICONS).get(key, DEFAULT_DASHICONS[key]),
            "codepoint": (data.get("codepoints") or DEFAULT_CODEPOINTS).get(key, DEFAULT_CODEPOINTS[key]),
        }
    manifest = {
        "name": "ODD Canonical Icon Glyphs",
        "version": "1.0.0",
        "size": SIZE,
        "source": source_slug,
        "requiredKeys": list(ICON_KEYS),
        "contract": "shared-mask-plus-material-layer",
        "glyphs": glyphs,
    }
    (GLYPHS / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def render_set(slug: str) -> None:
    manifest = load_manifest(slug)
    paths = icon_paths(manifest)
    recipe, accent, secondary, spark = fun_layer(manifest)
    src_dir = ICON_SETS / slug
    base_material = material(recipe, accent, secondary, spark)
    for key, rel in paths.items():
        if not isinstance(rel, str) or not rel.endswith((".webp", ".png")):
            raise SystemExit(f"icon-set {slug}: {key} path must be PNG or WebP")
        icon = compose_icon(load_mask(key), base_material, accent, secondary, spark)
        out = src_dir / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        if out.suffix.lower() == ".png":
            icon.save(out, "PNG", optimize=True)
        else:
            icon.save(out, "WEBP", quality=88, method=4)
    print(f"rendered {slug}", flush=True)


def all_sets() -> list[str]:
    return sorted(path.name for path in ICON_SETS.iterdir() if (path / "manifest.json").is_file())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extract-base", action="store_true", help="Refresh _tools/icon-glyphs/base from the default set.")
    parser.add_argument("--source-set", default="odd-default-icons", help="Set used by --extract-base.")
    parser.add_argument("--set", dest="sets", action="append", default=[], help="Render one icon set slug. Repeatable.")
    parser.add_argument("--all", action="store_true", help="Render every first-party icon set.")
    args = parser.parse_args()

    if args.extract_base:
        extract_base(args.source_set)
    targets = all_sets() if args.all else args.sets
    for slug in targets:
        render_set(slug)
    if not args.extract_base and not targets:
        parser.error("choose --extract-base, --set, or --all")


if __name__ == "__main__":
    main()
