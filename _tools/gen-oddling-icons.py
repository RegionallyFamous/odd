#!/usr/bin/env python3
"""Generate the first-party ODD raster icon set."""

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


INK = rgba("#12051f")
DEEP = rgba("#080511")
PLUM = rgba("#25173d")
PLUM_2 = rgba("#33214f")
VIOLET = rgba("#7a4cff")
CYAN = rgba("#64f4ff")
PEACH = rgba("#ffb86b")
MAGENTA = rgba("#ff3d9a")
CREAM = rgba("#fff4dc")
SILVER = rgba("#ececf3")
SLATE = rgba("#2d3140")


def n(value: float) -> int:
    return round(value * SCALE)


def box(values: tuple[float, float, float, float]) -> tuple[int, int, int, int]:
    return tuple(n(v) for v in values)


def points(values: list[tuple[float, float]]) -> list[tuple[int, int]]:
    return [(n(x), n(y)) for x, y in values]


def rounded_gradient(
    img: Image.Image,
    xy: tuple[float, float, float, float],
    radius: float,
    top: tuple[int, int, int, int],
    bottom: tuple[int, int, int, int],
) -> None:
    x0, y0, x1, y1 = box(xy)
    width = x1 - x0
    height = y1 - y0
    gradient = Image.new("RGBA", (width, height))
    draw = ImageDraw.Draw(gradient)
    for y in range(height):
        t = y / max(1, height - 1)
        color = tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(4))
        draw.line((0, y, width, y), fill=color)
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, width - 1, height - 1),
        radius=n(radius),
        fill=255,
    )
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    layer.paste(gradient, (x0, y0), mask)
    img.alpha_composite(layer)


def glow_ellipse(
    img: Image.Image,
    xy: tuple[float, float, float, float],
    color: tuple[int, int, int, int],
    blur: float,
) -> None:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse(box(xy), fill=color)
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(n(blur))))


def line(
    draw: ImageDraw.ImageDraw,
    xy: list[tuple[float, float]],
    fill: tuple[int, int, int, int],
    width: float,
) -> None:
    draw.line(points(xy), fill=fill, width=n(width), joint="curve")


def shadowed_shape(
    img: Image.Image,
    draw_fn,
    shadow_alpha: int = 112,
    blur: float = 8,
    dy: float = 8,
) -> None:
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(shadow), n(dy), rgba("#000000", shadow_alpha))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(n(blur))))
    draw_fn(ImageDraw.Draw(img), 0, None)


def icon_base() -> Image.Image:
    return Image.new("RGBA", (HI, HI), (0, 0, 0, 0))


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


def add_depth(img: Image.Image) -> Image.Image:
    alpha = img.getchannel("A")
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))

    glow = Image.new("RGBA", img.size, rgba("#64f4ff", 44))
    glow.putalpha(alpha.filter(ImageFilter.GaussianBlur(n(5))))
    out.alpha_composite(glow)

    odd_glow = Image.new("RGBA", img.size, rgba("#ff3d9a", 18))
    odd_glow.putalpha(alpha.filter(ImageFilter.GaussianBlur(n(9))))
    out.alpha_composite(odd_glow)

    shadow = Image.new("RGBA", img.size, rgba("#000000", 96))
    shadow.putalpha(alpha.filter(ImageFilter.GaussianBlur(n(5))))
    out.alpha_composite(shadow, (0, n(6)))

    out.alpha_composite(img)
    return out


