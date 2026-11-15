#!/usr/bin/env python3
"""#235 -> Corpus producer (lane directive 1, forgeclaw #235 comment 6866644896).

Every fix worked on the #235 channel and VERIFIED against the repository objects becomes (a) one intake record in the
existing intake shape (src/lib/nexusIntake.ts) and (b) one shaped traces-v1 row. A comment saying "fixed" is never
enough: a pair exists only when the pull request object says merged, names a merge commit, and its head has a
successful check run and no failed one; with --git-dir the merge commit must also exist in git and name the PR.

Honesty rules (house rules, enforced here):
- Intake records are PENDING candidates. The owner's three auto-admission classes (nexusIntake.ts) do not cover
  source `issue-235-fix`, and this module widens nothing.
- A frozen eval set is never edited and never trained on: shaping refuses to run when no frozen set could be loaded,
  and a row that overlaps one is dropped, with its reason counted.
- Deterministic: the same inputs give byte-identical outputs (timestamps come from the PR, not the clock).
- Nothing here talks to the network unless --live is given; tests use fixtures.

Python 3 standard library only. Run the tests with: python3 -B -m unittest discover -s nexus-llm/intake -p "test_*.py"
"""
import argparse
import glob
import json
import os
import re
import subprocess
import sys
import urllib.request

SOURCE = 'issue-235-fix'
KIND = 'fix-verified'
TRACE_KIND = 'fix_verified_real'
SHAPER_VERSION = 'traces-v1'
CHANNEL_ISSUE = 235
FAILED_CONCLUSIONS = {'failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure'}
SHA_RE = re.compile(r'^[0-9a-f]{40}$')
# "#416", "PR 416", "PR #416", ".../pull/416"; the channel issue itself is excluded by the caller.
PR_REF_RE = re.compile(r'(?:/pull/|\bPR\s*#?|(?<![\w/])#)(\d{2,5})\b')

SH = 48       # shingle width, as build_traces_v1.py
STEP = 12     # stride of the FROZEN index, as build_traces_v1.py
# build_traces_v1.py (and runs/run25/build_dataset.py) also probe a row at stride 12, so an exact overlap is caught only when
# its offset in the row matches its offset in the frozen text modulo 12: about 1 alignment in 12 (measured in
# test_issue235_producer.py). Here a row is probed at EVERY offset: any shared passage of SH + STEP - 1 = 59 normalized
# characters or more contains a full indexed shingle and is always caught. Index size is unchanged.


# ------------------------------------------------------------------ extraction
def extract_pr_numbers(comments, exclude=(CHANNEL_ISSUE,)):
    """PR numbers the comments name, in first-mention order, with the comment ids that named them."""
    found = {}
    for c in comments:
        for m in PR_REF_RE.finditer(c.get('body') or ''):
            n = int(m.group(1))
            if n in exclude:
                continue
            ids = found.setdefault(n, [])
            if c.get('id') not in ids:
                ids.append(c.get('id'))
    return found


# ---------------------------------------------------------------- verification
def verify_pr(n, pr, check_runs, git_check=None):
    """(ok, reasons). Every reason is a plain sentence about the object, never about a comment's claim."""
    reasons = []
    if not pr:
        return False, ['no pull request #%d found (the number may be an issue)' % n]
    if pr.get('merged') is not True:
        reasons.append('not merged')
    sha = pr.get('merge_commit_sha') or ''
    if not SHA_RE.match(sha):
        reasons.append('no merge commit sha on the pull request object')
    head = ((pr.get('head') or {}).get('sha')) or ''
    if not SHA_RE.match(head):
        reasons.append('no head sha')
    runs = [r for r in (check_runs or []) if r.get('status') == 'completed']
    if any(r.get('conclusion') in FAILED_CONCLUSIONS for r in runs):
        reasons.append('a check run on the head failed')
    if not any(r.get('conclusion') == 'success' for r in runs):
        reasons.append('no successful check run on the head')
    if git_check is not None and SHA_RE.match(sha) and not git_check(sha, n, head):
        reasons.append('merge commit %s is not in git, or does not belong to #%d' % (sha[:12], n))
    return (not reasons), reasons


def make_git_check(git_dir):
    """True when the commit exists and names the PR, or has the PR head as a parent (merge commit)."""
    def check(sha, n, head):
        try:
            out = subprocess.run(['git', '-C', git_dir, 'log', '-1', '--format=%P%n%s', sha],
                                 capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.SubprocessError):
            return False
        if out.returncode != 0:
            return False
        parents, _, subject = out.stdout.partition('\n')
        return head in parents.split() or ('#%d' % n) in subject
    return check


