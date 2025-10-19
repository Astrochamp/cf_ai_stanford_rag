/**
 * Stanford Encyclopedia of Philosophy - Article Processing Pipeline
 * 
 * This script provides a complete pipeline for fetching, preprocessing, and chunking
 * articles from the Stanford Encyclopedia of Philosophy for use in RAG systems.
 * 
 * MAIN FEATURES:
 * 
 * 1. HTML to Text Preprocessing:
 *    - Removes diacritics and normalizes Unicode
 *    - Converts HTML lists to text format with proper markers
 *    - Converts HTML tables to natural language descriptions (via GPT)
 *    - Converts TeX mathematical notation to Unicode symbols or natural language
 *    - Preserves paragraph structure with double newlines
 * 
 * 2. Semantic Chunking:
 *    - Splits text into chunks up to 1024 tokens (configurable)
 *    - Respects semantic boundaries (paragraphs, tables, lists)
 *    - Never splits in the middle of a semantic unit
 *    - Uses accurate GPT tokenization for chunk sizing
 */

import * as cheerio from 'cheerio';
import 'dotenv/config';
import * as fs from 'fs';
import { encode as tokenize } from 'gpt-tokenizer';
import { decode as htmlDecode } from 'html-entities';
import { OpenAI } from "openai";
import texToUnicodeMap from './data/tex-unicode-map.json';

const articlesListURL = "https://plato.stanford.edu/published.html";
const baseArticleURL = "https://plato.stanford.edu/entries/";
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
}) : null;

// ============================================================================
// CONSTANTS & REGEX PATTERNS
// ============================================================================

const TEX_PATTERN = /(?:\\\(|\\\[)(.*?)(?:\\\)|\\\])/s;
const TABLE_REGEX = /<table[^>]*>[\s\S]*?<\/table>/gi;
const NESTED_LIST_PLACEHOLDER = '__NESTED_LIST__';
const NESTED_LIST_END_PLACEHOLDER = '__END_NESTED_LIST__';

const EXCLUDED_TEX_COMMANDS = new Set([
  'sum', 'int', 'prod', 'lim', 'bigcup', 'bigcap', // operators
  'frac', 'sqrt',                                  // fractions, roots
  'hat', 'bar', 'vec', 'dot', 'tilde',             // accents
  'mathbb', 'mathcal', 'mathbf', 'mathrm',         // fonts
  'left', 'right', 'begin', 'end'                  // structural
]);

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type ArticleID = string & { __id: true; };

type ArticleSection = {
  shortName: string; // e.g. ReleConnLogi
  number: string; // 3.3
  heading: string; // Relevance and connexive logics
  content: string; // raw HTML content of the section
};

type Article = {
  id: ArticleID;
  title: string; // e.g. Yogacara
  originalTitle: string; // not normalised, may contain diacritics. e.g. Yogācāra
  authors: string[]; // list of author names
  preamble: string; // raw HTML content of the preamble
  sections: ArticleSection[];
  related: ArticleID[];
};

type ProcessedChunk = {
  retrievalText: string; // Fully normalized for embedding/search
  generationText: string; // Formatted for LLM context and display
  tokenCount: number; // Based on retrieval text
};

