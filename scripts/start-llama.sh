#!/usr/bin/env bash
# Start llama.cpp for ForgeClaw without disturbing an already healthy server.
set -euo pipefail

MODEL_PATH="${MODEL_PATH:-${HOME}/models/qwen2.5-3b-instruct-q4_k_m.gguf}"
SERVER_PATH="${SERVER_PATH:-${HOME}/forgeclaw/.nexus-llama-build/bin/llama-server}"
PORT="${PORT:-8080}"
CONTEXT="${CONTEXT:-8192}"
THREADS="${THREADS:-4}"
BASE_URL="http://127.0.0.1:${PORT}"
LOG_PATH="${LLAMA_LOG_PATH:-${HOME}/llama.log}"

if curl --silent --fail --max-time 2 "${BASE_URL}/v1/models" >/dev/null 2>&1; then
  echo "llama.cpp server already healthy on port ${PORT}; leaving it untouched."
  curl --silent "${BASE_URL}/v1/models"
  exit 0
fi

[[ -x "${SERVER_PATH}" ]] || { echo "llama-server not executable: ${SERVER_PATH}" >&2; exit 1; }
[[ -f "${MODEL_PATH}" ]] || { echo "GGUF model not found: ${MODEL_PATH}" >&2; exit 1; }

# Only terminate a process using this exact configured server binary and port.
if command -v pkill >/dev/null 2>&1; then
  pkill -f -- "${SERVER_PATH}.*--port[ =]${PORT}( |$)" 2>/dev/null || true
fi
sleep 1

echo "Starting llama.cpp server"
echo "Model: ${MODEL_PATH}"
echo "Port: ${PORT}"
nohup "${SERVER_PATH}" \
  -m "${MODEL_PATH}" \
  --port "${PORT}" \
  -c "${CONTEXT}" \
  -t "${THREADS}" \
  --no-warmup \
  >"${LOG_PATH}" 2>&1 &
server_pid=$!
echo "PID: ${server_pid}"

for _ in {1..30}; do
  if curl --silent --fail --max-time 2 "${BASE_URL}/v1/models" >/dev/null 2>&1; then
    echo "llama.cpp server ready on port ${PORT}"
    curl --silent "${BASE_URL}/v1/models"
    exit 0
  fi
  sleep 1
done

echo "llama.cpp failed to start; check ${LOG_PATH}" >&2
kill "${server_pid}" 2>/dev/null || true
exit 1
