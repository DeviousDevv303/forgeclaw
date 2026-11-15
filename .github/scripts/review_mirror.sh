#!/usr/bin/env bash
# Mirror job of .github/workflows/code-review.yml (no model code runs here).
# Publishes the review to review-results/<id>.txt (+ .meta.txt) so the app can read it; a failed review is
# published as a status line, so the app stops waiting and shows the reason.
#   usage: review_mirror.sh <remote-url> <invocation-id> <result-dir> <review-result>
# Auth comes from GIT_AUTH_HEADER (an http extraheader) when set.
set -euo pipefail
REMOTE="$1"; ID="$2"; RESULT_DIR="$3"; REVIEW_RESULT="$4"
printf '%s' "$ID" | grep -Eqx '[A-Za-z0-9._-]{1,120}' || { echo "::error::invalid invocation id"; exit 1; }
WORK="$(mktemp -d)"
g() { command git -c user.name='ForgeClaw Review' -c user.email='forgeclaw-review@local' ${GIT_AUTH_HEADER:+-c "http.https://github.com/.extraheader=$GIT_AUTH_HEADER"} "$@"; }

if [ -f "$RESULT_DIR/review.txt" ]; then cp "$RESULT_DIR/review.txt" "$WORK/answer.txt"
else printf 'REVIEW FAILED (%s); see the run log.\n' "$REVIEW_RESULT" > "$WORK/answer.txt"; fi
if [ -f "$RESULT_DIR/review_meta.txt" ]; then cp "$RESULT_DIR/review_meta.txt" "$WORK/meta.txt"
else printf 'status=%s\n' "$REVIEW_RESULT" > "$WORK/meta.txt"; fi

# Fresh shallow clone per attempt, so a concurrent push is just a retry.
for attempt in 1 2 3 4; do
  wt="$WORK/wt"; rm -rf "$wt"
  if ! g clone -q --depth 1 --single-branch --branch review-results "$REMOTE" "$wt" 2>/dev/null; then
    g init -q "$wt"; g -C "$wt" checkout -q --orphan review-results; g -C "$wt" remote add origin "$REMOTE"
  fi
  mkdir -p "$wt/review-results"
  cp "$WORK/answer.txt" "$wt/review-results/$ID.txt"; cp "$WORK/meta.txt" "$wt/review-results/$ID.meta.txt"
  g -C "$wt" add "review-results/$ID.txt" "review-results/$ID.meta.txt"
  g -C "$wt" commit -q -m "review: $ID"
  if g -C "$wt" push -q origin "HEAD:refs/heads/review-results"; then exit 0; fi
  sleep $((attempt * 2))
done
echo "::warning::push to review-results failed after 4 attempts"
exit 1
