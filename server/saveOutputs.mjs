import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'

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
  mkdirSync(join(runDir, 'input', 'images'), { recursive: true })
  return { runId, runDir }
}

export function saveInputCopies(runDir, { imagePaths, text }) {
  const imageNames = imagePaths.map((p) => basename(p))
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
