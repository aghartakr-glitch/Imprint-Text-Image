import { GRID_COLUMNS, GRID_ROWS } from './layoutConstants.js'

const VALID_STYLES = ['Editorial', 'Magazine', 'Exhibition Catalog']
const VALID_LAYOUT_FAMILIES = ['image-first', 'balanced', 'text-first']
const VALID_IMAGE_ROLES = ['hero', 'support', 'equal', 'gallery']

function colRangeOverlap(a, b) {
  return a.col_start <= b.col_start + b.col_span - 1 && b.col_start <= a.col_start + a.col_span - 1
}
function rowRangeOverlap(a, b) {
  return a.row_start <= b.row_start + b.row_span - 1 && b.row_start <= a.row_start + a.row_span - 1
}

// Every one of the 15 checks from the spec's validation checklist, minus "JSON parses" (that's
// the caller's job via JSON.parse before this ever runs). Grid-bounds checks (6/7/8) also cover
// "no element leaves the page" (15): a valid grid position maps to a physical box fully inside
// the page by construction, so there's nothing extra to check in mm-space.
export function validateLayoutPlan(plan, { imageCount } = {}) {
  const issues = []

  if (!plan || typeof plan !== 'object') {
    return { passed: false, issues: ['layout_plan이 객체가 아닙니다'] }
  }

  if (!VALID_STYLES.includes(plan.style)) {
    issues.push(`알 수 없는 style: ${plan.style}`)
  }
  if (!VALID_LAYOUT_FAMILIES.includes(plan.layout_family)) {
    issues.push(`알 수 없는 layout_family: ${plan.layout_family}`)
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
        if (el.role && !VALID_IMAGE_ROLES.includes(el.role)) {
          issues.push(`요소 ${el.id}: 알 수 없는 이미지 role: ${el.role}`)
        }
        const match = /^image_(\d+)$/.exec(el.id || '')
        if (match) seenImageIndices.add(Number(match[1]))
      }

      if (el.type === 'text') {
        if (el.role === 'caption') {
          issues.push(`요소 ${el.id}: 캡션 요소는 허용되지 않습니다`)
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

  return { passed: issues.length === 0, issues }
}
