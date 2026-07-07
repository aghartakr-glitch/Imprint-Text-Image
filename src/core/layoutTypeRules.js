import { textDensityFromLength } from './textDensity.js'

// Deterministic fallback used when the LLM is unavailable or its response fails validation.
// The source table (given informally, with overlapping ranges) is resolved here as an ordered
// if-chain from most specific to most general, so every input maps to exactly one layout type.
export function selectLayoutTypeByRules({ imageCount, textLength }) {
  const density = textDensityFromLength(textLength)

  if (imageCount === 1) {
    return density === 'short' ? 'image-first' : 'text-first'
  }
  if (imageCount >= 2 && imageCount <= 3 && density === 'short') {
    return 'image-first'
  }
  if (imageCount >= 2 && imageCount <= 4 && density === 'medium') {
    return 'balanced'
  }
  if (imageCount >= 5 && imageCount <= 6 && density === 'long') {
    return 'balanced'
  }
  if (density === 'long') {
    return 'text-first'
  }
  // imageCount 3~6 with short/medium text not already covered above
  return 'balanced'
}
