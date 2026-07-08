// Spec section 4.2 default rules for deciding single_page vs spread before layout planning.
// An explicit user request (via preferred_output_unit) always wins over the heuristic.
export function decideOutputUnit({ imageCount, textDensity, preferredOutputUnit }) {
  if (preferredOutputUnit === 'single_page' || preferredOutputUnit === 'spread') {
    return { outputUnit: preferredOutputUnit, source: 'user_control' }
  }

  if (imageCount >= 3) {
    return { outputUnit: 'spread', source: 'rule:image_count>=3' }
  }
  if (textDensity === 'medium' || textDensity === 'long') {
    return { outputUnit: 'spread', source: 'rule:text_density' }
  }
  // imageCount is 1-2 and textDensity is short
  return { outputUnit: 'single_page', source: 'rule:default' }
}
