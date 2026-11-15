#!/usr/bin/env python3
"""Inventory of every 'deepseek' occurrence on a git ref, classified by what renaming it would touch (DRAFT; changes nothing).
    python3 docs/migrations/qwen_inventory.py [ref]      (default origin/main)
Prints a JSON summary; the classification rules are the CLASSES list below, first match wins."""
import collections
import json
import re
import subprocess
import sys

ref = sys.argv[1] if len(sys.argv) > 1 else "origin/main"
CLASSES = [  # (name, what a rename touches, regex on the matched LINE)
    ("workflow-file-and-dispatch", "the workflow file name, workflow_id, dispatch payloads, A6 pins, fire-queue files", r"deepseek-16b\.yml|deepseek_gguf|DEEPSEEK_[A-Z_]+|workflow_dispatch.*deepseek"),
    ("mirror-branch", "the deepseek-results branch (mirror, check_clean, every banked artifact path)", r"deepseek-results"),
    ("tool-names", "model-facing tool names deepseek_reason / ask_deepseek (tool schemas, prompts, tests)", r"deepseek_reason|ask_deepseek|deepseek_[a-z_]+\b"),
    ("provider-id-and-lineage", "provider/runtime id 'deepseek' (router, lineage rule hasQwenLineage, stored records)", r"['\"]deepseek['\"]|isDeepSeek|QWEN_RUNTIMES|deepseek:"),
    ("checkpoint-label", "the checkpoint/model label deepseek-16b (run meta, labels, tests)", r"deepseek-16b"),
    ("module-and-file-names", "TypeScript module names and identifiers (deepseekSculpt, deepseekContext, ...)", r"deepseek[A-Z]\w*|[A-Za-z]*DeepSeek\w*"),
    ("prose-docs-comments", "comments, docs, test descriptions", r".*"),
]
out = subprocess.run(["git", "grep", "-in", "deepseek", ref, "--", "."], capture_output=True, text=True).stdout.split("\n")
by_class = collections.Counter()
files_by_class = collections.defaultdict(set)
examples = {}
for line in out:
    if not line:
        continue
    m = re.match(r"^[^:]+:([^:]+):(\d+):(.*)$", line)
    if not m:
        continue
    path, _, text = m.group(1), m.group(2), m.group(3)
    for name, _, rx in CLASSES:
        if re.search(rx, text, re.I if name == "prose-docs-comments" else 0):
            by_class[name] += 1
            files_by_class[name].add(path)
            examples.setdefault(name, f"{path}: {text.strip()[:110]}")
            break
# filenames themselves
names = subprocess.run(["git", "ls-tree", "-r", "--name-only", ref], capture_output=True, text=True).stdout.split("\n")
named = [n for n in names if re.search("deepseek", n, re.I)]
print(json.dumps({"ref": ref, "lines": sum(by_class.values()),
                  "classes": {n: {"lines": by_class[n], "files": len(files_by_class[n]), "touches": t, "example": examples.get(n)} for n, t, _ in CLASSES},
                  "files_with_deepseek_in_their_name": named}, indent=1))
