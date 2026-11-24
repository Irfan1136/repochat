"""GitHub helpers for the RepoChat MCP server. Standard library only.

Safety rule: fixes are only ever sent as a NEW branch plus a pull request.
The default branch (main) is never written to, so your main code stays untouched until you merge.
"""
import base64
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.github.com"
_NAME = re.compile(r"^([A-Za-z0-9_.-]{1,39})/([A-Za-z0-9_.-]{1,100})$")


class GitHubError(Exception):
    pass


def parse_repo(text):
    value = text.strip().removeprefix("https://github.com/").rstrip("/").removesuffix(".git")
    m = _NAME.match(value)
    if not m or set(m.group(1)) == {"."} or set(m.group(2)) == {"."}:
        raise ValueError("Use the form owner/repo, for example vercel/next.js")
    return m.group(1), m.group(2)


def _message(error):
    try:
        return json.load(error).get("message", "")
    except Exception:
        return ""


def request(method, path, token=None, body=None):
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "repochat-mcp"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        raise GitHubError(f"GitHub returned {e.code}. {_message(e)}".strip()) from None
    except urllib.error.URLError:
        raise GitHubError("Could not reach GitHub.") from None


def raw(owner, name, branch, path):
    quoted = "/".join(urllib.parse.quote(p) for p in path.split("/"))
    url = f"https://raw.githubusercontent.com/{owner}/{name}/{urllib.parse.quote(branch)}/{quoted}"
    with urllib.request.urlopen(url, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="replace")


def apply_replacement(text, start, end, new_text, expected=None):
    """Replace lines start..end (1-based, inclusive). Keeps the file's line endings."""
    eol = "\r\n" if "\r\n" in text else "\n"
    lines = text.split(eol)
    if not 1 <= start <= end <= len(lines):
        raise ValueError("That line range is outside the file.")
    if expected:
        want = [x.strip() for x in expected.replace("\r\n", "\n").split("\n")]
        if [x.strip() for x in lines[start - 1:end]] != want:
            raise ValueError("The file does not match what you expected at those lines. It may have changed.")
    new_lines = new_text.replace("\r\n", "\n").split("\n") if new_text != "" else []
    return eol.join(lines[:start - 1] + new_lines + lines[end:])


def create_fix_pr(token, repo, path, start, end, new_text, title, body="", expected=None):
    """Open a pull request with the change. Returns the pull request address."""
    if not token:
        raise GitHubError("A GitHub token is needed to open a pull request. Set GITHUB_TOKEN.")
    if ".." in path.split("/") or path.startswith("/"):
        raise ValueError("That file path is not allowed.")
    owner, name = parse_repo(repo)
    base = request("GET", f"/repos/{owner}/{name}", token)["default_branch"]
    quoted = "/".join(urllib.parse.quote(p) for p in path.split("/"))
    current = request("GET", f"/repos/{owner}/{name}/contents/{quoted}?ref={urllib.parse.quote(base)}", token)
    text = base64.b64decode(current["content"]).decode("utf-8")
    updated = apply_replacement(text, start, end, new_text, expected)
    if updated == text:
        raise ValueError("That change would not modify the file.")
    sha = request("GET", f"/repos/{owner}/{name}/git/ref/heads/{urllib.parse.quote(base)}", token)["object"]["sha"]
    branch = f"repochat/fix-{int(time.time()):x}"
    if branch == base:
        raise GitHubError("Refusing to write to the default branch.")
    request("POST", f"/repos/{owner}/{name}/git/refs", token, {"ref": f"refs/heads/{branch}", "sha": sha})
    request("PUT", f"/repos/{owner}/{name}/contents/{quoted}", token,
            {"message": title, "content": base64.b64encode(updated.encode()).decode(), "sha": current["sha"], "branch": branch})
    pr = request("POST", f"/repos/{owner}/{name}/pulls", token,
                 {"title": title, "head": branch, "base": base, "body": body or "Suggested by RepoChat. Please review before merging."})
    return pr["html_url"]
