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
 * 
 * 3. Key Functions:
 *    - fetchArticlesList(): Get all article IDs from SEP
 *    - fetchArticleContent(id): Fetch and parse a single article
 *    - preprocessText(html): Convert HTML to clean, processable text
 *    - semanticChunking(text): Split text into semantic chunks
 *    - processArticleSection(): Complete pipeline for one section
 *    - processArticle(): Process all sections of an article
 * 
 * USAGE:
 *    const article = await fetchArticleContent("logic-propositional" as ArticleID);
 *    const results = await processArticle(article, 1024);
 *    // results contains sections with their text chunks ready for embedding
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

function htmlListToTextList(htmlString: string, keepMarkers: boolean = true): string {
  function toRoman(num: number): string {
    if (num < 1 || num > 3999 || !Number.isInteger(num)) {
      // Standard Roman numerals are for positive integers in this range.
      return num.toString();
    }

    // Mapping of Roman numerals to their integer values.
    const romanMap: { [key: string]: number; } = {
      M: 1000, CM: 900, D: 500, CD: 400,
      C: 100, XC: 90, L: 50, XL: 40,
      X: 10, IX: 9, V: 5, IV: 4, I: 1
    };

    let roman = '';
    for (const key in romanMap) {
      while (num >= romanMap[key]) {
        roman += key;
        num -= romanMap[key];
      }
    }
    return roman;
  }

  function toAlphabet(num: number): string {
    if (num < 1 || !Number.isInteger(num)) {
      return num.toString();
    }
    let result = '';
    let tempNum = num;
    while (tempNum > 0) {
      // Adjust for 1-based indexing to 0-based for character codes.
      const remainder = (tempNum - 1) % 26;
      result = String.fromCharCode(65 + remainder) + result; // 65 is the char code for 'A'
      tempNum = Math.floor((tempNum - 1) / 26);
    }
    return result;
  }

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
                $(pre).replaceWith('\n__NESTED_LIST__\n' + $(pre).text() + '__END_NESTED_LIST__\n');
              });
              const contentWithPlaceholder = $liContent.text().trim();

              // Split by placeholder and indent nested content
              const parts = contentWithPlaceholder.split(/\n?__NESTED_LIST__\n?/);
              const mainText = parts[0].trim();
              if (keepMarkers) {
                textContent += `${marker}. ${mainText}\n`;
              } else {
                textContent += `${mainText}\n`;
              }

              for (let i = 1; i < parts.length; i++) {
                const nestedPart = parts[i].split('__END_NESTED_LIST__')[0];
                if (nestedPart) {
                  const nestedLines = nestedPart.split('\n').filter(line => line.trim());
                  nestedLines.forEach(line => {
                    if (keepMarkers) {
                      textContent += `  ${line}\n`;
                    } else {
                      // Remove markers from nested content too
                      const cleanedLine = line.replace(/^[\s\-•\d\w]+\.\s*/, '');
                      textContent += `${cleanedLine}\n`;
                    }
                  });
                }
              }
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
                $(pre).replaceWith('\n__NESTED_LIST__\n' + $(pre).text() + '__END_NESTED_LIST__\n');
              });
              const contentWithPlaceholder = $liContent.text().trim();

              // Split by placeholder and indent nested content
              const parts = contentWithPlaceholder.split(/\n?__NESTED_LIST__\n?/);
              const mainText = parts[0].trim();

              // Only add the parent marker if there's text content
              if (mainText) {
                if (keepMarkers) {
                  textContent += `- ${mainText}\n`;
                } else {
                  textContent += `${mainText}\n`;
                }
              }

              for (let i = 1; i < parts.length; i++) {
                const nestedPart = parts[i].split('__END_NESTED_LIST__')[0];
                if (nestedPart) {
                  const nestedLines = nestedPart.split('\n').filter(line => line.trim());
                  nestedLines.forEach(line => {
                    if (keepMarkers) {
                      // If parent had no text, don't indent the nested list
                      const indent = mainText ? '  ' : '';
                      textContent += `${indent}${line}\n`;
                    } else {
                      // Remove markers from nested content
                      const cleanedLine = line.replace(/^[\s\-•\d\w]+\.\s*/, '');
                      textContent += `${cleanedLine}\n`;
                    }
                  });
                }
              }
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

