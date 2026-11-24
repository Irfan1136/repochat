import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scanner"))
import repochat_scan as rs  # noqa: E402

# Fake secrets are built at run time so this test file never looks like a real leak.
FAKE_STRIPE = "sk_" + "live_" + "a1b2c3d4e5f6g7h8i9"


def test_flags_and_hides_secret():
    f = rs.scan_text("a.js", f'const API_KEY = "{FAKE_STRIPE}"')
    assert f and f[0].sev == "high"
    assert FAKE_STRIPE not in f[0].text


def test_flags_stripe_key_without_variable_name():
    assert rs.scan_text("a.py", f"x = '{FAKE_STRIPE}'")[0].sev == "high"


def test_clean_code_has_no_findings():
    assert rs.scan_text("a.js", "const total = items.length") == []


def test_ignore_marker():
    assert rs.scan_text("a.js", f'const T = "{FAKE_STRIPE}" // repochat-ignore') == []


def test_python_checks():
    code = "def f(x=[]):\n    try:\n        pass\n    except:\n        pass\n"
    tips = " ".join(f.tip for f in rs.scan_text("m.py", code))
    assert "shared between calls" in tips and "bare except" in tips


def test_shell_true_and_eval():  # repochat-ignore
    f = rs.scan_text("m.py", "import subprocess\nsubprocess.run(cmd, shell=True)\nresult = eval(data)\n")  # repochat-ignore
    assert {x.line for x in f} == {2, 3}


def test_bad_python_does_not_crash():
    assert rs.scan_text("m.py", "def broken(:\n") == []


def test_folder_scan_env_files(tmp_path):
    (tmp_path / ".env").write_text("SECRET=1")
    (tmp_path / ".env.example").write_text("SECRET=")
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "node_modules" / "x.js").write_text("eval(x)")  # repochat-ignore
    found = rs.scan_folder(str(tmp_path))
    assert [f.path for f in found] == [".env"]


def test_exit_codes(tmp_path):
    (tmp_path / "a.js").write_text("console.log(1)")  # repochat-ignore
    assert rs.main([str(tmp_path)]) == 0
    assert rs.main([str(tmp_path), "--fail-on", "low"]) == 1
    (tmp_path / "b.js").write_text(f'const KEY = "{FAKE_STRIPE}"')
    assert rs.main([str(tmp_path)]) == 1
    assert rs.main([str(tmp_path), "--fail-on", "never"]) == 0
