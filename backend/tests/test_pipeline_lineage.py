"""Copy activity lineage, read straight out of a pipeline definition.

A pipeline is not Spark, so the sandbox has nothing to execute for one: before
this, a pipeline step ran only its notebook activities and a pipeline whose whole
job was a Copy contributed no lineage at all. A Copy's lineage is declarative —
the datasets are inline and `translator.mappings` is a literal column map — so
it needs no engine, which is why it works in production too.
"""

from __future__ import annotations

import base64
import json

from app.fabric.pipelines import parse_pipeline_activities
from app.sandbox._refs import make_ref

NAME_MAP = {"ws-guid": "Finance", "bronze-guid": "Bronze", "gold-guid": "Gold"}


def lakehouse(table: str, artifact: str, workspace: str = "ws-guid", name: str = "") -> dict:
    return {
        "datasetSettings": {
            "type": "LakehouseTable",
            "typeProperties": {"table": table},
            "linkedService": {
                "name": name,
                "properties": {
                    "type": "Lakehouse",
                    "typeProperties": {"workspaceId": workspace, "artifactId": artifact},
                },
            },
        }
    }


def definition(activities: list[dict]) -> dict:
    payload = base64.b64encode(
        json.dumps({"properties": {"activities": activities}}).encode()
    ).decode()
    return {"parts": [{"path": "pipeline-content.json", "payload": payload}]}


def copy_activity(type_properties: dict, name: str = "Copy customers") -> dict:
    return {"name": name, "type": "Copy", "dependsOn": [], "typeProperties": type_properties}


def parse(activities, **kw):
    return parse_pipeline_activities(definition(activities), name_map=NAME_MAP, **kw)


# --- tables ----------------------------------------------------------------

def test_a_copy_names_the_tables_it_moves_between():
    [act] = parse(
        [
            copy_activity(
                {
                    "source": lakehouse("raw_customers", "bronze-guid"),
                    "sink": lakehouse("dim_customer", "gold-guid"),
                }
            )
        ]
    )
    assert act.reads == [make_ref("raw_customers", "Bronze", "Finance")]
    assert act.writes == [make_ref("dim_customer", "Gold", "Finance")]


def test_the_refs_match_the_sandbox_vocabulary():
    """A table a Copy writes must be the SAME graph node as the table a notebook
    later reads, not a look-alike sitting beside it."""
    [act] = parse([copy_activity({"sink": lakehouse("dim_customer", "gold-guid")})])
    assert act.writes == [make_ref("dim_customer", "Gold", "Finance")]


def test_an_unresolved_guid_is_kept_as_the_identity():
    """Collapsing it to "" would merge two same-named tables from different
    workspaces — the exact bug _refs exists to prevent."""
    [act] = parse([copy_activity({"sink": lakehouse("t", "unknown-lh", workspace="unknown-ws")})])
    assert act.writes == [make_ref("t", "unknown-lh", "unknown-ws")]


def test_the_linked_service_name_stands_in_when_the_guid_is_absent():
    [act] = parse([copy_activity({"sink": lakehouse("t", "", name="Silver")})])
    assert act.writes == [make_ref("t", "Silver", "Finance")]


def test_a_file_dataset_falls_back_to_its_filename():
    side = {
        "datasetSettings": {
            "typeProperties": {"location": {"fileName": "orders.parquet"}},
            "linkedService": {"name": "Files"},
        }
    }
    [act] = parse([copy_activity({"source": side, "sink": lakehouse("t", "gold-guid")})])
    # No workspaceId in the linked service, so the workspace stays unknown
    # rather than being assumed to be the pipeline's own.
    assert act.reads == [make_ref("orders.parquet", "Files", "")]


def test_one_known_end_is_still_recorded():
    """A Copy from an external source into a lakehouse is the commonest pipeline
    there is; the write is worth having even when the read cannot be named."""
    [act] = parse([copy_activity({"sink": lakehouse("landing", "bronze-guid")})])
    assert act.reads == []
    assert act.writes == [make_ref("landing", "Bronze", "Finance")]


def test_dataset_references_are_a_last_resort_and_claim_no_workspace():
    """A DatasetReference is an artifact name, not a table identity."""
    act = parse(
        [{**copy_activity({}), "inputs": [{"referenceName": "ds_orders", "type": "DatasetReference"}]}]
    )[0]
    assert act.reads == [make_ref("ds_orders", "", "")]


