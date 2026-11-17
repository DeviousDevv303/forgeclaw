#!/usr/bin/env python3
"""SPEC-gates runner for the Nexus Coding + Swarm Benchmark Pack (../SPEC.md).

Grades a checkpoint against the three frozen gates:
  C1 CODING-SHELL  (eval-coding.jsonl cs-001..cs-034)
  C2 CODING-PATCH  (eval-coding.jsonl cp-001..cp-006)
  C3 SWARM         (eval-swarm.jsonl  sw-001..sw-025)

Design, per the SPEC's harness facts:
- The checkpoint is driven with each row's prompt in the standard chat frame
  (trainer common.frame) with the mode token the dispatcher would present:
  create for shell/patch rows (the model composes), copy for swarm rows (the
  briefs carry prompt material verbatim) -- the same labels the run mixes carry.
- Decoding is UNCONSTRAINED greedy. Constrained decoding would manufacture
  well-formedness the gate exists to measure.
- Generation captures the FULL turn (stop at <|end|> only), because a swarm
  formation is several calls in one turn. The first emitted call is the C1/C2
  formation; every call counts for C3.
- C1 two-turn mode: rows flagged execute:true feed back the row's real result
  -- the KEY command run in the pinned checkout (a frozen, verified read
  command; the result is a property of the row) -- and the final answer is
  graded for use of the key's result_contains facts. Grounded rate is
  reported, not gated (SPEC, Gate C1 format paragraph), and is computed only
  over rows whose command was correct.
- C2 patch validity is judged by the repository's own instruments, never
  reimplemented: checkUnifiedDiff from the pinned checkout (via vite-node)
  and `git apply --check` against the pinned checkout; the applied result is
  byte-compared against the key patch's applied result in twin worktrees.

Usage:
  run_gates.py fixture [--pin DIR]
  run_gates.py generate --ckpt PATH [--trainer-dir DIR] [--pin DIR] --out PREDS
  run_gates.py score --preds PREDS [--pin DIR] --out-dir DIR [--subject NAME]
  run_gates.py all --ckpt PATH --out-dir DIR [--subject NAME]

Defaults: --pin ~/workspace/fc-main-check (the SPEC's pinned checkout,
e412568b), --trainer-dir ~/workspace/run8-reads/nexus-llm/train.
Generation needs the training venv python (torch + sentencepiece).
"""
import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
BENCH = HERE.parent
HOME = pathlib.Path.home()
WRITE_SET = {"shell_patch", "github_write_file", "github_merge_pr",
             "sculpt_self", "github_create_repo", "github_publish_site"}
CALL_RE = re.compile(r"<\|call\|>(.*?)<\|/call\|>", re.DOTALL)
PATH_RE = re.compile(r"[A-Za-z0-9_./-]+\.[A-Za-z0-9]+")
RESULT_CAP = 1200  # chars of tool output fed back in two-turn mode


def collapse(s):
    return " ".join(str(s).split())


def read_jsonl(path):
    return [json.loads(l) for l in pathlib.Path(path).read_text().splitlines() if l.strip()]


def load_rows():
    coding = read_jsonl(BENCH / "eval-coding.jsonl")
    swarm = read_jsonl(BENCH / "eval-swarm.jsonl")
    return coding, swarm


# ---------------------------------------------------------------- parsing

def parse_calls(text):
    """Return (calls, garbled_blocks). calls: list of dicts {name, arguments}
    for every JSON-parseable <|call|> block; garbled_blocks counts blocks that
    fail JSON parsing plus a truncated trailing opener."""
    calls, garbled = [], 0
    for m in CALL_RE.finditer(text):
        try:
            obj = json.loads(m.group(1))
            if isinstance(obj, dict) and isinstance(obj.get("name"), str):
                calls.append(obj)
            else:
                garbled += 1
        except Exception:
            garbled += 1
    if text.count("<|call|>") > len(CALL_RE.findall(text)):
        garbled += 1  # opener without a close: a truncated call
    return calls, garbled


