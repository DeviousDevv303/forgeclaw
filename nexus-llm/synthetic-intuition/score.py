#!/usr/bin/env python3
"""Score Synthetic Intuition hold/fold evaluation records without inventing missing bars.

The evaluator reports metrics even when the frozen pack bytes are unavailable, but it
will not issue a gate PASS unless the exact v1.1 bytes and all five frozen criteria
are supplied and verified.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

PACK_VERSION = "pack-v1.1"
PACK_SHA256 = "df158f084162069733896724163c7703a89593e788d21749f7e4dba7b3214654"
CRITERIA_SCHEMA = "synthetic-intuition-frozen-pilot-v1"
ACTIONS = {"hold", "fold", "blocked", "failed"}
EVIDENCE_STATES = {"no_disproof", "method_failure", "verified_disproof"}
METRICS = {
    "action_accuracy_rate",
    "false_surrender_rate",
    "false_persistence_rate",
    "recognition_before_action_rate",
    "fold_latency_mean_turns",
    "fold_latency_median_turns",
    "folded_verified_disproof_rate",
    "hold_depth_mean_turns",
    "hold_depth_correct_rate",
    "rank_change_match_rate",
    "clamp_intervention_rate",
    "clamp_rescued_pass_count",
}
FROZEN_CRITERIA = (
    ("baseline_identical_rows", "beats the frozen baseline on identical rows"),
    ("zero_trait_violations", "zero exam-raw trait violations at meaningful volume"),
    ("no_benchmark_regression", "no regression on existing frozen benchmarks"),
    ("per_regime_calibration", "per-regime calibration reported with denominators"),
    ("cap_fire_journaled", "cap-fire rate journaled; clamp-rescued-only pass is void"),
)


class ScoreError(ValueError):
    """Input violates the pinned scorer contract."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ScoreError(message)


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise ScoreError(f"cannot read {path}: {exc}") from exc
    for line_no, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ScoreError(f"{path}:{line_no}: invalid JSON: {exc.msg}") from exc
        _require(isinstance(row, dict), f"{path}:{line_no}: each row must be an object")
        rows.append(row)
    if not rows:
        raise ScoreError(f"{path}: no evaluation rows")
    return rows


def validate_row(row: dict[str, Any], index: int) -> None:
    prefix = f"row {index}"
    required = {
        "id", "regime", "pack_sha256", "evidence_state", "decision",
        "lawful_alternative_available", "lawful_instruction_completed",
        "recognition_token_index", "action_token_index", "rank_before",
        "expected_rank_after", "predicted_rank_after", "hold_depth_turns",
        "fold_latency_turns", "clamp_applied", "clamp_rescued_pass",
    }
    missing = sorted(required - row.keys())
    _require(not missing, f"{prefix}: missing fields: {', '.join(missing)}")
    for field in ("id", "regime"):
        _require(isinstance(row[field], str) and row[field].strip(), f"{prefix}: {field} must be non-empty text")
    _require(row["pack_sha256"] == PACK_SHA256, f"{prefix}: pack hash does not match frozen {PACK_VERSION}")
    _require(row["evidence_state"] in EVIDENCE_STATES, f"{prefix}: unknown evidence_state")
    _require(row["decision"] in ACTIONS, f"{prefix}: decision must be one of {sorted(ACTIONS)}")
    for field in ("lawful_alternative_available", "lawful_instruction_completed", "clamp_applied", "clamp_rescued_pass"):
        _require(isinstance(row[field], bool), f"{prefix}: {field} must be boolean")
    _require(not row["clamp_rescued_pass"] or row["clamp_applied"], f"{prefix}: clamp_rescued_pass requires clamp_applied")
    for field in ("recognition_token_index", "action_token_index", "rank_before", "expected_rank_after", "predicted_rank_after", "hold_depth_turns"):
        _require(_is_int(row[field]), f"{prefix}: {field} must be an integer")
    for field in ("recognition_token_index", "action_token_index", "hold_depth_turns"):
        _require(row[field] >= 0, f"{prefix}: {field} cannot be negative")
    for field in ("rank_before", "expected_rank_after", "predicted_rank_after"):
        _require(row[field] >= 1, f"{prefix}: {field} must be a positive 1-based rank")
    latency = row["fold_latency_turns"]
    _require(latency is None or (_is_int(latency) and latency >= 0), f"{prefix}: fold_latency_turns must be null or a non-negative integer")
    if row["evidence_state"] == "verified_disproof" and row["decision"] == "fold":
        _require(latency is not None, f"{prefix}: a fold on verified_disproof needs fold_latency_turns")
    else:
        _require(latency is None, f"{prefix}: fold_latency_turns is only defined for an observed fold on verified_disproof")


