# Synthetic Intuition — Step 0 (forgeclaw #235, Final Build Verdict, comment 6903122241)

Authorized by the owner's GO (comment 6903205565). Covers Step 0 only. It does not decide the production clamp default or the Codex Anima trichotomy.

## Built (app-side, deterministic, `src/lib/intuition/`)
| Piece | File | Notes |
|---|---|---|
| 12-field pre-outcome record | `record.ts` | Fields 1-8 sealed (deep-frozen, hashed) before any outcome; fields 9-12 are a separate grade naming the sealed hash. Field 11 enforced: method failure = mechanistic signature + `unresolved`; hypothesis disproof = pre-registered test ran on a clean chain + `incorrect`. Self-grading refused. |
| Bound math | `boundMath.ts` | One estimator: Wilson lower bound, z = 1.959964, id `wilson-lcb-z1.959964-v1`. 1/1 = 0.21, 7/10 = 0.40, 10/10 = 0.72. Buckets 0-7 on frozen edges `bucket-edges-v1`, meaning per bucket written down. |
| Pattern-class registry | `patternClasses.ts` | Shape and freeze rules only (falsifier required, parents, cap 16). `PATTERN_CLASSES_V1` (Muse's list) is active. A draft registry is refused by the packet builder unless `allowDraft`. |
| Evidence ledger + journal | `ledger.ts` | Only LIVE, graded, resolved, untampered records count. Synthetic, mined-235, ungraded and unresolved are counted as excluded, never as hits or denominators. Per class, per regime, per registry version. |
| Intuition packet | `packet.ts` | `ix1 c=03 b=5 r=1 f=1 p=2`. Integers only, no record IDs, 24-char budget, no new tokens. Provenance by packet hash -> journal -> record IDs; `resolvePacket` fails closed. |
| Owner view | `command.ts`, `components/IntuitionPanel.tsx`, `App.tsx` | `/intuition` opens a read-only panel (`/intuition close` hides it). Owner-only, no model, no token, no authority. |

## Verified against the deployed tokenizer
`nexus-llm/tokenizer/test_tokenizer.py::IntuitionPacket`: digits 0-7 are single pieces; the bucket is exactly one token in all 256 class/bucket/flag packet shapes; a packet is 19 tokens worst case.

## Frozen (Muse, #235 comment 6904200501)
- Estimator: `wilson-lcb-z1.959964-v1`. One estimator; parent shrinkage, if ever built, arrives as its own frozen prior.
- Bucket edges: `bucket-edges-v1` = [0.05, 0.15, 0.25, 0.40, 0.55, 0.70, 0.85].
- Pattern classes: `pattern-classes-v1`, twelve classes, now `ACTIVE_REGISTRY`. Freeze notes: one class per prediction; synthetic pairs never calibrate; per-class per-regime reporting.
- **Open wording check:** each class's `falsifier` text was derived from its signature in this branch (the ruling carried signature and assertion only). Compare against Muse's `pattern-classes-v1.md`.

## Not built / not done
- Gate A (Run 31 static audit): Muse runs it on the machine that holds the files; this lane grades the result. Nothing is claimed about Run 31 here.
- Steps 1-5 (scoring harness, generators, mined tranche, pilot, other suites) are gated on pack v1.1 hashing and later owner words.
