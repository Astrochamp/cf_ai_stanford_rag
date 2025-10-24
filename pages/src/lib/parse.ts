import katex from "katex";

/**
 * Parses TeX/LaTeX math expressions in text and renders them using KaTeX.
 * Supports:
 *  - Inline math: \( ... \) and $ ... $
 *  - Display math: \[ ... \] and $$ ... $$
 * Also correctly handles cases where backslashes are double-escaped (e.g., \\(\\prec\\)).
 * 
 * @param text The text containing TeX expressions
 * @returns The text with TeX expressions converted to HTML
 */
export function parseTeX(text: string): string {
  if (!text) return text;

  // Normalize math content by collapsing double backslashes to single
  const normalizeTeX = (math: string) => math.replace(/\\\\/g, "\\");

  const render = (
    match: string,
    math: string,
    displayMode: boolean,
    label: string
  ) => {
    try {
      const normalized = normalizeTeX(math).trim();
      return katex.renderToString(normalized, {
        displayMode,
        throwOnError: false,
        strict: false,
      });
    } catch (e) {
      console.error(`KaTeX ${label} error:`, e);
      return match;
    }
  };

  // Prefer handling block/display first to avoid interfering with inline patterns
  // Display math: $$ ... $$
  text = text.replace(/\$\$(.+?)\$\$/gs, (m, math) => render(m, math, true, "block math ($$)"));

  // Display math: \\[ ... \\] (double-escaped) and \[ ... \]
  text = text.replace(/\\\\\[(.+?)\\\\\]/gs, (m, math) => render(m, math, true, "display math (\\[\\])"));
  text = text.replace(/\\\[(.+?)\\\]/gs, (m, math) => render(m, math, true, "display math (\[\])"));

  // Inline math: \\( ... \\) (double-escaped) and \( ... \)
  text = text.replace(/\\\\\((.+?)\\\\\)/g, (m, math) => render(m, math, false, "inline math (\\(\\))"));
  text = text.replace(/\\\((.+?)\\\)/g, (m, math) => render(m, math, false, "inline math (\(\))"));

  // Inline math: $ ... $ (but not $$)
  // Use negative lookahead and lookbehind to avoid matching $$
  text = text.replace(/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g, (m, math) => render(m, math, false, "inline math ($)"));

  return text;
}