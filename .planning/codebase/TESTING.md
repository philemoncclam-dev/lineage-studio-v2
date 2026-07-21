# Testing Patterns

**Analysis Date:** 2026-07-20

## Test Framework

**Runner:**
- Pytest v8.3+ (backend only)
- Config: `pytest.ini` in repo root under `backend/`
- Frontend: No test framework configured (not yet implemented)

**Assertion Library:**
- Python: Built-in `assert` statements
- No pytest plugins or custom assertion helpers

**Run Commands:**
```bash
# Run all backend tests
cd backend
pytest

# Run specific test file
pytest tests/test_parser.py

# Run with verbose output
pytest -v

# Run a specific test function
pytest tests/test_api.py::test_health
```

## Test File Organization

**Location:**
- Backend: `backend/tests/` directory, parallel to `backend/app/`
- Frontend: Not yet implemented

**Naming:**
- `test_*.py` for test modules (e.g., `test_parser.py`, `test_api.py`)
- `conftest.py` for shared fixtures

**Structure:**
```
backend/
├── app/
│   ├── models.py
│   ├── parser.py
│   └── ...
└── tests/
    ├── conftest.py          # Shared fixtures
    ├── test_api.py          # HTTP-level endpoint tests
    ├── test_parser.py       # Static parser tests
    ├── test_config.py       # Configuration tests
    ├── test_dataproduct.py  # Data product cataloging tests
    └── ...
```

## Test Structure

**Suite Organization (pytest):**
Each test file groups related tests by module or feature:

```python
# From test_parser.py: Simple helper function approach
def _tables(cells: list[str]) -> set[str]:
    """Helper to extract table names from parsed cells."""
    graph = build_graph(
        IngestRequest(notebooks=[NotebookSource(name="nb", cells=cells)])
    )
    return {n.name for n in graph.nodes if n.id.startswith("table.")}


def test_python_imports_are_not_sql_reads():
    """Docstring explains the test and the real issue it found."""
    assert _tables(["from pyspark.sql import Row"]) == set()


def test_a_real_from_clause_still_reads():
    """The fix must not break valid SQL."""
    assert "raw_orders" in _tables(["df = spark.sql('SELECT * FROM raw_orders')"])
```

**Patterns:**
- Setup: Use fixtures (`@pytest.fixture`) for shared test data
- Assertions: Direct `assert` statements; one assertion per test where possible
- Teardown: Pytest cleans up after fixtures automatically
- Helper functions: Private functions (prefixed with `_`) for test utilities

## Mocking

**Framework:** `pytest` with built-in `monkeypatch` fixture

**Patterns:**
```python
# From test_api.py: Monkeypatch module-level functions
@pytest.fixture
def client() -> TestClient:
    return TestClient(main.app)


def test_purview_graph_returns_the_built_graph(client, monkeypatch):
    from app.purview import ingest
    
    monkeypatch.setattr(
        main,
        "build_graph_from_purview",
        lambda: ingest.build_graph_from_purview(FakePurviewClient()),
    )
    body = client.get("/purview/graph").json()
    assert {n["name"] for n in body["nodes"]} == {"WS_Demo", "LH_Sales", ...}
```

**Custom Fake Objects:**
- Create `FakeX` classes that implement the same interface as the real service
- Example from `conftest.py`: `FakePurviewClient` mirrors `PurviewClient` API
- Fakes record call history for assertions (e.g., `self.lineage_calls: list[str] = []`)

**What to Mock:**
- External services (Purview, Azure credentials)
- HTTP clients (use `TestClient` from fastapi.testclient for routes)
- Expensive operations (file I/O, network requests)

**What NOT to Mock:**
- The parser itself — test against real regex patterns
- Pydantic model validation — test the actual shape validation
- Core business logic — test with real data to catch regressions

## Fixtures and Factories