// New: Item-based processing types
type ItemKind = 'paragraph' | 'list' | 'table' | 'pre' | 'blockquote' | 'figure' | 'other';
type SectionItem = {
  kind: ItemKind;
  html: string; // raw HTML for the item
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Mapping of Roman numerals to their integer values.
 */
const ROMAN_MAP: Record<string, number> = {
  M: 1000, CM: 900, D: 500, CD: 400,
  C: 100, XC: 90, L: 50, XL: 40,
  X: 10, IX: 9, V: 5, IV: 4, I: 1
};

/**
 * Convert a number to Roman numeral representation.
 * Standard Roman numerals are for positive integers in the range 1-3999.
 */
function toRoman(num: number): string {
  if (num < 1 || num > 3999 || !Number.isInteger(num)) {
    return num.toString();
  }

  let roman = '';
  let remaining = num;
  for (const key in ROMAN_MAP) {
    while (remaining >= ROMAN_MAP[key]) {
      roman += key;
      remaining -= ROMAN_MAP[key];
    }
  }
  return roman;
}

/**
 * Convert a number to alphabetic representation (1=A, 2=B, ..., 26=Z, 27=AA, etc.).
 * Adjusts for 1-based indexing to 0-based for character codes.
 */
function toAlphabet(num: number): string {
  if (num < 1 || !Number.isInteger(num)) {
    return num.toString();
  }
  let result = '';
  let tempNum = num;
  while (tempNum > 0) {
    const remainder = (tempNum - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result; // 65 is the char code for 'A'
    tempNum = Math.floor((tempNum - 1) / 26);
  }
  return result;
}

/**
 * Process nested list content by replacing placeholder markers with properly indented text.
 */
function processNestedListContent(
  contentWithPlaceholder: string,
  keepMarkers: boolean,
  hasMainText: boolean
): string {
  const parts = contentWithPlaceholder.split(new RegExp(`\\n?${NESTED_LIST_PLACEHOLDER}\\n?`));
  const mainText = parts[0].trim();
  let result = '';

  if (mainText && keepMarkers) {
    // Main text will be handled by caller with marker
  }

  for (let i = 1; i < parts.length; i++) {
    const nestedPart = parts[i].split(NESTED_LIST_END_PLACEHOLDER)[0];
    if (nestedPart) {
      const nestedLines = nestedPart.split('\n').filter(line => line.trim());
      nestedLines.forEach(line => {
        if (keepMarkers) {
          const indent = hasMainText ? '  ' : '';
          result += `${indent}${line}\n`;
        } else {
          const cleanedLine = line.replace(/^[\s\-•\d\w]+\.\s*/, '');
          result += `${cleanedLine}\n`;
        }
      });
    }
  }

  return result;
}

// ============================================================================
// HTML LIST PROCESSING
// ============================================================================

function htmlListToTextList(htmlString: string, keepMarkers: boolean = true): string {

  const $ = cheerio.load(htmlString);

  // Process lists from innermost to outermost (bottom-up)
  // This ensures nested lists are converted before their parents
  function processLists() {
    let hasLists = true;

    while (hasLists) {
      // Find the deepest lists (those without any list descendants)
      const deepestLists = $('ul, ol').filter((_, list) => {
        return $(list).find('ul, ol').length === 0;
      });

      if (deepestLists.length === 0) {
        hasLists = false;
        break;
      }

      deepestLists.each((_, list) => {
        const $list = $(list);
        const isOrdered = list.tagName.toLowerCase() === 'ol';

        if (isOrdered) {
          const isReversed = $list.attr('reversed') !== undefined;
          const type = $list.attr('type')?.toLowerCase() || '1';
          const startAttr = $list.attr('start');
          let counter = startAttr ? parseInt(startAttr, 10) : 1;
          if (isNaN(counter)) counter = 1;

          let textContent = '\n';
          $list.children('li').each((_, li) => {
            let marker: string;

            switch (type) {
              case 'a':
                marker = toAlphabet(counter).toLowerCase();
                break;
              case 'A':
                marker = toAlphabet(counter).toUpperCase();
                break;
              case 'i':
                marker = toRoman(counter).toLowerCase();
                break;
              case 'I':
                marker = toRoman(counter).toUpperCase();
                break;
              case '1':
              default:
                marker = counter.toString();
                break;
            }

            const $li = $(li);
            const liHtml = $li.html() || '';

            // Check if this <li> contains a <pre> tag (converted nested list)
            const $liContent = $('<div></div>').html(liHtml);
            const $nestedPre = $liContent.find('pre');

            if ($nestedPre.length > 0) {
              // Has nested list - extract text before the <pre> and the <pre> content
              $nestedPre.each((_, pre) => {
                $(pre).replaceWith(`\n${NESTED_LIST_PLACEHOLDER}\n` + $(pre).text() + `${NESTED_LIST_END_PLACEHOLDER}\n`);
              });
              const contentWithPlaceholder = $liContent.text().trim();
              const parts = contentWithPlaceholder.split(new RegExp(`\\n?${NESTED_LIST_PLACEHOLDER}\\n?`));
              const mainText = parts[0].trim();

              if (keepMarkers) {
                textContent += `${marker}. ${mainText}\n`;
              } else {
                textContent += `${mainText}\n`;
              }

              textContent += processNestedListContent(contentWithPlaceholder, keepMarkers, true);
            } else {
              // No nested list - just get text
              if (keepMarkers) {
                textContent += `${marker}. ${$li.text().trim()}\n`;
              } else {
                textContent += `${$li.text().trim()}\n`;
              }
            }

            if (isReversed) {
              counter--;
            } else {
              counter++;
            }
          });
          textContent = textContent.trimEnd() + '\n';

          const preElement = $('<pre></pre>').text(textContent);
          $list.replaceWith(preElement);
        } else {
          // Unordered list
          let textContent = '\n';
          $list.children('li').each((_, li) => {
            const $li = $(li);
            const liHtml = $li.html() || '';

            // Check if this <li> contains a <pre> tag (converted nested list)
            const $liContent = $('<div></div>').html(liHtml);
            const $nestedPre = $liContent.find('pre');

            if ($nestedPre.length > 0) {
              // Has nested list - extract text before the <pre> and the <pre> content
              $nestedPre.each((_, pre) => {
                $(pre).replaceWith(`\n${NESTED_LIST_PLACEHOLDER}\n` + $(pre).text() + `${NESTED_LIST_END_PLACEHOLDER}\n`);
              });
              const contentWithPlaceholder = $liContent.text().trim();
              const parts = contentWithPlaceholder.split(new RegExp(`\\n?${NESTED_LIST_PLACEHOLDER}\\n?`));
              const mainText = parts[0].trim();

              // Only add the parent marker if there's text content
              if (mainText) {
                if (keepMarkers) {
                  textContent += `- ${mainText}\n`;
                } else {
                  textContent += `${mainText}\n`;
                }
              }

              textContent += processNestedListContent(contentWithPlaceholder, keepMarkers, !!mainText);
            } else {
              // No nested list - just get text
              if (keepMarkers) {
                textContent += `- ${$li.text().trim()}\n`;
              } else {
                textContent += `${$li.text().trim()}\n`;
              }
            }
          });
          textContent = textContent.trimEnd() + '\n';

          const preElement = $('<pre></pre>').text(textContent);
          $list.replaceWith(preElement);
        }
      });
    }
  }

  processLists();

  // Return the full, modified HTML.
  return $.html();
}

// ============================================================================
// TEX & TEXT NORMALIZATION
// ============================================================================

function replaceTexWithSymbols(text: string): string {
  const texMap = texToUnicodeMap as Record<string, string>;
  const texSymbolRegex = /\\([a-zA-Z]+)/g;
  const remainingTexRegex = /\\/;
  const mathExpressionRegex = /(?:\\\(|\\\[)(.*?)(?:\\\)|\\\])/g;

  return text.replace(mathExpressionRegex, (originalMatch, content) => {

    const firstPassContent = content.replace(texSymbolRegex, (match: string, command: string) => {
      if (EXCLUDED_TEX_COMMANDS.has(command) || !texMap[command]) {
        return match; // keep complex commands e.g \frac, \sum
      }
      return texMap[command]; // replace simple symbols
    });

    // replace "\rN" -> "N" and "\bT" -> "T"
    const customTypesetRegex = /\\[rb]([A-Za-z])/g;
    const removedCustomTypeset: string = firstPassContent.replace(customTypesetRegex, (match: string, letter: string): string => letter);

    // clean up braces and loose backslashes
    const processedContent = removedCustomTypeset.replace(/\\{/g, "{").replace(/\\}/g, "}").replace(/\s+\\\s+/g, ' ');

    if (remainingTexRegex.test(processedContent)) {
      const startDelimiter = originalMatch.slice(0, 2); // e.g., "\(" or "\["
      const endDelimiter = originalMatch.slice(-2);
      return `${startDelimiter}${processedContent}${endDelimiter}`;
    } else {
      return processedContent.replace(/\\/g, ''); // remove any remaining backslashes
    }
  });
}

// ============================================================================
// GPT API HELPERS
// ============================================================================

/**
 * Call GPT API with a prompt and return the response text.
 * Handles API errors gracefully by returning fallback text.
 */
async function callGPTAPI(prompt: string, fallbackText: string, logMessage: string): Promise<string> {
  if (!openai) {
    return fallbackText;
  }

  console.log(`  → ${logMessage}...`);

  try {
    const response = await openai.responses.create({
      model: "gpt-5-nano",
      input: prompt,
      text: {
        verbosity: "low"
      },
      reasoning: {
        effort: "minimal"
      }
    });

    return response.output_text;
  } catch (error) {
    console.error(`Error calling OpenAI API: ${error}`);
    return fallbackText;
  }
}

/**
 * Batch process multiple GPT API calls in parallel.
 * Returns results in the same order as inputs.
 */
async function batchGPTCalls<T>(
  items: T[],
  createPrompt: (item: T) => { prompt: string; fallback: string; },
  logPrefix: string = "Processing"
): Promise<string[]> {
  if (!openai || items.length === 0) {
    return items.map(item => createPrompt(item).fallback);
  }

  console.log(`  → ${logPrefix} ${items.length} items in parallel...`);

  const promises = items.map(async (item, index) => {
    const { prompt, fallback } = createPrompt(item);
    try {
      const response = await openai.responses.create({
        model: "gpt-5-nano",
        input: prompt,
        text: {
          verbosity: "low"
        },
        reasoning: {
          effort: "minimal"
        }
      });
      return response.output_text;
    } catch (error) {
      console.error(`Error in batch call ${index + 1}/${items.length}: ${error}`);
      return fallback;
    }
  });

  return Promise.all(promises);
}

async function gptConvertTexToText(text: string, articleTitle = "", sectionHeading = ""): Promise<string> {
  const contextParts = [];
  contextParts.push("Stanford Encyclopedia of Philosophy");
  if (articleTitle) contextParts.push(articleTitle);
  if (sectionHeading) contextParts.push(sectionHeading);
  const contextInfo = contextParts.join(" - ");

  const prompt = `# Task: Convert TeX to Natural Language

You will receive a paragraph from a philosophical text. Your job is to find all TeX notation and rewrite it as a natural language phrase.

**Instructions:**
1.  **Convert TeX:** Replace expressions like \`\\forall\`, \`\\in\`, and \`$..$\` with plain English.
2.  **Preserve Surrounding Text:** Do not alter any non-TeX words.

**Output Format:**
- The final text must contain **absolutely no TeX markup**.
- Provide **only the converted paragraph**. Do not include reasoning, explanations, or any introductory text.
- The output must be **raw plain text**, not wrapped in code blocks (\`\`\`), quotes, or other delimiters.

---
**Example 1:**
* **Input:** The Barcan formula is typically expressed as \`\\forall x \\Box Fx \\rightarrow \\Box \\forall x Fx\`.
* **Output:** The Barcan formula is typically expressed as for all x, it is necessary that Fx, which implies that it is necessary that for all x, Fx.

**Example 2:**
* **Input:** The axiom of separation allows us to form a subset \`Y = \\{x \\in Z \\mid \\phi(x)\\}\`.
* **Output:** The axiom of separation allows us to form a subset Y which is the set of all x in Z such that phi(x) is true.
---

**CONVERT THE FOLLOWING:**

**Context:** ${contextInfo}
**Paragraph:**
${text}

**Converted Paragraph:**
`;
  return callGPTAPI(prompt, text, 'Calling GPT to convert TeX to natural language');
};

/**
 * Batch process multiple TeX conversions in parallel.
 */
async function batchConvertTexToText(
  texts: string[],
  articleTitle = "",
  sectionHeading = ""
): Promise<string[]> {
  const contextParts = [];
  contextParts.push("Stanford Encyclopedia of Philosophy");
  if (articleTitle) contextParts.push(articleTitle);
  if (sectionHeading) contextParts.push(sectionHeading);
  const contextInfo = contextParts.join(" - ");

  return batchGPTCalls(
    texts,
    (text) => ({
      prompt: `# Task: Convert TeX to Natural Language
Do NOT use ANY reasoning for this task! Terminate reasoning as soon as you begin.

You will receive a paragraph from a philosophical text. Your job is to find all TeX notation and rewrite it as a natural language phrase.

**Instructions:**
1.  **Convert TeX:** Replace expressions like \`\\forall\`, \`\\in\`, and \`$..$\` with plain English.
2.  **Preserve Surrounding Text:** Do not alter any non-TeX words.

**Output Format:**
- The final text must contain **absolutely no TeX markup**.
- Provide **only the converted paragraph**. Do not include reasoning, explanations, or any introductory text.
- The output must be **raw plain text**, not wrapped in code blocks (\`\`\`), quotes, or other delimiters.

---
**Example 1:**
* **Input:** The Barcan formula is typically expressed as \`\\forall x \\Box Fx \\rightarrow \\Box \\forall x Fx\`.
* **Output:** The Barcan formula is typically expressed as for all x, it is necessary that Fx, which implies that it is necessary that for all x, Fx.

**Example 2:**
* **Input:** The axiom of separation allows us to form a subset \`Y = \\{x \\in Z \\mid \\phi(x)\\}\`.
* **Output:** The axiom of separation allows us to form a subset Y which is the set of all x in Z such that phi(x) is true.
---

**CONVERT THE FOLLOWING:**

**Context:** ${contextInfo}
**Paragraph:**
${text}

**Converted Paragraph:**
`,
      fallback: text
    }),
    'Converting TeX to natural language for'
  );
}

async function gptCreateTableDescription(tableElem: string, articleTitle = "", sectionHeading = ""): Promise<string> {
  const contextParts = [];
  contextParts.push("Stanford Encyclopedia of Philosophy");
  if (articleTitle) contextParts.push(articleTitle);
  if (sectionHeading) contextParts.push(sectionHeading);
  const contextInfo = contextParts.join(" - ");

  const prompt = `# Task: Summarize HTML Table
Do NOT use ANY reasoning for this task! Terminate reasoning as soon as you begin.

Your task is to analyze the provided HTML \`<table>\` and generate a concise natural language summary. The summary should capture the table's main purpose, structure, and key information.

**Instructions:**
1.  **Summarize, Don't Transcribe:** Do not describe every row or cell. Identify the key patterns, relationships, or conclusions presented in the table.
2.  **Translate TeX:** If the table contains TeX notation (e.g., \`\\forall\`, \`$..$\`), translate it into plain English as part of your summary.
3.  **Concise & Clear:** The output must be a single, easy-to-read description.
4.  **Plain Text Output:** Provide only the summary. Do not include any HTML, TeX, markdown, or explanatory preambles in your response.

---
**Example:**
* **Input Table:**
\`\`\`html
<table>
  <thead>
    <tr><th>System</th><th>Characteristic Axiom</th><th>Description</th></tr>
  </thead>
  <tbody>
    <tr><td>K</td><td>(None)</td><td>Base system for modal logic.</td></tr>
    <tr><td>T</td><td>$\\Box A \\rightarrow A$</td><td>Adds the axiom of necessity.</td></tr>
    <tr><td>S4</td><td>$\\Box A \\rightarrow \\Box\\Box A$</td><td>Builds on T, adds the axiom for transitivity.</td></tr>
  </tbody>
</table>
\`\`\`
* **Output Summary:**
A table presenting three modal logic systems, showing how they are built by adding axioms. The base system K has no unique axiom. System T extends K by adding the axiom stating that if A is necessary, then A is true. System S4 further builds on T with an axiom for transitivity, stating that if A is necessary, then it is necessary that A is necessary.
---

**SUMMARIZE THE FOLLOWING TABLE:**

**Context:** ${contextInfo}
**Input Table:**
${tableElem}

**Summary:**
`;
  return callGPTAPI(prompt, "", 'Calling GPT to generate table description');
};

/**
 * Batch process multiple table descriptions in parallel.
 */
async function batchCreateTableDescriptions(
  tables: string[],
  articleTitle = "",
  sectionHeading = ""
): Promise<string[]> {
  const contextParts = [];
  contextParts.push("Stanford Encyclopedia of Philosophy");
  if (articleTitle) contextParts.push(articleTitle);
  if (sectionHeading) contextParts.push(sectionHeading);
  const contextInfo = contextParts.join(" - ");

  return batchGPTCalls(
    tables,
    (tableElem) => ({
      prompt: `# Task: Summarize HTML Table

Your task is to analyze the provided HTML \`<table>\` and generate a concise natural language summary. The summary should capture the table's main purpose, structure, and key information.

**Instructions:**
1.  **Summarize, Don't Transcribe:** Do not describe every row or cell. Identify the key patterns, relationships, or conclusions presented in the table.
2.  **Translate TeX:** If the table contains TeX notation (e.g., \`\\forall\`, \`$..$\`), translate it into plain English as part of your summary.
3.  **Concise & Clear:** The output must be a single, easy-to-read description.
4.  **Plain Text Output:** Provide only the summary. Do not include any HTML, TeX, markdown, or explanatory preambles in your response.

---
**Example:**
* **Input Table:**
\`\`\`html
<table>
  <thead>
    <tr><th>System</th><th>Characteristic Axiom</th><th>Description</th></tr>
  </thead>
  <tbody>
    <tr><td>K</td><td>(None)</td><td>Base system for modal logic.</td></tr>
    <tr><td>T</td><td>$\\Box A \\rightarrow A$</td><td>Adds the axiom of necessity.</td></tr>
    <tr><td>S4</td><td>$\\Box A \\rightarrow \\Box\\Box A$</td><td>Builds on T, adds the axiom for transitivity.</td></tr>
  </tbody>
</table>
\`\`\`
* **Output Summary:**
A table presenting three modal logic systems, showing how they are built by adding axioms. The base system K has no unique axiom. System T extends K by adding the axiom stating that if A is necessary, then A is true. System S4 further builds on T with an axiom for transitivity, stating that if A is necessary, then it is necessary that A is necessary.
---

**SUMMARIZE THE FOLLOWING TABLE:**

**Context:** ${contextInfo}
**Input Table:**
${tableElem}

**Summary:**
`,
      fallback: ""
    }),
    'Generating table descriptions for'
  );
}

async function processTex(text: string, forRetrieval: boolean = true): Promise<string> {
  const replacedText = replaceTexWithSymbols(text);
  if (TEX_PATTERN.test(replacedText)) {
    if (forRetrieval) {
      // For retrieval, convert all TeX to natural language
      return await gptConvertTexToText(replacedText);
    } else {
      // For generation, keep TeX in a readable format (already replaced symbols)
      return replacedText;
    }
  } else {
    return replacedText;
  }
}

function convertTableToMarkdown(tableHtml: string): string {
  const $ = cheerio.load(tableHtml);
  const $table = $('table').first();

  if ($table.length === 0) return tableHtml;

  const rows: string[][] = [];

  // Extract headers
  const headers: string[] = [];
  $table.find('thead tr th, thead tr td').each((_, cell) => {
    headers.push($(cell).text().trim());
  });

  // If no thead, check for th in first row of tbody
  if (headers.length === 0) {
    $table.find('tbody tr:first-child th, tbody tr:first-child td').each((_, cell) => {
      headers.push($(cell).text().trim());
    });
  }

  if (headers.length > 0) {
    rows.push(headers);
  }

  // Extract body rows
  const startRow = headers.length > 0 && $table.find('thead').length === 0 ? 1 : 0;
  $table.find('tbody tr').slice(startRow).each((_, row) => {
    const cells: string[] = [];
    $(row).find('th, td').each((_, cell) => {
      cells.push($(cell).text().trim());
    });
    if (cells.length > 0) {
      rows.push(cells);
    }
  });

  // Build markdown table
  if (rows.length === 0) return tableHtml;

  let markdown = '\n';

  // Add header row
  if (rows.length > 0) {
    markdown += '| ' + rows[0].join(' | ') + ' |\n';
    markdown += '| ' + rows[0].map(() => '---').join(' | ') + ' |\n';
  }

  // Add data rows
  for (let i = 1; i < rows.length; i++) {
    markdown += '| ' + rows[i].join(' | ') + ' |\n';
  }

  markdown += '\n';

  return markdown;
}

// ============================================================================
// TABLE CONVERSION
// ============================================================================

async function convertTablesToDescriptions(text: string, articleTitle = "", sectionHeading = ""): Promise<string> {
  const tables = text.match(TABLE_REGEX);

  if (!tables || tables.length === 0) {
    return text;
  }

  let processedText = text;

  for (const table of tables) {
    const description = await gptCreateTableDescription(table, articleTitle, sectionHeading);
    if (description) {
      // Replace the table with a formatted description
      processedText = processedText.replace(table, `[Table: ${description}]`);
    }
  }

  return processedText;
}

function convertTablesToMarkdown(text: string): string {
  const tables = text.match(TABLE_REGEX);

  if (!tables || tables.length === 0) {
    return text;
  }

  let processedText = text;

  for (const table of tables) {
    const markdown = convertTableToMarkdown(table);
    processedText = processedText.replace(table, markdown);
  }

  return processedText;
}

function normaliseText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normaliseWhitespace(text: string, keepNewLines = false): string {
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

// ============================================================================
// HTML TAG STRIPPING
// ============================================================================

function stripHTMLTags(html: string): string {
  const PRESERVE_TAGS = new Set(['figure', 'figcaption']);
  const REMOVE_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'noscript']);
  const PARAGRAPH_TAGS = new Set(['p', 'div', 'blockquote', 'li', 'pre']);

  let text = html;

  REMOVE_WITH_CONTENT.forEach(tag => {
    const regex = new RegExp(`<${tag}[^>]*>.*?</${tag}>`, 'gis');
    text = text.replace(regex, '');
  });

  PARAGRAPH_TAGS.forEach(tag => {
    const openRegex = new RegExp(`<${tag}[^>]*>`, 'gi');
    const closeRegex = new RegExp(`</${tag}>`, 'gi');
    text = text.replace(closeRegex, '\n\n');
    text = text.replace(openRegex, '');
  });

  const preservedElements: { placeholder: string; content: string; }[] = [];
  let placeholderCounter = 0;

  PRESERVE_TAGS.forEach(tag => {
    const regex = new RegExp(`<${tag}[^>]*>.*?</${tag}>`, 'gis');
    text = text.replace(regex, (match) => {
      const placeholder = `__PRESERVED_ELEMENT_${placeholderCounter}__`;
      preservedElements.push({ placeholder, content: match });
      placeholderCounter++;
      return placeholder;
    });
  });

  text = text.replace(/<[^>]+>/g, '');
  text = htmlDecode(text);

  text = text.replace(/\r/g, ''); // remove carriage returns
  text = text.replace(/[ \t]+/g, ' '); // collapse horizontal whitespace
  text = text.replace(/ *\n */g, '\n'); // remove spaces around newlines
  text = text.replace(/\n{3,}/g, '\n\n'); // collapse 3+ newlines to 2

  preservedElements.forEach(({ placeholder, content }) => {
    text = text.replace(placeholder, content);
  });

  return text;
}

async function fetchArticlesList(): Promise<ArticleID[]> {
  const response = await fetch(articlesListURL);
  const text = await response.text();
  const $ = cheerio.load(text);
  const articleIDs: ArticleID[] = [];

  // More specific selector - target links that contain '/entries/' in href
  $('a[href*="/entries/"]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href || !href.includes('/entries/')) return;

    // Extract id (part after /entries/)
    const match = href.match(/\/entries\/([^\/\.]+)/);
    if (match && match[1]) {
      articleIDs.push(match[1] as ArticleID);
    }
  });
  const uniqueArticleIDs = Array.from(new Set(articleIDs));
  return uniqueArticleIDs;
}

