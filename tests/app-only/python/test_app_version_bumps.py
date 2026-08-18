"""Regression tests for catalog app bundle version enforcement."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[3]
CHECK = REPO / "odd" / "bin" / "check-app-version-bumps"


class AppVersionBumpsTest(unittest.TestCase):
    def registry(
        self,
        version: str,
        sha: str,
        slug: str = "fixture",
        channel: str | None = None,
    ) -> dict:
        row = {
            "type": "app",
            "slug": slug,
            "version": version,
            "sha256": sha,
        }
        if channel is not None:
            row["channel"] = channel
        return {
            "version": 1,
            "bundles": [row],
        }

    def run_check(self, baseline: dict, current: dict, *extra: str) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            baseline_path = root / "baseline.json"
            current_path = root / "current.json"
            baseline_path.write_text(json.dumps(baseline), encoding="utf-8")
            current_path.write_text(json.dumps(current), encoding="utf-8")
            return subprocess.run(
                [
                    str(CHECK),
                    "--baseline-registry",
                    str(baseline_path),
                    "--current-registry",
                    str(current_path),
                    *extra,
                ],
                cwd=REPO,
                check=False,
                capture_output=True,
                text=True,
            )

    def test_same_bundle_bytes_do_not_require_a_bump(self) -> None:
        result = self.run_check(
            self.registry("1.0.0", "a" * 64),
            self.registry("1.0.0", "a" * 64),
        )
        self.assertEqual(0, result.returncode, result.stderr)

    def test_new_slug_is_allowed(self) -> None:
        baseline = {"version": 1, "bundles": []}
        result = self.run_check(baseline, self.registry("1.0.0", "b" * 64))
        self.assertEqual(0, result.returncode, result.stderr)

    def test_changed_bytes_require_greater_precedence(self) -> None:
        for version in ("1.0.0", "0.9.9", "1.0.0+new-build"):
            with self.subTest(version=version):
                result = self.run_check(
                    self.registry("1.0.0+old-build", "a" * 64),
                    self.registry(version, "b" * 64),
                )
                self.assertNotEqual(0, result.returncode)
                self.assertIn("does not have greater SemVer precedence", result.stderr)

    def test_release_and_prerelease_ordering_follow_semver(self) -> None:
        accepted = (
            ("1.0.0-beta.1", "1.0.0-beta.2"),
            ("1.0.0-rc.1", "1.0.0"),
            ("184467440737095516159.0.0", "184467440737095516160.0.0"),
            ("1.0.0-184467440737095516159", "1.0.0-184467440737095516160"),
        )
        rejected = (
            ("1.0.0", "1.0.0-rc.2"),
            ("1.0.0-beta.2", "1.0.0-beta.1"),
            ("184467440737095516160.0.0", "184467440737095516159.0.0"),
            ("1.0.0-184467440737095516160", "1.0.0-184467440737095516159"),
        )
        for old, new in accepted:
            with self.subTest(old=old, new=new):
                result = self.run_check(self.registry(old, "a" * 64), self.registry(new, "b" * 64))
                self.assertEqual(0, result.returncode, result.stderr)
        for old, new in rejected:
            with self.subTest(old=old, new=new):
                result = self.run_check(self.registry(old, "a" * 64), self.registry(new, "b" * 64))
                self.assertNotEqual(0, result.returncode)

    def test_slug_filter_requires_current_row(self) -> None:
        result = self.run_check(
            self.registry("1.0.0", "a" * 64),
            self.registry("1.0.0", "a" * 64),
            "--slug",
            "missing",
        )
        self.assertNotEqual(0, result.returncode)
        self.assertIn("missing from current registry", result.stderr)

    def test_preview_channel_guards_existing_same_and_new_rows(self) -> None:
        changed = self.run_check(
            self.registry("1.0.0", "a" * 64, "preview-app", "preview"),
            self.registry("1.0.0", "b" * 64, "preview-app", "preview"),
            "--channel",
            "preview",
        )
        self.assertNotEqual(0, changed.returncode)
        self.assertIn("does not have greater SemVer precedence", changed.stderr)

        same = self.run_check(
            self.registry("1.0.0", "a" * 64, "preview-app", "preview"),
            self.registry("1.0.0", "a" * 64, "preview-app", "preview"),
            "--channel",
            "preview",
        )
        self.assertEqual(0, same.returncode, same.stderr)
        self.assertIn("1 byte-identical", same.stdout)

        new = self.run_check(
            {"version": 1, "bundles": []},
            self.registry("0.1.0-beta.1", "c" * 64, "preview-app", "preview"),
            "--channel",
            "preview",
        )
        self.assertEqual(0, new.returncode, new.stderr)
        self.assertIn("1 new", new.stdout)

    def resolve_base_ref(self, *extra: str, env: dict[str, str] | None = None) -> str:
        process_env = dict(os.environ)
        process_env.pop("ODD_APP_VERSION_BASE_REF", None)
        process_env.pop("GITHUB_ACTIONS", None)
        process_env.update(env or {})
        result = subprocess.run(
            [str(CHECK), "--resolve-base-ref", *extra],
            cwd=REPO,
            check=False,
            capture_output=True,
            text=True,
            env=process_env,
        )
        self.assertEqual(0, result.returncode, result.stderr)
        return result.stdout.strip()

    def test_base_ref_selection_handles_ci_event_shapes(self) -> None:
        self.assertEqual("HEAD", self.resolve_base_ref())
        self.assertEqual(
            "pull-request-base",
            self.resolve_base_ref(env={"GITHUB_ACTIONS": "true", "ODD_APP_VERSION_BASE_REF": "pull-request-base"}),
        )
        self.assertEqual(
            "HEAD^",
            self.resolve_base_ref(env={"GITHUB_ACTIONS": "true", "ODD_APP_VERSION_BASE_REF": "0" * 40}),
        )
        self.assertEqual("HEAD^", self.resolve_base_ref(env={"GITHUB_ACTIONS": "true"}))
        self.assertEqual(
            "explicit-ref",
            self.resolve_base_ref("--base-ref", "explicit-ref", env={"GITHUB_ACTIONS": "true", "ODD_APP_VERSION_BASE_REF": "event-ref"}),
        )

    def test_preview_guard_is_part_of_reusable_publish_quality_gate(self) -> None:
        ci = (REPO / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        preview = (REPO / ".github" / "workflows" / "catalog-preview.yml").read_text(encoding="utf-8")
        pages = (REPO / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")

        expected_guard = "--current-registry .odd/catalog-preview/v1/registry.json"
        self.assertIn("odd/bin/build-catalog-preview", ci)
        self.assertIn("--channel preview", ci)
        self.assertIn(expected_guard, ci)
        self.assertIn("--channel preview", preview)
        self.assertIn(expected_guard, preview)
        self.assertIn("uses: ./.github/workflows/ci.yml", pages)
        self.assertIn("needs: [quality-gates, browser-e2e]", pages)


if __name__ == "__main__":
    unittest.main()
