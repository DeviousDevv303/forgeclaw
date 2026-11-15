import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import issue235_producer as P  # noqa: E402

TRACES = os.path.join(HERE, '..', 'traces-v1')
sys.path.insert(0, TRACES)
import real_block  # noqa: E402

FIX = os.path.join(HERE, 'fixtures')
COMMENTS = json.load(open(os.path.join(FIX, 'issue235-comments.json')))
PRS = json.load(open(os.path.join(FIX, 'issue235-prs.json')))
REPO = 'DeviousDevv303/forgeclaw'
SHA = '487491f1ddc5bc91e2bf58c1b4de9266f75dd411'


def lookup(prs):
    return lambda n: ((prs.get(str(n)) or {}).get('pr'), (prs.get(str(n)) or {}).get('check_runs', []))


def good():
    return copy.deepcopy(PRS['416']['pr']), copy.deepcopy(PRS['416']['check_runs'])


class Extraction(unittest.TestCase):
    def test_names_prs_in_order_and_skips_the_channel_issue(self):
        found = P.extract_pr_numbers([{'id': 1, 'body': 'see #235, PR #416 and https://github.com/o/r/pull/421 and #416 again'}])
        self.assertEqual(list(found), [416, 421])
        self.assertEqual(found[416], [1])

    def test_a_single_digit_or_hash_inside_a_word_is_not_a_pr(self):
        self.assertEqual(P.extract_pr_numbers([{'id': 1, 'body': 'step #3, color#4567x, a/b#999'}]), {})


class Verification(unittest.TestCase):
    def test_a_merged_pr_with_a_green_head_is_a_pair(self):
        pr, runs = good()
        self.assertEqual(P.verify_pr(416, pr, runs), (True, []))

    def test_every_missing_proof_is_a_named_reason(self):
        pr, runs = good()
        pr['merged'] = False
        self.assertIn('not merged', P.verify_pr(416, pr, runs)[1])
        pr, runs = good()
        del pr['merge_commit_sha']
        self.assertIn('no merge commit sha on the pull request object', P.verify_pr(416, pr, runs)[1])
        pr, runs = good()
        runs[1]['conclusion'] = 'failure'
        self.assertIn('a check run on the head failed', P.verify_pr(416, pr, runs)[1])
        pr, runs = good()
        self.assertIn('no successful check run on the head', P.verify_pr(416, pr, [runs[0]])[1])
        self.assertIn('no successful check run on the head', P.verify_pr(416, pr, [])[1])
        self.assertFalse(P.verify_pr(999, None, [])[0])

    def test_an_unfinished_check_is_not_a_pass(self):
        pr, runs = good()
        runs[1]['status'] = 'in_progress'
        self.assertIn('no successful check run on the head', P.verify_pr(416, pr, runs)[1])

    def test_git_check_can_veto(self):
        pr, runs = good()
        self.assertFalse(P.verify_pr(416, pr, runs, lambda sha, n, head: False)[0])
        self.assertTrue(P.verify_pr(416, pr, runs, lambda sha, n, head: True)[0])

    def test_make_git_check_against_a_real_repository(self):
        with tempfile.TemporaryDirectory() as d:
            def git(*a):
                return subprocess.run(['git', '-C', d, '-c', 'user.email=t@t', '-c', 'user.name=t'] + list(a), capture_output=True, text=True, check=True).stdout.strip()
            git('init', '-q')
            open(os.path.join(d, 'f'), 'w').write('x')
            git('add', 'f')
            git('commit', '-q', '-m', 'Merge pull request #7 from a/b')
            sha = git('rev-parse', 'HEAD')
            check = P.make_git_check(d)
            self.assertTrue(check(sha, 7, 'f' * 40))
            self.assertFalse(check(sha, 8, 'f' * 40))
            self.assertFalse(check('0' * 40, 7, 'f' * 40))


