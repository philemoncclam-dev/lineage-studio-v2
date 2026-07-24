// Mock-Fabric dev mode: a fetch-compatible function that returns realistic
// canned responses for the exact endpoints fabricConnector.ts and
// fabricScanner.ts call, so the whole sync/deep-scan flow is click-through-able
// in the browser with zero Microsoft tenant involvement. Activated by
// VITE_FABRIC_MOCK=1 (see fabricAuth.ts's isFabricMockMode()).
//
// Design: a thin interception layer, not a fork of the connector logic. Both
// fabricConnector.ts and fabricScanner.ts already take their fetch
// implementation as a parameter (fabricScanner's ScannerDeps.fetchImpl) or —
// for the plain per-workspace REST calls in fabricConnector.ts — read the
// module-level `fetch` global. To keep this "thin" per the requirement, we
// expose one function, `mockFetch`, shaped exactly like `fetch`, that pattern
// matches on the URL and returns the right canned Response. Callers swap it
// in only when isFabricMockMode() is true.
//
// Canned workspace: one lakehouse (2 tables: customers, orders), one
// warehouse (sales_summary, only visible via the deep-scan/Scanner API path
// exactly like a real tenant), and one semantic model (Sales Model) with
// columns + TMSL-derived lineage back to the lakehouse's customers table.

export const MOCK_WORKSPACE_ID = "mock-workspace-0000";

const LAKEHOUSE_ID = "mock-lakehouse-1";
const WAREHOUSE_ID = "mock-warehouse-1";
const SEMANTIC_MODEL_ID = "mock-semanticmodel-1";
const NOTEBOOK_ID = "mock-notebook-1";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k] ?? null } as Headers,
    json: async () => body,
  } as Response;
}

// OneLake Delta commit files are NDJSON read via res.text().
function textResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as Response;
}

const itemsBody = {
  value: [
    {
      id: LAKEHOUSE_ID,
      displayName: "SalesLakehouse",
      description: "Mock lakehouse with customer and order tables.",
      type: "Lakehouse",
      workspaceId: MOCK_WORKSPACE_ID,
    },
    {
      id: WAREHOUSE_ID,
      displayName: "SalesWarehouse",
      description: "Mock warehouse (tables only visible via deep scan).",
      type: "Warehouse",
      workspaceId: MOCK_WORKSPACE_ID,
    },
    {
      id: SEMANTIC_MODEL_ID,
      displayName: "Sales Model",
      description: "Mock semantic model sourced from the lakehouse.",
      type: "SemanticModel",
      workspaceId: MOCK_WORKSPACE_ID,
    },
  ],
};

const lakehouseTablesBody = {
  data: [
    { type: "Managed", name: "customers", format: "Delta", location: "abfss://mock/customers" },
    { type: "Managed", name: "orders", format: "Delta", location: "abfss://mock/orders" },
  ],
};

function base64(json: unknown): string {
  const str = JSON.stringify(json);
  if (typeof btoa === "function") return btoa(str);
  return Buffer.from(str, "utf-8").toString("base64");
}

const semanticModelTmsl = {
  model: {
    tables: [
      {
        name: "Customer",
        columns: [
          { name: "CustomerId", dataType: "int64", sourceColumn: "id" },
          { name: "Email", dataType: "string", sourceColumn: "email" },
          { name: "SignupDate", dataType: "dateTime", sourceColumn: "signup_date" },
        ],
        partitions: [{ name: "p1", source: { entityName: "customers" } }],
      },
      {
        name: "Order",
        columns: [
          { name: "OrderId", dataType: "int64", sourceColumn: "id" },
          { name: "CustomerId", dataType: "int64", sourceColumn: "customer_id" },
          { name: "Amount", dataType: "double", sourceColumn: "amount" },
        ],
        partitions: [{ name: "p1", source: { entityName: "orders" } }],
      },
    ],
  },
};

const semanticModelDefinitionBody = {
  definition: {
    parts: [
      {
        path: "definition/model.bim",
        payload: base64(semanticModelTmsl),
        payloadType: "InlineBase64",
      },
    ],
  },
};

