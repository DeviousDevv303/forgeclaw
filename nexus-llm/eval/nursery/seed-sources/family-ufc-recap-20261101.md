# Seed family — Qwen UFC recap fabrication (2026-11-01)

Source object: the Nexus intake failure record below, verbatim (run_id `qwen-ufc-recap-20261101`, source `owner-report`, ts 2026-11-01T11:10:00Z, in `~/workspace/canary/nexus-intake.jsonl`, published to branch `nexus-intake-data`). The failure: ForgeClaw's Qwen lane presented UFC 331 (2026-09-19) as the previous night's card with fabricated/scrambled finishes. Verified ground truth (grader, same morning, against ufc.com official scorecards and MMA Junkie): UFC Fight Night 292, Meta Apex, Sat 2026-10-31 — Tom Nolan def. Renato Moicano TKO R3 1:28; Jacobe Smith def. Randy Brown UD (30-26 x3); Jean-Paul Lebosnoyani def. Farman Hasanov TKO R3; Luana Santos def. Yana Santos UD; Cody Durden def. Ode' Osbourne UD; Lucia Szabova def. Tainara Lisboa TKO R3 (prelims). Lane fix: PR #355 (`4382e09f`).

```json
{
  "ts": "2026-11-01T11:10:00Z",
  "source": "owner-report",
  "kind": "model-failure-observation",
  "run_id": "qwen-ufc-recap-20261101",
  "check": "forgeclaw-app-ufc-recap",
  "evidence": "Owner asked ForgeClaw (Qwen lane) for yesterday\u2019s UFC results on 2026-11-01. The answer presented UFC 331 (held 2026-09-19, Van def. Pantoja UD) as yesterday\u2019s card and mixed in fabricated/scrambled finishes (Silva title win vs Wang Cong, Sharaf KO of Steveson, Smith vs Whitehead \u2014 Smith actually fought on the real Oct 31 card). Actual Oct 31 2026 event: UFC Fight Night 292, Meta Apex \u2014 Nolan def. Moicano TKO R3 1:28; Smith def. Brown UD. Verified by grader against ufc.com/MMA Junkie same morning. Same failure family as the 2026-10-31 Munguia recap: stale event presented as current, no sign the live-web path was consulted."
}
```
