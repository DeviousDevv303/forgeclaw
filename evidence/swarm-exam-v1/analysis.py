#!/usr/bin/env python3
"""Regime-gating milestone 2 — grading + features + buckets + interventions.
Definitions frozen in FROZEN below (mirrored verbatim into the report).
Reads only the cached pulls in this dir; writes results.json."""
import json, math, os, statistics, datetime
from zoneinfo import ZoneInfo

W = os.path.dirname(os.path.abspath(__file__))
CST = ZoneInfo('America/Chicago'); ET = ZoneInfo('America/New_York')

FROZEN = {
 'era_split': 'entry time in America/Chicago: tune = Oct 28-31 2026, validation = Nov 1-4 2026',
 'vol60': 'sample stdev (n-1) of the 60 Binance BTCUSDT 1-min log returns whose intervals end in (t-3600s, t]; buckets = terciles of vol60 sampled at every minute mark of the tuning era (Oct 28 00:00 CST <= t < Nov 1 00:00 CST)',
 'chop': 'sign changes of (Binance 1-min close - K) over closes in (t-3600s, t], seeded by the last close <= t-3600s; a close exactly at K inherits the previous sign; K = entry window strike in dollars; buckets 0 / 1-2 / >=3',
 'chop_first_half': 'same count over closes in (window_start, window_start+450s], seeded by the last close <= window_start; timing-labeled: causal only at a hypothetical mid-window decision; reported, never intervention-priced',
 'momentum': 'entry-tick lean conflict iff momentumShort * momentumLong < 0 (strict); zero on either side counts as agreement; buckets agree / disagree',
 'distance': '|d0| buckets [0,6) sub-floor / [6,8) / [8,11) / [11,inf); d0 recomputed from the entry tick spot/strike (fills) or the journal row recorded distance_bps (shadow)',
 'tod': 'ET hour of entry in blocks 00-05 / 06-11 / 12-17 / 18-23; report only',
 'hostile': 'per feature per population: the bucket with the lowest tune-split (g) net mean (shadow designation requires tune n>=10; frozen-20 designation uses n>=1 and is labeled degenerate), and only if that mean is negative; otherwise the feature yields no gate candidate',
 'works': 'hostile bucket negative-mean on tune AND validation, pooled friendly buckets non-negative mean on validation, and stand-down validation improvement (saved losses - forgone wins) strictly greater than the forgone wins',
 'half_size': '(g) replay recomputed with contracts/2 (fractional allowed in the model); entry fee halved on the same proportion; exit fee formula evaluated at contracts/2',
}

# ---------------- shared series ----------------
BIN = {int(k): v for k, v in json.load(open(os.path.join(W, 'binance.json'))).items()}
# price points: (close_time_s, close) where close_time = open+60
POINTS = sorted((ts + 60, px) for ts, px in BIN.items())
PTIMES = [p[0] for p in POINTS]

import bisect
def closes_ending(lo_excl, hi_incl):
    i = bisect.bisect_right(PTIMES, lo_excl); j = bisect.bisect_right(PTIMES, hi_incl)
    return POINTS[i:j]
def last_close_at_or_before(t):
    i = bisect.bisect_right(PTIMES, t)
    return POINTS[i - 1] if i > 0 else None

def log_returns_ending(lo_excl, hi_incl):
    pts = closes_ending(lo_excl - 60, hi_incl)  # include the base point at/before lo
    rs = []
    for (t0, p0), (t1, p1) in zip(pts, pts[1:]):
        if t1 > lo_excl and p0 > 0 and p1 > 0:
            rs.append(math.log(p1 / p0))
    return rs

def vol60(t):
    rs = log_returns_ending(t - 3600, t)
    if len(rs) < 30: return None, len(rs)
    return statistics.stdev(rs), len(rs)

def crossings(lo_excl, hi_incl, K, seed_t):
    seed = last_close_at_or_before(seed_t)
    pts = closes_ending(lo_excl, hi_incl)
    if seed is None or not pts: return None
    signs = []
    last = 0
    for _, px in [seed] + pts:
        s = 1 if px > K else (-1 if px < K else last)
        if s != 0: last = s
        signs.append(last)
    return sum(1 for a, b in zip(signs, signs[1:]) if a != b and a != 0 and b != 0)

