# NEXUS/CORPUS Termux Runtime

NEXUS is a native, offline-first runtime for ForgeClaw. It loads a locally provisioned GGUF directly through the pinned `llama.cpp` submodule; it does not use Ollama, `llama-server`, OpenRouter, or cloud inference.

## Normal operator workflow

From the ForgeClaw repository, run one command:

```sh
./nexus/termux/forgeclaw-start.sh
```

The launcher automatically:

- Finds the approved Qwen GGUF in the standard Termux model locations.
- Verifies its SHA-256 before starting anything.
- Exports `NETWORK=OFF` and `OLLAMA=OFF`.
- Reuses a healthy NEXUS daemon and local bridge.
- Starts only missing or unhealthy processes.
- Recovers once from stale runtime state owned by the launcher.
- Checks daemon status and bridge `STATUS` readiness.
- Prevents duplicate launcher-owned processes.
- Fails with a clear error if the runtime cannot become ready.

Socket paths and local TCP details are internal launcher implementation details. The normal operator does not need to enter model paths, SHA values, socket paths, or ports. ForgeClaw uses its existing local NEXUS endpoint configuration after the launcher reports readiness.

The optional stop command stops only processes recorded as launcher-owned:

```sh
./nexus/termux/forgeclaw-stop.sh
```

A Termux:Widget shortcut may invoke `forgeclaw-start.sh` for one-tap startup. Android may stop background processes under battery optimization, so rerunning the launcher is safe and performs the same health checks rather than blindly starting duplicates. Opening the existing ForgeClaw Pages entry remains a separate optional convenience; browser launching is not required for runtime startup.

## Model provisioning

Provision the approved Qwen GGUF outside Git. The launcher verifies this exact artifact:

```text
Model: Qwen2.5-1.5B-Instruct-GGUF Q4_K_M
Filename: qwen2.5-1.5b-instruct-q4_k_m.gguf
SHA-256: 6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e
```

The authoritative source is:

<https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf>

The launcher checks these locations in order:

```text
$NEXUS_MODEL, when explicitly set
$PREFIX/var/lib/forgeclaw/nexus/qwen2.5-1.5b-instruct-q4_k_m.gguf
$HOME/storage/shared/Download/qwen2.5-1.5b-instruct-q4_k_m.gguf
$HOME/storage/downloads/qwen2.5-1.5b-instruct-q4_k_m.gguf
<repository>/models/nexus/qwen2.5-1.5b-instruct-q4_k_m.gguf
```

NEXUS refuses to load a model when the calculated digest differs from the expected digest.

## Build once on Termux

If the native binaries are not already built:

```sh
pkg install -y cmake ninja clang coreutils
git submodule update --init --recursive
cmake -S nexus/native -B build/nexus-native -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_COMPILER=clang \
  -DCMAKE_CXX_COMPILER=clang++ \
  -DGGML_NATIVE=OFF \
  -DGGML_OPENMP=OFF \
  -DGGML_LLAMAFILE=OFF \
  -DLLAMA_OPENSSL=OFF \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=OFF \
  -DLLAMA_BUILD_TOOLS=OFF \
  -DLLAMA_BUILD_SERVER=OFF
cmake --build build/nexus-native --target nexusd nexus-http-bridge nexus-cli nexus-corpus-selftest
```

The launcher then performs all normal startup and readiness work.

## Diagnostic commands

The following commands are for troubleshooting only; they expose internal paths intentionally and are not required for normal use:

```sh
./build/nexus-native/nexus-cli --socket "$PREFIX/var/run/forgeclaw/nexus.sock" status
./build/nexus-native/nexus-cli --socket "$PREFIX/var/run/forgeclaw/nexus.sock" chat "Reply with exactly: local check passed."
./build/nexus-native/nexus-cli --socket "$PREFIX/var/run/forgeclaw/nexus.sock" corpus add "Raw local material"
./build/nexus-native/nexus-cli --socket "$PREFIX/var/run/forgeclaw/nexus.sock" corpus candidate rec-1
./build/nexus-native/nexus-cli --socket "$PREFIX/var/run/forgeclaw/nexus.sock" corpus admit rec-1 "Guardian approved"
./build/nexus-native/nexus-cli --socket "$PREFIX/var/run/forgeclaw/nexus.sock" corpus search "local"
./build/nexus-native/nexus-cli --socket "$PREFIX/var/run/forgeclaw/nexus.sock" verify
```

The daemon status must report `initialized=1`, `offline=1`, and `ollama=0`. The runtime uses direct libllama inference, requires no Ollama process, and requires no `llama-server` process.

Corpus records transition from raw material to learning candidate to verified record only after integrity validation and explicit Guardian approval. Rejected candidates are never returned by verified retrieval. Corpus records are data, not executable authority.
