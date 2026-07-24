"""The sandbox run contract — the JSON shape passed to the executor subprocess
and back.

This is the seam that stays stable across the M2a → M2b swap: today a stub
executor fills it by static analysis, later a real local-Spark executor fills
the same shape from execution. The backend, the router, and the frontend all
speak only this contract, so swapping the engine underneath changes nothing
above it.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ColumnSchema(BaseModel):
    name: str
    type: str | None = None


class RunRequest(BaseModel):
    """Backend → executor: what to run and the schemas to stand up.

    `schemas` maps a table name to its columns; the executor registers each as
    an *empty* temp view so the notebook's reads resolve without any real data
    moving. It is unused by the stub engine and populated for real in M2b.
    """

    notebook_name: str
    cells: list[str]
    schemas: dict[str, list[ColumnSchema]] = Field(default_factory=dict)


class CellResult(BaseModel):
    index: int
    status: Literal["ok", "error", "skipped"]
    reads: list[str] = Field(default_factory=list)
    writes: list[str] = Field(default_factory=list)
    stdout: str = ""
    error: str | None = None


class RunResult(BaseModel):
    """Executor → backend: the outcome of a sandbox run.

    `saw_credentials` is the safety assertion made visible: the executor reports
    whether any Fabric/Azure credential was reachable from inside the child
    process. It must always be False — the runner scrubs the environment before
    spawning — and surfacing it turns the guarantee into something observable
    rather than merely intended.
    """

    ok: bool
    engine: Literal["stub", "spark"]
    cells: list[CellResult] = Field(default_factory=list)
    reads: list[str] = Field(default_factory=list)
    writes: list[str] = Field(default_factory=list)
    log: list[str] = Field(default_factory=list)
    saw_credentials: bool = False
    error: str | None = None
