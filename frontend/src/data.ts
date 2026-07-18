// Shared sample model that drives all three views. Later this comes from the
// backend (/graph, /ingest) and live Fabric pulls; the shapes stay stable.

export interface Col { key: string; name: string; type: string; pk?: boolean }
export interface Table { id: string; name: string; layer: string; c: ColorKey; x: number; y: number; columns: Col[] }
export interface NB { id: string; name: string; x: number; y: number }
export type ColorKey = 'bronze' | 'silver' | 'gold' | 'notebook' | 'workspace' | 'accent'

// ---- Lineage (DAG) view ----
export const TABLES: Table[] = [
  { id: 'raw', name: 'raw_orders', layer: 'bronze', c: 'bronze', x: 40, y: 70, columns: [
    { key: 'raw.order_id', name: 'order_id', type: 'long', pk: true },
    { key: 'raw.customer', name: 'customer', type: 'string' },
    { key: 'raw.amount', name: 'amount', type: 'double' },
    { key: 'raw.ts', name: 'ts', type: 'timestamp' },
  ] },
  { id: 'cust', name: 'customers', layer: 'bronze', c: 'bronze', x: 40, y: 300, columns: [
    { key: 'cust.customer_id', name: 'customer_id', type: 'long', pk: true },
    { key: 'cust.region', name: 'region', type: 'string' },
  ] },
  { id: 'clean', name: 'orders_clean', layer: 'silver', c: 'silver', x: 588, y: 120, columns: [
    { key: 'clean.order_id', name: 'order_id', type: 'long', pk: true },
    { key: 'clean.customer_name', name: 'customer_name', type: 'string' },
    { key: 'clean.amount', name: 'amount', type: 'double' },
    { key: 'clean.region', name: 'region', type: 'string' },
  ] },
  { id: 'rep', name: 'orders_report', layer: 'gold', c: 'gold', x: 836, y: 150, columns: [
    { key: 'rep.order_id', name: 'order_id', type: 'long' },
    { key: 'rep.customer_name', name: 'customer_name', type: 'string' },
    { key: 'rep.amount', name: 'amount', type: 'double' },
  ] },
]

export const NOTEBOOKS: NB[] = [{ id: 'nb', name: 'clean_orders', x: 314, y: 186 }]

// column-level flows: [from colKey, to colKey]
export const COL_EDGES: [string, string][] = [
  ['raw.order_id', 'clean.order_id'],
  ['raw.customer', 'clean.customer_name'],
  ['raw.amount', 'clean.amount'],
  ['cust.region', 'clean.region'],
  ['clean.order_id', 'rep.order_id'],
  ['clean.customer_name', 'rep.customer_name'],
  ['clean.amount', 'rep.amount'],
]

// table-level ops through the notebook: [source nodeId, target nodeId, kind]
export const OPS: [string, string, 'reads' | 'writes'][] = [
  ['raw', 'nb', 'reads'], ['cust', 'nb', 'reads'], ['nb', 'clean', 'writes'],
]

export const XFORM: Record<string, [string, string]> = {
  'clean.customer_name': ['upper(customer)', 'Uppercases the raw customer name for a consistent display format.'],
  'clean.region': ['customers.region', 'Brought in by joining customers on customer_id — enriches each order with its region.'],
  'clean.order_id': ['order_id', 'Passed through unchanged from raw_orders.'],
  'clean.amount': ['amount', 'Passed through; rows where amount ≤ 0 are filtered out upstream.'],
}

// ---- Knowledge graph / drill-down ----
export interface GNode { id: string; label: string; c: ColorKey; r: number; sub?: string; drill?: string }
export interface Level { level: string; crumb?: string; type: 'graph' | 'lineage'; nodes?: GNode[]; links?: [string, string, string][] }