// ============================================================================
// FIGURE PROCESSING
// ============================================================================

/**
 * Extract all figure IDs from HTML content.
 * Looks for elements with IDs and class containing "figure" (figure/figures), or <figure> tags with IDs.
 */
function extractFigureIds(html: string): Set<string> {
  const $ = cheerio.load(html);
  const figureIds = new Set<string>();

  // Find all figures: <figure> tags, div.figure, div.figures, or any element with class containing "figure"
  // This handles: class="figure", class="figures", class="figure center wide", etc.
  $('[class*="figure"][id], figure[id]').each((_, element) => {
    const id = $(element).attr('id');
    if (id) {
      figureIds.add(id);
    }
  });

  // Also look for nested figures and subfigures (e.g., div.inner-fig with id)
  $('[class*="figure"] [id], figure [id]').each((_, element) => {
    const id = $(element).attr('id');
    if (id) {
      figureIds.add(id);
    }
  });

  return figureIds;
}

/**
 * Fetch extended figure descriptions from a figdesc.html page.
 * Returns a map of figure IDs to their extended descriptions.
 * 
 * Strategy: First extract all figure IDs from the article content,
 * then look for those specific IDs in the figdesc.html page.
 */
async function fetchExtendedFigureDescriptions(articleUrl: string, articleHtml: string): Promise<Map<string, string>> {
  const figDescUrl = `${articleUrl}figdesc.html`;
  const descriptions = new Map<string, string>();

  // Extract figure IDs from the main article
  const figureIds = extractFigureIds(articleHtml);

  if (figureIds.size === 0) {
    // No figures in the article
    return descriptions;
  }

  try {
    const response = await fetch(figDescUrl);
    if (!response.ok) {
      // No figdesc.html page exists
      return descriptions;
    }

    const text = await response.text();
    const $ = cheerio.load(text);

    // For each figure ID from the article, try to find its description in figdesc.html
    for (const figId of figureIds) {
      const $element = $(`#${figId}`);

      if ($element.length === 0) continue;

      let description = '';

      // Strategy 1: If the element is a container (div, section), get its content
      if ($element.is('div, section, article')) {
        description = $element.html() || '';
      }
      // Strategy 2: If it's a heading, get content until the next heading or figure section
      else if ($element.is('h1, h2, h3, h4, h5, h6')) {
        let nextElement = $element.next();

        while (nextElement.length > 0) {
          // Stop at the next heading
          if (nextElement.is('h1, h2, h3, h4, h5, h6')) {
            break;
          }
          // Stop at the next figure section (any element with an ID from our list)
          const nextId = nextElement.attr('id');
          if (nextId && figureIds.has(nextId)) {
            break;
          }

          description += $.html(nextElement) + '\n';
          nextElement = nextElement.next();
        }
      }
      // Strategy 3: Get the parent container and its content
      else {
        const $parent = $element.parent();
        if ($parent.length > 0) {
          description = $parent.html() || '';
        }
      }

      if (description.trim()) {
        descriptions.set(figId, description.trim());
      }
    }

  } catch (error) {
    // Silently fail - extended descriptions are optional
    console.warn(`Could not fetch extended figure descriptions from ${figDescUrl}`);
  }

  return descriptions;
}

