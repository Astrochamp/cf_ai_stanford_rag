

import OpenAI from 'openai';
import type { HybridSearchResult } from './hybrid-search';

export interface EvidenceItem {
  id: string;
  doc_title: string;
  section_id: string;
  section_heading: string;
  chunk_index: number;
  text: string;
}

/**
 * Convert HybridSearchResults to EvidenceItems, ordered by reranker score (best first)
 * Returns a minified JSON string
 */
export function createEvidenceJson(results: HybridSearchResult[]): string {
  // Sort by rerank_score descending (best first)
  const sortedResults = [...results].sort((a, b) => b.rerank_score - a.rerank_score);

  // Map to EvidenceItem format
  const evidenceItems: EvidenceItem[] = sortedResults.map((result) => ({
    id: result.chunk_id,
    doc_title: `${result.article_title.trim()} (Stanford Encyclopedia of Philosophy)`,
    section_id: result.section_id,
    section_heading: result.heading || '',
    chunk_index: parseInt(result.chunk_id.split('/').pop()?.replace('chunk-', '') || '0'),
    text: result.generation_text || result.chunk_text,
  }));

  // Return minified JSON
  return JSON.stringify(evidenceItems);
}


const systemPrompt = `<System>
You are an expert philosopher and evidence-first summariser. GUIDELINES (must follow exactly):
- Use ONLY the passages provided in the "EVIDENCE" array below to support factual claims.
- For every factual claim, append a parenthetical citation matching the chunk id exactly, e.g. (propositional-logic/3.1/chunk-0).
- For each claim that is NOT supported by provided passages, explicitly label it: (UNSUPPORTED BY PROVIDED SOURCES).
- Produce output in British English. Use British spellings (e.g., 'analyse', 'colour', 'organisation'), British punctuation conventions and date format DD/MM/YYYY.
- When quoting a passage verbatim, use single quotation marks unless nested quotes require double quotes. Always include the chunk id after the quote.
- Keep answer focused, precise, and avoid speculative claims beyond the evidence.
- If asked for further reading, list the doc_title and section_heading for cited chunks only.
- Output "used_evidence" JSON (array of objects: {id, verbatim_quote, role_in_answer}) at the end of your response.

Use Markdown to format your response clearly, with TeX for any mathematical or logical expressions.
Your response must follow this format exactly:
\`\`\`
## Summary
Write a short 1-2 sentence summary of your answer.

## Explanation
Further detail supporting the summary. All claims in this section must have inline citations.

## Sources
{
  "used_evidence": [
    {
      "id": "string", // e.g. "propositional-logic/3.1/chunk-0"
      "verbatim_quote": "string",
      "role_in_answer": "string"
    },
    // ...
  ]
}
\`\`\`

Default behaviour:
- reasoning_effort: MEDIUM
- verbosity: MEDIUM
</System>`;

function buildUserPrompt(
  userQuery: string,
  evidenceItems: EvidenceItem[]
): string {
  const evidenceJson = JSON.stringify(evidenceItems);

  return `User: 
EVIDENCE = ${evidenceJson}

USER_QUERY:
"Answer this question using ONLY the evidence above. Provide a concise answer (<= 600 tokens) that addresses the question with philosophical nuance. For each factual sentence include a parenthetical citation to the specific chunk id used. At the end include a 'used_evidence' object with each chunk id you relied on and the exact verbatim sentence(s) you copied from that chunk."

Formatting rules (must follow):
1) First create a short 1-2 sentence Summary.
2) Then provide a more detailed Explanation supporting the Summary; each claim must have inline citations.
3) Then output a JSON object including "used_evidence", listing {id, verbatim_quote, role_in_answer}.

Please answer in British English.

QUESTION: ${userQuery}`;
}

export async function generateResponse(
  userQuery: string,
  evidenceItems: EvidenceItem[],
  openai: OpenAI
): Promise<string> {
  const userPrompt = buildUserPrompt(userQuery, evidenceItems);

  const response = await openai.responses.create({
    model: "gpt-5-mini",
    store: false,
    stream: false,
    instructions: systemPrompt,
    input: userPrompt,
    reasoning: {
      effort: "medium"
    },
    text: {
      verbosity: "medium"
    }
  });

  return response.output_text;
}