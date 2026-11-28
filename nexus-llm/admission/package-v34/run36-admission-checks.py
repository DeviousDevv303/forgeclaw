#!/usr/bin/env python3
"""
run36-admission-checks.py — v3.4.0
Mechanical admission-check layer for the Run 36 pilot training file (ForgeClaw).
LABEL: v3.4 CANDIDATE — C1-C6 and C9 active; C7/C8/C10 blocked. This candidate
supersedes nothing: supersession follows independent package verification,
never precedes it (GPT consolidated adjudication). Verification targets are
named by digest, not version label: the newest posted digest-set supersedes
all earlier ones; v3.1 is REJECTED on token grounds (Muse's finding, Claude's
verdict, amendment comment 7230645402).

Disposition history:
  v1  2026-11-28  first ship (batch 174)
  v2  2026-11-28  GPT audit: fixes #2 #3 #4 #5 accepted, #6 preserved,
                  #1 split (ceiling as declared input; 630 contested as unsourced)
  v3  2026-11-28  #1 CONCEDED. The ceiling is now a hard constant, not a CLI input.
  v3.1 2026-11-28 SELF-FOUND DEFECT (disclosed): v3's C9 was tier-blind and
                  rejected spawn_count 0 — the canonical RESTRAINT boundary.
                  C9 now tier-aware (restraint MUST normalize to zero spawns).
  v3.2 2026-11-28 GPT FINDINGS 1-3 ANSWERED on the object (full #235 pull,
                  1,518 comments via API):
                  (1) 640 = model context — object-verified (many posts incl.
                      the truncation audit, comment 7230139327). 630 as the
                      admission row limit is NOT stated on #235; its sources
                      are GPT's audit + Muse's record-reading, consistent with
                      the audit's measured "13 rows at 630+" tail band. The
                      constant stays enforced at 630 with that provenance
                      labeled, pending the canonical-text constitution
                      (Muse's assembly proposal, comment 7230201506).
                  (2) KAT circularity: the tokenizer FILE is now the external
                      anchor — nexus.model sha256 323458df…b935a is attested
                      in three independent on-object posts; the KAT guards
                      loader/version drift against those pinned bytes.
                  (3) TOKENIZER CORRECTED: the trainer counts rows with
                      SentencePiece nexus.model v1 (vocab 4,000), NOT cl100k.
                      Measured delta on the fixture rows: nexus counts run
                      +9..+29 (mean +20) vs cl100k on the same text — cl100k
                      counts would misplace the 630 boundary. This candidate
                      pins the canonical tokenizer bytes (correct path:
                      nexus-llm/loop-tree/tokenizer/nexus.model; the older
                      nexus-llm/tokenizer/nexus.model @4be164e4 is a known
                      trap) and supports both sentencepiece and tiktoken
                      loaders. cl100k fixtures from v3..v3.1 were demo pins.
  v3.3 2026-11-28 GPT TIER-AUTHORITY BLOCKER (highest-priority finding):
                  v3.x read the tier from the ROW being checked — a row could
                  steer its own C9 rule. Tier authority now lives in the
                  hash-pinned pilot manifest (manifest.tiers {row_id: tier}),
                  seat-controlled. Every row id MUST be classified;
                  unclassified rows and stale classifications FAIL CLOSED (C4);
                  a row-declared tier conflicting with the manifest FAILS (C4)
                  and C6/C9 refuse to run on untrusted classification
                  (BLOCKED). Negative counts invalid in EVERY tier; a
                  non-restraint row at zero spawns FAILs (enforcement, not
                  merely normalization). The grader's restraint authority
                  stays separate and preserved: eval side = frozen ID set
                  sw-001..005 (eval-swarm.jsonl e5ba5013…4adb @dcfcadd5);
                  pilot side = manifest classification. The two never mix.
  v3.4 2026-11-28 CLAUDE VERDICTS + MUSE AMENDMENT (comment 7230645402):
                  (1) EXTERNAL COUNT-KAT: manifest tokenizer block now carries
                      kat_counts — golden token counts supplied by an
                      independent lane (fixture: Muse's seven, comment
                      7230606565), verified against the pinned tokenizer.
                      Provenance is anchored in the harness (T26), outside both
                      runner and manifest. The id-sequence KAT stays: counts
                      and ids guard different drift.
                  (2) MANIFEST SEAL: new constant SEALED_MANIFEST_SHA256. For
                      admission runs the gate-5 seat pins the pilot manifest's
                      sha256 here — same discipline as the grader's
                      FROZEN_SHA256; classification changes become visible,
                      hash-dated runner+manifest pairs. None = UNSEALED
                      (fixture/development only) and the report SAYS so
                      (surface honesty). Seal mismatch FAILs C1.
                  (3) Stale-target rule recorded in the label above: verify
                      the newest posted digest-set, never a version label
                      (Claude's v3.1->v3.2 correction generalized).

HARD CONSTANT — DO NOT PARAMETERIZE:
  ROW_TOKEN_CEILING = 630   admission row token limit (record on forgeclaw #235;
                            640 is the model context window, a different quantity).
                            Changing this number is a code change with a new hash
                            (freeze discipline), never a runtime flag.

Route C: machines never promote machines. This tool NEVER prints ADMIT and never
exits 0. Admission is a gate-5 seat decision. Exit codes:
  1  at least one check FAIL
  2  no FAIL, but at least one BLOCKED or DEFERRED (C10 is BLOCKED by design,
     so this tool always exits 2 on a clean file)

C10 remains BLOCKED until the canonical 11-check specification text on #235 is
byte-compared against this implementation. C7/C8 are BLOCKED for the same reason:
their mechanical definitions were not byte-available to this build session and are
not reconstructed from memory (go to the object, never a reference of it).

Manifest contract (JSON):
  tokenizer : {name, package, version, kat: {text, expected_ids},
               kat_counts: {source, cases: [{id, text, tokens}]}  # (v3.4)
               # external golden counts from an independent lane — verified
               # when present; pilot manifests MUST carry such a set
               model_file: {path, sha256}  # sentencepiece only, hash-verified
  allowlist : {path, sha256}           # absence BLOCKS C2; hash mismatch FAILs C2
  rows      : {path, sha256}           # rows-file bytes verified against this
  tiers     : {row_id: "positive"|"restraint"|"near_miss"}  # TIER AUTHORITY
               # (v3.3) — must classify every row id exactly; unclassified or
               # stale ids FAIL C4 closed; row-declared tier never overrides
  token_ceiling (optional)             # if present and != 630 -> C3 FAIL (conflict)
Row contract (JSONL, one object per line):
  id (str), text (str),
  spawn_count (int, decimal-string, or {min,max} range), single_spawn_justified (bool, optional)
  tier (str, optional) — informational only; conflicts with manifest.tiers FAIL C4
  restraint-classified rows MUST normalize to zero spawns (frozen boundary, v3.1);
  non-restraint rows MUST be >= 1 (v3.3); negatives invalid everywhere (v3.3)
The counted form is row["text"] exactly as written — the frame-transform boundary
is upstream of this tool; counted-form comparison is a pre-admission gate.
"""
import argparse
import hashlib
import importlib
import importlib.metadata
import json
import random
import re
import sys
from pathlib import Path

