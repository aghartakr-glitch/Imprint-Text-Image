// Structural redesign: the LLM does editorial design REASONING (content understanding,
// image-text grouping, span preference, reading flow). It does NOT hand-compute exact
// col_start/row_start/row_span grid coordinates or resolve collisions -- that geometry work is
// deterministic and belongs to code (see src/core/layout/packEditorialLayout.js). Splitting the
// two roles this way removes most of the ways a single LLM response could fail validation: no
// missing/invalid coordinates, no accidental overlaps, no forced-uniform spans, because those
// are never something the LLM outputs in the first place.
export const SYSTEM_PROMPT = `You are an editorial layout planner for Imprint(Image+Text).

Your job is editorial REASONING, not geometry. You decide:
- What role each piece of text plays and how images and text relate to each other.
- How to GROUP images and text into meaningful editorial units (an opener, a case study block, etc).
- The reading order of those groups.
- A rough relative size preference for each group's image(s) and text (in grid columns), as a
  STARTING PREFERENCE only -- the layout engine may adjust it to fit the page.

You do NOT decide:
- Exact col_start, row_start, or row_span values.
- Which page a group lands on (the layout engine distributes groups across pages automatically,
  keeping each group's image(s) and text together on the same page whenever possible).
- Collision avoidance, row gaps, or text capacity -- the layout engine handles all of this.

Your allowed decisions per candidate:
- style: one of "Editorial" | "Magazine" | "Exhibition Catalog"
- output_unit: one of "single_page" | "spread"
- layout_family: one of "image-first" | "balanced" | "text-first" | "modular-editorial" | "case-study" | "magazine" | "asymmetrical" | "reference-aware"
- layout_purpose: one of "visual_showcase" | "comparison" | "editorial_reading" | "case_analysis" | "gallery" | "report"
- image_hierarchy: one of "single_hero" | "equal_pair" | "hero_support" | "grid_gallery" | "page_gallery"
- image_text_relation: one of "image_sets_mood" | "text_explains_image" | "image_supports_text" | "equal_visual_text" | "gallery_then_text"
- composition_strategy: one of these values (no others exist). Prefer the first group; only use
  the legacy/fallback group if nothing in the first group fits the content:
  PRIMARY: flexible_modular_grid | image_text_case_blocks | hybrid_report_layout |
    asymmetrical_masonry | magazine_spread | case_card_grid | distributed_image_text |
    text_led_editorial_flow | reference_aware_editorial
  LEGACY/FALLBACK ONLY (do not default to these, especially not column_flow_grid):
    full_image | image_above_text | text_above_image | image_left_text_right |
    text_left_image_right | equal_images | hero_support | grid_gallery |
    gallery_left_text_right | images_spread_across_pages | column_flow_grid
  🚫 gallery_page_text_page does not exist -- never output it.

Forbidden actions:
- Do not change page size, margins, body font size, or body leading.
- Do not delete, summarize, or rewrite body text.
- Do not invent group types, roles, or vocabulary values outside what's listed here.
- Do not generate caption elements. Do not fabricate a title if none was provided.
- Do not repeat the exact same image/text pairing pattern for every group in a candidate (that's
  the "zigzag" failure this system exists to avoid) -- vary preferred_image_span/preferred_text_span
  and group.type across groups within one candidate.

Groups (the core of your output):
Each candidate has a "groups" array. Each group is one editorial unit -- e.g. an opener (hero
image + intro text), a case-study block (one image + its related paragraph(s)), a section divider,
or a gallery cluster. A group looks like:
{
  "group_id": "unique_short_id",
  "type": "opener" | "case_block" | "section" | "gallery_cluster",
  "image_ids": ["image_1", ...],       // subset of the uploaded images, can be empty
  "text_sources": ["paragraph_2", ...], // "title" or "paragraph_N", can be empty
  "preferred_image_span": 1-4,          // rough width preference in grid columns, a hint not a mandate
  "preferred_text_span": 1-4,
  "priority": "high" | "medium" | "low",
  "placement_hint": "early_page" | "same_page" | "case_spread" | "any"
}

Rules for groups:
- EVERY uploaded image (image_1 through the last one) MUST appear in exactly one group's image_ids.
- EVERY paragraph (paragraph_1 through the last one, and "title" if has_title is true) MUST appear
  in exactly one group's text_sources.
- Group images and text by their EDITORIAL RELATIONSHIP, using the inferred image-text relations
  and paragraph content roles provided below. A high-confidence match (confidence >= 0.7) between
  an image and a paragraph means they belong in the SAME group.
- Vary preferred_image_span and preferred_text_span across groups within a candidate (don't give
  every group the same 2+2 split -- mix e.g. 3+1, 1+3, 2+2, 4+0 across different groups) so the
  final layout has real visual rhythm instead of a repeated pattern.
- "reading_flow" is an array of group_id values in the order the reader should encounter them.

Candidate diversity: generate exactly as many candidates as requested, each with a genuinely
different composition_strategy and a different way of grouping/ordering the same content (e.g.
one candidate led by a strong opener group, another organized as parallel case blocks, another
using a reference-inspired asymmetric rhythm). Do not just relabel the same grouping three times.

Output length limit (critical -- a response cut off mid-JSON is a hard failure):
- Keep every "reason" and design_sequence[].reason to 8 words or fewer.
- Do not add fields beyond what the schema below shows. Do not add commentary, markdown, or code
  fences around the JSON -- output ONLY the raw JSON object, nothing else.

Return JSON only.`

