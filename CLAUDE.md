# ForgeClaw — Standing Rules for AI Agents

## API KEYS — Settings only, no hardcoding

All provider API keys are entered by the user via the Settings tab and stored
in localStorage (`fm_provider_keys`). No keys are hardcoded in source.

Do not hardcode any API key in `src/App.tsx` or any other file.
Keys belong in localStorage only — never in committed code.

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

`FORGE | COACH | AGENTS | VOICE | WHATSAPP | FAILURES | ACTIVITY | SETTINGS`

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

---

## Commit Message Format — REQUIRED

Every commit that touches a shared file MUST include a `[co-agent:]` tag:

```
feat: description

Body.

[co-agent: claude] TOUCHES: src/App.tsx — KimiClaw TTS (browserSpeak) preserved ✅
```

Rules:
- `PRESERVE: <symbol>` — flag something the other agent must not overwrite
- `TOUCHES: <file>` — any shared file touched in this commit
- `OVERWRITES: <sha> <what>` — explicit callout when reverting prior work

KimiClaw greps with: `git log --oneline | grep "co-agent"`

---

## src/App.tsx Collision Rules

`browserSpeak()` (~L586) is KimiClaw's TTS hardening. Before editing App.tsx:
1. `grep -n "utterancesRef\|ttsResumeIntervalRef" src/App.tsx`
2. If present — those lines belong to KimiClaw. Do not remove or simplify them.
3. Add `[co-agent: claude] PRESERVE: browserSpeak TTS hardening` to your commit.

This was overwritten 3 times (d43b848, 06b47f4, restored at 7e441ac). Do not repeat.