MONTHS = {'JAN':1,'FEB':2,'MAR':3,'APR':4,'MAY':5,'JUN':6,'JUL':7,'AUG':8,'SEP':9,'OCT':10,'NOV':11,'DEC':12}
def window_times(ticker):
    part = ticker.split('-')[1]
    end = datetime.datetime(2000 + int(part[0:2]), MONTHS[part[2:5]], int(part[5:7]),
                            int(part[7:9]), int(part[9:11]), tzinfo=ET)
    return int((end - datetime.timedelta(minutes=15)).timestamp()), int(end.timestamp())

def era_of(ms):
    d = datetime.datetime.fromtimestamp(ms / 1000, CST)
    if d.month == 10 and 28 <= d.day <= 31: return 'tune'
    if d.month == 11 and 1 <= d.day <= 4: return 'val'
    return None

# vol terciles from the tuning era minute marks (frozen before validation reads)
t0 = int(datetime.datetime(2026,10,28,0,0,tzinfo=CST).timestamp())
t1 = int(datetime.datetime(2026,11,1,0,0,tzinfo=CST).timestamp())
era_vols = []
tt = t0
while tt < t1:
    v, n = vol60(tt)
    if v is not None: era_vols.append(v)
    tt += 60
era_vols.sort()
def pctile(sorted_xs, q):
    if not sorted_xs: return None
    pos = q * (len(sorted_xs) - 1); lo = int(math.floor(pos)); hi = int(math.ceil(pos))
    if lo == hi: return sorted_xs[lo]
    return sorted_xs[lo] + (sorted_xs[hi] - sorted_xs[lo]) * (pos - lo)
VOL_Q1, VOL_Q2 = pctile(era_vols, 1/3), pctile(era_vols, 2/3)

def vol_bucket(v):
    if v is None: return None
    return 'low' if v < VOL_Q1 else ('mid' if v < VOL_Q2 else 'high')
def chop_bucket(c):
    if c is None: return None
    return '0' if c == 0 else ('1-2' if c <= 2 else '>=3')
def dist_bucket(d):
    a = abs(d)
    return '[0,6)' if a < 6 else ('[6,8)' if a < 8 else ('[8,11)' if a < 11 else '[11,inf)'))
def tod_bucket(ms):
    h = datetime.datetime.fromtimestamp(ms / 1000, ET).hour
    return '00-05' if h < 6 else ('06-11' if h < 12 else ('12-17' if h < 18 else '18-23'))

def features_for(t_s, ticker, K_dollars, d0, ms_mom, ml_mom):
    v, nv = vol60(int(t_s))
    ws, we = window_times(ticker)
    if K_dollars is None:
        ch = chf = None
    else:
        ch = chop_bucket(crossings(int(t_s) - 3600, int(t_s), K_dollars, int(t_s) - 3600))
        chf = chop_bucket(crossings(ws, ws + 450, K_dollars, ws))
    return {
        'vol': vol_bucket(v), 'vol_raw': v, 'vol_n': nv,
        'chop': ch,
        'chop_fh': chf,
        'momentum': ('disagree' if (ms_mom is not None and ml_mom is not None and ms_mom * ml_mom < 0)
                     else ('agree' if ms_mom is not None and ml_mom is not None else None)),
        'distance': dist_bucket(d0) if d0 is not None else None,
        'tod': tod_bucket(int(t_s * 1000)),
    }

# ---------------- engine reuse ----------------
import importlib.util
espec = importlib.util.spec_from_file_location('engine', os.path.join(W, 'engine.py'))
engine = importlib.util.module_from_spec(espec); espec.loader.exec_module(engine)

def g_replay(ticker, side, price, contracts, entry_fee, entry_ts, close_ts, win, scale=1.0):
    c = contracts * scale
    closes = engine.side_closes(ticker, side, entry_ts, close_ts)
    g, n, px, ts = engine.walk(closes, price, c, entry_fee * scale, win, 'g', 5)
    return g, n, px

# ---------------- frozen 20 ----------------
frozen = json.load(open(os.path.join(W, 'frozen20_graded.json')))
crew = json.load(open(os.path.join(W, 'crew_entries_raw.json')))[:20]
def nearest_eval_tick(ticker, ms_target):
    """Nearest evaluation tick (spot/strike present) in the ticker's series —
    the milestone-1 prep.py convention (max gap 3.4s on this population)."""
    p = os.path.join(W, 'decisions_shadow', ticker + '.json')
    if not os.path.exists(p): return None, None
    best, best_gap = None, None
    for tr in json.load(open(p)):
        try: f = json.loads(tr['features_json'])
        except Exception: continue
        if not f.get('spotCents') or not f.get('strikeCents'): continue
        gap = abs(tr['at_ms'] - ms_target)
        if best_gap is None or gap < best_gap: best, best_gap = (tr, f), gap
    return best, best_gap
