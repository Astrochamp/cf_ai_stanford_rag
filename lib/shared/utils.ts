export function normaliseText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function normaliseWhitespace(text: string, keepNewLines = false): string {
  if (keepNewLines) {
    // First, collapse multiple newlines to double newlines (paragraph breaks)
    // Then replace single newlines (line wraps within paragraphs) with spaces
    // Finally collapse multiple spaces to single spaces
    return text
      .replace(/\n{3,}/g, '\n\n')  // Collapse 3+ newlines to 2 (paragraph breaks)
      .replace(/\n\n/g, '___PARAGRAPH_BREAK___')  // Temporarily mark paragraph breaks
      .replace(/\n/g, ' ')  // Replace single newlines with spaces
      .replace(/___PARAGRAPH_BREAK___/g, '\n\n')  // Restore paragraph breaks
      .replace(/[ \t]+/g, ' ')  // Collapse multiple spaces/tabs to single space
      .trim();
  }
  return text.replace(/\s+/g, ' ').trim();
}