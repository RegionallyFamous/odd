#!/usr/bin/env python3
"""Keep every first-party app represented on an evergreen, scalable site shelf."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOG_ROOT = ROOT / "_tools" / "catalog-sources"
README = ROOT / "README.md"
SITE = ROOT / "site" / "index.html"
STYLES = ROOT / "site" / "styles.css"
PUBLIC_TEXT_SUFFIXES = {".html", ".js", ".json", ".md", ".php", ".ts", ".tsx"}


def main() -> int:
    problems: list[str] = []
    catalog = json.loads((CATALOG_ROOT / "catalog.json").read_text(encoding="utf-8"))
    slugs = catalog.get("apps") or []
    readme = README.read_text(encoding="utf-8")
    site = SITE.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")

    for slug in slugs:
        meta_path = CATALOG_ROOT / "apps" / slug / "meta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        name = str(meta.get("name") or "").strip()
        if not name.startswith("ODD "):
            problems.append(f"{slug}: public app name must start with 'ODD '")

        site_marker = f'data-odd-app="{slug}"'
        if site.count(site_marker) != 1:
            problems.append(f"site/index.html must contain exactly one {site_marker}")
        if name and name not in site:
            problems.append(f"site/index.html must name {name}")

    if "<!-- odd-app:" in readme:
        problems.append(
            "README.md must stay evergreen instead of duplicating the live app inventory"
        )

    shelf_rule = re.search(
        r"\.catalog-section\s+\.app-grid\s*\{(?P<body>[^}]*)\}", styles, re.S
    )
    if not shelf_rule or not re.search(
        r"grid-column\s*:\s*1\s*/\s*-1\s*;", shelf_rule.group("body")
    ):
        problems.append(
            "site/styles.css must let the catalog app grid span the full shelf width"
        )

    grid_rule = re.search(r"(?m)^\.app-grid\s*\{(?P<body>[^}]*)\}", styles, re.S)
    if not grid_rule or not re.search(
        r"grid-template-columns\s*:\s*repeat\(\s*auto-fill\s*,",
        grid_rule.group("body"),
    ):
        problems.append(
            "site/styles.css must keep the app shelf as a responsive multi-column grid"
        )

    public_files = [README, SITE]
    public_files.extend(
        path
        for path in (CATALOG_ROOT / "apps").rglob("*")
        if path.is_file() and path.suffix.lower() in PUBLIC_TEXT_SUFFIXES
    )
    for path in public_files:
        text = path.read_text(encoding="utf-8", errors="replace")
        if re.search(r"\bWordpress\b", text):
            problems.append(
                f"{path.relative_to(ROOT)}: use the official 'WordPress' capitalization"
            )

    if problems:
        for problem in problems:
            print(f"error: {problem}", file=sys.stderr)
        return 1

    print(
        f"App site contract ok: {len(slugs)} catalog apps represented in site/index.html"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
