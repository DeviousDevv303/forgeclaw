#!/usr/bin/env python3
"""Validate Nexus workflow correlation IDs before using them as repository paths."""
from __future__ import annotations

import re
import sys


# IDs are path components in the public result mirror. Dots and slashes are
# intentionally excluded so neither traversal nor nested paths can be formed.
_SAFE_INVOCATION_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,119}\Z")


def is_safe_invocation_id(value: str) -> bool:
    return bool(_SAFE_INVOCATION_ID.fullmatch(value))


def main(argv: list[str]) -> int:
    if len(argv) != 2 or not is_safe_invocation_id(argv[1]):
        print("::error::Invalid invocation_id; expected 1-120 ASCII letters, digits, hyphens, or underscores, starting with a letter or digit.")
        return 1
    print("Nexus invocation ID is a safe single path component.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
