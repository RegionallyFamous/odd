#!/usr/bin/env python3
"""Slice the approved app icon contact sheet into raster icons and cards."""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = ROOT / "_tools" / "catalog-sources" / "apps"
SOURCE_SHEET = APP_ROOT / "source-app-icons-contact-sheet.png"
ICON_SIZE = 1024
ICON_CANVAS = (ICON_SIZE, ICON_SIZE)
CARD_SIZE = (1024, 576)
FIXED_DATE = (2025, 1, 1, 0, 0, 0)

APP_ORDER = (
    "board",
    "dont-read-the-comments",
    "flow",
    "ledger",
    "mosaic",
    "sine",
    "swatch",
    "tome",
)

CARD_COLORS = {
    "board": ("#ffd45a", "#56e7f4", "#ff5aa8"),
    "dont-read-the-comments": ("#ff5aa8", "#ffd45a", "#56e7f4"),
    "flow": ("#ff5aa8", "#56e7f4", "#9068ff"),
    "ledger": ("#56e7f4", "#ffd45a", "#77ef8b"),
    "mosaic": ("#ff5aa8", "#56e7f4", "#ffd45a"),
    "sine": ("#9068ff", "#ff5aa8", "#56e7f4"),
    "swatch": ("#ff5aa8", "#ffd45a", "#56e7f4"),
    "tome": ("#9068ff", "#ff5aa8", "#f4efe4"),
}

INK = "#080511"
GOLD = "#ffd45a"


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


def alpha_for_pixel(r: int, g: int, b: int) -> int:
    dominance = g - max(r, b)
    if g <= 80 or dominance <= 20:
        return 255
    return max(0, 255 - min(255, int((dominance - 20) * 4)))


def make_alpha_sheet(src: Image.Image) -> tuple[Image.Image, list[bytearray]]:
    src = src.convert("RGB")
    width, height = src.size
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    in_px = src.load()
    out_px = out.load()
    mask: list[bytearray] = [bytearray(width) for _ in range(height)]

    for y in range(height):
        row = mask[y]
        for x in range(width):
            r, g, b = in_px[x, y]
            alpha = alpha_for_pixel(r, g, b)
            if alpha < 24:
                alpha = 0
            if alpha:
                dominance = g - max(r, b)
                if dominance > 8:
                    g = min(g, max(r, b) + 8)
                out_px[x, y] = (r, g, b, alpha)
                row[x] = 1
    return out, mask


