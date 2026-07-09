// Spec: Advanced semantic role inference for text blocks
// Uses keyword analysis, position, structure, and length cues

const KEYWORD_PATTERNS = {
  overview: ['메가 트렌드', '매크로 트렌드', 'mega trend', 'macro trend', '의미합니다', '있습니다'],
  context: ['초양극화', '대응하고', '전 세계적인', '움직임', '강화되고', '심각해지는'],
  audience: ['Z세대', '밀레니얼', 'Gen Z', 'millennial', '세대'],
  protest_case: ['카네기', '시위', 'LGBTQ+', 'protest', 'demonstration', '프라이드', 'pride'],
  brand_case_dove: ['도브', 'Dove', '#NoDigitalDistortion', 'Turn Your Back', 'Bold Glamour'],
  brand_case_sweaty_betty: ['스웨티 베티', 'Sweaty Betty', 'Wear The Damn Shorts'],
  quote: ['"', '"', '\''],
  call_to_action: ['해야합니다', '필요합니다', '중요합니다', 'must', 'should', 'need'],
}

export function inferBlockRole(text, isFirstBlock = false) {
  if (!text) return 'unknown'

  const lowerText = text.toLowerCase()

  // First block heuristic: usually overview/intro
  if (isFirstBlock) {
    // But check if it's actually a case or other role
    for (const [role, keywords] of Object.entries(KEYWORD_PATTERNS)) {
      if (role === 'quote') continue
      if (keywords.some((kw) => lowerText.includes(kw.toLowerCase()))) {
        return mapPatternToRole(role)
      }
    }
    return 'intro_definition'
  }

  // Check keyword patterns
  for (const [pattern, keywords] of Object.entries(KEYWORD_PATTERNS)) {
    if (keywords.some((kw) => lowerText.includes(kw.toLowerCase()))) {
      return mapPatternToRole(pattern)
    }
  }

  // Check text structure cues
  const charCount = text.length
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0)
  const avgSentenceLength = charCount / Math.max(sentences.length, 1)

  // Long, flowing text without obvious role markers
  if (charCount > 300 && avgSentenceLength > 50) {
    return 'body'
  }

  // Short, focused text
  if (charCount < 150) {
    // Could be a label, case title, or conclusion
    if (lowerText.includes('result') || lowerText.includes('conclusion') || lowerText.includes('결론')) {
      return 'conclusion'
    }
    return 'section_label'
  }

  return 'body'
}

function mapPatternToRole(pattern) {
  const roleMap = {
    overview: 'intro_definition',
    context: 'context',
    audience: 'audience_value',
    protest_case: 'protest_case',
    brand_case_dove: 'brand_case',
    brand_case_sweaty_betty: 'brand_case',
    quote: 'quote',
    call_to_action: 'call_to_action',
  }

  return roleMap[pattern] || 'body'
}

export function extractBrandFromRole(text, role) {
  if (role !== 'brand_case') return null

  const lowerText = text.toLowerCase()

  if (KEYWORD_PATTERNS.brand_case_dove.some((kw) => lowerText.includes(kw.toLowerCase()))) {
    return 'Dove'
  }
  if (KEYWORD_PATTERNS.brand_case_sweaty_betty.some((kw) => lowerText.includes(kw.toLowerCase()))) {
    return 'Sweaty Betty'
  }

  return null
}

export function getBlockStylingHints(role) {
  const hints = {
    intro_definition: { style: 'intro_text', emphasis: 'high' },
    context: { style: 'body_text', emphasis: 'medium' },
    audience_value: { style: 'body_text', emphasis: 'medium' },
    protest_case: { style: 'case_body_text', emphasis: 'high' },
    brand_case: { style: 'case_body_text', emphasis: 'high' },
    conclusion: { style: 'conclusion_text', emphasis: 'high' },
    quote: { style: 'quote_text', emphasis: 'high' },
    body: { style: 'body_text', emphasis: 'low' },
    section_label: { style: 'label_text', emphasis: 'high' },
  }

  return hints[role] || { style: 'body_text', emphasis: 'low' }
}
