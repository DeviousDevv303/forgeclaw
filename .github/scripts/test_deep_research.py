"""Offline tests for deep_research.py: search and fetch are injected, no network is used."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import deep_research as dr  # noqa: E402

ARTICLE = '\n\n'.join([
    'Cookie banner and navigation text that has nothing to do with anything at all here.',
    'Qwen3.5 9B is an Apache 2.0 licensed model that runs on CPU with llama.cpp in GGUF format.',
    'Unrelated paragraph about the weather in a far away city and the price of bread lately.',
    'Benchmarks show the 9B model outperforming older 7B chat models on reasoning tasks by a wide margin.',
])


def search(results):
    def fn(query, count):
        if isinstance(results, Exception):
            raise results
        return results.get(query, [])
    return fn


class GatherTests(unittest.TestCase):
    def test_numbers_only_fetched_sources_and_reports_failures(self):
        hits = {'q1': [
            {'href': 'https://a.example/post?utm_source=x', 'title': 'A', 'body': 's'},
            {'href': 'https://a.example/post', 'title': 'A dup', 'body': 's'},
            {'href': 'https://b.example/x', 'title': 'B', 'body': 's'},
            {'href': 'https://c.example/broken', 'title': 'C', 'body': 's'},
        ]}

        def fetch(url):
            if 'broken' in url:
                raise TimeoutError('timed out')
            return ('Title ' + url, ARTICLE, '2026-10-01')

        report = dr.gather('Is Qwen3.5 9B good on CPU?', ['q1'], 5, search(hits), fetch, delay_s=0)
        self.assertEqual([s['id'] for s in report['sources']], [1, 2])
        self.assertEqual([s['domain'] for s in report['sources']], ['a.example', 'b.example'])
        self.assertEqual(report['failures'], [{'url': 'https://c.example/broken', 'error': 'TimeoutError: timed out'}])
        excerpt = report['sources'][0]['excerpt']
        self.assertIn('Apache 2.0', excerpt)
        self.assertLess(excerpt.index('Apache'), excerpt.index('Benchmarks'))  # document order kept

    def test_caps_results_per_domain(self):
        hits = {'q': [{'href': f'https://same.example/{i}', 'title': str(i)} for i in range(5)]}
        report = dr.gather('q', ['q'], 10, search(hits), lambda url: ('t', ARTICLE, ''), delay_s=0)
        self.assertEqual(len(report['sources']), dr.PER_DOMAIN)

    def test_a_failed_query_is_reported_and_the_rest_continue(self):
        calls = []

        def flaky(query, count):
            calls.append(query)
            if query == 'bad':
                raise RuntimeError('rate limited')
            return [{'href': 'https://ok.example/', 'title': 'ok'}]
        report = dr.gather('q', ['bad', 'good'], 3, flaky, lambda url: ('t', ARTICLE, ''), delay_s=0)
        self.assertEqual(calls, ['bad', 'good'])
        self.assertEqual(len(report['sources']), 1)
        self.assertEqual(report['failures'][0], {'query': 'bad', 'error': 'RuntimeError: rate limited'})

    def test_skips_pages_without_readable_text(self):
        report = dr.gather('q', ['q'], 3, search({'q': [{'href': 'https://spa.example/'}]}), lambda url: ('t', 'tiny', ''), delay_s=0)
        self.assertEqual(report['sources'], [])
        self.assertIn('no readable main text', report['failures'][0]['error'])
        self.assertIn('there is no evidence', dr.to_markdown(report))

    def test_limits_queries_and_sources(self):
        many = [f'q{i}' for i in range(20)]
        report = dr.gather('x', many, 99, search({}), lambda url: ('', '', ''), delay_s=0)
        self.assertEqual(len(report['queries']), dr.MAX_QUERIES)
        self.assertEqual(dr.gather('x', [], 3, search({}), lambda u: ('', '', ''), delay_s=0)['queries'], ['x'])

    def test_markdown_numbers_sources_for_citation(self):
        report = dr.gather('Qwen CPU', ['q'], 2, search({'q': [{'href': 'https://a.example/'}]}), lambda u: ('Qwen on CPU', ARTICLE, '2026-10-01'), delay_s=0)
        md = dr.to_markdown(report)
        self.assertIn('[1] Qwen on CPU (a.example, 2026-10-01)', md)
        self.assertIn('https://a.example/', md)


SIDES = ['Merab Dvalishvili', 'Petr Yan']
SENTIMENT = {'query': 'UFC 333 Dvalishvili vs Yan', 'sides': SIDES}
FIXED_NOW = lambda: '2026-10-24T00:00:00Z'  # noqa: E731


def reddit_search_payload():
    return {'data': {'children': [
        {'kind': 't3', 'data': {'id': 'p1', 'title': 'Yan takes the rematch, bank on it', 'selftext': '',
                                'permalink': '/r/MMA/comments/p1/x/', 'score': 42}},
        {'kind': 't3', 'data': {'id': 'p2', 'title': 'Yan vs Merab — who you got?', 'selftext': '',
                                'permalink': '/r/MMA/comments/p2/y/', 'score': 10}},
    ]}}


def reddit_comments_payload():
    return [{}, {'data': {'children': [
        {'kind': 't1', 'data': {'body': 'Merab by decision, the cardio is unreal', 'permalink': '/r/MMA/comments/p1/x/c1/', 'score': 9}},
        {'kind': 't1', 'data': {'body': 'Dvalishvili smothers him for five rounds', 'permalink': '/r/MMA/comments/p1/x/c2/', 'score': 4}},
        {'kind': 't1', 'data': {'body': 'Great fight either way, cannot wait', 'permalink': '/r/MMA/comments/p1/x/c3/', 'score': 1}},
    ]}}]


class FakeHttp:
    """Route by URL substring; a route value is (status, json) or an Exception to raise."""

    def __init__(self, routes):
        self.routes = routes
        self.gets = []
        self.posts = []

    def _route(self, url):
        for needle, result in self.routes:
            if needle in url:
                if isinstance(result, Exception):
                    raise result
                return result
        return (404, None)

    def get(self, url, headers):
        self.gets.append(url)
        return self._route(url)

    def post(self, url, headers, body):
        self.posts.append((url, body))
        return self._route(url)


def reddit_http(**overrides):
    routes = {
        'r/MMA/search.json': (200, reddit_search_payload()),
        'r/ufc/search.json': (200, {'data': {'children': []}}),
        'comments/p1.json': (200, reddit_comments_payload()),
        'comments/p2.json': (200, [{}, {'data': {'children': []}}]),
    }
    routes.update(overrides)
    return FakeHttp(list(routes.items()))


def lane_of(report, lane_id):
    return next(lane for lane in report['lanes'] if lane['id'] == lane_id)


class SentimentLaneTests(unittest.TestCase):
    def gather_sentiment(self, http, config=None, sentiment=SENTIMENT):
        return dr.gather('Who wins?', ['q'], 3, search({'q': [{'href': 'https://a.example/'}]}),
                         lambda url: ('t', ARTICLE, ''), delay_s=0, sentiment=sentiment,
                         config=config or {}, http_get=http.get, http_post=http.post, now_iso=FIXED_NOW)

    def test_reddit_lane_runs_and_the_lean_counts_exclusive_mentions(self):
        http = reddit_http()
        report = self.gather_sentiment(http)
        self.assertEqual(lane_of(report, 'reddit')['status'], 'ran')
        items = report['sentiment']['items']
        self.assertTrue(items)
        self.assertTrue(all(i['url'].startswith('https://www.reddit.com/') for i in items if i['lane'] == 'reddit'))
        lean = report['sentiment']['lean']
        # Pick-bearing: "Yan takes the rematch" (Yan), two comments for Merab/Dvalishvili.
        # Not bearing: "Yan vs Merab" (both), "Great fight either way" (neither).
        self.assertEqual(lean['counts'], [2, 1])
        self.assertEqual(lean['pick_bearing'], 3)
        self.assertEqual(lean['share_pct'], [66.7, 33.3])
        self.assertEqual(lean['method'], dr.LEAN_METHOD)

    def test_the_stored_lean_is_reproducible_from_the_stored_items(self):
        report = self.gather_sentiment(reddit_http())
        recomputed = dr.compute_lean(report['sentiment']['items'], SIDES)
        self.assertEqual(recomputed, report['sentiment']['lean'])

    def test_reddit_http_failure_is_a_failed_lane_with_the_cause(self):
        http = FakeHttp([('search.json', (403, None)), ('comments/', (403, None))])
        report = self.gather_sentiment(http)
        lane = lane_of(report, 'reddit')
        self.assertEqual(lane['status'], 'failed')
        self.assertIn('HTTP 403', lane['reason'])

    def test_reddit_transport_failure_is_a_failed_lane_not_a_crash(self):
        http = FakeHttp([('search.json', ConnectionError('peer closed connection')), ('comments/', ConnectionError('boom'))])
        report = self.gather_sentiment(http)
        lane = lane_of(report, 'reddit')
        self.assertEqual(lane['status'], 'failed')
        self.assertIn('ConnectionError', lane['reason'])
        self.assertEqual(len(report['sources']), 1)  # the web lane is untouched by the failure

    def test_x_lane_is_not_configured_without_a_key(self):
        report = self.gather_sentiment(reddit_http(), config={})
        lane = lane_of(report, 'x')
        self.assertEqual(lane['status'], 'not_configured')
        self.assertIn('XAI_API_KEY', lane['reason'])

    def test_x_lane_runs_on_a_contract_answer_and_fails_closed_on_prose(self):
        answer = '[{"text": "Merab all day, easiest pick on the card", "url": "https://x.com/fan/status/123456"}]'
        http = reddit_http()
        http.routes.append(('api.x.ai', (200, {'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': answer}]}]})))
        report = self.gather_sentiment(http, config={'xai_api_key': 'xai-test'})
        self.assertEqual(lane_of(report, 'x')['status'], 'ran')
        x_items = [i for i in report['sentiment']['items'] if i['lane'] == 'x']
        self.assertEqual(len(x_items), 1)
        self.assertEqual(x_items[0]['extraction'], dr.X_SEARCH_CONTRACT)

        prose = reddit_http()
        prose.routes.append(('api.x.ai', (200, {'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': 'Here are the posts people made…'}]}]})))
        report = self.gather_sentiment(prose, config={'xai_api_key': 'xai-test'})
        lane = lane_of(report, 'x')
        self.assertEqual(lane['status'], 'failed')
        self.assertIn('extraction contract', lane['reason'])

    def test_facebook_lane_is_not_configured_without_a_token(self):
        report = self.gather_sentiment(reddit_http(), config={})
        lane = lane_of(report, 'facebook')
        self.assertEqual(lane['status'], 'not_configured')
        self.assertIn('FACEBOOK_ACCESS_TOKEN', lane['reason'])

    def test_facebook_graph_error_is_a_failed_lane_naming_the_error(self):
        http = reddit_http()
        http.routes.insert(0, ('graph.facebook.com', (400, {'error': {'message': 'Invalid OAuth access token'}})))
        report = self.gather_sentiment(http, config={'facebook_access_token': 'bad-token'})
        lane = lane_of(report, 'facebook')
        self.assertEqual(lane['status'], 'failed')
        self.assertIn('Invalid OAuth access token', lane['reason'])

    def test_every_run_reports_the_full_lane_manifest(self):
        report = dr.gather('q', ['q'], 3, search({'q': [{'href': 'https://a.example/'}]}),
                           lambda url: ('t', ARTICLE, ''), delay_s=0, now_iso=FIXED_NOW)
        self.assertEqual([lane['id'] for lane in report['lanes']], ['web', 'reddit', 'x', 'facebook'])
        self.assertEqual(lane_of(report, 'web')['status'], 'ran')
        for lane_id in ('reddit', 'x', 'facebook'):
            lane = lane_of(report, lane_id)
            self.assertEqual(lane['status'], 'not_configured')
            self.assertIn('no sentiment subjects', lane['reason'])
        self.assertFalse(report['sentiment_requested'])
        self.assertNotIn('sentiment', report)

    def test_markdown_names_the_missing_forum_layer(self):
        report = self.gather_sentiment(reddit_http(), config={})
        md = dr.to_markdown(report)
        self.assertIn('forum layer missing: X', md)
        self.assertIn('forum layer missing: Facebook', md)
        self.assertNotIn('forum layer missing: Reddit', md)

    def test_lean_token_rules_shared_names_and_both_sides(self):
        sides = ['Alex Pereira', 'Alex Volkanovski']
        items = [
            {'text': 'Alex wins this easily'},          # shared first name only: counts for neither
            {'text': 'Pereira by KO in the second'},     # side A
            {'text': 'Volkanovski defends the takedowns'},  # side B
            {'text': 'Pereira vs Volkanovski is a war'},  # both: not pick-bearing
        ]
        lean = dr.compute_lean(items, sides)
        self.assertEqual(lean['counts'], [1, 1])
        self.assertEqual(lean['pick_bearing'], 2)


if __name__ == '__main__':
    unittest.main()