/**
 * Extract the best available description for a figure.
 * Priority: extended description > short caption > alt text
 */
function extractFigureDescription(
  $figure: cheerio.Cheerio<any>,
  figId: string | undefined,
  extendedDescriptions: Map<string, string>,
  $: cheerio.CheerioAPI
): string {
  // 1. Try extended description
  if (figId && extendedDescriptions.has(figId)) {
    return extendedDescriptions.get(figId)!;
  }

  // 2. Try short caption (figcaption tag or figlabel span or center p with text)
  const figcaption = $figure.find('figcaption').text().trim();
  if (figcaption) {
    return figcaption;
  }

  const figlabel = $figure.find('.figlabel').parent().text().trim();
  if (figlabel) {
    // Remove the link text about extended description
    return figlabel.replace(/\[An?\s+extended description[^\]]*\]/gi, '').trim();
  }

  const centerCaption = $figure.find('p.center, .center p').first().text().trim();
  if (centerCaption) {
    return centerCaption.replace(/\[An?\s+extended description[^\]]*\]/gi, '').trim();
  }

  // 3. Fallback to alt text from images
  const altTexts: string[] = [];
  $figure.find('img[alt]').each((_, img) => {
    const alt = $(img).attr('alt')?.trim();
    if (alt) altTexts.push(alt);
  });

  if (altTexts.length > 0) {
    return altTexts.join('; ');
  }

  return '';
}

