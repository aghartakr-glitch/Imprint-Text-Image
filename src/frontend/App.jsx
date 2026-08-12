import React, { useState } from 'react'
import { T, FS, GLOBAL_CSS } from './theme.js'

// All user-facing UI chrome text lives here so the KOR/ENG toggle only has one place to touch --
// content the user actually types (title/body/running head) is never translated, only labels,
// buttons, hints, and messages.
const STRINGS = {
  ko: {
    apiKeyLabel: 'Anthropic API 키',
    apiKeyPlaceholder: 'sk-ant-... (선택, 비우면 규칙 기반)',
    heading: '새 레이아웃 만들기',
    subheading: '이미지와 본문 텍스트를 넣으면 편집디자인 레이아웃을 자동으로 생성합니다.',
    imagesLabel: '이미지',
    addImages: '이미지 추가',
    imagesCount: (n) => `${n}장 선택됨 — 다시 선택하면 기존 목록에 추가됩니다.`,
    imagesHint: '체크한 이미지만 풀페이지로 강제됩니다. image_1, 2, 3... 순서로 배치에 사용되니 순서가 다르면 제거 후 원하는 순서로 다시 추가하세요.',
    titleLabel: '제목 (선택)',
    bodyLabel: '본문 텍스트',
    runningHeadLabel: '면주 (반복 상단 텍스트, 선택)',
    runningHeadPlaceholder: '예: 2026/2027    TREND REPORT',
    gridLabel: '판형 · 그리드 설정',
    pageSizeOptions: { A5: 'A5', A4: 'A4', B5: 'B5' },
    columnsOptions: { 1: '1단', 2: '2단', 3: '3단', 4: '4단', 5: '5단', 6: '6단' },
    gridModeOptions: { strict: '엄격한 그리드', flexible: '유연한 그리드' },
    generate: 'Generate',
    generating: '생성 중...',
    errNoImage: '이미지를 1장 이상 선택하세요.',
    errNoText: '본문 텍스트를 입력하세요.',
    errGenerateFailed: '생성에 실패했습니다.',
    bestLayout: '최적 레이아웃 —',
    styleLine: (style, runId) => `스타일: ${style} · outputs/${runId}/`,
    reasonLine: '선택 이유:',
    openPages: '낱장 PDF 열기',
    openSpread: '스프레드 미리보기 열기',
    compileFail: '컴파일 실패 — 로그를 확인하세요.',
    reference: '참고',
    usage: '사용 방법',
    usageItems: [
      '이미지와 본문 텍스트를 넣으면, 입력 조건을 분석해 가장 적합한 편집디자인 레이아웃 1개를 만듭니다.',
      '제목을 넣으면 섹션 오프너 페이지가 추가됩니다. 비워두면 본문 레이아웃만 생성됩니다.',
      '본문 텍스트는 빈 줄로 구분하면 문단별로 나뉘어 배치됩니다.',
      '판형, 단 수를 선택하면 이미지·텍스트가 그 그리드 안에서 각자 정해진 단수(1~n단)로 배치됩니다.',
      '체크한 이미지는 다른 텍스트/이미지 없이 단독으로 페이지 전체를 채웁니다.',
      '면주에 입력한 텍스트는 매 페이지 상단 안쪽에, 쪽번호는 상단 바깥쪽 모서리에 반복해서 들어갑니다.',
    ],
    layoutTypeLabels: { 'image-first': '이미지 중심', balanced: '균형', 'text-first': '텍스트 중심' },
  },
  en: {
    apiKeyLabel: 'Anthropic API key',
    apiKeyPlaceholder: 'sk-ant-... (optional, falls back to rule-based)',
    heading: 'Create a new layout',
    subheading: 'Add images and body text to automatically generate an editorial layout.',
    imagesLabel: 'Images',
    addImages: 'Add images',
    imagesCount: (n) => `${n} selected — picking again adds to the existing list.`,
    imagesHint: 'Only checked images are forced full-page. They’re used in order as image_1, 2, 3… — remove and re-add to reorder.',
    titleLabel: 'Title (optional)',
    bodyLabel: 'Body text',
    runningHeadLabel: 'Running head (repeats on every page, optional)',
    runningHeadPlaceholder: 'e.g. 2026/2027    TREND REPORT',
    gridLabel: 'Page size · grid settings',
    pageSizeOptions: { A5: 'A5', A4: 'A4', B5: 'B5' },
    columnsOptions: { 1: '1 col', 2: '2 col', 3: '3 col', 4: '4 col', 5: '5 col', 6: '6 col' },
    gridModeOptions: { strict: 'Strict grid', flexible: 'Flexible grid' },
    generate: 'Generate',
    generating: 'Generating...',
    errNoImage: 'Select at least one image.',
    errNoText: 'Enter body text.',
    errGenerateFailed: 'Generation failed.',
    bestLayout: 'Best layout —',
    styleLine: (style, runId) => `Style: ${style} · outputs/${runId}/`,
    reasonLine: 'Why this layout:',
    openPages: 'Open single pages PDF',
    openSpread: 'Open spread preview',
    compileFail: 'Compile failed — check the logs.',
    reference: 'Reference',
    usage: 'How to use',
    usageItems: [
      'Add images and body text; the input is analyzed to produce the single best-fitting editorial layout.',
      'A title adds a section-opener page. Leave it blank to generate only the body layout.',
      'Body text separated by blank lines is split and placed paragraph by paragraph.',
      'Choose a page size and column count and images/text are placed within that grid, each with its own span (1–n columns).',
      'A checked image fills the entire page on its own, with no other text or image.',
      'Running head text repeats on the inner top edge of every page; the page number repeats on the outer top corner.',
    ],
    layoutTypeLabels: { 'image-first': 'Image-first', balanced: 'Balanced', 'text-first': 'Text-first' },
  },
}

