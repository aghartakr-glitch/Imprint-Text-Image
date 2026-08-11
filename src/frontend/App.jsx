import React, { useState } from 'react'
import { T, FS, GLOBAL_CSS } from './theme.js'

const LAYOUT_TYPE_LABELS = { 'image-first': '이미지 중심', balanced: '균형', 'text-first': '텍스트 중심' }

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
      setError('이미지를 1장 이상 선택하세요.')
      return
    }
    if (!text.trim()) {
      setError('본문 텍스트를 입력하세요.')
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
        setError(body.error || '생성에 실패했습니다.')
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
        <span style={{ fontSize: FS.xs, color: T.muted, whiteSpace: 'nowrap' }}>Anthropic API 키</span>
        <input
          type="password"
          value={apiKey}
          onChange={handleApiKeyChange}
          placeholder="sk-ant-... (선택, 비우면 규칙 기반)"
          style={{
            width: 260, boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: 8,
            padding: '5px 8px', fontSize: FS.xs, color: T.ink, background: T.bg,
          }}
        />
      </header>

      <div style={{ maxWidth: 720, margin: '32px auto', padding: '0 24px' }}>
        <div style={{ background: T.surface, borderRadius: 12, padding: 24, boxShadow: '0 1px 2px rgba(17,17,17,0.04), 0 4px 16px rgba(17,17,17,0.06)' }}>
          <h1 style={{ fontSize: FS.lg, fontWeight: 800, letterSpacing: -0.3, margin: '0 0 2px' }}>새 레이아웃 만들기</h1>
          <p style={{ fontSize: FS.sm, color: T.muted, margin: '0 0 22px' }}>이미지와 본문 텍스트를 넣으면 편집디자인 레이아웃을 자동으로 생성합니다.</p>

          <div style={fieldWrapper}>
            <div style={groupTitle}>이미지</div>
            <label className="dropzone" style={dropzoneStyle}>
              <input type="file" accept="image/*" multiple onChange={handleImageChange} style={{ display: 'none' }} />
              <ImageIcon color={T.muted} />
              이미지 추가
            </label>
            <p style={{ fontSize: FS.xs, color: T.muted, marginTop: 8 }}>{images.length}장 선택됨 — 다시 선택하면 기존 목록에 추가됩니다.</p>
            {images.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <p style={{ fontSize: FS.xs, color: T.muted, margin: '0 0 2px' }}>체크한 이미지만 풀페이지로 강제됩니다. image_1, 2, 3... 순서로 배치에 사용되니 순서가 다르면 제거 후 원하는 순서로 다시 추가하세요.</p>
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
            <div style={groupTitle}>제목 (선택)</div>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
          </div>

          <div style={fieldWrapper}>
            <div style={groupTitle}>본문 텍스트</div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} style={inputStyle} />
          </div>

          <div style={fieldWrapper}>
            <div style={groupTitle}>면주 (반복 상단 텍스트, 선택)</div>
            <input
              type="text"
              value={runningHeadText}
              onChange={(e) => setRunningHeadText(e.target.value)}
              placeholder="예: 2026/2027    TREND REPORT"
              style={inputStyle}
            />
          </div>

          <div style={fieldWrapper}>
            <div style={groupTitle}>판형 · 그리드 설정</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <select value={pageSize} onChange={(e) => setPageSize(e.target.value)} style={selectStyle}>
                <option value="A5">A5</option>
                <option value="A4">A4</option>
                <option value="B5">B5</option>
              </select>
              <select value={columns} onChange={(e) => setColumns(e.target.value)} style={selectStyle}>
                <option value="1">1단</option>
                <option value="2">2단</option>
                <option value="3">3단</option>
                <option value="4">4단</option>
                <option value="5">5단</option>
                <option value="6">6단</option>
              </select>
              <select value={gridMode} onChange={(e) => setGridMode(e.target.value)} style={selectStyle}>
                <option value="strict">엄격한 그리드</option>
                <option value="flexible">유연한 그리드</option>
              </select>
            </div>
          </div>


          <button type="button" onClick={handleGenerate} disabled={status === 'generating'} style={primaryBtn}>
            {status === 'generating' ? '생성 중...' : 'Generate'}
          </button>

          {error && <p style={{ fontSize: FS.sm, color: T.error, lineHeight: 1.5, marginTop: 14 }}>{error}</p>}
        </div>

        {result && (
          <div style={{ marginTop: 16 }}>
            <div style={{ background: T.surface, borderLeft: `3px solid ${T.accent}`, borderRadius: 8, padding: 16, boxShadow: '0 1px 2px rgba(17,17,17,0.04)' }}>
              <div style={groupTitle}>
                최적 레이아웃 — {LAYOUT_TYPE_LABELS[result.layoutFamily] || result.layoutFamily}
              </div>
              <p style={{ fontSize: FS.xs, fontFamily: T.mono, color: T.muted }}>
                스타일: {result.style} · outputs/{result.runId}/
              </p>
              {result.reason && <p style={{ fontSize: FS.sm, color: T.muted }}>선택 이유: {result.reason}</p>}
              {result.bestEffortUsed && (
                <p style={{ fontSize: FS.sm, color: T.warning, background: '#FFF8E1', padding: '8px 10px', borderRadius: 8 }}>
                  ⚠️ {result.bestEffortWarning}
                </p>
              )}
              {result.compileOk ? (
                <p style={{ fontSize: FS.base }}>
                  <a href={result.pagesPdf} target="_blank" rel="noreferrer">낱장 PDF 열기</a>
                  {' | '}
                  <a href={result.spreadPdf} target="_blank" rel="noreferrer">스프레드 미리보기 열기</a>
                </p>
              ) : (
                <p style={{ fontSize: FS.sm, color: T.error }}>컴파일 실패 — 로그를 확인하세요.</p>
              )}
            </div>
          </div>
        )}

        <div style={{ marginTop: 16, background: T.code, borderRadius: 8, padding: 20 }}>
          <div style={groupTitle}>참고</div>

          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: FS.sm, fontWeight: 700, color: T.ink, margin: '0 0 4px' }}>사용 방법</p>
            <ul style={{ fontSize: FS.xs, color: T.muted, lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
              <li>이미지와 본문 텍스트를 넣으면, 입력 조건을 분석해 가장 적합한 편집디자인 레이아웃 1개를 만듭니다.</li>
              <li>제목을 넣으면 섹션 오프너 페이지가 추가됩니다. 비워두면 본문 레이아웃만 생성됩니다.</li>
              <li>본문 텍스트는 빈 줄로 구분하면 문단별로 나뉘어 배치됩니다.</li>
              <li>판형, 단 수를 선택하면 이미지·텍스트가 그 그리드 안에서 각자 정해진 단수(1~n단)로 배치됩니다.</li>
              <li>체크한 이미지는 다른 텍스트/이미지 없이 단독으로 페이지 전체를 채웁니다.</li>
              <li>면주에 입력한 텍스트는 매 페이지 상단 안쪽에, 쪽번호는 상단 바깥쪽 모서리에 반복해서 들어갑니다.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
