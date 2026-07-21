"""Microsoft Purview ingest and lineage-push integration.

Read paths build a `LineageGraph` from the Purview data map; the write path
(gated behind `PURVIEW_ALLOW_WRITE`) pushes lineage back into it.

Note on Unified Catalog: governance domains, data products and glossary terms
are a layer *above* the data map, but lineage and column schema are still read
and written through the data map API — so that is the only surface used here.
"""
