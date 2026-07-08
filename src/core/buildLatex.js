import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  PAGE_WIDTH_MM, PAGE_HEIGHT_MM, MARGIN_TOP_MM, MARGIN_BOTTOM_MM,
  MARGIN_INNER_MM, MARGIN_OUTER_MM,
  BODY_FONT_SIZE_PT, BODY_LEADING_PT,
  TITLE_FONT_SIZE_PT, TITLE_LEADING_PT, TITLE_VERTICAL_POSITION_RATIO,
} from './layoutConstants.js'

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

function escapeLatex(text) {
  const BACKSLASH_SENTINEL = ' BACKSLASH '
  return text
    .replace(/\\/g, BACKSLASH_SENTINEL)
    .replace(/([{}#%&_$])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/\n\s*\n/g, '\\par ')
    .replace(/\n/g, ' ')
    .split(BACKSLASH_SENTINEL).join('\\textbackslash{}')
}

function imageBlock(image, pageNumber) {
  const xMm = image.fullBleed ? image.xMm : leftMarginForPage(pageNumber) + image.xMm
  const yMm = image.fullBleed ? image.yMm : MARGIN_TOP_MM + image.yMm
  const path = image.path.replace(/\\/g, '/')
  return `\\begin{textblock}{${image.wMm}}(${xMm},${yMm})\n`
    + `  \\includegraphics[width=${image.wMm}mm,height=${image.hMm}mm,keepaspectratio]{${path}}\n`
    + '\\end{textblock}'
}

function textBlock(textZone, pageNumber, textSlice) {
  const xMm = leftMarginForPage(pageNumber) + textZone.xMm
  const yMm = MARGIN_TOP_MM + textZone.yMm
  return `\\begin{textblock}{${textZone.wMm}}(${xMm},${yMm})\n`
    + `  \\BodyText{${escapeLatex(textSlice)}}\n`
    + '\\end{textblock}'
}

// Section-opener title page: large heading type sitting in generous whitespace, not
// dead-center (TITLE_VERTICAL_POSITION_RATIO nudges it toward the upper-middle third,
// which reads more like a real editorial opener than a perfectly centered title slide).
function titleBlock(textZone, pageNumber, title) {
  const xMm = leftMarginForPage(pageNumber) + textZone.xMm
  const yMm = MARGIN_TOP_MM + textZone.yMm + textZone.hMm * TITLE_VERTICAL_POSITION_RATIO
  return `\\begin{textblock}{${textZone.wMm}}(${xMm},${yMm})\n`
    + `  \\TitleText{${escapeLatex(title)}}\n`
    + '\\end{textblock}'
}

export function buildPagesLatex(resolvedPages) {
  return resolvedPages
    .map((page, i) => {
      const pageNumber = i + 1
      const parts = ['\\mbox{}']
      parts.push(...page.images.map((img) => imageBlock(img, pageNumber)))
      if (page.type === 'title-page') {
        parts.push(titleBlock(page.textZone, pageNumber, page.title))
      } else if (Array.isArray(page.textBlocks) && page.textBlocks.length > 0) {
        // Column-flow grid pages carry one text block per column slot -- render every one that
        // actually has text (a reserved-region-blocked column can produce a zero-length slot).
        page.textBlocks.forEach((tb) => {
          if (tb.slice) parts.push(textBlock(tb.zone, pageNumber, tb.slice))
        })
      } else if (page.textZone && page.textSlice) {
        parts.push(textBlock(page.textZone, pageNumber, page.textSlice))
      }
      return parts.join('\n')
    })
    .join('\n\\newpage\n')
}

export function buildMainTex({ resolvedPages }) {
  const template = readFileSync(join(TEMPLATE_DIR, 'main_template.tex'), 'utf-8')
  return fillTemplate(template, { BODY_LATEX: buildPagesLatex(resolvedPages) })
}
