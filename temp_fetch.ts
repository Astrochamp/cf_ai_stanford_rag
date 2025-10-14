import * as cheerio from 'cheerio';
import fs from "fs";
import texToUnicodeMap from './data/tex-unicode-map.json';

function processTex(text: string): string {
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

    // clean up braces and loose backslashes
    const processedContent = firstPassContent.replace("\\{", "{").replace("\\}", "}").replace(/\s+\\\s+/g, ' ');

    if (remainingTexRegex.test(processedContent)) {
      const startDelimiter = originalMatch.slice(0, 2); // e.g., "\(" or "\["
      const endDelimiter = originalMatch.slice(-2);
      return `${startDelimiter}${processedContent}${endDelimiter}`;
    } else {
      return processedContent.replace(/\\/g, ''); // remove any remaining backslashes
    }
  });
}

function normaliseText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}


const articlesListURL = "https://plato.stanford.edu/published.html";
const baseArticleURL = "https://plato.stanford.edu/entries/";

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

const artId = "wittgenstein" as ArticleID;
fetchArticleContent(artId).then(article => {
  fs.mkdirSync('./data/articles', { recursive: true });
  fs.writeFileSync(`./data/articles/${artId}.json`, JSON.stringify(article, null, 2));
  console.log(`Article ${artId} saved.`);
}).catch(err => {
  console.error(`Error fetching article ${artId}:`, err);
});