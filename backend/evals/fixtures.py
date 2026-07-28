"""The model the eval questions are asked about.

Built to be WRONG in specific, deliberate ways. Every trap the system prompt
warns against needs an entity that springs it, or the eval only measures the
easy path:

- `customer_id` exists in two Bronze tables with NO transition between them, so
  a model that infers lineage from matching names has something to be wrong
  about.
- `bronze_orders → silver_wide` is a TABLE-level edge only, so tracing a column
  inside `silver_wide` returns `level: "object"` and the coarser-answer note.
- `bronze_customers.customer_id → gold_customer_ltv.customer_key` carries no
  `Source` property, so `derived` is false — a person drew it and nothing has
  checked it.
- `silver_orders_enriched.customer_id` fans out to more targets than MAX_PATHS,
  so a downstream trace truncates and `impact` is the only complete answer.
- `gold_orphan.orphan_col` has no lineage at all, for the gaps scan.

Ground truth is not hand-written: `expected.py` computes it by calling the same
deterministic traversal the assistant's tools call.
"""

from __future__ import annotations

from typing import Any

from app.chat.graph import MAX_PATHS
from app.chat.model import LineageModel

#: Comfortably over MAX_PATHS so a downstream trace from the fan-out column is
#: guaranteed to truncate. Derived rather than hard-coded — if the traversal's
#: bound moves, the trap moves with it instead of quietly ceasing to be one.
FANOUT = MAX_PATHS + 4


def _attr(entity_id: str, name: str) -> dict[str, Any]:
    return {"id": entity_id, "name": name, "children": []}


def eval_model() -> LineageModel:
    gold_fanout = [_attr(f"a_g_fan{i}", f"metric_{i}") for i in range(FANOUT)]

    layers = [
        {
            "id": "L_bronze",
            "name": "Bronze",
            "objects": [
                {
                    "id": "o_b_orders",
                    "name": "bronze_orders",
                    "children": [
                        _attr("a_b_amount", "amount"),
                        _attr("a_b_cust", "customer_id"),
                    ],
                },
                {
                    "id": "o_b_customers",
                    "name": "bronze_customers",
                    # The SAME column name as in bronze_orders, and nothing
                    # connects them. This is the name-inference trap.
                    "children": [
                        _attr("a_bc_cust", "customer_id"),
                        _attr("a_bc_email", "email"),
                    ],
                },
            ],
        },
        {
            "id": "L_silver",
            "name": "Silver",
            "objects": [
                {
                    "id": "o_s_orders",
                    "name": "silver_orders_enriched",
                    "children": [
                        _attr("a_s_amount", "amount_usd"),
                        _attr("a_s_cust", "customer_id"),
                    ],
                },
                {
                    "id": "o_s_wide",
                    "name": "silver_wide",
                    # Reachable only through a TABLE-level edge — no column
                    # here has an edge of its own.
                    "children": [_attr("a_sw_col", "wide_col")],
                },
            ],
        },
        {
            "id": "L_gold",
            "name": "Gold",
            "objects": [
                {
                    "id": "o_g_ltv",
                    "name": "gold_customer_ltv",
                    "children": [
                        _attr("a_g_ltv", "lifetime_value"),
                        _attr("a_g_key", "customer_key"),
                    ],
                },
                {
                    "id": "o_g_fan",
                    "name": "gold_metrics",
                    "children": gold_fanout,
                },
                {
                    "id": "o_g_orphan",
                    "name": "gold_orphan",
                    "children": [_attr("a_g_orphan", "orphan_col")],
                },
            ],
        },
    ]

    transitions: list[dict[str, str]] = [
        # A clean, sandbox-derived column chain: Bronze → Silver → Gold.
        {"id": "t_amount_1", "source": "a_b_amount", "target": "a_s_amount"},
        {"id": "t_amount_2", "source": "a_s_amount", "target": "a_g_ltv"},
        # Hand-drawn: no Source property, so `derived` comes back false.
        {"id": "t_handdrawn", "source": "a_bc_cust", "target": "a_g_key"},
        # Table level only. Nothing inside silver_wide has a column edge.
        {"id": "t_table_only", "source": "o_b_orders", "target": "o_s_wide"},
        {"id": "t_cust_in", "source": "a_b_cust", "target": "a_s_cust"},
    ]
    # The fan-out, from one Silver column to more Gold columns than a trace
    # will return.
    transitions += [
        {"id": f"t_fan{i}", "source": "a_s_cust", "target": f"a_g_fan{i}"}
        for i in range(FANOUT)
    ]

    return LineageModel.model_validate(
        {
            "id": "eval-1",
            "name": "Eval medallion",
            "layers": layers,
            "transitions": transitions,
            # `Source` is what makes a hop `derived`. EVERY edge carries one
            # except `t_handdrawn`, so `coverage` reports exactly one
            # hand-drawn edge — a number with a single unambiguous right
            # answer. Leaving the fan-out edges bare would put the count at 18
            # and make "how much of this is verified" untestable.
            "properties": {
                "t_amount_1": {"Source": "Fabric sandbox", "Transform": "amount * fx_rate"},
                "t_amount_2": {"Source": "Fabric sandbox", "Transform": "SUM(amount_usd)"},
                "t_cust_in": {"Source": "Fabric sandbox"},
                "t_table_only": {"Source": "Fabric sandbox"},
                **{f"t_fan{i}": {"Source": "Fabric sandbox"} for i in range(FANOUT)},
            },
        }
    )
