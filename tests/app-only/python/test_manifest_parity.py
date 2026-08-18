"""Shared manifest boundary cases for the canonical JSON Schema validator."""

from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "_tools"))

from manifest_validation import validate_manifest  # noqa: E402


FIXTURES = REPO_ROOT / "tests" / "fixtures"


class ManifestParityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.base_manifest = json.loads(
            (FIXTURES / "manifests" / "app-ok.json").read_text(encoding="utf-8")
        )
        cls.cases = json.loads(
            (FIXTURES / "manifest-parity-cases.json").read_text(encoding="utf-8")
        )

    def manifest_for(self, case: dict[str, object]) -> dict[str, object]:
        manifest = copy.deepcopy(self.base_manifest)
        overrides = case.get("overrides")
        if isinstance(overrides, dict):
            manifest.update(copy.deepcopy(overrides))
        if case.get("omit"):
            manifest.pop(str(case["field"]), None)
            return manifest
        if case.get("emptyObject"):
            value = {}
        elif "repeat" in case:
            value = str(case["repeat"]) * int(case["count"])
        else:
            value = case["value"]
        field = str(case["field"])
        if case.get("nestedField"):
            manifest[field][str(case["nestedField"])] = value
        else:
            manifest[field] = value
        return manifest

    def test_invalid_cases_are_rejected(self) -> None:
        for case in self.cases["invalid"]:
            with self.subTest(case=case["label"]):
                problems = validate_manifest(self.manifest_for(case))
                self.assertTrue(
                    any(
                        problem.startswith(f"{case['field']}:")
                        or problem.startswith(f"{case['field']}/")
                        or (
                            case.get("omit")
                            and "required property" in problem
                            and f"'{case['field']}'" in problem
                        )
                        for problem in problems
                    ),
                    problems,
                )

    def test_boundary_cases_are_accepted(self) -> None:
        for case in self.cases["valid"]:
            with self.subTest(case=case["label"]):
                self.assertEqual([], validate_manifest(self.manifest_for(case)))


if __name__ == "__main__":
    unittest.main()
