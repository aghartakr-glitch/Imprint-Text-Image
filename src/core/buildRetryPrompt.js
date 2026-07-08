// Spec section 17: a specific, literal retry template (not a vague "try again") -- the LLM gets
// the original input, its own failed output, and the exact validation errors to fix.
const FIXED_CONSTRAINTS_TEXT = `- A5 portrait
- fixed margins
- 6 columns x 12 rows grid
- body font size 9pt
- body leading 14pt
- image fit contain
- no captions
- no text overlay
- no image distortion
- body overflow continues to next page`

const CORRECTION_REQUIREMENTS_TEXT = `- All elements must stay inside the page grid.
- No text box may overlap any image box.
- All uploaded images must be placed exactly once unless a logged reason is provided.
- Body text box must exist.
- Do not reduce body text size or leading.
- Do not summarize or delete body text.`

export function buildRetryPrompt({ inputMetadata, failedLayoutPlan, validationErrors }) {
  return `Your previous layout_plan failed validation.

Original input metadata:
${JSON.stringify(inputMetadata)}

Previous layout_plan:
${JSON.stringify(failedLayoutPlan)}

Validation errors:
${JSON.stringify(validationErrors)}

You must regenerate the layout_plan while keeping all fixed constraints:
${FIXED_CONSTRAINTS_TEXT}

Correction requirements:
${CORRECTION_REQUIREMENTS_TEXT}

Return corrected JSON only.
Do not explain outside JSON.`
}
