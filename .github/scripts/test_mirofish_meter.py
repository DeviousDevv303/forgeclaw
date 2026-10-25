"""Offline tests for mirofish_meter.py: a local fake upstream stands in for the provider; no network, no real key."""
import contextlib
import io
import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(__file__))
import mirofish_meter as mm  # noqa: E402


class FakeUpstream:
    """Answers /chat/completions with a fixed usage; remembers what it was sent."""

    def __init__(self, usage=None, status=200, omit_usage=False, error_message='unauthorized'):
        self.seen = []
        outer = self
        reply_usage = usage if usage is not None else {'prompt_tokens': 1000, 'completion_tokens': 100}

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                return

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
                outer.seen.append({'path': self.path, 'auth': self.headers.get('Authorization'), 'body': json.loads(body)})
                if status >= 400:  # a real provider error carries an error object and no usage
                    payload = {'error': {'message': error_message, 'type': 'invalid_request_error'}}
                else:
                    payload = {'id': 'x', 'choices': [{'message': {'role': 'assistant', 'content': 'hi'}}]}
                    if not omit_usage:
                        payload['usage'] = reply_usage
                out = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(out)))
                self.end_headers()
                self.wfile.write(out)

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), H)
        self.server.daemon_threads = True
        threading.Thread(target=lambda: self.server.serve_forever(poll_interval=0.05), daemon=True).start()
        self.base = f'http://127.0.0.1:{self.server.server_address[1]}/v1'

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def post(port, body, path='/v1/chat/completions', key='dummy-from-mirofish'):
    request = urllib.request.Request(f'http://127.0.0.1:{port}{path}', data=json.dumps(body).encode(),
                                     headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'}, method='POST')
    try:
        with urllib.request.urlopen(request, timeout=10) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def snapshot(port):
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/__meter', timeout=10) as res:
        return json.loads(res.read())


MODEL = 'kimi-k2.6'
CALL = {'model': MODEL, 'messages': [{'role': 'user', 'content': 'hello'}], 'max_tokens': 200}


def quiet(test):
    """The meter prints every error to stderr by design; keep test output readable and let tests read what was printed."""
    buffer = io.StringIO()
    redirect = contextlib.redirect_stderr(buffer)
    redirect.__enter__()
    test.addCleanup(redirect.__exit__, None, None, None)
    return buffer


class PriceTests(unittest.TestCase):
    def test_a_priced_model_resolves_and_an_unpriced_one_refuses(self):
        self.assertEqual(mm.price_for('moonshot', 'kimi-k2.6'), (0.95, 4.00))
        with self.assertRaises(mm.MeterError) as ctx:
            mm.price_for('moonshot', 'kimi-k3')  # exists in the app, but has no price here: no price, no meter, no run
        self.assertIn('no price, no meter, no run', str(ctx.exception))
        with self.assertRaises(mm.MeterError):
            mm.price_for('somebody-else', 'x')
        self.assertEqual(mm.price_for('local', 'anything'), (0.0, 0.0))

    def test_the_proxy_refuses_to_start_for_an_unpriced_model(self):
        with self.assertRaises(mm.MeterError):
            mm.MeterProxy('http://127.0.0.1:9/v1', 'k', 'moonshot', 'kimi-k3', 0.40)


class ProxyTests(unittest.TestCase):
    def setUp(self):
        self.up = FakeUpstream()
        self.addCleanup(self.up.close)
        self.stderr = quiet(self)

    def proxy(self, ceiling=0.40, upstream=None, model=MODEL):
        proxy = mm.MeterProxy((upstream or self.up).base, 'REAL-PROVIDER-KEY', 'moonshot', model, ceiling)
        port = proxy.start()
        self.addCleanup(proxy.stop)
        return proxy, port

    def test_forwards_with_the_real_key_and_never_exposes_it_to_the_client(self):
        _, port = self.proxy()
        status, body = post(port, CALL, key='dummy-from-mirofish')
        self.assertEqual(status, 200)
        self.assertEqual(body['choices'][0]['message']['content'], 'hi')
        self.assertEqual(self.up.seen[0]['auth'], 'Bearer REAL-PROVIDER-KEY')  # injected by the proxy
        self.assertNotIn('dummy-from-mirofish', json.dumps(self.up.seen))      # the client's key never travels upstream
        self.assertEqual(self.up.seen[0]['path'], '/v1/chat/completions')

    def test_meters_usage_at_the_price_table(self):
        _, port = self.proxy()
        for _ in range(3):
            post(port, CALL)
        snap = snapshot(port)
        self.assertEqual((snap['calls'], snap['tokens_in'], snap['tokens_out']), (3, 3000, 300))
        # 3000 in at $0.95/M + 300 out at $4.00/M
        self.assertAlmostEqual(snap['cost_usd'], 3000 / 1e6 * 0.95 + 300 / 1e6 * 4.00, places=6)
        self.assertEqual(snap['price_table_version'], mm.PRICE_TABLE_VERSION)
        self.assertEqual(snap['cost_basis'], 'upper bound: every prompt token at the cache-miss price')
        self.assertFalse(snap['ceiling_hit'])

    def test_cuts_off_at_the_ceiling_with_429_and_says_so(self):
        up = FakeUpstream(usage={'prompt_tokens': 100_000, 'completion_tokens': 10_000})  # ~$0.135 per call
        self.addCleanup(up.close)
        _, port = self.proxy(ceiling=0.25, upstream=up)
        statuses = [post(port, CALL)[0] for _ in range(5)]
        self.assertEqual(statuses, [200, 200, 429, 429, 429])
        self.assertEqual(len(up.seen), 2)  # refused calls never reached the provider
        status, body = post(port, CALL)
        self.assertEqual(body['error']['type'], 'meter_ceiling')
        snap = snapshot(port)
        self.assertTrue(snap['ceiling_hit'])
        self.assertEqual(snap['refused_over_ceiling'], 4)
        self.assertGreaterEqual(snap['cost_usd'], 0.25)

    def test_one_engine_per_run(self):
        _, port = self.proxy()
        status, body = post(port, {**CALL, 'model': 'kimi-k2.7-code'})
        self.assertEqual((status, body['error']['type']), (400, 'meter_one_engine'))
        self.assertEqual(self.up.seen, [])
        self.assertEqual(snapshot(port)['refused_other'], 1)

    def test_streaming_is_refused_not_silently_mis_metered(self):
        _, port = self.proxy()
        status, body = post(port, {**CALL, 'stream': True})
        self.assertEqual((status, body['error']['type']), (400, 'meter_no_streaming'))
        self.assertEqual(self.up.seen, [])

    def test_a_call_without_usage_is_counted_conservatively_never_at_zero(self):
        up = FakeUpstream(omit_usage=True)
        self.addCleanup(up.close)
        _, port = self.proxy(upstream=up)
        post(port, CALL)
        snap = snapshot(port)
        self.assertEqual(snap['unmetered_calls_estimated'], 1)
        self.assertEqual(snap['tokens_out'], 200)  # the call's own max_tokens cap
        self.assertGreater(snap['tokens_in'], 0)
        self.assertGreater(snap['cost_usd'], 0)

    def test_cached_tokens_are_reported_but_not_discounted(self):
        up = FakeUpstream(usage={'prompt_tokens': 1000, 'completion_tokens': 10, 'prompt_tokens_details': {'cached_tokens': 600}})
        self.addCleanup(up.close)
        _, port = self.proxy(upstream=up)
        post(port, CALL)
        snap = snapshot(port)
        self.assertEqual(snap['cached_tokens_in_reported'], 600)
        self.assertAlmostEqual(snap['cost_usd'], 1000 / 1e6 * 0.95 + 10 / 1e6 * 4.00, places=6)  # no discount: an upper bound

    def test_an_unreachable_upstream_is_a_502_and_counted(self):
        proxy = mm.MeterProxy('http://127.0.0.1:9/v1', 'k', 'moonshot', MODEL, 0.40,
                              fetch=lambda *a, **k: (_ for _ in ()).throw(ConnectionRefusedError('nope')))
        port = proxy.start()
        self.addCleanup(proxy.stop)
        status, body = post(port, CALL)
        self.assertEqual((status, body['error']['type']), (502, 'meter_upstream_unreachable'))
        self.assertEqual(snapshot(port)['upstream_errors'], 1)

    def test_upstream_errors_are_passed_through_and_cost_nothing(self):
        up = FakeUpstream(status=401)
        self.addCleanup(up.close)
        _, port = self.proxy(upstream=up)
        status, _ = post(port, CALL)
        self.assertEqual(status, 401)
        snap = snapshot(port)
        self.assertEqual((snap['upstream_errors'], snap['cost_usd']), (1, 0.0))

    def test_concurrent_calls_are_tallied_exactly(self):
        _, port = self.proxy(ceiling=10.0)
        threads = [threading.Thread(target=post, args=(port, CALL)) for _ in range(20)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        snap = snapshot(port)
        self.assertEqual((snap['calls'], snap['tokens_in'], snap['tokens_out']), (20, 20_000, 2_000))


class RequestPolicyTests(unittest.TestCase):
    """Moonshot's K2 models pin their sampling and reject anything else with HTTP 400; MiroFish sets its own on every call.
    This is what failed the first live runs (both K2 models, the ontology call). MiroFish stays unmodified; the meter adapts."""

    MIROFISH_ONTOLOGY_CALL = {**CALL, 'temperature': 0.3, 'response_format': {'type': 'json_object'}}

    def setUp(self):
        self.up = FakeUpstream()
        self.addCleanup(self.up.close)
        self.stderr = quiet(self)

    def proxy(self, model=MODEL, thinking='provider-default', provider='moonshot'):
        proxy = mm.MeterProxy(self.up.base, 'REAL-PROVIDER-KEY', provider, model, 0.40, thinking=thinking)
        port = proxy.start()
        self.addCleanup(proxy.stop)
        return port

    def test_the_pinned_sampling_fields_never_reach_a_k2_model_and_every_removal_is_counted(self):
        port = self.proxy()
        status, _ = post(port, {**self.MIROFISH_ONTOLOGY_CALL, 'top_p': 0.9, 'n': 1, 'presence_penalty': 0.1, 'frequency_penalty': 0.2})
        post(port, {**CALL, 'temperature': 0.7})
        self.assertEqual(status, 200)
        sent = self.up.seen[0]['body']
        for field in mm.PINNED_SAMPLING:
            self.assertNotIn(field, sent)
        # everything else is forwarded as MiroFish sent it
        self.assertEqual((sent['model'], sent['messages'], sent['max_tokens'], sent['response_format']),
                         (MODEL, CALL['messages'], 200, {'type': 'json_object'}))
        policy = snapshot(port)['request_policy']
        self.assertEqual(policy['fields_removed'], {'temperature': 2, 'top_p': 1, 'n': 1, 'presence_penalty': 1, 'frequency_penalty': 1})
        self.assertEqual(policy['pinned_fields'], list(mm.PINNED_SAMPLING))

    def test_k2_7_code_is_stripped_the_same_way(self):
        port = self.proxy(model='kimi-k2.7-code')
        post(port, {**self.MIROFISH_ONTOLOGY_CALL, 'model': 'kimi-k2.7-code'})
        self.assertNotIn('temperature', self.up.seen[0]['body'])

    def test_thinking_disabled_is_set_on_every_call_and_a_conflicting_value_is_overridden_and_counted(self):
        port = self.proxy(thinking='disabled')
        post(port, CALL)
        post(port, {**CALL, 'thinking': {'type': 'enabled'}})
        self.assertEqual([s['body']['thinking'] for s in self.up.seen], [{'type': 'disabled'}, {'type': 'disabled'}])
        policy = snapshot(port)['request_policy']
        self.assertEqual((policy['thinking'], policy['thinking_overridden']), ('disabled', 1))

    def test_thinking_enabled_is_sent_as_enabled(self):
        port = self.proxy(thinking='enabled')
        post(port, CALL)
        self.assertEqual(self.up.seen[0]['body']['thinking'], {'type': 'enabled'})

    def test_the_provider_default_sends_no_thinking_field(self):
        port = self.proxy()
        post(port, CALL)
        self.assertNotIn('thinking', self.up.seen[0]['body'])

    def test_the_toggle_is_refused_where_it_is_not_documented_and_bad_values_refuse_to_start(self):
        for thinking in ('disabled', 'enabled'):
            with self.assertRaises(mm.MeterError) as ctx:
                mm.MeterProxy(self.up.base, 'k', 'moonshot', 'kimi-k2.7-code', 0.40, thinking=thinking)
            self.assertIn('not documented', str(ctx.exception))
        with self.assertRaises(mm.MeterError):
            mm.MeterProxy(self.up.base, 'k', 'moonshot', MODEL, 0.40, thinking='off')

    def test_an_engine_without_a_policy_is_forwarded_untouched(self):
        port = self.proxy(provider='local', model='qwen3-8b')
        post(port, {**self.MIROFISH_ONTOLOGY_CALL, 'model': 'qwen3-8b'})
        self.assertEqual(self.up.seen[0]['body']['temperature'], 0.3)
        self.assertEqual(snapshot(port)['request_policy']['fields_removed'], {})


class ErrorLogTests(unittest.TestCase):
    """MiroFish logs a rejected call as "status=400" and nothing else. The meter keeps the provider's own words."""

    def setUp(self):
        self.stderr = quiet(self)

    def proxy(self, upstream):
        proxy = mm.MeterProxy(upstream.base, 'REAL-PROVIDER-KEY', 'moonshot', MODEL, 0.40)
        port = proxy.start()
        self.addCleanup(proxy.stop)
        return port

    def test_a_provider_rejection_is_printed_and_kept_with_the_key_redacted(self):
        up = FakeUpstream(status=400, error_message='invalid temperature: only 1 is allowed for this model; key REAL-PROVIDER-KEY')
        self.addCleanup(up.close)
        port = self.proxy(up)
        status, body = post(port, CALL)
        self.assertEqual(status, 400)  # still passed through unchanged to MiroFish
        self.assertIn('REAL-PROVIDER-KEY', body['error']['message'])  # the caller's copy is the provider's own response
        sample = snapshot(port)['error_samples'][0]
        self.assertEqual((sample['source'], sample['status']), ('upstream', 400))
        self.assertIn('invalid temperature: only 1 is allowed', sample['excerpt'])
        self.assertNotIn('REAL-PROVIDER-KEY', json.dumps(snapshot(port)))
        self.assertIn('upstream error HTTP 400: ', self.stderr.getvalue())
        self.assertNotIn('REAL-PROVIDER-KEY', self.stderr.getvalue())

    def test_samples_are_truncated_deduplicated_and_bounded(self):
        up = FakeUpstream(status=400, error_message='x' * 5000)
        self.addCleanup(up.close)
        port = self.proxy(up)
        for _ in range(3):
            post(port, CALL)
        for i in range(mm.ERROR_SAMPLES_KEPT + 3):
            post(port, {**CALL, 'model': f'other-{i}'})  # distinct meter refusals
        samples = snapshot(port)['error_samples']
        self.assertEqual(len(samples), mm.ERROR_SAMPLES_KEPT)
        self.assertEqual(sum(1 for s in samples if s['source'] == 'upstream'), 1)  # three identical rejections, kept once
        self.assertLessEqual(max(len(s['excerpt']) for s in samples), mm.ERROR_SAMPLE_CHARS)
        self.assertEqual(self.stderr.getvalue().count('error HTTP'), 3 + mm.ERROR_SAMPLES_KEPT + 3)  # every error is still printed

    def test_the_meters_own_refusals_are_kept_too(self):
        up = FakeUpstream()
        self.addCleanup(up.close)
        port = self.proxy(up)
        post(port, {**CALL, 'stream': True})
        sample = snapshot(port)['error_samples'][0]
        self.assertEqual((sample['source'], sample['status']), ('meter', 400))
        self.assertIn('meter_no_streaming', sample['excerpt'])


if __name__ == '__main__':
    unittest.main()
