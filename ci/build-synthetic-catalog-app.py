#!/usr/bin/env python3
"""Append a run-specific synthetic app to a hermetic E2E catalog."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import secrets
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw


FIXED_DATE = (2025, 1, 1, 0, 0, 0)


def write_zip(path: Path, files: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(files):
            info = zipfile.ZipInfo(name, FIXED_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, files[name])


def write_art(root: Path, slug: str) -> tuple[str, int]:
    icon = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    draw = ImageDraw.Draw(icon)
    draw.rounded_rectangle((18, 18, 238, 238), radius=46, fill=(244, 244, 245, 255))
    draw.rectangle((78, 70, 178, 88), fill=(0, 0, 0, 0))
    draw.rectangle((78, 119, 178, 137), fill=(0, 0, 0, 0))
    draw.rectangle((78, 168, 178, 186), fill=(0, 0, 0, 0))
    icon_path = root / "icons" / f"{slug}.webp"
    icon.save(icon_path, "WEBP", lossless=True, method=6)

    card = Image.new("RGB", (1024, 576), (17, 18, 28))
    card_draw = ImageDraw.Draw(card)
    for x in range(0, 1024, 64):
        card_draw.line((x, 0, x, 576), fill=(35, 38, 56), width=1)
    for y in range(0, 576, 64):
        card_draw.line((0, y, 1024, y), fill=(35, 38, 56), width=1)
    card_draw.rounded_rectangle((362, 138, 662, 438), radius=64, fill=(244, 244, 245), outline=(10, 11, 16), width=18)
    for y in (224, 288, 352):
        card_draw.rounded_rectangle((430, y, 594, y + 22), radius=11, fill=(17, 18, 28))
    card_path = root / "cards" / f"app-{slug}.webp"
    card.save(card_path, "WEBP", quality=88, method=6)
    return icon_path.name, card_path.stat().st_size


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--base-url", default="https://fixture.invalid/catalog/v1")
    parser.add_argument("--id", default="")
    args = parser.parse_args()

    root = args.catalog_root.resolve()
    registry_path = root / "registry.json"
    if not registry_path.is_file():
        raise SystemExit(f"synthetic catalog registry is missing: {registry_path}")
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    if not isinstance(registry, dict) or not isinstance(registry.get("bundles"), list):
        raise SystemExit("synthetic catalog registry must contain a bundles array")

    identifier = re.sub(r"[^a-z0-9-]+", "-", args.id.lower()).strip("-")
    identifier = (identifier or secrets.token_hex(4))[:24].rstrip("-")
    slug = f"catalog-canary-{identifier}"
    if any(row.get("slug") == slug for row in registry["bundles"] if isinstance(row, dict)):
        raise SystemExit(f"synthetic catalog slug already exists: {slug}")

    for directory in (root / "bundles", root / "icons", root / "cards"):
        directory.mkdir(parents=True, exist_ok=True)

    manifest = {
        "type": "app",
        "name": "Catalog Canary",
        "slug": slug,
        "version": "1.0.0",
        "author": "ODD E2E",
        "description": "A run-specific app proving new catalog slugs install without a plugin release.",
        "icon": "icon.svg",
        "entry": "index.html",
        "capability": "manage_options",
        "window": {
            "title": "Catalog Canary",
            "width": 640,
            "height": 440,
            "minWidth": 320,
            "minHeight": 240,
            "resizable": True,
        },
        "surfaces": {"desktop": True, "taskbar": False},
    }
    icon_svg = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#f4f4f5" d="M5 5h54v54H5zM16 18h32v5H16zm0 12h32v5H16zm0 12h32v5H16z"/></svg>'
    index_html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Catalog Canary</title>
<style>html,body{{height:100%;margin:0}}body{{display:grid;place-items:center;background:#11121c;color:#f4f4f5;font:600 20px system-ui}}main{{padding:32px;border:2px solid currentColor;border-radius:20px}}</style></head>
<body><main data-catalog-canary="{slug}">New catalog slug is running.</main></body></html>
""".encode("utf-8")
    bundle_path = root / "bundles" / f"{slug}.wp"
    write_zip(
        bundle_path,
        {
            "icon.svg": icon_svg,
            "index.html": index_html,
            "manifest.json": (json.dumps(manifest, indent=2) + "\n").encode("utf-8"),
        },
    )
    icon_name, card_bytes = write_art(root, slug)
    base_url = args.base_url.rstrip("/")
    registry["bundles"].append(
        {
            "type": "app",
            "slug": slug,
            "name": "Catalog Canary",
            "version": "1.0.0",
            "author": "ODD E2E",
            "description": "A run-specific app proving new catalog slugs install without a plugin release.",
            "tags": ["e2e", "catalog", "canary"],
            "icon_url": f"{base_url}/icons/{icon_name}",
            "card_url": f"{base_url}/cards/app-{slug}.webp",
            "card_bytes": card_bytes,
            "download_url": f"{base_url}/bundles/{slug}.wp",
            "sha256": hashlib.sha256(bundle_path.read_bytes()).hexdigest(),
            "size": bundle_path.stat().st_size,
            "department": "apps",
            "search_text": f"app {slug} catalog canary e2e apps",
            "search_tokens": ["app", slug, "catalog", "canary", "e2e", "apps"],
            "requires": {"odd": "1.0.0", "openStation": "1.1.0", "api": "1.0.0"},
        }
    )
    registry_path.write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    signature = root / "registry.json.sig"
    if signature.exists():
        signature.unlink()
    print(slug)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
