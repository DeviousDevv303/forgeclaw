"""End-to-end companion to prefill_test.py (diagnostic, grades nothing): the same mirrored SWM-04 r2-tape prompt, same engine settings, NO time wall,
up to 1200 new tokens. Question: given enough time, does the model return parseable JSON on a prompt this long? One run, different machine from the Actions runner."""
import sys, time, json, re
from llama_cpp import Llama
prompt = open(sys.argv[1], encoding='utf-8').read()
llm = Llama(model_path=sys.argv[2], n_ctx=8192, n_threads=4, n_batch=512, n_gpu_layers=0, verbose=False)
ntok = len(llm.tokenize(prompt.encode('utf-8'), add_bos=False, special=True))
t1 = time.monotonic(); first = None; text = ''; n = 0; stop = None
for chunk in llm.create_completion(prompt, max_tokens=1200, temperature=0.6, top_p=0.9, stream=True):
    c = chunk['choices'][0]; n += 1; text += c.get('text', '')
    if first is None: first = time.monotonic() - t1
    if c.get('finish_reason'): stop = c['finish_reason']
total = time.monotonic() - t1
body = re.sub(r'^\s*```(?:json)?\s*|\s*```\s*$', '', text.strip())
try: json.loads(body); parsed = True; err = None
except Exception as e: parsed = False; err = str(e)[:120]
open(sys.argv[3], 'w', encoding='utf-8').write(text)
print(json.dumps({'prompt_tokens': ntok, 'time_to_first_token_s': round(first, 1), 'total_s': round(total, 1), 'new_tokens': n, 'finish_reason': stop,
                  'json_parses_after_fence_strip': parsed, 'parse_error': err, 'output_chars': len(text)}))
