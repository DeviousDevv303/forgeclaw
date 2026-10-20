# ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
# Proprietary source-available license. Commercial use requires written permission. See LICENSE.
"""Deep research evidence gatherer for .github/workflows/deep-research.yml.

Runs several web searches, fetches the result pages server-side (the browser cannot: most sites
refuse cross-origin reads), extracts the main text, and keeps the passages most relevant to the
question. Output is evidence for a model to synthesize, with one numbered entry per source so the
answer can cite [n]. This script never writes an answer itself and never invents a source: every
entry is a page that was actually fetched, and every failure is listed as a failure.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from typing import Callable, Iterable
from urllib.parse import urlsplit, urlunsplit

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


def gather(question: str, queries: list[str], max_sources: int, search: SearchFn, fetch: FetchFn, delay_s: float = 1.0) -> dict:
    started = time.time()
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
    return {
        'question': question, 'queries': queries, 'sources': sources, 'failures': failures,
        'elapsed_seconds': round(time.time() - started, 1),
    }


def to_markdown(report: dict) -> str:
    lines = [f"# Research evidence: {report['question']}", f"Queries: {'; '.join(report['queries'])}", '']
    for s in report['sources']:
        lines += [f"[{s['id']}] {s['title'] or s['url']} ({s['domain']}{', ' + s['date'] if s['date'] else ''})", s['url'], s['excerpt'], '']
    if not report['sources']:
        lines.append('No source could be fetched; there is no evidence to synthesize from.')
    if report['failures']:
        lines.append(f"Not used ({len(report['failures'])}): " + '; '.join((f.get('url') or f.get('query', '')) + ' - ' + f['error'] for f in report['failures'][:8]))
    return '\n'.join(lines)


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
    report = gather(question, queries, max_sources, real_search, real_fetch)
    report['invocation_id'] = os.environ.get('INVOCATION_ID', '')
    report['markdown'] = to_markdown(report)
    with open('research.json', 'w', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False)
    print(report['markdown'][:4000])
    print(f"sources={len(report['sources'])} failures={len(report['failures'])} elapsed={report['elapsed_seconds']}s")
    # An empty evidence set is a failed research run, not a successful one.
    return 0 if report['sources'] else 1


if __name__ == '__main__':
    sys.exit(main())
