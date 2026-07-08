import { readFileSync } from 'node:fs'
import imageSize from 'image-size'

// ratio >= 1.2: landscape; 0.85 <= ratio < 1.2: square; ratio < 0.85: portrait (spec section 6).
export function orientationFromRatio(ratio) {
  if (ratio >= 1.2) return 'landscape'
  if (ratio >= 0.85) return 'square'
  return 'portrait'
}

export function analyzeInput({ imagePaths, text }) {
  if (!Array.isArray(imagePaths) || imagePaths.length < 1 || imagePaths.length > 6) {
    throw new Error(`이미지는 1~6장이어야 합니다 (받은 개수: ${imagePaths?.length ?? 0})`)
  }

  const images = imagePaths.map((path) => {
    const buffer = readFileSync(path)
    const dim = imageSize(buffer)
    if (!dim.width || !dim.height) {
      throw new Error(`이미지 크기를 읽을 수 없습니다: ${path}`)
    }
    const aspectRatio = dim.width / dim.height
    return {
      path,
      width: dim.width,
      height: dim.height,
      aspectRatio,
      orientation: orientationFromRatio(aspectRatio),
    }
  })

  return {
    imageCount: images.length,
    images,
    textLength: text.length,
    textLengthNoSpaces: text.replace(/\s/g, '').length,
  }
}