// Icons are stroke-only, single-weight (1.6), matching the geometric/editorial feel of 42dot Sans
// rather than a filled glyph pack that would read as a generic web-app icon set.
function ImageIcon({ color, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  )
}
function TrashIcon({ color, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
    </svg>
  )
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: 8,
  padding: '8px 10px', fontSize: FS.base, lineHeight: 1.5, color: T.ink, background: T.surface,
}
const primaryBtn = {
  border: 'none', borderRadius: 8, background: T.accent, color: '#fff', padding: '11px 18px',
  fontSize: FS.base, fontWeight: 700, cursor: 'pointer',
}
// Eyebrow-tier field label -- deliberately the SMALLEST tier (FS.xs) so it recedes behind the
// field's own content and the card's FS.lg heading below establishes real top-of-hierarchy
// contrast (previously every label/value in the form sat within 1-2px of each other).
const groupTitle = { fontSize: FS.xs, fontWeight: 700, color: T.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 }
const fieldWrapper = { marginBottom: 18 }

const selectStyle = {
  border: `1px solid ${T.border}`, borderRadius: 8, padding: '7px 8px', fontSize: FS.base, color: T.ink, background: T.surface,
}
const dropzoneStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
  border: `1.5px dashed ${T.border}`, borderRadius: 8, padding: '10px 16px',
  fontSize: FS.sm, fontWeight: 600, color: T.muted, background: T.bg,
}