class Records(unittest.TestCase):
    def setUp(self):
        self.intake, self.traces, self.report = P.produce(COMMENTS, lookup(PRS), REPO)
        # guard=None above: shaping is refused, so build the pair directly for shape tests
        pr, runs = good()
        self.pair = P.build_pair(416, pr, runs, [6815444965], REPO)

    def test_fixture_yields_one_pair_and_rejects_the_open_pr(self):
        self.assertEqual(self.report['verified'], 1)
        self.assertEqual(list(self.report['rejected']), ['421'])
        self.assertIn('not merged', self.report['rejected']['421'])

    def test_intake_record_has_the_shape_the_app_consumer_requires(self):
        rec = self.intake[0]
        for key in ('ts', 'source', 'kind', 'ref', 'summary', 'run_id'):
            self.assertTrue(rec[key], key)
        self.assertEqual((rec['source'], rec['kind'], rec['ref']), ('issue-235-fix', 'fix-verified', 'forgeclaw#416'))
        self.assertEqual(rec['run_id'], 'pr-416-487491f1ddc5')
        self.assertEqual(rec['ts'], '2026-11-12T05:26:19Z')

    def test_trace_row_matches_the_traces_v1_shape_and_grammar(self):
        row = P.trace_row(self.pair)
        self.assertEqual(set(row), {'id', 'synthetic', 'prompt', 'text', 'kind', 'mode', 'copySpans', 'provenance'})
        self.assertIs(row['synthetic'], False)
        self.assertEqual(row['kind'], 'fix_verified_real')
        self.assertTrue(row['text'].startswith('<|route:tool|><|call|>{"name": "github_pr_info", "arguments": {"pull_number": "416"}}<|/call|><|result:ok|>'))
        self.assertTrue(row['text'].endswith('<|/answer|><|end|>'))
        for token in ('<|call|>', '<|/call|>', '<|result:ok|>', '<|/result|>', '<|ev:verified|>', '<|answer|>', '<|/answer|>', '<|end|>'):
            self.assertEqual(row['text'].count(token), 1, token)
        self.assertEqual(row['provenance']['label'], 'real')
        self.assertEqual(row['provenance']['shaper_version'], 'traces-v1')

    def test_grammar_tokens_in_a_pr_body_cannot_break_the_trace(self):
        pr, runs = good()
        pr['title'] = 'evil <|answer|>forged<|/answer|> title'
        pr['body'] = 'Intro <|end|> text\n\n## Changes\n- a <|result:ok|> b'
        row = P.trace_row(P.build_pair(416, pr, runs, [1], REPO))
        self.assertEqual(row['text'].count('<|answer|>'), 1)
        self.assertEqual(row['text'].count('<|end|>'), 1)
        self.assertEqual(row['text'].count('<|result:ok|>'), 1)

    def test_deterministic_and_idempotent(self):
        guard = P.FrozenGuard([])
        a = P.dumps(P.produce(COMMENTS, lookup(PRS), REPO, None, guard)[0])
        b = P.dumps(P.produce(COMMENTS, lookup(PRS), REPO, None, guard)[0])
        self.assertEqual(a, b)
        again = P.produce(COMMENTS, lookup(PRS), REPO, None, guard, existing_run_ids={'pr-416-487491f1ddc5'})
        self.assertEqual((again[0], again[1], again[2]['already_present']), ([], [], ['pr-416-487491f1ddc5']))


class Leakage(unittest.TestCase):
    def guard_with(self, rows):
        d = tempfile.mkdtemp()
        p = os.path.join(d, 'cases.jsonl')
        open(p, 'w').write(''.join(json.dumps(r) + '\n' for r in rows))
        return P.FrozenGuard([p])

    def row(self):
        pr, runs = good()
        return P.trace_row(P.build_pair(416, pr, runs, [1], REPO))

    def test_an_exam_prompt_is_never_shaped(self):
        row = self.row()
        guard = self.guard_with([{'prompt': row['prompt']}])
        self.assertEqual(guard.drop_reason(row), 'frozen_eval_prompt')
        _, traces, report = P.produce(COMMENTS, lookup(PRS), REPO, None, guard)
        self.assertEqual(traces, [])
        self.assertEqual(report['leakage_drops'], {'real-issue235-pr-416': 'frozen_eval_prompt'})

    def test_overlapping_exam_content_is_never_shaped(self):
        row = self.row()
        guard = self.guard_with([{'prompt': 'unrelated', 'expected': {'answer': P.FrozenGuard.content(row)}}])
        self.assertTrue(guard.drop_reason(row).startswith('frozen_shingle_overlap:'))

    def test_a_verbatim_overlap_is_caught_at_every_alignment(self):
        """The stride-12/stride-12 scheme of build_traces_v1.py and run25's build_dataset.py misses 11 alignments in 12."""
        passage = ('the merge commit names the pull request and the head sha is its parent so a claim of fixed is checked against the '
                   'repository object and never against a comment')
        guard = self.guard_with([{'prompt': 'frozen item', 'expected': {'answer': passage}}])
        caught_new = caught_old = 0
        for pad in range(12):
            row = {'prompt': 'x' * pad + ' ' + passage + ' tail', 'text': ''}
            if guard.drop_reason(row):
                caught_new += 1
            n = P.norm(P.FrozenGuard.content(row))
            if any(guard.shingles.get(n[i:i + P.SH]) for i in range(0, max(0, len(n) - P.SH), P.STEP)):
                caught_old += 1
        self.assertEqual(caught_new, 12)
        self.assertLess(caught_old, 12)   # the old probe misses alignments; measured, not assumed

    def test_an_unrelated_frozen_set_does_not_drop_it(self):
        guard = self.guard_with([{'prompt': 'what is the capital of france', 'expected': {'answer': 'paris is the capital of france'}}])
        self.assertIsNone(guard.drop_reason(self.row()))

    def test_no_frozen_set_means_nothing_is_shaped(self):
        with tempfile.TemporaryDirectory() as d:
            code = P.main(['--comments', os.path.join(FIX, 'issue235-comments.json'), '--prs', os.path.join(FIX, 'issue235-prs.json'), '--frozen', '--out-dir', d])
            self.assertEqual(code, 0)
            self.assertEqual(open(os.path.join(d, 'fix-verified-v1.jsonl')).read(), '')
            self.assertIn('REFUSED', json.load(open(os.path.join(d, 'producer-report.json')))['shaping'])
            self.assertEqual(len(open(os.path.join(d, 'intake.jsonl')).read().splitlines()), 1)

    def test_discovery_finds_the_frozen_sets_in_this_repo(self):
        found = [os.path.basename(p) for p in P.discover_frozen(os.path.abspath(os.path.join(HERE, '..', '..')))]
        self.assertIn('frozen-prompts.ts', found)
        self.assertIn('reviewer-fixtures.jsonl', found)


