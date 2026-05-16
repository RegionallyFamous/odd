#!/usr/bin/env python3
"""Generate ODD Shop card art with OpenAI Image 2.

Reads catalog source metadata and writes one `card.webp` beside each
source item. The catalog builder publishes those files as `card_url`.

Security:
  - Requires OPENAI_API_KEY in the environment.
  - Never prints or stores the key.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from PIL import Image


HERE = Path(__file__).resolve().parent
REPO = HERE.parent
SOURCES = HERE / "catalog-sources"
SCENE_CARD_SIZE = (1024, 576)

STYLE = """ODD Diorama System: cozy weird polished toy-like desktop surrealism; dark ink-plum base, iris violet, electric cyan, peach glow, acid green details, paper cream highlights; rounded squircle portals, soft bevels, layered cardboard/paper depth, luminous desktop props, subtle eye or portal motifs, tactile grain, rim lighting, soft shadows, tiny magical desktop universe. Square editorial shop card art. No text, no letters, no readable UI, no logos, no WordPress marks, no browser chrome, no people, no horror, no gore, no weapons, no generic corporate SaaS vector art."""


TYPE_NOTES = {
    "scene": "A destination-poster-like miniature world that preserves the wallpaper's subject and mood.",
    "icon-set": "A staged collection of four or five physical app-icon tiles expressing this icon set's material language.",
    "cursor-set": "A glowing pointer tool/creature with motion trails, readable as a cursor set.",
    "widget": "A tactile desktop object version of the widget with one exaggerated feature.",
    "app": "An object-metaphor for what the app does, not a screenshot.",
}


@dataclass(frozen=True)
class Item:
    type: str
    slug: str
    name: str
    description: str
    tags: list[str]
    source_dir: Path

    @property
    def output(self) -> Path:
        return self.source_dir / "card.webp"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text())


def collect_items() -> list[Item]:
    items: list[Item] = []

    for folder in sorted((SOURCES / "scenes").iterdir()):
        if not folder.is_dir():
            continue
        meta = read_json(folder / "meta.json")
        items.append(
            Item(
                type="scene",
                slug=folder.name,
                name=meta.get("label", folder.name),
                description=meta.get("description", ""),
                tags=list(meta.get("tags", [])),
                source_dir=folder,
            )
        )

    for folder in sorted((SOURCES / "icon-sets").iterdir()):
        if not folder.is_dir():
            continue
        meta = read_json(folder / "manifest.json")
        items.append(
            Item(
                type="icon-set",
                slug=folder.name,
                name=meta.get("label", folder.name),
                description=meta.get("description", ""),
                tags=[meta.get("category", ""), meta.get("accent", "")],
                source_dir=folder,
            )
        )

    for folder in sorted((SOURCES / "cursor-sets").iterdir()):
        if not folder.is_dir():
            continue
        meta = read_json(folder / "manifest.json")
        items.append(
            Item(
                type="cursor-set",
                slug=folder.name,
                name=meta.get("label", folder.name),
                description=meta.get("description", ""),
                tags=[meta.get("category", ""), meta.get("accent", "")],
                source_dir=folder,
            )
        )

    for folder in sorted((SOURCES / "widgets").iterdir()):
        if not folder.is_dir():
            continue
        meta = read_json(folder / "manifest.json")
        items.append(
            Item(
                type="widget",
                slug=folder.name,
                name=meta.get("label", folder.name),
                description=meta.get("description", ""),
                tags=[meta.get("category", "")],
                source_dir=folder,
            )
        )

    for folder in sorted((SOURCES / "apps").iterdir()):
        if not folder.is_dir():
            continue
        meta = read_json(folder / "meta.json")
        items.append(
            Item(
                type="app",
                slug=folder.name,
                name=meta.get("name", folder.name),
                description=meta.get("description", ""),
                tags=list(meta.get("tags", [])),
                source_dir=folder,
            )
        )

    return items


def prompt_for(item: Item) -> str:
    tags = ", ".join(t for t in item.tags if t)
    return "\n".join(
        [
            STYLE,
            f"Content type: {item.type}. {TYPE_NOTES[item.type]}",
            f"Item name: {item.name}.",
            f"Slug: {item.slug}.",
            f"Description: {item.description or 'No extra description.'}",
            f"Tags/material hints: {tags or 'ODD original.'}",
            "Make it visually unique for this item while unmistakably belonging to the same ODD Shop family.",
            "Output: one square 1024x1024 WebP card image, no text.",
        ]
    )


def generate_image(api_key: str, model: str, prompt: str) -> bytes:
    payload = json.dumps(
        {
            "model": model,
            "prompt": prompt,
            "size": "1024x1024",
            "output_format": "webp",
            "n": 1,
        }
    ).encode()
    req = urllib.request.Request(
        "https://api.openai.com/v1/images/generations",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as response:
            data = json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"OpenAI image request failed with HTTP {exc.code}: {detail[:800]}") from exc

    b64 = data.get("data", [{}])[0].get("b64_json")
    if not b64:
        raise RuntimeError("OpenAI image response did not include data[0].b64_json")
    return base64.b64decode(b64)


def write_scene_card(item: Item) -> None:
    """Scene cards must be the actual wallpaper, not parallel prompt art."""
    wallpaper = item.source_dir / "wallpaper.webp"
    if not wallpaper.is_file():
        raise RuntimeError(f"{item.type}/{item.slug}: missing wallpaper.webp")
    with Image.open(wallpaper) as src:
        card = src.convert("RGB").resize(SCENE_CARD_SIZE, Image.Resampling.LANCZOS)
    card.save(item.output, "WEBP", quality=88, method=6)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-2"))
    parser.add_argument("--only", action="append", default=[], help="Filter by type or type/slug, e.g. app or scene/aurora")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--sleep", type=float, default=0.2)
    args = parser.parse_args()

    filters = set(args.only)
    items = collect_items()
    if filters:
        items = [
            item
            for item in items
            if item.type in filters or f"{item.type}/{item.slug}" in filters or item.slug in filters
        ]
    if args.limit:
        items = items[: args.limit]

    if args.dry_run:
        for item in items:
            print(f"{item.type}/{item.slug} -> {item.output.relative_to(REPO)}")
            if item.type == "scene":
                print("Derive scene card from wallpaper.webp.")
            else:
                print(prompt_for(item))
            print("---")
        return 0

    needs_api = any(item.type != "scene" for item in items)
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if needs_api and not api_key:
        print("error: OPENAI_API_KEY is not set in the environment", file=sys.stderr)
        return 2

    for index, item in enumerate(items, start=1):
        if item.output.exists() and not args.force:
            print(f"[{index}/{len(items)}] skip {item.type}/{item.slug} (card.webp exists)")
            continue
        if item.type == "scene":
            print(f"[{index}/{len(items)}] derive {item.type}/{item.slug} from wallpaper.webp")
            write_scene_card(item)
            continue
        print(f"[{index}/{len(items)}] generate {item.type}/{item.slug}")
        image = generate_image(api_key, args.model, prompt_for(item))
        item.output.write_bytes(image)
        if args.sleep:
            time.sleep(args.sleep)

    return 0


if __name__ == "__main__":
    sys.exit(main())
