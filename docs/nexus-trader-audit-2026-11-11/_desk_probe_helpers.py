"""Shared helpers for the audit probes: loads the real Run 25 checkpoint (sha256-verified) and builds synthetic desk states."""
import sys, json, time
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / '.github' / 'scripts'))
import nexus_model, trader_agent as ta
nx = nexus_model.load_nexus()
print('loaded', nx.params, nx.ctx_limit, nx.checkpoint_sha256[:8])
def mk_obs(pos=False, dist=7.2, yb=70, ya=72):
    now=1_000_000_000
    live={"now":now,"window":{"ticker":"KXBTC15M-26NOV102315-15","strikeUsd":95000,"closeTimeMs":now+700_000,"startedAtMs":now-200_000,
          "samples":[[i*10, dist-0.01*i] for i in range(20)]},
          "snapshot":{"distanceBps":dist,"yesBidCents":yb,"yesAskCents":ya,"noBidCents":100-ya,"noAskCents":100-yb},
          "intents":([{"side":"yes","filled_hundredths":100,"avg_yes_price_micros":690000,"purpose":"entry","created_at_ms":now-100000,"intent_id":"x"}] if pos else [])}
    if pos: live["positions"]={"yes":100,"no":0}
    st={"equityCents":497,"killed":False,"goalCents":1500,"toGoalCents":1003}
    obs={"status":st,"live":live,"history":[],"record":{}}
    obs["fair"]=ta.fair_value(live); obs["edges"]=ta.edges(obs["fair"],live["snapshot"])
    return obs
if __name__=="__main__":
    obs=mk_obs()
    task,tr=ta.build_nexus_task(obs,count=nx.count)
    print('TASK tokens',nx.count(task),'trimmed',tr); print(task)
    t0=time.time(); out=nx.generate(task); print(round(time.time()-t0,1),'s'); print(out)
    print(ta.parse_nexus_transcript(out,obs,0.7))
