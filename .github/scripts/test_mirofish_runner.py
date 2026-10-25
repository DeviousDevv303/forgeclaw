"""Offline tests for mirofish_runner.py against a SCRIPTED FAKE MiroFish HTTP server.

What these prove: the runner's orchestration, its refusals, its abort handling, its cleanup and its record. What they do NOT
prove: that the real MiroFish answers like the fake. The fake follows the request and response shapes documented in
MiroFish's own handlers (read 2026-10-24); a keyed spike against the real engine is still open."""
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(__file__))
import mirofish_runner as mr  # noqa: E402
import mirofish_world as mw  # noqa: E402

A, B = 'Merab Dvalishvili', 'Petr Yan'
COMMIT, LOCK = 'a' * 40, 'b' * 64
PINS = {'repo_commit': COMMIT, 'uv_lock_sha256': LOCK, 'python': '3.11', 'torch': '2.9.1+cpu', 'torch_cpu_sha256': 'c' * 64,
        'uv_version': '0.9.26', 'runner_image': 'ubuntu-24.04'}
GOLDEN = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'scripts', 'fixtures', 'mirofish-sim-run.nexus.json')
PACKET = ('# Seed packet\n\n## Stats snapshot\n' + 'Yan landed 128 of 228 significant strikes in the rematch; Merab landed 131 of 363. ' * 20 +
          '\n\n## Matchup read\nPrimary paths, adaptation across meetings, the fight that remains. ' * 8)
ACTIONS = '\n'.join(json.dumps(o) for o in [
    {'event_type': 'round_start', 'round': 1, 'simulated_hour': 1},
    {'round': 1, 'timestamp': 't1', 'agent_id': 0, 'agent_name': 'Coach', 'action_type': 'CREATE_POST', 'action_args': {'content': 'Yan stuffed it.'}, 'success': True},
    {'round': 1, 'timestamp': 't2', 'agent_id': 1, 'agent_name': 'Fan', 'action_type': 'CREATE_COMMENT', 'action_args': {'content': 'Pace wins.', 'post_id': 1}, 'success': True},
])
# Credential-SHAPED fixtures for the packet screen, assembled at runtime so no such literal sits in this file. They are not credentials.
FAKE_API_KEY = 's' + 'k-' + 'x' * 32
FAKE_GH_TOKEN = 'gh' + 'p_' + 'a' * 30
FAKE_KEY_HEADER = '-----BEGIN ' + 'RSA PRIVATE ' + 'KEY-----'


class FakeMiro:
    """Scripted MiroFish. Records every request. Knobs are plain attributes tests can set before running."""

    def __init__(self):
        self.requests = []
        self.agents = 6
        self.graph_task = [{'status': 'processing'}, {'status': 'completed', 'result': {'graph_id': 'g1'}}]
        self.run_states = [{'runner_status': 'running', 'current_round': 2}, {'runner_status': 'completed', 'current_round': 4}]
        self.env_alive = True
        self.interviews = {f'reddit_{i}': {'agent_id': i, 'platform': 'reddit', 'response': f'PICK={"A" if i % 2 else "B"}; P_A={65 if i % 2 else 35}; WHY=x'} for i in range(6)}
        self.report_md = '# R\n## Where the crowd settled\nSplit.\n## What moved it\nTakedowns.\n'
        self.graph_data_status = 200
        self.ontology_status = 200
        self.on_run_status = None
        self._poll = {'graph': 0, 'run': 0}
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                return

            def _reply(self, status, obj):
                body = json.dumps(obj).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _handle(self, method):
                raw = self.rfile.read(int(self.headers.get('Content-Length') or 0)) if method in ('POST', 'DELETE') else b''
                ctype = self.headers.get('Content-Type', '')
                body = {} if ctype.startswith('multipart') or not raw else json.loads(raw)
                outer.requests.append({'method': method, 'path': self.path, 'body': body, 'raw': raw, 'ctype': ctype, 'lang': self.headers.get('Accept-Language')})
                status, obj = outer.route(method, self.path.split('?')[0], body)
                self._reply(status, obj)

            def do_GET(self):  # noqa: N802
                self._handle('GET')

            def do_POST(self):  # noqa: N802
                self._handle('POST')

            def do_DELETE(self):  # noqa: N802
                self._handle('DELETE')

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), H)
        self.server.daemon_threads = True
        threading.Thread(target=lambda: self.server.serve_forever(poll_interval=0.05), daemon=True).start()
        self.url = f'http://127.0.0.1:{self.server.server_address[1]}'

    def close(self):
        self.server.shutdown()
        self.server.server_close()

    def ok(self, data):
        return 200, {'success': True, 'data': data}

    def paths(self, method=None):
        return [r['path'].split('?')[0] for r in self.requests if method is None or r['method'] == method]

    def route(self, method, path, body):
        if path == '/api/graph/ontology/generate':
            if self.ontology_status != 200:  # what MiroFish answers when its LLM call is rejected (seen live, 2026-10-25)
                return self.ontology_status, {'success': False, 'error': 'LLM provider request failed (HTTP 400)'}
            return self.ok({'project_id': 'proj_1'})
        if path == '/api/graph/build':
            return self.ok({'task_id': 't_graph'})
        if path == '/api/graph/task/t_graph':
            i = min(self._poll['graph'], len(self.graph_task) - 1)
            self._poll['graph'] += 1
            return self.ok(self.graph_task[i])
        if path == '/api/simulation/create':
            return self.ok({'simulation_id': 'sim_1'})
        if path == '/api/simulation/prepare':
            return self.ok({'task_id': 't_prep', 'status': 'preparing', 'already_prepared': False})
        if path == '/api/simulation/prepare/status':
            return self.ok({'status': 'completed'})
        if re.fullmatch(r'/api/simulation/sim_1/profiles', path):
            profiles = [{'user_id': i, 'username': f'u{i}', 'name': ['Coach', 'Fan', 'Analyst', 'Ref', 'Writer', 'Rival'][i % 6], 'persona': 'p'} for i in range(self.agents)]
            return self.ok({'platform': 'reddit', 'count': self.agents, 'profiles': profiles})
        if path == '/api/simulation/start':
            return self.ok({'runner_status': 'running'})
        if path == '/api/simulation/sim_1/run-status':
            if self.on_run_status:
                self.on_run_status()
            i = min(self._poll['run'], len(self.run_states) - 1)
            self._poll['run'] += 1
            return self.ok(self.run_states[i])
        if path == '/api/simulation/stop':
            return self.ok({'runner_status': 'stopped'})
        if path == '/api/simulation/env-status':
            return self.ok({'env_alive': self.env_alive})
        if path == '/api/simulation/interview/all':
            return self.ok({'interviews_count': len(self.interviews), 'result': {'results': self.interviews}})
        if path == '/api/simulation/close-env':
            return self.ok({})
        if path == '/api/report/generate':
            return self.ok({'task_id': 't_rep', 'status': 'generating'})
        if path == '/api/report/generate/status':
            return self.ok({'status': 'completed'})
        if path == '/api/report/by-simulation/sim_1':
            return self.ok({'report_id': 'report_1', 'markdown_content': self.report_md})
        if path == '/api/graph/data/g1':
            if self.graph_data_status != 200:
                return self.graph_data_status, {'success': False, 'error': '<html>boom</html>'}
            return self.ok({'nodes': [{'uuid': 'n1', 'name': 'Petr Yan', 'labels': ['Entity', 'Fighter'], 'summary': 's'}], 'edges': []})
        if method == 'DELETE' and path == '/api/graph/delete/g1':
            return self.ok({})
        return 404, {'success': False, 'error': f'no route {method} {path}'}


