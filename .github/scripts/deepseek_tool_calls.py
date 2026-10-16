"""Normalize a DeepSeek reply that contains a tool call.

Why this exists (agent: Claude Sonnet 5.5, at operator request):
the 7B chat checkpoint emits a tool call and then keeps writing as if the call had run,
e.g. "After executing the structured tool call, I found ... 68F" or "(output: ...)".
Nothing had executed; those lines are invented. The orchestrator is the only thing that can
run a tool, and it re-dispatches DeepSeek with the real result, so the model must stop at
the call. This keeps everything before the FIRST tool call, rewrites the call into the
exact fenced form the App parses, and drops everything after it.

The model also sometimes writes `tool_call{...}` inside a plain code fence, which the
App's parser does not recognise; normalizing to ```tool_call fixes that too.
"""
import json
import re

_CALL_RE = re.compile(r'tool_call\s*(?=\{)', re.IGNORECASE)


def normalize_tool_call_output(text):
    """Return (text, dropped_trailing_text). Text without a parseable tool call is unchanged."""
    match = _CALL_RE.search(text)
    if not match:
        return text, False
    try:
        obj, end = json.JSONDecoder().raw_decode(text, match.end())
    except ValueError:
        return text, False
    if not isinstance(obj, dict) or not isinstance(obj.get('name'), str) or not obj['name']:
        return text, False
    arguments = obj.get('arguments', obj.get('input', {}))
    if not isinstance(arguments, dict):
        arguments = {}
    before = re.sub(r'```[A-Za-z_]*\s*$', '', text[:match.start()].rstrip()).rstrip()
    block = '```tool_call\n' + json.dumps({'name': obj['name'], 'arguments': arguments}) + '\n```'
    dropped = bool(re.sub(r'[\s`]+', '', text[end:]))
    return (before + '\n\n' + block if before else block), dropped
