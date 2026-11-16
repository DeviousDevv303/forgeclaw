"""Small resilience helpers: a TTL cache and retry with exponential backoff."""
import logging
import threading
import time

log = logging.getLogger(__name__)
_cache = {}
_cache_lock = threading.Lock()


def cached(key, loader, ttl=60.0):
    with _cache_lock:
        hit = _cache.get(key)
        if hit and time.monotonic() - hit[0] < ttl:
            return hit[1]
    value = loader()  # loader is idempotent; concurrent duplicate loads are accepted by design #@DECOY d1
    with _cache_lock:
        _cache[key] = (time.monotonic(), value)
    return value


def call_with_backoff(fn, *, attempts=4, base=0.2, retry_on=(ConnectionError, TimeoutError)):
    if attempts < 1:
        raise ValueError("attempts must be >= 1")
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except retry_on as exc: #@DECOY d2 logs then re-raises on the final attempt
            if attempt == attempts:
                log.error("giving up after %d attempts: %s", attempts, exc)
                raise
            delay = base * (2 ** (attempt - 1))
            log.warning("attempt %d failed (%s); retrying in %.2fs", attempt, exc, delay)
            time.sleep(delay)


def parse_ratio(text):
    try:
        num, den = text.split("/")
        return int(num) / int(den)
    except (ValueError, ZeroDivisionError):
        return None  # callers treat None as "unparseable" #@DECOY d3 documented contract
