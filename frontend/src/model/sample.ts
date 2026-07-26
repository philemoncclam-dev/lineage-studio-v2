// A demo model so the viewer has something real to render before import and
// the connectors are wired up. Modelled on a consumer-mortgage lineage: an
// origination system feeding a transformation layer, aggregated downstream.

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

export function sampleModel(): LineageModel {
  seq = 0

  const applicant = attr('Applicant', [
    attr('name'),
    attr('lastname'),
    attr('firstname'),
    attr('pin'),
    attr('dateofbirth'),
    attr('idcardno'),
    attr('phone'),
    attr('mobilephone'),
    attr('email'),
    attr('nationalityid'),
    attr('cityname'),
    attr('postalcode'),
    attr('gender'),
  ])
  const financials = attr('Applicant Financials', [
    attr('name'),
    attr('zipcode'),
    attr('netincome'),
    attr('availableincome'),
    attr('ficoscore'),
  ])
  const loanDetail = attr('Loan Detail', [attr('name')])
  const mortgages = obj('Consumer Mortgages', [applicant, financials, loanDetail])

  const output1 = attr('OUTPUT1', [
    attr('mobilephone'),
    attr('firstname'),
    attr('lastname'),
    attr('dateofbirth'),
    attr('name'),
    attr('gender'),
    attr('postalcode'),
    attr('city'),
  ])
  const datastore = attr('(DATASTORE) applicant', [output1])
  const mapping = attr('mortgage2dwtftApp', [datastore])
  const mappings = obj('Mappings', [mapping])

  const targetApplicant = attr('tft_applicant', [
    attr('m_customer_name'),
    attr('m_gender'),
    attr('m_dob'),
    attr('m_customer_postcode'),
    attr('m_city'),
    attr('m_phone_number'),
  ])
  const targets = obj('Targets', [targetApplicant])

  const aggApplicant = attr('tft_applicant', [
    attr('m_customer_name'),
    attr('m_gender'),
    attr('m_dob'),
    attr('m_customer_postcode'),
    attr('m_city'),
    attr('m_phone_number'),
  ])
  const aggregated = obj('Mortgage', [aggApplicant])

  const now = Date.now()
  const model: LineageModel = {
    id: 'sample-consumer-mortgages',
    name: 'Consumer Mortgages',
    createdAt: now,
    updatedAt: now,
    layers: [
      { id: id('l'), name: 'Origination System', objects: [mortgages] },
      { id: id('l'), name: 'Transformations', objects: [mappings, targets] },
      { id: id('l'), name: 'Aggregation Layer', objects: [aggregated] },
    ],
    transitions: [],
    properties: {},
  }

  // Classification properties — these drive the badge display rules.
  const classify = (a: Attribute, value: string) => {
    model.properties[a.id] = { ...model.properties[a.id], Classification: value }
  }
  const byName = (parent: Attribute, name: string) =>
    parent.children.find((c) => c.name === name)

  for (const name of ['name', 'phone', 'mobilephone', 'email', 'idcardno', 'nationalityid']) {
    const found = byName(applicant, name)
    if (found) classify(found, 'PII')
  }
  for (const name of ['lastname', 'firstname', 'dateofbirth', 'cityname', 'postalcode', 'gender']) {
    const found = byName(applicant, name)
    if (found) classify(found, 'LPI')
  }
  for (const name of ['netincome', 'availableincome', 'ficoscore']) {
    const found = byName(financials, name)
    if (found) classify(found, 'SPI')
  }
  for (const name of ['lastname', 'firstname', 'dateofbirth']) {
    const found = byName(applicant, name)
    if (found) model.properties[found.id] = { ...model.properties[found.id], CDE: 'true' }
  }
  for (const child of output1.children) classify(child, 'LPI')
  for (const child of targetApplicant.children) classify(child, 'LPI')
  for (const child of aggApplicant.children) classify(child, 'LPI')

  // Transitions: origination -> transformation output -> target -> aggregation.
  const link = (source: string, target: string): Transition => ({
    id: id('t'),
    source,
    target,
  })
  const pairs: [string, string][] = [
    ['firstname', 'firstname'],
    ['lastname', 'lastname'],
    ['dateofbirth', 'dateofbirth'],
    ['mobilephone', 'mobilephone'],
    ['gender', 'gender'],
    ['postalcode', 'postalcode'],
    ['name', 'name'],
  ]
  for (const [from, to] of pairs) {
    const a = byName(applicant, from)
    const b = byName(output1, to)
    if (a && b) model.transitions.push(link(a.id, b.id))
  }

  const outToTarget: [string, string][] = [
    ['name', 'm_customer_name'],
    ['gender', 'm_gender'],
    ['dateofbirth', 'm_dob'],
    ['postalcode', 'm_customer_postcode'],
    ['city', 'm_city'],
    ['mobilephone', 'm_phone_number'],
  ]
  for (const [from, to] of outToTarget) {
    const a = byName(output1, from)
    const b = byName(targetApplicant, to)
    if (a && b) model.transitions.push(link(a.id, b.id))
  }

  for (const source of targetApplicant.children) {
    const match = byName(aggApplicant, source.name)
    if (match) model.transitions.push(link(source.id, match.id))
  }

  return model
}