class Env:
    """A temp results dir, out dir and MiroFish dir, a fake meter, and a clock the polling sleeps advance."""

    def __init__(self, test: unittest.TestCase, **over):
        self.root = tempfile.mkdtemp(prefix='mirofish-test-')
        test.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.results, self.out, self.mdir = (os.path.join(self.root, n) for n in ('results', 'out', 'mirofish'))
        for d in (self.results, self.out):
            os.makedirs(d)
        sim_dir = os.path.join(self.mdir, 'backend', 'uploads', 'simulations', 'sim_1', 'reddit')
        os.makedirs(sim_dir)
        with open(os.path.join(sim_dir, 'actions.jsonl'), 'w') as handle:
            handle.write(ACTIONS)
        self.miro = FakeMiro()
        test.addCleanup(self.miro.close)
        self.meter_state = {'calls': 40, 'cost_usd': 0.11, 'ceiling_usd': 0.40, 'ceiling_hit': False, 'model': 'kimi-k2.6', 'provider': 'moonshot'}
        self.now = 1_800_000_000.0
        self.direct_text = 'PICK=B; P_A=40; WHY=baseline.'
        self.args = {'packet_text': PACKET, 'card_id': 'UFC333', 'market_ticker': 'KXUFCFIGHT-26OCT24YANDVA-YAN', 'sides': [A, B], 'yes_side': B,
                     'preset': 'tiny', 'provider': 'moonshot', 'model': 'kimi-k2.6', 'mirofish_dir': self.mdir, 'results_dir': self.results,
                     'out_dir': self.out, 'pins': dict(PINS),
                     'provenance': {'stats_snapshot': 'espn:600061267', 'matchup_read': 'sha:abc', 'human_state': 'absent'},
                     'rerun_reason': '', 'invocation_id': 'inv-1', 'run_url': 'https://github.com/x/y/actions/runs/1'}
        self.args.update(over)

    def sleep(self, seconds):
        self.now += seconds

    def clock(self):
        return self.now

    def run(self, **over):
        args = {**self.args, **over}
        miro = mr.Miro(mr.Http(self.miro.url))
        return mr.run_attempt(args, miro, lambda: dict(self.meter_state), lambda prompt: self.direct_text, sleep=self.sleep, clock=self.clock)


def read_json(path):
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


