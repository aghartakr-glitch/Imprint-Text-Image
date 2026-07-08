// Spec section 13.4: pick the highest-scoring scored candidate, breaking ties in this order.
// `scoredCandidates` items look like: { candidateId, plan, resolvedPages, validation,
// refinements, qualityScore, repaired }.
export function selectBestLayout(scoredCandidates) {
  if (scoredCandidates.length === 0) {
    throw new Error('선택할 후보가 없습니다')
  }

  const sorted = [...scoredCandidates].sort((a, b) => {
    const scoreDiff = b.qualityScore.total - a.qualityScore.total
    if (Math.abs(scoreDiff) > 1e-9) return scoreDiff

    // Same score: prefer no repair, then better text capacity, then better visual balance.
    if (a.repaired !== b.repaired) return a.repaired ? 1 : -1
    const capacityDiff = (b.qualityScore.readability ?? 0) - (a.qualityScore.readability ?? 0)
    if (Math.abs(capacityDiff) > 1e-9) return capacityDiff
    const balanceDiff = (b.qualityScore.visual_balance ?? 0) - (a.qualityScore.visual_balance ?? 0)
    return balanceDiff
  })

  return { selected: sorted[0], ranked: sorted }
}
