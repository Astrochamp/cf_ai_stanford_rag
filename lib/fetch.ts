import * as cheerio from 'cheerio';
import { extractFigureIds, processFiguresInContent } from './preprocess';
import {
  articlesListURL,
  baseArticleURL,
  sepRssFeedURL,
} from './shared/constants';
import type { Article, ArticleID, ArticleSection, RssFeedItem } from './shared/types';
import { normaliseText } from './shared/utils';


export async function fetchArticlesList(): Promise<ArticleID[]> {
  const response = await fetch(articlesListURL);
  const text = await response.text();
  const $ = cheerio.load(text);
  const articleIDs: ArticleID[] = [];

  // Target links within div#content that contain '/entries/' in href
  $('#content a[href*="/entries/"]').each((_, element) => {
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
 * Fetch the SEP RSS feed which contains new and recently revised articles.
 * @returns The RSS feed XML as a string
 */
export async function fetchRssFeed(): Promise<string> {
  const response = await fetch(sepRssFeedURL);
  if (!response.ok) {
    throw new Error(`Failed to fetch RSS feed: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

/**
 * Parse the SEP RSS feed XML and extract article IDs with publication dates.
 * The RSS feed contains items with links like "https://plato.stanford.edu/entries/article-id/"
 * and pubDate in RFC 2822 format (e.g., "Thu, 23 Oct 2025 03:22:01 -0800")
 * 
 * Note: The SEP RSS feed uses Pacific Time (PST/PDT, -0800/-0700) in pubDate despite
 * stating "All dates are given in UTC" in their documentation.
 * 
 * @param rssFeedXml - The RSS feed XML string
 * @returns Array of RSS feed items with article IDs and publication dates
 */
export function parseRssFeed(rssFeedXml: string): RssFeedItem[] {
  const $ = cheerio.load(rssFeedXml, { xmlMode: true });
  const items: RssFeedItem[] = [];

  // Parse each <item> in the feed
  $('item').each((_, item) => {
    const $item = $(item);
    const link = $item.find('link').text().trim();
    const pubDateStr = $item.find('pubDate').text().trim();

    if (!link || !link.includes('/entries/')) return;

    // Extract article ID from URL like "https://plato.stanford.edu/entries/article-id/"
    const match = link.match(/\/entries\/([^\/]+)/);
    if (!match || !match[1]) return;

    const articleId = match[1] as ArticleID;

    // Parse the pubDate (RFC 2822 format)
    // Example: "Thu, 23 Oct 2025 03:22:01 -0800"
    const pubDate = pubDateStr ? new Date(pubDateStr) : new Date();

    items.push({ articleId, pubDate });
  });

  // Return unique article IDs (keep the most recent pubDate if duplicates)
  const uniqueItems = new Map<string, RssFeedItem>();
  for (const item of items) {
    const existing = uniqueItems.get(item.articleId);
    if (!existing || item.pubDate > existing.pubDate) {
      uniqueItems.set(item.articleId, item);
    }
  }

  return Array.from(uniqueItems.values());
}

/**
 * Fetch and parse the SEP RSS feed to get articles with publication dates.
 * This is a convenience function that combines fetchRssFeed and parseRssFeed.
 * 
 * @returns Array of RSS feed items with article IDs and publication dates
 */
export async function fetchRssArticles(): Promise<RssFeedItem[]> {
  const rssFeedXml = await fetchRssFeed();
  return parseRssFeed(rssFeedXml);
}

/**
 * Fetch extended figure descriptions from a figdesc.html page.
 * Returns a map of figure IDs to their extended descriptions.
 * 
 * Strategy: First extract all figure IDs from the article content,
 * then look for those specific IDs in the figdesc.html page.
 */
export async function fetchExtendedFigureDescriptions(articleUrl: string, articleHtml: string): Promise<Map<string, string>> {
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
export async function fetchArticleContent(id: ArticleID): Promise<Article> {
  const url = `${baseArticleURL}${id}/`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch article ${id}: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const $ = cheerio.load(text);

  const title = $('meta[name="DC.title"]').attr('content') || 'No Title';
  const createdDate = $('meta[name="DCTERMS.issued"]').attr('content') || '';
  const updatedDate = $('meta[name="DCTERMS.modified"]').attr('content') || '';

  const originalTitle = title;

  const authors: string[] = [];
  $('meta[name="DC.creator"]').each((_, element) => {
    const author = $(element).attr('content');
    if (author) authors.push(author);
  });

  const preamble = $('#preamble').html() || '';

  const sections: ArticleSection[] = [];

  $('#main-text h2, #main-text h3, #main-text h4, #main-text h5, #main-text h6').each((_, element) => {
    // Only process proper section headings with an id attribute
    // This filters out headings used for emphasis (e.g., <h4>Can self-defense justify abortion?</h4>)
    // Proper headings look like: <h3 id="Pot">1.4 Potentiality</h3>
    const id = $(element).attr('id');
    if (!id) return;

    // content e.g. "2.2.2.4 Completeness as semi-decidability" -> heading = "Completeness as semi-decidability"
    const fullHeading = $(element).text().trim();
    const numberMatch = fullHeading.match(/^([\d.]+)\s+/);
    const number = numberMatch ? numberMatch[1].trim().replace(/\.$/, "") : '';
    const heading = number ? fullHeading.slice(number.length).replace(/^\./, "").trim() : fullHeading;

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
    related,
    created: createdDate,
    updated: updatedDate
  };
}