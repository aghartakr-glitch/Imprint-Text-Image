import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CSV_PATH = join(__dirname, '..', 'data', 'imprint_layout_dataset_200x_v0.5.csv')

// A minimal RFC-4180-ish CSV parser (handles quoted fields with embedded commas/newlines/
// doubled quotes) since this ~1000-row reference dataset isn't worth adding a dependency for.
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
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\r') {
      // ignore, \n (or the final \r\n's \n) ends the row
    } else if (c === '\n') {
      row.push(field); field = ''
      rows.push(row); row = []
    } else {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

let cachedRecords = null

export function loadDatasetSamples() {
  if (cachedRecords) return cachedRecords
  const content = readFileSync(CSV_PATH, 'utf-8').replace(/^﻿/, '')
  const rows = parseCsv(content)
  const [header, ...body] = rows
  cachedRecords = body
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])))
  return cachedRecords
}

// Picks up to `perPattern` rows per pattern_id (capped at `maxTotal` overall) as compact
// few-shot reference for the LLM prompt -- the full CSV is too large to embed every call.
export function sampleFewShot({ perPattern = 1, maxTotal = 12 } = {}) {
  const records = loadDatasetSamples()
  const byPattern = new Map()
  for (const rec of records) {
    const key = rec.pattern_id
    if (!key) continue
    if (!byPattern.has(key)) byPattern.set(key, [])
    if (byPattern.get(key).length < perPattern) byPattern.get(key).push(rec)
  }
  return [...byPattern.values()].flat().slice(0, maxTotal).map((rec) => ({
    pattern_id: rec.pattern_id,
    layout_family: rec.layout_family,
    image_count: rec.image_count,
    text_length_level: rec.text_length_level,
    image_arrangement: rec.image_arrangement,
    text_position: rec.text_position,
    why_this_layout_works: rec.why_this_layout_works,
  }))
}
