"""Offline tests for mirofish_world.py. Fixtures follow the record shapes MiroFish writes (read from its source, 2026-10-24);
they are synthetic, not from a real run, and the tests say so by not claiming anything about simulation quality."""
import json
import os
import re
import sys
import unittest
import xml.dom.minidom

sys.path.insert(0, os.path.dirname(__file__))
import mirofish_world as mw  # noqa: E402

A, B = 'Merab Dvalishvili', 'Petr Yan'
KEY = {'card_id': 'UFC333', 'market_ticker': 'KXUFCFIGHT-26OCT24YANDVA-YAN'}
ENGINE = {'name': 'mirofish', 'repo_commit': '7657031', 'uv_lock_sha256': 'f' * 64, 'python': '3.11', 'torch': '2.9.1+cpu'}


def act(round_, agent_id, name, action_type, ts, **args):
    return {'round': round_, 'timestamp': ts, 'agent_id': agent_id, 'agent_name': name, 'action_type': action_type,
            'action_args': args, 'result': None, 'success': True}


ACTIONS_REDDIT = [
    {'event_type': 'simulation_start', 'platform': 'reddit', 'timestamp': '2026-10-25T00:00:00'},
    {'round': 1, 'event_type': 'round_start', 'simulated_hour': 1, 'timestamp': '2026-10-25T00:00:01'},
    act(1, 0, 'Coach Voice', 'CREATE_POST', '2026-10-25T00:00:02', content='Yan stuffed the takedowns in fight two. Why would that change?'),
    act(1, 1, 'Merab Fan', 'CREATE_COMMENT', '2026-10-25T00:00:03', content='Pace beats defense by round four.', post_id=1),
    act(1, 2, 'Neutral Analyst', 'LIKE_POST', '2026-10-25T00:00:04', original_content='Yan stuffed the takedowns'),
    act(1, 2, 'Neutral Analyst', 'DO_NOTHING', '2026-10-25T00:00:05'),
    {'round': 1, 'event_type': 'round_end', 'actions_count': 4, 'timestamp': '2026-10-25T00:00:06'},
    {'round': 2, 'event_type': 'round_start', 'simulated_hour': 2, 'timestamp': '2026-10-25T00:01:00'},
    act(2, 0, 'Coach Voice', 'QUOTE_POST', '2026-10-25T00:01:02', quote_content='Both sides are overrating cardio.', original_content='Pace beats defense'),
    act(2, 1, 'Merab Fan', 'FOLLOW', '2026-10-25T00:01:03', target_user_name='Coach Voice'),
    {**act(2, 3, 'Broken', 'CREATE_POST', '2026-10-25T00:01:04', content='never shown'), 'success': False},
    {'event_type': 'simulation_end', 'platform': 'reddit', 'total_rounds': 2, 'total_actions': 6, 'timestamp': '2026-10-25T00:02:00'},
]
GRAPH = {'nodes': [{'uuid': 'u2', 'name': 'Petr Yan', 'labels': ['Entity', 'Fighter'], 'summary': 'Champion, switch stance.', 'attributes': {}},
                   {'uuid': 'u1', 'name': 'Merab Dvalishvili', 'labels': ['Entity', 'Fighter'], 'summary': 'Wrestler, pace.', 'attributes': {}}],
         'edges': [{'name': 'FACED', 'fact': 'Yan and Merab fought twice.', 'source_node_uuid': 'u1', 'target_node_uuid': 'u2',
                    'source_node_name': 'Merab Dvalishvili', 'target_node_name': 'Petr Yan'}]}
PROFILES = [{'user_id': 1, 'username': 'mfan', 'name': 'Merab Fan', 'persona': 'Believes pace wins.', 'bio': ''},
            {'user_id': 0, 'username': 'coach', 'name': 'Coach Voice', 'persona': 'Ex-wrestling coach.', 'bio': ''},
            {'user_id': 2, 'username': 'neutral', 'name': 'Neutral Analyst', 'persona': 'Stats person.', 'bio': ''}]
POLL = [{'agent_id': 0, 'text': 'PICK=B; P_A=35; WHY=Takedown defense held in fight two.'},
        {'agent_id': 1, 'text': 'PICK=A; P_A=62; WHY=Pace.'},
        {'agent_id': 2, 'text': 'I think it is a toss up honestly.'}]
REPORT_MD = '# Report\nlead text\n## Where the crowd settled\nSplit.\n## What moved it\nThe takedown record.\n'


