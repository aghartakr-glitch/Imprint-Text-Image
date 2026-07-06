const ROW_LAYOUTS = {
  1: [1],
  2: [2],
  3: [3],
  4: [2, 2],
  5: [3, 2],
  6: [3, 3],
}

export function computeGridBoxes(count, boundingBox, gapMm = 4) {
  const rows = ROW_LAYOUTS[count]
  if (!rows) throw new Error(`지원하지 않는 이미지 개수: ${count}`)

  const { xMm, yMm, wMm, hMm } = boundingBox
  const rowCount = rows.length
  const rowHeightMm = (hMm - gapMm * (rowCount - 1)) / rowCount

  const boxes = []
  rows.forEach((colCount, rowIndex) => {
    const rowY = yMm + rowIndex * (rowHeightMm + gapMm)
    const colWidthMm = (wMm - gapMm * (colCount - 1)) / colCount
    for (let col = 0; col < colCount; col += 1) {
      boxes.push({
        xMm: xMm + col * (colWidthMm + gapMm),
        yMm: rowY,
        wMm: colWidthMm,
        hMm: rowHeightMm,
      })
    }
  })
  return boxes
}
