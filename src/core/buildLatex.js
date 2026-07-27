import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  PAGE_WIDTH_MM, PAGE_HEIGHT_MM, MARGIN_TOP_MM, MARGIN_BOTTOM_MM,
  MARGIN_INNER_MM, MARGIN_OUTER_MM,
  BODY_FONT_SIZE_PT, BODY_LEADING_PT,
  TITLE_FONT_SIZE_PT, TITLE_LEADING_PT, TITLE_VERTICAL_POSITION_RATIO,
} from './layoutConstants.js'
import { stripMarkdownHeadingMarkers } from './text/parseMarkdownDocument.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATE_DIR = join(__dirname, '..', '..', 'templates')

function fillTemplate(template, values) {
  let out = template
  for (const [key, val] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(String(val))
  }
  return out
}

export function buildStyleTex({ fontsDir }) {
  const template = readFileSync(join(TEMPLATE_DIR, 'page_style_template.sty'), 'utf-8')
  return fillTemplate(template, {
    PAGE_WIDTH: PAGE_WIDTH_MM,
    PAGE_HEIGHT: PAGE_HEIGHT_MM,
    MARGIN_TOP: MARGIN_TOP_MM,
    MARGIN_BOTTOM: MARGIN_BOTTOM_MM,
    MARGIN_INNER: MARGIN_INNER_MM,
    MARGIN_OUTER: MARGIN_OUTER_MM,
    FONTS_DIR: fontsDir.replace(/\\/g, '/'),
    // IBM Plex Serif has no Hangul glyphs at all (confirmed by a real compile: Latin/numbers
    // rendered fine, every Hangul syllable came out as an empty box). Noto Sans KR is already
    // proven (real compile + visual check) to render Hangul correctly, so the body now uses
    // it too — sans-serif instead of PRD's serif spec, but reliably correct rather than
    // silently broken. Distinguished from the title purely by size/weight (9pt/regular vs
    // 28pt/bold), not by typeface family.
    BODY_FONT_FILE_EN: 'NotoSansKR-Regular',
    BODY_FONT_FILE_KR: 'NotoSansKR-Regular',
    BODY_FONT_FILE_BOLD: 'NotoSansKR-Bold',
    BODY_FONT_FILE_KR_BOLD: 'NotoSansKR-Bold',
    BODY_FONT_FILE_EXT: 'ttf',
    BODY_FONT_SIZE: BODY_FONT_SIZE_PT,
    BODY_LEADING: BODY_LEADING_PT,
    HEADING_FONT_FILE_EN: 'NotoSansKR-Regular',
    HEADING_FONT_FILE_KR: 'NotoSansKR-Regular',
    HEADING_FONT_FILE_BOLD: 'NotoSansKR-Bold',
    HEADING_FONT_FILE_KR_BOLD: 'NotoSansKR-Bold',
    HEADING_FONT_FILE_EXT: 'ttf',
    TITLE_FONT_SIZE: TITLE_FONT_SIZE_PT,
    TITLE_LEADING: TITLE_LEADING_PT,
  })
}

function leftMarginForPage(pageNumber) {
  // Recto (odd, right-hand page): spine on the left -> inner margin is the left margin.
  // Verso (even, left-hand page): spine on the right -> outer margin is the left margin.
  return pageNumber % 2 === 1 ? MARGIN_INNER_MM : MARGIN_OUTER_MM
}

function normalizeTextForLatex(text) {
  return stripMarkdownHeadingMarkers(String(text ?? ''))
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
}

