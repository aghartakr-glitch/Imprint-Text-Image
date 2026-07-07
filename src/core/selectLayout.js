// src/core/selectLayout.js
import Anthropic from '@anthropic-ai/sdk'
import { inferStyleByRules } from './styleRules.js'
import { selectLayoutTypeByRules } from './layoutTypeRules.js'
import { textDensityFromLength } from './textDensity.js'

const VALID_STYLES = ['Editorial', 'Magazine', 'Exhibition Catalog']
const VALID_LAYOUT_TYPES = ['image-first', 'balanced', 'text-first']
const MODEL = 'claude-sonnet-4-6'

const SYSTEM_PROMPT = `You are not a free-form layout generator.

You are a constrained editorial layout decision assistant for the Imprint(Image+Text) system.

Your role is only to:
1. infer the editorial style from input metadata,
2. choose one best layout type,
3. choose one predefined layout pattern ID,
4. explain the reasoning briefly for logging.

You must not generate three candidates.
You must not generate arbitrary coordinates.
You must not change page size.
You must not change margins.
You must not change body font size or leading.
You must not place text over images.
You must not distort images.
You must not remove or summarize body text.
You must not change the required output structure.

The system uses fixed constraints:
- A5 portrait
- 148mm x 210mm page
- 296mm x 210mm spread preview
- top margin 16mm
- bottom margin 18mm
- inner margin 18mm
- outer margin 14mm
- body font size 9pt
- body leading 14pt
- image count 1 to 6
- captions disabled
- image aspect ratio must be preserved
- text overlay on image is forbidden
- overflow text must continue to next page or next spread
- only one best layout should be generated

Return JSON only.`

function buildUserPrompt({
  imageCount, imageAspectRatios, textLength, availablePatterns,
}) {
  const density = textDensityFromLength(textLength)
  return `Input metadata:

{
  "image_count": ${imageCount},
  "image_ratios": [${imageAspectRatios.join(', ')}],
  "text_length_chars": ${textLength},
  "estimated_text_density": "${density}",
  "available_patterns": ${JSON.stringify(availablePatterns)}
}

Choose:
1. one style from ["Editorial", "Magazine", "Exhibition Catalog"]
2. one layout_type from ["image-first", "balanced", "text-first"]
3. one pattern_id from available_patterns

Rules:
- Choose only one final layout.
- Do not generate three candidates.
- Choose only from available_patterns.
- Do not invent pattern IDs.
- Do not create coordinates.
- Do not alter fixed constraints.
- Return JSON only.

Expected JSON format:

{
  "style": "Magazine",
  "layout_type": "balanced",
  "pattern_id": "four_images_balanced_01",
  "reason": "brief reason explaining why this is the most appropriate layout for the input"
}`
}

// Validation per the spec's checklist: JSON parses (caller's responsibility, via JSON.parse),
// style/layout_type in the allowed lists, pattern_id actually exists in available_patterns, that
// pattern's layoutType agrees with the response's layout_type, and nothing is missing. There's no
// separate "not three candidates" check: the schema itself (one style/layout_type/pattern_id set)
// makes generating three candidates structurally impossible.
function validateChoice(parsed, availablePatterns) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('응답이 JSON 객체가 아닙니다')
  }
  if (!VALID_STYLES.includes(parsed.style)) {
    throw new Error(`알 수 없는 스타일: ${parsed.style}`)
  }
  if (!VALID_LAYOUT_TYPES.includes(parsed.layout_type)) {
    throw new Error(`알 수 없는 layout_type: ${parsed.layout_type}`)
  }
  if (typeof parsed.reason !== 'string' || !parsed.reason.trim()) {
    throw new Error('reason이 비어 있습니다')
  }
  const matched = availablePatterns.find((p) => p.patternId === parsed.pattern_id)
  if (!matched) {
    throw new Error(`available_patterns에 없는 pattern_id입니다: ${parsed.pattern_id}`)
  }
  if (matched.layoutType !== parsed.layout_type) {
    throw new Error(
      `pattern_id(${parsed.pattern_id})의 layout_type(${matched.layoutType})이 응답의 layout_type(${parsed.layout_type})과 다릅니다`,
    )
  }
}

function ruleBasedFallback({ imageCount, textLength, availablePatterns }, fallbackReason) {
  const { style } = inferStyleByRules({ imageCount, textLength })
  const layoutType = selectLayoutTypeByRules({ imageCount, textLength })
  const matched = availablePatterns.find((p) => p.layoutType === layoutType)
  return {
    style,
    layoutType,
    patternId: matched.patternId,
    reason: '규칙 기반 자동 선택',
    source: fallbackReason == null ? 'rule-based' : 'rule-based-fallback',
    model: null,
    ...(fallbackReason == null ? {} : { fallbackReason }),
  }
}

export async function selectLayout({
  imageCount, textLength, imageAspectRatios, availablePatterns,
}, options = {}) {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY
  const mockMode = options.mockMode ?? process.env.MOCK_MODE === 'true'

  if (!apiKey || mockMode) {
    return ruleBasedFallback({ imageCount, textLength, availablePatterns }, null)
  }

  try {
    const client = options.client ?? new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: buildUserPrompt({
          imageCount, imageAspectRatios, textLength, availablePatterns,
        }),
      }],
    })

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
    const parsed = JSON.parse(text.trim())
    validateChoice(parsed, availablePatterns)

    return {
      style: parsed.style,
      layoutType: parsed.layout_type,
      patternId: parsed.pattern_id,
      reason: parsed.reason,
      source: 'llm',
      model: MODEL,
    }
  } catch (err) {
    return ruleBasedFallback({ imageCount, textLength, availablePatterns }, String(err?.message ?? err))
  }
}
