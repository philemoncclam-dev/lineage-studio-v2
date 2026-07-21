# Coding Conventions

**Analysis Date:** 2026-07-20

## Naming Patterns

**Files:**
- Backend: `snake_case.py` (e.g., `models.py`, `parser.py`, `client.py`)
- Frontend: `PascalCase.tsx` for components, `camelCase.ts` for utilities (e.g., `SearchPalette.tsx`, `api.ts`, `model.tsx`)
- CSS: kebab-case (e.g., `graph.css`, `search.css`)

**Functions:**
- Python: `snake_case` for functions and methods (e.g., `build_graph()`, `_short()`, `_column_maps()`)
- TypeScript: `camelCase` for functions and methods (e.g., `fetchSample()`, `openLineage()`, `notebookIndex()`)
- Python: prefix with `_` for private/internal functions (e.g., `_short()`, `_table_node_id()`)

**Variables:**
- Python: `snake_case` throughout (e.g., `cell_text`, `table_ref`, `parent_id`)
- TypeScript: `camelCase` for variables and state (e.g., `focusTable`, `loadError`, `purviewOpen`)
- React hooks: state variables with descriptive names (e.g., `setModel`, `setLoading`)
- Constants: `UPPER_SNAKE_CASE` in both languages (e.g., `PURVIEW_SCOPE`, `MAX_PER_GROUP`, `BASE`)

**Types:**
- Python: `PascalCase` for classes (e.g., `Node`, `Edge`, `LineageGraph`, `PurviewClient`, `Settings`)
- TypeScript: `PascalCase` for interfaces and types (e.g., `LineageNode`, `AppModel`, `TableContext`, `SearchResult`)
- Python Enums: `PascalCase` class with `UPPER_SNAKE_CASE` members (e.g., `NodeKind`, with `WORKSPACE`, `TABLE`)
- TypeScript: `Literal` types for union strings (e.g., `type Mode = 'lineage' | 'graph'`)

## Code Style

**Formatting:**
- Frontend: No explicit formatter configured; relies on TypeScript strict mode
- Backend: No explicit formatter configured; follows PEP 8 conventions
- Imports: modern Python with `from __future__ import annotations`
- JSX formatting: components exported as `export default function ComponentName()`

**Linting:**
- Frontend: `oxlint` v1.71.0 with react, typescript, and oxc plugins
- Backend: No linter configured; relies on type hints and pytest for validation
- Oxlint rules:
  - `react/rules-of-hooks`: error level
  - `react/only-export-components`: warn with `allowConstantExport: true`

## Import Organization

**Order (Backend Python):**
1. `from __future__ import annotations` (always first)
2. Standard library imports (`import re`, `from typing import ...`)
3. Third-party imports (`from fastapi import ...`, `from pydantic import ...`)
4. Local imports (`from .models import ...`, `from .config import ...`)

Example from `main.py`:
```python
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .models import IngestRequest, LineageGraph
from .parser import build_graph
```

**Order (Frontend TypeScript):**
1. React imports (`import { useEffect, useState } from 'react'`)
2. Type imports (`import type { AppModel } from './model'`)
3. Local imports (components, utilities)
4. CSS/style imports

Example from `SearchPalette.tsx`:
```typescript
import { useEffect, useMemo, useRef, useState } from 'react'
import { useModel, type AppModel } from '../model'
import './search.css'
```

**Path Aliases:**
- None configured; use relative imports with `./` or `../`
- Absolute paths from backend root via `sys.path` manipulation in tests

## Error Handling

**Python Patterns:**
- Custom exceptions: inherit from `RuntimeError` or built-in exceptions (e.g., `class PurviewError(RuntimeError):`)
- FastAPI: raise `HTTPException` with `status_code` and `detail` parameters
- Example from `main.py`:
```python
except PurviewError as exc:
    raise HTTPException(status_code=503, detail=str(exc)) from exc
```
- Validation: Pydantic handles validation automatically; invalid input raises `ValidationError`

**TypeScript Patterns:**
- Error in async/await: check with `e instanceof Error ? e.message : String(e)`
- Fetch errors: check `res.ok` before parsing JSON
- Example from `App.tsx`:
```typescript
catch (e) {
  setLoadError(e instanceof Error ? e.message : String(e))
}
```
- No try-catch for expected failures (e.g., backend down → stay on sample)

## Logging

**Framework:** No structured logger configured; uses `print()` for Python and console methods for TypeScript

**Patterns:**
- Comments explain behavior rather than logging state
- Module docstrings describe purpose and major flows
- No debug logging visible in current codebase

## Comments

**When to Comment:**
- Module-level: always include a docstring describing purpose and major flows
- Functions: include docstring explaining what it does, especially for complex logic
- Inline: comment non-obvious algorithmic choices or workarounds
- No comments on trivial code (e.g., `x = 1` doesn't need a comment)

**JSDoc/TSDoc:**
- Python: Module docstrings and function docstrings (examples in `models.py`, `parser.py`)
- TypeScript: Interface/type comments as inline comments, function comments rare
- Example from `models.py`:
```python
"""Core lineage domain model.

The graph is deliberately generic so the same shapes serve both the
manual-JSON ingestion path (Phase 1) and, later, the sandbox-execution and
live-Fabric paths (Phase 2).
"""
```

## Function Design

**Size:** Keep functions short and focused
- Helper functions: 5-20 lines (e.g., `_short()`, `_table_node_id()`, `hl()`)
- Main logic: under 50 lines; split with private helpers for clarity

**Parameters:** Explicit parameters; avoid *args/**kwargs except in utility signatures
- Use Pydantic models as parameters for structured data (e.g., `IngestRequest`)
- React: props passed as TypeScript interfaces (e.g., `interface Props { ... }`)

**Return Values:** 
- Python: Return typed values; use tuples for multiple returns (e.g., `tuple[Node, list[Edge]]`)
- TypeScript: Return typed values; use arrow functions for simple callbacks
- React: Always return `JSX.Element` or `React.ReactNode`

## Module Design

**Exports:**
- Python: Use `from .module import name` in `__init__.py` for public APIs
- TypeScript: Use `export` on functions and interfaces; `export type` for type-only exports
- React: `export default function Component()` or `export { Component }`

**Barrel Files:**
- Frontend: `model.tsx` exports multiple types and functions (AppModel, adapt, sampleModel, ModelProvider)
- Avoid overly broad re-exports; keep them focused on a single concept

**Patterns:**
- Shared data models: Backend defines in `models.py`, frontend mirrors in `api.ts` with comment linking them
- Configuration: Backend uses Pydantic `BaseSettings` with `@lru_cache` decorator for singleton
- React Context: Used sparingly for app-wide state (ModelProvider in `model.tsx`)

## Python-Specific Conventions

**Type Hints:**
- Always include full type hints on function signatures
- Use modern union syntax: `str | None` instead of `Optional[str]`
- Use `list[T]`, `dict[K, V]` instead of `List[T]`, `Dict[K, V]`

**Pydantic:**
- All request/response models inherit from `BaseModel` or `BaseSettings`
- Use `Field()` for descriptions and defaults
- Example from `models.py`:
```python
class Node(BaseModel):
    id: str = Field(..., description="Stable unique id")
    kind: NodeKind
    parent_id: str | None = Field(None, description="Containment parent")
```

## TypeScript-Specific Conventions

**Strict Mode:**
- tsconfig enforces: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`
- No `any` types; use explicit types or generics

**React:**
- Use functional components with hooks, never class components
- Hooks must follow rules-of-hooks (enforced by oxlint)
- Props passed as TypeScript interfaces, destructured in function params

---

*Convention analysis: 2026-07-20*