// ── Notebook (transformations) canned responses ─────────────────────────────
// One notebook that reads the lakehouse's customers + orders tables and writes
// two staged tables (orders_enriched, then customer_ltv from it) — exercises
// both known-table matching and staged-table creation.
const notebookItemsBody = {
  value: [
    {
      id: NOTEBOOK_ID,
      displayName: "Build customer LTV",
      description: "Joins customers + orders, materializes LTV.",
      type: "Notebook",
      workspaceId: MOCK_WORKSPACE_ID,
    },
  ],
};

const notebookIpynb = {
  cells: [
    {
      cell_type: "code",
      source: [
        'customers = spark.read.table("customers")\n',
        'orders = spark.read.format("delta").load("Tables/orders")\n',
        'enriched = customers.join(orders, "id")\n',
        'enriched.write.mode("overwrite").saveAsTable("orders_enriched")\n',
      ],
    },
    {
      cell_type: "code",
      source:
        'spark.sql("CREATE TABLE customer_ltv AS SELECT customer_id, sum(amount) AS ltv FROM orders_enriched GROUP BY customer_id")',
    },
  ],
};

const notebookDefinitionBody = {
  definition: {
    parts: [
      {
        path: "notebook-content.ipynb",
        payload: base64(notebookIpynb),
        payloadType: "InlineBase64",
      },
    ],
  },
};

// ── OneLake DFS (Delta-log schema) canned responses ─────────────────────────
// Mirrors the ADLS Gen2 surface oneLake.ts calls: a _delta_log listing per
// lakehouse table, plus each commit file's NDJSON (metaData.schemaString).
const deltaSchemas: Record<string, { name: string; type: string; nullable: boolean }[]> = {
  customers: [
    { name: "id", type: "long", nullable: false },
    { name: "email", type: "string", nullable: true },
    { name: "signup_date", type: "timestamp", nullable: true },
  ],
  orders: [
    { name: "id", type: "long", nullable: false },
    { name: "customer_id", type: "long", nullable: false },
    { name: "amount", type: "double", nullable: true },
  ],
};

function deltaLogListing(table: string) {
  return {
    paths: [
      { name: `${LAKEHOUSE_ID}/Tables/${table}/_delta_log/00000000000000000000.json` },
      { name: `${LAKEHOUSE_ID}/Tables/${table}/_delta_log/_last_checkpoint` },
    ],
  };
}

function deltaCommitBody(table: string): string {
  const schemaString = JSON.stringify({
    type: "struct",
    fields: deltaSchemas[table],
  });
  return [
    JSON.stringify({ commitInfo: { operation: "CREATE TABLE" } }),
    JSON.stringify({ metaData: { id: `mock-meta-${table}`, format: { provider: "parquet" }, schemaString } }),
  ].join("\n");
}

// ── Admin Scanner API (deep scan) canned responses ──────────────────────────
const SCAN_ID = "mock-scan-1";

const scanResultBody = {
  workspaces: [
    {
      id: MOCK_WORKSPACE_ID,
      name: "Mock workspace",
      lakehouses: [
        {
          id: LAKEHOUSE_ID,
          name: "SalesLakehouse",
          tables: [
            {
              name: "customers",
              columns: [
                { name: "id", dataType: "int64" },
                { name: "email", dataType: "string" },
                { name: "signup_date", dataType: "dateTime" },
              ],
            },
            {
              name: "orders",
              columns: [
                { name: "id", dataType: "int64" },
                { name: "customer_id", dataType: "int64" },
                { name: "amount", dataType: "double" },
              ],
            },
          ],
        },
      ],
      warehouses: [
        {
          id: WAREHOUSE_ID,
          name: "SalesWarehouse",
          tables: [
            {
              name: "sales_summary",
              columns: [
                { name: "customer_id", dataType: "int64" },
                { name: "total_amount", dataType: "double" },
                { name: "order_count", dataType: "int64" },
              ],
              source: { entityName: "orders" },
            },
          ],
        },
      ],
    },
  ],
};

/**
 * fetch-compatible mock implementation. Pattern-matches the same URLs the
 * real connector/scanner build, in the same order those modules issue them,
 * so no other code needs to know mock mode is active.
 */