class SuccessPathTests(unittest.TestCase):
    def test_a_completed_run_writes_the_record_and_three_hashed_artifacts(self):
        env = Env(self)
        record, paths = env.run()
        self.assertEqual((record['status'], record['reason']), ('completed', ''))
        self.assertEqual(sorted(os.path.basename(p) for p in paths), sorted(
            ['KXUFCFIGHT-26OCT24YANDVA-YAN.1.' + s for s in ('run-record.json', 'sim-world.v1.json', 'world.svg', 'report.md')]))
        art = record['artifacts']
        folder = os.path.join(env.out, 'UFC333')
        for key, name in (('world_json_sha256', art['world_json']), ('world_svg_sha256', art['world_svg']), ('report_sha256', art['report'])):
            with open(os.path.join(folder, name), 'rb') as handle:
                self.assertEqual(art[key], hashlib.sha256(handle.read()).hexdigest(), name)
        on_disk = read_json(os.path.join(folder, 'KXUFCFIGHT-26OCT24YANDVA-YAN.1.run-record.json'))
        self.assertEqual(on_disk, json.loads(json.dumps(record)))
        world = read_json(os.path.join(folder, art['world_json']))
        self.assertEqual(world['schema'], 'forgeclaw.sim-world.v1')
        self.assertEqual(len(world['agents']), 6)

    def test_the_record_carries_the_engine_pins_config_extraction_baseline_and_usage(self):
        env = Env(self)
        record, _ = env.run()
        self.assertEqual({k: v for k, v in record['engine'].items() if k != 'environment_digest'}, {'name': 'mirofish', **PINS})
        self.assertEqual(record['engine']['environment_digest'], mr.environment_digest(PINS))
        cfg = record['config']
        self.assertEqual((cfg['preset'], cfg['platform'], cfg['max_rounds'], cfg['rounds_run'], cfg['agents_cap'], cfg['agents_prepared'], cfg['locale']),
                         ('tiny', 'reddit', 4, 4, 8, 6, 'en'))
        self.assertFalse(cfg['reproducible'])
        self.assertFalse(cfg['counts_toward_bar'])  # a tiny world is a pipeline proof, not a counted sim
        ex = record['extraction']
        self.assertEqual((ex['method'], ex['n'], ex['picks'], ex['unparsed']), ('agent-poll-v1', 6, {'A': 3, 'B': 3}, 0))
        self.assertEqual(ex['median_p_a'], 50.0)
        self.assertEqual(record['lean_for_yes_side'], 50.0)
        self.assertEqual(record['baseline_direct'], {'model': 'kimi-k2.6', 'pick': 'B', 'p_a': 40.0, 'why': 'baseline.', 'parsed': True})
        self.assertEqual(record['usage']['cost_usd'], 0.11)
        self.assertEqual(record['seed']['packet_sha256'], hashlib.sha256(PACKET.encode()).hexdigest())
        self.assertEqual(record['timing']['started_at'][:4], '2027')  # fake clock: proves timing comes from the injected clock
        self.assertIsNone(record['rerun_of'])
        self.assertEqual(record['invocation_id'], 'inv-1')

    def test_lean_for_the_yes_side_flips_when_the_yes_side_is_b(self):
        env = Env(self)
        env.miro.interviews = {f'reddit_{i}': {'agent_id': i, 'response': 'PICK=A; P_A=70; WHY=x'} for i in range(4)}
        record, _ = env.run(yes_side=B)
        self.assertEqual((record['extraction']['median_p_a'], record['lean_for_yes_side']), (70.0, 30.0))
        env2 = Env(self)
        env2.miro.interviews = env.miro.interviews
        record2, _ = env2.run(yes_side=A)
        self.assertEqual(record2['lean_for_yes_side'], 70.0)

    def test_the_run_is_started_with_the_disciplined_parameters(self):
        env = Env(self)
        env.run()
        start = next(r for r in env.miro.requests if r['path'] == '/api/simulation/start')['body']
        self.assertEqual(start, {'simulation_id': 'sim_1', 'platform': 'reddit', 'max_rounds': 4, 'enable_graph_memory_update': False})
        create = next(r for r in env.miro.requests if r['path'] == '/api/simulation/create')['body']
        self.assertEqual((create['enable_twitter'], create['enable_reddit']), (False, True))
        poll = next(r for r in env.miro.requests if r['path'] == '/api/simulation/interview/all')['body']
        self.assertEqual(poll['prompt'], mw.poll_question(A, B))
        self.assertEqual(poll['platform'], 'reddit')

    def test_every_call_asks_for_english_and_the_packet_is_uploaded_as_a_file(self):
        env = Env(self)
        env.run()
        self.assertTrue(env.miro.requests)
        self.assertTrue(all(r['lang'] == 'en' for r in env.miro.requests))
        upload = next(r for r in env.miro.requests if r['path'] == '/api/graph/ontology/generate')
        self.assertTrue(upload['ctype'].startswith('multipart/form-data; boundary='))
        self.assertIn(b'filename="packet.md"', upload['raw'])
        self.assertIn(b'Yan landed 128 of 228', upload['raw'])

    def test_the_graph_is_read_before_it_is_deleted_and_deleted_exactly_once(self):
        env = Env(self)
        record, _ = env.run()
        paths = env.miro.paths()
        self.assertLess(paths.index('/api/graph/data/g1'), paths.index('/api/graph/delete/g1'))
        self.assertEqual(paths.count('/api/graph/delete/g1'), 1)
        self.assertEqual((record['zep']['graph_id'], record['zep']['deleted']), ('g1', True))
        self.assertEqual(record['zep']['credits_est'], mr.estimate_zep(len(PACKET))['credits_est'])

    def test_a_small_preset_counts_toward_the_bar_and_runs_both_platforms(self):
        env = Env(self)
        record, _ = env.run(preset='small')
        self.assertTrue(record['config']['counts_toward_bar'])
        start = next(r for r in env.miro.requests if r['path'] == '/api/simulation/start')['body']
        self.assertEqual((start['platform'], start['max_rounds']), ('parallel', 12))
        poll = next(r for r in env.miro.requests if r['path'] == '/api/simulation/interview/all')['body']
        self.assertEqual(poll['platform'], 'reddit')  # one platform for the poll, so it is not asked twice

    def test_a_baseline_failure_never_fails_the_run(self):
        env = Env(self)
        miro = mr.Miro(mr.Http(env.miro.url))

        def broken(prompt):
            raise ConnectionError('meter down')
        record, _ = mr.run_attempt(env.args, miro, lambda: dict(env.meter_state), broken, sleep=env.sleep, clock=env.clock)
        self.assertEqual(record['status'], 'completed')
        self.assertIn('ConnectionError', record['baseline_direct']['error'])

    def test_thin_inputs_are_labelled_thin_never_silently_upgraded(self):
        env = Env(self, packet_text='Yan vs Merab, short note.', provenance={'stats_snapshot': 'espn:1'})
        record, _ = env.run()
        self.assertTrue(record['seed']['thin'])
        reasons = ' | '.join(record['seed']['thin_reasons'])
        self.assertIn('under 1500', reasons)
        self.assertIn('provenance.matchup_read missing', reasons)
        self.assertIn('provenance.human_state missing', reasons)
        full = Env(self)
        self.assertFalse(full.run()[0]['seed']['thin'])