function escapeLatex(text) {
  const BACKSLASH_SENTINEL = ' BACKSLASH '
  return normalizeTextForLatex(text)
    .replace(/\\/g, BACKSLASH_SENTINEL)
    .replace(/([{}#%&_$])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/\n\s*\n/g, '\\par ')
    .replace(/\n/g, '\\\\ ')
    .split(BACKSLASH_SENTINEL).join('\\textbackslash{}')
}

function imageBlock(image, pageNumber) {
  const xMm = image.fullBleed ? image.xMm : leftMarginForPage(pageNumber) + image.xMm
  const yMm = image.fullBleed ? image.yMm : MARGIN_TOP_MM + image.yMm
  const path = image.path.replace(/\\/g, '/')

  // Cover-crop (refineLayout.js's coverImageInBox): render the image at cover size (aspect
  // preserved, spilling past the box in one dimension) and clip the spill with trimclip's
  // \clipbox{left bottom right top}, so the visible image fills its grid box edge-to-edge. The
  // trim amounts are computed in JS from the measured aspect ratio; width alone is passed to
  // \includegraphics so the render keeps the file's true proportions.
  if (image.cover) {
    const c = image.cover
    const fmt = (n) => Number(n.toFixed(3))
    return `\\begin{textblock*}{${image.wMm}mm}(${xMm}mm,${yMm}mm)\n`
      + `  \\noindent\\clipbox{${fmt(c.trimLeftMm)}mm ${fmt(c.trimBottomMm)}mm ${fmt(c.trimRightMm)}mm ${fmt(c.trimTopMm)}mm}{\\includegraphics[width=${fmt(c.renderWMm)}mm]{${path}}}\n`
      + '\\end{textblock*}'
  }

  return `\\begin{textblock*}{${image.wMm}mm}(${xMm}mm,${yMm}mm)\n`
    + `  \\noindent\\includegraphics[width=${image.wMm}mm,height=${image.hMm}mm,keepaspectratio]{${path}}\n`
    + '\\end{textblock*}'
}

// Map semantic role to LaTeX style command
function styleCommandForRole(role) {
  const roleMap = {
    title: '\\TitleText',
    section_title: '\\SectionTitleText',
    section_label: '\\SectionTitleText',
    case_title: '\\CaseTitleKoText',
    case_title_ko: '\\CaseTitleKoText',
    case_title_en: '\\CaseTitleEnText',
    case_body: '\\CaseBodyText',
    credit: '\\CreditText',
    label: '\\SectionTitleText',
    body: '\\BodyText',
  }
  return roleMap[role] || '\\BodyText'
}

// Running head + page number, top of page. In the generated spread preview, odd-numbered pages sit
// on the left and even-numbered pages sit on the right, so the outer edge is left for odd pages and
// right for even pages. The running head is placed on the opposite, inner edge. \pagestyle{empty}
// suppresses LaTeX's own header/footer machinery since every element is absolutely positioned.
function runningHeadBlock(pageNumber, runningHeadText) {
  const isLeftSpreadPage = pageNumber % 2 === 1
  const contentWidthMm = PAGE_WIDTH_MM - MARGIN_INNER_MM - MARGIN_OUTER_MM
  const yMm = MARGIN_TOP_MM - 8
  const numberBoxWidthMm = 15
  const numberXMm = isLeftSpreadPage ? MARGIN_OUTER_MM : PAGE_WIDTH_MM - MARGIN_OUTER_MM - numberBoxWidthMm
  const labelXMm = isLeftSpreadPage ? MARGIN_OUTER_MM : MARGIN_INNER_MM

  const parts = []
  if (runningHeadText) {
    const labelAlign = isLeftSpreadPage ? '\\raggedleft' : '\\raggedright'
    parts.push(`\\begin{textblock*}{${contentWidthMm}mm}(${labelXMm}mm,${yMm}mm)\n`
      + `  \\noindent{${labelAlign}\\RunningHeadText{${escapeLatex(runningHeadText)}}\\par}\n`
      + '\\end{textblock*}')
  }
  const numberAlign = isLeftSpreadPage ? '\\raggedright' : '\\raggedleft'
  parts.push(`\\begin{textblock*}{${numberBoxWidthMm}mm}(${numberXMm}mm,${yMm}mm)\n`
    + `  \\noindent{${numberAlign}\\PageNumberText{${pageNumber}}\\par}\n`
    + '\\end{textblock*}')
  return parts.join('\n')
}

function textBlock(textZone, pageNumber, textSlice, role = 'body') {
  const xMm = leftMarginForPage(pageNumber) + textZone.xMm
  const yMm = MARGIN_TOP_MM + textZone.yMm
  const hMm = textZone.hMm || 100 // Default fallback height if not specified

  const styleCmd = styleCommandForRole(role)

  return `\\begin{textblock*}{${textZone.wMm}mm}(${xMm}mm,${yMm}mm)\n`
    + `  \\noindent\\begin{minipage}[t][${hMm}mm][t]{${textZone.wMm}mm}\n`
    + `    ${styleCmd}{${escapeLatex(textSlice)}}\n`
    + `  \\end{minipage}\n`
    + '\\end{textblock*}'
}

// Section-opener title page: large heading type sitting in generous whitespace, not
// dead-center (TITLE_VERTICAL_POSITION_RATIO nudges it toward the upper-middle third,
// which reads more like a real editorial opener than a perfectly centered title slide).
function titleBlock(textZone, pageNumber, title) {
  const xMm = leftMarginForPage(pageNumber) + textZone.xMm
  const yMm = MARGIN_TOP_MM + textZone.yMm + textZone.hMm * TITLE_VERTICAL_POSITION_RATIO
  const hMm = textZone.hMm || 100
  return `\\begin{textblock*}{${textZone.wMm}mm}(${xMm}mm,${yMm}mm)\n`
    + `  \\noindent\\begin{minipage}[t][${hMm}mm][t]{${textZone.wMm}mm}\n`
    + `    \\TitleText{${escapeLatex(title)}}\n`
    + `  \\end{minipage}\n`
    + '\\end{textblock*}'
}

export function buildPagesLatex(resolvedPages, { runningHeadText } = {}) {
  return resolvedPages
    .map((page, i) => {
      const pageNumber = i + 1
      const parts = ['\\mbox{}']
      parts.push(...page.images.map((img) => imageBlock(img, pageNumber)))
      if (page.type === 'title-page') {
        parts.push(titleBlock(page.textZone, pageNumber, page.title))
      } else if (Array.isArray(page.textBlocks) && page.textBlocks.length > 0) {
        // Render every text block with role-based styling (section_title, case_body, body, etc.)
        // Each block is independent, enabling images and text to interleave.
        page.textBlocks.forEach((tb) => {
          if (tb.slice) parts.push(textBlock(tb.zone, pageNumber, tb.slice, tb.role))
        })
      } else if (page.textZone && page.textSlice) {
        parts.push(textBlock(page.textZone, pageNumber, page.textSlice))
      }
      parts.push(runningHeadBlock(pageNumber, runningHeadText))
      return parts.join('\n')
    })
    .join('\n\\newpage\n')
}

export function buildMainTex({ resolvedPages, runningHeadText }) {
  const template = readFileSync(join(TEMPLATE_DIR, 'main_template.tex'), 'utf-8')
  return fillTemplate(template, { BODY_LATEX: buildPagesLatex(resolvedPages, { runningHeadText }) })
}
