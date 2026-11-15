#!/usr/bin/env bash
# Mirror job of .github/workflows/browser-agent.yml (no browser runs here, and nothing from the page is executed).
# Publishes one browser round to browser-results/<id>/result.json (+ screen.jpg) so the app can read it. A round that
# failed before producing a result is published as a failure line, so the app stops waiting and shows the reason.
# Only a file named result.json (a size-capped JSON) and screen.jpg (a size-capped JPEG) are copied.
#   usage: browser_mirror.sh <remote-url> <invocation-id> <result-dir> <browse-result>
# Auth comes from GIT_AUTH_HEADER (an http extraheader) when set.
set -euo pipefail
REMOTE="$1"; ID="$2"; RESULT_DIR="$3"; BROWSE_RESULT="$4"
printf '%s' "$ID" | grep -Eqx '[A-Za-z0-9._-]{1,120}' || { echo "::error::invalid invocation id"; exit 1; }
WORK="$(mktemp -d)"
g() { command git -c user.name='ForgeClaw Browser' -c user.email='forgeclaw-browser@local' ${GIT_AUTH_HEADER:+-c "http.https://github.com/.extraheader=$GIT_AUTH_HEADER"} "$@"; }
MAX_JSON=200000; MAX_IMG=600000

SRC_JSON="$RESULT_DIR/result.json"
if [ -f "$SRC_JSON" ] && [ "$(wc -c < "$SRC_JSON")" -le "$MAX_JSON" ] && python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$SRC_JSON" 2>/dev/null; then
  cp "$SRC_JSON" "$WORK/result.json"
else
  python3 - "$WORK/result.json" "$BROWSE_RESULT" <<'PY'
import json, sys
json.dump({"ok": False, "error": "browse job %s before producing a result; see the run log." % sys.argv[2], "steps": [], "elements": [], "text": "", "url": "", "title": "", "actionsOk": 0}, open(sys.argv[1], "w"))
PY
fi
HAVE_IMG=0
SRC_IMG="$RESULT_DIR/screen.jpg"
if [ -f "$SRC_IMG" ] && [ "$(wc -c < "$SRC_IMG")" -le "$MAX_IMG" ] && [ "$(head -c 3 "$SRC_IMG" | od -An -tx1 | tr -d ' \n')" = "ffd8ff" ]; then cp "$SRC_IMG" "$WORK/screen.jpg"; HAVE_IMG=1; fi

# Fresh shallow clone per attempt, so a concurrent push is just a retry.
for attempt in 1 2 3 4; do
  wt="$WORK/wt"; rm -rf "$wt"
  if ! g clone -q --depth 1 --single-branch --branch browser-results "$REMOTE" "$wt" 2>/dev/null; then
    g init -q "$wt"; g -C "$wt" checkout -q --orphan browser-results; g -C "$wt" remote add origin "$REMOTE"
  fi
  mkdir -p "$wt/browser-results/$ID"
  cp "$WORK/result.json" "$wt/browser-results/$ID/result.json"
  [ "$HAVE_IMG" = 1 ] && cp "$WORK/screen.jpg" "$wt/browser-results/$ID/screen.jpg"
  g -C "$wt" add "browser-results/$ID"
  g -C "$wt" commit -q -m "browser: $ID"
  if g -C "$wt" push -q origin "HEAD:refs/heads/browser-results"; then exit 0; fi
  sleep $((attempt * 2))
done
echo "::warning::push to browser-results failed after 4 attempts"
exit 1