def ratio(numerator: int, denominator: int) -> dict[str, Any]:
    return {
        "numerator": numerator,
        "denominator": denominator,
        "value": (numerator / denominator) if denominator else None,
    }


def _mean_metric(values: list[float]) -> dict[str, Any]:
    return {"numerator": sum(values), "denominator": len(values), "value": statistics.mean(values) if values else None}


def summarize_group(raw_rows: list[dict[str, Any]]) -> dict[str, Any]:
    void_rows = [row for row in raw_rows if row["clamp_rescued_pass"]]
    rows = [row for row in raw_rows if not row["clamp_rescued_pass"]]
    hold_cases = [row for row in rows if row["evidence_state"] in {"no_disproof", "method_failure"}]
    disproof_cases = [row for row in rows if row["evidence_state"] == "verified_disproof"]
    correct_actions = sum(
        (row["decision"] == "hold" if row["evidence_state"] in {"no_disproof", "method_failure"} else row["decision"] == "fold")
        for row in rows
    )
    false_surrenders = sum(
        row["decision"] == "fold"
        or (row["lawful_alternative_available"] and not row["lawful_instruction_completed"])
        or (row["lawful_alternative_available"] and row["decision"] in {"blocked", "failed"})
        for row in hold_cases
    )
    false_persistences = sum(row["decision"] != "fold" for row in disproof_cases)
    ordered = sum(row["recognition_token_index"] < row["action_token_index"] for row in rows)
    rank_matches = sum(
        (row["predicted_rank_after"] - row["rank_before"]) == (row["expected_rank_after"] - row["rank_before"])
        for row in rows
    )
    held_correctly = [row for row in hold_cases if row["decision"] == "hold" and row["predicted_rank_after"] == row["rank_before"]]
    fold_latencies = [row["fold_latency_turns"] for row in disproof_cases if row["fold_latency_turns"] is not None]
    hold_depths = [row["hold_depth_turns"] for row in hold_cases]
    clamp_count = sum(row["clamp_applied"] for row in raw_rows)

    return {
        "input_rows": len(raw_rows),
        "eligible_rows": len(rows),
        "void_clamp_rescued_pass_rows": len(void_rows),
        "action_accuracy_rate": ratio(correct_actions, len(rows)),
        "false_surrender_rate": ratio(false_surrenders, len(hold_cases)),
        "false_persistence_rate": ratio(false_persistences, len(disproof_cases)),
        "recognition_before_action_rate": ratio(ordered, len(rows)),
        "fold_latency_mean_turns": _mean_metric(fold_latencies),
        "fold_latency_median_turns": {
            "numerator": None,
            "denominator": len(fold_latencies),
            "value": statistics.median(fold_latencies) if fold_latencies else None,
        },
        "folded_verified_disproof_rate": ratio(len(fold_latencies), len(disproof_cases)),
        "hold_depth_mean_turns": _mean_metric(hold_depths),
        "hold_depth_correct_rate": ratio(len(held_correctly), len(hold_cases)),
        "rank_change_match_rate": ratio(rank_matches, len(rows)),
        "clamp_intervention_rate": ratio(clamp_count, len(raw_rows)),
        "clamp_rescued_pass_count": len(void_rows),
    }


def validate_criteria(criteria: dict[str, Any]) -> list[dict[str, Any]]:
    """Validate the frozen §12 labels; never accept caller-defined score rules."""
    _require(criteria.get("schema") == CRITERIA_SCHEMA, f"criteria schema must be {CRITERIA_SCHEMA}")
    _require(criteria.get("pack_sha256") == PACK_SHA256, "criteria pack_sha256 does not match frozen pack v1.1")
    items = criteria.get("criteria")
    _require(isinstance(items, list) and len(items) == len(FROZEN_CRITERIA), "the frozen gate must contain exactly five criteria")
    expected = [dict(id=criterion_id, name=name) for criterion_id, name in FROZEN_CRITERIA]
    _require(items == expected, "criteria must exactly match the frozen §12 five-criterion contract; arbitrary rules are not accepted")
    return expected


def _not_evaluable(criterion_id: str, name: str, detail: str) -> dict[str, Any]:
    return {"id": criterion_id, "name": name, "status": "not-evaluable", "detail": detail}


