# Spiderlings: authorship and design record

**The spiderlings, the throne visual language, and the ForgeClaw UI concept are owner intellectual property** (Cristian, DeviousDevv303;
owner's statement, 2026-11-04). This file keeps the authorship chain on the object: the owner's directives and design decisions, dated,
next to the code that implements them. Directives are quoted from the owner's chat and from issue #235; times are as recorded there.

## Directives (owner)
| Date (CST) | Where | Decision |
|---|---|---|
| 2026-11-03 | #235 comment 6615517798 | Spiders live in the throne scene; destination = the task's real channel; shown only while a run is in flight; return to the throne; flagged returns with red thread; no motion without a recorded line. |
| 2026-11-04 09:21 | main chat (recorded #235 6634511062) | Build it to a UI-tested PR: spiders from the throne (the chair) along the cables to the task nodes and back; anchor suggestion: the circle at the chest; painted onto the backdrop on the existing ThroneRig (`?rig=1`), one scene; v1 = existing per-tool events + staleness + "as of"; no pinned files; mocks flagged; Playwright at 1100x900 and 443x853, screenshots in-repo. |
| 2026-11-04 09:24 | main chat (#235 6634579800) | Jumping spiders, realistic Phidippus anatomy, black with red; reactive first, ambient second (node-to-node jumps, silk distinct from the neural lines, one wall spider that slips and catches itself). |
| 2026-11-04 09:29 | main chat (#235 6634700554) | A mind of their own: seeded procedural behaviour trees, weighted choices, deterministic seeds, never pure RNG; occasional web-building; strategic unpredictability. |
| 2026-11-04 | Claude session chat | Reference photos sent ("They need to look like this"); corrections: drop the outline stroke, thicken the legs, hair; "the face and the fuzz"; final: realistic, not cartoony; stocky compact hairy body, short thick tapering legs, crouched posture with legs angled ~45-65° and the front pair raised; rendered texture, rim light on fur, no white outline. |
| 2026-11-04 | Claude session chat | Owner IP statement (above); preserve directives, briefs and dated decisions on the object. |
| 2026-11-04 | Owner ruling (via #235 paste) | Reference photos served their purpose: remove both JPEGs from `docs/spiderlings/reference/`; they do not merge. |
| 2026-11-04 | Claude session chat | Terrain reactivity (spiders obey the scene's geometry; climbing shows the climb; every pose reads the terrain), realism pass (saccadic locomotion, landing compression, dragline on every jump, attention tilt, eyeshine, idle micro-motion, conforming contact shadows, outcome-encoded movement) and stealth pass (stalk, freeze, prefer edges, statue stillness, escape reflex). |

## Visual targets (removed from the repo 2026-11-04, owner ruling)
The two owner-supplied reference photographs guided the v4 render and have served their purpose. By owner ruling (2026-11-04)
they were removed and do not merge, together with `v4-vs-reference.png`, which embedded them side by side. They are recorded here
by hash only, so the provenance survives without the third-party pixels:
- `7511.jpg` — *Phidippus carneus*: black, red abdomen with white spots, white bands (sha256 `b7d233c3284388fc363eed2b9af4d547bd58dce592f3dafdf93e9574e943b63a`; carried a BigAppleHerp.com mark).
- `7509.jpg` — the red-cephalothorax morph: red cephalothorax and abdomen, blue-black legs (sha256 `b5479c2c869ce5665acdf91ee2f22fb7e808b07488ea6b12084492a0a96002d8`).
The app draws its spiders procedurally (`src/components/spiderRender.ts`) and never shipped photo pixels. The files remain in the
PR branch's history until the PR is squash-merged; a squash merge leaves them out of main entirely.

## Design decisions (Claude lane, dated)
- 2026-11-04 v1: event ledger, staleness, "as of", demo flagged, anchors on the painting (PR #366, `69b46dde`).
- 2026-11-04 v1.1: ambient life, seeded behaviour tree, silk distinct from neural, face at rest (`96d0fad1`).
- 2026-11-04 v4 render: rebuilt as a creature to the two photos (filled tapered crouched legs, fur strands with rim light, no outline,
  glossy eyes; two morphs: carneus and red). Judged side by side with the photos at specimen scale.
- 2026-11-04 behaviour passes: saccadic stalk, outcome-encoded returns, climb pitch by surface, landing squash, escape reflex on
  startles, attention tilt to pointer/cube, eyeshine matched to scene light. Per-foot terrain IK left for a ledge-geometry trace.
