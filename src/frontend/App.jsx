import React, { useState } from 'react'

const LAYOUT_TYPE_LABELS = { 'image-first': '이미지 중심', balanced: '균형', 'text-first': '텍스트 중심' }

const T = {
  bg: '#F4F4F4', surface: '#FFFFFF', border: '#E0E0E0', muted: '#8C8C8C',
  ink: '#1A1A1A', code: '#EFEFEF', tagBg: '#E8E8E8',
  mono: "'JetBrains Mono','Fira Code',monospace", sans: 'system-ui,-apple-system,sans-serif',
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: 6,
  padding: '8px 10px', fontSize: 13, lineHeight: 1.5, color: T.ink, background: T.surface,
}
const primaryBtn = {
  border: 'none', borderRadius: 5, background: T.ink, color: '#fff', padding: '9px 14px',
  fontSize: 12, fontWeight: 700, cursor: 'pointer',
}
const groupTitle = { fontSize: 11, fontWeight: 700, color: T.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }
const fieldWrapper = { marginBottom: 16 }

const selectStyle = {
  border: `1px solid ${T.border}`, borderRadius: 6, padding: '7px 8px', fontSize: 13, color: T.ink, background: T.surface,
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
  const [marginPreset, setMarginPreset] = useState('recommended')
  const [columns, setColumns] = useState('4')
  const [gridMode, setGridMode] = useState('flexible')

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
    setImages(Array.from(e.target.files).slice(0, 6))
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
      page_size: pageSize, margin_preset: marginPreset, columns: Number(columns), grid_mode: gridMode,
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
      <header style={{ height: 48, display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px', borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Imprint</span>
        <span style={{ fontSize: 13, fontWeight: 500, color: T.muted }}>(Image+Text)</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: T.muted, whiteSpace: 'nowrap' }}>Anthropic API 키</span>
        <input
          type="password"
          value={apiKey}
          onChange={handleApiKeyChange}
          placeholder="sk-ant-... (선택, 비우면 규칙 기반)"
          style={{
            width: 260, boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: 5,
            padding: '5px 8px', fontSize: 12, color: T.ink, background: T.bg,
          }}
        />
      </header>

      <div style={{ maxWidth: 720, margin: '32px auto', padding: '0 24px' }}>
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: 20 }}>
          <p style={{ fontSize: 12, color: T.muted, marginTop: 0 }}>이미지 1~6장과 본문 텍스트를 넣으면, 입력 조건을 분석해 가장 적합한 편집디자인 레이아웃 1개를 만듭니다.</p>

          <div style={fieldWrapper}>
            <div style={groupTitle}>이미지 (최대 6장)</div>
            <input type="file" accept="image/*" multiple onChange={handleImageChange} />
            <p style={{ fontSize: 12, color: T.muted }}>{images.length}장 선택됨</p>
          </div>

          <div style={fieldWrapper}>
            <div style={groupTitle}>제목 (선택)</div>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
            <p style={{ fontSize: 12, color: T.muted }}>제목을 넣으면 섹션 오프너 페이지가 추가됩니다. 비워두면 본문 레이아웃만 생성됩니다.</p>
          </div>

          <div style={fieldWrapper}>
            <div style={groupTitle}>본문 텍스트</div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} style={inputStyle} />
            <p style={{ fontSize: 12, color: T.muted }}>빈 줄로 구분하면 문단별로 나뉘어 배치됩니다.</p>
          </div>

          <div style={fieldWrapper}>
            <div style={groupTitle}>판형 · 그리드 설정</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
              <select value={pageSize} onChange={(e) => setPageSize(e.target.value)} style={selectStyle}>
                <option value="A5">A5</option>
                <option value="A4">A4</option>
                <option value="B5">B5</option>
              </select>
              <select value={marginPreset} onChange={(e) => setMarginPreset(e.target.value)} style={selectStyle}>
                <option value="recommended">여백: 권장</option>
                <option value="narrow">여백: 좁게</option>
                <option value="wide">여백: 넓게</option>
              </select>
              <select value={columns} onChange={(e) => setColumns(e.target.value)} style={selectStyle}>
                <option value="2">2단</option>
                <option value="3">3단</option>
                <option value="4">4단</option>
                <option value="6">6단</option>
              </select>
              <select value={gridMode} onChange={(e) => setGridMode(e.target.value)} style={selectStyle}>
                <option value="strict">엄격한 그리드</option>
                <option value="flexible">유연한 그리드</option>
              </select>
            </div>
            <p style={{ fontSize: 12, color: T.muted }}>행 수·거터·텍스트 흐름 방식·이미지 배치는 이 설정을 바탕으로 자동 결정됩니다.</p>
          </div>

          <button type="button" onClick={handleGenerate} disabled={status === 'generating'} style={primaryBtn}>
            {status === 'generating' ? '생성 중...' : 'Generate'}
          </button>

          {error && <p style={{ fontSize: 12, color: '#B00020', lineHeight: 1.5 }}>{error}</p>}
        </div>

        {result && (
          <div style={{ marginTop: 20 }}>
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: 16 }}>
              <div style={groupTitle}>
                최적 레이아웃 — {LAYOUT_TYPE_LABELS[result.layoutFamily] || result.layoutFamily}
              </div>
              <p style={{ fontSize: 11, fontFamily: T.mono, color: T.muted }}>
                스타일: {result.style} · outputs/{result.runId}/
              </p>
              {result.reason && <p style={{ fontSize: 12, color: T.muted }}>선택 이유: {result.reason}</p>}
              {result.compileOk ? (
                <p style={{ fontSize: 13 }}>
                  <a href={result.pagesPdf} target="_blank" rel="noreferrer">낱장 PDF 열기</a>
                  {' | '}
                  <a href={result.spreadPdf} target="_blank" rel="noreferrer">스프레드 미리보기 열기</a>
                </p>
              ) : (
                <p style={{ fontSize: 12, color: '#B00020' }}>컴파일 실패 — 로그를 확인하세요.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
