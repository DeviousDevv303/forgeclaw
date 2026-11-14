#!/usr/bin/env python3
"""Run first-segment formation evidence for the frozen 25-row C3 swarm benchmark.

Only `nexus-intelligence.yml` is dispatched. Each run receives one frozen prompt,
empty context, create mode, and mirror=false. Generated tools/children are NOT
executed; therefore this is explicitly formation-only, not a full closed-loop C3
pass. Run the separately guarded live UI probes for real read-only child returns.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from swarm_grade import DEFAULT_BENCHMARK, FROZEN_SHA256, grade_trace, load_benchmark

OWNER = "DeviousDevv303"
REPO = "forgeclaw"
WORKFLOW_ID = "413150468"
API = f"https://api.github.com/repos/{OWNER}/{REPO}"
USER_AGENT = "ForgeClaw-Nexus-Swarm-Formation-Harness/1.0"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def api_request(token: str, method: str, path: str, payload: dict[str, Any] | None = None, timeout: int = 40) -> tuple[int, Any, dict[str, str]]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        API + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": USER_AGENT,
            **({"Content-Type": "application/json"} if data is not None else {}),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read()
            parsed = json.loads(body) if body else None
            return response.status, parsed, dict(response.headers.items())
    except urllib.error.HTTPError as exc:
        body = exc.read()
        try:
            parsed = json.loads(body) if body else None
        except json.JSONDecodeError:
            parsed = body.decode("utf-8", "replace")[:1000]
        return exc.code, parsed, dict(exc.headers.items())


def dispatch_once(token: str, row: dict[str, Any], run_tag: str) -> dict[str, Any]:
    invocation_id = f"swarm-{row['id']}-{run_tag}-{uuid.uuid4().hex[:8]}"
    payload = {
        "ref": "main",
        "inputs": {
            "task": row["prompt"],
            "context": "",
            "mode": "create",
            "invocation_id": invocation_id,
            "mirror": "false",
        },
    }
    status, body, _headers = api_request(token, "POST", f"/actions/workflows/{WORKFLOW_ID}/dispatches", payload)
    if status != 204:
        raise RuntimeError(f"{row['id']} dispatch failed with HTTP {status}: {body}")
    return {"row_id": row["id"], "invocation_id": invocation_id, "dispatch_status": status, "prompt": row["prompt"]}


def find_runs(token: str) -> list[dict[str, Any]]:
    status, body, _headers = api_request(token, "GET", f"/actions/workflows/{WORKFLOW_ID}/runs?event=workflow_dispatch&per_page=100")
    if status != 200 or not isinstance(body, dict):
        raise RuntimeError(f"workflow run listing failed with HTTP {status}: {body}")
    return body.get("workflow_runs", [])


def artifact_zip(token: str, url_path: str, timeout: int = 90) -> bytes:
    req = urllib.request.Request(API + url_path, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": USER_AGENT,
    })
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        if exc.code not in (301, 302, 303, 307, 308):
            raise RuntimeError(f"artifact redirect request failed with HTTP {exc.code}") from exc
        location = exc.headers.get("Location")
        if not location:
            raise RuntimeError("artifact download response did not include a redirect location") from exc
    # GitHub's signed artifact URL is fetched without forwarding the PAT.
    with urllib.request.urlopen(location, timeout=timeout) as response:
        return response.read()


def download_results(token: str, run: dict[str, Any], invocation_id: str) -> tuple[str, str]:
    run_id = int(run["id"])
    status, body, _headers = api_request(token, "GET", f"/actions/runs/{run_id}/artifacts?per_page=100")
    if status != 200 or not isinstance(body, dict):
        raise RuntimeError(f"artifact listing for run {run_id} failed with HTTP {status}: {body}")
    expected_name = f"nexus-{invocation_id}"
    match = next((item for item in body.get("artifacts", []) if item.get("name") == expected_name and not item.get("expired")), None)
    if not match:
        raise RuntimeError(f"run {run_id} has no unexpired {expected_name} artifact")
    archive = artifact_zip(token, f"/actions/artifacts/{int(match['id'])}/zip")
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        names = {Path(name).name: name for name in zipped.namelist()}
        if "result.txt" not in names or "result_meta.txt" not in names:
            raise RuntimeError(f"artifact {expected_name} is missing result.txt or result_meta.txt")
        raw = zipped.read(names["result.txt"]).decode("utf-8", "replace")
        meta = zipped.read(names["result_meta.txt"]).decode("utf-8", "replace")
    return raw, meta


def write_jsonl(path: Path, items: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text("".join(json.dumps(item, ensure_ascii=False) + "\n" for item in items), encoding="utf-8")
    temporary.replace(path)


def run_batch(
    token: str,
    rows: list[dict[str, Any]],
    out_dir: Path,
    concurrency: int,
    timeout: int,
    existing_dispatches: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    run_tag = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "dispatch-manifest.jsonl"
    dispatched: list[dict[str, Any]] = list(existing_dispatches or [])
    print(f"dispatching {len(rows) if existing_dispatches is None else 0} frozen rows, concurrency={concurrency}, mirror=false", flush=True)
    if existing_dispatches is None:
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = [pool.submit(dispatch_once, token, row, run_tag) for row in rows]
            for future in as_completed(futures):
                cell = future.result()
                dispatched.append(cell)
                write_jsonl(manifest_path, dispatched)
                print(f"dispatched {cell['row_id']} {cell['invocation_id']}", flush=True)
    else:
        write_jsonl(manifest_path, dispatched)
        print(f"resuming {len(dispatched)} existing invocations from {manifest_path}", flush=True)
    by_invocation = {cell["invocation_id"]: cell for cell in dispatched}
    deadline = time.monotonic() + timeout
    print(f"poll_timeout_seconds={timeout}", flush=True)
    completed: dict[str, dict[str, Any]] = {}
    while time.monotonic() < deadline and len(completed) < len(dispatched):
        runs = find_runs(token)
        for run in runs:
            title = str(run.get("display_title") or run.get("name") or "")
            invocation_id = next((candidate for candidate in by_invocation if candidate in title), None)
            if invocation_id:
                previous = completed.get(invocation_id)
                if run.get("status") == "completed" and (not previous or previous.get("status") != "completed"):
                    completed[invocation_id] = run
                elif invocation_id not in completed:
                    completed[invocation_id] = run
        done = sum(1 for run in completed.values() if run.get("status") == "completed")
        write_jsonl(out_dir / "workflow-run-status.jsonl", list(completed.values()))
        remaining_seconds = max(0, int(deadline - time.monotonic()))
        print(f"workflow_runs_completed={done}/{len(dispatched)} poll_timeout_remaining={remaining_seconds}s", flush=True)
        if done == len(dispatched):
            break
        time.sleep(15)
    missing = [item for item in by_invocation if item not in completed or completed[item].get("status") != "completed"]
    if missing:
        raise TimeoutError(f"timed out waiting for {len(missing)} workflows; invocation IDs: {', '.join(missing)}")

    rows_by_id = {row["id"]: row for row in rows}
    output: list[dict[str, Any]] = []
    for invocation_id, dispatch in by_invocation.items():
        run = completed[invocation_id]
        raw, meta = download_results(token, run, invocation_id)
        row = rows_by_id[dispatch["row_id"]]
        trace = {
            "row_id": row["id"],
            "evidence_type": "formation-only-first-segment; direct Nexus workflow; no tool executed",
            "end_to_end": False,
            "parent_segments": [raw],
            "parent_final_answer": None,
            "child_returns": [],
            "notes": [
                "This row's frozen prompt was dispatched as task with empty context and create mode.",
                "The Nexus workflow used mirror=false; output came from its run artifact.",
                "No generated spawn, search, shell, GitHub write, or other tool was executed.",
                "One first segment cannot prove multi-spawn sequencing, child returns, or parent synthesis.",
            ],
        }
        grade = grade_trace(row, trace)
        output.append({
            "row_id": row["id"],
            "prompt_verbatim": row["prompt"],
            "benchmark_sha256": FROZEN_SHA256,
            "invocation_id": invocation_id,
            "run_id": run.get("id"),
            "run_url": run.get("html_url"),
            "run_status": run.get("status"),
            "run_conclusion": run.get("conclusion"),
            "head_sha": run.get("head_sha"),
            "raw_segment_verbatim": raw,
            "result_meta_verbatim": meta,
            "grade": grade,
        })
    output.sort(key=lambda item: int(item["row_id"].split("-")[1]))
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "formation-traces.jsonl").write_text("".join(json.dumps(item, ensure_ascii=False) + "\n" for item in output), encoding="utf-8")
    summary = [
        "# Nexus C3 formation-only run",
        "",
        f"Benchmark SHA-256: `{FROZEN_SHA256}` (25 frozen rows).",
        "",
        "This run grades only each row's first raw Run 25 generation segment. It does not execute emitted tools or children; it therefore cannot certify full decomposition counts, sequencing, child return, or parent synthesis. The separate live UI traces provide read-only end-to-end evidence for mapped rows.",
        "",
        "| Row | Invocation | Run | First-segment spawn | Expected count | Formation valid | Count match |",
        "|---|---|---|---:|---:|---|---|",
    ]
    for item in output:
        grade = item["grade"]
        spawn_names = ", ".join(call.get("system_prompt", "")[:34] for call in grade["spawn_calls"]) or "none"
        expected = grade["expected_spawn_count"]
        expected_text = str(expected["min"]) if expected["min"] == expected["max"] else f"{expected['min']}–{expected['max']}"
        summary.append(f"| {item['row_id']} | `{item['invocation_id']}` | [#{item['run_id']}]({item['run_url']}) | {grade['observed_spawn_count']} {spawn_names} | {expected_text} | {grade['valid_formation']} | {grade['decomposition_match']} |")
    summary.append("")
    summary.append("A C3 gate verdict is intentionally not issued from first segments; consult the full raw traces and the live read-only probe report.")
    (out_dir / "FORMATION-GRADE.md").write_text("\n".join(summary) + "\n", encoding="utf-8")
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--benchmark", type=Path, default=DEFAULT_BENCHMARK)
    parser.add_argument("--out-dir", type=Path, default=None)
    parser.add_argument("--resume-manifest", type=Path, default=None, help="Resume already-dispatched rows from a JSONL dispatch manifest; does not dispatch again.")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--timeout-seconds", type=int, default=3600)
    args = parser.parse_args()
    token = os.environ.get("GH_TOKEN", "")
    if not token:
        raise SystemExit("GH_TOKEN must be present in the environment; its value is never printed or saved.")
    actual_sha = hashlib.sha256(args.benchmark.read_bytes()).hexdigest()
    if actual_sha != FROZEN_SHA256:
        raise SystemExit(f"refusing to run: frozen benchmark hash mismatch ({actual_sha})")
    rows = load_benchmark(args.benchmark)
    out_dir = args.out_dir or (args.resume_manifest.parent if args.resume_manifest else Path(__file__).resolve().parents[1] / "results" / ("manus-formation-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")))
    print(f"benchmark_sha256={actual_sha} rows={len(rows)}")
    existing_dispatches = None
    if args.resume_manifest:
        existing_dispatches = [json.loads(line) for line in args.resume_manifest.read_text(encoding="utf-8").splitlines() if line.strip()]
        by_row = {row["id"]: row for row in rows}
        if len(existing_dispatches) != len(rows) or {item.get("row_id") for item in existing_dispatches} != set(by_row):
            raise SystemExit("resume manifest must contain exactly one invocation for each frozen benchmark row")
        if len({item.get("invocation_id") for item in existing_dispatches}) != len(rows):
            raise SystemExit("resume manifest contains duplicate invocation IDs")
        for item in existing_dispatches:
            if item.get("prompt") != by_row[item["row_id"]]["prompt"]:
                raise SystemExit(f"resume manifest prompt mismatch for {item['row_id']}")
    run_batch(token, rows, out_dir, max(1, min(args.concurrency, 8)), args.timeout_seconds, existing_dispatches)
    print(f"saved={out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
