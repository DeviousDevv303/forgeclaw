# ForgeClaw — Shared Agent Memory

## CURRENT STATE
_Updated: 2026-05-16 · Update this block on every push._

| | SHA | Status |
|---|---|---|
| Remote HEAD | `7e441ac` | ✅ pushed |
| Claude local | `7e441ac` | in sync |
| KimiClaw local | `88eb037` | ⚠️ push pending |

**KimiClaw: push `88eb037` before starting new work — remote is behind.**

---

## ACTIVE FEATURES IN FLIGHT

| Feature | Owner | Status | Key Files |
|---|---|---|---|
| Ollama live model selector | Claude | ✅ shipped `06b47f4` | `src/App.tsx` |
| TTS hardening (browserSpeak) | KimiClaw | ✅ restored `7e441ac` — was overwritten 3x | `src/App.tsx` ~L586 |
| Tier 1 autonomy + kill switch | Claude | ✅ shipped `d43b848` | `src/lib/guardianGate.ts`, `src/App.tsx` |
| CI loop tools (get_run_status/logs) | Claude | ✅ shipped `f688e73` | `src/lib/forgeTools.ts` |
| System prompt for uncensored models | Claude | 🔜 next | `src/App.tsx` FORGEMIND_SYSTEM_PROMPT |
| TTS debug with user (Gemma/voice) | KimiClaw | 🔜 next | `src/App.tsx` browserSpeak |
| Monetization / proprietary layer | Cristian | 💬 in discussion | — |

---

## KNOWN COLLISION ZONES

| File | Risk | Protocol |
|---|---|---|
| `src/App.tsx` | HIGH — both agents touch it | Add `[co-agent:]` tags to every commit. Read `git log --oneline` before editing. |
| `src/App.tsx` ~L586 `browserSpeak()` | KimiClaw owns TTS hardening | Claude: grep `utterancesRef` before touching App.tsx. If present, do not overwrite. |
| `src/App.tsx` voice init `useEffect` | KimiClaw: `onvoiceschanged` order matters | Never revert to setting handler after `getVoices()` |
| `src/lib/guardianGate.ts` | Claude owns | KimiClaw: read before touching |
| `src/lib/forgeTools.ts` | Claude owns | KimiClaw: read before touching |

---

## COMMIT MESSAGE FORMAT (REQUIRED)

Every commit must include a `[co-agent:]` tag on the last line before the URL:

```
feat/fix/refactor: description of change

Body explaining why.

[co-agent: claude] TOUCHES: src/App.tsx browserSpeak — KimiClaw TTS preserved ✅
[co-agent: kimi]   TOUCHES: src/App.tsx — check Claude's Ollama selector intact

https://claude.ai/code/session_...
```

**Tag format:**
- `[co-agent: claude]` — Claude's note to KimiClaw
- `[co-agent: kimi]` — KimiClaw's note to Claude
- `PRESERVE: <thing>` — do not overwrite this
- `TOUCHES: <file>` — flag shared file changes
- `OVERWRITES: <sha> <thing>` — explicit callout when reverting prior work

**KimiClaw grep command:** `git log --oneline | grep "co-agent"`

---

## NEXT PRIORITIES

**Claude:**
1. System prompt branch for uncensored local models (Ollama/Gemma path)
2. Monetization architecture discussion with Cristian

**KimiClaw:**
1. Push `88eb037` to remote
2. TTS debug session with Cristian (Gemma 4 + voice output)
3. Sync on monetization direction

---

## STRATEGIC CONTEXT

Cristian is considering monetizing ForgeClaw. Key differentiators identified:
- Guardian gate + orchestrator contract system (novel safety architecture)
- Framework-as-safety philosophy (uncensored model + custom constraints = enterprise governance story)
- Autonomy tiering (fully autonomous default, Tier 1 on demand)

Direction: keep core shell open source, monetize proprietary routing intelligence, Enterprise Guardian (compliance audit logs, team policies), and ForgeClaw Cloud (hosted). Avoid Manus pattern of full closure.

---

## STANDING RULES (cross-reference CLAUDE.md)

- Hardcoded API keys in `src/App.tsx` — never remove
- Reasoning trace style — locked, see CLAUDE.md
- Tab structure: `FORGE | COACH | VOICE | WHATSAPP | FAILURES | ACTIVITY | SETTINGS`
- Both agents sign every message: Claude → `— Claude`, KimiClaw → `— KimiClaw`
- No direct agent-to-agent commits to shared files without `[co-agent:]` tag
