# ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
# Proprietary source-available license. Commercial use requires written permission. See LICENSE.
"""The illustrated world of a MiroFish run: sim-world.v1.json (canonical), world.svg (static preview), report.md.

Owner ruling 2026-10-24: the illustration is a core deliverable of the swarm lane, in a form ForgeClaw's future stage can
render. This module is a PURE function from MiroFish's own output files to those artifacts. It makes no model call, reads no
network and no clock, so the same inputs always give byte-identical outputs and every artifact can be hashed into the
sim-run record and tested on fixtures.

Field names are the ones MiroFish writes (read from its source, 2026-10-24):
  * actions.jsonl lines: {round, timestamp, agent_id, agent_name, action_type, action_args, result, success} plus event lines
    {event_type: round_start | round_end | simulation_start | simulation_end, ...};
  * /graph/data: nodes {uuid, name, labels, summary, attributes}, edges {name, fact, source_node_uuid, target_node_uuid,
    source_node_name, target_node_name};
  * profiles: {user_id, username, name, bio, persona, ...}.

What this is not: it does not interpret the simulation. It shows who said what, in which round, and where each agent ended
up in the final poll. The poll is a measurement we add (MiroFish emits no probability), and the world says so.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import statistics
from xml.sax.saxutils import escape

SCHEMA = 'forgeclaw.sim-world.v1'
POLL_METHOD = 'agent-poll-v1'
MAX_WORLD_BYTES = 1024 * 1024
MAX_SVG_BYTES = 200 * 1024
TEXT_CHARS = 280
SHORT_TEXT_CHARS = 140
TARGET_CHARS = 120
PERSONA_CHARS = 280
SECTION_CHARS = 6000
MAX_SECTIONS = 5

# Posting and arguing carry the story; the rest is reaction noise and is the first thing dropped when the file is too big.
HIGH_SIGNAL = {'CREATE_POST', 'CREATE_COMMENT', 'QUOTE_POST', 'REPOST'}
POST_ACTIONS = HIGH_SIGNAL | {'LIKE_POST', 'DISLIKE_POST', 'LIKE_COMMENT', 'DISLIKE_COMMENT', 'FOLLOW', 'MUTE',
                              'SEARCH_POSTS', 'SEARCH_USER', 'DO_NOTHING'}

COLOR_A, COLOR_B, COLOR_UNDECIDED = '#f97316', '#38bdf8', '#94a3b8'


def poll_question(side_a: str, side_b: str) -> str:
    """The fixed question every agent is asked at the end. Its hash is stamped into the record, so it cannot drift silently."""
    return (f'The fight is about to happen: A is {side_a} and B is {side_b}. Using everything you have seen and argued in this '
            'simulation, answer in exactly one line, in exactly this format and nothing else: '
            'PICK=<A or B>; P_A=<integer from 0 to 100, your probability that A wins>; WHY=<at most 20 words>')


# ─── Poll parsing and statistics ─────────────────────────────────────────────

_PICK = re.compile(r'PICK\s*[=:]\s*\**\s*([A-Za-z][A-Za-z .\'’-]{0,60}?)\s*\**\s*(?:[;\n|]|P_A|$)', re.I)
_P_A = re.compile(r'P_?A\s*[=:]\s*\**\s*(\d{1,3}(?:\.\d+)?)\s*%?', re.I)
_WHY = re.compile(r'WHY\s*[=:]\s*(.+)', re.I | re.S)


def _name_tokens(name: str) -> set[str]:
    return {t for t in re.findall(r"[a-z][a-z'’-]*", name.lower()) if len(t) >= 3}


def parse_poll_answer(text: str, side_a: str, side_b: str) -> dict:
    """One agent's answer: {pick: 'A'|'B'|None, p_a: float|None, why: str, consistent: bool|None}. Never guesses a missing field."""
    raw = text or ''
    pick = None
    match = _PICK.search(raw)
    if match:
        token = match.group(1).strip().rstrip('.').strip()
        if token.upper() in ('A', 'B'):
            pick = token.upper()
        else:
            tokens = _name_tokens(token)
            a_hit, b_hit = bool(tokens & _name_tokens(side_a)), bool(tokens & _name_tokens(side_b))
            if a_hit != b_hit:
                pick = 'A' if a_hit else 'B'
    p_a = None
    pmatch = _P_A.search(raw)
    if pmatch:
        value = float(pmatch.group(1))
        if 0 <= value <= 100:
            p_a = value
    why_match = _WHY.search(raw)
    why = re.sub(r'\s+', ' ', why_match.group(1)).strip()[:200] if why_match else ''
    consistent = None
    if pick and p_a is not None:
        consistent = not ((pick == 'A' and p_a < 50) or (pick == 'B' and p_a > 50))
    return {'pick': pick, 'p_a': p_a, 'why': why, 'consistent': consistent}


