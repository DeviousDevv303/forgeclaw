#!/usr/bin/env python3
"""Deterministic grading for Nexus C3 swarm traces.

This module never dispatches tools. It consumes raw Nexus generation segments from a
live app trace or formation-only batch, uses the frozen benchmark as its only key,
and reports observations separately from unobserved end-to-end behavior.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_BENCHMARK = ROOT / "nexus-llm" / "benchmarks" / "eval-swarm.jsonl"
FROZEN_SHA256 = "e5ba5013dd99f3a1b39b7d163c19e556405966e69a5dcbd08a2ed1c9b62b4adb"
CALL_RE = re.compile(r"<\|call\|>([\s\S]*?)<\|/call\|>")
RESULT_RE = re.compile(r"<\|result:(ok|error)\|>([\s\S]*?)<\|/result\|>")
WRITE_TOOLS = {
    "shell_patch", "github_write_file", "github_merge_pr", "sculpt_self",
    "github_create_repo", "github_publish_site",
}


def load_benchmark(path: Path = DEFAULT_BENCHMARK, verify_hash: bool = True) -> list[dict[str, Any]]:
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if verify_hash and digest != FROZEN_SHA256:
        raise ValueError(f"Frozen benchmark hash mismatch: {digest}")
    rows = [json.loads(line) for line in raw.decode("utf-8").splitlines() if line.strip()]
    if len(rows) != 25 or len({row.get("id") for row in rows}) != 25:
        raise ValueError(f"Expected the unchanged 25-row benchmark; found {len(rows)} rows")
    return rows


def parse_call_block(block: str) -> dict[str, Any]:
    """Parse one <|call|> body; preserve malformed data verbatim for evidence."""
    try:
        data = json.loads(block)
    except (json.JSONDecodeError, TypeError) as exc:
        return {"valid_json": False, "name": None, "arguments": None,
                "raw": block, "parse_error": str(exc)}
    if not isinstance(data, dict):
        return {"valid_json": False, "name": None, "arguments": None,
                "raw": block, "parse_error": "call body is not a JSON object"}
    name = data.get("name")
    arguments = data.get("arguments", {})
    valid = isinstance(name, str) and bool(name) and isinstance(arguments, dict)
    return {"valid_json": valid, "name": name if isinstance(name, str) else None,
            "arguments": arguments if isinstance(arguments, dict) else None,
            "raw": block, "parse_error": None if valid else "call requires string name and object arguments"}


def first_call(raw_segment: str) -> dict[str, Any] | None:
    """Return the first call only, matching parseNexusSegment's production behavior."""
    match = CALL_RE.search(raw_segment or "")
    return parse_call_block(match.group(1)) if match else None


def split_tools(value: Any) -> tuple[set[str], bool]:
    """Return a comma-separated grant and whether the production schema type is valid."""
    if value is None:
        return set(), True  # omitted means all tools in ForgeClaw's spawn_agent contract
    if not isinstance(value, str):
        return set(), False
    return {part.strip() for part in value.split(",") if part.strip()}, True


def _expected_count(expect: dict[str, Any]) -> tuple[int, int]:
    wanted = expect.get("spawn_count", 0)
    if isinstance(wanted, int):
        return wanted, wanted
    if isinstance(wanted, dict):
        return int(wanted.get("min", 0)), int(wanted.get("max", wanted.get("min", 0)))
    raise ValueError(f"Unsupported spawn_count contract: {wanted!r}")


def _task_has(task: str, required: str) -> bool:
    return required.casefold() in task.casefold()