def oddify(img: Image.Image, key: str) -> None:
    bbox = alpha_bbox(img, 32)
    if bbox is None:
        return

    x0, y0, x1, y1 = bbox
    width = x1 - x0
    height = y1 - y0
    unit = max(n(7), min(width, height) // 14)
    d = ImageDraw.Draw(img)

    # Tiny eyes and feelers keep the silhouette native-ish while making it ODD.
    eye_y = y0 + round(height * 0.28)
    eye_1 = x0 + round(width * 0.58)
    eye_2 = eye_1 + round(unit * 1.75)
    for cx in (eye_1, eye_2):
        d.ellipse(
            (cx - unit, eye_y - unit, cx + unit, eye_y + unit),
            fill=rgba("#fff4dc", 245),
        )
        d.ellipse(
            (cx - unit // 3, eye_y - unit // 3, cx + unit // 3, eye_y + unit // 3),
            fill=INK,
        )

    feeler_x = x0 + round(width * 0.72)
    feeler_y = y0 + round(height * 0.12)
    d.line(
        (
            feeler_x,
            feeler_y + unit,
            feeler_x + round(unit * 1.2),
            feeler_y - round(unit * 1.8),
            feeler_x + round(unit * 2.5),
            feeler_y - round(unit * 0.8),
        ),
        fill=CYAN,
        width=max(2, round(unit * 0.42)),
        joint="curve",
    )
    d.ellipse(
        (
            feeler_x + round(unit * 1.9),
            feeler_y - round(unit * 1.35),
            feeler_x + round(unit * 3.0),
            feeler_y - round(unit * 0.25),
        ),
        fill=MAGENTA,
    )

    tail = [
        (
            x0 + round(width * 0.24),
            y1 - round(height * 0.16),
        ),
        (
            x0 + round(width * 0.12),
            y1 - round(height * 0.04),
        ),
        (
            x0 + round(width * 0.19),
            y1 + round(height * 0.08),
        ),
    ]
    d.line(tail, fill=CYAN, width=max(2, round(unit * 0.48)), joint="curve")
    d.ellipse(
        (
            tail[-1][0] - round(unit * 0.62),
            tail[-1][1] - round(unit * 0.62),
            tail[-1][0] + round(unit * 0.62),
            tail[-1][1] + round(unit * 0.62),
        ),
        fill=rgba("#fff4dc", 232),
    )


def finish(img: Image.Image) -> Image.Image:
    img = normalize_icon(img)
    img = add_depth(img)
    return img.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def draw_dashboard(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)

    def shape(draw: ImageDraw.ImageDraw, oy: int, color) -> None:
        draw.arc(box((148, 160, 364, 376)), 202, 338, fill=rgba("#fff4dc", 230) if color is None else color, width=n(24))
        for angle in (214, 244, 274, 304, 334):
            r1, r2 = 72, 92
            cx, cy = n(256), n(292) + oy
            a = math.radians(angle)
            draw.line(
                (
                    cx + round(math.cos(a) * n(r1)),
                    cy + round(math.sin(a) * n(r1)),
                    cx + round(math.cos(a) * n(r2)),
                    cy + round(math.sin(a) * n(r2)),
                ),
                fill=rgba("#fff4dc", 220) if color is None else color,
                width=n(7),
            )
        needle = [(256, 292), (326, 234)]
        line(draw, [(needle[0][0], needle[0][1] + oy / SCALE), (needle[1][0], needle[1][1] + oy / SCALE)], rgba("#ffb86b", 255) if color is None else color, 10)
        draw.ellipse(box((235, 271 + oy / SCALE, 277, 313 + oy / SCALE)), fill=CYAN if color is None else color)

    shadowed_shape(img, shape)
    d.arc(box((286, 178, 374, 330)), 286, 352, fill=CYAN, width=n(16))


def draw_posts(img: Image.Image) -> None:
    note = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(note)
    d.rounded_rectangle(box((166, 170, 346, 340)), radius=n(28), fill=CREAM)
    d.rounded_rectangle(box((166, 170, 346, 340)), radius=n(28), outline=rgba("#12051f", 80), width=n(4))
    d.rounded_rectangle(box((196, 216, 316, 235)), radius=n(9), fill=CYAN)
    d.rounded_rectangle(box((196, 258, 292, 274)), radius=n(8), fill=rgba("#7a4cff", 210))
    note = note.rotate(-7, resample=Image.Resampling.BICUBIC, center=(n(256), n(256)))
    img.alpha_composite(note)
    d = ImageDraw.Draw(img)
    line(d, [(258, 142), (258, 246)], rgba("#000000", 74), 15)
    line(d, [(254, 136), (254, 240)], rgba("#64f4ff", 255), 12)
    d.ellipse(box((222, 104, 286, 168)), fill=VIOLET)
    d.ellipse(box((236, 116, 268, 148)), fill=rgba("#fff4dc", 82))


def draw_pages(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(box((168, 146, 324, 340)), radius=n(24), fill=rgba("#000000", 70))
    d.rounded_rectangle(box((154, 132, 310, 326)), radius=n(24), fill=rgba("#d8dbe7", 255))
    d.rounded_rectangle(box((198, 174, 358, 368)), radius=n(26), fill=CREAM)
    d.polygon(points([(314, 174), (358, 218), (314, 218)]), fill=rgba("#d8dbe7", 255))
    d.line(points([(314, 174), (314, 218), (358, 218)]), fill=rgba("#12051f", 72), width=n(4))
    for y, color in ((250, CYAN), (288, rgba("#7a4cff", 220)), (326, rgba("#ffb86b", 230))):
        d.rounded_rectangle(box((228, y, 328, y + 14)), radius=n(7), fill=color)


def draw_media(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(box((142, 182, 342, 322)), radius=n(34), fill=SILVER)
    d.rounded_rectangle(box((160, 160, 236, 198)), radius=n(20), fill=SILVER)
    d.rounded_rectangle(box((142, 182, 342, 322)), radius=n(34), outline=rgba("#12051f", 84), width=n(5))
    d.ellipse(box((194, 202, 304, 312)), fill=SLATE)
    d.ellipse(box((216, 224, 282, 290)), fill=rgba("#7a4cff", 245))
    d.ellipse(box((232, 236, 270, 274)), fill=rgba("#12051f", 230))
    d.ellipse(box((296, 204, 326, 234)), fill=CYAN)
    line(d, [(364, 204), (364, 314)], MAGENTA, 16)
    line(d, [(364, 204), (420, 190)], MAGENTA, 14)
    d.ellipse(box((318, 304, 366, 352)), fill=MAGENTA)


def draw_comments(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(box((132, 164, 382, 310)), radius=n(66), fill=SILVER)
    d.polygon(points([(286, 300), (354, 356), (344, 286)]), fill=SILVER)
    d.rounded_rectangle(box((132, 164, 382, 310)), radius=n(66), outline=rgba("#12051f", 76), width=n(5))
    for x, color in ((208, VIOLET), (258, CYAN), (308, MAGENTA)):
        d.ellipse(box((x - 17, 221, x + 17, 255)), fill=color)


def draw_appearance(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    line(d, [(308, 142), (212, 306)], rgba("#000000", 72), 44)
    line(d, [(304, 138), (208, 302)], SILVER, 36)
    line(d, [(246, 248), (216, 300)], CYAN, 20)
    d.polygon(points([(196, 304), (164, 384), (240, 348)]), fill=rgba("#1b1c28", 255))
    d.polygon(points([(164, 384), (196, 336), (240, 348), (218, 390)]), fill=VIOLET)
    d.rounded_rectangle(box((218, 260, 256, 306)), radius=n(10), fill=PEACH)
    d.ellipse(box((290, 120, 346, 176)), fill=rgba("#fff4dc", 80))


def draw_plugins(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    d.ellipse(box((150, 206, 238, 314)), fill=rgba("#d8dbe7", 235))
    d.ellipse(box((282, 206, 370, 314)), fill=rgba("#d8dbe7", 235))
    d.ellipse(box((188, 154, 332, 344)), fill=SILVER)
    d.rounded_rectangle(box((210, 186, 310, 356)), radius=n(48), fill=SILVER)
    for y, color in ((220, CYAN), (258, VIOLET), (296, CYAN)):
        d.rounded_rectangle(box((214, y - 8, 306, y + 8)), radius=n(8), fill=color)
    d.line(points([(224, 160), (200, 112)]), fill=SILVER, width=n(14))
    d.line(points([(296, 160), (320, 112)]), fill=SILVER, width=n(14))
    d.ellipse(box((194, 100, 216, 122)), fill=CYAN)
    d.ellipse(box((314, 100, 336, 122)), fill=CYAN)
    d.rounded_rectangle(box((238, 346, 282, 404)), radius=n(17), fill=CYAN)
    d.rounded_rectangle(box((238, 346, 282, 404)), radius=n(17), outline=rgba("#12051f", 72), width=n(4))
    d.ellipse(box((224, 170, 248, 194)), fill=INK)
    d.ellipse(box((272, 170, 296, 194)), fill=INK)


def draw_users(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    d.ellipse(box((238, 134, 332, 228)), fill=rgba("#7a4cff", 230))
    d.rounded_rectangle(box((208, 220, 366, 350)), radius=n(64), fill=rgba("#7a4cff", 230))
    d.ellipse(box((174, 148, 270, 244)), fill=SILVER)
    d.rounded_rectangle(box((130, 236, 318, 372)), radius=n(74), fill=SILVER)
    d.rounded_rectangle(box((130, 318, 318, 374)), radius=n(28), fill=CYAN)
    d.rounded_rectangle(box((130, 236, 318, 372)), radius=n(74), outline=rgba("#12051f", 70), width=n(5))


def draw_tools(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    line(d, [(222, 282), (334, 170)], rgba("#000000", 78), 40)
    line(d, [(218, 278), (330, 166)], SILVER, 32)
    d.ellipse(box((178, 272, 246, 340)), fill=SILVER)
    d.ellipse(box((196, 290, 228, 322)), fill=PLUM)
    d.pieslice(box((296, 116, 396, 216)), 42, 314, fill=SILVER)
    d.ellipse(box((316, 136, 376, 196)), fill=PLUM)
    line(d, [(248, 248), (302, 194)], CYAN, 12)


def draw_settings(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    for y, knob_x, color in ((184, 306, VIOLET), (256, 214, CYAN), (328, 276, PEACH)):
        d.rounded_rectangle(box((146, y - 8, 366, y + 8)), radius=n(8), fill=SILVER)
        d.ellipse(box((knob_x - 26, y - 26, knob_x + 26, y + 26)), fill=color)
        d.ellipse(box((knob_x - 12, y - 12, knob_x + 12, y + 12)), fill=rgba("#fff4dc", 66))


def draw_profile(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    d.ellipse(box((140, 124, 372, 356)), fill=SILVER)
    d.ellipse(box((172, 156, 340, 324)), fill=rgba("#2d3140", 255))
    d.ellipse(box((212, 180, 300, 268)), fill=CREAM)
    d.rounded_rectangle(box((186, 268, 326, 350)), radius=n(48), fill=CREAM)
    d.arc(box((140, 124, 372, 356)), 30, 116, fill=MAGENTA, width=n(16))
    d.arc(box((140, 124, 372, 356)), 204, 294, fill=CYAN, width=n(16))


def draw_links(img: Image.Image) -> None:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(box((142, 214, 292, 286)), radius=n(36), outline=SILVER, width=n(28))
    d.rounded_rectangle(box((220, 226, 370, 298)), radius=n(36), outline=SILVER, width=n(28))
    line(d, [(226, 256), (286, 256)], CYAN, 18)
    layer = layer.rotate(-28, resample=Image.Resampling.BICUBIC, center=(n(256), n(256)))
    img.alpha_composite(layer)
    d = ImageDraw.Draw(img)
    d.ellipse(box((232, 232, 280, 280)), fill=rgba("#7a4cff", 210))
    d.ellipse(box((246, 246, 266, 266)), fill=CYAN)


def draw_recycle_bin(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(box((176, 178, 336, 360)), radius=n(28), fill=SILVER)
    d.rounded_rectangle(box((154, 152, 358, 196)), radius=n(20), fill=SILVER)
    d.rounded_rectangle(box((214, 126, 298, 164)), radius=n(18), fill=VIOLET)
    for x in (212, 256, 300):
        d.rounded_rectangle(box((x - 8, 220, x + 8, 330)), radius=n(8), fill=rgba("#2d3140", 210))
    d.rounded_rectangle(box((176, 178, 336, 360)), radius=n(28), outline=rgba("#12051f", 78), width=n(5))
    d.rounded_rectangle(box((154, 152, 358, 196)), radius=n(20), outline=rgba("#12051f", 68), width=n(4))


def draw_fallback(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(box((142, 154, 370, 344)), radius=n(30), fill=SILVER)
    d.rounded_rectangle(box((142, 154, 370, 206)), radius=n(30), fill=SLATE)
    d.rounded_rectangle(box((166, 232, 242, 318)), radius=n(14), fill=CYAN)
    d.rounded_rectangle(box((264, 232, 342, 318)), radius=n(14), fill=rgba("#d8dbe7", 255))
    for x, color in ((176, CYAN), (214, MAGENTA), (252, VIOLET)):
        d.ellipse(box((x, 172, x + 18, 190)), fill=color)
    d.line(points([(256, 206), (256, 344)]), fill=rgba("#12051f", 72), width=n(4))
    d.rounded_rectangle(box((142, 154, 370, 344)), radius=n(30), outline=rgba("#12051f", 80), width=n(5))


def draw_os_settings(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(box((142, 154, 370, 292)), radius=n(18), fill=SILVER)
    d.rounded_rectangle(box((164, 178, 348, 266)), radius=n(10), fill=SLATE)
    d.polygon(points([(190, 246), (314, 196), (314, 226), (190, 276)]), fill=rgba("#fff4dc", 230))
    d.rounded_rectangle(box((228, 306, 284, 340)), radius=n(8), fill=SILVER)
    d.rounded_rectangle(box((202, 340, 310, 362)), radius=n(10), fill=SILVER)
    d.rounded_rectangle(box((188, 212, 304, 224)), radius=n(6), fill=CYAN)
    d.ellipse(box((300, 180, 336, 216)), fill=VIOLET)
    d.rounded_rectangle(box((142, 154, 370, 292)), radius=n(18), outline=rgba("#12051f", 76), width=n(5))


def draw_import(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(box((170, 158, 342, 270)), radius=n(20), outline=SILVER, width=n(24))
    d.rectangle(box((200, 182, 312, 286)), fill=PLUM)
    d.polygon(points([(256, 344), (178, 262), (228, 262), (228, 142), (284, 142), (284, 262), (334, 262)]), fill=CREAM)
    d.polygon(points([(256, 344), (210, 296), (302, 296)]), fill=CYAN)
    d.rounded_rectangle(box((204, 364, 308, 388)), radius=n(11), fill=VIOLET)
    d.rounded_rectangle(box((228, 142, 284, 262)), radius=n(12), outline=rgba("#12051f", 80), width=n(5))


def draw_classic_admin(img: Image.Image) -> None:
    d = ImageDraw.Draw(img)
    line(d, [(328, 154), (382, 154), (382, 358), (328, 358)], SILVER, 24)
    line(d, [(306, 256), (164, 256)], CREAM, 34)
    d.polygon(points([(162, 256), (244, 178), (244, 224), (330, 224), (330, 288), (244, 288), (244, 334)]), fill=CREAM)
    line(d, [(330, 224), (330, 288)], CYAN, 12)
    line(d, [(184, 256), (248, 196)], VIOLET, 12)
    line(d, [(184, 256), (248, 316)], MAGENTA, 12)


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
        oddify(img, key)
        icons[key] = finish(img)
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
    card = Image.new("RGBA", (1600, 1000), DEEP)

    def card_glow(xy: tuple[int, int, int, int], color, blur: int) -> None:
        layer = Image.new("RGBA", card.size, (0, 0, 0, 0))
        ImageDraw.Draw(layer).ellipse(xy, fill=color)
        card.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))

    card_glow((-160, -180, 980, 860), rgba("#64f4ff", 58), 70)
    card_glow((520, 320, 1780, 1180), rgba("#7a4cff", 52), 76)
    card_glow((740, -180, 1700, 650), rgba("#ff3d9a", 34), 82)
    floor = Image.new("RGBA", card.size, (0, 0, 0, 0))
    fd = ImageDraw.Draw(floor)
    fd.ellipse((80, 604, 1520, 910), fill=rgba("#fff4dc", 18))
    fd.ellipse((180, 680, 1420, 910), fill=rgba("#000000", 80))
    card.alpha_composite(floor.filter(ImageFilter.GaussianBlur(18)))

    placements = [
        ("dashboard", 210, 224, 286, -7),
        ("posts", 478, 148, 318, 6),
        ("pages", 772, 214, 286, -4),
        ("media", 1020, 132, 332, 7),
        ("plugins", 640, 470, 330, 0),
    ]
    for key, x, y, size, rotation in placements:
        icon = icons[key].resize((size, size), Image.Resampling.LANCZOS)
        if rotation:
            icon = icon.rotate(rotation, resample=Image.Resampling.BICUBIC, expand=True)
        shadow = Image.new("RGBA", icon.size, (0, 0, 0, 0))
        shadow.alpha_composite(icon)
        alpha = shadow.getchannel("A").filter(ImageFilter.GaussianBlur(20))
        shadow = Image.new("RGBA", icon.size, rgba("#000000", 112))
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
    print(f"generated {len(icons)} raster icons")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