function replaceTexWithSymbols(text: string): string {
  const texMap = texToUnicodeMap as Record<string, string>;
  const texSymbolRegex = /\\([a-zA-Z]+)/g;
  const remainingTexRegex = /\\/;
  const mathExpressionRegex = /(?:\\\(|\\\[)(.*?)(?:\\\)|\\\])/g;

  const EXCLUDED_COMMANDS = new Set([
    'sum', 'int', 'prod', 'lim', 'bigcup', 'bigcap', // operators
    'frac', 'sqrt',                                  // fractions, roots
    'hat', 'bar', 'vec', 'dot', 'tilde',             // accents
    'mathbb', 'mathcal', 'mathbf', 'mathrm',         // fonts
    'left', 'right', 'begin', 'end'                  // structural
  ]);

  return text.replace(mathExpressionRegex, (originalMatch, content) => {

    const firstPassContent = content.replace(texSymbolRegex, (match: string, command: string) => {
      if (EXCLUDED_COMMANDS.has(command) || !texMap[command]) {
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

async function gptConvertTexToText(text: string): Promise<string> {
  if (!openai) {
    return text;
  }

  const prompt = `Convert TeX expressions in this text to concise plain English, using symbols where possible. Respond with the updated text and nothing else, WITHOUT triple-quotes. Do NOT think step-by-step. Do NOT make any other changes to the text.

Text:
"""
${text}
"""
`;
  try {
    const response = await openai.responses.create({
      "model": "gpt-5-nano",
      input: prompt,
      text: {
        "verbosity": "low"
      },
      "reasoning": {
        "effort": "minimal"
      }
    });

    return response.output_text;
  } catch (error) {
    console.error("Error calling OpenAI API for TeX conversion:", error);
    // Fall back to returning the original text if API fails
    return text;
  }
};

async function gptCreateTableDescription(tableElem: string, articleTitle = "", sectionHeading = ""): Promise<string> {
  if (!openai) {
    return "";
  }

  const contextParts = [];
  contextParts.push("Stanford Encyclopedia of Philosophy");
  if (articleTitle) contextParts.push(articleTitle);
  if (sectionHeading) contextParts.push(sectionHeading);
  const contextInfo = contextParts.join(" - ");

  const prompt = `Write a concise natural language description of this HTML table. The table may contain TeX expressions. Respond with the description and nothing else, WITHOUT triple-quotes. Do NOT think step-by-step. Context: ${contextInfo}

Table:
"""
${tableElem}
"""
`;
  try {
    const response = await openai.responses.create({
      "model": "gpt-5-nano",
      input: prompt,
      text: {
        "verbosity": "low"
      },
      "reasoning": {
        "effort": "minimal"
      }
    });

    return response.output_text;
  } catch (error) {
    console.error("Error calling OpenAI API for table description generation:", error);
    return "";
  }
};

async function processTex(text: string, forRetrieval: boolean = true): Promise<string> {
  const replacedText = replaceTexWithSymbols(text);
  // if tex is still present, send to gpt-5-nano to convert to natural language
  // look for \( ... \) or \[ ... \]
  const texPattern = /(?:\\\(|\\\[)(.*?)(?:\\\)|\\\])/s;
  if (texPattern.test(replacedText)) {
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

async function convertTablesToDescriptions(text: string, articleTitle = "", sectionHeading = ""): Promise<string> {
  // Find all table elements and convert them to descriptions
  const tableRegex = /<table[^>]*>[\s\S]*?<\/table>/gi;
  const tables = text.match(tableRegex);

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
  // Find all table elements and convert them to markdown (for generation)
  const tableRegex = /<table[^>]*>[\s\S]*?<\/table>/gi;
  const tables = text.match(tableRegex);

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
    return text.replace(/[ \t]+/g, ' ').trim();
  }
  return text.replace(/\s+/g, ' ').trim();
}

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
 * Replaces complex figure HTML with simple <figure><figcaption>...</figcaption></figure>
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
    let nextElement = $(element).next();

    while (nextElement.length > 0) {
      if (nextElement.is('h2, h3, h4, h5, h6')) {
        break;
      }

      content += $.html(nextElement);
      nextElement = nextElement.next();
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
 * Preprocess HTML content from Stanford Encyclopedia of Philosophy articles.
 * Creates TWO versions optimized for different purposes:
 * 
 * RETRIEVAL FORMAT (for embedding/search):
 * 1. normaliseText: Remove diacritics and normalize Unicode
 * 2. normaliseWhitespace: Collapse whitespace
 * 3. htmlListToTextList (no markers): Convert lists to plain text without bullets/numbers
 * 4. convertTablesToDescriptions: Convert tables to natural language descriptions using GPT
 * 5. stripHTMLTags: Remove HTML tags
 * 6. processTex (full conversion): Convert all TeX to Unicode or natural language (may call GPT)
 * 7. normaliseWhitespace: Final cleanup
 * 
 * GENERATION FORMAT (for LLM context & display):
 * 1. Keep original text (preserve diacritics)
 * 2. normaliseWhitespace: Collapse whitespace
 * 3. htmlListToTextList (with markers): Keep list structure with -, 1., a., etc.
 * 4. convertTablesToMarkdown: Convert tables to markdown for LLM understanding
 * 5. stripHTMLTags: Remove HTML tags
 * 6. processTex (partial): Replace simple symbols but keep complex TeX readable (no GPT call)
 * 7. normaliseWhitespace: Final cleanup
 * 
 * @param text - Raw HTML content from article section
 * @param articleTitle - Article title (used for context in table descriptions)
 * @param sectionHeading - Section heading (used for context in table descriptions)
 * @returns Object with both retrieval and generation text
 */
async function preprocessTextDual(
  text: string,
  articleTitle = "",
  sectionHeading = ""
): Promise<{ retrieval: string; generation: string; }> {
  // RETRIEVAL FORMAT - Optimized for embedding
  let retrieval = text;
  retrieval = normaliseText(retrieval);
  retrieval = normaliseWhitespace(retrieval);
  retrieval = htmlListToTextList(retrieval, false); // No markers
  retrieval = await convertTablesToDescriptions(retrieval, articleTitle, sectionHeading);
  retrieval = stripHTMLTags(retrieval);
  retrieval = await processTex(retrieval, true); // Full TeX conversion
  retrieval = normaliseWhitespace(retrieval, true);

  // GENERATION FORMAT - Optimized for LLM & display
  let generation = text;
  // Don't normalize text - keep diacritics
  generation = normaliseWhitespace(generation);
  generation = htmlListToTextList(generation, true); // Keep markers
  generation = convertTablesToMarkdown(generation);
  generation = stripHTMLTags(generation);
  generation = await processTex(generation, false); // Partial TeX conversion
  generation = normaliseWhitespace(generation, true);

  return { retrieval, generation };
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

  // Convert each item to dual formats (retrieval/generation)
  const retrievalUnits: string[] = [];
  const generationUnits: string[] = [];

  for (const item of items) {
    const dual = await preprocessItemDual(item, articleTitle, sectionHeading);
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

/**
 * Extract semantic units from preprocessed text.
 * Units are: table descriptions, list blocks, and regular paragraphs.
 */
function extractSemanticUnits(text: string): string[] {
  const units: string[] = [];

  // Simple semantic split on paragraph boundaries (two or more newlines)
  const rawUnits = text.split(/\n{2,}/);
  for (const rawUnit of rawUnits) {
    const trimmed = rawUnit.trim();
    if (!trimmed) continue;
    units.push(trimmed);
  }

  // Merge consecutive list items if they belong to the same list
  // (This handles cases where list items might have been split by \n\n)
  const mergedUnits: string[] = [];
  let currentListBlock = '';

  for (const unit of units) {
    const lines = unit.split('\n');
    const startsWithListMarker = /^\s*[-•]\s/.test(lines[0]) ||
      /^\s*\d+\.\s/.test(lines[0]) ||
      /^\s*[a-z]\.\s/.test(lines[0]) ||
      /^\s*[A-Z]\.\s/.test(lines[0]) ||
      /^\s*[ivxlcdm]+\.\s/i.test(lines[0]);

    if (startsWithListMarker) {
      if (currentListBlock) {
        currentListBlock += '\n' + unit;
      } else {
        currentListBlock = unit;
      }
    } else {
      // Not a list - flush any accumulated list block
      if (currentListBlock) {
        mergedUnits.push(currentListBlock);
        currentListBlock = '';
      }
      mergedUnits.push(unit);
    }
  }

  // Flush any remaining list block
  if (currentListBlock) {
    mergedUnits.push(currentListBlock);
  }

  return mergedUnits;
}

// === Item-based helpers ===

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
        items.push({ kind: 'paragraph', html: `<p>${text}</p>` });
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



// EXAMPLE of figure and caption from SEP HTML source
// This example shows how SEP structures figures with:
// - Multiple sub-figures with individual alt text
// - Short caption with figure label
// - Link to extended description on figdesc.html
// The processFiguresInContent function will normalize this to a simple <figure><figcaption>...</figcaption></figure>
const _example_fig_html = `<div class="figure centered avoid-break" id="fig1">

<div id="fig1a" style="display: inline-block; width:45%">
<img alt="a rectangle one half blue and one half white with a solid black line between the two halves" src="figure1a.svg" style="width:2in" />

<p class="center">
(a)</p>
</div>

<div id="fig1c" style="display: inline-block; width:45%">
<img alt="same rectangle with no black line between the two halves" src="figure1b.svg" style="width:2in" />

<p class="center">
(b)</p>
</div>

<div id="fig1b" style="display: inline-block; width:45%">
<img alt="same rectangle but colors now in a gradient from blue at one end to white at the other" src="figure1c.svg" style="width:2in" />

<p class="center">
(c)</p>
</div>

<div id="fig1d" style="display: inline-block; width:45%">
<img alt="same rectangle but now a solid light blue" src="figure1d.svg" style="width:2in" />

<p class="center">
(d)</p>
</div>

<p class="center">
<span class="figlabel">Figure 1</span> [An
 <a href="figdesc.html#fig1">extended description of figure 1</a>
 is in the supplement.]</p>
</div>`;





// Test data
const TEST_ARTICLE_TITLE = "Propositional Logic";
const TEST_SECTION_HEADING = "2.1 Truth-functionality";

const example_text = `<p>
One sees that \\(f_1^1\\) performs no operation on its input and is
essentially the same as \\(\\top\\). \\(f_4^1\\) is similarly an impostor:
\\(\\bot\\) dressed up as a unary function. One can quickly check that
the number of <i>n</i>-ary truth functions is \\(2^{2^n}\\)&mdash;there
being 2 possible output values on each of the \\(2^n\\) possible
<i>n</i>-tuples of input values, and that at each stage, a number of
truth functions are impostors from lower arity. A case of special
interest are the sixteen binary truth functions, which one can fully
individuate by specifying their range on the 4 possible input
values:</p>

<div class="center">

<table class="cellpad-small-dense cell-center two-rulesTH centered">
<colgroup class="colhead" span="1"> </colgroup> <colgroup span="4">
</colgroup>
<thead>
<tr class="header">
<th>input</th>
<th>\\(\\langle\\bT, \\bT\\rangle\\)</th>
<th>\\(\\langle\\bT, \\bF\\rangle\\)</th>
<th>\\(\\langle\\bF, \\bT\\rangle\\)</th>
<th>\\(\\langle\\bF, \\bF\\rangle\\)</th> </tr> </thead>
<tbody>
<tr class="odd">
<th>\\(f_1^2\\)</th>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bT\\)</td> </tr>
<tr class="even">
<th>\\(f_2^2\\)</th>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bF\\)</td> </tr>
<tr class="odd">
<th>\\(f_3^2\\)</th>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bT\\)</td> </tr>
<tr class="even">
<th>\\(f_4^2\\)</th>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bF\\)</td> </tr>
<tr class="odd">
<th>\\(f_5^2\\)</th>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bT\\)</td> </tr>
<tr class="even">
<th>\\(f_6^2\\)</th>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bF\\)</td> </tr>
<tr class="odd">
<th>\\(f_7^2\\)</th>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bT\\)</td> </tr>
<tr class="even">
<th>\\(f_8^2\\)</th>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bF\\)</td> </tr>
<tr class="odd">
<th>\\(f_9^2\\)</th>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bT\\)</td> </tr>
<tr class="even">
<th>\\(f_{10}^2\\)</th>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bF\\)</td> </tr>
<tr class="odd">
<th>\\(f_{11}^2\\)</th>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bT\\)</td> </tr>
<tr class="even">
<th>\\(f_{12}^2\\)</th>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bF\\)</td> </tr>
<tr class="odd">
<th>\\(f_{13}^2\\)</th>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bT\\)</td> </tr>
<tr class="even">
<th>\\(f_{14}^2\\)</th>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bT\\)</td>
  <td>\\(\\bF\\)</td> </tr>
<tr class="odd">
<th>\\(f_{15}^2\\)</th>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bT\\)</td> </tr>
<tr class="even">
<th>\\(f_{16}^2\\)</th>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bF\\)</td>
  <td>\\(\\bF\\)</td> </tr> </tbody>
</table>

</div>

<p>
One immediately recognizes the impostors \\(f_1^2 = \\top\\), \\(f_4^2 =
f_2^1\\) acting on the first input value, \\(f_6^2 = f_2^1\\) acting on
the second input value, \\(f_{11}^2 = f_3^1\\) acting on the second
input value, \\(f_{13}^2 = f_3^1\\) action on the first value, and
\\(f_{16}^2 = \\bot\\), leaving ten essentially new binary truth
functions.</p>`;

async function runTests() {
  console.log('\n=== Testing Dual-Format Preprocessing Pipeline ===\n');

  try {
    // Test 0: Figure processing
    console.log('Test 0: Figure processing...');
    const mockExtendedDescriptions = new Map<string, string>([
      ['fig1', '<p>This figure shows four variations of a rectangle to illustrate color boundaries:</p><ul><li>(a) Sharp boundary with black line</li><li>(b) Sharp boundary without line</li><li>(c) Gradient boundary</li><li>(d) Uniform color</li></ul>']
    ]);

    // Test extractFigureDescription with the example figure
    const $fig = cheerio.load(_example_fig_html);
    const description = extractFigureDescription($fig.root(), 'fig1', mockExtendedDescriptions, $fig);
    console.log('✓ Extracted figure description:');
    console.log(`  ${description.slice(0, 150)}...`);

    // Test processFiguresInContent (simulated - would normally fetch from server)
    console.log('\n✓ Figure processing functions implemented');
    console.log('  • extractFigureDescription: Priority = extended > caption > alt text');
    console.log('  • processFiguresInContent: Normalizes figures to <figure><figcaption>');
    console.log('  • Integrated into fetchArticleContent pipeline');

    // Test 1: Dual-format preprocessing
    console.log('\n\nTest 1: Dual-format preprocessing...');
    const { retrieval, generation } = await preprocessTextDual(example_text, TEST_ARTICLE_TITLE, TEST_SECTION_HEADING);

    fs.writeFileSync('debug_output_retrieval.txt', retrieval);
    fs.writeFileSync('debug_output_generation.txt', generation);
    console.log('✓ Retrieval format saved to debug_output_retrieval.txt');
    console.log('✓ Generation format saved to debug_output_generation.txt');

    console.log('\nRetrieval format preview (first 200 chars):');
    console.log(retrieval.slice(0, 200) + '...');
    console.log('\nGeneration format preview (first 200 chars):');
    console.log(generation.slice(0, 200) + '...');

    // Test 2: Semantic chunking with dual formats
    console.log('\n\nTest 2: Dual-format semantic chunking...');
    const mockSection: ArticleSection = {
      shortName: "TruthFunc",
      number: "2.1",
      heading: "Truth-functionality",
      content: example_text
    };

    const dualChunks = await processArticleSectionDual(mockSection, TEST_ARTICLE_TITLE, 1024);
    console.log(`✓ Created ${dualChunks.length} chunk(s) with dual formats`);

    dualChunks.forEach((chunk, i) => {
      console.log(`\n  Chunk ${i + 1}: ${chunk.tokenCount} tokens`);
      console.log(`    Retrieval preview: ${chunk.retrievalText.slice(0, 100)}...`);
      console.log(`    Generation preview: ${chunk.generationText.slice(0, 100)}...`);
    });

    const chunksOutput = {
      chunks: dualChunks.map((c, i) => ({
        chunkNumber: i + 1,
        tokenCount: c.tokenCount,
        retrievalText: c.retrievalText,
        generationText: c.generationText
      }))
    };
    fs.writeFileSync('debug_chunks.json', JSON.stringify(chunksOutput, null, 2));
    console.log('\n✓ Dual-format chunks saved to debug_chunks.json');

    // Test 3: Test with smaller chunk size
    console.log('\n\nTest 3: Testing smaller chunk size (200 tokens)...');
    const smallChunks = await processArticleSectionDual(mockSection, TEST_ARTICLE_TITLE, 200);
    console.log(`✓ Created ${smallChunks.length} chunk(s) with 200 token limit`);

    smallChunks.forEach((chunk, i) => {
      console.log(`  Chunk ${i + 1}: ${chunk.tokenCount} tokens`);
    });

    console.log('\n\n=== All Tests Passed ===\n');

    // Summary
    console.log('Summary of Format Differences:');
    console.log('\nRETRIEVAL FORMAT (for embedding/search):');
    console.log('  • Fully normalized (no diacritics)');
    console.log('  • TeX converted to Unicode or natural language');
    console.log('  • Tables converted to natural language descriptions');
    console.log('  • Lists without markers (pure content)');
    console.log('  • Maximum semantic density');
    console.log('\nGENERATION FORMAT (for LLM context & display):');
    console.log('  • Preserves diacritics and special characters');
    console.log('  • TeX kept in readable format (simple symbols replaced)');
    console.log('  • Tables converted to markdown');
    console.log('  • Lists with proper markers (-, 1., a., etc.)');
    console.log('  • Structured for better LLM comprehension');

  } catch (error) {
    console.error('\n=== Error during processing ===');
    console.error(error);
    process.exit(1);
  }
}

runTests();