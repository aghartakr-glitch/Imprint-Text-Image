import { GRID_COLUMNS, GRID_ROWS } from './layoutConstants.js'
import { DESIGN_SPACE } from './designSpace.js'

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
// object_position, design_sequence) validated against designSpace.js's vocabulary. "JSON parses"
// isn't checked here -- that's the caller's job via JSON.parse before this ever runs.
export function validateLayoutPlan(plan, { imageCount } = {}) {
  const issues = []

  if (!plan || typeof plan !== 'object') {
    return { passed: false, issues: ['layout_plan이 객체가 아닙니다'] }
  }

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

  if (!plan.grid || plan.grid.columns !== GRID_COLUMNS) {
    issues.push(`grid.columns는 ${GRID_COLUMNS}이어야 합니다 (받은 값: ${plan.grid?.columns})`)
  }
  if (!plan.grid || plan.grid.rows !== GRID_ROWS) {
    issues.push(`grid.rows는 ${GRID_ROWS}이어야 합니다 (받은 값: ${plan.grid?.rows})`)
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
      } else if (el.col_start < 1 || el.col_start + el.col_span - 1 > GRID_COLUMNS) {
        issues.push(`요소 ${el.id}: col 범위가 grid(1~${GRID_COLUMNS})를 벗어났습니다`)
      }
      if (!Number.isInteger(el.row_start) || !Number.isInteger(el.row_span) || el.row_span < 1) {
        issues.push(`요소 ${el.id}: row_start/row_span 값이 잘못되었습니다`)
      } else if (el.row_start < 1 || el.row_start + el.row_span - 1 > GRID_ROWS) {
        issues.push(`요소 ${el.id}: row 범위가 grid(1~${GRID_ROWS})를 벗어났습니다`)
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

  return { passed: issues.length === 0, issues }
}
