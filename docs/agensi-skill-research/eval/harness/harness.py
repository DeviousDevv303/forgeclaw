#!/usr/bin/env python3
"""Shared mutation scorer for both lanes. Python 3 standard library only. No model is involved.

  harness.py freeze                      build frozen/ from tasks/ (reference, mutants, manifest, checksums)
  harness.py verify                      check frozen/ still matches its checksums
  harness.py suite  <task> <suite.py>    test lane: score a candidate test suite
  harness.py review <task> <target> <findings.json>
                                         review lane: target is a mutant id (m01...) or "reference"
  harness.py selftest                    prove the scorer separates a weak suite from a strong one

Frozen ground truth (fixed before any arm runs):
  reference.py  the task's correct implementation, normalised with ast.unparse
  mutants/      single-change variants made by the operators below, sampled with a fixed seed
  class         MUST = behaves differently from the reference on at least one frozen probe input
                MAY  = no probe tells it apart (possibly an equivalent mutant); reported separately

Test lane rules: a suite is a .py file of `test_*` functions (or unittest.TestCase classes) that
imports the code under test as `impl`. Tests that fail on the reference are false positives; they
are reported and then IGNORED when counting kills, so a broken test earns no credit. A mutant is
killed when any remaining test fails, errors, or times out.

Review lane rules: findings JSON is {"findings":[{"line":N,"severity":"critical|warning|suggestion"}]}
with 1-based lines in the file the reviewer was shown. On a mutant, a hit is any finding within
+-LINE_TOL of a changed line; critical/warning findings elsewhere are false alarms. On the reference,
every critical/warning finding is a false alarm.
"""
import ast, copy, difflib, hashlib, json, os, random, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TASKS, FROZEN = os.path.join(HERE, "tasks"), os.path.join(HERE, "frozen")
SEED, MAX_MUTANTS, TIMEOUT, LINE_TOL = 20261114, 20, 10, 1
ASSERTIVE = {"critical", "warning"}

CMP = {ast.Lt: ast.LtE, ast.LtE: ast.Lt, ast.Gt: ast.GtE, ast.GtE: ast.Gt, ast.Eq: ast.NotEq, ast.NotEq: ast.Eq}
ARITH = {ast.Add: ast.Sub, ast.Sub: ast.Add, ast.Mult: ast.FloorDiv, ast.FloorDiv: ast.Mult}
BOOL = {ast.And: ast.Or, ast.Or: ast.And}

DRIVER = r'''
import sys, json, copy, importlib.util
def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec); sys.modules[name] = mod; spec.loader.exec_module(mod); return mod
mode, impl_path, other = sys.argv[1], sys.argv[2], sys.argv[3]
out = {}
if mode == "probe":
    probes = load(other, "probes")
    try:
        fn = getattr(load(impl_path, "impl"), probes.FUNCTION)
    except BaseException as exc:
        fn = None; out = ["LOAD:" + type(exc).__name__] * len(probes.PROBES)
    if fn:
        out = []
        for args in probes.PROBES:
            a = copy.deepcopy(args)
            try:
                out.append("OK:" + repr(fn(*a)) + "|" + repr(a))
            except BaseException as exc:
                out.append("EXC:" + type(exc).__name__)
else:
    try:
        load(impl_path, "impl"); suite = load(other, "suite_under_test")
        import unittest
        for name in sorted(dir(suite)):
            obj = getattr(suite, name)
            if name.startswith("test") and callable(obj) and not isinstance(obj, type):
                try: obj(); out[name] = "pass"
                except BaseException: out[name] = "fail"
            elif isinstance(obj, type) and issubclass(obj, unittest.TestCase):
                for t in unittest.defaultTestLoader.loadTestsFromTestCase(obj):
                    res = unittest.TestResult(); t.run(res)
                    out[t.id().split(".", 1)[-1]] = "pass" if res.wasSuccessful() else "fail"
    except BaseException as exc:
        out = {"__load__": "error:" + type(exc).__name__}
print("\n@@RESULT@@" + json.dumps(out))
'''


def drive(mode, impl_path, other):
    try:
        p = subprocess.run([sys.executable, "-I", "-c", DRIVER, mode, impl_path, other],
                           capture_output=True, text=True, timeout=TIMEOUT)
        return json.loads(p.stdout.rsplit("@@RESULT@@", 1)[1])
    except subprocess.TimeoutExpired:
        return "TIMEOUT"
    except Exception:
        return "CRASH"


