#!/usr/bin/env python3
"""Generate the first-party ODD raster icon set.

The Oddlings set is intentionally built as simple raster glyphs instead of
mini illustrations. Every icon needs to survive the wp-admin rail, dock, and
desktop shortcut sizes, so the generator favors big silhouettes, thick cuts,
one accent mark, and transparent full-canvas scale.
"""

from __future__ import annotations

from pathlib import Path
import math
import shutil

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "_tools" / "catalog-sources" / "icon-sets" / "oddlings"
MIRROR_DIRS = [
    ROOT / "packages" / "create-odd-bundle" / "templates" / "icon-set",
    ROOT / "examples" / "example-iconset",
]

SIZE = 512
SCALE = 3
HI = SIZE * SCALE

ICON_KEYS = [
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
]


def rgba(hex_value: str, alpha: int = 255) -> tuple[int, int, int, int]:
    value = hex_value.lstrip("#")
    return (
        int(value[0:2], 16),
        int(value[2:4], 16),
        int(value[4:6], 16),
        alpha,
    )


RIM = rgba("#14081f")
RIM_SOFT = rgba("#14081f", 190)
INK = rgba("#211635")
FILL = rgba("#f2edf8")
FILL_2 = rgba("#d8d5e4")
FILL_3 = rgba("#bfc0d2")
CYAN = rgba("#48f0ff")
MAGENTA = rgba("#ff3f9f")
VIOLET = rgba("#7d58ff")
PEACH = rgba("#ffb25f")
LIME = rgba("#a9ff68")
SHADOW = rgba("#000000", 130)

ACCENTS = [CYAN, MAGENTA, VIOLET, PEACH, LIME]


def n(value: float) -> int:
    return round(value * SCALE)


def box(values: tuple[float, float, float, float]) -> tuple[int, int, int, int]:
    return tuple(n(v) for v in values)


def points(values: list[tuple[float, float]]) -> list[tuple[int, int]]:
    return [(n(x), n(y)) for x, y in values]


def icon_base() -> Image.Image:
    return Image.new("RGBA", (HI, HI), (0, 0, 0, 0))


def draw_line(
    draw: ImageDraw.ImageDraw,
    xy: list[tuple[float, float]],
    fill: tuple[int, int, int, int],
    width: float,
    *,
    outline: bool = True,
) -> None:
    if outline:
        draw.line(points(xy), fill=RIM, width=n(width + 18), joint="curve")
    draw.line(points(xy), fill=fill, width=n(width), joint="curve")


def draw_rr(
    draw: ImageDraw.ImageDraw,
    xy: tuple[float, float, float, float],
    radius: float,
    fill: tuple[int, int, int, int],
    *,
    outline_width: float = 0,
    outline_fill: tuple[int, int, int, int] = RIM,
) -> None:
    if outline_width:
        draw.rounded_rectangle(
            box(xy),
            radius=n(radius),
            fill=fill,
            outline=outline_fill,
            width=n(outline_width),
        )
    else:
        draw.rounded_rectangle(box(xy), radius=n(radius), fill=fill)


def draw_ellipse(
    draw: ImageDraw.ImageDraw,
    xy: tuple[float, float, float, float],
    fill: tuple[int, int, int, int],
    *,
    outline_width: float = 0,
) -> None:
    if outline_width:
        draw.ellipse(box(xy), fill=fill, outline=RIM, width=n(outline_width))
    else:
        draw.ellipse(box(xy), fill=fill)


def draw_poly(
    draw: ImageDraw.ImageDraw,
    xy: list[tuple[float, float]],
    fill: tuple[int, int, int, int],
    *,
    outline_width: float = 0,
) -> None:
    if outline_width:
        draw.line(points(xy + [xy[0]]), fill=RIM, width=n(outline_width * 2), joint="curve")
    draw.polygon(points(xy), fill=fill)


def rotated_layer(img: Image.Image, angle: float, draw_fn) -> None:
    layer = icon_base()
    draw_fn(ImageDraw.Draw(layer))
    layer = layer.rotate(angle, resample=Image.Resampling.BICUBIC, center=(n(256), n(256)))
    img.alpha_composite(layer)


def alpha_bbox(img: Image.Image, threshold: int = 18):
    alpha = img.getchannel("A").point(lambda px: 255 if px > threshold else 0)
    return alpha.getbbox()


