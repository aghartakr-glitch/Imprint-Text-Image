import { gridToMm } from './gridToMm.js'

// Spec section 13: a rule-based (not deep-learning) quality estimator. It only ever scores
// candidates that already passed validateLayoutPlan, so the "hard" deductions (overlap, out of
// page, missing body/image, fit != contain) never actually fire here -- those plans are already
// rejected/repaired earlier in the pipeline. This estimator focuses on the *softer* editorial
// judgment calls validation can't express: hierarchy consistency, crowding, tiny images, and
// image_text_relation/layout_family compatibility.
const MIN_IMAGE_AREA_MM2 = 15 * 15
const MAX_PAGE_COVERAGE_RATIO = 0.92

const IMAGE_TEXT_RELATION_COMPATIBILITY = {
  'image-first': ['image_sets_mood', 'gallery_then_text', 'equal_visual_text'],
  'text-first': ['text_explains_image', 'image_supports_text'],
  balanced: ['text_explains_image', 'equal_visual_text', 'image_supports_text', 'gallery_then_text'],
}

function allElements(plan) {
  return (plan.pages || []).flatMap((p) => p.elements || [])
}

function pageCoverageRatio(page) {
  const areaOf = (box) => box.wMm * box.hMm
  const usedArea = page.images.reduce((sum, img) => sum + areaOf(img), 0)
    + (page.textZone ? areaOf(page.textZone) : 0)
  const pageArea = 148 * 210 // physical A5 page, as a crowding upper bound
  return usedArea / pageArea
}

export function estimateLayoutQuality({
  plan, resolvedPages = [], refinements = { notes: [] }, repetitionPenaltyApplied = false,
}) {
  const deductions = []
  const scores = {
    readability: 1, visual_balance: 1, hierarchy: 1, whitespace: 1, image_text_relation: 1,
  }

  function deduct(category, amount, reason) {
    scores[category] = Math.max(0, scores[category] - amount)
    deductions.push({ reason, amount: -amount })
  }

  if (refinements.notes.some((n) => n.includes('너무 좁습니다'))) {
    deduct('readability', 0.5, 'text box too narrow for body')
  }

  if (refinements.notes.some((n) => n.includes('비어 있습니다'))) {
    deduct('visual_balance', 0.5, 'poor visual balance (empty page)')
  }

  if (plan.image_hierarchy === 'hero_support') {
    const hasHeroElement = allElements(plan).some((el) => el.type === 'image' && el.role === 'hero')
    if (!hasHeroElement) deduct('hierarchy', 0.5, 'weak hierarchy (image_hierarchy=hero_support but no hero-role image)')
  }

  const tinyImages = allElements(plan).filter((el) => {
    if (el.type !== 'image') return false
    const box = gridToMm(el)
    return box.wMm * box.hMm < MIN_IMAGE_AREA_MM2
  })
  if (tinyImages.length >= 2) {
    deduct('whitespace', 0.5, 'too many tiny images')
  }

  const overcrowdedPage = resolvedPages.some((page) => pageCoverageRatio(page) > MAX_PAGE_COVERAGE_RATIO)
  if (overcrowdedPage) {
    deduct('whitespace', 0.5, 'insufficient whitespace (page nearly full)')
  }

  const compatibleRelations = IMAGE_TEXT_RELATION_COMPATIBILITY[plan.layout_family]
  if (compatibleRelations && !compatibleRelations.includes(plan.image_text_relation)) {
    deduct('image_text_relation', 0.5, `image_text_relation(${plan.image_text_relation}) mismatched with layout_family(${plan.layout_family})`)
  }

  if (repetitionPenaltyApplied) {
    deduct('visual_balance', 0.5, 'repeated same layout too often')
  }

  const total = Object.values(scores).reduce((sum, v) => sum + v, 0)

  return {
    layout_quality_score: {
      total: Math.round(total * 100) / 100,
      ...scores,
      deductions,
    },
  }
}
