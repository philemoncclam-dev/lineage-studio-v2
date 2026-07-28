// A second demo model, shaped like a real Fabric medallion estate.
//
// The first sample (`sample.ts`) is a flat three-layer mapping. This one exists
// because the app's actual subject is a Fabric workspace, and several features
// only mean anything against that shape: the sandbox writes Landing → Bronze →
// Silver → Gold, pipelines contain notebooks, and a Purview-catalogued data
// product sits on the end. Four layers, small enough to read on one screen.
//
// The hierarchy is used consistently, and it is worth stating because the same
// three levels carry different meanings per layer:
//
//   layer  →  object            →  attribute group  →  attribute
//   Source →  a source system   →  a table          →  a column
//   Trans. →  a pipeline        →  a notebook       →  (nothing)
//   Work.  →  a medallion stage →  a table or file  →  a column
//   Catalog→  a data product    →  a published asset→  a column
//
// DELIBERATE IMPERFECTIONS. This model is also the demo surface for the
// assistant, so it carries the three states an honest lineage tool has to tell
// apart — and a spotless sample would show none of them:
//
//   - `bronze_invoices.currency` has NO lineage at all, so `lineage_gaps` finds
//     something and "which columns are untraced?" has a real answer.
//   - The Silver → Gold `region` edge is HAND-DRAWN (no `Source` property),
//     while every other edge is marked as sandbox-derived, so `derived: false`
//     has a case to report.
//   - Landing → Bronze is TABLE-level only, mirroring what a file source
//     actually produces: there are no columns to trace through a CSV, so the
//     assistant must report that path as coarser rather than implying columns.

import type { Attribute, LineageModel, ModelObject, Transition } from './types'

let seq = 0
/** Deterministic ids — a fixed sample must not churn its ids on every reload. */
const id = (prefix: string) => `${prefix}-${(seq += 1)}`

const attr = (name: string, children: Attribute[] = []): Attribute => ({
  id: id('a'),
  name,
  children,
})

const obj = (name: string, children: Attribute[]): ModelObject => ({
  id: id('o'),
  name,
  children,
})