/**
 * Process figures in article content: extract descriptions and normalize HTML.
 * Fetches extended descriptions from figdesc.html if available, then replaces
 * complex figure HTML with standardized <figure><figcaption>...</figcaption></figure>.
 * 
 * @param html - The HTML content containing figures
 * @param articleUrl - The base URL of the article (for fetching figdesc.html)
 * @returns HTML with normalized figure elements
 */
async function processFiguresInContent(
  html: string,
  articleUrl: string
): Promise<string> {
  const $ = cheerio.load(html);
  const extendedDescriptions = await fetchExtendedFigureDescriptions(articleUrl, html);

  // Find all figures - SEP uses various patterns: div.figure, div.figures, <figure> tag
  // Use attribute contains selector to match class="figure", class="figures", class="figure center wide", etc.
  $('[class*="figure"], figure').each((_, element) => {
    const $fig = $(element);
    const figId = $fig.attr('id');

    const description = extractFigureDescription($fig, figId, extendedDescriptions, $);

    // Replace with normalized figure HTML
    if (description) {
      $fig.replaceWith(`<figure data-figid="${figId || ''}"><figcaption>${description}</figcaption></figure>`);
    } else {
      // No description available - use a generic placeholder
      $fig.replaceWith(`<figure data-figid="${figId || ''}"><figcaption>Figure</figcaption></figure>`);
    }
  });

  return $.html();
}

// ============================================================================
// ARTICLE FETCHING
// ============================================================================

/**
 * Fetch and parse an article from the Stanford Encyclopedia of Philosophy.
 * 
 * @param id - The article ID (e.g., "wittgenstein", "logic-propositional")
 * @returns Parsed article with metadata, preamble, sections, and related articles
 * @throws Error if the article cannot be fetched or parsed
 */
async function fetchArticleContent(id: ArticleID): Promise<Article> {
  const url = `${baseArticleURL}${id}/`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch article ${id}: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const $ = cheerio.load(text);

  const title = $('meta[name="DC.title"]').attr('content') || 'No Title';
  const originalTitle = title;

  const authors: string[] = [];
  $('meta[name="DC.creator"]').each((_, element) => {
    const author = $(element).attr('content');
    if (author) authors.push(author);
  });

  const preamble = $('#preamble').html() || '';

  const sections: ArticleSection[] = [];

  $('#main-text h2, #main-text h3, #main-text h4, #main-text h5, #main-text h6').each((_, element) => {
    // content e.g. "2.2.2.4 Completeness as semi-decidability" -> heading = "Completeness as semi-decidability"
    const fullHeading = $(element).text().trim();
    const numberMatch = fullHeading.match(/^([\d.]+)\s+/);
    const number = numberMatch ? numberMatch[1].trim().replace(/\.$/, "") : '';
    const heading = number ? fullHeading.slice(number.length).replace(/^\./, "").trim() : fullHeading;

    // shortName = element id
    const shortName = $(element).attr('id') || '';

    let content = '';
    let nextSibling = (element as any).nextSibling;

    while (nextSibling) {
      // Check if it's a heading element (stop here)
      if (nextSibling.type === 'tag') {
        const tagName = (nextSibling as any).name?.toLowerCase();
        if (tagName && ['h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
          break;
        }
      }

      // Add the node (element or text node) to content
      const $sibling = $(nextSibling);
      if (nextSibling.type === 'text') {
        // For text nodes, preserve the raw text
        const textContent = nextSibling.data || '';
        content += textContent;
      } else {
        // For element nodes, get the full HTML
        content += $.html($sibling);
      }

      nextSibling = nextSibling.nextSibling;
    }

    // some sections may be empty (e.g. a heading with subheadings but no content of its own)
    if (!content.trim()) return;

    sections.push({
      shortName,
      number,
      heading,
      content
    });
  });

  // Process figures in preamble and sections to normalize them
  const processedPreamble = await processFiguresInContent(preamble, url);
  const processedSections = await Promise.all(
    sections.map(async (section) => ({
      ...section,
      content: await processFiguresInContent(section.content, url)
    }))
  );

  const related: ArticleID[] = [];
  $('#related-entries a').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;
    const id = href.replace(/[\.\/]/g, "") as ArticleID; // "../russell/" -> "russell"
    if (id) related.push(id);
  });

  return {
    id,
    title: normaliseText(title),
    originalTitle,
    authors,
    preamble: processedPreamble,
    sections: processedSections,
    related
  };
}

/**
 * Process an article section: preprocess the content and chunk it semantically.
 * Returns chunks in both retrieval and generation formats.
 * 
 * @param section - The article section to process
 * @param articleTitle - The title of the article (for context in table descriptions)
 * @param maxTokens - Maximum tokens per chunk (default: 1024)
 * @returns Array of ProcessedChunk objects with both formats
 */
async function processArticleSectionDual(
  section: ArticleSection,
  articleTitle: string,
  maxTokens: number = 1024
): Promise<ProcessedChunk[]> {
  const sectionHeading = section.number ? `${section.number} ${section.heading}` : section.heading;

  // Itemize the section content into stable block-level items
  const items = splitHtmlIntoItems(section.content);

  // Convert all items to dual formats (retrieval/generation) in parallel
  const dualResults = await batchPreprocessItemsDual(items, articleTitle, sectionHeading);

  // Extract aligned retrieval and generation units
  const retrievalUnits: string[] = [];
  const generationUnits: string[] = [];

  for (const dual of dualResults) {
    const r = dual.retrieval.trim();
    const g = dual.generation.trim();
    if (r.length > 0 || g.length > 0) {
      // Maintain alignment even if one side is empty; prefer skipping only if both are empty
      retrievalUnits.push(r);
      generationUnits.push(g);
    }
  }

  // Greedy chunking driven by retrieval units; apply same boundaries to generation
  const chunks: ProcessedChunk[] = [];
  let currentRetrievalChunk = '';
  let currentGenerationChunk = '';
  let currentTokenCount = 0;

  for (let i = 0; i < retrievalUnits.length; i++) {
    const rUnit = retrievalUnits[i];
    const gUnit = generationUnits[i] ?? '';
    const unitTokens = tokenize(rUnit).length;

    if (currentTokenCount + unitTokens > maxTokens && currentRetrievalChunk.length > 0) {
      chunks.push({
        retrievalText: currentRetrievalChunk.trim(),
        generationText: currentGenerationChunk.trim(),
        tokenCount: currentTokenCount
      });
      currentRetrievalChunk = '';
      currentGenerationChunk = '';
      currentTokenCount = 0;
    }

    if (currentRetrievalChunk.length > 0) {
      currentRetrievalChunk += '\n\n' + rUnit;
      currentGenerationChunk += '\n\n' + gUnit;
    } else {
      currentRetrievalChunk = rUnit;
      currentGenerationChunk = gUnit;
    }
    currentTokenCount += unitTokens;

    if (unitTokens > maxTokens && currentRetrievalChunk === rUnit) {
      // Oversized single unit -> its own chunk
      chunks.push({
        retrievalText: currentRetrievalChunk.trim(),
        generationText: currentGenerationChunk.trim(),
        tokenCount: unitTokens
      });
      currentRetrievalChunk = '';
      currentGenerationChunk = '';
      currentTokenCount = 0;
    }
  }

  if (currentRetrievalChunk.trim().length > 0) {
    chunks.push({
      retrievalText: currentRetrievalChunk.trim(),
      generationText: currentGenerationChunk.trim(),
      tokenCount: currentTokenCount
    });
  }

  return chunks;
}

