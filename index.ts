import 'dotenv/config';
import { fetchArticleContent, fetchArticlesList } from './lib/fetch';
import { processArticleSectionDual } from './lib/preprocess';
import type { ArticleID, ArticleSection, ProcessedChunk, DBArticle, DBChunk, DBIngestionQueue, DBSection } from './lib/shared/types';


const MAX_TOKENS_PER_CHUNK = 1024;


async function testArticleProcessing(articleId: string) {
  try {
    // Step 1: Fetch article
    const article = await fetchArticleContent(articleId as ArticleID);
    const dbArticle: DBArticle = {
      article_id: article.id,
      title: article.title,
      authors: article.authors.length > 0 ? article.authors.join('; ') : null,
      created: article.created,
      updated: article.updated
    };

    // Step 2: Process preamble (always keep as single chunk)
    const preambleChunks = await processArticleSectionDual(
      {
        number: '0',
        heading: 'Preamble',
        content: article.preamble
      },
      article.title,
      Infinity // Use Infinity to ensure preamble is never split
    );

    // Step 3: Process all sections
    const dbSections: DBSection[] = [];
    const dbChunks: DBChunk[] = [];
    const sectionChunksMap: Record<string, ProcessedChunk[]> = {};

    for (let i = 0; i < article.sections.length; i++) {
      const section = article.sections[i];

      const chunks = await processArticleSectionDual(
        section,
        article.title,
        MAX_TOKENS_PER_CHUNK
      );

      // Create DBSection entry
      const sectionId = `${article.id}/${section.number}`;
      dbSections.push({
        section_id: sectionId,
        article_id: article.id,
        number: section.number,
        heading: section.heading || null,
        num_chunks: chunks.length
      });

      // Create DBChunk entries
      chunks.forEach((chunk, index) => {
        dbChunks.push({
          chunk_id: `${sectionId}/chunk-${index + 1}`,
          section_id: sectionId,
          chunk_index: index,
          chunk_text: chunk.retrievalText,
          r2_url: null // Placeholder, to be filled after R2 upload
        });
      });

      sectionChunksMap[sectionId] = chunks; // to allow generationText to be stored in R2
    }

    

  } catch (error) {
    console.error('Error processing article:', error);
  }
}