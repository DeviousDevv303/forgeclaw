#!/usr/bin/env python3
"""Gate A reproduction — recompute the GATE-A-AUDIT.md counts from the raw files.
Definitions follow the audit report's header exactly. Every count prints with
its denominator. Inputs:
  mix      ~/workspace/run31/data.jsonl            (91,989 rows)
  tranche6 ~/workspace/run31-campaign/data/desk-live-form-tranche6.jsonl (7,000)
  manifest ~/workspace/run31-campaign/data/build-manifest.json (pair linkage)
"""
import json, re, sys, collections, pathlib

HOME = pathlib.Path.home()
MIX = HOME / 'workspace/run31/data.jsonl'
T6 = HOME / 'workspace/run31-campaign/data/desk-live-form-tranche6.jsonl'
MAN = HOME / 'workspace/run31-campaign/data/build-manifest.json'

DESK = {'propose', 'propose_fee', 'desk_pass', 'assess_exit', 'assess_hold'}
ENTRY = {'propose', 'propose_fee', 'desk_pass'}

re_dist = re.compile(r'BTC is ([+-]?[0-9.]+) bps')
re_edge = re.compile(r'edge ([+-]?[0-9.]+)c')
re_pyes = re.compile(r'P\(YES\)\s*([0-9.]+)')
re_vsask = re.compile(r'vs (yes|no) ask ([0-9.]+)c')
re_book = re.compile(r'YES ([0-9.]+)/([0-9.]+)c')
re_ticker = re.compile(r'on (\S+?):')
re_noask = re.compile(r'NO ask ([0-9.]+)c')
re_yesask_is = re.compile(r'YES ask is ([0-9.]+)c')

def load(p):
    return [json.loads(l) for l in open(p)]

def first_recog(text):
    """Position of the first recognition element in a completion, or None."""
    cands = []
    for pat in ('P(YES)', 'P(NO)', '"probability"'):
        i = text.find(pat)
        if i >= 0:
            cands.append(i)
    return min(cands) if cands else None

def has_recog(text):
    return ('P(YES)' in text) or ('P(NO)' in text) or ('"probability"' in text)

def stated_p(text):
    m = re_pyes.search(text)
    if m:
        return float(m.group(1))
    m = re.search(r'"probability":\s*([0-9.]+)', text)
    return float(m.group(1)) if m else None

def stated_edge(text):
    m = re_edge.search(text)
    return float(m.group(1)) if m else None

def stated_side_ask(text, prompt):
    """The row's own stated ask for its aligned side, per the audit's corrected
    measure (never the derived complement). Returns (side, ask) or (None, None)."""
    m = re_vsask.search(text)
    if m:
        return m.group(1), float(m.group(2))
    m = re_noask.search(text)
    if m:
        return 'no', float(m.group(1))
    m = re.search(r'(YES|NO) ask is ([0-9.]+)c', text)
    if m:
        return m.group(1).lower(), float(m.group(2))
    m = re.search(r'(YES|NO) ask ([0-9.]+)c', text)
    if m:
        return m.group(1).lower(), float(m.group(2))
    return None, None

def side_of(text):
    m = re.search(r'"side":\s*"(yes|no)"', text)
    return m.group(1) if m else None

