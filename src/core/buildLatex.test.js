import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStyleTex, buildMainTex, buildPagesLatex } from './buildLatex.js'

test('buildStyleTex fills in geometry and font placeholders, leaves no {{...}} tokens', () => {
  const tex = buildStyleTex({ fontsDir: '/abs/path/assets/fonts' })
  assert.match(tex, /paperwidth=148mm/)
  assert.match(tex, /paperheight=210mm/)
  assert.match(tex, /inner=18mm/)
  assert.match(tex, /outer=14mm/)
  assert.match(tex, /Path = \{\/abs\/path\/assets\/fonts\/\}/)
  assert.doesNotMatch(tex, /\{\{[A-Z_]+\}\}/)
})

test('buildPagesLatex emits one textblock per image and \\newpage between pages', () => {
  const resolvedPages = [
    {
      type: 'full-bleed-image',
      images: [{ path: '/a.jpg', xMm: 0, yMm: 0, wMm: 148, hMm: 210, fullBleed: true }],
      textZone: null,
      textSlice: null,
    },
    {
      type: 'text-only',
      images: [],
      textZone: { xMm: 0, yMm: 0, wMm: 116, hMm: 176 },
      textSlice: '가나다',
    },
  ]
  const body = buildPagesLatex(resolvedPages)
  assert.match(body, /includegraphics\[width=148mm,height=210mm,keepaspectratio\]\{\/a\.jpg\}/)
  assert.match(body, /\\newpage/)
  assert.match(body, /\\BodyText\{가나다\}/)
})

test('buildPagesLatex escapes LaTeX special characters in body text', () => {
  const resolvedPages = [{
    type: 'text-only',
    images: [],
    textZone: { xMm: 0, yMm: 0, wMm: 116, hMm: 176 },
    textSlice: '100% 완료 & 확인_됨 #1',
  }]
  const body = buildPagesLatex(resolvedPages)
  assert.match(body, /100\\% 완료 \\& 확인\\_됨 \\#1/)
})

test('buildMainTex embeds the page body into the document template', () => {
  const resolvedPages = [{ type: 'text-only', images: [], textZone: { xMm: 0, yMm: 0, wMm: 116, hMm: 176 }, textSlice: '본문' }]
  const tex = buildMainTex({ resolvedPages })
  assert.match(tex, /\\documentclass\[twoside\]\{article\}/)
  assert.match(tex, /\\BodyText\{본문\}/)
  assert.doesNotMatch(tex, /\{\{BODY_LATEX\}\}/)
})

test('escapeLatex handles a literal backslash without double-escaping', () => {
  const resolvedPages = [{
    type: 'text-only',
    images: [],
    textZone: { xMm: 0, yMm: 0, wMm: 116, hMm: 176 },
    textSlice: 'C:\\Users\\test',
  }]
  const body = buildPagesLatex(resolvedPages)
  assert.match(body, /C:\\textbackslash\{\}Users\\textbackslash\{\}test/)
  assert.doesNotMatch(body, /\\textbackslash\\\{/, 'braces after \\textbackslash must not be re-escaped')
})

test('escapeLatex escapes tilde and caret', () => {
  const resolvedPages = [{
    type: 'text-only',
    images: [],
    textZone: { xMm: 0, yMm: 0, wMm: 116, hMm: 176 },
    textSlice: '5~10 x^2',
  }]
  const body = buildPagesLatex(resolvedPages)
  assert.match(body, /5\\textasciitilde\{\}10 x\\textasciicircum\{\}2/)
})

test('buildStyleTex normalizes a Windows-style fontsDir to forward slashes', () => {
  const tex = buildStyleTex({ fontsDir: 'C:\\Users\\mjungpk\\Desktop\\Imprint(Image+Text)\\assets\\fonts' })
  assert.match(tex, /Path = \{C:\/Users\/mjungpk\/Desktop\/Imprint\(Image\+Text\)\/assets\/fonts\/\}/)
  assert.doesNotMatch(tex, /Path = \{C:\\/, 'fontsDir must not contain backslashes in the rendered .sty')
})
