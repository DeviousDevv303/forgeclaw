#!/usr/bin/env python3
"""Build recognition-signal-only hold/fold pairs in the Nexus run-mix JSONL shape.

This is a generator, not a training launcher. It requires verified frozen-pack bytes,
a hash-pinned design manifest, graded source provenance, and exact group counts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

PACK_VERSION = "pack-v1.1"
PACK_SHA256 = "df158f084162069733896724163c7703a89593e788d21749f7e4dba7b3214654"
DESIGN_SCHEMA = "synthetic-intuition-mix-design-v1"
ACTIONS = {"hold", "fold"}
DIFFICULTIES = {"evidence_given", "evidence_inferred"}
SOURCE_TYPES = {"desk_journal", "mined_235"}
SPECIAL_TOKEN_RE = re.compile(r"<\|[^|]+\|>")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")


class BuildError(ValueError):
    """Input violates the frozen pair-generation contract."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise BuildError(message)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BuildError(f"cannot read JSON from {path}: {exc}") from exc
    _require(isinstance(value, dict), f"{path}: expected a JSON object")
    return value


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise BuildError(f"cannot read {path}: {exc}") from exc
    rows: list[dict[str, Any]] = []
    for line_no, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise BuildError(f"{path}:{line_no}: invalid JSON: {exc.msg}") from exc
        _require(isinstance(value, dict), f"{path}:{line_no}: expected an object")
        rows.append(value)
    _require(bool(rows), f"{path}: no pair definitions")
    return rows


def verify_pack(path: Path) -> None:
    _require(path.is_file(), f"frozen pack bytes are required but missing: {path}")
    actual = sha256_bytes(path.read_bytes())
    _require(actual == PACK_SHA256, f"frozen pack hash mismatch: expected {PACK_SHA256}, got {actual}")


def load_design(path: Path, sidecar: Path) -> tuple[dict[str, Any], str]:
    _require(sidecar.is_file(), f"hash sidecar for the frozen mix design is required: {sidecar}")
    expected = sidecar.read_text(encoding="utf-8").strip().split()[0]
    _require(bool(SHA_RE.fullmatch(expected)), f"invalid design sha256 in {sidecar}")
    data = path.read_bytes()
    actual = sha256_bytes(data)
    _require(actual == expected, f"mix design hash mismatch: expected {expected}, got {actual}")
    design = read_json(path)
    _require(design.get("schema") == DESIGN_SCHEMA, f"design schema must be {DESIGN_SCHEMA}")
    _require(design.get("pack_sha256") == PACK_SHA256, "mix design is not pinned to frozen pack v1.1")
    _require(isinstance(design.get("design_id"), str) and design["design_id"].strip(), "mix design needs a design_id")
    _require(isinstance(design.get("frozen_at"), str) and design["frozen_at"].strip(), "mix design needs frozen_at")
    target = design.get("target_pairs_by_group")
    _require(isinstance(target, dict) and target, "mix design needs exact target_pairs_by_group counts")
    for group, count in target.items():
        _require(isinstance(group, str) and group.strip(), "mix design group names must be non-empty")
        _require(isinstance(count, int) and not isinstance(count, bool) and count > 0, f"target count for {group} must be a positive integer")
    return design, actual