def _quantile(sorted_values: list[float], q: float) -> float:
    if len(sorted_values) == 1:
        return sorted_values[0]
    pos = (len(sorted_values) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (pos - lo)


def poll_stats(parsed: list[dict]) -> dict:
    """The swarm's lean, counted from stored answers: n, unparsed, pick counts, median P(A), IQR, and how many contradicted themselves."""
    n = len(parsed)
    picks = [p['pick'] for p in parsed if p['pick']]
    values = sorted(p['p_a'] for p in parsed if p['p_a'] is not None)
    stats = {
        'method': POLL_METHOD, 'n': n, 'unparsed': sum(1 for p in parsed if not p['pick'] and p['p_a'] is None),
        'picks': {'A': picks.count('A'), 'B': picks.count('B')},
        'p_a_n': len(values), 'median_p_a': None, 'iqr_p_a': None, 'q1_p_a': None, 'q3_p_a': None,
        'inconsistent': sum(1 for p in parsed if p['consistent'] is False),
    }
    if values:
        stats['median_p_a'] = round(statistics.median(values), 1)
        q1, q3 = _quantile(values, 0.25), _quantile(values, 0.75)
        stats['q1_p_a'], stats['q3_p_a'], stats['iqr_p_a'] = round(q1, 1), round(q3, 1), round(q3 - q1, 1)
    return stats


# ─── Reading MiroFish's files ────────────────────────────────────────────────

def parse_actions_jsonl(text: str) -> list[dict]:
    """Every parseable JSON object in an actions.jsonl, in file order. A malformed line is skipped, not fatal."""
    out = []
    for line in (text or '').splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if isinstance(obj, dict):
            out.append(obj)
    return out


def _clip(value, limit: int) -> str:
    return re.sub(r'\s+', ' ', str(value or '')).strip()[:limit]


def event_text_and_target(action_type: str, args: dict) -> tuple[str, str]:
    """The words an action put into the world and what it was aimed at, using the argument names MiroFish logs."""
    args = args if isinstance(args, dict) else {}
    if action_type in ('CREATE_POST',):
        return _clip(args.get('content'), TEXT_CHARS), ''
    if action_type == 'CREATE_COMMENT':
        return _clip(args.get('content'), TEXT_CHARS), _clip(f"post:{args['post_id']}" if args.get('post_id') is not None else '', TARGET_CHARS)
    if action_type == 'QUOTE_POST':
        return _clip(args.get('quote_content') or args.get('content'), TEXT_CHARS), _clip(args.get('original_content'), TARGET_CHARS)
    if action_type == 'REPOST':
        return '', _clip(args.get('original_content'), TARGET_CHARS)
    if action_type in ('LIKE_POST', 'DISLIKE_POST', 'LIKE_COMMENT', 'DISLIKE_COMMENT'):
        return '', _clip(args.get('original_content') or args.get('content'), TARGET_CHARS)
    if action_type in ('FOLLOW', 'MUTE'):
        return '', _clip(args.get('target_user_name'), TARGET_CHARS)
    if action_type in ('SEARCH_POSTS', 'SEARCH_USER'):
        return _clip(args.get('query') or args.get('keyword') or args.get('username'), TEXT_CHARS), ''
    return '', ''


def report_sections_from_markdown(markdown: str) -> list[dict]:
    """MiroFish's report as titled sections (it writes 2 to 5). Text before the first heading is kept as an untitled lead."""
    sections, title, body = [], '', []
    for line in (markdown or '').splitlines():
        heading = re.match(r'^##\s+(.*)$', line)
        if heading:
            if title or ''.join(body).strip():
                sections.append({'title': title, 'markdown': '\n'.join(body).strip()[:SECTION_CHARS]})
            title, body = heading.group(1).strip()[:160], []
        else:
            body.append(line)
    if title or ''.join(body).strip():
        sections.append({'title': title, 'markdown': '\n'.join(body).strip()[:SECTION_CHARS]})
    return sections[:MAX_SECTIONS]


# ─── The world ───────────────────────────────────────────────────────────────

def _node_kind(labels) -> str:
    for label in labels or []:
        if label not in ('Entity', 'Node'):
            return str(label)[:60]
    return 'Entity'


def build_world(*, key: dict, engine: dict, sides: list[str], graph: dict, profiles: list[dict], actions: dict,
                poll_answers: list[dict], report_sections: list[dict], max_bytes: int = MAX_WORLD_BYTES) -> dict:
    """The canonical world. `actions` maps platform -> parsed actions.jsonl objects; `poll_answers` is [{agent_id, text}]."""
    side_a, side_b = sides[0], sides[1]
    nodes = sorted(({'id': n.get('uuid', ''), 'name': _clip(n.get('name'), 80), 'kind': _node_kind(n.get('labels')),
                     'summary': _clip(n.get('summary'), 240)} for n in (graph or {}).get('nodes', [])),
                   key=lambda n: (n['name'], n['id']))
    edges = sorted(({'source': e.get('source_node_name') or e.get('source_node_uuid', ''),
                     'target': e.get('target_node_name') or e.get('target_node_uuid', ''),
                     'relation': _clip(e.get('name'), 60), 'fact': _clip(e.get('fact'), 240)}
                    for e in (graph or {}).get('edges', [])),
                   key=lambda e: (e['source'], e['target'], e['relation'], e['fact']))

    parsed_poll, picks = [], {}
    for answer in poll_answers:
        parsed = parse_poll_answer(answer.get('text', ''), side_a, side_b)
        parsed_poll.append({'agent_id': answer.get('agent_id'), **parsed})
        picks[answer.get('agent_id')] = parsed['pick']
    stats = poll_stats([{k: v for k, v in p.items() if k != 'agent_id'} for p in parsed_poll])

    activity: dict = {}
    rounds: dict[int, list[dict]] = {}
    hours: dict[int, int] = {}
    events_total = events_failed = 0
    for platform in sorted(actions):
        for obj in actions[platform]:
            if 'event_type' in obj:
                if obj['event_type'] == 'round_start' and isinstance(obj.get('round'), int):
                    hours.setdefault(obj['round'], obj.get('simulated_hour') if isinstance(obj.get('simulated_hour'), int) else 0)
                continue
            action_type = str(obj.get('action_type', '')).upper()
            if action_type not in POST_ACTIONS or not isinstance(obj.get('round'), int):
                continue
            events_total += 1
            if obj.get('success') is False:
                events_failed += 1
                continue
            agent_id = obj.get('agent_id')
            activity[agent_id] = activity.get(agent_id, 0) + (0 if action_type == 'DO_NOTHING' else 1)
            text, target = event_text_and_target(action_type, obj.get('action_args'))
            rounds.setdefault(obj['round'], []).append({
                '_ts': str(obj.get('timestamp', '')), 'agent': agent_id, 'agent_name': _clip(obj.get('agent_name'), 60),
                'platform': platform, 'type': action_type, 'text': text, 'target': target})

    agents = []
    for p in sorted(profiles or [], key=lambda p: (p.get('user_id') if isinstance(p.get('user_id'), int) else 1 << 30, str(p.get('name', '')))):
        pick = picks.get(p.get('user_id'))
        agents.append({'id': p.get('user_id'), 'name': _clip(p.get('name') or p.get('username'), 60),
                       'persona': _clip(p.get('persona') or p.get('bio'), PERSONA_CHARS), 'activity': activity.get(p.get('user_id'), 0),
                       'final_pick': {'A': side_a, 'B': side_b}.get(pick, 'undecided')})

    world = {
        'schema': SCHEMA, 'key': key, 'engine': engine, 'sides': [side_a, side_b],
        'graph': {'nodes': nodes, 'edges': edges}, 'agents': agents,
        'rounds': [], 'poll': {'question_sha256': hashlib.sha256(poll_question(side_a, side_b).encode()).hexdigest(),
                               'answers': [{'agent': p['agent_id'], 'pick': p['pick'], 'p_a': p['p_a'], 'why': p['why']} for p in
                                           sorted(parsed_poll, key=lambda p: (p['agent_id'] is None, p['agent_id'] if isinstance(p['agent_id'], int) else 0))],
                               **stats},
        'report': {'sections': report_sections[:MAX_SECTIONS]},
        'limits': {'truncated': False, 'events_total': events_total, 'events_failed': events_failed, 'events_kept': 0, 'steps': []},
        'note': 'The poll is a measurement added by ForgeClaw: MiroFish emits no probability. It shows how the seed packet propagated '
                'through simulated personas and is not independent evidence.',
    }

    def assemble(drop_low: bool, text_limit: int, per_round: int | None) -> int:
        kept = 0
        out = []
        for n in sorted(rounds):
            ordered = sorted(rounds[n], key=lambda e: (e['_ts'], e['platform'], e['agent'] if isinstance(e['agent'], int) else -1, e['type']))
            if drop_low:
                ordered = [e for e in ordered if e['type'] in HIGH_SIGNAL]
            if per_round is not None:
                ordered = ordered[:per_round]
            events = [{'agent': e['agent'], 'platform': e['platform'], 'type': e['type'], 'text': e['text'][:text_limit], 'target': e['target']}
                      for e in ordered]
            kept += len(events)
            if events:
                out.append({'n': n, 'hour': hours.get(n, 0), 'events': events})
        world['rounds'] = out
        world['limits']['events_kept'] = kept
        return len(dump_world(world))

    steps = [(False, TEXT_CHARS, None), (True, TEXT_CHARS, None), (True, SHORT_TEXT_CHARS, None)] + \
            [(True, SHORT_TEXT_CHARS, k) for k in (8, 6, 4, 3, 2, 1)]
    for i, step in enumerate(steps):
        size = assemble(*step)
        if size <= max_bytes:
            break
        world['limits']['truncated'] = True
        world['limits']['steps'].append(f'drop_low={step[0]} text<={step[1]} per_round={step[2]} gave {size} bytes')
    if i > 0 or world['limits']['events_kept'] < events_total - events_failed:
        world['limits']['truncated'] = True
    return world


def dump_world(world: dict) -> bytes:
    """The canonical bytes: stable key order, compact, UTF-8. This is what is hashed into the record."""
    return json.dumps(world, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')


# ─── The static preview ──────────────────────────────────────────────────────

_CONTROL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f]')


def _svg_text(value, limit: int) -> str:
    return escape(_CONTROL.sub('', re.sub(r'\s+', ' ', str(value or ''))).strip()[:limit])


def render_svg(world: dict) -> str:
    """A deterministic, self-contained, script-free SVG: one cluster per final pick, dot size by activity, top excerpts as captions."""
    side_a, side_b = world['sides']
    zones = {side_a: (300, 330, COLOR_A), 'undecided': (600, 330, COLOR_UNDECIDED), side_b: (900, 330, COLOR_B)}
    by_zone: dict[str, list[dict]] = {side_a: [], 'undecided': [], side_b: []}
    for agent in world['agents']:
        by_zone.setdefault(agent['final_pick'] if agent['final_pick'] in by_zone else 'undecided', []).append(agent)
    poll = world['poll']
    median = poll.get('median_p_a')
    summary = (f"{len(world['agents'])} agents, {len(world['rounds'])} rounds with events; final poll n={poll['n']}, "
               f"picks {side_a} {poll['picks']['A']} / {side_b} {poll['picks']['B']}"
               + (f", median P({side_a}) {median}" if median is not None else ', no probability parsed'))
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 720" width="1200" height="720" role="img" aria-labelledby="t d">',
        f'<title id="t">{_svg_text(f"MiroFish swarm: {side_a} vs {side_b}", 120)}</title>',
        f'<desc id="d">{_svg_text(summary, 400)}</desc>',
        '<rect width="1200" height="720" fill="#0b0d10"/>',
        f'<text x="600" y="38" text-anchor="middle" font-family="monospace" font-size="20" fill="#e5e7eb">{_svg_text(f"{side_a}  vs  {side_b}", 90)}</text>',
        f'<text x="600" y="62" text-anchor="middle" font-family="monospace" font-size="13" fill="#9ca3af">{_svg_text(summary, 160)}</text>',
        '<text x="600" y="84" text-anchor="middle" font-family="monospace" font-size="11" fill="#6b7280">simulated personas; the poll is a measurement we add, not independent evidence</text>',
    ]
    for name, (cx, cy, color) in zones.items():
        members = by_zone.get(name, [])
        parts.append(f'<text x="{cx}" y="124" text-anchor="middle" font-family="monospace" font-size="15" fill="{color}">'
                     f'{_svg_text(name, 28)} ({len(members)})</text>')
        for i, agent in enumerate(members):
            angle = i * 2.399963229728653
            radius = 26 * math.sqrt(i + 0.5)
            x, y = cx + radius * math.cos(angle), cy + radius * math.sin(angle)
            r = 6 + min(12.0, math.sqrt(agent['activity']) * 2)
            parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="{color}" fill-opacity="0.85">'
                         f'<title>{_svg_text(agent["name"], 60)}: {agent["activity"]} actions</title></circle>')
    names = {a['id']: a['name'] for a in world['agents']}
    spoken = [(e['text'], n['n'], names.get(e['agent'], f"agent {e['agent']}")) for n in world['rounds'] for e in n['events']
              if e['type'] in ('CREATE_POST', 'CREATE_COMMENT', 'QUOTE_POST') and e['text']]
    spoken.sort(key=lambda s: (-len(s[0]), s[1], s[2]))
    parts.append('<text x="60" y="556" font-family="monospace" font-size="12" fill="#6b7280">what they said (longest excerpts)</text>')
    for i, (text, rnd, who) in enumerate(spoken[:5]):
        parts.append(f'<text x="60" y="{580 + i * 24}" font-family="monospace" font-size="13" fill="#d1d5db">'
                     f'R{rnd} {_svg_text(who, 24)}: {_svg_text(text, 100)}</text>')
    if not spoken:
        parts.append('<text x="60" y="580" font-family="monospace" font-size="13" fill="#9ca3af">no posts or comments were recorded</text>')
    parts.append('</svg>')
    svg = '\n'.join(parts)
    if len(svg.encode('utf-8')) > MAX_SVG_BYTES:
        raise ValueError(f'world.svg is {len(svg.encode("utf-8"))} bytes, over the {MAX_SVG_BYTES} cap')
    return svg


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
