import { GRID_COLUMNS, GRID_ROWS, TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM } from './layoutConstants.js'
import { decideOutputUnit } from './outputUnit.js'
import { parseTextBlocks } from './text/parseTextBlocks.js'
import { flowTextAcrossColumns, makeContinuationFlowRegion } from './text/ColumnFlowEngine.js'

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

// Classifies an image's aspect ratio (width/height) into how many grid columns it should claim.
// A wide/landscape photo reads naturally as a banner across most or all of the row; a portrait
// photo reads naturally as a narrow, tall column. Capped to the user's actual column count so a
// 2-column grid never asks for a span that doesn't exist.
function colSpanForAspectRatio(ratio, columns) {
  const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  let fraction
  if (r >= 1.5) fraction = 1 // full-width banner
  else if (r >= 1.15) fraction = 0.6 // landscape
  else if (r >= 0.85) fraction = 0.4 // square
  else fraction = 0.28 // portrait
  // Images read as editorial visual anchors, never as a single narrow grid sliver -- floor at 2
  // columns whenever the grid has room for it (columns===1 has no choice but 1).
  const floor = columns >= 2 ? 2 : 1
  return Math.min(columns, Math.max(floor, Math.round(columns * fraction)))
}

function rowSpanForAspectRatio(ratio, rows) {
  const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  let fraction
  if (r >= 1.5) fraction = 0.22
  else if (r >= 1.15) fraction = 0.3
  else if (r >= 0.85) fraction = 0.28
  else fraction = 0.38
  return Math.min(rows - 1, Math.max(2, Math.round(rows * fraction)))
}

// Section 5.4/7 of the "Grid Preset + Column Flow" supplement, redesigned so images and body text
// genuinely interleave instead of "all images in a uniform grid up top, all text below/after"
// (the exact anti-pattern this replaces -- confirmed by a real run where 6 images were forced into
// identical 26mm cells via splitGridCells, ignoring every image's real aspect ratio, and
// `resolved_grid_settings.variation_level` was computed but never actually consumed anywhere).
//
// Each image becomes its own "band": a row range on some page, with a column span (1..columns)
// driven by its real aspect ratio -- landscape photos claim most/all of the row as a banner,
// square photos claim less than half, portraits claim a narrow column -- and whatever columns
// remain in that same row range become a `textRegion` so body text flows immediately beside that
// image, not after every image. Bands stack down the page and wrap onto additional pages once a
// page's rows are exhausted, so images are distributed across the whole spread instead of
// clustered in a single dense block. Left/right alternation per band (even index: image left/text
// right; odd index: image right/text left) adds real visual variety along the way.
function imageBandsFor(imageAspectRatios, columns, rows) {
  const bands = []
  let page = 1
  let rowCursor = 1
  imageAspectRatios.forEach((ratio, i) => {
    const colSpan = colSpanForAspectRatio(ratio, columns)
    const rowSpan = rowSpanForAspectRatio(ratio, rows)
    if (rowCursor + rowSpan - 1 > rows) {
      page += 1
      rowCursor = 1
    }
    const imageOnRight = colSpan < columns && i % 2 === 1
    const imageColStart = imageOnRight ? columns - colSpan + 1 : 1
    const image = {
      page, col_start: imageColStart, col_span: colSpan, row_start: rowCursor, row_span: rowSpan,
    }
    let textRegion = null
    if (colSpan < columns) {
      const textColSpan = columns - colSpan
      const textColStart = imageOnRight ? 1 : colSpan + 1
      textRegion = {
        page, col_start: textColStart, col_span: textColSpan, row_start: rowCursor, row_span: rowSpan,
      }
    }
    bands.push({ image, textRegion })
    rowCursor += rowSpan + 1 // +1 row gap between bands
  })
  return bands
}

function textElementsFromSlots(slots, pageNum) {
  return slots.map((slot, i) => ({
    id: `body_p${pageNum}_c${i + 1}`,
    type: 'text',
    role: 'body',
    col_start: slot.col_start,
    col_span: slot.col_span,
    row_start: slot.row_start,
    row_span: slot.row_span,
    text: slot.textSlice,
  }))
}