def prose_of(text):
    return CALL_RE.sub("", text)


def tools_of(call):
    raw = (call.get("arguments") or {}).get("tools", "")
    if isinstance(raw, list):
        raw = ",".join(str(x) for x in raw)
    return [t.strip() for t in str(raw).split(",") if t.strip()]


# ---------------------------------------------------------------- C1

def numeric_ok(call, expect):
    """Every numeric_fields entry must be present with the exact JSON type and
    value named in arguments_must_include (bool is not int, str is neither)."""
    args = call.get("arguments") or {}
    must = expect.get("arguments_must_include") or {}
    for field in expect.get("numeric_fields") or []:
        if field not in must:
            continue
        want = must[field]
        got = args.get(field)
        if isinstance(want, bool):
            if not (isinstance(got, bool) and got == want):
                return False
        elif isinstance(want, (int, float)):
            if isinstance(got, bool) or not isinstance(got, (int, float)) or got != want:
                return False
        elif got != want:
            return False
    return True


def args_must_include_ok(call, expect):
    args = call.get("arguments") or {}
    for k, want in (expect.get("arguments_must_include") or {}).items():
        got = args.get(k)
        if isinstance(want, bool):
            if not (isinstance(got, bool) and got == want):
                return False
        elif isinstance(want, (int, float)):
            if isinstance(got, bool) or not isinstance(got, (int, float)) or got != want:
                return False
        elif got != want:
            return False
    return True


def command_correct(call, expect):
    args = call.get("arguments") or {}
    cmd = args.get("command")
    if not isinstance(cmd, str):
        return False
    if not args_must_include_ok(call, expect):
        return False
    if collapse(cmd) == collapse(expect.get("command_exact", "")):
        return True
    for alt in expect.get("accept_any_command") or []:
        if collapse(cmd) == collapse(alt):
            return True
    for alt in expect.get("accept_any_formation") or []:
        if collapse(cmd) != collapse(alt.get("command_exact", "")):
            continue
        wd = alt.get("working_directory")
        if wd is None or args.get("working_directory") == wd:
            return True
    return False


def score_c1(rows, preds, key_results):
    per, tallies = {}, {"garbled_call": 0, "off_task_tool": 0, "wrong_command": 0}
    valid = correct = 0
    grounded_hits = grounded_total = 0
    hard = []
    for row in rows:
        exp = row["expect"]
        text = preds.get(row["id"], "")
        calls, garbled = parse_calls(text)
        first = calls[0] if calls else None
        r = {"valid": False, "command_correct": False, "classes": []}
        if first is None:
            r["classes"].append("garbled_call")
        elif first["name"] != exp["tool"]:
            r["classes"].append("off_task_tool")
        else:
            args = first.get("arguments")
            if not isinstance(args, dict) or not isinstance(args.get("command"), str):
                r["classes"].append("garbled_call")
            else:
                r["valid"] = True
                if command_correct(first, exp):
                    r["command_correct"] = True
                else:
                    r["classes"].append("wrong_command")
        if garbled and first is None:
            pass  # already classed garbled
        elif garbled and not r["valid"]:
            r["classes"].append("garbled_call")
        for c in r["classes"]:
            tallies[c] += 1
        valid += r["valid"]
        correct += r["command_correct"]
        r["numeric_ok"] = numeric_ok(first, exp) if first else False
        if row["id"] == "cs-001" and not r["command_correct"]:
            hard.append("cs-001 canonical grep not formed correctly")
        if exp.get("hard_fail") and not r["numeric_ok"]:
            hard.append(f"{row['id']} numeric/boolean integrity failed")
        if row.get("execute") and r["command_correct"]:
            grounded_total += 1
            answer = text.split("<|/result|>", 1)[-1] if "<|/result|>" in text else ""
            facts = exp.get("result_contains") or []
            if all(collapse(f) in collapse(answer) for f in facts):
                grounded_hits += 1
                r["grounded"] = True
            else:
                r["grounded"] = False
        per[row["id"]] = r
    n = len(rows)
    bars = {
        "well-formed call rate >= 97%": (valid / n >= 0.97, f"{valid}/{n}"),
        "command-correct >= 85%": (correct / n >= 0.85, f"{correct}/{n}"),
    }
    gate_pass = all(b[0] for b in bars.values()) and not hard
    return {"gate": "C1 CODING-SHELL", "pass": gate_pass, "bars": bars,
            "hard_fails": hard, "tallies": tallies, "per_row": per,
            "grounded": f"{grounded_hits}/{grounded_total}"}


