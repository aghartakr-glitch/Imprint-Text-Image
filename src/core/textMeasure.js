import {
  BODY_LEADING_PT,
  CHAR_WIDTH_CALIBRATION_FACTOR,
  PT_TO_MM,
  ROLE_BOLD_WIDTH_FACTOR,
  ROLE_FONT_SIZE_PT,
  ROLE_LEADING_PT,
} from './layoutConstants.js'

export const BODY_LIKE_ROLES = new Set(['body', 'continuation_body', 'quote', 'lead', 'list_item'])

// Shared text measurement model for the absolute-positioned LaTeX renderer.
// Every stacked text box is placed before XeLaTeX runs, so layout and validation must use the same
// conservative line-count model. Keep these values in sync with templates/page_style_template.sty's
// TitleText, SectionTitleText, and BodyText behavior.
const HEADING_WIDTH_FACTOR = 0.85
const HEADING_LINE_SAFETY_FACTOR = 0.96

export function isBodyLikeRole(role = 'body') {
  return BODY_LIKE_ROLES.has(role)
}

export function leadingMmFor(role = 'body') {
  return (ROLE_LEADING_PT[role] ?? BODY_LEADING_PT) * PT_TO_MM
}

export function estimateTextCapacityMm(wMm, hMm, role = 'body') {
  const fontSizePt = ROLE_FONT_SIZE_PT[role] ?? ROLE_FONT_SIZE_PT.body
  const leadingPt = ROLE_LEADING_PT[role] ?? ROLE_LEADING_PT.body
  const boldFactor = ROLE_BOLD_WIDTH_FACTOR[role] ?? 1
  const charWidthMm = fontSizePt * PT_TO_MM * boldFactor * CHAR_WIDTH_CALIBRATION_FACTOR
  const lineHeightMm = leadingPt * PT_TO_MM

  const charsPerLine = Math.floor(wMm / charWidthMm)
  const lines = Math.floor(hMm / lineHeightMm)
  return Math.max(0, charsPerLine * lines)
}

export function headingVisualUnits(text) {
  return Array.from(String(text || '')).reduce((sum, ch) => {
    if (/\\s/.test(ch)) return sum + 0.35
    if (/[-.,:;()\[\]{}'"/]/.test(ch)) return sum + 0.35
    if (/[A-Z]/.test(ch)) return sum + 0.72
    if (/[a-z0-9]/.test(ch)) return sum + 0.58
    return sum + 1.05
  }, 0)
}

export function headingLineCapacityUnits(wMm, role = 'body') {
  const fontSizePt = ROLE_FONT_SIZE_PT[role] ?? ROLE_FONT_SIZE_PT.body
  const unitWidthMm = fontSizePt * PT_TO_MM * HEADING_WIDTH_FACTOR
  return Math.max(1, (wMm / unitWidthMm) * HEADING_LINE_SAFETY_FACTOR)
}

export function estimateLineCount({ text = '', charCount = 0, role = 'body', wMm, hMm = null } = {}) {
  if (!isBodyLikeRole(role) && text) {
    return Math.max(1, Math.ceil(headingVisualUnits(text) / headingLineCapacityUnits(wMm, role)))
  }

  const heightMm = hMm ?? leadingMmFor(role)
  const charsPerLine = Math.max(1, estimateTextCapacityMm(wMm, heightMm, role))
  return Math.max(1, Math.ceil((charCount || 0) / charsPerLine))
}

export function textHeightMmForLines(lines, role = 'body') {
  const leading = leadingMmFor(role)
  return lines > 1 ? lines * leading + leading * 0.35 : leading
}

export function textHeightMm({ text = '', charCount = 0, role = 'body', wMm } = {}) {
  return textHeightMmForLines(estimateLineCount({ text, charCount, role, wMm }), role)
}

export function measuredLengthForValidation({ text = '', charCount = 0, role = 'body' } = {}) {
  return !isBodyLikeRole(role) && text ? headingVisualUnits(text) : charCount
}

export function capacityForValidation({ text = '', role = 'body', wMm, hMm } = {}) {
  if (!isBodyLikeRole(role) && text) {
    const lines = Math.floor(hMm / leadingMmFor(role))
    return Math.max(0, headingLineCapacityUnits(wMm, role) * lines)
  }
  return estimateTextCapacityMm(wMm, hMm, role)
}

