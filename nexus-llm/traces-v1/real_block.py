#!/usr/bin/env python3
"""The real block of a training mix: every traces-v1 `*-v1.jsonl` file, not a hard-coded pair.

runs/run25/build_dataset.py names tool-use-v1.jsonl and context-v1.jsonl explicitly, so a new real file (for example
fix-verified-v1.jsonl from nexus-llm/intake/issue235_producer.py) never reaches a mix until its builder lists it. A builder
that calls load_real_block(dir) picks up every real file in the directory. This module reads and counts only: it never
writes a trace, never touches a frozen set, and refuses a synthetic row (the real block holds real rows only).

Dry-run report: python3 nexus-llm/traces-v1/real_block.py [--dir nexus-llm/traces-v1] [--frozen FILE ...]
"""
import argparse
import collections
import glob
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def real_block_files(directory=HERE):
    return sorted(glob.glob(os.path.join(directory, '*-v1.jsonl')))


def load_real_block(directory=HERE):
    """(rows, per_file_counts). A synthetic row, or a row without prompt/text/id, is an error, never silently skipped."""
    rows, per_file = [], collections.OrderedDict()
    for path in real_block_files(directory):
        n = 0
        for lineno, line in enumerate(open(path, encoding='utf-8'), 1):
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get('synthetic') is not False:
                raise ValueError('%s:%d is not a real row (synthetic must be false)' % (os.path.basename(path), lineno))
            for key in ('id', 'prompt', 'text', 'kind', 'provenance'):
                if key not in row:
                    raise ValueError('%s:%d lacks %s' % (os.path.basename(path), lineno, key))
            row['_file'] = os.path.basename(path)
            rows.append(row)
            n += 1
        per_file[os.path.basename(path)] = n
    return rows, per_file


def _guard_class():
    spec = importlib.util.spec_from_file_location('issue235_producer', os.path.join(HERE, '..', 'intake', 'issue235_producer.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def mix_report(directory=HERE, frozen=None):
    rows, per_file = load_real_block(directory)
    ids = collections.Counter(r['id'] for r in rows)
    report = {'files': per_file, 'real_rows': len(rows), 'real_unique': len(ids),
              'duplicate_ids': sorted(i for i, c in ids.items() if c > 1),
              'by_kind': dict(sorted(collections.Counter(r['kind'] for r in rows).items())),
              'by_source': dict(sorted(collections.Counter(r['provenance'].get('source', '?') for r in rows).items()))}
    if frozen is not None:
        mod = _guard_class()
        guard = mod.FrozenGuard(frozen)
        drops = {}
        for r in rows:
            reason = guard.drop_reason(r)
            if reason:
                drops[r['id']] = reason
        report['frozen_files_checked'] = [os.path.basename(p) for p in guard.files]
        report['leakage_drops'] = drops
        report['final_real_unique'] = report['real_unique'] - len(drops)
    return report


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--dir', default=HERE)
    ap.add_argument('--frozen', nargs='*', default=None, help='frozen-set files; default: discovered under nexus-llm/eval')
    args = ap.parse_args(argv)
    frozen = args.frozen
    if frozen is None:
        mod = _guard_class()
        frozen = mod.discover_frozen(os.path.abspath(os.path.join(HERE, '..', '..')))
    print(json.dumps(mix_report(args.dir, frozen or None), indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