F20 = []
_markets = json.load(open(os.path.join(W, 'markets_frozen.json')))
for pos, r in zip(frozen, crew):
    tick, gap = nearest_eval_tick(r['ticker'], r['created_at_ms'])
    d0 = ms = ml = K = None
    if tick and gap is not None and gap <= 60000:
        tr, f = tick
        spot_c = f.get('spotCents'); strike_c = f.get('strikeCents')
        K = strike_c / 100.0
        d0 = (spot_c - strike_c) / strike_c * 10000.0  # bps, combined-grade formula
        lean = f.get('lean') or {}
        ms = lean.get('momentumShort'); ml = lean.get('momentumLong')
    t_s = r['created_at_ms'] / 1000.0
    close_ts = int(datetime.datetime.fromisoformat(
        _markets[pos['ticker']]['close_time'].replace('Z', '+00:00')).timestamp())
    gh, nh, _ = g_replay(pos['ticker'], pos['side'], pos['price'], pos['contracts'],
                         pos['entry_fee'], t_s, close_ts, pos['win'], scale=0.5)
    feats = features_for(t_s, pos['ticker'], K, d0, ms, ml)
    F20.append({'pop': 'frozen20', 'ticker': pos['ticker'], 'side': pos['side'],
                'era': era_of(r['created_at_ms']), 'net_g': pos['g']['net'],
                'net_g_half': nh, 'features': feats, 'd0': d0, 'price': pos['price'],
                'contracts': pos['contracts']})

# ---------------- shadow population ----------------
lo_ms = int(datetime.datetime(2026,10,28,0,0,tzinfo=CST).timestamp()*1000)
hi_ms = int(datetime.datetime(2026,11,5,0,0,tzinfo=CST).timestamp()*1000)
shadow_rows = [r for r in json.load(open(os.path.join(W, 'shadow_rows.json')))
               if lo_ms <= r['at_ms'] < hi_ms and r['result'] is not None and r['gross_cents'] is not None]
SH = []
audit = {'rows': len(shadow_rows), 'arm_found': 0, 'identity_fail': 0, 'no_candles': 0}
for r in shadow_rows:
    tdir = os.path.join(W, 'decisions_shadow', r['ticker'] + '.json')
    arm = None
    if os.path.exists(tdir):
        for tr in json.load(open(tdir)):
            if tr['at_ms'] == r['at_ms'] and '"spotCents"' in tr['features_json']: arm = tr; break
    if arm is None: continue
    audit['arm_found'] += 1
    c = float(r['contracts']); side = r['side']; win = (r['result'] == side)
    gross = float(r['gross_cents'])
    p = (100 - gross / c) if win else (-gross / c)
    resid = abs((c * (100 - p) if win else -c * p) - gross)
    if abs(float(r['net_cents']) - (gross - float(r['fee_estimate_cents']))) > 0.51 or resid > 1.0:
        audit['identity_fail'] += 1; continue
    ws, we = window_times(r['ticker'])
    if not os.path.exists(os.path.join(W, 'candles', r['ticker'] + '.json')):
        audit['no_candles'] += 1; continue
    fee = float(r['fee_estimate_cents'])
    g, n, px = g_replay(r['ticker'], side, p, c, fee, r['at_ms'] / 1000.0, we, win)
    gh, nh, _ = g_replay(r['ticker'], side, p, c, fee, r['at_ms'] / 1000.0, we, win, scale=0.5)
    f = json.loads(arm['features_json']); lean = f.get('lean') or {}
    feats = features_for(r['at_ms'] / 1000.0, r['ticker'], r['strike_cents'] / 100.0,
                         float(r['distance_bps']), lean.get('momentumShort'), lean.get('momentumLong'))
    SH.append({'pop': 'shadow', 'ticker': r['ticker'], 'side': side, 'variant': r['variant'],
               'era': era_of(r['at_ms']), 'net_g': n, 'net_g_half': nh,
               'journal_net': float(r['net_cents']), 'features': feats,
               'd0': float(r['distance_bps']), 'price': p, 'contracts': c})
print('shadow audit:', audit, '| graded under (g):', len(SH))

# ---------------- aggregation ----------------
def stats(nets):
    if not nets: return {'n': 0, 'mean': None, 'p5': None, 'sum': 0.0}
    s = sorted(nets)
    return {'n': len(nets), 'mean': sum(nets) / len(nets), 'p5': pctile(s, 0.05), 'sum': sum(nets)}