def normalize_icon(img: Image.Image, margin: float = 12) -> Image.Image:
    bbox = alpha_bbox(img)
    if bbox is None:
        return img

    crop = img.crop(bbox)
    width, height = crop.size
    target = HI - (n(margin) * 2)
    scale = min(target / width, target / height)
    resized = crop.resize(
        (max(1, round(width * scale)), max(1, round(height * scale))),
        Image.Resampling.LANCZOS,
    )

    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.alpha_composite(
        resized,
        ((HI - resized.width) // 2, (HI - resized.height) // 2),
    )
    return out


def max_filter(size: int) -> ImageFilter.Filter:
    odd = max(3, int(size))
    if odd % 2 == 0:
        odd += 1
    return ImageFilter.MaxFilter(odd)


def add_depth(img: Image.Image) -> Image.Image:
    alpha = img.getchannel("A")
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))

    glow_alpha = alpha.filter(ImageFilter.GaussianBlur(n(5)))
    glow = Image.new("RGBA", img.size, rgba("#48f0ff", 44))
    glow.putalpha(glow_alpha)
    out.alpha_composite(glow)

    drop_alpha = alpha.filter(ImageFilter.GaussianBlur(n(7)))
    drop = Image.new("RGBA", img.size, SHADOW)
    drop.putalpha(drop_alpha)
    out.alpha_composite(drop, (0, n(9)))

    rim_alpha = alpha.filter(max_filter(n(4)))
    rim = Image.new("RGBA", img.size, RIM)
    rim.putalpha(rim_alpha)
    out.alpha_composite(rim)
    out.alpha_composite(img)
    return out


def add_odd_mark(img: Image.Image, key: str) -> None:
    bbox = alpha_bbox(img, 32)
    if bbox is None:
        return

    x0, y0, x1, y1 = bbox
    width = x1 - x0
    height = y1 - y0
    unit = max(n(24), round(min(width, height) * 0.095))
    idx = ICON_KEYS.index(key)
    color = ACCENTS[idx % len(ACCENTS)]
    d = ImageDraw.Draw(img)

    # A single off-kilter "odd seed" keeps the set alive without adding
    # tiny facial details that disappear in compact rails.
    cx = x0 + round(width * (0.72 if idx % 2 else 0.28))
    cy = y0 + round(height * (0.22 if idx % 3 else 0.78))
    d.ellipse(
        (cx - unit, cy - unit, cx + unit, cy + unit),
        fill=RIM_SOFT,
    )
    d.ellipse(
        (
            cx - round(unit * 0.64),
            cy - round(unit * 0.64),
            cx + round(unit * 0.64),
            cy + round(unit * 0.64),
        ),
        fill=color,
    )


