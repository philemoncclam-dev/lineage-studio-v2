"""Decoding Fabric notebook definitions into parser input.

The fixtures are the two encodings Fabric actually returns from
`getDefinition` — the `notebook-content.py` banner script by default, and real
`.ipynb` JSON when asked for. No network and no credentials: every test here
runs off a definition dict, which is the same seam the manual fallback uses
when the service principal is refused workspace access.
"""

from __future__ import annotations

import base64
import json

import pytest

from app.fabric.notebooks import (
    NotebookDecodeError,
    notebook_source_from_definition,
    notebook_source_from_ipynb,
    parse_notebook_qualified_name,
)

WS = "03e777db-4717-49bc-8ff3-7f63fe765f29"
ITEM = "8c8f31ba-5c16-40d8-a86a-c5e3d45c1b4a"

SCRIPT = """# Fabric notebook source

# METADATA ********************

# MARKDOWN ********************

# ## Build the customer LTV table
# SELECT FROM prose_should_not_count

# CELL ********************

df = spark.table('raw_orders')

# META {"language": "python"}

# CELL ********************

df.write.mode('overwrite').saveAsTable('vw_sales')
"""

IPYNB = json.dumps(
    {
        "cells": [
            {"cell_type": "markdown", "source": ["# heading\n"]},
            {"cell_type": "code", "source": ["df = spark.table('raw_orders')\n"]},
            # nbformat permits a bare string as well as a list of lines.
            {"cell_type": "code", "source": "df.write.saveAsTable('vw_sales')"},
            {"cell_type": "code", "source": ["   \n"]},
        ]
    }
)


def _definition(path: str, text: str) -> dict:
    return {
        "parts": [
            {"path": ".platform", "payload": base64.b64encode(b"{}").decode()},
            {
                "path": path,
                "payload": base64.b64encode(text.encode()).decode(),
                "payloadType": "InlineBase64",
            },
        ]
    }


def test_script_encoding_splits_on_cell_banners():
    src = notebook_source_from_definition("nb", _definition("notebook-content.py", SCRIPT))
    assert src.cells == [
        "df = spark.table('raw_orders')",
        "df.write.mode('overwrite').saveAsTable('vw_sales')",
    ]


def test_markdown_and_metadata_are_not_treated_as_code():
    """Prose containing 'SELECT ... FROM' would otherwise invent a read edge."""
    src = notebook_source_from_definition("nb", _definition("notebook-content.py", SCRIPT))
    joined = "\n".join(src.cells)
    assert "prose_should_not_count" not in joined
    assert "# META" not in joined


def test_ipynb_encoding_keeps_only_non_empty_code_cells():
    src = notebook_source_from_definition("nb", _definition("notebook-content.ipynb", IPYNB))
    assert src.cells == [
        "df = spark.table('raw_orders')\n",
        "df.write.saveAsTable('vw_sales')",
    ]


def test_the_encoding_is_detected_from_content_not_the_file_name():
    """Fabric has mislabelled parts before; content is the reliable signal."""
    src = notebook_source_from_definition("nb", _definition("notebook-content.py", IPYNB))
    assert src.cells[0] == "df = spark.table('raw_orders')\n"


def test_platform_metadata_parts_are_never_chosen_as_the_code_part():
    definition = {"parts": [{"path": ".platform", "payload": base64.b64encode(b"{}").decode()}]}
    with pytest.raises(NotebookDecodeError):
        notebook_source_from_definition("nb", definition)


def test_undecodable_payload_is_reported_rather_than_silently_empty():
    """An empty notebook and an unreadable one mean very different lineage."""
    definition = {"parts": [{"path": "notebook-content.py", "payload": "!!!not base64!!!"}]}
    with pytest.raises(NotebookDecodeError):
        notebook_source_from_definition("nb", definition)


def test_decoded_text_can_be_supplied_directly():
    """The fallback path when the service principal cannot reach Fabric."""
    src = notebook_source_from_ipynb("nb", SCRIPT, lakehouse_default="LH_Sales")
    assert src.lakehouse_default == "LH_Sales"
    assert len(src.cells) == 2


def test_notebook_qualified_name_yields_workspace_and_item_ids():
    qn = f"https://app.fabric.microsoft.com/groups/{WS}/synapsenotebooks/{ITEM}"
    assert parse_notebook_qualified_name(qn) == (WS, ITEM)


def test_a_non_notebook_qualified_name_is_not_mistaken_for_one():
    qn = f"https://app.fabric.microsoft.com/groups/{WS}/lakehouses/{ITEM}/tables/x"
    assert parse_notebook_qualified_name(qn) is None
