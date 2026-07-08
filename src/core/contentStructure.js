// Splits the input into the structured pieces an editorial page actually has (spec section 5).
// This system only collects title + body from the user today (no subtitle/section_label/page
// number input yet), so those report as absent rather than being fabricated.
export function analyzeContentStructure({ title, text }) {
  const hasTitle = typeof title === 'string' && title.trim().length > 0
  const hasBody = typeof text === 'string' && text.trim().length > 0
  return {
    has_title: hasTitle,
    title_length_chars: hasTitle ? title.trim().length : 0,
    has_subtitle: false,
    subtitle_length_chars: 0,
    has_body: hasBody,
    body_length_chars: hasBody ? text.length : 0,
    has_section_label: false,
    has_page_number: false,
  }
}