def mutation_sites(tree):
    """Yield (operator_name, function(tree_copy) -> None) for every single-change mutation."""
    nodes = list(ast.walk(tree))
    for i, n in enumerate(nodes):
        if isinstance(n, ast.Compare):
            for k, op in enumerate(n.ops):
                if type(op) in CMP:
                    yield "CMP", (lambda t, i=i, k=k: _set(_nth(t, i).ops, k, CMP[type(_nth(t, i).ops[k])]()))
        elif isinstance(n, ast.BinOp) and type(n.op) in ARITH:
            yield "ARITH", (lambda t, i=i: setattr(_nth(t, i), "op", ARITH[type(_nth(t, i).op)]()))
        elif isinstance(n, ast.BoolOp):
            yield "BOOL", (lambda t, i=i: setattr(_nth(t, i), "op", BOOL[type(_nth(t, i).op)]()))
        elif isinstance(n, ast.Constant) and type(n.value) is int:
            yield "CONST", (lambda t, i=i: setattr(_nth(t, i), "value", _nth(t, i).value + 1))
        elif isinstance(n, ast.UnaryOp) and isinstance(n.op, ast.Not):
            yield "NOT", (lambda t, i=i: _replace(t, _nth(t, i), _nth(t, i).operand))
        elif isinstance(n, ast.If) and not n.orelse and len(n.body) == 1 and isinstance(n.body[0], (ast.Raise, ast.Assign)):
            yield "DROP_IF", (lambda t, i=i: _replace(t, _nth(t, i), ast.Pass()))


def _nth(tree, i):
    return list(ast.walk(tree))[i]


def _set(lst, k, v):
    lst[k] = v


def _replace(tree, old, new):
    for parent in ast.walk(tree):
        for field, val in ast.iter_fields(parent):
            if val is old:
                setattr(parent, field, new); return
            if isinstance(val, list) and any(v is old for v in val):
                val[[v is old for v in val].index(True)] = new; return


def changed_lines(ref_src, mut_src):
    lines = set()
    for tag, _, _, j1, j2 in difflib.SequenceMatcher(None, ref_src.split("\n"), mut_src.split("\n")).get_opcodes():
        if tag in ("replace", "insert"):
            lines.update(range(j1 + 1, j2 + 1))
        elif tag == "delete":
            lines.add(j1 + 1)
    return sorted(lines)


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def frozen_files():
    out = []
    for root, _, files in os.walk(FROZEN):
        out += [os.path.join(root, f) for f in files if f != "CHECKSUMS.sha256"]
    return sorted(out)


def freeze():
    if os.path.exists(FROZEN):
        sys.exit("frozen/ already exists. Delete it deliberately to re-freeze; never re-freeze after an arm has run.")
    sums = []
    for task in sorted(os.listdir(TASKS)):
        tdir, fdir = os.path.join(TASKS, task), os.path.join(FROZEN, task)
        os.makedirs(os.path.join(fdir, "mutants"))
        tree = ast.parse(open(os.path.join(tdir, "reference.py")).read())
        ref_src = ast.unparse(tree) + "\n"
        ref_path = os.path.join(fdir, "reference.py")
        open(ref_path, "w").write(ref_src)
        probes = os.path.join(tdir, "probes.py")
        ref_sig = drive("probe", ref_path, probes)
        if not isinstance(ref_sig, list) or any(s.startswith("LOAD") for s in ref_sig):
            sys.exit(f"{task}: reference failed to run its probes")
        cands = {}
        for op, apply in mutation_sites(tree):
            t = copy.deepcopy(tree); apply(t)
            try:
                src = ast.unparse(ast.fix_missing_locations(t)) + "\n"; compile(src, "m", "exec")
            except Exception:
                continue
            if src != ref_src:
                cands.setdefault(src, op)
        items = sorted(cands.items())
        picked = sorted(random.Random(SEED).sample(items, min(MAX_MUTANTS, len(items))))
        manifest = []
        for n, (src, op) in enumerate(picked, 1):
            mid = f"m{n:02d}"; mpath = os.path.join(fdir, "mutants", mid + ".py")
            open(mpath, "w").write(src)
            cls = "MUST" if drive("probe", mpath, probes) != ref_sig else "MAY"
            manifest.append({"id": mid, "op": op, "lines": changed_lines(ref_src, src), "class": cls})
        json.dump({"task": task, "seed": SEED, "candidates": len(items), "mutants": manifest},
                  open(os.path.join(fdir, "manifest.json"), "w"), indent=1)
        must = sum(m["class"] == "MUST" for m in manifest)
        print(f"{task}: {len(items)} candidates, froze {len(manifest)} ({must} MUST, {len(manifest) - must} MAY)")
    for f in frozen_files():
        sums.append(f"{sha(f)}  {os.path.relpath(f, FROZEN)}")
    open(os.path.join(FROZEN, "CHECKSUMS.sha256"), "w").write("\n".join(sums) + "\n")