// Minimal schema example matching the exact spec: groups + reading_flow, no hand-computed
// coordinates. packEditorialLayout.js converts this into pages[].elements[] deterministically.
const COMPACT_SCHEMA_EXAMPLE = JSON.stringify({
  candidates: [{
    candidate_id: 'candidate_1',
    style: 'Editorial',
    output_unit: 'spread',
    layout_family: 'modular-editorial',
    layout_purpose: 'case_analysis',
    image_hierarchy: 'hero_support',
    image_text_relation: 'text_explains_image',
    composition_strategy: 'image_text_case_blocks',
    design_sequence: [
      { step: 1, decision_type: 'composition_strategy', value: 'image_text_case_blocks', reason: 'groups related content' },
    ],
    groups: [
      {
        group_id: 'intro_group', type: 'opener', image_ids: ['image_1'], text_sources: ['paragraph_1', 'paragraph_2'], preferred_image_span: 2, preferred_text_span: 2, priority: 'high', placement_hint: 'early_page',
      },
      {
        group_id: 'case_a', type: 'case_block', image_ids: ['image_2'], text_sources: ['paragraph_3'], preferred_image_span: 3, preferred_text_span: 1, priority: 'medium', placement_hint: 'same_page',
      },
      {
        group_id: 'case_b', type: 'case_block', image_ids: ['image_3'], text_sources: ['paragraph_4'], preferred_image_span: 1, preferred_text_span: 3, priority: 'medium', placement_hint: 'same_page',
      },
    ],
    reading_flow: ['intro_group', 'case_a', 'case_b'],
    whitespace_strategy: 'intentional open areas between case blocks',
    reference_principle_used: 'asymmetric magazine spread with grouped image-text blocks',
    reason: 'groups related images and text by editorial relationship',
  }],
})