// ============================================================================
// SECTION ITEM PROCESSING
// ============================================================================

/**
 * Split HTML into semantic items (paragraphs, lists, tables, figures, etc.)
 */
function splitHtmlIntoItems(html: string): SectionItem[] {
  const items: SectionItem[] = [];
  // Wrap the fragment so we can reliably iterate top-level nodes
  const $ = cheerio.load(`<div id="__root__">${html}</div>`);
  const $root = $('#__root__');

  $root.contents().each((_, node) => {
    // Text node handling: turn significant text into a paragraph
    if (node.type === 'text') {
      const text = (node.data || '').trim();
      if (text.length > 0) {
        // Preserve the raw text content, especially for TeX notation
        // Use a cheerio element to properly encode the text
        const $p = $('<p></p>').text(text);
        items.push({ kind: 'paragraph', html: $.html($p) });
      }
      return;
    }

    if (node.type !== 'tag') {
      return;
    }

    const tag = (node as any).name?.toLowerCase?.() as string | undefined;
    if (!tag) return;

    const $node = $(node as any);

    if (tag === 'p') {
      items.push({ kind: 'paragraph', html: $.html($node) });
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      items.push({ kind: 'list', html: $.html($node) });
      return;
    }
    if (tag === 'table') {
      items.push({ kind: 'table', html: $.html($node) });
      return;
    }
    if (tag === 'pre') {
      items.push({ kind: 'pre', html: $.html($node) });
      return;
    }
    if (tag === 'blockquote') {
      items.push({ kind: 'blockquote', html: $.html($node) });
      return;
    }
    if (tag === 'figure') {
      items.push({ kind: 'figure', html: $.html($node) });
      return;
    }

    if (tag === 'div' || tag === 'section') {
      // Check if this div is actually a figure (SEP uses div.figure, div.figures, etc.)
      // Check if class attribute contains "figure"
      const classAttr = $node.attr('class') || '';
      if (classAttr.includes('figure')) {
        items.push({ kind: 'figure', html: $.html($node) });
        return;
      }

      // Try to lift contained block items (table/list/figure) if present directly as children
      const directTable = $node.children('table').first();
      if (directTable.length > 0) {
        items.push({ kind: 'table', html: $.html(directTable) });
        return;
      }
      const directList = $node.children('ul,ol').first();
      if (directList.length > 0) {
        items.push({ kind: 'list', html: $.html(directList) });
        return;
      }
      const directFigure = $node.children('figure').first();
      if (directFigure.length > 0) {
        items.push({ kind: 'figure', html: $.html(directFigure) });
        return;
      }
      // Fallback: treat as paragraph-ish container content
      items.push({ kind: 'paragraph', html: $.html($node) });
      return;
    }

    // Default case
    items.push({ kind: 'other', html: $.html($node) });
  });

  return items;
}

/**
 * Preprocess a section item into dual formats for retrieval and generation.
 * 
 * Retrieval format:
 * - Normalized text without diacritics
 * - TeX converted to natural language
 * - Lists without markers
 * - Tables as natural language descriptions
 * 
 * Generation format:
 * - Preserves some formatting (list markers, markdown tables)
 * - TeX kept in readable format (symbols replaced)
 * - Better for LLM context
 * 
 * @param item - The section item to preprocess
 * @param articleTitle - Title of the article (for table context)
 * @param sectionHeading - Heading of the section (for table context)
 * @returns Object with retrieval and generation text
 */
