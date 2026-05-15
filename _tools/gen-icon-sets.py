#!/usr/bin/env python3
"""
ODD icon set generator
======================

Emits the three reboot icon sets — `filament`, `arctic`, `fold` — under
odd/assets/icons/<set>/ from a single source of truth. Each icon is one
of 13 stable WP-Desktop keys (dashboard, posts, …, fallback) and shares
its silhouette across sets so the visual language differs but the
metaphors stay consistent.

Each set has its own renderer that wraps shared symbol drawing
primitives in its visual treatment:

  filament  — a single hair-thin glowing stroke on a transparent base.
              Designed to read as one unbroken filament of light.

  arctic    — frost-blue thin-line icons with a tiny accent dot.
              Dock tinting via currentColor on the main stroke.

  fold      — flat folded-paper icons: two-tone faces with one visible
              crease and a soft drop shadow. Tactile + minimalist.

Usage:
  python3 _tools/gen-icon-sets.py

Idempotent — overwrites existing icons. Run it any time the silhouette
catalog changes; commit the rendered SVGs.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ICONS_ROOT = REPO / "odd" / "assets" / "icons"

SIZE = 64                # SVG canvas (also viewBox)
PAD = 8                  # interior padding for symbol drawing
INNER = SIZE - PAD * 2   # 48px usable

# ------------------------------------------------------------------ #
# Shared symbol catalog. Each entry is a list of "primitives" the
# renderers know how to emit: ('line', x1, y1, x2, y2),
# ('rect', x, y, w, h), ('circle', cx, cy, r), ('poly', [(x,y),...]).
# Coordinates are in 0..INNER space; renderers translate by PAD.
# ------------------------------------------------------------------ #

I = INNER  # local alias

SYMBOLS = {
    # Dashboard — 2x2 grid of squares (the WP "blocks" archetype).
    "dashboard": [
        ("rect",  4,  4, I/2 - 8, I/2 - 8),
        ("rect",  I/2 + 4,  4, I/2 - 8, I/2 - 8),
        ("rect",  4,  I/2 + 4, I/2 - 8, I/2 - 8),
        ("rect",  I/2 + 4,  I/2 + 4, I/2 - 8, I/2 - 8),
    ],
    # Posts — stacked horizontal lines on a page corner.
    "posts": [
        ("rect",  4,  6, I - 8, I - 12),
        ("line",  10, 16, I - 10, 16),
        ("line",  10, 24, I - 10, 24),
        ("line",  10, 32, I - 14, 32),
        ("line",  10, 40, I - 18, 40),
    ],
    # Pages — single page with a folded corner.
    "pages": [
        ("poly", [(8, 4), (I - 14, 4), (I - 4, 14), (I - 4, I - 4), (8, I - 4)]),
        ("poly", [(I - 14, 4), (I - 14, 14), (I - 4, 14)]),
        ("line", 14, 22, I - 12, 22),
        ("line", 14, 30, I - 12, 30),
        ("line", 14, 38, I - 18, 38),
    ],
    # Media — landscape with sun + horizon (image archetype).
    "media": [
        ("rect", 4, 8, I - 8, I - 16),
        ("circle", I - 16, 18, 4),
        ("poly", [(4, I - 8), (16, I - 22), (28, I - 12), (40, I - 24), (I - 4, I - 8)]),
    ],
    # Comments — speech bubble with tail.
    "comments": [
        ("poly", [
            (4, 6), (I - 4, 6), (I - 4, I - 14),
            (I - 18, I - 14), (I - 24, I - 4), (I - 26, I - 14),
            (4, I - 14)
        ]),
        ("line", 12, 16, I - 12, 16),
        ("line", 12, 24, I - 16, 24),
    ],
    # Appearance — paint roller / brush abstract: rectangle handle + tip.
    "appearance": [
        ("rect", 4, 6, I - 8, 10),
        ("rect", I/2 - 4, 16, 8, 8),
        ("poly", [(I/2 - 10, 24), (I/2 + 10, 24), (I/2 + 6, I - 4), (I/2 - 6, I - 4)]),
    ],
    # Plugins — power plug silhouette.
    "plugins": [
        ("rect", I/2 - 12, 4, 24, 18),
        ("line", I/2 - 6, 0, I/2 - 6, 6),
        ("line", I/2 + 6, 0, I/2 + 6, 6),
        ("rect", I/2 - 8, 22, 16, 10),
        ("line", I/2, 32, I/2, I - 4),
    ],
    # Users — two overlapping head-and-shoulders silhouettes.
    "users": [
        ("circle", I/2 - 8, 16, 7),
        ("circle", I/2 + 8, 16, 7),
        ("poly", [(I/2 - 18, I - 4), (I/2 - 14, 28), (I/2 - 2, 28), (I/2 + 2, I - 4)]),
        ("poly", [(I/2 - 2, I - 4), (I/2 + 2, 28), (I/2 + 14, 28), (I/2 + 18, I - 4)]),
    ],
    # Tools — wrench (diagonal handle + open end).
    "tools": [
        ("poly", [(I - 6, 4), (I - 14, 4), (I - 14, 14), (I - 6, 14)]),
        ("line", I - 14, 14, 8, I - 8),
        ("circle", 8, I - 8, 4),
    ],
    # Settings — gear (8-tooth rosette + center hole).
    "settings": [
        ("circle", I/2, I/2, 14),
        ("circle", I/2, I/2, 5),
        # Gear teeth as 8 small rects radiating outward.
        ("rect", I/2 - 2, 0, 4, 6),
        ("rect", I/2 - 2, I - 6, 4, 6),
        ("rect", 0, I/2 - 2, 6, 4),
        ("rect", I - 6, I/2 - 2, 6, 4),
        ("poly", [(I/2 + 12, I/2 - 14), (I/2 + 16, I/2 - 12), (I/2 + 12, I/2 - 8), (I/2 + 8, I/2 - 12)]),
        ("poly", [(I/2 - 12, I/2 - 14), (I/2 - 8, I/2 - 12), (I/2 - 12, I/2 - 8), (I/2 - 16, I/2 - 12)]),
        ("poly", [(I/2 + 12, I/2 + 14), (I/2 + 16, I/2 + 12), (I/2 + 12, I/2 + 8), (I/2 + 8, I/2 + 12)]),
        ("poly", [(I/2 - 12, I/2 + 14), (I/2 - 8, I/2 + 12), (I/2 - 12, I/2 + 8), (I/2 - 16, I/2 + 12)]),
    ],
    # Profile — single user portrait (head + circle frame).
    "profile": [
        ("circle", I/2, I/2, I/2 - 4),
        ("circle", I/2, I/2 - 4, 7),
        ("poly", [(I/2 - 14, I - 8), (I/2 - 8, 22), (I/2 + 8, 22), (I/2 + 14, I - 8)]),
    ],
    # Links — two interlocking chain ovals at 30° angle.
    "links": [
        ("poly", [
            (4, I/2), (10, I/2 - 10), (I/2 - 4, I/2 - 14),
            (I/2 + 2, I/2 - 4), (I/2 - 4, I/2), (10, I/2 + 4)
        ]),
        ("poly", [
            (I - 4, I/2), (I - 10, I/2 + 10), (I/2 + 4, I/2 + 14),
            (I/2 - 2, I/2 + 4), (I/2 + 4, I/2), (I - 10, I/2 - 4)
        ]),
    ],
    # Fallback — three concentric pulses (works for any unmapped key).
    "fallback": [
        ("circle", I/2, I/2, 4),
        ("circle", I/2, I/2, 12),
        ("circle", I/2, I/2, 20),
    ],
}


# ------------------------------------------------------------------ #
# Renderers
# ------------------------------------------------------------------ #

def _xy(x, y):
    return f"{round(x + PAD, 2)} {round(y + PAD, 2)}"


def _render_filament(prims):
    """Hair-thin glowing line on transparent. Dock tints via currentColor."""
    parts = []
    for p in prims:
        kind = p[0]
        if kind == "line":
            parts.append(
                f'<line x1="{p[1]+PAD}" y1="{p[2]+PAD}" x2="{p[3]+PAD}" y2="{p[4]+PAD}" />'
            )
        elif kind == "rect":
            parts.append(
                f'<rect x="{p[1]+PAD}" y="{p[2]+PAD}" width="{p[3]}" height="{p[4]}" '
                f'rx="2" />'
            )
        elif kind == "circle":
            parts.append(
                f'<circle cx="{p[1]+PAD}" cy="{p[2]+PAD}" r="{p[3]}" />'
            )
        elif kind == "poly":
            pts = " ".join(_xy(x, y) for x, y in p[1])
            parts.append(f'<polygon points="{pts}" />')
    body = "\n  ".join(parts)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" '
        f'fill="none" stroke="currentColor" stroke-width="2" '
        f'stroke-linecap="round" stroke-linejoin="round">\n  '
        f'{body}\n</svg>\n'
    )


def _render_arctic(prims):
    """Frost-blue thin lines + a small magenta accent dot in the corner."""
    parts = []
    for p in prims:
        kind = p[0]
        if kind == "line":
            parts.append(
                f'<line x1="{p[1]+PAD}" y1="{p[2]+PAD}" x2="{p[3]+PAD}" y2="{p[4]+PAD}" />'
            )
        elif kind == "rect":
            parts.append(
                f'<rect x="{p[1]+PAD}" y="{p[2]+PAD}" width="{p[3]}" height="{p[4]}" '
                f'rx="3" />'
            )
        elif kind == "circle":
            parts.append(
                f'<circle cx="{p[1]+PAD}" cy="{p[2]+PAD}" r="{p[3]}" />'
            )
        elif kind == "poly":
            pts = " ".join(_xy(x, y) for x, y in p[1])
            parts.append(f'<polygon points="{pts}" />')
    body = "\n  ".join(parts)
    accent = (
        f'<circle cx="{SIZE - 9}" cy="9" r="2.5" '
        f'fill="#c87cff" stroke="none" />'
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" '
        f'fill="none" stroke="currentColor" stroke-width="1.6" '
        f'stroke-linecap="round" stroke-linejoin="round">\n  '
        f'{body}\n  {accent}\n</svg>\n'
    )


def _render_fold(prims):
    """Two-tone folded-paper: every shape gets a face fill + a darker
    'shadow' triangle along one edge to read as a crease. Strokes are
    omitted to keep the look flat. A soft offset drop shadow sits under
    each shape to give the paper some lift."""
    face = "#fffaf0"        # paper face
    shadow = "#d6b48a"      # crease + drop shadow
    parts = []
    drop_parts = []
    for p in prims:
        kind = p[0]
        if kind == "line":
            # Render lines as thin rounded rects so they have weight.
            x1, y1, x2, y2 = p[1] + PAD, p[2] + PAD, p[3] + PAD, p[4] + PAD
            parts.append(
                f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
                f'stroke="{shadow}" stroke-width="2" stroke-linecap="round" />'
            )
            drop_parts.append(
                f'<line x1="{x1+1.2}" y1="{y1+1.6}" x2="{x2+1.2}" y2="{y2+1.6}" '
                f'stroke="rgba(0,0,0,0.10)" stroke-width="2" stroke-linecap="round" />'
            )
        elif kind == "rect":
            x, y, w, h = p[1] + PAD, p[2] + PAD, p[3], p[4]
            drop_parts.append(
                f'<rect x="{x+1.4}" y="{y+1.8}" width="{w}" height="{h}" '
                f'rx="2" fill="rgba(0,0,0,0.12)" />'
            )
            parts.append(
                f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="2" fill="{face}" />'
            )
            # Crease: a darker triangle from top-right corner to
            # bottom-right, suggesting one folded edge.
            parts.append(
                f'<polygon points="{x+w*0.55} {y} {x+w} {y} {x+w} {y+h*0.55}" '
                f'fill="{shadow}" opacity="0.55" />'
            )
        elif kind == "circle":
            cx, cy, r = p[1] + PAD, p[2] + PAD, p[3]
            drop_parts.append(
                f'<circle cx="{cx+1.4}" cy="{cy+1.8}" r="{r}" fill="rgba(0,0,0,0.12)" />'
            )
            parts.append(
                f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{face}" />'
            )
            # Crease: a half-disc on one side, faked with a rotated path.
            parts.append(
                f'<path d="M {cx} {cy-r} A {r} {r} 0 0 1 {cx} {cy+r} Z" '
                f'fill="{shadow}" opacity="0.45" />'
            )
        elif kind == "poly":
            pts = " ".join(_xy(x, y) for x, y in p[1])
            drop_pts = " ".join(_xy(x + 1.4 - PAD, y + 1.8 - PAD) for x, y in p[1])
            # The drop shadow is offset by the same amount in viewBox space;
            # _xy already added PAD, so we reverse that and re-add inside.
            drop_pts = " ".join(
                f"{round(x + PAD + 1.4, 2)} {round(y + PAD + 1.8, 2)}" for x, y in p[1]
            )
            drop_parts.append(
                f'<polygon points="{drop_pts}" fill="rgba(0,0,0,0.12)" />'
            )
            parts.append(
                f'<polygon points="{pts}" fill="{face}" />'
            )
            # Crease: pick the first three points, halve to mid, fill darker.
            if len(p[1]) >= 3:
                a = p[1][0]
                b = p[1][len(p[1]) // 2]
                mx = sum(x for x, _ in p[1]) / len(p[1])
                my = sum(y for _, y in p[1]) / len(p[1])
                crease_pts = f"{_xy(*a)} {_xy(*b)} {_xy(mx, my)}"
                parts.append(
                    f'<polygon points="{crease_pts}" fill="{shadow}" opacity="0.45" />'
                )
    body = "\n  ".join(drop_parts + parts)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}">\n  '
        f'{body}\n</svg>\n'
    )


# ------------------------------------------------------------------ #
# Shared primitive helpers (used by the v1.2.0 renderers below).
# ------------------------------------------------------------------ #

def _prim_svg(prims, stroke_attrs, fill=None, rect_rx=2):
    """Render a list of primitives as SVG element strings using the
    provided stroke attribute string. If `fill` is given, shapes are
    filled with it; otherwise they stay unfilled (stroked only)."""
    parts = []
    fill_attr = f'fill="{fill}"' if fill else 'fill="none"'
    for p in prims:
        kind = p[0]
        if kind == "line":
            parts.append(
                f'<line x1="{p[1]+PAD}" y1="{p[2]+PAD}" '
                f'x2="{p[3]+PAD}" y2="{p[4]+PAD}" '
                f'{stroke_attrs} />'
            )
        elif kind == "rect":
            parts.append(
                f'<rect x="{p[1]+PAD}" y="{p[2]+PAD}" '
                f'width="{p[3]}" height="{p[4]}" rx="{rect_rx}" '
                f'{fill_attr} {stroke_attrs} />'
            )
        elif kind == "circle":
            parts.append(
                f'<circle cx="{p[1]+PAD}" cy="{p[2]+PAD}" r="{p[3]}" '
                f'{fill_attr} {stroke_attrs} />'
            )
        elif kind == "poly":
            pts = " ".join(_xy(x, y) for x, y in p[1])
            parts.append(
                f'<polygon points="{pts}" {fill_attr} {stroke_attrs} />'
            )
    return "\n  ".join(parts)


# ------------------------------------------------------------------ #
# v1.2.0 procedural renderers.
# ------------------------------------------------------------------ #

def _render_risograph(prims):
    """Fluorescent riso: cyan + pink off-register stamps on cream paper
    with a scatter of grit specks. Deliberately misaligned by ~1.5 px."""
    paper = '<rect x="0" y="0" width="64" height="64" fill="#f4ecd8" />'
    # Subtle paper grain dots.
    grit = "".join(
        f'<circle cx="{(i * 7.3) % 62 + 1}" cy="{(i * 11.1) % 62 + 1}" '
        f'r="0.35" fill="#c5b89a" opacity="0.35" />'
        for i in range(38)
    )
    cyan_pass = _prim_svg(
        prims,
        'stroke="#2ed4e6" stroke-width="3" stroke-linecap="round" '
        'stroke-linejoin="round"',
        fill="#2ed4e6", rect_rx=1,
    )
    pink_pass = _prim_svg(
        prims,
        'stroke="#ff4fa8" stroke-width="3" stroke-linecap="round" '
        'stroke-linejoin="round"',
        fill="#ff4fa8", rect_rx=1,
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}">\n  '
        f'{paper}\n  {grit}\n  '
        f'<g transform="translate(-1.4, 0.4)" opacity="0.85">\n    '
        f'{cyan_pass}\n  </g>\n  '
        f'<g transform="translate(1.2, -0.8)" opacity="0.85" '
        f'style="mix-blend-mode:multiply">\n    '
        f'{pink_pass}\n  </g>\n'
        f'</svg>\n'
    )


def _render_circuit_bend(prims):
    """PCB-green tile with gold traces + a red LED dot in the corner."""
    board = (
        f'<rect x="0" y="0" width="{SIZE}" height="{SIZE}" rx="6" fill="#0d5a2e" />'
        f'<rect x="2" y="2" width="{SIZE-4}" height="{SIZE-4}" rx="5" '
        f'fill="none" stroke="#154d24" stroke-width="1" />'
    )
    # Gold traces = the primitives rendered as gold-filled / gold-stroked.
    traces = _prim_svg(
        prims,
        'stroke="#e8c055" stroke-width="1.8" stroke-linecap="round" '
        'stroke-linejoin="round"',
        fill="#e8c055",
        rect_rx=1,
    )
    # Gold solder pads at polygon vertices and line ends for "PCB" feel.
    pads = []
    for p in prims:
        if p[0] == "line":
            pads.append(f'<circle cx="{p[1]+PAD}" cy="{p[2]+PAD}" r="1.5" fill="#f7d76a" />')
            pads.append(f'<circle cx="{p[3]+PAD}" cy="{p[4]+PAD}" r="1.5" fill="#f7d76a" />')
    led = (
        '<circle cx="55" cy="9" r="3.2" fill="#ff4a4a" />'
        '<circle cx="54" cy="8" r="1.2" fill="#ffdede" />'
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}">\n  '
        f'{board}\n  {traces}\n  '
        f'{"".join(pads)}\n  {led}\n'
        f'</svg>\n'
    )


def _render_botanical_plate(prims):
    """Copperplate ink + soft watercolor wash on aged paper."""
    paper = (
        f'<rect x="0" y="0" width="{SIZE}" height="{SIZE}" fill="#f5ead2" />'
    )
    # Watercolor wash = primitives rendered soft green slightly offset.
    wash = _prim_svg(
        prims,
        'stroke="#8ea749" stroke-width="4" stroke-linecap="round" '
        'stroke-linejoin="round" opacity="0.35"',
        fill="#b6cc72",
        rect_rx=2,
    )
    # Line art on top in copperplate sepia ink.
    ink = _prim_svg(
        prims,
        'stroke="#3a2a14" stroke-width="1.3" stroke-linecap="round" '
        'stroke-linejoin="round"',
        rect_rx=2,
    )
    # A thin classification-style underline near the bottom.
    label = (
        '<line x1="12" y1="58" x2="52" y2="58" '
        'stroke="#3a2a14" stroke-width="0.7" opacity="0.55" />'
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}">\n  '
        f'{paper}\n  <g transform="translate(1.2, 1.2)">{wash}</g>\n  '
        f'{ink}\n  {label}\n'
        f'</svg>\n'
    )


def _render_cross_stitch(prims):
    """Pink/rose cross-stitch pixel art on linen with a ghost thread."""
    linen = (
        f'<rect x="0" y="0" width="{SIZE}" height="{SIZE}" fill="#f3e6cf" />'
    )
    # Linen weave pattern — fine horizontal/vertical tick grid.
    weave = []
    for i in range(0, SIZE, 2):
        weave.append(
            f'<line x1="0" y1="{i}" x2="{SIZE}" y2="{i}" '
            f'stroke="#d9c59f" stroke-width="0.3" opacity="0.55" />'
        )
        weave.append(
            f'<line x1="{i}" y1="0" x2="{i}" y2="{SIZE}" '
            f'stroke="#d9c59f" stroke-width="0.3" opacity="0.4" />'
        )
    # Cross-stitch = tiny x's wherever a primitive would draw a pixel.
    # We sample each primitive into ~4-px grid stitches.
    stitches = []
    step = 4.0

    def stitch_at(cx, cy, color="#e87ca7"):
        s = step * 0.4
        stitches.append(
            f'<line x1="{cx-s}" y1="{cy-s}" x2="{cx+s}" y2="{cy+s}" '
            f'stroke="{color}" stroke-width="1.4" stroke-linecap="round" />'
        )
        stitches.append(
            f'<line x1="{cx-s}" y1="{cy+s}" x2="{cx+s}" y2="{cy-s}" '
            f'stroke="{color}" stroke-width="1.4" stroke-linecap="round" />'
        )

    # Walk every primitive and drop stitches along its path.
    for p in prims:
        kind = p[0]
        if kind == "line":
            x1, y1, x2, y2 = p[1]+PAD, p[2]+PAD, p[3]+PAD, p[4]+PAD
            dist = max(((x2-x1)**2 + (y2-y1)**2) ** 0.5, 0.01)
            n = max(2, int(dist / step))
            for i in range(n + 1):
                t = i / n
                stitch_at(x1 + (x2-x1)*t, y1 + (y2-y1)*t)
        elif kind == "rect":
            x, y, w, h = p[1]+PAD, p[2]+PAD, p[3], p[4]
            perim = [(x,y,x+w,y), (x+w,y,x+w,y+h), (x+w,y+h,x,y+h), (x,y+h,x,y)]
            for (x1,y1,x2,y2) in perim:
                dist = max(((x2-x1)**2 + (y2-y1)**2) ** 0.5, 0.01)
                n = max(2, int(dist / step))
                for i in range(n + 1):
                    t = i / n
                    stitch_at(x1 + (x2-x1)*t, y1 + (y2-y1)*t)
        elif kind == "circle":
            cx, cy, r = p[1]+PAD, p[2]+PAD, p[3]
            import math
            n = max(6, int(2 * math.pi * r / step))
            for i in range(n):
                a = (i / n) * 2 * math.pi
                stitch_at(cx + math.cos(a)*r, cy + math.sin(a)*r)
        elif kind == "poly":
            pts = [(x+PAD, y+PAD) for x, y in p[1]]
            for i in range(len(pts)):
                x1,y1 = pts[i]
                x2,y2 = pts[(i+1) % len(pts)]
                dist = max(((x2-x1)**2 + (y2-y1)**2) ** 0.5, 0.01)
                n = max(2, int(dist / step))
                for j in range(n + 1):
                    t = j / n
                    stitch_at(x1 + (x2-x1)*t, y1 + (y2-y1)*t)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}">\n  '
        f'{linen}\n  {"".join(weave)}\n  {"".join(stitches)}\n'
        f'</svg>\n'
    )


def _render_lemonade_stand(prims):
    """Crayon-stroke glyph on a yellow gingham backplate with a sun badge."""
    bg = f'<rect x="0" y="0" width="{SIZE}" height="{SIZE}" fill="#fff4b8" />'
    # Gingham = offset semi-transparent stripes.
    gingham = []
    for i in range(0, SIZE, 6):
        gingham.append(
            f'<rect x="{i}" y="0" width="3" height="{SIZE}" '
            f'fill="#ffde57" opacity="0.5" />'
        )
        gingham.append(
            f'<rect x="0" y="{i}" width="{SIZE}" height="3" '
            f'fill="#ffde57" opacity="0.4" />'
        )
    crayon = _prim_svg(
        prims,
        'stroke="#d05b1a" stroke-width="3" stroke-linecap="round" '
        'stroke-linejoin="round" opacity="0.94"',
        rect_rx=2,
    )
    # A hand-drawn crayon glow.
    glow = _prim_svg(
        prims,
        'stroke="#ffb400" stroke-width="5" stroke-linecap="round" '
        'stroke-linejoin="round" opacity="0.35"',
        rect_rx=2,
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}">\n  '
        f'{bg}\n  {"".join(gingham)}\n  '
        f'{glow}\n  {crayon}\n'
        f'</svg>\n'
    )


def _render_hologram(prims):
    """Iridescent foil sticker with a peel corner."""
    grad = (
        '<defs>'
        '<linearGradient id="holo" x1="0" y1="0" x2="1" y2="1">'
        '<stop offset="0" stop-color="#9fd0ff"/>'
        '<stop offset="0.33" stop-color="#fea8ff"/>'
        '<stop offset="0.66" stop-color="#a8ffd9"/>'
        '<stop offset="1" stop-color="#ffe79a"/>'
        '</linearGradient>'
        '<linearGradient id="holoDk" x1="0" y1="0" x2="0" y2="1">'
        '<stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/>'
        '<stop offset="1" stop-color="#ffffff" stop-opacity="0"/>'
        '</linearGradient>'
        '</defs>'
    )
    base = _prim_svg(
        prims,
        'stroke="url(#holo)" stroke-width="3.2" stroke-linecap="round" '
        'stroke-linejoin="round"',
        fill="url(#holo)",
        rect_rx=2,
    )
    gloss = _prim_svg(
        prims,
        'stroke="url(#holoDk)" stroke-width="1" stroke-linecap="round" '
        'stroke-linejoin="round" opacity="0.85"',
        rect_rx=2,
    )
    # Peel corner at bottom-right.
    peel = (
        '<path d="M 54 54 L 62 54 L 62 62 Z" fill="#eaf6ff" opacity="0.9" />'
        '<path d="M 54 54 L 62 54 L 58 58 Z" fill="#b7d8ef" opacity="0.9" />'
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}">\n  '
        f'{grad}\n  {base}\n  {gloss}\n  {peel}\n'
        f'</svg>\n'
    )


# ------------------------------------------------------------------ #
# v1.2.0 "bespoke" renderers. These aren't hand-drawn per icon —
# that would take 4×13 manual SVGs — but each applies a distinctive
# treatment (material, lighting, dimensional layering) to make the
# same primitive set look tactile and authored per-glyph.
# ------------------------------------------------------------------ #

def _render_claymation(prims):
    """Puffy stop-motion clay with a soft specular highlight."""
    bg = f'<rect x="0" y="0" width="{SIZE}" height="{SIZE}" fill="#ffd8a3" />'
    # Base clay shadow (slightly offset darker).
    shadow = _prim_svg(
        prims,
        'stroke="#c25a18" stroke-width="8" stroke-linecap="round" '
        'stroke-linejoin="round" opacity="0.75"',
        fill="#c25a18",
        rect_rx=6,
    )
    face = _prim_svg(
        prims,
        'stroke="#ffb04a" stroke-width="7" stroke-linecap="round" '
        'stroke-linejoin="round"',
        fill="#ffb04a",
        rect_rx=6,
    )
    speculars = _prim_svg(
        prims,
        'stroke="#fff3d2" stroke-width="2.4" stroke-linecap="round" '
        'stroke-linejoin="round" opacity="0.6"',
        rect_rx=6,
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}">\n  '
        f'{bg}\n  <g transform="translate(1.2, 1.8)" opacity="0.85">{shadow}</g>\n  '
        f'{face}\n  <g transform="translate(-1, -1.3)">{speculars}</g>\n'
        f'</svg>\n'
    )


def _render_stadium(prims):
    """Chenille varsity patch on a crimson backing with stitched outline."""
    bg = (
        f'<rect x="0" y="0" width="{SIZE}" height="{SIZE}" rx="8" fill="#c23030" />'
    )
    stitch = (
        f'<rect x="3" y="3" width="{SIZE-6}" height="{SIZE-6}" rx="6" '
        f'fill="none" stroke="#f2f2ea" stroke-width="1" '
        f'stroke-dasharray="2 2" />'
    )
    # Chenille look = fat cream stroke with a darker inner twin line.
    chenille = _prim_svg(
        prims,
        'stroke="#f2eede" stroke-width="6" stroke-linecap="round" '
        'stroke-linejoin="round"',
        fill="#f2eede",
        rect_rx=3,
    )
    inner = _prim_svg(
        prims,
        'stroke="#c89a3a" stroke-width="2" stroke-linecap="round" '
        'stroke-linejoin="round" opacity="0.75"',
        rect_rx=3,
    )
    # Pennant corner flair.
    pennant = (
        '<polygon points="0 6 14 8 6 12 0 12" fill="#f2c445" />'
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}">\n  '
        f'{bg}\n  {stitch}\n  {pennant}\n  {chenille}\n  {inner}\n'
        f'</svg>\n'
    )


def _render_arcade_tokens(prims):
    """Embossed bronze-gold coin, the glyph pressed in as a raised relief."""
    bg = f'<rect x="0" y="0" width="{SIZE}" height="{SIZE}" fill="#2a1b0e" />'
    coin = (
        f'<circle cx="32" cy="32" r="28" fill="#e6a84a" />'
        f'<circle cx="32" cy="32" r="28" fill="none" '
        f'stroke="#8a5a1e" stroke-width="2.4" />'
        f'<circle cx="32" cy="32" r="24" fill="none" '
        f'stroke="#f6d27a" stroke-width="1" opacity="0.8" />'
    )
    # Engraved glyph: darker stroke below, highlight stroke above, offset
    # to simulate an embossed ridge.
    deep = _prim_svg(
        prims,
        'stroke="#7a4414" stroke-width="3" stroke-linecap="round" '
        'stroke-linejoin="round"',
        fill="#7a4414",
        rect_rx=2,
    )
    rim = _prim_svg(
        prims,
        'stroke="#fce79a" stroke-width="1.6" stroke-linecap="round" '
        'stroke-linejoin="round" opacity="0.9"',
        rect_rx=2,
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}">\n  '
        f'{bg}\n  {coin}\n  '
        f'<g transform="translate(0.6, 0.8)">{deep}</g>\n  '
        f'<g transform="translate(-0.4, -0.6)">{rim}</g>\n'
        f'</svg>\n'
    )


def _render_tiki(prims):
    """Warm wood-grain backplate with rattan weave and a cocoa glyph."""
    wood = (
        f'<rect x="0" y="0" width="{SIZE}" height="{SIZE}" fill="#c07840" />'
    )
    grain = []
    for i in range(0, SIZE, 3):
        grain.append(
            f'<path d="M 0 {i} C 20 {i+1.4} 40 {i-1.4} {SIZE} {i}" '
            f'fill="none" stroke="#8e5224" stroke-width="0.5" opacity="0.55" />'
        )
    # Rattan weave frame along the edges.
    weave = (
        f'<rect x="3" y="3" width="{SIZE-6}" height="{SIZE-6}" rx="5" '
        f'fill="none" stroke="#3c1c08" stroke-width="1.2" opacity="0.7" />'
        f'<rect x="5" y="5" width="{SIZE-10}" height="{SIZE-10}" rx="4" '
        f'fill="none" stroke="#f4d7a5" stroke-width="0.8" opacity="0.55" '
        f'stroke-dasharray="2 1.5" />'
    )
    glyph = _prim_svg(
        prims,
        'stroke="#3c1c08" stroke-width="3" stroke-linecap="round" '
        'stroke-linejoin="round"',
        fill="#3c1c08",
        rect_rx=3,
    )
    highlight = _prim_svg(
        prims,
        'stroke="#fce3b9" stroke-width="1" stroke-linecap="round" '
        'stroke-linejoin="round" opacity="0.65"',
        rect_rx=3,
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}">\n  '
        f'{wood}\n  {"".join(grain)}\n  {weave}\n  '
        f'{glyph}\n  <g transform="translate(-0.6, -0.8)">{highlight}</g>\n'
        f'</svg>\n'
    )


# The three original sets (filament / arctic / fold) were replaced with
# hand-authored full-color artwork before the public 1.0.0 baseline and
# are no longer regenerated by this script. Their renderers
# (_render_filament, _render_arctic, _render_fold) are kept for reference
# but excluded from SETS so running this script does not overwrite their
# hand-crafted SVGs on disk.
SETS = {
    "risograph": {
        "label": "Risograph",
        "franchise": "Print",
        "accent": "#ff4fa8",
        "description": (
            "Two-color riso print look — fluorescent pink and cyan "
            "off-register on dust-grit paper. Loud and cheerful."
        ),
        "render": _render_risograph,
    },
    "claymation": {
        "label": "Claymation",
        "franchise": "Handmade",
        "accent": "#ffb84d",
        "description": (
            "Puffy stop-motion clay sculpts with soft speculars on "
            "warm primaries. Feels pressed by hand."
        ),
        "render": _render_claymation,
    },
    "circuit-bend": {
        "label": "Circuit Bend",
        "franchise": "Technical",
        "accent": "#2fb37a",
        "description": (
            "PCB-green tiles with gold traces, solder pads, and a "
            "tiny red LED in the corner. Pairs with Circuit Garden."
        ),
        "render": _render_circuit_bend,
    },
    "stadium": {
        "label": "Stadium",
        "franchise": "Sport",
        "accent": "#d73a3a",
        "description": (
            "Chenille varsity-patch icons on crimson backing with "
            "dashed stitched outlines and a pennant corner."
        ),
        "render": _render_stadium,
    },
    "botanical-plate": {
        "label": "Botanical Plate",
        "franchise": "Illustrated",
        "accent": "#6a8f3b",
        "description": (
            "Copperplate ink + soft green watercolor wash on aged "
            "paper, like a naturalist's field guide."
        ),
        "render": _render_botanical_plate,
    },
    "arcade-tokens": {
        "label": "Arcade Tokens",
        "franchise": "Retro",
        "accent": "#b07a2a",
        "description": (
            "Embossed bronze-and-gold coin icons with every glyph "
            "pressed in as a relief. Jingles in your pocket."
        ),
        "render": _render_arcade_tokens,
    },
    "cross-stitch": {
        "label": "Cross-Stitch",
        "franchise": "Craft",
        "accent": "#e87ca7",
        "description": (
            "Rose cross-stitch pixel art on linen, each glyph "
            "rendered in tiny x-shaped thread stamps."
        ),
        "render": _render_cross_stitch,
    },
    "lemonade-stand": {
        "label": "Lemonade Stand",
        "franchise": "Summer",
        "accent": "#ffd64b",
        "description": (
            "Crayon-stroke glyphs on a sunny yellow gingham "
            "backplate. Kid-drawn, summer-bright."
        ),
        "render": _render_lemonade_stand,
    },
    "hologram": {
        "label": "Hologram",
        "franchise": "Synthetic",
        "accent": "#9fd0ff",
        "description": (
            "Iridescent foil-sticker glyphs with a pastel-rainbow "
            "gradient and a peel corner. Sparkly without being dark."
        ),
        "render": _render_hologram,
    },
    "tiki": {
        "label": "Tiki",
        "franchise": "Lounge",
        "accent": "#c47a3c",
        "description": (
            "Mid-century tiki lounge — warm wood-grain backplate "
            "with a rattan weave frame and cocoa-engraved glyphs."
        ),
        "render": _render_tiki,
    },
}


KEYS = (
    "dashboard", "posts", "pages", "media", "comments", "appearance",
    "plugins", "users", "tools", "settings", "profile", "links", "fallback",
)


def _slug_to_filename(key: str) -> str:
    return f"{key}.svg"


def main() -> int:
    if not ICONS_ROOT.is_dir():
        ICONS_ROOT.mkdir(parents=True, exist_ok=True)

    for slug, spec in SETS.items():
        set_dir = ICONS_ROOT / slug
        set_dir.mkdir(parents=True, exist_ok=True)
        manifest = {
            "slug": slug,
            "label": spec["label"],
            "franchise": spec["franchise"],
            "accent": spec["accent"],
            "description": spec["description"],
            "preview": "dashboard.svg",
            "icons": {k: _slug_to_filename(k) for k in KEYS},
        }
        # Strip any pre-existing SVGs so renamed/removed icons don't
        # linger as orphans (the validator flags those as warnings).
        for old in set_dir.glob("*.svg"):
            old.unlink()
        for key in KEYS:
            svg = spec["render"](SYMBOLS[key])
            (set_dir / _slug_to_filename(key)).write_text(svg)
        (set_dir / "manifest.json").write_text(
            json.dumps(manifest, indent=2) + "\n"
        )
        print(f"  wrote {slug}/ ({len(KEYS)} icons + manifest)")

    print(f"OK: {len(SETS)} icon set(s) generated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
