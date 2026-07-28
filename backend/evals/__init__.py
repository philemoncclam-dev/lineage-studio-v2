"""Graded questions against a live model provider.

Deliberately NOT under `tests/`. Everything here costs real money and calls a
real API, and it is not deterministic — two runs of the same question can take
different tool paths and still both be right. Assertions are the wrong shape
for that, so this produces a SCORE rather than a pass/fail, and `pytest tests`
never collects it.

Run it with `python -m evals.run`.
"""
