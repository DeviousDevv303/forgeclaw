# ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
# Proprietary source-available license. Commercial use requires written permission. See LICENSE.
"""Deep research evidence gatherer for .github/workflows/deep-research.yml.

Runs several web searches, fetches the result pages server-side (the browser cannot: most sites
refuse cross-origin reads), extracts the main text, and keeps the passages most relevant to the
question. Output is evidence for a model to synthesize, with one numbered entry per source so the
answer can cite [n]. This script never writes an answer itself and never invents a source: every
entry is a page that was actually fetched, and every failure is listed as a failure.

When the caller supplies sentiment subjects (a matchup/event plus the two sides), the run ALSO
fans out to community sentiment lanes — Reddit (public JSON, no credentials), X via the xAI API
(only when XAI_API_KEY is configured), and Facebook via the Graph API (only when
FACEBOOK_ACCESS_TOKEN is configured). Every run reports a per-lane manifest: each lane is RAN
(with item count and as-of time), NOT CONFIGURED, or FAILED (with the cause). A lane that did not
run is named in the output, never silently absent: a recommendation built on this research must
be able to say "forum layer missing: <lane> — <reason>" instead of pretending the scan happened.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from typing import Callable, Iterable
from urllib.parse import quote, urlencode, urlsplit, urlunsplit

MAX_QUERIES = 6
MAX_SOURCES_LIMIT = 15
PER_DOMAIN = 2
EXCERPT_CHARS = 2400
FETCH_TIMEOUT_S = 15
MAX_PAGE_BYTES = 3_000_000
STOPWORDS = set('the a an and or of to in on for with is are was were be by as at from that this it what which how why who when does do can'.split())

SearchFn = Callable[[str, int], list]
FetchFn = Callable[[str], tuple]


def normalize_url(url: str) -> str:
    parts = urlsplit(url.strip())
    query = '&'.join(p for p in parts.query.split('&') if p and not p.lower().startswith(('utm_', 'fbclid', 'gclid')))
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip('/') or '/', query, ''))


def domain(url: str) -> str:
    host = urlsplit(url).netloc.lower()
    return host[4:] if host.startswith('www.') else host


def keywords(text: str) -> list[str]:
    return [w for w in re.findall(r'[a-z0-9][a-z0-9+#.-]*', text.lower()) if len(w) > 2 and w not in STOPWORDS]


def best_passages(text: str, terms: Iterable[str], limit: int = EXCERPT_CHARS) -> str:
    """Highest-scoring paragraphs for the question, kept in document order, within the limit."""
    terms = set(terms)
    paragraphs = [p.strip() for p in re.split(r'\n\s*\n|\n', text) if len(p.strip()) > 40]
    if not paragraphs:
        return text.strip()[:limit]
    scored = []
    for index, para in enumerate(paragraphs):
        words = keywords(para)
        hits = sum(1 for w in words if w in terms)
        scored.append((hits / (len(words) ** 0.5 or 1), index, para))
    chosen, used = [], 0
    for score, index, para in sorted(scored, key=lambda s: (-s[0], s[1])):
        if used + len(para) > limit and chosen:
            continue
        chosen.append((index, para[:limit]))
        used += min(len(para), limit)
        if used >= limit:
            break
    return '\n'.join(p for _, p in sorted(chosen))


def collect_candidates(queries: list[str], search: SearchFn, max_sources: int) -> tuple[list[dict], list[dict]]:
    """Unique result URLs across queries, at most PER_DOMAIN per site so one site cannot dominate."""
    seen, per_domain, out, failures = set(), {}, [], []
    for query in queries:
        try:
            hits = search(query, 10) or []
        except Exception as error:  # noqa: BLE001 - a failed query is reported, the others continue
            failures.append({'query': query, 'error': f'{type(error).__name__}: {error}'[:300]})
            continue
        for hit in hits:
            url = (hit.get('href') or hit.get('url') or '').strip()
            if not url.startswith(('http://', 'https://')):
                continue
            key = normalize_url(url)
            site = domain(url)
            if key in seen or per_domain.get(site, 0) >= PER_DOMAIN:
                continue
            seen.add(key)
            per_domain[site] = per_domain.get(site, 0) + 1
            out.append({'url': url, 'title': (hit.get('title') or '').strip(), 'snippet': (hit.get('body') or '').strip(), 'query': query})
    return out[: max_sources * 2], failures  # fetch extra: some pages will fail


def gather(question: str, queries: list[str], max_sources: int, search: SearchFn, fetch: FetchFn, delay_s: float = 1.0,
           sentiment: dict | None = None, config: dict | None = None, http_get: HttpGet | None = None,
           http_post: HttpPost | None = None, now_iso: Callable[[], str] | None = None) -> dict:
    started = time.time()
    now_iso = now_iso or utc_now_iso
    queries = [q.strip() for q in queries if q.strip()][:MAX_QUERIES] or [question]
    max_sources = max(1, min(int(max_sources), MAX_SOURCES_LIMIT))
    terms = keywords(question + ' ' + ' '.join(queries))
    candidates, failures = collect_candidates(queries, lambda q, n: (time.sleep(delay_s) if delay_s else None) or search(q, n), max_sources)
    sources = []
    for cand in candidates:
        if len(sources) >= max_sources:
            break
        try:
            title, text, date = fetch(cand['url'])
        except Exception as error:  # noqa: BLE001
            failures.append({'url': cand['url'], 'error': f'{type(error).__name__}: {error}'[:300]})
            continue
        text = (text or '').strip()
        if len(text) < 200:
            failures.append({'url': cand['url'], 'error': 'no readable main text (script-rendered, blocked, or not an article)'})
            continue
        sources.append({
            'id': len(sources) + 1, 'url': cand['url'], 'domain': domain(cand['url']),
            'title': title or cand['title'], 'date': date or '', 'query': cand['query'],
            'chars': len(text), 'excerpt': best_passages(text, terms),
        })
    community_lanes, sentiment_block = build_sentiment(
        sentiment, config or {}, http_get or real_http_get, http_post or real_http_post, delay_s, now_iso)
    web_lane = _lane('web', 'Web search', 'ran' if sources else 'failed', len(sources), now_iso,
                     reason='' if sources else 'no source could be fetched')
    report = {
        'question': question, 'queries': queries, 'sources': sources, 'failures': failures,
        'elapsed_seconds': round(time.time() - started, 1),
        'lanes': [web_lane, *community_lanes],
        'sentiment_requested': sentiment is not None,
    }
    if sentiment_block is not None:
        report['sentiment'] = sentiment_block
    return report


# ─── Community sentiment lanes ───────────────────────────────────────────────
# Three lanes fan out alongside the web search when a run carries sentiment subjects. Reddit is a
# public read (no credentials). X goes through the xAI API and only exists when a key is
# configured; Facebook goes through the Graph API and only exists when a token is configured.
# Nothing here invents content: an item is a post or comment that was actually returned by the
# source, kept with its URL, and a lane that cannot run says so in the manifest with its reason.

HttpGet = Callable[[str, dict], tuple]   # (url, headers) -> (http_status, parsed_json_or_None)
HttpPost = Callable[[str, dict, dict], tuple]  # (url, headers, json_body) -> (http_status, parsed_json_or_None)

REDDIT_SUBREDDITS = ('MMA', 'ufc')
REDDIT_POSTS_PER_SUB = 4        # search hits kept per subreddit
REDDIT_COMMENT_POSTS_PER_SUB = 3  # of those, how many get their comments read (the picks live there)
REDDIT_COMMENTS_PER_POST = 8
REDDIT_MAX_ITEMS = 80
LANE_DELAY_S = 1.1  # public Reddit asks unauthenticated clients to stay near 1 request/second

XAI_API_URL = 'https://api.x.ai/v1/responses'
XAI_MODEL = 'grok-4'
XAI_MAX_ITEMS = 10
X_SEARCH_CONTRACT = 'xai-x-search-json-v1'  # the model must answer with exactly a JSON list of {"text", "url"}

FACEBOOK_GRAPH_URL = 'https://graph.facebook.com/v21.0'
FACEBOOK_MAX_PAGES = 3
FACEBOOK_POSTS_PER_PAGE = 5

# Lean counting rule (deterministic; the stored items reproduce the stored lean exactly):
# an item is pick-bearing for a side when it mentions that side — by surname or first name —
# and does not mention the other side at all. A name token shared by both sides counts for
# neither. Shares are percentages of pick-bearing items, not of all items.
LEAN_METHOD = 'exclusive-name-mention-v1'


class LaneError(Exception):
    """A lane ran and failed; the message is the cause the manifest reports."""


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _lane(lane_id: str, label: str, status: str, items: int, now_iso: Callable[[], str], reason: str = '', detail: str = '') -> dict:
    entry = {'id': lane_id, 'label': label, 'status': status, 'items': items, 'as_of': now_iso(), 'reason': reason}
    if detail:
        entry['detail'] = detail
    return entry


def _get_json(http_get: HttpGet, url: str, headers: dict, cache: dict) -> object:
    if url in cache:
        return cache[url]
    try:
        status, data = http_get(url, headers)
    except Exception as error:  # noqa: BLE001 - a transport failure is a lane failure, never a run failure
        raise LaneError(f'{type(error).__name__}: {error}'[:300]) from error
    if status != 200:
        raise LaneError(f'HTTP {status}')
    if not isinstance(data, (dict, list)):
        raise LaneError(f'HTTP {status} but the response was not JSON')
    cache[url] = data
    return data


def reddit_lane(subject_query: str, http_get: HttpGet, delay_s: float, now_iso: Callable[[], str]) -> tuple[dict, list[dict]]:
    """Public subreddit search + top comments. Items keep the exact post/comment text and URL."""
    headers = {'User-Agent': 'ForgeClawResearch/1.0 (deep-research sentiment lane; +https://github.com/DeviousDevv303/forgeclaw)'}
    cache: dict = {}
    items: list[dict] = []
    failed_parts = []
    for sub in REDDIT_SUBREDDITS:
        if delay_s:
            time.sleep(delay_s)
        search_url = f'https://www.reddit.com/r/{sub}/search.json?' + urlencode({
            'q': subject_query, 'restrict_sr': '1', 'sort': 'relevance', 't': 'year', 'limit': REDDIT_POSTS_PER_SUB,
        })
        try:
            data = _get_json(http_get, search_url, headers, cache)
            posts = [c.get('data') or {} for c in (data.get('data') or {}).get('children') or [] if c.get('kind') == 't3']
        except LaneError as error:
            failed_parts.append(f'r/{sub} search failed ({error})')
            continue
        kept = []
        for post in posts:
            title = (post.get('title') or '').strip()
            permalink = post.get('permalink') or ''
            if not title or not permalink:
                continue
            text = title + (f"\n{post['selftext'].strip()}" if (post.get('selftext') or '').strip() else '')
            kept.append({'lane': 'reddit', 'kind': 'post', 'text': text[:1000],
                         'url': f'https://www.reddit.com{permalink}', 'score': post.get('score')})
            items.append(kept[-1])
        for post in sorted(posts, key=lambda p: p.get('score') or 0, reverse=True)[:REDDIT_COMMENT_POSTS_PER_SUB]:
            post_id = post.get('id')
            if not post_id:
                continue
            if delay_s:
                time.sleep(delay_s)
            comments_url = f'https://www.reddit.com/comments/{post_id}.json?' + urlencode({'limit': REDDIT_COMMENTS_PER_POST, 'sort': 'top'})
            try:
                pair = _get_json(http_get, comments_url, headers, cache)
                children = (pair[1].get('data') or {}).get('children') or [] if isinstance(pair, list) and len(pair) > 1 else []
            except LaneError as error:
                failed_parts.append(f'comments for post {post_id} failed ({error})')
                continue
            for child in children:
                if child.get('kind') != 't1':
                    continue
                body = ((child.get('data') or {}).get('body') or '').strip()
                permalink = (child.get('data') or {}).get('permalink') or ''
                if not body or not permalink:
                    continue
                items.append({'lane': 'reddit', 'kind': 'comment', 'text': body[:1000],
                              'url': f'https://www.reddit.com{permalink}', 'score': (child.get('data') or {}).get('score')})
        if len(items) >= REDDIT_MAX_ITEMS:
            break
    items = items[:REDDIT_MAX_ITEMS]
    if not items and failed_parts:
        return _lane('reddit', 'Reddit', 'failed', 0, now_iso, reason='; '.join(failed_parts)[:300]), []
    detail = '; '.join(failed_parts)[:300] if failed_parts else ''
    return _lane('reddit', 'Reddit', 'ran', len(items), now_iso, detail=detail), items


def _xai_output_text(data: object) -> str:
    for block in (data or {}).get('output') or []:
        if block.get('type') != 'message':
            continue
        for part in block.get('content') or []:
            if part.get('type') == 'output_text' and part.get('text'):
                return str(part['text'])
    return ''


def x_lane(subject_query: str, api_key: str, http_post: HttpPost, now_iso: Callable[[], str]) -> tuple[dict, list[dict]]:
    """X through the xAI API's X-search tool. No key -> the lane does not exist, and says so."""
    if not api_key:
        return _lane('x', 'X', 'not_configured', 0, now_iso,
                     reason='no xAI API key configured (repository secret XAI_API_KEY is not set); the X lane needs it for X search'), []
    prompt = (
        f'Use X search to find recent public posts on X about: {subject_query}. '
        f'Return ONLY a JSON array of up to {XAI_MAX_ITEMS} objects, each {{"text": the post\'s exact text, "url": the post\'s URL}}. '
        'No commentary, no markdown, nothing outside the JSON array.'
    )
    body = {'model': XAI_MODEL, 'input': prompt, 'tools': [{'type': 'x_search'}]}
    try:
        status, data = http_post(XAI_API_URL, {'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}, body)
    except Exception as error:  # noqa: BLE001 - the lane reports its failure, the run continues
        return _lane('x', 'X', 'failed', 0, now_iso, reason=f'{type(error).__name__}: {error}'[:300]), []
    if status != 200:
        return _lane('x', 'X', 'failed', 0, now_iso, reason=f'xAI API answered HTTP {status}'), []
    raw = _xai_output_text(data).strip()
    if raw.startswith('```'):
        raw = re.sub(r'^```(?:json)?\s*|\s*```$', '', raw).strip()
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        parsed = None
    if not isinstance(parsed, list):
        return _lane('x', 'X', 'failed', 0, now_iso,
                     reason=f'xAI answer did not match the extraction contract ({X_SEARCH_CONTRACT}: a JSON list of {{"text", "url"}})'), []
    items = []
    for entry in parsed:
        if not isinstance(entry, dict):
            continue
        text = str(entry.get('text') or '').strip()
        url = str(entry.get('url') or '').strip()
        if text and re.match(r'^https://(www\.)?(x\.com|twitter\.com)/[^/]+/status/\d+', url):
            items.append({'lane': 'x', 'kind': 'post', 'text': text[:1000], 'url': url, 'extraction': X_SEARCH_CONTRACT})
    return _lane('x', 'X', 'ran', len(items), now_iso), items[:XAI_MAX_ITEMS]


def facebook_lane(subject_query: str, access_token: str, http_get: HttpGet, now_iso: Callable[[], str]) -> tuple[dict, list[dict]]:
    """Facebook through the Graph API. The Graph API has no unauthenticated read path, so without
    a token the lane reports NOT CONFIGURED — there is no lawful path to invent here."""
    if not access_token:
        return _lane('facebook', 'Facebook', 'not_configured', 0, now_iso,
                     reason='Facebook Graph API requires an access token and ForgeClaw holds none (repository secret FACEBOOK_ACCESS_TOKEN is not set); the Graph API offers no unauthenticated read path'), []

    def graph_error(data: object) -> str:
        if isinstance(data, dict) and isinstance(data.get('error'), dict):
            return str(data['error'].get('message') or 'unknown Graph API error')[:240]
        return ''

    search_url = f"{FACEBOOK_GRAPH_URL}/search?" + urlencode({
        'q': subject_query, 'type': 'page', 'fields': 'id,name', 'limit': FACEBOOK_MAX_PAGES, 'access_token': access_token,
    })
    try:
        status, data = http_get(search_url, {})
    except Exception as error:  # noqa: BLE001 - the lane reports its failure, the run continues
        return _lane('facebook', 'Facebook', 'failed', 0, now_iso, reason=f'{type(error).__name__}: {error}'[:300]), []
    if graph_error(data):
        return _lane('facebook', 'Facebook', 'failed', 0, now_iso, reason=f'Graph API error: {graph_error(data)}'), []
    if status != 200 or not isinstance(data, dict):
        return _lane('facebook', 'Facebook', 'failed', 0, now_iso, reason=f'Graph page search answered HTTP {status}'), []
    items: list[dict] = []
    failures = []
    for page in (data.get('data') or [])[:FACEBOOK_MAX_PAGES]:
        page_id = str(page.get('id') or '')
        if not page_id:
            continue
        posts_url = f"{FACEBOOK_GRAPH_URL}/{quote(page_id, safe='')}/posts?" + urlencode({
            'fields': 'message,permalink_url,created_time', 'limit': FACEBOOK_POSTS_PER_PAGE, 'access_token': access_token,
        })
        try:
            pstatus, pdata = http_get(posts_url, {})
        except Exception as error:  # noqa: BLE001 - one page failing does not fail pages already read
            failures.append(f'page {page_id}: {type(error).__name__}'[:120])
            continue
        if pstatus != 200 or not isinstance(pdata, dict):
            failures.append(f'page {page_id}: HTTP {pstatus}'[:120])
            continue
        for post in pdata.get('data') or []:
            text = (post.get('message') or '').strip()
            url = (post.get('permalink_url') or '').strip()
            if text and url:
                items.append({'lane': 'facebook', 'kind': 'post', 'text': text[:1000], 'url': url})
    detail = '; '.join(failures)[:300] if failures else ''
    return _lane('facebook', 'Facebook', 'ran', len(items), now_iso, detail=detail), items


def _name_tokens(name: str) -> set[str]:
    parts = [p for p in re.findall(r"[a-z][a-z'’-]*", name.lower()) if len(p) >= 3]
    return set(parts)


def compute_lean(items: list[dict], sides: list[str]) -> dict | None:
    """The crowd's lean by the LEAN_METHOD counting rule. Pure: the stored items reproduce it."""
    if len(sides) != 2:
        return None
    token_sets = [_name_tokens(s) for s in sides]
    shared = token_sets[0] & token_sets[1]
    token_sets = [t - shared for t in token_sets]
    counts = [0, 0]
    for item in items:
        text = (item.get('text') or '').lower()
        mentioned = [any(re.search(rf'(?<![a-z]){re.escape(tok)}(?![a-z])', text) for tok in toks) if toks else False
                     for toks in token_sets]
        if mentioned[0] != mentioned[1]:
            counts[0 if mentioned[0] else 1] += 1
    bearing = counts[0] + counts[1]
    shares = [round(100 * c / bearing, 1) if bearing else None for c in counts]
    return {'method': LEAN_METHOD, 'sides': list(sides), 'pick_bearing': bearing, 'counts': counts, 'share_pct': shares}


def build_sentiment(sentiment: dict | None, config: dict, http_get, http_post,
                    delay_s: float, now_iso: Callable[[], str]) -> tuple[list[dict], dict | None]:
    """Run the three community lanes (or explain, per lane, why each did not run).

    Returns (lane_manifest_entries, sentiment_block_or_None). The block exists only when the
    caller supplied sentiment subjects; the manifest entries exist on every run, so a missing
    forum layer is always named, never silently absent.
    """
    if sentiment is None:
        reason = 'no sentiment subjects were supplied for this run'
        return [
            _lane('reddit', 'Reddit', 'not_configured', 0, now_iso, reason=reason),
            _lane('x', 'X', 'not_configured', 0, now_iso, reason=reason),
            _lane('facebook', 'Facebook', 'not_configured', 0, now_iso, reason=reason),
        ], None
    subject_query = sentiment['query']
    lanes: list[dict] = []
    items: list[dict] = []
    reddit, reddit_items = reddit_lane(subject_query, http_get, delay_s, now_iso)
    lanes.append(reddit)
    items += reddit_items
    x, x_items = x_lane(subject_query, (config.get('xai_api_key') or '').strip(), http_post, now_iso)
    lanes.append(x)
    items += x_items
    facebook, facebook_items = facebook_lane(subject_query, (config.get('facebook_access_token') or '').strip(), http_get, now_iso)
    lanes.append(facebook)
    items += facebook_items
    block = {'sides': list(sentiment.get('sides') or []), 'items': items, 'lean': compute_lean(items, list(sentiment.get('sides') or []))}
    return lanes, block


def to_markdown(report: dict) -> str:
    lines = [f"# Research evidence: {report['question']}", f"Queries: {'; '.join(report['queries'])}", '']
    for s in report['sources']:
        lines += [f"[{s['id']}] {s['title'] or s['url']} ({s['domain']}{', ' + s['date'] if s['date'] else ''})", s['url'], s['excerpt'], '']
    if not report['sources']:
        lines.append('No source could be fetched; there is no evidence to synthesize from.')
    lanes = report.get('lanes') or []
    if lanes:
        lines += ['', '## Source lanes']
        for lane in lanes:
            state = {'ran': f"ran — {lane['items']} item(s)", 'not_configured': 'NOT CONFIGURED', 'failed': 'FAILED'}[lane['status']]
            suffix = f" — {lane['reason']}" if lane.get('reason') else ''
            detail = f" ({lane['detail']})" if lane.get('detail') else ''
            lines.append(f"- {lane['label']}: {state}{suffix}{detail} (as of {lane.get('as_of', '')})")
        if report.get('sentiment_requested'):
            for lane in lanes:
                if lane['id'] != 'web' and lane['status'] != 'ran':
                    lines.append(f"forum layer missing: {lane['label']} — {lane.get('reason') or lane['status']}")
    sentiment = report.get('sentiment')
    if sentiment:
        lines += ['', '## Community sentiment']
        lean = sentiment.get('lean')
        if lean:
            counts = '; '.join(f"{side}: {count} pick-bearing item(s)" + (f" ({share}%)" if share is not None else '')
                               for side, count, share in zip(lean['sides'], lean['counts'], lean['share_pct']))
            lines.append(f"Lean ({lean['method']}, {lean['pick_bearing']} pick-bearing of {len(sentiment['items'])} item(s)): {counts}")
        elif sentiment.get('sides'):
            lines.append(f"No lean: the counting rule needs exactly two sides (got {len(sentiment['sides'])}).")
        for item in sentiment['items'][:20]:
            lines.append(f"- [{item['lane']}] {item['text'][:300]} — {item['url']}")
        if len(sentiment['items']) > 20:
            lines.append(f"({len(sentiment['items']) - 20} more sentiment item(s) in the JSON record)")
    if report['failures']:
        lines.append(f"Not used ({len(report['failures'])}): " + '; '.join((f.get('url') or f.get('query', '')) + ' - ' + f['error'] for f in report['failures'][:8]))
    return '\n'.join(lines)


def real_http_get(url: str, headers: dict) -> tuple:
    import httpx
    merged = {'User-Agent': 'ForgeClawResearch/1.0 (deep-research; +https://github.com/DeviousDevv303/forgeclaw)', **(headers or {})}
    with httpx.Client(follow_redirects=True, timeout=FETCH_TIMEOUT_S, headers=merged) as client:
        res = client.get(url)
    try:
        return res.status_code, res.json()
    except ValueError:
        return res.status_code, None


def real_http_post(url: str, headers: dict, body: dict) -> tuple:
    import httpx
    with httpx.Client(follow_redirects=True, timeout=30, headers=headers or {}) as client:
        res = client.post(url, json=body)
    try:
        return res.status_code, res.json()
    except ValueError:
        return res.status_code, None


def real_search(query: str, count: int) -> list:
    from ddgs import DDGS
    with DDGS() as client:
        return list(client.text(query, max_results=count))


def real_fetch(url: str) -> tuple:
    import httpx
    import trafilatura
    headers = {'User-Agent': 'Mozilla/5.0 (compatible; ForgeClawResearch/1.0; +https://github.com/DeviousDevv303/forgeclaw)'}
    with httpx.Client(follow_redirects=True, timeout=FETCH_TIMEOUT_S, headers=headers) as client:
        with client.stream('GET', url) as res:
            res.raise_for_status()
            kind = res.headers.get('content-type', '')
            if 'html' not in kind and 'text' not in kind:
                raise ValueError(f'not a web page ({kind or "unknown type"})')
            body = b''
            for chunk in res.iter_bytes():
                body += chunk
                if len(body) > MAX_PAGE_BYTES:
                    break
    html = body.decode('utf-8', errors='replace')
    meta = trafilatura.extract_metadata(html)
    text = trafilatura.extract(html, include_comments=False, include_tables=True, favor_precision=True) or ''
    return (getattr(meta, 'title', '') or '', text, getattr(meta, 'date', '') or '')


def main() -> int:
    question = os.environ.get('QUESTION', '').strip()
    if not question:
        print('::error title=deep-research::question is required')
        return 1
    queries = os.environ.get('QUERIES', '').splitlines()
    try:
        max_sources = int(os.environ.get('MAX_SOURCES', '8'))
    except ValueError:
        max_sources = 8
    # Sentiment subjects are optional; when a query is supplied the three community lanes run (or
    # report why they cannot) alongside the web search. Sides arrive as "Name A|Name B".
    sentiment = None
    sentiment_query = os.environ.get('SENTIMENT_QUERY', '').strip()
    if sentiment_query:
        sides = [s.strip() for s in os.environ.get('SENTIMENT_SIDES', '').split('|') if s.strip()]
        sentiment = {'query': sentiment_query, 'sides': sides}
    config = {
        'xai_api_key': os.environ.get('XAI_API_KEY', ''),
        'facebook_access_token': os.environ.get('FACEBOOK_ACCESS_TOKEN', ''),
    }
    report = gather(question, queries, max_sources, real_search, real_fetch,
                    sentiment=sentiment, config=config)
    report['invocation_id'] = os.environ.get('INVOCATION_ID', '')
    report['markdown'] = to_markdown(report)
    with open('research.json', 'w', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False)
    print(report['markdown'][:4000])
    lane_summary = ' '.join(f"{lane['id']}={lane['status']}({lane['items']})" for lane in report.get('lanes') or [])
    print(f"sources={len(report['sources'])} failures={len(report['failures'])} elapsed={report['elapsed_seconds']}s lanes: {lane_summary}")
    # An empty evidence set is a failed research run, not a successful one.
    return 0 if report['sources'] else 1


if __name__ == '__main__':
    sys.exit(main())
