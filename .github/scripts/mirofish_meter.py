# ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
# Proprietary source-available license. Commercial use requires written permission. See LICENSE.
"""Metering proxy between MiroFish and one OpenAI-format LLM endpoint.

MiroFish (AGPL-3.0) runs as an unmodified external process and speaks only the OpenAI chat-completions format. Its
LLM_BASE_URL points here instead of at the provider, which gives the run three properties without touching MiroFish:

  * a measured cost: every call's `usage` is tallied against a price table that is versioned and stamped into the record;
  * a ceiling: once the tally reaches it, further calls get HTTP 429 (`meter_ceiling`) and the run is recorded as aborted;
  * one engine per run: a call that names any other model than the configured one is refused (HTTP 400).

The provider key lives only in this process. MiroFish is given a dummy key, so code we did not write never holds it.

Honesty rules, all deliberate:
  * Unknown model => no price => the proxy refuses to start. No price, no meter, no run.
  * A call with no `usage` is counted at a conservative estimate, never at zero. An unmetered call is not a free call.
  * Every prompt token is priced at the cache-miss rate, so the figure overstates cost when the provider caches. It is a
    ceiling guard and an upper bound, not an invoice; the provider's own usage page is the invoice.
  * The ceiling is a cut-off, not a hard cap: calls already in flight when it trips still finish, so overshoot is bounded
    by the concurrency, and the snapshot reports it as it is.
  * Streaming is refused (HTTP 400), because a stream cannot be metered here. If MiroFish ever streams, the run fails
    loudly instead of being silently mis-metered.
  * A provider that pins sampling parameters gets them removed from the request (REQUEST_POLICY), and every removal is
    counted. MiroFish stays unmodified; the provider applies its own fixed values.
  * Every error, the provider's or the meter's own, is printed to this process's log and kept (key redacted, truncated) in
    the snapshot. MiroFish logs only "status=400", so without this a rejected call says nothing about why.

Standard library only, so the runner needs nothing installed beyond MiroFish itself.
"""
from __future__ import annotations

import json
import sys
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

PRICE_TABLE_VERSION = '2026-10-24'
PRICE_SOURCE = ("Moonshot figures are from third-party price trackers, which disagree slightly; Moonshot's own pricing page "
                'was not reached. Verify before relying on the dollar figures.')
# USD per million tokens: (input, output). Reasoning tokens are billed as output by the provider and arrive inside
# usage.completion_tokens, so they are priced as output here.
PRICES: dict[str, dict[str, tuple[float, float]]] = {
    'moonshot': {'kimi-k2.6': (0.95, 4.00), 'kimi-k2.7-code': (0.95, 4.00)},
    # A self-hosted OpenAI-format server (for example llama.cpp on the runner): no per-token price, so only calls are metered.
    'local': {'*': (0.0, 0.0)},
}
UNMETERED_INPUT_CHARS_PER_TOKEN = 3.5
UNMETERED_OUTPUT_FALLBACK_TOKENS = 1024

# Moonshot's K2 models pin their sampling and reject any other value with HTTP 400. Moonshot's kimi-k2.6 quickstart (read
# 2026-10-25): temperature "will use a fixed value 1.0, non-thinking mode will use a fixed value 0.6", top_p 0.95, n 1,
# presence and frequency penalty 0.0, and "any other value will result in an error". MiroFish sets its own on every call
# (temperature 0.3 for the ontology, 0.5 and 0.7 elsewhere), which is what failed the first live runs on both K2 models:
# the ontology call, HTTP 400. MiroFish runs unmodified, so the meter removes those fields and the provider applies its fixed
# values. Removing rather than setting 1.0 is deliberate: the fixed value depends on the thinking mode.
PINNED_SAMPLING = ('temperature', 'top_p', 'n', 'presence_penalty', 'frequency_penalty')
# provider -> model -> (request fields the provider pins, whether the model documents the thinking toggle). The toggle,
# `thinking: {"type": "enabled" | "disabled"}` (enabled by default), is documented for kimi-k2.6; it was not checked for
# kimi-k2.7-code, so that model only runs at the provider's default.
REQUEST_POLICY: dict[str, dict[str, tuple[tuple[str, ...], bool]]] = {
    'moonshot': {'kimi-k2.6': (PINNED_SAMPLING, True), 'kimi-k2.7-code': (PINNED_SAMPLING, False)},
}
# Moonshot also rejects an assistant message with no text and no tool call: "the message at position 4 with role 'assistant'
# must not be empty" (live run 40234425538, 2026-10-25). camel, the agent library under MiroFish, keeps such a message in each
# agent's history after an action, so an agent's every later call failed: its next simulation step, and the final poll. The
# message carries nothing, so the meter drops it (an assistant message that carries a tool call is kept, empty text and all:
# Moonshot accepts those). Every drop is counted.
DROP_EMPTY_ASSISTANT = frozenset({'moonshot'})
THINKING_CHOICES = ('disabled', 'enabled', 'provider-default')
ERROR_SAMPLES_KEPT = 8
ERROR_SAMPLE_CHARS = 600