TOOL_VERSION = "3.4.0"
ROW_TOKEN_CEILING = 630          # hard constant — see module docstring
MODEL_CONTEXT_TOKENS = 640       # informational only; NOT enforced (different quantity)
JACCARD_NEAR_DUP = 0.90          # distinctness pre-screen threshold (provisional, C10-folded)
TIER_QUOTAS = {"positive": 5, "restraint": 3}   # near_miss tier = census (all rows)
KNOWN_TIERS = frozenset({"positive", "restraint", "near_miss"})
WORKSHEET_SEED = int.from_bytes(
    hashlib.sha256(b"run36-worksheet-seed-v3").digest()[:8], "big"
)  # fixed constant seed => deterministic worksheets across machines

# MANIFEST SEAL (v3.4) — the tier-classification manifest is the seat's
# authority artifact, so for ADMISSION runs its sha256 is pinned HERE, the same
# discipline as the grader's FROZEN_SHA256. A classification change then means
# a new manifest AND a new runner pin: visible, hash-dated, re-verified.
# None = UNSEALED (fixture/development only) — the report declares it.
SEALED_MANIFEST_SHA256 = None

PASS, FAIL, BLOCKED, DEFERRED = "PASS", "FAIL", "BLOCKED", "DEFERRED"


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Report:
    def __init__(self):
        self.checks = {}          # cid -> {"verdict": v, "detail": str}
        self.worksheets = None
        self.tokenizer = None     # usable encoding, or None
        self.manifest_seal = None  # seal state string once C1 evaluates it

    def put(self, cid, verdict, detail):
        self.checks[cid] = {"verdict": verdict, "detail": detail}

    def summary(self):
        order = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"]
        return {c: self.checks.get(c, {"verdict": BLOCKED, "detail": "not run"})
                for c in order}


