#!/usr/bin/env python3
"""PreToolUse guard for Edit/Write/MultiEdit in this repo.

Policy source of truth: .github/protected-paths.txt (the same list the autonomous workflows use,
matched by the same is_protected() in .github/scripts/check-protected.py). This file keeps no list of its own.

Decisions (printed as hook JSON on stdout, exit 0):
  deny  - writing a .env* file, or content that looks like a credential
  ask   - the path is protected (operator must confirm; Tier 2 paths still need a NAMED authorization)
  (none) - allow
Fails closed: if the policy list or the matcher cannot be loaded, it asks rather than allows.
Every decision is appended to .claude/guard-audit.log (git-ignored). Shell commands are NOT inspected.
"""
import importlib.util
import json
import os
import posixpath
import re
import sys
import time

ROOT = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()

# Credential shapes. Built from fragments so this file does not itself contain a literal token prefix.
SECRET_PATTERNS = [
    re.compile(r"gh[pousr]_" + r"[A-Za-z0-9]{30,}"),
    re.compile(r"github_" + r"pat_[A-Za-z0-9_]{30,}"),
    re.compile(r"sk-" + r"ant-[A-Za-z0-9_-]{20,}"),
    re.compile(r"sk-" + r"or-[A-Za-z0-9_-]{20,}"),
    re.compile(r"AK" + r"IA[0-9A-Z]{16}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE" + r" KEY-----"),
]


def emit(decision, reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": decision,
        "permissionDecisionReason": reason,
    }}))


def audit(path, decision, reason):
    try:
        with open(os.path.join(ROOT, ".claude", "guard-audit.log"), "a", encoding="utf-8") as fh:
            fh.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')}\t{decision}\t{path}\t{reason}\n")
    except OSError:
        pass


def load_matcher():
    spec = importlib.util.spec_from_file_location("check_protected", os.path.join(ROOT, ".github", "scripts", "check-protected.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod, mod.load(os.path.join(ROOT, ".github", "protected-paths.txt"))


def written_text(tool_input):
    parts = [tool_input.get("content"), tool_input.get("new_string")]
    for edit in tool_input.get("edits") or []:
        parts.append(edit.get("new_string"))
    return "\n".join(p for p in parts if isinstance(p, str))


def main():
    try:
        event = json.load(sys.stdin)
    except ValueError:
        emit("ask", "protected-path-guard could not parse the hook input")
        return
    tool_input = event.get("tool_input") or {}
    raw = tool_input.get("file_path") or ""
    if not raw:
        return
    abs_path = os.path.normpath(raw if os.path.isabs(raw) else os.path.join(ROOT, raw))
    rel = posixpath.normpath(os.path.relpath(abs_path, ROOT).replace(os.sep, "/"))

    if re.search(r"(^|/)\.env($|\.)", rel):
        reason = f"{rel}: writing .env files is blocked"
        audit(rel, "deny", reason); emit("deny", reason); return
    text = written_text(tool_input)
    if any(p.search(text) for p in SECRET_PATTERNS):
        reason = f"{rel}: the content looks like a credential; secrets never go in source"
        audit(rel, "deny", reason); emit("deny", reason); return

    try:
        mod, entries = load_matcher()
        protected = mod.is_protected(rel, entries)
    except Exception as exc:  # fail closed
        reason = f"{rel}: could not load the protected-path policy ({type(exc).__name__}); confirm manually"
        audit(rel, "ask", reason); emit("ask", reason); return
    if protected:
        reason = (f"{rel} is in .github/protected-paths.txt. Confirm only if the operator authorized this item by name "
                  "(Tier 2 paths need a named authorization).")
        audit(rel, "ask", reason); emit("ask", reason); return
    audit(rel, "allow", "")


if __name__ == "__main__":
    main()
