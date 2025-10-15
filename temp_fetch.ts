import * as cheerio from 'cheerio';
import 'dotenv/config';
import * as fs from 'fs';
import { decode as htmlDecode } from 'html-entities';
import { encode as bpeEncode, decode as bpeDecode } from 'gpt-tokenizer';
import { OpenAI } from "openai";
import texToUnicodeMap from './data/tex-unicode-map.json';

const articlesListURL = "https://plato.stanford.edu/published.html";
const baseArticleURL = "https://plato.stanford.edu/entries/";
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

function htmlListToTextList(htmlString: string): string {
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
              textContent += `${marker}. ${mainText}\n`;

              for (let i = 1; i < parts.length; i++) {
                const nestedPart = parts[i].split('__END_NESTED_LIST__')[0];
                if (nestedPart) {
                  const nestedLines = nestedPart.split('\n').filter(line => line.trim());
                  nestedLines.forEach(line => {
                    textContent += `  ${line}\n`;
                  });
                }
              }
            } else {
              // No nested list - just get text
              textContent += `${marker}. ${$li.text().trim()}\n`;
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
                textContent += `- ${mainText}\n`;
              }

              for (let i = 1; i < parts.length; i++) {
                const nestedPart = parts[i].split('__END_NESTED_LIST__')[0];
                if (nestedPart) {
                  const nestedLines = nestedPart.split('\n').filter(line => line.trim());
                  nestedLines.forEach(line => {
                    // If parent had no text, don't indent the nested list
                    const indent = mainText ? '  ' : '';
                    textContent += `${indent}${line}\n`;
                  });
                }
              }
            } else {
              // No nested list - just get text
              textContent += `- ${$li.text().trim()}\n`;
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

function _replaceTexSymbols(text: string): string {
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

    // replace nonstandard "\rN" -> "N" (e.g. \rA -> A)
    const romanTypesetRegex = /\\r([A-Za-z])/g;
    const firstPassContentWithRomans: string = firstPassContent.replace(romanTypesetRegex, (match: string, letter: string): string => letter);

    // clean up braces and loose backslashes
    const processedContent = firstPassContentWithRomans.replace(/\\{/g, "{").replace(/\\}/g, "}").replace(/\s+\\\s+/g, ' ');

    if (remainingTexRegex.test(processedContent)) {
      const startDelimiter = originalMatch.slice(0, 2); // e.g., "\(" or "\["
      const endDelimiter = originalMatch.slice(-2);
      return `${startDelimiter}${processedContent}${endDelimiter}`;
    } else {
      return processedContent.replace(/\\/g, ''); // remove any remaining backslashes
    }
  });
}

async function _gptConvertTexToText(text: string): Promise<string> {
  throw new Error("Disabled for debugging");

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

async function _gptCreateTableDescription(tableElem: string, articleTitle="", sectionHeading=""): Promise<string> {
  throw new Error("Disabled for debugging");

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

async function processTex(text: string): Promise<string> {
  const replacedText = _replaceTexSymbols(text);
  // if tex is still present, send to gpt-5-nano to convert to natural language
  // look for \( ... \) or \[ ... \]
  const texPattern = /(?:\\\(|\\\[)(.*?)(?:\\\)|\\\])/s;
  if (texPattern.test(replacedText)) {
    return await _gptConvertTexToText(replacedText);
  } else {
    return replacedText;
  }
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
  const PRESERVE_TAGS = new Set(['table', 'thead', 'tbody', 'tr', 'td', 'th', 'figure', 'figcaption']);
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
    preamble,
    sections,
    related
  };
}

async function preprocessText(text: string): Promise<string> {
  // order: normaliseText -> htmlListToTextList -> stripHTMLTags -> processTex -> normaliseWhitespace (keepNewLines=true)

  let processed = text;
  processed = normaliseText(processed);
  processed = normaliseWhitespace(processed); // needed to remove line wrapping from HTML source
  processed = htmlListToTextList(processed);
  processed = stripHTMLTags(processed); // converts p tags to \n\n
  processed = await processTex(processed);
  processed = normaliseWhitespace(processed, true);
  return processed;
}

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

preprocessText(example_text).then(result => {
  fs.writeFileSync('debug_output.txt', result);
});