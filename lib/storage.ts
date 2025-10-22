import type { DBArticle, DBChunk, DBSection } from './shared/types';
import { executeD1Batch, executeD1Query, generateEmbeddingsBatch, insertVectorsBatch, uploadToR2 } from './worker-api';

/**
 * Store article metadata in D1
 */
export async function storeArticleMetadata(article: DBArticle, dbWorkerUrl: string, privateKeyPem: string): Promise<void> {
  await executeD1Query(
    `INSERT OR REPLACE INTO articles (article_id, title, authors, created, updated)
     VALUES (?, ?, ?, ?, ?)`,
    dbWorkerUrl,
    privateKeyPem,
    [article.article_id, article.title, article.authors, article.created, article.updated]
  );
}

/**
 * Store section metadata in D1
 */
export async function storeSectionMetadata(section: DBSection, dbWorkerUrl: string, privateKeyPem: string): Promise<void> {
  await executeD1Query(
    `INSERT OR REPLACE INTO sections (section_id, article_id, number, heading, num_chunks)
     VALUES (?, ?, ?, ?, ?)`,
    dbWorkerUrl,
    privateKeyPem,
    [section.section_id, section.article_id, section.number, section.heading, section.num_chunks]
  );
}

/**
 * Store chunk metadata in D1 (retrieval format)
 */
export async function storeChunkMetadata(chunk: DBChunk, dbWorkerUrl: string, privateKeyPem: string): Promise<void> {
  await executeD1Query(
    `INSERT OR REPLACE INTO chunks (chunk_id, section_id, chunk_index, chunk_text, r2_url)
     VALUES (?, ?, ?, ?, ?)`,
    dbWorkerUrl,
    privateKeyPem,
    [chunk.chunk_id, chunk.section_id, chunk.chunk_index, chunk.chunk_text, chunk.r2_url]
  );
}

/**
 * Store generation format chunk in R2
 */
export async function storeGenerationChunk(chunkId: string, generationText: string, dbWorkerUrl: string, privateKeyPem: string): Promise<string> {
  const key = `chunks/${chunkId}.txt`;
  await uploadToR2(key, generationText, dbWorkerUrl, privateKeyPem, 'text/plain');
  return key;
}

/**
 * Store multiple chunks in batch (optimized for performance)
 */
export async function storeChunksBatch(
  chunks: DBChunk[],
  generationTexts: string[],
  dbWorkerUrl: string,
  privateKeyPem: string
): Promise<void> {
  if (chunks.length !== generationTexts.length) {
    throw new Error('Chunks and generation texts arrays must have the same length');
  }

  // Upload all generation texts to R2
  const r2UploadPromises = chunks.map((chunk, index) =>
    storeGenerationChunk(chunk.chunk_id, generationTexts[index], dbWorkerUrl, privateKeyPem)
  );
  const r2Keys = await Promise.all(r2UploadPromises);

  // Update chunks with R2 URLs
  const updatedChunks = chunks.map((chunk, index) => ({
    ...chunk,
    r2_url: r2Keys[index],
  }));

  // Batch insert into D1
  const queries = updatedChunks.map(chunk => ({
    query: `INSERT OR REPLACE INTO chunks (chunk_id, section_id, chunk_index, chunk_text, r2_url)
            VALUES (?, ?, ?, ?, ?)`,
    params: [chunk.chunk_id, chunk.section_id, chunk.chunk_index, chunk.chunk_text, chunk.r2_url],
  }));

  await executeD1Batch(queries, dbWorkerUrl, privateKeyPem);
}

/**
 * Vectorize chunks and store embeddings
 * Generates embeddings using Cloudflare Workers AI and stores them in Vectorize
 */
export async function vectorizeChunks(
  chunks: Array<{ chunkId: string; text: string; }>,
  dbWorkerUrl: string,
  privateKeyPem: string,
  accountId: string,
  apiToken: string
): Promise<void> {
  if (chunks.length === 0) {
    return;
  }

  console.log(`  Vectorizing ${chunks.length} chunks...`);

  // Process in batches of 100 (API limit)
  const BATCH_SIZE = 100;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map(c => c.text);

    console.log(`  Generating embeddings for chunks ${i + 1}-${Math.min(i + BATCH_SIZE, chunks.length)}...`);
    const embeddings = await generateEmbeddingsBatch(texts, accountId, apiToken);

    // Store embeddings in Cloudflare Vectorize
    const vectors = batch.map((c, idx) => ({
      id: c.chunkId,
      values: embeddings[idx],
      metadata: { chunkId: c.chunkId },
    }));

    await insertVectorsBatch(vectors, dbWorkerUrl, privateKeyPem);
    console.log(`  ✓ Stored ${embeddings.length} embeddings in Vectorize`);
  }
}
