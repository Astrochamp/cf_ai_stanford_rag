import katex from "katex";
import type { UsedEvidenceItem } from "./types";

interface ParsedSources {
  used_evidence: UsedEvidenceItem[];
}

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

/**
 * Extracts and parses the "used_evidence" JSON from the LLM's
 * Markdown response.
 *
 * @param llmOutput The full string response from the large language model.
 * @returns The parsed ParsedSources object, or null if parsing fails.
 */
export function extractSourcesJson(llmOutput: string): UsedEvidenceItem[] | null {
  const headingMarker = "## Sources";

  // 1. Split the output by the "## Sources" heading
  const parts = llmOutput.split(headingMarker);

  // If the heading wasn't found, parts.length will be 1
  if (parts.length < 2) {
    console.error("Parsing Error: '## Sources' heading not found.");
    return null;
  }

  // 2. Get the text *after* the heading
  // This will contain the JSON and any trailing text
  const textAfterHeading = parts[1];

  // 3. Find the first '{' and the last '}'
  // This is more robust than regex against extra text
  const jsonStartIndex = textAfterHeading.indexOf('{');
  const jsonEndIndex = textAfterHeading.lastIndexOf('}');

  if (jsonStartIndex === -1 || jsonEndIndex === -1) {
    console.error("Parsing Error: Could not find opening or closing brace {} for JSON.");
    return null;
  }

  // 4. Extract the raw JSON string
  const jsonString = textAfterHeading.substring(jsonStartIndex, jsonEndIndex + 1);

  // 5. Parse the JSON in a try...catch block
  // This is CRITICAL, as LLMs can make syntax errors (e.g., trailing commas)
  try {
    const parsedJson: ParsedSources = JSON.parse(jsonString);
    return parsedJson.used_evidence;
  } catch (error) {
    console.error("Parsing Error: Failed to parse invalid JSON.", error);
    console.error("Invalid JSON string was:", jsonString);
    return null;
  }
}