#!/usr/bin/env python3
"""Verify the file-reference closure of a Live2D model3.json package.

Copyright (c) 2026
SPDX-License-Identifier: MIT

The checker is stdlib-only and read-only. It parses model3.json and any
referenced JSON that exposes another FileReferences object, then reports
relative paths, byte sizes, missing files, and references that leave the
chosen package root. It deliberately does not parse or validate MOC semantics
or prove Core loading/rendering.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple


DRIVE_RE = re.compile(r"^[A-Za-z]:")
SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*://")
SINGLE_FILE_KEYS = {
    "Moc",
    "Physics",
    "DisplayInfo",
    "Pose",
    "UserData",
}
LIST_FILE_KEYS = {"Textures"}


def is_absolute_reference(value: str) -> bool:
    """Recognize POSIX, Windows, UNC, drive, and URL references."""

    return (
        Path(value).is_absolute()
        or PurePosixPath(value.replace("\\", "/")).is_absolute()
        or PureWindowsPath(value).is_absolute()
        or bool(DRIVE_RE.match(value))
        or bool(SCHEME_RE.match(value))
    )


def iter_file_fields(node: Any) -> Iterable[str]:
    """Yield File fields from expression containers only."""

    if isinstance(node, dict):
        value = node.get("File")
        if isinstance(value, str) and value.strip():
            yield value
        for child in node.values():
            if isinstance(child, (dict, list)):
                yield from iter_file_fields(child)
    elif isinstance(node, list):
        for child in node:
            yield from iter_file_fields(child)


def iter_motion_fields(node: Any) -> Iterable[Tuple[str, str]]:
    """Yield motion File and optional Sound fields as file references."""

    if isinstance(node, dict):
        for field in ("File", "Sound"):
            value = node.get(field)
            if isinstance(value, str) and value.strip():
                yield field, value
        for child in node.values():
            if isinstance(child, (dict, list)):
                yield from iter_motion_fields(child)
    elif isinstance(node, list):
        for child in node:
            yield from iter_motion_fields(child)


def validate_file_references(file_refs: Any, context: str) -> List[str]:
    """Check the minimal model3 fields needed to form a useful closure."""

    errors: List[str] = []
    if not isinstance(file_refs, dict):
        return ["%s must be an object" % context]

    moc = file_refs.get("Moc")
    if not isinstance(moc, str) or not moc.strip():
        errors.append("%s.Moc must be a non-empty string" % context)

    textures = file_refs.get("Textures")
    if not isinstance(textures, list) or not textures:
        errors.append("%s.Textures must be a non-empty string list" % context)
    else:
        for index, item in enumerate(textures):
            if not isinstance(item, str) or not item.strip():
                errors.append("%s.Textures[%d] must be a non-empty string" % (context, index))

    motions = file_refs.get("Motions")
    if motions is not None:
        if not isinstance(motions, dict):
            errors.append("%s.Motions must be an object" % context)
        else:
            for group, entries in motions.items():
                if not isinstance(entries, list):
                    errors.append("%s.Motions[%s] must be a list" % (context, group))
                    continue
                for index, entry in enumerate(entries):
                    if not isinstance(entry, dict):
                        errors.append("%s.Motions[%s][%d] must be an object" % (context, group, index))
                        continue
                    if "Sound" in entry and (
                        not isinstance(entry["Sound"], str) or not entry["Sound"].strip()
                    ):
                        errors.append(
                            "%s.Motions[%s][%d].Sound must be a non-empty string"
                            % (context, group, index)
                        )
    return errors


def collect_file_references(file_refs: Any, source_file: Path) -> List[Dict[str, Any]]:
    """Extract known file-reference fields without guessing model semantics."""

    result: List[Dict[str, Any]] = []
    if not isinstance(file_refs, dict):
        return result

    def add(value: Any, field: str) -> None:
        if isinstance(value, str) and value.strip():
            result.append({"reference": value, "field": field, "source_file": source_file})

    for key, value in file_refs.items():
        if key in SINGLE_FILE_KEYS:
            add(value, "FileReferences." + key)
        elif key in LIST_FILE_KEYS and isinstance(value, list):
            for index, item in enumerate(value):
                add(item, "FileReferences.%s[%d]" % (key, index))
        elif key == "Expressions":
            for index, item in enumerate(iter_file_fields(value)):
                add(item, "FileReferences.%s[%d].File" % (key, index))
        elif key == "Motions":
            for index, (field, item) in enumerate(iter_motion_fields(value)):
                add(item, "FileReferences.%s[%d].%s" % (key, index, field))
    return result


def inside(base: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(base)
        return True
    except ValueError:
        return False


def display_relative(path: Path, base: Path) -> str:
    try:
        return path.relative_to(base).as_posix()
    except ValueError:
        return path.as_posix()


def inspect_occurrence(item: Dict[str, Any], base: Path) -> Dict[str, Any]:
    raw = str(item["reference"])
    source_file = Path(item["source_file"])
    record: Dict[str, Any] = {
        "source": display_relative(source_file, base),
        "field": item["field"],
        "reference": raw,
        "in_bounds": False,
        "exists": False,
    }

    if is_absolute_reference(raw):
        record["status"] = "out_of_bounds"
        record["reason"] = "absolute or URL reference"
        return record

    normalized = raw.replace("\\", "/")
    parts = PurePosixPath(normalized).parts
    candidate = (source_file.parent / Path(*parts)).resolve()
    record["path"] = display_relative(candidate, base)
    record["in_bounds"] = inside(base, candidate)
    if not record["in_bounds"]:
        record["status"] = "out_of_bounds"
        record["reason"] = "resolved path leaves base directory"
        return record
    record["exists"] = candidate.is_file()
    if not record["exists"]:
        record["status"] = "missing"
        return record
    record["status"] = "ok"
    record["size_bytes"] = candidate.stat().st_size
    record["resolved_file"] = candidate
    return record


def load_json(path: Path) -> Tuple[Optional[Any], Optional[str]]:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig")), None
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return None, "%s: %s" % (type(exc).__name__, exc)


def verify(model3_path: Path, base_dir: Path) -> Dict[str, Any]:
    base = base_dir.resolve()
    model_path = model3_path.resolve()
    errors: List[str] = []
    schema_errors: List[str] = []
    json_errors: List[Dict[str, str]] = []
    references: List[Dict[str, Any]] = []
    visited_json: Set[Path] = set()

    result: Dict[str, Any] = {
        "model3": str(model3_path),
        "base_dir": str(base_dir),
        "root": {
            "path": display_relative(model_path, base),
            "exists": model_path.is_file(),
        },
        "references": references,
        "unique_files": [],
        "missing": [],
        "out_of_bounds": [],
        "schema_errors": schema_errors,
        "json_errors": json_errors,
        "non_moc_validation": {
            "moc_semantics_checked": False,
            "core_or_rendering_checked": False,
        },
    }

    if not model_path.is_file():
        errors.append("model3.json is missing")
        result["errors"] = errors
        result["ok"] = False
        return result
    if not inside(base, model_path):
        errors.append("model3.json is outside base directory")

    root_data, root_error = load_json(model_path)
    if root_error:
        json_errors.append({"file": display_relative(model_path, base), "error": root_error})
        errors.append("model3.json is not valid JSON")
        result["root"]["size_bytes"] = model_path.stat().st_size
        result["errors"] = errors
        result["ok"] = False
        return result

    if not isinstance(root_data, dict):
        errors.append("model3.json root is not an object")
    file_refs = root_data.get("FileReferences") if isinstance(root_data, dict) else None
    if not isinstance(file_refs, dict):
        errors.append("FileReferences object is missing")
    else:
        schema_errors.extend(validate_file_references(file_refs, "FileReferences"))
        references.extend(collect_file_references(file_refs, model_path))

    queue_index = 0
    while queue_index < len(references):
        item = references[queue_index]
        queue_index += 1
        record = inspect_occurrence(item, base)
        references[queue_index - 1] = record
        if record["status"] == "missing":
            errors.append("missing: %s" % record["reference"])
        elif record["status"] == "out_of_bounds":
            errors.append("out_of_bounds: %s" % record["reference"])
        if record.get("status") != "ok":
            continue

        resolved_file = Path(record["resolved_file"])
        if resolved_file.suffix.lower() != ".json" or resolved_file in visited_json:
            continue
        visited_json.add(resolved_file)
        nested_data, nested_error = load_json(resolved_file)
        if nested_error:
            json_errors.append({"file": display_relative(resolved_file, base), "error": nested_error})
            continue
        if isinstance(nested_data, dict) and isinstance(nested_data.get("FileReferences"), dict):
            nested_refs = nested_data["FileReferences"]
            schema_errors.extend(
                validate_file_references(
                    nested_refs,
                    "%s.FileReferences" % display_relative(resolved_file, base),
                )
            )
            references.extend(collect_file_references(nested_refs, resolved_file))

    unique: Dict[Path, Dict[str, Any]] = {}
    for record in references:
        if record.get("status") == "ok":
            path = Path(record["resolved_file"])
            unique[path] = {
                "path": display_relative(path, base),
                "size_bytes": record["size_bytes"],
            }
    for record in references:
        record.pop("resolved_file", None)

    result["root"]["size_bytes"] = model_path.stat().st_size
    result["unique_files"] = [unique[path] for path in sorted(unique, key=lambda p: p.as_posix())]
    result["missing"] = [record for record in references if record.get("status") == "missing"]
    result["out_of_bounds"] = [record for record in references if record.get("status") == "out_of_bounds"]
    result["counts"] = {
        "references": len(references),
        "unique_files": len(unique),
        "existing": sum(record.get("status") == "ok" for record in references),
        "missing": len(result["missing"]),
        "out_of_bounds": len(result["out_of_bounds"]),
        "schema_errors": len(schema_errors),
        "json_errors": len(json_errors),
        "total_bytes": sum(item["size_bytes"] for item in unique.values()),
    }
    errors.extend("schema: %s" % error for error in schema_errors)
    if json_errors:
        errors.append("one or more referenced JSON files could not be parsed")
    result["errors"] = errors
    result["ok"] = not errors
    return result


def print_human(result: Dict[str, Any]) -> None:
    status = "PASS" if result.get("ok") else "FAIL"
    print("%s: model3 reference closure" % status)
    print("model3: %s (%s bytes)" % (result["model3"], result["root"].get("size_bytes", "?")))
    print("base_dir: %s" % result["base_dir"])
    for record in result["references"]:
        size = " bytes=%s" % record["size_bytes"] if "size_bytes" in record else ""
        print("- [%s] %s <- %s%s" % (record["status"], record["reference"], record["field"], size))
    counts = result.get("counts", {})
    print("summary: %s references, %s unique files, %s missing, %s out_of_bounds, %s bytes" % (
        counts.get("references", 0),
        counts.get("unique_files", 0),
        counts.get("missing", 0),
        counts.get("out_of_bounds", 0),
        counts.get("total_bytes", 0),
    ))
    print("semantic caveat: MOC semantics and Core/rendering were not checked")
    for error in result.get("errors", []):
        print("error: %s" % error, file=sys.stderr)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model3", type=Path, help="path to model3.json")
    parser.add_argument(
        "--base-dir",
        type=Path,
        default=None,
        help="package root for relative references (defaults to model3 parent)",
    )
    parser.add_argument("--json", action="store_true", dest="as_json", help="emit JSON")
    args = parser.parse_args(argv)

    model3_path = args.model3.expanduser()
    base_dir = args.base_dir.expanduser() if args.base_dir else model3_path.parent
    result = verify(model3_path, base_dir)
    if args.as_json:
        clean_result = json.loads(json.dumps(result, default=str, ensure_ascii=False))
        print(json.dumps(clean_result, ensure_ascii=False, indent=2))
    else:
        print_human(result)
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