def c1_manifest_and_tokenizer(rep: Report, manifest_path: Path):
    """C1: manifest schema + tokenizer implementation AND version + known-answer test.
    Supported packages: tiktoken (encoding selected by name) and sentencepiece
    (model bytes pinned via tokenizer.model_file {path, sha256}, hash-verified
    the same way as the allowlist — the trainer's canonical tokenizer is a
    sentencepiece file, so a name-only check would be a guard that can't fire)."""
    if not manifest_path.is_file():
        rep.put("C1", BLOCKED, f"manifest file missing: {manifest_path.name}")
        return None
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict):
            raise ValueError("manifest root is not an object")
    except Exception as e:
        rep.put("C1", FAIL, f"manifest malformed/unparseable: {e}")
        return None
    # manifest seal (v3.4): when the seat pins SEALED_MANIFEST_SHA256, the
    # loaded manifest bytes MUST reproduce it — the classifications inside are
    # the seat's authority, so the file carrying them is pinned like the
    # grader's frozen benchmark. None = unsealed; the report declares it.
    if SEALED_MANIFEST_SHA256 is not None:
        actual_seal = sha256_file(manifest_path)
        if actual_seal != SEALED_MANIFEST_SHA256:
            rep.put("C1", FAIL, f"manifest seal mismatch: loaded manifest sha256 "
                                f"{actual_seal[:16]}… != pinned seal "
                                f"{SEALED_MANIFEST_SHA256[:16]}… (seat's "
                                f"classification artifact altered or substituted)")
            return None
    rep.manifest_seal = (f"SEALED (sha256 {SEALED_MANIFEST_SHA256[:16]}…)"
                         if SEALED_MANIFEST_SHA256 is not None else
                         "UNSEALED (fixture/development mode — admission runs "
                         "require SEALED_MANIFEST_SHA256 pinned in the runner)")
    tok = manifest.get("tokenizer")
    if not isinstance(tok, dict) or not all(k in tok for k in ("name", "package", "version")):
        rep.put("C1", FAIL, "manifest missing tokenizer {name, package, version}")
        return None
    name, pkg, declared_ver = tok["name"], tok["package"], tok["version"]
    try:
        module = importlib.import_module(pkg)
    except Exception as e:
        rep.put("C1", FAIL, f"tokenizer package {pkg!r} not importable: {e}")
        return None
    actual_ver = importlib.metadata.version(pkg)
    if actual_ver != declared_ver:
        rep.put("C1", FAIL,
                f"tokenizer version mismatch: manifest declares {declared_ver}, "
                f"installed is {actual_ver}")
        return None
    base = Path(manifest_path.parent)
    if pkg == "tiktoken":
        try:
            enc = module.get_encoding(name)
        except Exception as e:
            rep.put("C1", FAIL, f"unknown encoding {name!r}: {e}")
            return None
        encode = enc.encode
        tok_desc = f"tiktoken=={actual_ver} encoding {name!r}"
    elif pkg == "sentencepiece":
        mf = tok.get("model_file")
        if not isinstance(mf, dict) or "path" not in mf or "sha256" not in mf:
            rep.put("C1", FAIL, "sentencepiece tokenizer requires pinned "
                                "tokenizer.model_file {path, sha256}")
            return None
        mp = (base / mf["path"]).resolve()
        if not mp.is_file():
            rep.put("C1", FAIL, f"tokenizer model file missing: {mf['path']}")
            return None
        if sha256_file(mp) != mf["sha256"]:
            rep.put("C1", FAIL, f"tokenizer model file hash mismatch (corrupt, "
                                f"substituted, or the old 4be164e4 file): {mf['path']}")
            return None
        try:
            sp = module.SentencePieceProcessor(model_file=str(mp))
        except Exception as e:
            rep.put("C1", FAIL, f"sentencepiece failed to load {mf['path']}: {e}")
            return None
        encode = sp.encode
        tok_desc = (f"sentencepiece=={actual_ver} model {name!r} "
                    f"({mp.name}, sha256-verified)")
    else:
        rep.put("C1", FAIL, f"unsupported tokenizer package {pkg!r}")
        return None
    kat = tok.get("kat")
    if not isinstance(kat, dict) or "text" not in kat or "expected_ids" not in kat:
        rep.put("C1", FAIL, "manifest missing tokenizer known-answer test (kat)")
        return None
    actual_ids = list(encode(kat["text"]))
    if actual_ids != list(kat["expected_ids"]):
        rep.put("C1", FAIL, "known-answer test failed: tokenizer implementation "
                            "does not reproduce manifest kat.expected_ids")
        return None
    # external count-KAT (v3.4): golden token counts supplied by an independent
    # lane (fixture: Muse's seven, #235 comment 7230606565). Verified whenever
    # present. For the pilot manifest the seat MUST source this set from a lane
    # other than the runner's (amendment 7230645402 requirement (c)).
    kat_counts_note = "no external count-KAT block"
    kat_counts = tok.get("kat_counts")
    if kat_counts is not None:
        cases = kat_counts.get("cases") if isinstance(kat_counts, dict) else None
        if not isinstance(cases, list) or not cases:
            rep.put("C1", FAIL, "tokenizer kat_counts present but malformed "
                                "(need non-empty cases[])")
            return None
        bad = []
        for i, case in enumerate(cases, 1):
            if not isinstance(case, dict) or "text" not in case or "tokens" not in case:
                bad.append(f"case {i} malformed")
                continue
            n = len(encode(case["text"]))
            if n != case["tokens"]:
                bad.append(f"{case.get('id', f'case {i}')}: counted {n} "
                           f"!= golden {case['tokens']}")
        if bad:
            rep.put("C1", FAIL, "external count-KAT failed: " + "; ".join(bad))
            return None
        kat_counts_note = (f"external count-KAT reproduced ({len(cases)} cases; "
                           f"source: {kat_counts.get('source', 'UNLABELED')})")
    rep.put("C1", PASS, f"tokenizer {tok_desc} verified; "
                        f"KAT reproduced ({len(actual_ids)} tokens); "
                        f"{kat_counts_note}; manifest {rep.manifest_seal}")
    rep.tokenizer = encode
    return manifest


