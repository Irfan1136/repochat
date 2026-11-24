import base64
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "mcp_server"))
import gh  # noqa: E402


def test_parse_repo():
    assert gh.parse_repo("https://github.com/Irfan1136/repochat/") == ("Irfan1136", "repochat")
    assert gh.parse_repo("vercel/next.js.git") == ("vercel", "next.js")
    for bad in ["nope", "a/b/c", "../x", "a/.."]:
        with pytest.raises(ValueError):
            gh.parse_repo(bad)


def test_apply_replacement_and_line_endings():
    assert gh.apply_replacement("a\nb\nc\n", 2, 2, "B") == "a\nB\nc\n"
    assert gh.apply_replacement("a\r\nb\r\nc", 2, 3, "x\ny") == "a\r\nx\r\ny"
    assert gh.apply_replacement("a\nb\nc", 2, 2, "") == "a\nc"  # empty text deletes the lines


def test_apply_replacement_guards():
    with pytest.raises(ValueError):
        gh.apply_replacement("a\nb", 3, 3, "x")
    with pytest.raises(ValueError):
        gh.apply_replacement("a\nb", 2, 2, "x", expected="something else")
    assert gh.apply_replacement("a\n  b", 2, 2, "x", expected="b") == "a\nx"


def _fake_github(monkeypatch, file_text):
    calls = []

    def fake(method, path, token=None, body=None):
        calls.append((method, path, body))
        if method == "GET" and path == "/repos/o/r":
            return {"default_branch": "main"}
        if method == "GET" and "/contents/" in path:
            return {"content": base64.b64encode(file_text.encode()).decode(), "sha": "filesha"}
        if method == "GET" and "/git/ref/" in path:
            return {"object": {"sha": "basesha"}}
        if method == "POST" and path.endswith("/pulls"):
            return {"html_url": "https://github.com/o/r/pull/1"}
        return {}

    monkeypatch.setattr(gh, "request", fake)
    return calls


def test_pull_request_never_writes_to_the_default_branch(monkeypatch):
    calls = _fake_github(monkeypatch, "keep\nSECRET=1\nkeep")
    url = gh.create_fix_pr("tok", "o/r", "src/a.py", 2, 2, "SECRET=os.environ['X']", "Fix secret", expected="SECRET=1")  # repochat-ignore
    assert url == "https://github.com/o/r/pull/1"
    put = next(c for c in calls if c[0] == "PUT")
    assert put[2]["branch"].startswith("repochat/fix-") and put[2]["branch"] != "main"
    assert base64.b64decode(put[2]["content"]).decode() == "keep\nSECRET=os.environ['X']\nkeep"  # repochat-ignore
    ref = next(c for c in calls if c[0] == "POST" and c[1].endswith("/git/refs"))
    assert ref[2]["ref"].startswith("refs/heads/repochat/fix-")
    assert next(c for c in calls if c[1].endswith("/pulls"))[2]["base"] == "main"


def test_pull_request_refuses_bad_input(monkeypatch):
    _fake_github(monkeypatch, "a\nb")
    with pytest.raises(gh.GitHubError):
        gh.create_fix_pr("", "o/r", "a.py", 1, 1, "x", "t")
    with pytest.raises(ValueError):
        gh.create_fix_pr("tok", "o/r", "../etc/passwd", 1, 1, "x", "t")
    with pytest.raises(ValueError):
        gh.create_fix_pr("tok", "o/r", "a.py", 1, 1, "a", "t")  # no change
    with pytest.raises(ValueError):
        gh.create_fix_pr("tok", "o/r", "a.py", 1, 1, "x", "t", expected="different")


def test_server_registers_three_tools():
    pytest.importorskip("mcp")
    import asyncio
    import server

    tools = asyncio.run(server.mcp.list_tools())
    assert sorted(t.name for t in tools) == ["find_code", "propose_fix_pr", "scan_repo"]
