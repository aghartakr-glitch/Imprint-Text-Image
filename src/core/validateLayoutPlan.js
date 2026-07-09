import { GRID_COLUMNS, GRID_ROWS } from './layoutConstants.js'
import { DESIGN_SPACE } from './designSpace.js'
import { validateCollisions } from './validation/validateCollisions.js'
import { analyzeSpanVariation } from './layout/spanVariation.js'

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

  // 🔴 CRITICAL: Forbid gallery_page_text_page (separates all images from all text)
  // Must use interleaving strategies for modular layouts
  if (plan.composition_strategy === 'gallery_page_text_page') {
    issues.push('❌ gallery_page_text_page는 금지됨: 모든 이미지를 한 페이지, 모든 글을 다른 페이지에 배치하므로 이미지-텍스트 interleaving 불가능. 대신 column_flow_grid, image_left_text_right, text_left_image_right, 또는 images_spread_across_pages를 사용하세요.')
  }

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
  let spanAnalysis = null

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

        // Three legitimate ways a text element carries its content:
        //  1. text_source: "paragraph_N"/"title" — modular reference resolved by paginateGridPlan.
        //  2. text: "..."                        — pre-sliced content (grid/column-flow fallback).
        //  3. neither                            — legacy continuous-flow body; paginateGridPlan
        //                                          flows the whole body into it via overflow.
        // Only guard against the one genuinely broken form: text_source present but malformed
        // (e.g. "body_all", which used to merge every paragraph into a single undifferentiated blob).
        if (el.text_source != null) {
          if (el.text_source === 'body_all') {
            issues.push(`요소 ${el.id}: text_source는 "body_all"이 아니라 구체적인 paragraph_N을 참조해야 합니다`)
          } else if (!/^(title|paragraph_\d+)$/.test(el.text_source)) {
            issues.push(`요소 ${el.id}: text_source 형식이 잘못되었습니다: "${el.text_source}" (title 또는 paragraph_N 형식)`)
          }
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

  // Phase 5: Grid specification and span variation checks (after pages are analyzed)
  if (plan.grid_spec) {
    spanAnalysis = analyzeSpanVariation(plan)
    if (spanAnalysis.forcedRigidColumns) {
      issues.push(`❌ 모든 텍스트가 동일한(또는 1-column) 폭으로 강제 배치됨 (columns=${plan.grid_spec.columns}): grid는 이미지/텍스트의 span(1~${plan.grid_spec.columns}열)을 정하는 정렬 기준일 뿐, 모든 요소를 1열 폭으로 채우라는 뜻이 아닙니다. 문단마다 다른 col_span(2열, 3열 등)을 사용하세요.`)
    }

    // Phase 5: Reject plans with insufficient text span variation (for 3+ column grids)
    if (activeColumns >= 3 && !spanAnalysis.text_span_variation_used) {
      issues.push(`❌ Phase 5: 텍스트 span 다양화 부족: 모든 텍스트가 동일한 폭(${spanAnalysis.text_span_patterns[0] || '1-column'})으로만 배치됨. 2-column, 3-column 등을 혼합하세요.`)
    }

    // Phase 5: Reject plans with no image span variation (when multiple images exist)
    const imageCount = seenImageIndices.size
    if (imageCount >= 2 && !spanAnalysis.image_span_variation_used) {
      issues.push(`❌ Phase 5: 이미지 span 다양화 부족: ${imageCount}장의 이미지가 모두 같은 크기로 배치됨. 1-column, 2-column, 3-column 등을 혼합하세요.`)
    }

    // Phase 5: Warn if column_flow_grid is used (fallback only)
    if (plan.composition_strategy === 'column_flow_grid') {
      issues.push(`⚠️  Phase 5: column_flow_grid는 fallback입니다. flexible_modular_grid, image_text_case_blocks, asymmetrical 등을 우선 사용하세요.`)
    }
  }

  // Collision validation: text-image overlap, gap checks. validateCollisions returns structured
  // objects ({ type, severity, reason, ... }); every other check here pushes a plain string. Only
  // blocking errors are surfaced (as strings, to keep `issues` a flat string list the callers/tests
  // expect); severity:'warning' gap notices are advisory and intentionally non-blocking.
  const collisionResult = validateCollisions(plan, {
    gridMode: plan.grid_spec?.grid_mode || 'strict',
  })
  collisionResult.issues
    .filter((i) => i.severity === 'error')
    .forEach((i) => issues.push(`요소 충돌(${i.type}): ${i.element_a} ↔ ${i.element_b} (page ${i.page}) — ${i.reason}`))

  // A plan is valid only when it has zero issues. Previously this filtered on `i.severity === 'error'`,
  // but every check above pushes a *string* (no .severity), so that filter silently passed EVERY
  // plan — disabling the entire validation layer (bad enums, unplaced images, missing paragraphs,
  // forbidden composition strategies all sailed through as passed:true). Now string issues block.
  return { passed: issues.length === 0, issues }
}
