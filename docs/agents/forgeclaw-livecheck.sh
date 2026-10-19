#!/usr/bin/env bash
# ForgeClaw live check. Read-only: never dispatches, pushes, or writes to GitHub.
# Usage: bash docs/agents/forgeclaw-livecheck.sh [number_of_deepseek_runs]   (run from the forgeclaw repo root)
# Optional: export GH_TOKEN=... (read-only use; raises the API rate limit and allows log downloads).
set -uo pipefail
REPO=DeviousDevv303/forgeclaw
API=https://api.github.com/repos/$REPO
SITE=https://deviousdevv303.github.io/forgeclaw/
N=${1:-10}
AUTH=(); [ -n "${GH_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $GH_TOKEN")
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
gh_get() { curl -sS "${AUTH[@]}" -H 'Accept: application/vnd.github+json' "$API$1"; }
FAIL=0; flag() { echo "  !! $*"; FAIL=1; }

echo "== 1. main + CI"
git fetch -q origin main deepseek-results 2>/dev/null || flag "git fetch failed"
echo "  main: $(git log --oneline -1 origin/main)"
gh_get "/actions/runs?branch=main&event=push&per_page=6" > "$TMP/ci.json"
python3 - "$TMP/ci.json" <<'E' || FAIL=1
import json,sys
runs=json.load(open(sys.argv[1])).get('workflow_runs',[])
bad=0; latest=set()
for r in runs[:6]:
    first = r['name'] not in latest; latest.add(r['name'])
    tag = '' if first else '  (older)'
    print(f"  {r['created_at'][:16]} {r['name'][:28]:<28} {r['head_sha'][:7]} {r['status']}/{r['conclusion']}{tag}")
    # Only the newest run of each workflow decides; an older failure already fixed by a later run is history.
    if first and r['status']=='completed' and r['conclusion']!='success': bad=1
if bad: print("  !! the latest main run of a workflow did not succeed"); sys.exit(1)
E

echo "== 2. live Pages bundle"
curl -sS -o "$TMP/index.html" "$SITE" || flag "site unreachable"
JS=$(grep -oE 'assets/[^"]+\.js' "$TMP/index.html" | head -1)
curl -sS -o "$TMP/b.js" "$SITE$JS"
has() { grep -qF -- "$1" "$TMP/b.js"; }
has 'deepseek-not-dispatched' && echo "  ok  router fix live (#131)" || flag "router fix missing from live bundle"
grep -qE 'deepseek-16b\.yml.{0,40}per_page=20|\$\{[A-Za-z_$]+\}/runs\?event=workflow_dispatch&per_page=20' "$TMP/b.js" && echo "  ok  DeepSeek discovery per_page=20" || flag "DeepSeek discovery page size not 20"
has 'using most recent run' && flag "#130 fallback is LIVE" || echo "  ok  no discovery fallback"
has 'GitHub Actions unreachable' && flag "old 'GitHub Actions unreachable' text is live" || echo "  ok  no old unreachable text"
echo "  info heavy pollers still at per_page=100: $(grep -oE 'per_page=100' "$TMP/b.js" | wc -l)"

echo "== 3. last $N DeepSeek runs"
gh_get "/actions/workflows/deepseek-16b.yml/runs?event=workflow_dispatch&per_page=$N" > "$TMP/ds.json"
python3 - "$TMP/ds.json" "$API" <<'E' || FAIL=1
import json,sys,subprocess,os,hashlib
from datetime import datetime as D
p=lambda s:D.fromisoformat(s.replace('Z','+00:00')) if s else None
runs=json.load(open(sys.argv[1])).get('workflow_runs',[]); api=sys.argv[2]
auth=['-H',f"Authorization: Bearer {os.environ['GH_TOKEN']}"] if os.environ.get('GH_TOKEN') else []
seen={}; prev=None; bad=0
print(f"  {'run':>5} {'created':>8} {'gap':>5} {'queue':>5} {'total':>6} {'model':>6}  result  mirror  meta")
for r in runs:
    iid=r['name'].split()[-1]
    jobs=json.loads(subprocess.run(['curl','-sS',*auth,f"{api}/actions/runs/{r['id']}/jobs"],capture_output=True,text=True).stdout).get('jobs',[])
    q=tot=model='-'
    for j in jobs:
        if j.get('started_at'): q=f"{(p(j['started_at'])-p(r['created_at'])).total_seconds():.0f}s"
        if j.get('completed_at'): tot=f"{(p(j['completed_at'])-p(r['created_at'])).total_seconds()/60:.1f}m"
        for s in j.get('steps',[]):
            if s['name']=='Run DeepSeek' and s.get('completed_at'): model=f"{(p(s['completed_at'])-p(s['started_at'])).total_seconds()/60:.1f}m"
    g=lambda f:subprocess.run(['git','show',f'origin/deepseek-results:deepseek-results/{iid}.{f}'],capture_output=True,text=True)
    txt=g('txt'); meta=g('meta.txt')
    mirror='yes' if txt.returncode==0 else 'NO'
    m=dict(l.split('=',1) for l in meta.stdout.splitlines() if '=' in l)
    gap='' if prev is None else f"{(prev-p(r['created_at'])).total_seconds()/60:.0f}m"; prev=p(r['created_at'])
    h=hashlib.sha1(txt.stdout.encode()).hexdigest()[:8] if mirror=='yes' else ''
    dup=f" DUP-of-#{seen[h]}" if h and h in seen else ''; seen.setdefault(h,r['run_number']) if h else None
    notes=[]
    if m.get('degraded')=='true': notes.append('DEGRADED')
    if m.get('tool_call_tail_dropped')=='true': notes.append('tail-dropped')
    if txt.stdout.lstrip().startswith('['): notes.append('ENVELOPE-ECHO')
    print(f"  #{r['run_number']:>4} {r['created_at'][11:19]} {gap:>5} {q:>5} {tot:>6} {model:>6}  {str(r['conclusion']):<7} {mirror:<6} {' '.join(notes)}{dup}")
    if r['status']=='completed' and r['conclusion']!='success': bad=1; print(f"        !! failed: {r['html_url']}")
    if r['conclusion']=='success' and mirror=='NO': bad=1; print(f"        !! success but NO mirror (push race?) {iid}")
sys.exit(bad)
E

echo "== 4. failed DeepSeek run logs (needs GH_TOKEN)"
python3 -c "import json;[print(r['id']) for r in json.load(open('$TMP/ds.json'))['workflow_runs'] if r['conclusion'] not in ('success',None)]" | while read -r id; do
  if [ -z "${GH_TOKEN:-}" ]; then echo "  run $id failed; set GH_TOKEN to fetch its log"; continue; fi
  gh_get "/actions/runs/$id/jobs" | python3 -c "import json,sys;[print(j['id']) for j in json.load(sys.stdin)['jobs'] if j['conclusion']=='failure']" | while read -r job; do
    echo "  -- run $id job $job (last error lines):"
    curl -sSL "${AUTH[@]}" "$API/actions/jobs/$job/logs" | grep -E '##\[error\]|rejected|Error|Traceback|Killed|OOM' | tail -8 | sed 's/^/     /'
  done
done

echo "== RESULT: $([ $FAIL = 0 ] && echo PASS || echo 'ATTENTION NEEDED (see !! lines)')"
exit $FAIL
