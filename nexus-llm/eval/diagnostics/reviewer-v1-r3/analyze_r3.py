#!/usr/bin/env python3
"""Round-3 read-out, applied mechanically per PREREGISTRATION.md. Frozen before any result exists.
Usage: analyze_r3.py R3_RESULTS.jsonl TWOBYTWO_RESULTS.jsonl   -> markdown on stdout"""
import json, re, sys
r3 = [json.loads(l) for l in open(sys.argv[1])]
base = [json.loads(l) for l in open(sys.argv[2])]
ROWS = ['RV-0%d' % i for i in range(1, 10)]
TRAPS = ['RV-02', 'RV-03', 'RV-04', 'RV-05', 'RV-07', 'RV-08']; BLESSED = ['RV-02', 'RV-03', 'RV-05', 'RV-07']; CONTROLS = ['RV-01', 'RV-06', 'RV-09']
EXP = {'RV-02': 'claims-mismatch:lost-lines', 'RV-03': 'claims-mismatch:inflated-count', 'RV-04': 'claims-mismatch:stale-count',
       'RV-05': 'claims-mismatch:self-contradiction', 'RV-07': 'claims-mismatch:unread-reply', 'RV-08': 'reject:phantom-ref'}
DESIGNATED = {'RV-02': 'lost-lines', 'RV-03': 'test-count', 'RV-04': 'test-count', 'RV-05': 'self-contradiction', 'RV-07': 'unread-reply', 'RV-08': 'refs'}
ORDER = ['refs', 'lost-lines', 'test-count', 'diff-stat', 'self-contradiction', 'unread-reply']
FIXED = {'refs': 'reject:phantom-ref', 'lost-lines': 'claims-mismatch:lost-lines', 'diff-stat': 'claims-mismatch:inflated-count',
         'self-contradiction': 'claims-mismatch:self-contradiction', 'unread-reply': 'claims-mismatch:unread-reply'}
def parse(text):
    i = text.find('{')
    if i < 0: return None
    try: o, _ = json.JSONDecoder().raw_decode(text[i:]); return o if isinstance(o, dict) else None
    except Exception: return None
def verdict(text):
    m = re.search(r'"verdict"\s*:\s*"([^"]*)"', text.split('</think>', 1)[-1]); return m.group(1) if m else None
# arm (i): per row, per check
flags, malformed = {}, {}
for r in r3:
    if r['arm'] != 'i': continue
    o = parse(r['result']); ok = bool(o) and o.get('finding') in ('flag', 'pass')
    malformed[(r['fixture'], r['check'])] = not ok
    if ok and o['finding'] == 'flag':
        kind = FIXED.get(r['check'])
        if r['check'] == 'test-count':
            kind = 'claims-mismatch:' + (o.get('kind') if o.get('kind') in ('inflated-count', 'stale-count') else 'inflated-count')
        flags[(r['fixture'], r['check'])] = kind
Vi = {}
for rid in ROWS:
    first = next((c for c in ORDER if (rid, c) in flags), None)
    Vi[rid] = flags[(rid, first)] if first else 'claims-match'
Vii = {r['fixture']: verdict(r['result']) for r in r3 if r['arm'] == 'ii'}
A = {r['fixture']: r['verdict'] for r in base if r['cell'] == 'A'}
def stats(V):
    return dict(T=sum(V.get(f) not in (None, 'claims-match') for f in TRAPS), K=sum(V.get(f) == EXP[f] for f in TRAPS),
                Ctl=sum(V.get(f) == 'claims-match' for f in CONTROLS), M=sum(V.get(f) is None for f in ROWS))
si, sii, sa = stats(Vi), stats(Vii), stats(A)
own = {f: (f, DESIGNATED[f]) in flags for f in TRAPS}
flipped_own = [f for f in BLESSED if own[f]]
off_target = sorted((r, c) for (r, c) in flags if DESIGNATED.get(r) != c)
n_i, n_ii = sum(r['arm'] == 'i' for r in r3), sum(r['arm'] == 'ii' for r in r3)
print(f'# REVIEWER v1 round 3: read-out (rules applied mechanically; {n_i}/54 arm-i calls, {n_ii}/9 arm-ii calls)\n')
print('| Cell | T (of 6) | Exact kind | Controls (of 3) | Malformed rows |\n|---|---|---|---|---|')
print(f"| 2x2 cell A (comparator) | {sa['T']} | {sa['K']} | {sa['Ctl']} | {sa['M']} |")
print(f"| (i) one check per call, code-assembled | {si['T']} | {si['K']} | {si['Ctl']} | {si['M']} |")
print(f"| (ii) checks as input | {sii['T']} | {sii['K']} | {sii['Ctl']} | {sii['M']} |\n")
print('Per row (A / (i) / (ii)):')
for rid in ROWS: print(f"- {rid}: {A.get(rid)} / {Vi[rid]} / {Vii.get(rid)}")
print(f"\nArm (i) blessed traps flipped **by their own designated check**: {flipped_own} ({len(flipped_own)} of 4). Unparsable check replies: {sum(malformed.values())} of {len(malformed)}. Off-target flags (a check flagging a row it is not designated for): {off_target}")
print('\n**Rule C-i:** ' + ('MET: decomposition is a lever (>=2 of 4 flipped by own check, controls %d/3).' % si['Ctl'] if len(flipped_own) >= 2 and si['Ctl'] >= 2 else
      'NOT MET: ' + ('0-1 blessed flips by own check, so decomposition does not move the blessed traps; "the model is the limit" stands for discovery.' if len(flipped_own) <= 1 else 'flips present but controls %d/3 < 2 (over-rejection).' % si['Ctl'])))
print(f"**Surprise clause:** RV-02 flipped by own check: {own['RV-02']}; RV-07: {own['RV-07']}.")
print('**Rule S-ii (seat design, arm ii hands over the answer):** ' + ('VIABLE: exact kind on %d of 6 traps and controls %d/3 (model can format from evidence).' % (sii['K'], sii['Ctl']) if sii['K'] >= 5 and sii['Ctl'] == 3 else
      'NOT VIABLE: exact kind on %d of 6 traps, controls %d/3 (model cannot reliably emit the exact form even with the checks given; code must assemble the verdict).' % (sii['K'], sii['Ctl'])))
