"""Offline tests for mirofish_meter.py: a local fake upstream stands in for the provider; no network, no real key."""
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

    def __init__(self, usage=None, status=200, omit_usage=False):
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
                    payload = {'error': {'message': 'unauthorized', 'type': 'invalid_request_error'}}
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


if __name__ == '__main__':
    unittest.main()
