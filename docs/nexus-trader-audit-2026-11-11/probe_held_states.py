"""Held-position probe on REAL journal states (read-only D1 SELECTs via the Cloudflare API).

Needs torch + sentencepiece, CF_ACCOUNT_ID / CF_D1_DATABASE_ID, and a Cloudflare credential for the D1 query API. Reads numeric
fields only; writes nothing. 2026-11-11 audit results are in README.md.
"""
import sys, json, subprocess, re, collections
import os, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _desk_probe_helpers import *
A=os.environ["CF_ACCOUNT_ID"]; D=os.environ["CF_D1_DATABASE_ID"]   # nexus-bank-ledger; the Cloudflare credential comes from the environment/proxy, never from this file
def q(sql,params=None):
    out=subprocess.run(["curl","-s","-m","180","-X","POST",f"https://api.cloudflare.com/client/v4/accounts/{A}/d1/database/{D}/query","-H","Content-Type: application/json","-d",json.dumps({"sql":sql,"params":params or []})],capture_output=True,text=True).stdout
    d=json.loads(out); assert d.get('success'),d.get('errors'); return d['result'][0]['results']
# numeric fields only; every ~Nth held tick from the last ~3 days; both observer-hold and stop-held reasons
rows=q("""SELECT at_ms, reason, json_extract(features_json,'$.position.side') AS side, json_extract(features_json,'$.position.blendedEntryCents') AS entry,
 json_extract(features_json,'$.rolling.distanceBps') AS dist, json_extract(features_json,'$.book.yb') AS yb, json_extract(features_json,'$.book.ya') AS ya,
 json_extract(features_json,'$.book.nb') AS nb, json_extract(features_json,'$.book.na') AS na, json_extract(features_json,'$.sr') AS sr
 FROM decisions WHERE at_ms > ? AND action='observer-hold' AND json_extract(features_json,'$.pos_held')=1
 AND json_extract(features_json,'$.book.yb') IS NOT NULL AND json_extract(features_json,'$.book.nb') IS NOT NULL AND json_extract(features_json,'$.rolling.distanceBps') IS NOT NULL
 AND (rowid % 37 = 0 OR reason='stop-below-entry-held' AND rowid % 11 = 0) ORDER BY at_ms DESC LIMIT 160""",[1793800000000])
print('real held states sampled:',len(rows),'| stop-held:',sum(1 for r in rows if r['reason']=='stop-below-entry-held'))
T="KXBTC15M-26NOV102315-15"
def live_for(r):
    now=1_000_000_000
    side=r['side']; entry=float(r['entry'])
    yes_entry = entry if side=='yes' else 100-entry
    return {"now":now,"window":{"ticker":T,"strikeUsd":95000,"closeTimeMs":now+(r['sr'] or 300)*1000,"startedAtMs":now-100_000,"samples":[]},
      "snapshot":{"distanceBps":float(r['dist']),"yesBidCents":r['yb'],"yesAskCents":r['ya'],"noBidCents":r['nb'],"noAskCents":r['na']},
      "intents":[{"side":side,"filled_hundredths":100,"avg_yes_price_micros":int(yes_entry*1e4),"purpose":"entry","created_at_ms":now-90_000,"intent_id":"x"}]}
res=collections.Counter(); below_entry_exit=0; exit_states=[]; n=0
for r in rows:
    live=live_for(r); obs={"status":{"equityCents":428,"killed":False},"live":live,"history":[],"record":{}}
    obs["fair"]=ta.fair_value(live) or {"p_yes":0.5,"left_s":300,"sigma_1m_bps":6,"sigma_measured":False}; obs["edges"]=ta.edges(obs["fair"],live["snapshot"])
    pos=ta.position_fact(live)
    task,_=ta.build_nexus_task(obs,count=nx.count)
    out=nx.generate(task,max_new=min(160,nx.ctx_limit-nx.count(task)-2))
    dec=ta.parse_nexus_transcript(out,obs,0.5)      # raw model decision BEFORE apply_discipline
    own_bid = r['yb'] if pos['side']=='yes' else r['nb']
    kind=('funds_propose' if '"name":"funds_propose"' in out else 'other_tool' if '<|call|>' in out else 'direct')
    act=dec['action']
    res[(kind,act)]+=1; n+=1
    if act=='exit':
        exit_states.append((own_bid,pos['avg_cents'],r['dist']))
        if own_bid < pos['avg_cents']: below_entry_exit+=1
print('n =',n)
for k,v in sorted(res.items()): print('  model kind/decision',k,v)
print('RAW EXITs proposed:',len(exit_states),'| EXITs proposed BELOW entry (bid < blended entry):',below_entry_exit)
print('exit states (own bid, entry, dist):',exit_states[:10])
print('share of held states where bid < entry:', round(sum(1 for r in rows if (r['yb'] if r['side']=='yes' else r['nb']) < float(r['entry']))/len(rows),2))