class RefusalTests(unittest.TestCase):
    def refused(self, env, **over):
        with self.assertRaises(mr.Refusal) as ctx:
            env.run(**over)
        self.assertEqual(env.miro.requests, [], 'a refusal must not touch MiroFish')
        self.assertEqual(os.listdir(env.out), [], 'a refusal must write no record')
        return str(ctx.exception)

    def test_no_pin_no_record(self):
        env = Env(self)
        self.assertIn('no pin, no record', self.refused(env, pins={'repo_commit': 'main', 'uv_lock_sha256': LOCK}))
        self.assertIn('no pin, no record', self.refused(env, pins={'repo_commit': COMMIT}))
        self.assertIn('no pin, no record', self.refused(env, pins={}))

    def test_a_packet_with_a_secret_or_owner_private_material_is_refused(self):
        env = Env(self)
        self.assertIn('API-key-shaped', self.refused(env, packet_text=PACKET + ' ' + FAKE_API_KEY))
        self.assertIn('GitHub token', self.refused(env, packet_text=PACKET + ' ' + FAKE_GH_TOKEN))
        self.assertIn('bankroll', self.refused(env, packet_text=PACKET + ' my bankroll is $41'))
        self.assertIn('private key', self.refused(env, packet_text=PACKET + '\n' + FAKE_KEY_HEADER))
        self.assertIsNone(mr.screen_packet(PACKET))  # an ordinary stats packet passes

    def test_bad_inputs_are_refused(self):
        env = Env(self)
        self.assertIn('unknown preset', self.refused(env, preset='huge'))
        self.assertIn('exactly two', self.refused(env, sides=[A]))
        self.assertIn('card_id', self.refused(env, card_id='../etc'))
        self.assertIn('market_ticker', self.refused(env, market_ticker='a b'))

    def test_a_completed_sim_takes_the_slot_for_good(self):
        env = Env(self)
        env.run()
        env2 = Env(self)
        shutil.copytree(env.out, env2.results, dirs_exist_ok=True)
        self.assertIn('one sim per market per card', self.refused(env2))

    def test_an_owner_override_needs_a_named_reason_and_is_recorded_as_rerun_of(self):
        env = Env(self)
        env.run()
        env2 = Env(self)
        shutil.copytree(env.out, env2.results, dirs_exist_ok=True)
        record, _ = env2.run(rerun_reason='Cristian ordered a rerun after the weigh-in changed the matchup')
        self.assertEqual(record['attempt'], 2)
        self.assertEqual(record['rerun_of'], {'attempt': 1, 'reason': 'Cristian ordered a rerun after the weigh-in changed the matchup'})

    def test_aborted_attempts_do_not_take_the_slot_until_the_limit(self):
        env = Env(self)
        env.miro.agents = 99  # over the cap: aborts before spending
        first, _ = env.run()
        self.assertEqual((first['status'], first['attempt']), ('aborted_agents_over_cap', 1))
        env2 = Env(self)
        shutil.copytree(env.out, env2.results, dirs_exist_ok=True)
        env2.miro.agents = 99
        second, _ = env2.run()
        self.assertEqual((second['status'], second['attempt']), ('aborted_agents_over_cap', 2))
        env3 = Env(self)
        shutil.copytree(env.out, env3.results, dirs_exist_ok=True)   # both recorded attempts are visible to the next one
        shutil.copytree(env2.out, env3.results, dirs_exist_ok=True)
        self.assertIn('limit 2', self.refused(env3))

    def test_an_unreadable_existing_record_is_refused_not_guessed(self):
        env = Env(self)
        os.makedirs(os.path.join(env.results, 'UFC333'))
        with open(os.path.join(env.results, 'UFC333', 'KXUFCFIGHT-26OCT24YANDVA-YAN.1.run-record.json'), 'w') as handle:
            handle.write('{not json')
        self.assertIn('unreadable', self.refused(env))

    def test_slot_decision_units(self):
        self.assertEqual(mr.decide_slot([]), 1)
        self.assertEqual(mr.decide_slot([{'attempt': 1, 'status': 'failed'}]), 2)
        with self.assertRaises(mr.Refusal):
            mr.decide_slot([{'attempt': 1, 'status': 'completed'}])
        self.assertEqual(mr.decide_slot([{'attempt': 1, 'status': 'completed'}], 'named reason'), 2)


