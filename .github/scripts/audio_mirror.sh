#!/usr/bin/env bash
# Mirror job of .github/workflows/audio-transcribe.yml (no model code runs here).
# Publishes the transcript to audio-results/<id>.txt (+ .meta.txt) and removes the attached clip
# from the audio-inputs branch. A failed transcription is published as a status line, so the app
# stops waiting and shows the reason.
#   usage: audio_mirror.sh <remote-url> <invocation-id> <audio-ref or ''> <result-dir> <transcribe-result>
# Auth comes from GIT_AUTH_HEADER (an http extraheader) when set.
set -euo pipefail
REMOTE="$1"; ID="$2"; AUDIO_REF="$3"; RESULT_DIR="$4"; TRANSCRIBE_RESULT="$5"
printf '%s' "$ID" | grep -Eqx '[A-Za-z0-9._-]{1,120}' || { echo "::error::invalid invocation id"; exit 1; }
if [ -n "$AUDIO_REF" ] && ! printf '%s' "$AUDIO_REF" | grep -Eqx 'audio-inputs/[A-Za-z0-9._-]{1,120}\.(webm|mp4|m4a|mp3|wav|ogg|flac|aac)'; then
  echo "::error::invalid audio_ref"; exit 1
fi
WORK="$(mktemp -d)"
g() { command git -c user.name='ForgeClaw Audio' -c user.email='forgeclaw-audio@local' ${GIT_AUTH_HEADER:+-c "http.https://github.com/.extraheader=$GIT_AUTH_HEADER"} "$@"; }

if [ -f "$RESULT_DIR/result.txt" ]; then cp "$RESULT_DIR/result.txt" "$WORK/answer.txt"
else printf 'TRANSCRIPTION FAILED (%s); see the run log.\n' "$TRANSCRIBE_RESULT" > "$WORK/answer.txt"; fi
if [ -f "$RESULT_DIR/result_meta.txt" ]; then cp "$RESULT_DIR/result_meta.txt" "$WORK/meta.txt"
else printf 'status=%s\n' "$TRANSCRIBE_RESULT" > "$WORK/meta.txt"; fi

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
  mkdir -p "$1/audio-results"
  cp "$WORK/answer.txt" "$1/audio-results/$ID.txt"; cp "$WORK/meta.txt" "$1/audio-results/$ID.meta.txt"
  g -C "$1" add "audio-results/$ID.txt" "audio-results/$ID.meta.txt"
  g -C "$1" commit -q -m "audio: $ID"
}
remove_clip() {
  [ -f "$1/$AUDIO_REF" ] || return 1
  g -C "$1" rm -q "$AUDIO_REF"
  g -C "$1" commit -q -m "audio: remove $AUDIO_REF after transcription"
}

publish audio-results add_answer
if [ -n "$AUDIO_REF" ]; then publish audio-inputs remove_clip || true; fi