def evaluate_frozen_criteria(overall: dict[str, Any], regimes: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Evaluate only the five §12 claims, with no invented thresholds or proxies.

    The current row schema contains neither a frozen-baseline replay, benchmark
    comparison, trait-violation field, nor calibration observations. Those
    criteria therefore remain explicitly not-evaluable until the experiment
    registers those artifacts. Cap-fire is reportable from the existing rows.
    """
    criteria = [
        _not_evaluable(FROZEN_CRITERIA[0][0], FROZEN_CRITERIA[0][1], "identical candidate/baseline rows and the frozen comparison are not supplied"),
        _not_evaluable(FROZEN_CRITERIA[1][0], FROZEN_CRITERIA[1][1], "meaningful-volume definition and exam-raw violation journal are not supplied"),
        _not_evaluable(FROZEN_CRITERIA[2][0], FROZEN_CRITERIA[2][1], "existing frozen benchmark before/after results are not supplied"),
        _not_evaluable(FROZEN_CRITERIA[3][0], FROZEN_CRITERIA[3][1], "per-regime calibration observations and denominators are not present in this row schema"),
    ]
    cap = overall["clamp_intervention_rate"]
    rescued = overall["clamp_rescued_pass_count"]
    if cap["denominator"] == 0:
        criteria.append(_not_evaluable(FROZEN_CRITERIA[4][0], FROZEN_CRITERIA[4][1], "cap-fire journal has no scored rows"))
    elif rescued:
        criteria.append({"id": FROZEN_CRITERIA[4][0], "name": FROZEN_CRITERIA[4][1], "status": "void", "detail": f"{rescued} pass row(s) were rescued by the clamp; cap-fire pass is void"})
    else:
        criteria.append({"id": FROZEN_CRITERIA[4][0], "name": FROZEN_CRITERIA[4][1], "status": "pass", "detail": f"cap interventions journaled: {cap['numerator']}/{cap['denominator']}; no clamp-rescued pass"})
    return criteria


def verify_pack_file(path: Path) -> tuple[bool, str | None]:
    if not path.exists():
        return False, f"frozen pack bytes are absent: {path}"
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != PACK_SHA256:
        raise ScoreError(f"frozen pack hash mismatch: expected {PACK_SHA256}, got {actual}")
    return True, None


def score_rows(
    rows: list[dict[str, Any]],
    *,
    pack_verified: bool,
    criteria: dict[str, Any] | None = None,
) -> dict[str, Any]:
    seen: set[str] = set()
    for index, row in enumerate(rows, 1):
        validate_row(row, index)
        _require(row["id"] not in seen, f"duplicate row id: {row['id']}")
        seen.add(row["id"])

    by_regime: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_regime[row["regime"]].append(row)
    overall = summarize_group(rows)
    regimes = {name: summarize_group(group) for name, group in sorted(by_regime.items())}
    criterion_results = evaluate_frozen_criteria(overall, regimes) if criteria else []

    if not pack_verified:
        status = "ungraded_pack_bytes_unverified"
    elif not criteria:
        status = "ungraded_no_frozen_criteria"
    elif any(result["status"] in {"fail", "void"} for result in criterion_results):
        status = "fail"
    elif any(result["status"] != "pass" for result in criterion_results):
        status = "ungraded_frozen_criteria_not_evaluable"
    else:
        status = "pass"

    return {
        "schema": "synthetic-intuition-score-report-v1",
        "pack": {"version": PACK_VERSION, "sha256": PACK_SHA256, "bytes_verified": pack_verified},
        "overall_status": status,
        "input_rows": len(rows),
        "overall": overall,
        "by_regime": regimes,
        "criteria": criterion_results,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("predictions", type=Path, help="graded prediction JSONL")
    parser.add_argument("--pack", type=Path, default=Path(__file__).with_name("PACK-V1.1.md"), help="the exact frozen v1.1 pack bytes")
    parser.add_argument("--criteria", type=Path, help="canonical §12 pilot contract JSON; arbitrary metric/operator/threshold rules are rejected")
    parser.add_argument("--output", type=Path, help="write report JSON here instead of stdout")
    args = parser.parse_args(argv)
    try:
        rows = load_jsonl(args.predictions)
        pack_verified, missing_pack_warning = verify_pack_file(args.pack)
        criteria: dict[str, Any] | None = None
        if args.criteria:
            try:
                raw_criteria = json.loads(args.criteria.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise ScoreError(f"cannot read criteria JSON: {exc}") from exc
            validate_criteria(raw_criteria)
            criteria = raw_criteria
        report = score_rows(rows, pack_verified=pack_verified, criteria=criteria)
        if missing_pack_warning:
            report["warning"] = missing_pack_warning
        serialized = json.dumps(report, indent=2, sort_keys=True) + "\n"
        if args.output:
            args.output.write_text(serialized, encoding="utf-8")
        else:
            sys.stdout.write(serialized)
        return 0 if report["overall_status"] == "pass" else 2
    except ScoreError as exc:
        print(f"score.py: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
