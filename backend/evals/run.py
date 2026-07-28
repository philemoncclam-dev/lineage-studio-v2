"""Run the graded questions against a live provider and score the result.

    .venv/Scripts/python -m evals.run                    # configured model
    .venv/Scripts/python -m evals.run --model claude-haiku-4-5
    .venv/Scripts/python -m evals.run --repeat 3         # non-determinism
    .venv/Scripts/python -m evals.run --only TRAP_       # one family
    .venv/Scripts/python -m evals.run --transcript out.json

Two scores are reported, never one. Trap cases and plain cases are counted
separately because they answer different questions: the plain score says the
assistant works, the trap score says it can be trusted. A model that aces the
first and fails the second is the exact failure this repo is built to avoid,
and a single blended number would hide it.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass

from app.chat.assistant import Answer, AssistantError, Message, ask
from app.chat.providers import ProviderError
from app.chat.providers import build as build_provider
from app.config import Settings, get_settings
from evals.cases import CASES, Case
from evals.fixtures import eval_model


@dataclass
class Result:
    case: Case
    answer: Answer | None
    failures: list[str]
    error: str | None
    seconds: float

    @property
    def ok(self) -> bool:
        return self.error is None and not self.failures


def run_case(case: Case, model, provider) -> Result:
    started = time.monotonic()
    try:
        answer = ask(
            model,
            [Message(role="user", content=case.question)],
            selection=case.selection,
            provider=provider,
        )
    except (AssistantError, ProviderError) as exc:
        return Result(case, None, [], str(exc), time.monotonic() - started)

    failures = [c.label for c in case.checks if not c.passed(answer)]
    return Result(case, answer, failures, None, time.monotonic() - started)


def _report(results: list[Result], repeat: int) -> int:
    for r in results:
        mark = "PASS" if r.ok else "FAIL"
        rounds = len(r.answer.trace) if r.answer else 0
        print(f"\n[{mark}] {r.case.name}  ({r.seconds:.1f}s, {rounds} tool calls)")
        print(f"       Q: {r.case.question}")
        if r.error:
            print(f"       ERROR: {r.error}")
            continue
        assert r.answer is not None
        if r.failures:
            # The rationale matters more than the failed label — it says what
            # the question was probing, which is what you need to judge whether
            # the model was actually wrong or the phrase match was too strict.
            print(f"       WHY IT MATTERS: {r.case.rationale}")
            for f in r.failures:
                print(f"       missed: {f}")
            print(f"       trace: {[c.name for c in r.answer.trace]}")
            print(f"       said: {r.answer.text[:400]}")

    traps = [r for r in results if r.case.trap]
    plain = [r for r in results if not r.case.trap]
    errors = [r for r in results if r.error]

    def score(rs: list[Result]) -> str:
        if not rs:
            return "n/a"
        good = sum(1 for r in rs if r.ok)
        return f"{good}/{len(rs)} ({100 * good // len(rs)}%)"

    total = sum(r.seconds for r in results)
    print("\n" + "=" * 64)
    print(f"  fidelity traps : {score(traps)}   <- the number that matters")
    print(f"  plain cases    : {score(plain)}")
    print(f"  errors         : {len(errors)}")
    print(f"  wall clock     : {total:.0f}s total, {total / max(len(results), 1):.1f}s/question")
    if repeat > 1:
        print(f"  (each case run {repeat}x; any run failing marks the case failed)")
    print("=" * 64)
    print("\nA failed check is a prompt to go READ the transcript, not a verdict.")
    print("Phrase matching is loose and the model may be right in words the")
    print("check did not anticipate — fix the check when that happens.\n")
    return 1 if traps and any(not r.ok for r in traps) else 0


def main() -> int:
    # The answers are full of em-dashes and arrows, and a Windows console
    # defaults to cp1252 — which does not just mangle them, it raises
    # UnicodeEncodeError mid-report and loses the results of a paid run.
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", help="override the configured model id")
    parser.add_argument("--repeat", type=int, default=1, help="runs per case")
    parser.add_argument("--only", default="", help="substring filter on case name")
    parser.add_argument("--transcript", help="write full answers to this JSON file")
    args = parser.parse_args()

    settings = get_settings()
    if args.model:
        # A copy, so the override cannot leak into the cached settings the rest
        # of the process reads.
        settings = Settings(**{**settings.model_dump(), "chat_model_name": args.model})

    if not settings.chat_configured:
        print(
            "No provider is configured. Set ANTHROPIC_API_KEY in the repo-root "
            ".env (or CHAT_API_KEY for the OpenAI-compatible path) and try again.",
            file=sys.stderr,
        )
        return 2

    cases = [c for c in CASES if args.only in c.name]
    if not cases:
        print(f"No case name contains {args.only!r}.", file=sys.stderr)
        return 2

    model = eval_model()
    print(f"model    : {settings.chat_model}")
    print(f"provider : {settings.chat_provider}")
    print(f"cases    : {len(cases)} x {args.repeat}")

    try:
        provider = build_provider(settings)
    except ProviderError as exc:
        print(f"\n{exc}", file=sys.stderr)
        return 2

    results: list[Result] = []
    for case in cases:
        # Every repeat must pass. A check that only holds sometimes is a check
        # that does not hold — this is a fidelity bar, not an average.
        runs = [run_case(case, model, provider) for _ in range(args.repeat)]
        results.append(next((r for r in runs if not r.ok), runs[0]))

    code = _report(results, args.repeat)

    if args.transcript:
        with open(args.transcript, "w", encoding="utf-8") as fh:
            json.dump(
                [
                    {
                        "case": r.case.name,
                        "question": r.case.question,
                        "ok": r.ok,
                        "failures": r.failures,
                        "error": r.error,
                        "seconds": round(r.seconds, 2),
                        "text": r.answer.text if r.answer else None,
                        "trace": [
                            {"name": c.name, "input": c.input, "result": c.result}
                            for c in (r.answer.trace if r.answer else [])
                        ],
                        "proposals": len(r.answer.proposals) if r.answer else 0,
                    }
                    for r in results
                ],
                fh,
                indent=2,
            )
        print(f"transcript written to {args.transcript}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
