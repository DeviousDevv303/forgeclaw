# NEXUS/CORPUS Termux Runtime

NEXUS is a native, offline-first runtime for ForgeClaw. It loads a locally provisioned GGUF directly through the pinned `llama.cpp` submodule; it does not use Ollama, `llama-server`, OpenRouter, or cloud inference.

## Build

From the ForgeClaw repository:

```sh
git submodule update --init --recursive
cmake -S nexus/native -B build/nexus-native -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
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

On Termux, use the native CMake/Clang toolchain and build with `GGML_NATIVE=OFF` for a portable ARM64 baseline. Android/ARM64 packaging remains a deployment step; the runtime source itself has no network or proprietary runtime dependency.

## Model provisioning

Provision the approved Qwen GGUF outside Git. Record the SHA-256 in the provisioning manifest or operator notes and pass the exact digest to `nexusd`:

```text
Model: Qwen2.5-1.5B-Instruct-GGUF Q4_K_M
SHA-256: 6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e
```

NEXUS refuses to load a model when the calculated digest differs from the expected digest.

## Start the local runtime

```sh
mkdir -p "$PREFIX/var/lib/forgeclaw/nexus"
./build/nexus-native/nexusd \
  --model "$PREFIX/var/lib/forgeclaw/nexus/qwen2.5-1.5b-instruct-q4_k_m.gguf" \
  --sha256 6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e \
  --socket "$PREFIX/var/run/forgeclaw/nexus.sock" \
  --corpus "$PREFIX/var/lib/forgeclaw/nexus/corpus.log" \
  --ctx 512 \
  --threads 2 \
  --n-predict 32
```

The daemon exposes only a Unix-domain socket. Its status reports `offline=1` and `ollama=0`.

For the ForgeClaw browser UI, start the optional loopback-only bridge in a separate Termux process:

```sh
./build/nexus-native/nexus-http-bridge \
  --socket "$PREFIX/var/run/forgeclaw/nexus.sock" \
  --port 8787
```

The bridge binds only to `127.0.0.1`; it forwards the small NEXUS text protocol to the Unix socket. ForgeClaw’s NEXUS provider defaults to `http://127.0.0.1:8787` and accepts an explicitly configured loopback URL only.

## Operator commands

```sh
./build/nexus-native/nexus-cli --socket "$PREFIX/var/run/forgeclaw/nexus.sock" status
./build/nexus-native/nexus-cli --socket "$PREFIX/var/run/forgeclaw/nexus.sock" chat "Reply with exactly: local check passed."
./build/nexus-native/nexus-cli --socket "$PREFIX/var/run/forgeclaw/nexus.sock" corpus add "Raw local material"
./build/nexus-native/nexus-cli --socket "$PREFIX/var/run/forgeclaw/nexus.sock" corpus candidate rec-1
./build/nexus-native/nexus-cli --socket "$PREFIX/var/run/forgeclaw/nexus.sock" corpus admit rec-1 "Guardian approved"
./build/nexus-native/nexus-cli --socket "$PREFIX/var/run/forgeclaw/nexus.sock" corpus search "local"
./build/nexus-native/nexus-cli --socket "$PREFIX/var/run/forgeclaw/nexus.sock" verify
```

Corpus records transition from raw material to learning candidate to verified record only after integrity validation and explicit Guardian approval. Rejected candidates are never returned by verified retrieval. Corpus records are data, not executable authority.
