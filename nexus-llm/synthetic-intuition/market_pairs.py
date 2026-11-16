#!/usr/bin/env python3
"""Generate market-distance minimal pairs and score the 48-pair Gate B probe shape.

The probe is eval-only. Training generation requires source-backed, graded pairs and
an exact frozen group-count manifest; no probe row is ever emitted as a training row.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter
from pathlib import Path
from typing import Any

import build_pairs as provenance

PACK_SHA256 = provenance.PACK_SHA256
STRONG_MIN_BPS = 11.0
STRONG_MAX_BPS = 19.0
WEAK_MIN_BPS = 0.4
WEAK_MAX_BPS = 1.9


def fail(condition: bool, message: str) -> None:
    if not condition:
        raise provenance.BuildError(message)


def finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def expected_side(distance_bps: float) -> str:
    return "yes" if distance_bps > 0 else "no"


def is_strong(distance_bps: float) -> bool:
    return STRONG_MIN_BPS <= abs(distance_bps) <= STRONG_MAX_BPS


def is_weak(distance_bps: float) -> bool:
    return WEAK_MIN_BPS <= abs(distance_bps) <= WEAK_MAX_BPS


def validate_market_pair(pair: dict[str, Any], index: int, repo_root: Path, *, training: bool) -> dict[str, Any]:
    pair_id = pair.get("pair_id")
    fail(isinstance(pair_id, str) and pair_id.strip(), f"pair {index}: pair_id is required")
    fail(pair.get("split") == ("train" if training else "eval_only"), f"{pair_id}: wrong split; eval probes must never enter training")
    fail(pair.get("pack_sha256") == PACK_SHA256, f"{pair_id}: pack hash mismatch")
    fail(pair.get("pair_type") in {"magnitude", "sign"}, f"{pair_id}: pair_type must be magnitude or sign")
    for key in ("regime", "design_group"):
        fail(isinstance(pair.get(key), str) and pair[key].strip(), f"{pair_id}: {key} is required")

    shared = pair.get("shared")
    fail(isinstance(shared, dict), f"{pair_id}: shared context is required")
    ticker = shared.get("ticker")
    fail(isinstance(ticker, str) and ticker.strip(), f"{pair_id}: exact ticker is required")
    for key in ("yes_ask_cents", "no_ask_cents"):
        value = shared.get(key)
        fail(isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 99, f"{pair_id}: explicit {key} in 1..99 is required")
    fail(finite_number(shared.get("max_stake")) and shared["max_stake"] > 0, f"{pair_id}: max_stake must be a positive JSON number")
    fail(isinstance(shared.get("rationale"), str) and shared["rationale"].strip(), f"{pair_id}: source-backed rationale is required")
    sources = shared.get("sources")
    fail(isinstance(sources, list) and sources and all(isinstance(s, str) and s.strip() for s in sources), f"{pair_id}: source strings are required")

    arms = pair.get("arms")
    fail(isinstance(arms, list) and len(arms) == 2, f"{pair_id}: exactly two arms are required")
    seen_ids: set[str] = set()
    normalized: list[dict[str, Any]] = []
    for arm in arms:
        fail(isinstance(arm, dict), f"{pair_id}: arm must be an object")
        fail(set(arm).issubset({"arm_id", "distance_bps", "target_probability"}), f"{pair_id}: only distance_bps may vary in the prompt; target_probability is an answer label")
        if arm.get("target_probability") is not None:
            fail(finite_number(arm["target_probability"]) and 0 < arm["target_probability"] < 1, f"{pair_id}: target_probability must be within (0,1)")
        arm_id = arm.get("arm_id")
        fail(isinstance(arm_id, str) and arm_id.strip() and arm_id not in seen_ids, f"{pair_id}: arm_id must be unique text")
        seen_ids.add(arm_id)
        distance = arm.get("distance_bps")
        fail(finite_number(distance) and distance != 0, f"{pair_id}/{arm_id}: nonzero numeric distance_bps required")
        side = expected_side(distance)
        normalized.append({**arm, "side": side, "distance_bps": float(distance)})

    if pair["pair_type"] == "magnitude":
        strong = [arm for arm in normalized if is_strong(arm["distance_bps"])]
        weak = [arm for arm in normalized if is_weak(arm["distance_bps"])]
        fail(len(strong) == len(weak) == 1, f"{pair_id}: magnitude pair needs one 11–19 bps strong and one 0.4–1.9 bps weak arm")
        fail((strong[0]["distance_bps"] > 0) == (weak[0]["distance_bps"] > 0), f"{pair_id}: magnitude arms must have the same sign")
        strong[0]["expected_action"] = "propose"
        weak[0]["expected_action"] = "pass"
    else:
        fail(all(is_strong(arm["distance_bps"]) for arm in normalized), f"{pair_id}: sign pair arms must both be strong (11–19 bps)")
        fail(normalized[0]["distance_bps"] * normalized[1]["distance_bps"] < 0, f"{pair_id}: sign pair must contain +d and −d")
        fail(math.isclose(abs(normalized[0]["distance_bps"]), abs(normalized[1]["distance_bps"]), abs_tol=1e-9), f"{pair_id}: sign pair magnitudes must match")
        for arm in normalized:
            arm["expected_action"] = "propose"

    for arm in normalized:
        if training and arm["expected_action"] == "propose":
            fail(finite_number(arm.get("target_probability")) and 0 < arm["target_probability"] < 1, f"{pair_id}/{arm['arm_id']}: training propose arm needs target_probability as a label")

    if training:
        pair_source = provenance.verify_source(pair, pair_id, repo_root)
    else:
        fail(pair.get("eval_only") is True, f"{pair_id}: probe rows must be explicitly marked eval_only")
        fail(pair.get("source") is None, f"{pair_id}: probe rows must not carry training-source metadata")
        pair_source = None

    return {"pair_id": pair_id, "pair_type": pair["pair_type"], "regime": pair["regime"], "design_group": pair["design_group"], "shared": shared, "arms": normalized, "source": pair_source}


def prompt_for(pair: dict[str, Any], arm: dict[str, Any]) -> str:
    shared = pair["shared"]
    yes_usd = shared["yes_ask_cents"] / 100
    no_usd = shared["no_ask_cents"] / 100
    return (
        f"Kalshi ticker: {shared['ticker']}\n"
        f"Order book asks: YES {shared['yes_ask_cents']}c (USD {yes_usd:.2f}); "
        f"NO {shared['no_ask_cents']}c (USD {no_usd:.2f}).\n"
        f"Max stake USD: {shared['max_stake']}.\n"
        f"Evidence/rationale: {shared['rationale']}\n"
        f"Sources: {'; '.join(shared['sources'])}\n"
        f"Signed distance: {arm['distance_bps']} bps."
    )


def expected_call(pair: dict[str, Any], arm: dict[str, Any]) -> dict[str, Any] | None:
    if arm["expected_action"] == "pass":
        return None
    shared = pair["shared"]
    side = arm["side"]
    # Use the explicit ask for the selected side; never infer NO ask from YES ask.
    ask_cents = shared["yes_ask_cents"] if side == "yes" else shared["no_ask_cents"]
    call_args = {
        "name": "funds_propose",
        "arguments": {
            "venue": "kalshi",
            "market": shared["ticker"],
            "side": side,
            "price": ask_cents / 100,
            "rationale": shared["rationale"],
            "sources": list(shared["sources"]),
            "max_stake": shared["max_stake"],
        }
    }
    if arm.get("target_probability") is not None:
        call_args["arguments"]["probability"] = arm["target_probability"]
    return call_args


def row_for(pair: dict[str, Any], arm: dict[str, Any]) -> dict[str, Any]:
    prompt = prompt_for(pair, arm)
    call = expected_call(pair, arm)
    if call is None:
        text = "<|route:direct|><|ev:not_verified|><|answer|>PASS. The evidence does not clear the frozen entry rule; no proposal was formed.<|/answer|><|end|>"
        spans: list[str] = []
    else:
        args = call["arguments"]
        json_call = json.dumps(call, ensure_ascii=False, separators=(",", ":"))
        price_text = f"{args['price']:.2f}"
        result = f"Proposal recorded for {args['market']} {args['side'].upper()} at ${price_text}; awaiting owner approval (auto-approve off)."
        text = f"<|route:tool|><|call|>{json_call}<|/call|><|result:ok|>{result}<|/result|><|ev:attempted|><|answer|>Proposal drafted for owner review; no order was placed.<|/answer|><|end|>"
        candidates = [args["market"], price_text, str(args["max_stake"]), args["rationale"], *args["sources"]]
        if "probability" in args:
            candidates.append(str(args["probability"]))
        spans = list(dict.fromkeys(value for value in candidates if isinstance(value, str) and len(value) >= 2 and value in prompt and value in text))
    return {
        "id": f"market-intuition-{pair['pair_id']}-{arm['arm_id']}",
        "synthetic": True,
        "prompt": prompt,
        "text": text,
        "kind": f"intuition_market_{pair['pair_type']}_pair",
        "mode": "copy" if spans else "create",
        "copySpans": spans,
        "guardian_eligible": False,
        "class_source": "synthetic-intuition-pack-v1.1",
        "pair_id": pair["pair_id"],
        "pair_arm": arm["arm_id"],
        "pair_type": pair["pair_type"],
        "regime": pair["regime"],
        "design_group": pair["design_group"],
        "distance_bps": arm["distance_bps"],
        "expected_action": arm["expected_action"],
        "expected_side": arm["side"] if arm["expected_action"] == "propose" else None,
        "expected_call": call,
        "pack_sha256": PACK_SHA256,
        "source_record_id": pair["source"]["record_id"] if pair["source"] else None,
        "source_sha256": pair["source"]["sha256"] if pair["source"] else None,
        "eval_only": pair["source"] is None,
        "eval_excluded": pair["source"] is not None,
    }


def validate_gate_b_template(pairs: list[dict[str, Any]], repo_root: Path) -> list[dict[str, Any]]:
    normalized = [validate_market_pair(pair, idx, repo_root, training=False) for idx, pair in enumerate(pairs, 1)]
    fail(len(normalized) == 48, f"Gate B probe template must contain exactly 48 pairs; got {len(normalized)}")
    counts = Counter((pair["pair_type"], 1 if pair["pair_type"] == "magnitude" and pair["arms"][0]["distance_bps"] > 0 else -1) for pair in normalized if pair["pair_type"] == "magnitude")
    magnitude_positive = sum(1 for pair in normalized if pair["pair_type"] == "magnitude" and pair["arms"][0]["distance_bps"] > 0)
    magnitude_negative = sum(1 for pair in normalized if pair["pair_type"] == "magnitude" and pair["arms"][0]["distance_bps"] < 0)
    sign_count = sum(pair["pair_type"] == "sign" for pair in normalized)
    fail((magnitude_positive, magnitude_negative, sign_count) == (16, 16, 16), f"Gate B template needs 16 positive magnitude, 16 negative magnitude, 16 sign pairs; got {(magnitude_positive, magnitude_negative, sign_count)}")
    return normalized


def build_market_rows(pairs: list[dict[str, Any]], design: dict[str, Any], repo_root: Path) -> list[dict[str, Any]]:
    normalized = [validate_market_pair(pair, index, repo_root, training=True) for index, pair in enumerate(pairs, 1)]
    ids = [pair["pair_id"] for pair in normalized]
    fail(len(ids) == len(set(ids)), "duplicate training pair_id")
    actual = Counter(pair["design_group"] for pair in normalized)
    expected = design.get("target_pairs_by_group")
    fail(isinstance(expected, dict) and bool(expected), "frozen mix design needs target_pairs_by_group")
    fail(dict(actual) == expected, f"generated pair group counts differ from frozen design: actual={dict(actual)}, expected={expected}")
    return [row_for(pair, arm) for pair in normalized for arm in pair["arms"]]


def reject_training_overlap(pairs: list[dict[str, Any]], training_rows: list[dict[str, Any]], tranche6_rows: list[dict[str, Any]]) -> None:
    training_text = []
    for row in [*training_rows, *tranche6_rows]:
        for field in ("prompt", "text"):
            value = row.get(field)
            if isinstance(value, str):
                training_text.append(" ".join(value.split()))
    exact_prompts = set(training_text)
    for pair in pairs:
        ticker = pair["shared"]["ticker"]
        for arm in pair["arms"]:
            prompt = " ".join(prompt_for(pair, arm).split())
            fail(prompt not in exact_prompts, f"{pair['pair_id']}/{arm['arm_id']}: probe prompt duplicates training content")
        fail(not any(ticker in text for text in training_text), f"{pair['pair_id']}: probe ticker is present in training mix or tranche-6")


def score_probe(pairs: list[dict[str, Any]], outputs: list[dict[str, Any]], *, pack_verified: bool) -> dict[str, Any]:
    expected = {(pair["pair_id"], arm["arm_id"]): (pair, arm) for pair in pairs for arm in pair["arms"]}
    seen: set[tuple[str, str]] = set()
    bad_rows = 0
    expected_propose = 0
    correct_propose = 0
    action_correct = 0
    side_correct = 0
    price_correct = 0
    ticker_correct = 0
    numeric_integrity = 0
    pair_flip_correct = 0
    rows_by_pair: dict[str, list[dict[str, Any]]] = {}
    for idx, row in enumerate(outputs, 1):
        key = (row.get("pair_id"), row.get("arm_id"))
        fail(key in expected, f"output {idx}: unknown pair/arm {key}")
        fail(key not in seen, f"output {idx}: duplicate pair/arm {key}")
        seen.add(key)
        pair, arm = expected[key]
        rows_by_pair.setdefault(key[0], []).append(row)
        action = row.get("action")
        correct_action = action == arm["expected_action"]
        action_correct += int(correct_action)
        if arm["expected_action"] == "propose":
            expected_propose += 1
            call = row.get("call")
            correct_call = isinstance(call, dict) and call.get("name") == "funds_propose" and isinstance(call.get("arguments"), dict)
            if correct_call:
                args = call["arguments"]
                expected_args = expected_call(pair, arm)["arguments"]
                ticker_ok = args.get("market") == pair["shared"]["ticker"]
                ticker_correct += int(ticker_ok)
                side_ok = args.get("side") == arm["side"]
                side_correct += int(side_ok)
                ask_key = "yes_ask_cents" if arm["side"] == "yes" else "no_ask_cents"
                price_ok = finite_number(args.get("price")) and args["price"] == pair["shared"][ask_key] / 100
                price_correct += int(price_ok)
                numeric_ok = (
                    finite_number(args.get("price")) and args["price"] == expected_args["price"]
                    and finite_number(args.get("max_stake")) and args["max_stake"] == expected_args["max_stake"]
                    and finite_number(args.get("probability")) and 0 < args["probability"] < 1
                    and ("probability" not in expected_args or args["probability"] == expected_args["probability"])
                )
                numeric_integrity += int(numeric_ok)
                expected_keys = set(expected_args) | {"probability"}
                required_ok = set(args) == expected_keys and all(args.get(k) == v for k, v in expected_args.items() if k not in {"price", "probability", "max_stake"})
                if correct_action and ticker_ok and side_ok and price_ok and numeric_ok and required_ok:
                    correct_propose += 1
                else:
                    bad_rows += 1
            else:
                bad_rows += 1
        else:
            if row.get("call") is None and correct_action:
                pass
            else:
                bad_rows += 1

    missing = sorted(set(expected) - seen)
    fail(not missing, f"probe outputs missing {len(missing)} pair/arm predictions")
    for pair in pairs:
        arm_rows = rows_by_pair.get(pair["pair_id"], [])
        if len(arm_rows) != 2:
            continue
        by_arm = {r["arm_id"]: r for r in arm_rows}
        arms = {a["arm_id"]: a for a in pair["arms"]}
        if pair["pair_type"] == "magnitude":
            strong = next(a for a in pair["arms"] if is_strong(a["distance_bps"]))
            weak = next(a for a in pair["arms"] if is_weak(a["distance_bps"]))
            flipped = by_arm[strong["arm_id"]].get("action") == "propose" and by_arm[weak["arm_id"]].get("action") == "pass"
        else:
            positive = next(a for a in pair["arms"] if a["distance_bps"] > 0)
            negative = next(a for a in pair["arms"] if a["distance_bps"] < 0)
            pos_call = by_arm[positive["arm_id"]].get("call") or {}
            neg_call = by_arm[negative["arm_id"]].get("call") or {}
            flipped = (
                by_arm[positive["arm_id"]].get("action") == "propose"
                and by_arm[negative["arm_id"]].get("action") == "propose"
                and pos_call.get("arguments", {}).get("side") == "yes"
                and neg_call.get("arguments", {}).get("side") == "no"
            )
        pair_flip_correct += int(flipped)

    denominator = len(outputs)
    full_pairs = len(pairs)
    passed = pair_flip_correct == full_pairs and action_correct == denominator and correct_propose == expected_propose and bad_rows == 0
    status = "pass" if passed and pack_verified else ("ungraded_pack_bytes_unverified" if passed else "fail")
    return {
        "schema": "synthetic-intuition-gate-b-report-v1",
        "pack_sha256": PACK_SHA256,
        "pack_bytes_verified": pack_verified,
        "status": status,
        "pairs": full_pairs,
        "rows": denominator,
        "expected_action_flips": {"correct": pair_flip_correct, "denominator": full_pairs},
        "row_action_accuracy": {"correct": action_correct, "denominator": denominator},
        "expected_propose_rows": expected_propose,
        "valid_exact_proposals": correct_propose,
        "ticker_exact": ticker_correct,
        "side_exact": side_correct,
        "side_ask_price_exact": price_correct,
        "numeric_fields_exact": numeric_integrity,
        "bad_rows": bad_rows,
    }


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    return provenance.read_jsonl(path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pairs", type=Path, help="48-pair Gate B probe JSONL; eval only")
    parser.add_argument("outputs", type=Path, help="one parsed model prediction per probe row")
    parser.add_argument("--pack", type=Path, default=Path(__file__).with_name("PACK-V1.1.md"))
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).parents[2])
    parser.add_argument("--training-mix", type=Path, required=True, help="full Run 31 mix for overlap checks")
    parser.add_argument("--tranche6", type=Path, required=True, help="tranche-6 source rows for overlap checks")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        pairs_raw = load_jsonl(args.pairs)
        pairs = validate_gate_b_template(pairs_raw, args.repo_root)
        reject_training_overlap(pairs, load_jsonl(args.training_mix), load_jsonl(args.tranche6))
        outputs = load_jsonl(args.outputs)
        pack_verified = False
        if args.pack.is_file():
            provenance.verify_pack(args.pack)
            pack_verified = True
        report = score_probe(pairs, outputs, pack_verified=pack_verified)
        args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0 if report["status"] == "pass" else 2
    except (provenance.BuildError, OSError) as exc:
        print(f"market_pairs.py: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