export const LEVELS: Record<string, Level> = {
  estate: { level: 'Estate', type: 'graph',
    nodes: [
      { id: 'ws_an', label: 'Analytics', c: 'accent', r: 30, sub: '3 lakehouses · 14 tables', drill: 'ws:an' },
      { id: 'ws_fi', label: 'Finance', c: 'gold', r: 24, sub: '2 lakehouses · 9 tables', drill: 'ws:an' },
      { id: 'ws_mk', label: 'Marketing', c: 'notebook', r: 22, sub: '2 lakehouses · 7 tables', drill: 'ws:an' },
    ], links: [['ws_an', 'ws_fi', 'shared'], ['ws_an', 'ws_mk', 'shared']] },
  'ws:an': { level: 'Workspace', crumb: 'Analytics', type: 'graph',
    nodes: [
      { id: 'lh_b', label: 'Bronze', c: 'bronze', r: 20, sub: 'landing · 4 tables', drill: 'lake:s' },
      { id: 'lh_s', label: 'Silver', c: 'silver', r: 20, sub: 'processing · 3 tables', drill: 'lake:s' },
      { id: 'lh_g', label: 'Gold', c: 'gold', r: 20, sub: 'serving · 3 tables', drill: 'lake:s' },
      { id: 'nb_clean', label: 'clean_orders', c: 'notebook', r: 11, sub: 'notebook' },
      { id: 'nb_sess', label: 'sessionize_events', c: 'notebook', r: 10, sub: 'notebook' },
      { id: 'nb_c360', label: 'build_customer_360', c: 'notebook', r: 11, sub: 'notebook' },
      { id: 'nb_rev', label: 'daily_revenue', c: 'notebook', r: 10, sub: 'notebook' },
    ], links: [['lh_b', 'nb_clean', 'r'], ['nb_clean', 'lh_s', 'w'], ['lh_b', 'nb_sess', 'r'], ['nb_sess', 'lh_s', 'w'],
      ['lh_s', 'nb_c360', 'r'], ['nb_c360', 'lh_g', 'w'], ['lh_s', 'nb_rev', 'r'], ['nb_rev', 'lh_g', 'w']] },
  'lake:s': { level: 'Lakehouse', crumb: 'Silver', type: 'graph',
    nodes: [
      { id: 'orders_clean', label: 'orders_clean', c: 'silver', r: 13, sub: 'table · 4 cols', drill: 'tbl:oc' },
      { id: 'customers_dim', label: 'customers_dim', c: 'silver', r: 12, sub: 'table · 6 cols', drill: 'tbl:oc' },
      { id: 'events_sess', label: 'events_sessionized', c: 'silver', r: 12, sub: 'table · 5 cols', drill: 'tbl:oc' },
      { id: 'nb_clean', label: 'clean_orders', c: 'notebook', r: 10, sub: 'notebook' },
      { id: 'nb_sess', label: 'sessionize_events', c: 'notebook', r: 9, sub: 'notebook' },
      { id: 'nb_c360', label: 'build_customer_360', c: 'notebook', r: 10, sub: 'notebook' },
    ], links: [['nb_clean', 'orders_clean', 'w'], ['nb_clean', 'customers_dim', 'w'], ['nb_sess', 'events_sess', 'w'],
      ['orders_clean', 'nb_c360', 'r'], ['customers_dim', 'nb_c360', 'r'], ['events_sess', 'nb_c360', 'r']] },
  'tbl:oc': { level: 'Table lineage', crumb: 'orders_clean', type: 'lineage' },
}

// Maps drill-level keys (type 'lineage') to TABLES ids so the graph view can
// show real column metadata on drill. Levels without an entry fall back
// gracefully in the UI.
export const LEVEL_TABLE: Record<string, string> = { 'tbl:oc': 'clean' }

// ---- Notebook source (for OpenGrok-style code search) ----
// Keys: 'nb' = clean_orders (the DAG-view notebook id); the rest are keyed by
// name-like ids matching notebooks referenced in LEVELS:
//   'sessionize_events', 'build_customer_360', 'daily_revenue'.
export const NOTEBOOK_CODE: Record<string, string> = {
  nb: `# clean_orders — bronze -> silver
from pyspark.sql import functions as F

raw = spark.read.table("bronze.raw_orders")
customers = spark.read.table("bronze.customers")

orders = (
    raw
    .filter(F.col("amount") > 0)
    .join(customers, raw["customer"] == customers["customer_id"], "left")
    .select(
        F.col("order_id"),
        F.upper(F.col("customer")).alias("customer_name"),
        F.col("amount"),
        customers["region"],
    )
)

orders.write.mode("overwrite").saveAsTable("silver.orders_clean")`,
  sessionize_events: `# sessionize_events — bronze -> silver
from pyspark.sql import functions as F
from pyspark.sql.window import Window

events = spark.read.table("bronze.raw_events")

w = Window.partitionBy("user_id").orderBy("event_ts")
gap = F.col("event_ts").cast("long") - F.lag("event_ts").over(w).cast("long")

sessions = (
    events
    .withColumn("new_session", (gap > 30 * 60).cast("int"))
    .withColumn("session_id", F.sum("new_session").over(w))
)

sessions.write.mode("overwrite").saveAsTable("silver.events_sessionized")`,
  build_customer_360: `# build_customer_360 — silver -> gold
from pyspark.sql import functions as F

orders = spark.read.table("silver.orders_clean")
customers = spark.read.table("silver.customers_dim")
events = spark.read.table("silver.events_sessionized")

spend = orders.groupBy("customer_name").agg(F.sum("amount").alias("lifetime_value"))
activity = events.groupBy("user_id").agg(F.countDistinct("session_id").alias("sessions"))

c360 = (
    customers
    .join(spend, "customer_name", "left")
    .join(activity, customers["customer_id"] == activity["user_id"], "left")
)

c360.write.mode("overwrite").saveAsTable("gold.customer_360")`,
  daily_revenue: `# daily_revenue — silver -> gold
from pyspark.sql import functions as F

orders = spark.read.table("silver.orders_clean")

daily = (
    orders
    .withColumn("order_date", F.to_date("ts"))
    .groupBy("order_date", "region")
    .agg(F.sum("amount").alias("revenue"), F.count("order_id").alias("orders"))
)

daily.write.mode("overwrite").saveAsTable("gold.daily_revenue")`,
}
