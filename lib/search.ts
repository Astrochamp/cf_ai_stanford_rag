import { executeD1Query, generateEmbedding, getGenerationText as getGenerationTextWorker, queryVectorize, searchChunks as searchChunksWorker } from './worker-api';

/**
 * Search chunks using BM25 full-text search
 */
export async function searchChunks(query: string, limit: number = 10): Promise<any> {
  return searchChunksWorker(query, limit);
}

/**
 * Retrieve generation format text from R2
 */
export async function getGenerationText(chunkId: string): Promise<string> {
  return getGenerationTextWorker(chunkId);
}

/**
 * Perform semantic search using vector embeddings
 * Returns chunks ranked by semantic similarity
 */
export async function semanticSearch(query: string, topK: number = 10): Promise<any[]> {
  // Generate embedding for the query
  const queryEmbedding = await generateEmbedding(query);

  // Query Vectorize for similar chunks
  const vectorResults = await queryVectorize(queryEmbedding, topK);

  // Extract chunk IDs and fetch full chunk data from D1
  if (!vectorResults.matches || vectorResults.matches.length === 0) {
    return [];
  }

  const chunkIds = vectorResults.matches.map((match: any) => match.id);

  // Build query to fetch chunks
  const placeholders = chunkIds.map(() => '?').join(',');
  const result = await executeD1Query(
    `SELECT c.chunk_id, c.section_id, c.chunk_text, c.r2_url, s.heading, s.number, a.title
     FROM chunks c
     JOIN sections s ON c.section_id = s.section_id
     JOIN articles a ON s.article_id = a.article_id
     WHERE c.chunk_id IN (${placeholders})`,
    chunkIds
  );

  // Merge with vector scores
  const chunksMap = new Map();
  if (result.results) {
    for (const row of result.results) {
      chunksMap.set(row.chunk_id, row);
    }
  }

  // Combine results with scores, maintaining order
  return vectorResults.matches.map((match: any) => ({
    ...chunksMap.get(match.id),
    score: match.score,
  })).filter((item: any) => item.chunk_id); // Filter out any missing chunks
}