def c2_provenance(rep: Report, manifest: dict, rows_path: Path):
    """C2: allowlist provenance + rows-file integrity. Absent allowlist BLOCKS, never PASSes."""
    problems, blocked = [], False
    allow = manifest.get("allowlist")
    if not isinstance(allow, dict) or "path" not in allow or "sha256" not in allow:
        blocked = True
        problems.append("allowlist provenance absent from manifest")
    else:
        ap = (Path(manifest["_base"]) / allow["path"]).resolve()
        if not ap.is_file():
            blocked = True
            problems.append(f"allowlist file missing: {allow['path']}")
        elif sha256_file(ap) != allow["sha256"]:
            problems.append(f"allowlist hash mismatch (corrupt or substituted): {allow['path']}")
    rows_decl = manifest.get("rows", {})
    if "sha256" in rows_decl:
        if not rows_path.is_file():
            blocked = True
            problems.append(f"rows file missing: {rows_path.name}")
        elif sha256_file(rows_path) != rows_decl["sha256"]:
            problems.append("rows file bytes do not match manifest rows.sha256")
    if problems:
        rep.put("C2", BLOCKED if blocked else FAIL, "; ".join(problems))
    else:
        rep.put("C2", PASS, "allowlist present and hash-verified; rows bytes match manifest")


