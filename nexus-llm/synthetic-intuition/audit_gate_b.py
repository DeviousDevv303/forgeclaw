#!/usr/bin/env python3
"""Audit the committed Gate B pair geometry and summary without pretending raw outputs are present."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

PACK_SHA256 = "df158f084162069733896724163c7703a89593e788d21749f7e4dba7b3214654"
DISTANCE_RE = re.compile(r"BTC is ([+-]?[0-9]+(?:\.[0-9]+)?) bps")
TICKER_RE = re.compile(r"Propose a trade on (KX[A-Z0-9-]+):")
BOOK_RE = re.compile(r"YES ([0-9]+(?:\.[0-9]+)?)/([0-9]+(?:\.[0-9]+)?)c")
FAMILIES = {"magnitude_pos", "magnitude_neg", "sign"}


class AuditError(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AuditError(message)


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AuditError(f"cannot read JSON from {path}: {exc}") from exc
    require(isinstance(value, dict), f"{path}: expected an object")
    return value


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise AuditError(f"cannot read {path}: {exc}") from exc
    rows: list[dict[str, Any]] = []
    for line_no, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError as exc:
            raise AuditError(f"{path}:{line_no}: invalid JSON: {exc.msg}") from exc
        require(isinstance(item, dict), f"{path}:{line_no}: each row must be an object")
        rows.append(item)
    return rows


def normalized_prompt(prompt: str) -> str:
    return DISTANCE_RE.sub("BTC is <DISTANCE> bps", prompt)


def audit_pairs(rows: list[dict[str, Any]]) -> dict[str, Any]:
    require(len(rows) == 96, f"Gate B pair file must have 96 rows, got {len(rows)}")
    required = {"id", "pair_id", "family", "half", "prompt", "distance_bps", "book_yes", "expected_action", "mode", "prefix"}
    seen_ids: set[str] = set()
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    row_facts: dict[str, dict[str, Any]] = {}
    family_rows: Counter[str] = Counter()
    expected_actions: Counter[str] = Counter()

    for index, row in enumerate(rows, 1):
        missing = sorted(required - row.keys())
        require(not missing, f"row {index}: missing fields {missing}")
        require(isinstance(row["id"], str) and row["id"] not in seen_ids, f"row {index}: id must be unique text")
        seen_ids.add(row["id"])
        pair_id = row["pair_id"]
        require(isinstance(pair_id, str) and pair_id, f"row {index}: pair_id must be non-empty text")
        require(row["family"] in FAMILIES, f"{row['id']}: unknown family {row['family']!r}")
        require(isinstance(row["prompt"], str) and row["prompt"], f"{row['id']}: prompt required")
        distance = row["distance_bps"]
        require(isinstance(distance, (int, float)) and not isinstance(distance, bool) and math.isfinite(distance), f"{row['id']}: distance_bps must be finite numeric")
        dmatch = DISTANCE_RE.search(row["prompt"])
        require(dmatch is not None and math.isclose(float(dmatch.group(1)), float(distance), abs_tol=1e-9), f"{row['id']}: prompt distance does not match distance_bps")
        tmatch = TICKER_RE.search(row["prompt"])
        require(tmatch is not None, f"{row['id']}: ticker missing from prompt")
        require("-27FEB" in tmatch.group(1) or "-27MAR" in tmatch.group(1), f"{row['id']}: ticker is outside the stated Feb/Mar 2027 probe window")
        book = row["book_yes"]
        require(isinstance(book, list) and len(book) == 2 and all(isinstance(x, int) and not isinstance(x, bool) and 1 <= x <= 99 for x in book), f"{row['id']}: book_yes must be [bid, ask] cents")
        bmatch = BOOK_RE.search(row["prompt"])
        require(bmatch is not None and math.isclose(float(bmatch.group(1)), book[0], abs_tol=1e-9) and math.isclose(float(bmatch.group(2)), book[1], abs_tol=1e-9), f"{row['id']}: prompt YES book differs from book_yes")
        require(row["expected_action"] in {"propose_yes", "propose_no", "pass"}, f"{row['id']}: invalid expected_action")
        grouped[pair_id].append(row)
        family_rows[row["family"]] += 1
        expected_actions[row["expected_action"]] += 1
        row_facts[row["id"]] = {
            "pair_id": pair_id,
            "family": row["family"],
            "half": row["half"],
            "ticker": tmatch.group(1),
            "distance_bps": float(distance),
            "expected_action": row["expected_action"],
        }

    require(set(family_rows) == FAMILIES and all(family_rows[f] == 32 for f in FAMILIES), f"family row counts must be 32 each, got {dict(family_rows)}")
    require(len(grouped) == 48 and all(len(pair_rows) == 2 for pair_rows in grouped.values()), "expected 48 two-row pairs")
    family_pairs: Counter[str] = Counter()
    ticker_set: set[str] = set()

    for pair_id, pair_rows in grouped.items():
        a, b = pair_rows
        require(a["family"] == b["family"], f"{pair_id}: family differs within pair")
        fam = a["family"]
        family_pairs[fam] += 1
        require(normalized_prompt(a["prompt"]) == normalized_prompt(b["prompt"]), f"{pair_id}: prompt varies beyond the distance number")
        require(a["book_yes"] == b["book_yes"] and a["mode"] == b["mode"] and a["prefix"] == b["prefix"], f"{pair_id}: book/mode/prefix varies within pair")
        ta, tb = TICKER_RE.search(a["prompt"]).group(1), TICKER_RE.search(b["prompt"]).group(1)
        require(ta == tb, f"{pair_id}: ticker varies within pair")
        ticker_set.add(ta)
        arms = {r["half"]: r for r in pair_rows}
        require(len(arms) == 2, f"{pair_id}: half labels must be unique")

        if fam in {"magnitude_pos", "magnitude_neg"}:
            require(set(arms) == {"strong", "weak"}, f"{pair_id}: magnitude halves must be strong/weak")
            strong, weak = arms["strong"], arms["weak"]
            sign = 1 if fam == "magnitude_pos" else -1
            ds, dw = float(strong["distance_bps"]), float(weak["distance_bps"])
            require(sign * ds >= 11 and sign * ds <= 19, f"{pair_id}: strong distance outside 11–19 bps with expected sign")
            require(sign * dw >= 0.4 and sign * dw <= 1.9, f"{pair_id}: weak distance outside 0.4–1.9 bps with expected sign")
            expected = "propose_yes" if sign > 0 else "propose_no"
            require(strong["expected_action"] == expected and weak["expected_action"] == "pass", f"{pair_id}: magnitude gold labels do not match frozen direction/threshold")
        else:
            require(set(arms) == {"pos", "neg"}, f"{pair_id}: sign halves must be pos/neg")
            pos, neg = arms["pos"], arms["neg"]
            dp, dn = float(pos["distance_bps"]), float(neg["distance_bps"])
            require(11 <= dp <= 19 and -19 <= dn <= -11 and math.isclose(dp, abs(dn), abs_tol=1e-9), f"{pair_id}: sign pair must be matched ±11–19 bps")
            require(pos["expected_action"] == "propose_yes" and neg["expected_action"] == "propose_no", f"{pair_id}: sign gold labels do not invert side")

    require(dict(family_pairs) == {"magnitude_pos": 16, "magnitude_neg": 16, "sign": 16}, f"pair-family counts differ from 16/16/16: {dict(family_pairs)}")
    require(dict(expected_actions) == {"propose_no": 32, "propose_yes": 32, "pass": 32}, f"expected action counts differ from 32/32/32: {dict(expected_actions)}")
    return {
        "rows": 96,
        "pairs": 48,
        "pair_families": dict(sorted(family_pairs.items())),
        "rows_by_family": dict(sorted(family_rows.items())),
        "expected_actions": dict(sorted(expected_actions.items())),
        "unique_tickers": len(ticker_set),
        "prompt_variation": "distance_bps_only",
        "probe_tickers_feb_mar_2027": True,
        "row_facts": row_facts,
    }


def reconcile_summary(summary: dict[str, Any], pair_audit: dict[str, Any]) -> dict[str, Any]:
    require(summary.get("pairs_total") == pair_audit["pairs"] == 48, "summary pair total differs from pair file")
    require(summary.get("rows_total") == pair_audit["rows"] == 96, "summary row total differs from pair file")
    rows_correct = summary.get("rows_correct")
    row_accuracy = summary.get("row_accuracy")
    pairs_correct = summary.get("pairs_fully_correct_flip")
    flip_rate = summary.get("flip_rate")
    require(isinstance(rows_correct, int) and rows_correct == 24, "summary rows_correct is not the posted 24")
    require(isinstance(row_accuracy, (int, float)) and math.isclose(row_accuracy, rows_correct / 96, abs_tol=1e-12), "summary row_accuracy does not equal rows_correct/rows_total")
    require(pairs_correct == 0 and math.isclose(float(flip_rate), pairs_correct / 48, abs_tol=1e-12), "summary flip_rate does not equal pairs_fully_correct_flip/pairs_total")
    expected_by_family = {"magnitude_pos": "0/16", "magnitude_neg": "0/16", "sign": "0/16"}
    require(summary.get("by_family_pairs_correct") == expected_by_family, "summary family flips do not match the pair families")
    action_distribution = summary.get("action_distribution")
    require(action_distribution == {"pass": 88, "propose_unknown_side": 8}, "summary action distribution differs from published 88 pass / 8 unknown-side propose")
    require(sum(action_distribution.values()) == 96, "summary action counts do not sum to 96")
    all_pair_ids = {fact["pair_id"] for fact in pair_audit["row_facts"].values()}
    failed = summary.get("failed_pairs")
    require(isinstance(failed, list) and set(failed) == all_pair_ids and len(failed) == 48, "failed_pairs is not exactly the 48 probe pairs")
    corrupt = summary.get("corrupt_rows")
    require(isinstance(corrupt, list) and len(corrupt) == 8 and len(set(corrupt)) == 8, "expected eight unique corrupt row IDs")
    require(all(row_id in pair_audit["row_facts"] for row_id in corrupt), "corrupt_rows contains IDs absent from pair file")
    corrupt_expectations = Counter(pair_audit["row_facts"][row_id]["expected_action"] for row_id in corrupt)
    require(corrupt_expectations == {"pass": 8}, f"published corrupt rows are not all expected-pass halves: {dict(corrupt_expectations)}")
    return {
        "rows_correct": {"numerator": rows_correct, "denominator": 96, "value": row_accuracy},
        "full_pair_flips": {"numerator": pairs_correct, "denominator": 48, "value": flip_rate},
        "family_pair_flips": expected_by_family,
        "action_distribution": action_distribution,
        "corrupt_rows": {"count": 8, "denominator": 96, "expected_actions": dict(corrupt_expectations)},
        "summary_consistency": "consistent_with_pair_artifact",
        "raw_output_reproduced": False,
    }


def audit(pair_rows: list[dict[str, Any]], summary: dict[str, Any], pack_path: Path) -> dict[str, Any]:
    require(pack_path.is_file(), f"frozen pack missing: {pack_path}")
    pack_hash = hashlib.sha256(pack_path.read_bytes()).hexdigest()
    require(pack_hash == PACK_SHA256, f"frozen pack hash mismatch: expected {PACK_SHA256}, got {pack_hash}")
    pair_audit = audit_pairs(pair_rows)
    summary_audit = reconcile_summary(summary, pair_audit)
    return {
        "schema": "synthetic-intuition-gate-b-audit-v1",
        "pack_sha256": pack_hash,
        "pack_bytes_verified": True,
        "pair_file_geometry": {k: v for k, v in pair_audit.items() if k != "row_facts"},
        "published_summary": summary_audit,
        "verdict": "reported_probe_fail_consistent; raw model outputs still required for independent reproduction",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pairs", type=Path)
    parser.add_argument("summary", type=Path)
    parser.add_argument("--pack", type=Path, default=Path(__file__).with_name("PACK-V1.1.md"))
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        report = audit(read_jsonl(args.pairs), read_json(args.summary), args.pack)
        args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0
    except (AuditError, OSError) as exc:
        print(f"audit_gate_b.py: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
