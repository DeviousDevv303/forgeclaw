# ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
# Proprietary source-available license. Commercial use requires written permission. See LICENSE.
"""Runner for one MiroFish swarm simulation: seed packet in, one sim-run record plus the illustrated world out.

MiroFish (AGPL-3.0) is an EXTERNAL process: this script talks to its HTTP API on localhost and reads the files it writes. No
MiroFish code is imported, vendored or patched. The workflow (mirofish-sim.yml) starts MiroFish at a pinned commit with its
LLM_BASE_URL pointed at the metering proxy (mirofish_meter.py); this script only needs that proxy's URL.

Discipline, enforced here BEFORE anything is spent (a refusal exits non-zero and writes no record):
  * no pin, no record: the MiroFish commit and the uv.lock hash must be present;
  * one COMPLETED sim per (card_id, market_ticker), ever; an aborted or failed attempt does not take the slot, up to
    MAX_ATTEMPTS per key, so infrastructure failure cannot burn it but "run again until the story is better" is blocked;
  * the seed packet is screened for secrets and owner-private material (a last-line guard, not a guarantee).

Then, in order: ontology -> graph -> create -> prepare -> agent-count check -> start -> simulate -> final poll -> report ->
artifacts. The agent count is checked against the preset's cap before the simulation starts, because MiroFish derives it from
the packet and an LLM, and cannot be told an exact number. Whatever happens afterwards, the Zep graph is deleted and the
outcome is recorded: completed, aborted_budget, aborted_agents_over_cap, aborted_zep_quota, timeout or failed.

What this does NOT do: judge the simulation. Its only number is the poll the runner adds (agent-poll-v1), which measures how
the packet propagated through simulated personas. It is recorded next to a one-call direct baseline so grading can tell
whether the swarm adds anything beyond the packet itself.

Two outputs per attempt, deliberately separate: `<ticker>.<n>.run-record.json` is the engine-side detail (everything about how the
run went, including aborts); `<ticker>.<n>.sim-run.nexus.json` is ONE line in the intake lane's own `sim-run` schema
(src/lib/nexusIntake.ts), written only for a completed run of a size that counts toward the bar, because grading counts every
filed sim. The intake lane files it; this runner never writes to the intake stream.

Standard library only.
"""
from __future__ import annotations

import argparse
import collections
import glob
import hashlib
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Callable

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mirofish_world as world_mod  # noqa: E402

RECORD_SCHEMA = 'forgeclaw.mirofish-run-record.v1'
RECORD_SUFFIX = 'run-record.json'          # the engine-side detail; NOT the intake kind (that is `sim-run`, below)
NEXUS_SUFFIX = 'sim-run.nexus.json'        # one line in the intake lane's own schema (src/lib/nexusIntake.ts, #300)
NEXUS_SOURCE = 'mirofish-runner'
SIDE_TOKEN_MAX = 64
MAX_ATTEMPTS = 2
MIN_FULL_PACKET_CHARS = 1500
ZEP_CHUNK_CHARS, ZEP_CHUNK_OVERLAP, ZEP_CREDITS_PER_CHUNK = 500, 50, 2  # chunk_size/overlap are MiroFish's defaults; credits are vendor-sourced
SAFE_ID = re.compile(r'^[A-Za-z0-9._-]{1,120}$')
HEX40, HEX64 = re.compile(r'^[0-9a-f]{40}$'), re.compile(r'^[0-9a-f]{64}$')

# size_class decides whether a run counts toward the lane's "10 comparable sims" bar: a tiny world is a pipeline proof.
# Every preset runs MiroFish's `parallel` script: its reddit-only script writes no actions.jsonl (only a SQLite file), so a
# world could never be built from it, and it never signals completion. `active_rounds` counts rounds with agents awake; the
# rounds before the agents' first active hour are added on top (see plan_clock) and cost nothing.
PRESETS = {
    'tiny': {'platform': 'parallel', 'active_rounds': 4, 'agents_cap': 8, 'parallel_profiles': 3, 'counts_toward_bar': False},
    'small': {'platform': 'parallel', 'active_rounds': 12, 'agents_cap': 14, 'parallel_profiles': 5, 'counts_toward_bar': True},
    'mid': {'platform': 'parallel', 'active_rounds': 24, 'agents_cap': 20, 'parallel_profiles': 5, 'counts_toward_bar': True},
}
STAGE_TIMEOUTS_S = {'ontology': 600, 'graph': 1200, 'prepare': 2400, 'simulate': 5400, 'ready': 300, 'poll': 900, 'ended': 300, 'report': 2400}
# The stage limits add up to more than the workflow's 150-minute job limit, so one overall deadline caps them all. Time is held
# back for cleanup (stop the simulation, delete the Zep graph) and the record, so a slow run ends as `timeout` with both done
# instead of being killed by Actions with neither (seen live, 2026-10-25: a 91-minute hang left the graph in Zep).
DEFAULT_DEADLINE_S = 8100
CLEANUP_RESERVE_S = 240
# Cleanup must fit the reserve even when MiroFish hangs, so its calls get a short HTTP limit, not the 120 s default.
CLEANUP_HTTP_TIMEOUT_S = 20
# MiroFish's simulation script defaults, used only when its prepared config leaves a field out.
SCRIPT_MINUTES_PER_ROUND, SCRIPT_TOTAL_HOURS, SCRIPT_ACTIVE_HOURS = 30, 72, tuple(range(8, 23))
SCRIPT_AGENTS_PER_HOUR = {'agents_per_hour_min': 5, 'agents_per_hour_max': 20}
SCRIPT_PEAK = {'peak_hours': (9, 10, 11, 14, 15, 20, 21, 22), 'peak_activity_multiplier': 1.5}
SCRIPT_OFF_PEAK = {'off_peak_hours': (0, 1, 2, 3, 4, 5), 'off_peak_activity_multiplier': 0.3}
# MiroFish generates a report only for a simulation whose run status is one of these (app/api/report.py; HTTP 409 otherwise).
REPORTABLE_RUNNER_STATUSES = ('completed', 'stopped')
# MiroFish refuses to delete a graph while a simulation using it is in one of these states (GraphInUseError, HTTP 409).
ACTIVE_RUNNER_STATUSES = ('starting', 'running', 'paused', 'stopping')
GRAPH_DELETE_ATTEMPTS, GRAPH_DELETE_RETRY_S, INACTIVE_WAIT_S = 4, 10, 60
# An intake line is a pre-fight forecast, so it is filed only for a market Kalshi still lists as open when the run starts.
KALSHI_MARKET_URL = 'https://api.elections.kalshi.com/trade-api/v2/markets/{ticker}'
OPEN_MARKET_STATUSES = ('active', 'open')
PLATFORM_FLAGS = {'parallel': ('twitter_completed', 'reddit_completed'), 'twitter': ('twitter_completed',), 'reddit': ('reddit_completed',)}

# Material that must never reach MiroFish or Zep. A deliberately blunt screen.
_SECRET_PATTERNS = [
    (re.compile(r'\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}'), 'an API-key-shaped string'),
    (re.compile(r'\bgh[pousr]_[A-Za-z0-9]{20,}'), 'a GitHub token'),
    (re.compile(r'\bgithub_pat_[A-Za-z0-9_]{20,}'), 'a GitHub token'),
    (re.compile(r'(?i)\bbearer\s+[A-Za-z0-9._-]{16,}'), 'a bearer token'),
    (re.compile(r'(?i)-----BEGIN [A-Z ]*PRIVATE KEY-----'), 'a private key'),
]
_PRIVATE_WORDS = re.compile(r'(?i)\b(bankroll|my position|my bet|my stake|account balance|cash balance|api[_ -]?key|password|passphrase)\b')


class RunnerError(Exception):
    """A pipeline failure with the stage it happened in."""

    def __init__(self, stage: str, message: str, status: str = 'failed'):
        super().__init__(message)
        self.stage, self.status = stage, status