class NexusLineTests(unittest.TestCase):
    """The adapter that emits the intake lane's own `sim-run` line (src/lib/nexusIntake.ts, #300)."""

    def small(self, **over):
        env = Env(self)
        record, paths = env.run(preset='small', repo='DeviousDevv303/forgeclaw', **over)
        return env, record, paths

    def line_of(self, env, record):
        return read_json(os.path.join(env.out, 'UFC333', record['nexus']['file']))

    def test_a_counted_completed_run_emits_one_valid_line_in_the_intake_schema(self):
        env, record, paths = self.small()
        self.assertTrue(record['nexus']['emitted'], record['nexus'])
        self.assertIn('KXUFCFIGHT-26OCT24YANDVA-YAN.1.sim-run.nexus.json', [os.path.basename(p) for p in paths])
        line = self.line_of(env, record)
        self.assertIsNone(mr.nexus_line_problem(line))
        self.assertEqual((line['kind'], line['source'], line['ref'], line['side']), ('sim-run', 'mirofish-runner', 'KXUFCFIGHT-26OCT24YANDVA-YAN', 'YES'))
        self.assertEqual(line['run_id'], 'sim-UFC333-KXUFCFIGHT-26OCT24YANDVA-YAN-a1')
        self.assertEqual(line['position_ref'], 'shadow:UFC333:KXUFCFIGHT-26OCT24YANDVA-YAN')
        self.assertEqual(line['seed'], {'stats_snapshot': 'espn:600061267', 'matchup_read': True, 'human_state': False})  # 'absent' is false, not true
        self.assertEqual((line['engine']['agents'], line['engine']['rounds'], line['engine']['model'], line['engine']['mirofish_commit']), (6, 4, 'kimi-k2.6', COMMIT))
        self.assertEqual(line['median_lean_pct'], record['lean_for_yes_side'])
        self.assertEqual(line['report'], 'https://github.com/DeviousDevv303/forgeclaw/blob/sim-results/UFC333/KXUFCFIGHT-26OCT24YANDVA-YAN.1.sim-world.v1.json')

    def test_a_thinking_enabled_run_is_filed_under_its_own_engine_label(self):
        policy = {'pinned_fields': ['temperature'], 'fields_removed': {'temperature': 3}, 'thinking': 'enabled', 'thinking_overridden': 0}
        env = Env(self)
        env.meter_state['request_policy'] = policy
        record, _ = env.run(preset='small', repo='DeviousDevv303/forgeclaw')
        self.assertEqual((record['config']['engine_label'], record['config']['thinking']), ('kimi-k2.6+thinking', 'enabled'))
        self.assertEqual(self.line_of(env, record)['engine']['model'], 'kimi-k2.6+thinking')

    def test_a_thinking_disabled_run_keeps_the_plain_label_and_says_how_it_was_sampled(self):
        policy = {'pinned_fields': ['temperature', 'top_p'], 'fields_removed': {'temperature': 3}, 'thinking': 'disabled', 'thinking_overridden': 0}
        env = Env(self)
        env.meter_state['request_policy'] = policy
        record, _ = env.run(preset='small', repo='DeviousDevv303/forgeclaw')
        self.assertEqual((record['config']['engine_label'], record['config']['thinking']), ('kimi-k2.6', 'disabled'))
        self.assertIn("the provider's fixed values: the meter removed temperature, top_p", record['config']['sampling'])
        self.assertEqual(self.line_of(env, record)['engine']['model'], 'kimi-k2.6')

    def test_the_line_matches_the_golden_fixture_the_typescript_validator_also_checks(self):
        env, record, _ = self.small()
        self.assertEqual(self.line_of(env, record), read_json(GOLDEN),
                         'the emitted line drifted from src/scripts/fixtures/mirofish-sim-run.nexus.json; update both sides deliberately')

    def test_a_tiny_run_never_reaches_intake_because_grading_would_count_it(self):
        env = Env(self)
        record, paths = env.run(preset='tiny')
        self.assertEqual(record['status'], 'completed')
        self.assertFalse(record['nexus']['emitted'])
        self.assertIn('does not count toward the 10-sim bar', record['nexus']['reason'])
        self.assertFalse(any(p.endswith('.sim-run.nexus.json') for p in paths))

    def test_no_line_without_a_known_yes_side_or_for_a_run_that_did_not_complete(self):
        env, record, _ = self.small(yes_side='')
        self.assertFalse(record['nexus']['emitted'])
        self.assertIn('no lean for the YES side', record['nexus']['reason'])
        env2 = Env(self)
        env2.miro.agents = 99
        aborted, _ = env2.run(preset='small')
        self.assertFalse(aborted['nexus']['emitted'])
        self.assertIn('ended aborted_agents_over_cap', aborted['nexus']['reason'])

    def test_no_line_when_the_pins_cannot_make_the_environment_digest(self):
        env = Env(self)
        pins = {k: v for k, v in PINS.items() if k != 'torch_cpu_sha256'}
        record, _ = env.run(preset='small', pins=pins)
        self.assertFalse(record['nexus']['emitted'])
        self.assertIn('environment digest', record['nexus']['reason'])
        self.assertIsNone(record['engine']['environment_digest'])

    def test_the_position_ref_is_the_callers_when_given(self):
        env, record, _ = self.small(position_ref='pos_abc123')
        self.assertEqual(self.line_of(env, record)['position_ref'], 'pos_abc123')

    def test_the_digest_covers_every_pinned_piece_and_is_stable(self):
        base = mr.environment_digest(PINS)
        self.assertRegex(base, r'^sha256:[0-9a-f]{64}$')
        self.assertEqual(base, mr.environment_digest(dict(PINS)))
        for key in ('repo_commit', 'uv_lock_sha256', 'torch_cpu_sha256', 'python', 'uv_version', 'runner_image'):
            self.assertNotEqual(base, mr.environment_digest({**PINS, key: PINS[key] + 'x'}), f'changing {key} must change the digest')
        self.assertIsNone(mr.environment_digest({**PINS, 'uv_version': ''}))

    def test_the_digest_is_labelled_for_what_it_is_not_passed_off_as_an_image_digest(self):
        env, record, _ = self.small()
        self.assertEqual(self.line_of(env, record)['engine']['digest_kind'], 'source-install-environment')

    def test_the_port_of_the_validator_rejects_what_the_typescript_one_rejects(self):
        good = read_json(GOLDEN)
        self.assertIsNone(mr.nexus_line_problem(good))
        def with_(path, value):
            line = json.loads(json.dumps(good))
            target = line
            for key in path[:-1]:
                target = target[key]
            if value is KeyError:
                del target[path[-1]]
            else:
                target[path[-1]] = value
            return line
        cases = [(('kind',), 'sim-outcome'), (('run_id',), ''), (('ref',), KeyError), (('position_ref',), KeyError),
                 (('seed', 'matchup_read'), 'yes'), (('seed', 'stats_snapshot'), ''), (('engine', 'agents'), 0), (('engine', 'agents'), 1.5),
                 (('engine', 'rounds'), True), (('engine', 'model'), ''), (('engine', 'mirofish_commit'), 'main'),
                 (('engine', 'image_digest'), 'sha256:abc'), (('engine', 'image_digest'), KeyError), (('median_lean_pct'), 101),
                 (('median_lean_pct',), -1), (('median_lean_pct',), float('nan')), (('side',), 'YES YES'), (('side',), ''), (('report',), '')]
        for path, value in cases:
            path = path if isinstance(path, tuple) else (path,)
            self.assertIsNotNone(mr.nexus_line_problem(with_(path, value)), f'{path} = {value!r} should be rejected')
        self.assertIsNone(mr.nexus_line_problem({**good, 'extra_field': 'ignored, as the TypeScript validator ignores it'}))