FEATURES = ['vol', 'chop', 'momentum', 'distance', 'chop_fh', 'tod']
def bucket_table(rows, feat):
    out = {}
    for split in ('tune', 'val'):
        sub = {}
        buckets = sorted({r['features'][feat] for r in rows if r['features'][feat] is not None})
        for b in buckets:
            nets = [r['net_g'] for r in rows if r['era'] == split and r['features'][feat] == b]
            sub[b] = stats(nets)
        alln = [r['net_g'] for r in rows if r['era'] == split and r['features'][feat] is not None]
        sub['__all__'] = stats(alln)
        sub['__missing__'] = len([r for r in rows if r['era'] == split and r['features'][feat] is None])
        out[split] = sub
    return out

def designate(rows, feat, min_n):
    tune = bucket_table(rows, feat)['tune']
    cand = [(b, s) for b, s in tune.items() if not b.startswith('__') and s['n'] >= min_n and s['mean'] is not None]
    if not cand: return None
    b, s = min(cand, key=lambda x: x[1]['mean'])
    return b if s['mean'] < 0 else None

def interventions(rows, feat, hostile):
    val = [r for r in rows if r['era'] == 'val' and r['features'][feat] is not None]
    H = [r for r in val if r['features'][feat] == hostile]
    F = [r for r in val if r['features'][feat] != hostile]
    saved = -sum(r['net_g'] for r in H if r['net_g'] < 0)
    forgone = sum(r['net_g'] for r in H if r['net_g'] > 0)
    base = sum(r['net_g'] for r in val)
    sd_net = sum(r['net_g'] for r in F)
    hs_net = sum(r['net_g'] for r in F) + sum(r['net_g_half'] for r in H)
    return {'hostile': hostile, 'val_n': len(val), 'hostile_n': len(H), 'friendly_n': len(F),
            'base_net': base, 'standdown_net': sd_net, 'standdown_delta': sd_net - base,
            'saved_losses': saved, 'forgone_wins': forgone,
            'halfsize_net': hs_net, 'halfsize_delta': hs_net - base,
            'hostile_val_mean': (sum(r['net_g'] for r in H) / len(H)) if H else None,
            'friendly_val_mean': (sum(r['net_g'] for r in F) / len(F)) if F else None,
            'hostile_tune_mean': None}

RESULT = {'frozen_defs': FROZEN, 'vol_terciles': {'q1': VOL_Q1, 'q2': VOL_Q2, 'era_minutes': len(era_vols)},
          'shadow_audit': audit, 'populations': {}}
for pop_name, rows in (('frozen20', F20), ('shadow', SH)):
    RESULT.setdefault('coverage', {})[pop_name] = {
        f: len([r for r in rows if r['features'][f] is not None]) for f in FEATURES}
for pop_name, rows, min_n in (('frozen20', F20, 1), ('shadow', SH, 10)):
    tables = {f: bucket_table(rows, f) for f in FEATURES}
    inters = {}
    for f in ('vol', 'chop', 'momentum', 'distance'):
        h = designate(rows, f, min_n)
        if h is not None:
            iv = interventions(rows, f, h)
            iv['hostile_tune_mean'] = tables[f]['tune'][h]['mean']
            inters[f] = iv
    RESULT['populations'][pop_name] = {'n': len(rows),
        'tune_n': len([r for r in rows if r['era'] == 'tune']),
        'val_n': len([r for r in rows if r['era'] == 'val']),
        'tables': tables, 'interventions': inters}
# cross-application: shadow-designated hostile buckets onto frozen-20 validation
cross = {}
for f in ('vol', 'chop', 'momentum', 'distance'):
    h = designate(SH, f, 10)
    if h is not None: cross[f] = interventions(F20, f, h)
RESULT['cross_shadow_gate_on_frozen20'] = cross
json.dump(RESULT, open(os.path.join(W, 'results.json'), 'w'), indent=1)
json.dump({'frozen20': F20, 'shadow': SH}, open(os.path.join(W, 'graded_with_features.json'), 'w'), indent=1)
print('vol terciles: q1=%.6g q2=%.6g (era minutes %d)' % (VOL_Q1, VOL_Q2, len(era_vols)))
print('frozen20 rows:', len(F20), '| tune', RESULT['populations']['frozen20']['tune_n'], '| val', RESULT['populations']['frozen20']['val_n'])
print('shadow rows:', len(SH), '| tune', RESULT['populations']['shadow']['tune_n'], '| val', RESULT['populations']['shadow']['val_n'])
print('ANALYSIS DONE')
