"""Regression coverage for catalog builds outside the repository."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


REPO = Path(__file__).resolve().parents[3]
BUILD = REPO / "_tools" / "build-catalog.py"
WORKBENCH = REPO / "_tools" / "catalog-sources" / "apps" / "workbench"


def is_repo_path(path: Path) -> bool:
    try:
        path.resolve().relative_to(REPO.resolve())
    except ValueError:
        return False
    return True


def external_temp_base() -> Path | None:
    try:
        default_temp = tempfile.gettempdir()
    except FileNotFoundError:
        default_temp = None
    candidates = [
        os.environ.get("TMPDIR"),
        default_temp,
        os.environ.get("RUNNER_TEMP"),
        os.environ.get("TEMP"),
        os.environ.get("TMP"),
        "/tmp",
        "/var/tmp",
    ]
    if os.name == "nt" and os.environ.get("SystemRoot"):
        candidates.append(str(Path(os.environ["SystemRoot"]) / "Temp"))

    seen: set[Path] = set()
    for raw in candidates:
        if not raw:
            continue
        try:
            candidate = Path(raw).expanduser().resolve()
        except (OSError, RuntimeError):
            continue
        if candidate in seen or is_repo_path(candidate):
            continue
        seen.add(candidate)
        try:
            with tempfile.TemporaryDirectory(dir=candidate):
                pass
        except OSError:
            continue
        return candidate
    return None


class BuildCatalogOutputTest(unittest.TestCase):
    def test_repo_local_tmpdir_is_ignored(self) -> None:
        with mock.patch.dict(os.environ, {"TMPDIR": str(REPO)}):
            base = external_temp_base()
        if base is None:
            self.skipTest("no writable temporary directory exists outside the repository")
        self.assertFalse(is_repo_path(base))

    def test_external_output_and_fallback_paths_are_reported(self) -> None:
        base = external_temp_base()
        if base is None:
            self.skipTest("no writable temporary directory exists outside the repository")

        with tempfile.TemporaryDirectory(dir=base) as directory:
            root = Path(directory).resolve()
            source = root / "catalog-sources"
            app_root = source / "apps"
            output = root / "odd-e2e-catalog" / "v1"
            fallback = root / "fallback-registry.json"

            app_root.mkdir(parents=True)
            shutil.copytree(WORKBENCH, app_root / "workbench")
            (source / "catalog.json").write_text(
                json.dumps({"apps": ["workbench"]}),
                encoding="utf-8",
            )

            with self.assertRaises(ValueError):
                output.relative_to(REPO)

            env = dict(os.environ)
            env.update(
                {
                    "ODD_CATALOG_SOURCE_ROOT": str(source),
                    "ODD_CATALOG_OUT_ROOT": str(output),
                    "ODD_CATALOG_WRITE_FALLBACK": "1",
                    "ODD_CATALOG_FALLBACK_REGISTRY": str(fallback),
                    "ODD_CATALOG_GENERATED_AT": "",
                    "ODD_CATALOG_SIGNING_KEY": "",
                    "ODD_CATALOG_REQUIRE_SIGNATURE": "0",
                }
            )
            result = subprocess.run(
                [sys.executable, str(BUILD)],
                cwd=REPO,
                env=env,
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertEqual(0, result.returncode, result.stderr)
            self.assertIn(f"registry: {output / 'registry.json'}", result.stdout)
            self.assertIn(f"schema:   {output / 'registry.schema.json'}", result.stdout)
            self.assertIn(f"fallback: {fallback}", result.stdout)
            self.assertTrue((output / "registry.json").is_file())
            self.assertTrue((output / "registry.schema.json").is_file())
            self.assertTrue(fallback.is_file())


if __name__ == "__main__":
    unittest.main()
