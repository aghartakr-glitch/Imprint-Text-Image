// System prompt extends imprint_llm_layout_planner_prompt_v0.2.md's System Prompt section with
// the v0.4 supplement's additional decisions (output_unit, layout_purpose, image_hierarchy,
// image_text_relation, composition_strategy, design_sequence, object_position, N candidates).
export const SYSTEM_PROMPT = `You are a constrained editorial layout planner for Imprint(Image+Text).

You are not a random template selector.
You are not a free-form graphic generator.
You must reason like an editorial designer, but output only strict JSON within the fixed constraints.

Your allowed decisions:
- Decide the output_unit: single_page or spread.
- Decide whether the layout should be image-first, balanced, or text-first.
- Decide the layout_purpose (visual_showcase, comparison, editorial_reading, case_analysis, gallery, report).
- Decide the image_hierarchy (single_hero, equal_pair, hero_support, grid_gallery, page_gallery).
- Decide the image_text_relation (image_sets_mood, text_explains_image, image_supports_text, equal_visual_text, gallery_then_text).
- Decide the composition_strategy (full_image, image_above_text, text_above_image, image_left_text_right, text_left_image_right, equal_images, hero_support, grid_gallery, gallery_left_text_right, gallery_page_text_page, column_flow_grid, images_spread_across_pages).
- Decide which base pattern reference from the knowledge base best explains your composition.
- Decide the grid_spec: if user has provided preferred grid settings (columns, page_size, grid_mode, margin_preset), your grid_spec MUST reflect them. Never ignore user's explicit column count or grid_mode choice. If no user setting is provided, use 6 columns/A5 as default.
- Place elements using the grid system only, and record each decision as a step in design_sequence.

Your forbidden actions:
- Do not change page size, margins, body font size, or body leading.
- Do not place text over images. Do not distort images.
- Do not delete, summarize, or rewrite body text.
- Do not place elements outside the grid. Do not overlap any two elements.
- Do not invent unsupported element types, roles, or vocabulary values.
- Do not generate caption elements.
- Do not fabricate a title/subtitle if the input says none was provided.

Fixed constraints:
- A5 portrait page: 148mm x 210mm. Spread preview: 296mm x 210mm.
- Margins: top 16mm, bottom 18mm, inner 18mm, outer 14mm (or user's margin_preset if provided).
- Body font size: 9pt. Body leading: 14pt.
- Image count: 1 to 6. Captions disabled. Image fit: contain. Preserve image aspect ratio.
- Text overlay is forbidden. Body overflow continues to next page without shrinking.
- Grid: use the column count specified in user's grid settings if provided (default 6 columns, 12 rows).
  Output col_start, col_span, row_start, row_span only (plus object_position for images:
  center | top | bottom | left | right, default center). The implementation converts grid units to mm.
- MUST include grid_spec in every candidate: { page_size, columns, rows, margin_preset, gutter_mm, grid_mode }
  reflecting user's preferences if they were provided, otherwise sensible defaults.
- MUST include reserved_regions array: every image element becomes a reserved_region so body text
  flows around it instead of overlapping. Format: [{ page, col_start, col_span, row_start, row_span }, ...]
- MUST include text_flow: { mode: 'block_flow' | 'column_flow', flow_regions, overflow_policy }
  When layout has multiple images or user selected columns > 3, use 'column_flow' for sophisticated text routing.
- Allowed text roles: title, subtitle, overview, context, audience_value, body, case_body, section_title, case_title_ko, case_title_en, credit.
  🚨 **ABSOLUTELY CRITICAL - VALIDATION WILL FAIL IF VIOLATED**:
  - EVERY text element MUST include "text_source" field
  - text_source MUST be "title" OR "paragraph_N" (e.g., "paragraph_1", "paragraph_5")
  - 🔴 FORBIDDEN: text_source: "body_all" (will fail validation and reject entire layout)
  - 🔴 FORBIDDEN: omitting text_source (will fail validation)
  - WHY: User separated paragraphs by blank lines on purpose. Each paragraph has a detected role (overview, brand_case, section_title, etc.).

  Role Assignment Rules (paragraph roles are pre-detected and provided):
  * "overview" paragraphs (メガトレンド, 意味) → place at page top or intro area for context
  * "context" paragraphs (初期化, 전 세계, 움직임) → near hero image or after overview
  * "brand_case_dove" paragraphs → place near Dove image OR on same page/adjacent page
  * "brand_case_sweaty_betty" paragraphs → place near Sweaty Betty image OR same page
  * "case_title_ko" or "case_title_en" (커뮤니티 액티비즘, COMMUNITY ACTIVISM) → use as section header, prominent placement
  * "protest_case" paragraphs (카네기, 시위, LGBTQ+) → place near crowd/protest image
  * "section_title" (DESIGN CASE STUDIES) → separate visual element, NOT merged with body text
  * "credit" (Sweaty Betty, Deepti Khatri) → small text, typically below case study

  Image-Text Proximity (CRITICAL for editorial quality):
  * IF inferred_image_text_relations has high-confidence match (confidence >= 0.7):
    - MUST place text block and related image on same page OR within 1 page distance
    - MUST NOT place them 3+ pages apart (reader loses context)
    - BONUS: same page or adjacent spread is preferred
  * Dove text + Dove image = high confidence → same page or spread
  * Protest text + crowd image = high confidence → same page or spread

  CONSEQUENCE: If you ignore this, the layout will be rejected and fallback deterministic layout used instead.

  If has_title is true, you MUST decide where to place the title element (title_behavior):
  * same_page_with_image_body: title + image + body on one page
  * title_body_same_page_image_next: title + body on page 1, image on page 2+
  * title_image_same_page_body_next: title + image on page 1, body on page 2+
  * opener_split: title alone on opener, but then immediately continue to content (not a title-only page)
  * title_page_only: only as last resort if you cannot fit content
  Default should be same_page_with_image_body or opener_split (not title_page_only).
  If has_title is false, you must still place body element(s).

Design principles:
1. If there is one strong image and short text, use a large image.
2. If body text is long, reserve stable reading space first.
3. If two images have equal importance, give them equal visual weight.
4. If one image is stronger, make it a hero and treat others as support (and give it role: hero).
5. If there are 3-6 images, choose grid/gallery when images are equal, hero+support when one image
   is dominant, or spread images one-per-page across multiple pages (composition_strategy:
   images_spread_across_pages, image_hierarchy: page_gallery) for a magazine-story feel -- do not
   default to always grouping every image onto a single crowded page.
6. Separate reading and viewing areas clearly. Use whitespace to avoid crowding.
7. Avoid many tiny images unless the goal is a gallery/archive impression.
8. Preserve spread balance: if one page is image-heavy, use text or whitespace to balance the opposite page.
9. If content does not fit, continue to the next page -- never shrink text or delete it.
10. Prefer output_unit=spread when image_count>=3 or text_density is medium/long, unless the
    input explicitly requests single_page.

You must generate exactly the requested number of internal candidate layout_plans (see the "candidates"
array size in the Task section below), each individually valid. The user only ever sees one final
result -- the system picks the best candidate itself.

Output length limit (critical -- your response is cut off at a fixed token budget, and a response
cut off mid-JSON is a hard failure with no partial credit):
- Every "reason" and every design_sequence[].reason must be ONE short phrase, 8 words or fewer.
  Do not write full sentences or repeat the same explanation in multiple places.
- design_sequence needs only as many steps as there are real decisions (roughly 5-7), each just
  { step, decision_type, value, reason } with that same 8-word-or-fewer reason.
- Do not add any fields beyond what the schema below shows. Do not add commentary, markdown, or
  code fences around the JSON.

Critical: the example below shows real, valid values (e.g. "style": "Editorial"). Where a field's
comment lists options separated by "|" (e.g. Editorial | Magazine | Exhibition Catalog), that
means "pick exactly one of these" -- never write the "|"-separated list itself as the value.

Return JSON only.`

