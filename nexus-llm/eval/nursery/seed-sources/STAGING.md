# Held-out seed families — STAGING (grading seat)

**Staged by:** Muse (grading seat), 2026-11-02 · **Authority:** the seat's §7 ruling on Claude's held-out partition draft (#235 comment 6577340477, ruling Q5: the seat stages the four seed families' sources with hashes; Claude's lane drafts the first held-out list from these staged objects). Draft: `nexus-llm/eval/nursery/HELDOUT-PARTITION-DRAFT.md` @ `3b8c5aed`, SHA-256 `f67cc072…c515`.

Each family below is one underlying object, per the draft's §2 partition-by-family rule. `family_id` = SHA-256 of the canonical source reference shown. These files stage the SOURCES only — no probe records exist yet. Rows built from these objects stay `unverified-source` for any family whose staging is later found incomplete; all four here are staged from objects the seat read directly this session.

| Family | Canonical ref | family_id (SHA-256 of ref) | Staged file | File SHA-256 | Source provenance |
|---|---|---|---|---|---|
| Qwen UFC recap fabrication (2026-11-01) | `chat-failure:qwen-ufc-recap-20261101` | `3634493305b544be0d8818b0d3ff05bb4f58ab5a219249683eaf3c4577dd10a9` | `family-ufc-recap-20261101.md` | `bdc6ac7239bcc54afa554ca4a20d5071e6eea0966c071bfd664d7bc430af48e4` | Intake record run_id `qwen-ufc-recap-20261101` (owner-report, 2026-11-01T11:10:00Z) verbatim; ground truth verified by the grader against ufc.com / MMA Junkie; lane fix PR #355 |
| Munguia live-search recap failure (2026-10-31) | `chat-failure:munguia-recap-20261031` | `e24e07d3c29bfb04b135b55e3e8d36e0bfba2a8a84e64cc7d071350cbbca26a1` | `family-munguia-recap-20261031.md` | `1478ba05a6d5d867b2f3be393309b92c9e337cfb916f78a2df14f4e90a9cadcb` | Muse's daily log entries of 2026-10-31 (~16:3x and ~16:44–16:47 CDT) verbatim; ground truth verified by live web search (Tennessean / USA Today / BoxingNews24 / WBN): Munguia def. Zon UD 117-111 ×2, 116-112 |
| D-018 mirrored NO-fill denomination | `finding:D-018` | `575395135bda62a1f9c493a8fb04189e6e38a571a19bcb75ee7cc3947d3969a9` | `family-d018-filing.md` | `1c7051de4d97b9b34b389f82aa1b5d842b61377797b7304847b8383328c6ebf3` | The defect filing verbatim (#235 comment 6567535380, Pass 19); disposition ruled by the owner 2026-11-02 (#235 comment 6576941547) |
| Route C Qwen self-admission case | `chat-failure:route-c-qwen-self-admit-20261101` | `dbd08fc0eacc0a8d0644a924ca2fa7f76ed56aa01d49a13778b7b7be2a51a17f` | `family-route-c-walk-comment-6555510247.md` | `9ac91491443e18661579cb39ad449d4d3b45f78b09244abb60f7a54d7f2bf279` | Claude's end-to-end Nexus↔Qwen walk post verbatim (#235 comment 6555510247, fetched via the API at staging time); fix PR #354 merged `f861075f` |

## Next steps (per the ruling's freeze sequence)

1. Claude's lane drafts the first held-out list from these staged objects — explicit list (ruling Q1), probe records in the draft's §4 schema, each row naming its family and this staging as provenance.
2. The seat freezes the list on #235 with its hash.
3. The denylist is built from the frozen exams + the frozen held-out list and proven against its canaries (ruling Q2), results on the object.

Signed-off-by: Muse <muse@forgeclaw.dev>
