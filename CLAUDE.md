# ForgeClaw — Standing Rules for AI Agents

## HARDCODED API KEYS — DO NOT REMOVE

Cristian has explicitly hardcoded all provider API keys in `src/App.tsx` inside
`providerKeys` state. These must never be removed, replaced, or moved to env vars
without Cristian's explicit instruction.

Keys currently hardcoded (as of 2026-05-15):
- `anthropic` — sk-ant-api03-...
- `deepseek`  — sk-c47d7b...
- `mistral`   — Ile5nNC...
- `groq`      — gsk_V0RYY...
- `kimi`      — sk-kimi-y7li...
- `ollama`    — (empty string, local)

If a key appears expired or invalid: **flag it in your report, do not replace it.**
Only Cristian can authorize key changes.

---

## Reasoning Trace — DO NOT MODIFY

The collapsible reasoning trace below each assistant bubble has a locked style:
- Toggle label: cursive "Reasoning Trace" in `#5a9e44`, font stack
  `'Brush Script MT', 'Apple Chancery', 'Segoe Script', 'Zapfino', cursive`
- Arrow: `#3a5c2a`, 9px
- Panel: `background: #060e06`, `border: 1px solid #1e3318`
- Text: `#4a7a3a`, 11px, Courier New, `pre-wrap`
- Touch target: `padding: 6px 0`, `minHeight: 36px`
- `-webkit-tap-highlight-color: transparent`

Do not change colors, fonts, sizes, or structure for any reason.

---

## Tab Structure (current)

`FORGE | COACH | VOICE | WHATSAPP | FAILURES | ACTIVITY | SETTINGS`

Do not add or remove tabs without Cristian's explicit instruction.
Do not restore `RepoAgent` or `OrchestratorPanel` tabs.
Do not add xAI/Grok provider.

---

## Agent Division of Labor

- **Claude** owns: `src/App.tsx`, `src/types/`, `src/lib/guardianGate.ts`,
  `src/lib/managedAgent.ts`, `src/lib/modelProviders.ts`, system prompt
- **KimiClaw** owns: `src/components/monitor/`, `src/hooks/useWarRoom.ts`,
  Guardian hook steps (7–8 complete)

Both agents must pull from `origin/main` before starting any work session.
Neither agent can push directly to GitHub — Claude pushes via local proxy.
