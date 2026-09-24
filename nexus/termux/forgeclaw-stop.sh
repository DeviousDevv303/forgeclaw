#!/data/data/com.termux/files/usr/bin/sh
# Stops only processes started by forgeclaw-start.sh.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PREFIX_ROOT=${PREFIX:-"$HOME/.forgeclaw"}
RUN_ROOT="$PREFIX_ROOT/var/run/forgeclaw"
SOCKET="$RUN_ROOT/nexus.sock"
DAEMON_PIDFILE="$RUN_ROOT/nexusd.pid"
BRIDGE_PIDFILE="$RUN_ROOT/nexus-http-bridge.pid"
DAEMON_NAME="/build/nexus-native/nexusd"
BRIDGE_NAME="/build/nexus-native/nexus-http-bridge"

stop_owned() {
  pidfile=$1
  needle=$2
  if [ -s "$pidfile" ]; then
    pid=$(cat "$pidfile" 2>/dev/null || true)
    case "$pid" in
      ''|*[!0-9]*) ;;
      *)
        if [ -r "/proc/$pid/cmdline" ] && tr '\000' ' ' <"/proc/$pid/cmdline" | grep -F -- "$needle" >/dev/null 2>&1; then
          kill "$pid" 2>/dev/null || true
        fi
        ;;
    esac
  fi
  rm -f "$pidfile"
}

stop_owned "$BRIDGE_PIDFILE" "$BRIDGE_NAME"
stop_owned "$DAEMON_PIDFILE" "$DAEMON_NAME"
rm -f "$SOCKET"
printf '%s\n' '[ForgeClaw] local NEXUS processes stopped'