async function preprocessItemDual(item: SectionItem, articleTitle: string, sectionHeading: string): Promise<{ retrieval: string; generation: string; }> {
  const { kind, html } = item;

  // Helpers to normalize whitespace at the end for consistency
  const finalize = (s: string) => {
    // Collapse whitespace but keep newlines
    return normaliseWhitespace(s, true);
  };

  if (kind === 'list') {
    // Retrieval: no markers; Generation: with markers
    // Start from original HTML to preserve structure within the list conversion
    let r = htmlListToTextList(html, false);
    let g = htmlListToTextList(html, true);

    r = stripHTMLTags(r);
    g = stripHTMLTags(g);

    r = normaliseText(r);
    r = await processTex(r, true);
    g = await processTex(g, false);

    return { retrieval: finalize(r), generation: finalize(g) };
  }

  if (kind === 'table') {
    // Extract the actual table HTML if wrapped
    const $ = cheerio.load(html);
    const $table = $('table').first();
    const tableHtml = $table.length > 0 ? $.html($table) : html;

    // Retrieval: GPT description (fallback to markdown -> plain text)
    let rDesc = await gptCreateTableDescription(tableHtml, articleTitle, sectionHeading);
    if (!rDesc) {
      // Fallback: markdown then strip to text
      const md = convertTableToMarkdown(tableHtml);
      rDesc = stripHTMLTags(md).replace(/[|`]/g, '').trim();
    }
    // Generation: markdown table
    const gMd = convertTableToMarkdown(tableHtml);

    // Process TeX
    let r = normaliseText(rDesc);
    r = await processTex(r, true);
    let g = await processTex(gMd, false);

    return { retrieval: finalize(r), generation: finalize(g) };
  }

  if (kind === 'figure') {
    const $ = cheerio.load(html);

    // Extract caption from figcaption (now standardized by processFiguresInContent)
    let caption = $('figcaption').html()?.trim() || '';

    // If no figcaption, fall back to checking for old-style figures
    if (!caption) {
      // Check for .figlabel or center paragraphs
      const figlabel = $('.figlabel').parent().html()?.trim() || '';
      if (figlabel) {
        caption = figlabel.replace(/\[An?\s+extended description[^\]]*\]/gi, '').trim();
      } else {
        const centerCaption = $('p.center, .center p').first().html()?.trim() || '';
        if (centerCaption) {
          caption = centerCaption.replace(/\[An?\s+extended description[^\]]*\]/gi, '').trim();
        } else {
          // Last resort: check alt text
          const altTexts: string[] = [];
          $('img[alt]').each((_, img) => {
            const alt = $(img).attr('alt')?.trim();
            if (alt) altTexts.push(alt);
          });
          if (altTexts.length > 0) {
            caption = altTexts.join('; ');
          }
        }
      }
    }

    // Process the caption: strip HTML tags but keep content
    // The caption may contain TeX, paragraphs, lists, etc. from extended descriptions
    let captionText = stripHTMLTags(caption);
    captionText = normaliseWhitespace(captionText, true);

    const rRaw = captionText ? `Figure: ${captionText}` : 'Figure';
    const gRaw = captionText ? `[Figure: ${captionText}]` : '[Figure]';

    let r = normaliseText(rRaw);
    r = await processTex(r, true);
    let g = await processTex(gRaw, false);

    return { retrieval: finalize(r), generation: finalize(g) };
  }

  if (kind === 'pre') {
    // Treat preformatted blocks as-is but strip tags; avoid losing structure
    let r = stripHTMLTags(html);
    let g = r; // identical content for generation
    r = normaliseText(r);
    r = await processTex(r, true);
    g = await processTex(g, false);
    return { retrieval: finalize(r), generation: finalize(g) };
  }

  // Paragraph, blockquote, and others fall back to generic text handling
  {
    let r = stripHTMLTags(html);
    let g = r; // same textual content, different TeX/diacritics handling below

    r = normaliseText(r);
    r = await processTex(r, true);
    g = await processTex(g, false);

    return { retrieval: finalize(r), generation: finalize(g) };
  }
}

/**
 * Batch preprocess multiple items in parallel with optimized GPT calls.
 * This is significantly faster than processing items sequentially.
 * 
 * @param items - Array of section items to preprocess
 * @param articleTitle - Title of the article (for table context)
 * @param sectionHeading - Heading of the section (for table context)
 * @returns Array of dual-format results in the same order as input items
 */
async function batchPreprocessItemsDual(
  items: SectionItem[],
  articleTitle: string,
  sectionHeading: string
): Promise<{ retrieval: string; generation: string; }[]> {
  if (items.length === 0) {
    return [];
  }

  // Helpers to normalize whitespace at the end for consistency
  const finalize = (s: string) => {
    return normaliseWhitespace(s, true);
  };

  // Phase 1: Prepare all items and identify what needs GPT processing
  type PreparedItem = {
    index: number;
    kind: ItemKind;
    retrieval: string;
    generation: string;
    needsRetrievalTexConversion: boolean;
    needsGenerationTexConversion: boolean;
  };

  const prepared: PreparedItem[] = [];
  const tablesToProcess: { index: number; html: string; }[] = [];

  for (let i = 0; i < items.length; i++) {
    const { kind, html } = items[i];

    if (kind === 'list') {
      let r = htmlListToTextList(html, false);
      let g = htmlListToTextList(html, true);
      r = stripHTMLTags(r);
      g = stripHTMLTags(g);
      r = normaliseText(r);

      const replacedR = replaceTexWithSymbols(r);
      const replacedG = replaceTexWithSymbols(g);

      prepared.push({
        index: i,
        kind,
        retrieval: replacedR,
        generation: replacedG,
        needsRetrievalTexConversion: TEX_PATTERN.test(replacedR),
        needsGenerationTexConversion: false // generation keeps TeX symbols
      });
    } else if (kind === 'table') {
      const $ = cheerio.load(html);
      const $table = $('table').first();
      const tableHtml = $table.length > 0 ? $.html($table) : html;

      tablesToProcess.push({ index: i, html: tableHtml });

      // Placeholder - will be filled after batch table processing
      prepared.push({
        index: i,
        kind,
        retrieval: '',
        generation: '',
        needsRetrievalTexConversion: false,
        needsGenerationTexConversion: false
      });
    } else if (kind === 'figure') {
      const $ = cheerio.load(html);
      let caption = $('figcaption').html()?.trim() || '';

      if (!caption) {
        const figlabel = $('.figlabel').parent().html()?.trim() || '';
        if (figlabel) {
          caption = figlabel.replace(/\[An?\s+extended description[^\]]*\]/gi, '').trim();
        } else {
          const centerCaption = $('p.center, .center p').first().html()?.trim() || '';
          if (centerCaption) {
            caption = centerCaption.replace(/\[An?\s+extended description[^\]]*\]/gi, '').trim();
          } else {
            const altTexts: string[] = [];
            $('img[alt]').each((_, img) => {
              const alt = $(img).attr('alt')?.trim();
              if (alt) altTexts.push(alt);
            });
            if (altTexts.length > 0) {
              caption = altTexts.join('; ');
            }
          }
        }
      }

      let captionText = stripHTMLTags(caption);
      captionText = normaliseWhitespace(captionText, true);

      const rRaw = captionText ? `Figure: ${captionText}` : 'Figure';
      const gRaw = captionText ? `[Figure: ${captionText}]` : '[Figure]';

      let r = normaliseText(rRaw);
      const replacedR = replaceTexWithSymbols(r);
      const replacedG = replaceTexWithSymbols(gRaw);

      prepared.push({
        index: i,
        kind,
        retrieval: replacedR,
        generation: replacedG,
        needsRetrievalTexConversion: TEX_PATTERN.test(replacedR),
        needsGenerationTexConversion: false
      });
    } else {
      // pre, paragraph, blockquote, other
      let r = stripHTMLTags(html);
      let g = r;
      r = normaliseText(r);

      const replacedR = replaceTexWithSymbols(r);
      const replacedG = replaceTexWithSymbols(g);

      prepared.push({
        index: i,
        kind,
        retrieval: replacedR,
        generation: replacedG,
        needsRetrievalTexConversion: TEX_PATTERN.test(replacedR),
        needsGenerationTexConversion: false
      });
    }
  }

  // Phase 2: Batch process all tables in parallel
  if (tablesToProcess.length > 0) {
    const tableHtmls = tablesToProcess.map(t => t.html);
    const tableDescriptions = await batchCreateTableDescriptions(tableHtmls, articleTitle, sectionHeading);

    for (let i = 0; i < tablesToProcess.length; i++) {
      const { index } = tablesToProcess[i];
      let rDesc = tableDescriptions[i];

      if (!rDesc) {
        const md = convertTableToMarkdown(tableHtmls[i]);
        rDesc = stripHTMLTags(md).replace(/[|`]/g, '').trim();
      }

      const gMd = convertTableToMarkdown(tableHtmls[i]);

      let r = normaliseText(rDesc);
      const replacedR = replaceTexWithSymbols(r);
      const replacedG = replaceTexWithSymbols(gMd);

      prepared[index].retrieval = replacedR;
      prepared[index].generation = replacedG;
      prepared[index].needsRetrievalTexConversion = TEX_PATTERN.test(replacedR);
      prepared[index].needsGenerationTexConversion = false;
    }
  }

  // Phase 3: Batch process all TeX conversions in parallel
  const texConversionsNeeded = prepared.filter(p => p.needsRetrievalTexConversion);

  if (texConversionsNeeded.length > 0) {
    const texInputs = texConversionsNeeded.map(p => p.retrieval);
    const texOutputs = await batchConvertTexToText(texInputs, articleTitle, sectionHeading);

    for (let i = 0; i < texConversionsNeeded.length; i++) {
      const preparedIndex = prepared.findIndex(p => p.index === texConversionsNeeded[i].index);
      if (preparedIndex !== -1) {
        prepared[preparedIndex].retrieval = texOutputs[i];
      }
    }
  }

  // Phase 4: Finalize and return results in original order
  return prepared.map(p => ({
    retrieval: finalize(p.retrieval),
    generation: finalize(p.generation)
  }));
}

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

/**
 * Set the article ID to test (e.g., "logic-propositional", "consciousness", "kant")
 * Find article IDs in URLs like: https://plato.stanford.edu/entries/logic-propositional/
 */
const TEST_ARTICLE_ID = "logic-propositional"; // <-- CHANGE THIS TO TEST DIFFERENT ARTICLES

/**
 * Maximum tokens per chunk (default: 1024)
 */
const MAX_TOKENS_PER_CHUNK = 1024;

/**
 * Output directory for test results
 */
const OUTPUT_DIR = "./test_output";

// ============================================================================
// TEST RUNNER
// ============================================================================

