"""Canonical JSON Schema validation for ODD app manifests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator


REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = REPO_ROOT / "docs" / "schemas" / "manifest.schema.json"


def load_schema() -> dict[str, Any]:
    value = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("manifest schema must be a JSON object")
    Draft202012Validator.check_schema(value)
    return value


VALIDATOR = Draft202012Validator(load_schema())


def _has_parent_component(value: object) -> bool:
    return isinstance(value, str) and ".." in value.split("/")


def validate_manifest(manifest: object) -> list[str]:
    """Return deterministic, human-readable problems for one manifest."""
    problems: list[str] = []
    for error in sorted(VALIDATOR.iter_errors(manifest), key=lambda item: list(item.path)):
        location = "/".join(str(part) for part in error.absolute_path) or "(root)"
        problems.append(f"{location}: {error.message}")

    if not isinstance(manifest, dict):
        return problems

    for field in ("entry", "icon"):
        if _has_parent_component(manifest.get(field)):
            problems.append(f"{field}: path must not contain a parent-directory component")

    native_paths = manifest.get("native")
    if isinstance(native_paths, dict):
        for field in ("script", "style"):
            if _has_parent_component(native_paths.get(field)):
                problems.append(
                    f"native/{field}: path must not contain a parent-directory component"
                )

    window = manifest.get("window")
    if isinstance(window, dict):
        width = window.get("width")
        min_width = window.get("minWidth", window.get("min_width"))
        height = window.get("height")
        min_height = window.get("minHeight", window.get("min_height"))
        if isinstance(width, int) and isinstance(min_width, int) and min_width > width:
            problems.append("window/minWidth: must not exceed window/width")
        if isinstance(height, int) and isinstance(min_height, int) and min_height > height:
            problems.append("window/minHeight: must not exceed window/height")

    native = manifest.get("native")
    if isinstance(native, dict):
        if manifest.get("slug") != "odd-notes":
            problems.append("native: only odd-notes may declare a native surface")
        elif "template" in native and native.get("template") != "odd-notes":
            problems.append("native/template: odd-notes must use the odd-notes template")

    return problems
