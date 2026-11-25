# Run 35 — Status

**State: TRAINING LAUNCHED 2026-11-22 01:49:50 UTC (2026-11-21
19:49:50 CST) — chain config (a). Supervisor PID 12089, trainer
PID 12102. Liveness cron `run35-liveness-check` (hourly, first
run 2026-11-21 20:41:20 CST) relaunches the supervisor after a
VM replacement and removes itself on completion.**

- Training: `supervise35.sh` (mirror of supervise34.sh) launched
  detached via setsid/nohup. Trainer command: `train.py --data
  ~/workspace/run35/data.jsonl --out ~/workspace/run35/ckpt
  --preset small-copy-ind --steps 2500 --batch 32 --lr 3e-4
  --save-every 250 --allow-real --init
  ~/workspace/run34/ckpt/model.pt`. Verified live: train.log
  header (169,210 of 169,219 rows, max len 637, vocab 4000, copy
  rows 29,004), "warm start from
  /home/hatch/workspace/run34/ckpt/model.pt", 4,479,234 params,
  step 0 loss 0.0084. Expected wall-clock ≈3.7 h at Run 34's
  measured 5.3 s/step. Relaunches resume from
  `~/workspace/run35/ckpt/resume.pt`. Logs: `train.log`,
  `supervisor.log`, `supervisor-stdout.log` in this directory.
- Owner decision resolved: the owner directed Muse to proceed
  with the needed Nexus Isles / Nexus Intelligence work
  (2026-11-21 voice call); the chain config was Muse's stated
  recommendation. The nexus-30m from-scratch option (§4b) was
  NOT fired and remains available as a separate run.

- Mix: `~/workspace/run35/data.jsonl` — 169,219 rows, sha256
  `083700648ec8ab9f2e838d7f15b51c2dbff9585e115bd1d26196c908f4f9a7cb`
  (mix-report.json). Built per the Run 34 grade prescription:
  tranche 10 short-span max_stake (≤2dp, ≤5 chars, LAST in the call)
  + P(YES) probability convention with 1,200 mirrored YES/NO pairs,
  applied also as a transform to all 5,420 legacy t7/t8 propose
  rows (500 reduced-arg-set tranche-7 rows dropped, disclosed);
  held EXIT/HOLD at exact parity (900/900); isles35 trajectories
  (550 trajectories, verb switches to eat at satiety ≤3 ∧ inv ≥3;
  400 satiety-4/2 boundary pairs) replacing isles34; Gate B / SPEC
  rehearsal ring-fenced to Run 32 shares (36.43% / 6.04% vs Run
  32's 36.42% / 6.02%, Run 34's 30.63% / 4.44%); qa34 frozen at
  3,105 rows, no growth.
- Audit: `audit35.py` — **PASS** (audit35.log), full-field: 29,040
  propose calls (short + verbatim max_stake, ≤6-char numerics,
  field == rationale P(YES) on all); 13,200 assess/held comparisons
  all true; 550 trajectories transition-verified; shares and sha
  verified; pack v1.1 hash matches the frozen record.
- Training configs (prepared, NOT fired): (a) chain —
  small-copy-ind, init from Run 34 ckpt, 2,500 steps, batch 32,
  ≈3.7 h at Run 34's measured 5.3 s/step. (b) larger — nexus-30m
  (27,595,776 params, the trainer's largest preset), batch 8 (the
  probe-proven ceiling; 16/32 OOM'd), from scratch (no warm start:
  config mismatch, and no copy head), 2,500 steps ≈ 4.8 h at the
  probe's measured 6.88 s/step but only 20,000 samples seen;
  exposure-matched 10,000 steps ≈ 19.1 h.
- Next: owner's model-size call, then launch under a supervisor +
  hourly liveness check (the Run 33/34 pattern), then the full
  frozen grade. Run 25 remains seated until a run passes; the
  Nexus Isles launch gate does not clear on a build.

## STOPPED BY OWNER WORD — 2026-11-22 ~16:53 CST
Cristian ordered Run 35 stopped. Trainer and supervisor killed; run35-liveness-check cron disabled so nothing relaunches it. Final state: never progressed past resume step 250 (21+ resumes; VM replacements killed the trainer before every save point after the first). ckpt/resume.pt (step 250) preserved as-is. No grade will be run on Run 35. Superseded by the Run 36 implementation (five-phase method + gate order), which chains from Run 34's completed checkpoint.
