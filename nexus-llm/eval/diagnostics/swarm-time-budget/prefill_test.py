"""Direct test of the time-budget reading: how long does llama.cpp take to evaluate the exact mirrored SWM-04 r2-tape prompt before the first token?
Engine settings copied from deepseek_gguf.py / the workflow (n_ctx 8192, n_threads 4, n_batch 512). Absolute times differ from the Actions runner."""
import sys, time, json
from llama_cpp import Llama
prompt = open(sys.argv[1], encoding='utf-8').read()
t0 = time.monotonic()
llm = Llama(model_path=sys.argv[2], n_ctx=8192, n_threads=4, n_batch=512, n_gpu_layers=0, verbose=False)
load_s = time.monotonic() - t0
ntok = len(llm.tokenize(prompt.encode('utf-8'), add_bos=False, special=True))
t1 = time.monotonic()
stream = llm.create_completion(prompt, max_tokens=24, temperature=0.6, top_p=0.9, stream=True)
first = None; n = 0; text = ''
for chunk in stream:
    n += 1; text += chunk['choices'][0].get('text', '')
    if first is None: first = time.monotonic() - t1
total = time.monotonic() - t1
print(json.dumps({'prompt_chars': len(prompt), 'prompt_tokens': ntok, 'load_s': round(load_s, 1), 'time_to_first_token_s': round(first, 1),
                  'tokens_after_first': n - 1, 'decode_s_per_token_after_first': round((total - first) / max(n - 1, 1), 2), 'first_24_text': text[:120]}))