# ------------------------------------------------------------- text shaping
def clean(text):
    """Plain single-line text with no grammar tokens: '<|' and '|>' would break the traces grammar."""
    text = re.sub(r'`+', '', text or '')
    text = re.sub(r'\*\*|__', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text.replace('<|', '< |').replace('|>', '| >')


def first_paragraph(body):
    """First prose paragraph of a PR body (headings, lists and the footer are skipped)."""
    for block in re.split(r'\n\s*\n', body or ''):
        block = block.strip()
        if not block or block.startswith(('#', '-', '*', '|', '>', '---', '🤖', 'http', '```')):
            continue
        return clean(block)
    return ''


def bullets(body, limit=4, width=170):
    """First bullets under a Changes / Defect / Fix heading: what the fix actually did, in the PR's own words."""
    out, on = [], False
    for line in (body or '').splitlines():
        if line.startswith('#'):
            on = bool(re.match(r'#+\s*(changes|defect|fix|what)', line, re.I))
            continue
        if on and re.match(r'\s*[-*]\s+', line):
            text = clean(re.sub(r'^\s*[-*]\s+', '', line))
            if text:
                out.append(text if len(text) <= width else text[:width].rsplit(' ', 1)[0] + '…')
        if len(out) >= limit:
            break
    return out


def build_pair(n, pr, check_runs, comment_ids, repo):
    sha = pr['merge_commit_sha']
    ok_runs = [r for r in check_runs if r.get('conclusion') == 'success']
    checks = ', '.join('%s=%s' % (r.get('name'), r.get('conclusion')) for r in check_runs if r.get('status') == 'completed')
    changes = bullets(pr.get('body'))
    lead = first_paragraph(pr.get('body'))
    problem = (lead.rstrip('.') + '.' if lead else '') + (' Changes: ' + ' | '.join(c.rstrip('.') for c in changes) + '.' if changes else '')
    return {
        'number': n, 'repo': repo, 'title': clean(pr.get('title')), 'problem': problem.strip(), 'lead': lead, 'changes': changes,
        'merged_at': pr.get('merged_at') or pr.get('closed_at') or '',
        'merge_sha': sha, 'head_sha': pr['head']['sha'],
        'changed_files': pr.get('changed_files'), 'additions': pr.get('additions'), 'deletions': pr.get('deletions'),
        'checks': checks, 'check_url': (ok_runs[0].get('html_url') if ok_runs else ''),
        'comment_ids': comment_ids, 'url': 'https://github.com/%s/pull/%d' % (repo, n),
    }


def intake_record(pair):
    """The existing intake shape: ts, source, run_id, kind, ref, summary, provenance (nexusIntake.ts validateIntakeRecord)."""
    summary = '%s. %s Merged %s as %s; checks: %s.' % (
        pair['title'], pair['problem'], pair['merged_at'], pair['merge_sha'][:12], pair['checks'])
    prov = '%s ; check run %s ; discussed on #%d comments %s' % (
        pair['url'], pair['check_url'], CHANNEL_ISSUE, ','.join(str(i) for i in pair['comment_ids']))
    return {'ts': pair['merged_at'], 'source': SOURCE, 'run_id': 'pr-%d-%s' % (pair['number'], pair['merge_sha'][:12]),
            'kind': KIND, 'ref': 'forgeclaw#%d' % pair['number'], 'summary': summary, 'provenance': prov}


def trace_row(pair):
    """One traces-v1 row: the claim, a github_pr_info call, the object evidence, a verified verdict."""
    n = pair['number']
    prompt = 'Verify this claim before anyone acts on it (#235 fix #%d): %s' % (n, pair['title'])
    stats = ''
    if pair.get('changed_files') is not None:
        stats = ' %s files changed, +%s/-%s.' % (pair['changed_files'], pair['additions'], pair['deletions'])
    result = clean('PR #%d %s: merged %s as %s on main (head %s).%s Checks on the head: %s. As filed: %s' % (
        n, pair['title'], pair['merged_at'], pair['merge_sha'][:12], pair['head_sha'][:12], stats, pair['checks'], pair['lead']))
    what = ' What changed: ' + ' | '.join(c.rstrip('.') for c in pair['changes']) + '.' if pair['changes'] else ''
    answer = clean('Verdict: CONFIRMED. The fix is merged (%s) and its checks passed.%s' % (pair['merge_sha'][:12], what))
    call = json.dumps({'name': 'github_pr_info', 'arguments': {'pull_number': str(n)}})
    text = ('<|route:tool|><|call|>' + call + '<|/call|><|result:ok|>' + result + '<|/result|><|ev:verified|>'
            '<|answer|>' + answer + '<|/answer|><|end|>')
    prov = {'run_id': 'pr-%d-%s' % (n, pair['merge_sha'][:12]), 'source': SOURCE, 'ref': 'forgeclaw#%d' % n,
            'check': 'claim -> pull request object (merged, merge commit, head checks) -> verdict', 'label': 'real',
            'synthetic': False, 'label_source': 'repository_object', 'value_source': 'api', 'guardian_eligible': True,
            'shaper_version': SHAPER_VERSION, 'shaped_at': pair['merged_at']}
    spans = [s for s in re.findall(r'(src/[\w./\-]+|[\w./\-]+\.ts:\d+)', prompt) if s in text]
    return {'id': 'real-issue235-pr-%d' % n, 'synthetic': False, 'prompt': prompt, 'text': text, 'kind': TRACE_KIND,
            'mode': 'copy' if spans else 'create', 'copySpans': spans, 'provenance': prov}


# ----------------------------------------------------------- leakage guard
def norm(s):
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]', ' ', s.lower())).strip()