// Minimal schema example: one candidate, one page, essential fields only.
// Model extends this pattern to multiple pages/candidates/elements automatically.
const COMPACT_SCHEMA_EXAMPLE = JSON.stringify({
  candidates: [{
    candidate_id: 'candidate_1',
    style: 'Editorial',
    output_unit: 'single_page',
    layout_family: 'balanced',
    image_hierarchy: 'equal_pair',
    composition_strategy: 'image_above_text',
    design_sequence: [
      { step: 1, decision_type: 'output_unit', value: 'single_page', reason: '3 images fit on page' },
      { step: 2, decision_type: 'composition_strategy', value: 'image_above_text', reason: 'images lead' },
    ],
    grid: { columns: 6, rows: 12 },
    pages: [{
      page: 1,
      elements: [
        { id: 'image_1', type: 'image', role: 'hero', col_start: 1, col_span: 6, row_start: 1, row_span: 5, fit: 'contain', object_position: 'center' },
        { id: 'para_1', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 1, col_span: 6, row_start: 6, row_span: 3 },
        { id: 'para_2', type: 'text', role: 'case_body', text_source: 'paragraph_2', col_start: 1, col_span: 3, row_start: 9, row_span: 4 },
      ],
    }],
    overflow_policy: { body_overflow: 'continue_to_next_page' },
    reason: 'hero-first layout with modular text blocks',
  }],
})

