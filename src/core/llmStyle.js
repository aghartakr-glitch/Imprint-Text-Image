// src/core/llmStyle.js
import Anthropic from '@anthropic-ai/sdk'
import { inferStyleByRules } from './styleRules.js'

const VALID_STYLES = ['Editorial', 'Magazine', 'Exhibition Catalog']
const MODEL = 'claude-sonnet-4-6'

export async function inferStyle({ imageCount, textLength, imageAspectRatios }, options = {}) {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY
  const mockMode = options.mockMode ?? process.env.MOCK_MODE === 'true'

  if (!apiKey || mockMode) {
    const fallback = inferStyleByRules({ imageCount, textLength })
    return { ...fallback, source: 'rule-based', model: null }
  }

  try {
    const client = options.client ?? new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `다음 편집 조판 입력을 보고 스타일을 하나만 골라 JSON으로만 답하세요.
이미지 개수: ${imageCount}
이미지 가로세로비: ${imageAspectRatios.join(', ')}
본문 글자 수: ${textLength}
가능한 스타일: Editorial, Magazine, Exhibition Catalog
형식: {"style": "...", "reason": "..."}`,
      }],
    })

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
    const parsed = JSON.parse(text.trim())
    if (!VALID_STYLES.includes(parsed.style)) {
      throw new Error(`알 수 없는 스타일: ${parsed.style}`)
    }
    return { style: parsed.style, reason: parsed.reason ?? '', source: 'llm', model: MODEL }
  } catch (err) {
    const fallback = inferStyleByRules({ imageCount, textLength })
    return {
      ...fallback,
      source: 'rule-based-fallback',
      model: null,
      fallbackReason: String(err?.message ?? err),
    }
  }
}
