# Codebase Concerns

**Analysis Date:** 2026-07-20

## Tech Debt

**Global mutable state in API layer:**
- Issue: `backend/app/main.py` uses a module-level `global _last_graph` variable (line 58-60) to store the most recently built graph. This is shared across requests and not thread-safe.
- Files: `backend/app/main.py`
- Impact: In concurrent scenarios (e.g., multiple ingest requests), requests can interfere with each other. Testing is complicated because tests mutate shared state. Deployment behind a multi-worker application server will cause unpredictable behavior.
- Fix approach: Move to a session store (in-memory dict keyed by session/user ID) or a real database. For MVP, use FastAPI's `Depends()` with a database connection; even SQLite is better than a global.

**Heuristic regex-based SQL and PySpark parsing:**
- Issue: `backend/app/parser.py` uses regex patterns (lines 28-41) to extract table references from notebook code. These patterns are brittle and cannot handle SQL complexity.
- Files: `backend/app/parser.py` (patterns at lines 28-41, extraction logic at lines 66-71, 74-89)
- Impact: False positives (Python imports matching SQL FROM clauses), false negatives (CTEs, subqueries, dynamic SQL, complex joins), and wrong column mappings (only flat SELECT lists). Phase 2's Spark sandbox executor will replace this, but Phase 1 lineage is known-incomplete.
- Fix approach: Document limitations clearly in the UI. For Phase 2, the sandbox executor will use Spark's logical plans for accurate lineage. Consider a validation pass warning users when high-confidence patterns are missing.

**Simplistic column-level lineage extraction:**
- Issue: Column maps are derived from regex matching on flat SELECT lists (parser.py lines 74-89). Only captures simple `col AS alias` patterns; misses CTEs, subqueries, expressions with multiple sources, and UNION.
- Files: `backend/app/parser.py` (lines 74-89)
- Impact: Column lineage is incomplete and cannot capture complex transformations. Users see incomplete data flow for joins and derived columns.
- Fix approach: Phase 2's Spark sandbox will solve this by reading Spark's logical plans. For Phase 1, consider shipping metadata that marks column lineage as "approximate, Phase 1".

**N+1 API calls during Purview graph ingest:**
- Issue: `backend/app/purview/ingest.py` fetches column details one table at a time (lines 140-141). For a graph with N tables, makes N+1 API calls.
- Files: `backend/app/purview/ingest.py` (lines 88-105, 139-141)
- Impact: Slow lineage fetch for catalogs with many tables. Purview API has rate limits (search: 500 entities per call, but entity details are per-item). A catalog with 1000 tables can take 30+ seconds.
- Fix approach: Use Purview's search with `continuationToken` to paginate columns in bulk (if available), or add client-side caching. For immediate relief, consider lazy-loading columns only when the UI requests them.

**Broad exception handling in optional operations:**
- Issue: `backend/app/purview/client.py` line 127 catches all exceptions (`except Exception`) with `noqa: BLE001` comment. While documented, this can hide real failures.
- Files: `backend/app/purview/client.py` (lines 110-129)
- Impact: Optional lookups (e.g., principal_object_id) that fail silently. If the Directory API is down, the service principal lookup fails silently, and ownership fields use an empty string. Users won't know why.
- Fix approach: Log the suppressed exception at INFO or DEBUG level. Distinguish between expected failures (no directory access) and unexpected ones (service down).

**Silent error suppression in frontend:**
- Issue: `frontend/src/App.tsx` catches all errors from `fetchGraph()` (line 28) and `fetchPurviewStatus()` (line 37) with empty catch blocks. Falls back to sample data without informing the user.
- Files: `frontend/src/App.tsx` (lines 26-39)
- Impact: Users may not realize they're looking at demo data. Backend failures are invisible. A backend crash, network error, or misconfiguration all present the same UI.
- Fix approach: The loadError state exists but fetchGraph errors are not assigned to it. Assign network/load errors to loadError so users see a chip warning "backend unavailable".

