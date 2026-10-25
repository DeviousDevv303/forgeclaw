# ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
# Proprietary source-available license. Commercial use requires written permission. See LICENSE.
"""Turn MiroFish's locked requirements into a CPU-only, fully hash-pinned install for an Actions runner.

Measured 2026-10-24: MiroFish's uv.lock resolves to a 4.24 GB download on Linux x86_64, 4.06 GB of it (96%) torch plus NVIDIA
CUDA libraries that a CPU runner cannot use (pulled in by camel-oasis -> sentence-transformers). Installing CPU torch first and
the rest of the lock with --no-deps gives 1.35 GB. This helper does the one fiddly part of that, offline and testable:

  * drop every torch / triton / nvidia-* requirement from `uv export` output, whole blocks at a time (a requirement is an
    unindented `name==version` line followed by indented `--hash=` and `# via` lines), keeping every other hash;
  * emit a one-package requirements file for the CPU build of the SAME torch version, pinned by the wheel hash the caller
    supplies, so even the single package that is not in the lockfile cannot change under us.

It refuses to produce output if anything GPU-shaped survives, or if the lock contains no torch to match.
"""
from __future__ import annotations

import argparse
import json
import re
import sys

_REQUIREMENT = re.compile(r'^([A-Za-z0-9][A-Za-z0-9_.-]*)(\[[^\]]*\])?==([^\s;\\]+)')
_GPU = re.compile(r'^(torch|triton|nvidia-[a-z0-9-]+)$', re.I)
_HASH = re.compile(r'^[0-9a-f]{64}$')


class RequirementsError(Exception):
    pass


def drop_gpu_packages(text: str) -> tuple[str, list[str], str]:
    """Return (requirements without GPU packages, dropped package names, locked torch version). Whole blocks, hashes intact."""
    kept: list[str] = []
    dropped: list[str] = []
    torch_version = ''
    skipping = False
    for line in text.splitlines():
        match = _REQUIREMENT.match(line)
        if match:
            name = match.group(1).lower()
            skipping = bool(_GPU.match(name))
            if skipping:
                dropped.append(name)
                if name == 'torch':
                    torch_version = match.group(3)
        elif line and not line[0].isspace():
            skipping = False  # an unindented comment or option line ends the previous block
        if not skipping:
            kept.append(line)
    if not torch_version:
        raise RequirementsError('the lock has no torch requirement: nothing to replace with a CPU build')
    remaining = [m.group(1) for m in (_REQUIREMENT.match(l) for l in kept) if m and _GPU.match(m.group(1).lower())]
    if remaining:
        raise RequirementsError(f'GPU packages survived the filter: {remaining}')
    return '\n'.join(kept) + '\n', sorted(set(dropped)), torch_version


def torch_cpu_requirement(version: str, sha256: str) -> str:
    """One hash-pinned requirement for the CPU build of the locked torch version."""
    if not re.fullmatch(r'\d+(\.\d+){1,3}', version):
        raise RequirementsError(f'unexpected torch version {version!r}')
    if not _HASH.match(sha256 or ''):
        raise RequirementsError('the CPU torch wheel needs a 64-hex sha256 pin')
    return f'torch=={version}+cpu \\\n    --hash=sha256:{sha256}\n'


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description='Split uv export output into a hash-pinned non-GPU file and a CPU-torch file.')
    ap.add_argument('export', help='output of `uv export --frozen --no-emit-project` (with hashes)')
    ap.add_argument('--torch-cpu-sha256', required=True, help='sha256 of the CPU torch wheel for the locked version')
    ap.add_argument('--out-main', required=True)
    ap.add_argument('--out-torch', required=True)
    ns = ap.parse_args(argv)
    try:
        with open(ns.export, encoding='utf-8') as handle:
            main_text, dropped, torch_version = drop_gpu_packages(handle.read())
        torch_text = torch_cpu_requirement(torch_version, ns.torch_cpu_sha256)
    except (RequirementsError, OSError) as error:
        print(f'::error title=mirofish-requirements::{error}', file=sys.stderr)
        return 1
    with open(ns.out_main, 'w', encoding='utf-8') as handle:
        handle.write(main_text)
    with open(ns.out_torch, 'w', encoding='utf-8') as handle:
        handle.write(torch_text)
    print(json.dumps({'torch_locked': torch_version, 'torch_cpu': f'{torch_version}+cpu', 'dropped': dropped, 'dropped_count': len(dropped)}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
