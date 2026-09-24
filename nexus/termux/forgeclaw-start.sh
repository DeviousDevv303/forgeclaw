#!/data/data/com.termux/files/usr/bin/sh
# ForgeClaw NEXUS operator launcher.
# Orchestration only: the NEXUS protocol and native runtime are unchanged.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
PREFIX_ROOT=${PREFIX:-"$HOME/.forgeclaw"}
RUNTIME_ROOT="$PREFIX_ROOT/var/lib/forgeclaw/nexus"
RUN_ROOT="$PREFIX_ROOT/var/run/forgeclaw"
SOCKET="$RUN_ROOT/nexus.sock"
CORPUS="$RUNTIME_ROOT/corpus.log"
DAEMON_PIDFILE="$RUN_ROOT/nexusd.pid"
BRIDGE_PIDFILE="$RUN_ROOT/nexus-http-bridge.pid"
DAEMON_LOG="$RUNTIME_ROOT/nexusd.log"
BRIDGE_LOG="$RUNTIME_ROOT/nexus-http-bridge.log"
BRIDGE_URL="http://127.0.0.1:8787"
EXPECTED_SHA256="6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e"
MODEL_NAME="qwen2.5-1.5b-instruct-q4_k_m.gguf"
DAEMON="$REPO_ROOT/build/nexus-native/nexusd"
CLI="$REPO_ROOT/build/nexus-native/nexus-cli"
BRIDGE="$REPO_ROOT/build/nexus-native/nexus-http-bridge"

log() { printf '[ForgeClaw] %s\n' "$*"; }
fatal() { printf '[ForgeClaw] ERROR: %s\n' "$*" >&2; exit 1; }

find_model() {
  if [ -n "${NEXUS_MODEL:-}" ] && [ -f "$NEXUS_MODEL" ]; then
    printf '%s\n' "$NEXUS_MODEL"
    return 0
  fi
  for model in \
    "$RUNTIME_ROOT/$MODEL_NAME" \
    "$HOME/storage/shared/Download/$MODEL_NAME" \
    "$HOME/storage/downloads/$MODEL_NAME" \
    "$REPO_ROOT/models/nexus/$MODEL_NAME"; do
    [ -f "$model" ] && { printf '%s\n' "$model"; return 0; }
  done
  return 1
}

read_pid() {
  file=$1
  [ -s "$file" ] || return 1
  pid=$(cat "$file" 2>/dev/null || true)
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  printf '%s\n' "$pid"
}

pid_matches() {
  pid=$1
  needle=$2
  [ -r "/proc/$pid/cmdline" ] || return 1
  tr '\000' ' ' <"/proc/$pid/cmdline" | grep -F -- "$needle" >/dev/null 2>&1
}

stop_owned_process() {
  pidfile=$1
  needle=$2
  pid=$(read_pid "$pidfile" || true)
  if [ -n "${pid:-}" ] && pid_matches "$pid" "$needle"; then
    kill "$pid" 2>/dev/null || true
    i=0
    while [ "$i" -lt 10 ] && kill -0 "$pid" 2>/dev/null; do sleep 1; i=$((i + 1)); done
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$pidfile"
}

daemon_ready() {
  [ -S "$SOCKET" ] || return 1
  output=$("$CLI" --socket "$SOCKET" status 2>/dev/null || true)
  printf '%s\n' "$output" | grep -F 'STATUS' | grep -F 'initialized=1' | grep -F 'offline=1' | grep -F 'ollama=0' >/dev/null
}

bridge_ready() {
  response=$(printf 'STATUS\n' | curl -fsS --max-time 3 -X POST -H 'Content-Type: text/plain' --data-binary @- "$BRIDGE_URL/" 2>/dev/null || true)
  printf '%s\n' "$response" | grep -F 'OK' | grep -F 'STATUS' | grep -F 'initialized=1' | grep -F 'offline=1' | grep -F 'ollama=0' >/dev/null
}

wait_for_daemon() {
  i=0
  while [ "$i" -lt 120 ]; do
    daemon_ready && return 0
    sleep 1
    i=$((i + 1))
  done
  return 1
}

wait_for_bridge() {
  i=0
  while [ "$i" -lt 20 ]; do
    bridge_ready && return 0
    sleep 1
    i=$((i + 1))
  done
  return 1
}

mkdir -p "$RUNTIME_ROOT" "$RUN_ROOT"
[ -x "$DAEMON" ] || fatal "NEXUS daemon is not built; run the documented native build first"
[ -x "$CLI" ] || fatal "NEXUS CLI is not built; run the documented native build first"
[ -x "$BRIDGE" ] || fatal "NEXUS HTTP bridge is not built; run the documented native build first"
MODEL=$(find_model || true)
[ -n "${MODEL:-}" ] || fatal "approved Qwen GGUF not found; place $MODEL_NAME in the standard model location or set NEXUS_MODEL"
ACTUAL_SHA256=$(sha256sum "$MODEL" | awk '{print $1}')
[ "$ACTUAL_SHA256" = "$EXPECTED_SHA256" ] || fatal "model SHA-256 verification failed"

export NETWORK=OFF
export OLLAMA=OFF

if daemon_ready; then
  log "NEXUS runtime already healthy"
else
  if [ -e "$SOCKET" ]; then
    stop_owned_process "$DAEMON_PIDFILE" "$DAEMON"
    rm -f "$SOCKET"
  fi
  log "Starting local NEXUS runtime"
  nohup "$DAEMON" \
    --model "$MODEL" \
    --sha256 "$EXPECTED_SHA256" \
    --socket "$SOCKET" \
    --corpus "$CORPUS" \
    --ctx 512 \
    --threads 2 \
    --n-predict 32 \
    >"$DAEMON_LOG" 2>&1 &
  daemon_pid=$!
  printf '%s\n' "$daemon_pid" >"$DAEMON_PIDFILE"
  wait_for_daemon || {
    stop_owned_process "$DAEMON_PIDFILE" "$DAEMON"
    rm -f "$SOCKET"
    fatal "NEXUS runtime did not become ready; inspect the local runtime log"
  }
fi

if bridge_ready; then
  log "NEXUS bridge already healthy"
else
  stop_owned_process "$BRIDGE_PIDFILE" "$BRIDGE"
  log "Starting local NEXUS bridge"
  nohup "$BRIDGE" --socket "$SOCKET" --port 8787 >"$BRIDGE_LOG" 2>&1 &
  bridge_pid=$!
  printf '%s\n' "$bridge_pid" >"$BRIDGE_PIDFILE"
  wait_for_bridge || {
    stop_owned_process "$BRIDGE_PIDFILE" "$BRIDGE"
    fatal "NEXUS bridge did not become ready; inspect the local bridge log"
  }
fi

log "NEXUS ready for ForgeClaw (offline mode)"
