import { GRID_COLUMNS, GRID_ROWS } from './layoutConstants.js'
import { DESIGN_SPACE } from './designSpace.js'
import { validateCollisions } from './validation/validateCollisions.js'

const VALID_STYLES = ['Editorial', 'Magazine', 'Exhibition Catalog']

function colRangeOverlap(a, b) {
  return a.col_start <= b.col_start + b.col_span - 1 && b.col_start <= a.col_start + a.col_span - 1
}
function rowRangeOverlap(a, b) {
  return a.row_start <= b.row_start + b.row_span - 1 && b.row_start <= a.row_start + a.row_span - 1
}

function checkEnum(value, allowed, fieldName, issues, required = true) {
  if (value == null && !required) return
  if (!allowed.includes(value)) issues.push(`알 수 없는 ${fieldName}: ${value}`)
}

// Every check from spec v0.3 section 9 plus the v0.4 supplement's extended schema fields
// (output_unit, layout_purpose, image_hierarchy, image_text_relation, composition_strategy,
// object_position, design_sequence) plus the grid-preset supplement fields (grid_spec,
// reserved_regions, text_flow, layout_variation), all validated against designSpace.js's
// vocabulary. "JSON parses" isn't checked here -- that's the caller's job via JSON.parse.
export function validateLayoutPlan(plan, { imageCount } = {}) {
  const issues = []

  if (!plan || typeof plan !== 'object') {
    return { passed: false, issues: ['layout_plan이 객체가 아닙니다'] }
  }

  // Compute active grid dimensions: if plan has grid_spec, use it; otherwise fall back to defaults
  const activeColumns = plan.grid_spec?.columns ?? GRID_COLUMNS
  const activeRows = plan.grid_spec?.rows ?? GRID_ROWS

  checkEnum(plan.style, VALID_STYLES, 'style', issues)
  checkEnum(plan.layout_family, DESIGN_SPACE.layoutFamilies, 'layout_family', issues)
  checkEnum(plan.output_unit, DESIGN_SPACE.outputUnits, 'output_unit', issues)
  checkEnum(plan.layout_purpose, DESIGN_SPACE.layoutPurposes, 'layout_purpose', issues)
  checkEnum(plan.image_hierarchy, DESIGN_SPACE.imageHierarchies, 'image_hierarchy', issues)
  checkEnum(plan.image_text_relation, DESIGN_SPACE.imageTextRelations, 'image_text_relation', issues)
  checkEnum(plan.composition_strategy, DESIGN_SPACE.compositionStrategies, 'composition_strategy', issues)

  if (!Array.isArray(plan.design_sequence) || plan.design_sequence.length === 0) {
    issues.push('design_sequence가 비어 있거나 배열이 아닙니다')
  }

  // Validate grid.columns/rows match the active grid (either from grid_spec or defaults)
  if (!plan.grid || plan.grid.columns !== activeColumns) {
    issues.push(`grid.columns는 ${activeColumns}이어야 합니다 (받은 값: ${plan.grid?.columns})`)
  }
  if (!plan.grid || plan.grid.rows !== activeRows) {
    issues.push(`grid.rows는 ${activeRows}이어야 합니다 (받은 값: ${plan.grid?.rows})`)
  }

  const pages = Array.isArray(plan.pages) ? plan.pages : []
  if (pages.length === 0) {
    issues.push('pages 배열이 비어 있습니다')
  }

  const seenImageIndices = new Set()
  let hasBodyText = false

  pages.forEach((page) => {
    const elements = Array.isArray(page.elements) ? page.elements : []

    elements.forEach((el) => {
      if (!Number.isInteger(el.col_start) || !Number.isInteger(el.col_span) || el.col_span < 1) {
        issues.push(`요소 ${el.id}: col_start/col_span 값이 잘못되었습니다`)
      } else if (el.col_start < 1 || el.col_start + el.col_span - 1 > activeColumns) {
        issues.push(`요소 ${el.id}: col 범위가 grid(1~${activeColumns})를 벗어났습니다`)
      }
      if (!Number.isInteger(el.row_start) || !Number.isInteger(el.row_span) || el.row_span < 1) {
        issues.push(`요소 ${el.id}: row_start/row_span 값이 잘못되었습니다`)
      } else if (el.row_start < 1 || el.row_start + el.row_span - 1 > activeRows) {
        issues.push(`요소 ${el.id}: row 범위가 grid(1~${activeRows})를 벗어났습니다`)
      }

      if (el.type === 'image') {
        if (el.fit !== 'contain') {
          issues.push(`요소 ${el.id}: 이미지의 fit은 항상 contain이어야 합니다 (받은 값: ${el.fit})`)
        }
        if (el.role) checkEnum(el.role, DESIGN_SPACE.imageRoles, `요소 ${el.id}의 role`, issues)
        if (el.object_position) checkEnum(el.object_position, DESIGN_SPACE.objectPositions, `요소 ${el.id}의 object_position`, issues)
        const match = /^image_(\d+)$/.exec(el.id || '')
        if (match) seenImageIndices.add(Number(match[1]))
      }

      if (el.type === 'text') {
        if (el.role != null) checkEnum(el.role, DESIGN_SPACE.textRoles, `요소 ${el.id}의 role`, issues)

        // CRITICAL: text_source must reference specific paragraph, never "body_all"
        if (!el.text_source) {
          issues.push(`요소 ${el.id}: text_source가 없습니다 (paragraph_N 또는 title 필수)`)
        } else if (el.text_source === 'body_all') {
          issues.push(`요소 ${el.id}: text_source는 "body_all"이 아니라 구체적인 paragraph_N을 참조해야 합니다`)
        } else if (!/^(title|paragraph_\d+)$/.test(el.text_source)) {
          issues.push(`요소 ${el.id}: text_source 형식이 잘못되었습니다: "${el.text_source}" (title 또는 paragraph_N 형식)`)
        }

        if (el.role === 'body') hasBodyText = true
      }
    })

    for (let i = 0; i < elements.length; i += 1) {
      for (let j = i + 1; j < elements.length; j += 1) {
        const a = elements[i]
        const b = elements[j]
        if (colRangeOverlap(a, b) && rowRangeOverlap(a, b)) {
          issues.push(`요소 ${a.id}와 ${b.id}가 겹칩니다 (page ${page.page})`)
        }
      }
    }
  })

  if (!hasBodyText) {
    issues.push('본문 텍스트 영역(role: body)이 존재하지 않습니다')
  }

  if (Number.isInteger(imageCount)) {
    for (let n = 1; n <= imageCount; n += 1) {
      if (!seenImageIndices.has(n)) issues.push(`업로드된 이미지 image_${n}이 배치되지 않았습니다`)
    }
  }

  if (plan.overflow_policy?.body_overflow !== 'continue_to_next_page') {
    issues.push(`overflow_policy.body_overflow는 continue_to_next_page여야 합니다 (받은 값: ${plan.overflow_policy?.body_overflow})`)
  }

  // Grid-preset supplement fields (all optional, but if present must be self-consistent).
  if (plan.grid_spec) {
    const gs = plan.grid_spec
    if (!Number.isInteger(gs.columns) || gs.columns < 1) {
      issues.push(`grid_spec.columns는 양의 정수여야 합니다 (받은 값: ${gs.columns})`)
    }
    if (!Number.isInteger(gs.rows) || gs.rows < 1) {
      issues.push(`grid_spec.rows는 양의 정수여야 합니다 (받은 값: ${gs.rows})`)
    }
    if (typeof gs.gutter_mm !== 'number' || gs.gutter_mm < 0) {
      issues.push(`grid_spec.gutter_mm는 음이 아닌 숫자여야 합니다 (받은 값: ${gs.gutter_mm})`)
    }
    if (gs.page_size && !['A5', 'A4', 'B5', 'custom'].includes(gs.page_size)) {
      issues.push(`grid_spec.page_size는 A5|A4|B5|custom 중 하나여야 합니다 (받은 값: ${gs.page_size})`)
    }
    if (gs.margin_preset && !['recommended', 'narrow', 'wide', 'custom'].includes(gs.margin_preset)) {
      issues.push(`grid_spec.margin_preset는 recommended|narrow|wide|custom 중 하나여야 합니다 (받은 값: ${gs.margin_preset})`)
    }
    if (gs.grid_mode && !['strict', 'flexible'].includes(gs.grid_mode)) {
      issues.push(`grid_spec.grid_mode는 strict|flexible 중 하나여야 합니다 (받은 값: ${gs.grid_mode})`)
    }
  }

  if (Array.isArray(plan.reserved_regions)) {
    plan.reserved_regions.forEach((region, i) => {
      if (!Number.isInteger(region.col_start) || !Number.isInteger(region.col_span) || region.col_span < 1) {
        issues.push(`reserved_regions[${i}]: col_start/col_span 값이 잘못되었습니다`)
      }
      if (!Number.isInteger(region.row_start) || !Number.isInteger(region.row_span) || region.row_span < 1) {
        issues.push(`reserved_regions[${i}]: row_start/row_span 값이 잘못되었습니다`)
      }
      // Check reserved regions against active grid (user's grid_spec or defaults)
      if (region.col_start < 1 || region.col_start + region.col_span - 1 > activeColumns) {
        issues.push(`reserved_regions[${i}]: col 범위가 grid(1~${activeColumns})를 벗어났습니다`)
      }
      if (region.row_start < 1 || region.row_start + region.row_span - 1 > activeRows) {
        issues.push(`reserved_regions[${i}]: row 범위가 grid(1~${activeRows})를 벗어났습니다`)
      }
    })
  }

  if (typeof plan.layout_variation === 'string' && plan.layout_variation.length === 0) {
    issues.push('layout_variation는 비어 있지 않은 문자열이어야 합니다')
  }

  if (plan.text_flow) {
    const tf = plan.text_flow
    if (tf.mode && !['block_flow', 'column_flow', 'none'].includes(tf.mode)) {
      issues.push(`text_flow.mode는 block_flow|column_flow|none 중 하나여야 합니다 (받은 값: ${tf.mode})`)
    }
    if (Array.isArray(tf.flow_regions)) {
      tf.flow_regions.forEach((region, i) => {
        if (!Number.isInteger(region.col_start) || !Number.isInteger(region.col_span) || region.col_span < 1) {
          issues.push(`text_flow.flow_regions[${i}]: col 값이 잘못되었습니다`)
        }
        if (!Number.isInteger(region.row_start) || !Number.isInteger(region.row_span) || region.row_span < 1) {
          issues.push(`text_flow.flow_regions[${i}]: row 값이 잘못되었습니다`)
        }
      })
    }
    if (tf.overflow_policy?.body_overflow && tf.overflow_policy.body_overflow !== 'continue_to_next_page') {
      issues.push(`text_flow.overflow_policy.body_overflow는 continue_to_next_page여야 합니다 (받은 값: ${tf.overflow_policy.body_overflow})`)
    }
  }

  // Collision validation: text-image overlap, gap checks
  const collisionResult = validateCollisions(plan, {
    gridMode: plan.grid_spec?.grid_mode || 'strict',
  })
  issues.push(...collisionResult.issues)

  return { passed: issues.filter((i) => i.severity === 'error').length === 0, issues }
}
