#!/usr/bin/env bash
# Mirror job of .github/workflows/image-analyze.yml (no model code runs here).
# Publishes the analysis to vision-results/<id>.txt (+ .meta.txt) and removes the attached picture
# from the vision-inputs branch. A failed analysis is published as a status line, so the app stops
# waiting and shows the reason.
#   usage: vision_mirror.sh <remote-url> <invocation-id> <image-ref or ''> <result-dir> <analyze-result>
# Auth comes from GIT_AUTH_HEADER (an http extraheader) when set.
set -euo pipefail
REMOTE="$1"; ID="$2"; IMAGE_REF="$3"; RESULT_DIR="$4"; ANALYZE_RESULT="$5"
printf '%s' "$ID" | grep -Eqx '[A-Za-z0-9._-]{1,120}' || { echo "::error::invalid invocation id"; exit 1; }
if [ -n "$IMAGE_REF" ] && ! printf '%s' "$IMAGE_REF" | grep -Eqx 'vision-inputs/[A-Za-z0-9._-]{1,120}\.(jpg|png|webp|gif)'; then
  echo "::error::invalid image_ref"; exit 1
fi
WORK="$(mktemp -d)"
g() { command git -c user.name='ForgeClaw Vision' -c user.email='forgeclaw-vision@local' ${GIT_AUTH_HEADER:+-c "http.https://github.com/.extraheader=$GIT_AUTH_HEADER"} "$@"; }

if [ -f "$RESULT_DIR/result.txt" ]; then cp "$RESULT_DIR/result.txt" "$WORK/answer.txt"
else printf 'ANALYSIS FAILED (%s); see the run log.\n' "$ANALYZE_RESULT" > "$WORK/answer.txt"; fi
if [ -f "$RESULT_DIR/result_meta.txt" ]; then cp "$RESULT_DIR/result_meta.txt" "$WORK/meta.txt"
else printf 'status=%s\n' "$ANALYZE_RESULT" > "$WORK/meta.txt"; fi

# publish <branch> <edit-function>: fresh shallow clone per attempt, so a concurrent push is just a retry.
publish() {
  local branch="$1" edit="$2" wt="$WORK/wt"
  for attempt in 1 2 3 4; do
    rm -rf "$wt"
    if ! g clone -q --depth 1 --single-branch --branch "$branch" "$REMOTE" "$wt" 2>/dev/null; then
      g init -q "$wt"; g -C "$wt" checkout -q --orphan "$branch"; g -C "$wt" remote add origin "$REMOTE"
    fi
    if ! "$edit" "$wt"; then return 0; fi   # nothing to change
    if g -C "$wt" push -q origin "HEAD:refs/heads/$branch"; then return 0; fi
    sleep $((attempt * 2))
  done
  echo "::warning::push to $branch failed after 4 attempts"
  return 1
}
add_answer() {
  mkdir -p "$1/vision-results"
  cp "$WORK/answer.txt" "$1/vision-results/$ID.txt"; cp "$WORK/meta.txt" "$1/vision-results/$ID.meta.txt"
  g -C "$1" add "vision-results/$ID.txt" "vision-results/$ID.meta.txt"
  g -C "$1" commit -q -m "vision: $ID"
}
remove_picture() {
  [ -f "$1/$IMAGE_REF" ] || return 1
  g -C "$1" rm -q "$IMAGE_REF"
  g -C "$1" commit -q -m "vision: remove $IMAGE_REF after analysis"
}

publish vision-results add_answer
if [ -n "$IMAGE_REF" ]; then publish vision-inputs remove_picture || true; fi