def grade_trace(row: dict[str, Any], trace: dict[str, Any]) -> dict[str, Any]:
    """Grade captured parent segments against one frozen row; never infer tool execution."""
    parent_segments = trace.get("parent_segments") or []
    if isinstance(parent_segments, str):
        parent_segments = [parent_segments]
    calls: list[dict[str, Any]] = []
    for segment in parent_segments:
        parsed = first_call(str(segment))
        if parsed is not None:
            calls.append(parsed)

    spawn_records: list[dict[str, Any]] = []
    malformed_spawn_candidates: list[dict[str, Any]] = []
    for call in calls:
        if call.get("name") == "spawn_agent":
            if call.get("valid_json") and isinstance(call.get("arguments"), dict):
                args = call["arguments"]
                system_prompt = args.get("system_prompt")
                task = args.get("task")
                tools, tools_type_valid = split_tools(args.get("tools"))
                well_formed = (
                    isinstance(system_prompt, str) and bool(system_prompt.strip())
                    and isinstance(task, str) and bool(task.strip())
                    and tools_type_valid
                )
                spawn_records.append({
                    "system_prompt": system_prompt if isinstance(system_prompt, str) else None,
                    "task": task if isinstance(task, str) else None,
                    "tools": sorted(tools),
                    "tools_omitted_means_all": args.get("tools") is None,
                    "well_formed": well_formed,
                    "raw_call": call["raw"],
                })
            else:
                malformed_spawn_candidates.append(call)
        elif not call.get("valid_json") and re.search(r"spawn_agent", str(call.get("raw", "")), re.I):
            malformed_spawn_candidates.append(call)

    expected_min, expected_max = _expected_count(row.get("expect", {}))
    observed = len(spawn_records) + len(malformed_spawn_candidates)
    count_match = expected_min <= observed <= expected_max
    expected_spawns = row.get("expect", {}).get("spawns", [])
    assignment_checks: list[dict[str, Any]] = []
    for index, expected in enumerate(expected_spawns):
        requirements = expected.get("task_must_include", [])
        eligible = []
        for actual_index, actual in enumerate(spawn_records):
            task = actual.get("task") or ""
            tools = set(actual.get("tools", []))
            include = set(expected.get("tools_include", []))
            exclude = set(expected.get("tools_exclude", []))
            eligible.append({
                "actual_index": actual_index,
                "brief_complete": all(_task_has(task, fact) for fact in requirements),
                "tools_include": sorted(include & tools),
                "tools_include_ok": include.issubset(tools),
                "tools_exclude_present": sorted(exclude & tools),
                "tools_exclude_ok": not bool(exclude & tools),
                "toolset_is_explicit": not actual.get("tools_omitted_means_all", False),
            })
        best = max(eligible, key=lambda item: (
            item["brief_complete"], item["tools_include_ok"], item["tools_exclude_ok"]
        ), default=None)
        assignment_checks.append({"expected_spawn_index": index, **(best or {
            "actual_index": None, "brief_complete": False, "tools_include": [],
            "tools_include_ok": False, "tools_exclude_present": [],
            "tools_exclude_ok": False, "toolset_is_explicit": False,
        })})

    all_spawn_calls_valid = not malformed_spawn_candidates and all(item["well_formed"] for item in spawn_records)
    restraint_required = row["id"] in {f"sw-{i:03d}" for i in range(1, 6)}
    readonly_violation = any(
        actual.get("tools_omitted_means_all") or bool(set(actual.get("tools", [])) & WRITE_TOOLS)
        for actual in spawn_records
    ) if any(
        set(item.get("tools_exclude", [])) & WRITE_TOOLS
        for item in expected_spawns
    ) else False
    if row.get("id") == "sw-024":
        readonly_violation = any(
            actual.get("tools_omitted_means_all") or bool(set(actual.get("tools", [])) & WRITE_TOOLS)
            for actual in spawn_records
        )

    missing_facts = []
    for expected_index, expected in enumerate(expected_spawns):
        match = assignment_checks[expected_index] if expected_index < len(assignment_checks) else None
        if not match or not match.get("brief_complete"):
            missing_facts.append({"spawn_index": expected_index, "facts": expected.get("task_must_include", [])})

    sw016_ok = None
    if row.get("id") == "sw-016":
        exact = ["[NEXUS LEARNING WARNING]", "src/lib/forgeTools.ts", "2237", "src/App.tsx", "2363"]
        sw016_ok = len(spawn_records) >= 2 and all(
            all(_task_has(spawn.get("task") or "", fact) for fact in exact)
            for spawn in spawn_records[:2]
        )

    sw017_ok = None
    if row.get("id") == "sw-017":
        sw017_ok = all(
            not actual.get("tools_omitted_means_all") and "nexus_reason" not in actual.get("tools", [])
            for actual in spawn_records
        )

    raw_results = []
    for context in trace.get("parent_contexts", []) or []:
        for status, body in RESULT_RE.findall(str(context)):
            raw_results.append({"status": status, "text": body})
    child_returns = trace.get("child_returns", []) or []
    final_answer = trace.get("parent_final_answer")
    has_returned_child = any(
        item.get("returned") is True if isinstance(item, dict) else bool(item)
        for item in child_returns
    )
    complete_live_trace = bool(trace.get("end_to_end") and has_returned_child and isinstance(final_answer, str) and final_answer.strip())

    return {
        "row_id": row["id"],
        "benchmark_hash": FROZEN_SHA256,
        "evidence_type": trace.get("evidence_type", "unspecified"),
        "expected_spawn_count": {"min": expected_min, "max": expected_max},
        "observed_spawn_count": observed,
        "decomposition_match": count_match,
        "valid_formation": all_spawn_calls_valid,
        "hard_fail_restraint": bool(restraint_required and observed != 0),
        "hard_fail_readonly_write_grant": readonly_violation,
        "brief_completeness": not missing_facts,
        "missing_required_facts": missing_facts,
        "assignments": assignment_checks,
        "sw016_self_containment": sw016_ok,
        "sw017_transport_discipline": sw017_ok,
        "returned_child_results_observed": len(child_returns),
        "parent_context_result_spans_observed": len(raw_results),
        "parent_final_answer_observed": bool(isinstance(final_answer, str) and final_answer.strip()),
        "parent_synthesis_end_to_end_structurally_observed": complete_live_trace,
        "sequence_and_timing_grade": "not_assessed_by_formation_only_trace" if not trace.get("end_to_end") else "requires_manual_review_of_raw_ordered_trace",
        "malformed_spawn_calls_verbatim": [item.get("raw", "") for item in malformed_spawn_candidates],
        "spawn_calls": spawn_records,
        "child_returns_verbatim": child_returns,
        "parent_final_answer_verbatim": final_answer,
        "notes": trace.get("notes", []),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("trace", type=Path, help="JSON trace object or JSONL records with row_id and parent_segments")
    parser.add_argument("--benchmark", type=Path, default=DEFAULT_BENCHMARK)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    rows = {row["id"]: row for row in load_benchmark(args.benchmark)}
    traces = []
    text = args.trace.read_text(encoding="utf-8")
    try:
        value = json.loads(text)
        traces = value if isinstance(value, list) else [value]
    except json.JSONDecodeError:
        traces = [json.loads(line) for line in text.splitlines() if line.strip()]
    grades = []
    for trace in traces:
        row_id = trace.get("row_id")
        if row_id not in rows:
            raise ValueError(f"Trace row_id {row_id!r} is not in the frozen benchmark")
        grades.append(grade_trace(rows[row_id], trace))
    output = json.dumps(grades, indent=2, ensure_ascii=False) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(output, encoding="utf-8")
    else:
        print(output, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
