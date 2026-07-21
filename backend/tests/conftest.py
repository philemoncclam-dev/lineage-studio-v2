"""Shared fixtures.

The fake catalog mirrors the shapes a live Fabric scan actually emits — the
double-scanned lakehouse and the container-less warehouse view are both real
behaviours we hit against `Phil-purview-dev`, not invented edge cases.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.purview.client import PurviewError  # noqa: E402  (needs the path above)

WS = "11111111-1111-1111-1111-111111111111"
LH = "22222222-2222-2222-2222-222222222222"
# The SQL analytics endpoint: a separate GUID from the lakehouse, under the
# `lakewarehouses` segment. Views live here, tables under the lakehouse.
LW = "33333333-3333-3333-3333-333333333333"
SCHEMA = "44444444-4444-4444-4444-444444444444"
BASE = "https://app.fabric.microsoft.com/groups"

FAKE_HITS = [
    {
        "id": "g-ws",
        "entityType": "fabric_workspace",
        "name": "WS_Demo",
        "qualifiedName": f"{BASE}/{WS}",
    },
    {
        "id": "g-lh",
        "entityType": "fabric_lakehouse",
        "name": "LH_Sales",
        "qualifiedName": f"{BASE}/{WS}/lakehouses/{LH}",
    },
    {
        # Same display name, different GUID: the SQL analytics endpoint.
        "id": "g-lw",
        "entityType": "fabric_lake_warehouse",
        "name": "LH_Sales",
        "qualifiedName": f"{BASE}/{WS}/lakewarehouses/{LW}",
    },
    {
        "id": "g-orders",
        "entityType": "fabric_lakehouse_table",
        "name": "raw_orders",
        "qualifiedName": f"{BASE}/{WS}/lakehouses/{LH}/tables/dbo%252Fraw_orders",
    },
    {
        "id": "g-view",
        "entityType": "fabric_warehouse_view",
        "name": "vw_customer_ltv",
        "qualifiedName": f"{BASE}/{WS}/lakewarehouses/{LW}/views/vw_customer_ltv",
    },
    {
        # Unmapped type — storage artefact, must be dropped.
        "id": "g-path",
        "entityType": "fabric_path",
        "name": "Files",
        "qualifiedName": f"{BASE}/{WS}/lakehouses/{LH}/files",
    },
]

FAKE_ENTITIES = {
    # A lakehouse table: columns hang off the entity itself.
    "g-orders": {
        "entity": {
            "relationshipAttributes": {
                "columns": [
                    {"displayText": "order_id", "guid": "c-1"},
                    {"displayText": "customer%2Fid", "guid": "c-2"},
                ]
            }
        },
        "referredEntities": {"c-1": {"attributes": {"data_type": "int"}}},
    },
    # A warehouse view: no columns of its own, only a tabular_schema link.
    "g-view": {
        "entity": {
            "relationshipAttributes": {
                "columns": [],
                "tabular_schema": {"guid": SCHEMA},
            }
        }
    },
    SCHEMA: {
        "entity": {
            "relationshipAttributes": {
                "columns": [{"displayText": "ltv", "guid": "c-9"}]
            }
        },
        "referredEntities": {"c-9": {"attributes": {"type": "decimal"}}},
    },
}


class FakePurviewClient:
    """Stands in for `PurviewClient` with no network and no credentials."""

    def __init__(self, hits=None, entities=None, relations=None) -> None:
        self.hits = FAKE_HITS if hits is None else hits
        self.entities = FAKE_ENTITIES if entities is None else entities
        self.relations = relations or []
        self.lineage_calls: list[str] = []

    def search(self, keywords=None, filter=None):
        return iter(self.hits)

    def get_entity(self, guid: str) -> dict:
        return self.entities.get(guid, {"entity": {}})

    def get_lineage(self, guid: str, depth: int = 3, direction: str = "BOTH") -> dict:
        self.lineage_calls.append(guid)
        return {"relations": self.relations}

    def get_next_lineage(self, guid: str, direction: str) -> dict:
        self.lineage_calls.append(guid)
        # The live endpoint 404s for an entity with no lineage rather than
        # returning an empty set, so the fake must fail the same way — a fake
        # that politely returns nothing would hide the bug this guards.
        if not self.relations:
            raise PurviewError("404 not a valid lineage entity type")
        return {"relations": self.relations}


@pytest.fixture
def fake_client() -> FakePurviewClient:
    return FakePurviewClient()
