// Builds the sample lineage model entirely in the browser. Port of the former
// backend sample.py, expanded into a fuller medallion architecture (Source →
// Staging → Bronze → Silver → Gold → Reporting) so the app is exercised against
// a realistically sized model: several layers, many objects/tables, dozens of
// attributes, multi-hop lineage, and a populated tag registry.
import type { LineageNode, LineageEdge, NodeType, TagDef } from "./types";

const newId = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/-/g, "");

export function buildSampleModel(): {
  name: string;
  nodes: LineageNode[];
  edges: LineageEdge[];
  tags: TagDef[];
} {
  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];

  const add = (
    type: NodeType,
    name: string,
    parent: LineageNode | null,
    logic = "",
    tags: string[] = []
  ): LineageNode => {
    const n: LineageNode = {
      id: newId(),
      type,
      name,
      parentId: parent ? parent.id : null,
      properties: tags.length ? { tags } : {},
      transformation_logic: logic,
      x: 0,
      y: 0,
    };
    nodes.push(n);
    return n;
  };
  const attr = (name: string, group: LineageNode, logic = "", tags: string[] = []) =>
    add("Attribute", name, group, logic, tags);
  const link = (s: LineageNode, t: LineageNode) =>
    edges.push({ id: newId(), sourceNodeId: s.id, targetNodeId: t.id });
  // Chain a value through a list of attributes left→right (each feeds the next).
  const chain = (...as: LineageNode[]) => {
    for (let i = 0; i < as.length - 1; i++) link(as[i], as[i + 1]);
  };

  // Tag registry — assigned across attributes so the Tags panel and Filter have
  // real data to work with.
  const tags: TagDef[] = [
    { name: "PII", color: "#e24a7b" },
    { name: "Financial", color: "#c9a227" },
    { name: "Conformed", color: "#3bb273" },
    { name: "KPI", color: "#5a6acf" },
    { name: "Audit", color: "#7b8a4a" },
  ];

  // Hierarchy: Layer > Object (lakehouse/system) > Group (table) > Attribute.

  // ── Layer: Data Sources (Landing) ───────────────────────────────────────
  const lSrc = add("Layer", "Data Sources", null);

  const oCrm = add("Object", "CRM Landing (_LH_L)", lSrc);
  const gCust = add("Group", "landing_customer", oCrm);
  const sCustId = attr("CustomerID", gCust);
  const sName = attr("Customer Name", gCust, "", ["PII"]);
  const sEmail = attr("Customer Email", gCust, "", ["PII"]);
  const sPhone = attr("Phone", gCust, "", ["PII"]);
  const sCountry = attr("Country", gCust);

  const oOrders = add("Object", "Orders Landing (_LH_L)", lSrc);
  const gOrder = add("Group", "landing_orders", oOrders);
  const sOrderId = attr("OrderID", gOrder);
  const sOrderCust = attr("CustomerID", gOrder);
  const sOrderDate = attr("Order Date", gOrder);
  const sAmount = attr("Amount", gOrder, "", ["Financial"]);
  const sCurrency = attr("Currency", gOrder);
  const sProdId = attr("ProductID", gOrder);

  const oProd = add("Object", "Product Catalog (_LH_L)", lSrc);
  const gProd = add("Group", "landing_product", oProd);
  const sPId = attr("ProductID", gProd);
  const sPName = attr("Product Name", gProd);
  const sPCat = attr("Category", gProd);
  const sPPrice = attr("List Price", gProd, "", ["Financial"]);

  // ── Layer: P-T (staging notebooks) ──────────────────────────────────────
  const lPt = add("Layer", "P-T (Staging)", null);
  const oNbCust = add("Object", "01_load_bronze_customer", lPt);
  const gtCust = add("Group", "bronze_customer (staged)", oNbCust);
  const tCustId = attr("Customer_ID", gtCust, "direct passthrough");
  const tName = attr("Customer_Name", gtCust, "trim + collapse whitespace", ["PII"]);
  const tEmail = attr("Customer_Email", gtCust, "lower(trim(email))", ["PII"]);
  const tPhone = attr("Phone", gtCust, "strip non-digits", ["PII"]);
  const tCountry = attr("Country", gtCust, "upper(country)");
  const tCustHash = attr("Record_Hash", gtCust, "md5(concat_ws(',', *src cols))", ["Audit"]);
  const tCustTs = attr("Ingested_At", gtCust, "current_timestamp()", ["Audit"]);

  const oNbOrder = add("Object", "02_load_bronze_orders", lPt);
  const gtOrder = add("Group", "bronze_orders (staged)", oNbOrder);
  const tOrderId = attr("Order_ID", gtOrder, "direct passthrough");
  const tOrderCust = attr("Customer_ID", gtOrder, "direct passthrough");
  const tOrderDate = attr("Order_Date", gtOrder, "to_date(order_date, 'yyyy-MM-dd')");
  const tAmount = attr("Amount", gtOrder, "cast(amount as decimal(18,2))", ["Financial"]);
  const tCurrency = attr("Currency", gtOrder, "upper(currency)");
  const tOrderProd = attr("Product_ID", gtOrder, "direct passthrough");
  const tOrderTs = attr("Ingested_At", gtOrder, "current_timestamp()", ["Audit"]);

  // ── Layer: P-S (Bronze lakehouse) ───────────────────────────────────────
  const lBronze = add("Layer", "P-S (Bronze)", null);
  const oBronze = add("Object", "Bronze (_LH_B)", lBronze);
  const gbCust = add("Group", "bronze_customer", oBronze);
  const bCustId = attr("Customer_ID", gbCust);
  const bName = attr("Customer_Name", gbCust, "", ["PII"]);
  const bEmail = attr("Customer_Email", gbCust, "", ["PII"]);
  const bPhone = attr("Phone", gbCust, "", ["PII"]);
  const bCountry = attr("Country", gbCust);
  const bCustHash = attr("Record_Hash", gbCust, "", ["Audit"]);

  const gbOrder = add("Group", "bronze_orders", oBronze);
  const bOrderId = attr("Order_ID", gbOrder);
  const bOrderCust = attr("Customer_ID", gbOrder);
  const bOrderDate = attr("Order_Date", gbOrder);
  const bAmount = attr("Amount", gbOrder, "", ["Financial"]);
  const bCurrency = attr("Currency", gbOrder);
  const bOrderProd = attr("Product_ID", gbOrder);

  // ── Layer: Silver (conformed) ───────────────────────────────────────────
  const lSilver = add("Layer", "Silver (Conformed)", null);
  const oSilver = add("Object", "Silver (_LH_S)", lSilver);
  const gsCust = add("Group", "dim_customer_clean", oSilver);
  const xCustKey = attr("CustomerKey", gsCust, "sha2(customer_id, 256)", ["Conformed"]);
  const xFullName = attr("FullName", gsCust, "initcap(customer_name)", ["PII", "Conformed"]);
  const xEmail = attr("Email", gsCust, "validated email or null", ["PII", "Conformed"]);
  const xCountry = attr("CountryCode", gsCust, "iso-3166 lookup(country)", ["Conformed"]);

  const gsOrder = add("Group", "fact_orders_clean", oSilver);
  const xOrderKey = attr("OrderKey", gsOrder, "sha2(order_id, 256)", ["Conformed"]);
  const xCustFk = attr("CustomerKey", gsOrder, "sha2(customer_id, 256)", ["Conformed"]);
  const xOrderDate = attr("OrderDate", gsOrder, "", ["Conformed"]);
  const xAmountUsd = attr("AmountUSD", gsOrder, "amount * fx_rate(currency, order_date)", [
    "Financial",
    "Conformed",
  ]);

  // ── Layer: Gold (dimensional) ───────────────────────────────────────────
  const lGold = add("Layer", "Gold (Dimensional)", null);
  const oGold = add("Object", "Gold (_LH_G)", lGold);
  const ggDim = add("Group", "DimCustomer", oGold);
  const gCustKey = attr("CustomerKey", ggDim, "", ["Conformed"]);
  const gCustName = attr("CustomerName", ggDim, "", ["PII"]);
  const gCustCountry = attr("Country", ggDim);

  const ggFact = add("Group", "FactSales", oGold);
  const gSalesKey = attr("SalesKey", ggFact, "");
  const gFactCust = attr("CustomerKey", ggFact, "");
  const gRevenue = attr("Revenue", ggFact, "sum(amount_usd)", ["Financial", "KPI"]);
  const gOrderCount = attr("OrderCount", ggFact, "count(distinct order_key)", ["KPI"]);

  // ── Layer: Reporting (Power BI semantic model) ──────────────────────────
  const lRpt = add("Layer", "Reporting", null);
  const oPbi = add("Object", "Sales Dataset (Power BI)", lRpt);
  const gMeasures = add("Group", "Measures", oPbi);
  const mRevenue = attr("Total Revenue", gMeasures, "SUM(FactSales[Revenue])", [
    "Financial",
    "KPI",
  ]);
  const mAov = attr("Avg Order Value", gMeasures, "[Total Revenue] / [Total Orders]", ["KPI"]);
  const mOrders = attr("Total Orders", gMeasures, "SUM(FactSales[OrderCount])", ["KPI"]);

  // ── Lineage ──────────────────────────────────────────────────────────────
  // Customer: Source → staging → bronze → silver → gold → reporting
  chain(sCustId, tCustId, bCustId, xCustKey, gCustKey);
  chain(sName, tName, bName, xFullName, gCustName);
  chain(sEmail, tEmail, bEmail, xEmail);
  link(sPhone, tPhone); link(tPhone, bPhone);
  chain(sCountry, tCountry, bCountry, xCountry, gCustCountry);
  [sCustId, sName, sEmail].forEach((s) => link(s, tCustHash));
  link(tCustHash, bCustHash);

  // Orders: Source → staging → bronze → silver
  chain(sOrderId, tOrderId, bOrderId, xOrderKey, gSalesKey);
  chain(sOrderCust, tOrderCust, bOrderCust, xCustFk, gFactCust);
  chain(sOrderDate, tOrderDate, bOrderDate, xOrderDate);
  chain(sAmount, tAmount, bAmount, xAmountUsd, gRevenue);
  chain(sCurrency, tCurrency, bCurrency);
  link(sCurrency, xAmountUsd); // currency feeds the USD conversion
  chain(sProdId, tOrderProd, bOrderProd);
  link(xOrderKey, gOrderCount);

  // Audit timestamps are source-only (system-generated, feed nothing) — they
  // give the "no output (sink-only)" lineage filter real attributes to catch.
  void [tCustTs, tOrderTs];

  // Product (source-only into staging is omitted; left partly isolated to give
  // the lineage-status filter something to catch).
  void [sPId, sPName, sPCat, sPPrice, gFactCust];

  // Gold → Reporting measures
  link(gRevenue, mRevenue);
  link(gOrderCount, mOrders);
  link(mRevenue, mAov);
  link(mOrders, mAov);

  return { name: "Sample — Medallion (Source→Gold→BI)", nodes, edges, tags };
}