def strings_deep(o):
    if isinstance(o, str):
        yield o
    elif isinstance(o, dict):
        for v in o.values():
            yield from strings_deep(v)
    elif isinstance(o, list):
        for v in o:
            yield from strings_deep(v)


def discover_frozen(repo_root):
    """Frozen sets present in this repo: nexus-llm/eval's registered and conventional exam content."""
    ev = os.path.join(repo_root, 'nexus-llm', 'eval')
    found = set()
    reg = os.path.join(ev, 'FROZEN.json')
    if os.path.exists(reg):
        try:
            for exam in json.load(open(reg)).get('exams', []):
                for rel in exam.get('files', {}):
                    p = os.path.join(repo_root, rel)
                    if os.path.isfile(p) and p.endswith(('.jsonl', '.json', '.md')):
                        found.add(p)
        except ValueError:
            pass
    for pat in ('**/cases.jsonl', '**/*fixtures*.jsonl', 'frozen-prompts.ts', 'coding/starter-tasks.json', 'loop/scenarios.json'):
        found.update(p for p in glob.glob(os.path.join(ev, pat), recursive=True) if os.path.isfile(p))
    return sorted(found)


class FrozenGuard:
    """The build_traces_v1.py leakage check: frozen prompts, trading tickers, 48-char shingles of exam content."""
    def __init__(self, paths):
        self.files = list(paths)
        self.prompts, self.tickers, self.shingles = set(), set(), {}
        for p in self.files:
            raw = open(p, errors='replace').read()
            label = os.path.basename(p)
            self.tickers |= set(re.findall(r'KX[A-Z0-9][A-Z0-9\-]+', raw))
            if not p.endswith('.jsonl'):
                self._shingle(raw, label)
                continue
            for line in raw.splitlines():
                line = line.strip()
                if not line.startswith('{'):
                    continue
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                for key in ('prompt', 'question', 'input'):
                    if isinstance(r.get(key), str) and r[key]:
                        self.prompts.add(norm(r[key]))
                payload = [r['prompt']] if isinstance(r.get('prompt'), str) else []
                for key in ('expect', 'expected', 'gold', 'answer'):
                    if key in r:
                        payload += list(strings_deep(r[key]))
                self._shingle(' '.join(payload), label)

    def _shingle(self, text, label):
        n = norm(text)
        for i in range(0, max(0, len(n) - SH), STEP):
            self.shingles.setdefault(n[i:i + SH], label)

    @staticmethod
    def content(row):
        parts = [row['prompt']]
        parts += re.findall(r'<\|result:ok\|>(.*?)<\|/result\|>', row['text'])
        parts += re.findall(r'<\|answer\|>(.*?)<\|/answer\|>', row['text'])
        return ' '.join(parts)

    def drop_reason(self, row):
        if norm(row['prompt']) in self.prompts:
            return 'frozen_eval_prompt'
        for t in re.findall(r'KX[A-Z0-9][A-Z0-9\-]+', row['prompt'] + row['text']):
            if t in self.tickers:
                return 'frozen_ticker:' + t
        n = norm(self.content(row))
        for i in range(0, max(0, len(n) - SH + 1)):
            hit = self.shingles.get(n[i:i + SH])
            if hit:
                return 'frozen_shingle_overlap:' + hit
        return None


