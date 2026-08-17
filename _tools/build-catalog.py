#!/usr/bin/env python3
"""Build the deterministic, Apps-only ODD catalog."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import shutil
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from PIL import Image


HERE = Path(__file__).resolve().parent
REPO = HERE.parent


def repo_path_from_env(name: str, default: Path) -> Path:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    path = Path(raw)
    return path if path.is_absolute() else REPO / path


SOURCES = repo_path_from_env("ODD_CATALOG_SOURCE_ROOT", HERE / "catalog-sources")
OUT_ROOT = repo_path_from_env("ODD_CATALOG_OUT_ROOT", REPO / "site" / "catalog" / "v1")
OUT_BUNDLES = OUT_ROOT / "bundles"
OUT_ICONS = OUT_ROOT / "icons"
OUT_CARDS = OUT_ROOT / "cards"
REGISTRY_JSON = OUT_ROOT / "registry.json"
REGISTRY_SIG = OUT_ROOT / "registry.json.sig"
FALLBACK_REGISTRY = repo_path_from_env(
    "ODD_CATALOG_FALLBACK_REGISTRY",
    REPO / "odd" / "data" / "fallback-registry.json",
)
WRITE_FALLBACK = os.environ.get("ODD_CATALOG_WRITE_FALLBACK", "1") != "0"
CATALOG_CHANNEL = (os.environ.get("ODD_CATALOG_CHANNEL") or "stable").strip().lower()
CATALOG_BASE = (
    os.environ.get("ODD_CATALOG_BASE_URL")
    or "https://odd.regionallyfamous.com/catalog/v1"
).rstrip("/")
SCHEMA_URL = f"{CATALOG_BASE}/registry.schema.json"

FIXED_DATE = (2025, 1, 1, 0, 0, 0)
SEMVER_RE = re.compile(
    r"^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$"
)
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
ASSET_PATH_RE = re.compile(r"^[a-zA-Z0-9._-]+(?:/[a-zA-Z0-9._-]+)*$")
REQUIRES_KEYS = {"odd", "openStation", "api"}
CHANNELS = {"stable", "preview", "all"}
MANIFEST_KEYS = {
    "$schema", "author", "capability", "description", "desktopIcon", "entry",
    "icon", "name", "native", "slug", "surfaces", "type", "version", "window",
}
FORBIDDEN_EXTENSIONS = {
    "bash", "cgi", "phar", "php", "php3", "php4", "php5", "php7",
    "phps", "phtml", "pl", "py", "rb", "sh",
}
MAX_APP_FILES = 2000
MAX_APP_BYTES = 25 * 1024 * 1024
MAX_ICON_BYTES = 768 * 1024
MIN_ICON_DIMENSION = 64
MAX_ICON_DIMENSION = 2048
MIN_VISIBLE_ICON_FILL = 0.80
MIN_TRANSPARENT_EDGE_RATIO = 0.90
VISIBLE_ALPHA = 32
CARD_SIZE = (1024, 576)
MAX_CARD_BYTES = 320 * 1024
SVG_ALLOWED_ELEMENTS = {
    "circle", "clipPath", "defs", "desc", "ellipse", "feDropShadow", "filter", "g", "line",
    "linearGradient", "mask", "path", "polygon", "polyline", "radialGradient",
    "rect", "stop", "svg", "title",
}
SVG_ALLOWED_ATTRIBUTES = {
    "aria-label", "aria-labelledby", "class", "clip-path", "clip-rule", "cx", "cy", "d", "dx", "dy",
    "fill", "fill-opacity", "fill-rule", "filter", "flood-color", "flood-opacity", "gradientTransform", "gradientUnits",
    "height", "id", "mask", "offset", "opacity", "points", "r", "role", "rx",
    "ry", "stdDeviation", "stop-color", "stop-opacity", "stroke", "stroke-dasharray",
    "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
    "stroke-opacity", "stroke-width", "transform", "viewBox", "width", "x", "x1",
    "x2", "xmlns", "y", "y1", "y2",
}


def fail(message: str) -> None:
    raise SystemExit(message)


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text())
    except FileNotFoundError:
        fail(f"{label}: missing {path.name}")
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        fail(f"{label}: invalid {path.name}: {exc}")
    if not isinstance(value, dict):
        fail(f"{label}: {path.name} must contain a JSON object")
    return value


def app_channel(meta: dict) -> str:
    raw = str(meta.get("catalog_channel") or meta.get("channel") or "stable").lower()
    aliases = {
        "draft": "preview", "live": "stable", "main": "stable",
        "preview": "preview", "production": "stable", "stable": "stable",
        "test": "preview",
    }
    channel = aliases.get(raw)
    if channel is None:
        fail(f"unsupported catalog channel {raw!r}")
    return channel


def channel_included(channel: str) -> bool:
    if CATALOG_CHANNEL not in CHANNELS:
        fail(f"ODD_CATALOG_CHANNEL must be one of {sorted(CHANNELS)}")
    if CATALOG_CHANNEL == "all":
        return True
    if CATALOG_CHANNEL == "preview":
        return channel in {"stable", "preview"}
    return channel == "stable"


def selected_apps() -> list[str]:
    config = load_json(SOURCES / "catalog.json", "catalog")
    if set(config) != {"apps"}:
        fail("catalog.json may contain only the Apps-only 'apps' key")
    values = config["apps"]
    if not isinstance(values, list) or not values:
        fail("catalog.json apps must be a non-empty array")
    if any(not isinstance(value, str) or not SLUG_RE.fullmatch(value) for value in values):
        fail("catalog.json contains an invalid app slug")
    if len(values) != len(set(values)):
        fail("catalog.json contains a duplicate app slug")
    return values


def catalog_requires(meta: dict, label: str) -> dict[str, str]:
    raw = meta.get("requires") or {}
    if not isinstance(raw, dict):
        fail(f"{label}: requires must be an object")
    if set(raw).difference(REQUIRES_KEYS):
        fail(f"{label}: requires contains an unsupported key")
    for key, value in raw.items():
        if not isinstance(value, str) or not SEMVER_RE.fullmatch(value):
            fail(f"{label}: requires.{key} must be a semantic version")
    return dict(raw)


def signing_key():
    raw = (os.environ.get("ODD_CATALOG_SIGNING_KEY") or "").strip()
    if not raw:
        if os.environ.get("ODD_CATALOG_REQUIRE_SIGNATURE") == "1":
            fail("ODD_CATALOG_SIGNING_KEY is required")
        return None
    try:
        key_bytes = base64.b64decode(raw, validate=True)
    except Exception as exc:
        fail(f"ODD_CATALOG_SIGNING_KEY is invalid base64: {exc}")
    if len(key_bytes) == 64:
        key_bytes = key_bytes[:32]
    if len(key_bytes) != 32:
        fail("ODD_CATALOG_SIGNING_KEY must decode to 32 or 64 bytes")
    try:
        from nacl.signing import SigningKey
    except Exception as exc:
        fail(f"PyNaCl is required when catalog signing is enabled: {exc}")
    return SigningKey(key_bytes)


def write_signature(body: bytes) -> None:
    key = signing_key()
    if key is None:
        return
    REGISTRY_SIG.write_text(base64.b64encode(key.sign(body).signature).decode("ascii") + "\n")


def safe_bundle_files(source: Path, label: str) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    total = 0
    for path in sorted(source.rglob("*")):
        if path.is_symlink():
            fail(f"{label}: symlinks are forbidden ({path.name})")
        if not path.is_file():
            continue
        rel = path.relative_to(source).as_posix()
        if path.name == ".DS_Store" or path.name.startswith("."):
            fail(f"{label}: hidden files are forbidden ({rel})")
        if not ASSET_PATH_RE.fullmatch(rel) or ".." in Path(rel).parts:
            fail(f"{label}: unsafe bundle path {rel!r}")
        if path.suffix.lower().lstrip(".") in FORBIDDEN_EXTENSIONS:
            fail(f"{label}: server-executable file is forbidden ({rel})")
        data = path.read_bytes()
        if path.suffix.lower() in {".js", ".mjs"}:
            source_text = data.decode("utf-8", errors="replace")
            if re.search(r"\b(?:navigator\.)?serviceWorker\b", source_text):
                fail(f"{label}: service-worker code is not allowed in {rel}")
            bare_import = re.search(
                r"\b(?:from\s*|import\s*)(?:\([^)]*)?['\"](?![./]|https?://)([^'\"]+)['\"]",
                source_text,
            )
            if bare_import:
                fail(
                    f"{label}: browser bundle contains unresolved module import "
                    f"{bare_import.group(1)!r} in {rel}"
                )
        total += len(data)
        files[rel] = data
    if not files:
        fail(f"{label}: bundle-src is empty")
    if len(files) > MAX_APP_FILES:
        fail(f"{label}: bundle exceeds {MAX_APP_FILES} files")
    if total > MAX_APP_BYTES:
        fail(f"{label}: bundle exceeds {MAX_APP_BYTES} uncompressed bytes")
    return files


def write_zip(dest: Path, files: dict[str, bytes]) -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(files):
            info = zipfile.ZipInfo(name, FIXED_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, files[name])
    dest.write_bytes(buffer.getvalue())


def local_name(name: str) -> str:
    return name.split("}", 1)[-1] if name.startswith("{") else name


def validate_svg(data: bytes, label: str) -> None:
    if len(data) > MAX_ICON_BYTES:
        fail(f"{label}: SVG exceeds {MAX_ICON_BYTES} bytes")
    try:
        root = ET.fromstring(data.decode("utf-8"))
    except (UnicodeDecodeError, ET.ParseError) as exc:
        fail(f"{label}: invalid SVG: {exc}")
    if local_name(root.tag) != "svg" or not root.attrib.get("viewBox"):
        fail(f"{label}: SVG requires an svg root and viewBox")
    for node in root.iter():
        tag = local_name(node.tag)
        if tag not in SVG_ALLOWED_ELEMENTS:
            fail(f"{label}: disallowed SVG element <{tag}>")
        for raw_name, raw_value in node.attrib.items():
            name = local_name(raw_name)
            value = str(raw_value).strip()
            if name.lower().startswith("on") or name not in SVG_ALLOWED_ATTRIBUTES:
                fail(f"{label}: disallowed SVG attribute {name!r}")
            has_unsafe_scheme = re.search(r"(?:javascript|data|vbscript)\s*:", value, re.I)
            has_external_url = "url(" in value.lower() and not re.fullmatch(
                r"url\(\s*#[A-Za-z0-9._-]+\s*\)", value, re.I
            )
            if has_unsafe_scheme or has_external_url:
                fail(f"{label}: external or scriptable SVG value is forbidden")


def alpha_fill(image: Image.Image) -> float | None:
    mask = image.getchannel("A").point(lambda value: 255 if value >= VISIBLE_ALPHA else 0)
    box = mask.getbbox()
    if box is None:
        return None
    return max(box[2] - box[0], box[3] - box[1]) / max(image.size)


def transparent_edge_ratio(image: Image.Image) -> float:
    alpha = image.getchannel("A")
    width, height = image.size
    edge = [alpha.getpixel((x, y)) for x in range(width) for y in (0, height - 1)]
    edge += [alpha.getpixel((x, y)) for y in range(height) for x in (0, width - 1)]
    return sum(value < VISIBLE_ALPHA for value in edge) / len(edge)


def validate_raster_icon(data: bytes, suffix: str, label: str) -> None:
    if len(data) > MAX_ICON_BYTES:
        fail(f"{label}: icon exceeds {MAX_ICON_BYTES} bytes")
    expected = {".png": "PNG", ".webp": "WEBP"}.get(suffix.lower())
    if expected is None:
        fail(f"{label}: icon must be SVG, PNG, or WebP")
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.verify()
        with Image.open(io.BytesIO(data)) as image:
            if image.format != expected:
                fail(f"{label}: extension does not match image format")
            if image.width != image.height:
                fail(f"{label}: icon must be square")
            if not MIN_ICON_DIMENSION <= image.width <= MAX_ICON_DIMENSION:
                fail(f"{label}: icon dimensions are outside the supported range")
            rgba = image.convert("RGBA")
    except (OSError, SyntaxError) as exc:
        fail(f"{label}: invalid raster icon: {exc}")
    fill = alpha_fill(rgba)
    if fill is None or fill < MIN_VISIBLE_ICON_FILL:
        fail(f"{label}: visible icon fill is too small")
    if transparent_edge_ratio(rgba) < MIN_TRANSPARENT_EDGE_RATIO:
        fail(f"{label}: app icon needs transparent edges")


def validate_icon(data: bytes, name: str, label: str) -> None:
    if Path(name).suffix.lower() == ".svg":
        validate_svg(data, label)
    else:
        validate_raster_icon(data, Path(name).suffix, label)


def validate_manifest(manifest: dict, meta: dict, slug: str, files: dict[str, bytes]) -> None:
    label = f"app {slug}"
    unknown = set(manifest).difference(MANIFEST_KEYS)
    if unknown:
        fail(f"{label}: manifest contains unsupported keys: {sorted(unknown)}")
    required = {"type", "slug", "name", "version", "entry", "icon"}
    if required.difference(manifest):
        fail(f"{label}: manifest is missing required fields")
    if manifest["type"] != "app" or manifest["slug"] != slug:
        fail(f"{label}: manifest type and slug must match the Apps-only source")
    if meta.get("slug") != slug or meta.get("version") != manifest.get("version"):
        fail(f"{label}: meta.json and manifest.json must agree on slug and version")
    if not isinstance(manifest["name"], str) or not manifest["name"].strip():
        fail(f"{label}: manifest name must be non-empty")
    if not isinstance(manifest["version"], str) or not SEMVER_RE.fullmatch(manifest["version"]):
        fail(f"{label}: manifest version must be semantic")
    for key in ("entry", "icon"):
        value = manifest[key]
        if not isinstance(value, str) or not ASSET_PATH_RE.fullmatch(value) or value not in files:
            fail(f"{label}: manifest {key} must name a bundled relative file")
    validate_icon(files[manifest["icon"]], manifest["icon"], f"{label} manifest icon")
    if Path(manifest["entry"]).suffix.lower() in {".html", ".htm"}:
        html = files[manifest["entry"]].decode("utf-8", errors="replace")
        if re.search(r"<base\b", html, re.I):
            fail(f"{label}: app entry may not override the document base URL")
        for reference in re.findall(r"(?:src|href)\s*=\s*['\"]([^'\"]+)['\"]", html, re.I):
            if reference.startswith(("data:", "#")):
                continue
            if reference.startswith(("http://", "https://", "//", "/")):
                fail(f"{label}: app entry contains a non-local asset reference {reference!r}")
            clean = reference.split("?", 1)[0].split("#", 1)[0]
            parts = [part for part in clean.split("/") if part not in {"", "."}]
            if ".." in parts or "/".join(parts) not in files:
                fail(f"{label}: app entry references a missing or unsafe asset {reference!r}")


def publish_card(source: Path, slug: str) -> tuple[str, int]:
    card = source / "card.webp"
    if not card.is_file():
        fail(f"app {slug}: card.webp is required")
    if card.stat().st_size > MAX_CARD_BYTES:
        fail(f"app {slug}: card.webp exceeds {MAX_CARD_BYTES} bytes")
    try:
        with Image.open(card) as image:
            image.verify()
        with Image.open(card) as image:
            if image.format != "WEBP" or image.size != CARD_SIZE:
                fail(f"app {slug}: card.webp must be a {CARD_SIZE[0]}x{CARD_SIZE[1]} WebP")
    except (OSError, SyntaxError) as exc:
        fail(f"app {slug}: invalid card.webp: {exc}")
    name = f"app-{slug}.webp"
    shutil.copy2(card, OUT_CARDS / name)
    return f"{CATALOG_BASE}/cards/{name}", card.stat().st_size


def hash_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def search_fields(row: dict) -> None:
    text = " ".join(
        str(value) for value in (
            row.get("type"), row.get("slug"), row.get("name"), row.get("author"),
            row.get("description"), row.get("tags"), row.get("requires"), "apps",
        )
    ).lower()
    tokens = []
    for token in re.findall(r"[a-z0-9][a-z0-9-]*", text):
        if token not in tokens:
            tokens.append(token)
    row["department"] = "apps"
    row["search_text"] = " ".join(tokens)
    row["search_tokens"] = tokens[:96]


def build_app(slug: str) -> dict:
    source = SOURCES / "apps" / slug
    label = f"app {slug}"
    if not source.is_dir():
        fail(f"{label}: source directory is missing")
    meta = load_json(source / "meta.json", label)
    if not channel_included(app_channel(meta)):
        return {}
    bundle_source = source / "bundle-src"
    if not bundle_source.is_dir():
        fail(f"{label}: bundle-src is required; prebuilt bundle.wp inputs are not accepted")
    files = safe_bundle_files(bundle_source, label)
    try:
        manifest = json.loads(files["manifest.json"])
    except KeyError:
        fail(f"{label}: manifest.json is required")
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        fail(f"{label}: invalid manifest.json: {exc}")
    if not isinstance(manifest, dict):
        fail(f"{label}: manifest.json must be an object")
    validate_manifest(manifest, meta, slug, files)

    bundle = OUT_BUNDLES / f"{slug}.wp"
    write_zip(bundle, files)

    source_icon = next(
        (source / name for name in ("icon.webp", "icon.png", "icon.svg") if (source / name).is_file()),
        None,
    )
    if source_icon is None:
        fail(f"{label}: a catalog icon is required")
    icon_data = source_icon.read_bytes()
    validate_icon(icon_data, source_icon.name, f"{label} catalog icon")
    icon_name = f"{slug}{source_icon.suffix.lower()}"
    (OUT_ICONS / icon_name).write_bytes(icon_data)
    card_url, card_bytes = publish_card(source, slug)

    row = {
        "type": "app",
        "slug": slug,
        "name": str(meta.get("name") or "").strip(),
        "version": str(meta.get("version") or ""),
        "author": str(meta.get("author") or "Regionally Famous"),
        "description": str(meta.get("description") or ""),
        "tags": meta.get("tags") if isinstance(meta.get("tags"), list) else [],
        "icon_url": f"{CATALOG_BASE}/icons/{icon_name}",
        "card_url": card_url,
        "card_bytes": card_bytes,
        "download_url": f"{CATALOG_BASE}/bundles/{bundle.name}",
        "sha256": hash_file(bundle),
        "size": bundle.stat().st_size,
    }
    if not row["name"]:
        fail(f"{label}: meta.json name is required")
    requires = catalog_requires(meta, label)
    if requires:
        row["requires"] = requires
    channel = app_channel(meta)
    if channel != "stable":
        row["channel"] = channel
    search_fields(row)
    return row


SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "$id": SCHEMA_URL,
    "title": "ODD Apps Catalog Registry",
    "type": "object",
    "additionalProperties": False,
    "required": ["$schema", "version", "generated_at", "bundles"],
    "properties": {
        "$schema": {"type": "string"},
        "version": {"type": "integer", "const": 1},
        "generated_at": {"type": "string"},
        "bundles": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "type", "slug", "name", "version", "author", "description", "tags",
                    "icon_url", "card_url", "card_bytes", "download_url", "sha256", "size",
                    "department", "search_text", "search_tokens",
                ],
                "properties": {
                    "type": {"const": "app"},
                    "slug": {"type": "string", "pattern": SLUG_RE.pattern},
                    "name": {"type": "string", "minLength": 1},
                    "version": {"type": "string", "pattern": SEMVER_RE.pattern},
                    "author": {"type": "string"},
                    "description": {"type": "string"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "channel": {"type": "string", "enum": ["preview"]},
                    "icon_url": {"type": "string"},
                    "card_url": {"type": "string"},
                    "card_bytes": {"type": "integer", "minimum": 1},
                    "download_url": {"type": "string"},
                    "sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                    "size": {"type": "integer", "minimum": 1},
                    "department": {"const": "apps"},
                    "search_text": {"type": "string"},
                    "search_tokens": {"type": "array", "items": {"type": "string"}},
                    "requires": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            key: {"type": "string", "pattern": SEMVER_RE.pattern}
                            for key in sorted(REQUIRES_KEYS)
                        },
                    },
                },
            },
        },
    },
}


def main() -> int:
    if not SOURCES.is_dir():
        print(f"error: {SOURCES} not found", file=sys.stderr)
        return 1

    if OUT_ROOT.exists():
        shutil.rmtree(OUT_ROOT)
    for directory in (OUT_BUNDLES, OUT_ICONS, OUT_CARDS):
        directory.mkdir(parents=True, exist_ok=True)

    rows = [row for slug in selected_apps() if (row := build_app(slug))]
    if not rows:
        fail("catalog must publish at least one app")
    registry = {
        "$schema": SCHEMA_URL,
        "version": 1,
        "generated_at": os.environ.get("ODD_CATALOG_GENERATED_AT", ""),
        "bundles": rows,
    }
    body = (json.dumps(registry, indent=2) + "\n").encode("utf-8")
    REGISTRY_JSON.write_bytes(body)
    write_signature(body)
    (OUT_ROOT / "registry.schema.json").write_text(json.dumps(SCHEMA, indent=2) + "\n")
    if WRITE_FALLBACK:
        FALLBACK_REGISTRY.parent.mkdir(parents=True, exist_ok=True)
        FALLBACK_REGISTRY.write_bytes(body)

    total = sum(row["size"] for row in rows)
    print(f"built catalog: {len(rows)} apps, {total:,} bundle bytes")
    print(f"  registry: {REGISTRY_JSON.relative_to(REPO)}")
    print(f"  schema:   {(OUT_ROOT / 'registry.schema.json').relative_to(REPO)}")
    print(f"  fallback: {FALLBACK_REGISTRY.relative_to(REPO) if WRITE_FALLBACK else 'disabled'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