export default function App() {
  const [lang, setLang] = useState(localStorage.getItem('imprint_lang') || 'ko')
  const s = STRINGS[lang]
  const [apiKey, setApiKey] = useState(localStorage.getItem('anthropic_api_key') || '')
  const [images, setImages] = useState([])
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [status, setStatus] = useState('idle')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [pageSize, setPageSize] = useState('A5')
  const [columns, setColumns] = useState('4')
  const [gridMode, setGridMode] = useState('flexible')
  const [forcedFullBleedIndices, setForcedFullBleedIndices] = useState(new Set())
  const [runningHeadText, setRunningHeadText] = useState('')

  function handleLangChange(next) {
    setLang(next)
    localStorage.setItem('imprint_lang', next)
  }

  function handleApiKeyChange(e) {
    const newKey = e.target.value
    setApiKey(newKey)
    if (newKey) {
      localStorage.setItem('anthropic_api_key', newKey)
    } else {
      localStorage.removeItem('anthropic_api_key')
    }
  }

  function handleImageChange(e) {
    // Was setImages(Array.from(e.target.files)) -- a plain <input multiple> replaces its whole
    // FileList on every pick, and the browser's native picker returns files sorted by name in the
    // folder view, not by click order. Together that meant every re-selection wiped out images
    // already added and reordered everything alphabetically regardless of what the user actually
    // clicked. Append instead, so picking again adds to the existing set (still in that pick's own
    // name-sorted order -- a real per-file drag reorder is a separate feature) and the user can
    // build up the set across multiple picks.
    const newFiles = Array.from(e.target.files)
    setImages((prev) => [...prev, ...newFiles])
    e.target.value = ''
  }

  function removeImage(index) {
    setImages((prev) => prev.filter((_, i) => i !== index))
    setForcedFullBleedIndices((prev) => {
      const next = new Set()
      prev.forEach((i) => {
        if (i < index) next.add(i)
        else if (i > index) next.add(i - 1)
      })
      return next
    })
  }

  function toggleForcedFullBleed(index) {
    setForcedFullBleedIndices((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function handleGenerate() {
    if (images.length < 1) {
      setError(s.errNoImage)
      return
    }
    if (!text.trim()) {
      setError(s.errNoText)
      return
    }
    setError(null)
    setStatus('generating')
    setResult(null)

    const form = new FormData()
    images.forEach((file) => form.append('images', file))
    form.append('title', title)
    form.append('text', text)
    if (apiKey) form.append('apiKey', apiKey)
    form.append('userLayoutSettings', JSON.stringify({
      page_size: pageSize, columns: Number(columns), grid_mode: gridMode,
      forced_full_bleed_images: [...forcedFullBleedIndices].map((i) => i + 1),
      allow_unforced_full_bleed: false,
      running_head_text: runningHeadText,
    }))

    try {
      const response = await fetch('/api/generate', { method: 'POST', body: form })
      const body = await response.json()
      if (!body.ok) {
        setError(body.error || s.errGenerateFailed)
        setStatus('idle')
        return
      }
      setResult(body)
      setStatus('done')
    } catch (err) {
      setError(String(err.message || err))
      setStatus('idle')
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: T.bg, fontFamily: T.sans, color: T.ink }}>
      <style>{GLOBAL_CSS}</style>
      <style>{`
        .dropzone:hover { border-color: ${T.accent} !important; color: ${T.accent} !important; background: #FFF5F0 !important; }
        .dropzone:hover svg { stroke: ${T.accent} !important; }
        .remove-btn:hover svg { stroke: ${T.error} !important; }
      `}</style>
      <header style={{ height: 48, display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px', borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <span style={{ fontSize: FS.md, fontWeight: 800, letterSpacing: -0.2 }}>Imprint</span>
        <span style={{ fontSize: FS.sm, fontWeight: 500, color: T.muted }}>(Image+Text)</span>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => handleLangChange('ko')}
            style={{
              border: 'none', cursor: 'pointer', padding: '5px 10px', fontSize: FS.xs, fontWeight: 700,
              background: lang === 'ko' ? T.accent : T.surface, color: lang === 'ko' ? '#fff' : T.muted,
            }}
          >
            KOR
          </button>
          <button
            type="button"
            onClick={() => handleLangChange('en')}
            style={{
              border: 'none', cursor: 'pointer', padding: '5px 10px', fontSize: FS.xs, fontWeight: 700,
              background: lang === 'en' ? T.accent : T.surface, color: lang === 'en' ? '#fff' : T.muted,
            }}
          >
            ENG
          </button>
        </div>
        <span style={{ fontSize: FS.xs, color: T.muted, whiteSpace: 'nowrap' }}>{s.apiKeyLabel}</span>
        <input
          type="password"
          value={apiKey}
          onChange={handleApiKeyChange}
          placeholder={s.apiKeyPlaceholder}
          style={{
            width: 260, boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: 8,
            padding: '5px 8px', fontSize: FS.xs, color: T.ink, background: T.bg,
          }}
        />
      </header>

      <div style={{ maxWidth: 720, margin: '32px auto', padding: '0 24px' }}>
        <div style={{ background: T.surface, borderRadius: 12, padding: 24, boxShadow: '0 1px 2px rgba(17,17,17,0.04), 0 4px 16px rgba(17,17,17,0.06)' }}>
          <h1 style={{ fontSize: FS.lg, fontWeight: 800, letterSpacing: -0.3, margin: '0 0 2px' }}>{s.heading}</h1>
          <p style={{ fontSize: FS.sm, color: T.muted, margin: '0 0 22px' }}>{s.subheading}</p>

          <div style={fieldWrapper}>
            <div style={groupTitle}>{s.imagesLabel}</div>
            <label className="dropzone" style={dropzoneStyle}>
              <input type="file" accept="image/*" multiple onChange={handleImageChange} style={{ display: 'none' }} />
              <ImageIcon color={T.muted} />
              {s.addImages}
            </label>
            <p style={{ fontSize: FS.xs, color: T.muted, marginTop: 8 }}>{s.imagesCount(images.length)}</p>
            {images.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <p style={{ fontSize: FS.xs, color: T.muted, margin: '0 0 2px' }}>{s.imagesHint}</p>
                {images.map((file, i) => (
                  <div key={`${file.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: FS.sm, color: T.ink }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                      <input
                        type="checkbox"
                        checked={forcedFullBleedIndices.has(i)}
                        onChange={() => toggleForcedFullBleed(i)}
                      />
                      image_{i + 1} — {file.name}
                    </label>
                    <button
                      type="button"
                      className="remove-btn"
                      onClick={() => removeImage(i)}
                      style={{ display: 'flex', alignItems: 'center', border: 'none', background: 'none', cursor: 'pointer', padding: '2px 6px' }}
                    >
                      <TrashIcon color={T.muted} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={fieldWrapper}>
            <div style={groupTitle}>{s.titleLabel}</div>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
          </div>

          <div style={fieldWrapper}>
            <div style={groupTitle}>{s.bodyLabel}</div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} style={inputStyle} />
          </div>

          <div style={fieldWrapper}>
            <div style={groupTitle}>{s.runningHeadLabel}</div>
            <input
              type="text"
              value={runningHeadText}
              onChange={(e) => setRunningHeadText(e.target.value)}
              placeholder={s.runningHeadPlaceholder}
              style={inputStyle}
            />
          </div>

          <div style={fieldWrapper}>
            <div style={groupTitle}>{s.gridLabel}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <select value={pageSize} onChange={(e) => setPageSize(e.target.value)} style={selectStyle}>
                {Object.entries(s.pageSizeOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select value={columns} onChange={(e) => setColumns(e.target.value)} style={selectStyle}>
                {Object.entries(s.columnsOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select value={gridMode} onChange={(e) => setGridMode(e.target.value)} style={selectStyle}>
                {Object.entries(s.gridModeOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </div>


          <button type="button" onClick={handleGenerate} disabled={status === 'generating'} style={primaryBtn}>
            {status === 'generating' ? s.generating : s.generate}
          </button>

          {error && <p style={{ fontSize: FS.sm, color: T.error, lineHeight: 1.5, marginTop: 14 }}>{error}</p>}
        </div>

        {result && (
          <div style={{ marginTop: 16 }}>
            <div style={{ background: T.surface, borderLeft: `3px solid ${T.accent}`, borderRadius: 8, padding: 16, boxShadow: '0 1px 2px rgba(17,17,17,0.04)' }}>
              <div style={groupTitle}>
                {s.bestLayout} {s.layoutTypeLabels[result.layoutFamily] || result.layoutFamily}
              </div>
              <p style={{ fontSize: FS.xs, fontFamily: T.mono, color: T.muted }}>
                {s.styleLine(result.style, result.runId)}
              </p>
              {result.reason && <p style={{ fontSize: FS.sm, color: T.muted }}>{s.reasonLine} {result.reason}</p>}
              {result.bestEffortUsed && (
                <p style={{ fontSize: FS.sm, color: T.warning, background: '#FFF8E1', padding: '8px 10px', borderRadius: 8 }}>
                  ⚠️ {result.bestEffortWarning}
                </p>
              )}
              {result.compileOk ? (
                <p style={{ fontSize: FS.base }}>
                  <a href={result.pagesPdf} target="_blank" rel="noreferrer">{s.openPages}</a>
                  {' | '}
                  <a href={result.spreadPdf} target="_blank" rel="noreferrer">{s.openSpread}</a>
                </p>
              ) : (
                <p style={{ fontSize: FS.sm, color: T.error }}>{s.compileFail}</p>
              )}
            </div>
          </div>
        )}

        <div style={{ marginTop: 16, background: T.code, borderRadius: 8, padding: 20 }}>
          <div style={groupTitle}>{s.reference}</div>

          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: FS.sm, fontWeight: 700, color: T.ink, margin: '0 0 4px' }}>{s.usage}</p>
            <ul style={{ fontSize: FS.xs, color: T.muted, lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
              {s.usageItems.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