export function fabricSampleModel(): LineageModel {
  seq = 0

  // --- 1. Data sources ------------------------------------------------------
  const sfAccount = attr('Account', [
    attr('AccountId'),
    attr('Name'),
    attr('BillingCountry'),
  ])
  const salesforce = obj('Salesforce CRM', [sfAccount])

  const sqlInvoice = attr('Invoice', [
    attr('InvoiceId'),
    attr('AccountId'),
    attr('Amount'),
    attr('InvoiceDate'),
  ])
  const billing = obj('Billing (SQL Server)', [sqlInvoice])

  // --- 2. Transformations: pipelines, each holding its notebooks ------------
  const nbLand = attr('nb_land_sources')
  const nbBronze = attr('nb_bronze_load')
  const ingest = obj('pl_ingest_daily', [nbLand, nbBronze])

  const nbSilver = attr('nb_silver_conform')
  const nbGold = attr('nb_gold_aggregate')
  const transform = obj('pl_transform_daily', [nbSilver, nbGold])

  // --- 3. Workspace: the medallion stages -----------------------------------
  // Files, not tables: a landing folder has no schema to disclose, which is
  // exactly why the edges out of it are table-level.
  const landAccounts = attr('Files/salesforce/accounts/*.csv')
  const landInvoices = attr('Files/billing/invoices/*.csv')
  const landing = obj('Landing', [landAccounts, landInvoices])

  const bronzeAccounts = attr('bronze_accounts', [
    attr('account_id'),
    attr('account_name'),
    attr('billing_country'),
  ])
  const bronzeInvoices = attr('bronze_invoices', [
    attr('invoice_id'),
    attr('account_id'),
    attr('amount'),
    attr('invoice_date'),
    // The gap. Landed by the ingest but never mapped onward.
    attr('currency'),
  ])
  const bronze = obj('Bronze', [bronzeAccounts, bronzeInvoices])

  const silverCustomer = attr('silver_customer', [
    attr('customer_id'),
    attr('customer_name'),
    attr('region'),
  ])
  const silverInvoice = attr('silver_invoice', [
    attr('invoice_id'),
    attr('customer_id'),
    attr('amount_usd'),
    attr('invoice_date'),
  ])
  const silver = obj('Silver', [silverCustomer, silverInvoice])

  const goldLtv = attr('gold_customer_ltv', [
    attr('customer_id'),
    attr('lifetime_value'),
    attr('invoice_count'),
    attr('region'),
  ])
  const gold = obj('Gold', [goldLtv])

  // --- 4. Catalogued data assets -------------------------------------------
  const productAsset = attr('Customer LTV', [
    attr('customer_id'),
    attr('lifetime_value'),
    attr('region'),
  ])
  const product = obj('Customer 360 (Data Product)', [productAsset])

  const now = Date.now()
  const model: LineageModel = {
    id: 'sample-fabric-medallion',
    name: 'Fabric Medallion Estate',
    description:
      'Four layers: source systems, the pipelines that move them, the medallion ' +
      'workspace, and the catalogued product on the end.',
    tags: ['sample', 'fabric'],
    createdAt: now,
    updatedAt: now,
    layers: [
      { id: id('l'), name: 'Data Sources', objects: [salesforce, billing] },
      { id: id('l'), name: 'Transformations', objects: [ingest, transform] },
      { id: id('l'), name: 'Workspace', objects: [landing, bronze, silver, gold] },
      { id: id('l'), name: 'Catalogued Assets', objects: [product] },
    ],
    transitions: [],
    properties: {},
  }

  const prop = (entityId: string, values: Record<string, string>) => {
    model.properties[entityId] = { ...model.properties[entityId], ...values }
  }
  const child = (parent: Attribute, name: string): Attribute => {
    const found = parent.children.find((c) => c.name === name)
    if (!found) throw new Error(`sample is inconsistent: no ${name} under ${parent.name}`)
    return found
  }

  /**
   * Every edge is sandbox-derived UNLESS `via` is omitted, which marks it
   * hand-drawn — the distinction the assistant reports as "a person drew this
   * and nothing has checked it".
   */
  const link = (source: string, target: string, extra?: Record<string, string>): Transition => {
    const t: Transition = { id: id('t'), source, target }
    model.transitions.push(t)
    if (extra) prop(t.id, extra)
    return t
  }
  const derived = (via: string, transform?: string) => ({
    Source: 'Fabric sandbox',
    Via: via,
    ...(transform ? { Transform: transform } : {}),
  })

  // Sources → Landing. Table level: a CSV drop has no column mapping.
  link(sfAccount.id, landAccounts.id, derived('nb_land_sources'))
  link(sqlInvoice.id, landInvoices.id, derived('nb_land_sources'))

  // Landing → Bronze, still table level — nothing to trace through a file.
  link(landAccounts.id, bronzeAccounts.id, derived('nb_bronze_load'))
  link(landInvoices.id, bronzeInvoices.id, derived('nb_bronze_load'))

  // Bronze → Silver, column level.
  link(child(bronzeAccounts, 'account_id').id, child(silverCustomer, 'customer_id').id, derived('nb_silver_conform'))
  link(child(bronzeAccounts, 'account_name').id, child(silverCustomer, 'customer_name').id, derived('nb_silver_conform'))
  link(
    child(bronzeAccounts, 'billing_country').id,
    child(silverCustomer, 'region').id,
    derived('nb_silver_conform', "upper(trim(billing_country))"),
  )
  link(child(bronzeInvoices, 'invoice_id').id, child(silverInvoice, 'invoice_id').id, derived('nb_silver_conform'))
  link(child(bronzeInvoices, 'account_id').id, child(silverInvoice, 'customer_id').id, derived('nb_silver_conform'))
  link(
    child(bronzeInvoices, 'amount').id,
    child(silverInvoice, 'amount_usd').id,
    derived('nb_silver_conform', 'amount * fx_rate'),
  )
  link(child(bronzeInvoices, 'invoice_date').id, child(silverInvoice, 'invoice_date').id, derived('nb_silver_conform'))
  // `currency` maps nowhere on purpose — see the header note.

  // Silver → Gold, column level.
  link(child(silverCustomer, 'customer_id').id, child(goldLtv, 'customer_id').id, derived('nb_gold_aggregate'))
  link(
    child(silverInvoice, 'amount_usd').id,
    child(goldLtv, 'lifetime_value').id,
    derived('nb_gold_aggregate', 'sum(amount_usd)'),
  )
  link(
    child(silverInvoice, 'invoice_id').id,
    child(goldLtv, 'invoice_count').id,
    derived('nb_gold_aggregate', 'count(invoice_id)'),
  )
  // Hand-drawn: no Source, no Via. Somebody asserted it; nothing verified it.
  link(child(silverCustomer, 'region').id, child(goldLtv, 'region').id)

  // Gold → the catalogued product.
  link(child(goldLtv, 'customer_id').id, child(productAsset, 'customer_id').id, derived('Purview publish'))
  link(child(goldLtv, 'lifetime_value').id, child(productAsset, 'lifetime_value').id, derived('Purview publish'))
  link(child(goldLtv, 'region').id, child(productAsset, 'region').id, derived('Purview publish'))

  // Pipelines write the stages they produce, so the transformation layer is
  // connected to the workspace rather than floating beside it.
  link(nbLand.id, landing.id, derived('pl_ingest_daily'))
  link(nbBronze.id, bronze.id, derived('pl_ingest_daily'))
  link(nbSilver.id, silver.id, derived('pl_transform_daily'))
  link(nbGold.id, gold.id, derived('pl_transform_daily'))

  // A little metadata, so Properties and the tag badges have something to show.
  prop(salesforce.id, { Workspace: 'Source systems', Access: 'Read' })
  prop(ingest.id, { Step: '1', Workspace: 'Analytics' })
  prop(transform.id, { Step: '2', Workspace: 'Analytics' })
  prop(bronze.id, { Workspace: 'Analytics', Access: 'Write' })
  prop(silver.id, { Workspace: 'Analytics', Access: 'Write' })
  prop(gold.id, { Workspace: 'Analytics', Access: 'Write' })
  prop(product.id, { Source: 'Purview', Access: 'Read' })

  prop(child(silverCustomer, 'customer_name').id, { Tags: 'PII', 'Data type': 'string' })
  prop(child(bronzeAccounts, 'account_name').id, { Tags: 'PII', 'Data type': 'string' })
  prop(child(goldLtv, 'lifetime_value').id, { 'Data type': 'decimal(18,2)' })
  prop(child(bronzeInvoices, 'currency').id, { 'Data type': 'string' })
  prop(productAsset.id, { Tags: 'Certified' })

  return model
}