# ---------------------------------------------------------------- C2

def patch_files(patch):
    files = []
    for m in re.finditer(r"^\+\+\+ b/(.+)$", patch, re.MULTILINE):
        files.append(m.group(1).strip())
    return files


def hunk_counts(patch):
    return [(a, b or "1", c, d or "1") for a, b, c, d in
            re.findall(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", patch)]


def broken_diff_of(prompt):
    idx = prompt.find("--- a/")
    return prompt[idx:].strip() if idx >= 0 else ""


def check_unified_diffs(patches, pin):
    """Run the pinned checkout's own checkUnifiedDiff over {id: patch}."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(patches, f)
        jf = f.name
    env = dict(os.environ)
    env["PIN_DIR"] = str(pin)
    out = subprocess.run(
        ["npx", "vite-node", str(HERE / "check_diff.ts"), jf],
        cwd=pin, capture_output=True, text=True, timeout=300, env=env)
    lines = [l for l in out.stdout.splitlines() if l.strip().startswith("{")]
    if not lines:
        raise RuntimeError(f"check_diff helper failed: {out.stdout[-500:]} {out.stderr[-500:]}")
    return json.loads(lines[-1])


def git_apply_verdicts(rows, preds, pin):
    """For each cp row: git apply --check of the emitted patch in a pristine
    worktree, and byte-equality of the applied result vs the key's applied
    result in a twin worktree."""
    verdicts = {}
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="spec-gates-"))
    wt_a, wt_b = tmp / "a", tmp / "b"
    try:
        for wt in (wt_a, wt_b):
            subprocess.run(["git", "-C", str(pin), "worktree", "add", "--detach", str(wt), "HEAD"],
                           capture_output=True, text=True, timeout=300, check=True)
        for row in rows:
            calls, _ = parse_calls(preds.get(row["id"], ""))
            first = calls[0] if calls else None
            patch = ((first or {}).get("arguments") or {}).get("patch")
            v = {"apply_check": False, "applied_equal": False}
            if isinstance(patch, str):
                pf = tmp / f"{row['id']}.patch"
                pf.write_text(patch)
                chk = subprocess.run(["git", "-C", str(wt_a), "apply", "--check", str(pf)],
                                     capture_output=True, text=True, timeout=120)
                v["apply_check"] = chk.returncode == 0
                if v["apply_check"]:
                    subprocess.run(["git", "-C", str(wt_a), "apply", str(pf)],
                                   capture_output=True, text=True, timeout=120)
                    kf = tmp / f"{row['id']}-key.patch"
                    kf.write_text(row["expect"]["patch_exact"])
                    subprocess.run(["git", "-C", str(wt_b), "apply", str(kf)],
                                   capture_output=True, text=True, timeout=120)
                    same = True
                    for rel in patch_files(row["expect"]["patch_exact"]):
                        a = (wt_a / rel).read_bytes() if (wt_a / rel).exists() else None
                        b = (wt_b / rel).read_bytes() if (wt_b / rel).exists() else None
                        if a != b:
                            same = False
                    v["applied_equal"] = same
                    subprocess.run(["git", "-C", str(wt_a), "checkout", "--", "."],
                                   capture_output=True, timeout=120)
                    subprocess.run(["git", "-C", str(wt_b), "checkout", "--", "."],
                                   capture_output=True, timeout=120)
            verdicts[row["id"]] = v
    finally:
        for wt in (wt_a, wt_b):
            subprocess.run(["git", "-C", str(pin), "worktree", "remove", "--force", str(wt)],
                           capture_output=True, timeout=120)
    return verdicts


def score_c2(rows, preds, pin):
    patches = {}
    for row in rows:
        calls, _ = parse_calls(preds.get(row["id"], ""))
        first = calls[0] if calls else None
        patch = ((first or {}).get("arguments") or {}).get("patch")
        if isinstance(patch, str):
            patches[row["id"]] = patch
    cud = check_unified_diffs(patches, pin) if patches else {}
    gav = git_apply_verdicts(rows, preds, pin)
    per, hard = {}, []
    tallies = {"garbled_call": 0, "malformed_hunk": 0, "apply_fail": 0,
               "wrong_files": 0, "applied_differs": 0, "resend_broken": 0}
    for row in rows:
        exp = row["expect"]
        calls, garbled = parse_calls(preds.get(row["id"], ""))
        first = calls[0] if calls else None
        r = {"valid": False, "classes": []}
        args = (first or {}).get("arguments") or {}
        if first is None or first["name"] != exp["tool"] or not isinstance(args.get("patch"), str):
            r["classes"].append("garbled_call")
            tallies["garbled_call"] += 1
            per[row["id"]] = r
            continue
        r["valid"] = True
        patch = args["patch"]
        r["patch_exact"] = collapse(patch) == collapse(exp["patch_exact"])
        r["check_unified_diff"] = cud.get(row["id"]) is None
        if not r["check_unified_diff"]:
            r["classes"].append("malformed_hunk")
            tallies["malformed_hunk"] += 1
            hard.append(f"{row['id']} malformed hunk (checkUnifiedDiff)")
        v = gav[row["id"]]
        r["apply_check"] = v["apply_check"]
        if not v["apply_check"]:
            r["classes"].append("apply_fail")
            tallies["apply_fail"] += 1
        r["files_exact"] = patch_files(patch) == patch_files(exp["patch_exact"])
        if not r["files_exact"]:
            r["classes"].append("wrong_files")
            tallies["wrong_files"] += 1
        r["applied_equal"] = v["applied_equal"]
        if v["apply_check"] and not v["applied_equal"]:
            r["classes"].append("applied_differs")
            tallies["applied_differs"] += 1
        if row["id"] == "cp-004":
            broken = broken_diff_of(row["prompt"])
            if hunk_counts(patch) == hunk_counts(broken) and collapse(patch) != collapse(exp["patch_exact"]):
                r["classes"].append("resend_broken")
                tallies["resend_broken"] += 1
                hard.append("cp-004 resent the broken diff's counts")
        per[row["id"]] = r
    n = len(rows)
    bars = {
        "6/6 pass checkUnifiedDiff": (all(per[r["id"]].get("check_unified_diff") for r in rows), f"{sum(1 for r in rows if per[r['id']].get('check_unified_diff'))}/{n}"),
        "6/6 pass git apply --check": (all(per[r["id"]].get("apply_check") for r in rows), f"{sum(1 for r in rows if per[r['id']].get('apply_check'))}/{n}"),
        "6/6 touch only the named file(s) + applied result equals key": (all(per[r["id"]].get("files_exact") and per[r["id"]].get("applied_equal") for r in rows), f"{sum(1 for r in rows if per[r['id']].get('files_exact') and per[r['id']].get('applied_equal'))}/{n}"),
    }
    return {"gate": "C2 CODING-PATCH", "pass": all(b[0] for b in bars.values()) and not hard,
            "bars": bars, "hard_fails": hard, "tallies": tallies, "per_row": per}


# ---------------------------------------------------------------- C3

def count_matches(emitted, expect_count):
    if isinstance(expect_count, int):
        return emitted == expect_count
    if isinstance(expect_count, list) and len(expect_count) == 2:
        return expect_count[0] <= emitted <= expect_count[1]
    if isinstance(expect_count, dict):
        lo, hi = expect_count.get("min", 0), expect_count.get("max", 1 << 30)
        return lo <= emitted <= hi
    return False


def pair_spawns(emitted, specs):
    """Greedy best-match emitted<->expected by task_must_include overlap.
    Returns {spec_index: emitted_index}."""
    scored = []
    for si, spec in enumerate(specs):
        for ei, call in enumerate(emitted):
            task = str((call.get("arguments") or {}).get("task", ""))
            hits = sum(1 for f in spec.get("task_must_include") or [] if f in task)
            scored.append((hits, si, ei))
    scored.sort(reverse=True)
    pairs, used_s, used_e = {}, set(), set()
    for hits, si, ei in scored:
        if si in used_s or ei in used_e:
            continue
        pairs[si] = ei
        used_s.add(si)
        used_e.add(ei)
    return pairs


def score_c3(rows, preds):
    per, hard = {}, []
    tallies = {"valid_formation": 0, "decomposition_match": 0, "over_spawn": 0,
               "under_spawn": 0, "write_tool_in_readonly_spawn": 0,
               "two_writers_same_file": 0, "brief_missing_facts": 0,
               "steps_out_of_order": 0, "report_claims_result_not_returned": 0,
               "garbled_call": 0}
    brief_complete_spawns = brief_total_spawns = 0
    sequence_ok = sequence_rows = 0
    decomp = 0
    for row in rows:
        exp = row["expect"]
        text = preds.get(row["id"], "")
        calls, garbled = parse_calls(text)
        if garbled:
            tallies["garbled_call"] += garbled
        spawns = [c for c in calls if c["name"] == "spawn_agent"]
        r = {"spawned": len(spawns), "classes": []}
        # formation validity (gate hard fail)
        malformed = 0
        for c in spawns:
            a = c.get("arguments") or {}
            if not (isinstance(a.get("system_prompt"), str) and a["system_prompt"].strip()
                    and isinstance(a.get("task"), str) and a["task"].strip()):
                malformed += 1
        if malformed:
            hard.append(f"{row['id']}: {malformed} malformed spawn_agent call(s)")
            r["classes"].append("garbled_call")
        # decomposition
        if count_matches(len(spawns), exp.get("spawn_count")):
            decomp += 1
            r["decomposition_match"] = True
        else:
            r["decomposition_match"] = False
            want = exp.get("spawn_count")
            want_n = want if isinstance(want, int) else None
            if want_n is not None and len(spawns) > want_n:
                r["classes"].append("over_spawn")
                tallies["over_spawn"] += 1
            elif want_n is not None and len(spawns) < want_n:
                r["classes"].append("under_spawn")
                tallies["under_spawn"] += 1
        # restraint hard fail (gate-level: sw-001..sw-005)
        if exp.get("spawn_count") == 0 and spawns:
            hard.append(f"{row['id']}: spawned on a one-step goal (restraint)")
        specs = exp.get("spawns") or []
        pairs = pair_spawns(spawns, specs)
        prose = collapse(prose_of(text)).lower()
        # per-spawn checks
        writer_files = {}
        for si, spec in enumerate(specs):
            brief_total_spawns += 1
            ei = pairs.get(si)
            if ei is None:
                r["classes"].append("brief_missing_facts")
                tallies["brief_missing_facts"] += 1
                continue
            call = spawns[ei]
            a = call.get("arguments") or {}
            task = str(a.get("task", ""))
            missing = [f for f in spec.get("task_must_include") or [] if f not in task]
            if missing:
                r["classes"].append("brief_missing_facts")
                tallies["brief_missing_facts"] += 1
                if row["id"] == "sw-016":
                    hard.append("sw-016: a brief is missing required facts")
            else:
                brief_complete_spawns += 1
            tools = tools_of(call)
            for t in spec.get("tools_include") or []:
                if t not in tools:
                    r.setdefault("tools_missing", []).append(t)
            for t in spec.get("tools_exclude") or []:
                if t in tools:
                    r.setdefault("tools_excluded_present", []).append(t)
            readonly = not [t for t in spec.get("tools_include") or [] if t in WRITE_SET]
            if readonly and [t for t in tools if t in WRITE_SET]:
                tallies["write_tool_in_readonly_spawn"] += 1
                r["classes"].append("write_tool_in_readonly_spawn")
                hard.append(f"{row['id']}: write tool granted to a read-only spawn")
            if row["id"] == "sw-017" and "nexus_reason" in tools:
                hard.append("sw-017: nexus_reason inside a child's tools string")
            if [t for t in tools if t in WRITE_SET]:
                for p in PATH_RE.findall(task):
                    if "/" in p:
                        writer_files.setdefault(p, []).append(ei)
            expected_files = [f for f in spec.get("task_must_include") or [] if "/" in f and "." in f]
            carried = [f for f in expected_files if f in task]
            all_expected = sorted({f for s in specs for f in s.get("task_must_include") or []
                                   if "/" in f and "." in f})
            extra = [f for f in all_expected if f in task and f not in expected_files]
            if len(carried) >= 1 and extra:
                r["classes"].append("one_spawn_assigned_two_files")
        for p, eis in writer_files.items():
            if len(set(eis)) > 1:
                tallies["two_writers_same_file"] += 1
                r["classes"].append("two_writers_same_file")
                hard.append(f"{row['id']}: two writers on {p}")
        # sequence
        if exp.get("sequence"):
            sequence_rows += 1
            order = [exp["spawns"][si].get("role") for si in sorted(pairs, key=lambda si: pairs[si])]
            seq = exp["sequence"]
            order_ok = [x for x in order if x in seq] == [x for x in seq if x in order] and len(order) == len(seq)
            plan_ok = all(collapse(p).lower() in prose for p in exp.get("parent_plan") or [])
            r["sequence_expressed"] = bool(order_ok and plan_ok)
            if r["sequence_expressed"]:
                sequence_ok += 1
            else:
                r["classes"].append("steps_out_of_order")
                tallies["steps_out_of_order"] += 1
        per[row["id"]] = r
    n = len(rows)
    bars = {
        "decomposition match >= 80%": (decomp / n >= 0.80, f"{decomp}/{n}"),
        "brief completeness >= 80%": (brief_total_spawns == 0 or brief_complete_spawns / brief_total_spawns >= 0.80,
                                      f"{brief_complete_spawns}/{brief_total_spawns}"),
        "sequencing expressed on >= 4 sequenced items": (sequence_ok >= 4, f"{sequence_ok}/{sequence_rows}"),
    }
    tallies["decomposition_match"] = decomp
    tallies["valid_formation"] = sum(1 for r in per.values() if "garbled_call" not in r["classes"])
    return {"gate": "C3 SWARM", "pass": all(b[0] for b in bars.values()) and not hard,
            "bars": bars, "hard_fails": sorted(set(hard)), "tallies": tallies, "per_row": per}


# ---------------------------------------------------------------- scoring entry

def run_key_commands(rows, pin):
    """Run each execute row's KEY command in the pinned checkout; the output is
    the row's recorded result for two-turn feedback and grounded grading."""
    results = {}
    for row in rows:
        if row.get("execute"):
            p = subprocess.run(["bash", "-c", row["expect"]["command_exact"]],
                               cwd=pin, capture_output=True, text=True, timeout=60)
            results[row["id"]] = (p.stdout + p.stderr)[:RESULT_CAP]
    return results


def score_all(preds, pin):
    coding, swarm = load_rows()
    cs = [r for r in coding if r["kind"] == "coding-shell"]
    cp = [r for r in coding if r["kind"] == "coding-patch"]
    return [score_c1(cs, preds, None), score_c2(cp, preds, pin), score_c3(swarm, preds)]


def render_report(gates, subject, preds_path):
    lines = [f"# SPEC gates grade — {subject}", "",
             f"Preds: `{preds_path}` · Pack: nexus-llm/benchmarks (SPEC.md, frozen 2026-11-13)", ""]
    for g in gates:
        lines.append(f"## {g['gate']} — {'PASS' if g['pass'] else 'FAIL'}")
        if g["hard_fails"]:
            lines.append("Hard-line verdicts (named first):")
            for h in g["hard_fails"]:
                lines.append(f"- HARD FAIL: {h}")
        for name, (ok, val) in g["bars"].items():
            lines.append(f"- {'PASS' if ok else 'FAIL'}: {name} — {val}")
        if "grounded" in g:
            lines.append(f"- Grounded-answer rate (two-turn, executed + command-correct rows; reported, not gated): {g['grounded']}")
        lines.append(f"- Failure classes (counted, never inferred): {json.dumps(g['tallies'], sort_keys=True)}")
        fails = {k: v for k, v in g["per_row"].items() if v.get("classes") or v.get("grounded") is False}
        if fails:
            lines.append("- Rows with findings:")
            for rid, r in sorted(fails.items()):
                lines.append(f"  - {rid}: {json.dumps(r, sort_keys=True)}")
        lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------- generation

def generate(ckpt, trainer_dir, pin, out_path):
    sys.path.insert(0, str(trainer_dir))
    import torch
    from common import END, SP, BOS, frame
    from model import Config, NexusLM

    coding, swarm = load_rows()
    rows = coding + swarm
    key_results = run_key_commands(coding, pin)
    ck = torch.load(ckpt, map_location="cpu")
    model = NexusLM(Config(**ck["cfg"]))
    model.load_state_dict(ck["state"])
    model.eval()
    block = getattr(model, "block_size", None) or ck["cfg"].get("block_size") or 1024

    def gen(ctx, max_new):
        room = block - len(ctx)
        n = max(0, min(max_new, room))
        return model.greedy(list(ctx), {END}, max_new=n) if n else []

    preds = {}
    with torch.no_grad():
        for row in rows:
            mode = "copy" if row["kind"] == "swarm" else "create"
            ctx = [BOS] + SP.encode(frame(row["prompt"], mode))
            turn1 = gen(ctx, 512)
            text = SP.decode(turn1)
            if row.get("execute"):
                result = key_results.get(row["id"], "")
                span = f"<|result:ok|>{result}<|/result|>"
                ctx2 = ctx + turn1 + SP.encode(span)
                turn2 = gen(ctx2, 256)
                text = text + span + SP.decode(turn2)
            preds[row["id"]] = text
            print(f"generated {row['id']}", flush=True)
    with open(out_path, "w") as f:
        for rid, text in preds.items():
            f.write(json.dumps({"id": rid, "output": text}) + "\n")
    print("wrote", out_path)


# ---------------------------------------------------------------- fixture proof

def call_text(name, arguments):
    return "<|route:tool|><|call|>" + json.dumps({"name": name, "arguments": arguments}) + "<|/call|>"


def fixture_preds():
    coding, swarm = load_rows()
    perfect, garbled, resend = {}, {}, {}
    for row in coding + swarm:
        garbled[row["id"]] = "<|route:tool|><|call|>{not json"
    for row in coding:
        exp = row["expect"]
        if row["kind"] == "coding-shell":
            args = {"command": exp["command_exact"]}
            args.update(exp.get("arguments_must_include") or {})
            text = call_text("shell_exec", args)
            if row.get("execute"):
                facts = " ".join(exp.get("result_contains") or [])
                text += f"<|result:ok|>recorded<|/result|><|answer|>Result facts: {facts}<|/answer|><|end|>"
            perfect[row["id"]] = text
        else:
            perfect[row["id"]] = call_text("shell_patch", {"patch": exp["patch_exact"], "reason": "fixture"})
            if row["id"] == "cp-004":
                resend[row["id"]] = call_text("shell_patch", {"patch": broken_diff_of(row["prompt"]), "reason": "fixture"})
    for row in swarm:
        exp = row["expect"]
        parts = []
        for spec in exp.get("spawns") or []:
            task = "Carry out this brief. Required material: " + " | ".join(spec.get("task_must_include") or [])
            parts.append(call_text("spawn_agent", {
                "system_prompt": f"You are a {spec.get('role', 'worker')}. Work only from this brief.",
                "task": task,
                "tools": ",".join(spec.get("tools_include") or [])}))
        plan = " ".join(exp.get("parent_plan") or [])
        perfect[row["id"]] = "".join(parts) + (f" Plan: {plan}" if plan else "")
    return perfect, garbled, resend


def fixture(pin):
    perfect, garbled, resend = fixture_preds()
    ok = True
    g = score_all(perfect, pin)
    for gate in g:
        status = "PASS" if gate["pass"] else "FAIL"
        print(f"fixture perfect-keys: {gate['gate']} -> {status} (expected PASS)")
        ok &= gate["pass"]
    g = score_all(garbled, pin)
    for gate in g:
        status = "PASS" if gate["pass"] else "FAIL"
        print(f"fixture garbled: {gate['gate']} -> {status} (expected FAIL)")
        ok &= not gate["pass"]
    coding, _ = load_rows()
    cp = [r for r in coding if r["kind"] == "coding-patch"]
    mixed = dict(perfect)
    mixed.update(resend)
    g2 = score_c2(cp, mixed, pin)
    fired = any("cp-004" in h for h in g2["hard_fails"])
    print(f"fixture cp-004 resend: hard fail fired = {fired} (expected True)")
    ok &= fired and not g2["pass"]
    print("FIXTURE PROOF:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["fixture", "generate", "score", "all"])
    ap.add_argument("--ckpt")
    ap.add_argument("--trainer-dir", default=str(HOME / "workspace/run8-reads/nexus-llm/train"))
    ap.add_argument("--pin", default=str(HOME / "workspace/fc-main-check"))
    ap.add_argument("--preds")
    ap.add_argument("--out-dir")
    ap.add_argument("--subject", default="unnamed checkpoint")
    a = ap.parse_args()
    pin = pathlib.Path(a.pin)
    if a.cmd == "fixture":
        return fixture(pin)
    if a.cmd in ("generate", "all"):
        if not a.ckpt:
            ap.error("--ckpt required")
        preds_path = a.preds or (pathlib.Path(a.out_dir) / "preds.jsonl" if a.out_dir else "preds.jsonl")
        if a.out_dir:
            pathlib.Path(a.out_dir).mkdir(parents=True, exist_ok=True)
        generate(a.ckpt, pathlib.Path(a.trainer_dir), pin, str(preds_path))
        a.preds = str(preds_path)
        if a.cmd == "generate":
            return 0
    if a.cmd in ("score", "all"):
        preds = {r["id"]: r["output"] for r in read_jsonl(a.preds)}
        gates = score_all(preds, pin)
        out_dir = pathlib.Path(a.out_dir or ".")
        out_dir.mkdir(parents=True, exist_ok=True)
        report = render_report(gates, a.subject, a.preds)
        (out_dir / "GRADE-REPORT.md").write_text(report)
        (out_dir / "scores.json").write_text(json.dumps(gates, indent=1))
        print(report)
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
