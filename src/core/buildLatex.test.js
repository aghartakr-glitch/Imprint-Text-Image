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
  const mboxCount = (body.match(/\\mbox\{\}/g) || []).length
  assert.equal(mboxCount, resolvedPages.length, 'each page must have exactly one \\mbox{} content anchor so \\newpage actually ejects a page with overlay-only textblocks')
})

test('buildPagesLatex places page numbers on the outer edge, without chevron symbols', () => {
  const resolvedPages = [
    { type: 'text-only', images: [], textZone: { xMm: 0, yMm: 0, wMm: 116, hMm: 176 }, textSlice: '첫 페이지' },
    { type: 'text-only', images: [], textZone: { xMm: 0, yMm: 0, wMm: 116, hMm: 176 }, textSlice: '둘째 페이지' },
  ]
  const body = buildPagesLatex(resolvedPages)
  const pageBodies = body.split('\\newpage')
  assert.equal(pageBodies.length, 2)
  assert.match(pageBodies[0], /\\begin\{textblock\*\}\{15mm\}\(14mm,8mm\)\n  \\noindent\{\\raggedright\\PageNumberText\{1\}\\par\}/)
  assert.match(pageBodies[1], /\\begin\{textblock\*\}\{15mm\}\(119mm,8mm\)\n  \\noindent\{\\raggedleft\\PageNumberText\{2\}\\par\}/)
  assert.doesNotMatch(body, /PageNumberText\{[^}]*[<>][^}]*\}/)
})

test('buildPagesLatex renders running heads on the inner edge when provided, none when omitted', () => {
  const resolvedPages = [
    { type: 'text-only', images: [], textZone: { xMm: 0, yMm: 0, wMm: 116, hMm: 176 }, textSlice: '첫 페이지' },
    { type: 'text-only', images: [], textZone: { xMm: 0, yMm: 0, wMm: 116, hMm: 176 }, textSlice: '둘째 페이지' },
  ]
  const withHead = buildPagesLatex(resolvedPages, { runningHeadText: '2026/2027 TREND REPORT' })
  const pageBodies = withHead.split('\\newpage')
  assert.match(pageBodies[0], /\\begin\{textblock\*\}\{116mm\}\(14mm,8mm\)\n  \\noindent\{\\raggedleft\\RunningHeadText\{2026\/2027 TREND REPORT\}\\par\}/)
  assert.match(pageBodies[1], /\\begin\{textblock\*\}\{116mm\}\(18mm,8mm\)\n  \\noindent\{\\raggedright\\RunningHeadText\{2026\/2027 TREND REPORT\}\\par\}/)

  const withoutHead = buildPagesLatex(resolvedPages)
  assert.doesNotMatch(withoutHead, /\\RunningHeadText/)
})

test('buildPagesLatex renders a title-page with \\TitleText instead of \\BodyText, no images', () => {
  const resolvedPages = [
    {
      type: 'title-page',
      images: [],
      textZone: { xMm: 0, yMm: 0, wMm: 116, hMm: 176 },
      textSlice: null,
      title: '어떤 여름',
    },
    {
      type: 'text-only',
      images: [],
      textZone: { xMm: 0, yMm: 0, wMm: 116, hMm: 176 },
      textSlice: '본문 시작',
    },
  ]
  const body = buildPagesLatex(resolvedPages)
  assert.match(body, /\\TitleText\{어떤 여름\}/)
  assert.match(body, /\\BodyText\{본문 시작\}/)
  assert.doesNotMatch(body, /includegraphics/, 'title-page must not place any image')
})

// Regression: confirmed 2026-07-27 via a real side-by-side XeLaTeX compile that plain xeCJK breaks
// a line between ANY two Hangul characters, including inside a single Korean word/어절 (e.g.
// "대담한" -> "대담" / "한" split across two lines) -- correct for Chinese/Japanese, wrong for
// Korean. kotex (loading xetexko) only breaks at 어절 (space) boundaries.
test('buildStyleTex uses kotex (word-boundary-safe Korean line-breaking), not plain xeCJK', () => {
  const tex = buildStyleTex({ fontsDir: '/abs/path/assets/fonts' })
  assert.match(tex, /\\RequirePackage\{kotex\}/)
  assert.doesNotMatch(tex, /\\RequirePackage\{xeCJK\}/)
  assert.match(tex, /\\setmainhangulfont\{NotoSansKR-Regular\}/)
  assert.doesNotMatch(tex, /\\setCJKmainfont/)
})

