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

import importlib.util
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

from .protocol import RunRequest, RunResult

_SANDBOX_DIR = Path(__file__).resolve().parent
_CHILD_STUB = _SANDBOX_DIR / "child_stub.py"
_CHILD_SPARK = _SANDBOX_DIR / "child_spark.py"

# The pinned Spark venv lives outside backend/ so uvicorn --reload never watches
# it (local Windows setup). Absent in a container, where PySpark is instead
# installed into the backend's own interpreter — and absent on Vercel/CI, where
# the runner transparently falls back to the stub engine.
_SPARK_VENV_PYTHON = (
    Path(__file__).resolve().parents[3] / "sandbox" / ".venv312" / "Scripts" / "python.exe"
)


def _spark_python() -> str | None:
    """The interpreter that can run the Spark executor, or None.

    Prefers the pinned local venv; otherwise uses the current interpreter when
    PySpark is importable there (the container image installs it that way).
    """
    if _SPARK_VENV_PYTHON.exists():
        return str(_SPARK_VENV_PYTHON)
    if importlib.util.find_spec("pyspark") is not None:
        return sys.executable
    return None

# Benign OS variables the child needs to start Python at all. Everything else —
# crucially every PURVIEW_*/AZURE_* secret — is dropped. Names are matched
# case-insensitively against this set.
_KEEP_ENV = {
    "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP",
    "APPDATA", "LOCALAPPDATA", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
    "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "LANG", "LC_ALL",
    # Needed by Spark in a Linux container (find the JVM, a writable HOME).
    "JAVA_HOME", "SPARK_HOME", "HOME",
}

# Spark cold-start is ~15s; give the whole run generous headroom. The stub is
# near-instant but shares the ceiling.
_TIMEOUT = 240


def _scrubbed_env() -> dict[str, str]:
    return {k: v for k, v in os.environ.items() if k.upper() in _KEEP_ENV}


def spark_available() -> bool:
    return _CHILD_SPARK.exists() and _spark_python() is not None


Engine = str  # "auto" | "spark" | "stub"


def _executor_cmd(request_file: str, engine: Engine) -> tuple[list[str], str]:
    """The command that runs one sandbox request, and the engine it is.

    The Spark executor (pinned venv locally, or the current interpreter in a
    container) when chosen and available; otherwise the stub under the backend
    interpreter. This is the whole M2a → M2b seam.

    The engine is returned alongside the command because every failure path below
    has to name it. Reporting a Spark crash or timeout as `engine="stub"` — which
    is what a hardcoded literal did — sends whoever reads the error to the wrong
    executor entirely.
    """
    spark_python = _spark_python()
    use_spark = spark_python is not None and _CHILD_SPARK.exists() and engine in ("spark", "auto")
    if use_spark:
        return [spark_python, str(_CHILD_SPARK), request_file], "spark"
    return [sys.executable, str(_CHILD_STUB), request_file], "stub"


def _kill_tree(proc: subprocess.Popen) -> None:
    """Kill the child AND everything it spawned.

    `Popen.kill()` reaches only the direct child, and the Spark child's real
    weight is the JVM it starts underneath. Killing just the Python parent on
    timeout therefore left a multi-hundred-megabyte JVM running with nothing
    holding its stdout — one orphan per timed-out run, until the box ran out.
    """
    if sys.platform == "win32":
        # `/T` is the whole point: terminate the tree rooted at this pid.
        subprocess.run(
            ["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True, check=False
        )
    else:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError, OSError):
            pass
    proc.kill()  # Harmless if already dead; guarantees the direct child is gone.


def run_sandbox(req: RunRequest, timeout: int = _TIMEOUT, engine: Engine = "auto") -> RunResult:
    workdir = tempfile.mkdtemp(prefix="lsbx_")
    request_file = Path(workdir) / "request.json"
    request_file.write_text(req.model_dump_json(), encoding="utf-8")
    cmd, ran_as = _executor_cmd(str(request_file), engine)
    try:
        proc = subprocess.Popen(  # noqa: S603 — fixed argv, no shell
            cmd,
            cwd=workdir,
            env=_scrubbed_env(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            # Its own session on POSIX so the whole group can be signalled; on
            # Windows `taskkill /T` walks the tree by pid and needs nothing here.
            start_new_session=sys.platform != "win32",
        )
        try:
            stdout, stderr = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            _kill_tree(proc)
            # Drain after the kill — without this the pipes are never closed and
            # the reader threads keep the handles (and the workdir) alive.
            proc.communicate()
            return RunResult(ok=False, engine=ran_as, error=f"sandbox run exceeded {timeout}s")
    finally:
        # `rmdir` only ever removed an EMPTY directory, so every Spark run — which
        # leaves spark-warehouse/ and metastore_db/ behind — leaked its whole
        # temp tree permanently. Nothing cleaned them up later; this is that
        # "cleaned separately".
        shutil.rmtree(workdir, ignore_errors=True)

    if proc.returncode != 0:
        detail = (stderr or stdout or "executor exited non-zero").strip()
        return RunResult(ok=False, engine=ran_as, error=detail[:1000])
    try:
        return RunResult.model_validate_json(_result_json(stdout))
    except Exception as exc:  # noqa: BLE001
        return RunResult(
            ok=False,
            engine=ran_as,
            error=f"could not parse executor output: {exc}; raw={stdout[:400]!r}",
        )


def _result_json(stdout: str) -> str:
    """The executor's JSON object, ignoring anything the JVM added around it.

    The child writes one JSON object to stdout, but it does not own stdout: the
    Spark JVM writes there too, and on Windows a line like "... has been
    terminated." can land AFTER the result as the session shuts down. Parsing
    the whole stream then fails on trailing characters and a perfectly good run
    is reported as a crash — the intermittent sandbox failures were this.

    So decode the first complete JSON object and ignore the rest, rather than
    requiring the child to have had stdout to itself.
    """
    start = stdout.find("{")
    if start < 0:
        return stdout
    obj, _end = json.JSONDecoder().raw_decode(stdout, start)
    return json.dumps(obj)