def ordering(rows, label):
    desk = [r for r in rows if r['kind'] in DESK]
    entry = [r for r in rows if r['kind'] in ENTRY]
    print(f'== {label}: desk rows {len(desk)}, entry rows {len(entry)}')
    # route token precedes first recognition element
    n = d = 0
    for r in desk:
        t = r['text']
        ri = t.find('<|route:')
        if ri < 0:
            continue
        fr = first_recog(t)
        if fr is None:
            continue
        d += 1
        if ri < fr:
            n += 1
    print(f'  route token precedes first recognition element: {n}/{d}')
    # funds_propose call name precedes first recognition element
    n = d = 0
    for r in desk:
        t = r['text']
        ci = t.find('funds_propose')
        if ci < 0:
            continue
        fr = first_recog(t)
        d += 1
        if fr is not None and ci < fr:
            n += 1
    print(f'  funds_propose precedes first recognition element: {n}/{d}')
    # key order inside propose calls
    pfirst = sfirst = tot = 0
    for r in desk:
        t = r['text']
        if 'funds_propose' not in t:
            continue
        pi, si = t.find('"probability"'), t.find('"side"')
        if pi < 0 or si < 0:
            continue
        tot += 1
        if pi < si:
            pfirst += 1
        else:
            sfirst += 1
    print(f'  key order "probability" before "side": {pfirst}/{tot}; "side" first: {sfirst}/{tot}')
    # desk_pass: P(YES) precedes "No trade"
    n = d = 0
    for r in desk:
        if r['kind'] != 'desk_pass':
            continue
        t = r['text']
        pi, ni = t.find('P(YES)'), t.find('No trade')
        if pi < 0 or ni < 0:
            continue
        d += 1
        if pi < ni:
            n += 1
    print(f'  desk_pass P(YES) precedes "No trade": {n}/{d}')
    # assess_hold: action word precedes P(YES)
    n = d = 0
    for r in desk:
        if r['kind'] != 'assess_hold':
            continue
        t = r['text']
        pi = t.find('P(YES)')
        ai = min([i for i in (t.find('EXIT'), t.find('HOLD')) if i >= 0], default=-1)
        if pi < 0 or ai < 0:
            continue
        d += 1
        if ai < pi:
            n += 1
    print(f'  assess_hold action word precedes P(YES): {n}/{d}')
    ae = [r for r in desk if r['kind'] == 'assess_exit']
    ae_sig = sum(1 for r in ae if has_recog(r['text']))
    print(f'  assess_exit rows carrying any probability signal: {ae_sig}/{len(ae)}')
    sig = sum(1 for r in desk if has_recog(r['text']))
    print(f'  desk rows carrying an explicit recognition signal: {sig}/{len(desk)}')
    # entry prompts carry recognition inputs (distance + book in prompt)
    ok = 0
    for r in entry:
        if re_dist.search(r['prompt']) and re_book.search(r['prompt']):
            ok += 1
    print(f'  entry prompts stating distance+book: {ok}/{len(entry)}')

def marginals(rows, label):
    desk = [r for r in rows if r['kind'] in DESK]
    entry = [r for r in rows if r['kind'] in ENTRY]
    ent = sum(1 for r in entry if r['kind'] in ('propose', 'propose_fee'))
    pas = sum(1 for r in entry if r['kind'] == 'desk_pass')
    ax = sum(1 for r in desk if r['kind'] == 'assess_exit')
    ah = sum(1 for r in desk if r['kind'] == 'assess_hold')
    print(f'== {label} marginals: desk {len(desk)}; entry {len(entry)} = entries {ent} + passes {pas}; assess EXIT {ax} / HOLD {ah}')

def bands(rows, label):
    entry = [r for r in rows if r['kind'] in ENTRY]
    dec_all = []
    dec = []
    for r in entry:
        m = re_dist.search(r['prompt'])
        if not m:
            continue
        d = float(m.group(1))
        if abs(d) < 3:
            continue
        dec_all.append((r, d))
        e = stated_edge(r['text'])
        if e is None:
            continue
        dec.append((r, d, e))
    print(f'== {label} decisive entry rows (|d|>=3): {len(dec_all)}; with stated edge: {len(dec)}')
    def band(e):
        if e >= 1.5: return '>=+1.5c'
        if e >= 0.5: return '[+0.5,+1.5)c'
        if e >= 0.0: return '[0,+0.5)c'
        if e >= -3.0: return '[-3,0)c'
        return '<-3c'
    tab = collections.defaultdict(collections.Counter)
    for r, d, e in dec:
        tab[band(e)][r['kind']] += 1
    for b in ['>=+1.5c', '[+0.5,+1.5)c', '[0,+0.5)c', '[-3,0)c', '<-3c']:
        c = tab.get(b, {})
        tot = sum(c.values())
        if tot:
            print(f'  edge {b}: {tot} rows -> ' + ', '.join(f'{k} {v}' for k, v in sorted(c.items())))
    # cap band over ALL decisive rows: stated aligned ask > 85c
    cap = [(r, d) for r, d in dec_all if (stated_side_ask(r['text'], r['prompt'])[1] or 0) > 85]
    capp = sum(1 for r, d in cap if r['kind'] == 'desk_pass')
    print(f'  cap band (stated aligned ask >85c): {len(cap)} rows -> desk_pass {capp}, other {len(cap)-capp}')

