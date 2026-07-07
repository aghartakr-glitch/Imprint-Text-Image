import React, { useState } from 'react'

const CANDIDATE_LABELS = { A: '이미지 중심', B: '균형', C: '텍스트 중심' }

export default function App() {
  const [images, setImages] = useState([])
  const [text, setText] = useState('')
  const [status, setStatus] = useState('idle')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

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
    form.append('text', text)

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
    <div style={{ maxWidth: 720, margin: '2rem auto', fontFamily: 'sans-serif' }}>
      <h1>Imprint(Image+Text)</h1>
      <p>이미지 1~6장과 본문 텍스트를 넣으면 편집디자인형 스프레드 후보 3종을 만듭니다.</p>

      <div style={{ marginBottom: '1rem' }}>
        <label>
          이미지 (최대 6장)
          <input type="file" accept="image/*" multiple onChange={handleImageChange} />
        </label>
        <p>{images.length}장 선택됨</p>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label>
          본문 텍스트
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} style={{ width: '100%' }} />
        </label>
      </div>

      <button type="button" onClick={handleGenerate} disabled={status === 'generating'}>
        {status === 'generating' ? '생성 중...' : 'Generate'}
      </button>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {result && (
        <div style={{ marginTop: '2rem' }}>
          <p>추정 스타일: {result.style}</p>
          <p>결과 폴더: outputs/{result.runId}/</p>
          {Object.entries(result.candidates).map(([key, cand]) => (
            <div key={key} style={{ marginBottom: '1.5rem' }}>
              <h2>Candidate {key} — {CANDIDATE_LABELS[key]}</h2>
              {cand.ok === false ? (
                <p style={{ color: 'red' }}>생성 실패: {cand.error}</p>
              ) : cand.compileOk ? (
                <p>
                  <a href={cand.pagesPdf} target="_blank" rel="noreferrer">낱장 PDF 열기</a>
                  {' | '}
                  <a href={cand.spreadPdf} target="_blank" rel="noreferrer">스프레드 미리보기 열기</a>
                </p>
              ) : (
                <p style={{ color: 'red' }}>컴파일 실패 — 로그를 확인하세요.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