// Real column-flow grid fallback (spec section 7/11): unlike the legacy fixed-6x12 variants
// above, this respects the user's actual grid_spec (page_size/margin_preset/columns/grid_mode,
// resolved via GridPresetManager) and flows body text across real column slots that route around
// the image reserved_regions (via ColumnFlowEngine/ReservedRegionManager) instead of a single
// fixed body-text box. Every body-role element it emits already carries its final pre-sliced
// `text` -- reconstructLayout.js recognizes the plan's `grid_spec` field and skips the legacy
// paginateGridPlan re-slicing step accordingly.
export function buildGridFallbackPlan({
  imageCount, textDensity, imageAspectRatios = [], textLength = 0, text = '', title = '', gridSettings,
}) {
  const { outputUnit } = decideOutputUnit({ imageCount, textDensity })
  const { grid_spec: gridSpecRaw, resolved_grid_settings: resolved } = gridSettings
  const columns = gridSpecRaw.columns
  const rows = gridSpecRaw.rows
  const gridSpec = {
    columns, rows, gutterMm: gridSpecRaw.gutter_mm, boxWidthMm: TEXT_BOX_WIDTH_MM, boxHeightMm: TEXT_BOX_HEIGHT_MM,
  }

  // Real aspect ratios drive each image's column span (see imageBandsFor) so images are never
  // forced into a uniform grid; ratios missing/invalid fall back to a square guess.
  const ratios = Array.from({ length: imageCount }, (_, i) => imageAspectRatios[i] ?? 1)
  const bands = imageBandsFor(ratios, columns, rows)
  const imageRole = imageCount === 1 ? 'hero' : (imageCount === 2 ? 'equal' : 'gallery')
  const imageEls = bands.map((band, i) => ({
    id: `image_${i + 1}`, type: 'image', role: imageRole, fit: 'contain', object_position: 'center', ...band.image,
  }))
  const reservedRegions = bands.map((band) => band.image)
  const lastImagePage = bands.length > 0 ? bands[bands.length - 1].image.page : 1

  // parseTextBlocks may peel off an auto-detected title-like first paragraph when no explicit
  // title was given; with no explicit title there is no separate title page to render it on, so
  // fold it back into the body flow here rather than silently dropping that text.
  const parsed = parseTextBlocks({ title, text })
  const hasExplicitTitle = typeof title === 'string' && title.trim().length > 0
  // ColumnFlowEngine only flows role: 'body' blocks; without an explicit title there is no
  // separate title page, so relabel any auto-detected title block back to 'body' instead of
  // dropping it (see the comment above buildGridFallbackPlan).
  const bodyBlocks = hasExplicitTitle
    ? parsed.text_blocks.filter((b) => b.role === 'body')
    : parsed.text_blocks.map((b) => (b.role === 'title' ? { ...b, role: 'body' } : b))

  // One flow_region per band's text slot (beside that band's image, same page/rows) IN BAND ORDER,
  // so paragraphs land directly next to the image they're adjacent to instead of being pushed
  // below every image. Bands whose image claims the full row (no side room) contribute no region
  // here -- text simply continues into the next band or the trailing full-width region below.
  const bandFlowRegions = bands.filter((b) => b.textRegion).map((b) => b.textRegion)
  // After the last image band, whatever page it landed on may still have unused rows below it;
  // give body text a trailing full-width region there so it isn't wasted.
  const lastBand = bands[bands.length - 1]
  const usedRowEnd = lastBand ? lastBand.image.row_start + lastBand.image.row_span : 0
  const trailingRegion = usedRowEnd < rows
    ? [{
      page: lastImagePage, col_start: 1, col_span: columns, row_start: usedRowEnd + 1, row_span: rows - usedRowEnd,
    }]
    : []
  const flowRegions = [...bandFlowRegions, ...trailingRegion]

  const reservedRegionsByPage = {}
  reservedRegions.forEach((r) => {
    reservedRegionsByPage[r.page] = [...(reservedRegionsByPage[r.page] ?? []), r]
  })

  const { filledSlots, remainingText } = flowTextAcrossColumns({
    textBlocks: bodyBlocks, flowRegions, reservedRegionsByPage, gridSpec,
  })

  // Group filled text slots (and images) by page to build each page's element list.
  const pageNumbers = new Set([1, ...imageEls.map((el) => el.page), ...filledSlots.map((s) => s.page)])
  const maxPage = Math.max(...pageNumbers)
  const pagesElements = []
  for (let p = 1; p <= maxPage; p += 1) {
    pagesElements.push([
      ...imageEls.filter((el) => el.page === p).map(({ page, ...rest }) => rest),
      ...textElementsFromSlots(filledSlots.filter((s) => s.page === p), p).map(({ page, ...rest }) => rest),
    ])
  }

  let remaining = remainingText
  let pageNum = maxPage + 1
  const MAX_CONTINUATION_PAGES = 500 // safety cap against a pathological infinite loop
  while (remaining.length > 0 && pageNum <= MAX_CONTINUATION_PAGES) {
    const region = makeContinuationFlowRegion({ page: pageNum, gridSpec })
    const { filledSlots: contSlots, remainingText: contRemaining } = flowTextAcrossColumns({
      textBlocks: [{ id: `overflow_${pageNum}`, role: 'body', text: remaining }],
      flowRegions: [region],
      gridSpec,
    })
    pagesElements.push(textElementsFromSlots(contSlots, pageNum).map(({ page, ...rest }) => rest))
    remaining = contRemaining
    pageNum += 1
  }

  const layoutFamily = imageCount === 1 ? 'balanced' : (imageCount >= 3 ? 'image-first' : 'balanced')
  const layoutPurpose = imageCount >= 3 ? 'gallery' : 'case_analysis'
  const imageHierarchy = imageCount === 1 ? 'single_hero' : (imageCount === 2 ? 'equal_pair' : 'grid_gallery')
  const compositionStrategy = 'column_flow_grid'
  const reason = `이미지 ${imageCount}장 + ${textDensity} 본문: 사용자 grid 설정(${columns}열/${rows}행) 기반 column-flow 폴백`

  return {
    style: 'Editorial',
    output_unit: outputUnit,
    layout_family: layoutFamily,
    layout_purpose: layoutPurpose,
    image_hierarchy: imageHierarchy,
    image_text_relation: 'text_explains_image',
    composition_strategy: compositionStrategy,
    base_pattern_reference: 'user_grid_preset_column_flow',
    layout_intent: reason,
    design_sequence: [
      ...designSequenceFor({
        outputUnit, layoutPurpose, layoutFamily, imageHierarchy, imageTextRelation: 'text_explains_image', compositionStrategy, reason,
      }).filter((step) => step.decision_type !== 'grid_layout'),
      {
        step: 7, decision_type: 'grid_layout', value: `${columns}_columns_${rows}_rows`, reason: '사용자 grid 설정',
      },
    ],
    grid: { columns, rows },
    grid_spec: gridSpecRaw,
    resolved_grid_settings: resolved,
    reserved_regions: reservedRegions,
    text_flow: { mode: resolved.text_flow, flow_regions: flowRegions },
    layout_variation: `${resolved.image_behavior}_${resolved.text_flow}`,
    pages: pagesElements.map((elements, i) => ({ page: i + 1, elements })),
    overflow_policy: { body_overflow: 'continue_to_next_page' },
    reason,
  }
}