def c4_rows_schema(rep: Report, rows_path: Path):
    """C4: row schema validation + duplicate ID rejection. A row MAY declare a
    tier field (informational); tier AUTHORITY is the manifest (see classify_rows)."""
    rows, bad, seen, dups = [], [], set(), set()
    for lineno, line in enumerate(rows_path.read_text(encoding="utf-8").splitlines(), 1):
        if line.strip() == "":
            bad.append(f"line {lineno}: blank line")
            continue
        try:
            row = json.loads(line)
            assert isinstance(row, dict)
            assert isinstance(row.get("id"), str) and row["id"]
            assert isinstance(row.get("text"), str) and row["text"]
            if "tier" in row:
                assert isinstance(row["tier"], str)
            assert isinstance(row.get("spawn_count"), (int, str, dict))
            if "single_spawn_justified" in row:
                assert isinstance(row["single_spawn_justified"], bool)
        except Exception:
            bad.append(f"line {lineno}: malformed row schema")
            continue
        if row["id"] in seen:
            dups.add(row["id"])
        seen.add(row["id"])
        rows.append(row)
    problems = [f"duplicate row id(s): {sorted(dups)}"] if dups else []
    problems += bad
    if problems:
        rep.put("C4", FAIL, "; ".join(problems))
    else:
        rep.put("C4", PASS, f"{len(rows)} rows well-formed, ids unique")
    return rows


def classify_rows(manifest: dict, rows):
    """Tier authority (v3.3, GPT's required design): the hash-pinned pilot
    manifest — NOT the row being checked — supplies each row's tier.
    Fail closed: every row id must be classified; stale classifications (ids
    not present in the file) fail; a row-declared tier conflicting with the
    manifest fails. Returns (tier_of, problems)."""
    problems = []
    tiers = manifest.get("tiers")
    if not isinstance(tiers, dict) or not tiers:
        return {}, ["manifest.tiers absent or not an object — tier authority missing"]
    bad_vals = [k for k, v in tiers.items() if v not in KNOWN_TIERS]
    if bad_vals:
        problems.append(f"manifest.tiers has unknown tier value(s) for: {sorted(bad_vals)}")
    row_ids = {r["id"] for r in rows}
    unclassified = sorted(row_ids - set(tiers))
    stale = sorted(set(tiers) - row_ids)
    if unclassified:
        problems.append(f"row id(s) with no manifest classification: {unclassified}")
    if stale:
        problems.append(f"manifest.tiers classifies id(s) not in the rows file: {stale}")
    for r in rows:
        declared = r.get("tier")
        if declared is not None and r["id"] in tiers and declared != tiers[r["id"]]:
            problems.append(f"{r['id']}: row-declared tier {declared!r} conflicts with "
                            f"manifest classification {tiers[r['id']]!r} — manifest governs, "
                            f"conflict itself is the defect")
    return ({rid: tiers[rid] for rid in row_ids if rid in tiers}, problems)


def c3_token_ceiling(rep: Report, manifest: dict, rows):
    """C3: exact re-count via the verified tokenizer against the hard 630 constant.
    Manifest-declared counts are never trusted. A declared ceiling != 630 FAILs."""
    declared = manifest.get("token_ceiling")
    if declared is not None and declared != ROW_TOKEN_CEILING:
        rep.put("C3", FAIL, f"manifest declares token_ceiling={declared}, conflicting with "
                            f"the enforced constant {ROW_TOKEN_CEILING}")
        return
    if rep.tokenizer is None:
        rep.put("C3", DEFERRED, "tokenizer unavailable; manifest token counts never trusted")
        return
    over = []
    counts = {}
    for row in rows:
        n = len(rep.tokenizer(row["text"]))
        counts[row["id"]] = n
        if n > ROW_TOKEN_CEILING:
            over.append(f"{row['id']}={n}")
    if over:
        rep.put("C3", FAIL, f"rows over the {ROW_TOKEN_CEILING}-token ceiling: "
                            + ", ".join(over))
    else:
        worst = max(counts.values()) if counts else 0
        rep.put("C3", PASS, f"{len(rows)} rows re-counted via verified tokenizer; "
                            f"max {worst} <= {ROW_TOKEN_CEILING}")


