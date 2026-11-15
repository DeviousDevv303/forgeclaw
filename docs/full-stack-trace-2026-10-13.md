# ForgeClaw ↔ NEXUS Taste full-stack trace — 2026-10-13

## Environment

- ForgeClaw: `main`, tested after the health-cache amendment.
- nexus-taste: `feat/nexus-taste-provider-v1`, mock VLM + mock embedder.
- Service: `PYTHONPATH=src python -m nexus_taste.server`, loopback `127.0.0.1:8377`.
- Image: generated 16×16 PNG fixture, client image ID `trace-image-1`.
- No credentials were included in the trace.

## Hop-by-hop trace

| Step | Request | Response | State change / owner |
|---|---|---|---|
| 1 | `GET /v1/health` | `200`, `status=ok`, `siglip_loaded=true`, `vlm_loaded=true`, `event_count=0` | Service readiness; nexus-taste owns model readiness. |
| 2 | `POST /v1/extract` with base64 PNG and `image_id=trace-image-1` | `202`, job ID `895febf3-7091-41d8-ab73-ead327d8d59d` | ForgeClaw creates an optional Taste job; chat remains independent. |
| 3 | `GET /v1/extract/{job_id}` | `200`, `status=pending` for polls 1–15 | ForgeClaw client polls with bounded backoff; service owns job state. |
| 4 | `GET /v1/extract/{job_id}` | `200`, `status=complete`, `extraction_model=mock-vlm-v1`, `prompt_version=v1`, five features at confidence `0.9` | ForgeClaw stores `tasteImageId` on the uploaded message; feedback controls become eligible. |
| 5 | `POST /v1/feedback` with `signal=fire` | `200`, `routing=attraction`, `update_type=attract`, all five dimensions updated | nexus-taste updates its persisted centroid state. |
| 6 | `POST /v1/profile` with `format=generation` | `200`, `prompt_positive=""`, `prompt_negative=""`, `fallback_active=true`, `event_count=1` | Maturity guard prevents immature taste state from changing generation prompts. |
| 7 | `POST /v1/profile` with `format=full` | `200`, centroid/confidence returned, `clusters=[]` | Full state inspection; no clusters exist in the current Sprint-2 service state. |

## Contract checks

- `GET /v1/health`: passed.
- `POST /v1/extract`: passed with `202`.
- Polling: passed through pending to complete.
- Extract features: five valid normalized features returned.
- `POST /v1/feedback`: passed with `200`.
- Explicit `dimension` override: automated contract test confirms it wins over text mapping.
- `POST /v1/profile` generation amendment: automated contract test confirms top-level string fields `prompt_positive` and `prompt_negative` are present.
- Immature model behavior: observed `fallback_active=true` at event count 1.
- Health caching: ForgeClaw client test confirms concurrent deduplication and a 30-second TTL.

## UI and Corpus boundary

The browser-side upload path dispatches the Taste extraction independently from the existing local Corpus path. Taste extraction is optional and abortable: component unmount or a replacement upload cancels the current request. The message renders Taste feedback controls only after `tasteImageId` is recorded. GitHub token persistence remains in Settings; a privacy-masked prefilled token is activated by opening **Settings → GitHub Token** and clicking **Save**.

The live HTTP trace ran the service and bridge endpoints directly. Browser Network/localStorage inspection was not required for the service contract assertions; the UI ownership is covered by the ForgeClaw build and source path above.

## Verification results

- ForgeClaw: `npm run build` passed.
- ForgeClaw: `199 passed, 8 skipped` via `npm run test:run`.
- nexus-taste: `17 passed` via mock-mode `.venv/bin/pytest tests/ -q`.
- `git diff --check`: clean in both repositories before commit.

## Not started

Generation-upgrade work beyond consuming the mature generation profile was intentionally not started. It remains sequenced after merge-gate fixes and the trace, as required by the directive.