**Error message truncation hides diagnostics:**
- Issue: Error responses are truncated at 500 chars (purview/client.py line 69) or 300 chars (fabric/client.py line 101). HTTP error bodies from Azure services are often larger.
- Files: `backend/app/purview/client.py` (line 69), `backend/app/fabric/client.py` (line 101)
- Impact: Debugging permission errors, malformed requests, or service issues becomes harder. The truncated message might cut off the actual error detail.
- Fix approach: Log full error text to application logs; keep HTTP response truncation only for UI display.

## Known Bugs

**Polling loop uses blocking sleep:**
- Symptoms: Notebook definition fetch can stall the uvicorn thread for up to 60 seconds (`_OPERATION_TIMEOUT`)
- Files: `backend/app/fabric/client.py` (lines 91-112)
- Trigger: Call `get_notebook_definition()` when Fabric is slow or the operation takes time to complete
- Workaround: Restart the backend; the next request will retry

## Security Considerations

**No authentication on backend API:**
- Risk: The backend has no authentication and holds a Fabric/Purview service principal with write access to the catalog. Any origin in CORS allow-list can mutate Purview on the visitor's behalf.
- Files: `backend/app/main.py` (lines 30-37), `backend/app/config.py` (lines 41-54)
- Current mitigation: CORS uses an allow-list (not wildcard), and `PURVIEW_ALLOW_WRITE` defaults to false. Render deployment sets `PURVIEW_ALLOW_WRITE=false` by default.
- Recommendations: (1) Add OAuth2/OpenID Connect to authenticate users before allowing writes. (2) Scope service principal to **read-only** for Purview, and use a separate, time-limited token for writes (Managed Identity or SAS). (3) Audit CORS origins on every deploy — misconfig is silent.

**Credentials in environment variables without automated validation:**
- Risk: Purview and Fabric credentials are read from `.env` (config.py lines 29-32). No validation that credentials are actually used or that they work until the first API call fails.
- Files: `backend/app/config.py` (lines 27-66)
- Current mitigation: `.env` is in `.gitignore`. Render secrets are set via dashboard.
- Recommendations: (1) Add a startup check that validates Purview credentials on boot if `purview_configured` is true. (2) Log a clear error if credentials are invalid. (3) Consider using Azure Managed Identity instead of client secrets in hosted environments.

**Fallback to sample data silently:**
- Risk: If backend is down, the app falls back to demo data (`frontend/src/App.tsx` line 28). Users may not realize they're not seeing live data and may make decisions based on sample output.
- Files: `frontend/src/App.tsx` (lines 26-28)
- Current mitigation: A chip badge says "sample data" but only if fetch explicitly fails and fetchGraph error is caught.
- Recommendations: Make it explicit and loud. Require users to acknowledge they are viewing sample data before doing any analysis.

## Performance Bottlenecks

**Purview graph fetch is O(N tables) API calls:**
- Problem: Building the full lineage graph makes one API call per table for column details. A 100-table catalog takes 100+ seconds.
- Files: `backend/app/purview/ingest.py` (lines 88-105, 139-141)
- Cause: `client.get_entity(guid)` is called in a loop. Purview search can return 500 entities per call but details must be fetched individually.
- Improvement path: (1) Profile the actual calls — check if Purview returns columns in search results. (2) If not, batch the requests using asyncio. (3) Add client-side caching layer with TTL. (4) Lazy-load columns only when UI requests them (drill-in). (5) For Phase 2, rely on Spark lineage which doesn't need Purview at all.

**Frontend graph rendering has no virtualization:**
- Problem: ReactFlow renders all nodes and edges at once. Large graphs (1000+ nodes) will lag.
- Files: `frontend/src/views/GraphView.tsx`
- Cause: ReactFlow without virtualization or node clustering renders the DOM for every node.
- Improvement path: Add ReactFlow's `minimap` and `background` plugins. For very large graphs, implement clustering (group tables by lakehouse). Consider lazy-loading edge details.

**No pagination or lazy-loading in Purview search:**
- Problem: `ingest.py` fetches all entities from Purview at once with `client.search()` (line 115). For catalogs with 10,000+ entities, this loads everything into memory.
- Files: `backend/app/purview/ingest.py` (lines 115, 184-211)
- Cause: Search results are eagerly consumed into a list (line 115).
- Improvement path: Stream search results, materialize nodes lazily, or add a filter to scope the search (e.g., by collection or type).

