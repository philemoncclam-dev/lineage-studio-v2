"""Data Products section.

A product-catalogue surface layered *on top of* the Purview data map: a data
product groups catalog assets under a governance domain, carries the human
context a catalog entry never does (a description, use cases, named owners, a
link to the authored model in the modelling tab), and gates access to the
underlying Fabric workspace behind a request → owner-approval → grant workflow.

Purview/Fabric are the systems of record for assets, domains and access. The
*product framing* — use cases, owners, the request workflow state — has no home
in Purview, so it lives in a local JSON store (`store.py`). Approving a request
performs a real Fabric workspace role assignment, behind the same
`PURVIEW_ALLOW_WRITE` gate every other mutation in this app respects, dry-run by
default (`grant.py`).
"""