def c5_distinctness(rep: Report, rows):
    """C5 (provisional, folded under C10): pairwise Jaccard near-duplicate pre-screen."""
    def toks(s):
        return set(re.findall(r"\S+", s.lower()))
    pairs = []
    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            a, b = toks(rows[i]["text"]), toks(rows[j]["text"])
            if not a or not b:
                continue
            sim = len(a & b) / len(a | b)
            if sim >= JACCARD_NEAR_DUP:
                pairs.append(f"{rows[i]['id']}~{rows[j]['id']} jaccard={sim:.3f}")
    if pairs:
        rep.put("C5", FAIL, f"near-duplicate pairs >= {JACCARD_NEAR_DUP}: " + "; ".join(pairs))
    else:
        rep.put("C5", PASS, f"no pair at/above Jaccard {JACCARD_NEAR_DUP}")


def c6_worksheets(rep: Report, rows, tier_of):
    """C6 (provisional, folded under C10): deterministic judgment worksheets.
    Seed-pinned per constant seed; near-miss tier is a census, not a sample.
    Tiers come from the manifest classification (v3.3), never the row."""
    tiers = {}
    for row in rows:
        tiers.setdefault(tier_of[row["id"]], []).append(row["id"])
    rng = random.Random(WORKSHEET_SEED)
    sheet = {}
    notes = []
    for tier, quota in TIER_QUOTAS.items():
        ids = sorted(tiers.get(tier, []))
        if len(ids) < quota:
            notes.append(f"tier {tier}: only {len(ids)} rows for quota {quota} (shortfall)")
        sheet[tier] = sorted(rng.sample(ids, min(quota, len(ids))))
    sheet["near_miss"] = sorted(tiers.get("near_miss", []))   # census: all rows
    rep.worksheets = {"seed": WORKSHEET_SEED, "quotas": TIER_QUOTAS,
                      "selection": sheet, "notes": notes}
    rep.put("C6", PASS, f"worksheets drawn (seed {WORKSHEET_SEED}); "
                        + "; ".join(f"{t}:{len(v)}" for t, v in sheet.items())
                        + (" | " + "; ".join(notes) if notes else ""))


def _normalize_spawn_count(raw):
    """Normalize a spawn_count to (lo, hi). Accepts int, decimal string
    ('1' -> 1), or a {min, max} range object per the grader's spawn_count
    contract family (swarm_grade.py @dcfcadd5). Returns None if invalid."""
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return (raw, raw) if raw >= 0 else None   # negatives invalid in every tier
    if isinstance(raw, str) and re.fullmatch(r"\s*[0-9]+\s*", raw):
        n = int(raw.strip())
        return (n, n)
    if isinstance(raw, dict):
        lo, hi = raw.get("min"), raw.get("max", raw.get("min"))
        if isinstance(lo, int) and not isinstance(lo, bool) \
                and isinstance(hi, int) and not isinstance(hi, bool) \
                and 0 <= lo <= hi:
            return (lo, hi)
    return None


def c9_spawn_counts(rep: Report, rows, tier_of):
    """C9: tier-aware spawn-count validation under MANIFEST tier authority (v3.3).
    RESTRAINT BOUNDARY (sourced, verified on the object): restraint-classified
    rows MUST normalize to zero spawns — frozen benchmark sw-001..sw-005
    (eval-swarm.jsonl sha256 e5ba5013…4adb @dcfcadd5) hard-fails any observed
    spawn on restraint rows, and the pilot's restraint rows must match that
    form and boundary (#235 comment 7230313007). String '0' normalizes to 0
    and does not evade the boundary; a range form must cap at 0.
    Non-restraint rows: MUST be >= 1 spawn (a zero-spawn multi-spawn row is a
    classification lie — FAIL); an exact single spawn requires
    single_spawn_justified=true; string '1' normalizes and does NOT evade.
    Negative counts are invalid in every tier."""
    problems = []
    for row in rows:
        norm = _normalize_spawn_count(row["spawn_count"])
        if norm is None:
            problems.append(f"{row['id']}: spawn_count {row['spawn_count']!r} invalid "
                            f"(not a non-negative integer, decimal string, or valid "
                            f"{{min,max}} range)")
            continue
        lo, hi = norm
        if tier_of[row["id"]] == "restraint":
            if hi != 0:
                problems.append(f"{row['id']}: restraint-classified row permits spawn(s) "
                                f"({lo}..{hi}); the frozen boundary is zero")
        elif lo < 1:
            problems.append(f"{row['id']}: {tier_of[row['id']]}-classified row at zero "
                            f"spawns — only restraint rows may carry zero")
        elif lo == hi == 1 and row.get("single_spawn_justified") is not True:
            problems.append(f"{row['id']}: single-spawn row without "
                            f"single_spawn_justified=true")
    if problems:
        rep.put("C9", FAIL, "; ".join(problems))
    else:
        rep.put("C9", PASS, "spawn counts normalized (int/str/{min,max}); restraint "
                            "rows at zero-spawn boundary; single-spawn rows carry justification")