# --- columns ---------------------------------------------------------------

def test_a_translator_mapping_becomes_column_lineage():
    [act] = parse(
        [
            copy_activity(
                {
                    "source": lakehouse("raw_customers", "bronze-guid"),
                    "sink": lakehouse("dim_customer", "gold-guid"),
                    "translator": {
                        "type": "TabularTranslator",
                        "mappings": [
                            {"source": {"name": "id"}, "sink": {"name": "customer_id"}},
                            {"source": {"name": "nm"}, "sink": {"name": "name"}},
                        ],
                    },
                }
            )
        ]
    )
    assert [(f.from_column, f.to_column) for f in act.column_lineage] == [
        ("id", "customer_id"),
        ("nm", "name"),
    ]
    assert act.column_lineage[0].from_table == make_ref("raw_customers", "Bronze", "Finance")
    assert act.column_lineage[0].to_table == make_ref("dim_customer", "Gold", "Finance")
    # A Copy moves values, it does not compute them.
    assert act.column_lineage[0].transform is None


def test_a_hierarchical_source_column_is_read_from_its_json_path():
    [act] = parse(
        [
            copy_activity(
                {
                    "source": lakehouse("src", "bronze-guid"),
                    "sink": lakehouse("dst", "gold-guid"),
                    "translator": {
                        "mappings": [
                            {"source": {"path": "$['customer']['id']"}, "sink": {"name": "cid"}}
                        ]
                    },
                }
            )
        ]
    )
    assert [(f.from_column, f.to_column) for f in act.column_lineage] == [("id", "cid")]


def test_an_ordinal_only_mapping_is_skipped_rather_than_invented():
    [act] = parse(
        [
            copy_activity(
                {
                    "source": lakehouse("src", "bronze-guid"),
                    "sink": lakehouse("dst", "gold-guid"),
                    "translator": {"mappings": [{"source": {"ordinal": "1"}, "sink": {"name": "a"}}]},
                }
            )
        ]
    )
    assert act.column_lineage == []


def test_no_translator_means_tables_only_not_invented_columns():
    """An implicit same-name mapping is real, but the column LIST is not in the
    definition and making one up would be fiction."""
    [act] = parse(
        [
            copy_activity(
                {
                    "source": lakehouse("src", "bronze-guid"),
                    "sink": lakehouse("dst", "gold-guid"),
                }
            )
        ]
    )
    assert act.column_lineage == []
    assert act.reads and act.writes


# --- everything else is untouched ------------------------------------------

def test_a_notebook_activity_carries_no_copy_lineage():
    [act] = parse(
        [
            {
                "name": "Run nb",
                "type": "TridentNotebook",
                "typeProperties": {"notebookId": "nb-guid", "workspaceId": "ws-guid"},
            }
        ]
    )
    assert (act.reads, act.writes, act.column_lineage) == ([], [], [])
    assert act.notebook_id == "nb-guid"


def test_dependency_edges_still_parse():
    acts = parse(
        [
            copy_activity({}, name="first"),
            {"name": "second", "type": "Copy", "dependsOn": [{"activity": "first"}]},
        ]
    )
    assert [a.depends_on for a in acts] == [[], ["first"]]


def test_an_undecodable_definition_is_empty_rather_than_an_error():
    payload = base64.b64encode(b"{{{").decode()
    bad = {"parts": [{"path": "pipeline-content.json", "payload": payload}]}
    assert parse_pipeline_activities(bad) == []


# --- pipelines inside pipelines --------------------------------------------
#
# A master pipeline that only sequences other pipelines has no notebook of its
# own. Before `expand_pipeline_activities` the child reference was dropped
# entirely, so such a pipeline parsed to activities with nothing runnable in
# them and the whole orchestration did nothing at all.


def _notebook(name: str, nb_id: str, deps: list[str] | None = None) -> dict:
    return {
        "name": name,
        "type": "TridentNotebook",
        "dependsOn": [{"activity": d, "dependencyConditions": ["Succeeded"]} for d in (deps or [])],
        "typeProperties": {"notebookId": nb_id, "workspaceId": "ws-1"},
    }


