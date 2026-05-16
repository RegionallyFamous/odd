#!/usr/bin/env python3
"""
Generate the static wallpaper and preview for the `oddling-desktop`
scene from its imagegen source artwork.

The scene itself is authored as a Pixi tick function on top of a
painted still image. This script normalizes the project-bound source
image into the files shipped by the catalog:

    * `_tools/catalog-sources/scenes/oddling-desktop/wallpaper.webp`
      1920x1080, WebP q82.
    * `_tools/catalog-sources/scenes/oddling-desktop/preview.webp`
      640x360, WebP q80.
    * `_tools/catalog-sources/scenes/oddling-desktop/card.webp`
      1024x1024, WebP q88, square Discover card art.

Usage:
    python3 _tools/gen-oddling-desktop.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps

HERE = Path(__file__).resolve().parent
SOURCES = HERE / "catalog-sources"
SCENE_DIR = SOURCES / "scenes" / "oddling-desktop"
SOURCE_IMAGE = SCENE_DIR / "source-imagegen.png"


def normalize_wallpaper(w: int = 1920, h: int = 1080) -> Image.Image:
    """Crop, resize, and lightly finish the imagegen source."""
    if not SOURCE_IMAGE.is_file():
        raise FileNotFoundError(
            f"Missing source image: {SOURCE_IMAGE}. Generate or copy the "
            "imagegen backdrop there before running this script."
        )

    with Image.open(SOURCE_IMAGE) as src:
        img = ImageOps.fit(
            src.convert("RGB"),
            (w, h),
            method=Image.Resampling.LANCZOS,
            centering=(0.5, 0.5),
        ).convert("RGBA")

    # Keep the desktop icon side calm even if future source art gets busier.
    safe = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(safe)
    for x in range(int(w * 0.42)):
        t = 1 - x / (w * 0.42)
        alpha = int(44 * (t**1.8))
        sdraw.line((x, 0, x, h), fill=(6, 1, 15, alpha))
    img = Image.alpha_composite(img, safe)

    # Slightly unify the image with ODD's CRT mood without flattening the art.
    scan = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    scan_draw = ImageDraw.Draw(scan)
    for y in range(0, h, 4):
        scan_draw.line((0, y, w, y), fill=(0, 0, 0, 18))
    img = Image.alpha_composite(img, scan)

    vignette = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    vdraw = ImageDraw.Draw(vignette)
    for i in range(56):
        inset_x = int(i * 22)
        inset_y = int(i * 12)
        if inset_x * 2 >= w or inset_y * 2 >= h:
            break
        alpha = int(3 + i * 1.7)
        vdraw.rectangle(
            (inset_x, inset_y, w - inset_x, h - inset_y),
            outline=(0, 0, 0, alpha),
            width=1,
        )
    img = Image.alpha_composite(img, vignette)

    # Tiny blur hides upscale bite while preserving the imagegen painting.
    return img.convert("RGB").filter(ImageFilter.GaussianBlur(radius=0.25))


def write_scene_assets() -> None:
    SCENE_DIR.mkdir(parents=True, exist_ok=True)
    wallpaper = normalize_wallpaper(1920, 1080)
    wallpaper.save(
        SCENE_DIR / "wallpaper.webp",
        format="WEBP",
        quality=82,
        method=6,
    )

    preview = wallpaper.resize((640, 360), Image.Resampling.LANCZOS)
    preview.save(
        SCENE_DIR / "preview.webp",
        format="WEBP",
        quality=80,
        method=6,
    )

    with Image.open(SOURCE_IMAGE) as src:
        card = ImageOps.fit(
            src.convert("RGB"),
            (1024, 1024),
            method=Image.Resampling.LANCZOS,
            centering=(0.68, 0.5),
        ).convert("RGBA")
    edge = Image.new("RGBA", card.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(edge)
    for i in range(40):
        alpha = int(2 + i * 1.8)
        draw.rectangle(
            (i, i, 1024 - i, 1024 - i),
            outline=(0, 0, 0, alpha),
            width=1,
        )
    card = Image.alpha_composite(card, edge).convert("RGB")
    card.save(
        SCENE_DIR / "card.webp",
        format="WEBP",
        quality=88,
        method=6,
    )


def main() -> None:
    write_scene_assets()


if __name__ == "__main__":
    main()
