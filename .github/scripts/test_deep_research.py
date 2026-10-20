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


if __name__ == '__main__':
    unittest.main()
