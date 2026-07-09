// Spec Phase 3.1: Case study cards grid layout builder
// For 4 images + 4 case studies: a 2x2 grid of cards, each with image above description

export function buildCaseStudyCardsGrid({ imageCount, contentStructure, userGridSettings = {} }) {
  if (imageCount !== 4 || !contentStructure?.case_study_items?.length !== 4) {
    return null // Not applicable for this content
  }

  const { case_study_items: cases } = contentStructure
  const gridColumns = userGridSettings.columns ?? 6
  const gridRows = userGridSettings.rows ?? 12

  // 2x2 card grid: each card takes 3 cols × 6 rows (if 6-col grid)
  // Page 1: cards 1-2 top, Page 2: cards 3-4 bottom
  // For 4-col grid: each card takes 2 cols × 6 rows
  const cardWidth = gridColumns / 2
  const cardHeight = gridRows / 2

  const elements = []
  let page = 1
  let rowOffset = 1

  for (let i = 0; i < 4; i++) {
    const col = (i % 2) * cardWidth + 1
    const row = Math.floor(i / 2) * cardHeight + rowOffset

    // Image: upper half of card
    elements.push({
      id: `image_${i + 1}`,
      type: 'image',
      role: 'equal',
      page,
      col_start: col,
      col_span: cardWidth,
      row_start: row,
      row_span: Math.ceil(cardHeight / 2),
      fit: 'contain',
      object_position: 'center',
    })

    // Text: lower half of card
    elements.push({
      id: `case_${i + 1}`,
      type: 'text',
      role: 'body',
      page,
      col_start: col,
      col_span: cardWidth,
      row_start: row + Math.ceil(cardHeight / 2),
      row_span: Math.floor(cardHeight / 2),
    })

    // Move to next page after 2 cards
    if (i === 1) {
      page = 2
      rowOffset = 1
    }
  }

  return {
    candidate_id: 'builtin_case_study_cards_1',
    style: 'Editorial',
    output_unit: 'spread',
    layout_family: 'case_study_cards_grid',
    layout_purpose: 'case_analysis',
    image_hierarchy: 'equal_pair', // All 4 equal importance
    image_text_relation: 'case_study_cards',
    composition_strategy: 'grid_gallery',
    base_pattern_reference: 'four_cards_2x2_grid',
    layout_intent: '4 case studies in 2x2 card grid with images',
    design_sequence: [
      { step: 1, decision_type: 'layout_family', value: 'case_study_cards_grid', reason: '4 images + 4 cases detected' },
      { step: 2, decision_type: 'composition_strategy', value: 'grid_gallery', reason: '2x2 card layout with equal hierarchy' },
      { step: 3, decision_type: 'output_unit', value: 'spread', reason: 'Two pages: 2 cards per page' },
    ],
    grid: { columns: gridColumns, rows: gridRows },
    grid_spec: {
      columns: gridColumns,
      rows: gridRows,
      page_size: userGridSettings.page_size || 'A5',
      margin_preset: userGridSettings.margin_preset || 'recommended',
      gutter_mm: userGridSettings.gutter_mm || 4,
      grid_mode: userGridSettings.grid_mode || 'strict',
    },
    reserved_regions: elements
      .filter((el) => el.type === 'image')
      .map((el) => ({
        page: el.page,
        col_start: el.col_start,
        col_span: el.col_span,
        row_start: el.row_start,
        row_span: el.row_span,
      })),
    text_flow: {
      mode: 'block_flow',
      flow_regions: [
        { page: 1, col_start: 1, col_span: gridColumns, row_start: 1, row_span: gridRows },
        { page: 2, col_start: 1, col_span: gridColumns, row_start: 1, row_span: gridRows },
      ],
      overflow_policy: { body_overflow: 'continue_to_next_page' },
    },
    layout_variation: 'card_grid_2x2',
    pages: [
      {
        page: 1,
        elements: elements.filter((el) => el.page === 1),
      },
      {
        page: 2,
        elements: elements.filter((el) => el.page === 2),
      },
    ],
    title_behavior: 'title_page_only', // Case studies are self-contained; title on separate page
    overflow_policy: { body_overflow: 'continue_to_next_page' },
    reason: 'Dedicated 2x2 card grid for case studies',
  }
}
