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

// Default geometry is A5/recommended -- every existing caller that doesn't know about a specific
// generation's page_size (tests, legacy call sites) keeps producing exactly the output it always
// did. Real generations now pass the plan's own resolved geometry (2026-07-28): previously this
// whole file hardcoded PAGE_WIDTH_MM/PAGE_HEIGHT_MM/MARGIN_*_MM (all A5 numbers) no matter what
// page_size the user picked in the UI, so even a fully-valid, non-overflowing B5/A4 layout still
// got physically typeset onto an A5 sheet -- the page_size dropdown changed metadata and internal
// math elsewhere, but never the actual rendered PDF.
const DEFAULT_GEOMETRY = {
  pageWidthMm: PAGE_WIDTH_MM,
  pageHeightMm: PAGE_HEIGHT_MM,
  marginTopMm: MARGIN_TOP_MM,
  marginBottomMm: MARGIN_BOTTOM_MM,
  marginInnerMm: MARGIN_INNER_MM,
  marginOuterMm: MARGIN_OUTER_MM,
}

export function buildStyleTex({ fontsDir, geometry = DEFAULT_GEOMETRY }) {
  const template = readFileSync(join(TEMPLATE_DIR, 'page_style_template.sty'), 'utf-8')
  return fillTemplate(template, {
    PAGE_WIDTH: geometry.pageWidthMm,
    PAGE_HEIGHT: geometry.pageHeightMm,
    MARGIN_TOP: geometry.marginTopMm,
    MARGIN_BOTTOM: geometry.marginBottomMm,
    MARGIN_INNER: geometry.marginInnerMm,
    MARGIN_OUTER: geometry.marginOuterMm,
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

function leftMarginForPage(pageNumber, geometry = DEFAULT_GEOMETRY) {
  // Recto (odd, right-hand page): spine on the left -> inner margin is the left margin.
  // Verso (even, left-hand page): spine on the right -> outer margin is the left margin.
  return pageNumber % 2 === 1 ? geometry.marginInnerMm : geometry.marginOuterMm
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

function imageBlock(image, pageNumber, geometry = DEFAULT_GEOMETRY) {
  const xMm = image.fullBleed ? image.xMm : leftMarginForPage(pageNumber, geometry) + image.xMm
  const yMm = image.fullBleed ? image.yMm : geometry.marginTopMm + image.yMm
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
    caption: '\\CaptionText',
    label: '\\SectionTitleText',
    body: '\\BodyText',
  }
  return roleMap[role] || '\\BodyText'
}

// Running head + page number, top of page. In the generated spread preview, odd-numbered pages sit
// on the left and even-numbered pages sit on the right, so the outer edge is left for odd pages and
// right for even pages. The running head is placed on the opposite, inner edge. \pagestyle{empty}
// suppresses LaTeX's own header/footer machinery since every element is absolutely positioned.
function runningHeadBlock(pageNumber, runningHeadText, geometry = DEFAULT_GEOMETRY) {
  const isLeftSpreadPage = pageNumber % 2 === 1
  const contentWidthMm = geometry.pageWidthMm - geometry.marginInnerMm - geometry.marginOuterMm
  const yMm = geometry.marginTopMm - 8
  const numberBoxWidthMm = 15
  const numberXMm = isLeftSpreadPage ? geometry.marginOuterMm : geometry.pageWidthMm - geometry.marginOuterMm - numberBoxWidthMm
  const labelXMm = isLeftSpreadPage ? geometry.marginOuterMm : geometry.marginInnerMm

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

function textBlock(textZone, pageNumber, textSlice, role = 'body', geometry = DEFAULT_GEOMETRY) {
  const xMm = leftMarginForPage(pageNumber, geometry) + textZone.xMm
  const yMm = geometry.marginTopMm + textZone.yMm
  const hMm = textZone.hMm || 100 // Default fallback height if not specified

  const styleCmd = styleCommandForRole(role)

  return `\\begin{textblock*}{${textZone.wMm}mm}(${xMm}mm,${yMm}mm)\n`
    + `  \\noindent\\begin{minipage}[t][${hMm}mm][t]{${textZone.wMm}mm}\n`
    + `    ${styleCmd}{${escapeLatex(textSlice)}}\n`
    + `  \\end{minipage}\n`
    + '\\end{textblock*}'
}


// Kept in sync by hand with repairContentGroupLayout.js's GAP_AFTER_HEADING_MM/GAP_AFTER_BODY_MM --
// those are the values a real generation's box_mm positions are actually built from (calibrated
// 2026-07-27/28 against real renders). This function used to carry its OWN, never-synced numbers
// (title->4mm, section_label->3mm, body->2.2mm), so whenever flowTextBlock() below handled a group
// instead of the individually-positioned box_mm path, the SAME title+subtitle pattern rendered with
// a visibly different, larger gap than everywhere else -- confirmed 2026-07-28 from a real page
// where two structurally identical title+subtitle groups on the same page had different spacing
// depending only on which of the two rendering paths happened to run.
function gapAfterTextRole(role) {
  if (role === 'body' || role === 'continuation_body' || role === 'quote' || role === 'lead' || role === 'list_item') return 3
  if (role === 'credit' || role === 'caption') return 1
  return 2 // every heading-tier role (title, section_title/label, case_title*, label)
}

function textBlockSort(a, b) {
  const ay = a.zone?.yMm ?? 0
  const by = b.zone?.yMm ?? 0
  if (Math.abs(ay - by) > 0.5) return ay - by
  return (a.zone?.xMm ?? 0) - (b.zone?.xMm ?? 0)
}

function flowKeyForTextBlock(tb) {
  // flow_group_id is a 0-based index (buildContentGroups.js/repairContentGroupLayout.js number
  // groups starting at 0), so `!tb?.flow_group_id` was true for the document's very first group
  // (flow_group_id: 0 is falsy in JS) -- that group silently fell through to the OTHER rendering
  // path (individually-positioned box_mm textblocks, 1mm gap) while every other group correctly
  // grouped into flowTextBlock() below. Confirmed 2026-07-28: a real document's first title+subtitle
  // pair rendered with different spacing than every other title+subtitle pair in the same document,
  // purely because it happened to be group 0. Must check for null/undefined specifically, not falsiness.
  if (tb?.flow_group_id == null || !tb?.zone || !tb.slice) return null
  const x = Math.round((tb.zone.xMm || 0) * 10) / 10
  const w = Math.round((tb.zone.wMm || 0) * 10) / 10
  return `${tb.flow_group_id}:${x}:${w}`
}

function groupTextBlocksForFlow(textBlocks = []) {
  const grouped = new Map()
  const order = []
  textBlocks.forEach((tb, index) => {
    if (!tb.slice) return
    const key = flowKeyForTextBlock(tb)
    if (!key) {
      order.push({ type: 'single', index, tb })
      return
    }
    if (!grouped.has(key)) {
      grouped.set(key, [])
      order.push({ type: 'group', key, firstIndex: index })
    }
    grouped.get(key).push({ ...tb, __index: index })
  })

  return order.map((entry) => {
    if (entry.type === 'single') return entry
    const blocks = grouped.get(entry.key).sort(textBlockSort)
    if (blocks.length <= 1) return { type: 'single', index: entry.firstIndex, tb: blocks[0] }
    return { type: 'group', key: entry.key, blocks }
  })
}

function flowTextBlock(blocks, pageNumber, geometry = DEFAULT_GEOMETRY) {
  const sorted = [...blocks].sort(textBlockSort)
  const firstZone = sorted[0].zone
  const xMm = leftMarginForPage(pageNumber, geometry) + firstZone.xMm
  const yMm = geometry.marginTopMm + firstZone.yMm
  const bottom = Math.max(...sorted.map((tb) => (tb.zone.yMm || 0) + (tb.zone.hMm || 0)))
  const hMm = Math.max(firstZone.hMm || 0, bottom - firstZone.yMm)
  const body = sorted.map((tb, index) => {
    const styleCmd = styleCommandForRole(tb.role)
    const spacer = index < sorted.length - 1 ? `\\vspace{${gapAfterTextRole(tb.role)}mm}` : ''
    return `    ${styleCmd}{${escapeLatex(tb.slice)}}${spacer}`
  }).join('\n')

  return `\\begin{textblock*}{${firstZone.wMm}mm}(${xMm}mm,${yMm}mm)\n`
    + `  \\noindent\\begin{minipage}[t]{${firstZone.wMm}mm}\n`
    + `${body}\n`
    + `  \\end{minipage}\n`
    + '\\end{textblock*}'
}
// Section-opener title page: large heading type sitting in generous whitespace, not
// dead-center (TITLE_VERTICAL_POSITION_RATIO nudges it toward the upper-middle third,
// which reads more like a real editorial opener than a perfectly centered title slide).
function titleBlock(textZone, pageNumber, title, geometry = DEFAULT_GEOMETRY) {
  const xMm = leftMarginForPage(pageNumber, geometry) + textZone.xMm
  const yMm = geometry.marginTopMm + textZone.yMm + textZone.hMm * TITLE_VERTICAL_POSITION_RATIO
  const hMm = textZone.hMm || 100
  return `\\begin{textblock*}{${textZone.wMm}mm}(${xMm}mm,${yMm}mm)\n`
    + `  \\noindent\\begin{minipage}[t][${hMm}mm][t]{${textZone.wMm}mm}\n`
    + `    \\TitleText{${escapeLatex(title)}}\n`
    + `  \\end{minipage}\n`
    + '\\end{textblock*}'
}

export function buildPagesLatex(resolvedPages, { runningHeadText, geometry = DEFAULT_GEOMETRY } = {}) {
  return resolvedPages
    .map((page, i) => {
      const pageNumber = i + 1
      const parts = ['\\mbox{}']
      parts.push(...page.images.map((img) => imageBlock(img, pageNumber, geometry)))
      if (page.type === 'title-page') {
        parts.push(titleBlock(page.textZone, pageNumber, page.title, geometry))
      } else if (Array.isArray(page.textBlocks) && page.textBlocks.length > 0) {
        groupTextBlocksForFlow(page.textBlocks).forEach((entry) => {
          if (entry.type === 'group') {
            parts.push(flowTextBlock(entry.blocks, pageNumber, geometry))
          } else if (entry.tb?.slice) {
            parts.push(textBlock(entry.tb.zone, pageNumber, entry.tb.slice, entry.tb.role, geometry))
          }
        })
      } else if (page.textZone && page.textSlice) {
        parts.push(textBlock(page.textZone, pageNumber, page.textSlice, 'body', geometry))
      }
      parts.push(runningHeadBlock(pageNumber, runningHeadText, geometry))
      let pageLatex = parts.join('\n')
      // Auto-repair (2026-08-05): two independent real generations both produced a \BodyText
      // textblock* whose \end{textblock*} is missing -- always the exact same shape, \end{minipage}
      // immediately followed by the NEXT element's \begin{textblock*} (sometimes with a blank line
      // between, sometimes not), with no \end{textblock*} in between. Root cause not pinned down
      // (traced to textBlock()'s single-block render path, but its source unconditionally appends
      // the closing tag, so the exact trigger is still unclear) -- but the broken shape itself is
      // narrow and unambiguous enough to detect and fix directly: XeTeX would otherwise silently
      // swallow the rest of the document into one unterminated group, wasting a full compile.
      pageLatex = pageLatex.replace(
        /\\end\{minipage\}\n(\s*\n)?(?=\\begin\{textblock\*\})/g,
        (_match, blankLine) => `\\end{minipage}\n\\end{textblock*}\n${blankLine || ''}`,
      )
      // Final balance check: if the shape above didn't cover it, fail loudly with the page number
      // instead of producing unreadable LaTeX that XeTeX only rejects at \end{document}.
      const beginCount = (pageLatex.match(/\\begin\{textblock\*\}/g) || []).length
      const endCount = (pageLatex.match(/\\end\{textblock\*\}/g) || []).length
      if (beginCount !== endCount) {
        throw new Error(`buildPagesLatex: page ${pageNumber} has ${beginCount} \\begin{textblock*} but ${endCount} \\end{textblock*} -- unbalanced LaTeX would fail to compile`)
      }
      return pageLatex
    })
    .join('\n\\newpage\n')
}

export function buildMainTex({ resolvedPages, runningHeadText, geometry = DEFAULT_GEOMETRY }) {
  const template = readFileSync(join(TEMPLATE_DIR, 'main_template.tex'), 'utf-8')
  return fillTemplate(template, { BODY_LATEX: buildPagesLatex(resolvedPages, { runningHeadText, geometry }) })
}
