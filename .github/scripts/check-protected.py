#!/usr/bin/env python3
"""Refuse changes to protected paths.

Usage: check-protected.py <protected-paths.txt>   (NUL-separated paths on stdin)

Feed it EVERY changed path, including both sides of renames (use `git diff --no-renames -z`)
and untracked files. Exit 0 = nothing protected, 1 = at least one protected path, 2 = bad usage.
Workflows load this script and the list from origin/main, so a proposed change cannot weaken them.
"""
import fnmatch
import posixpath
import sys


def load(list_file):
    entries = []
    with open(list_file, encoding='utf-8') as handle:
        for line in handle:
            line = line.strip()
            if line and not line.startswith('#'):
                entries.append(line.casefold())
    if not entries:
        raise SystemExit('protected-paths list is empty; refusing to continue.')
    return entries


def normalize(path):
    path = posixpath.normpath(path.replace('\\', '/')).lstrip('/')
    return path.casefold()


def is_protected(path, entries):
    path = normalize(path)
    if path == '..' or path.startswith('../') or path == '.':
        return True  # traversal or nonsense: treat as protected
    base = posixpath.basename(path)
    for entry in entries:
        if entry.endswith('/'):
            if path.startswith(entry) or path + '/' == entry:
                return True
        elif '/' in entry:
            if fnmatch.fnmatchcase(path, entry):
                return True
        elif fnmatch.fnmatchcase(base, entry):
            return True
    return False


def main(argv):
    if len(argv) != 2:
        print('usage: check-protected.py <protected-paths.txt>', file=sys.stderr)
        return 2
    entries = load(argv[1])
    raw = sys.stdin.buffer.read().decode('utf-8', errors='surrogateescape')
    paths = [p for p in raw.split('\0') if p]
    refused = sorted({p for p in paths if is_protected(p, entries)})
    if refused:
        print('Protected paths changed:')
        for path in refused:
            print(f'  {path}')
        return 1
    print(f'Protected-path check passed for {len(set(paths))} changed path(s).')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
