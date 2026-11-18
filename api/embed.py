"""POST /api/embed  ->  {"vectors": [[...], ...]}

Vercel Python function. It keeps GEMINI_API_KEY on the server and turns text into
vectors (embeddings), so the browser can search code by meaning. Standard library only.
"""
import json
import math
import os
import re
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse

MAX_TEXTS = 50
MAX_TEXT_CHARS = 1200
MAX_TOTAL_CHARS = 40_000
MAX_BODY = 200_000
PER_MINUTE = 20
_hits = {}  # best-effort limiter; resets when the server instance restarts

_QUOTED = re.compile(r"""(['"])[A-Za-z0-9_\-/+=]{16,}\1""")
_KEYS = re.compile(r"sk_live_\w+|AKIA[0-9A-Z]{16}")


def redact(text):
    """Hide anything that looks like a secret before it leaves our server."""
    return _KEYS.sub("••••••", _QUOTED.sub('"••••••"', text))


def validate(body):
    """Return (texts, kind) for a good request, otherwise None."""
    if not isinstance(body, dict):
        return None
    texts, kind = body.get("texts"), body.get("kind")
    if kind not in ("document", "query"):
        return None
    if not isinstance(texts, list) or not 1 <= len(texts) <= MAX_TEXTS:
        return None
    clean, total = [], 0
    for t in texts:
        if not isinstance(t, str) or not t.strip():
            return None
        t = redact(t[:MAX_TEXT_CHARS])
        total += len(t)
        clean.append(t)
    return (clean, kind) if total <= MAX_TOTAL_CHARS else None


def normalize(vector):
    """Scale a vector to length 1, so similarity is just a dot product."""
    length = math.sqrt(sum(x * x for x in vector)) or 1.0
    return [round(x / length, 4) for x in vector]


def check_origin(origin, host, allowed):
    """Same site is fine; other sites must be listed in ALLOWED_ORIGINS."""
    if not origin or urlparse(origin).netloc == host:
        return True, {}
    if origin in allowed:
        return True, {"Access-Control-Allow-Origin": origin, "Vary": "Origin"}
    return False, {}


def rate_limited(ip, now=None):
    now = time.time() if now is None else now
    recent = [t for t in _hits.get(ip, []) if now - t < 60]
    recent.append(now)
    _hits[ip] = recent
    if len(_hits) > 5000:
        _hits.clear()
    return len(recent) > PER_MINUTE


def embed_texts(texts, kind, key, model, dim):
    task = "RETRIEVAL_QUERY" if kind == "query" else "RETRIEVAL_DOCUMENT"
    requests = []
    for t in texts:
        r = {"model": f"models/{model}", "content": {"parts": [{"text": t}]}, "taskType": task}
        if dim:
            r["outputDimensionality"] = dim
        requests.append(r)
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:batchEmbedContents",
        data=json.dumps({"requests": requests}).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.load(resp)
    vectors = [normalize(e["values"]) for e in data["embeddings"]]
    if len(vectors) != len(texts):
        raise ValueError("unexpected response")
    return vectors


class handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # keep logs free of request data
        pass

    def _send(self, code, obj=None, headers=None):
        body = json.dumps(obj).encode() if obj is not None else b""
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _guard(self):
        allowed = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
        ok, cors = check_origin(self.headers.get("Origin"), self.headers.get("Host"), allowed)
        if not ok:
            self._send(403, {"error": "Not allowed."})
            return None
        return cors

    def do_OPTIONS(self):
        cors = self._guard()
        if cors is None:
            return
        cors.update({"Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600"})
        self._send(204, None, cors)

    def do_GET(self):
        cors = self._guard()
        if cors is not None:
            self._send(405, {"error": "Use POST."}, cors)

    def do_POST(self):
        cors = self._guard()
        if cors is None:
            return
        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            return self._send(503, {"error": "The AI is not set up yet. The site owner needs to add a GEMINI_API_KEY."}, cors)
        ip = (self.headers.get("X-Forwarded-For") or "unknown").split(",")[0].strip()
        if rate_limited(ip):
            return self._send(429, {"error": "Too many requests. Please wait a minute."}, cors)
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if not 0 < length <= MAX_BODY:
            return self._send(413, {"error": "That request was too large or empty."}, cors)
        try:
            body = json.loads(self.rfile.read(length))
        except ValueError:
            body = None
        parsed = validate(body)
        if not parsed:
            return self._send(400, {"error": "That request was not valid."}, cors)
        model = re.sub(r"[^A-Za-z0-9._-]", "", os.environ.get("GEMINI_EMBED_MODEL") or "gemini-embedding-001")
        try:
            dim = int(os.environ.get("EMBED_DIM", "768"))
        except ValueError:
            dim = 768
        try:
            vectors = embed_texts(parsed[0], parsed[1], key, model, dim)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                return self._send(429, {"error": "The free AI limit was reached. Please try again in a minute."}, cors)
            return self._send(502, {"error": "The embedding service had a problem. Check GEMINI_EMBED_MODEL."}, cors)
        except Exception:
            return self._send(504, {"error": "The embedding service took too long. Please try again."}, cors)
        self._send(200, {"vectors": vectors}, cors)
