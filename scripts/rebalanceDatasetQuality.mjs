#!/usr/bin/env node
// Spec v0.4 section 19: the 1,000-row CSV is a synthetic reference prior, not ground truth. This
// script (a) drops rows with impossible combinations (missing required fields, out-of-range
// quality_score, hero_image_exists=true with no hero_image_index) and (b) remaps quality_score
// via quantile buckets so the distribution matches the target good/bad mix an estimator needs
// (20% 5s, 35% 4s, 25% 3s, 15% 2s, 5% 1s) -- preserving each row's *relative* ranking (its
// original score is still the ordering signal) rather than assigning scores randomly.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CSV_PATH = join(__dirname, '..', 'src', 'data', 'imprint_layout_dataset_200x_v0.5.csv')

const TARGET_DISTRIBUTION = [
  { score: 5, share: 0.20 },
  { score: 4, share: 0.35 },
  { score: 3, share: 0.25 },
  { score: 2, share: 0.15 },
  { score: 1, share: 0.05 },
]

function parseCsv(content) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < content.length; i += 1) {
    const c = content[i]
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') { field += '"'; i += 1 } else { inQuotes = false }
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' } else if (c === '\r') { /* skip */ } else if (c === '\n') {
      row.push(field); field = ''; rows.push(row); row = []
    } else field += c
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

function toCsvField(value) {
  const str = String(value ?? '')
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

function isImpossible(record) {
  const qualityScore = Number(record.quality_score)
  if (!record.pattern_id || !record.image_count) return true
  if (!Number.isFinite(qualityScore) || qualityScore < 1 || qualityScore > 5) return true
  if (record.hero_image_exists === 'true' && !record.hero_image_index) return true
  return false
}

function rebalanceQualityScores(records) {
  // Rank ascending by original quality_score (stable): worst-ranked rows get the lowest new
  // scores, so the *relative order* editorial judgment already encoded is preserved.
  const ranked = [...records]
    .map((r, i) => ({ r, i, orig: Number(r.quality_score) }))
    .sort((a, b) => (a.orig - b.orig) || (a.i - b.i))

  const n = ranked.length
  let cursor = 0
  // TARGET_DISTRIBUTION is worst-share-last; walk low->high scores to match ranked's ascending order.
  const ascending = [...TARGET_DISTRIBUTION].sort((a, b) => a.score - b.score)
  ascending.forEach(({ score, share }, idx) => {
    const isLast = idx === ascending.length - 1
    const count = isLast ? n - cursor : Math.round(n * share)
    for (let k = 0; k < count && cursor < n; k += 1, cursor += 1) {
      ranked[cursor].r.quality_score = String(score)
    }
  })
  return records
}

function main() {
  const content = readFileSync(CSV_PATH, 'utf-8').replace(/^﻿/, '')
  const rows = parseCsv(content)
  const [header, ...body] = rows
  const records = body
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])))

  const before = records.length
  const kept = records.filter((r) => !isImpossible(r))
  const removed = before - kept.length

  rebalanceQualityScores(kept)

  const outRows = [header.join(','), ...kept.map((r) => header.map((h) => toCsvField(r[h])).join(','))]
  writeFileSync(CSV_PATH, `${outRows.join('\n')}\n`, 'utf-8')

  const finalCounts = TARGET_DISTRIBUTION.reduce((acc, { score }) => {
    acc[score] = kept.filter((r) => Number(r.quality_score) === score).length
    return acc
  }, {})
  console.log(`rows before: ${before}, removed as impossible: ${removed}, kept: ${kept.length}`)
  console.log('final quality_score distribution:', finalCounts)
}

main()