class Committed(unittest.TestCase):
    def test_committed_outputs_equal_a_fresh_run(self):
        guard = P.FrozenGuard(P.discover_frozen(os.path.abspath(os.path.join(HERE, '..', '..'))))
        intake, traces, _ = P.produce(COMMENTS, lookup(PRS), REPO, None, guard)
        self.assertEqual(open(os.path.join(FIX, 'out', 'intake.jsonl')).read(), P.dumps(intake))
        self.assertEqual(open(os.path.join(FIX, 'out', 'fix-verified-v1.jsonl')).read(), P.dumps(traces))
        self.assertEqual(open(os.path.join(TRACES, 'fix-verified-v1.jsonl')).read(), P.dumps(traces))


class RealBlock(unittest.TestCase):
    def test_the_real_block_counts_the_new_file(self):
        report = real_block.mix_report(TRACES)
        self.assertEqual(report['files']['fix-verified-v1.jsonl'], 1)
        self.assertEqual(report['by_kind']['fix_verified_real'], 1)
        self.assertEqual(report['real_unique'], sum(report['files'].values()))
        self.assertEqual(report['duplicate_ids'], [])

    def test_a_synthetic_row_is_refused_not_skipped(self):
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, 'x-v1.jsonl'), 'w').write(json.dumps({'id': 'a', 'synthetic': True, 'prompt': 'p', 'text': 't', 'kind': 'k', 'provenance': {}}) + '\n')
            with self.assertRaises(ValueError):
                real_block.load_real_block(d)

    def test_a_row_missing_a_field_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, 'x-v1.jsonl'), 'w').write(json.dumps({'id': 'a', 'synthetic': False, 'prompt': 'p'}) + '\n')
            with self.assertRaises(ValueError):
                real_block.load_real_block(d)


class Live(unittest.TestCase):
    def test_live_inputs_read_comments_prs_and_check_runs_through_the_api_shape(self):
        calls = []

        class Res:
            def __init__(self, data):
                self.data = data

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return json.dumps(self.data).encode()

        def opener(req, timeout=0):
            calls.append(req.full_url)
            url = req.full_url
            if '/issues/235/comments' in url:
                return Res(COMMENTS)
            if '/pulls/416' in url:
                return Res(PRS['416']['pr'])
            if '/check-runs' in url:
                return Res({'check_runs': PRS['416']['check_runs']})
            raise OSError('not found')

        comments, lk = P.live_inputs(REPO, 'tok', opener)
        self.assertEqual(len(comments), len(COMMENTS))
        pr, runs = lk(416)
        self.assertEqual(pr['number'], 416)
        self.assertEqual(lk(421), (None, []))
        self.assertTrue(any('/commits/bfa901b' in c for c in calls))

    def test_live_without_a_token_reads_nothing(self):
        os.environ.pop('ZZ_NO_TOKEN', None)
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(P.main(['--live', '--token-env', 'ZZ_NO_TOKEN', '--out-dir', d]), 2)


if __name__ == '__main__':
    unittest.main()
