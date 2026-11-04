#!/usr/bin/env python3
"""Swarm batch tools (read-only: they never dispatch anything and write only to --out). Two subcommands, run from a clone that has fetched
origin/muse/swarm-fire-queue and origin/deepseek-results:

  verify  MANIFEST [--out payloads.json]
      Checks a batch manifest against the queue files BEFORE anything is fired. For every cell: the queue file at the stated commit exists,
      its invocation_id equals the manifest's, inputs.task and inputs.context match the manifest's lengths and SHA-256, the fixed inputs are
      the standard ones (profile chat, nexus_learning false, mirror true, the standard exam_forbidden), the id is not already on the mirror,
      and no id repeats in the manifest. Prints a table; writes the dispatch payloads of the cells that PASS. Exit 0 only if every cell passes.
  check   MANIFEST WORKFLOW_COMMIT
      For every manifest cell already on the mirror, runs swarm_dispatch_clean.py (byte-exact task and context, segment anchors, workflow_commit)
      and prints a table with elapsed, tokens and budget-stopped. Judges transport only, never the model's output.

MANIFEST = {"expected_main": "<sha>", "cells": [{"invocation_id", "queue_file", "queue_commit", "task_sha256", "context_sha256", "task_chars", "context_chars"}]}
Cells may be listed by Muse's rule for refire ids; this tool only requires that an id is not already on the mirror."""
import argparse, hashlib, json, pathlib, subprocess, sys, tempfile
HERE = pathlib.Path(__file__).resolve().parent
STANDARD = {'profile': 'chat', 'nexus_learning': 'false', 'mirror': 'true',
            'exam_forbidden': 'WyJORVhVUyBHVUlEQU5DRSAoIiwgIltFTkQgTkVYVVMgR1VJREFOQ0VdIl0='}
sha = lambda s: hashlib.sha256(s.encode('utf-8')).hexdigest()

def git(*args):
    return subprocess.run(['git', *args], capture_output=True, text=True)

# New artifacts are written by qwen3-8b.yml to the qwen-results branch; artifacts banked before the rename (workflow deepseek-16b.yml, removed
# 2026-11-04) are history on deepseek-results. An id counts as "on the mirror" if it is on either.
MIRRORS = (('origin/qwen-results', 'qwen-results'), ('origin/deepseek-results', 'deepseek-results'))

def mirror_ids():
    ids = set()
    for ref, _dir in MIRRORS:
        out = git('ls-tree', '-r', '--name-only', ref)
        if out.returncode == 0: ids |= {pathlib.PurePosixPath(f).name.split('.')[0] for f in out.stdout.split()}
    return ids

def mirror_show(inv, ext):
    for ref, d in MIRRORS:
        r = git('show', f'{ref}:{d}/{inv}.{ext}')
        if r.returncode == 0: return r.stdout
    return ''

def verify(manifest, out):
    if not manifest.get('cells'):
        print('manifest has no cells: nothing to verify, nothing to fire'); return 1
    seen, onmirror, rows, payloads = set(), mirror_ids(), [], []
    for c in manifest['cells']:
        why = []
        inv = c['invocation_id']
        if inv in seen: why.append('id repeated in the manifest')
        seen.add(inv)
        if inv in onmirror: why.append('id already on the mirror')
        r = git('show', f"{c['queue_commit']}:{c['queue_file']}")
        q = None
        if r.returncode != 0: why.append('queue file not readable at that commit')
        else:
            try: q = json.loads(r.stdout)
            except Exception as e: why.append(f'queue file is not JSON: {e}')
        if q is not None:
            i = q.get('inputs', {})
            if q.get('invocation_id') != inv: why.append(f"queue invocation_id={q.get('invocation_id')}")
            if i.get('invocation_id', inv) != inv: why.append('inputs.invocation_id differs')
            task, context = i.get('task', ''), i.get('context', '')
            if len(task) != c['task_chars'] or sha(task) != c['task_sha256']: why.append(f"task mismatch (have {len(task)} chars, {sha(task)[:12]})")
            if len(context) != c['context_chars'] or sha(context) != c['context_sha256']: why.append(f"context mismatch (have {len(context)} chars, {sha(context)[:12]})")
            for k, want in STANDARD.items():
                if str(i.get(k)) != want: why.append(f'{k}={i.get(k)!r}')
            if not why:
                payloads.append({'workflow_id': 'qwen3-8b.yml', 'ref': 'main', 'inputs': {**{k: i[k] for k in ('task', 'context')}, 'invocation_id': inv, **STANDARD}})
        rows.append((inv, 'PASS' if not why else 'FAIL', '; '.join(why)))
    w = max(len(r[0]) for r in rows)
    for inv, st, why in rows: print(f'{inv:<{w}}  {st}  {why}')
    bad = [r for r in rows if r[1] != 'PASS']
    print(f'\n{len(rows) - len(bad)} of {len(rows)} cells pass; expected main {manifest.get("expected_main")}')
    if out: pathlib.Path(out).write_text(json.dumps(payloads, indent=1))
    return 0 if not bad else 1

def check(manifest, pin):
    if not manifest.get('cells'):
        print('manifest has no cells'); return 1
    rows, on = [], mirror_ids()
    for c in manifest['cells']:
        inv = c['invocation_id']
        if inv not in on: rows.append((inv, 'not on the mirror yet', '', '', '')); continue
        tmp = pathlib.Path(tempfile.mkdtemp(prefix='swarm-check-'))
        q = git('show', f"{c['queue_commit']}:{c['queue_file']}").stdout
        (tmp / 'q.json').write_text(q)
        for ext in ('prompt.txt', 'meta.txt'):
            (tmp / f'{inv}.{ext}').write_text(mirror_show(inv, ext))
        p = subprocess.run([sys.executable, str(HERE / 'swarm_dispatch_clean.py'), str(tmp / 'q.json'), str(tmp), pin], capture_output=True, text=True)
        try: rec = json.loads(p.stdout)
        except Exception: rec = {'clean': False, 'why': [p.stdout[:80] or p.stderr[:80]]}
        meta = dict(l.split('=', 1) for l in (tmp / f'{inv}.meta.txt').read_text().splitlines() if '=' in l)
        rows.append((inv, 'CLEAN' if rec.get('clean') else 'NOT CLEAN: ' + '; '.join(rec.get('why', [])),
                     meta.get('elapsed_seconds', ''), meta.get('generated_tokens', ''), meta.get('stopped_by_time_budget', '')))
    w = max(len(r[0]) for r in rows)
    print(f'{"cell":<{w}}  transport  elapsed_s  tokens  budget_stopped')
    for r in rows: print(f'{r[0]:<{w}}  {r[1]}  {r[2]}  {r[3]}  {r[4]}')
    return 0 if all(r[1] == 'CLEAN' for r in rows) else 1

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest='cmd', required=True)
    a = sub.add_parser('verify'); a.add_argument('manifest'); a.add_argument('--out')
    b = sub.add_parser('check'); b.add_argument('manifest'); b.add_argument('workflow_commit')
    args = ap.parse_args(); m = json.load(open(args.manifest))
    sys.exit(verify(m, args.out) if args.cmd == 'verify' else check(m, args.workflow_commit))
