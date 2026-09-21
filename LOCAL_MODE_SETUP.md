# ForgeClaw Local Mode Runtime Setup

This guide explains how to provide the local runtime required by ForgeClaw Local Mode. It documents the boundary between the ForgeClaw application, the `llama.cpp` server, the GGUF model, and the machine that runs them.

**This document describes runtime setup. It does not describe ForgeClaw code changes; none are required for Local Mode v0.1.**

## Scope and environment boundary

**ForgeClaw Local Mode** is the application-side provider implementation. It sends OpenAI-compatible requests to a configured local endpoint. The provider does not include an LLM model and does not start `llama-server` for the user.

**`llama.cpp`** supplies the local `llama-server` process. That process loads a GGUF model and exposes an HTTP API.

**The GGUF model** is a separate model file. The server cannot answer requests until that file has been downloaded and loaded successfully.

**The user's machine** must run both `llama-server` and the browser or application that is making the request when the endpoint is configured as `http://127.0.0.1:8080/v1`. The address `127.0.0.1` is the loopback address of the machine running the browser or application.

**The Manus acceptance sandbox** was a temporary environment used to verify Local Mode v0.1. Its absolute paths and running processes are not automatically present on the user's machine. The acceptance run does not install or permanently manage the runtime on another computer.

## Acceptance configuration

The Local Mode acceptance test used these parameters:

| Setting | Acceptance value |
|---|---|
| ForgeClaw endpoint | `http://127.0.0.1:8080/v1` |
| `llama-server` host | `127.0.0.1` |
| `llama-server` port | `8080` |
| Context size | `4096` |
| GPU layers | `0` (CPU-only) |
| Parallel request lanes | `1` |
| Model | Qwen2.5 1.5B Instruct Q4_K_M GGUF |
| Acceptance model filename | `qwen2.5-1.5b-instruct-q4_k_m.gguf` |
| Model file SHA-256 (`qwen2.5-1.5b-instruct-q4_k_m.gguf`) | `6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e` |

This model-file SHA-256 was calculated in the temporary acceptance environment. The recommended model source is the official `Qwen/Qwen2.5-1.5B-Instruct-GGUF` repository. After downloading `qwen2.5-1.5b-instruct-q4_k_m.gguf` locally, compute `sha256sum` and compare it with the value above. If it differs, record the discrepancy rather than assuming equivalence. The exact source used to obtain the acceptance artifact was not recorded in the existing project evidence.

## Obtaining the runtime

Obtain `llama.cpp` from the official project using one of its documented installation options. The official release page provides pre-built binaries without requiring users to pin one specific release tag or binary asset. The official project also documents building from source with CMake, Docker, and platform-specific installation routes.

For a source build, the official server documentation gives this pattern:

```bash
cmake -B build
cmake --build build --config Release -t llama-server
```

The resulting binary is normally located at `./build/bin/llama-server` relative to the `llama.cpp` checkout. On Windows, use the corresponding `.exe` path and PowerShell command syntax. The official Qwen model page also documents `llama.cpp` installation and model-serving options for macOS, Linux, and Windows.

The official project documents Docker as another option. A Docker deployment must publish the container's port 8080 and mount the directory containing the model. Adapt the official example to the selected model path rather than copying the Manus sandbox paths.

## Obtain and place the GGUF model

Use the official Qwen model repository:

```text
Qwen/Qwen2.5-1.5B-Instruct-GGUF
```

Use this exact file for the acceptance configuration:

```text
qwen2.5-1.5b-instruct-q4_k_m.gguf
```

Do not substitute Qwen2, Qwen2.5 0.5B, or another model when reproducing this acceptance configuration. Place the file in a predictable local directory, for example:

```text
/path/to/models/qwen2.5-1.5b-instruct-q4_k_m.gguf
```

The `/path/to/...` values are placeholders. They are not expected to exist literally on your machine.

After downloading, calculate the file hash locally:

```bash
sha256sum /path/to/models/qwen2.5-1.5b-instruct-q4_k_m.gguf
```

Compare the result with the documented acceptance hash. A different digest means the file is not the same artifact used in the Manus acceptance sandbox. It may still be a valid model, but it is not acceptance-artifact identity evidence.

