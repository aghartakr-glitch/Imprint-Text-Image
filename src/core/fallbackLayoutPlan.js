import { GRID_COLUMNS, GRID_ROWS } from './layoutConstants.js'
import { decideOutputUnit } from './outputUnit.js'

// Same row-splitting idea the old fixed pattern library used for image grids, but expressed in
// grid cells (columns/rows) instead of mm, so it slots straight into a layout_plan.
const ROW_LAYOUTS = {
  1: [1], 2: [2], 3: [3], 4: [2, 2], 5: [3, 2], 6: [3, 3],
}

function splitGridCells(count, region) {
  const rowsLayout = ROW_LAYOUTS[count]
  if (!rowsLayout) throw new Error(`지원하지 않는 이미지 개수: ${count}`)
  const rowCount = rowsLayout.length
  const rowSpanEach = Math.max(1, Math.floor(region.row_span / rowCount))

  const cells = []
  rowsLayout.forEach((colCount, rowIdx) => {
    const rowStart = region.row_start + rowIdx * rowSpanEach
    const colSpanEach = Math.max(1, Math.floor(region.col_span / colCount))
    for (let c = 0; c < colCount; c += 1) {
      cells.push({
        col_start: region.col_start + c * colSpanEach,
        col_span: colSpanEach,
        row_start: rowStart,
        row_span: rowSpanEach,
      })
    }
  })
  return cells
}

function imageElements(imageCount, region, role) {
  return splitGridCells(imageCount, region).map((cell, i) => ({
    id: `image_${i + 1}`, type: 'image', role, fit: 'contain', object_position: 'center', ...cell,
  }))
}

function bodyText(region) {
  return {
    id: 'body_1', type: 'text', role: 'body', ...region,
  }
}

function designSequenceFor({
  outputUnit, layoutPurpose, layoutFamily, imageHierarchy, imageTextRelation, compositionStrategy, reason,
}) {
  return [
    {
      step: 1, decision_type: 'output_unit', value: outputUnit, reason,
    },
    {
      step: 2, decision_type: 'layout_purpose', value: layoutPurpose, reason,
    },
    {
      step: 3, decision_type: 'layout_family', value: layoutFamily, reason,
    },
    {
      step: 4, decision_type: 'image_hierarchy', value: imageHierarchy, reason,
    },
    {
      step: 5, decision_type: 'image_text_relation', value: imageTextRelation, reason,
    },
    {
      step: 6, decision_type: 'composition_strategy', value: compositionStrategy, reason,
    },
    {
      step: 7, decision_type: 'grid_layout', value: `${GRID_COLUMNS}_columns_${GRID_ROWS}_rows`, reason: 'A5 고정 grid 사용',
    },
  ]
}

function plan({
  layoutFamily, layoutPurpose, imageHierarchy, imageTextRelation, compositionStrategy, outputUnit,
  basePatternReference, elements, reason,
}) {
  return {
    style: 'Editorial',
    output_unit: outputUnit,
    layout_family: layoutFamily,
    layout_purpose: layoutPurpose,
    image_hierarchy: imageHierarchy,
    image_text_relation: imageTextRelation,
    composition_strategy: compositionStrategy,
    base_pattern_reference: basePatternReference,
    layout_intent: reason,
    design_sequence: designSequenceFor({
      outputUnit, layoutPurpose, layoutFamily, imageHierarchy, imageTextRelation, compositionStrategy, reason,
    }),
    grid: { columns: GRID_COLUMNS, rows: GRID_ROWS },
    pages: [{ page: 1, elements }],
    overflow_policy: { body_overflow: 'continue_to_next_page' },
    reason,
  }
}

function multiPagePlan({
  layoutFamily, layoutPurpose, imageHierarchy, imageTextRelation, compositionStrategy, outputUnit,
  basePatternReference, pagesElements, reason,
}) {
  return {
    style: 'Editorial',
    output_unit: outputUnit,
    layout_family: layoutFamily,
    layout_purpose: layoutPurpose,
    image_hierarchy: imageHierarchy,
    image_text_relation: imageTextRelation,
    composition_strategy: compositionStrategy,
    base_pattern_reference: basePatternReference,
    layout_intent: reason,
    design_sequence: designSequenceFor({
      outputUnit, layoutPurpose, layoutFamily, imageHierarchy, imageTextRelation, compositionStrategy, reason,
    }),
    grid: { columns: GRID_COLUMNS, rows: GRID_ROWS },
    pages: pagesElements.map((elements, i) => ({ page: i + 1, elements })),
    overflow_policy: { body_overflow: 'continue_to_next_page' },
    reason,
  }
}