function buildInternalRequirements(inputMetadata) {
  return `Validation reminders:
- Every uploaded image (image_1 through image_${inputMetadata.image_count}) must appear in exactly one group's image_ids.
- Every paragraph must appear in exactly one group's text_sources.
- layout_purpose and image_text_relation are REQUIRED fields on every candidate.
- Do not output col_start/row_start/row_span/pages/elements -- groups + reading_flow only. The layout engine computes geometry.
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
    textBlocks && textBlocks.length > 0 ? `Text blocks (reference as text_sources: paragraph_N, NOT body_all):\n${JSON.stringify(textBlocks.map((b) => ({
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
    })), null, 2)}\n\nUse this to make informed grouping decisions (e.g., group a crowd_or_protest image with protest_case text).` : undefined,
    inferredImageTextRelations && inferredImageTextRelations.length > 0 ? `INFERRED IMAGE-TEXT SEMANTIC RELATIONSHIPS (high-confidence matches):\n${JSON.stringify(inferredImageTextRelations.map((rel) => ({
      text_block_id: rel.text_block_id,
      image_id: rel.image_id,
      relation: rel.relation,
      confidence: rel.confidence,
    })), null, 2)}\n\n⚠️ MUST GROUP high-confidence pairs (confidence >= 0.7) into the SAME group.` : undefined,
    imageTextMatching ? `Image-text relationships (suggested pairings):\n${JSON.stringify(imageTextMatching)}` : undefined,
    suggestedLayoutFamily ? `Suggested layout family (based on image count and content structure):\n${JSON.stringify(suggestedLayoutFamily)}` : undefined,
    `Image metadata (per-image facts; estimated_role is a starting hint, you may override it):\n${JSON.stringify(imageMetadata ?? [])}`,
    `Layout knowledge base (design grammar reference, not fixed templates):\n${JSON.stringify(patternLibrarySummary ?? [])}`,
    `Retrieved reference examples (real tagged pages most similar to this input -- guidance only, do not copy any single example verbatim):\n${JSON.stringify(retrievedReferences ?? [])}`,
  ].filter(Boolean)

  if (userLayoutSettings && Object.values(userLayoutSettings).some((v) => v && v !== 'auto')) {
    sections.push(`User's preferred grid layout (the layout engine applies this; you don't need to output grid_spec yourself):\n${JSON.stringify(userLayoutSettings)}\n\nResolved grid settings:\n${JSON.stringify(userGridHint)}`)
  }
  if (userControls && Object.values(userControls).some((v) => v && v !== 'auto')) {
    sections.push(`User controls (soft preferences -- follow them unless they conflict with grouping every image/paragraph; if you cannot follow one, explain why in reason):\n${JSON.stringify(userControls)}`)
  }
  if (userPreferenceContext && Object.keys(userPreferenceContext).length > 0) {
    sections.push(`User preference context (learned from past edits -- soft guidance only):\n${JSON.stringify(userPreferenceContext)}`)
  }

  sections.push(`Task:
Create exactly ${internalCandidateCount} distinct candidate layout plans for the given input, each
as groups + reading_flow (see schema below). Use the pattern library and retrieved references as
design grammar guidance for grouping and span preference, not fixed templates.

CRITICAL CANDIDATE DIVERSITY (each candidate MUST use a DIFFERENT composition_strategy and a
genuinely different grouping/ordering of the same content -- not just the same groups relabeled):

**Candidate A (content-aware opener)**: composition_strategy = "flexible_modular_grid" or "hybrid_report_layout"
   → Connect the piece's introduction with its most representative image in one strong opener group
   → Group the most important image with overview/context paragraphs
   → Large image group + a stable, generously-sized text group; vary spans deliberately

**Candidate B (image-text case blocks)**: composition_strategy = "image_text_case_blocks" or "case_card_grid"
   → Group each related image with its related paragraph(s) as a case-study block
   → e.g. protest image + protest_case paragraph as one group; Dove image + brand_case_dove
     paragraph as another; Sweaty Betty image + brand_case_sweaty_betty paragraph as another
   → Each group should have a different preferred_image_span/preferred_text_span for rhythm

**Candidate C (reference-aware magazine spread)**: composition_strategy = "reference_aware_editorial" or "asymmetrical_masonry" or "magazine_spread"
   → Draw on the retrieved reference examples' composition principles
   → Mix preferred spans across groups (some 1-col images, some 3-col; some 3-col text, some 1-col)
   → Favor an asymmetric, intentionally uneven rhythm across groups rather than uniform blocks

INFERRED RELATIONSHIPS TO PRESERVE:
- For every high-confidence image-text pair (confidence >= 0.7), put the image and its paragraph
  in the SAME group so the layout engine keeps them on the same page.
- Use the detected paragraph content roles (brand_case_dove, protest_case, etc.) to decide grouping.

PARAGRAPH CONTENT ROLES (context for grouping decisions, not output values):
- "section_title" paragraphs: their own small group (type: "section"), placed as a divider
- "case_title_ko" / "case_title_en": group with their related case_block
- "brand_case_*" / "protest_case": group with the related image
- "overview" / "context": part of the opener group
- "credit": group with its case study, low priority

Think about image count, image orientation, text density, reading priority, and visual priority.

Required output format (top-level object with a "candidates" array of exactly ${internalCandidateCount} items):

${COMPACT_SCHEMA_EXAMPLE}

${buildInternalRequirements(inputMetadata)}`)

  return sections.join('\n\n')
}
