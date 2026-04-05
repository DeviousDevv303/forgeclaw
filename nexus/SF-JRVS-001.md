# NEXUS ENTRY — JARVIS REPO DISSECTION
**Entry ID:** SF-JRVS-001  
**Source:** github.com/ethanplusai/jarvis  
**Date:** 2026-04-04  
**Status:** Catalogued — Pending Integration  
**Author:** Cristian (DeviousDevv303) + Claude  
**Classification:** External Pattern Extraction

---

## 1. OVERVIEW

JARVIS is a voice-first AI assistant built for macOS. We are NOT cloning it.
We are dissecting it for reusable architectural patterns that align with
ForgeMind and ForgeClaw goals, adapted for Linux-first development.

**What we keep:** patterns, dispatch logic, memory design, cognitive loop  
**What we skip:** AppleScript, Fish Audio TTS, macOS-only integrations  
**Our advantage:** FAISS > SQLite FTS, 5-phase scaffold > flat action tags, ForgeClaw deploy > ACTION:BUILD

---

## 2. REPO STRUCTURE SNAPSHOT

```
jarvis/
├── server.py              # Main FastAPI server + WebSocket handler (~2300 lines)
├── actions.py             # Action tag dispatch system ← HIGH VALUE
├── dispatch_registry.py   # Action router ← HIGH VALUE
├── memory.py              # SQLite + FTS5 persistent memory ← HIGH VALUE
├── conversation.py        # Conversation state management
├── planner.py             # Multi-step task planner with smart questions
├── learning.py            # Self-improvement / pattern learning
├── evolution.py           # System evolution hooks
├── work_mode.py           # Persistent Claude Code sessions
├── browser.py             # Playwright web automation
├── templates.py           # Prompt templates
├── tracking.py            # Task tracking
├── suggestions.py         # Proactive suggestions
├── monitor.py             # Background monitoring
├── qa.py                  # Quality assurance hooks
├── ab_testing.py          # A/B testing framework
├── screen.py              # Screen context awareness
├── frontend/
│   ├── orb.ts             # Three.js particle orb ← AESTHETIC VALUE
│   ├── voice.ts           # Web Speech API + audio
│   └── main.ts            # Frontend state machine
├── helpers/               # Utility functions
├── templates/prompts/     # Prompt template library
└── data/                  # Persistent data store
```

---

## 3. EXTRACTABLE PATTERNS — PRIORITY RANKED

---

### 🔴 PRIORITY 1 — ACTION TAG DISPATCH SYSTEM
**Files:** `actions.py`, `dispatch_registry.py`  
**What it is:** A structured tagging system where the LLM embeds action
tokens in its response text. A parser intercepts these tags and routes
them to registered handlers.

**JARVIS action tags:**
```
[ACTION:BUILD]          → spawns Claude Code subprocess
[ACTION:BROWSE]         → opens browser to URL or search
[ACTION:RESEARCH]       → deep research via Claude Opus → HTML report
[ACTION:PROMPT_PROJECT] → connects to existing project via Claude Code
[ACTION:ADD_TASK]       → creates tracked task with priority + due date
[ACTION:REMEMBER]       → stores fact to SQLite memory
```

**Why it matters for us:**
The dispatch registry is the cleanest part of JARVIS. It decouples intent
detection from execution — the LLM just tags its output, the registry
handles the rest. This is exactly what ForgeMind needs as a command layer.

**ForgeMind integration target:**
```
[FM:PHASE_1]   → trigger Assumptions phase
[FM:PHASE_2]   → trigger Heuristics phase
[FM:PHASE_3]   → trigger First Principles phase
[FM:PHASE_4]   → trigger Extension phase
[FM:PHASE_5]   → trigger Convergence phase
[FM:STORE]     → write to NEXUS knowledge base
[FM:RECALL]    → query FAISS + NEXUS
[FM:TRAIN]     → append to forge-mind-v1.jsonl corpus
```

**ForgeClaw integration target:**
```
[FC:BUILD]     → trigger autonomous code generation
[FC:DEPLOY]    → push to GitHub Pages
[FC:AUDIT]     → run code health check
[FC:CLAWBOT]   → invoke ClawBot agent
```

