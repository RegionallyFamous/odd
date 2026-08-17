#!/usr/bin/env python3
"""Render the ODD marketing site brand assets.

Outputs:
  site/favicon-16.png       — small favicon fallback
  site/favicon-32.png       — classic favicon fallback
  site/apple-touch-icon.png — 180x180 iOS home-screen icon
  site/og-apps-for-openstation.png — 1200x630 Open Graph + Twitter share image

The canonical favicon.svg is hand-authored next to the PNGs; this script
makes sure the rasterized fallbacks agree with it and bakes a social card.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"

# Brand palette (matches site/styles.css)
HOT = (255, 79, 168, 255)
VIOLET = (157, 107, 255, 255)
DEEP = (90, 53, 214, 255)
CYAN = (112, 245, 255, 255)
CYAN_SOFT = (198, 251, 255, 255)
CYAN_DEEP = (30, 122, 201, 255)
GOLD = (255, 224, 138, 255)
MINT = (124, 247, 181, 255)
PINK_SOFT = (255, 122, 217, 255)
INK = (18, 5, 31, 255)
INK_DEEP = (7, 2, 16, 255)
BONE = (253, 250, 242, 255)
NIGHT = (9, 20, 37, 255)

FONT_BLACK = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FONT_REG = "/System/Library/Fonts/Supplemental/Arial.ttf"
FONT_MONO = "/System/Library/Fonts/SFNSMono.ttf"


def load_font(path: str, size: int) -> ImageFont.FreeTypeFont:
	try:
		return ImageFont.truetype(path, size=size)
	except OSError:
		return ImageFont.load_default()


def lerp(a, b, t):
	return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def vertical_gradient(size, top, bottom):
	w, h = size
	img = Image.new("RGBA", size, top)
	px = img.load()
	for y in range(h):
		t = y / max(1, h - 1)
		c = lerp(top, bottom, t)
		for x in range(w):
			px[x, y] = c
	return img


def soft_blob(canvas: Image.Image, cx: int, cy: int, radius: int, color, alpha: int, blur: int) -> None:
	"""Paint a blurred colored blob onto the canvas."""
	layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
	d = ImageDraw.Draw(layer)
	bbox = (cx - radius, cy - radius, cx + radius, cy + radius)
	d.ellipse(bbox, fill=(color[0], color[1], color[2], alpha))
	layer = layer.filter(ImageFilter.GaussianBlur(blur))
	canvas.alpha_composite(layer)


def round_rect(draw: ImageDraw.ImageDraw, bbox, radius: int, fill) -> None:
	draw.rounded_rectangle(bbox, radius=radius, fill=fill)


def draw_eye(canvas: Image.Image, cx: int, cy: int, size: int, shadow: bool = True) -> None:
	"""Draw the ODD eye tile centered at (cx, cy) with given bounding size."""
	half = size // 2
	bbox = (cx - half, cy - half, cx + half, cy + half)
	# background rounded square w/ vertical gradient pink→violet→deep
	tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
	grad = vertical_gradient((size, size), HOT, DEEP)
	mask = Image.new("L", (size, size), 0)
	ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * 0.22), fill=255)
	tile.paste(grad, (0, 0), mask)

	# Blend violet over the middle to lift the gradient
	vlayer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
	ImageDraw.Draw(vlayer).rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * 0.22), fill=(VIOLET[0], VIOLET[1], VIOLET[2], 140))
	g2 = vertical_gradient((size, size), (0, 0, 0, 0), (0, 0, 0, 255))
	vlayer.putalpha(Image.eval(g2.split()[-1], lambda a: int(a * 0.5)))
	tile.alpha_composite(vlayer)

	if shadow:
		sh = Image.new("RGBA", (size + size // 3, size + size // 3), (0, 0, 0, 0))
		ImageDraw.Draw(sh).rounded_rectangle(
			(size // 6, size // 6, size + size // 6, size + size // 6),
			radius=int(size * 0.22),
			fill=(255, 79, 168, 90),
		)
		sh = sh.filter(ImageFilter.GaussianBlur(size * 0.08))
		canvas.alpha_composite(sh, dest=(cx - half - size // 6, cy - half))

	canvas.alpha_composite(tile, dest=(cx - half, cy - half))

	# Eye shell (bone-white circle with dark stroke)
	shell_r = int(size * 0.32)
	stroke = max(2, int(size * 0.05))
	d = ImageDraw.Draw(canvas)
	d.ellipse(
		(cx - shell_r, cy - shell_r, cx + shell_r, cy + shell_r),
		fill=BONE,
		outline=(19, 8, 38, 255),
		width=stroke,
	)

	# Iris — cyan radial gradient, rendered as a stack of concentric circles
	iris_r = int(size * 0.21)
	for i in range(iris_r, 0, -1):
		t = 1 - i / iris_r
		c = lerp(CYAN_DEEP, CYAN_SOFT, t * t)
		ox = int((0.15 * iris_r) * (1 - t))
		oy = int((0.18 * iris_r) * (1 - t))
		d.ellipse(
			(cx - i + ox, cy - i + oy, cx + i + ox, cy + i + oy),
			fill=c,
		)

	# Pupil
	pup_r = int(size * 0.095)
	d.ellipse((cx - pup_r, cy - pup_r, cx + pup_r, cy + pup_r), fill=NIGHT)

	# Highlight
	hl_r = max(1, int(size * 0.035))
	hl_x = cx - int(size * 0.045)
	hl_y = cy - int(size * 0.055)
	d.ellipse((hl_x - hl_r, hl_y - hl_r, hl_x + hl_r, hl_y + hl_r), fill=(255, 255, 255, 255))


# ---------- Favicons ----------


def render_favicon(size: int) -> Image.Image:
	base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
	draw_eye(base, size // 2, size // 2, size, shadow=False)
	return base


def write_favicons() -> None:
	for px in (16, 32):
		img = render_favicon(px)
		img.save(SITE / f"favicon-{px}.png", "PNG", optimize=True)
		print(f"wrote site/favicon-{px}.png")
	apple = render_favicon(180)
	apple.save(SITE / "apple-touch-icon.png", "PNG", optimize=True)
	print("wrote site/apple-touch-icon.png")


# ---------- OG card ----------


def draw_confetti(canvas: Image.Image) -> None:
	"""Scatter Memphis-style decorations on the OG card."""
	d = ImageDraw.Draw(canvas)

	# Squiggle top-left
	layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
	ld = ImageDraw.Draw(layer)
	cx, cy = 120, 96
	for i in range(0, 220, 4):
		x = cx + i
		y = cy + int(math.sin(i / 22.0) * 22)
		ld.ellipse((x - 6, y - 6, x + 6, y + 6), fill=CYAN)
	canvas.alpha_composite(layer)

	# Star top-right
	def star(cx, cy, outer, inner, fill, rot=0.0):
		points = []
		for i in range(10):
			r = outer if i % 2 == 0 else inner
			a = rot + i * math.pi / 5 - math.pi / 2
			points.append((cx + r * math.cos(a), cy + r * math.sin(a)))
		d.polygon(points, fill=fill)

	star(1060, 110, 56, 26, GOLD, rot=0.15)

	# Dashed ring (gold) top-left-center
	dashed_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
	dd = ImageDraw.Draw(dashed_layer)
	ring_cx, ring_cy, ring_r = 540, 70, 38
	steps = 18
	for i in range(steps):
		if i % 2:
			continue
		a0 = i * 2 * math.pi / steps
		a1 = (i + 1) * 2 * math.pi / steps
		for t in [j / 30 for j in range(30)]:
			ang = a0 + (a1 - a0) * t
			x = ring_cx + ring_r * math.cos(ang)
			y = ring_cy + ring_r * math.sin(ang)
			dd.ellipse((x - 4, y - 4, x + 4, y + 4), fill=GOLD)
	canvas.alpha_composite(dashed_layer)

	# Zigzag bottom-left
	zig_points = []
	zx, zy = 60, 540
	for i in range(6):
		zig_points.append((zx + i * 34, zy + (0 if i % 2 == 0 else -40)))
	for i in range(len(zig_points) - 1):
		d.line([zig_points[i], zig_points[i + 1]], fill=MINT, width=10)

	# Bullseye bottom-right
	bx, by = 1120, 540
	for r, c in ((58, HOT), (42, BONE), (28, HOT), (14, BONE)):
		d.ellipse((bx - r, by - r, bx + r, by + r), fill=c)

	# Plus sign mid-right
	px, py = 980, 300
	d.rounded_rectangle((px - 6, py - 22, px + 6, py + 22), radius=3, fill=PINK_SOFT)
	d.rounded_rectangle((px - 22, py - 6, px + 22, py + 6), radius=3, fill=PINK_SOFT)

	# Triangle mid-top between eye and text
	tx, ty = 430, 100
	d.polygon([(tx, ty - 28), (tx + 26, ty + 18), (tx - 26, ty + 18)], outline=GOLD, width=6)

	# Dot grid lower-left (tucked under the eye)
	for ix in range(3):
		for iy in range(3):
			d.ellipse((72 + ix * 18, 568 + iy * 18, 72 + ix * 18 + 9, 568 + iy * 18 + 9), fill=VIOLET)


def render_og() -> Image.Image:
	W, H = 1200, 630
	canvas = vertical_gradient((W, H), INK, INK_DEEP)

	# Atmospheric blobs (softly blurred) — pink TL, gold-violet TR, cyan BL
	soft_blob(canvas, 140, 180, 220, HOT, alpha=130, blur=110)
	soft_blob(canvas, 1080, 120, 240, VIOLET, alpha=140, blur=120)
	soft_blob(canvas, 260, 520, 200, CYAN, alpha=110, blur=100)
	soft_blob(canvas, 900, 540, 180, GOLD, alpha=90, blur=110)

	# Confetti decorations
	draw_confetti(canvas)

	# Eye glyph left
	draw_eye(canvas, cx=230, cy=330, size=360, shadow=True)

	# Text block right
	d = ImageDraw.Draw(canvas)
	text_x = 480
	kicker_font = load_font(FONT_BLACK, 24)
	wordmark_font = load_font(FONT_BLACK, 168)
	head_font = load_font(FONT_BLACK, 40)
	lede_font = load_font(FONT_BOLD, 26)
	url_font = load_font(FONT_BOLD, 24)

	# Kicker
	kicker_text = "OPENSTATION"
	d.text((text_x, 158), kicker_text, fill=CYAN, font=kicker_font)
	kbbox = d.textbbox((text_x, 158), kicker_text, font=kicker_font)
	d.rounded_rectangle(
		(kbbox[2] + 14, kbbox[1] + 8, kbbox[2] + 60, kbbox[3] - 2),
		radius=6,
		fill=CYAN,
	)

	# Wordmark (ODD) — huge, white
	d.text((text_x - 4, 184), "ODD", fill=BONE, font=wordmark_font)
	wm_bbox = d.textbbox((text_x - 4, 184), "ODD", font=wordmark_font)
	dot_cx = wm_bbox[2] + 22
	dot_cy = wm_bbox[3] - 14
	d.ellipse((dot_cx - 14, dot_cy - 14, dot_cx + 14, dot_cy + 14), fill=HOT)

	# Product line (2 lines, fits comfortably)
	head_y = 380
	head_line_h = 48
	d.text((text_x, head_y), "Apps for", fill=GOLD, font=head_font)
	d.text((text_x, head_y + head_line_h), "OpenStation.", fill=GOLD, font=head_font)

	# Lede
	lede_y = head_y + head_line_h * 2 + 16
	d.text((text_x, lede_y), "Useful tools. Playful experiments.", fill=BONE, font=lede_font)
	d.text((text_x, lede_y + 32), "ODD Notes is only the beginning.", fill=BONE, font=lede_font)

	# URL
	d.text((text_x, H - 56), "odd.regionallyfamous.com", fill=CYAN, font=url_font)

	return canvas


def write_og() -> None:
	og = render_og()
	filename = "og-apps-for-openstation.png"
	og.save(SITE / filename, "PNG", optimize=True)
	print(f"wrote site/{filename}")


def main() -> None:
	write_favicons()
	write_og()


if __name__ == "__main__":
	main()