def world(**over):
    base = dict(key=KEY, engine=ENGINE, sides=[A, B], graph=GRAPH, profiles=PROFILES, actions={'reddit': mw.parse_actions_jsonl(
        '\n'.join(json.dumps(o) for o in ACTIONS_REDDIT))}, poll_answers=POLL, report_sections=mw.report_sections_from_markdown(REPORT_MD))
    base.update(over)
    return mw.build_world(**base)


class PollParsingTests(unittest.TestCase):
    def test_parses_the_requested_format(self):
        p = mw.parse_poll_answer('PICK=B; P_A=35; WHY=Takedown defense held.', A, B)
        self.assertEqual((p['pick'], p['p_a'], p['consistent']), ('B', 35.0, True))
        self.assertEqual(p['why'], 'Takedown defense held.')

    def test_accepts_a_name_instead_of_a_letter_and_loose_punctuation(self):
        self.assertEqual(mw.parse_poll_answer('PICK = Petr Yan; P_A = 40%; WHY=x', A, B)['pick'], 'B')
        self.assertEqual(mw.parse_poll_answer('**PICK=A**\nP_A=71', A, B)['pick'], 'A')

    def test_never_guesses_a_missing_field(self):
        p = mw.parse_poll_answer('It is a toss up.', A, B)
        self.assertEqual((p['pick'], p['p_a'], p['consistent']), (None, None, None))
        self.assertIsNone(mw.parse_poll_answer('PICK=B', A, B)['p_a'])
        self.assertIsNone(mw.parse_poll_answer('PICK=A; P_A=140', A, B)['p_a'])  # out of range is not coerced
        self.assertIsNone(mw.parse_poll_answer('PICK=Dvalishvili Yan', A, B)['pick'])  # names both sides: ambiguous, not guessed

    def test_flags_an_answer_that_contradicts_itself(self):
        p = mw.parse_poll_answer('PICK=A; P_A=30; WHY=x', A, B)
        self.assertFalse(p['consistent'])

    def test_statistics_come_from_the_stored_answers(self):
        parsed = [mw.parse_poll_answer(t['text'], A, B) for t in POLL]
        s = mw.poll_stats(parsed)
        self.assertEqual((s['n'], s['unparsed'], s['picks'], s['p_a_n']), (3, 1, {'A': 1, 'B': 1}, 2))
        self.assertEqual((s['median_p_a'], s['q1_p_a'], s['q3_p_a'], s['iqr_p_a']), (48.5, 41.8, 55.2, 13.5))
        empty = mw.poll_stats([])
        self.assertEqual((empty['n'], empty['median_p_a']), (0, None))


