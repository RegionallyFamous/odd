#!/usr/bin/env python3
"""Build the ODD remote catalog.

Walks `_tools/catalog-sources/` and emits:

    site/catalog/v1/
        registry.json           one catalog manifest for everything
        registry.schema.json    JSON schema for validators
        bundles/*.wp            one .wp archive per bundle
        icons/<slug>.*          Discover tile per bundle

The plugin fetches `registry.json` over HTTPS and installs
listed bundles through `oddout_bundle_install()`. Every content change
is a commit to this repo; GitHub Pages republishes `site/` on push,
which takes `odd.regionallyfamous.com/catalog/v1/` live with the new
content — no plugin release required.

Determinism:
    * Every file inside every .wp uses a fixed mtime (2025-01-01).
    * Inputs are walked in sorted order.
    * Zip entries are ZIP_DEFLATED at default compression level.
    * Re-running without source changes produces byte-identical zips
      (enforced by CI: `validate-catalog` fails if rebuild leaves the
      tree dirty).

Bundle types:
    scene       source: catalog-sources/scenes/<slug>/{scene.js,
                meta.json, wallpaper.webp, preview.webp}
    icon-set    source: catalog-sources/icon-sets/<slug>/ (manifest
                + PNG/WebP raster icons)
    cursor-set  source: catalog-sources/cursor-sets/<slug>/ (manifest
                + SVG cursors)
    widget      source: catalog-sources/widgets/<slug>/{widget.js,
                widget.css?, manifest.json, preview.svg?, assets/*}
    app         source: catalog-sources/apps/<slug>/{bundle.wp, icon.svg,
                meta.json} — app .wp is prebuilt, we just publish it.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import shutil
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
SOURCES = HERE / "catalog-sources"
OUT_ROOT = REPO / "site" / "catalog" / "v1"
OUT_BUNDLES = OUT_ROOT / "bundles"
OUT_ICONS = OUT_ROOT / "icons"
OUT_CARDS = OUT_ROOT / "cards"

FIXED_DATE = (2025, 1, 1, 0, 0, 0)
CATALOG_BASE = "https://odd.regionallyfamous.com/catalog/v1"
SCHEMA_URL = f"{CATALOG_BASE}/registry.schema.json"
FIRST_PARTY_ICON_KEYS = {
    "dashboard", "posts", "pages", "media", "comments",
    "appearance", "plugins", "users", "tools", "settings",
    "profile", "links", "recycle-bin", "fallback",
}

ICON_IMAGE_SIZE_BUDGET = 768 * 1024
ICON_IMAGE_MIN_DIM = 64
ICON_IMAGE_MAX_DIM = 2048
ICON_IMAGE_EXTENSIONS = {"png": "PNG", "webp": "WEBP"}
ASSET_REL_PATH = re.compile(r"^[a-zA-Z0-9._-]+(/[a-zA-Z0-9._-]+)*$")
BUNDLE_FORBIDDEN_EXTENSIONS = {
    "php", "phtml", "phar", "php3", "php4", "php5", "php7",
    "phps", "cgi", "pl", "py", "rb", "sh", "bash",
}

_ICON_CTRL = re.compile(rb"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_SVG_ALLOWED_ELEMENTS = {
    "svg",
    "g",
    "defs",
    "title",
    "desc",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "use",
    "clipPath",
    "mask",
    "linearGradient",
    "radialGradient",
    "stop",
    "filter",
    "feBlend",
    "feColorMatrix",
    "feComposite",
    "feDropShadow",
    "feFlood",
    "feGaussianBlur",
    "feMerge",
    "feMergeNode",
    "feMorphology",
    "feOffset",
}
_SVG_ALLOWED_ATTRS = {
    "xmlns",
    "viewBox",
    "width",
    "height",
    "role",
    "aria-label",
    "id",
    "class",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "d",
    "points",
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-opacity",
    "stroke-dasharray",
    "stroke-dashoffset",
    "opacity",
    "transform",
    "clip-path",
    "clip-rule",
    "mask",
    "filter",
    "offset",
    "stop-color",
    "stop-opacity",
    "gradientUnits",
    "gradientTransform",
    "font-family",
    "font-size",
    "font-weight",
    "letter-spacing",
    "text-anchor",
    "dominant-baseline",
    "textLength",
    "lengthAdjust",
    "dx",
    "dy",
    "stdDeviation",
    "flood-color",
    "flood-opacity",
    "in",
    "in2",
    "mode",
    "operator",
    "values",
    "result",
    "color-interpolation-filters",
    "href",
    "xlink:href",
    "xmlns:xlink",
}


def _svg_name(name: str) -> str:
    if name.startswith("{"):
        uri, local = name[1:].split("}", 1)
        if uri == "http://www.w3.org/1999/xlink":
            return f"xlink:{local}"
        return local
    return name


def _validate_basic_svg(label: str, data: bytes) -> ET.Element:
    if _ICON_CTRL.search(data):
        raise SystemExit(f"{label}: SVG contains forbidden control bytes")
    text = data.decode("utf-8", errors="replace")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise SystemExit(f"{label}: invalid XML: {exc}")
    if root.tag != "{http://www.w3.org/2000/svg}svg":
        raise SystemExit(f"{label}: root element is not <svg>")
    if not (root.attrib.get("viewBox") or "").strip():
        raise SystemExit(f"{label}: missing viewBox")
    for node in root.iter():
        tag = _svg_name(node.tag)
        if tag not in _SVG_ALLOWED_ELEMENTS:
            raise SystemExit(f"{label}: contains disallowed element <{tag}>")
        for raw_name, raw_value in node.attrib.items():
            name = _svg_name(raw_name)
            value = (raw_value or "").strip()
            if name.lower().startswith("on"):
                raise SystemExit(f"{label}: contains event handler attribute {name!r}")
            if name not in _SVG_ALLOWED_ATTRS and not name.startswith("data-"):
                raise SystemExit(f"{label}: contains disallowed attribute {name!r}")
            if name in {"href", "xlink:href"} and value and not value.startswith("#"):
                raise SystemExit(f"{label}: contains external reference {name}={value!r}")
            if "url(" in value.lower() and not re.search(r"url\(\s*#[^)]+\)", value, re.I):
                raise SystemExit(f"{label}: contains external url() reference {value!r}")
            if re.search(r"(?:javascript|data|vbscript)\s*:", value, re.I):
                raise SystemExit(f"{label}: contains scriptable URL value {value!r}")
    return root


def _validate_icon_image(slug: str, rel: str, data: bytes) -> None:
    """Fail-loud check applied to every square raster icon-set asset."""
    _validate_icon_raster(slug, rel, data, square=True)


def _validate_icon_preview(slug: str, rel: str, data: bytes) -> None:
    """Fail-loud check applied to optional raster icon-set preview art."""
    _validate_icon_raster(slug, rel, data, square=False)


def _validate_icon_raster(slug: str, rel: str, data: bytes, *, square: bool) -> None:
    label = f"icon-set {slug}: {rel}"
    ext = Path(rel).suffix.lower().lstrip(".")
    expected = ICON_IMAGE_EXTENSIONS.get(ext)
    if expected is None:
        raise SystemExit(f"{label}: icon assets must be .png or .webp")
    if len(data) > ICON_IMAGE_SIZE_BUDGET:
        raise SystemExit(
            f"{label}: {len(data)} bytes exceeds {ICON_IMAGE_SIZE_BUDGET} budget"
        )
    try:
        with Image.open(io.BytesIO(data)) as img:
            img.verify()
        with Image.open(io.BytesIO(data)) as img:
            fmt = img.format
            width, height = img.size
    except Exception as exc:
        raise SystemExit(f"{label}: invalid image data: {exc}") from exc
    if fmt != expected:
        raise SystemExit(f"{label}: extension .{ext} does not match {fmt}")
    if square and width != height:
        raise SystemExit(f"{label}: icon must be square, got {width}x{height}")
    if (
        width < ICON_IMAGE_MIN_DIM
        or height < ICON_IMAGE_MIN_DIM
        or width > ICON_IMAGE_MAX_DIM
        or height > ICON_IMAGE_MAX_DIM
    ):
        raise SystemExit(
            f"{label}: image dimensions must be {ICON_IMAGE_MIN_DIM}-{ICON_IMAGE_MAX_DIM}px, got {width}x{height}px"
        )


def _validate_widget_preview_svg(slug: str, rel: str, data: bytes) -> None:
    _validate_basic_svg(f"widget {slug}: {rel}", data)


# ---------------------------------------------------------------- #
# Deterministic zip.
# ---------------------------------------------------------------- #


def write_zip(dest: Path, files: dict[str, bytes]) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in sorted(files):
            info = zipfile.ZipInfo(name, FIXED_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            zf.writestr(info, files[name])
    dest.write_bytes(buf.getvalue())


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def publish_card(src_dir: Path, type_prefix: str, slug: str) -> str:
    """Publish optional generated Shop card art for a catalog row."""
    card = src_dir / "card.webp"
    if not card.is_file():
        return ""
    name = f"{type_prefix}-{slug}.webp"
    shutil.copy2(card, OUT_CARDS / name)
    return f"{CATALOG_BASE}/cards/{name}"


# ---------------------------------------------------------------- #
# Discover tile icons.
#
# Every catalog row needs a tile. Scenes use their real preview art,
# icon-sets compose a WebP tile from raster set icons, widgets can ship
# a preview.svg beside the manifest, and apps copy their bundle icon.
# ---------------------------------------------------------------- #


def scene_tile(slug: str, label: str, fallback: str) -> str:
    initial = (label or slug).strip()[:1].upper() or "?"
    text_color = "#ffffff" if _is_dark(fallback) else "#10121a"
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"'
        f' role="img" aria-label="{label}">\n'
        f'  <rect x="0" y="0" width="64" height="64" rx="14" ry="14" fill="{fallback}"/>\n'
        '  <circle cx="48" cy="16" r="8" fill="#ffffff" opacity="0.18"/>\n'
        '  <circle cx="14" cy="52" r="6" fill="#ffffff" opacity="0.12"/>\n'
        '  <text x="32" y="42" text-anchor="middle"'
        ' font-family="Inter, system-ui, -apple-system, sans-serif"'
        f' font-size="28" font-weight="800" fill="{text_color}">{initial}</text>\n'
        "</svg>\n"
    )


def _is_dark(hex_color: str) -> bool:
    c = hex_color.lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    if len(c) < 6:
        return True
    try:
        r, g, b = int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)
    except ValueError:
        return True
    return (0.299 * r + 0.587 * g + 0.114 * b) < 128


def widget_tile(slug: str, label: str) -> str:
    uid = re.sub(r"[^a-z0-9]+", "", slug.lower())

    if slug == "sticky":
        return (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
            f'width="1024" height="1024" role="img" aria-label="{label} widget preview">'
            "<defs>"
            f'<linearGradient id="bg{uid}" x1="0" y1="0" x2="1" y2="1">'
            '<stop offset="0" stop-color="#fff8bd"/>'
            '<stop offset="1" stop-color="#ffb23f"/>'
            "</linearGradient>"
            f'<filter id="sh{uid}" x="-20%" y="-20%" width="140%" height="150%">'
            '<feDropShadow dx="0" dy="24" stdDeviation="24" flood-color="#6b3a00" flood-opacity=".28"/>'
            "</filter>"
            "</defs>"
            f'<rect width="1024" height="1024" fill="url(#bg{uid})"/>'
            '<circle cx="160" cy="140" r="210" fill="#fff" opacity=".24"/>'
            '<g filter="url(#shsticky)" transform="rotate(-7 512 512)">'
            '<path d="M252 196 H800 V720 L652 870 H252 Z" fill="#ffe76a"/>'
            '<path d="M652 720 H800 L652 870 Z" fill="#ffc247"/>'
            '<path d="M652 720 L800 720 L652 870 Z" fill="#be7a18" opacity=".18"/>'
            '<path d="M338 382 H700 M338 494 H650 M338 606 H582" fill="none" stroke="#7a5018" stroke-width="42" stroke-linecap="round" opacity=".72"/>'
            "</g>"
            "</svg>\n"
        ).replace("url(#shsticky)", f"url(#sh{uid})")

    if slug == "eight-ball":
        return (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
            f'width="1024" height="1024" role="img" aria-label="{label} widget preview">'
            "<defs>"
            f'<radialGradient id="bg{uid}" cx=".32" cy=".24" r=".9">'
            '<stop offset="0" stop-color="#6d58ff"/>'
            '<stop offset=".58" stop-color="#1d1640"/>'
            '<stop offset="1" stop-color="#07030d"/>'
            "</radialGradient>"
            f'<radialGradient id="ball{uid}" cx=".34" cy=".28" r=".78">'
            '<stop offset="0" stop-color="#6f667d"/>'
            '<stop offset=".42" stop-color="#171421"/>'
            '<stop offset="1" stop-color="#020104"/>'
            "</radialGradient>"
            f'<filter id="sh{uid}" x="-20%" y="-20%" width="140%" height="150%">'
            '<feDropShadow dx="0" dy="28" stdDeviation="28" flood-color="#000" flood-opacity=".36"/>'
            "</filter>"
            "</defs>"
            f'<rect width="1024" height="1024" fill="url(#bg{uid})"/>'
            '<circle cx="180" cy="156" r="188" fill="#fff" opacity=".12"/>'
            f'<circle cx="512" cy="522" r="324" fill="url(#ball{uid})" filter="url(#sh{uid})"/>'
            '<circle cx="414" cy="364" r="74" fill="#fff" opacity=".14"/>'
            '<circle cx="512" cy="508" r="138" fill="#f7f7fb"/>'
            '<text x="512" y="562" text-anchor="middle" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="156" font-weight="900" fill="#111827">8</text>'
            '<path d="M340 784 Q512 862 684 784" fill="none" stroke="#8b5cf6" stroke-width="28" stroke-linecap="round" opacity=".72"/>'
            "</svg>\n"
        )

    if slug == "spotify":
        return (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
            f'width="1024" height="1024" role="img" aria-label="{label} widget preview">'
            "<defs>"
            f'<linearGradient id="bg{uid}" x1="0" y1="0" x2="1" y2="1">'
            '<stop offset="0" stop-color="#1ed760"/>'
            '<stop offset=".52" stop-color="#0d3f24"/>'
            '<stop offset="1" stop-color="#05070a"/>'
            "</linearGradient>"
            f'<linearGradient id="card{uid}" x1="0" y1="0" x2="0" y2="1">'
            '<stop offset="0" stop-color="#20252d"/>'
            '<stop offset="1" stop-color="#0b0d10"/>'
            "</linearGradient>"
            f'<filter id="sh{uid}" x="-20%" y="-20%" width="140%" height="150%">'
            '<feDropShadow dx="0" dy="28" stdDeviation="28" flood-color="#000" flood-opacity=".42"/>'
            "</filter>"
            "</defs>"
            f'<rect width="1024" height="1024" fill="url(#bg{uid})"/>'
            '<circle cx="174" cy="150" r="220" fill="#fff" opacity=".16"/>'
            '<circle cx="850" cy="846" r="260" fill="#1ed760" opacity=".18"/>'
            f'<g filter="url(#sh{uid})" transform="rotate(-5 512 512)">'
            f'<rect x="202" y="192" width="620" height="640" rx="76" fill="url(#card{uid})"/>'
            '<rect x="252" y="246" width="520" height="326" rx="46" fill="#1ed760"/>'
            '<circle cx="512" cy="410" r="122" fill="#0a0d10" opacity=".92"/>'
            '<path d="M452 344 L452 476 L570 410 Z" fill="#1ed760"/>'
            '<path d="M300 650 H724" stroke="#f7fff9" stroke-width="30" stroke-linecap="round" opacity=".92"/>'
            '<path d="M300 718 H646" stroke="#1ed760" stroke-width="28" stroke-linecap="round" opacity=".92"/>'
            '<path d="M300 786 H568" stroke="#f7fff9" stroke-width="24" stroke-linecap="round" opacity=".42"/>'
            "</g>"
            '<g fill="none" stroke="#f7fff9" stroke-linecap="round" opacity=".86">'
            '<path d="M324 162 C444 102 604 104 716 168" stroke-width="24"/>'
            '<path d="M366 214 C462 176 574 178 660 226" stroke-width="18" opacity=".72"/>'
            '<path d="M410 262 C476 240 552 242 612 274" stroke-width="14" opacity=".54"/>'
            "</g>"
            "</svg>\n"
        )

    # Generic fallback for future widgets.
    initial = (label or slug).strip()[:1].upper() or "?"
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
        f'width="1024" height="1024" role="img" aria-label="{label} widget preview">'
        '<rect width="1024" height="1024" fill="#8a5cff"/>'
        '<circle cx="220" cy="200" r="160" fill="#fff" opacity=".22"/>'
        '<text x="512" y="610" text-anchor="middle" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="420" font-weight="900" fill="#fff">'
        f'{initial}</text>'
        "</svg>\n"
    )


def iconset_tile(slug: str, label: str, accent: str, src_dir: Path, icons: dict[str, str]) -> bytes:
    """Compose a WebP catalog preview from raster icon-set artwork."""
    def safe_hex(value: str) -> str:
        value = (value or "#888888").strip()
        if re.fullmatch(r"#[0-9a-fA-F]{3}", value):
            return "#" + "".join(ch * 2 for ch in value[1:])
        if re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            return value
        return "#888888"

    def mix(c1: str, c2: str, amt: float) -> tuple[int, int, int]:
        a = safe_hex(c1).lstrip("#")
        b = safe_hex(c2).lstrip("#")
        out = []
        for i in (0, 2, 4):
            av = int(a[i:i + 2], 16)
            bv = int(b[i:i + 2], 16)
            out.append(round(av * (1 - amt) + bv * amt))
        return tuple(out)

    accent = safe_hex(accent)
    accent_rgb = tuple(int(accent.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    glow_rgb = mix(accent, "#ffffff", 0.28)

    img = Image.new("RGBA", (1024, 1024), (8, 5, 17, 255))
    glow = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)
    draw.ellipse((-140, -180, 720, 700), fill=(*glow_rgb, 58))
    draw.ellipse((300, 300, 1220, 1180), fill=(*accent_rgb, 32))
    glow = glow.filter(ImageFilter.GaussianBlur(70))
    img.alpha_composite(glow)

    placements = [
        ("dashboard", 62, 62, 388, -4),
        ("posts", 574, 62, 388, 4),
        ("pages", 62, 574, 388, 4),
        ("media", 574, 574, 388, -4),
    ]
    for key, x, y, size, rot in placements:
        rel = icons.get(key) or icons.get("dashboard") or next(iter(icons.values()))
        with Image.open(src_dir / rel) as icon:
            icon = icon.convert("RGBA")
            icon.thumbnail((size, size), Image.Resampling.LANCZOS)
            layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            ox = (size - icon.width) // 2
            oy = (size - icon.height) // 2
            layer.alpha_composite(icon, (ox, oy))
            if rot:
                layer = layer.rotate(rot, resample=Image.Resampling.BICUBIC, expand=True)
            shadow = Image.new("RGBA", layer.size, (0, 0, 0, 0))
            shadow.alpha_composite(layer)
            alpha = shadow.getchannel("A").filter(ImageFilter.GaussianBlur(18))
            shadow = Image.new("RGBA", layer.size, (0, 0, 0, 118))
            shadow.putalpha(alpha)
            px = x - (layer.width - size) // 2
            py = y - (layer.height - size) // 2
            img.alpha_composite(shadow, (px, py + 22))
            img.alpha_composite(layer, (px, py))

    out = io.BytesIO()
    img.convert("RGB").save(out, "WEBP", quality=88, method=6)
    return out.getvalue()


# ---------------------------------------------------------------- #
# Per-type bundle builders.
# ---------------------------------------------------------------- #


def build_scene(slug: str, src_dir: Path) -> dict:
    meta = json.loads((src_dir / "meta.json").read_text())
    scene_js = (src_dir / "scene.js").read_bytes()
    wallpaper = (src_dir / "wallpaper.webp").read_bytes()
    preview = (src_dir / "preview.webp").read_bytes()

    manifest = {
        "$schema": "../../manifest.schema.json",
        "type": "scene",
        "slug": meta["slug"],
        "name": meta["label"],
        "label": meta["label"],
        "version": meta.get("version", "1.0.0"),
        "author": meta.get("author", "Regionally Famous"),
        "description": meta.get("description", ""),
        "franchise": meta.get("franchise", "Community"),
        "tags": meta.get("tags", []),
        "fallbackColor": meta.get("fallbackColor", "#111"),
        "heroSafe": meta.get("heroSafe", True),
        "entry": "scene.js",
        "preview": "preview.webp",
        "wallpaper": "wallpaper.webp",
    }
    bundle = OUT_BUNDLES / f"scene-{slug}.wp"
    write_zip(
        bundle,
        {
            "manifest.json": json.dumps(manifest, indent=2).encode() + b"\n",
            "scene.js": scene_js,
            "preview.webp": preview,
            "wallpaper.webp": wallpaper,
        },
    )

    # Use the painted preview.webp as the Discover tile. The generated
    # "first initial on a flat swatch" SVG fallback looked identical
    # for every scene whose label started with the same letter — and
    # we already ship the real art. Still emit the SVG fallback on
    # disk for legacy clients / validators but point `icon_url` at the
    # webp so the Shop renders the actual scene imagery.
    icon_svg_name = f"scene-{slug}.svg"
    (OUT_ICONS / icon_svg_name).write_text(
        scene_tile(slug, meta["label"], meta.get("fallbackColor", "#111"))
    )
    icon_webp_name = f"scene-{slug}.webp"
    (OUT_ICONS / icon_webp_name).write_bytes(preview)

    return {
        "type": "scene",
        "slug": slug,
        "name": meta["label"],
        "version": manifest["version"],
        "author": manifest["author"],
        "description": manifest["description"],
        "franchise": manifest["franchise"],
        "tags": manifest["tags"],
        "heroSafe": manifest["heroSafe"],
        "icon_url": f"{CATALOG_BASE}/icons/{icon_webp_name}",
        "card_url": publish_card(src_dir, "scene", slug),
        "download_url": f"{CATALOG_BASE}/bundles/{bundle.name}",
        "sha256": sha256_file(bundle),
        "size": bundle.stat().st_size,
    }


def build_iconset(slug: str, src_dir: Path) -> dict:
    meta = json.loads((src_dir / "manifest.json").read_text())
    missing = sorted(FIRST_PARTY_ICON_KEYS - set(meta.get("icons", {}).keys()))
    if missing:
        raise SystemExit(f"icon-set {slug}: missing first-party icons {missing}")

    files: dict[str, bytes] = {}
    manifest = {
        "$schema": "../../manifest.schema.json",
        "type": "icon-set",
        "slug": meta["slug"],
        "name": meta["label"],
        "label": meta["label"],
        "version": meta.get("version", "1.0.0"),
        "author": meta.get("author", "Regionally Famous"),
        "description": meta.get("description", ""),
        "franchise": meta.get("franchise", "Community"),
        "accent": meta.get("accent", "#888"),
        "preview": meta.get("preview", "dashboard.webp"),
        "icons": meta["icons"],
    }
    files["manifest.json"] = json.dumps(manifest, indent=2).encode() + b"\n"
    asset_rels = set(meta["icons"].values())
    if manifest["preview"]:
        asset_rels.add(manifest["preview"])
    for rel in sorted(asset_rels):
        asset_path = src_dir / rel
        if not asset_path.is_file():
            raise SystemExit(f"icon-set {slug}: missing {rel}")
        data = asset_path.read_bytes()
        if rel == manifest["preview"]:
            _validate_icon_preview(slug, rel, data)
        else:
            _validate_icon_image(slug, rel, data)
        files[rel] = data

    bundle = OUT_BUNDLES / f"iconset-{slug}.wp"
    write_zip(bundle, files)

    icon_name = f"iconset-{slug}.webp"
    (OUT_ICONS / icon_name).write_bytes(
        iconset_tile(slug, meta["label"], meta.get("accent", "#888"), src_dir, meta["icons"])
    )

    return {
        "type": "icon-set",
        "slug": slug,
        "name": meta["label"],
        "version": manifest["version"],
        "author": manifest["author"],
        "description": manifest["description"],
        "franchise": manifest["franchise"],
        "accent": manifest["accent"],
        "icon_url": f"{CATALOG_BASE}/icons/{icon_name}",
        "card_url": publish_card(src_dir, "iconset", slug),
        "download_url": f"{CATALOG_BASE}/bundles/{bundle.name}",
        "sha256": sha256_file(bundle),
        "size": bundle.stat().st_size,
    }


CURSOR_KINDS = {
    "default",
    "pointer",
    "text",
    "grab",
    "grabbing",
    "crosshair",
    "not-allowed",
    "wait",
    "help",
    "progress",
}
CURSOR_SIZE_BUDGET = 8192
CURSOR_RENDER_SIZE = 64


def _svg_dimension(root: ET.Element, attr: str) -> int | None:
    raw = (root.attrib.get(attr) or "").strip()
    match = re.fullmatch(r"(\d+)(?:px)?", raw)
    return int(match.group(1)) if match else None


def _validate_cursor_svg(slug: str, rel: str, data: bytes, require_cursor_dimensions: bool = False) -> None:
    label = f"cursor-set {slug}: {rel}"
    if len(data) > CURSOR_SIZE_BUDGET:
        raise SystemExit(f"{label}: {len(data)} bytes exceeds {CURSOR_SIZE_BUDGET} budget")
    if _ICON_CTRL.search(data):
        raise SystemExit(f"{label}: SVG contains forbidden control bytes")
    text = data.decode("utf-8", errors="replace")
    for tag in ("<image", "<script", "<foreignObject"):
        if tag in text:
            raise SystemExit(f"{label}: contains forbidden element {tag!r}")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise SystemExit(f"{label}: invalid XML: {exc}")
    if root.tag != "{http://www.w3.org/2000/svg}svg":
        raise SystemExit(f"{label}: root element is not <svg>")
    if require_cursor_dimensions:
        width = _svg_dimension(root, "width")
        height = _svg_dimension(root, "height")
        if width != CURSOR_RENDER_SIZE or height != CURSOR_RENDER_SIZE:
            raise SystemExit(
                f'{label}: CSS cursor SVGs must declare width="{CURSOR_RENDER_SIZE}" height="{CURSOR_RENDER_SIZE}"'
            )
    if not (root.attrib.get("viewBox") or root.attrib.get("width")):
        raise SystemExit(f"{label}: SVG must include viewBox or width")


def build_cursorset(slug: str, src_dir: Path) -> dict:
    meta = json.loads((src_dir / "manifest.json").read_text())
    cursors = meta.get("cursors") or {}
    if not isinstance(cursors, dict) or "default" not in cursors:
        raise SystemExit(f"cursor-set {slug}: manifest must declare cursors.default")

    files: dict[str, bytes] = {}
    manifest = {
        "$schema": "../../manifest.schema.json",
        "type": "cursor-set",
        "slug": meta["slug"],
        "name": meta["label"],
        "label": meta["label"],
        "version": meta.get("version", "1.0.0"),
        "author": meta.get("author", "Regionally Famous"),
        "description": meta.get("description", ""),
        "franchise": meta.get("franchise", "Community"),
        "accent": meta.get("accent", "#38e8ff"),
        "preview": meta.get("preview", "preview.svg"),
        "cursors": cursors,
    }
    files["manifest.json"] = json.dumps(manifest, indent=2).encode() + b"\n"

    rels: set[str] = set()
    cursor_rels: set[str] = set()
    for kind, spec in cursors.items():
        if kind not in CURSOR_KINDS:
            raise SystemExit(f"cursor-set {slug}: unsupported cursor kind {kind!r}")
        if not isinstance(spec, dict):
            raise SystemExit(f"cursor-set {slug}: cursor {kind!r} must be an object")
        rel = spec.get("file")
        hotspot = spec.get("hotspot")
        if not isinstance(rel, str) or not rel:
            raise SystemExit(f"cursor-set {slug}: cursor {kind!r} missing file")
        if Path(rel).name != rel or "\\" in rel or ".." in rel:
            raise SystemExit(f"cursor-set {slug}: cursor path {rel!r} must be flat")
        if Path(rel).suffix.lower() != ".svg":
            raise SystemExit(f"cursor-set {slug}: cursor {rel!r} must be SVG")
        if not (isinstance(hotspot, list) and len(hotspot) == 2 and all(isinstance(v, int) for v in hotspot)):
            raise SystemExit(f"cursor-set {slug}: cursor {kind!r} hotspot must be [x, y] ints")
        rels.add(rel)
        cursor_rels.add(rel)

    preview = manifest["preview"]
    if isinstance(preview, str) and preview:
        rels.add(preview)

    for rel in sorted(rels):
        svg_path = src_dir / rel
        if not svg_path.is_file():
            raise SystemExit(f"cursor-set {slug}: missing {rel}")
        data = svg_path.read_bytes()
        _validate_cursor_svg(slug, rel, data, rel in cursor_rels)
        files[rel] = data

    bundle = OUT_BUNDLES / f"cursor-set-{slug}.wp"
    write_zip(bundle, files)

    icon_name = f"cursor-set-{slug}.svg"
    preview_path = src_dir / preview if isinstance(preview, str) and preview else None
    if preview_path and preview_path.is_file():
        (OUT_ICONS / icon_name).write_bytes(preview_path.read_bytes())
    else:
        (OUT_ICONS / icon_name).write_text(widget_tile(slug, meta["label"]))

    return {
        "type": "cursor-set",
        "slug": slug,
        "name": meta["label"],
        "version": manifest["version"],
        "author": manifest["author"],
        "description": manifest["description"],
        "franchise": manifest["franchise"],
        "accent": manifest["accent"],
        "icon_url": f"{CATALOG_BASE}/icons/{icon_name}",
        "card_url": publish_card(src_dir, "cursor-set", slug),
        "download_url": f"{CATALOG_BASE}/bundles/{bundle.name}",
        "sha256": sha256_file(bundle),
        "size": bundle.stat().st_size,
    }


def build_widget(slug: str, src_dir: Path) -> dict:
    meta = json.loads((src_dir / "manifest.json").read_text())
    widget_js = (src_dir / "widget.js").read_bytes()
    css_rel = meta.get("css") or []
    if isinstance(css_rel, str):
        css_rel = [css_rel]

    files: dict[str, bytes] = {}
    manifest = {
        "$schema": "../../manifest.schema.json",
        "type": "widget",
        "slug": meta["slug"],
        "id": meta.get("id", f"odd/{slug}"),
        "name": meta["label"],
        "label": meta["label"],
        "version": meta.get("version", "1.0.0"),
        "author": meta.get("author", "Regionally Famous"),
        "description": meta.get("description", ""),
        "franchise": meta.get("franchise", "Community"),
        "entry": "widget.js",
        "css": css_rel,
    }
    for key in (
        "icon",
        "movable",
        "resizable",
        "minWidth",
        "minHeight",
        "maxWidth",
        "maxHeight",
        "defaultWidth",
        "defaultHeight",
        "capabilities",
    ):
        if key in meta:
            manifest[key] = meta[key]
    files["manifest.json"] = json.dumps(manifest, indent=2).encode() + b"\n"
    files["widget.js"] = widget_js
    for rel in css_rel:
        p = src_dir / rel
        if p.is_file():
            files[rel] = p.read_bytes()

    assets_dir = src_dir / "assets"
    if assets_dir.is_dir():
        for p in sorted(assets_dir.rglob("*")):
            if not p.is_file():
                continue
            rel = p.relative_to(src_dir).as_posix()
            if not ASSET_REL_PATH.match(rel):
                raise SystemExit(f"widget {slug}: invalid asset path {rel!r}")
            ext = p.suffix.lower().lstrip(".")
            if ext in BUNDLE_FORBIDDEN_EXTENSIONS:
                raise SystemExit(f"widget {slug}: forbidden asset extension in {rel!r}")
            files[rel] = p.read_bytes()

    bundle = OUT_BUNDLES / f"widget-{slug}.wp"
    write_zip(bundle, files)

    icon_name = f"widget-{slug}.svg"
    preview_path = src_dir / "preview.svg"
    if preview_path.is_file():
        preview = preview_path.read_bytes()
        _validate_widget_preview_svg(slug, "preview.svg", preview)
        (OUT_ICONS / icon_name).write_bytes(preview)
    else:
        (OUT_ICONS / icon_name).write_text(widget_tile(slug, meta["label"]))

    return {
        "type": "widget",
        "slug": slug,
        "name": meta["label"],
        "version": manifest["version"],
        "author": manifest["author"],
        "description": manifest["description"],
        "franchise": manifest["franchise"],
        "icon_url": f"{CATALOG_BASE}/icons/{icon_name}",
        "card_url": publish_card(src_dir, "widget", slug),
        "download_url": f"{CATALOG_BASE}/bundles/{bundle.name}",
        "sha256": sha256_file(bundle),
        "size": bundle.stat().st_size,
    }


def build_app(slug: str, src_dir: Path) -> dict:
    meta = json.loads((src_dir / "meta.json").read_text())
    bundle_src = src_dir / "bundle.wp"
    icon_src = src_dir / "icon.svg"
    if not bundle_src.is_file():
        raise SystemExit(f"app {slug}: missing bundle.wp")
    with zipfile.ZipFile(bundle_src, "r") as zf:
        manifest = json.loads(zf.read("manifest.json"))
        icon = manifest.get("icon")
        if not isinstance(icon, str) or not icon:
            raise SystemExit(f"app {slug}: manifest.json must declare icon")
        if not icon.startswith(("http://", "https://")) and icon not in zf.namelist():
            raise SystemExit(f"app {slug}: manifest icon {icon!r} missing from bundle.wp")

    bundle_dest = OUT_BUNDLES / f"{slug}.wp"
    shutil.copy2(bundle_src, bundle_dest)

    icon_name = f"{slug}.svg"
    if icon_src.is_file():
        shutil.copy2(icon_src, OUT_ICONS / icon_name)
    else:
        (OUT_ICONS / icon_name).write_text(widget_tile(slug, meta["name"]))

    return {
        "type": "app",
        "slug": slug,
        "name": meta["name"],
        "version": meta.get("version", "1.0.0"),
        "author": meta.get("author", "Regionally Famous"),
        "description": meta.get("description", ""),
        "tags": meta.get("tags", []),
        "icon_url": f"{CATALOG_BASE}/icons/{icon_name}",
        "card_url": publish_card(src_dir, "app", slug),
        "download_url": f"{CATALOG_BASE}/bundles/{bundle_dest.name}",
        "sha256": sha256_file(bundle_dest),
        "size": bundle_dest.stat().st_size,
    }


# ---------------------------------------------------------------- #
# Registry schema + assembly.
# ---------------------------------------------------------------- #


SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "$id": SCHEMA_URL,
    "title": "ODD Catalog Registry",
    "type": "object",
    "required": ["version", "bundles"],
    "properties": {
        "$schema": {"type": "string"},
        "version": {"type": "integer", "const": 1},
        "generated_at": {"type": "string"},
        "starter_pack": {
            "type": "object",
            "properties": {
                "scenes": {"type": "array", "items": {"type": "string"}},
                "iconSets": {"type": "array", "items": {"type": "string"}},
                "cursorSets": {"type": "array", "items": {"type": "string"}},
                "widgets": {"type": "array", "items": {"type": "string"}},
                "apps": {"type": "array", "items": {"type": "string"}},
            },
        },
        "bundles": {
            "type": "array",
            "items": {
                "type": "object",
                "required": [
                    "type",
                    "slug",
                    "name",
                    "version",
                    "icon_url",
                    "download_url",
                    "sha256",
                    "size",
                    "card_url",
                ],
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": ["scene", "icon-set", "cursor-set", "widget", "app"],
                    },
                    "slug": {"type": "string", "pattern": "^[a-z0-9][a-z0-9-]*$"},
                    "name": {"type": "string"},
                    "version": {
                        "type": "string",
                        "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$",
                    },
                    "author": {"type": "string"},
                    "description": {"type": "string"},
                    "franchise": {"type": "string"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "icon_url": {"type": "string"},
                    "card_url": {"type": "string"},
                    "download_url": {"type": "string"},
                    "sha256": {
                        "type": "string",
                        "pattern": "^[0-9a-f]{64}$",
                    },
                    "size": {"type": "integer", "minimum": 1},
                    "accent": {"type": "string"},
                },
            },
        },
    },
}


def main() -> int:
    if not SOURCES.is_dir():
        print(f"error: {SOURCES} not found", file=sys.stderr)
        return 1

    # Wipe and recreate outputs so stale bundles can't linger.
    if OUT_ROOT.exists():
        shutil.rmtree(OUT_ROOT)
    OUT_BUNDLES.mkdir(parents=True, exist_ok=True)
    OUT_ICONS.mkdir(parents=True, exist_ok=True)
    OUT_CARDS.mkdir(parents=True, exist_ok=True)

    all_rows: list[dict] = []

    scenes_dir = SOURCES / "scenes"
    if scenes_dir.is_dir():
        for folder in sorted(scenes_dir.iterdir()):
            if not folder.is_dir():
                continue
            all_rows.append(build_scene(folder.name, folder))

    iconsets_dir = SOURCES / "icon-sets"
    if iconsets_dir.is_dir():
        for folder in sorted(iconsets_dir.iterdir()):
            if not folder.is_dir():
                continue
            all_rows.append(build_iconset(folder.name, folder))

    cursorsets_dir = SOURCES / "cursor-sets"
    if cursorsets_dir.is_dir():
        for folder in sorted(cursorsets_dir.iterdir()):
            if not folder.is_dir():
                continue
            all_rows.append(build_cursorset(folder.name, folder))

    widgets_dir = SOURCES / "widgets"
    if widgets_dir.is_dir():
        for folder in sorted(widgets_dir.iterdir()):
            if not folder.is_dir():
                continue
            all_rows.append(build_widget(folder.name, folder))

    apps_dir = SOURCES / "apps"
    if apps_dir.is_dir():
        for folder in sorted(apps_dir.iterdir()):
            if not folder.is_dir():
                continue
            all_rows.append(build_app(folder.name, folder))

    starter_path = SOURCES / "starter-pack.json"
    starter = json.loads(starter_path.read_text()) if starter_path.is_file() else {}

    registry = {
        "$schema": SCHEMA_URL,
        "version": 1,
        # Deterministic by default; CI sets ODD_CATALOG_GENERATED_AT for stamped releases.
        "generated_at": "",
        "starter_pack": {
            "scenes": starter.get("scenes", []),
            "iconSets": starter.get("iconSets", []),
            "cursorSets": starter.get("cursorSets", []),
            "widgets": starter.get("widgets", []),
            "apps": starter.get("apps", []),
        },
        "bundles": all_rows,
    }

    (OUT_ROOT / "registry.json").write_text(
        json.dumps(registry, indent=2) + "\n"
    )
    (OUT_ROOT / "registry.schema.json").write_text(
        json.dumps(SCHEMA, indent=2) + "\n"
    )

    # Frozen in-plugin fallback. When the shipped plugin boots on a
    # site with no network (Playground demo without outbound access,
    # air-gapped WordPress, or a temporary catalog host outage), this
    # file is the last-resort source for the registry. See
    # odd/includes/content/catalog-fallback.php. Kept byte-identical
    # to the published registry so determinism checks still pass.
    FALLBACK_DIR = REPO / "odd" / "data"
    FALLBACK_DIR.mkdir(parents=True, exist_ok=True)
    (FALLBACK_DIR / "fallback-registry.json").write_text(
        json.dumps(registry, indent=2) + "\n"
    )

    # Summary.
    types: dict[str, int] = {}
    total_size = 0
    for row in all_rows:
        types[row["type"]] = types.get(row["type"], 0) + 1
        total_size += row["size"]
    print("built catalog:")
    for t, n in sorted(types.items()):
        print(f"  {t:<10} {n}")
    print(f"  bundles    {len(all_rows)}")
    print(f"  total size {total_size:,} bytes "
          f"({total_size / (1024 * 1024):.1f} MB)")
    print(f"  out:       {OUT_ROOT.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
