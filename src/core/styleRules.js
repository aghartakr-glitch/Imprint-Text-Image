export function inferStyleByRules({ imageCount, textLength }) {
  if (imageCount <= 2 && textLength >= 2000) {
    return { style: 'Editorial', reason: '이미지 수가 적고 본문이 길어 텍스트 중심 판형이 적합' }
  }
  if (imageCount >= 4) {
    return { style: 'Magazine', reason: '이미지 수가 많아 리듬감 있는 배치가 적합' }
  }
  return { style: 'Exhibition Catalog', reason: '이미지가 크게 쓰이는 도록형 인상이 적합' }
}