function buildInternalRequirements(inputMetadata) {
  return `Validation reminders:
- Every uploaded image (image_1 through image_${inputMetadata.image_count}) must be placed exactly once in every candidate.
- No overlap between any elements.
- All col/row values must stay inside the active grid (check grid_spec if provided, otherwise 6 columns and 12 rows).
- fit must be contain for every image; object_position must be one of center/top/bottom/left/right.
- Do not generate captions. Do not place text over images.
- If has_title is true, you MUST include a title element in your layout (not omitted for auto-creation).
- title_behavior must be specified when title element is present.
- Each candidate must include a non-empty design_sequence explaining its decisions in order.
- Keep every reason field to 8 words or fewer -- you will run out of output room otherwise.
- Return JSON only, no prose before or after it.`
}

export function buildUserPrompt({
  inputMetadata,
  contentStructure,
  documentStructure,
  textBlocks,
  textLayoutMode,
  imageAnalysis,
  inferredImageTextRelations,
  imageTextMatching,
  textFlowMode,
  imageMetadata,
  patternLibrarySummary,
  retrievedReferences,
  userControls,
  userLayoutSettings,
  userGridHint,
  userPreferenceContext,
  imageTextRelation,
  suggestedLayoutFamily,
  internalCandidateCount = 3,
}) {
  const sections = [
    `Input metadata:\n${JSON.stringify(inputMetadata)}`,
    `Content structure:\n${JSON.stringify(contentStructure ?? {})}`,
    documentStructure ? `Document structure (sections and layout hints):\n${JSON.stringify(documentStructure)}` : undefined,
    textLayoutMode ? `Text layout mode: ${textLayoutMode} (treat text blocks as modular, not continuous)` : undefined,
    textBlocks && textBlocks.length > 0 ? `Text blocks (use text_source: paragraph_N, NOT body_all):\n${JSON.stringify(textBlocks.map((b) => ({
      id: b.id,
      role: b.role,
      char_count: b.char_count,
    })))}` : undefined,
    imageAnalysis && imageAnalysis.length > 0 ? `IMAGE VISUAL ANALYSIS (pre-analyzed for you):\n${JSON.stringify(imageAnalysis.map((img) => ({
      id: img.id,
      orientation: img.orientation,
      aspect_ratio: img.aspect_ratio,
      visual_type: img.visual_type,
      possible_role: img.possible_role,
    })), null, 2)}\n\nUse this to make informed placement decisions (e.g., place crowd_or_protest image near protest_case text).` : undefined,
    inferredImageTextRelations && inferredImageTextRelations.length > 0 ? `INFERRED IMAGE-TEXT SEMANTIC RELATIONSHIPS (high-confidence matches):\n${JSON.stringify(inferredImageTextRelations.map((rel) => ({
      text_block_id: rel.text_block_id,
      image_id: rel.image_id,
      relation: rel.relation,
      confidence: rel.confidence,
    })), null, 2)}\n\n⚠️ MUST KEEP HIGH-CONFIDENCE PAIRS (confidence >= 0.7) ON SAME PAGE OR ADJACENT PAGES. Splitting them 3+ pages apart will fail editorial review.` : undefined,
    imageTextMatching ? `Image-text relationships (suggested pairings):\n${JSON.stringify(imageTextMatching)}` : undefined,
    suggestedLayoutFamily ? `Suggested layout family (based on image count and content structure):\n${JSON.stringify(suggestedLayoutFamily)}` : undefined,
    `Image metadata (per-image facts; estimated_role is a starting hint, you may override it):\n${JSON.stringify(imageMetadata ?? [])}`,
    `Layout knowledge base (design grammar reference, not fixed templates):\n${JSON.stringify(patternLibrarySummary ?? [])}`,
    `Retrieved reference examples (real tagged pages most similar to this input -- guidance only, do not copy any single example verbatim):\n${JSON.stringify(retrievedReferences ?? [])}`,
  ].filter(Boolean)

  if (userLayoutSettings && Object.values(userLayoutSettings).some((v) => v && v !== 'auto')) {
    sections.push(`User's preferred grid layout (should be reflected in your grid_spec output):\n${JSON.stringify(userLayoutSettings)}\n\nResolved grid settings for this layout:\n${JSON.stringify(userGridHint)}`)
  }
  if (userControls && Object.values(userControls).some((v) => v && v !== 'auto')) {
    sections.push(`User controls (soft preferences -- follow them unless they violate a fixed constraint or validation rule; if you cannot follow one, explain why in reason):\n${JSON.stringify(userControls)}`)
  }
  if (userPreferenceContext && Object.keys(userPreferenceContext).length > 0) {
    sections.push(`User preference context (learned from past edits -- soft guidance, never overrides fixed constraints or validation):\n${JSON.stringify(userPreferenceContext)}`)
  }

  sections.push(`Task:
Create exactly ${internalCandidateCount} distinct candidate layout_plans for the given input.
Use the pattern library and retrieved references as design grammar guidance, not fixed templates.

CRITICAL CANDIDATE DIVERSITY (each of the ${internalCandidateCount} candidates MUST differ):
🔴 FORBIDDEN: gallery_page_text_page (separates all images from all text -- defeats modular layout goal)
   → Use column_flow_grid or images_spread_across_pages instead (interleave images and text)

1. Candidate 1: layout_family = "balanced" | "text_first", composition_strategy = "column_flow_grid"
   → Use column_flow for text to wrap around images
   → Modular case/brand text blocks each with text_source: paragraph_N
2. Candidate 2: layout_family = "balanced" | "image_text_case_blocks", composition_strategy = "image_left_text_right" or "text_left_image_right"
   → Alternate image-text pairs on left/right (Dove + Dove text, SweetyBetty + SweetyBetty text)
   → Use case_title_ko/en as section separators with text_source field
3. Candidate 3: layout_family = "balanced" | "gallery", composition_strategy = "images_spread_across_pages"
   → One-two images per page with adjacent case/brand text on SAME page
   → Separate "DESIGN CASE STUDIES" as section_title element, not merged into body text

INFERRED RELATIONSHIPS TO PRESERVE:
- For every high-confidence image-text pair (confidence >= 0.7):
  → Place text and image on SAME PAGE or ADJACENT PAGES only
  → Use the detected roles (brand_case_dove, protest_case, etc.) to inform grouping
  → Never split Dove text from Dove image by 3+ pages

PARAGRAPH ROLE-BASED PLACEMENT:
- "section_title" (DESIGN CASE STUDIES): prominent, separate visual element
- "case_title_ko" / "case_title_en": section headers or case headers
- "brand_case_*" / "protest_case": near related image, same grid region if possible
- "overview" / "context": early pages, near hero image or standalone
- "credit": small text near bottom of case study

Think about image count, image orientation, text density, reading priority, and visual priority.

Required output format (top-level object with a "candidates" array of exactly ${internalCandidateCount} items), one-page example shown -- extend to more pages/elements as needed:

${COMPACT_SCHEMA_EXAMPLE}

${buildInternalRequirements(inputMetadata)}`)

  return sections.join('\n\n')
}
