import * as cheerio from 'cheerio';
import 'dotenv/config';
import * as fs from 'fs';
import { decode } from 'html-entities';
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

function htmlListToTextList(html: string): string {
  const $ = cheerio.load(html);

  function getOrderedListMarker(index: number, type: string = '1', reversed: boolean = false, start: number = 1): string {
    const actualIndex = reversed ? start - index : start + index;

    switch (type) {
      case 'a':
        return String.fromCharCode(96 + actualIndex) + '.'; // a, b, c, ...
      case 'A':
        return String.fromCharCode(64 + actualIndex) + '.'; // A, B, C, ...
      case 'i':
        return toRoman(actualIndex).toLowerCase() + '.'; // i, ii, iii, ...
      case 'I':
        return toRoman(actualIndex) + '.'; // I, II, III, ...
      case '1':
      default:
        return actualIndex + '.'; // 1, 2, 3, ...
    }
  }

  function toRoman(num: number): string {
    const romanNumerals: [number, string][] = [
      [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
      [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
      [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
    ];

    let result = '';
    for (const [value, numeral] of romanNumerals) {
      while (num >= value) {
        result += numeral;
        num -= value;
      }
    }
    return result;
  }

  function processList(listElement: cheerio.Cheerio<any>, depth: number = 0): string {
    const isOrdered = listElement.is('ol');
    const indent = '  '.repeat(depth);
    let result = '';

    // Get attributes for ordered lists
    const type = listElement.attr('type') || '1';
    const start = parseInt(listElement.attr('start') || '1', 10);
    const reversed = listElement.attr('reversed') !== undefined;

    listElement.children('li').each((index: number, li: any) => {
      const $li = $(li);

      // Get the marker for this list item
      const marker = isOrdered
        ? getOrderedListMarker(index, type, reversed, start)
        : '-';

      // Extract text content, excluding nested lists
      const textContent = $li.clone()
        .children('ul, ol')
        .remove()
        .end()
        .text()
        .trim();

      if (textContent) {
        result += `${indent}${marker} ${textContent}\n`;
      }

      // Process nested lists
      $li.children('ul, ol').each((_, nestedList) => {
        result += processList($(nestedList), depth + 1);
      });
    });

    return result;
  }

  let output = '';

  $('ul, ol').each((_, list) => {
    const $list = $(list);
    // Only process top-level lists (not nested ones)
    if ($list.parent().is('li')) return;

    output += processList($list);
  });

  return output.trim();
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
  const PRESERVE_TAGS = new Set(['table', 'thead', 'tbody', 'tr', 'td', 'th', 'figure', 'figcaption']);
  const REMOVE_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'noscript']);

  let text = html;

  REMOVE_WITH_CONTENT.forEach(tag => {
    const regex = new RegExp(`<${tag}[^>]*>.*?</${tag}>`, 'gis');
    text = text.replace(regex, '');
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

  text = text.replace(/<[^>]+>/g, ' ');
  text = decode(text);

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

// order: normaliseText -> normaliseWhitespace -> htmlListToTextList -> stripHTMLTags -> processTex (simple -> gpt) -> normaliseWhitespace (keepNewLines)

// const artId = "wittgenstein" as ArticleID;
// fetchArticleContent(artId).then(article => {
//   fs.mkdirSync('./data/articles', { recursive: true });
//   fs.writeFileSync(`./data/articles/${artId}.json`, JSON.stringify(article, null, 2));
//   console.log(`Article ${artId} saved.`);
// }).catch(err => {
//   console.error(`Error fetching article ${artId}:`, err);
// });

const example_text = `The truth-functional analysis of propositional logic proceeds by
associating <i>n</i>-ary truth functions with the <i>n</i>-ary
propositional connectives. The classical case considered thus far,
where the truth value space is bivalent, admits a strikingly simple
analysis. Observe first that the functions \\(f_1^3\\), \\(f_2^2\\), and
\\(f_2^8\\) approximate the truth conditions of some uses of the natural
language particles &ldquo;not&rdquo;, &ldquo;or&rdquo;, and
&ldquo;and&rdquo; (another use of the particle &ldquo;or&rdquo; is
arguably approximated by \\(f_2^7\\)). Thus if we associate these
functions with the three connectives labeled earlier \\(\\neg\\),
\\(\\vee\\), and \\(\\wedge\\), we could compute the truth value of complex
formulas such as \\(\\neg\\rA\\vee\\neg(\\rB\\wedge\\rC)\\) given different
possible assignments of truth values to the sentence letters A, B, and
C, according to the composition of functions indicated in the
formula&rsquo;s propositional structure. One can check that this
formula takes the value <strong>F</strong> precisely when each of A,
B, and C is assigned <strong>T</strong> and takes the value
<strong>T</strong> otherwise. Under this interpretation, one can
define</p>

<ol>

<li>

<p>
A is a <strong>classical propositional validity</strong> if it
evaluates as <strong>T</strong> on every possible assignment of values
to its atomic propositional variables;</p></li>

<li>

<p>
A is <strong>classically satisfiable</strong> if it evaluates as
<strong>T</strong> on at least one possible assignment of values to
its atomic propositional variables (and is <strong>classically
unsatisfiable</strong> otherwise);</p></li>

<li>

<p>
A is a <strong>classical propositional consequence</strong> of B if on
no assignment of values to the atoms that occur in A and B on which B,
evaluates as <strong>T</strong> does A evaluate as
<strong>F</strong>;</p></li>

<li>

<p>
A is a <strong>classical propositional equivalent</strong> of B if A
and B evaluate as <strong>T</strong> on precisely the same assignments
of values to atoms.</p></li>
</ol>

<p>
In this way, the language of propositional logic restricted to the
connectives \\(\\neg\\), \\(\\vee\\), and \\(\\wedge\\) corresponds with the
formulas of the familiar two element Boolean algebra of
complementation, union, and intersection. The familiar Boolean laws
of</p>

<ul>

<li>

<p>
<strong>interchange</strong>:
<br />
If A and B are equivalent, and A occurs as a subformula of \\(\\rC_1\\),
then the result of replacing an occurrence of A in \\(\\rC_1\\) with B is
a formula \\(\\rC_2\\) that is equivalent to \\(\\rC_1\\).</p></li>

<li>

<p>
<strong>substitution</strong>:
<br />
If A and \\(\\rB_1\\) and \\(\\rC_1\\) are any formulas whatsoever, then the
result of replacing <em>each</em> occurrence of the propositional
variable \\(p\\) in \\(\\rB_1\\) and \\(\\rC_1\\) with A are formulas
\\(\\rB_2\\) and \\(\\rC_2\\) with the properties: \\(\\rB_2\\) is valid if
\\(\\rB_1\\) is; \\(\\rB_2\\) is unsatisfiable if \\(\\rB_1\\) is; \\(\\rB_2\\) is
a consequence of \\(\\rC_2\\) if \\(\\rB_1\\) is a consequence of \\(\\rC_1\\);
\\(\\rB_2\\) and \\(\\rC_2\\) are equivalent if \\(\\rB_1\\) and \\(\\rC_1\\)
are.</p></li>

<li>

<p>
<strong>complementation</strong>:
<br />
\\(\\rA\\vee\\neg\\rA\\) is a classical validity (called the &ldquo;law of
excluded middle&rdquo; (<span class="sc">lem</span>) in propositional
logic).</p></li>

<li>

<p>
<strong>double complementation</strong>:
<br />
\\(\\neg\\neg\\rA\\) is equivalent to A.</p></li>

<li>

<p>
<strong>commutativity</strong>:
<br />
\\(\\rA\\wedge\\rB\\) is equivalent to \\(\\rB\\wedge\\rA\\), and \\(\\rA\\vee\\rB\\)
is equivalent to \\(\\rB\\vee\\rA\\).</p></li>

<li>

<p>
<strong>associativity</strong>:
<br />
\\((\\rA\\wedge\\rB)\\wedge\\rC\\) is equivalent to \\(\\rA\\wedge
(\\rB\\wedge\\rC)\\), and \\((\\rA\\vee\\rB)\\vee\\rC\\) is equivalent to
\\(\\rA\\vee (\\rB\\vee\\rC)\\).</p></li>

<li>

<p>
<strong>distribution</strong>:
<br />
\\(\\rA\\vee (\\rB_1\\wedge\\rB_2\\wedge \\ldots \\wedge\\rB_n)\\) is equivalent
to \\((\\rA\\vee\\rB_1)\\wedge (\\rA\\vee\\rB_2)\\wedge \\ldots \\wedge
(\\rA\\vee\\rB_n)\\) and
<br />
\\(\\rA\\wedge (\\rB_1\\vee\\rB_2\\vee \\ldots \\vee\\rB_n)\\) is equivalent to
\\((\\rA\\wedge\\rB_1)\\vee (\\rA\\wedge\\rB_2)\\vee \\ldots \\vee
(\\rA\\wedge\\rB_n)\\).</p></li>

<li>

<p>
<strong>De Morgan equivalence</strong>:
<br />
\\(\\neg(\\rB_1\\wedge\\rB_2\\wedge \\ldots \\wedge\\rB_n)\\) is equivalent to
\\(\\neg\\rB_1\\vee\\neg\\rB_2\\vee \\ldots \\vee\\neg\\rB_n\\) and
<br />
\\(\\neg(\\rB_1\\vee\\rB_2\\vee \\ldots \\vee\\rB_n)\\) is equivalent to
\\(\\neg\\rB_1\\wedge\\neg\\rB_2\\wedge \\ldots \\wedge\\neg\\rB_n\\).</p></li>
</ul>

<p>
therefore apply to this language of &ldquo;Boolean propositional
formulas&rdquo;.</p>`;

processTex(
  stripHTMLTags(
    // htmlListToTextList(
      normaliseWhitespace(
        normaliseText(
          example_text
        )
      )
    // )
  )
).then(result => {
  const normalised = normaliseWhitespace(result, true);
  fs.writeFileSync('./example_output.txt', normalised);
  console.log("Processed text saved to example_output.txt");
}).catch(err => {
  console.error("Error processing text:", err);
});