export const mockFetch: typeof fetch = async (input, _init) => {
  const url = typeof input === "string" ? input : input.toString();

  // OneLake DFS: _delta_log listing + commit-file reads (see oneLake.ts), plus
  // the Phase 2 runtime result file the helper notebook "wrote".
  if (url.includes("onelake.dfs.fabric.microsoft.com")) {
    if (url.includes("/Files/lineage/")) {
      return textResponse(
        JSON.stringify({
          notebooks: [
            {
              id: NOTEBOOK_ID,
              name: "Build customer LTV",
              reads: ["customers", "orders"],
              writes: ["orders_enriched", "customer_ltv"],
            },
          ],
        })
      );
    }
    const listMatch = url.match(/directory=([^&]+)/);
    if (listMatch) {
      const dir = decodeURIComponent(listMatch[1]);
      const table = dir.match(/Tables\/([^/]+)\/_delta_log/)?.[1];
      if (table && deltaSchemas[decodeURIComponent(table)]) {
        return jsonResponse(deltaLogListing(decodeURIComponent(table)));
      }
      return jsonResponse({ paths: [] });
    }
    const commitMatch = url.match(/Tables\/([^/]+)\/_delta_log\/\d{20}\.json$/);
    if (commitMatch && deltaSchemas[commitMatch[1]]) {
      return textResponse(deltaCommitBody(commitMatch[1]));
    }
    return jsonResponse({ message: `mockFetch: no OneLake response for ${url}` }, 404);
  }

  // Workspace list for the Sync dialog's picker. Must not catch the
  // per-workspace URLs (/workspaces/{id}/...), so match the bare collection.
  if (/\/v1\/workspaces(\?[^/]*)?$/.test(url)) {
    return jsonResponse({
      value: [
        { id: MOCK_WORKSPACE_ID, displayName: "Mock workspace" },
        { id: "mock-workspace-0001", displayName: "Finance analytics" },
        { id: "mock-workspace-0002", displayName: "Marketing sandbox" },
      ],
    });
  }

  // Phase 2 runtime: create helper notebook → run job → poll job.
  const runInit = (_init as RequestInit | undefined) ?? {};
  if (url.endsWith("/notebooks") && runInit.method === "POST") {
    return jsonResponse({ id: "mock-helper-nb" }, 201);
  }
  if (url.includes("/jobs/instances?jobType=RunNotebook")) {
    return jsonResponse({}, 202, {
      Location: `https://api.fabric.microsoft.com/v1/workspaces/${MOCK_WORKSPACE_ID}/items/mock-helper-nb/jobs/instances/mock-job-1`,
    });
  }
  if (url.includes("/jobs/instances/mock-job-1")) {
    return jsonResponse({ status: "Completed" });
  }

  if (url.includes("/items?type=Notebook")) return jsonResponse(notebookItemsBody);
  if (url.includes("/items?type=Lakehouse")) {
    return jsonResponse({
      value: [
        {
          id: LAKEHOUSE_ID,
          displayName: "SalesLakehouse",
          type: "Lakehouse",
          workspaceId: MOCK_WORKSPACE_ID,
        },
      ],
    });
  }
  if (url.includes(`/notebooks/${NOTEBOOK_ID}/getDefinition`)) {
    return jsonResponse(notebookDefinitionBody);
  }
  if (url.endsWith("/items")) return jsonResponse(itemsBody);
  if (url.includes(`/lakehouses/${LAKEHOUSE_ID}/tables`)) return jsonResponse(lakehouseTablesBody);
  if (url.includes(`/semanticModels/${SEMANTIC_MODEL_ID}/getDefinition`)) {
    return jsonResponse(semanticModelDefinitionBody);
  }
  if (url.includes("/admin/workspaces/getInfo")) {
    return jsonResponse({ id: SCAN_ID, status: "Running" });
  }
  if (url.includes(`/admin/workspaces/scanStatus/${SCAN_ID}`)) {
    return jsonResponse({ id: SCAN_ID, status: "Succeeded" });
  }
  if (url.includes(`/admin/workspaces/scanResult/${SCAN_ID}`)) {
    return jsonResponse(scanResultBody);
  }

  return jsonResponse({ message: `mockFetch: no canned response for ${url}` }, 404);
};

/** Instant no-op sleep so mock deep-scan polling never actually waits. */
export const mockSleep = async (_ms: number): Promise<void> => {};