class AbortPathTests(unittest.TestCase):
    def test_too_many_agents_aborts_before_a_single_simulation_token_is_spent(self):
        env = Env(self)
        env.miro.agents = 9
        record, paths = env.run()
        self.assertEqual(record['status'], 'aborted_agents_over_cap')
        self.assertIn('prepared 9 agents; the tiny cap is 8', record['reason'])
        self.assertNotIn('/api/simulation/start', env.miro.paths())
        self.assertEqual(record['zep']['deleted'], True)
        self.assertEqual(record['config']['agents_prepared'], 9)
        self.assertEqual([os.path.basename(p) for p in paths], ['KXUFCFIGHT-26OCT24YANDVA-YAN.1.run-record.json'])  # a record, but no world

    def test_the_metering_ceiling_stops_the_simulation_and_is_recorded(self):
        env = Env(self)
        env.miro.run_states = [{'runner_status': 'running', 'current_round': 1}] * 5

        def trip():
            if env.miro._poll['run'] == 2:
                env.meter_state.update(ceiling_hit=True, cost_usd=0.41)
        env.miro.on_run_status = trip
        record, _ = env.run()
        self.assertEqual(record['status'], 'aborted_budget')
        self.assertIn('/api/simulation/stop', env.miro.paths())
        self.assertEqual(record['usage']['cost_usd'], 0.41)
        self.assertTrue(record['usage']['ceiling_hit'])
        self.assertEqual(record['zep']['deleted'], True)

    def test_a_ceiling_reached_before_the_simulation_starts_never_starts_it(self):
        env = Env(self)
        env.meter_state.update(ceiling_hit=True)
        record, _ = env.run()
        self.assertEqual(record['status'], 'aborted_budget')
        self.assertNotIn('/api/simulation/start', env.miro.paths())

    def test_a_graph_failure_that_reads_like_a_zep_quota_is_named_as_one(self):
        env = Env(self)
        env.miro.graph_task = [{'status': 'failed', 'error': 'Zep: episode credit quota exceeded (429)'}]
        record, _ = env.run()
        self.assertEqual(record['status'], 'aborted_zep_quota')
        self.assertIsNone(record['zep']['graph_id'])
        self.assertIsNone(record['zep']['deleted'])  # no graph was created, so nothing to delete
        self.assertNotIn('/api/graph/delete/g1', env.miro.paths())

    def test_a_polling_stage_that_never_finishes_times_out_and_does_not_wait_forever(self):
        env = Env(self)
        env.miro.run_states = [{'runner_status': 'running', 'current_round': 1}]
        record, _ = env.run()
        self.assertEqual(record['status'], 'timeout')
        self.assertIn('simulate did not finish within 5400 s', record['reason'])
        self.assertEqual(record['zep']['deleted'], True)

    def test_a_provider_rejection_is_recorded_in_the_providers_own_words(self):
        # The first live runs (2026-10-25): MiroFish reported only "HTTP 400"; the meter kept what Moonshot actually said.
        env = Env(self)
        env.miro.ontology_status = 502
        env.meter_state.update(error_samples=[
            {'source': 'meter', 'status': 400, 'excerpt': 'meter_one_engine: not this one'},
            {'source': 'upstream', 'status': 400, 'excerpt': 'invalid temperature: only 1 is allowed for this model'}])
        record, _ = env.run()
        self.assertEqual(record['status'], 'failed')
        self.assertIn('[ontology] MiroFish answered HTTP 502', record['reason'])
        self.assertIn('the provider said (HTTP 400): invalid temperature: only 1 is allowed', record['reason'])
        self.assertNotIn('meter_one_engine', record['reason'])  # the provider's words, not the meter's

    def test_a_failure_without_a_provider_error_says_nothing_invented(self):
        env = Env(self)
        env.miro.ontology_status = 502
        record, _ = env.run()
        self.assertNotIn('the provider said', record['reason'])

    def test_a_simulation_that_fails_is_recorded_with_its_cause(self):
        env = Env(self)
        env.miro.run_states = [{'runner_status': 'failed', 'error': 'OASIS crashed'}]
        record, _ = env.run()
        self.assertEqual(record['status'], 'failed')
        self.assertIn('OASIS crashed', record['reason'])

    def test_a_dead_environment_fails_the_poll_honestly(self):
        env = Env(self)
        env.miro.env_alive = False
        record, _ = env.run()
        self.assertEqual(record['status'], 'failed')
        self.assertIn('final poll cannot be asked', record['reason'])
        self.assertEqual(record['zep']['deleted'], True)

    def test_a_missing_actions_log_is_a_failure_not_an_empty_world(self):
        env = Env(self)
        os.remove(os.path.join(env.mdir, 'backend', 'uploads', 'simulations', 'sim_1', 'reddit', 'actions.jsonl'))
        record, paths = env.run()
        self.assertEqual(record['status'], 'failed')
        self.assertIn('no actions.jsonl', record['reason'])
        self.assertEqual([os.path.basename(p) for p in paths], ['KXUFCFIGHT-26OCT24YANDVA-YAN.1.run-record.json'])

    def test_an_unexpected_engine_error_is_still_recorded_and_the_graph_still_deleted(self):
        env = Env(self)
        env.miro.graph_data_status = 500
        record, _ = env.run()
        self.assertEqual(record['status'], 'failed')
        self.assertIn('artifacts', record['reason'])
        self.assertEqual(record['zep']['deleted'], True)

    def test_unparsed_answers_are_counted_not_dropped(self):
        env = Env(self)
        env.miro.interviews = {'reddit_0': {'agent_id': 0, 'response': 'PICK=A; P_A=60; WHY=x'}, 'reddit_1': {'agent_id': 1, 'response': 'no idea'}}
        record, _ = env.run()
        self.assertEqual((record['extraction']['n'], record['extraction']['unparsed']), (2, 1))


