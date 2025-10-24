

import OpenAI from 'openai';
import type { HybridSearchResult } from './hybrid-search';

export interface LLMEvidenceItem {
  id: number;
  doc_title: string;
  section_heading: string;
  text: string;
}

/**
 * Convert HybridSearchResults to EvidenceItems, ordered by reranker score (best first)
 * Returns a minified JSON string
 */
export function createEvidenceJson(results: HybridSearchResult[]): { evidenceJson: string; articleIdMap: Map<number, string>; } {
  // Sort by rerank_score descending (best first)
  const sortedResults = [...results].sort((a, b) => b.rerank_score - a.rerank_score);
  const mapping = new Map<number, string>();

  // Map to EvidenceItem format
  const evidenceItems = sortedResults.map((result, index) => {
    mapping.set(index+1, result.article_id);

    return {
      id: index+1,
      doc_title: `${result.article_title.trim()} (Stanford Encyclopedia of Philosophy)`,
      section_heading: result.heading || '',
      text: result.generation_text || result.chunk_text,
    } as LLMEvidenceItem;
  });

  // Return minified JSON
  return {
    evidenceJson: JSON.stringify(evidenceItems),
    articleIdMap: mapping
  };
}


const systemPrompt = `<System>
You are an expert philosophy assistant who writes fluent, historically aware, mini-essay-style answers while remaining accountable to the provided source passages.

GUIDELINES:
1. Use the content of the EVIDENCE array as the factual basis for the answer. It is acceptable to synthesize and paraphrase across passages.
2. Produce a clear, engaging, mini-essay-style response with signposting and transitions. Aim for a natural flow (varied sentence length, rhetorical signposting like "Origins", "Compatibilist accounts", "Key debates", etc. when relevant).
3. Citation policy:
   - Map each evidence chunk to a short numeric citation e.g. ^[1], ^[5][8], ^[6][10][11] etc.
   - Attach citations to the *clauses* or *sentences* they support, but avoid interrupting sentence flow. It is OK to place a citation at the end of a sentence when that sentence is supported by one or more chunks.
4. You may quote verbatim when helpful; mark verbatim quotes with single quotes and include the citation after the quote.
5. Produce the following output structure in Markdown. Use British English:
   - An mini-essay-style synthesis. Use headings like "Origins", "Development", "Contemporary debates", etc. if relevant.
6. Keep factual precision but prioritise readability and synthesis. If necessary to answer the user’s question fully, you may infer plausible context from the provided passages - don't add a citation when doing so.

Formatting:
- Use ## Markdown headings and paragraphs.
- Use TeX when helpful to format expressions e.g. from propositional logic.
- Short numeric citations only (^[1], ^[2][3]).
</System>`;

function buildUserPrompt(
  userQuery: string,
  evidenceItems: LLMEvidenceItem[]
): string {
  const evidenceJson = JSON.stringify(evidenceItems);

  return `EVIDENCE = ${evidenceJson}

QUESTION:
"""
${userQuery}
"""`;
}

export async function generateResponse(
  userQuery: string,
  evidenceItems: LLMEvidenceItem[],
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
      effort: "low"
    },
    text: {
      verbosity: "medium"
    }
  });

  return response.output_text;
}