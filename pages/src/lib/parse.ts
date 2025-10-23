import type { UsedEvidenceItem } from "./types";

interface ParsedSources {
  used_evidence: UsedEvidenceItem[];
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