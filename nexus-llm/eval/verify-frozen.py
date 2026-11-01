#!/usr/bin/env python3
"""Verify that frozen exam files are unchanged. Stdlib only. Exit 0 = intact, 1 = violation, 2 = usage.

A freeze lives in nexus-llm/eval/FROZEN.json:
  {"exams": [{"name": "...", "dir": "nexus-llm/eval/x/", "frozen_at": "<full 40-char commit SHA>",
              "files": {"<repo path>": "<sha256>"}, "allow_new": ["AMENDMENTS-*.md"]}]}

Two modes, two jobs:
  CI (continuous tripwire):  verify-frozen.py --manifest-sha256 <pin>
      The pin is a literal in a protected workflow, so changing a frozen file means changing FROZEN.json,
      which changes its hash, which means a visible edit to the protected workflow. Needs no git history,
      so it survives squash merges.
  Grader (the teeth):  verify-frozen.py --origin
      Also reads every file AT the frozen_at commit and requires the same hash. An unobtainable commit
      is a FAILURE, never a skip: a grader that cannot see the object must not grade.
"""
import argparse
import fnmatch
import hashlib
import json
import os
import subprocess
import sys


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def run_git(root, *args):
    return subprocess.run(["git", "-C", root, *args], capture_output=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--manifest", default="nexus-llm/eval/FROZEN.json")
    ap.add_argument("--manifest-sha256", help="pinned SHA-256 of the manifest file (CI mode)")
    ap.add_argument("--origin", action="store_true", help="also verify each file at its frozen_at commit (grader mode)")
    a = ap.parse_args()
    if not a.manifest_sha256 and not a.origin:
        print("usage: need --manifest-sha256 (CI) and/or --origin (grader)", file=sys.stderr)
        return 2

    problems = []
    mpath = os.path.join(a.root, a.manifest)
    try:
        raw = open(mpath, "rb").read()
    except OSError as e:
        print(f"FAIL manifest unreadable: {e}")
        return 1
    if a.manifest_sha256 and sha256_bytes(raw) != a.manifest_sha256.lower():
        problems.append(f"manifest {a.manifest} hash {sha256_bytes(raw)} != pinned {a.manifest_sha256}")
    try:
        manifest = json.loads(raw)
        exams = manifest["exams"]
    except (ValueError, KeyError) as e:
        print(f"FAIL manifest malformed: {e}")
        return 1

    for ex in exams:
        name, d, files = ex["name"], ex["dir"], ex["files"]
        allow_new = ex.get("allow_new", [])
        for path, want in files.items():
            try:
                got = sha256_bytes(open(os.path.join(a.root, path), "rb").read())
            except OSError:
                problems.append(f"[{name}] missing or unreadable frozen file: {path}")
                continue
            if got != want:
                problems.append(f"[{name}] {path} is {got}, frozen as {want}")
        base = os.path.join(a.root, d)
        for dirpath, _, names in os.walk(base):
            for fn in names:
                rel = os.path.relpath(os.path.join(dirpath, fn), a.root).replace(os.sep, "/")
                if rel in files:
                    continue
                if any(fnmatch.fnmatch(os.path.basename(rel), pat) for pat in allow_new) and os.path.dirname(rel) == d.rstrip("/"):
                    continue
                problems.append(f"[{name}] unlisted file in a frozen directory: {rel}")
        if a.origin:
            sha = ex.get("frozen_at", "")
            if len(sha) != 40 or any(c not in "0123456789abcdef" for c in sha):
                problems.append(f"[{name}] frozen_at is not a full 40-char commit SHA: {sha!r}")
                continue
            if run_git(a.root, "cat-file", "-e", f"{sha}^{{commit}}").returncode != 0:
                run_git(a.root, "fetch", "--depth=1", "origin", sha)
            if run_git(a.root, "cat-file", "-e", f"{sha}^{{commit}}").returncode != 0:
                problems.append(f"[{name}] frozen_at commit {sha} is not obtainable; refusing to grade")
                continue
            for path, want in files.items():
                r = run_git(a.root, "show", f"{sha}:{path}")
                if r.returncode != 0:
                    problems.append(f"[{name}] {path} does not exist at frozen_at {sha}")
                elif sha256_bytes(r.stdout) != want:
                    problems.append(f"[{name}] {path} at frozen_at {sha} is {sha256_bytes(r.stdout)}, manifest says {want}")

    if problems:
        print("FROZEN-EXAM VIOLATION")
        for p in problems:
            print("  " + p)
        return 1
    print(f"frozen exams intact: {', '.join(e['name'] for e in exams)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