// Deterministic, grid-based fallback used only when the LLM is unavailable or still fails
// validation after retries. Rules from spec section 11's table; several buckets now offer
// multiple real layout variants (chosen deterministically from the actual input, not always the
// same one) instead of a single fixed shape per image-count/text-density combination.
//
// When `gridSettings` is supplied (the user's 4 grid settings resolved via GridPresetManager),
// this delegates entirely to buildGridFallbackPlan above -- the real column-flow engine wired
// into runGeneration.mjs. Without it (e.g. a direct unit-test call), the legacy fixed-6x12
// variants below still run unchanged.
export function buildFallbackLayoutPlan({
  imageCount, textDensity, imageAspectRatios = [], textLength = 0, text, title, gridSettings,
}) {
  if (gridSettings) {
    return buildGridFallbackPlan({
      imageCount, textDensity, imageAspectRatios, textLength, text: text ?? '', title: title ?? '', gridSettings,
    })
  }
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
    // Was gallery_page_text_page (all images on one page, all text on the next) -- the exact
    // "images front, text back" anti-pattern. Use the sparse one-image-per-page variant instead so
    // images are distributed across pages (images_spread_across_pages) with the body following.
    return sparsePerPageVariant(imageCount)
  }

  if (imageCount >= 3 && imageCount <= 6) {
    const variants = [galleryGridVariant, heroSupportVariant, twoPageDistributedVariant, sparsePerPageVariant]
    return variants[pickVariantIndex(variantSeed, variants.length)](imageCount)
  }

  throw new Error(`지원하지 않는 이미지 개수: ${imageCount}`)
}
