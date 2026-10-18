"""HTTP helpers: stdlib only, polite retries, a small on-disk cache.

Every external call in the pipeline goes through here so that retry policy,
user agent and caching live in one place."""

import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

UA = "Mozilla/5.0 (X11; Linux x86_64) fpl-dashboard/1.0 (+personal use)"
CACHE_DIR = Path(os.environ.get("FPL_CACHE_DIR", ".cache/http"))


class FetchError(RuntimeError):
    pass


def _cache_file(url):
    return CACHE_DIR / (hashlib.sha256(url.encode()).hexdigest()[:32] + ".bin")


def get(url, headers=None, ttl=0, tries=4, timeout=30, pause=0.0):
    """Return the response body as bytes.

    ttl > 0 serves a cached copy younger than ttl seconds. Retries back off
    exponentially on network errors, 429 and 5xx; other 4xx fail at once."""
    path = _cache_file(url)
    if ttl > 0 and path.exists() and time.time() - path.stat().st_mtime < ttl:
        return path.read_bytes()
    hdrs = {"User-Agent": UA, "Accept": "*/*"}
    hdrs.update(headers or {})
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read()
            if ttl > 0:
                CACHE_DIR.mkdir(parents=True, exist_ok=True)
                path.write_bytes(body)
            if pause:
                time.sleep(pause)
            return body
        except urllib.error.HTTPError as e:
            last = e
            if e.code not in (429, 500, 502, 503, 504):
                break
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            last = e
        time.sleep(min(2 ** attempt, 20))
    raise FetchError(f"{url}: {last}")


def get_json(url, headers=None, ttl=0, **kw):
    hdrs = {"Accept": "application/json"}
    hdrs.update(headers or {})
    return json.loads(get(url, headers=hdrs, ttl=ttl, **kw).decode("utf-8"))


def get_text(url, headers=None, ttl=0, **kw):
    return get(url, headers=headers, ttl=ttl, **kw).decode("utf-8", errors="replace")