async function testArticleProcessing(articleId: string) {
  console.log('\n' + '='.repeat(80));
  console.log(`TESTING ARTICLE: ${articleId}`);
  console.log('='.repeat(80) + '\n');

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const startTime = Date.now();

  try {
    // Step 1: Fetch article
    console.log(`\n[1/4] Fetching article "${articleId}"...`);
    const article = await fetchArticleContent(articleId as ArticleID);
    console.log(`✓ Fetched article: "${article.title}" (${article.originalTitle})`);
    console.log(`  Authors: ${article.authors.join(', ')}`);
    console.log(`  Sections: ${article.sections.length}`);
    console.log(`  Related articles: ${article.related.length}`);

    // Step 2: Process preamble (always keep as single chunk)
    console.log(`\n[2/4] Processing preamble...`);
    const preambleChunks = await processArticleSectionDual(
      {
        shortName: 'preamble',
        number: '',
        heading: 'Preamble',
        content: article.preamble
      },
      article.title,
      Infinity // Use Infinity to ensure preamble is never split
    );
    console.log(`✓ Preamble kept as single chunk (${preambleChunks[0]?.tokenCount || 0} tokens)`);

    // Step 3: Process all sections
    console.log(`\n[3/4] Processing ${article.sections.length} section(s)...`);
    const allSectionChunks: {
      section: ArticleSection;
      chunks: ProcessedChunk[];
    }[] = [];

    for (let i = 0; i < article.sections.length; i++) {
      const section = article.sections[i];
      const sectionLabel = section.number
        ? `${section.number} ${section.heading}`
        : section.heading;

      console.log(`  [${i + 1}/${article.sections.length}] Processing: ${sectionLabel}...`);

      const chunks = await processArticleSectionDual(
        section,
        article.title,
        MAX_TOKENS_PER_CHUNK
      );

      allSectionChunks.push({ section, chunks });
      console.log(`    → ${chunks.length} chunk(s) | ${chunks.reduce((sum, c) => sum + c.tokenCount, 0)} total tokens`);
    }

    // Step 4: Generate output files
    console.log(`\n[4/4] Writing output files...`);

    // Create article-specific output directory
    const articleDir = `${OUTPUT_DIR}/${articleId}`;
    if (!fs.existsSync(articleDir)) {
      fs.mkdirSync(articleDir, { recursive: true });
    }

    // Write article metadata
    const metadata = {
      id: article.id,
      title: article.title,
      originalTitle: article.originalTitle,
      authors: article.authors,
      related: article.related,
      sectionCount: article.sections.length,
      totalChunks: preambleChunks.length + allSectionChunks.reduce((sum, s) => sum + s.chunks.length, 0),
      maxTokensPerChunk: MAX_TOKENS_PER_CHUNK,
      processedAt: new Date().toISOString()
    };
    fs.writeFileSync(`${articleDir}/metadata.json`, JSON.stringify(metadata, null, 2));
    console.log(`  ✓ metadata.json`);

    // Write preamble chunks
    if (preambleChunks.length > 0) {
      const preambleOutput = {
        section: "Preamble",
        chunks: preambleChunks.map((c, i) => ({
          chunkNumber: i + 1,
          tokenCount: c.tokenCount,
          retrievalText: c.retrievalText,
          generationText: c.generationText
        }))
      };
      fs.writeFileSync(`${articleDir}/preamble.json`, JSON.stringify(preambleOutput, null, 2));
      console.log(`  ✓ preamble.json (${preambleChunks.length} chunks)`);
    }

    // Write section chunks
    for (let i = 0; i < allSectionChunks.length; i++) {
      const { section, chunks } = allSectionChunks[i];
      const filename = section.shortName
        ? `section_${i + 1}_${section.shortName}.json`
        : `section_${i + 1}.json`;

      const sectionOutput = {
        sectionNumber: section.number,
        sectionHeading: section.heading,
        shortName: section.shortName,
        chunks: chunks.map((c, j) => ({
          chunkNumber: j + 1,
          tokenCount: c.tokenCount,
          retrievalText: c.retrievalText,
          generationText: c.generationText
        }))
      };

      fs.writeFileSync(`${articleDir}/${filename}`, JSON.stringify(sectionOutput, null, 2));
      console.log(`  ✓ ${filename} (${chunks.length} chunks)`);
    }

    // Write complete article (all chunks in one file)
    const completeOutput = {
      metadata,
      preamble: preambleChunks.map((c, i) => ({
        section: "Preamble",
        chunkNumber: i + 1,
        tokenCount: c.tokenCount,
        retrievalText: c.retrievalText,
        generationText: c.generationText
      })),
      sections: allSectionChunks.map(({ section, chunks }) => ({
        sectionNumber: section.number,
        sectionHeading: section.heading,
        shortName: section.shortName,
        chunks: chunks.map((c, i) => ({
          chunkNumber: i + 1,
          tokenCount: c.tokenCount,
          retrievalText: c.retrievalText,
          generationText: c.generationText
        }))
      }))
    };
    fs.writeFileSync(`${articleDir}/complete.json`, JSON.stringify(completeOutput, null, 2));
    console.log(`  ✓ complete.json (full article)`);

    // Write human-readable summary
    let summary = `ARTICLE PROCESSING SUMMARY\n`;
    summary += `${'='.repeat(80)}\n\n`;
    summary += `Article ID: ${article.id}\n`;
    summary += `Title: ${article.title}\n`;
    summary += `Original Title: ${article.originalTitle}\n`;
    summary += `Authors: ${article.authors.join(', ')}\n`;
    summary += `Related Articles: ${article.related.length}\n`;
    summary += `Processed: ${new Date().toISOString()}\n`;
    summary += `Max Tokens/Chunk: ${MAX_TOKENS_PER_CHUNK}\n`;
    summary += `\n${'-'.repeat(80)}\n\n`;

    summary += `PREAMBLE:\n`;
    summary += `  Chunks: ${preambleChunks.length}\n`;
    summary += `  Total Tokens: ${preambleChunks.reduce((sum, c) => sum + c.tokenCount, 0)}\n\n`;

    summary += `SECTIONS (${article.sections.length}):\n\n`;
    allSectionChunks.forEach(({ section, chunks }, i) => {
      const sectionLabel = section.number
        ? `${section.number} ${section.heading}`
        : section.heading;
      const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);
      summary += `  ${i + 1}. ${sectionLabel}\n`;
      summary += `     Chunks: ${chunks.length} | Tokens: ${totalTokens}\n`;
    });

    summary += `\n${'-'.repeat(80)}\n\n`;
    summary += `TOTALS:\n`;
    summary += `  Total Chunks: ${metadata.totalChunks}\n`;
    summary += `  Total Tokens: ${preambleChunks.reduce((sum, c) => sum + c.tokenCount, 0) + allSectionChunks.reduce((sum, s) => sum + s.chunks.reduce((s2, c) => s2 + c.tokenCount, 0), 0)}\n`;

    fs.writeFileSync(`${articleDir}/SUMMARY.txt`, summary);
    console.log(`  ✓ SUMMARY.txt`);

    // Write sample chunks for inspection
    const sampleChunks = [];
    if (preambleChunks.length > 0) {
      sampleChunks.push({
        location: 'Preamble - Chunk 1',
        ...preambleChunks[0]
      });
    }
    if (allSectionChunks.length > 0 && allSectionChunks[0].chunks.length > 0) {
      const firstSection = allSectionChunks[0];
      sampleChunks.push({
        location: `${firstSection.section.number || 'Section 1'} ${firstSection.section.heading} - Chunk 1`,
        ...firstSection.chunks[0]
      });
    }

    let samplesText = `SAMPLE CHUNKS FOR INSPECTION\n`;
    samplesText += `${'='.repeat(80)}\n\n`;

    sampleChunks.forEach((sample, i) => {
      samplesText += `${'='.repeat(80)}\n`;
      samplesText += `SAMPLE ${i + 1}: ${sample.location}\n`;
      samplesText += `Tokens: ${sample.tokenCount}\n`;
      samplesText += `${'='.repeat(80)}\n\n`;

      samplesText += `RETRIEVAL FORMAT (for embedding/search):\n`;
      samplesText += `${'-'.repeat(80)}\n`;
      samplesText += sample.retrievalText + '\n\n';

      samplesText += `GENERATION FORMAT (for LLM context):\n`;
      samplesText += `${'-'.repeat(80)}\n`;
      samplesText += sample.generationText + '\n\n\n';
    });

    fs.writeFileSync(`${articleDir}/SAMPLES.txt`, samplesText);
    console.log(`  ✓ SAMPLES.txt (${sampleChunks.length} sample chunks)`);

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n' + '='.repeat(80));
    console.log('SUCCESS!');
    console.log('='.repeat(80));
    console.log(`\nProcessed ${article.title} in ${elapsedTime}s`);
    console.log(`Output directory: ${articleDir}`);
    console.log(`\nFiles created:`);
    console.log(`  • metadata.json - Article metadata and statistics`);
    console.log(`  • complete.json - All chunks in one file`);
    console.log(`  • preamble.json - Preamble chunks`);
    console.log(`  • section_*.json - Individual section chunks`);
    console.log(`  • SUMMARY.txt - Human-readable summary`);
    console.log(`  • SAMPLES.txt - Sample chunks for inspection\n`);

  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('ERROR DURING PROCESSING');
    console.error('='.repeat(80));
    console.error(error);
    process.exit(1);
  }
}

// Run test with configured article
testArticleProcessing(TEST_ARTICLE_ID);