**Linux adaptation:** Pure Python — no OS-specific dependencies. Drop-in.

---

### 🔴 PRIORITY 1 — MEMORY.PY (SQLite + FTS5)
**File:** `memory.py`  
**What it is:** Lightweight persistent key-value + full-text-search memory
using SQLite with the FTS5 extension. Stores preferences, decisions,
and facts across sessions without any external dependencies.

**Architecture:**
```
memory.py
├── store(key, value, category)    → write fact
├── recall(query)                  → FTS5 full-text search
├── get(key)                       → direct key lookup
├── list(category)                 → browse by category
└── forget(key)                    → delete entry
```

**Why it matters for us:**
ForgeMind Next uses FAISS for semantic vector search — that's correct for
embedding similarity. But SQLite FTS5 is better for exact/keyword recall
(names, IDs, specific terms). These two systems are COMPLEMENTARY, not
competing. We can run both in parallel:

```
Query Input
    ↓
┌─────────────────────────────┐
│  Intent Classifier           │
│  "semantic?" → FAISS        │
│  "exact?"    → SQLite FTS5  │
└─────────────────────────────┘
    ↓           ↓
  FAISS       SQLite
  results     results
    ↓           ↓
  Merge + Re-rank
    ↓
  ForgeMind Response
```

**Linux adaptation:** SQLite is cross-platform. Zero changes needed.

---

### 🟡 PRIORITY 2 — PLANNER.PY (Multi-Step Task Planning)
**File:** `planner.py`  
**What it is:** Before executing complex tasks, JARVIS generates clarifying
questions, decomposes the task into steps, and builds an execution plan.
Smart questions prevent wasted compute on misunderstood requests.

**Pattern:**
```
Input: "Build me a landing page"
  ↓
Planner: generate 2-3 scoped clarifying questions
  ↓
User answers
  ↓
Planner: decompose into ordered subtasks
  ↓
Executor: run each subtask, notify on completion
```

**ForgeMind integration target:**
This is structurally identical to the 5-phase scaffold but at the task
level. We can wrap the planner pattern AROUND the 5-phase system:
- Phase 1 (Assumptions) feeds the clarifying questions
- Planner uses Phase 3 (First Principles) to decompose
- Convergence (Phase 5) produces the final execution plan

**This is the bridge between ForgeMind cognition and ForgeClaw execution.**

---

### 🟡 PRIORITY 2 — WORK_MODE.PY (Persistent Sessions)
**File:** `work_mode.py`  
**What it is:** Maintains persistent context across multiple LLM calls
within a single working session. Prevents context loss between steps of
a multi-turn task.

**Why it matters for us:**
ForgeMind Next has a known issue — model re-initialization on every
Streamlit rerun breaks session continuity. `work_mode.py` is a reference
implementation for how to maintain a session object correctly.

**Key pattern:**
```python
# JARVIS pattern (adapted)
class WorkSession:
    def __init__(self):
        self.history = []
        self.context = {}
        self.active = True

    def push(self, role, content):
        self.history.append({"role": role, "content": content})

    def get_context_window(self, max_turns=10):
        return self.history[-max_turns:]
```

Compare to ForgeMind Next fix: wrapping `ForgeMindAgent` in
`@st.cache_resource` — same goal, different mechanism. JARVIS's approach
is more explicit and portable.

---

### 🟡 PRIORITY 2 — LEARNING.PY + EVOLUTION.PY
**Files:** `learning.py`, `evolution.py`  
**What it is:** JARVIS tracks which responses the user accepts/rejects
and which action patterns recur. Over time it adjusts prompt templates
and action selection based on observed preferences.

**Why it matters for us:**
This is a primitive version of the Guardian LLM concept — a system that
learns YOUR heuristics over time. Currently our training pipeline
(forge-mind-v1.jsonl) is manual. These files show a pattern for
semi-automated heuristic capture:

```
User interaction
  ↓
Response accepted/rejected (implicit signal)
  ↓
learning.py: log pattern + outcome
  ↓
evolution.py: update prompt template weights
  ↓
Next interaction uses updated template
```

**Long-term integration target:** Phase 2 of the Guardian LLM build.
Not immediate — but we should study these files when we start the
automated training data generation pipeline.

---

