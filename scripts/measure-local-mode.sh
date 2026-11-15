#!/usr/bin/env bash
set -u
OUT="${1:-/home/ubuntu/forgeclaw/local-mode-measurement.txt}"
MODEL="local-model"
ENDPOINT="http://127.0.0.1:8080/v1/chat/completions"
: > "$OUT"
log() { printf '%s\n' "$*" | tee -a "$OUT"; }
sample() {
  label="$1"
  used_kib=$(awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{print t-a}' /proc/meminfo)
  swap_kib=$(awk '/^SwapTotal:/{t=$2} /^SwapFree:/{f=$2} END{print t-f}' /proc/meminfo)
  llama_rss=$(ps -C llama-server -o rss= | awk '{s+=$1} END{print s+0}')
  vite_rss=$(ps -C node -o rss=,args= | awk '/vite|npm run dev/{s+=$1} END{print s+0}')
  log "$(date -Is) label=$label total_used_mib=$((used_kib/1024)) swap_used_mib=$((swap_kib/1024)) llama_rss_mib=$((llama_rss/1024)) vite_rss_mib=$((vite_rss/1024))"
}
log "ForgeClaw Local Mode v0.1 combined workload measurement"
log "host=$(hostname)"
free -h | tee -a "$OUT"
sample baseline
curl -sf http://127.0.0.1:5173/ >/dev/null && log "vite_ready=true" || log "vite_ready=false"
curl -sf http://127.0.0.1:8080/v1/models >/dev/null && log "llama_ready=true" || log "llama_ready=false"
sample runtime_ready
for i in 1 2 3; do
  curl -sf "$ENDPOINT" -H 'Content-Type: application/json' -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"system\",\"content\":\"You are ForgeClaw. Return a concise verified result.\"},{\"role\":\"user\",\"content\":\"Perform local execution check $i. State one concrete result.\"}],\"max_tokens\":96,\"stream\":false}" >/tmp/forgeclaw-local-response-$i.json
  test -s /tmp/forgeclaw-local-response-$i.json && log "inference_$i=completed" || log "inference_$i=empty"
  sample "inference_$i"
done
curl -sf "$ENDPOINT" -H 'Content-Type: application/json' -d '{"model":"local-model","messages":[{"role":"system","content":"You are ForgeClaw. Use the available tool when appropriate."},{"role":"user","content":"Use the run_js tool to calculate 6 times 7, then verify the result."}],"tools":[{"type":"function","function":{"name":"run_js","description":"Execute local JavaScript","parameters":{"type":"object","properties":{"code":{"type":"string"}},"required":["code"]}}}],"tool_choice":"auto","max_tokens":128,"stream":false}' >/tmp/forgeclaw-local-tool-response.json
sample tool_inference
log "peak_total_used_mib=$(awk -F'total_used_mib=' '/label=/{split($2,a," "); if(a[1]>m)m=a[1]} END{print m+0}' "$OUT")"
log "peak_swap_used_mib=$(awk -F'swap_used_mib=' '/label=/{split($2,a," "); if(a[1]>m)m=a[1]} END{print m+0}' "$OUT")"