def verify():
    want = dict(reversed(l.split("  ", 1)) for l in open(os.path.join(FROZEN, "CHECKSUMS.sha256")).read().splitlines())
    have = {os.path.relpath(f, FROZEN): sha(f) for f in frozen_files()}
    if want != have:
        sys.exit("FROZEN SET CHANGED: results are not comparable")
    return True


def score_suite(task, suite_path):
    verify()
    fdir = os.path.join(FROZEN, task)
    manifest = json.load(open(os.path.join(fdir, "manifest.json")))["mutants"]
    ref = drive("suite", os.path.join(fdir, "reference.py"), suite_path)
    if not isinstance(ref, dict) or "__load__" in ref or not ref:
        return {"task": task, "valid": False, "reason": f"suite did not run on the reference: {ref}"}
    false_pos = sorted(t for t, r in ref.items() if r != "pass")
    good = [t for t in ref if t not in false_pos]
    kills, killers_used = {}, set()
    for m in manifest:
        res = drive("suite", os.path.join(fdir, "mutants", m["id"] + ".py"), suite_path)
        if isinstance(res, str) or "__load__" in res:
            kills[m["id"]] = [res if isinstance(res, str) else "LOAD_ERROR"] if good else []
        else:
            kills[m["id"]] = sorted(t for t in good if res.get(t) != "pass")
        killers_used.update(k for k in kills[m["id"]] if k in good)
    def rate(cls):
        ms = [m for m in manifest if m["class"] == cls]
        return {"total": len(ms), "killed": sum(bool(kills[m["id"]]) for m in ms),
                "rate": round(sum(bool(kills[m["id"]]) for m in ms) / len(ms), 3) if ms else None}
    return {"task": task, "valid": True, "tests": len(ref), "false_positive_tests": false_pos,
            "tests_that_never_kill": sorted(set(good) - killers_used), "MUST": rate("MUST"), "MAY": rate("MAY"),
            "survivors_MUST": [m["id"] for m in manifest if m["class"] == "MUST" and not kills[m["id"]]],
            "kill_map": kills}


def score_review(task, target, findings_path):
    verify()
    try:
        raw = json.load(open(findings_path))
        fs = [(int(f["line"]), str(f.get("severity", "")).lower()) for f in (raw["findings"] if isinstance(raw, dict) else raw)]
    except Exception as exc:
        return {"task": task, "target": target, "valid": False, "reason": type(exc).__name__}
    assertive = [l for l, s in fs if s in ASSERTIVE]
    if target == "reference":
        return {"task": task, "target": target, "valid": True, "findings": len(fs), "false_alarms": len(assertive)}
    m = next(x for x in json.load(open(os.path.join(FROZEN, task, "manifest.json")))["mutants"] if x["id"] == target)
    near = lambda l: any(abs(l - c) <= LINE_TOL for c in m["lines"])
    return {"task": task, "target": target, "class": m["class"], "op": m["op"], "valid": True, "findings": len(fs),
            "hit": any(near(l) for l, _ in fs), "hit_assertive": any(near(l) for l in assertive),
            "false_alarms": sum(not near(l) for l in assertive)}


def selftest():
    ex = os.path.join(HERE, "examples")
    weak, strong = score_suite("paginate", os.path.join(ex, "paginate_weak.py")), score_suite("paginate", os.path.join(ex, "paginate_strong.py"))
    bad = score_suite("paginate", os.path.join(ex, "paginate_wrong.py"))
    print(json.dumps({k: {x: v[x] for x in ("tests", "false_positive_tests", "MUST", "MAY", "survivors_MUST")}
                      for k, v in (("weak", weak), ("strong", strong), ("wrong", bad))}, indent=1))
    assert not weak["false_positive_tests"] and not strong["false_positive_tests"], "example suites must pass the reference"
    assert strong["MUST"]["rate"] == 1.0, "strong suite must kill every MUST mutant"
    assert weak["MUST"]["rate"] < strong["MUST"]["rate"], "scorer must separate weak from strong"
    assert bad["false_positive_tests"] and bad["MUST"]["killed"] == 0, "a wrong test must be flagged and earn no kills"
    print("SELFTEST PASS")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "freeze": freeze()
    elif cmd == "verify": verify() and print("frozen set intact")
    elif cmd == "suite": print(json.dumps(score_suite(sys.argv[2], os.path.abspath(sys.argv[3])), indent=1))
    elif cmd == "review": print(json.dumps(score_review(sys.argv[2], sys.argv[3], sys.argv[4]), indent=1))
    elif cmd == "selftest": selftest()
    else: sys.exit(__doc__)
