import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  PAGE_WIDTH_MM, PAGE_HEIGHT_MM, MARGIN_TOP_MM, MARGIN_BOTTOM_MM,
  MARGIN_INNER_MM, MARGIN_OUTER_MM,
  BODY_FONT_SIZE_PT, BODY_LEADING_PT,
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
    FONTS_DIR: fontsDir,
    BODY_FONT_FILE_EN: 'IBMPlexSerif-Regular',
    BODY_FONT_FILE_KR: 'IBMPlexSerif-Regular',
    BODY_FONT_FILE_BOLD: 'IBMPlexSerif-Bold',
    BODY_FONT_FILE_KR_BOLD: 'IBMPlexSerif-Bold',
    BODY_FONT_FILE_EXT: 'ttf',
    BODY_FONT_SIZE: BODY_FONT_SIZE_PT,
    BODY_LEADING: BODY_LEADING_PT,
  })
}

function leftMarginForPage(pageNumber) {
  // Recto (odd, right-hand page): spine on the left -> inner margin is the left margin.
  // Verso (even, left-hand page): spine on the right -> outer margin is the left margin.
  return pageNumber % 2 === 1 ? MARGIN_INNER_MM : MARGIN_OUTER_MM
}

function escapeLatex(text) {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([{}#%&_$])/g, '\\$1')
    .replace(/\n\s*\n/g, '\\par ')
    .replace(/\n/g, ' ')
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

export function buildPagesLatex(resolvedPages) {
  return resolvedPages
    .map((page, i) => {
      const pageNumber = i + 1
      const parts = page.images.map((img) => imageBlock(img, pageNumber))
      if (page.textZone && page.textSlice) {
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
