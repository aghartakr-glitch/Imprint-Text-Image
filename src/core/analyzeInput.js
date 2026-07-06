import { readFileSync } from 'node:fs'
import imageSize from 'image-size'

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
    return {
      path,
      width: dim.width,
      height: dim.height,
      aspectRatio: dim.width / dim.height,
    }
  })

  return {
    imageCount: images.length,
    images,
    textLength: text.length,
    textLengthNoSpaces: text.replace(/\s/g, '').length,
  }
}
