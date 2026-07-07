import { mkdirSync, copyFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, basename, extname } from 'node:path'

function timestampFolderName(date = new Date(), seq = 1) {
  const pad = (n) => String(n).padStart(2, '0')
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const hh = pad(date.getHours())
  const mm = pad(date.getMinutes())
  return `${y}-${m}-${d}_${hh}${mm}_${String(seq).padStart(3, '0')}`
}

export function createRunFolder(outputsRoot, { date, seq } = {}) {
  const runId = timestampFolderName(date, seq)
  const runDir = join(outputsRoot, runId)
  if (existsSync(runDir)) {
    throw new Error(`이미 존재하는 결과 폴더입니다(seq 충돌 가능성): ${runDir}`)
  }
  mkdirSync(join(runDir, 'input', 'images'), { recursive: true })
  return { runId, runDir }
}

function dedupeName(name, usedNames) {
  if (!usedNames.has(name)) return name
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let n = 2
  let candidate = `${stem}-${n}${ext}`
  while (usedNames.has(candidate)) {
    n += 1
    candidate = `${stem}-${n}${ext}`
  }
  return candidate
}

export function saveInputCopies(runDir, { imagePaths, text }) {
  const usedNames = new Set()
  const imageNames = imagePaths.map((p) => {
    const name = dedupeName(basename(p), usedNames)
    usedNames.add(name)
    return name
  })
  imagePaths.forEach((p, i) => {
    copyFileSync(p, join(runDir, 'input', 'images', imageNames[i]))
  })
  writeFileSync(join(runDir, 'input', 'input-text.txt'), text, 'utf-8')
  return { imageNames }
}

const CANDIDATE_FOLDER_NAMES = {
  A: 'candidate-a_image-first',
  B: 'candidate-b_balanced',
  C: 'candidate-c_text-first',
}

export function candidateFolderName(candidate) {
  const name = CANDIDATE_FOLDER_NAMES[candidate]
  if (!name) throw new Error(`알 수 없는 후보: ${candidate}`)
  return name
}

export function writeCandidateSources(runDir, candidate, { mainTex, styleTex, layout }) {
  const dir = join(runDir, candidateFolderName(candidate))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'main.tex'), mainTex, 'utf-8')
  writeFileSync(join(dir, 'page_style.sty'), styleTex, 'utf-8')
  writeFileSync(join(dir, 'layout.json'), JSON.stringify(layout, null, 2), 'utf-8')
  return dir
}

export function writeGenerationLog(runDir, log) {
  writeFileSync(join(runDir, 'generation-log.json'), JSON.stringify(log, null, 2), 'utf-8')
}