Fetch = Callable[[str, str, dict, bytes | None], tuple]  # (url, method, headers, body) -> (status, content_type, body_bytes)


class MeterError(Exception):
    pass


def _as_int(value) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def price_for(provider: str, model: str) -> tuple[float, float]:
    table = PRICES.get(provider)
    if table is None:
        raise MeterError(f'unknown provider "{provider}"; known: {sorted(PRICES)}')
    if model in table:
        return table[model]
    if '*' in table:
        return table['*']
    raise MeterError(f'no price for model "{model}" under provider "{provider}" (priced: {sorted(table)}); no price, no meter, no run')


def is_empty_assistant(message) -> bool:
    """An assistant turn with no text and no tool call: it carries nothing, and Moonshot rejects the whole request over it."""
    if not isinstance(message, dict) or message.get('role') != 'assistant' or message.get('tool_calls'):
        return False
    content = message.get('content')
    if content is None:
        return True
    if isinstance(content, str):
        return not content.strip()
    return isinstance(content, list) and not content


def policy_for(provider: str, model: str) -> tuple[tuple[str, ...], bool]:
    """(pinned fields to remove, whether the thinking toggle is documented) for this engine; nothing for an unlisted one."""
    return REQUEST_POLICY.get(provider, {}).get(model, ((), False))


def default_fetch(url: str, method: str, headers: dict, body: bytes | None) -> tuple:
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=300) as res:  # noqa: S310 - the upstream is the configured provider URL
            return res.status, res.headers.get('Content-Type', 'application/json'), res.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers.get('Content-Type', 'application/json'), error.read()


