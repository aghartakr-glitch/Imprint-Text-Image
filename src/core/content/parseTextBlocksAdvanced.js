// Spec: Advanced text block parsing with paragraph-level roles and metadata
// Converts flat text into modular, identifiable text blocks with semantic roles

const KEYWORD_PATTERNS = {
  trend_context: ['메가 트렌드', '매크로 트렌드', 'mega trend', 'macro trend'],
  audience_value: ['Z세대', '밀레니얼', 'Gen Z', 'millennial'],
  protest_case: ['카네기', '시위', 'LGBTQ+', 'protest', 'demonstration'],
  brand_case_dove: ['도브', 'Dove', '#NoDigitalDistortion', 'Turn Your Back'],
  brand_case_sweaty_betty: ['스웨티 베티', 'Sweaty Betty', 'Wear The Damn Shorts'],
}

function detectParagraphRole(text, index, totalParagraphs) {
  // First paragraph → intro_definition or overview
  if (index === 0) {
    return 'intro_definition'
  }

  // Check keyword patterns
  const lowerText = text.toLowerCase()

  if (KEYWORD_PATTERNS.trend_context.some(kw => lowerText.includes(kw.toLowerCase()))) {
    return 'trend_context'
  }
  if (KEYWORD_PATTERNS.audience_value.some(kw => lowerText.includes(kw.toLowerCase()))) {
    return 'audience_value'
  }
  if (KEYWORD_PATTERNS.protest_case.some(kw => lowerText.includes(kw.toLowerCase()))) {
    return 'protest_case'
  }
  if (KEYWORD_PATTERNS.brand_case_dove.some(kw => lowerText.includes(kw.toLowerCase()))) {
    return 'brand_case'
  }
  if (KEYWORD_PATTERNS.brand_case_sweaty_betty.some(kw => lowerText.includes(kw.toLowerCase()))) {
    return 'brand_case'
  }

  return 'body'
}

function extractBrandName(text) {
  const lowerText = text.toLowerCase()

  if (KEYWORD_PATTERNS.brand_case_dove.some(kw => lowerText.includes(kw.toLowerCase()))) {
    return 'Dove'
  }
  if (KEYWORD_PATTERNS.brand_case_sweaty_betty.some(kw => lowerText.includes(kw.toLowerCase()))) {
    return 'Sweaty Betty'
  }

  return null
}

export function parseTextBlocksAdvanced({ title, text }) {
  const titleStr = typeof title === 'string' ? title.trim() : ''
  const textStr = typeof text === 'string' ? text : ''

  // Split by blank lines (one or more newlines with optional whitespace)
  const paragraphs = textStr
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)

  if (paragraphs.length === 0) {
    return {
      text_blocks: [],
      paragraph_count: 0,
      has_modular_blocks: false,
      has_case_like_paragraphs: false,
      total_chars: 0,
    }
  }

  // Convert paragraphs to text blocks with roles
  const textBlocks = paragraphs.map((paragraph, index) => {
    const role = detectParagraphRole(paragraph, index, paragraphs.length)
    const blockId = `paragraph_${index + 1}`
    const charCount = paragraph.length

    const block = {
      id: blockId,
      role,
      text: paragraph,
      char_count: charCount,
      index,
    }

    // Add brand name for brand_case blocks
    if (role === 'brand_case') {
      const brand = extractBrandName(paragraph)
      if (brand) {
        block.brand = brand
      }
    }

    return block
  })

  // Check for modular structure
  const hasCaseLikeParagraphs = textBlocks.some((b) =>
    ['brand_case', 'protest_case'].includes(b.role)
  )
  const hasModularBlocks = textBlocks.length >= 3 && hasCaseLikeParagraphs

  const totalChars = textBlocks.reduce((sum, b) => sum + b.char_count, 0)

  return {
    text_blocks: textBlocks,
    paragraph_count: paragraphs.length,
    has_modular_blocks: hasModularBlocks,
    has_case_like_paragraphs: hasCaseLikeParagraphs,
    total_chars: totalChars,
  }
}
