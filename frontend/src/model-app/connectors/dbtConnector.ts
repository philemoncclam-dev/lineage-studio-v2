// dbt connector: parses a manifest.json into the connector's flat node list.
//
// Mapping into the app's Layer > Object > Group > Attribute hierarchy:
//   Layer   — one synthetic "dbt: <project>" per sync
//   Object  — each dbt model / source / seed
//   Group   — one table per Object (same name), holding the columns
//   Attr    — each column of that model/source
//
// Column-level lineage is not present in manifest.json (it needs catalog.json /
// sqlglot analysis), and this canvas only renders attribute-to-attribute edges,
// so v1 syncs structure + metadata only — no edges. depends_on is captured in
// each object's metadata for reference.
import type { Connector, ConnectorNode, ConnectorEdge, ConnectorParseResult } from "./types";

interface DbtColumn {
  name?: string;
  description?: string;
  data_type?: string | null;
}
interface DbtNode {
  unique_id?: string;
  resource_type?: string;
  name?: string;
  database?: string | null;
  schema?: string | null;
  description?: string;
  columns?: Record<string, DbtColumn>;
  config?: { materialized?: string };
  depends_on?: { nodes?: string[] };
}
interface DbtManifest {
  metadata?: { project_name?: string };
  nodes?: Record<string, DbtNode>;
  sources?: Record<string, DbtNode>;
}

const LAYER_ID = "dbt:layer";

function objectNodes(manifest: DbtManifest): DbtNode[] {
  // Models, seeds, snapshots live under `nodes`; sources under `sources`. Skip
  // tests/analyses/etc. that don't represent a table.
  const wanted = new Set(["model", "seed", "snapshot", "source"]);
  const fromNodes = Object.values(manifest.nodes ?? {});
  const fromSources = Object.values(manifest.sources ?? {});
  return [...fromNodes, ...fromSources].filter(
    (n) => n.resource_type && wanted.has(n.resource_type)
  );
}

async function parse(input: File): Promise<ConnectorParseResult> {
  const text = await input.text();
  let manifest: DbtManifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new Error("Not valid JSON — expected a dbt manifest.json.");
  }
  if (!manifest.nodes && !manifest.sources) {
    throw new Error("This doesn't look like a dbt manifest (no nodes/sources).");
  }

  const project = manifest.metadata?.project_name ?? "dbt";
  const out: ConnectorNode[] = [];

  // One Layer per sync.
  out.push({
    externalId: LAYER_ID,
    parentExternalId: null,
    type: "Layer",
    name: `dbt: ${project}`,
  });

  const objects = objectNodes(manifest);
  // uid -> its column names (original case), for name-based column lineage below.
  const columnsByUid = new Map<string, string[]>();

  for (const node of objects) {
    const uid = node.unique_id;
    if (!uid) continue;
    const objName = node.name ?? uid;
    columnsByUid.set(
      uid,
      Object.entries(node.columns ?? {}).map(([k, c]) => c.name ?? k)
    );

    // Object (the model/source).
    out.push({
      externalId: uid,
      parentExternalId: LAYER_ID,
      type: "Object",
      name: objName,
      metadata: {
        resourceType: node.resource_type,
        database: node.database ?? undefined,
        schema: node.schema ?? undefined,
        materialized: node.config?.materialized,
        dependsOn: node.depends_on?.nodes ?? [],
        description: node.description || undefined,
      },
      seedDescription: node.description || undefined,
    });

    // Group (the table) under the Object.
    const groupExtId = `${uid}::table`;
    out.push({
      externalId: groupExtId,
      parentExternalId: uid,
      type: "Group",
      name: objName,
    });

    // Attributes (columns) under the Group.
    for (const [colName, col] of Object.entries(node.columns ?? {})) {
      const name = col.name ?? colName;
      out.push({
        externalId: `${uid}::${name}`,
        parentExternalId: groupExtId,
        type: "Attribute",
        name,
        metadata: {
          dataType: col.data_type ?? undefined,
          description: col.description || undefined,
        },
        seedDescription: col.description || undefined,
      });
    }
  }

  // Column-level lineage. manifest.json only carries table-level depends_on, so
  // we connect columns by matching name across a dependency (the common
  // pass-through case). Renames/derivations aren't captured without catalog.json
  // + SQL analysis — documented as a known limitation.
  const edges: ConnectorEdge[] = [];
  const known = new Set(objects.map((n) => n.unique_id));
  for (const node of objects) {
    const downUid = node.unique_id;
    if (!downUid) continue;
    const downCols = new Set(columnsByUid.get(downUid) ?? []);
    for (const upUid of node.depends_on?.nodes ?? []) {
      if (!known.has(upUid)) continue; // ignore deps we didn't materialize (tests, etc.)
      for (const upCol of columnsByUid.get(upUid) ?? []) {
        if (downCols.has(upCol)) {
          edges.push({
            sourceExternalId: `${upUid}::${upCol}`,
            targetExternalId: `${downUid}::${upCol}`,
          });
        }
      }
    }
  }

  return { nodes: out, edges };
}

export const dbtConnector: Connector = {
  id: "dbt",
  label: "dbt (manifest.json)",
  fileHint: "manifest.json",
  parse,
};