## Start `llama-server`

The current `llama-server` flags corresponding to the acceptance values are shown below. Replace the placeholders with paths that exist on your own machine:

```bash
/path/to/llama-server \
  --model /path/to/models/qwen2.5-1.5b-instruct-q4_k_m.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  --ctx-size 4096 \
  --n-gpu-layers 0 \
  --parallel 1
```

`/path/to/llama-server` and `/path/to/models/...` are placeholders. The absolute paths from the temporary Manus sandbox belonged only to the temporary Manus sandbox and must not be copied as user-machine paths.

The recorded acceptance command used the short aliases `-m`, `-c`, and `-ngl` with the same values. The current long names above preserve the acceptance configuration without silently changing it:

```text
-m /path/to/models/qwen2.5-1.5b-instruct-q4_k_m.gguf  =  --model ...
-c 4096                                              =  --ctx-size 4096
-ngl 0                                               =  --n-gpu-layers 0
--parallel 1                                         =  --parallel 1
```

On Windows PowerShell, use the executable and model paths appropriate to Windows:

```powershell
C:\path\to\llama-server.exe `
  --model C:\path\to\models\qwen2.5-1.5b-instruct-q4_k_m.gguf `
  --host 127.0.0.1 `
  --port 8080 `
  --ctx-size 4096 `
  --n-gpu-layers 0 `
  --parallel 1
```

The command must remain running while ForgeClaw uses Local Mode. Closing the terminal or stopping the process makes the endpoint unavailable.

## Verifying the runtime in layers

A successful `/v1/models` response is only a server-level check. It is not, by itself, proof that ForgeClaw Local Mode works. `/health` and `/v1/models` prove HTTP availability and model exposure only; they do not prove ForgeClaw Local Mode works. Verify the complete chain in order:

```text
llama-server process running
        ↓
127.0.0.1:8080 reachable
        ↓
expected GGUF successfully loaded
        ↓
OpenAI-compatible /v1 surface responds
        ↓
ForgeClaw LocalInferenceProvider reaches that endpoint
        ↓
actual ForgeClaw inference succeeds
        ↓
tool calling and managed-agent behavior can be exercised
```


### Diagnostic ladder

Use the failure location to separate runtime failures from application failures:

- **Server up, `/health` fails:** `llama-server` or port binding is broken.
- **`/health` returns 200, but `/v1/models` is empty or identifies the wrong model:** the GGUF failed to load or the command points to the wrong file.
- **`/v1/models` is correct, but ForgeClaw inference fails:** investigate ForgeClaw's provider or endpoint configuration rather than the basic runtime.
- **ForgeClaw inference succeeds, but tool calling fails:** investigate model chat-template or tool-calling compatibility rather than HTTP transport.

### Check that port 8080 is listening

Linux:

```bash
ss -ltnp | grep ':8080'
```

macOS:

```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN
```

