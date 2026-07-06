import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PRESET_DIR = join(__dirname, '..', '..', 'templates', 'pattern-presets')
const PRESET_FILES = ['1-image.json', '2-image.json', '3-4-image.json', '5-6-image.json']

function loadPresets() {
  return PRESET_FILES.map((file) => JSON.parse(readFileSync(join(PRESET_DIR, file), 'utf-8')))
}

export function resolveImageIndices(spec, imageCount) {
  if (spec === 'all') return Array.from({ length: imageCount }, (_, i) => i)
  if (Array.isArray(spec)) return spec
  throw new Error(`잘못된 imageIndices 지정: ${JSON.stringify(spec)}`)
}

export function getCandidatePattern(imageCount, candidate, presets = loadPresets()) {
  const preset = presets.find((p) => imageCount >= p.imageCountMin && imageCount <= p.imageCountMax)
  if (!preset) throw new Error(`이미지 개수(${imageCount})에 맞는 패턴을 찾을 수 없습니다`)
  const pattern = preset.candidates[candidate]
  if (!pattern) throw new Error(`후보(${candidate})에 대한 패턴이 없습니다`)
  return { ...pattern, overflowPageType: preset.overflowPageType }
}