class Meter:
    """Thread-safe tally of what a run has spent."""

    def __init__(self, provider: str, model: str, ceiling_usd: float, thinking: str = 'provider-default'):
        self.provider, self.model, self.ceiling_usd = provider, model, float(ceiling_usd)
        self.price_in, self.price_out = price_for(provider, model)
        self.pinned_fields, toggle_documented = policy_for(provider, model)
        if thinking not in THINKING_CHOICES:
            raise MeterError(f'thinking must be one of {list(THINKING_CHOICES)}; got {thinking!r}')
        if thinking != 'provider-default' and not toggle_documented:
            raise MeterError(f'the thinking toggle is not documented for {provider}/{model}; run it with thinking=provider-default')
        self.thinking = thinking
        self.fields_removed: dict[str, int] = {}
        self.thinking_overridden = 0
        self.drop_empty_assistant = provider in DROP_EMPTY_ASSISTANT
        self.empty_assistant_dropped = 0
        self.error_samples: list[dict] = []
        self._lock = threading.Lock()
        self.calls = 0
        self.tokens_in = 0
        self.tokens_out = 0
        self.cached_tokens_in = 0
        self.unmetered_calls = 0
        self.upstream_errors = 0
        self.refused_over_ceiling = 0
        self.refused_other = 0
        self.cost_usd = 0.0
        self.ceiling_hit = False

    def over_ceiling(self) -> bool:
        with self._lock:
            return self.cost_usd >= self.ceiling_usd

    def note_refusal(self, over_ceiling: bool) -> None:
        with self._lock:
            if over_ceiling:
                self.refused_over_ceiling += 1
                self.ceiling_hit = True
            else:
                self.refused_other += 1

    def apply_policy(self, request: dict) -> dict:
        """The request as the provider must receive it: pinned sampling removed, empty assistant turns dropped, the run's
        thinking mode set. Counted."""
        out = dict(request)
        dropped = 0
        if self.drop_empty_assistant and isinstance(out.get('messages'), list):
            kept = [m for m in out['messages'] if not is_empty_assistant(m)]
            dropped = len(out['messages']) - len(kept)
            out['messages'] = kept
        removed = [field for field in self.pinned_fields if field in out]
        for field in removed:
            del out[field]
        overridden = False
        if self.thinking != 'provider-default':
            wanted = {'type': self.thinking}
            overridden = 'thinking' in out and out['thinking'] != wanted  # one thinking mode per run, like one model
            out['thinking'] = wanted
        with self._lock:
            for field in removed:
                self.fields_removed[field] = self.fields_removed.get(field, 0) + 1
            self.thinking_overridden += int(overridden)
            self.empty_assistant_dropped += dropped
        return out

    def note_error(self, source: str, status: int, excerpt: str) -> None:
        """Print every error to the log; keep the first few distinct ones (already redacted by the caller) in the snapshot."""
        excerpt = excerpt[:ERROR_SAMPLE_CHARS]
        print(f'{source} error HTTP {status}: {excerpt}', file=sys.stderr, flush=True)
        with self._lock:
            sample = {'source': source, 'status': status, 'excerpt': excerpt}
            if len(self.error_samples) < ERROR_SAMPLES_KEPT and sample not in self.error_samples:
                self.error_samples.append(sample)

    def record(self, request_body: bytes, response_status: int, response_body: bytes) -> None:
        tokens_in = tokens_out = cached = 0
        metered = False
        try:
            usage = (json.loads(response_body or b'{}') or {}).get('usage')
        except (ValueError, AttributeError):
            usage = None
        if isinstance(usage, dict) and isinstance(usage.get('prompt_tokens'), int) and isinstance(usage.get('completion_tokens'), int):
            tokens_in, tokens_out, metered = usage['prompt_tokens'], usage['completion_tokens'], True
            details = usage.get('prompt_tokens_details')
            cached = _as_int(usage.get('cached_tokens')) or _as_int((details or {}).get('cached_tokens') if isinstance(details, dict) else 0)
        with self._lock:
            self.calls += 1
            if response_status >= 400:
                self.upstream_errors += 1
            if not metered and response_status < 400:
                # Conservative, never zero: the prompt by length, the answer by its stated cap (or a fixed fallback).
                self.unmetered_calls += 1
                try:
                    cap = (json.loads(request_body) or {}).get('max_tokens')
                except ValueError:
                    cap = None
                tokens_in = int(len(request_body) / UNMETERED_INPUT_CHARS_PER_TOKEN)
                tokens_out = int(cap) if isinstance(cap, int) and cap > 0 else UNMETERED_OUTPUT_FALLBACK_TOKENS
            self.tokens_in += tokens_in
            self.tokens_out += tokens_out
            self.cached_tokens_in += cached
            self.cost_usd += tokens_in / 1e6 * self.price_in + tokens_out / 1e6 * self.price_out
            if self.cost_usd >= self.ceiling_usd:
                self.ceiling_hit = True

    def snapshot(self) -> dict:
        with self._lock:
            return {
                'provider': self.provider, 'model': self.model,
                'price_table_version': PRICE_TABLE_VERSION, 'price_source': PRICE_SOURCE,
                'price_per_mtok_usd': {'input': self.price_in, 'output': self.price_out},
                'calls': self.calls, 'tokens_in': self.tokens_in, 'tokens_out': self.tokens_out,
                'cached_tokens_in_reported': self.cached_tokens_in,
                'unmetered_calls_estimated': self.unmetered_calls, 'upstream_errors': self.upstream_errors,
                'refused_over_ceiling': self.refused_over_ceiling, 'refused_other': self.refused_other,
                'cost_usd': round(self.cost_usd, 6), 'ceiling_usd': self.ceiling_usd, 'ceiling_hit': self.ceiling_hit,
                'cost_basis': 'upper bound: every prompt token at the cache-miss price',
                'request_policy': {'pinned_fields': list(self.pinned_fields), 'fields_removed': dict(self.fields_removed),
                                   'thinking': self.thinking, 'thinking_overridden': self.thinking_overridden,
                                   'empty_assistant_dropped': self.empty_assistant_dropped},
                'error_samples': [dict(s) for s in self.error_samples],
            }


