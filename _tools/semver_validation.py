"""Shared strict Semantic Version validation for ODD catalog tooling."""

from __future__ import annotations

import re


NUMERIC_IDENTIFIER = r"(?:0|[1-9][0-9]*)"
NON_NUMERIC_IDENTIFIER = r"(?:[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)"
PRERELEASE_IDENTIFIER = rf"(?:{NUMERIC_IDENTIFIER}|{NON_NUMERIC_IDENTIFIER})"
STRICT_SEMVER_PATTERN = (
    rf"^({NUMERIC_IDENTIFIER})\.({NUMERIC_IDENTIFIER})\.({NUMERIC_IDENTIFIER})"
    rf"(?:-({PRERELEASE_IDENTIFIER}(?:\.{PRERELEASE_IDENTIFIER})*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
STRICT_SEMVER_RE = re.compile(STRICT_SEMVER_PATTERN)


def is_strict_semver(value: object) -> bool:
    """Return whether *value* follows SemVer 2.0.0 identifier rules."""
    return isinstance(value, str) and STRICT_SEMVER_RE.fullmatch(value) is not None
