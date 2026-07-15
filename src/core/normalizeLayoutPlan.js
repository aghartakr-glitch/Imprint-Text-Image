// Normalizes known enum-alias mismatches the LLM sometimes emits, BEFORE validation runs, so a
// candidate is never rejected over a synonym the schema didn't spell out for it (confirmed
// 2026-07-10: a real response used grid_spec.margin_preset="default", which validateLayoutPlan's
// enum check rejects outright since only recommended|narrow|wide|custom are schema-legal -- "default"
// means exactly "use the standard margins", i.e. "recommended"). Only maps values that are genuine
// synonyms of a real schema-legal value; anything else is left untouched so validateLayoutPlan can
// still catch actually-invalid input.
const MARGIN_PRESET_ALIASES = {
  default: 'recommended',
  normal: 'recommended',
  standard: 'recommended',
  recommended: 'recommended',
  narrow: 'narrow',
  wide: 'wide',
  custom: 'custom',
}

function normalizeMarginPreset(value) {
  if (value == null) return value
  const key = String(value).trim().toLowerCase()
  return MARGIN_PRESET_ALIASES[key] || value
}

export function normalizeLayoutPlan(plan) {
  if (!plan || typeof plan !== 'object') return plan

  const normalized = structuredClone(plan)

  if (normalized.grid_spec && normalized.grid_spec.margin_preset != null) {
    const before = normalized.grid_spec.margin_preset
    const after = normalizeMarginPreset(before)
    if (after !== before) {
      console.log('[NORMALIZE]', {
        field: 'grid_spec.margin_preset',
        before,
        after,
      })
    }
    normalized.grid_spec.margin_preset = after
  }

  return normalized
}
