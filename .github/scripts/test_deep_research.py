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


# Snippets below are trimmed from the real search results of 2026-10-24 (the reachability probe for UFC 333 fighters).
YAN_IG_PROFILE = {'href': 'https://www.instagram.com/petr_yan/', 'title': 'Петр "No Mercy" Ян (@petr_yan) • Instagram photos and videos',
                  'body': '2M Followers, 761 Following, 1,464 Posts - Петр "No Mercy" Ян (@petr_yan) on Instagram: "🔺UFC Champion🏆 🔺Team @archangl_michael'}
NAMESAKE_IG = {'href': 'https://www.instagram.com/yantastic/', 'title': 'Peter Yan (@yantastic) • Instagram photos and videos',
               'body': '803K Followers - Peter Yan (@yantastic) on Instagram: "Melbourne Australia @presets My iPhone & Osmo LUTs, Presets"'}
YAN_IG_OWN = {'href': 'https://www.instagram.com/p/DeKZJkACIyx/', 'title': 'Instagram',
              'body': '343K likes, 3,291 comments - petr_yan on October 6, 2026: "Работа такая , надо делать ⚡️ That\'s the job—it has to be done"'}
YAN_IG_OLD = {'href': 'https://www.instagram.com/p/DbfwxqACKmL/', 'title': 'Instagram',
              'body': '58K likes, 478 comments - petr_yan on August 1, 2026: "Сегодня состоялся очередной праздник"'}
ESPN_ABOUT_YAN = {'href': 'https://www.instagram.com/p/DR880Lujc7Q/', 'title': 'Instagram',
                  'body': '334K likes, 2,128 comments - espnmma on October 20, 2026: "Petr Yan put on an absolute clinic"'}
YAN_X_PROFILE = {'href': 'https://x.com/PetrYanUFC', 'title': 'Petr "No Mercy" Yan (@PetrYanUFC) / X', 'body': 'UFC bantamweight from Siberia, Russia.'}
MERAB_X_OWN = {'href': 'https://x.com/MerabDvalishvil/status/2106565593268879862', 'title': 'Post',
               'body': 'Post Merab "The Machine" Dvalishvili @MerabDvalishvil Wow, we have a new contender in bantamweight 🦾 #UFC332 2:02 AM · Oct 4, 2026'}
UFC_ABOUT_YAN_X = {'href': 'https://x.com/ufc/status/2113503056843423988', 'title': 'UFC on X: "No Mercy @PetrYanUFC weighs in at 135 lbs"', 'body': 'No Mercy weighs in'}
YAN_X_OLD = {'href': 'https://x.com/PetrYanUFC/status/1259332032695418888', 'title': 'x', 'body': "I'm watching this fight very closely #UFC249"}
VOLK_TT_OWN = {'href': 'https://www.tiktok.com/@alexvolkanovski/video/7623943615487708434', 'title': 'TikTok',
               'body': '1134 Likes, 44 Comments. TikTok video from Alex Volkanovski (@alexvolkanovski): "Hunting invasive deer on my property".'}
FIGHT_NOW = dr.datetime(2026, 10, 24, tzinfo=dr.timezone.utc)


def scripted(table):
    """A search backend answering by exact query; a value that is an Exception is raised."""
    calls = []

    def fn(query, count):
        calls.append(query)
        value = table.get(query, [])
        if isinstance(value, Exception):
            raise value
        return value
    fn.calls = calls
    return fn


