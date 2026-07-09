// Spec section 5.3 + Revision: Rich content structure parsing for editorial layouts.
// NOW: Generates modular text_blocks instead of merging into body_all.
// Identifies meaningful content groups with semantic roles so LLM can create better grid layouts.

// Keyword patterns for automatic role detection
const ROLE_PATTERNS = {
  overview: [/메가트렌드|매크로트렌드|의미합니다|의미하|정의|반응|나타나/i],
  context: [/초양극화|전 세계|글로벌|움직임|행동주의|트렌드|사회적|환경|정치적/i],
  audience_value: [/Z세대|밀레니얼|세대|소비자|개인|사용자|선호/i],
  protest_case: [/카네기|시위|LGBTQ|프라이드|Pride|social movement|목소리|연대/i],
  brand_case_dove: [/도브|Dove|NoDigitalDistortion|Turn Your Back|Bold Glamour/i],
  brand_case_sweaty_betty: [/스웨티 베티|Sweaty Betty|Wear The Damn Shorts/i],
  case_section_title: [/^DESIGN CASE STUDIES$/i],
  case_title_en: [/^[A-Z\s]{5,}$/],
  case_title_ko: [/액티비즘|페미니즘|기념|운동|캠페인|상품/i],
  credit: [/^([\w\s]+|[가-힣]+)$/, /Nike N7|Deepti Khatri|Lippa Nessa/i], // short line or known credit
}

function inferParagraphRole(text) {
  const trimmed = text.trim()

  // Check case_section_title first (exact match)
  if (ROLE_PATTERNS.case_section_title[0].test(trimmed)) {
    return 'case_section_title'
  }

  // Short line heuristics (credit or case title)
  const lineCount = trimmed.split('\n').length
  const charCount = trimmed.length
  if (lineCount === 1 && charCount < 60) {
    // Could be case_title_en (all caps, short)
    if (ROLE_PATTERNS.case_title_en[0].test(trimmed)) {
      return 'case_title_en'
    }
    // Could be case_title_ko (Korean, short)
    if (/[가-힣]/.test(trimmed) && charCount < 40) {
      return 'case_title_ko'
    }
    // Check for known credits
    if (ROLE_PATTERNS.credit[1].test(trimmed)) {
      return 'credit'
    }
    // Default short line
    return 'case_title_ko'
  }

  // Check longer paragraphs against patterns (in order of specificity)
  for (const [role, patterns] of Object.entries(ROLE_PATTERNS)) {
    if (role === 'case_section_title' || role === 'case_title_en' || role === 'credit') {
      continue // Already checked
    }
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        return role
      }
    }
  }

  return 'unknown'
}

export function parseContentStructure({ title, text }) {
  const titleStr = typeof title === 'string' ? title.trim() : ''
  const textStr = typeof text === 'string' ? text : ''

  // Split by blank lines (one or more) to detect paragraph boundaries
  const rawParagraphs = textStr
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)

  const paragraph_count = rawParagraphs.length

  // Build text_blocks array: each paragraph becomes an independent block
  const text_blocks = rawParagraphs.map((para, idx) => {
    const role = inferParagraphRole(para)
    return {
      id: `paragraph_${idx + 1}`,
      type: 'paragraph',
      role,
      text: para,
      char_count: para.length,
    }
  })

  // Determine text layout mode based on content signals
  let text_layout_mode = 'continuous_flow'
  if (paragraph_count >= 2) {
    // Multiple paragraphs → modular_blocks or hybrid_flow
    const hasCaseTitle = text_blocks.some((b) => b.role?.includes('case_title') || b.role === 'case_section_title')
    const hasBrandCase = text_blocks.some((b) => b.role?.includes('brand_case'))
    if (hasCaseTitle || hasBrandCase || paragraph_count >= 5) {
      text_layout_mode = 'modular_blocks'
    } else if (paragraph_count >= 3) {
      text_layout_mode = 'hybrid_flow'
    }
  }

  // Backward compatibility: also return old structure
  let introBody = null
  let bodyParagraphs = rawParagraphs
  const INTRO_MAX_CHARS = 150
  if (rawParagraphs.length > 1 && rawParagraphs[0].length < INTRO_MAX_CHARS && !rawParagraphs[0].endsWith('.')) {
    introBody = rawParagraphs[0]
    bodyParagraphs = rawParagraphs.slice(1)
  }

  return {
    // New structure (primary)
    paragraph_count,
    text_blocks,
    text_layout_mode,
    merged_body_all: false, // Explicitly mark: NOT merged

    // Old structure (backward compatibility)
    title: titleStr || null,
    intro_body: introBody,
    body_paragraphs: bodyParagraphs,
    has_intro: !!introBody,
    has_body: bodyParagraphs.length > 0,
    has_case_like_paragraphs: text_blocks.some((b) => b.role?.includes('case') || b.role?.includes('brand')),
    total_paragraphs: paragraph_count,
  }
}
