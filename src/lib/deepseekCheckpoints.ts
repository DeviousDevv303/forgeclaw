// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/** Must match PRIMARY_MODEL / FALLBACK_MODEL in .github/workflows/deepseek-16b.yml (enforced by a test). */
// 2026-10-20: Qwen3-8B replaced deepseek-llm-7b-chat (benchmark in .github/scripts/deepseek_gguf.py).
export const DEEPSEEK_PRIMARY_CHECKPOINT = 'Qwen/Qwen3-8B'
export const DEEPSEEK_FALLBACK_CHECKPOINT = 'deepseek-ai/deepseek-coder-1.3b-instruct'
