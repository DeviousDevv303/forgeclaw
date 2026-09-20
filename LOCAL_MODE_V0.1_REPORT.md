# ForgeClaw Local Mode v0.1 — Milestone Report

**Repository:** `DeviousDevv303/forgeclaw`  
**Branch:** `main`  
**Commit inspected:** `b0860b5`  
**Report status:** verified findings from the current sandbox run

## Conclusion

ForgeClaw now has a provider-agnostic Local Mode path that communicates with an OpenAI-compatible local inference server. The initial runtime uses **llama.cpp** with **Qwen2.5 1.5B Instruct, Q4_K_M GGUF**. The application boots through Vite without an OpenRouter key, the local provider completes inference, llama.cpp emits a native tool call, the managed-agent loop returns successfully, and an offline `run_js` tool execution was verified.

The hardware result is positive for this sandbox, but it is not a valid acceptance result for the stated 8 GB laptop because the sandbox exposed **24 GiB of RAM** during the runtime test. The provisional 6.5 GB ceiling therefore remains unvalidated for the target machine.

## Status by required category

| Category | Status | Evidence |
|---|---|---|
| Planned | Completed | Local provider, llama.cpp transport, Q4 GGUF runtime, smoke tests, and RAM measurement were scoped before implementation. |
| Attempted | Completed | Repository boot, provider integration, local server startup, inference, tool call, managed-agent path, and workload measurement were run. |
| Completed | Completed | Local provider registration, UI selection, endpoint configuration, health check, model selection, and test coverage were added. |
| Verified | Completed for the available sandbox | Build, lint, four Local Mode tests, Vite HTTP response, llama.cpp `/v1/models`, inference responses, tool response, and RAM samples were verified. |
| Blocked | Target hardware acceptance | The current sandbox reports 24 GiB total RAM rather than the specified 8 GB machine. Full browser-driven UI interaction was not separately automated in this run. |

## Repository and baseline state

The repository was cloned from the authorized public `main` branch. Before changes, `npm ci` completed successfully. The baseline `npm run build`, `npm run lint`, and `npm run test:run` commands passed. The repository had no test files before the Local Mode smoke test was added.

The existing provider architecture consisted of OpenRouter and Moonshot adapters behind shared `AIProvider`, router, and model-bridge contracts. The application defaulted to OpenRouter and required a cloud key for the active execution path.

## Implemented Local Mode path

The new `localInferenceProvider` implements the existing `AIProvider` contract. It uses an OpenAI-compatible HTTP endpoint and does not require an API key. The default endpoint is `http://127.0.0.1:8080/v1`; the UI allows an operator to override it. The adapter supports non-streaming and streaming chat completions, native tool schemas, native tool-call response parsing, and a `/v1/models` health check.

The provider was registered in `providerRouter.ts` and `modelProviders.ts`. Local Mode is now the default provider for a new session, while OpenRouter and Moonshot remain available as optional providers. The existing cloud-provider adapters were not removed or replaced.

The App settings UI now exposes Local Inference, the local GGUF model entry, the llama.cpp endpoint, a local endpoint health check, and Local Mode diagnostics. The endpoint is stored in browser local storage under `fm_local_endpoint`; no cloud credential is required.

## Local runtime used

The runtime was built from the current llama.cpp repository with the server target enabled. The server was started with a CPU-only configuration and one serialized request lane:

```text
llama-server \
  -m /home/ubuntu/models/qwen2.5-1.5b-instruct-q4_k_m.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  -c 4096 \
  -ngl 0 \
  --parallel 1
```

The selected model was `qwen2.5-1.5b-instruct-q4_k_m.gguf`. The server reported a GGUF size of **1,111,370,240 bytes**, approximately **1.1 GiB**, and identified the quantization as **Q4_K - Medium**. The runtime reported `n_params=1,777,088,000` and `n_ctx=4096`.

## Runtime verification

The llama.cpp endpoint returned a valid model list from `/v1/models`. The ForgeClaw provider smoke test then sent a chat completion through `callProvider('local', ...)` rather than calling the model independently. The response had `provider: 'local'` and contained generated text.

A second request sent the ForgeClaw tool schema for `run_js`. The model returned a native function call with the following effective request:

```json
{
  "name": "run_js",
  "arguments": "{\"code\": \"6 * 7\"}"
}
```

The local tool executor separately executed that call offline and returned `42`. The bounded managed-agent loop also completed through the Local provider. These paths are covered by four passing Vitest tests in `localInferenceProvider.test.ts`.

The Vite application responded with HTTP 200 at the served `/forgeclaw/` path. The production build generated successfully after the Local Mode changes.

## Combined RAM measurement

The measurement included the operating system, llama.cpp server and model, the Vite development runtime, and repeated local inference requests including a tool-schema request. It did not measure only the model.

| Measurement | Result |
|---|---:|
| Sandbox RAM reported before runtime work | 7.8 GiB total in the initial baseline check |
| RAM reported during the completed runtime measurement | 23 GiB displayed by `free -h`; 24 GiB total from `/proc/meminfo` |
| Combined-workload baseline used RAM | 3,542 MiB |
| After server and Vite readiness checks | 3,542 MiB |
| Peak during three inference requests | 3,546 MiB |
| Peak during tool-schema inference | 3,577 MiB |
| Peak swap used | 0 MiB |
| llama-server RSS at final capture | 1,366 MiB |
| Vite Node RSS at final capture | 245 MiB |
| Provisional 6.5 GB ceiling | Not applicable to this sandbox result |

The complete raw sample log is preserved in `local-mode-measurement.txt`. The sandbox dynamically exposed more memory after the initial baseline, so this run cannot prove whether the same workload stays below 6.5 GB on the operator's 8 GB machine. The target-machine measurement must be repeated on that hardware.

## Failure taxonomy investigation

The apparent taxonomy conflict is currently a layering issue rather than a direct naming collision.

`src/lib/agentCore.ts` defines execution and tool failure classes: `TOOL_FAILURE`, `AUTH_FAILURE`, `NETWORK_FAILURE`, `DEPENDENCY_FAILURE`, `INVALID_ASSUMPTION`, `USER_CONSTRAINT`, and `UNKNOWN`. The file contains both `classifyFailure` and the richer regex-based `classifyToolFailure`, which are two classifiers for the same execution-level vocabulary and should be reviewed later for canonicalization.

`src/lib/ai/types.ts` defines provider/API error classes: `AUTH_FAILURE`, `RATE_LIMIT`, `NETWORK_FAILURE`, `CONTENT_POLICY`, `INSUFFICIENT_FUNDS`, and `UNKNOWN`. These are concerned with transport and provider responses.

The earlier design terms `BUILD_FAILURE`, `TYPE_FAILURE`, `CONTEXT_DRIFT`, `HALLUCINATION`, `SECURITY_RISK`, `API_TIMEOUT`, `TOOL_MISUSE`, and `LOGIC_CONFLICT` were not found in the current source tree. They should not be silently reintroduced or deleted. The evidence supports a future layered model: provider errors feed an execution-failure layer, while execution failures may later receive diagnostic subcategories. No taxonomy rewrite was performed in this milestone.

## Licensing state

The license conflict was not modified. `README.md` states **MIT**, while `LICENSE` begins with **ForgeClaw Proprietary Source-Available License** and source headers describe a proprietary source-available license requiring written permission for commercial use. No license file, README licensing statement, or source-header licensing statement was changed.

## Validation commands

The final validation completed successfully:

```text
npm run build
npm run lint
npm run test:run
```

The final test run reported **1 test file and 4 tests passed**. The only build note was the existing Browserslist database age warning.

## Remaining limitations and next authorized step

Local Mode v0.1 is implemented and verified against the available sandbox. The remaining acceptance gap is hardware-specific: repeat the same combined workload on the stated 8 GB laptop and record whether peak total system RAM remains at or below approximately 6.5 GB without OOM, crashes, or serious instability.

If the target machine fails that test, the next decision should be made from evidence using the directive's smaller-model, serialized-execution, or honest Local/Hybrid boundary options. No such decision was made silently here.

## References

[1]: https://github.com/ggml-org/llama.cpp "llama.cpp repository"

[2]: https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF "Qwen2.5 1.5B Instruct GGUF model repository"