def verify_source(pair: dict[str, Any], pair_id: str, repo_root: Path) -> dict[str, Any]:
    source = pair.get("source")
    _require(isinstance(source, dict), f"{pair_id}: source provenance is required")
    _require(source.get("type") in SOURCE_TYPES, f"{pair_id}: source.type must be desk_journal or mined_235")
    _require(isinstance(source.get("record_id"), str) and source["record_id"].strip(), f"{pair_id}: source.record_id is required")
    _require(source.get("graded") is True, f"{pair_id}: source must be graded")
    _require(source.get("eval_excluded") is True, f"{pair_id}: source must be explicitly excluded from eval")
    _require(source.get("canonical_anchor") is False, f"{pair_id}: canonical eval anchors cannot enter training")
    expected = source.get("sha256")
    _require(isinstance(expected, str) and bool(SHA_RE.fullmatch(expected)), f"{pair_id}: source.sha256 must be a lowercase SHA-256")
    rel_path = source.get("path")
    _require(isinstance(rel_path, str) and rel_path.strip(), f"{pair_id}: source.path is required to reproduce provenance")
    source_path = (repo_root / rel_path).resolve()
    root = repo_root.resolve()
    _require(source_path == root or root in source_path.parents, f"{pair_id}: source.path escapes the repository root")
    _require(source_path.is_file(), f"{pair_id}: source file is missing: {source_path}")
    actual = sha256_bytes(source_path.read_bytes())
    _require(actual == expected, f"{pair_id}: source hash mismatch for {rel_path}")
    anchor_text = (source["record_id"] + " " + rel_path).lower().replace("_", "-")
    _require(not re.search(r"run[- #]?4\b|1830", anchor_text), f"{pair_id}: canonical Run #4 / 1830 eval anchor is forbidden in training")
    return {"type": source["type"], "record_id": source["record_id"], "path": rel_path, "sha256": actual}


def validate_pair(pair: dict[str, Any], index: int, repo_root: Path) -> dict[str, Any]:
    pair_id = pair.get("pair_id")
    _require(isinstance(pair_id, str) and pair_id.strip(), f"pair {index}: pair_id is required")
    for field in ("regime", "design_group", "shared_prompt", "recognition_field"):
        _require(isinstance(pair.get(field), str) and pair[field].strip(), f"{pair_id}: {field} must be non-empty text")
    difficulty = pair.get("difficulty")
    _require(difficulty in DIFFICULTIES, f"{pair_id}: difficulty must be one of {sorted(DIFFICULTIES)}")
    shared_prompt = pair["shared_prompt"].strip()
    _require("Recognition signal:" not in shared_prompt, f"{pair_id}: shared_prompt must not pre-include the varied recognition signal")
    if difficulty == "evidence_given":
        _require("Evidence class:" in shared_prompt, f"{pair_id}: evidence_given rows need an explicit Evidence class in shared_prompt")
    else:
        _require("Raw result:" in shared_prompt, f"{pair_id}: evidence_inferred rows need the raw result in shared_prompt")
        _require("Evidence class:" not in shared_prompt, f"{pair_id}: evidence_inferred rows must not reveal the evidence class")

    arms = pair.get("arms")
    _require(isinstance(arms, list) and len(arms) == 2, f"{pair_id}: exactly two arms are required")
    by_action: dict[str, dict[str, Any]] = {}
    for arm in arms:
        _require(isinstance(arm, dict), f"{pair_id}: each arm must be an object")
        action = arm.get("action")
        _require(action in ACTIONS, f"{pair_id}: arm action must be hold or fold")
        _require(action not in by_action, f"{pair_id}: duplicate {action} arm")
        by_action[action] = arm
        _require(isinstance(arm.get("signal"), str) and arm["signal"].strip(), f"{pair_id}: arm signal must be non-empty text")
        _require(isinstance(arm.get("answer"), str) and arm["answer"].strip(), f"{pair_id}: arm answer must be non-empty text")
        _require(not SPECIAL_TOKEN_RE.search(arm["answer"]), f"{pair_id}: answer must be plain text; grammar tokens are added by the generator")
        rank_before = arm.get("rank_before")
        rank_after = arm.get("expected_rank_after")
        for name, rank in (("rank_before", rank_before), ("expected_rank_after", rank_after)):
            _require(isinstance(rank, int) and not isinstance(rank, bool) and 1 <= rank <= 7, f"{pair_id}: {name} must be in 1..7")
        spans = arm.get("copySpans", [])
        _require(isinstance(spans, list) and all(isinstance(x, str) and x for x in spans), f"{pair_id}: copySpans must be a list of non-empty strings")
        arm_prompt = shared_prompt + "\nRecognition signal: " + arm["signal"].strip()
        for span in spans:
            _require(span in arm_prompt and span in arm["answer"], f"{pair_id}: copySpan is not verbatim in both prompt and answer: {span!r}")
    _require(set(by_action) == ACTIONS, f"{pair_id}: one hold and one fold arm are required")
    hold = by_action["hold"]
    fold = by_action["fold"]
    _require(hold["signal"] != fold["signal"], f"{pair_id}: recognition signals must differ")
    _require(hold["rank_before"] == fold["rank_before"], f"{pair_id}: rank_before must be held constant across the pair")
    _require(pair.get("varied_field") == pair["recognition_field"], f"{pair_id}: only the declared recognition field may vary")
    source = verify_source(pair, pair_id, repo_root)
    return {
        "pair_id": pair_id,
        "regime": pair["regime"],
        "difficulty": difficulty,
        "design_group": pair["design_group"],
        "shared_prompt": shared_prompt,
        "recognition_field": pair["recognition_field"],
        "hold": hold,
        "fold": fold,
        "source": source,
    }


