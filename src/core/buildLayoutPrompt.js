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
- Decide the composition_strategy (full_image, image_above_text, text_above_image, image_left_text_right, text_left_image_right, equal_images, hero_support, grid_gallery, gallery_left_text_right, gallery_page_text_page).
- Decide which base pattern reference from the knowledge base best explains your composition.
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
- Margins: top 16mm, bottom 18mm, inner 18mm, outer 14mm.
- Body font size: 9pt. Body leading: 14pt.
- Image count: 1 to 6. Captions disabled. Image fit: contain. Preserve image aspect ratio.
- Text overlay is forbidden. Body overflow continues to next page without shrinking.
- Grid: each page uses 6 columns and 12 rows. Output col_start, col_span, row_start, row_span only
  (plus object_position for images: center | top | bottom | left | right, default center).
  The implementation converts grid units to mm.
- Allowed text roles: title, subtitle, body, section_label, page_number, continuation_body.
  You do not need to place a title/subtitle element yourself -- if has_title is true, it is
  rendered on its own separate opener page automatically. Only place body (and optionally
  section_label) elements.

Design principles:
1. If there is one strong image and short text, use a large image.
2. If body text is long, reserve stable reading space first.
3. If two images have equal importance, give them equal visual weight.
4. If one image is stronger, make it a hero and treat others as support (and give it role: hero).
5. If there are 3-6 images, choose grid/gallery when images are equal, or hero+support when one image is dominant.
6. Separate reading and viewing areas clearly. Use whitespace to avoid crowding.
7. Avoid many tiny images unless the goal is a gallery/archive impression.
8. Preserve spread balance: if one page is image-heavy, use text or whitespace to balance the opposite page.
9. If content does not fit, continue to the next page -- never shrink text or delete it.
10. Prefer output_unit=spread when image_count>=3 or text_density is medium/long, unless the
    input explicitly requests single_page.

You must generate exactly the requested number of internal candidate layout_plans (see the "candidates"
array size in the Task section below), each individually valid. The user only ever sees one final
result -- the system picks the best candidate itself.

Return JSON only.`

// One compact single-line example beats a pretty-printed one -- indentation/newlines are pure
// token cost the model doesn't need to parse JSON. Kept to exactly one page/one image/one text
// element; the model already knows how to extend the pattern to more pages/elements from the
// field descriptions above.
const COMPACT_SCHEMA_EXAMPLE = JSON.stringify({
  candidates: [{
    candidate_id: 'candidate_1',
    style: 'Editorial | Magazine | Exhibition Catalog',
    output_unit: 'single_page | spread',
    layout_family: 'image-first | balanced | text-first',
    layout_purpose: 'visual_showcase | comparison | editorial_reading | case_analysis | gallery | report',
    image_hierarchy: 'single_hero | equal_pair | hero_support | grid_gallery | page_gallery',
    image_text_relation: 'image_sets_mood | text_explains_image | image_supports_text | equal_visual_text | gallery_then_text',
    composition_strategy: 'full_image | image_above_text | ... (see system prompt list)',
    base_pattern_reference: 'a known pattern_id',
    layout_intent: 'brief design intent',
    design_sequence: [{
      step: 1, decision_type: 'output_unit', value: '...', reason: '...',
    }],
    grid: { columns: 6, rows: 12 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'image_1', type: 'image', role: 'hero', page: 1, col_start: 1, col_span: 3, row_start: 1, row_span: 5, fit: 'contain', object_position: 'center',
        },
        {
          id: 'body_1', type: 'text', role: 'body', page: 1, col_start: 1, col_span: 4, row_start: 7, row_span: 4,
        },
      ],
    }],
    overflow_policy: { body_overflow: 'continue_to_next_page' },
    reason: 'brief explanation',
  }],
})

function buildInternalRequirements(inputMetadata) {
  return `Validation reminders:
- Every uploaded image (image_1 through image_${inputMetadata.image_count}) must be placed exactly once in every candidate.
- No overlap between any elements.
- All col/row values must stay inside 6 columns and 12 rows.
- fit must be contain for every image; object_position must be one of center/top/bottom/left/right.
- Do not generate captions. Do not place text over images.
- Each candidate must include a non-empty design_sequence explaining its decisions in order.
- Return JSON only, no prose before or after it.`
}

export function buildUserPrompt({
  inputMetadata,
  contentStructure,
  imageMetadata,
  patternLibrarySummary,
  retrievedReferences,
  userControls,
  userPreferenceContext,
  internalCandidateCount = 3,
}) {
  const sections = [
    `Input metadata:\n${JSON.stringify(inputMetadata)}`,
    `Content structure:\n${JSON.stringify(contentStructure ?? {})}`,
    `Image metadata (per-image facts; estimated_role is a starting hint, you may override it):\n${JSON.stringify(imageMetadata ?? [])}`,
    `Layout knowledge base (design grammar reference, not fixed templates):\n${JSON.stringify(patternLibrarySummary ?? [])}`,
    `Retrieved reference examples (real tagged pages most similar to this input -- guidance only, do not copy any single example verbatim):\n${JSON.stringify(retrievedReferences ?? [])}`,
  ]

  if (userControls && Object.values(userControls).some((v) => v && v !== 'auto')) {
    sections.push(`User controls (soft preferences -- follow them unless they violate a fixed constraint or validation rule; if you cannot follow one, explain why in reason):\n${JSON.stringify(userControls)}`)
  }
  if (userPreferenceContext && Object.keys(userPreferenceContext).length > 0) {
    sections.push(`User preference context (learned from past edits -- soft guidance, never overrides fixed constraints or validation):\n${JSON.stringify(userPreferenceContext)}`)
  }

  sections.push(`Task:
Create exactly ${internalCandidateCount} distinct candidate layout_plans for the given input.
Use the pattern library and retrieved references as design grammar guidance, not fixed templates.
Think about image count, image orientation, text density, reading priority, and visual priority.

Required output format (top-level object with a "candidates" array of exactly ${internalCandidateCount} items), one-page example shown -- extend to more pages/elements as needed:

${COMPACT_SCHEMA_EXAMPLE}

${buildInternalRequirements(inputMetadata)}`)

  return sections.join('\n\n')
}