class HelperTests(unittest.TestCase):
    def test_bounded_polling_raises_a_timeout_status(self):
        now = [0.0]
        with self.assertRaises(mr.RunnerError) as ctx:
            mr.wait_for('x', lambda: {}, lambda s: False, lambda s: None, 30, lambda d: now.__setitem__(0, now[0] + d), lambda: now[0], interval_s=10)
        self.assertEqual(ctx.exception.status, 'timeout')

    def test_multipart_carries_fields_and_the_file(self):
        raw, ctype = mr.multipart({'a': '1'}, [('files', 'p.md', b'hello')])
        boundary = ctype.split('boundary=')[1].encode()
        self.assertIn(b'name="a"\r\n\r\n1', raw)
        self.assertIn(b'filename="p.md"', raw)
        self.assertTrue(raw.rstrip().endswith(b'--' + boundary + b'--'))

    def test_zep_estimate_matches_the_post(self):
        self.assertEqual(mr.estimate_zep(6000)['episodes_est'], 14)
        self.assertEqual(mr.estimate_zep(6000)['credits_est'], 28)
        self.assertEqual(mr.estimate_zep(10)['episodes_est'], 1)

    def test_every_preset_has_the_fields_the_runner_reads(self):
        for name, preset in mr.PRESETS.items():
            self.assertEqual(set(preset), {'platform', 'max_rounds', 'agents_cap', 'parallel_profiles', 'counts_toward_bar'}, name)
        self.assertFalse(mr.PRESETS['tiny']['counts_toward_bar'])
        self.assertTrue(mr.PRESETS['small']['counts_toward_bar'])

    def test_direct_answers_parse_with_the_same_rules_as_the_poll(self):
        d = mr.parse_direct('PICK=A; P_A=61; WHY=pace', A, B, 'm')
        self.assertEqual((d['pick'], d['p_a'], d['parsed']), ('A', 61.0, True))
        self.assertFalse(mr.parse_direct('hmm', A, B, 'm')['parsed'])


