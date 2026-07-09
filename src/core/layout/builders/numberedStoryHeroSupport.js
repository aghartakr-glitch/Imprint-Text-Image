// Spec Phase 3.2: Numbered story with hero + support images layout builder
// For 3 images + 3 numbered items: hero image (large) + body text on page 1,
// then 2 support images paired with numbered item 2-3 on page 2

export function buildNumberedStoryHeroSupport({ imageCount, contentStructure, userGridSettings = {} }) {
  if (imageCount !== 3 || !contentStructure?.numbered_items?.length !== 3) {
    return null // Not applicable for this content
  }

  const gridColumns = userGridSettings.columns ?? 6
  const gridRows = userGridSettings.rows ?? 12

  // Page 1: Hero image (top, full width) + first numbered item (bottom)
  // Page 2: Two support images (left/right split) + numbered items 2-3 (below)

  const elements = [
    // Page 1: hero image (top)
    {
      id: 'image_1',
      type: 'image',
      role: 'hero',
      page: 1,
      col_start: 1,
      col_span: gridColumns,
      row_start: 1,
      row_span: 7,
      fit: 'contain',
      object_position: 'center',
    },
    // Page 1: first numbered item (below hero)
    {
      id: 'numbered_1',
      type: 'text',
      role: 'body',
      page: 1,
      col_start: 1,
      col_span: gridColumns,
      row_start: 8,
      row_span: 5,
    },
    // Page 2: support image 2 (left)
    {
      id: 'image_2',
      type: 'image',
      role: 'support',
      page: 2,
      col_start: 1,
      col_span: Math.ceil(gridColumns / 2),
      row_start: 1,
      row_span: 5,
      fit: 'contain',
      object_position: 'center',
    },
    // Page 2: support image 3 (right)
    {
      id: 'image_3',
      type: 'image',
      role: 'support',
      page: 2,
      col_start: Math.ceil(gridColumns / 2) + 1,
      col_span: Math.floor(gridColumns / 2),
      row_start: 1,
      row_span: 5,
      fit: 'contain',
      object_position: 'center',
    },
    // Page 2: numbered items 2-3 (below images, full width)
    {
      id: 'numbered_2_3',
      type: 'text',
      role: 'body',
      page: 2,
      col_start: 1,
      col_span: gridColumns,
      row_start: 7,
      row_span: 6,
    },
  ]

  return {
    candidate_id: 'builtin_numbered_hero_support_1',
    style: 'Editorial',
    output_unit: 'spread',
    layout_family: 'numbered_story_hero_support',
    layout_purpose: 'editorial_reading',
    image_hierarchy: 'hero_support',
    image_text_relation: 'numbered_image_text_pairs',
    composition_strategy: 'hero_support',
    base_pattern_reference: 'hero_image_then_numbered_story',
    layout_intent: 'Hero image with 3-part numbered story',
    design_sequence: [
      { step: 1, decision_type: 'layout_family', value: 'numbered_story_hero_support', reason: '3 images + 3 numbered items detected' },
      { step: 2, decision_type: 'image_hierarchy', value: 'hero_support', reason: 'First image hero, others support' },
      { step: 3, decision_type: 'composition_strategy', value: 'hero_support', reason: 'Hero on page 1, support images page 2' },
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
    layout_variation: 'hero_then_numbered_support',
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
    title_behavior: 'title_page_only',
    overflow_policy: { body_overflow: 'continue_to_next_page' },
    reason: 'Hero image + numbered story spread',
  }
}
