const STYLE_IMAGE_SCALE = {
  Editorial: 0.85,
  Magazine: 1.0,
  'Exhibition Catalog': 1.15,
}

export function scaleImageHeight(baseHeightMm, style) {
  const scale = STYLE_IMAGE_SCALE[style] ?? 1.0
  return Math.round(baseHeightMm * scale * 10) / 10
}
