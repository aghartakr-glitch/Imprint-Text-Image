// Allowed design-space vocabulary for the editorial image+text layout system (v0.4 supplement).
// The LLM must choose from these values only; validateLayoutPlan.js enforces it.
export const DESIGN_SPACE = {
  outputUnits: ['single_page', 'spread'],

  pageKinds: ['single_page', 'spread', 'continuation_page'],

  layoutFamilies: ['image-first', 'balanced', 'text-first'],

  layoutPurposes: [
    'visual_showcase',
    'comparison',
    'editorial_reading',
    'case_analysis',
    'gallery',
    'report',
  ],

  imageStructures: ['single_image', 'equal_pair', 'hero_support', 'grid_gallery', 'page_gallery'],

  imageHierarchies: ['single_hero', 'equal_pair', 'hero_support', 'grid_gallery', 'page_gallery'],

  // Per-element image role (distinct from the whole-set imageHierarchies classification above).
  imageRoles: ['hero', 'support', 'equal', 'gallery'],

  textRoles: ['title', 'subtitle', 'body', 'section_label', 'page_number', 'continuation_body'],

  imageTextRelations: [
    'image_sets_mood',
    'text_explains_image',
    'image_supports_text',
    'equal_visual_text',
    'gallery_then_text',
  ],

  compositionStrategies: [
    'full_image',
    'image_above_text',
    'text_above_image',
    'image_left_text_right',
    'text_left_image_right',
    'equal_images',
    'hero_support',
    'grid_gallery',
    'gallery_left_text_right',
    'gallery_page_text_page',
    // Each image gets its own page (interspersed with text pages), instead of grouping every
    // image onto one crowded page -- a real editorial-magazine pattern for storytelling spreads.
    'images_spread_across_pages',
  ],

  objectPositions: ['center', 'top', 'bottom', 'left', 'right'],

  validationDimensions: [
    'no_overlap',
    'no_text_overlay',
    'aspect_ratio_preserved',
    'inside_grid',
    'overflow_handled',
    'readability_passed',
  ],
}
