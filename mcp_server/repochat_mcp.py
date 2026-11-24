"""RepoChat MCP server: lets an AI assistant (Claude Desktop, Claude Code, ...) scan a repo,
search it, and propose a fix as a pull request. Run:  python mcp_server/repochat_mcp.py

Set GITHUB_TOKEN to a fine-grained token (Contents + Pull requests: read and write, one repo only)
if you want propose_fix_pr. Scanning public repos works without a token.
"""
import os
import re
import sys
from pathlib import Path

try:
    from mcp.server.mcpserver import MCPServer as Server  # mcp 2.x
except ImportError:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP as Server

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "scanner"))
import gh  # noqa: E402
import repochat_scan  # noqa: E402

mcp = Server("repochat")
CODE = re.compile(r"\.(js|jsx|mjs|ts|tsx|py|java|go|rb|php|c|cc|cpp|cs|rs|swift|kt|html|css|sql|sh)$", re.I)
SKIP = re.compile(r"(^|/)(node_modules|dist|build|vendor|\.git|coverage)/|\.min\.|lock\.", re.I)
STOP = {"the", "where", "what", "how", "does", "and", "for", "are", "this", "that", "with", "which", "file", "code"}


def _read_repo(repo, max_files):
    owner, name = gh.parse_repo(repo)
    token = os.environ.get("GITHUB_TOKEN")
    info = gh.request("GET", f"/repos/{owner}/{name}", token)
    branch = info["default_branch"]
    tree = gh.request("GET", f"/repos/{owner}/{name}/git/trees/{branch}?recursive=1", token)["tree"]
    picks = [t for t in tree if t["type"] == "blob" and CODE.search(t["path"]) and not SKIP.search(t["path"]) and t.get("size", 0) < 60000]
    picks.sort(key=lambda t: (t["path"].count("/"), t.get("size", 0)))
    files = []
    for t in picks[: max(1, min(max_files, 80))]:
        try:
            files.append((t["path"], gh.raw(owner, name, branch, t["path"])))
        except Exception:
            continue
    return files


@mcp.tool()
def scan_repo(repo: str, max_files: int = 40) -> str:
    """Scan a public GitHub repo (owner/repo) for risky code such as leaked keys. Read-only."""
    findings = []
    for path, text in _read_repo(repo, max_files):
        findings += repochat_scan.scan_text(path, text)
    findings.sort(key=lambda f: repochat_scan.RANK[f.sev])
    if not findings:
        return "No obvious problems found in the files that were read."
    return "\n".join(f"[{f.sev}] {f.path}:{f.line}  {f.text}\n    fix: {f.tip}" for f in findings[:40])


@mcp.tool()
def find_code(repo: str, question: str) -> str:
    """Find the lines of a public repo that best match a question, using simple keyword search. Read-only."""
    words = [w for w in re.findall(r"[a-z0-9_]{3,}", question.lower()) if w not in STOP]
    if not words:
        return "Ask with at least one specific word, for example 'login' or 'payment'."
    hits = []
    for path, text in _read_repo(repo, 40):
        for number, line in enumerate(text.splitlines(), 1):
            score = sum(w in line.lower() for w in words)
            if score and line.strip() and len(line) < 400:
                hits.append((score, path, number, repochat_scan.redact(line.strip())[:160]))
    hits.sort(key=lambda h: -h[0])
    return "\n".join(f"{p}:{n}  {t}" for _, p, n, t in hits[:8]) or "No matching lines."


@mcp.tool()
def propose_fix_pr(repo: str, path: str, start_line: int, end_line: int, new_text: str, title: str, expected_old_text: str = "") -> str:
    """Open a pull request that replaces lines start_line..end_line of a file with new_text.
    It creates a NEW branch and a pull request. It never changes the default branch.
    Pass expected_old_text (the current lines) so nothing is changed if the file moved on."""
    return "Pull request created: " + gh.create_fix_pr(
        os.environ.get("GITHUB_TOKEN"), repo, path, start_line, end_line, new_text, title, expected=expected_old_text or None)


if __name__ == "__main__":
    mcp.run()
