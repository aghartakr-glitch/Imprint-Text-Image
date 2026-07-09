// Spec Phase 3.4: Macro opener split layout builder
// For title + intro + 1 hero image: title on opener page, then content spread with image + intro

export function buildMacroOpenerSplit({ hasTitle, imageCount, contentStructure, userGridSettings = {} }) {
  if (imageCount !== 1 || !hasTitle || !contentStructure?.has_intro) {
    return null // Not applicable
  }

  const gridColumns = userGridSettings.columns ?? 6
  const gridRows = userGridSettings.rows ?? 12

  // Page 1: Title only (opener page)
  // Page 2: Image left, intro text right
  // Page 3+: Body text continues

  const elements = [
    // Page 1: Title (centered, full-height)
    {
      id: 'title_1',
      type: 'text',
      role: 'title',
      page: 1,
      col_start: 1,
      col_span: gridColumns,
      row_start: 6,
      row_span: 2,
    },
    // Page 2: Hero image (left, full-height minus title)
    {
      id: 'image_1',
      type: 'image',
      role: 'hero',
      page: 2,
      col_start: 1,
      col_span: Math.floor(gridColumns / 2),
      row_start: 1,
      row_span: gridRows,
      fit: 'contain',
      object_position: 'center',
    },
    // Page 2: Intro text (right)
    {
      id: 'intro_1',
      type: 'text',
      role: 'body_intro',
      page: 2,
      col_start: Math.floor(gridColumns / 2) + 1,
      col_span: Math.ceil(gridColumns / 2),
      row_start: 1,
      row_span: Math.ceil(gridRows / 2),
    },
    // Page 2-3: Body text continues (right side, full width if needed)
    {
      id: 'body_1',
      type: 'text',
      role: 'body',
      page: 2,
      col_start: Math.floor(gridColumns / 2) + 1,
      col_span: Math.ceil(gridColumns / 2),
      row_start: Math.ceil(gridRows / 2) + 1,
      row_span: Math.floor(gridRows / 2),
    },
  ]

  return {
    candidate_id: 'builtin_macro_opener_1',
    style: 'Editorial',
    output_unit: 'spread',
    layout_family: 'macro_opener_split',
    layout_purpose: 'editorial_reading',
    image_hierarchy: 'single_hero',
    image_text_relation: 'one_hero_image_with_intro',
    composition_strategy: 'image_left_text_right',
    base_pattern_reference: 'title_page_then_image_text',
    layout_intent: 'Title opener followed by hero image + intro spread',
    design_sequence: [
      { step: 1, decision_type: 'output_unit', value: 'spread', reason: 'Title opener + content spread' },
      { step: 2, decision_type: 'layout_family', value: 'macro_opener_split', reason: 'Title + hero image + intro detected' },
      { step: 3, decision_type: 'composition_strategy', value: 'image_left_text_right', reason: 'Classic editorial left-right split' },
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
    reserved_regions: [
      {
        page: 2,
        col_start: 1,
        col_span: Math.floor(gridColumns / 2),
        row_start: 1,
        row_span: gridRows,
      },
    ],
    text_flow: {
      mode: 'block_flow',
      flow_regions: [
        { page: 1, col_start: 1, col_span: gridColumns, row_start: 1, row_span: gridRows },
        { page: 2, col_start: Math.floor(gridColumns / 2) + 1, col_span: Math.ceil(gridColumns / 2), row_start: 1, row_span: gridRows },
      ],
      overflow_policy: { body_overflow: 'continue_to_next_page' },
    },
    layout_variation: 'title_opener_then_image_right_text_left',
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
    title_behavior: 'opener_split',
    overflow_policy: { body_overflow: 'continue_to_next_page' },
    reason: 'Macro opener + hero image spread',
  }
}
