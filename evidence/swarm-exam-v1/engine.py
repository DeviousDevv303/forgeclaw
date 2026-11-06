#!/usr/bin/env python3
"""Deterministic replay engine — rebuilt to the combined-grade/composite/overlay
conventions and validated by the milestone-1 reproduce gate before any use.

Conventions (from the three grade reports):
- side bid close: YES -> yes_bid.close*100 ; NO -> 100 - yes_ask.close*100 (cents)
- in-life scan only: entry_ts < end_period_ts <= close_ts (post-close degenerate
  candle can never price an exit)
- a triggered exit prices at the triggering candle's close
- net = gross - actual entry fee - modeled exit fee; exit fee =
  ceil(0.07 * (px/100) * (1-px/100) * contracts * 100) cents; settlements fee-free
- (f) per step: peak update, then peak-exit test (armed at peak >= entry+2)
- (h) per step: stop test, peak update, peak-exit test (floor precedence)
"""
import json, math, os, datetime

W = os.path.dirname(os.path.abspath(__file__))

def exit_fee(px, contracts):
    return math.ceil(0.07 * (px / 100.0) * (1 - px / 100.0) * contracts * 100)

def side_closes(ticker, side, entry_ts, close_ts):
    cs = json.load(open(os.path.join(W, 'candles', ticker + '.json')))
    out = []
    for c in sorted(cs, key=lambda x: x['end_period_ts']):
        e = c['end_period_ts']
        if entry_ts < e <= close_ts:
            if side == 'yes':
                out.append((e, float(c['yes_bid']['close_dollars']) * 100))
            else:
                out.append((e, 100 - float(c['yes_ask']['close_dollars']) * 100))
    return out

def settle_gross(price, contracts, win):
    return contracts * (100 - price) if win else -contracts * price

def walk(closes, price, contracts, entry_fee, win, rule, G=5):
    """rule in {'g','d','f','h'} -> (gross, net, exit_px or None, exit_ts or None)"""
    peak = price
    for ts, px in closes:
        if rule in ('g', 'd', 'h') and px <= price - 10:
            g = contracts * (px - price)
            return g, g - entry_fee - exit_fee(px, contracts), px, ts
        if rule == 'd' and px >= price + 6:
            g = contracts * (px - price)
            return g, g - entry_fee - exit_fee(px, contracts), px, ts
        if rule in ('f', 'h'):
            peak = max(peak, px)
            if peak >= price + 2 and px <= peak - G:
                g = contracts * (px - price)
                return g, g - entry_fee - exit_fee(px, contracts), px, ts
    g = settle_gross(price, contracts, win)
    return g, g - entry_fee, None, None

def grade_position(ticker, side, price, contracts, entry_fee, entry_ts, close_ts, result):
    win = (result == side)
    closes = side_closes(ticker, side, entry_ts, close_ts)
    out = {'ticker': ticker, 'side': side, 'price': price, 'contracts': contracts,
           'entry_fee': entry_fee, 'entry_ts': entry_ts, 'result': result, 'win': win,
           'n_closes': len(closes)}
    hg = settle_gross(price, contracts, win)
    out['hold'] = {'gross': hg, 'net': hg - entry_fee}
    for rule, key, G in (('g', 'g', 5), ('d', 'd', 5), ('f', 'f3', 3), ('f', 'f5', 5), ('h', 'h5', 5)):
        g, n, px, ts = walk(closes, price, contracts, entry_fee, win, rule, G)
        out[key] = {'gross': g, 'net': n, 'exit_px': px, 'exit_ts': ts}
    return out

ANCHORS = {  # gross, net — milestone-1 reproduce gate
    'hold': (887.0, 771.4), 'f3': (549.4, 381.8), 'f5': (561.4, 395.8),
    'g': (623.0, 454.4), 'h5': (321.4, 114.8), 'd': (234.4, 13.8),
}

def main():
    crew = json.load(open(os.path.join(W, 'crew_entries_raw.json')))[:20]
    markets = json.load(open(os.path.join(W, 'markets_frozen.json')))
    positions = []
    for r in crew:
        avg_yes = r['avg_yes_price_micros'] / 10000.0
        price = avg_yes if r['side'] == 'yes' else 100 - avg_yes
        close_ts = int(datetime.datetime.fromisoformat(
            markets[r['ticker']]['close_time'].replace('Z', '+00:00')).timestamp())
        positions.append(grade_position(
            r['ticker'], r['side'], price, r['filled_hundredths'] / 100.0,
            r['fees_micros'] / 10000.0, r['created_at_ms'] / 1000.0, close_ts,
            markets[r['ticker']]['result']))
    fee_sum = sum(p['entry_fee'] for p in positions)
    print('entry fees sum: %.2f (expect 115.64)' % fee_sum)
    ok = True
    for key, (ag, an) in ANCHORS.items():
        g = sum(p[key]['gross'] for p in positions)
        n = sum(p[key]['net'] for p in positions)
        good = abs(g - ag) <= 0.15 and abs(n - an) <= 0.15
        ok &= good
        print('%-5s gross %9.2f (anchor %7.1f)  net %9.2f (anchor %7.1f)  %s'
              % (key, g, ag, n, an, 'OK' if good else 'MISMATCH'))
    fires = sorted(p['g']['exit_px'] for p in positions if p['g']['exit_px'] is not None)
    print('(g) fire prices:', fires, '(expect [0.0, 31.0, 41.0, 43.0, 49.0, 51.0, 54.0, 63.0])')
    json.dump(positions, open(os.path.join(W, 'frozen20_graded.json'), 'w'), indent=1)
    print('REPRODUCE GATE:', 'PASSED' if ok else 'FAILED')
    return 0 if ok else 1

if __name__ == '__main__':
    raise SystemExit(main())
