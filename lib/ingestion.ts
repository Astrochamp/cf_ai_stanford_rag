import OpenAI from 'openai';
import { fetchArticleContent } from './fetch';
import { processArticleSectionDual } from './preprocess';
import { getNextPendingArticle, updateIngestionStatus } from './queue';
import type { ArticleID, DBArticle, DBChunk } from './shared/types';
import { storeArticleMetadata, storeChunksBatch, storeSectionMetadata, vectorizeChunks } from './storage';

const MAX_TOKENS_PER_CHUNK = 1024;

/**
 * Complete article processing pipeline
 */
export async function processAndStoreArticle(
  articleId: string,
  dbWorkerUrl: string,
  privateKeyPem: string,
  accountId: string,
  apiToken: string,
  openai: OpenAI
): Promise<void> {
  console.log(`Starting processing for article: ${articleId}`);

  try {
    // Update status to processing
    await updateIngestionStatus(articleId, 'processing', dbWorkerUrl, privateKeyPem);

    // Step 1: Fetch article
    console.log('Step 1: Fetching article...');
    const article = await fetchArticleContent(articleId as ArticleID);

    const dbArticle: DBArticle = {
      article_id: article.id,
      title: article.title,
      authors: article.authors.length > 0 ? article.authors.join('; ') : null,
      created: article.created,
      updated: article.updated
    };

    // Step 2: Store article metadata
    console.log('Step 2: Storing article metadata...');
    await storeArticleMetadata(dbArticle, dbWorkerUrl, privateKeyPem);

    // Step 3: Process preamble (always keep as single chunk)
    console.log('Step 3: Processing preamble...');
    const preambleChunks = await processArticleSectionDual(
      {
        number: '0',
        heading: 'Preamble',
        content: article.preamble
      },
      article.title,
      openai,
      Infinity // Use Infinity to ensure preamble is never split
    );

    // Store preamble section
    const preambleSectionId = `${article.id}/0`;
    await storeSectionMetadata({
      section_id: preambleSectionId,
      article_id: article.id,
      number: '0',
      heading: 'Preamble',
      num_chunks: preambleChunks.length
    }, dbWorkerUrl, privateKeyPem);

    // Store preamble chunks
    const preambleDbChunks: DBChunk[] = preambleChunks.map((chunk, index) => ({
      chunk_id: `${preambleSectionId}/chunk-${index}`,
      section_id: preambleSectionId,
      chunk_index: index,
      chunk_text: chunk.retrievalText,
      num_tokens: chunk.tokenCount,
      r2_url: null,
    }));

    const preambleGenerationTexts = preambleChunks.map(c => c.generationText);
    await storeChunksBatch(preambleDbChunks, preambleGenerationTexts, dbWorkerUrl, privateKeyPem);

    // Step 4: Process all sections
    console.log('Step 4: Processing sections...');
    const allChunksForVectorization: Array<{ chunkId: string; text: string; }> = [];

    // Add preamble chunks to vectorization queue
    preambleDbChunks.forEach(chunk => {
      allChunksForVectorization.push({
        chunkId: chunk.chunk_id,
        text: chunk.chunk_text,
      });
    });

    for (let i = 0; i < article.sections.length; i++) {
      const section = article.sections[i];
      console.log(`  Processing section ${section.number}: ${section.heading || '(untitled)'}...`);

      const chunks = await processArticleSectionDual(
        section,
        article.title,
        openai,
        MAX_TOKENS_PER_CHUNK
      );

      // Store section metadata
      const sectionId = `${article.id}/${section.number}`;
      await storeSectionMetadata({
        section_id: sectionId,
        article_id: article.id,
        number: section.number,
        heading: section.heading || null,
        num_chunks: chunks.length
      }, dbWorkerUrl, privateKeyPem);

      // Prepare chunk data
      const dbChunks: DBChunk[] = chunks.map((chunk, index) => ({
        chunk_id: `${sectionId}/chunk-${index}`,
        section_id: sectionId,
        chunk_index: index,
        chunk_text: chunk.retrievalText,
        num_tokens: chunk.tokenCount,
        r2_url: null,
      }));

      const generationTexts = chunks.map(c => c.generationText);

      // Store chunks
      await storeChunksBatch(dbChunks, generationTexts, dbWorkerUrl, privateKeyPem);

      // Add to vectorization queue
      dbChunks.forEach(chunk => {
        allChunksForVectorization.push({
          chunkId: chunk.chunk_id,
          text: chunk.chunk_text,
        });
      });
    }

    // Step 5: Generate and store embeddings
    console.log('Step 5: Generating embeddings...');
    await vectorizeChunks(allChunksForVectorization, dbWorkerUrl, privateKeyPem, accountId, apiToken);

    // Update status to completed
    await updateIngestionStatus(articleId, 'completed', dbWorkerUrl, privateKeyPem);
    console.log(`✓ Article ${articleId} processed successfully`);

  } catch (error) {
    console.error(`Error processing article ${articleId}:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    await updateIngestionStatus(articleId, 'failed', dbWorkerUrl, privateKeyPem, errorMessage);
    throw error;
  }
}

/**
 * Process all pending articles in the queue
 */
export async function processIngestionQueue(
  dbWorkerUrl: string,
  privateKeyPem: string,
  accountId: string,
  apiToken: string,
  openai: OpenAI
): Promise<void> {
  console.log('Starting ingestion queue processing...');

  let articleId = await getNextPendingArticle(dbWorkerUrl, privateKeyPem);
  let processed = 0;

  while (articleId) {
    try {
      await processAndStoreArticle(articleId, dbWorkerUrl, privateKeyPem, accountId, apiToken, openai);
      processed++;
    } catch (error) {
      console.error(`Failed to process article ${articleId}:`, error);
      // Error is already logged in updateIngestionStatus
    }

    articleId = await getNextPendingArticle(dbWorkerUrl, privateKeyPem);
  }

  console.log(`\nIngestion queue processing complete. Processed ${processed} article(s).`);
}