class Refusal(Exception):
    """A pre-flight refusal: nothing is spent and no record is written."""


# ─── Pre-flight ──────────────────────────────────────────────────────────────

def screen_packet(text: str) -> str | None:
    """Why the seed packet must not be sent to MiroFish and Zep, or None when it passes."""
    for pattern, what in _SECRET_PATTERNS:
        if pattern.search(text):
            return f'the packet contains {what}'
    hit = _PRIVATE_WORDS.search(text)
    if hit:
        return f'the packet mentions "{hit.group(0)}": owner-private material never goes to MiroFish or Zep (public data and analysis only)'
    return None


def check_pins(pins: dict) -> None:
    if not HEX40.match(str(pins.get('repo_commit', ''))):
        raise Refusal('no pin, no record: pins.repo_commit must be the full 40-hex MiroFish commit')
    if not HEX64.match(str(pins.get('uv_lock_sha256', ''))):
        raise Refusal('no pin, no record: pins.uv_lock_sha256 must be the 64-hex sha256 of the locked dependency file')


def record_prefix(results_dir: str, card_id: str, ticker: str) -> str:
    if not SAFE_ID.match(card_id) or not SAFE_ID.match(ticker):
        raise Refusal('card_id and market_ticker must be 1-120 characters of letters, digits, dot, underscore or hyphen')
    return os.path.join(results_dir, card_id, ticker)


def load_attempts(results_dir: str, card_id: str, ticker: str) -> list[dict]:
    attempts = []
    for path in sorted(glob.glob(record_prefix(results_dir, card_id, ticker) + f'.*.{RECORD_SUFFIX}')):
        try:
            with open(path, encoding='utf-8') as handle:
                attempts.append(json.load(handle))
        except (OSError, ValueError):
            raise Refusal(f'an existing record is unreadable ({os.path.basename(path)}); refusing to guess whether the slot is taken')
    return attempts


def decide_slot(attempts: list[dict], rerun_reason: str = '') -> int:
    """The next attempt number, or a Refusal. A completed run takes the slot for good (an owner override needs a named reason)."""
    completed = [a for a in attempts if a.get('status') == 'completed']
    if completed and not rerun_reason.strip():
        raise Refusal('this (card_id, market_ticker) already has a completed sim; one sim per market per card. '
                      'An owner override needs a named reason (rerun_reason), and it is recorded as rerun_of.')
    if not completed and len(attempts) >= MAX_ATTEMPTS and not rerun_reason.strip():
        raise Refusal(f'{len(attempts)} aborted or failed attempts already recorded (limit {MAX_ATTEMPTS}); a further attempt needs a named reason')
    return max([a.get('attempt', 0) for a in attempts], default=0) + 1


def estimate_zep(packet_chars: int) -> dict:
    step = ZEP_CHUNK_CHARS - ZEP_CHUNK_OVERLAP
    episodes = max(1, math.ceil(max(packet_chars - ZEP_CHUNK_OVERLAP, 1) / step))
    return {'episodes_est': episodes, 'credits_est': episodes * ZEP_CREDITS_PER_CHUNK,
            'basis': '500-char chunks, 2 credits per chunk; graph-memory updates off. Vendor figures are unverified.'}


# ─── HTTP ────────────────────────────────────────────────────────────────────

class Http:
    """JSON over urllib, English locale on every call (MiroFish defaults to Chinese prompts without Accept-Language: en)."""

    def __init__(self, base: str, timeout_s: float = 120.0):
        self.base, self.timeout_s = base.rstrip('/'), timeout_s

    def call(self, method: str, path: str, body=None, headers: dict | None = None, raw: bytes | None = None, timeout_s: float | None = None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        hdrs = {'Accept-Language': 'en', 'Accept': 'application/json', **({'Content-Type': 'application/json'} if body is not None else {}), **(headers or {})}
        request = urllib.request.Request(self.base + path, data=data, headers=hdrs, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout_s or self.timeout_s) as res:  # noqa: S310 - localhost MiroFish
                status, payload = res.status, res.read()
        except urllib.error.HTTPError as error:
            status, payload = error.code, error.read()
        try:
            parsed = json.loads(payload or b'{}')
        except ValueError:
            parsed = {'success': False, 'error': (payload or b'')[:300].decode('utf-8', 'replace')}
        return status, parsed


def multipart(fields: dict, files: list[tuple[str, str, bytes]]) -> tuple[bytes, str]:
    boundary = '----forgeclaw' + uuid.uuid4().hex
    out = []
    for name, value in fields.items():
        out.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    for field, filename, content in files:
        out.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
                   'Content-Type: text/markdown\r\n\r\n'.encode() + content + b'\r\n')
    out.append(f'--{boundary}--\r\n'.encode())
    return b''.join(out), f'multipart/form-data; boundary={boundary}'


class Miro:
    """The slice of MiroFish's HTTP API the runner uses. Every call returns `data` or raises RunnerError naming the stage."""

    def __init__(self, http: Http):
        self.http = http

    def _ok(self, stage: str, status: int, body: dict):
        if status >= 400 or not body.get('success', False):
            raise RunnerError(stage, f'MiroFish answered HTTP {status}: {str(body.get("error") or body)[:300]}')
        return body.get('data') or {}

    def post(self, stage: str, path: str, body: dict, timeout_s: float | None = None):
        return self._ok(stage, *self.http.call('POST', path, body, timeout_s=timeout_s))

    def get(self, stage: str, path: str, timeout_s: float | None = None):
        return self._ok(stage, *self.http.call('GET', path, timeout_s=timeout_s))

    def delete(self, stage: str, path: str, timeout_s: float | None = None):
        return self._ok(stage, *self.http.call('DELETE', path, timeout_s=timeout_s))

    def upload(self, stage: str, path: str, fields: dict, files: list, timeout_s: float | None = None):
        raw, ctype = multipart(fields, files)
        return self._ok(stage, *self.http.call('POST', path, raw=raw, headers={'Content-Type': ctype}, timeout_s=timeout_s))


# ─── Pipeline ────────────────────────────────────────────────────────────────

