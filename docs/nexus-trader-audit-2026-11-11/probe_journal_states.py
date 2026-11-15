"""Entry probe on REAL flat journal states, through parse_nexus_transcript + apply_discipline.

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
rows=q("""SELECT json_extract(features_json,'$.rolling.distanceBps') AS dist, json_extract(features_json,'$.book.yb') AS yb, json_extract(features_json,'$.book.ya') AS ya,
 json_extract(features_json,'$.book.nb') AS nb, json_extract(features_json,'$.book.na') AS na, json_extract(features_json,'$.sr') AS sr
 FROM decisions WHERE at_ms > ? AND action='observer-hold' AND json_extract(features_json,'$.pos_held')=0
 AND json_extract(features_json,'$.book.yb') IS NOT NULL AND json_extract(features_json,'$.book.ya') IS NOT NULL AND json_extract(features_json,'$.book.nb') IS NOT NULL AND json_extract(features_json,'$.book.na') IS NOT NULL
 AND json_extract(features_json,'$.rolling.distanceBps') IS NOT NULL AND json_extract(features_json,'$.sr') > 60 AND rowid % 53 = 0 ORDER BY at_ms DESC LIMIT 200""",[1793800000000])
print('real FLAT states:',len(rows))
T="KXBTC15M-26NOV102315-15"
by=collections.defaultdict(collections.Counter); tot=collections.Counter(); samples=[]
for r in rows:
    d=float(r['dist']); now=1_000_000_000
    live={"now":now,"window":{"ticker":T,"strikeUsd":95000,"closeTimeMs":now+int(r['sr'])*1000,"startedAtMs":now-100_000,"samples":[]},
      "snapshot":{"distanceBps":d,"yesBidCents":r['yb'],"yesAskCents":r['ya'],"noBidCents":r['nb'],"noAskCents":r['na']},"intents":[]}
    obs={"status":{"equityCents":428,"killed":False},"live":live,"history":[],"record":{}}
    obs["fair"]=ta.fair_value(live); obs["edges"]=ta.edges(obs["fair"],live["snapshot"])
    task,_=ta.build_nexus_task(obs,count=nx.count)
    out=nx.generate(task,max_new=min(160,nx.ctx_limit-nx.count(task)-2))
    dec=ta.parse_nexus_transcript(out,obs,0.5); fin=ta.apply_discipline(dec,obs)
    bucket='BTC below strike (d<0)' if d<0 else 'BTC above strike (d>=0)'
    m=re.search(r'"side":"(\w+)"',out); side=m.group(1) if m else ('direct' if '<|route:direct' in out else 'none')
    key=(side, 'valid' if dec['valid'] else 'invalid', fin['action'])
    by[bucket][key]+=1; tot[(side,fin['action'])]+=1
    if fin['action']!='none' and len(samples)<4: samples.append((round(d,1),r['ya'],r['na'],fin['action'],(obs['edges'])))
for b,c in by.items():
    print(b, 'n=',sum(c.values()))
    for k,v in sorted(c.items()): print('   side/valid/after-discipline',k,v)
print('TOTAL (side, after-discipline action):',dict(tot))
print('examples of surviving entries (dist, yesAsk, noAsk, action, edges):',samples)