def _invoke(name: str, child_id: str, deps: list[str] | None = None, *, canvas: bool = False) -> dict:
    """`canvas=True` gives the Fabric UI's InvokePipeline spelling."""
    tp = (
        {"pipelineId": child_id, "workspaceId": "ws-1", "operationType": "InvokeFabricPipeline"}
        if canvas
        else {"pipeline": {"referenceName": child_id, "type": "PipelineReference"}}
    )
    return {
        "name": name,
        "type": "InvokePipeline" if canvas else "ExecutePipeline",
        "dependsOn": [{"activity": d, "dependencyConditions": ["Succeeded"]} for d in (deps or [])],
        "typeProperties": tp,
    }


def _expand(root: dict, library: dict[str, dict]):
    from app.fabric.pipelines import expand_pipeline_activities

    def fetch(_ws: str, item: str) -> dict:
        return library[item]

    return expand_pipeline_activities(root, fetch, workspace_id="ws-1")


def test_a_master_of_pipelines_yields_the_notebooks_underneath():
    """The bug this pins: pl_00_master ran nothing, because it owns no notebook."""
    child = definition([_notebook("run nb_a", "nb-a"), _notebook("run nb_b", "nb-b", ["run nb_a"])])
    master = definition([_invoke("invoke child", "child-1")])

    acts = _expand(master, {"child-1": child})
    assert [a.notebook_id for a in acts if a.notebook_id] == ["nb-a", "nb-b"]


def test_the_canvas_spelling_of_the_reference_works_too():
    """InvokePipeline stores `pipelineId`; ExecutePipeline a PipelineReference."""
    child = definition([_notebook("run nb_a", "nb-a")])
    master = definition([_invoke("invoke child", "child-1", canvas=True)])
    assert [a.notebook_id for a in _expand(master, {"child-1": child})if a.notebook_id] == ["nb-a"]


def test_the_invoking_step_is_kept_so_the_structure_stays_visible():
    child = definition([_notebook("run nb_a", "nb-a")])
    master = definition([_invoke("invoke child", "child-1")])
    acts = _expand(master, {"child-1": child})
    assert "invoke child" in [a.name for a in acts]
    # And the child's work is named under it, so two parents invoking the same
    # pipeline stay distinct nodes rather than colliding on `dependsOn`.
    assert "invoke child / run nb_a" in [a.name for a in acts]


def test_what_followed_the_invoke_waits_for_the_whole_child():
    """Splicing, not appending.

    `waitOnCompletion` is what the pipeline means. If the step after the invoke
    kept depending on the invoke itself, it would race the child's contents
    instead of following them — a sequence silently turned into a fork.
    """
    child = definition([_notebook("run nb_a", "nb-a"), _notebook("run nb_b", "nb-b", ["run nb_a"])])
    master = definition(
        [_invoke("invoke child", "child-1"), _notebook("run after", "nb-z", ["invoke child"])]
    )
    acts = {a.name: a for a in _expand(master, {"child-1": child})}
    # the child's LEAF, not the invoke
    assert acts["run after"].depends_on == ["invoke child / run nb_b"]
    # and nothing in the child starts before the invoke would have
    assert acts["invoke child / run nb_a"].depends_on == ["invoke child"]


def test_three_levels_deep_all_come_back():
    """The shape the demo fixture actually has: master -> bronze -> dimensions."""
    leaf = definition([_notebook("run nb_dim", "nb-dim")])
    mid = definition([_invoke("invoke dims", "leaf-1")])
    master = definition([_invoke("invoke bronze", "mid-1")])
    acts = _expand(master, {"mid-1": mid, "leaf-1": leaf})
    assert [a.notebook_id for a in acts if a.notebook_id] == ["nb-dim"]
    assert "invoke bronze / invoke dims / run nb_dim" in [a.name for a in acts]


def test_a_cycle_stops_rather_than_recursing_forever():
    """A pipeline that invokes itself is a mistake, not a reason to hang."""
    library: dict[str, dict] = {}
    library["self-1"] = definition([_invoke("invoke self", "self-1")])
    acts = _expand(library["self-1"], library)
    assert [a.name for a in acts].count("invoke self") == 1


def test_an_unreadable_child_is_a_step_not_a_failure():
    def fetch(_ws: str, _item: str) -> dict:
        raise RuntimeError("403 from Fabric")

    from app.fabric.pipelines import expand_pipeline_activities

    master = definition([_invoke("invoke child", "child-1")])
    acts = expand_pipeline_activities(master, fetch, workspace_id="ws-1")
    assert [a.name for a in acts] == ["invoke child"]
