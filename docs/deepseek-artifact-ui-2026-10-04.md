
## Follow-up: WebGPU coding fallback

A second failure mode appeared when llama.cpp was unavailable. The UI still entered the WebGPU fallback, but the selected provider state advertised native tools. A small browser model could emit token soup instead of its first `github_repo_state` call; the runtime then correctly refused to claim repository completion, but no repository work occurred.

The router now deterministically emits a read-only `github_repo_state` bootstrap call when all of the following are true:

- the selected runtime is browser-local WebGPU/NEXUS;
- the request exposes `github_repo_state`;
- no GitHub tool result exists yet; and
- the latest request is clearly repository-oriented.

This preserves ordinary chat behavior, keeps Guardian and tool authority in the existing dispatcher, and ensures the UI receives actual repository evidence before the WebGPU model is asked to continue.