def plan_clock(config: dict, active_rounds: int) -> dict:
    """How many rounds to ask for so the run holds `active_rounds` rounds in which agents act.

    MiroFish's simulated clock starts at 00:00. Each round its script picks int(uniform(agents_per_hour_min, agents_per_hour_max)
    x the hour's multiplier) of the agents awake in that hour, so a round acts only when an agent is awake AND that count is at
    least 1. Two live runs acted in no round: the first asked for 4 rounds from 00:00 with no agent awake before 07:00; the second
    (2026-10-25) had an agent awake at 00:00, but 00:00 to 05:59 is off-peak, where the generated multiplier (0.05) truncates the
    count to 0. The script cannot be told a start hour and runs unmodified, so the runner counts a round as active only when its
    hour has an agent awake and a count that cannot truncate to 0 (agents_per_hour_min x multiplier >= 1), and asks for rounds up
    to the `active_rounds`-th such round. If no hour is that certain, it falls back to hours where an acting agent is possible
    (agents_per_hour_max x multiplier > 1). The other rounds cost little or nothing: the script skips a round with no agent picked."""
    time_config = config.get('time_config') or {}
    # The same lookups the script makes (a default only when the key is absent), so the plan matches what will run.
    minutes = time_config.get('minutes_per_round', SCRIPT_MINUTES_PER_ROUND)
    hours = time_config.get('total_simulation_hours', SCRIPT_TOTAL_HOURS)
    for name, value in (('minutes_per_round', minutes), ('total_simulation_hours', hours)):
        if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            raise RunnerError('prepare', f'the prepared config has an unusable {name} ({value!r}); the simulation script would fail on it')
    rate = {}
    for name, default in (*SCRIPT_AGENTS_PER_HOUR.items(), *SCRIPT_PEAK.items(), *SCRIPT_OFF_PEAK.items()):
        value = time_config.get(name, default)
        usable = isinstance(value, (list, tuple)) if name.endswith('_hours') else (
            isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0)
        if not usable:
            raise RunnerError('prepare', f'the prepared config has an unusable {name} ({value!r})')
        rate[name] = value

    def multiplier(hour: int) -> float:
        if hour in rate['peak_hours']:
            return rate['peak_activity_multiplier']
        if hour in rate['off_peak_hours']:
            return rate['off_peak_activity_multiplier']
        return 1.0
    config_rounds = (hours * 60) // minutes
    awake = set()
    for agent in config.get('agent_configs') or []:
        hours = agent.get('active_hours', SCRIPT_ACTIVE_HOURS)
        awake.update(h for h in hours if isinstance(h, int) and 0 <= h <= 23)
    if not awake:
        raise RunnerError('prepare', 'no prepared agent has any active hour, so no agent could ever act. Nothing was simulated.')
    low, high = sorted((rate['agents_per_hour_min'], rate['agents_per_hour_max']))
    hour_of = lambda r: (r * minutes // 60) % 24  # noqa: E731 - the script's own simulated_hour
    for activity, can_act in (('guaranteed', lambda h: low * multiplier(h) >= 1), ('possible', lambda h: high * multiplier(h) > 1)):
        chosen = [r for r in range(config_rounds) if hour_of(r) in awake and can_act(hour_of(r))][:active_rounds]
        if chosen:
            break
    else:
        raise RunnerError('prepare', f'no round of the prepared {config_rounds}-round schedule falls in an hour where the script can pick an '
                                     f'awake agent ({low} to {high} agents an hour, x{rate["peak_activity_multiplier"]} at peak, '
                                     f'x{rate["off_peak_activity_multiplier"]} off-peak). Nothing was simulated.')
    wanted = chosen[-1] + 1
    return {'minutes_per_round': minutes, 'first_active_round': chosen[0] + 1, 'first_active_hour': hour_of(chosen[0]),
            'idle_rounds': wanted - len(chosen), 'active_rounds': len(chosen), 'active_round_numbers': [r + 1 for r in chosen],
            'activity': activity, 'max_rounds': wanted, 'config_rounds': config_rounds}


def wait_for(stage: str, fetch: Callable[[], dict], is_done: Callable[[dict], bool], is_failed: Callable[[dict], str | None],
             timeout_s: float, sleep: Callable[[float], None], clock: Callable[[], float], interval_s: float = 5.0,
             on_tick: Callable[[dict], None] | None = None) -> dict:
    """Bounded polling. Raises RunnerError(status='timeout') at the limit, never waits forever."""
    deadline = clock() + timeout_s
    while True:
        state = fetch()
        failure = is_failed(state)
        if failure:
            raise RunnerError(stage, failure)
        if on_tick:
            on_tick(state)
        if is_done(state):
            return state
        if clock() >= deadline:
            raise RunnerError(stage, f'{stage} did not finish within {int(timeout_s)} s', status='timeout')
        sleep(interval_s)


def as_agent_id(value):
    """An agent id as the integer the profiles and actions use, when it is one; anything else unchanged."""
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return value


def task_failure(state: dict) -> str | None:
    return f'task failed: {str(state.get("error") or state.get("message") or "no detail")[:300]}' if state.get('status') == 'failed' else None


class Run:
    """One attempt's state. `meter` is a callable returning the metering proxy's snapshot; `log` prints one progress line."""

    def __init__(self, miro: Miro, args: dict, meter: Callable[[], dict], direct: Callable[[str], str], sleep, clock,
                 log: Callable[[str], None] | None = None):
        self.miro, self.args, self.meter, self.direct, self.sleep, self.clock = miro, args, meter, direct, sleep, clock
        # Progress goes to stderr: stdout stays the one JSON summary the workflow and the CLI tests read.
        self.log_line = log or (lambda line: print(line, file=sys.stderr, flush=True))
        self.started = clock()
        self.deadline_s = float(args.get('deadline_s') or DEFAULT_DEADLINE_S)
        self.project_id = self.graph_id = self.simulation_id = None
        self.agents_prepared = self.rounds_run = self.simulated_actions = self.relogged_seed_posts = None
        self.clock_plan: dict | None = None
        # ended: MiroFish has published a terminal run status, so the process is gone and cleanup need not stop it.
        self.simulation_started = self.simulation_ended = False
        self.poll_answers: list[dict] = []
        self.profiles: list[dict] = []
        self.graph_data: dict = {}
        self.report_markdown = ''
        self.baseline = None
        self.graph_deleted: bool | None = None
        self._last_round_logged = None

    @property
    def preset(self) -> dict:
        return PRESETS[self.args['preset']]

    def log(self, stage: str, message: str) -> None:
        """One line in the job log per step, with the spend so far: the run is watchable while it runs, not only after."""
        try:
            snap = self.meter()
        except Exception:  # noqa: BLE001 - a progress line must never break the run
            snap = {}
        self.log_line(f'[runner +{self.clock() - self.started:5.0f}s] {stage}: {message} '
                      f'(${float(snap.get("cost_usd") or 0):.4f} so far, {snap.get("calls", 0)} LLM calls)')

    def limit(self, stage: str) -> float:
        """The stage's own limit, cut short by the run's overall deadline, keeping CLEANUP_RESERVE_S for cleanup and the record."""
        left = self.started + self.deadline_s - CLEANUP_RESERVE_S - self.clock()
        if left <= 0:
            raise RunnerError(stage, f'the run deadline ({int(self.deadline_s)} s) was reached before {stage}', status='timeout')
        return min(STAGE_TIMEOUTS_S[stage], left)

    def wait(self, stage: str, fetch, is_done, is_failed, on_tick=None) -> dict:
        limit = self.limit(stage)
        try:
            return wait_for(stage, fetch, is_done, is_failed, limit, self.sleep, self.clock, on_tick=on_tick)
        except RunnerError as error:
            if error.status == 'timeout' and limit < STAGE_TIMEOUTS_S[stage]:
                raise RunnerError(stage, f'{error}: cut short by the run deadline ({int(self.deadline_s)} s)', status='timeout') from None
            raise

    def _budget_check(self):
        if self.meter().get('ceiling_hit'):
            raise RunnerError('simulate', 'the metering ceiling was reached', status='aborted_budget')

    def execute(self) -> None:
        a, p = self.args, self.preset
        side_a, side_b = a['sides']
        text = a['packet_text']
        # 1. ontology (one synchronous LLM call inside MiroFish, so it gets the stage limit, not the HTTP default)
        self.log('ontology', 'asking MiroFish to read the packet')
        data = self.miro.upload('ontology', '/api/graph/ontology/generate', {
            'simulation_requirement': f'Predict how the fight between {side_a} and {side_b} will play out, from the seed material.',
            'project_name': f'{a["card_id"]}-{a["market_ticker"]}'[:80], 'additional_context': ''},
            [('files', 'packet.md', text.encode('utf-8'))], timeout_s=self.limit('ontology'))
        self.project_id = data.get('project_id')
        if not self.project_id:
            raise RunnerError('ontology', 'MiroFish returned no project_id')
        # 2. graph (Zep ingestion happens here)
        self.log('graph', 'building the knowledge graph in Zep')
        task = self.miro.post('graph', '/api/graph/build', {'project_id': self.project_id, 'chunk_size': ZEP_CHUNK_CHARS, 'chunk_overlap': ZEP_CHUNK_OVERLAP})
        done = self.wait('graph', lambda: self.miro.get('graph', f'/api/graph/task/{task["task_id"]}'), lambda s: s.get('status') == 'completed', task_failure)
        self.graph_id = (done.get('result') or {}).get('graph_id')
        if not self.graph_id:
            raise RunnerError('graph', 'the graph task completed without a graph_id')
        # 2b. the agents, counted BEFORE their profiles are written. Prepare makes about one LLM call per agent, so an over-cap
        # packet spent $0.13 on 18 profiles before being refused (seen live, 2026-10-26, SPIKE3-UFC333 attempt 1). This reads the
        # same entity filter prepare uses, from Zep, with no LLM call. If it cannot be read, the check after prepare decides.
        try:
            expected = self.miro.get('prepare', f'/api/simulation/entities/{self.graph_id}?enrich=false').get('filtered_count')
        except RunnerError as error:
            expected = None
            self.log('prepare', f'could not count the agents before writing their profiles ({str(error)[:120]}); checking after instead')
        if isinstance(expected, int) and not isinstance(expected, bool):
            self.log('prepare', f'the graph holds {expected} agent entities (the {a["preset"]} cap is {p["agents_cap"]})')
            if expected > p['agents_cap']:
                self.agents_prepared = expected
                raise RunnerError('prepare', f'the graph holds {expected} agent entities; the {a["preset"]} cap is {p["agents_cap"]}. '
                                             'No profile was written and nothing was simulated.', status='aborted_agents_over_cap')
        # 3. create
        platform = p['platform']
        sim = self.miro.post('create', '/api/simulation/create', {
            'project_id': self.project_id, 'graph_id': self.graph_id,
            'enable_twitter': platform in ('twitter', 'parallel'), 'enable_reddit': platform in ('reddit', 'parallel')})
        self.simulation_id = sim.get('simulation_id')
        if not self.simulation_id:
            raise RunnerError('create', 'MiroFish returned no simulation_id')
        # 4. prepare (profiles + LLM-generated config)
        self.log('prepare', f'graph {self.graph_id} ready; generating agent profiles and the simulation config')
        prep = self.miro.post('prepare', '/api/simulation/prepare', {
            'simulation_id': self.simulation_id, 'use_llm_for_profiles': True,
            'parallel_profile_count': p['parallel_profiles'], 'force_regenerate': False})
        if not prep.get('already_prepared'):
            self.wait('prepare', lambda: self.miro.post('prepare', '/api/simulation/prepare/status', {'task_id': prep['task_id'], 'simulation_id': self.simulation_id}),
                      lambda s: s.get('status') in ('completed', 'ready'), task_failure)
        # 5. agent count, checked BEFORE any simulation token is spent
        profile_platform = 'twitter' if platform == 'twitter' else 'reddit'
        profiles = self.miro.get('prepare', f'/api/simulation/{self.simulation_id}/profiles?platform={profile_platform}')
        self.agents_prepared = int(profiles.get('count', len(profiles.get('profiles', []))))
        self.profiles = profiles.get('profiles', [])
        if self.agents_prepared > p['agents_cap']:
            raise RunnerError('prepare', f'MiroFish prepared {self.agents_prepared} agents; the {a["preset"]} cap is {p["agents_cap"]}. '
                                         'Nothing was simulated.', status='aborted_agents_over_cap')
        if self.agents_prepared < 2:
            raise RunnerError('prepare', f'MiroFish prepared {self.agents_prepared} agent(s): too few for a swarm')
        # 6. the clock: enough rounds to reach the agents' waking hours (idle rounds make no LLM call)
        self.clock_plan = plan_clock(self.miro.get('prepare', f'/api/simulation/{self.simulation_id}/config'), p['active_rounds'])
        cp = self.clock_plan
        self.log('prepare', f'{self.agents_prepared} agents; {cp["minutes_per_round"]}-minute rounds, agents first able to act at '
                            f'{cp["first_active_hour"]:02d}:00 (round {cp["first_active_round"]}, {cp["activity"]}), so {cp["idle_rounds"]} '
                            f'idle + {cp["active_rounds"]} active = {cp["max_rounds"]} rounds')
        self._budget_check()
        # 7. start (marked started first: a start that half-succeeds is still stopped by cleanup)
        self.simulation_started = True
        self.miro.post('start', '/api/simulation/start', {
            'simulation_id': self.simulation_id, 'platform': platform, 'max_rounds': cp['max_rounds'], 'enable_graph_memory_update': False})
        self.log('simulate', f'started on {platform}')
        # 8. simulate. Finished means every platform reported its simulation_end (MiroFish's per-platform flag). runner_status
        # only becomes "completed" once the process exits, and the process deliberately stays alive for the interview poll.
        flags = PLATFORM_FLAGS[platform]

        def tick(state: dict) -> None:
            self.rounds_run = state.get('current_round', self.rounds_run)
            if self.rounds_run != self._last_round_logged:
                self._last_round_logged = self.rounds_run
                self.log('simulate', f'round {self.rounds_run} of {cp["max_rounds"]}')
            if self.meter().get('ceiling_hit'):
                try:
                    self.miro.post('simulate', '/api/simulation/stop', {'simulation_id': self.simulation_id})
                finally:
                    raise RunnerError('simulate', 'the metering ceiling was reached; the simulation was stopped', status='aborted_budget')

        def sim_failure(state: dict) -> str | None:
            if state.get('runner_status') in ('failed', 'stopped'):
                return f'simulation {state.get("runner_status")}: {str(state.get("error") or "no detail")[:300]}'
            return None
        self.wait('simulate', lambda: self.miro.get('simulate', f'/api/simulation/{self.simulation_id}/run-status'),
                  lambda s: all(s.get(f) for f in flags) or s.get('runner_status') == 'completed', sim_failure, on_tick=tick)
        # 9. the environment opens for interviews just after the loop ends ("alive"); asking before that fails
        self.log('ready', f'simulation finished after {self.rounds_run} rounds; waiting for the agents to take questions')
        try:
            self.wait('ready', lambda: self.miro.post('ready', '/api/simulation/env-status', {'simulation_id': self.simulation_id}),
                      lambda s: bool(s.get('env_alive')), lambda s: None)
        except RunnerError as error:
            if 'run deadline' in str(error):
                raise
            raise RunnerError('ready', f'the simulation finished but its environment never opened for interviews ({error}), '
                                       'so the final poll cannot be asked') from None
        # 10. final poll: one fixed question to every agent, on one platform
        poll_platform = 'twitter' if platform == 'twitter' else 'reddit'
        poll_limit = self.limit('poll')
        answered = self.miro.post('poll', '/api/simulation/interview/all', {
            'simulation_id': self.simulation_id, 'prompt': world_mod.poll_question(side_a, side_b), 'platform': poll_platform,
            'timeout': int(poll_limit)}, timeout_s=poll_limit + 60)
        results = (answered.get('result') or {}).get('results') or {}
        # MiroFish's interview results carry agent_id as a string ('0'); profiles and actions use integers, and the world matches
        # them by key, so an unconverted id would leave every agent "undecided" (seen against the real script, 2026-10-25).
        self.poll_answers = [{'agent_id': as_agent_id(r.get('agent_id')), 'text': str(r.get('response', ''))} for _, r in sorted(results.items())]
        self.log('poll', f'{len(self.poll_answers)} agents answered the poll')
        try:
            self.miro.post('poll', '/api/simulation/close-env', {'simulation_id': self.simulation_id})
        except RunnerError as error:
            # Left open, the environment waits for commands forever and never reaches a status MiroFish will report on. A stop
            # ends it too (as "stopped", which MiroFish also accepts for a report).
            self.log('poll', f'closing the environment failed ({str(error)[:160]}); stopping the simulation instead')
            self.miro.post('poll', '/api/simulation/stop', {'simulation_id': self.simulation_id})
        self._budget_check()
        # 11. report (narrative only: stored, never parsed for numbers). MiroFish refuses it (HTTP 409) until the run status is
        # terminal, which it publishes only once the process has exited after close-env: asked within a second of close-env,
        # the live run of 2026-10-25 was refused with the poll already answered.
        self.log('report', 'waiting for MiroFish to mark the simulation finished')

        def ended_badly(state: dict) -> str | None:
            if str(state.get('runner_status', '')).lower() == 'failed':
                return f'the simulation failed after the poll, so MiroFish will not write a report: {str(state.get("error") or "no detail")[:300]}'
            return None
        try:
            self.wait('ended', lambda: self.miro.get('report', f'/api/simulation/{self.simulation_id}/run-status'),
                      lambda s: str(s.get('runner_status', '')).lower() in REPORTABLE_RUNNER_STATUSES, ended_badly)
        except RunnerError as error:
            if error.status == 'timeout' and 'run deadline' not in str(error):
                raise RunnerError('report', f'MiroFish never marked the simulation finished after the poll ({error}), so it will not '
                                            'write a report', status='timeout') from None
            raise RunnerError('report', str(error), status=error.status) from None
        self.simulation_ended = True
        self.log('report', 'MiroFish is writing its report')
        gen = self.miro.post('report', '/api/report/generate', {'simulation_id': self.simulation_id, 'force_regenerate': False})
        if not gen.get('already_completed') and gen.get('status') != 'completed':
            self.wait('report', lambda: self.miro.post('report', '/api/report/generate/status', {'task_id': gen.get('task_id'), 'simulation_id': self.simulation_id}),
                      lambda s: s.get('status') == 'completed', task_failure)
        report = self.miro.get('report', f'/api/report/by-simulation/{self.simulation_id}')
        self.report_markdown = str(report.get('markdown_content') or '')
        if not self.report_markdown and report.get('report_id'):
            self.report_markdown = str(self.miro.get('report', f'/api/report/{report["report_id"]}').get('markdown_content') or '')
        # 12. the graph, for the world (it must be read now: cleanup deletes it from Zep)
        self.graph_data = self.miro.get('artifacts', f'/api/graph/data/{self.graph_id}')
        # 13. baseline: one direct call on the same packet (counted by the meter like any other call)
        try:
            self.baseline = self.direct(f'{text}\n\n{world_mod.poll_question(side_a, side_b)}')
        except Exception as error:  # noqa: BLE001 - recorded, never fatal: the swarm result stands without it
            self.baseline = {'error': f'{type(error).__name__}: {error}'[:200]}
        self.log('done', 'report, graph and baseline collected')

    def cleanup(self) -> None:
        """Stop the simulation if it may still be running, wait until MiroFish no longer counts it as active, then delete the
        Zep graph. MiroFish refuses to delete a graph an active simulation uses (409, GraphInUseError): the first live run's
        timeout path skipped the stop and left its graph in Zep. Never raises: the record is written whatever happens here."""
        if self.simulation_started and not self.simulation_ended:
            try:
                self.miro.post('cleanup', '/api/simulation/stop', {'simulation_id': self.simulation_id}, timeout_s=CLEANUP_HTTP_TIMEOUT_S)
                self.log('cleanup', 'stopped the simulation')
            except Exception as error:  # noqa: BLE001 - best effort; the delete below says whether it mattered
                self.log('cleanup', f'could not stop the simulation: {str(error)[:200]}')
        if self.simulation_started:
            self._wait_until_inactive()
        if not self.graph_id:
            return
        for attempt in range(1, GRAPH_DELETE_ATTEMPTS + 1):
            try:
                self.miro.delete('cleanup', f'/api/graph/delete/{self.graph_id}', timeout_s=CLEANUP_HTTP_TIMEOUT_S)
                self.graph_deleted = True
                self.log('cleanup', f'deleted the Zep graph {self.graph_id}')
                return
            except Exception as error:  # noqa: BLE001 - recorded, never raised
                self.graph_deleted = False
                if 'HTTP 409' not in str(error) or attempt == GRAPH_DELETE_ATTEMPTS:
                    self.log('cleanup', f'the Zep graph {self.graph_id} was NOT deleted: {str(error)[:200]}')
                    return
                self.sleep(GRAPH_DELETE_RETRY_S)

    def _wait_until_inactive(self) -> None:
        give_up = self.clock() + INACTIVE_WAIT_S
        while self.clock() < give_up:
            try:
                state = self.miro.get('cleanup', f'/api/simulation/{self.simulation_id}/run-status', timeout_s=CLEANUP_HTTP_TIMEOUT_S)
            except Exception:  # noqa: BLE001 - the delete's own answer decides
                return
            if str(state.get('runner_status', '')).lower() not in ACTIVE_RUNNER_STATUSES:
                return
            self.sleep(5)


def drop_relogged_seed_posts(actions: dict) -> tuple[dict, int]:
    """Each platform's actions without the seed posts MiroFish logs a second time, and how many were dropped.

    MiroFish's script logs its seed posts as round 0, then reads new actions from its trace table starting at row 0
    (`last_rowid = 0` in run_parallel_simulation.py at the pinned commit), so its first read, in the platform's first round with
    an agent step, logs the seed posts again under that round. Seen live (2026-10-25, run 40241533761): 9 of the 15 entries after
    round 0 were these repeats, shown in the world as agent posts. Only that first round is touched, and an entry is dropped only
    when it matches a round-0 seed post by agent, action type and text, each seed post at most once: a later post that repeats a
    seed's words is the agent's own."""
    def is_action(e: dict) -> bool:
        return 'event_type' not in e and bool(e.get('action_type')) and isinstance(e.get('round'), int)

    def key(e: dict) -> tuple:
        return (e.get('agent_id'), e.get('action_type'), str((e.get('action_args') or {}).get('content') or '').strip())
    cleaned, dropped = {}, 0
    for platform, entries in actions.items():
        seeds = collections.Counter(key(e) for e in entries if is_action(e) and e['round'] == 0)
        first = min((e['round'] for e in entries if is_action(e) and e['round'] >= 1), default=None)
        kept = []
        for e in entries:
            if seeds and is_action(e) and e['round'] == first and seeds[key(e)] > 0:
                seeds[key(e)] -= 1
                dropped += 1
                continue
            kept.append(e)
        cleaned[platform] = kept
    return cleaned, dropped


def simulated_actions(actions: dict) -> int:
    """Actions agents took in the simulated rounds. Round 0 holds only the posts the script seeds before its loop."""
    return sum(1 for entries in actions.values() for e in entries
               if 'event_type' not in e and e.get('action_type') and isinstance(e.get('round'), int) and e['round'] >= 1)


def read_actions(mirofish_dir: str, simulation_id: str) -> dict:
    base = os.path.join(mirofish_dir, 'backend', 'uploads', 'simulations', simulation_id)
    found = {}
    for platform in ('twitter', 'reddit'):
        path = os.path.join(base, platform, 'actions.jsonl')
        if os.path.isfile(path):
            with open(path, encoding='utf-8') as handle:
                found[platform] = world_mod.parse_actions_jsonl(handle.read())
    return found


def provider_said(meter: dict) -> str:
    """The first provider error the meter kept, as a reason suffix. MiroFish reports only the status, never the provider's words."""
    sample = next((s for s in meter.get('error_samples') or [] if s.get('source') == 'upstream'), None)
    return f'; the provider said (HTTP {sample.get("status")}): {str(sample.get("excerpt", ""))[:240]}' if sample else ''


def classify(error: RunnerError, meter: dict) -> tuple[str, str]:
    """The record status for a pipeline failure."""
    if error.status != 'failed':
        return error.status, str(error)
    if meter.get('ceiling_hit'):
        return 'aborted_budget', f'{error}; the metering ceiling had been reached'
    if error.stage == 'graph' and re.search(r'(?i)quota|credit|rate.?limit|429|too many', str(error)):
        return 'aborted_zep_quota', str(error)
    return 'failed', f'[{error.stage}] {error}{provider_said(meter)}'


def model_label(model: str, meter: dict) -> str:
    """The engine label grading keys on. A thinking-enabled run is a different engine for the track record, so it is labelled apart."""
    thinking = (meter.get('request_policy') or {}).get('thinking')
    return f'{model}+thinking' if thinking == 'enabled' else model


def parse_direct(text: str, side_a: str, side_b: str, model: str) -> dict:
    parsed = world_mod.parse_poll_answer(text, side_a, side_b)
    return {'model': model, 'pick': parsed['pick'], 'p_a': parsed['p_a'], 'why': parsed['why'], 'parsed': parsed['pick'] is not None and parsed['p_a'] is not None}


def build_record(*, args: dict, attempt: int, attempts: list[dict], run: Run, status: str, reason: str, meter: dict, started: str, finished: str,
                 wall_seconds: float, artifact_info: dict, stats: dict | None) -> dict:
    p, packet = PRESETS[args['preset']], args['packet_text']
    thin = []
    if len(packet) < MIN_FULL_PACKET_CHARS:
        thin.append(f'packet is {len(packet)} characters (under {MIN_FULL_PACKET_CHARS})')
    thin += [f'provenance.{k} missing' for k in ('stats_snapshot', 'matchup_read', 'human_state') if not (args.get('provenance') or {}).get(k)]
    side_a, side_b = args['sides']
    yes = args.get('yes_side') or None
    lean_yes = None
    if stats and stats.get('median_p_a') is not None and yes in (side_a, side_b):
        lean_yes = stats['median_p_a'] if yes == side_a else round(100 - stats['median_p_a'], 1)
    previous = next((a for a in reversed(attempts) if a.get('status') == 'completed'), None)
    policy = meter.get('request_policy') or {}
    sampling = ("MiroFish's own per-call values (0.3 to 0.7), passed through" if not policy.get('pinned_fields') else
                f"the provider's fixed values: the meter removed {', '.join(policy['pinned_fields'])} from MiroFish's calls "
                '(this engine rejects any other value); see usage.request_policy')
    return {
        'schema': RECORD_SCHEMA, 'attempt': attempt, 'key': {'card_id': args['card_id'], 'market_ticker': args['market_ticker']},
        'sides': [side_a, side_b], 'yes_side': yes, 'status': status, 'reason': reason,
        'seed': {'packet_sha256': world_mod.sha256_hex(packet.encode('utf-8')), 'packet_chars': len(packet),
                 'provenance': args.get('provenance') or {}, 'thin': bool(thin), 'thin_reasons': thin},
        'engine': {'name': 'mirofish', **{k: args['pins'].get(k) for k in ('repo_commit', 'uv_lock_sha256', 'python', 'torch', 'torch_cpu_sha256', 'uv_version', 'runner_image')},
                   'environment_digest': environment_digest(args['pins'])},
        'config': {'preset': args['preset'], 'size_class': args['preset'], 'counts_toward_bar': p['counts_toward_bar'], 'platform': p['platform'],
                   'active_rounds': p['active_rounds'], 'max_rounds': (run.clock_plan or {}).get('max_rounds'), 'clock': run.clock_plan,
                   'rounds_run': run.rounds_run, 'active_rounds_run': active_rounds_run(run), 'simulated_actions': run.simulated_actions,
                   'relogged_seed_posts_dropped': run.relogged_seed_posts,
                   'agents_cap': p['agents_cap'], 'agents_prepared': run.agents_prepared, 'deadline_s': int(run.deadline_s),
                   'llm_provider': args['provider'], 'llm_model': args['model'], 'engine_label': model_label(args['model'], meter),
                   'thinking': policy.get('thinking', 'provider-default'), 'locale': 'en', 'sampling': sampling, 'reproducible': False},
        'extraction': stats, 'lean_for_yes_side': lean_yes, 'baseline_direct': run.baseline,
        'usage': meter, 'zep': {'graph_id': run.graph_id, 'deleted': run.graph_deleted, **estimate_zep(len(packet))},
        'artifacts': artifact_info, 'timing': {'started_at': started, 'finished_at': finished, 'wall_seconds': round(wall_seconds, 1)},
        'rerun_of': ({'attempt': previous.get('attempt'), 'reason': args.get('rerun_reason', '')} if previous else None),
        'invocation_id': args.get('invocation_id', ''),
    }


def environment_digest(pins: dict) -> str | None:
    """A sha256 over everything that makes the install reproducible, or None when a piece is missing.

    The intake schema (nexusIntake.ts) asks for `engine.image_digest`, because it assumed a container image. This engine is a
    hash-pinned SOURCE install with no image, so the honest equivalent is a digest of the whole pinned environment: the MiroFish
    commit, the lockfile hash, the CPU torch wheel hash, the Python and uv versions and the runner image name. It is emitted in the
    image_digest field with `digest_kind` saying what it is, and is a proposal for the intake lane to ratify or change."""
    needed = ('repo_commit', 'uv_lock_sha256', 'torch_cpu_sha256', 'python', 'uv_version', 'runner_image')
    if any(not pins.get(k) for k in needed):
        return None
    canonical = json.dumps({k: pins[k] for k in needed}, sort_keys=True, separators=(',', ':'))
    return 'sha256:' + hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def _nonempty(value) -> bool:
    return isinstance(value, str) and value.strip() != ''


def nexus_line_problem(value) -> str | None:
    """A Python port of simRunRecordProblem (src/lib/nexusIntake.ts). The TypeScript test in the repo validates the same golden
    line with the real validator, so if the two ever drift one of them fails."""
    if not isinstance(value, dict):
        return 'sim-run is not an object'
    if value.get('kind') != 'sim-run':
        return 'kind is not sim-run'
    for key in ('ts', 'source', 'run_id', 'ref', 'position_ref'):
        if not _nonempty(value.get(key)):
            return f'sim-run has no {key}'
    seed = value.get('seed')
    if not isinstance(seed, dict):
        return 'sim-run has no seed provenance object'
    if not isinstance(seed.get('matchup_read'), bool) or not isinstance(seed.get('human_state'), bool):
        return 'sim-run seed.matchup_read and seed.human_state must be booleans'
    if 'stats_snapshot' not in seed or (seed['stats_snapshot'] is not None and not _nonempty(seed['stats_snapshot'])):
        return 'sim-run seed.stats_snapshot must be a string or null'
    engine = value.get('engine')
    if not isinstance(engine, dict):
        return 'sim-run has no engine config object'
    for key in ('agents', 'rounds'):
        n = engine.get(key)
        if not (isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= 100_000):
            return f'sim-run engine.{key} must be a positive integer'
    if not _nonempty(engine.get('model')):
        return 'sim-run engine.model is missing'
    if not re.fullmatch(r'[0-9a-fA-F]{7,40}', str(engine.get('mirofish_commit', ''))):
        return 'sim-run is missing its MiroFish commit pin'
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', str(engine.get('image_digest', ''))):
        return 'sim-run is missing its engine digest pin (sha256:<64 hex>)'
    median = value.get('median_lean_pct')
    if isinstance(median, bool) or not isinstance(median, (int, float)) or not math.isfinite(median) or not 0 <= median <= 100:
        return 'sim-run median_lean_pct must be a number from 0 to 100'
    side = value.get('side')
    if not (_nonempty(side) and not re.search(r'\s', side.strip()) and len(side.strip()) <= SIDE_TOKEN_MAX):
        return 'sim-run side must be one token'
    if not _nonempty(value.get('report')):
        return 'sim-run has no report reference'
    return None


def build_nexus_line(record: dict, args: dict) -> tuple[dict | None, str]:
    """The intake lane's `sim-run` line for this run, or (None, why not).

    Only a COMPLETED run of a size that counts toward the bar produces one: grading counts every filed sim toward its
    10-settled-sims bar, so a tiny pipeline-proof world must never reach intake. The record is for the YES contract of the
    market (side 'YES'), which needs the caller to say which fighter that is."""
    if record['status'] != 'completed':
        return None, f'not emitted: the run ended {record["status"]}'
    if not record['config']['counts_toward_bar']:
        return None, f'not emitted: the {record["config"]["preset"]} preset does not count toward the 10-sim bar, and intake would count it'
    ex = record.get('extraction') or {}
    lean = record.get('lean_for_yes_side')
    if lean is None:
        return None, ('not emitted: no lean for the YES side (yes_side was not one of the sides, or no agent gave a parseable P_A); '
                      'intake needs a median lean for one named side')
    market = record.get('market_at_start') or {}
    if not market.get('open'):
        seen = (f'Kalshi listed it as {market.get("status") or "unknown"}, closing {market.get("close_time") or "unknown"}' if market.get('checked')
                else f'Kalshi could not be read: {market.get("error") or "not checked"}')
        return None, f'not emitted: the market was not open when the run started ({seen}); a sim run once the market has closed is not a pre-fight forecast'
    digest = environment_digest(args['pins'])
    if digest is None:
        return None, 'not emitted: the pins lack what the environment digest needs (torch_cpu_sha256, uv_version, runner_image)'
    prov = args.get('provenance') or {}
    snapshot = prov.get('stats_snapshot')
    present = lambda v: isinstance(v, str) and v.strip() not in ('', 'absent', 'none', 'null')  # noqa: E731
    repo = args.get('repo') or ''
    report = (f'https://github.com/{repo}/blob/sim-results/{args["card_id"]}/{args["market_ticker"]}.{record["attempt"]}.sim-world.v1.json'
              if repo else record['artifacts'].get('world_json', ''))
    pins = args['pins']
    line = {
        'kind': 'sim-run', 'ts': record['timing']['finished_at'], 'source': NEXUS_SOURCE,
        'run_id': f'sim-{args["card_id"]}-{args["market_ticker"]}-a{record["attempt"]}',
        'ref': args['market_ticker'], 'position_ref': args.get('position_ref') or f'shadow:{args["card_id"]}:{args["market_ticker"]}',
        'seed': {'stats_snapshot': snapshot if present(snapshot) else None, 'matchup_read': present(prov.get('matchup_read')),
                 'human_state': present(prov.get('human_state'))},
        'engine': {'agents': record['config']['agents_prepared'], 'model': record['config']['engine_label'], 'rounds': record['config']['active_rounds_run'],
                   'mirofish_commit': pins['repo_commit'], 'image_digest': digest, 'digest_kind': 'source-install-environment',
                   'uv_lock_sha256': pins['uv_lock_sha256']},
        'median_lean_pct': lean, 'side': 'YES', 'report': report,
    }
    problem = nexus_line_problem(line)
    if problem:
        return None, f'not emitted: the line would fail intake validation ({problem})'
    if ex.get('n', 0) < 1:
        return None, 'not emitted: the poll has no answers'
    return line, 'emitted'


def write_outputs(out_dir: str, card_id: str, ticker: str, attempt: int, record: dict, files: dict[str, bytes]) -> list[str]:
    folder = os.path.join(out_dir, card_id)
    os.makedirs(folder, exist_ok=True)
    written = []
    for suffix, content in files.items():
        path = os.path.join(folder, f'{ticker}.{attempt}.{suffix}')
        with open(path, 'wb') as handle:
            handle.write(content)
        written.append(path)
    path = os.path.join(folder, f'{ticker}.{attempt}.{RECORD_SUFFIX}')
    with open(path, 'w', encoding='utf-8') as handle:
        json.dump(record, handle, ensure_ascii=False, sort_keys=True, indent=2)
        handle.write('\n')
    return written + [path]


def utc(clock_seconds: float) -> str:
    return datetime.fromtimestamp(clock_seconds, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def active_rounds_run(run: Run) -> int | None:
    """Rounds run in which agents could act (see plan_clock): the idle rounds are bookkeeping, not simulation."""
    if run.rounds_run is None or run.clock_plan is None:
        return run.rounds_run
    return sum(1 for n in run.clock_plan['active_round_numbers'] if n <= int(run.rounds_run))


def market_at_start(read: Callable[[str], dict], ticker: str, now_s: float) -> dict:
    """Whether Kalshi lists the market as open (an open status and a close time still ahead). Never raises."""
    try:
        market = read(ticker) or {}
    except Exception as error:  # noqa: BLE001 - an unreadable market files no line; the run itself goes on
        return {'checked': False, 'open': False, 'error': f'{type(error).__name__}: {error}'[:200]}
    status = str(market.get('status') or '').lower()
    close_time = market.get('close_time')
    try:
        closes_after = datetime.fromisoformat(str(close_time).replace('Z', '+00:00')).timestamp() > now_s
    except ValueError:
        closes_after = False
    return {'checked': True, 'status': status, 'close_time': close_time, 'open': status in OPEN_MARKET_STATUSES and closes_after}


def kalshi_market_reader(timeout_s: float = 15, retry_after_s: float = 3, sleep=time.sleep) -> Callable[[str], dict]:
    """Kalshi's public market endpoint (no account, no key). One retry on a rate limit or a server error: Kalshi answers 429
    to bursts (seen 2026-10-26), and an unread market means a completed counted run files no line."""
    def read(ticker: str) -> dict:
        url = KALSHI_MARKET_URL.format(ticker=urllib.parse.quote(ticker, safe=''))
        for attempt in (1, 2):
            try:
                with urllib.request.urlopen(url, timeout=timeout_s) as res:  # noqa: S310 - fixed public https host
                    return json.loads(res.read()).get('market') or {}
            except urllib.error.HTTPError as error:
                if attempt == 2 or error.code not in (429, 500, 502, 503, 504):
                    raise
            except urllib.error.URLError:
                if attempt == 2:
                    raise
            sleep(retry_after_s)
        return {}
    return read


def run_attempt(args: dict, miro: Miro, meter: Callable[[], dict], direct: Callable[[str], str], *, sleep=time.sleep, clock=time.time,
                log: Callable[[str], None] | None = None, market: Callable[[str], dict] | None = None) -> tuple[dict, list[str]]:
    """Pre-flight, one pipeline attempt, record. Raises Refusal before spending anything; otherwise always returns a record."""
    if args['preset'] not in PRESETS:
        raise Refusal(f'unknown preset {args["preset"]!r}; known: {sorted(PRESETS)}')
    if len(args['sides']) != 2 or not all(args['sides']):
        raise Refusal('sides must be exactly two non-empty names')
    check_pins(args['pins'])
    why = screen_packet(args['packet_text'])
    if why:
        raise Refusal(why)
    attempts = load_attempts(args['results_dir'], args['card_id'], args['market_ticker'])
    attempt = decide_slot(attempts, args.get('rerun_reason', ''))
    side_a, side_b = args['sides']
    started_at = clock()
    # Read only when a line could be filed: a counted preset with a YES side. Taken before anything is spent, so the record
    # says whether the market was open when the run began, not when it ended.
    market_state = (market_at_start(market or kalshi_market_reader(), args['market_ticker'], started_at)
                    if args.get('yes_side') and PRESETS[args['preset']]['counts_toward_bar'] else None)
    run = Run(miro, args, meter, lambda prompt: parse_direct(direct(prompt), side_a, side_b, args['model']), sleep, clock, log)
    status, reason = 'completed', ''
    try:
        run.execute()
    except RunnerError as error:
        status, reason = classify(error, meter())
    except Exception as error:  # noqa: BLE001 - an unexpected failure is still recorded, never swallowed
        status, reason = 'failed', f'unexpected {type(error).__name__}: {error}'[:300]
    finally:
        run.cleanup()
    finished_at = clock()

    stats = None
    if run.poll_answers:
        stats = world_mod.poll_stats([world_mod.parse_poll_answer(x['text'], side_a, side_b) for x in run.poll_answers]) | {
            'question_sha256': world_mod.sha256_hex(world_mod.poll_question(side_a, side_b).encode())}
    files: dict[str, bytes] = {}
    artifact_info: dict = {'run_url': args.get('run_url', '')}
    actions: dict = {}
    if status == 'completed':
        actions, run.relogged_seed_posts = drop_relogged_seed_posts(
            read_actions(args['mirofish_dir'], run.simulation_id) if args.get('mirofish_dir') else {})
        run.simulated_actions = simulated_actions(actions)
        if not actions:
            status, reason = 'failed', '[artifacts] no actions.jsonl was found for the simulation, so the world cannot be built'
        elif not run.simulated_actions:
            # Seen live (2026-10-25): every round fell in off-peak hours, no agent acted, and the world would have held only the
            # seeded posts. That is not a swarm, so it is not recorded as one.
            status, reason = 'failed', ('[simulate] no agent acted in any simulated round (the log holds only the seeded posts), so there '
                                        'is no swarm to build a world from')
    if status == 'completed':
        engine = {'name': 'mirofish', **{k: args['pins'].get(k) for k in ('repo_commit', 'uv_lock_sha256', 'python', 'torch', 'torch_cpu_sha256', 'uv_version', 'runner_image')},
                  'environment_digest': environment_digest(args['pins'])}
        world = world_mod.build_world(
            key={'card_id': args['card_id'], 'market_ticker': args['market_ticker']}, engine=engine, sides=[side_a, side_b], graph=run.graph_data,
            profiles=run.profiles, actions=actions, poll_answers=run.poll_answers,
            report_sections=world_mod.report_sections_from_markdown(run.report_markdown))
        world_bytes = world_mod.dump_world(world)
        svg_bytes = world_mod.render_svg(world).encode('utf-8')
        report_bytes = run.report_markdown.encode('utf-8')
        files = {'sim-world.v1.json': world_bytes, 'world.svg': svg_bytes, 'report.md': report_bytes}
        artifact_info.update({'world_json': f'{args["market_ticker"]}.{attempt}.sim-world.v1.json', 'world_json_sha256': world_mod.sha256_hex(world_bytes),
                              'world_svg': f'{args["market_ticker"]}.{attempt}.world.svg', 'world_svg_sha256': world_mod.sha256_hex(svg_bytes),
                              'report': f'{args["market_ticker"]}.{attempt}.report.md', 'report_sha256': world_mod.sha256_hex(report_bytes),
                              'world_truncated': world['limits']['truncated']})
    record = build_record(args=args, attempt=attempt, attempts=attempts, run=run, status=status, reason=reason, meter=meter(),
                          started=utc(started_at), finished=utc(finished_at), wall_seconds=finished_at - started_at,
                          artifact_info=artifact_info, stats=stats)
    record['market_at_start'] = market_state
    line, why = build_nexus_line(record, args)
    record['nexus'] = {'emitted': line is not None, 'reason': why, 'file': f'{args["market_ticker"]}.{attempt}.{NEXUS_SUFFIX}' if line else None}
    if line is not None:
        files[NEXUS_SUFFIX] = (json.dumps(line, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode('utf-8')
    return record, write_outputs(args['out_dir'], args['card_id'], args['market_ticker'], attempt, record, files)


def meter_reader(meter_url: str) -> Callable[[], dict]:
    def read() -> dict:
        with urllib.request.urlopen(meter_url.rstrip('/') + '/__meter', timeout=15) as res:  # noqa: S310 - localhost meter
            return json.loads(res.read())
    return read


def direct_caller(meter_url: str, model: str) -> Callable[[str], str]:
    """One chat call through the metering proxy (so it is counted and capped like every other call)."""
    def call(prompt: str) -> str:
        body = json.dumps({'model': model, 'messages': [{'role': 'user', 'content': prompt}], 'max_tokens': 400}).encode()
        request = urllib.request.Request(meter_url.rstrip('/') + '/v1/chat/completions', data=body,
                                         headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(request, timeout=300) as res:  # noqa: S310 - localhost meter
            return json.loads(res.read())['choices'][0]['message']['content']
    return call


def parse_args(argv=None) -> dict:
    ap = argparse.ArgumentParser(description='Run one MiroFish swarm simulation and write its record and illustrated world.')
    ap.add_argument('--packet', required=True, help='seed packet file (markdown)')
    ap.add_argument('--card-id', required=True)
    ap.add_argument('--market-ticker', required=True)
    ap.add_argument('--sides', required=True, help='"Side A|Side B": the first is A, the side P_A is asked about')
    ap.add_argument('--yes-side', default='', help='which side the market YES contract is on (one of the sides)')
    ap.add_argument('--preset', default='tiny', choices=sorted(PRESETS))
    ap.add_argument('--provider', required=True)
    ap.add_argument('--model', required=True)
    ap.add_argument('--mirofish-url', default='http://127.0.0.1:5001')
    ap.add_argument('--mirofish-dir', default='', help='the MiroFish checkout, where it writes its simulation files')
    ap.add_argument('--meter-url', required=True)
    ap.add_argument('--results-dir', required=True, help='checkout of the sim-results branch (read for the one-sim-per-key rule)')
    ap.add_argument('--out-dir', required=True)
    ap.add_argument('--pins', default='{}', help='JSON: repo_commit, uv_lock_sha256 (required); python, torch, torch_cpu_sha256, uv_version, runner_image')
    ap.add_argument('--provenance', default='{}', help='JSON: stats_snapshot, matchup_read, human_state (values: a ref/hash, or "absent")')
    ap.add_argument('--position-ref', default='', help='the position or proposal this run is for; default shadow:<card_id>:<market_ticker>')
    ap.add_argument('--repo', default=os.environ.get('GITHUB_REPOSITORY', ''), help='owner/name, for the report link in the intake line')
    ap.add_argument('--rerun-reason', default='')
    ap.add_argument('--invocation-id', default='')
    ap.add_argument('--run-url', default='')
    ap.add_argument('--deadline-s', type=int, default=DEFAULT_DEADLINE_S,
                    help='overall limit for the run, under the job timeout: every stage is cut to fit, with time kept for cleanup and the record')
    ns = ap.parse_args(argv)
    with open(ns.packet, encoding='utf-8') as handle:
        packet_text = handle.read()
    try:
        pins, provenance = json.loads(ns.pins), json.loads(ns.provenance)
    except ValueError as error:
        raise Refusal(f'--pins and --provenance must be JSON: {error}')
    sides = [x.strip() for x in ns.sides.split('|')]
    return {'packet_text': packet_text, 'card_id': ns.card_id, 'market_ticker': ns.market_ticker, 'sides': sides,
            'yes_side': ns.yes_side.strip() if ns.yes_side.strip() in sides else '', 'preset': ns.preset,
            'provider': ns.provider, 'model': ns.model, 'mirofish_url': ns.mirofish_url, 'mirofish_dir': ns.mirofish_dir,
            'meter_url': ns.meter_url, 'results_dir': ns.results_dir, 'out_dir': ns.out_dir, 'pins': pins, 'provenance': provenance,
            'rerun_reason': ns.rerun_reason, 'invocation_id': ns.invocation_id, 'run_url': ns.run_url,
            'position_ref': ns.position_ref.strip(), 'repo': ns.repo.strip(), 'deadline_s': ns.deadline_s}


def main(argv=None) -> int:
    try:
        args = parse_args(argv)
        record, paths = run_attempt(args, Miro(Http(args['mirofish_url'])), meter_reader(args['meter_url']), direct_caller(args['meter_url'], args['model']))
    except Refusal as refusal:
        print(f'::error title=mirofish-runner::refused before spending anything: {refusal}', file=sys.stderr)
        return 2
    print(json.dumps({'status': record['status'], 'reason': record['reason'], 'attempt': record['attempt'], 'files': paths,
                      'cost_usd': record['usage'].get('cost_usd'), 'agents': record['config']['agents_prepared'],
                      'rounds_run': record['config']['rounds_run'], 'nexus': record['nexus']}, indent=2))
    if record['status'] != 'completed':
        print(f'::error title=mirofish-runner::run ended {record["status"]}: {record["reason"]}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
