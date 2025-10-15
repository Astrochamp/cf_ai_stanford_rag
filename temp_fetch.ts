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

  // --- Process Unordered Lists (<ul>) ---
  $('ul').each((_, ul) => {
    let textContent = '\n';
    $(ul).children('li').each((_, li) => {
      textContent += `- ${$(li).text().trim()}\n`;
    });
    textContent = textContent.trimEnd() + '\n';

    // Replace the <ul> element with a <pre> tag containing the formatted text.
    const preElement = $('<pre></pre>').text(textContent);
    $(ul).replaceWith(preElement);
  });

  // --- Process Ordered Lists (<ol>) ---
  $('ol').each((_, ol) => {
    const $ol = $(ol);
    const isReversed = $ol.attr('reversed') !== undefined;
    const type = $ol.attr('type')?.toLowerCase() || '1';

    // Determine the starting number for the list.
    const startAttr = $ol.attr('start');
    let counter = startAttr ? parseInt(startAttr, 10) : 1;
    if (isNaN(counter)) {
      counter = 1;
    }

    let textContent = '\n';
    $ol.children('li').each((_, li) => {
      let marker: string;

      // Generate the appropriate list marker based on the 'type' attribute.
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

      textContent += `${marker}. ${$(li).text().trim()}\n`;

      // Increment or decrement the counter for the next item.
      if (isReversed) {
        counter--;
      } else {
        counter++;
      }
    });
    textContent = textContent.trimEnd() + '\n';

    // Replace the <ol> element with a <pre> tag.
    const preElement = $('<pre></pre>').text(textContent);
    $ol.replaceWith(preElement);
  });

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
    const processedContent = firstPassContentWithRomans.replace("\\{", "{").replace("\\}", "}").replace(/\s+\\\s+/g, ' ');

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
  const prompt = `Convert TeX expressions in this text to concise plain English, using symbols where possible. Respond with the updated text and nothing else, WITHOUT triple-quotes. Do NOT think step-by-step. Do NOT make any other changes to the text.

Text:
"""
${text}
"""
`;
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
};

async function processTex(text: string): Promise<string> {
  const replacedText = _replaceTexSymbols(text);
  // if tex is still present, send to gpt-5-nano to convert to natural language
  // look for \( ... \) or \[ ... \]
  const texPattern = /(?:\\\(|\\\[)(.*?)(?:\\\)|\\\])/s;
  if (texPattern.test(replacedText)) {
    // debug
    console.log("TeX detected after replacement, sending to GPT for conversion.");
    fs.writeFileSync('./debug_tex_input.txt', replacedText);
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
  const PRESERVE_TAGS = new Set(['table', 'thead', 'tbody', 'tr', 'td', 'th', 'figure', 'figcaption', 'pre']);
  const REMOVE_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'noscript']);
  const PARAGRAPH_TAGS = new Set(['p', 'div', 'blockquote', 'li']);

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

  // debug
  console.log("After removing certain tags:", text);

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

  $('a').each((_, element) => {
    const href = $(element).attr('href');
    // extract id (part after /entries/)
    if (!href) return;
    const id = href.split('/entries/')[1].replace('.html', '').replace(/\/$/, '') as ArticleID;
    articleIDs.push(id);
  });
  const uniqueArticleIDs = Array.from(new Set(articleIDs));
  return uniqueArticleIDs;
}

async function fetchArticleContent(id: ArticleID): Promise<Article> {
  const url = `${baseArticleURL}${id}/`;
  const response = await fetch(url);
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
  processed = normaliseWhitespace(processed);
  processed = htmlListToTextList(processed);
  processed = stripHTMLTags(processed); // converts p tags to \n\n
  processed = await processTex(processed);
  processed = normaliseWhitespace(processed, true);
  return processed;
}

async function preprocessArticle(article: Article): Promise<Article> {
  const preamble = await preprocessText(article.preamble);
  const sections: ArticleSection[] = [];
  for (const section of article.sections) {
    const content = await preprocessText(section.content);
    sections.push({
      shortName: section.shortName,
      number: section.number,
      heading: section.heading,
      content
    });
  }
  return {
    ...article,
    preamble,
    sections
  };
}

// const artId = "wittgenstein" as ArticleID;
// fetchArticleContent(artId).then(article => {
//   const processedArticle = preprocessArticle(article);
//   fs.mkdirSync('./data/articles', { recursive: true });
//   fs.writeFileSync(`./data/articles/${artId}.json`, JSON.stringify(processedArticle, null, 2));
//   console.log(`Article ${artId} saved.`);
// }).catch(err => {
//   console.error(`Error fetching article ${artId}:`, err);
// });


const example_text = `<p>
The formal language of propositional logic consists of
&ldquo;atomic&rdquo; propositional variables, \\(p_1\\), \\(p_2\\),
\\(p_3\\), &hellip;, and propositional connectives, \\(c_1^1\\),
\\(c_2^1\\), \\(c_3^1\\), &hellip;, \\(c_1^2\\), \\(c_2^2\\), \\(c_3^2\\),
&hellip;, \\(c_1^3\\), &hellip;. The expressions&rsquo; subscripts are
used to distinguish them from one another; the fact that we use
natural numbers indicates the typical convention that the vocabulary
be countable. The propositional connectives&rsquo; superscripts
indicate their &ldquo;arity&rdquo;, i.e., the number of propositions
that they operate on in order to create a new proposition. The
formulas of propositional logic are defined recursively by</p>

<ol>

<li>

<p>
Atomic propositional variables are formulas.</p></li>

<li>

<p>
If \\(c_n^m\\) is a propositional connective, and \\(\\langle\\)A, B, C,
&hellip;\\(\\rangle\\) is a sequence of <i>m</i>, possibly but not
necessarily atomic, possibly but not necessarily distinct, formulas,
then the result of applying \\(c_n^m\\) to \\(\\langle\\)A, B, C,
&hellip;\\(\\rangle\\) is a formula.</p></li>
</ol>

<p>
The result of applying \\(c_n^m\\) to \\(\\langle\\)A, B, C,
&hellip;\\(\\rangle\\) is customarily written in functional notation:
\\(c_n^m\\)(A, B, C, &hellip;). Examples of formulas are</p>

<ul>

<li id="formula1">

<p>
\\(p_4\\)</p></li>

<li id="formula2">

<p>
\\(c_1^2(p_7, p_3)\\)</p></li>

<li id="formula3">

<p>
\\(c_2^2(c_1^1(p_1), c_1^1(c_1^2(p_2, p_3)))\\)</p></li>

<li id="formula4">

<p>
\\(c_5^3(p_2, c_3^2(c_4^1(c_6^2(p_3, p_3)), p_5),
c_9^1(p_2))\\)</p></li>
</ul>

<p>
This recursive definition of the formulas of propositional logic
justifies the use of the label &ldquo;atomic&rdquo; for the
propositional variables: Every formula is built up stepwise from atoms
through a finite application of propositional connectives. It can be
helpful to think of the connectives as &ldquo;propositional
functions&rdquo; that take propositions (denoted by formulas) as input
and return propositions as output. The space of propositions is then
given as the free algebra on the atomic formulas generated by these
functions, and the specification of a proposition is given by the
standard &ldquo;composition of functions&rdquo; notation. This
terminology is not common, however, because the expression
&ldquo;propositional function&rdquo; has a quite different use of high
currency (see the entry on
 <a href="../russell/">Bertrand Russell</a>).</p>`;

(async () => {
  const processed = await preprocessText(example_text);
  fs.writeFileSync('./debug_processed_example.txt', processed);
})();