### 🟢 PRIORITY 3 — THREE.JS PARTICLE ORB (orb.ts)
**File:** `frontend/orb.ts`  
**What it is:** An audio-reactive particle visualization built in Three.js
that pulses and deforms based on the assistant's voice output frequency data.

**Why it matters for us:**
Pure aesthetic — but highly aligned with the ForgeMind cyberpunk visual
identity. The orb is the visual "heartbeat" of JARVIS. We could adapt
a version of this as a ForgeMind ambient UI element — even without voice,
it could pulse based on processing state (thinking / responding / idle).

**Linux adaptation:** Three.js is browser-based. Fully cross-platform.
Replace Web Speech API audio source with processing state events.

---

### 🟢 PRIORITY 3 — TEMPLATES/PROMPTS LIBRARY
**Directory:** `templates/prompts/`  
**What it is:** A directory of reusable prompt templates for different
task types. Each template is parameterized and called by name.

**Why it matters for us:**
ForgeMind already has the 5-phase scaffold as a cognitive template.
JARVIS's template library pattern gives us a file-system-level way to
manage and version our prompt templates — cleaner than hardcoding them
in Python.

**Integration:** Add `~/forge-mind/templates/` directory, store phase
prompts as `.md` files, load at runtime. Makes prompts editable without
touching Python code.

---

### ⚫ SKIP — DO NOT PORT
| Component | Reason |
|---|---|
| `calendar_access.py` | AppleScript — macOS only |
| `mail_access.py` | AppleScript — macOS only |
| `notes_access.py` | AppleScript — macOS only |
| Fish Audio TTS | Proprietary API + macOS-tuned |
| Web Speech API | Chrome-only, replace with Whisper on Linux |
| `screen.py` | AppleScript screen capture — replace with scrot/xwd on Linux |
| `desktop-overlay/` | Swift — macOS only |

---

## 4. ARCHITECTURE DIFF — JARVIS vs FORGEMIND

```
JARVIS                          FORGEMIND (target state)
──────────────────────────────────────────────────────
Voice input (Web Speech API)    Text input (+ future Whisper)
  ↓                               ↓
Intent detection (ad hoc)       5-Phase Scaffold (structured)
  ↓                               ↓
Action dispatch (action tags)   FM/FC dispatch tags ← BORROW THIS
  ↓                               ↓
Claude Haiku (fast response)    Qwen2.5-1.8b / Ollama (local)
  ↓                               ↓
SQLite FTS5 memory              FAISS + SQLite FTS5 ← ADD SQLITE
  ↓                               ↓
Fish Audio TTS                  Text output (+ future TTS)
  ↓                               ↓
Three.js orb UI                 Cyberpunk HTML UI ← PORT ORB
```

---

## 5. INTEGRATION ROADMAP

### Phase A — Foundation (post-wifi, immediate)
1. Deploy ForgeMind to GitHub Pages (stable base)
2. Verify live deployment
3. Port `dispatch_registry.py` pattern as `fm_dispatch.py`
4. Add SQLite FTS5 alongside FAISS in ForgeMind Next

### Phase B — Cognitive Layer
5. Implement FM action tags in Ollama response parser
6. Wire dispatch to 5-phase scaffold phases
7. Port planner.py pattern as pre-scaffold clarifier
8. Add `templates/` directory for prompt management

### Phase C — ForgeClaw Bridge
9. Implement FC action tags in ClawBot
10. Connect ForgeMind dispatch → ForgeClaw build pipeline
11. Single prompt → ForgeMind thinks → ForgeClaw deploys

### Phase D — Long Term (Guardian LLM)
12. Study learning.py + evolution.py
13. Design automated heuristic capture pipeline
14. Semi-automated corpus generation for forge-mind-v1.jsonl
15. Port Three.js orb as ForgeMind ambient UI

---

## 6. KIMI SYNC BRIEFING

> Copy this section to Kimi verbatim for full project alignment.

---

**TO: Kimi  
FROM: Cristian + Claude  
RE: JARVIS Dissection + ForgeMind Build Plan**

We dissected the JARVIS repo (github.com/ethanplusai/jarvis) — a
voice-first AI assistant built with FastAPI + Three.js + Claude + SQLite.
We are NOT building JARVIS. We extracted the useful patterns only.