## Fragile Areas

**Fabric qualified name parsing:**
- Files: `backend/app/fabric/notebooks.py` (lines 31-32), `backend/app/purview/ingest.py` (lines 40-43)
- Why fragile: Both use hardcoded regex patterns to extract GUIDs from Fabric qualified names (e.g., `/groups/<guid>/synapsenotebooks/<guid>`). If Fabric changes the URL structure, parsing breaks silently (returns None, not an error).
- Safe modification: Add a test that covers a real Fabric qualified name. When modifying, ensure both regex patterns stay in sync. Consider extracting shared regex constant.
- Test coverage: `test_fabric.py` tests the decode path but not qualified name parsing. No test validates against real Fabric URLs.

**Purview entity type mapping is hardcoded:**
- Files: `backend/app/purview/ingest.py` (lines 21-30)
- Why fragile: Fabric scan types (`fabric_lakehouse`, `fabric_warehouse`, etc.) are hardcoded. If Fabric or Purview adds new entity types, they are silently dropped (skipped in line 115).
- Safe modification: Log when an entity type is skipped. Add a configuration file listing known types so new ones can be added without code changes.
- Test coverage: No test for unknown entity types.

**Column name extraction from Purview entities:**
- Files: `backend/app/purview/ingest.py` (lines 67-85)
- Why fragile: Tries multiple field names for column data (`dataType`, `data_type`, `type`) and assumes one will exist. If the field name changes or is missing, columns are silently incomplete.
- Safe modification: Validate that at least one field is present; log if extraction fails. Consider making data_type optional in the model.
- Test coverage: No test for missing data type fields.

**Parser inference of table nodes:**
- Files: `backend/app/parser.py` (lines 137-144)
- Why fragile: If the regex patterns miss a table reference, an inferred placeholder node is created with `"inferred": True`. This can create orphaned nodes if the pattern match is wrong.
- Safe modification: Add validation that inferred nodes don't outnumber explicitly provided nodes by a large ratio (e.g., if inferred > explicit * 2, warn the user).
- Test coverage: `test_parser.py` has only 3 test cases; doesn't test inference.

## Scaling Limits

**In-memory graph storage has no limit:**
- Current capacity: Limited by Python heap. A graph with 100K nodes + edges is ~500MB of memory.
- Limit: Single `_last_graph` variable will hit memory limit or GC pauses when graphs exceed ~1M nodes (Fabric enterprise catalogs can exceed this).
- Scaling path: (1) Move to a database (PostgreSQL + PostGIS for graph operations). (2) Implement pagination (fetch graph regions on demand). (3) Add a cache layer with LRU eviction. (4) For Phase 2, Spark sandbox executor will be I/O bound, not memory bound.

**No request timeout or queue depth limit:**
- Current capacity: uvicorn defaults to 2048 connections. No explicit timeout or queue limit on `/ingest` or `/purview/graph`.
- Limit: Slow clients (network latency) or slow backend operations (Fabric latency) can exhaust connection pool. No backpressure.
- Scaling path: (1) Add explicit timeouts to all HTTP calls (currently hardcoded at 60-120s). (2) Add a request queue with a depth limit; return 429 when full. (3) Implement async/await for I/O operations (currently blocking).

## Dependencies at Risk

**Python 3.14 but Phase 2 needs Python 3.11/3.12:**
- Risk: Local environment is Python 3.14, but comments in `requirements.txt` (lines 18-21) note Phase 2 PySpark needs 3.11/3.12. Developers may accidentally use 3.14 features that break Phase 2.
- Impact: Phase 2 venv setup will fail if the code uses 3.13+ syntax (e.g., `match/case` from 3.10, type unions `X | Y` from 3.10 — actually OK).
- Migration plan: Create a separate `.python-version` file pinning 3.11 or 3.12 for development. Add a CI check that Phase 2 code is tested against 3.11/3.12.