test('buildStyleTex fills in the heading font and title size placeholders too', () => {
  const tex = buildStyleTex({ fontsDir: '/abs/path/assets/fonts' })
  assert.match(tex, /\\newfontfamily\\HeadingENFace\{NotoSansKR-Regular\}/)
  // \newhangulfontfamily (kotex/xetexko), not \newCJKfontfamily (xeCJK) -- switched 2026-07-27 so
  // Korean line-breaking only happens at 어절 (word) boundaries, never mid-word (see
  // page_style_template.sty's kotex comment for the confirmed real-compile comparison).
  assert.match(tex, /\\newhangulfontfamily\\HeadingKRFace\{NotoSansKR-Regular\}/)
  // 36pt leading (was 34pt) -- bumped 2026-07-27 to a >=1.25x ratio, see layoutConstants.js's
  // TITLE_LEADING_PT comment.
  assert.match(tex, /\\fontsize\{28pt\}\{36pt\}/)
})

test('buildStyleTex disables hyphenation and keeps all title/body roles ragged-right', () => {
  const tex = buildStyleTex({ fontsDir: '/abs/path/assets/fonts' })
  assert.match(tex, /\\RequirePackage\[none\]\{hyphenat\}/)
  assert.match(tex, /\\newcommand\{\\NoHyphenRaggedRight\}/)
  // Heading commands (TitleText) use \HeadingRaggedRight, not \NoHyphenRaggedRight -- headings
  // still allow a break at a REAL hyphen already in the text (e.g. "MOHOLY-NAGY"), which body
  // text's fully-disabled variant intentionally blocks (see page_style_template.sty).
  assert.match(tex, /\\newcommand\{\\HeadingRaggedRight\}/)
  assert.match(tex, /\\newcommand\{\\TitleText\}\[1\]\{\{[^\n]*\\HeadingRaggedRight/)
  assert.match(tex, /\\newcommand\{\\BodyText\}\[1\]\{[^\n]*\\NoHyphenRaggedRight/)
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

test('buildPagesLatex preserves a single source newline as a line break, not a paragraph gap', () => {
  const resolvedPages = [{
    type: 'text-only',
    images: [],
    textZone: { xMm: 0, yMm: 0, wMm: 116, hMm: 176 },
    textSlice: '첫 줄\n둘째 줄',
  }]
  const body = buildPagesLatex(resolvedPages)
  assert.match(body, /첫 줄\\\\ 둘째 줄/)
  assert.doesNotMatch(body, /첫 줄\\par 둘째 줄/)
})
test('buildPagesLatex converts literal HTML br markers into paragraph breaks before escaping', () => {
  const resolvedPages = [{
    type: 'text-only',
    images: [],
    textZone: { xMm: 0, yMm: 0, wMm: 116, hMm: 176 },
    textSlice: '첫 문단<br><br>둘째 문단',
  }]
  const body = buildPagesLatex(resolvedPages)
  assert.match(body, /첫 문단\\par 둘째 문단/)
  assert.doesNotMatch(body, /<br/i)
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

// Cover-crop rendering (2026-07-27): an image must fill its grid box exactly. The emitted LaTeX
// renders the image oversize (aspect preserved via width alone) and clips the spill, so the visible
// result lands precisely on the box edges -- no letterbox gap, no centering offset.
test('buildPagesLatex emits a clipped cover render when the image carries crop data', () => {
  const resolvedPages = [{
    type: 'layout-plan-page',
    images: [{
      path: '/a.jpg',
      xMm: 0,
      yMm: 0,
      wMm: 56,
      hMm: 40,
      fullBleed: false,
      cover: {
        renderWMm: 80, renderHMm: 40, trimLeftMm: 12, trimRightMm: 12, trimTopMm: 0, trimBottomMm: 0,
      },
    }],
    textZone: null,
    textSlice: null,
  }]
  const body = buildPagesLatex(resolvedPages)
  assert.match(body, /\\clipbox\{12mm 0mm 12mm 0mm\}\{\\includegraphics\[width=80mm\]\{\/a\.jpg\}\}/)
  // The positioning box still uses the planned grid size, so the image occupies its whole cell.
  assert.match(body, /\\begin\{textblock\*\}\{56mm\}/)
  assert.doesNotMatch(body, /keepaspectratio/)
})

test('buildPagesLatex falls back to plain contain rendering when no crop data is present', () => {
  const resolvedPages = [{
    type: 'layout-plan-page',
    images: [{
      path: '/a.jpg', xMm: 0, yMm: 0, wMm: 56, hMm: 40, fullBleed: false,
    }],
    textZone: null,
    textSlice: null,
  }]
  const body = buildPagesLatex(resolvedPages)
  assert.match(body, /keepaspectratio/)
  assert.doesNotMatch(body, /clipbox/)
})

test('buildStyleTex loads trimclip so \\clipbox is defined', () => {
  const tex = buildStyleTex({ fontsDir: '/abs/path/assets/fonts' })
  assert.match(tex, /\\RequirePackage\{trimclip\}/)
})

test('buildPagesLatex flows same-group text blocks inside one outer textblock', () => {
  const resolvedPages = [{
    type: 'layout-plan-page',
    images: [],
    textBlocks: [
      {
        zone: { xMm: 0, yMm: 20, wMm: 56, hMm: 8 },
        slice: '포토그램과 새로운 사진',
        role: 'case_title_ko',
        flow_group_id: 'group_7',
      },
      {
        zone: { xMm: 0, yMm: 23, wMm: 56, hMm: 8 },
        slice: '타이포포토',
        role: 'case_title_ko',
        flow_group_id: 'group_7',
      },
    ],
  }]
  const body = buildPagesLatex(resolvedPages)
  const textblockCount = (body.match(/\\begin\{textblock\*\}/g) || []).length
  assert.equal(textblockCount, 2, 'two same-group text blocks plus the page number should render as one content textblock')
  // 2mm, matching repairContentGroupLayout.js's GAP_AFTER_HEADING_MM -- gapAfterTextRole() must
  // stay in sync with the box_mm path's calibrated heading gap, not carry its own separate number.
  assert.match(body, /\\CaseTitleKoText\{포토그램과 새로운 사진\}\\vspace\{2mm\}\n    \\CaseTitleKoText\{타이포포토\}/)
})

// Regression (2026-07-28, real generation): flow_group_id is a 0-based index, so the document's
// very first group (flow_group_id: 0) is falsy in JS. flowKeyForTextBlock() used to check
// `!tb?.flow_group_id`, so group 0's title+subtitle silently skipped the flowTextBlock() grouping
// every OTHER group used, rendering with different (tighter, box_mm-derived) spacing than every
// later group's title+subtitle pair -- confirmed from a real document where the first section's
// title/subtitle gap visibly differed from the second section's, despite identical structure.
test('a group with flow_group_id 0 (the document\'s first group) still flows into one textblock', () => {
  const resolvedPages = [{
    type: 'layout-plan-page',
    images: [],
    textBlocks: [
      {
        zone: {
          xMm: 0, yMm: 0, wMm: 55.25, hMm: 12,
        },
        slice: 'JOHANNES ITTEN',
        role: 'title',
        flow_group_id: 0,
      },
      {
        zone: {
          xMm: 0, yMm: 13, wMm: 55.25, hMm: 6,
        },
        slice: '색채를 체계화한 교육자',
        role: 'section_label',
        flow_group_id: 0,
      },
    ],
  }]
  const body = buildPagesLatex(resolvedPages)
  const textblockCount = (body.match(/\\begin\{textblock\*\}/g) || []).length
  assert.equal(textblockCount, 2, 'the group-0 pair plus the page number should render as one content textblock, same as any other group')
  assert.match(body, /\\TitleText\{JOHANNES ITTEN\}\\vspace\{2mm\}\n    \\SectionTitleText\{색채를 체계화한 교육자\}/)
})

test('buildStyleTex uses supplied page geometry instead of A5 defaults', () => {
  const geometry = {
    pageWidthMm: 176,
    pageHeightMm: 250,
    marginTopMm: 16,
    marginBottomMm: 16,
    marginInnerMm: 18,
    marginOuterMm: 14,
    textBoxWidthMm: 144,
    textBoxHeightMm: 218,
  }
  const tex = buildStyleTex({ fontsDir: '/abs/path/assets/fonts', geometry })
  assert.match(tex, /paperwidth=176mm/)
  assert.match(tex, /paperheight=250mm/)
  assert.doesNotMatch(tex, /paperwidth=148mm/)
})