// Deterministic, grid-based fallback used only when the LLM is unavailable or still fails
// validation after retries. Rules from the spec section 11 table; 5-6 images + short/medium
// text isn't explicitly listed there, so it's extended from the 3-4-image adaptive-grid rule
// (same shape, just more cells).
export function buildFallbackLayoutPlan({ imageCount, textDensity }) {
  const { outputUnit } = decideOutputUnit({ imageCount, textDensity })

  if (imageCount === 1 && textDensity === 'long') {
    return plan({
      layoutFamily: 'text-first',
      layoutPurpose: 'editorial_reading',
      imageHierarchy: 'single_hero',
      imageTextRelation: 'image_supports_text',
      compositionStrategy: 'text_left_image_right',
      outputUnit,
      basePatternReference: 'single_left_text_right_image',
      elements: [
        bodyText({
          col_start: 1, col_span: 3, row_start: 1, row_span: 12,
        }),
        ...imageElements(1, {
          col_start: 4, col_span: 3, row_start: 1, row_span: 12,
        }, 'hero'),
      ],
      reason: '이미지 1장 + 긴 본문: 글이 왼쪽, 이미지가 오른쪽에 배치되는 결정론적 폴백',
    })
  }

  if (imageCount === 1) {
    return plan({
      layoutFamily: 'image-first',
      layoutPurpose: 'visual_showcase',
      imageHierarchy: 'single_hero',
      imageTextRelation: 'image_sets_mood',
      compositionStrategy: 'image_above_text',
      outputUnit,
      basePatternReference: 'single_page_with_text_below',
      elements: [
        ...imageElements(1, {
          col_start: 1, col_span: 6, row_start: 1, row_span: 6,
        }, 'hero'),
        bodyText({
          col_start: 1, col_span: 6, row_start: 8, row_span: 5,
        }),
      ],
      reason: '이미지 1장 + 짧거나 중간 길이 본문: 이미지가 위, 본문이 아래인 결정론적 폴백',
    })
  }

  if (imageCount === 2 && textDensity === 'short') {
    return plan({
      layoutFamily: 'image-first',
      layoutPurpose: 'comparison',
      imageHierarchy: 'equal_pair',
      imageTextRelation: 'equal_visual_text',
      compositionStrategy: 'equal_images',
      outputUnit,
      basePatternReference: 'two_equal_images',
      elements: [
        ...imageElements(2, {
          col_start: 1, col_span: 6, row_start: 1, row_span: 6,
        }, 'equal'),
        bodyText({
          col_start: 1, col_span: 6, row_start: 8, row_span: 5,
        }),
      ],
      reason: '이미지 2장 + 짧은 본문: 동일 비중 이미지 2장과 하단 본문의 결정론적 폴백',
    })
  }

  if (imageCount === 2) {
    return plan({
      layoutFamily: 'balanced',
      layoutPurpose: 'case_analysis',
      imageHierarchy: 'equal_pair',
      imageTextRelation: 'text_explains_image',
      compositionStrategy: 'image_above_text',
      outputUnit,
      basePatternReference: 'two_images_top_text_bottom',
      elements: [
        ...imageElements(2, {
          col_start: 1, col_span: 6, row_start: 1, row_span: 4,
        }, 'equal'),
        bodyText({
          col_start: 1, col_span: 6, row_start: 6, row_span: 7,
        }),
      ],
      reason: '이미지 2장 + 중간/긴 본문: 상단 이미지 2장, 넉넉한 하단 본문의 결정론적 폴백',
    })
  }

  if (imageCount >= 3 && imageCount <= 6 && textDensity === 'long') {
    return multiPagePlan({
      layoutFamily: 'text-first',
      layoutPurpose: 'gallery',
      imageHierarchy: 'page_gallery',
      imageTextRelation: 'gallery_then_text',
      compositionStrategy: 'gallery_page_text_page',
      outputUnit,
      basePatternReference: 'one_page_gallery_one_page_text',
      pagesElements: [
        imageElements(imageCount, {
          col_start: 1, col_span: 6, row_start: 1, row_span: 12,
        }, 'gallery'),
        [bodyText({
          col_start: 1, col_span: 6, row_start: 1, row_span: 12,
        })],
      ],
      reason: `이미지 ${imageCount}장 + 긴 본문: 갤러리 페이지와 읽기 전용 페이지를 분리하는 결정론적 폴백`,
    })
  }

  if (imageCount >= 3 && imageCount <= 6) {
    return plan({
      layoutFamily: 'balanced',
      layoutPurpose: 'gallery',
      imageHierarchy: 'grid_gallery',
      imageTextRelation: 'equal_visual_text',
      compositionStrategy: 'grid_gallery',
      outputUnit,
      basePatternReference: imageCount === 4 ? 'grid_2x2_with_text' : 'gallery_with_text_block',
      elements: [
        ...imageElements(imageCount, {
          col_start: 1, col_span: 6, row_start: 1, row_span: 6,
        }, 'gallery'),
        bodyText({
          col_start: 1, col_span: 6, row_start: 8, row_span: 5,
        }),
      ],
      reason: `이미지 ${imageCount}장 + 짧거나 중간 길이 본문: 이미지 grid와 하단 본문의 결정론적 폴백`,
    })
  }

  throw new Error(`지원하지 않는 이미지 개수: ${imageCount}`)
}