**Key things we're pulling:**

1. **Action Tag Dispatch System** (`actions.py` + `dispatch_registry.py`)
   The LLM embeds structured tags like `[ACTION:BUILD]` in its responses.
   A registry parser intercepts and routes them. We're adapting this for
   ForgeMind with tags like `[FM:PHASE_1]` through `[FM:PHASE_5]`, `[FM:STORE]`,
   `[FM:RECALL]`, `[FM:TRAIN]` — and for ForgeClaw with `[FC:BUILD]`,
   `[FC:DEPLOY]`, `[FC:AUDIT]`.

2. **SQLite FTS5 Memory** (`memory.py`)
   Lightweight persistent memory using SQLite full-text search. We're
   adding this ALONGSIDE FAISS in ForgeMind Next — not replacing it.
   FAISS handles semantic/embedding search. SQLite FTS5 handles exact
   keyword/ID recall. They run in parallel, results get merged.

3. **Persistent Session Pattern** (`work_mode.py`)
   A `WorkSession` class that maintains conversation history across
   multi-turn tasks. This is the correct fix for the ForgeMind Next
   model re-initialization problem (vs the `@st.cache_resource` patch
   which only addresses Streamlit's rerun issue).

4. **Multi-Step Planner** (`planner.py`)
   Pre-execution clarifying questions + task decomposition. We're
   wrapping this AROUND the 5-phase scaffold: Phase 1 (Assumptions)
   generates the questions, Phase 3 (First Principles) decomposes,
   Phase 5 (Convergence) produces the execution plan. This is the
   bridge between ForgeMind cognition and ForgeClaw execution.

5. **Three.js Particle Orb** (`frontend/orb.ts`) — lower priority
   Audio-reactive ambient visualization. We'll adapt it as a
   processing-state UI element for ForgeMind (cyberpunk aesthetic).
   Linux-compatible since it's browser-based.

**What we're skipping:**
Everything macOS-specific — AppleScript integrations (Calendar, Mail,
Notes), Fish Audio TTS, Swift desktop overlay, Web Speech API.
On Linux we'll replace voice input with Whisper when that time comes.

**Current build order:**
1. Deploy ForgeMind to GitHub Pages (wifi pending)
2. Port dispatch registry as `fm_dispatch.py`
3. Add SQLite FTS5 to ForgeMind Next alongside FAISS
4. Implement FM action tags in Ollama response parser
5. Connect ForgeMind → ForgeClaw pipeline

**Stack reminder:**
- ForgeMind engine: Deno on port 3001
- Ollama: port 11434, model qwen2.5:1.8b
- ForgeMind UI: port 5173
- ForgeMind Next: Streamlit + Qwen2.5-7B + FAISS
- ForgeClaw: Vite + React + TS → GitHub Pages
- Training corpus: ~/forge-mind/corpus/forge-mind-v1.jsonl
- NEXUS KB: committed, includes SF-STRM-001

**Guardian LLM status:** long-term target. `learning.py` + `evolution.py`
from JARVIS are reference implementations for automated heuristic capture.
Study these when we reach corpus automation phase.

---

## 7. NOTES + OBSERVATIONS

- JARVIS `server.py` is ~2300 lines — monolithic. Our separation of
  concerns (engine / UI / corpus) is already cleaner architecture.
- `ab_testing.py` is interesting — JARVIS A/B tests prompt variants
  automatically. Worth revisiting for ForgeMind prompt optimization.
- `suggestions.py` + `monitor.py` implement proactive behavior —
  the assistant initiates without being asked. Long-term Guardian
  LLM behavior pattern.
- `qa.py` has quality assurance hooks on LLM outputs — worth studying
  for ForgeMind's reflect stage in the think→respond→reflect→store loop.
- JARVIS uses Claude Haiku for speed + Claude Opus for depth. We're
  doing the inverse: local Qwen for speed, Claude API for heavy lifting.
  Same dual-model philosophy, different implementation.

---

**Entry Status:** ACTIVE  
**Next Action:** Begin Phase A — deploy ForgeMind, port dispatch registry  
**Linked Entries:** SF-STRM-001 (Distributed Stream Processing)