class WorldTests(unittest.TestCase):
    def test_builds_from_mirofish_records(self):
        w = world()
        self.assertEqual(w['schema'], 'forgeclaw.sim-world.v1')
        self.assertEqual([n['name'] for n in w['graph']['nodes']], ['Merab Dvalishvili', 'Petr Yan'])  # sorted, stable
        self.assertEqual(w['graph']['nodes'][0]['kind'], 'Fighter')
        self.assertEqual(w['graph']['edges'][0]['relation'], 'FACED')
        self.assertEqual([a['id'] for a in w['agents']], [0, 1, 2])
        self.assertEqual({a['id']: a['final_pick'] for a in w['agents']}, {0: B, 1: A, 2: 'undecided'})
        self.assertEqual([r['n'] for r in w['rounds']], [1, 2])
        self.assertEqual(w['rounds'][0]['hour'], 1)
        types = [e['type'] for e in w['rounds'][0]['events']]
        self.assertEqual(types, ['CREATE_POST', 'CREATE_COMMENT', 'LIKE_POST', 'DO_NOTHING'])
        self.assertEqual(w['rounds'][1]['events'][0]['text'], 'Both sides are overrating cardio.')
        self.assertEqual(w['rounds'][1]['events'][0]['target'], 'Pace beats defense')
        self.assertEqual(w['rounds'][0]['events'][1]['target'], 'post:1')
        self.assertEqual([s['title'] for s in w['report']['sections']], ['', 'Where the crowd settled', 'What moved it'])

    def test_a_failed_action_never_appears_and_is_counted(self):
        w = world()
        self.assertNotIn('never shown', json.dumps(w))
        self.assertEqual((w['limits']['events_total'], w['limits']['events_failed'], w['limits']['events_kept']), (7, 1, 6))
        self.assertFalse(w['limits']['truncated'])

    def test_the_poll_block_carries_the_stats_and_the_question_hash_not_the_question_drift(self):
        w = world()
        self.assertEqual(w['poll']['method'], 'agent-poll-v1')
        self.assertEqual(w['poll']['median_p_a'], 48.5)
        self.assertEqual(len(w['poll']['answers']), 3)
        self.assertEqual(len(w['poll']['question_sha256']), 64)
        self.assertIn('not independent evidence', w['note'])

    def test_is_byte_for_byte_deterministic(self):
        self.assertEqual(mw.dump_world(world()), mw.dump_world(world()))
        shuffled = {'reddit': list(reversed(mw.parse_actions_jsonl('\n'.join(json.dumps(o) for o in ACTIONS_REDDIT))))}
        self.assertEqual(mw.sha256_hex(mw.dump_world(world())), mw.sha256_hex(mw.dump_world(world(actions=shuffled))))

    def test_malformed_lines_are_skipped_not_fatal(self):
        objs = mw.parse_actions_jsonl('{"round":1}\nnot json\n\n[1,2]\n{"round":2}')
        self.assertEqual([o['round'] for o in objs], [1, 2])

    def test_oversize_worlds_shed_low_signal_events_first_and_say_so(self):
        big = []
        for r in range(1, 40):
            big.append({'round': r, 'event_type': 'round_start', 'simulated_hour': r})
            for a in range(30):
                big.append(act(r, a % 3, f'Agent {a % 3}', 'CREATE_POST', f'2026-10-25T00:{r:02d}:{a:02d}', content='long argument ' * 20))
                big.append(act(r, a % 3, f'Agent {a % 3}', 'LIKE_POST', f'2026-10-25T00:{r:02d}:{a:02d}', original_content='liked post ' * 8))
        w = world(actions={'reddit': big}, max_bytes=60_000)
        self.assertLessEqual(len(mw.dump_world(w)), 60_000)
        self.assertTrue(w['limits']['truncated'])
        self.assertTrue(w['limits']['steps'])
        self.assertLess(w['limits']['events_kept'], w['limits']['events_total'])
        self.assertTrue(all(e['type'] in mw.HIGH_SIGNAL for r in w['rounds'] for e in r['events']))

    def test_a_world_that_fits_is_not_marked_truncated(self):
        self.assertFalse(world()['limits']['truncated'])

    def test_report_sections_are_titled_capped_and_keep_a_lead(self):
        sections = mw.report_sections_from_markdown('# T\nlead\n## One\na\n## Two\nb\n## Three\nc\n## Four\nd\n## Five\ne\n## Six\nf')
        self.assertEqual(len(sections), mw.MAX_SECTIONS)
        self.assertEqual(sections[0]['title'], '')
        self.assertIn('lead', sections[0]['markdown'])


class SvgTests(unittest.TestCase):
    def test_is_well_formed_self_contained_and_script_free(self):
        svg = mw.render_svg(world())
        xml.dom.minidom.parseString(svg)  # well-formed XML
        self.assertNotRegex(svg, r'(?i)<script|onload=|onclick=|href=|xlink:|<image|<foreignObject')
        self.assertTrue(svg.startswith('<svg xmlns="http://www.w3.org/2000/svg"'))
        self.assertLess(len(svg.encode()), mw.MAX_SVG_BYTES)

    def test_says_what_it_is_and_shows_the_clusters(self):
        svg = mw.render_svg(world())
        self.assertIn('Merab Dvalishvili vs Petr Yan', svg)  # whitespace is collapsed on purpose
        self.assertIn('not independent evidence', svg)
        self.assertIn('Petr Yan (1)', svg)
        self.assertIn('Merab Dvalishvili (1)', svg)
        self.assertIn('undecided (1)', svg)
        self.assertIn('median P(Merab Dvalishvili) 48.5', svg)
        self.assertIn('Yan stuffed the takedowns in fight two', svg)

    def test_is_deterministic(self):
        self.assertEqual(mw.render_svg(world()), mw.render_svg(world()))

    def test_hostile_text_cannot_inject_markup(self):
        evil = [act(1, 0, 'x', 'CREATE_POST', 't', content='</text><script>alert(1)</script> & "quotes" \x01')]
        w = world(actions={'reddit': evil}, profiles=[{'user_id': 0, 'name': '<b onload=1>', 'persona': 'p'}])
        svg = mw.render_svg(w)
        xml.dom.minidom.parseString(svg)
        self.assertNotIn('<script', svg)
        self.assertNotIn('<b onload', svg)
        self.assertIn('&lt;script&gt;', svg)

    def test_an_empty_world_still_renders_and_says_so(self):
        w = world(actions={'reddit': []}, profiles=[], poll_answers=[], graph={'nodes': [], 'edges': []})
        svg = mw.render_svg(w)
        xml.dom.minidom.parseString(svg)
        self.assertIn('no posts or comments were recorded', svg)
        self.assertIn('no probability parsed', svg)


if __name__ == '__main__':
    unittest.main()
