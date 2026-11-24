import json
import sys
import threading
import urllib.error
import urllib.request
from http.server import HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
import embed  # noqa: E402

SECRET = "sk_" + "live_" + "a1b2c3d4e5f6g7h8i9"


def test_validate_accepts_good_and_rejects_bad():
    assert embed.validate({"texts": ["hi"], "kind": "query"}) == (["hi"], "query")
    assert embed.validate({"texts": [], "kind": "query"}) is None
    assert embed.validate({"texts": ["hi"], "kind": "other"}) is None
    assert embed.validate({"texts": [1], "kind": "query"}) is None
    assert embed.validate({"texts": ["x"] * 51, "kind": "document"}) is None
    assert embed.validate("nope") is None


def test_validate_hides_secrets():
    texts, _ = embed.validate({"texts": [f'KEY = "{SECRET}"'], "kind": "document"})
    assert SECRET not in texts[0]


def test_normalize_gives_length_one():
    v = embed.normalize([3.0, 4.0])
    assert v == [0.6, 0.8]


def test_origin_rules():
    assert embed.check_origin(None, "a.app", []) == (True, {})
    assert embed.check_origin("https://a.app", "a.app", [])[0]
    ok, cors = embed.check_origin("https://me.github.io", "a.app", ["https://me.github.io"])
    assert ok and cors["Access-Control-Allow-Origin"] == "https://me.github.io"
    assert embed.check_origin("https://evil.example", "a.app", ["https://me.github.io"]) == (False, {})


def test_rate_limit_rules(monkeypatch):
    monkeypatch.delenv("UPSTASH_REDIS_REST_URL", raising=False)
    monkeypatch.setenv("RATE_PER_MINUTE", "3")
    monkeypatch.setenv("DAILY_LIMIT", "5")
    embed._mem.clear()
    assert all(embed.allowed("1.1.1.1", now=100.0)[0] for _ in range(3))
    assert embed.allowed("1.1.1.1", now=101.0) == (False, "minute")
    assert all(embed.allowed("2.2.2.2", now=102.0)[0] for _ in range(2))  # daily total is now 5
    assert embed.allowed("2.2.2.2", now=103.0) == (False, "day")
    assert embed.allowed("1.1.1.1", now=200.0) == (False, "day")  # a new minute does not reset the daily cap


def test_upstash_counts_and_falls_back(monkeypatch):
    monkeypatch.setenv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io")
    monkeypatch.setenv("UPSTASH_REDIS_REST_TOKEN", "t")
    store, calls = {}, []

    def fake(path):
        calls.append(path)
        cmd, _, key = path.partition("/")
        if cmd == "incr":
            store[key] = store.get(key, 0) + 1
            return {"result": store[key]}
        return {"result": 1}

    monkeypatch.setattr(embed, "_upstash", fake)
    assert [embed.count("k:1", 60) for _ in range(3)] == [1, 2, 3]
    assert sum(c.startswith("expire/") for c in calls) == 1  # the timer is set once
    embed._mem.clear()

    def broken(path):
        raise OSError("down")

    monkeypatch.setattr(embed, "_upstash", broken)
    assert embed.count("k:2", 60) == 1 and embed.count("k:2", 60) == 2  # memory takes over


def _post(port, payload, headers=None):
    req = urllib.request.Request(f"http://127.0.0.1:{port}/api/embed", data=json.dumps(payload).encode(),  # repochat-ignore
                                 headers={"Content-Type": "application/json", **(headers or {})}, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)


def test_server_end_to_end(monkeypatch):
    embed._mem.clear()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(embed, "embed_texts", lambda texts, kind, key, model, dim: [[1.0, 0.0] for _ in texts])
    server = HTTPServer(("127.0.0.1", 0), embed.handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    try:
        assert _post(port, {"texts": ["a", "b"], "kind": "document"}) == (200, {"vectors": [[1.0, 0.0], [1.0, 0.0]]})
        assert _post(port, {"texts": [], "kind": "document"})[0] == 400
        assert _post(port, {"texts": ["a"], "kind": "query"}, {"Origin": "https://evil.example"})[0] == 403
        monkeypatch.delenv("GEMINI_API_KEY")
        assert _post(port, {"texts": ["a"], "kind": "query"})[0] == 503
    finally:
        server.shutdown()
