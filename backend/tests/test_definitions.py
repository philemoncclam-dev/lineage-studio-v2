"""Spreadsheet import and fuzzy matching.

The matching tests carry the weight here: parsing a two-column sheet is dull,
but deciding that `Customer Id` means `customer_id` while `customer_name` does
not is where an import quietly corrupts a catalog. Every case below is a
spelling a governance spreadsheet has plausibly used.
"""

from __future__ import annotations

import pytest
from openpyxl import Workbook

from app.purview.definitions import (
    CONFIDENT,
    DESCRIPTION_ATTRIBUTE,
    DefinitionImportError,
    SheetRow,
    TargetColumn,
    build_write_session,
    match_rows,
    normalise,
    parse_definitions,
    similarity,
)

COLUMNS = [
    TargetColumn(guid="c-1", name="order_id"),
    TargetColumn(guid="c-2", name="customer_id"),
    TargetColumn(guid="c-3", name="amount"),
    TargetColumn(guid="c-4", name="order_date"),
]


def _xlsx(tmp_path, rows) -> bytes:
    book = Workbook()
    sheet = book.active
    for row in rows:
        sheet.append(row)
    path = tmp_path / "defs.xlsx"
    book.save(path)
    return path.read_bytes()


# --- parsing -----------------------------------------------------------


def test_reads_name_and_description_from_the_first_two_columns(tmp_path):
    data = _xlsx(tmp_path, [("order_id", "The order key"), ("amount", "Gross value")])
    rows = parse_definitions("defs.xlsx", data)
    assert [(r.name, r.description) for r in rows] == [
        ("order_id", "The order key"),
        ("amount", "Gross value"),
    ]


def test_a_header_row_is_recognised_and_dropped(tmp_path):
    data = _xlsx(tmp_path, [("Column Name", "Description"), ("amount", "Gross value")])
    assert [r.name for r in parse_definitions("defs.xlsx", data)] == ["amount"]


def test_extra_columns_are_ignored_rather_than_rejected(tmp_path):
    """Real sheets carry owner, PII flags, steward — none of it is our business."""
    data = _xlsx(tmp_path, [("amount", "Gross value", "finance", "no")])
    rows = parse_definitions("defs.xlsx", data)
    assert rows[0].description == "Gross value"


def test_blank_and_descriptionless_rows_are_skipped(tmp_path):
    """An empty definition is not an instruction to blank the catalog."""
    data = _xlsx(tmp_path, [(None, None), ("amount", None), ("order_id", "The key")])
    assert [r.name for r in parse_definitions("defs.xlsx", data)] == ["order_id"]


def test_csv_is_accepted_too():
    data = b"Name,Description\norder_id,The order key\n"
    rows = parse_definitions("defs.csv", data)
    assert [(r.name, r.description) for r in rows] == [("order_id", "The order key")]


def test_an_unsupported_extension_is_refused_clearly():
    with pytest.raises(DefinitionImportError):
        parse_definitions("defs.xls", b"\x00")


# --- normalisation and scoring ----------------------------------------


@pytest.mark.parametrize(
    "spelling", ["customer_id", "Customer Id", "CustomerId", "CUSTOMER-ID", " customer id "]
)
def test_every_common_spelling_folds_to_one_form(spelling):
    assert normalise(spelling) == "customerid"


def test_spelling_differences_score_as_a_perfect_match():
    assert similarity("Customer Id", "customer_id") == 1.0
    assert similarity("CustomerID", "customer_id") == 1.0


def test_reordered_tokens_are_recognised_but_not_claimed_as_exact():
    """`Date Of Order` is `order_date`, yet a character ratio barely sees it."""
    score = similarity("Order Date", "date_order")
    assert score >= CONFIDENT
    assert score < 1.0


def test_unrelated_names_score_low():
    assert similarity("amount", "customer_id") < 0.5


# --- matching ----------------------------------------------------------


def test_exact_matches_are_preselected():
    proposals = match_rows([SheetRow("Customer Id", "Who ordered")], COLUMNS)
    assert proposals[0].column_name == "customer_id"
    assert proposals[0].status == "exact"
    assert proposals[0].selected is True


def test_a_row_matching_nothing_is_returned_not_dropped():
    """A silently discarded row looks identical to one that imported fine."""
    proposals = match_rows([SheetRow("shipping_carrier", "Who ships it")], COLUMNS)
    assert proposals[0].status == "unmatched"
    assert proposals[0].column_guid is None
    assert proposals[0].selected is False


def test_a_near_miss_is_proposed_but_left_for_the_user_to_confirm():
    proposals = match_rows([SheetRow("order_idx", "The order key")], COLUMNS)
    assert proposals[0].column_name == "order_id"
    assert proposals[0].status in {"fuzzy", "ambiguous"}
    assert 0 < proposals[0].confidence < 1.0


def test_two_equally_plausible_targets_are_flagged_ambiguous_not_guessed():
    """`order_ref` sits equidistant from two suffixed columns — a coin flip.

    Both score high enough to look confident, which is exactly the case where
    auto-selecting would write a definition onto the wrong column.
    """
    proposals = match_rows(
        [SheetRow("order_ref", "The order reference")],
        [
            TargetColumn(guid="c-1", name="order_ref_a"),
            TargetColumn(guid="c-2", name="order_ref_b"),
        ],
    )
    assert proposals[0].status == "ambiguous"
    assert proposals[0].selected is False
    assert proposals[0].alternatives


def test_a_column_is_claimed_by_only_one_row():
    proposals = match_rows(
        [SheetRow("customer_id", "Who ordered"), SheetRow("customer_ids", "Also that")],
        COLUMNS,
    )
    claimed = [p.column_guid for p in proposals if p.column_guid]
    assert len(claimed) == len(set(claimed))


def test_the_strongest_row_wins_a_contested_column_regardless_of_sheet_order():
    """Row order in a spreadsheet is arbitrary; the outcome must not depend on it."""
    weak_first = match_rows(
        [SheetRow("amountx", "weak"), SheetRow("Amount", "strong")],
        [TargetColumn(guid="c-3", name="amount")],
    )
    assert weak_first[1].column_guid == "c-3"
    assert weak_first[1].description == "strong"
    assert weak_first[0].column_guid is None


def test_every_row_comes_back_in_sheet_order():
    rows = [SheetRow("amount", "a"), SheetRow("zzz", "b"), SheetRow("order_id", "c")]
    proposals = match_rows(rows, COLUMNS)
    assert [p.source_name for p in proposals] == ["amount", "zzz", "order_id"]


# --- pushing -----------------------------------------------------------


def test_the_push_updates_only_the_description_attribute():
    """A whole-entity PUT would round-trip and risk clobbering scan attributes."""
    from app.purview.definitions import Assignment

    session = build_write_session(
        [Assignment(column_guid="c-2", column_name="customer_id", description="Who ordered")]
    )
    result = session.run()
    op = result.to_dict()["operations"][0]

    assert result.dry_run is True
    assert op["verb"] == "PUT"
    assert op["path"] == f"/atlas/v2/entity/guid/c-2?name={DESCRIPTION_ATTRIBUTE}"
    assert op["body"] == "Who ordered"
    assert "customer_id" in op["describes"]
