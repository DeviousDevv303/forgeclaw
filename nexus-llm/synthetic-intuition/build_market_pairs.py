#!/usr/bin/env python3
"""Build source-backed market recognition pairs after the frozen probe contract passes."""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import build_pairs as provenance
import market_pairs


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pairs", type=Path, help="graded distance-pair definitions JSONL")
    parser.add_argument("--design", required=True, type=Path, help="frozen mix-design JSON")
    parser.add_argument("--design-sha256", required=True, type=Path, help="mix-design SHA-256 sidecar")
    parser.add_argument("--pack", type=Path, default=Path(__file__).with_name("PACK-V1.1.md"))
    parser.add_argument("--frozen-manifest", type=Path, default=Path(__file__).parents[1] / "eval" / "FROZEN.json")
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).parents[2])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.output.exists():
            raise provenance.BuildError(f"refusing to overwrite existing output: {args.output}")
        provenance.verify_pack(args.pack)
        design, design_hash = provenance.load_design(args.design, args.design_sha256)
        pairs = provenance.read_jsonl(args.pairs)
        rows = market_pairs.build_market_rows(pairs, design, args.repo_root)
        frozen_strings = provenance.load_frozen_strings(args.frozen_manifest, args.repo_root)
        provenance.reject_frozen_overlap(rows, frozen_strings)
        output_hash = provenance.write_jsonl(args.output, rows)
        report = {
            "schema": "synthetic-intuition-market-build-report-v1",
            "pack_sha256": market_pairs.PACK_SHA256,
            "pack_bytes_verified": True,
            "design_id": design["design_id"],
            "design_sha256": design_hash,
            "frozen_at": design["frozen_at"],
            "source_pairs": len(pairs),
            "rows": len(rows),
            "pair_types": dict(sorted(Counter(pair["pair_type"] for pair in pairs).items())),
            "actions": dict(sorted(Counter(row["expected_action"] for row in rows).items())),
            "source_sha256": dict(sorted({row["source_record_id"]: row["source_sha256"] for row in rows}.items())),
            "frozen_eval_strings_checked": len(frozen_strings),
            "output_sha256": output_hash,
            "training_started": False,
        }
        args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0
    except (provenance.BuildError, OSError) as exc:
        print(f"build_market_pairs.py: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