class FakeMeterServer:
    """The two endpoints the runner uses on the meter: GET /__meter and the one-call baseline."""

    def __init__(self, snapshot):
        outer = self
        self.snapshot = snapshot

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                return

            def _send(self, obj):
                body = json.dumps(obj).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):  # noqa: N802
                self._send(outer.snapshot)

            def do_POST(self):  # noqa: N802
                self.rfile.read(int(self.headers.get('Content-Length') or 0))
                self._send({'choices': [{'message': {'content': 'PICK=B; P_A=40; WHY=baseline.'}}]})

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), H)
        self.server.daemon_threads = True
        threading.Thread(target=lambda: self.server.serve_forever(poll_interval=0.05), daemon=True).start()
        self.url = f'http://127.0.0.1:{self.server.server_address[1]}'

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class CommandLineTests(unittest.TestCase):
    """The real argparse path, exit codes included, against fake MiroFish and meter servers (instant polling, so no waiting)."""

    def setUp(self):
        self.env = Env(self)
        self.env.miro.graph_task = [{'status': 'completed', 'result': {'graph_id': 'g1'}}]
        self.env.miro.run_states = [{'runner_status': 'completed', 'current_round': 4}]
        self.meter = FakeMeterServer(self.env.meter_state)
        self.addCleanup(self.meter.close)
        self.packet = os.path.join(self.env.root, 'packet.md')
        with open(self.packet, 'w') as handle:
            handle.write(PACKET)

    def argv(self, **over):
        flags = {'--packet': self.packet, '--card-id': 'UFC333', '--market-ticker': 'KXUFCFIGHT-26OCT24YANDVA-YAN', '--sides': f'{A}|{B}',
                 '--yes-side': B, '--preset': 'tiny', '--provider': 'moonshot', '--model': 'kimi-k2.6', '--mirofish-url': self.env.miro.url,
                 '--mirofish-dir': self.env.mdir, '--meter-url': self.meter.url, '--results-dir': self.env.results, '--out-dir': self.env.out,
                 '--pins': json.dumps(self.env.args['pins']), '--provenance': json.dumps(self.env.args['provenance']),
                 '--invocation-id': 'inv-cli', '--run-url': 'https://example.invalid/run'}
        flags.update(over)
        return [x for pair in flags.items() for x in pair]

    def run_main(self, **over):
        import contextlib
        import io
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = mr.main(self.argv(**over))
        return code, out.getvalue(), err.getvalue()

    def test_a_completed_run_exits_zero_and_prints_a_summary(self):
        code, out, err = self.run_main()
        self.assertEqual(code, 0, err)
        summary = json.loads(out)
        self.assertEqual((summary['status'], summary['attempt'], summary['agents'], summary['rounds_run']), ('completed', 1, 6, 4))
        self.assertEqual(len(summary['files']), 4)
        record = read_json(os.path.join(self.env.out, 'UFC333', 'KXUFCFIGHT-26OCT24YANDVA-YAN.1.run-record.json'))
        self.assertEqual(record['invocation_id'], 'inv-cli')
        self.assertEqual(record['yes_side'], B)
        self.assertEqual(record['artifacts']['run_url'], 'https://example.invalid/run')
        self.assertEqual(record['baseline_direct']['p_a'], 40.0)

    def test_an_aborted_run_exits_one_but_still_leaves_its_record(self):
        self.env.miro.agents = 50
        code, out, err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn('aborted_agents_over_cap', err)
        self.assertTrue(os.path.isfile(os.path.join(self.env.out, 'UFC333', 'KXUFCFIGHT-26OCT24YANDVA-YAN.1.run-record.json')))

    def test_a_refusal_exits_two_writes_nothing_and_never_calls_mirofish(self):
        code, out, err = self.run_main(**{'--pins': '{}'})
        self.assertEqual(code, 2)
        self.assertIn('refused before spending anything', err)
        self.assertEqual(os.listdir(self.env.out), [])
        self.assertEqual(self.env.miro.requests, [])

    def test_pins_that_are_not_json_are_a_refusal_not_a_traceback(self):
        code, _, err = self.run_main(**{'--pins': 'not json'})
        self.assertEqual(code, 2)
        self.assertIn('must be JSON', err)

    def test_a_yes_side_that_is_not_one_of_the_sides_is_dropped_not_trusted(self):
        code, _, _ = self.run_main(**{'--yes-side': 'Somebody Else'})
        self.assertEqual(code, 0)
        record = read_json(os.path.join(self.env.out, 'UFC333', 'KXUFCFIGHT-26OCT24YANDVA-YAN.1.run-record.json'))
        self.assertEqual((record['yes_side'], record['lean_for_yes_side']), (None, None))


if __name__ == '__main__':
    unittest.main()
