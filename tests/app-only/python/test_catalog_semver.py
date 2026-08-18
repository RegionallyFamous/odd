"""Strict SemVer guardrails shared by catalog build and validation."""

from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from importlib.machinery import SourceFileLoader
from pathlib import Path


REPO = Path(__file__).resolve().parents[3]
TOOLS = REPO / "_tools"
sys.path.insert(0, str(TOOLS))

from semver_validation import STRICT_SEMVER_RE, is_strict_semver


def load_module(name: str, path: Path):
    loader = SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    if spec is None:
        raise RuntimeError(f"could not load {path}")
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class CatalogSemverTest(unittest.TestCase):
    def test_strict_semver_positive_and_negative_identifiers(self) -> None:
        for version in ("0.0.0", "1.2.3-alpha.1", "1.2.3-0", "1.2.3-alpha-1+build.01"):
            with self.subTest(version=version):
                self.assertTrue(is_strict_semver(version))
        for version in (
            "01.0.0",
            "1.0.0-",
            "1.0.0-alpha..1",
            "1.0.0-01",
            "1.0.0+build..1",
        ):
            with self.subTest(version=version):
                self.assertFalse(is_strict_semver(version))

    def test_builder_and_validator_share_the_strict_expression(self) -> None:
        builder = load_module("odd_build_catalog_semver_test", TOOLS / "build-catalog.py")
        validator = load_module("odd_validate_catalog_semver_test", REPO / "odd" / "bin" / "validate-catalog")
        self.assertIs(STRICT_SEMVER_RE, builder.SEMVER_RE)
        self.assertIs(STRICT_SEMVER_RE, validator.SEMVER_RE)

        valid = {"odd": "1.1.0", "openStation": "1.1.0-rc.1", "api": "1.0.0+build.01"}
        self.assertEqual(valid, builder.catalog_requires({"requires": valid}, "fixture"))
        for version in ("1.0.0-alpha..1", "1.0.0-01", "1.0.0+build..1"):
            with self.subTest(version=version):
                invalid = {**valid, "api": version}
                with self.assertRaises(SystemExit):
                    builder.catalog_requires({"requires": invalid}, "fixture")

    def test_validator_enforces_strict_requires_versions(self) -> None:
        validator = load_module("odd_validate_catalog_requires_test", REPO / "odd" / "bin" / "validate-catalog")
        row = {
            "type": "app",
            "slug": "semver-fixture",
            "name": "SemVer Fixture",
            "version": "1.0.0",
            "author": "ODD",
            "description": "SemVer validation fixture.",
            "tags": [],
            "icon_url": "file:///missing-icon.svg",
            "card_url": "file:///missing-card.svg",
            "card_bytes": 0,
            "download_url": "file:///missing-app.wp",
            "sha256": "a" * 64,
            "size": 0,
            "department": "apps",
            "search_text": "",
            "search_tokens": [],
            "requires": {"odd": "1.0.0", "openStation": "1.0.0", "api": "1.0.0"},
        }

        problems = []
        validator.validate_row(row, 0, set(), problems)
        self.assertFalse(any("invalid requires version" in problem for problem in problems))

        for invalid in ("1.0.0-alpha..1", "1.0.0-01", "1.0.0+build..1"):
            invalid_row = json.loads(json.dumps(row))
            invalid_row["requires"]["api"] = invalid
            problems = []
            validator.validate_row(invalid_row, 0, set(), problems)
            self.assertTrue(
                any("invalid requires version" in problem for problem in problems),
                invalid,
            )


if __name__ == "__main__":
    unittest.main()
