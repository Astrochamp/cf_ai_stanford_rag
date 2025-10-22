import * as cheerio from 'cheerio';
import 'dotenv/config';
import { encode as tokenize } from 'gpt-tokenizer';
import { decode as htmlDecode } from 'html-entities';
import OpenAI from 'openai';
import texToUnicodeMap from '../data/tex-unicode-map.json';
import { fetchExtendedFigureDescriptions } from './fetch';
import {
  EXCLUDED_TEX_COMMANDS,
  NESTED_LIST_END_PLACEHOLDER,
  NESTED_LIST_PLACEHOLDER,
  TABLE_REGEX,
  TEX_PATTERN
} from './shared/constants';
import type {
  ArticleSection,
  ItemKind,
  ProcessedChunk,
  SectionItem
} from './shared/types';
import { normaliseText, normaliseWhitespace } from './shared/utils';



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
  const mathExpressionRegex = /(?:\\\(|\\\[)(.*?)(?:\\\)|\\\])/gs;

  // Unicode mappings for font commands
  const mathcalMap: Record<string, string> = {
    'A': '𝒜', 'B': '𝐵', 'C': '𝒞', 'D': '𝒟', 'E': '𝐸', 'F': '𝐹', 'G': '𝒢',
    'H': '𝐻', 'I': '𝐼', 'J': '𝒥', 'K': '𝒦', 'L': '𝐿', 'M': '𝑀', 'N': '𝒩',
    'O': '𝒪', 'P': '𝒫', 'Q': '𝒬', 'R': '𝑅', 'S': '𝒮', 'T': '𝒯', 'U': '𝒰',
    'V': '𝒱', 'W': '𝒲', 'X': '𝒳', 'Y': '𝒴', 'Z': '𝒵'
  };

  const mathbbMap: Record<string, string> = {
    'A': '𝔸', 'B': '𝔹', 'C': 'ℂ', 'D': '𝔻', 'E': '𝔼', 'F': '𝔽', 'G': '𝔾',
    'H': 'ℍ', 'I': '𝕀', 'J': '𝕁', 'K': '𝕂', 'L': '𝕃', 'M': '𝕄', 'N': 'ℕ',
    'O': '𝕆', 'P': 'ℙ', 'Q': 'ℚ', 'R': 'ℝ', 'S': '𝕊', 'T': '𝕋', 'U': '𝕌',
    'V': '𝕍', 'W': '𝕎', 'X': '𝕏', 'Y': '𝕐', 'Z': 'ℤ'
  };

  const mathbfMap: Record<string, string> = {
    'A': '𝐀', 'B': '𝐁', 'C': '𝐂', 'D': '𝐃', 'E': '𝐄', 'F': '𝐅', 'G': '𝐆',
    'H': '𝐇', 'I': '𝐈', 'J': '𝐉', 'K': '𝐊', 'L': '𝐋', 'M': '𝐌', 'N': '𝐍',
    'O': '𝐎', 'P': '𝐏', 'Q': '𝐐', 'R': '𝐑', 'S': '𝐒', 'T': '𝐓', 'U': '𝐔',
    'V': '𝐕', 'W': '𝐖', 'X': '𝐗', 'Y': '𝐘', 'Z': '𝐙',
    'a': '𝐚', 'b': '𝐛', 'c': '𝐜', 'd': '𝐝', 'e': '𝐞', 'f': '𝐟', 'g': '𝐠',
    'h': '𝐡', 'i': '𝐢', 'j': '𝐣', 'k': '𝐤', 'l': '𝐥', 'm': '𝐦', 'n': '𝐧',
    'o': '𝐨', 'p': '𝐩', 'q': '𝐪', 'r': '𝐫', 's': '𝐬', 't': '𝐭', 'u': '𝐮',
    'v': '𝐯', 'w': '𝐰', 'x': '𝐱', 'y': '𝐲', 'z': '𝐳'
  };

  const mathitMap: Record<string, string> = {
    'A': '𝐴', 'B': '𝐵', 'C': '𝐶', 'D': '𝐷', 'E': '𝐸', 'F': '𝐹', 'G': '𝐺',
    'H': '𝐻', 'I': '𝐼', 'J': '𝐽', 'K': '𝐾', 'L': '𝐿', 'M': '𝑀', 'N': '𝑁',
    'O': '𝑂', 'P': '𝑃', 'Q': '𝑄', 'R': '𝑅', 'S': '𝑆', 'T': '𝑇', 'U': '𝑈',
    'V': '𝑉', 'W': '𝑊', 'X': '𝑋', 'Y': '𝑌', 'Z': '𝑍',
    'a': '𝑎', 'b': '𝑏', 'c': '𝑐', 'd': '𝑑', 'e': '𝑒', 'f': '𝑓', 'g': '𝑔',
    'h': 'ℎ', 'i': '𝑖', 'j': '𝑗', 'k': '𝑘', 'l': '𝑙', 'm': '𝑚', 'n': '𝑛',
    'o': '𝑜', 'p': '𝑝', 'q': '𝑞', 'r': '𝑟', 's': '𝑠', 't': '𝑡', 'u': '𝑢',
    'v': '𝑣', 'w': '𝑤', 'x': '𝑥', 'y': '𝑦', 'z': '𝑧'
  };

  const mathsfMap: Record<string, string> = {
    'A': '𝖠', 'B': '𝖡', 'C': '𝖢', 'D': '𝖣', 'E': '𝖤', 'F': '𝖥', 'G': '𝖦',
    'H': '𝖧', 'I': '𝖨', 'J': '𝖩', 'K': '𝖪', 'L': '𝖫', 'M': '𝖬', 'N': '𝖭',
    'O': '𝖮', 'P': '𝖯', 'Q': '𝖰', 'R': '𝖱', 'S': '𝖲', 'T': '𝖳', 'U': '𝖴',
    'V': '𝖵', 'W': '𝖶', 'X': '𝖷', 'Y': '𝖸', 'Z': '𝖹',
    'a': '𝖺', 'b': '𝖻', 'c': '𝖼', 'd': '𝖽', 'e': '𝖾', 'f': '𝖿', 'g': '𝗀',
    'h': '𝗁', 'i': '𝗂', 'j': '𝗃', 'k': '𝗄', 'l': '𝗅', 'm': '𝗆', 'n': '𝗇',
    'o': '𝗈', 'p': '𝗉', 'q': '𝗊', 'r': '𝗋', 's': '𝗌', 't': '𝗍', 'u': '𝗎',
    'v': '𝗏', 'w': '𝗐', 'x': '𝗑', 'y': '𝗒', 'z': '𝗓'
  };

  return text.replace(mathExpressionRegex, (originalMatch, content) => {
    let processedContent = content;

    // Handle font commands FIRST (before general symbol replacement)

    // Handle \text{...} command - just extract the content as plain text
    processedContent = processedContent.replace(/\\text\{([^}]*)\}/g, (match: string, text: string) => {
      // Replace escaped spaces with normal spaces
      return text.replace(/\\ /g, ' ').replace(/\\\n/g, ' ');
    });

    // Helper function to convert multi-character content with per-character font mapping
    const convertWithFontMap = (content: string, fontMap: Record<string, string>): string => {
      return content.split('').map(char => fontMap[char] || char).join('');
    };

    // Helper function to clean up multi-character content (spaces, newlines)
    const cleanMultiCharContent = (content: string): string => {
      return content.replace(/\\ /g, ' ').replace(/\\\n/g, ' ').replace(/\s+/g, ' ').trim();
    };

    // Convert \mathcal{X} -> Unicode Mathematical Script (uppercase only)
    // Single letter: use map, multiple chars: convert each letter
    processedContent = processedContent.replace(/\\mathcal\{([^}]*)\}/g, (match: string, content: string) => {
      const cleaned = cleanMultiCharContent(content);
      return cleaned.split('').map(char => {
        const upper = char.toUpperCase();
        return mathcalMap[upper] || char;
      }).join('');
    });

    // Convert \mathbb{X} -> Unicode Mathematical Double-Struck (uppercase only)
    processedContent = processedContent.replace(/\\mathbb\{([^}]*)\}/g, (match: string, content: string) => {
      const cleaned = cleanMultiCharContent(content);
      return cleaned.split('').map(char => {
        const upper = char.toUpperCase();
        return mathbbMap[upper] || char;
      }).join('');
    });

    // Convert \mathbf{...} -> Unicode Mathematical Bold
    processedContent = processedContent.replace(/\\mathbf\{([^}]*)\}/g, (match: string, content: string) => {
      const cleaned = cleanMultiCharContent(content);
      return convertWithFontMap(cleaned, mathbfMap);
    });

    // Convert \mathit{...} -> Unicode Mathematical Italic
    processedContent = processedContent.replace(/\\mathit\{([^}]*)\}/g, (match: string, content: string) => {
      const cleaned = cleanMultiCharContent(content);
      return convertWithFontMap(cleaned, mathitMap);
    });

    // Convert \mathsf{...} -> Unicode Mathematical Sans-Serif
    processedContent = processedContent.replace(/\\mathsf\{([^}]*)\}/g, (match: string, content: string) => {
      const cleaned = cleanMultiCharContent(content);
      return convertWithFontMap(cleaned, mathsfMap);
    });

    // Convert \mathrm{...} -> just extract (upright/roman is default, no special Unicode)
    processedContent = processedContent.replace(/\\mathrm\{([^}]*)\}/g, (match: string, content: string) => {
      return cleanMultiCharContent(content);
    });

    // Handle \not\command patterns (negated relations)
    // \not\models -> ⊭, \not\in -> ∉, \not\equiv -> ≢, etc.
    const notCombinations: Record<string, string> = {
      'models': '⊭',
      'in': '∉',
      'equiv': '≢',
      'sim': '≁',
      'simeq': '≄',
      'approx': '≉',
      'cong': '≇',
      'subset': '⊄',
      'supset': '⊅',
      'subseteq': '⊈',
      'supseteq': '⊉',
      'exists': '∄'
    };

    processedContent = processedContent.replace(/\\not\\([a-zA-Z]+)/g, (match: string, command: string) => {
      return notCombinations[command] || `¬${texMap[command] || match}`;
    });

    // Handle \sqrt{...} - extract just the content with "sqrt(...)" format
    processedContent = processedContent.replace(/\\sqrt\{([^}]*)\}/g, (match: string, content: string) => {
      const cleaned = cleanMultiCharContent(content);
      return `√(${cleaned})`;
    });

    // Replace TeX symbols with Unicode equivalents
    const firstPassContent = processedContent.replace(texSymbolRegex, (match: string, command: string) => {
      if (EXCLUDED_TEX_COMMANDS.has(command) || !texMap[command]) {
        return match; // keep complex commands e.g \frac, \sum
      }
      return texMap[command]; // replace simple symbols
    });

    // Remove \left and \right 
    const withoutLeftRight = firstPassContent
      .replace(/\\left\b/g, '')
      .replace(/\\right\b/g, '');

    // replace "\rN" -> "N" and "\bT" -> "T"
    const customTypesetRegex = /\\[rb]([A-Za-z])/g;
    const removedCustomTypeset: string = withoutLeftRight.replace(customTypesetRegex, (match: string, letter: string): string => letter);

    // Remove TeX spacing commands: \, \; \: \! \quad \qquad etc.
    // These are spacing commands that don't translate to Unicode symbols
    const spacingCommandsRemoved = removedCustomTypeset
      .replace(/\\ /g, ' ')      // escaped space
      .replace(/\\\n/g, ' ')     // escaped newline (used in mathsf/text)
      .replace(/\\,/g, ' ')      // thin space
      .replace(/\\;/g, ' ')      // thick space
      .replace(/\\:/g, ' ')      // medium space
      .replace(/\\!/g, '')       // negative thin space (remove)
      .replace(/\\quad\b/g, ' ') // quad space
      .replace(/\\qquad\b/g, ' '); // double quad space

    // clean up braces and loose backslashes
    processedContent = spacingCommandsRemoved
      .replace(/\\{/g, "{")
      .replace(/\\}/g, "}")
      .replace(/\s+\\\s+/g, ' ')
      .trim();

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
async function callGPTAPI(prompt: string, openai: OpenAI, fallbackText: string, logMessage: string): Promise<string> {
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
  openai: OpenAI,
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

async function gptConvertTexToText(text: string, openai: OpenAI, articleTitle = "", sectionHeading = ""): Promise<string> {
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
  return callGPTAPI(prompt, openai, text, 'Calling GPT to convert TeX to natural language');
};

/**
 * Batch process multiple TeX conversions in parallel.
 */
async function batchConvertTexToText(
  texts: string[],
  openai: OpenAI,
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
    openai,
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

async function gptCreateTableDescription(tableElem: string, openai: OpenAI, articleTitle = "", sectionHeading = ""): Promise<string> {
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
  return callGPTAPI(prompt, openai, "", 'Calling GPT to generate table description');
};

/**
 * Batch process multiple table descriptions in parallel.
 */
async function batchCreateTableDescriptions(
  tables: string[],
  openai: OpenAI,
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
    openai,
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

async function processTex(
  text: string,
  openai: OpenAI,
  forRetrieval: boolean = true,
  articleTitle: string = "",
  sectionHeading: string = ""
): Promise<string> {
  const replacedText = replaceTexWithSymbols(text);
  if (TEX_PATTERN.test(replacedText)) {
    if (forRetrieval) {
      // For retrieval, convert all TeX to natural language
      return await gptConvertTexToText(replacedText, openai, articleTitle, sectionHeading);
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

async function convertTablesToDescriptions(text: string, openai: OpenAI, articleTitle = "", sectionHeading = ""): Promise<string> {
  const tables = text.match(TABLE_REGEX);

  if (!tables || tables.length === 0) {
    return text;
  }

  let processedText = text;

  for (const table of tables) {
    const description = await gptCreateTableDescription(table, openai, articleTitle, sectionHeading);
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

// ============================================================================
// FIGURE PROCESSING
// ============================================================================

/**
 * Extract all figure IDs from HTML content.
 * Looks for elements with IDs and class containing "figure" (figure/figures), or <figure> tags with IDs.
 */
export function extractFigureIds(html: string): Set<string> {
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
export async function processFiguresInContent(
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

/**
 * Process an article section: preprocess the content and chunk it semantically.
 * Returns chunks in both retrieval and generation formats.
 * 
 * @param section - The article section to process
 * @param articleTitle - The title of the article (for context in table descriptions)
 * @param maxTokens - Maximum tokens per chunk (default: 1024)
 * @returns Array of ProcessedChunk objects with both formats
 */
export async function processArticleSectionDual(
  section: ArticleSection,
  articleTitle: string,
  openai: OpenAI,
  maxTokens: number = 1024
): Promise<ProcessedChunk[]> {
  const sectionHeading = section.number ? `${section.number} ${section.heading}` : section.heading;

  // Itemize the section content into stable block-level items
  const items = splitHtmlIntoItems(section.content);

  // Convert all items to dual formats (retrieval/generation) in parallel
  const dualResults = await batchPreprocessItemsDual(items, articleTitle, sectionHeading, openai);

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
async function preprocessItemDual(item: SectionItem, articleTitle: string, sectionHeading: string, openai: OpenAI): Promise<{ retrieval: string; generation: string; }> {
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
    r = await processTex(r, openai, true, articleTitle, sectionHeading);
    g = await processTex(g, openai, false, articleTitle, sectionHeading);

    return { retrieval: finalize(r), generation: finalize(g) };
  }

  if (kind === 'table') {
    // Extract the actual table HTML if wrapped
    const $ = cheerio.load(html);
    const $table = $('table').first();
    const tableHtml = $table.length > 0 ? $.html($table) : html;

    // Retrieval: GPT description (fallback to markdown -> plain text)
    let rDesc = await gptCreateTableDescription(tableHtml, openai, articleTitle, sectionHeading);
    if (!rDesc) {
      // Fallback: markdown then strip to text
      const md = convertTableToMarkdown(tableHtml);
      rDesc = stripHTMLTags(md).replace(/[|`]/g, '').trim();
    }
    // Generation: markdown table
    const gMd = convertTableToMarkdown(tableHtml);

    // Process TeX
    let r = normaliseText(rDesc);
    r = await processTex(r, openai, true, articleTitle, sectionHeading);
    let g = await processTex(gMd, openai, false, articleTitle, sectionHeading);

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
    r = await processTex(r, openai, true, articleTitle, sectionHeading);
    let g = await processTex(gRaw, openai, false, articleTitle, sectionHeading);

    return { retrieval: finalize(r), generation: finalize(g) };
  }

  if (kind === 'pre') {
    // Treat preformatted blocks as-is but strip tags; avoid losing structure
    let r = stripHTMLTags(html);
    let g = r; // identical content for generation
    r = normaliseText(r);
    r = await processTex(r, openai, true, articleTitle, sectionHeading);
    g = await processTex(g, openai, false, articleTitle, sectionHeading);
    return { retrieval: finalize(r), generation: finalize(g) };
  }

  // Paragraph, blockquote, and others fall back to generic text handling
  {
    let r = stripHTMLTags(html);
    let g = r; // same textual content, different TeX/diacritics handling below

    r = normaliseText(r);
    r = await processTex(r, openai, true, articleTitle, sectionHeading);
    g = await processTex(g, openai, false, articleTitle, sectionHeading);

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
  sectionHeading: string,
  openai: OpenAI
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
      // For generation, keep original TeX expressions (don't convert to Unicode)

      prepared.push({
        index: i,
        kind,
        retrieval: replacedR,
        generation: g,
        needsRetrievalTexConversion: TEX_PATTERN.test(replacedR),
        needsGenerationTexConversion: false // generation keeps original TeX
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
      // For generation, keep original TeX expressions

      prepared.push({
        index: i,
        kind,
        retrieval: replacedR,
        generation: gRaw,
        needsRetrievalTexConversion: TEX_PATTERN.test(replacedR),
        needsGenerationTexConversion: false
      });
    } else {
      // pre, paragraph, blockquote, other
      let r = stripHTMLTags(html);
      let g = r;
      r = normaliseText(r);

      const replacedR = replaceTexWithSymbols(r);
      // For generation, keep original TeX expressions

      prepared.push({
        index: i,
        kind,
        retrieval: replacedR,
        generation: g,
        needsRetrievalTexConversion: TEX_PATTERN.test(replacedR),
        needsGenerationTexConversion: false
      });
    }
  }

  // Phase 2: Batch process all tables in parallel
  if (tablesToProcess.length > 0) {
    const tableHtmls = tablesToProcess.map(t => t.html);
    const tableDescriptions = await batchCreateTableDescriptions(tableHtmls, openai, articleTitle, sectionHeading);

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
      // For generation, keep original TeX expressions in markdown table

      prepared[index].retrieval = replacedR;
      prepared[index].generation = gMd;
      prepared[index].needsRetrievalTexConversion = TEX_PATTERN.test(replacedR);
      prepared[index].needsGenerationTexConversion = false;
    }
  }

  // Phase 3: Batch process all TeX conversions in parallel
  const texConversionsNeeded = prepared.filter(p => p.needsRetrievalTexConversion);

  if (texConversionsNeeded.length > 0) {
    const texInputs = texConversionsNeeded.map(p => p.retrieval);
    const texOutputs = await batchConvertTexToText(texInputs, openai, articleTitle, sectionHeading);

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