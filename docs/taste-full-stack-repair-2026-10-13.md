# NEXUS Taste full-stack repair — 2026-10-13

## Scope

This change completes the existing ForgeClaw ↔ `nexus-taste` integration from the provider client through the chat lifecycle and Settings UI. The `nexus-taste` repository is currently a Sprint-1 Python pipeline/library; it does not contain an HTTP server, so the ForgeClaw client continues to target the separately deployed service contract at `http://127.0.0.1:8377/v1`.

## Implemented

- Preserved and integrated the existing tested Taste extraction, feedback, and generation-profile path.
- Removed the accidental root file named `undefined`.
- Made the provider health check real: `tasteProvider.isConfigured()` now probes `GET /health` asynchronously instead of returning `true`.
- Registered Taste in the provider router as an auxiliary provider. It is visible to provider status/configuration code but remains intentionally non-routable for chat (`send()` fails with an explicit message).
- Made provider configuration checks awaitable without changing synchronous providers.
- Replaced `unknown[]` profile clusters with the typed `TasteCluster` shape.
- Removed the undocumented `dimension` field from feedback requests.
- Added exponential polling backoff (`2s → 4s → 8s → 16s → 30s`) with the existing 120-second deadline.
- Propagated `AbortSignal` into health, extract, and job-poll requests. Chat cleanup aborts an in-flight optional taste extraction on unmount or when a newer image extraction starts.
- Added endpoint persistence via `fc_taste_endpoint` and a Settings panel that shows live health status, allows saving the endpoint, and clearly labels Taste as optional.
- Kept Taste additive: an unavailable service never blocks chat or image generation.
- Audited `forgeclaw/orchestrator/integrity_gate.ts`; it is not imported by the current runtime, so it was left intact as a standalone governance module rather than deleted.

## Verification

- ForgeClaw focused Vitest: provider router and Taste client tests pass (`8 tests`).
- ForgeClaw `npm run build`: passes (TypeScript, ESLint, and Vite production bundle).
- ForgeClaw `git diff --check`: clean.
- `nexus-taste` backend test suite: requires the repository's Python test dependencies (`pytest`); the sandbox system interpreter does not currently include them.

## Operational note

If the UI reports a missing GitHub token while the field is privacy-masked, open **Settings → GitHub Token** and click **Save** once. The prefilled token is retained; no new token needs to be generated.