def finish(img: Image.Image, key: str) -> Image.Image:
    add_odd_mark(img, key)
    img = normalize_icon(img)
    img = add_depth(img)
    return img.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def draw_dashboard(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    d.arc(box((98, 128, 414, 444)), 203, 337, fill=RIM, width=n(74))
    d.arc(box((98, 128, 414, 444)), 203, 337, fill=FILL, width=n(48))
    draw_line(d, [(256, 300), (346, 210)], PEACH, 26)
    draw_ellipse(d, (218, 262, 294, 338), CYAN, outline_width=8)
    d.arc(box((154, 184, 358, 388)), 217, 323, fill=VIOLET, width=n(15))


def draw_posts(img: Image.Image) -> None:
    def card(d: ImageDraw.ImageDraw) -> None:
        draw_rr(d, (134, 118, 378, 382), 44, FILL)
        draw_rr(d, (178, 180, 334, 212), 14, CYAN)
        draw_rr(d, (178, 250, 312, 282), 14, VIOLET)
        draw_rr(d, (178, 318, 278, 350), 14, FILL_3)
    rotated_layer(img, -8, card)


def draw_pages(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    draw_rr(d, (134, 126, 316, 374), 34, FILL_2)
    draw_rr(d, (196, 148, 378, 396), 36, FILL)
    draw_poly(d, [(316, 148), (378, 210), (316, 210)], FILL_2)
    draw_rr(d, (232, 264, 342, 298), 14, CYAN)
    draw_rr(d, (232, 326, 318, 360), 14, MAGENTA)


def draw_media(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    draw_rr(d, (104, 176, 404, 352), 54, FILL)
    draw_rr(d, (144, 134, 250, 204), 32, FILL)
    draw_ellipse(d, (184, 184, 334, 334), INK)
    draw_ellipse(d, (222, 222, 296, 296), VIOLET)
    draw_ellipse(d, (318, 206, 370, 258), CYAN)
    draw_line(d, [(398, 202), (398, 334), (454, 316)], MAGENTA, 24)


def draw_comments(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    draw_rr(d, (92, 150, 418, 320), 78, FILL)
    draw_poly(d, [(292, 302), (390, 386), (354, 288)], FILL)
    for x, color in ((188, CYAN), (256, VIOLET), (324, MAGENTA)):
        draw_ellipse(d, (x - 26, 220, x + 26, 272), color)


def draw_appearance(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    draw_line(d, [(328, 104), (202, 318)], FILL, 42)
    draw_line(d, [(286, 180), (214, 304)], CYAN, 18, outline=False)
    draw_poly(d, [(178, 310), (112, 448), (250, 382)], INK)
    draw_poly(d, [(128, 426), (188, 328), (250, 382), (208, 452)], VIOLET)
    draw_rr(d, (202, 276, 262, 342), 16, PEACH)


def draw_plugins(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    draw_ellipse(d, (110, 218, 232, 344), FILL_2)
    draw_ellipse(d, (280, 218, 402, 344), FILL_2)
    draw_rr(d, (182, 126, 330, 390), 74, FILL)
    draw_line(d, [(214, 130), (184, 72)], FILL, 20)
    draw_line(d, [(298, 130), (328, 72)], FILL, 20)
    draw_ellipse(d, (168, 54, 208, 94), CYAN)
    draw_ellipse(d, (304, 54, 344, 94), CYAN)
    draw_rr(d, (216, 368, 296, 458), 30, CYAN)
    draw_rr(d, (220, 206, 292, 236), 12, INK)
    draw_rr(d, (220, 282, 292, 312), 12, INK)


def draw_users(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    draw_ellipse(d, (254, 114, 380, 240), VIOLET)
    draw_rr(d, (222, 236, 412, 398), 82, VIOLET)
    draw_ellipse(d, (130, 128, 270, 268), FILL)
    draw_rr(d, (82, 262, 322, 430), 92, FILL)
    draw_rr(d, (108, 354, 296, 416), 30, CYAN)


def draw_tools(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    draw_line(d, [(178, 336), (336, 178)], FILL, 50)
    draw_ellipse(d, (104, 298, 214, 408), FILL)
    draw_ellipse(d, (134, 328, 184, 378), INK)
    d.pieslice(box((278, 82, 452, 256)), 42, 318, fill=FILL)
    draw_ellipse(d, (324, 128, 404, 208), INK)
    draw_line(d, [(228, 286), (296, 218)], CYAN, 18, outline=False)


def draw_settings(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    rows = ((154, 324, VIOLET), (256, 184, CYAN), (358, 276, PEACH))
    for y, knob_x, color in rows:
        draw_rr(d, (90, y - 16, 422, y + 16), 16, FILL)
        draw_ellipse(d, (knob_x - 46, y - 46, knob_x + 46, y + 46), color)
        draw_ellipse(d, (knob_x - 18, y - 18, knob_x + 18, y + 18), FILL)


def draw_profile(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    draw_ellipse(d, (92, 94, 420, 422), FILL)
    draw_ellipse(d, (148, 150, 364, 366), INK)
    draw_ellipse(d, (204, 176, 308, 280), FILL)
    draw_rr(d, (170, 280, 342, 386), 58, FILL)
    d.arc(box((92, 94, 420, 422)), 34, 118, fill=MAGENTA, width=n(25))
    d.arc(box((92, 94, 420, 422)), 204, 294, fill=CYAN, width=n(25))


def draw_links(img: Image.Image) -> None:
    def chain(d: ImageDraw.ImageDraw) -> None:
        draw_rr(d, (100, 190, 292, 300), 54, FILL, outline_width=32)
        draw_rr(d, (220, 212, 412, 322), 54, FILL, outline_width=32)
        draw_line(d, [(214, 256), (298, 256)], CYAN, 26, outline=False)
    rotated_layer(img, -28, chain)


def draw_recycle_bin(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    draw_rr(d, (152, 168, 360, 416), 42, FILL)
    draw_rr(d, (116, 118, 396, 180), 30, FILL)
    draw_rr(d, (208, 74, 304, 132), 26, VIOLET)
    for x in (206, 256, 306):
        draw_rr(d, (x - 14, 226, x + 14, 370), 12, INK)


def draw_fallback(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    draw_rr(d, (112, 124, 400, 388), 48, FILL)
    draw_rr(d, (112, 124, 400, 196), 48, INK)
    draw_rr(d, (152, 232, 246, 340), 22, CYAN)
    draw_rr(d, (278, 232, 360, 340), 22, FILL_2)
    draw_line(d, [(256, 196), (256, 388)], RIM_SOFT, 12, outline=False)
    for x, color in ((154, CYAN), (204, MAGENTA), (254, VIOLET)):
        draw_ellipse(d, (x, 146, x + 26, 172), color)


def draw_os_settings(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    draw_rr(d, (88, 118, 424, 320), 28, FILL)
    draw_rr(d, (124, 154, 388, 284), 18, INK)
    draw_poly(d, [(160, 250), (340, 178), (340, 226), (160, 298)], FILL)
    draw_rr(d, (222, 324, 290, 374), 12, FILL)
    draw_rr(d, (178, 374, 334, 408), 16, FILL)
    draw_rr(d, (156, 210, 318, 230), 10, CYAN)


def draw_import(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    draw_line(d, [(256, 78), (256, 292)], FILL, 58)
    draw_poly(d, [(256, 420), (104, 268), (198, 268), (198, 228), (314, 228), (314, 268), (408, 268)], FILL)
    draw_poly(d, [(256, 420), (180, 344), (332, 344)], CYAN)
    draw_rr(d, (150, 86, 362, 202), 28, FILL, outline_width=22)
    draw_rr(d, (178, 440, 334, 474), 16, VIOLET)


def draw_classic_admin(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    draw_line(d, [(334, 108), (412, 108), (412, 404), (334, 404)], FILL, 44)
    draw_poly(d, [(94, 256), (238, 116), (238, 196), (354, 196), (354, 316), (238, 316), (238, 396)], FILL)
    draw_line(d, [(346, 196), (346, 316)], CYAN, 22, outline=False)
    draw_line(d, [(132, 256), (246, 154)], VIOLET, 18, outline=False)
    draw_line(d, [(132, 256), (246, 358)], MAGENTA, 18, outline=False)


DRAWERS = {
    "dashboard": draw_dashboard,
    "posts": draw_posts,
    "pages": draw_pages,
    "media": draw_media,
    "comments": draw_comments,
    "appearance": draw_appearance,
    "plugins": draw_plugins,
    "users": draw_users,
    "tools": draw_tools,
    "settings": draw_settings,
    "profile": draw_profile,
    "links": draw_links,
    "recycle-bin": draw_recycle_bin,
    "fallback": draw_fallback,
    "os-settings": draw_os_settings,
    "import": draw_import,
    "classic-admin": draw_classic_admin,
}


def generate_icons() -> dict[str, Image.Image]:
    icons: dict[str, Image.Image] = {}
    for key in ICON_KEYS:
        img = icon_base()
        DRAWERS[key](img)
        icons[key] = finish(img, key)
    return icons


def save_icons(icons: dict[str, Image.Image], folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for key, img in icons.items():
        img.save(folder / f"{key}.webp", "WEBP", quality=92, method=4)


def mirror_icons() -> None:
    for folder in MIRROR_DIRS:
        folder.mkdir(parents=True, exist_ok=True)
        for key in ICON_KEYS:
            shutil.copy2(SOURCE_DIR / f"{key}.webp", folder / f"{key}.webp")


def save_contact_sheet(icons: dict[str, Image.Image]) -> None:
    cols = 6
    rows = math.ceil(len(ICON_KEYS) / cols)
    sheet = Image.new("RGBA", (SIZE * cols, SIZE * rows), (0, 0, 0, 0))
    for idx, key in enumerate(ICON_KEYS):
        x = (idx % cols) * SIZE
        y = (idx // cols) * SIZE
        sheet.alpha_composite(icons[key], (x, y))
    sheet.save(SOURCE_DIR / "source-contact-sheet.png", "PNG")


def save_card(icons: dict[str, Image.Image]) -> None:
    card = Image.new("RGBA", (1600, 1000), rgba("#090511"))

    def glow(xy: tuple[int, int, int, int], color, blur: int) -> None:
        layer = Image.new("RGBA", card.size, (0, 0, 0, 0))
        ImageDraw.Draw(layer).ellipse(xy, fill=color)
        card.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))

    glow((-180, -140, 920, 840), rgba("#48f0ff", 56), 70)
    glow((500, 260, 1800, 1160), rgba("#7d58ff", 58), 78)
    glow((820, -180, 1700, 580), rgba("#ff3f9f", 34), 82)
    ImageDraw.Draw(card).ellipse((110, 650, 1490, 920), fill=rgba("#f2edf8", 18))

    placements = [
        ("dashboard", 178, 218, 300, -5),
        ("posts", 464, 142, 330, 6),
        ("pages", 764, 224, 300, -3),
        ("media", 1044, 148, 330, 5),
        ("plugins", 640, 500, 336, 0),
    ]
    for key, x, y, size, rotation in placements:
        icon = icons[key].resize((size, size), Image.Resampling.LANCZOS)
        if rotation:
            icon = icon.rotate(rotation, resample=Image.Resampling.BICUBIC, expand=True)
        alpha = icon.getchannel("A").filter(ImageFilter.GaussianBlur(20))
        shadow = Image.new("RGBA", icon.size, rgba("#000000", 116))
        shadow.putalpha(alpha)
        card.alpha_composite(shadow, (x, y + 34))
        card.alpha_composite(icon, (x, y))

    card.convert("RGB").save(SOURCE_DIR / "card.webp", "WEBP", quality=90, method=4)


def main() -> int:
    icons = generate_icons()
    save_icons(icons, SOURCE_DIR)
    save_contact_sheet(icons)
    save_card(icons)
    mirror_icons()
    print(f"generated {len(icons)} simple raster icons")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
