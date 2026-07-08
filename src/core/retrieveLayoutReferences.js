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

export function retrieveLayoutReferences({
  imageCount, textDensity, outputUnit, layoutFamily, imageOrientations = [],
}, { topN = 5 } = {}) {
  const records = loadDatasetSamples()

  return records
    .filter((r) => r.pattern_id && r.image_count)
    .map((r) => ({ record: r, score: scoreRecord(r, {
      imageCount, textDensity, outputUnit, layoutFamily, imageOrientations,
    }) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(({ record }) => ({
      sample_id: record.sample_id,
      image_count: Number(record.image_count),
      text_length_level: record.text_length_level,
      layout_family: record.layout_family,
      pattern_id: record.pattern_id,
      image_arrangement: record.image_arrangement,
      text_position: record.text_position,
      image_text_relation: record.image_text_relation,
      why_this_layout_works: record.why_this_layout_works,
      quality_score: Number(record.quality_score) || null,
    }))
}
