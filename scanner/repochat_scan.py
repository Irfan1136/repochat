#!/usr/bin/env python3
"""RepoChat Scanner: finds risky code in a folder. Standard library only.

Usage:  python scanner/repochat_scan.py [folder] [--fail-on high|medium|low|never] [--json]
Add the comment  repochat-ignore  to a line to skip it.
"""
import argparse
import ast
import json
import os
import re
import sys
from dataclasses import asdict, dataclass

SKIP_DIRS = {".git", "node_modules", "dist", "dist-single", "build", "vendor", "coverage", "__pycache__", ".venv", "venv", ".pytest_cache"}
SKIP_FILE = re.compile(r"\.min\.|lock\.|\.(png|jpe?g|gif|ico|svg|woff2?|zip|pdf)$", re.I)
ENV_FILE = re.compile(r"(^|/)\.env(\.[\w-]+)?$", re.I)
ENV_OK = re.compile(r"example|sample|template", re.I)
MAX_BYTES = 200_000
RANK = {"high": 0, "medium": 1, "low": 2}

RULES = [
    ("high", re.compile(r"""\w*(key|secret|token|passw(or)?d)\w*\s*[:=]\s*['"][A-Za-z0-9_\-/+=]{16,}['"]""", re.I),
     "This looks like a secret written into the code. Move it to an environment variable and replace (rotate) the key."),
    ("high", re.compile(r"sk_live_[0-9A-Za-z]{10,}|AKIA[0-9A-Z]{16}"),
     "This looks like a live payment or cloud key. Revoke it now, then use an environment variable."),
    ("medium", re.compile(r"\beval\s*\("), "eval() runs text as code, which attackers can abuse. Use a safer approach."),
    ("medium", re.compile(r"\.innerHTML\s*=|dangerouslySetInnerHTML"), "Inserting raw HTML can allow XSS attacks. Use textContent, or clean the HTML first."),
    ("low", re.compile(r"catch\s*(\([^)]*\))?\s*\{\s*\}|except\s*:\s*pass"), "The error is ignored silently, which hides bugs. Log it or handle it."),
    ("low", re.compile(r"\b(TODO|FIXME|HACK)\b"), "Unfinished work. Finish it or track it as an issue."),
    ("low", re.compile(r"console\.(log|debug)\("), "Debug output left in the code. Remove it before release."),
]

_QUOTED = re.compile(r"""(['"])[A-Za-z0-9_\-/+=]{16,}\1""")
_KEYS = re.compile(r"sk_live_\w+|AKIA[0-9A-Z]{16}")


@dataclass
class Finding:
    path: str
    line: int
    sev: str
    text: str
    tip: str


def redact(text):
    return _KEYS.sub("••••••", _QUOTED.sub('"••••••"', text))


def python_checks(path, text):
    """Extra checks that only make sense for Python files (uses the ast module)."""
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError):
        return []
    lines = text.splitlines()
    found = []

    def add(node, tip):
        line = getattr(node, "lineno", 1)
        src = lines[line - 1].strip() if 0 < line <= len(lines) else ""
        found.append(Finding(path, line, "medium", redact(src)[:140], tip))

    for node in ast.walk(tree):
        if isinstance(node, ast.ExceptHandler) and node.type is None:
            add(node, "A bare except catches every error, even ones you did not expect. Name the error type.")
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for d in node.args.defaults + [x for x in node.args.kw_defaults if x]:
                if isinstance(d, (ast.List, ast.Dict, ast.Set)):
                    add(d, "A list or dict as a default value is shared between calls. Use None and create it inside.")
        elif isinstance(node, ast.Call):
            if any(k.arg == "shell" and isinstance(k.value, ast.Constant) and k.value.value is True for k in node.keywords):
                add(node, "shell=True lets attackers inject commands. Pass a list of arguments instead.")
            name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", "")
            if name in ("exec", "loads") and (name == "exec" or getattr(getattr(node.func, "value", None), "id", "") == "pickle"):
                add(node, "exec() and pickle.loads() can run attacker code. Avoid them on untrusted data.")
    return found


def scan_text(path, text):
    findings = []
    for number, line in enumerate(text.splitlines(), 1):
        if len(line) > 400 or "repochat-ignore" in line:
            continue
        for sev, pattern, tip in RULES:
            if pattern.search(line):
                findings.append(Finding(path, number, sev, redact(line.strip())[:140], tip))
                break
    if path.endswith(".py"):
        findings += [f for f in python_checks(path, text) if "repochat-ignore" not in text.splitlines()[f.line - 1]]
    seen, unique = set(), []
    for f in findings:  # one finding per line
        if (f.path, f.line) not in seen:
            seen.add((f.path, f.line))
            unique.append(f)
    return unique


def scan_folder(root):
    findings = []
    for folder, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            full = os.path.join(folder, name)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            if ENV_FILE.search(rel) and not ENV_OK.search(rel):
                findings.append(Finding(rel, 1, "high", "(contents hidden)",
                                        "An environment file is committed. Remove it from Git, add it to .gitignore, and replace every key inside it."))
                continue
            try:
                if SKIP_FILE.search(rel) or os.path.getsize(full) > MAX_BYTES:
                    continue
                with open(full, encoding="utf-8", errors="replace") as fh:
                    text = fh.read()
            except OSError:
                continue
            if "\0" not in text:
                findings += scan_text(rel, text)
    return sorted(findings, key=lambda f: (RANK[f.sev], f.path, f.line))


def main(argv=None):
    parser = argparse.ArgumentParser(description="Find risky code in a folder.")
    parser.add_argument("folder", nargs="?", default=".")
    parser.add_argument("--fail-on", choices=["high", "medium", "low", "never"], default="high")
    parser.add_argument("--json", action="store_true", help="print results as JSON")
    args = parser.parse_args(argv)

    findings = scan_folder(args.folder)
    if args.json:
        print(json.dumps([asdict(f) for f in findings], indent=2, ensure_ascii=False))
    else:
        for f in findings:
            print(f"[{f.sev.upper():6}] {f.path}:{f.line}  {f.text}\n         fix: {f.tip}")
        counts = {s: sum(1 for f in findings if f.sev == s) for s in RANK}
        print(f"\n{len(findings)} finding(s): {counts['high']} high, {counts['medium']} medium, {counts['low']} low")
    if args.fail_on == "never":
        return 0
    limit = RANK[args.fail_on]
    return 1 if any(RANK[f.sev] <= limit for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