def row_for_arm(pair: dict[str, Any], arm: dict[str, Any], design: dict[str, Any]) -> dict[str, Any]:
    prompt = pair["shared_prompt"] + "\nRecognition signal: " + arm["signal"].strip()
    spans = list(dict.fromkeys(arm.get("copySpans", [])))
    answer = arm["answer"].strip()
    text = f"<|route:direct|><|ev:not_verified|><|answer|>Decision: {arm['action'].upper()}. {answer}<|/answer|><|end|>"
    return {
        "id": f"intuition-{pair['pair_id']}-{arm['action']}",
        "synthetic": True,
        "prompt": prompt,
        "text": text,
        "kind": "intuition_hold_fold_pair",
        "mode": "copy" if spans else "create",
        "copySpans": spans,
        "guardian_eligible": False,
        "class_source": "synthetic-intuition-pack-v1.1",
        "pair_id": pair["pair_id"],
        "pair_arm": arm["action"],
        "regime": pair["regime"],
        "difficulty": pair["difficulty"],
        "design_group": pair["design_group"],
        "recognition_field": pair["recognition_field"],
        "recognition_signal": arm["signal"].strip(),
        "rank_before": arm["rank_before"],
        "expected_rank_after": arm["expected_rank_after"],
        "expected_action": arm["action"],
        "source_type": pair["source"]["type"],
        "source_record_id": pair["source"]["record_id"],
        "source_sha256": pair["source"]["sha256"],
        "eval_excluded": True,
        "canonical_anchor": False,
        "pack_sha256": PACK_SHA256,
        "mix_design_id": design["design_id"],
    }


def reject_frozen_overlap(rows: list[dict[str, Any]], frozen_strings: set[str]) -> None:
    normalized = {" ".join(value.split()) for value in frozen_strings if value.strip()}
    for row in rows:
        for field in ("prompt", "text"):
            value = " ".join(row[field].split())
            _require(value not in normalized, f"{row['id']}: exact {field} duplicates a frozen evaluation string")


def load_frozen_strings(manifest_path: Path, repo_root: Path) -> set[str]:
    manifest = read_json(manifest_path)
    strings: set[str] = set()
    exams = manifest.get("exams", [])
    _require(isinstance(exams, list), f"{manifest_path}: exams must be a list")
    for exam in exams:
        files = exam.get("files", {})
        _require(isinstance(files, dict), f"{manifest_path}: exam files must be a mapping")
        for rel_path, expected in files.items():
            path = (repo_root / rel_path).resolve()
            _require(path.is_file(), f"frozen file missing: {rel_path}")
            _require(sha256_bytes(path.read_bytes()) == expected, f"frozen file hash mismatch: {rel_path}")
            if path.suffix.lower() == ".jsonl":
                for row in read_jsonl(path):
                    for key in ("prompt", "text"):
                        value = row.get(key)
                        if isinstance(value, str):
                            strings.add(value)
    _require(bool(exams), f"{manifest_path}: no frozen exams found")
    return strings