class FighterPostsTests(unittest.TestCase):
    def test_x_ids_decode_to_the_times_x_displayed(self):
        # Displayed on the posts: 2:02 AM Oct 4 2026 (UTC) and 8:33 PM Oct 24 2026.
        self.assertEqual(dr.x_post_time('2106565593268879862').strftime('%Y-%m-%d %H:%M'), '2026-10-04 02:02')
        self.assertEqual(dr.x_post_time('2114092946442309978').strftime('%Y-%m-%d %H:%M'), '2026-10-24 20:33')
        self.assertIsNone(dr.x_post_time('not-a-number'))

    def test_keeps_only_the_fighters_own_recent_posts_and_drops_namesakes_and_third_parties(self):
        sr = scripted({
            'site:instagram.com Petr Yan': [NAMESAKE_IG, YAN_IG_PROFILE],
            'site:instagram.com/p petr_yan': [YAN_IG_OWN, ESPN_ABOUT_YAN, YAN_IG_OLD],
            'site:instagram.com/reel petr_yan': [YAN_IG_OWN],
            'site:x.com Petr Yan': [YAN_X_PROFILE],
            'site:x.com/PetrYanUFC/status': [UFC_ABOUT_YAN_X, YAN_X_OLD],
        })
        out = dr.fighter_posts_for('Petr Yan', sr, 0, FIGHT_NOW)
        self.assertEqual(out['handles'], {'instagram': 'petr_yan', 'x': 'PetrYanUFC'})  # not @yantastic
        self.assertEqual(out['status'], 'ran')
        self.assertEqual([i['url'] for i in out['items']], ['https://www.instagram.com/p/DeKZJkACIyx/'])  # de-duplicated; own and in window
        self.assertEqual(out['items'][0]['date'], '2026-10-06')
        self.assertIn("That's the job", out['items'][0]['text'])
        self.assertGreaterEqual(out['stale_set_aside'], 1)  # the Aug 1 post and the 2020 X post are older than the window

    def test_captions_lose_their_closing_quote_and_full_stop(self):
        self.assertEqual(dr._clip('Press Conference time #UFC333".'), 'Press Conference time #UFC333')
        self.assertEqual(dr._clip('He said "stay ready" and left'), 'He said "stay ready" and left')

    def test_a_third_party_post_is_never_attributed_to_the_fighter(self):
        posts = dr._own_posts('instagram', 'petr_yan', [ESPN_ABOUT_YAN])
        self.assertEqual(posts, [])
        self.assertEqual(dr._own_posts('x', 'PetrYanUFC', [UFC_ABOUT_YAN_X]), [])

    def test_x_and_tiktok_posts_are_dated_from_their_ids_and_matched_to_the_account_in_the_url(self):
        mine = dr._own_posts('x', 'merabdvalishvil', [MERAB_X_OWN])
        self.assertEqual((mine[0]['date'], mine[0]['date_source']), ('2026-10-04', 'post-id'))
        self.assertIn('new contender in bantamweight', mine[0]['text'])
        tiktok = dr._own_posts('tiktok', 'alexvolkanovski', [VOLK_TT_OWN])
        self.assertEqual((tiktok[0]['date'], tiktok[0]['date_source']), ('2026-04-01', 'post-id'))
        self.assertIn('auto-generated', tiktok[0]['note'])  # TikTok's index text is not necessarily the fighter's words
        self.assertNotIn('note', mine[0])
        self.assertEqual(dr._own_posts('tiktok', 'someoneelse', [VOLK_TT_OWN]), [])

    def test_a_fighter_with_no_verified_handle_is_reported_with_the_reason_not_guessed(self):
        sr = scripted({'site:instagram.com Petr Yan': [NAMESAKE_IG]})
        out = dr.fighter_posts_for('Petr Yan', sr, 0, FIGHT_NOW)
        self.assertEqual((out['status'], out['handles'], out['items']), ('no_handle', {}, []))
        self.assertIn('no instagram profile found that reads as Petr Yan', out['reason'])

    def test_a_verified_handle_with_nothing_recent_says_so(self):
        sr = scripted({'site:x.com Petr Yan': [YAN_X_PROFILE], 'site:x.com/PetrYanUFC/status': [YAN_X_OLD]})
        out = dr.fighter_posts_for('Petr Yan', sr, 0, FIGHT_NOW)
        self.assertEqual(out['status'], 'none_found')
        self.assertIn('no own post indexed in the last 60 days', out['reason'])
        self.assertIn('1 older post(s) set aside', out['reason'])

    def test_a_search_backend_that_errors_is_a_failed_fighter_not_a_crash_and_is_retried(self):
        boom = RuntimeError('rate limited')
        sr = scripted({q: boom for q in ('site:instagram.com Petr Yan', 'site:x.com Petr Yan', 'site:tiktok.com Petr Yan')})
        out = dr.fighter_posts_for('Petr Yan', sr, 0, FIGHT_NOW)
        self.assertEqual(out['status'], 'failed')
        self.assertIn('RuntimeError: rate limited', out['reason'])
        self.assertEqual(sr.calls.count('site:x.com Petr Yan'), dr.SEARCH_RETRIES + 1)

    def test_an_empty_answer_is_retried_then_accepted_when_the_backend_recovers(self):
        answers = iter([[], [], [YAN_X_PROFILE]])
        calls = []

        def flaky(query, count):
            calls.append(query)
            return next(answers) if query == 'site:x.com Petr Yan' else []
        handle, why = dr.discover_handle('Petr Yan', 'x', 'x.com', dr.PLATFORMS[1][2], flaky, 0)
        self.assertEqual((handle, why), ('PetrYanUFC', ''))

    def test_undated_posts_are_capped_and_flagged(self):
        lead = lambda n: {'href': f'https://www.instagram.com/p/U{n}/', 'title': 'Instagram', 'body': f'petr_yan Follow 20,106likes petr_yan Caption number {n}'}  # noqa: E731
        sr = scripted({'site:instagram.com Petr Yan': [YAN_IG_PROFILE], 'site:instagram.com/p petr_yan': [lead(n) for n in range(6)]})
        out = dr.fighter_posts_for('Petr Yan', sr, 0, FIGHT_NOW)
        self.assertEqual(len(out['items']), dr.FIGHTER_POSTS_MAX_UNDATED)
        self.assertTrue(all(i.get('undated') for i in out['items']))

    def test_the_block_is_separate_from_the_lanes_and_the_crowd_lean(self):
        sr = scripted({'q': [{'href': 'https://a.example/'}], 'site:instagram.com Petr Yan': [YAN_IG_PROFILE],
                       'site:instagram.com/p petr_yan': [YAN_IG_OWN]})
        http = reddit_http()
        report = dr.gather('Who wins?', ['q'], 3, sr, lambda url: ('t', ARTICLE, ''), delay_s=0, sentiment=SENTIMENT,
                           config={}, http_get=http.get, http_post=http.post, now_iso=FIXED_NOW)
        self.assertNotIn('fighter_posts', [lane['id'] for lane in report['lanes']])
        self.assertEqual(report['fighter_posts']['method'], dr.FIGHTER_POSTS_METHOD)
        self.assertEqual([f['name'] for f in report['fighter_posts']['fighters']], SIDES)
        # The fighter's own caption names Yan; it must not be counted as crowd opinion.
        self.assertTrue(all('petr_yan' not in item['url'] for item in report['sentiment']['items']))
        md = dr.to_markdown(report)
        self.assertIn('## Fighter posts (own accounts only', md)
        self.assertIn('Petr Yan (instagram:@petr_yan): ', md)
        self.assertIn('unavailable — ', md)  # the other fighter had no handle: named, not silent

    def test_no_block_without_sentiment_subjects(self):
        report = dr.gather('q', ['q'], 3, search({'q': [{'href': 'https://a.example/'}]}), lambda url: ('t', ARTICLE, ''), delay_s=0, now_iso=FIXED_NOW)
        self.assertNotIn('fighter_posts', report)


if __name__ == '__main__':
    unittest.main()
