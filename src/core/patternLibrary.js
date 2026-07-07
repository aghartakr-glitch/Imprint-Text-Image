import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PRESET_DIR = join(__dirname, '..', '..', 'templates', 'pattern-presets')
const PRESET_FILES = ['1-image.json', '2-image.json', '3-4-image.json', '5-6-image.json']

function loadPresets() {
  return PRESET_FILES.map((file) => JSON.parse(readFileSync(join(PRESET_DIR, file), 'utf-8')))
}

const PRESETS = loadPresets()

export function resolveImageIndices(spec, imageCount) {
  if (spec === 'all') return Array.from({ length: imageCount }, (_, i) => i)
  if (Array.isArray(spec)) return spec
  throw new Error(`잘못된 imageIndices 지정: ${JSON.stringify(spec)}`)
}

function findBucket(imageCount, presets) {
  const preset = presets.find((p) => imageCount >= p.imageCountMin && imageCount <= p.imageCountMax)
  if (!preset) throw new Error(`이미지 개수(${imageCount})에 맞는 패턴을 찾을 수 없습니다`)
  return preset
}

// The 3 pattern variants (image-first/balanced/text-first) for a given image count, presented
// as options for the LLM (or the rule-based fallback) to choose exactly one from — never all 3.
export function getAvailablePatterns(imageCount, presets = PRESETS) {
  const preset = findBucket(imageCount, presets)
  return Object.values(preset.candidates).map((c) => ({ patternId: c.patternId, layoutType: c.layoutType }))
}

export function getPatternById(imageCount, patternId, presets = PRESETS) {
  const preset = findBucket(imageCount, presets)
  const pattern = Object.values(preset.candidates).find((c) => c.patternId === patternId)
  if (!pattern) throw new Error(`패턴을 찾을 수 없습니다: ${patternId}`)
  return { ...pattern, overflowPageType: preset.overflowPageType }
}
