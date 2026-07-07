export const TEXT_DENSITY_SHORT_MAX = 1200
export const TEXT_DENSITY_MEDIUM_MAX = 3500

export function textDensityFromLength(textLength) {
  if (textLength <= TEXT_DENSITY_SHORT_MAX) return 'short'
  if (textLength <= TEXT_DENSITY_MEDIUM_MAX) return 'medium'
  return 'long'
}