def component_boxes(mask: list[bytearray]) -> list[tuple[int, int, int, int, int]]:
    height = len(mask)
    width = len(mask[0]) if height else 0
    seen = [bytearray(width) for _ in range(height)]
    boxes: list[tuple[int, int, int, int, int]] = []

    for y in range(height):
        for x in range(width):
            if not mask[y][x] or seen[y][x]:
                continue
            stack = [(x, y)]
            seen[y][x] = 1
            x1 = x2 = x
            y1 = y2 = y
            area = 0
            while stack:
                cx, cy = stack.pop()
                area += 1
                x1 = min(x1, cx)
                x2 = max(x2, cx)
                y1 = min(y1, cy)
                y2 = max(y2, cy)
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if nx < 0 or nx >= width or ny < 0 or ny >= height:
                        continue
                    if mask[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = 1
                        stack.append((nx, ny))
            if area >= 100:
                boxes.append((x1, y1, x2 + 1, y2 + 1, area))
    return sorted(boxes, key=lambda box: box[0])


def alpha_bbox(img: Image.Image, threshold: int = 16) -> tuple[int, int, int, int]:
    alpha = img.getchannel("A")
    mask = alpha.point(lambda p: 255 if p > threshold else 0)
    bbox = mask.getbbox()
    if not bbox:
        raise RuntimeError("icon crop has no visible pixels")
    return bbox


def fit_to_canvas(crop: Image.Image, target: int) -> Image.Image:
    bbox = alpha_bbox(crop, 32)
    crop = crop.crop(bbox)
    scale = target / max(crop.size)
    resized = crop.resize(
        (round(crop.width * scale), round(crop.height * scale)),
        Image.Resampling.LANCZOS,
    )
    out = Image.new("RGBA", ICON_CANVAS, (0, 0, 0, 0))
    out.alpha_composite(resized, ((ICON_SIZE - resized.width) // 2, (ICON_SIZE - resized.height) // 2))
    return out


def normalize_icon(crop: Image.Image) -> Image.Image:
    icon = fit_to_canvas(crop, 870)
    icon = remove_edge_slivers(icon)
    return fit_to_canvas(icon, 870)


def remove_edge_slivers(icon: Image.Image) -> Image.Image:
    alpha = icon.getchannel("A")
    px = icon.load()
    a_px = alpha.load()
    width, height = icon.size
    seen = [bytearray(width) for _ in range(height)]

    for y in range(height):
        for x in range(width):
            if seen[y][x] or a_px[x, y] <= 16:
                continue
            stack = [(x, y)]
            seen[y][x] = 1
            pixels = []
            x1 = x2 = x
            y1 = y2 = y
            while stack:
                cx, cy = stack.pop()
                pixels.append((cx, cy))
                x1 = min(x1, cx)
                x2 = max(x2, cx)
                y1 = min(y1, cy)
                y2 = max(y2, cy)
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if nx < 0 or nx >= width or ny < 0 or ny >= height:
                        continue
                    if not seen[ny][nx] and a_px[nx, ny] > 16:
                        seen[ny][nx] = 1
                        stack.append((nx, ny))
            comp_w = x2 - x1 + 1
            comp_h = y2 - y1 + 1
            area = len(pixels)
            near_edge = x1 < 150 or x2 > width - 150
            tall_sliver = comp_h >= 100 and (comp_w < 120 or comp_h > comp_w * 2)
            small_edge_scrap = area < 4200 and max(comp_w, comp_h) < 140
            if near_edge and (tall_sliver or small_edge_scrap):
                for px_x, px_y in pixels:
                    r, g, b, _a = px[px_x, px_y]
                    px[px_x, px_y] = (r, g, b, 0)
    return icon


def extract_icons() -> dict[str, Image.Image]:
    if not SOURCE_SHEET.is_file():
        raise SystemExit(f"missing {SOURCE_SHEET}")
    source = Image.open(SOURCE_SHEET)
    alpha_sheet, mask = make_alpha_sheet(source)
    boxes = component_boxes(mask)
    if len(boxes) != len(APP_ORDER):
        raise SystemExit(f"expected {len(APP_ORDER)} app icons in contact sheet, found {len(boxes)}")

    icons: dict[str, Image.Image] = {}
    width, height = alpha_sheet.size
    for slug, (x1, y1, x2, y2, _area) in zip(APP_ORDER, boxes):
        pad = 36
        crop = alpha_sheet.crop((
            max(0, x1 - pad),
            max(0, y1 - pad),
            min(width, x2 + pad),
            min(height, y2 + pad),
        ))
        icons[slug] = normalize_icon(crop)
    return icons


def sparkle(draw: ImageDraw.ImageDraw, x: int, y: int, r: int, fill: str = GOLD) -> None:
    p = round(r * 0.34)
    draw.polygon(
        [(x, y - r), (x + p, y - p), (x + r, y), (x + p, y + p),
         (x, y + r), (x - p, y + p), (x - r, y), (x - p, y - p)],
        fill=rgba("#07050f", 255),
    )
    r2 = round(r * 0.68)
    p2 = round(r2 * 0.34)
    draw.polygon(
        [(x, y - r2), (x + p2, y - p2), (x + r2, y), (x + p2, y + p2),
         (x, y + r2), (x - p2, y + p2), (x - r2, y), (x - p2, y - p2)],
        fill=rgba(fill, 255),
    )


def card_plate(accent: str, secondary: str, warm: str) -> Image.Image:
    width, height = CARD_SIZE
    img = Image.new("RGBA", CARD_SIZE, rgba(INK))
    draw = ImageDraw.Draw(img)
    for y in range(height):
        t = y / (height - 1)
        draw.line((0, y, width, y), fill=(*mix("#171126", "#05030a", t), 255))

    glows = Image.new("RGBA", CARD_SIZE, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glows)
    gd.ellipse((-230, -230, 590, 540), fill=rgba(accent, 92))
    gd.ellipse((520, -160, 1260, 420), fill=rgba(secondary, 68))
    gd.ellipse((210, 230, 900, 780), fill=rgba(warm, 38))
    img.alpha_composite(glows.filter(ImageFilter.GaussianBlur(62)))

    grid = Image.new("RGBA", CARD_SIZE, (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    for x in range(38, width, 58):
        gd.line((x, 0, x, height), fill=(255, 255, 255, 21), width=1)
    for y in range(34, height, 58):
        gd.line((0, y, width, y), fill=(255, 255, 255, 18), width=1)
    for x in range(86, width, 174):
        gd.line((x, 0, x, height), fill=rgba(accent, 28), width=2)
    img.alpha_composite(grid)
    return img


def render_card(icon: Image.Image, colors: tuple[str, str, str]) -> Image.Image:
    base = card_plate(*colors)
    art = icon.copy()
    art.thumbnail((430, 430), Image.Resampling.LANCZOS)
    x = (CARD_SIZE[0] - art.width) // 2
    y = (CARD_SIZE[1] - art.height) // 2 + 8
    shadow = Image.new("RGBA", art.size, (0, 0, 0, 0))
    shadow.putalpha(art.getchannel("A").filter(ImageFilter.GaussianBlur(18)).point(lambda p: min(128, p)))
    base.alpha_composite(shadow, (x, y + 22))
    base.alpha_composite(art, (x, y))
    draw = ImageDraw.Draw(base)
    sparkle(draw, 220, 136, 16, colors[2])
    sparkle(draw, 798, 404, 20, colors[0])
    return base.convert("RGB")


def write_bundle_icon(src_dir: Path, icon_bytes: bytes) -> None:
    bundle = src_dir / "bundle.wp"
    if not bundle.is_file():
        return
    out = io.BytesIO()
    with zipfile.ZipFile(bundle, "r") as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        found_manifest = False
        found_icon = False
        for src_info in zin.infolist():
            name = src_info.filename
            if name == "icon.svg":
                continue
            data = zin.read(name)
            if name == "manifest.json":
                manifest = json.loads(data.decode("utf-8"))
                manifest["icon"] = "icon.webp"
                data = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")
                found_manifest = True
            elif name == "icon.webp":
                data = icon_bytes
                found_icon = True
            info = zipfile.ZipInfo(name, date_time=FIXED_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = src_info.external_attr
            zout.writestr(info, data)
        if not found_manifest:
            raise SystemExit(f"{bundle}: missing manifest.json")
        if not found_icon:
            info = zipfile.ZipInfo("icon.webp", date_time=FIXED_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            zout.writestr(info, icon_bytes)
    bundle.write_bytes(out.getvalue())
    print(bundle)


def sync_bundle_src(src_dir: Path, icon_bytes: bytes) -> None:
    bundle_src = src_dir / "bundle-src"
    if not bundle_src.is_dir():
        return
    (bundle_src / "icon.webp").write_bytes(icon_bytes)
    manifest_path = bundle_src / "manifest.json"
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text())
        if manifest.get("icon") != "icon.webp":
            manifest["icon"] = "icon.webp"
            manifest_path.write_text(json.dumps(manifest, indent="\t") + "\n")


def main() -> None:
    icons = extract_icons()
    for slug in APP_ORDER:
        src_dir = APP_ROOT / slug
        if not src_dir.is_dir():
            raise SystemExit(f"missing app source {src_dir}")
        icon_path = src_dir / "icon.webp"
        card_path = src_dir / "card.webp"
        icon = icons[slug]
        icon.save(icon_path, "WEBP", quality=92, method=6)
        icon_bytes = icon_path.read_bytes()
        render_card(icon, CARD_COLORS[slug]).save(card_path, "WEBP", quality=88, method=6)
        write_bundle_icon(src_dir, icon_bytes)
        sync_bundle_src(src_dir, icon_bytes)
        print(icon_path)
        print(card_path)


if __name__ == "__main__":
    main()
