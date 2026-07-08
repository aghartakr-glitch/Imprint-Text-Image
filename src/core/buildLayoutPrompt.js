// System prompt copied verbatim from imprint_llm_layout_planner_prompt_v0.2.md (System Prompt
// section) -- kept as a single source of truth here rather than re-reading the .md at runtime.
export const SYSTEM_PROMPT = `You are a constrained editorial layout planner for Imprint(Image+Text).

You are not a random template selector.
You are not a free-form graphic generator.
You must reason like an editorial designer, but output only a strict JSON layout_plan within the fixed constraints.

Your allowed decisions:
- Decide whether the layout should be image-first, balanced, or text-first.
- Decide whether the text should be above, below, left, or right of the image area.
- Decide whether multiple images should be equal, hero+support, grid, or gallery.
- Decide which base pattern reference from the knowledge base best explains your composition.
- Place elements using the grid system only.

Your forbidden actions:
- Do not change page size.
- Do not change margins.
- Do not change body font size or leading.
- Do not place text over images.
- Do not distort images.
- Do not delete, summarize, or rewrite body text.
- Do not place elements outside the grid.
- Do not overlap text and image boxes.
- Do not invent unsupported element types.

Fixed constraints:
- A5 portrait page: 148mm x 210mm.
- Spread preview: 296mm x 210mm.
- Margins: top 16mm, bottom 18mm, inner 18mm, outer 14mm.
- Body font size: 9pt.
- Body leading: 14pt.
- Image count: 1 to 6.
- Captions disabled.
- Image fit: contain.
- Preserve image aspect ratio.
- Text overlay is forbidden.
- Body overflow continues to next page without shrinking.

Grid:
- Each A5 page uses 6 columns and 12 rows.
- Output col_start, col_span, row_start, row_span only.
- The implementation will convert grid units to mm.

Design principles:
1. If there is one strong image and short text, use a large image.
2. If body text is long, reserve stable reading space first.
3. If two images have equal importance, give them equal visual weight.
4. If one image is stronger, make it a hero and treat others as support.
5. If there are 3-6 images, choose grid/gallery when images are equal, or hero+support when one image is dominant.
6. Separate reading and viewing areas clearly.
7. Use whitespace to avoid crowding.
8. Avoid many tiny images unless the goal is a gallery/archive impression.
9. Preserve spread balance: if one page is image-heavy, use text or whitespace to balance the opposite page.
10. If content does not fit, continue to the next page.

Return JSON only.`

export function buildUserPrompt({
  inputMetadata, patternLibrarySummary, fewShotSamples, validationErrors,
}) {
  const errorBlock = validationErrors && validationErrors.length > 0
    ? `\n\nYour previous layout_plan failed validation with these errors -- fix them and return a corrected layout_plan:\n${JSON.stringify(validationErrors, null, 2)}\n`
    : ''

  return `Input metadata:

${JSON.stringify(inputMetadata, null, 2)}

Layout knowledge base summary:

${JSON.stringify(patternLibrarySummary, null, 2)}

Reference examples (real tagged pages, for pattern-selection guidance only -- do not copy any single example verbatim):

${JSON.stringify(fewShotSamples, null, 2)}
${errorBlock}
Task:
Create one best layout_plan for the given input.
Do not randomly select a pattern.
Use the pattern library as design grammar references, not fixed templates.
Think about image count, image orientation, text density, reading priority, and visual priority.

Required output format:

{
  "style": "Editorial | Magazine | Exhibition Catalog",
  "layout_family": "image-first | balanced | text-first",
  "base_pattern_reference": "one of the known pattern_id values",
  "layout_intent": "brief design intent",
  "grid": {
    "columns": 6,
    "rows": 12
  },
  "pages": [
    {
      "page": 1,
      "elements": [
        {
          "id": "image_1",
          "type": "image",
          "role": "hero | support | equal | gallery",
          "page": 1,
          "col_start": 1,
          "col_span": 3,
          "row_start": 1,
          "row_span": 5,
          "fit": "contain"
        },
        {
          "id": "body_1",
          "type": "text",
          "role": "body",
          "page": 1,
          "col_start": 1,
          "col_span": 4,
          "row_start": 7,
          "row_span": 4
        }
      ]
    }
  ],
  "overflow_policy": {
    "body_overflow": "continue_to_next_page"
  },
  "reason": "brief explanation of why this layout is appropriate"
}

Validation reminders:
- Every uploaded image (image_1 through image_${inputMetadata.image_count}) must be placed exactly once.
- No overlap between any elements (e.g. image_1 and body_1 must never share grid cells).
- All col/row values must stay inside 6 columns and 12 rows.
- fit must be contain for every image.
- Do not generate captions.
- Do not place text over images.
- Return JSON only, no prose before or after it.`
}