**Azure SDK token refresh is automatic but unconfigurable:**
- Risk: `ClientSecretCredential` caches and auto-refreshes tokens, but timeout, retry, and backoff policies are not configurable in the current code.
- Impact: If Azure token service is slow or returns 429, the client has no control over retry behavior.
- Migration plan: Wrap `ClientSecretCredential` in a custom credential class with configurable retry policy. Use `azure.identity` `retry_total` and `backoff_factor` parameters if they're exposed in a future version.

**OpenLineage integration not yet in Phase 1:**
- Risk: Phase 2 depends on `openlineage-integration-common` and `openlineage-python` (requirements.txt comments). These packages are not yet added and their stability is unknown.
- Impact: Phase 2 lineage accuracy depends on OpenLineage format and reliability.
- Migration plan: Lock versions explicitly in Phase 2 requirements. Add integration tests against a local Spark cluster.

## Missing Critical Features

**No support for complex SQL (CTEs, subqueries, dynamic SQL):**
- Problem: Phase 1 parser cannot derive lineage from window functions, CTEs (`WITH` clauses), derived tables, or dynamic SQL.
- Blocks: Accurate lineage for any notebook using advanced SQL patterns.
- Workaround: Phase 2's Spark sandbox will handle these correctly.

**No support for Spark DataFrame transformations not expressed in SQL:**
- Problem: `df.groupBy().agg()`, `df.join()`, and other DataFrame API calls are not parsed.
- Blocks: Lineage for Spark SQL-free notebooks.
- Workaround: Phase 2 executor will see these in the logical plan.

**No support for external data sources (S3, databases, etc.):**
- Problem: Parser looks for `spark.table()` and SQL `FROM` clauses; doesn't handle `spark.read.parquet()`, `spark.read.jdbc()`, etc.
- Blocks: Lineage that includes external systems.
- Workaround: Fabric scan may emit these as entities; Phase 2 Spark monitor will capture them.

**No lineage tracing across notebooks (notebook-to-notebook):**
- Problem: The current model has notebooks as leaf nodes. If notebook A reads output of notebook B, that edge is not detected.
- Blocks: Multi-notebook workflows.
- Workaround: Phase 2 will trace execution order from Fabric notebooks list.

**No support for data quality or SLA metadata:**
- Problem: Nodes carry only lineage info, not data quality, freshness, or SLA status.
- Blocks: Downstream impact analysis (if raw_orders is stale, which reports break?).

## Test Coverage Gaps

**Parser regex patterns are undertested:**
- What's not tested: Complex SQL (CTEs, subqueries, window functions), Spark DataFrame API, edge cases (table names with special chars, quoted identifiers).
- Files: `backend/tests/test_parser.py` (only 3 test cases)
- Risk: Parser silently misses lineage or generates false positives. Real notebooks fail in production.
- Priority: High — Phase 1's entire value rests on the parser working correctly.

**Purview client error handling:**
- What's not tested: Rate limiting (429), timeout (504), partial failures (mixed success/failure in batch operations).
- Files: `backend/tests/test_purview_*` — no tests for network failures or Purview-specific error codes.
- Risk: Production behavior is unknown when Purview is slow or overloaded.
- Priority: Medium — mitigated by dry-run behavior, but needed for production reliability.

**Frontend interaction with large graphs:**
- What's not tested: Rendering 1000+ nodes, panning/zooming performance, search/filter on large dataset.
- Files: No frontend tests (TypeScript only, no test runner configured).
- Risk: "UI never tested in browser" (handoff.md line 31). Layout and interaction are unverified.
- Priority: High — must be tested before first deployment.

**Concurrent requests and thread safety:**
- What's not tested: Multiple simultaneous `/ingest` calls, race conditions in `_last_graph` access.
- Files: `backend/app/main.py`, no concurrency tests.
- Risk: Undefined behavior when multiple users upload data simultaneously.
- Priority: High — blocks multi-user deployment.

**Definition import (.xlsx parsing):**
- What's not tested: Malformed Excel files, missing columns, large files (10K+ rows).
- Files: `backend/app/purview/definitions.py` — 1 test case (`test_definitions.py`), likely minimal.
- Risk: Users can crash the backend with bad input.
- Priority: Medium — feature is less critical than core lineage.

---

*Concerns audit: 2026-07-20*
