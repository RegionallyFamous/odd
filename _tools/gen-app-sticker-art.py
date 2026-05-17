#!/usr/bin/env python3
"""Generate first-party app icons and cards in the ODD default icon style."""

from __future__ import annotations

import io
import json
import math
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = ROOT / "_tools" / "catalog-sources" / "apps"
ICON_SIZE = 1024
ICON_CANVAS = (ICON_SIZE, ICON_SIZE)
CARD_SIZE = (1024, 576)
FIXED_DATE = (2025, 1, 1, 0, 0, 0)

INK = "#080511"
RIM = "#07050f"
PAPER = "#f4efe4"
PAPER_2 = "#ded7cc"
CYAN = "#56e7f4"
PINK = "#ff5aa8"
VIOLET = "#9068ff"
VIOLET_DARK = "#4f2ab8"
GOLD = "#ffd45a"
GREEN = "#77ef8b"
ORANGE = "#ff9f55"

APPS = {
    "board": (GOLD, CYAN, PINK),
    "dont-read-the-comments": (PINK, GOLD, CYAN),
    "flow": (PINK, CYAN, VIOLET),
    "ledger": (CYAN, GOLD, GREEN),
    "mosaic": (PINK, CYAN, GOLD),
    "sine": (VIOLET, PINK, CYAN),
    "swatch": (PINK, GOLD, CYAN),
    "tome": (VIOLET, PINK, PAPER),
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


def sparkle(draw: ImageDraw.ImageDraw, x: int, y: int, r: int, fill: str = GOLD) -> None:
    p = round(r * 0.34)
    draw.polygon(
        [(x, y - r), (x + p, y - p), (x + r, y), (x + p, y + p),
         (x, y + r), (x - p, y + p), (x - r, y), (x - p, y - p)],
        fill=rgba(RIM, 255),
    )
    r2 = round(r * 0.7)
    p2 = round(r2 * 0.34)
    draw.polygon(
        [(x, y - r2), (x + p2, y - p2), (x + r2, y), (x + p2, y + p2),
         (x, y + r2), (x - p2, y + p2), (x - r2, y), (x - p2, y - p2)],
        fill=rgba(fill, 255),
    )


def gradient(size: tuple[int, int], top: str, bottom: str) -> Image.Image:
    width, height = size
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for y in range(height):
        t = y / max(1, height - 1)
        draw.line((0, y, width, y), fill=(*mix(top, bottom, t), 255))
    return img


def rounded_sticker(
    layer: Image.Image,
    xy,
    radius: int,
    top: str,
    bottom: str,
    *,
    cream: bool = True,
    tilt: float = 0,
) -> None:
    x1, y1, x2, y2 = xy
    piece = Image.new("RGBA", ICON_CANVAS, (0, 0, 0, 0))
    draw = ImageDraw.Draw(piece)
    rounded(draw, (x1 - 42, y1 - 42, x2 + 42, y2 + 42), radius + 38, rgba(RIM, 255))
    if cream:
        rounded(draw, (x1 - 18, y1 - 18, x2 + 18, y2 + 18), radius + 22, rgba(PAPER, 255))
    mask = Image.new("L", ICON_CANVAS, 0)
    md = ImageDraw.Draw(mask)
    rounded(md, xy, radius, 255)
    fill = gradient(ICON_CANVAS, top, bottom)
    piece.alpha_composite(Image.composite(fill, Image.new("RGBA", ICON_CANVAS, (0, 0, 0, 0)), mask))
    gd = ImageDraw.Draw(piece)
    gd.ellipse((x1 + 50, y1 + 42, x1 + 116, y1 + 92), fill=(255, 255, 255, 112))
    gd.ellipse((x1 + 132, y1 + 64, x1 + 164, y1 + 96), fill=(255, 255, 255, 70))
    if tilt:
        piece = piece.rotate(tilt, resample=Image.Resampling.BICUBIC, center=((x1 + x2) / 2, (y1 + y2) / 2))
    layer.alpha_composite(piece)


def ellipse_sticker(layer: Image.Image, box, top: str, bottom: str, *, cream: bool = True) -> None:
    x1, y1, x2, y2 = box
    draw = ImageDraw.Draw(layer)
    pad = 42
    draw.ellipse((x1 - pad, y1 - pad, x2 + pad, y2 + pad), fill=rgba(RIM, 255))
    if cream:
        draw.ellipse((x1 - 18, y1 - 18, x2 + 18, y2 + 18), fill=rgba(PAPER, 255))
    mask = Image.new("L", ICON_CANVAS, 0)
    md = ImageDraw.Draw(mask)
    md.ellipse(box, fill=255)
    layer.alpha_composite(Image.composite(gradient(ICON_CANVAS, top, bottom), Image.new("RGBA", ICON_CANVAS, (0, 0, 0, 0)), mask))
    draw.ellipse((x1 + 62, y1 + 54, x1 + 124, y1 + 108), fill=(255, 255, 255, 112))
    draw.ellipse((x1 + 140, y1 + 78, x1 + 172, y1 + 110), fill=(255, 255, 255, 70))


def finish_icon(layer: Image.Image, accent: str, warm: str) -> Image.Image:
    out = Image.new("RGBA", ICON_CANVAS, (0, 0, 0, 0))
    alpha = layer.getchannel("A")
    glow = Image.new("RGBA", ICON_CANVAS, rgba(accent, 0))
    glow.putalpha(alpha.filter(ImageFilter.GaussianBlur(22)).point(lambda p: min(105, p)))
    out.alpha_composite(glow)
    shadow = Image.new("RGBA", ICON_CANVAS, (0, 0, 0, 0))
    shadow.putalpha(alpha.filter(ImageFilter.GaussianBlur(28)).point(lambda p: min(170, p)))
    shifted = Image.new("RGBA", ICON_CANVAS, (0, 0, 0, 0))
    shifted.alpha_composite(shadow, (0, 38))
    out.alpha_composite(shifted)
    out.alpha_composite(layer)
    draw = ImageDraw.Draw(out)
    sparkle(draw, 764, 242, 34, warm)
    sparkle(draw, 284, 766, 24, accent)
    return out


def draw_board(layer: Image.Image, colors) -> None:
    rounded_sticker(layer, (142, 190, 428, 554), 42, "#ffdf67", GOLD, tilt=-8)
    rounded_sticker(layer, (360, 132, 668, 526), 46, "#ff66b3", PINK, tilt=6)
    rounded_sticker(layer, (500, 322, 844, 704), 48, "#64edf6", CYAN, tilt=-4)
    draw = ImageDraw.Draw(layer)
    for x1, y1, x2, y2 in ((196, 308, 348, 342), (196, 408, 316, 444), (430, 260, 590, 300), (432, 382, 584, 422), (572, 456, 750, 494), (574, 568, 704, 606)):
        rounded(draw, (x1, y1, x2, y2), 18, rgba(INK, 210))
    line_round(draw, [(844, 260), (910, 260), (910, 648), (840, 648)], rgba(RIM, 255), 58)
    line_round(draw, [(844, 260), (910, 260), (910, 648), (840, 648)], rgba(PAPER, 255), 34)
    line_round(draw, [(844, 260), (910, 260), (910, 648), (840, 648)], rgba(VIOLET, 255), 16)


def draw_comments(layer: Image.Image, colors) -> None:
    rounded_sticker(layer, (202, 210, 746, 666), 74, "#fff4e2", PAPER_2, tilt=-3)
    draw = ImageDraw.Draw(layer)
    for x, y, fill in ((328, 340, PINK), (490, 300, CYAN), (616, 420, GOLD)):
        rounded(draw, (x - 58, y - 44, x + 58, y + 44), 24, rgba(RIM, 255))
        rounded(draw, (x - 42, y - 30, x + 42, y + 30), 18, rgba(fill, 255))
        draw.polygon([(x - 14, y + 28), (x + 18, y + 28), (x - 4, y + 58)], fill=rgba(fill, 255))
    for x, y in ((398, 500), (570, 540), (704, 284)):
        line_round(draw, [(x, y), (x, y - 120)], rgba(RIM, 255), 26)
        line_round(draw, [(x, y), (x, y - 120)], rgba(PAPER, 255), 12)
        draw.polygon([(x, y - 132), (x + 112, y - 98), (x, y - 62)], fill=rgba(RIM, 255))
        draw.polygon([(x + 16, y - 118), (x + 82, y - 98), (x + 16, y - 78)], fill=rgba(PINK, 255))


def draw_flow(layer: Image.Image, colors) -> None:
    draw = ImageDraw.Draw(layer)
    ellipse_sticker(layer, (168, 170, 856, 858), PAPER, PAPER_2)
    draw.ellipse((278, 282, 746, 750), fill=rgba(RIM, 255))
    draw.arc((316, 316, 708, 708), 198, 334, fill=rgba(PINK, 255), width=70)
    draw.arc((316, 316, 708, 708), 18, 146, fill=rgba(CYAN, 255), width=70)
    draw.arc((316, 316, 708, 708), 146, 198, fill=rgba(VIOLET, 255), width=70)
    line_round(draw, [(512, 520), (664, 356)], rgba(RIM, 255), 80)
    line_round(draw, [(512, 520), (664, 356)], rgba(PINK, 255), 44)
    draw.ellipse((440, 448, 584, 592), fill=rgba(RIM, 255))
    draw.ellipse((478, 486, 546, 554), fill=rgba(PINK, 255))
    rounded(draw, (272, 676, 752, 800), 28, rgba(RIM, 255))
    draw.ellipse((326, 708, 398, 780), fill=rgba(PINK, 255))
    draw.ellipse((626, 708, 698, 780), fill=rgba(CYAN, 255))


def draw_ledger(layer: Image.Image, colors) -> None:
    draw = ImageDraw.Draw(layer)
    rounded_sticker(layer, (222, 126, 760, 824), 64, PAPER, PAPER_2, tilt=-4)
    for y in (292, 398, 504):
        line_round(draw, [(320, y), (650, y + 12)], rgba(INK, 150), 24)
    rounded(draw, (320, 190, 602, 248), 24, rgba(INK, 210))
    for x1, y1, x2, y2, fill in ((342, 612, 418, 742, CYAN), (462, 530, 538, 742, GREEN), (584, 418, 660, 742, GOLD)):
        rounded(draw, (x1 - 16, y1 - 16, x2 + 16, y2 + 16), 28, rgba(RIM, 255))
        rounded(draw, (x1, y1, x2, y2), 18, rgba(fill, 255))
        draw.ellipse((x1 + 12, y1 + 18, x1 + 44, y1 + 50), fill=(255, 255, 255, 72))
    ellipse_sticker(layer, (642, 596, 842, 796), GOLD, ORANGE)
    draw.ellipse((704, 658, 780, 734), fill=rgba(RIM, 225))


def draw_mosaic(layer: Image.Image, colors) -> None:
    draw = ImageDraw.Draw(layer)
    rounded_sticker(layer, (164, 164, 836, 836), 78, PAPER, PAPER_2, tilt=-7)
    fills = [PINK, CYAN, GOLD, CYAN, VIOLET, PINK, GOLD, "#49cef2", PAPER]
    size = 142
    gap = 28
    start = 248
    i = 0
    for row in range(3):
        for col in range(3):
            x = start + col * (size + gap)
            y = start + row * (size + gap)
            rounded(draw, (x - 12, y - 12, x + size + 12, y + size + 12), 32, rgba(RIM, 255))
            rounded(draw, (x, y, x + size, y + size), 24, rgba(fills[i], 255))
            draw.ellipse((x + 26, y + 22, x + 64, y + 60), fill=(255, 255, 255, 76))
            i += 1
    line_round(draw, [(724, 758), (862, 896)], rgba(RIM, 255), 62)
    line_round(draw, [(724, 758), (862, 896)], rgba(PAPER, 255), 34)


def draw_sine(layer: Image.Image, colors) -> None:
    draw = ImageDraw.Draw(layer)
    points = []
    for x in range(112, 914, 12):
        t = (x - 112) / (914 - 112)
        y = 440 + math.sin(t * math.tau * 2.05 - 0.45) * 190
        points.append((x, y))
    line_round(draw, points, rgba(RIM, 255), 108)
    line_round(draw, points, rgba(PAPER, 255), 72)
    line_round(draw, points, rgba(VIOLET, 255), 42)
    rounded(draw, (196, 688, 828, 820), 66, rgba(RIM, 255))
    rounded(draw, (236, 728, 788, 780), 28, rgba(PAPER, 255))
    for x, fill in ((336, PINK), (512, CYAN), (688, VIOLET)):
        draw.ellipse((x - 70, 650, x + 70, 790), fill=rgba(RIM, 255))
        draw.ellipse((x - 48, 672, x + 48, 768), fill=rgba(fill, 255))
        draw.ellipse((x - 20, 700, x + 14, 734), fill=(255, 255, 255, 78))


def draw_swatch(layer: Image.Image, colors) -> None:
    draw = ImageDraw.Draw(layer)
    for x, y, r, fill in ((366, 332, 150, PINK), (650, 330, 150, GOLD), (352, 628, 154, CYAN), (664, 632, 154, VIOLET)):
        ellipse_sticker(layer, (x - r, y - r, x + r, y + r), fill, fill)
    ellipse_sticker(layer, (424, 424, 600, 600), PAPER, PAPER_2)
    draw.ellipse((468, 468, 556, 556), fill=rgba(RIM, 255))
    draw.ellipse((494, 494, 530, 530), fill=rgba(CYAN, 255))
    line_round(draw, [(214, 812), (388, 692)], rgba(RIM, 255), 74)
    line_round(draw, [(214, 812), (388, 692)], rgba(PAPER, 255), 42)


def draw_tome(layer: Image.Image, colors) -> None:
    draw = ImageDraw.Draw(layer)
    book = Image.new("RGBA", ICON_CANVAS, (0, 0, 0, 0))
    bd = ImageDraw.Draw(book)
    bd.polygon([(128, 170), (512, 238), (896, 170), (896, 792), (512, 872), (128, 792)], fill=rgba(RIM, 255))
    bd.polygon([(176, 224), (474, 276), (474, 786), (176, 728)], fill=rgba(VIOLET, 255))
    bd.polygon([(550, 276), (848, 224), (848, 728), (550, 786)], fill=rgba(PINK, 255))
    bd.polygon([(238, 282), (474, 324), (474, 738), (238, 692)], fill=rgba(PAPER, 255))
    bd.polygon([(550, 324), (786, 282), (786, 692), (550, 738)], fill=rgba(PAPER, 255))
    rounded(bd, (474, 252, 550, 812), 34, rgba(RIM, 255))
    bd.polygon([(570, 342), (654, 328), (628, 540), (578, 512)], fill=rgba(GOLD, 255))
    for y in (420, 520, 620):
        line_round(bd, [(290, y), (424, y + 24)], rgba(INK, 140), 22)
        line_round(bd, [(606, y + 24), (744, y)], rgba(INK, 140), 22)
    book = book.rotate(4, resample=Image.Resampling.BICUBIC, center=(512, 520))
    layer.alpha_composite(book)


DRAWERS = {
    "board": draw_board,
    "dont-read-the-comments": draw_comments,
    "flow": draw_flow,
    "ledger": draw_ledger,
    "mosaic": draw_mosaic,
    "sine": draw_sine,
    "swatch": draw_swatch,
    "tome": draw_tome,
}


def render_icon(slug: str) -> Image.Image:
    layer = Image.new("RGBA", ICON_CANVAS, (0, 0, 0, 0))
    colors = APPS[slug]
    DRAWERS[slug](layer, colors)
    return finish_icon(layer, colors[1], colors[2])


def plate(accent: str, secondary: str, warm: str) -> Image.Image:
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
    base = plate(*colors)
    art = icon.copy()
    art.thumbnail((520, 520), Image.Resampling.LANCZOS)
    x = (CARD_SIZE[0] - art.width) // 2
    y = (CARD_SIZE[1] - art.height) // 2 + 8
    shadow = Image.new("RGBA", art.size, (0, 0, 0, 0))
    alpha = art.getchannel("A").filter(ImageFilter.GaussianBlur(18))
    shadow.putalpha(alpha.point(lambda p: min(120, p)))
    base.alpha_composite(shadow, (x, y + 20))
    base.alpha_composite(art, (x, y))
    draw = ImageDraw.Draw(base)
    sparkle(draw, 222, 134, 16, colors[2])
    sparkle(draw, 792, 404, 20, colors[0])
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
    new_bytes = out.getvalue()
    if bundle.read_bytes() != new_bytes:
        bundle.write_bytes(new_bytes)
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


def build(slug: str, src_dir: Path) -> None:
    colors = APPS[slug]
    icon = render_icon(slug)
    icon_path = src_dir / "icon.webp"
    card_path = src_dir / "card.webp"
    src_dir.mkdir(parents=True, exist_ok=True)
    icon.save(icon_path, "WEBP", quality=92, method=6)
    card = render_card(icon, colors)
    card.save(card_path, "WEBP", quality=88, method=6)
    icon_bytes = icon_path.read_bytes()
    write_bundle_icon(src_dir, icon_bytes)
    sync_bundle_src(src_dir, icon_bytes)
    print(icon_path)
    print(card_path)


def main() -> None:
    for src_dir in sorted(APP_ROOT.iterdir()):
        if not src_dir.is_dir() or not (src_dir / "meta.json").is_file():
            continue
        slug = src_dir.name
        if slug not in APPS:
            raise SystemExit(f"no app sticker recipe for {slug}")
        build(slug, src_dir)


if __name__ == "__main__":
    main()
