#!/usr/bin/env python3
"""Check local Markdown links and public-package boundaries.

Copyright (c) 2026
SPDX-License-Identifier: MIT

This stdlib-only helper validates a skill package. It does not inspect or
modify model files, SDKs, credentials, or a remote site.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Iterable


LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
WINDOWS_ABS_RE = re.compile(r"^(?:[A-Za-z]:[\\/]|[\\/]{2})")
PRIVATE_RE = re.compile(
    r"(?i)(?:\b(?:127\.0\.0\.1|0\.0\.0\.0|localhost)\b|"
    r"\b10\.(?:\d{1,3}\.){2}\d{1,3}\b|"
    r"\b192\.168\.(?:\d{1,3}\.)\d{1,3}\b|"
    r"\b172\.(?:1[6-9]|2\d|3[0-1])\.(?:\d{1,3}\.)\d{1,3}\b)"
)
ABS_PATH_RE = re.compile(r"(?i)(?:\b[A-Z]:[\\/]|(?:^|[\s'\"`])file://|(?:^|[\s'\"`])\\\\)")
SECRET_RE = re.compile(
    r"(?i)(?:\b(?:bearer\s+|password\s*[:=]|token\s*[:=])\S+|"
    r"\b(?:ghp|github_pat|sk)-[A-Za-z0-9_-]{12,}\b)"
)
FORBIDDEN_SUFFIXES = {".cmo3", ".moc3", ".psd", ".psb", ".tps", ".paf", ".sdk"}
FORBIDDEN_NAMES = (
    ".model3.json",
    ".motion3.json",
    ".physics3.json",
    ".exp3.json",
    ".cdi3.json",
)


def iter_text_files(root: Path) -> Iterable[Path]:
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix.lower() in {".md", ".markdown", ".yaml", ".yml", ".py", ".txt"}:
            yield path


def split_target(raw: str) -> str:
    target = raw.strip()
    if target.startswith("<") and ">" in target:
        target = target[1 : target.index(">")]
    else:
        target = target.split()[0]
    return target.split("#", 1)[0].split("?", 1)[0]


def check_links(root: Path) -> list[str]:
    errors: list[str] = []
    for path in iter_text_files(root):
        if path.suffix.lower() not in {".md", ".markdown"}:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for match in LINK_RE.finditer(text):
            raw_target = match.group(1)
            target = split_target(raw_target)
            if not target or target.startswith("#") or SCHEME_RE.match(target):
                continue
            if WINDOWS_ABS_RE.match(target):
                errors.append(f"{path.relative_to(root)}: absolute link: {target}")
                continue
            resolved = (path.parent / target).resolve()
            try:
                resolved.relative_to(root.resolve())
            except ValueError:
                errors.append(f"{path.relative_to(root)}: link escapes package: {target}")
                continue
            if not resolved.exists():
                errors.append(f"{path.relative_to(root)}: missing link target: {target}")
    return errors


def check_public_boundary(root: Path) -> list[str]:
    errors: list[str] = []
    for path in iter_text_files(root):
        # The helper necessarily contains the patterns it scans for.
        if path.suffix.lower() == ".py":
            continue
        rel = path.relative_to(root)
        text = path.read_text(encoding="utf-8", errors="replace")
        if ABS_PATH_RE.search(text):
            errors.append(f"{rel}: machine absolute path")
        if PRIVATE_RE.search(text):
            errors.append(f"{rel}: private/local endpoint")
        if SECRET_RE.search(text):
            errors.append(f"{rel}: credential-like text")
    return errors


def check_forbidden_files(root: Path) -> list[str]:
    errors: list[str] = []
    for path in sorted(root.rglob("*")):
        name = path.name.lower()
        if path.is_file() and (
            path.suffix.lower() in FORBIDDEN_SUFFIXES
            or name.endswith(FORBIDDEN_NAMES)
        ):
            errors.append(f"{path.relative_to(root)}: model/source/SDK file is not package content")
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path, help="skill package directory")
    parser.add_argument("--strict-public", action="store_true", help="also scan public-boundary rules")
    parser.add_argument("--json", action="store_true", dest="as_json", help="emit a machine-readable result")
    args = parser.parse_args(argv)

    root = args.root.expanduser().resolve()
    if not root.is_dir():
        message = f"root is not a directory: {root}"
        if args.as_json:
            print(json.dumps({"ok": False, "errors": [message]}, ensure_ascii=False))
        else:
            print(f"FAIL: {message}", file=sys.stderr)
        return 2

    errors = check_links(root)
    if args.strict_public:
        errors.extend(check_public_boundary(root))
        errors.extend(check_forbidden_files(root))
    result = {"ok": not errors, "root": str(root), "errors": errors}
    if args.as_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif errors:
        print("FAIL")
        for error in errors:
            print(f"- {error}")
    else:
        print("PASS: local links and selected package checks are closed")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
