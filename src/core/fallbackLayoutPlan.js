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

function stackVertically(count, region) {
  const rowSpanEach = Math.max(1, Math.floor(region.row_span / count))
  return Array.from({ length: count }, (_, i) => ({
    col_start: region.col_start,
    col_span: region.col_span,
    row_start: region.row_start + i * rowSpanEach,
    row_span: rowSpanEach,
  }))
}

// startIndex lets a variant place a *subset* of the images (e.g. images 3-6 on page 2) while
// keeping element ids matching their real image_N upload index.
function imageElementsAt(startIndex, cells, role) {
  return cells.map((cell, i) => ({
    id: `image_${startIndex + i}`, type: 'image', role, fit: 'contain', object_position: 'center', ...cell,
  }))
}

function imageElements(imageCount, region, role) {
  return imageElementsAt(1, splitGridCells(imageCount, region), role)
}

function bodyText(region, id = 'body_1') {
  return {
    id, type: 'text', role: 'body', ...region,
  }
}

// Deterministic (same input -> same variant, so results stay reproducible/testable) but varies
// across different real inputs -- fixes the "every 3-image generation looks identical" bug where
// the fallback had exactly one shape per image-count bucket regardless of the actual photos/text.
function pickVariantIndex(seedParts, variantCount) {
  const seedString = seedParts.join('|')
  let hash = 0
  for (let i = 0; i < seedString.length; i += 1) {
    hash = (Math.imul(hash, 31) + seedString.charCodeAt(i)) >>> 0
  }
  return hash % variantCount
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

// --- 3-6 images, short/medium text: three real variants (spec 11 only demanded "adaptive grid +
// text block", but a single fixed shape is exactly the "images always crammed in one row" bug) ---

function galleryGridVariant(imageCount) {
  return plan({
    layoutFamily: 'balanced',
    layoutPurpose: 'gallery',
    imageHierarchy: 'grid_gallery',
    imageTextRelation: 'equal_visual_text',
    compositionStrategy: 'grid_gallery',
    outputUnit: 'single_page',
    basePatternReference: imageCount === 4 ? 'grid_2x2_with_text' : 'gallery_with_text_block',
    elements: [
      ...imageElements(imageCount, {
        col_start: 1, col_span: 6, row_start: 1, row_span: 6,
      }, 'gallery'),
      bodyText({
        col_start: 1, col_span: 6, row_start: 8, row_span: 5,
      }),
    ],
    reason: `이미지 ${imageCount}장 + 짧거나 중간 길이 본문: grid gallery 변형 (모든 이미지를 균등한 격자로)`,
  })
}

function heroSupportVariant(imageCount) {
  const heroCell = {
    col_start: 1, col_span: 3, row_start: 1, row_span: 7,
  }
  const supportCells = stackVertically(imageCount - 1, {
    col_start: 4, col_span: 3, row_start: 1, row_span: 7,
  })
  return plan({
    layoutFamily: 'balanced',
    layoutPurpose: 'case_analysis',
    imageHierarchy: 'hero_support',
    imageTextRelation: 'text_explains_image',
    compositionStrategy: 'hero_support',
    outputUnit: 'single_page',
    basePatternReference: 'hero_image_plus_secondary',
    elements: [
      ...imageElementsAt(1, [heroCell], 'hero'),
      ...imageElementsAt(2, supportCells, 'support'),
      bodyText({
        col_start: 1, col_span: 6, row_start: 9, row_span: 4,
      }),
    ],
    reason: `이미지 ${imageCount}장 + 짧거나 중간 길이 본문: hero+support 변형 (대표 이미지 1장 크게, 나머지는 보조)`,
  })
}

function twoPageDistributedVariant(imageCount) {
  const page1Count = Math.ceil(imageCount / 2)
  const page2Count = imageCount - page1Count
  return multiPagePlan({
    layoutFamily: 'balanced',
    layoutPurpose: 'gallery',
    imageHierarchy: 'grid_gallery',
    imageTextRelation: 'text_explains_image',
    compositionStrategy: 'gallery_left_text_right',
    outputUnit: 'spread',
    basePatternReference: 'gallery_with_text_block',
    pagesElements: [
      imageElementsAt(1, splitGridCells(page1Count, {
        col_start: 1, col_span: 6, row_start: 1, row_span: 12,
      }), 'gallery'),
      [
        ...imageElementsAt(page1Count + 1, splitGridCells(page2Count, {
          col_start: 1, col_span: 6, row_start: 1, row_span: 6,
        }), 'gallery'),
        bodyText({
          col_start: 1, col_span: 6, row_start: 8, row_span: 5,
        }),
      ],
    ],
    reason: `이미지 ${imageCount}장 + 짧거나 중간 길이 본문: 2페이지 분산 변형 (이미지를 두 페이지로 나눠 배치)`,
  })
}

// One image per page (never grouped), followed by a dedicated text page -- a real editorial-
// magazine pattern where photos breathe across a whole story instead of all clustering onto one
// crowded page. Directly addresses "sparse, one-photo-per-page" as a real, selectable option.
function sparsePerPageVariant(imageCount) {
  const imagePages = Array.from({ length: imageCount }, (_, i) => imageElementsAt(i + 1, [{
    col_start: 1, col_span: 6, row_start: 2, row_span: 9,
  }], 'gallery'))
  const textPage = [bodyText({
    col_start: 1, col_span: 6, row_start: 1, row_span: 12,
  })]
  return multiPagePlan({
    layoutFamily: 'image-first',
    layoutPurpose: 'gallery',
    imageHierarchy: 'page_gallery',
    imageTextRelation: 'gallery_then_text',
    compositionStrategy: 'images_spread_across_pages',
    outputUnit: 'spread',
    basePatternReference: 'one_page_gallery_one_page_text',
    pagesElements: [...imagePages, textPage],
    reason: `이미지 ${imageCount}장 + 짧거나 중간 길이 본문: 이미지 1장씩 별도 페이지에 듬성듬성 분산 배치하는 변형`,
  })
}

// Deterministic, grid-based fallback used only when the LLM is unavailable or still fails
// validation after retries. Rules from spec section 11's table; several buckets now offer
// multiple real layout variants (chosen deterministically from the actual input, not always the
// same one) instead of a single fixed shape per image-count/text-density combination.
export function buildFallbackLayoutPlan({
  imageCount, textDensity, imageAspectRatios = [], textLength = 0,
}) {
  const { outputUnit } = decideOutputUnit({ imageCount, textDensity })
  const variantSeed = [
    imageCount, textDensity, textLength,
    ...imageAspectRatios.map((r) => Math.round(r * 100)),
  ]

  if (imageCount === 1 && textDensity === 'long') {
    const variants = [
      () => plan({
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
      }),
      () => plan({
        layoutFamily: 'text-first',
        layoutPurpose: 'editorial_reading',
        imageHierarchy: 'single_hero',
        imageTextRelation: 'image_supports_text',
        compositionStrategy: 'image_left_text_right',
        outputUnit,
        basePatternReference: 'single_left_image_right_text',
        elements: [
          ...imageElements(1, {
            col_start: 1, col_span: 3, row_start: 1, row_span: 12,
          }, 'hero'),
          bodyText({
            col_start: 4, col_span: 3, row_start: 1, row_span: 12,
          }),
        ],
        reason: '이미지 1장 + 긴 본문: 이미지가 왼쪽, 글이 오른쪽에 배치되는 결정론적 폴백 (변형)',
      }),
    ]
    return variants[pickVariantIndex(variantSeed, variants.length)]()
  }

  if (imageCount === 1) {
    const variants = [
      () => plan({
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
      }),
      () => plan({
        layoutFamily: 'balanced',
        layoutPurpose: 'visual_showcase',
        imageHierarchy: 'single_hero',
        imageTextRelation: 'image_supports_text',
        compositionStrategy: 'image_left_text_right',
        outputUnit,
        basePatternReference: 'single_left_image_right_text',
        elements: [
          ...imageElements(1, {
            col_start: 1, col_span: 3, row_start: 1, row_span: 12,
          }, 'hero'),
          bodyText({
            col_start: 4, col_span: 3, row_start: 1, row_span: 12,
          }),
        ],
        reason: '이미지 1장 + 짧거나 중간 길이 본문: 이미지 왼쪽, 본문 오른쪽 배치의 결정론적 폴백 (변형)',
      }),
    ]
    return variants[pickVariantIndex(variantSeed, variants.length)]()
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
    const variants = [galleryGridVariant, heroSupportVariant, twoPageDistributedVariant, sparsePerPageVariant]
    return variants[pickVariantIndex(variantSeed, variants.length)](imageCount)
  }

  throw new Error(`지원하지 않는 이미지 개수: ${imageCount}`)
}
