"""Turn a Fabric Data Pipeline's definition into a small activity graph.

`getDefinition` returns the pipeline as base64 `parts`, the same shape a
notebook comes in; the canonical part here is `pipeline-content.json`, whose
`properties.activities` array is exactly what the Fabric authoring canvas draws
— each activity plus its `dependsOn` back-edges. We lift name/type/dependencies
so the explorer can render the same left-to-right flow.

Parsing is pure and unit-tested; the network fetch lives on the client.
"""

from __future__ import annotations

import json

from pydantic import BaseModel

from .notebooks import _decode_part


class PipelineActivity(BaseModel):
    name: str
    type: str
    depends_on: list[str] = []


def parse_pipeline_activities(definition: dict) -> list[PipelineActivity]:
    """The activities of a pipeline definition, with dependency back-edges.

    Returns `[]` when the definition carries no `pipeline-content.json` part or
    no activities — an empty pipeline and an unreadable one both render as
    "nothing to show" rather than an error.
    """
    parts = (definition or {}).get("parts") or []
    content = next(
        (p for p in parts if (p.get("path") or "").lower().endswith("pipeline-content.json")),
        None,
    )
    if not content:
        return []

    doc = json.loads(_decode_part(content))
    # Fabric writes `{"properties": {"activities": [...]}}`, but some exports
    # hoist activities to the top level — accept either.
    activities = (doc.get("properties") or doc).get("activities") or []

    out: list[PipelineActivity] = []
    for a in activities:
        name = a.get("name") or ""
        if not name:
            continue
        deps: list[str] = []
        for d in a.get("dependsOn") or []:
            dep = d.get("activity") if isinstance(d, dict) else d
            if dep:
                deps.append(dep)
        out.append(PipelineActivity(name=name, type=a.get("type") or "Unknown", depends_on=deps))
    return out