# ------------------------------------------------------------------ pipeline
def produce(comments, pr_lookup, repo, git_check=None, guard=None, existing_run_ids=()):
    """Returns (intake_records, trace_rows, report). pr_lookup(n) -> (pr_object_or_None, check_runs)."""
    report = {'prs_named': 0, 'verified': 0, 'rejected': {}, 'already_present': [], 'shaped': 0, 'leakage_drops': {},
              'frozen_files_loaded': [os.path.basename(p) for p in (guard.files if guard else [])]}
    intake, traces = [], []
    named = extract_pr_numbers(comments)
    report['prs_named'] = len(named)
    for n in sorted(named):
        pr, runs = pr_lookup(n)
        ok, reasons = verify_pr(n, pr, runs, git_check)
        if not ok:
            report['rejected'][str(n)] = reasons
            continue
        report['verified'] += 1
        pair = build_pair(n, pr, runs, named[n], repo)
        rec = intake_record(pair)
        if rec['run_id'] in set(existing_run_ids):
            report['already_present'].append(rec['run_id'])
            continue
        intake.append(rec)
        if guard is None:
            continue
        row = trace_row(pair)
        reason = guard.drop_reason(row)
        if reason:
            report['leakage_drops'][row['id']] = reason
            continue
        traces.append(row)
    report['shaped'] = len(traces)
    report['intake_records'] = len(intake)
    return intake, traces, report


def dumps(rows):
    return ''.join(json.dumps(r, ensure_ascii=False, sort_keys=False) + '\n' for r in rows)


def read_existing_run_ids(path):
    ids = set()
    if path and os.path.exists(path):
        for line in open(path, errors='replace'):
            try:
                rid = json.loads(line).get('run_id')
            except ValueError:
                continue
            if rid:
                ids.add(rid)
    return ids


# --------------------------------------------------------------------- live
def api_get(url, token, opener=urllib.request.urlopen):
    req = urllib.request.Request(url, headers={'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + token,
                                               'User-Agent': 'forgeclaw-issue235-producer/1'})
    with opener(req, timeout=30) as res:
        return json.loads(res.read().decode('utf-8'))


def live_inputs(repo, token, opener=urllib.request.urlopen):
    """Comments of #235 and a PR lookup, from the GitHub API. Untested against the live API in this lane's sandbox."""
    comments, page = [], 1
    while True:
        batch = api_get('https://api.github.com/repos/%s/issues/%d/comments?per_page=100&page=%d' % (repo, CHANNEL_ISSUE, page), token, opener)
        comments += batch
        if len(batch) < 100:
            break
        page += 1

    def lookup(n):
        try:
            pr = api_get('https://api.github.com/repos/%s/pulls/%d' % (repo, n), token, opener)
        except Exception:  # a number that is an issue, or deleted: not a pair
            return None, []
        runs = api_get('https://api.github.com/repos/%s/commits/%s/check-runs' % (repo, pr['head']['sha']), token, opener).get('check_runs', [])
        return pr, runs
    return comments, lookup


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--repo', default='DeviousDevv303/forgeclaw')
    ap.add_argument('--comments', help='JSON file: list of #235 comments (id, body, ...)')
    ap.add_argument('--prs', help='JSON file: {"416": {"pr": {...}, "check_runs": [...]}, ...}')
    ap.add_argument('--live', action='store_true', help='read comments, PRs and check runs from the GitHub API')
    ap.add_argument('--token-env', default='GITHUB_TOKEN')
    ap.add_argument('--git-dir', help='local clone used to byte-verify each merge commit')
    ap.add_argument('--frozen', nargs='*', default=None, help='frozen-set files (default: discovered under nexus-llm/eval)')
    ap.add_argument('--existing-intake', help='intake.jsonl already published; its run_ids are not re-emitted')
    ap.add_argument('--out-dir', required=True)
    args = ap.parse_args(argv)

    if args.live:
        token = os.environ.get(args.token_env, '')
        if not token:
            print('--live needs a token in $%s; nothing was read.' % args.token_env, file=sys.stderr)
            return 2
        comments, lookup = live_inputs(args.repo, token)
    else:
        if not (args.comments and args.prs):
            print('offline mode needs --comments and --prs (or use --live).', file=sys.stderr)
            return 2
        comments = json.load(open(args.comments))
        prs = json.load(open(args.prs))
        lookup = lambda n: ((prs.get(str(n)) or {}).get('pr'), (prs.get(str(n)) or {}).get('check_runs', []))  # noqa: E731

    root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    frozen = args.frozen if args.frozen is not None else discover_frozen(root)
    guard = FrozenGuard(frozen) if frozen else None
    git_check = make_git_check(args.git_dir) if args.git_dir else None
    intake, traces, report = produce(comments, lookup, args.repo, git_check, guard, read_existing_run_ids(args.existing_intake))
    if guard is None:
        report['shaping'] = 'REFUSED: no frozen set could be loaded, so nothing was shaped (leakage control is mandatory)'
    os.makedirs(args.out_dir, exist_ok=True)
    open(os.path.join(args.out_dir, 'intake.jsonl'), 'w').write(dumps(intake))
    open(os.path.join(args.out_dir, 'fix-verified-v1.jsonl'), 'w').write(dumps(traces))
    open(os.path.join(args.out_dir, 'producer-report.json'), 'w').write(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