def leak(rows, label):
    """NO-side / YES-side stated ask vs the prompt-derivable ask (audit 3.3)."""
    yes_bad = yes_tot = no_bad = no_tot = 0
    maxdiff = 0.0
    for r in rows:
        if r['kind'] not in ('propose', 'propose_fee'):
            continue
        side, ask = stated_side_ask(r['text'], r['prompt'])
        if side is None:
            continue
        bm = re_book.search(r['prompt'])
        if not bm:
            continue
        ybid, yask = float(bm.group(1)), float(bm.group(2))
        if side == 'yes':
            yes_tot += 1
            if abs(ask - yask) > 0.15:
                yes_bad += 1
        else:
            no_tot += 1
            derivable = 100.0 - ybid
            if abs(ask - derivable) > 0.15:
                no_bad += 1
                maxdiff = max(maxdiff, abs(ask - derivable))
    print(f'== {label} ask leak: YES-side stated != printed: {yes_bad}/{yes_tot}; NO-side stated != derivable complement: {no_bad}/{no_tot} (max diff {maxdiff:.1f}c)')

def pairs(t6rows):
    man = json.loads(MAN.read_text())
    facts = man['facts']
    byid = {r['id']: r for r in t6rows}
    pairmap = collections.defaultdict(list)
    for rid, f in facts.items():
        p = f.get('pair')
        if p:
            pairmap[p].append(rid)
    print(f'== tranche-6 pairs: {len(pairmap)} pairs; pair halves {sum(len(v) for v in pairmap.values())}')
    fam = collections.Counter(p[0] for p in pairmap)
    print('  family census: ' + ', '.join(f'{k}* {v}' for k, v in sorted(fam.items())))
    flips = collections.Counter(); ftot = collections.Counter()
    recog_only = 0
    for p, ids in sorted(pairmap.items()):
        if len(ids) != 2:
            continue
        a, b = byid[ids[0]], byid[ids[1]]
        fam0 = p[0]
        ka, kb = a['kind'], b['kind']
        if fam0 in ('c', 'e'):
            ftot[fam0] += 1
            if {ka, kb} == {'desk_pass'} or (('propose' in (ka, kb) or 'propose_fee' in (ka, kb)) and 'desk_pass' in (ka, kb)):
                flips[fam0] += 1
        if fam0 == 'a':
            ftot['a'] += 1
            if {ka, kb} == {'assess_exit', 'assess_hold'}:
                flips['a'] += 1
        if fam0 == 's':
            ftot['s'] += 1
            if side_of(a['text']) and side_of(b['text']) and side_of(a['text']) != side_of(b['text']):
                flips['s'] += 1
        if fam0 == 'n':
            ftot['n'] += 1
            if ka == kb == 'desk_pass':
                flips['n'] += 1
        # recognition-only variation: identical prompts (same state+book) but different stated P
        if a['prompt'] == b['prompt']:
            pa, pb = stated_p(a['text']), stated_p(b['text'])
            if pa is not None and pb is not None and abs(pa - pb) > 0.005:
                recog_only += 1
    for k in ('c', 'e', 'a', 's', 'n'):
        print(f'  family {k}*: designed-flip verified {flips[k]}/{ftot[k]}')
    print(f'  pairs varying ONLY the recognition signal (identical prompt, different stated P): {recog_only}/{len(pairmap)}')

def main():
    t6 = load(T6)
    mix = load(MIX)
    print(f'loaded tranche6={len(t6)} rows, mix={len(mix)} rows')
    ordering(t6, 'tranche 6')
    ordering(mix, 'full mix')
    marginals(t6, 'tranche 6')
    marginals(mix, 'full mix')
    bands(t6, 'tranche 6')
    bands(mix, 'full mix')
    leak(t6, 'tranche 6')
    pairs(t6)

if __name__ == '__main__':
    main()
