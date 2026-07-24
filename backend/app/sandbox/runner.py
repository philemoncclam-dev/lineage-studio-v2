"""Spawn a sandbox executor as an isolated subprocess and collect its result.

The isolation is the substance here:
  - the child runs with a **scrubbed environment** — only benign OS vars survive,
    never a credential — so even if the child tried, it has nothing to
    authenticate with;
  - it runs by absolute path in a **throwaway working directory**, so it cannot
    import the `app` package or find the repo `.env`; and
  - it is bounded by a timeout.

M2a spawns the stub executor under the backend's own interpreter. M2b will swap
`_executor_cmd` for the pinned Spark venv running the Spark executor script —
nothing else in this module, the router, or the frontend changes, because the
JSON contract (protocol.py) is identical.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

from .protocol import RunRequest, RunResult

_CHILD_STUB = Path(__file__).resolve().parent / "child_stub.py"

# Benign OS variables the child needs to start Python at all. Everything else —
# crucially every PURVIEW_*/AZURE_* secret — is dropped. Names are matched
# case-insensitively against this set.
_KEEP_ENV = {
    "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP",
    "APPDATA", "LOCALAPPDATA", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
    "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "LANG", "LC_ALL",
}

_TIMEOUT = 120


def _scrubbed_env() -> dict[str, str]:
    return {k: v for k, v in os.environ.items() if k.upper() in _KEEP_ENV}


def _executor_cmd(request_file: str) -> list[str]:
    """The command that runs one sandbox request.

    M2a: the backend interpreter running the standalone stub by path. M2b will
    return the pinned Spark venv python + the Spark executor script here.
    """
    return [sys.executable, str(_CHILD_STUB), request_file]


def run_sandbox(req: RunRequest, timeout: int = _TIMEOUT) -> RunResult:
    workdir = tempfile.mkdtemp(prefix="lsbx_")
    request_file = Path(workdir) / "request.json"
    request_file.write_text(req.model_dump_json(), encoding="utf-8")
    try:
        proc = subprocess.run(
            _executor_cmd(str(request_file)),
            cwd=workdir,
            env=_scrubbed_env(),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return RunResult(ok=False, engine="stub", error=f"sandbox run exceeded {timeout}s")
    finally:
        request_file.unlink(missing_ok=True)
        try:
            os.rmdir(workdir)
        except OSError:
            pass  # Spark (M2b) will leave a warehouse here; cleaned separately.

    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "executor exited non-zero").strip()
        return RunResult(ok=False, engine="stub", error=detail[:1000])
    try:
        return RunResult.model_validate_json(proc.stdout)
    except Exception as exc:  # noqa: BLE001
        return RunResult(
            ok=False,
            engine="stub",
            error=f"could not parse executor output: {exc}; raw={proc.stdout[:400]!r}",
        )