**Test Data (conftest.py):**
```python
# Fake entity data mirrors real Purview API responses
FAKE_HITS = [
    {
        "id": "g-ws",
        "entityType": "fabric_workspace",
        "name": "WS_Demo",
    },
    # More entities...
]

FAKE_ENTITIES = {
    "g-orders": {
        "entity": {
            "relationshipAttributes": {
                "columns": [...]
            }
        }
    }
}

class FakePurviewClient:
    """Fake client that returns predefined data without network access."""
    def __init__(self, hits=None, entities=None, relations=None) -> None:
        self.hits = FAKE_HITS if hits is None else hits
        self.entities = FAKE_ENTITIES if entities is None else entities


@pytest.fixture
def fake_client() -> FakePurviewClient:
    return FakePurviewClient()
```

**Location:**
- `backend/tests/conftest.py` for shared fixtures

**Usage Pattern:**
Test functions accept fixtures as parameters:
```python
def test_some_feature(fake_client):
    # fake_client is automatically provided by pytest
    result = process_with_client(fake_client)
    assert result == expected
```

## Coverage

**Requirements:** Not enforced; no coverage tools configured

**View Coverage:** Not implemented

**Gaps:** Frontend has no tests at all (Phase 1, planned for Phase 2 or later)

## Test Types

**Unit Tests:**
- Scope: Individual functions and classes
- Approach: Direct function calls with known inputs; verify outputs
- Examples: `test_parser.py` (parser regex patterns), `test_config.py` (config loading)
- Location: Most tests are unit tests

**Integration Tests:**
- Scope: HTTP endpoints and their interactions with services
- Approach: `TestClient` from fastapi for route-level testing
- Examples: `test_api.py` (endpoint tests with monkeypatching), `test_dataproduct.py` (data product writes)
- Location: `test_api.py`, `test_actions.py`, `test_dataproduct.py`

**E2E Tests:**
- Framework: Not implemented
- Status: Phase 1 focuses on unit and integration tests; end-to-end testing deferred

## Common Patterns

**Async Testing:**
Not used yet (no async operations in core business logic, only in FastAPI handlers which are tested via TestClient)

**Error Testing:**
```python
# From test_api.py: Verify error responses
def test_unconfigured_purview_is_503_not_500(client, monkeypatch):
    """A machine with no Purview access is a normal state, not a server bug."""
    
    def boom():
        raise PurviewError("Purview is not configured")
    
    monkeypatch.setattr(main, "build_graph_from_purview", boom)
    resp = client.get("/purview/graph")
    assert resp.status_code == 503
    assert "not configured" in resp.json()["detail"]
```

**Docstring Patterns:**
Every test function includes a docstring explaining what it tests and why:
```python
def test_python_imports_are_not_sql_reads():
    """`from pyspark.sql import Row` is not a read of a table named `sql`.

    Found against the live `00_seed_sources` notebook, where it invented a
    phantom upstream table from an ordinary import.
    """
```

**Settings Override (monkeypatch):**
```python
# From test_dataproduct.py: Override configuration for testing
@pytest.fixture
def allow_write(monkeypatch):
    """Turn the deployment gate on without touching the real .env."""
    settings = config.get_settings().model_copy(update={"purview_allow_write": True})
    monkeypatch.setattr(config, "get_settings", lambda: settings)
```

## Example Test File

Reference implementation from `test_parser.py`:

```python
"""Static parser regressions, from real Fabric notebook source."""

from __future__ import annotations

from app.models import IngestRequest, NotebookSource
from app.parser import build_graph


def _tables(cells: list[str]) -> set[str]:
    """Extract table names from parsed cells."""
    graph = build_graph(
        IngestRequest(notebooks=[NotebookSource(name="nb", cells=cells)])
    )
    return {n.name for n in graph.nodes if n.id.startswith("table.")}


def test_python_imports_are_not_sql_reads():
    """Imports must not create phantom upstream tables."""
    assert _tables(["from pyspark.sql import Row", "import pandas"]) == set()


def test_a_real_from_clause_still_reads():
    """The import fix must not blind the parser to actual SQL."""
    assert "raw_orders" in _tables(["df = spark.sql('SELECT * FROM raw_orders')"])
```

## Frontend Testing (Future)

**Planned (Phase 2+):**
- Vitest or Jest for component testing
- React Testing Library for interaction testing
- No specific patterns yet; use backend patterns as reference for conventions

---

*Testing analysis: 2026-07-20*
