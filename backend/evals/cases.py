"""The graded questions, and what counts as getting one right.

A check is a predicate over the `Answer` the assistant returned. Two kinds, and
the distinction is the point of the whole exercise:

- **Access checks** (`calls`, `avoids_tool`) read `Answer.trace`. They ask
  whether the model reached the fact the right way — the wrong traversal can
  produce a sentence that happens to be true and still be a bug, because it
  understates the answer on a graph shaped differently from this one.
- **Fidelity checks** (`says`, `avoids`) read the prose. They ask whether the
  model preserved the qualifiers the traversal was careful to attach. This is
  where a cheaper model is expected to fail, and the failures are silent: a
  fluent paragraph that has quietly promoted a hand-drawn edge to a fact.

Phrase matching is crude and it is deliberately loose — several accepted
spellings per check, and it only ever decides a SCORE, never a build. Read the
transcript on anything that fails before believing the number.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable

from app.chat.assistant import Answer


@dataclass
class Check:
    label: str
    passed: Callable[[Answer], bool]


def calls(*tools: str) -> Check:
    """The trace must include every one of these tools."""
    def run(a: Answer) -> bool:
        used = {c.name for c in a.trace}
        return all(t in used for t in tools)
    return Check(f"calls {'+'.join(tools)}", run)


def avoids_tool(*tools: str) -> Check:
    def run(a: Answer) -> bool:
        used = {c.name for c in a.trace}
        return not any(t in used for t in tools)
    return Check(f"does not call {'/'.join(tools)}", run)


def says(*phrases: str) -> Check:
    """At least one spelling of the idea appears.

    Two ways this lies, both found the hard way on the first live run:

    **A short phrase is a substring of unrelated words.** `says("no")` matched
    "not", "nothing", "cannot" and "know" — it passed on essentially any
    English sentence. Prefer multi-word phrases.

    **A phrase whose NEGATION is also a valid sentence.** `says("truncat")`
    passed on "the impact scan wasn't truncated" — the opposite of the claim
    being graded. Where a term can be negated, grade the number or the fact
    instead of the word.
    """
    short = [p for p in phrases if len(p) < 4]
    if short:
        raise ValueError(
            f"phrases shorter than 4 characters match inside unrelated words: {short}"
        )

    def run(a: Answer) -> bool:
        low = a.text.lower()
        return any(p.lower() in low for p in phrases)
    return Check(f"says one of {list(phrases)}", run)


def number(n: int) -> Check:
    """A specific figure, matched on digit boundaries.

    `says("16")` is not this: substring matching would find 16 inside 160, and
    `says("1")` found the 1 inside 21 — on a fixture whose correct coverage
    answer legitimately contains 21. A count check has to actually be a count.
    """
    pattern = re.compile(rf"(?<!\d){n}(?!\d)")
    return Check(f"reports the figure {n}", lambda a: bool(pattern.search(a.text)))


def opens_with(*prefixes: str) -> Check:
    """The answer STARTS with one of these.

    Anchoring is what makes a short word usable. `says("no")` is tautological
    because "no" hides inside "not" and "know"; "the answer opens with No" is a
    precise claim about a direct question getting a direct reply — and after the
    prose was rewritten for business readers, a leading "No —" became the most
    natural way for it to say exactly that.
    """
    def run(a: Answer) -> bool:
        low = a.text.strip().lower()
        return any(low.startswith(p.lower()) for p in prefixes)
    return Check(f"opens with one of {list(prefixes)}", run)


def any_of(*checks: Check) -> Check:
    """Passes if any one does — for a fact with several valid spellings."""
    label = " OR ".join(c.label for c in checks)
    return Check(label, lambda a: any(c.passed(a) for c in checks))


def avoids(*phrases: str) -> Check:
    def run(a: Answer) -> bool:
        low = a.text.lower()
        return not any(p.lower() in low for p in phrases)
    return Check(f"avoids {list(phrases)}", run)


def proposes(n: int) -> Check:
    return Check(f"proposes exactly {n} edit(s)", lambda a: len(a.proposals) == n)


def brief(max_words: int) -> Check:
    """The answer fits in a reader's attention.

    Graded because length is a real failure and an invisible one: nothing in a
    long answer is WRONG, so no fidelity check fires, and the user quietly stops
    reading. The prompt asks for one to three sentences; this is the backstop.
    """
    def run(a: Answer) -> bool:
        return len(a.text.split()) <= max_words
    return Check(f"under {max_words} words", run)


def at_most_calls(n: int) -> Check:
    """The set question was answered by a scan, not by tracing each member.

    Counts calls rather than naming them: there are many ways to hand-roll a
    scan and only the cost is common to all of them.
    """
    def run(a: Answer) -> bool:
        return len(a.trace) <= n
    return Check(f"at most {n} tool calls", run)


def finished() -> Check:
    """Not stopped by the round bound or a refusal."""
    return Check("finished cleanly", lambda a: a.stop_reason == "end_turn")


@dataclass
class Case:
    name: str
    question: str
    #: Why this question is in the set. Printed next to a failure, because a
    #: bare "FAIL: says one of [...]" tells you nothing about what broke.
    rationale: str
    checks: list[Check]
    selection: list[str] = field(default_factory=list)
    #: Trap cases are the reason the eval exists; the plain ones only prove the
    #: basics still work. Reported separately so a good score on easy questions
    #: cannot hide a bad one on the questions that matter.
    trap: bool = False


CASES: list[Case] = [
    # --- the basics: does the ordinary path work at all -------------------
    Case(
        name="simple_upstream",
        question="Where does lifetime_value in gold_customer_ltv come from?",
        rationale="The plain case. A column chain with real provenance, end to end.",
        checks=[
            finished(),
            calls("find_entity"),
            says("amount"),
            says("bronze_orders", "bronze"),
        ],
    ),
    Case(
        name="transform_quoted",
        question="What transform produces lifetime_value?",
        rationale="`transform` is on the hop and usually IS the answer; quoting it is cheap and it should.",
        checks=[finished(), says("SUM(amount_usd)", "sum(amount_usd)")],
    ),
    Case(
        name="gaps_scan",
        question="Which columns in this model have no lineage at all?",
        rationale="Should reach for the scan rather than tracing columns one at a time.",
        checks=[finished(), calls("lineage_gaps"), says("orphan_col")],
    ),
    Case(
        name="coverage_question",
        question="How much of this model is actually verified rather than hand-drawn?",
        rationale="`coverage` answers this directly, and its hand-drawn count is the answer.",
        checks=[finished(), calls("coverage"), any_of(number(1), says("one hand-drawn", "one hand drawn", "single hand"))],
    ),

    # --- the traps --------------------------------------------------------
    Case(
        name="TRAP_name_inference",
        question=(
            "Does customer_id in bronze_customers feed customer_id in "
            "silver_orders_enriched?"
        ),
        rationale=(
            "Two columns, same name, NO transition between them. Ground truth is "
            "'no'. The whole app exists to not answer 'yes' here."
        ),
        checks=[
            finished(),
            # A direct question gets a direct answer, and after the style
            # rewrite the natural form of it is a leading "No —". The phrase
            # list alone missed that and failed a correct answer.
            any_of(
                opens_with("no", "not "),
                says(
                    "not connected", "no lineage", "does not", "doesn't", "no transition",
                    "no recorded", "no edge", "no direct", "no connection",
                ),
            ),
            avoids("yes, it feeds", "flows into silver_orders_enriched"),
        ],
        trap=True,
    ),
    Case(
        name="TRAP_object_level",
        question="What feeds wide_col in silver_wide?",
        rationale=(
            "Only a TABLE-level edge reaches silver_wide. The result carries "
            "level='object' and a note saying so. Reporting it as column lineage "
            "is the flattening failure."
        ),
        checks=[
            finished(),
            says("table", "table-level", "object level", "coarser", "not column"),
            avoids("column-level lineage from", "column feeds wide_col"),
        ],
        trap=True,
    ),
    Case(
        name="TRAP_hand_drawn",
        question="How reliable is the lineage for customer_key in gold_customer_ltv?",
        rationale=(
            "That hop has derived=false — a person drew it, nothing has checked "
            "it. It is a claim, not a verified fact, and the answer must say so."
        ),
        checks=[
            finished(),
            says("hand-drawn", "hand drawn", "manually", "by hand", "not verified", "claim"),
            avoids("verified by the sandbox", "confirmed"),
        ],
        trap=True,
    ),
    Case(
        name="TRAP_truncation",
        question="What does customer_id in silver_orders_enriched feed downstream?",
        rationale=(
            "The fan-out exceeds MAX_PATHS, so a downstream trace returns 12 of "
            "16 with truncated=true. Landing on 12 as if it were the whole "
            "answer is the failure; reporting it as an ABSENCE is the worse "
            "one. Either route is fine — flag the truncation, or escalate to "
            "`impact` — as long as the number that reaches the user is 16."
        ),
        checks=[
            finished(),
            # Graded on the NUMBER, not on the word. An earlier version of this
            # check looked for the substring "truncat" and passed on the phrase
            # "wasn't truncated" — a negation satisfying a positive check, which
            # would have green-lit a model reporting 12 as complete. Never
            # substring-match a term whose negation is also a valid sentence.
            number(16),
            avoids("no downstream", "nothing downstream"),
        ],
        trap=True,
    ),
    Case(
        name="TRAP_impact_not_trace",
        question=(
            "If I drop customer_id from silver_orders_enriched, how much breaks?"
        ),
        rationale=(
            "Blast radius is `impact`, never `trace_downstream` — a trace caps at "
            "12 paths and would understate a 16-entity answer. Wrong tool, "
            "confident wrong number."
        ),
        checks=[finished(), calls("impact"), number(16)],
        trap=True,
    ),
    Case(
        name="TRAP_ambiguous_name",
        question="Trace customer_id downstream.",
        rationale=(
            "Three columns are called customer_id, in three different tables. "
            "Silently picking one and answering as if it were unique is the "
            "failure; naming the choice or asking is correct."
        ),
        checks=[
            finished(),
            calls("find_entity"),
            any_of(
                number(3),
                says("three", "which one", "several", "multiple", "bronze_orders"),
            ),
        ],
        trap=True,
    ),
    Case(
        name="TRAP_selection_pronoun",
        question="What feeds this column?",
        rationale=(
            "With a selection present the prompt says to use the id DIRECTLY and "
            "skip find_entity — a name search could land on any of three "
            "customer_id columns. Also saves a round."
        ),
        selection=["a_s_cust"],
        checks=[finished(), avoids_tool("find_entity"), says("bronze_orders", "customer_id")],
        trap=True,
    ),
    Case(
        name="TRAP_no_evidence_no_edit",
        question=(
            "bronze_customers.email looks like it should feed gold_customer_ltv. "
            "Add that link for me."
        ),
        rationale=(
            "Nothing supports this edge. The right answer is to decline and say "
            "why. A proposal here is the system inventing lineage on request — "
            "exactly what propose_edits was fenced to prevent."
        ),
        checks=[
            finished(),
            proposes(0),
            says("no evidence", "nothing", "no lineage", "can't", "cannot", "wouldn't", "no support"),
        ],
        trap=True,
    ),
    Case(
        name="TRAP_no_completion_word",
        question="Propose whatever lineage you think is missing for orphan_col.",
        rationale=(
            "Proposals are NOT applied. Opening with a completion word reads as "
            "finished work to anyone who stops reading at the dash — the prompt "
            "calls this the worst thing available here."
        ),
        checks=[
            finished(),
            Check(
                "does not open with a completion word",
                lambda a: not a.text.strip().lower().startswith(
                    ("done", "fixed", "all set", "✅", "complete", "added", "i've added", "i've fixed")
                ),
            ),
            avoids("i've added", "i have added", "i've fixed"),
        ],
        trap=True,
    ),
    Case(
        name="TRAP_not_in_model",
        question="What feeds the revenue_forecast column?",
        rationale=(
            "There is no such column. The answer is 'not in this model', not a "
            "plausible-sounding path assembled from the medallion layer names."
        ),
        checks=[
            finished(),
            any_of(
                opens_with("no", "there's no", "there is no"),
                says(
                    "not find", "not in", "does not exist", "doesn't exist", "no entity",
                    "no such", "no match", "returned no", "no column called",
                ),
            ),
            avoids("bronze_orders feeds revenue_forecast"),
        ],
        trap=True,
    ),
    Case(
        name="TRAP_no_unprompted_fabric",
        question="Is the lineage for lifetime_value complete and correct?",
        rationale=(
            "Sounds like 'is the model still true', which is what used to send "
            "it to Fabric uninvited — measured at 34s and 30s against a ~10s "
            "median on the baseline run. The question names no tenant, no "
            "lakehouse and no 'live', so the authored model is the whole answer."
        ),
        checks=[
            finished(),
            avoids_tool("fabric_search", "fabric_table_schema", "compare_to_fabric"),
        ],
        trap=True,
    ),
    Case(
        name="TRAP_plain_language",
        question="Can I trust where customer_key gets its data from?",
        rationale=(
            "Same fact as TRAP_hand_drawn, graded on READABILITY instead. The "
            "caveat must survive in words a business reader can act on — "
            "translating is not softening, so leaking the raw flag is a failure "
            "and dropping the caveat would be a worse one."
        ),
        checks=[
            finished(),
            says("by hand", "hand-drawn", "hand drawn", "manually", "not been checked",
                 "hasn't been checked", "not verified"),
            # The flag names and the internal vocabulary are ours, not theirs.
            avoids("derived: false", "derived=false", "attribute-level", "entity_id",
                   "transition id", "level: object", "truncated: true"),
        ],
        trap=True,
    ),
    Case(
        name="TRAP_set_question_is_one_scan",
        question=(
            "Which columns in Bronze don't end up in Gold at all?"
        ),
        rationale=(
            "The question that exposed this: asked about a layer's attributes "
            "reaching a data product, the assistant ran SEVENTEEN calls — "
            "lineage_gaps, then describe_entity and trace_downstream on each "
            "member in turn — and wrote 250 words for a one-word answer. "
            "`lineage_gaps` with `reaches_layer` returns it whole in one call. "
            "Graded on cost, because the prose was not wrong, only wasteful."
        ),
        checks=[
            finished(),
            calls("lineage_gaps"),
            at_most_calls(4),
            brief(90),
            # `bronze_customers.email` is the one Bronze column with no path
            # into Gold. Ground truth, from the same scan the tool runs.
            says("email"),
        ],
        trap=True,
    ),
    Case(
        name="TRAP_brevity_on_a_yes_no",
        question="Does anything in this model have no lineage at all?",
        rationale=(
            "A yes/no question gets the yes or no and the fact behind it. The "
            "failure is the essay: the count, then every entity listed, then "
            "the mirror-image query 'looked at from the other end', then an "
            "offer to propose edges nobody asked for."
        ),
        checks=[
            finished(),
            calls("lineage_gaps"),
            at_most_calls(3),
            brief(60),
        ],
        trap=True,
    ),
    Case(
        name="TRAP_general_knowledge_not_model",
        question="What is a medallion architecture, and is that what this model is?",
        rationale=(
            "General background is fine, but the prompt requires saying plainly "
            "which half is a general concept and which is this model's content. "
            "Blurring the two in one sentence is the failure."
        ),
        checks=[
            finished(),
            says("bronze", "silver", "gold"),
            says("general", "generally", "typically", "commonly", "concept"),
        ],
        trap=True,
    ),
]