Windows PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 8080 -State Listen
```

A listener confirms that a process owns the port. It does not confirm that the expected model loaded.

### Check `/health`

Run:

```bash
curl --fail --show-error http://127.0.0.1:8080/health
```

When the model is loaded and the server is ready, the official server documentation describes an HTTP 200 response with a status such as:

```json
{"status":"ok"}
```

A 503 response indicates that the model is still loading or unavailable. Wait for readiness and inspect the server's terminal output before continuing.

### Check `/v1/models`

Run:

```bash
curl --fail --show-error http://127.0.0.1:8080/v1/models
```

The response should list the loaded model. Confirm that the returned model metadata identifies a GGUF model and that the loaded file is the intended Qwen artifact. This confirms the OpenAI-compatible model-list surface and model loading, but it does not confirm ForgeClaw application behavior.

### Configure ForgeClaw

In ForgeClaw's Local Mode settings, select:

```text
Runtime Provider: Local Inference (llama.cpp)
```

Set the endpoint to exactly:

```text
http://127.0.0.1:8080/v1
```

The `/v1` suffix is required for the OpenAI-compatible provider path. Do not use `/health` or `/v1/models` as the ForgeClaw provider endpoint.

### Perform application-level verification

ForgeClaw is the provider/application integration. `llama.cpp` and `llama-server` are the local inference server. GGUF is the model file. ForgeClaw does not bundle the GGUF model and does not automatically start `llama-server`.

Use ForgeClaw's **TEST LOCAL ENDPOINT** control first. Then send an ordinary user request through the ForgeClaw chat interface. The successful test must travel through ForgeClaw's `LocalInferenceProvider`; a direct `curl` result alone is insufficient.

For a fuller Local Mode check, exercise a request that uses a supported local tool and then confirm that the managed-agent loop receives the model response, executes the tool, and returns the result. The acceptance test verified this path with native `run_js` tool calling and an offline result of `42`.

## Troubleshooting

### `Failed to fetch`

> `Failed to fetch` is a client-side fetch failure. `127.0.0.1` refers to the loopback interface of the machine making the request. If `llama-server` is not running on that same machine at port 8080, ForgeClaw cannot reach it.

The Manus sandbox is temporary, and its absolute paths do not exist automatically on the user's machine. First verify `/health` directly from the same machine and browser environment. If `curl` fails, start the server and inspect its terminal output. If `curl` succeeds but ForgeClaw still fails, verify the endpoint includes `/v1`, check the browser's displayed endpoint value, and confirm that the browser is not running on a different machine or isolated environment.

### Nothing is listening on port 8080

The server is not running, is still starting, or is configured for another port. Start it with `--port 8080`, or change the ForgeClaw endpoint to the port actually in use. Do not assume that a model file by itself starts a server.

### `llama-server` executable not found

The executable is not on the shell `PATH`, or it was not built or installed. Use the absolute path to the binary, locate the official pre-built release for your operating system, or build the server from source using the official CMake instructions.

### GGUF file not found

The path after `-m` is wrong, the file was moved, or the command is being run from a different machine. Replace the placeholder with the absolute or correctly resolved path to the model on the machine running `llama-server`.

### Model fails to load

Inspect the server's startup output. Common evidence includes a corrupt or incomplete file, an unsupported model format, insufficient memory, or a path that resolves to a directory instead of a file. Verify the file size and, when reproducing the acceptance artifact, compare its SHA-256 with the documented acceptance digest.

### Port 8080 is already occupied

Identify the process holding the port. Either stop that process if it is safe to do so, start `llama-server` on another port, or configure ForgeClaw to use the alternate port. Do not start a second server on the same port.

### ForgeClaw points at the wrong endpoint

Use:

```text
http://127.0.0.1:8080/v1
```

Do not enter the server's `/health` URL, the `/v1/models` URL, a model filename, or the temporary Manus sandbox path. If the server runs on another port, update the ForgeClaw endpoint to that port while retaining the `/v1` suffix.

## Hardware and acceptance limitations

The previous Local Mode v0.1 acceptance run was performed in a **24 GiB Manus sandbox**. In that environment, the peak combined workload was approximately **3,577 MiB**, and the `llama-server` process was approximately **1,366 MiB RSS** at final capture. The server used CPU inference with `--n-gpu-layers 0`.

These sandbox measurements do **not** constitute acceptance on 8 GB hardware and must not be presented as proof that any 8 GB machine will run this configuration. The 8 GB target-machine acceptance remains **NOT VERIFIED**. Hardware-specific changes such as selecting a smaller model, reducing context, or changing execution settings are recommendations for a separate evaluation, not acceptance evidence from this guide.

The Manus sandbox was temporary. Its absolute paths and running processes do not exist automatically on the user's machine.

## References

[1]: https://github.com/ggml-org/llama.cpp "Official llama.cpp repository and installation options"
[2]: https://github.com/ggml-org/llama.cpp/tree/master/tools/server "Official llama.cpp server documentation"
[3]: https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md "Official llama.cpp build documentation"
[4]: https://github.com/ggml-org/llama.cpp/blob/master/docs/docker.md "Official llama.cpp Docker documentation"
[5]: https://github.com/ggml-org/llama.cpp/releases "Official llama.cpp releases"
[6]: https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF "Official Qwen2.5 1.5B Instruct GGUF repository"
