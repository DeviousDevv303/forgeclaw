# Form filling for the browser agent: read-only design (NO CODE)

Status: **PROPOSED**. Written against `main` @ `1ee0026` (+ branch `claude/forgeclaw-refactor-audit-b5ydc0`). Requested by the operator
under the NEXUS standing pre-approval (2026-10-27): "scope it, read-only design first; propose the real gate for draft-fill-only;
cover credentials/session audit, CAPTCHA handoff, journaling and screenshots." Instruction is not a control; this design says where each control lives.

## 1. What exists (verified in code)

| Fact | Evidence |
|---|---|
| The browser runs as a GitHub Actions job: fresh Chromium, **blank page every round**, replays the whole action list. No cookies, no stored login. | `scripts/browser-agent.cjs` header, `main()`; `browser-agent.yml` (`browse` job: `contents: read`, `persist-credentials: false`) |
| Password fields are refused; no downloads; private addresses refused for navigations and every sub-request. | `runAction` (`kind === 'password'`), `context.route('**/*')`, `acceptDownloads: false` |
| Three actions can submit a form: `type` with `submit:true` (presses Enter), `press` Enter, `click` on a submit control. | `validateActions`, `runAction` |
| Every round is published to branch `browser-results` **of this repository**: `result.json` (page text up to 4,000 chars, 60 element names incl. `value` attributes) and `screen.jpg`, as git history. | `.github/scripts/browser_mirror.sh` |
| The typed text travels as the `actions_json` **workflow_dispatch input**. | `browser-agent.yml` inputs |
| **The repository is public** (`visibility: public`). | GitHub API, 2026-10-27 |
| The guidance "never enter passwords, payment or personal details; stop at a captcha" is a prompt string. | `BROWSER_GUIDANCE`, `toolExposure.ts:296` |
| Under the default `autonomous` posture `browser_run` needs no co-sign. That is the owner's directive (2026-10-25), unchanged here. | `guardianGate.ts:88` returns before the browser rule at `:91` |
| Live `browser-agent.yml` runs ever: **0** (checked 2026-10-27). | GitHub Actions API |

## 2. Findings that shape the design

1. **Public exposure.** Anything typed into a form, and any screenshot of a filled form, is published to a public repo permanently (dispatch input,
   run page, `browser-results` history). Personal data must never go through this path. The prompt rule against it is the only control today.
2. **"Fill it, then you press submit" has no handoff.** The filled page exists only inside the runner and dies with it; the operator cannot take over that
   session. So draft-fill on the current architecture can *analyse a form, dry-run the fill and prove it with a screenshot*, but not hand a live form to a person.
3. **Logged-in forms are unreachable by construction** (no login, no password input). Government, medical and financial portals need a login, so they are
   out of scope because the runner cannot reach them, not because a policy says so. Any credential or session custody would be a new authority surface.
4. **Draft-only must not depend on the Guardian posture.** Under `autonomous` nothing is co-signed, so a co-sign rule cannot be the gate.

## 3. Proposed controls (layered; each names where it lives)

**C1. Runner write-block (the real gate for "draft only").** In `scripts/browser-agent.cjs`, default ON (`BROWSER_AGENT_ALLOW_WRITES` must be exactly `true`
to disable; the workflow never sets it, so no YAML change is needed for v1):
- in the existing `context.route('**/*')` handler, abort any request whose method is not `GET`/`HEAD`/`OPTIONS` (`route.abort('blockedbyclient')`) and record
  `{n, type, ok:false, note:'write blocked (draft mode): POST <host>'}`;
- `page.addInitScript` installing a capturing `submit` listener that calls `preventDefault()` and overrides `HTMLFormElement.prototype.submit/requestSubmit`, so a
  GET-method form cannot submit either; record `form submit blocked`.
- Residual risk, to be stated in the tool result: a GET request with side effects triggered by page script, and WebSockets (not covered by `route`). Unverified whether the pinned Playwright 1.64.1 exposes `routeWebSocket`.
**C2. No model-controllable switch.** There is no tool parameter that enables writes. A switch in `localStorage` would not be safe: under `autonomous`, `run_js` is
unsandboxed and can write it. If a submit mode is ever wanted it must come from outside the app (a repository variable the workflow reads), and that is a separate decision (§6).
**C3. PII guard at the handler (`forgeTools.ts`, pre-authorized).** Before dispatch, refuse `type` text that looks like personal data (email, phone, SSN-shaped, Luhn-valid card number,
street-address pattern) with a `[TOOL ERROR]` that says why. Heuristic and bypassable; it is a backstop for C1's scope, not a privacy guarantee. Also drop input `value` attributes from `elements` in `snapshot()`.
**C4. CAPTCHA = stop.** Detect `iframe[src*=recaptcha|hcaptcha|turnstile]`, challenge text and known challenge selectors; on detection end the round with
`ok:false`, a note `captcha_detected`, and the screenshot. There is no solver and none may be added (guard test below). Detection is best-effort; a missed CAPTCHA fails at the next action, not silently.
**C5. Journal.** Each round already has an invocation id and is mirrored. Add a NEXUS learning/journal record per fill: invocation id, URL host, field labels, a SHA-256 of each typed value (never the value), step results, and
"writes blocked: N". Screenshots stay in the public mirror, hence the v1 scope below.

## 4. v1 scope (recommended)

Public forms that need **no login and no personal data**: form discovery and field mapping, dry-run fill with non-personal sample values, screenshot proof, validation-message capture.
Not in v1: submission, login, personal data, payments, government/medical/financial portals.

## 5. v2 (design only): a local headed runner

The only architecture that gives a real draft-then-you-submit handoff, private data and logged-in sessions is a runner on the **operator's own machine** (Playwright, headed), where the operator presses submit and
nothing leaves the machine. That is a different runtime: it needs its own credential-custody design (sessions never in prompts, logs, repository or training data), a private result channel, and a fresh Guardian review. Not started.

## 6. Tests required (before any code merges)

1. Local fixture server + real Chromium (skipped when no browser, like `browserAgentWorkflow.test.ts`): a POST form submitted three ways (click, `type submit:true`, `press Enter`) results in **0 write requests at the server** and a "write blocked" step.
2. A GET-method form is blocked by the submit listener (0 requests).
3. Default-on: with the env var unset the runner blocks writes; only the literal `true` disables it.
4. A CAPTCHA fixture ends the round with `captcha_detected`.
5. Handler unit tests: PII-shaped text refused before any network call; non-PII text dispatched.
6. `result.json` of a filled form contains no typed value.
7. Guard test: `package.json` has no CAPTCHA-solving dependency.
8. Enumeration: a test fails if a new action type is added to `ACTION_TYPES` without an explicit draft-mode decision.

## 7. Authorizations this design would need

- `scripts/browser-agent.cjs`: **protected** (`scripts/` in `.github/protected-paths.txt`); not covered by the standing pre-approval. Named authorization needed.
- `src/lib/forgeTools.ts` (C3, C5): pre-authorized for the NEXUS track; the commit must flag it.
- `.github/workflows/browser-agent.yml`: not needed for v1. If a repo-variable submit mode is ever added, rule-18 flag first.
- `src/lib/toolExposure.ts` guidance text: not protected by the policy file, but listed by the audit directive.

## 8. Open and unverified

- Live behaviour: **zero** `browser_run` workflow runs exist; nothing here has been observed end to end.
- Whether the app's GitHub token can set repository variables (decides whether C2's off-device switch is safe).
- Whether any site tolerates being driven this way (terms of service not reviewed).
- Residual side-effect paths in C1.