def build_rows(pairs: list[dict[str, Any]], design: dict[str, Any], repo_root: Path) -> list[dict[str, Any]]:
    validated: list[dict[str, Any]] = []
    ids: set[str] = set()
    for index, pair in enumerate(pairs, 1):
        result = validate_pair(pair, index, repo_root)
        _require(result["pair_id"] not in ids, f"duplicate pair_id: {result['pair_id']}")
        ids.add(result["pair_id"])
        validated.append(result)
    expected = design["target_pairs_by_group"]
    actual = Counter(pair["design_group"] for pair in validated)
    _require(set(actual) == set(expected), f"design groups differ from frozen design: actual={dict(actual)}, expected={expected}")
    for group, target in expected.items():
        _require(actual[group] == target, f"group {group}: generated {actual[group]} pairs, frozen target is {target}")
    rows = [row_for_arm(pair, pair[action], design) for pair in validated for action in ("hold", "fold")]
    row_ids = [row["id"] for row in rows]
    _require(len(row_ids) == len(set(row_ids)), "generated row IDs are not unique")
    return rows


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> str:
    payload = "".join(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n" for row in rows)
    path.write_text(payload, encoding="utf-8")
    return sha256_bytes(payload.encode("utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pairs", type=Path, help="graded and provenance-backed pair definitions JSONL")
    parser.add_argument("--design", required=True, type=Path, help="hash-pinned, frozen mix-design JSON")
    parser.add_argument("--design-sha256", required=True, type=Path, help="sidecar containing the mix-design SHA-256")
    parser.add_argument("--pack", type=Path, default=Path(__file__).with_name("PACK-V1.1.md"), help="exact frozen v1.1 pack bytes")
    parser.add_argument("--frozen-manifest", type=Path, default=Path(__file__).parents[1] / "eval" / "FROZEN.json")
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).parents[2], help="repository root for source and frozen-set verification")
    parser.add_argument("--output", required=True, type=Path, help="output training JSONL; never overwrites an existing file")
    parser.add_argument("--report", required=True, type=Path, help="build report JSON")
    args = parser.parse_args(argv)
    try:
        _require(not args.output.exists(), f"refusing to overwrite existing training output: {args.output}")
        verify_pack(args.pack)
        design, design_hash = load_design(args.design, args.design_sha256)
        pairs = read_jsonl(args.pairs)
        rows = build_rows(pairs, design, args.repo_root)
        frozen_strings = load_frozen_strings(args.frozen_manifest, args.repo_root)
        reject_frozen_overlap(rows, frozen_strings)
        output_hash = write_jsonl(args.output, rows)
        report = {
            "schema": "synthetic-intuition-build-report-v1",
            "pack": {"version": PACK_VERSION, "sha256": PACK_SHA256, "bytes_verified": True},
            "mix_design": {"id": design["design_id"], "sha256": design_hash, "frozen_at": design["frozen_at"]},
            "source_pairs": len(pairs),
            "output_rows": len(rows),
            "pairs_by_group": dict(sorted(Counter(row["design_group"] for row in rows if row["pair_arm"] == "hold").items())),
            "rows_by_arm": dict(sorted(Counter(row["pair_arm"] for row in rows).items())),
            "source_sha256": dict(sorted({row["source_record_id"]: row["source_sha256"] for row in rows}.items())),
            "frozen_eval_strings_checked": len(frozen_strings),
            "output_sha256": output_hash,
            "training_started": False,
        }
        args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0
    except (BuildError, OSError) as exc:
        print(f"build_pairs.py: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