def main():
    ap = argparse.ArgumentParser(description="Run 36 mechanical admission checks (Route C: never grants admission)")
    ap.add_argument("--rows", required=True, help="path to rows JSONL")
    ap.add_argument("--manifest", required=True, help="path to manifest JSON")
    ap.add_argument("--report", help="optional path to write the JSON report")
    args = ap.parse_args()

    rep = Report()
    rows_path = Path(args.rows).resolve()
    manifest_path = Path(args.manifest).resolve()

    if not rows_path.is_file():
        rep.put("C2", BLOCKED, f"rows file missing: {rows_path}")
        manifest = None
    else:
        manifest = c1_manifest_and_tokenizer(rep, manifest_path)

    rows = []
    if manifest is not None:
        manifest["_base"] = str(manifest_path.parent)
        c2_provenance(rep, manifest, rows_path)
        if rows_path.is_file():
            rows = c4_rows_schema(rep, rows_path)
            tier_of, cls_problems = classify_rows(manifest, rows)
            if cls_problems:
                # classification is identity/integrity: fold into C4 (FAIL) and
                # refuse to run tier-dependent checks on untrusted classification
                prev = rep.checks.get("C4", {})
                detail = (prev.get("detail", "") + " | " if prev else "") \
                    + "; ".join(cls_problems)
                rep.put("C4", FAIL, detail)
            c3_token_ceiling(rep, manifest, rows)
            c5_distinctness(rep, rows)
            if cls_problems:
                rep.put("C6", BLOCKED, "tier classification failed (C4); not run")
                rep.put("C9", BLOCKED, "tier classification failed (C4); not run")
            else:
                c6_worksheets(rep, rows, tier_of)
                c9_spawn_counts(rep, rows, tier_of)
    else:
        for cid in ("C2", "C3", "C4", "C5", "C6", "C9"):
            if cid not in rep.checks:
                rep.put(cid, BLOCKED, "upstream manifest failure; not run")

    rep.put("C7", BLOCKED, "definition does not exist to implement (#235 comment "
                           "7230201506: canonical 11-check text was never constituted); "
                           "do not read as PASS")
    rep.put("C8", BLOCKED, "definition does not exist to implement (#235 comment "
                           "7230201506: canonical 11-check text was never constituted); "
                           "do not read as PASS")
    rep.put("C10", BLOCKED, "no byte-compare target exists until the canonical 11-check "
                            "text is constituted (assembly proposal, comment 7230201506, "
                            "owner-decides) and posted")

    verdicts = [c["verdict"] for c in rep.checks.values()]
    out = {
        "tool": "run36-admission-checks",
        "tool_version": TOOL_VERSION,
        "constants": {"row_token_ceiling": ROW_TOKEN_CEILING,
                      "model_context_tokens_informational": MODEL_CONTEXT_TOKENS,
                      "jaccard_near_dup": JACCARD_NEAR_DUP},
        "manifest_seal": rep.manifest_seal or "not evaluated (see C1)",
        "checks": rep.summary(),
        "worksheets": rep.worksheets,
        "admission": "NOT_GRANTED",
        "admission_note": "This tool never prints ADMIT and never exits 0. "
                          "Admission is a gate-5 seat decision (Route C).",
    }
    text = json.dumps(out, indent=2, sort_keys=True)
    for cid, c in rep.summary().items():
        print(f"{cid} {c['verdict']} — {c['detail']}")
    print("ADMISSION: NOT_GRANTED (seat-only authority; this tool is the mechanical layer)")
    if args.report:
        Path(args.report).write_text(text + "\n", encoding="utf-8")
    if FAIL in verdicts:
        sys.exit(1)
    sys.exit(2)   # BLOCKED/DEFERRED always present (C10 by design)


if __name__ == "__main__":
    main()