class MeterProxy:
    """Local HTTP server that forwards chat-completion calls to the configured upstream and meters them."""

    def __init__(self, upstream_base: str, api_key: str, provider: str, model: str, ceiling_usd: float,
                 host: str = '127.0.0.1', port: int = 0, fetch: Fetch | None = None, thinking: str = 'provider-default'):
        self.meter = Meter(provider, model, ceiling_usd, thinking)
        self.upstream_base = upstream_base.rstrip('/')
        self._api_key = api_key
        self._fetch = fetch or default_fetch
        self._server = ThreadingHTTPServer((host, port), self._handler())
        self._server.daemon_threads = True
        self._thread: threading.Thread | None = None

    @property
    def port(self) -> int:
        return self._server.server_address[1]

    def start(self) -> int:
        self._thread = threading.Thread(target=lambda: self._server.serve_forever(poll_interval=0.05), name='mirofish-meter', daemon=True)
        self._thread.start()
        return self.port

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()

    def redact(self, body: bytes) -> str:
        """A provider error body as text, with the key removed in case anything ever echoes it."""
        text = body.decode('utf-8', 'replace') if isinstance(body, bytes) else str(body)
        return text.replace(self._api_key, '[redacted]') if self._api_key else text

    def _handler(self):
        proxy = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, fmt, *args):  # noqa: D401 - silence the default stderr access log
                return

            def _send(self, status: int, body: bytes, content_type: str = 'application/json') -> None:
                self.send_response(status)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _error(self, status: int, kind: str, message: str) -> None:
                proxy.meter.note_error('meter', status, f'{kind}: {message}')
                self._send(status, json.dumps({'error': {'type': kind, 'message': message}}).encode())

            def _upstream_url(self) -> str:
                path = self.path[len('/v1'):] if self.path.startswith('/v1') else self.path
                return proxy.upstream_base + path

            def _headers(self) -> dict:
                return {'Authorization': f'Bearer {proxy._api_key}', 'Content-Type': 'application/json', 'Accept': 'application/json'}

            def do_GET(self):  # noqa: N802
                if self.path == '/__meter':
                    self._send(200, json.dumps(proxy.meter.snapshot()).encode())
                    return
                status, ctype, body = proxy._fetch(self._upstream_url(), 'GET', self._headers(), None)
                self._send(status, body, ctype)

            def do_POST(self):  # noqa: N802
                length = int(self.headers.get('Content-Length') or 0)
                raw = self.rfile.read(length) if length else b''
                try:
                    request = json.loads(raw or b'{}')
                except ValueError:
                    proxy.meter.note_refusal(False)
                    self._error(400, 'bad_request', 'request body is not JSON')
                    return
                if request.get('stream'):
                    proxy.meter.note_refusal(False)
                    self._error(400, 'meter_no_streaming', 'streaming cannot be metered by this proxy; the run must not stream')
                    return
                if request.get('model') != proxy.meter.model:
                    proxy.meter.note_refusal(False)
                    self._error(400, 'meter_one_engine', f'this run is configured to one model ({proxy.meter.model}); got {request.get("model")!r}')
                    return
                if proxy.meter.over_ceiling():
                    proxy.meter.note_refusal(True)
                    self._error(429, 'meter_ceiling', f'run ceiling of ${proxy.meter.ceiling_usd:.2f} reached')
                    return
                forwarded = json.dumps(proxy.meter.apply_policy(request), ensure_ascii=False).encode('utf-8')
                try:
                    status, ctype, body = proxy._fetch(self._upstream_url(), 'POST', self._headers(), forwarded)
                except Exception as error:  # noqa: BLE001 - reported to the caller and counted, never swallowed
                    with proxy.meter._lock:
                        proxy.meter.upstream_errors += 1
                    self._error(502, 'meter_upstream_unreachable', f'{type(error).__name__}: {error}'[:300])
                    return
                if status >= 400:
                    proxy.meter.note_error('upstream', status, proxy.redact(body))
                proxy.meter.record(forwarded, status, body)
                self._send(status, body, ctype)

        return Handler


def main(argv: list[str] | None = None) -> int:
    """Run the proxy standalone (the runner normally embeds it): reads PROVIDER, MODEL, UPSTREAM_BASE, CEILING_USD, API_KEY, THINKING."""
    import os
    import signal
    try:
        proxy = MeterProxy(os.environ['UPSTREAM_BASE'], os.environ['API_KEY'], os.environ['PROVIDER'], os.environ['MODEL'],
                           float(os.environ.get('CEILING_USD', '0.40')), port=int(os.environ.get('PORT', '0')),
                           thinking=os.environ.get('THINKING', 'provider-default'))
    except (KeyError, ValueError, MeterError) as error:
        print(f'::error title=mirofish-meter::{error}', file=sys.stderr)
        return 1
    port = proxy.start()
    print(f'meter listening on 127.0.0.1:{port}', flush=True)
    done = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: done.set())
    try:
        done.wait()
    finally:
        print(json.dumps(proxy.meter.snapshot()), flush=True)
        proxy.stop()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
