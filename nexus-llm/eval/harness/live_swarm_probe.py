#!/usr/bin/env python3
"""Run the two assigned read-only swarm probes through the deployed ForgeClaw UI.

Requires GH_TOKEN in the environment, Python Playwright, and an installed Chromium.
The browser context is ephemeral. The GitHub token is injected in memory only and
is never written to the evidence files. Non-GET requests are blocked except the
three read-only/trace workflows used by these probes: Nexus Intelligence,
DuckDuckGo search, and deep research.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

try:
    from playwright.sync_api import Browser, Page, Request, Response, Route, sync_playwright
except ImportError as exc:  # pragma: no cover - environment guidance
    raise SystemExit("Playwright is required: pip install playwright && python -m playwright install chromium") from exc

from swarm_grade import DEFAULT_BENCHMARK, grade_trace, load_benchmark

DEFAULT_APP = "https://deviousdevv303.github.io/forgeclaw/"
OWNER = "DeviousDevv303"
REPO = "forgeclaw"
ALLOWED_WORKFLOWS = {"nexus-intelligence.yml", "ddg_search.yml", "deep-research.yml"}
CALL_RE = re.compile(r"<\|call\|>([\s\S]*?)<\|/call\|>")
ANSWER_RE = re.compile(r"<\|answer\|>([\s\S]*?)(?:<\|/answer\|>|$)")


def scrub(value: Any, secret: str) -> Any:
    if isinstance(value, str):
        return value.replace(secret, "[REDACTED]") if secret else value
    if isinstance(value, list):
        return [scrub(item, secret) for item in value]
    if isinstance(value, dict):
        return {key: ("[REDACTED]" if re.search(r"token|authorization|secret|api[_-]?key|private[_-]?key", str(key), re.I) else scrub(item, secret)) for key, item in value.items()}
    return value


def extract_nexus_segment(body: str) -> str:
    """The Nexus mirror contains the raw one-segment grammar; preserve it unchanged."""
    return body.strip("\ufeff\r\n")


def parse_calls(raw: str) -> list[dict[str, Any]]:
    calls = []
    for match in CALL_RE.finditer(raw):
        block = match.group(1)
        try:
            decoded = json.loads(block)
            if isinstance(decoded, dict):
                calls.append({"name": decoded.get("name"), "arguments": decoded.get("arguments", {}), "raw": block, "parse_error": None})
            else:
                calls.append({"name": None, "arguments": None, "raw": block, "parse_error": "call body is not an object"})
        except json.JSONDecodeError as exc:
            calls.append({"name": None, "arguments": None, "raw": block, "parse_error": str(exc)})
    return calls


def final_answer(raw: str) -> str | None:
    if CALL_RE.search(raw):
        return None
    match = ANSWER_RE.search(raw)
    if match:
        return match.group(1).strip()
    # The production parser displays grammar-stripped text for unframed answers.
    cleaned = re.sub(r"<\|/?[a-z_]+(?::[a-z_]+)?\|>", "", raw).strip()
    return cleaned or None


def read_result_body(response: Response) -> tuple[str | None, str | None]:
    try:
        body = response.text()
    except Exception:
        return None, "response body unavailable"
    path = urlsplit(response.url).path
    if "api.github.com" in urlsplit(response.url).netloc:
        try:
            data = json.loads(body)
            if isinstance(data, dict) and data.get("encoding") == "base64" and isinstance(data.get("content"), str):
                decoded = base64.b64decode(data["content"].replace("\n", "")).decode("utf-8", "replace")
                return decoded, None
        except (json.JSONDecodeError, ValueError, UnicodeDecodeError):
            pass
    return body, None


def history_state(page: Page) -> dict[str, Any]:
    return page.evaluate("""() => {
      try {
        const messages = JSON.parse(localStorage.getItem('forgemind_history') || '[]');
        const last = messages[messages.length - 1] || null;
        return {count: messages.length, lastRole: last?.role || null,
          streaming: last?.streaming === true, content: last?.content || '',
          provider: last?.provider || null, model: last?.model || null};
      } catch { return {count: 0, lastRole: null, streaming: false, content: ''}; }
    }""")


def fetch_deployed_version() -> dict[str, Any]:
    import urllib.request
    with urllib.request.urlopen(DEFAULT_APP.rstrip("/") + "/version.json", timeout=30) as response:
        data = json.loads(response.read().decode("utf-8"))
    return {"commit": data.get("commit"), "builtAt": data.get("builtAt")}


def run_one(browser: Browser, token: str, app_url: str, row: dict[str, Any], out_dir: Path, timeout: int) -> dict[str, Any]:
    prompt = row["prompt"]
    context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
    init = (
        "localStorage.setItem('gh_token', " + json.dumps(token) + ");"
        "localStorage.setItem('fm_provider', 'nexus-intelligence');"
        f"localStorage.setItem('fc_gh_owner', {json.dumps(OWNER)});"
        f"localStorage.setItem('fc_gh_repo', {json.dumps(REPO)});"
        "localStorage.removeItem('forgemind_history');"
        "localStorage.removeItem('forgemind_corpus');"
    )
    context.add_init_script(init)
    page = context.new_page()
    state: dict[str, Any] = {
        "prompt": prompt,
        "allowed_workflow_dispatches": [],
        "workflow_responses": [],
        "nexus_results": {},
        "metadata_results": {},
        "blocked_requests": [],
        "errors": [],
    }

    def safety_route(route: Route) -> None:
        request = route.request
        split = urlsplit(request.url)
        path = split.path
        method = request.method.upper()
        if method in {"GET", "HEAD", "OPTIONS"}:
            route.continue_()
            return
        match = re.search(r"/actions/workflows/([^/]+)/dispatches$", path)
        workflow = match.group(1) if match else None
        if split.netloc == "api.github.com" and method == "POST" and workflow in ALLOWED_WORKFLOWS:
            try:
                payload = request.post_data_json
            except Exception:
                payload = None
            event = {
                "workflow": workflow,
                "method": method,
                "path": path,
                "payload": scrub(payload, token),
                "status": None,
            }
            state["allowed_workflow_dispatches"].append(event)
            route.continue_()
            return
        state["blocked_requests"].append({"method": method, "host": split.netloc, "path": path, "reason": "only Nexus, DDG search and deep-research workflow dispatches are allowed"})
        route.fulfill(status=451, content_type="text/plain", body="Harness safety boundary: this non-read-only request was blocked.")

    def on_response(response: Response) -> None:
        url = response.url
        path = urlsplit(url).path
        if "/actions/workflows/" in path and path.endswith("/dispatches"):
            for event in reversed(state["allowed_workflow_dispatches"]):
                if event["path"] == path and event["status"] is None:
                    event["status"] = response.status
                    break
        lower = path.lower()
        if "nexus-results" in lower and lower.endswith((".txt", ".meta.txt")):
            content, error = read_result_body(response)
            if content is not None:
                key = Path(path).name
                dest = state["metadata_results"] if key.endswith(".meta.txt") else state["nexus_results"]
                dest[key] = {"status": response.status, "raw": content}
                if error:
                    state["errors"].append(error)
        if "api.github.com" in urlsplit(url).netloc and "/actions/workflows/" in path and path.endswith("/runs"):
            try:
                data = response.json()
                if isinstance(data, dict) and isinstance(data.get("workflow_runs"), list):
                    runs = [{key: run.get(key) for key in ("id", "name", "display_title", "status", "conclusion", "html_url", "run_number")} for run in data["workflow_runs"]]
                    state["workflow_responses"].append({"path": path, "status": response.status, "runs": runs})
            except Exception:
                pass

    page.route("**/*", safety_route)
    page.on("response", on_response)
    started_at = datetime.now(timezone.utc).isoformat()
    try:
        page.goto(app_url, wait_until="domcontentloaded", timeout=90_000)
        composer = page.locator('textarea[placeholder*="Nexus Intelligence"]').first
        composer.wait_for(timeout=90_000)
        send = page.get_by_role("button", name="SEND", exact=True)
        if send.count() != 1:
            raise RuntimeError(f"Expected one SEND button, found {send.count()}")
        ui_before = page.locator("body").inner_text()
        composer.fill(prompt)
        send.click()
        deadline = time.monotonic() + timeout
        finished = None
        while time.monotonic() < deadline:
            finished = history_state(page)
            all_ids = {
                str((event.get("payload") or {}).get("inputs", {}).get("invocation_id"))
                for event in state["allowed_workflow_dispatches"]
                if event.get("workflow") == "nexus-intelligence.yml"
            }
            result_ids = {Path(filename).stem for filename in state["nexus_results"]}
            pending = {item for item in all_ids if item and item not in result_ids}
            is_done = finished.get("lastRole") == "assistant" and not finished.get("streaming") and bool(finished.get("content"))
            if is_done and not pending:
                # Allow the final app state and late mirror metadata response to settle.
                time.sleep(4)
                finished = history_state(page)
                if finished.get("lastRole") == "assistant" and not finished.get("streaming"):
                    break
            time.sleep(1)
        else:
            raise TimeoutError(f"UI turn did not settle within {timeout}s; last assistant state={finished}")
        screenshot = out_dir / f"{row['id']}-ui.png"
        page.screenshot(path=str(screenshot), full_page=True)
        history = page.evaluate("""() => { try { return JSON.parse(localStorage.getItem('forgemind_history') || '[]'); } catch { return []; } }""")
        visible_answer = str(finished.get("content", ""))
        dispatches = state["allowed_workflow_dispatches"]
        invocation_inputs = []
        for event in dispatches:
            payload = event.get("payload") or {}
            inputs = payload.get("inputs") if isinstance(payload, dict) else None
            if isinstance(inputs, dict):
                invocation_inputs.append({"workflow": event["workflow"], "inputs": scrub(inputs, token), "status": event.get("status")})
        nexus_results = []
        for filename, item in state["nexus_results"].items():
            invocation_id = filename.removesuffix(".txt")
            nexus_results.append({"invocation_id": invocation_id, "status": item["status"], "raw_segment": extract_nexus_segment(item["raw"])})
        request_inputs = [item for item in invocation_inputs if item["workflow"] == "nexus-intelligence.yml"]
        by_id = {item["invocation_id"]: item for item in nexus_results}
        root_ids = []
        parent_segments = []
        parent_contexts = []
        for item in request_inputs:
            inputs = item["inputs"]
            if inputs.get("task", "").strip() == prompt.strip():
                invocation_id = str(inputs.get("invocation_id", ""))
                root_ids.append(invocation_id)
                result = by_id.get(invocation_id)
                if result:
                    parent_segments.append(result["raw_segment"])
                if inputs.get("context"):
                    parent_contexts.append(str(inputs["context"]))
        parsed_parent_calls = []
        for segment in parent_segments:
            parsed_parent_calls.extend(parse_calls(segment))
        spawns = [call.get("arguments") for call in parsed_parent_calls if call.get("name") == "spawn_agent" and isinstance(call.get("arguments"), dict)]
        child_returns = []
        child_segments = []
        for spawn_index, spawn in enumerate(spawns):
            task = str(spawn.get("task", ""))
            matches = [item for item in request_inputs if item["inputs"].get("task", "").strip() == task.strip()]
            if not matches:
                child_returns.append({"spawn_index": spawn_index, "task": task, "returned": False, "text": None, "invocation_ids": []})
                continue
            child_ids = [str(item["inputs"].get("invocation_id", "")) for item in matches]
            candidate_segments = [by_id[child_id]["raw_segment"] for child_id in child_ids if child_id in by_id]
            child_segments.extend({"spawn_index": spawn_index, "invocation_id": child_id, "raw_segment": by_id[child_id]["raw_segment"]} for child_id in child_ids if child_id in by_id)
            returned = None
            for segment in candidate_segments:
                answer = final_answer(segment)
                if answer:
                    returned = answer
            child_returns.append({"spawn_index": spawn_index, "task": task, "returned": bool(returned), "text": returned, "invocation_ids": child_ids})
        parent_final = None
        for segment in parent_segments:
            answer = final_answer(segment)
            if answer:
                parent_final = answer
        trace = {
            "row_id": row["id"],
            "evidence_type": "Manus-run deployed live UI, Run 25 checkpoint",
            "end_to_end": True,
            "prompt_verbatim": prompt,
            "started_at": started_at,
            "deployed_version": fetch_deployed_version(),
            "root_invocation_ids": root_ids,
            "invocations": invocation_inputs,
            "raw_nexus_segments": nexus_results,
            "parent_segments": parent_segments,
            "parent_contexts": parent_contexts,
            "child_segments": child_segments,
            "child_returns": child_returns,
            "parent_final_answer": parent_final,
            "rendered_answer": visible_answer,
            "ui_before_prompt": ui_before,
            "blocked_requests": state["blocked_requests"],
            "workflow_run_snapshots": state["workflow_responses"],
            "metadata_results": state["metadata_results"],
            "notes": [
                "The token was injected into a fresh in-memory browser context and is excluded from evidence files.",
                "Every non-GET/HEAD/OPTIONS request was blocked except dispatches to nexus-intelligence.yml, ddg_search.yml and deep-research.yml.",
                "No benchmark write/create action is authorized by this harness.",
            ],
            "screenshot": screenshot.name,
        }
        grade = grade_trace(row, trace)
        return {"trace": trace, "grade": grade}
    except Exception as exc:
        state["errors"].append(f"{type(exc).__name__}: {exc}")
        raise
    finally:
        context.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-url", default=DEFAULT_APP)
    parser.add_argument("--benchmark", type=Path, default=DEFAULT_BENCHMARK)
    parser.add_argument("--out-dir", type=Path, default=None)
    parser.add_argument("--probe", choices=("A", "B", "all"), default="all")
    parser.add_argument("--timeout-seconds", type=int, default=3600)
    args = parser.parse_args()
    token = os.environ.get("GH_TOKEN", "")
    if not token:
        raise SystemExit("GH_TOKEN must be present in the environment; its value is never printed or saved.")
    rows = {row["id"]: row for row in load_benchmark(args.benchmark)}
    selected_ids = {"A": ["sw-020"], "B": ["sw-016"], "all": ["sw-020", "sw-016"]}[args.probe]
    out_dir = args.out_dir or (Path(__file__).resolve().parents[1] / "results" / ("manus-run-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")))
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"app={args.app_url}")
    print(f"benchmark_sha256={hashlib_sha(args.benchmark)} rows={len(rows)} probes={','.join(selected_ids)}")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for row_id in selected_ids:
                print(f"RUN {row_id}: {rows[row_id]['prompt']}", flush=True)
                result = run_one(browser, token, args.app_url, rows[row_id], out_dir, args.timeout_seconds)
                trace_path = out_dir / f"{row_id}-trace.json"
                grade_path = out_dir / f"{row_id}-grade.json"
                trace_path.write_text(json.dumps(result["trace"], indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                grade_path.write_text(json.dumps(result["grade"], indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                print(f"DONE {row_id}: spawns={result['grade']['observed_spawn_count']} expected={result['grade']['expected_spawn_count']} returns={result['grade']['returned_child_results_observed']} parent_answer={result['grade']['parent_final_answer_observed']} blocked={len(result['trace']['blocked_requests'])}", flush=True)
        finally:
            browser.close()
    return 0


def hashlib_sha(path: Path) -> str:
    import hashlib
    return hashlib.sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
