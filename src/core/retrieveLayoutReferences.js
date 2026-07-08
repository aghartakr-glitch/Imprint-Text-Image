import { loadDatasetSamples } from './layoutDataset.js'

// The full ~1000-row CSV is never sent to the LLM (spec section 7.1). This ranks every row by
// how well it matches the current input and returns only the top few as few-shot reference.
function orientationOverlapScore(rowOrientations, targetOrientations) {
  if (!rowOrientations || targetOrientations.length === 0) return 0
  const rowSet = new Set(rowOrientations.split(';').map((s) => s.trim()).filter(Boolean))
  if (rowSet.size === 0) return 0
  const matches = targetOrientations.filter((o) => rowSet.has(o)).length
  return matches / targetOrientations.length
}

function scoreRecord(record, {
  imageCount, textDensity, outputUnit, layoutFamily, imageOrientations,
}) {
  let score = 0
  const recordImageCount = Number(record.image_count)
  if (recordImageCount === imageCount) score += 3
  else if (Number.isFinite(recordImageCount)) score -= Math.abs(recordImageCount - imageCount) * 0.3

  if (record.text_length_level === textDensity) score += 2
  if (outputUnit && record.page_type === outputUnit) score += 2
  if (layoutFamily && record.layout_family === layoutFamily) score += 1
  score += orientationOverlapScore(record.image_orientations, imageOrientations)
  score += (Number(record.quality_score) || 0) / 5
  return score
}

// topN defaults to 3 (the low end of the spec's "3~5") and the per-row fields are trimmed to
// what the LLM actually needs to make a decision -- every extra field/reference is tokens paid
// on every single generation, so this stays as lean as the spec's own intent allows.
export function retrieveLayoutReferences({
  imageCount, textDensity, outputUnit, layoutFamily, imageOrientations = [],
}, { topN = 3 } = {}) {
  const records = loadDatasetSamples()

  return records
    .filter((r) => r.pattern_id && r.image_count)
    .map((r) => ({ record: r, score: scoreRecord(r, {
      imageCount, textDensity, outputUnit, layoutFamily, imageOrientations,
    }) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(({ record }) => ({
      pattern_id: record.pattern_id,
      layout_family: record.layout_family,
      image_count: Number(record.image_count),
      text_length_level: record.text_length_level,
      quality_score: Number(record.quality_score) || null,
    }))
}
