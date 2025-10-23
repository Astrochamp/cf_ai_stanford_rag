import { rerankChunks } from './cf';
import { executeD1Query, generateEmbedding, getGenerationText, queryVectorize, searchChunks } from './worker-api';

/**
 * Reciprocal Rank Fusion (RRF) score calculation
 * @param rank - Position in the ranked list (0-indexed)
 * @param k - Constant to reduce impact of high rankings (default 60)
 */
function rrfScore(rank: number, k: number = 60): number {
  return 1 / (k + rank + 1);
}

export interface ChunkNeighbor {
  chunk_id: string;
  section_id: string;
  chunk_index: number;
  chunk_text: string;
  num_tokens: number;
  r2_key: string | null;
  article_id: string;
  article_title: string;
  heading: string | null;
  section_number: string;
}

/**
 * Get neighboring chunks from the same section
 * 
 * Returns up to 2 neighboring chunks from the same section:
 * - If chunk is first in section: returns n+1 and n+2 (if they exist)
 * - If chunk is last in section: returns n-1 and n-2 (if they exist)
 * - Otherwise: returns n-1 and n+1
 * 
 * @param chunkId - The ID of the chunk to find neighbors for
 * @param dbWorkerUrl - Database worker URL
 * @param privateKeyPem - Private key for JWT auth
 * @returns Array of neighboring chunks (may be empty if section has only 1 chunk)
 */
export async function getChunkNeighbors(
  chunkId: string,
  dbWorkerUrl: string,
  privateKeyPem: string
): Promise<ChunkNeighbor[]> {
  // First, get the current chunk's section_id, chunk_index, and total chunks in section
  const currentChunkResult = await executeD1Query(
    `SELECT c.chunk_id, c.section_id, c.chunk_index, s.num_chunks
     FROM chunks c
     JOIN sections s ON c.section_id = s.section_id
     WHERE c.chunk_id = ?`,
    dbWorkerUrl,
    privateKeyPem,
    [chunkId]
  );

  if (!currentChunkResult.results || currentChunkResult.results.length === 0) {
    throw new Error(`Chunk not found: ${chunkId}`);
  }

  const currentChunk = currentChunkResult.results[0];
  const { section_id, chunk_index, num_chunks } = currentChunk;

  // If section has only 1 chunk, return empty array
  if (num_chunks <= 1) {
    return [];
  }

  // Determine which indices to fetch
  let indicesToFetch: number[] = [];

  if (chunk_index === 0) {
    // First chunk: get n+1 and n+2
    indicesToFetch = [1];
    if (num_chunks > 2) {
      indicesToFetch.push(2);
    }
  } else if (chunk_index === num_chunks - 1) {
    // Last chunk: get n-1 and n-2
    indicesToFetch = [chunk_index - 1];
    if (chunk_index >= 2) {
      indicesToFetch.unshift(chunk_index - 2);
    }
  } else {
    // Middle chunk: get n-1 and n+1
    indicesToFetch = [chunk_index - 1, chunk_index + 1];
  }

  // Fetch the neighboring chunks
  const placeholders = indicesToFetch.map(() => '?').join(',');
  const neighborsResult = await executeD1Query(
    `SELECT c.chunk_id, c.section_id, c.chunk_index, c.chunk_text, c.num_tokens, c.r2_key,
            s.heading, s.number as section_number,
            a.article_id, a.title as article_title
     FROM chunks c
     JOIN sections s ON c.section_id = s.section_id
     JOIN articles a ON s.article_id = a.article_id
     WHERE c.section_id = ? AND c.chunk_index IN (${placeholders})
     ORDER BY c.chunk_index`,
    dbWorkerUrl,
    privateKeyPem,
    [section_id, ...indicesToFetch]
  );

  return neighborsResult.results || [];
}

/**
 * Deduplicate and merge results from multiple search methods using RRF
 */
function mergeWithRRF(
  vectorResults: Array<{ id: string; score: number; }>,
  bm25Results: Array<{ chunk_id: string; rank: number; }>,
  topK: number = 50
): Array<{ chunk_id: string; rrf_score: number; }> {
  const scoresMap = new Map<string, number>();

  // Add vector search scores
  vectorResults.forEach((result, index) => {
    const score = rrfScore(index);
    scoresMap.set(result.id, (scoresMap.get(result.id) || 0) + score);
  });

  // Add BM25 scores
  bm25Results.forEach((result, index) => {
    const score = rrfScore(index);
    scoresMap.set(result.chunk_id, (scoresMap.get(result.chunk_id) || 0) + score);
  });

  // Sort by combined RRF score and take top K
  return Array.from(scoresMap.entries())
    .map(([chunk_id, rrf_score]) => ({ chunk_id, rrf_score }))
    .sort((a, b) => b.rrf_score - a.rrf_score)
    .slice(0, topK);
}

export interface HybridSearchResult {
  chunk_id: string;
  section_id: string;
  article_id: string;
  chunk_text: string;
  num_tokens: number;
  r2_key: string | null;
  heading: string | null;
  section_number: string;
  article_title: string;
  rrf_score: number;
  rerank_score: number;
  generation_text: string;
}

/**
 * Perform hybrid search combining vector search, BM25, and reranking
 * 
 * Steps:
 * 1. Query Vectorize for top 50 chunks
 * 2. Search D1 with BM25 (FTS5) for top 50 chunks
 * 3. Dedupe and unify with RRF
 * 4. Rerank using BGE reranker
 * 
 * @param query - User query string
 * @param dbWorkerUrl - Database worker URL
 * @param privateKeyPem - Private key for JWT auth
 * @param accountId - Cloudflare account ID
 * @param apiToken - Cloudflare API token
 * @param topK - Number of final results to return (default 10)
 * @param vectorTopK - Number of results from vector search (default 50)
 * @param bm25TopK - Number of results from BM25 search (default 50)
 * @param rrfTopK - Number of results after RRF fusion (default 50)
 */
export async function hybridSearch(
  query: string,
  dbWorkerUrl: string,
  privateKeyPem: string,
  accountId: string,
  apiToken: string,
  topK: number = 10,
  vectorTopK: number = 50,
  bm25TopK: number = 50,
  rrfTopK: number = 50
): Promise<HybridSearchResult[]> {
  // Step 1: Vector search
  const queryEmbedding = await generateEmbedding(query, accountId, apiToken);
  const vectorResults = await queryVectorize(
    queryEmbedding,
    vectorTopK,
    dbWorkerUrl,
    privateKeyPem
  );

  // Step 2: BM25 search
  const bm25Response = await searchChunks(query, dbWorkerUrl, privateKeyPem, bm25TopK);
  const bm25Results = bm25Response.results || [];

  // Step 3: Dedupe and merge with RRF
  const vectorMatches = vectorResults.matches || [];
  const mergedResults = mergeWithRRF(vectorMatches, bm25Results, rrfTopK);

  if (mergedResults.length === 0) {
    return [];
  }

  // Fetch full chunk data from D1
  const chunkIds = mergedResults.map(r => r.chunk_id);
  const placeholders = chunkIds.map(() => '?').join(',');

  const chunksResult = await executeD1Query(
    `SELECT c.chunk_id, c.section_id, c.chunk_text, c.num_tokens, c.r2_key, s.heading, s.number as section_number, 
            a.article_id, a.title as article_title
     FROM chunks c
     JOIN sections s ON c.section_id = s.section_id
     JOIN articles a ON s.article_id = a.article_id
     WHERE c.chunk_id IN (${placeholders})`,
    dbWorkerUrl,
    privateKeyPem,
    chunkIds
  );

  // Create a map of chunks for easy lookup
  const chunksMap = new Map<string, any>();
  if (chunksResult.results) {
    for (const row of chunksResult.results) {
      chunksMap.set(row.chunk_id, row);
    }
  }

  // Combine chunks with RRF scores, maintaining order
  const chunksWithScores = mergedResults
    .map(result => {
      const chunk = chunksMap.get(result.chunk_id);
      if (!chunk) return null;
      return {
        ...chunk,
        rrf_score: result.rrf_score,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  // Step 4: Rerank
  const contexts = chunksWithScores.map(c => c.chunk_text);
  const rerankResults = await rerankChunks(
    query,
    contexts,
    accountId,
    apiToken,
    { top_k: topK }
  );

  // Map rerank results back to chunks and fetch generation text
  const finalResults: HybridSearchResult[] = await Promise.all(
    rerankResults.map(async (result) => {
      const chunk = chunksWithScores[result.id];
      const generationText = await getGenerationText(chunk.chunk_id, dbWorkerUrl, privateKeyPem);

      return {
        ...chunk,
        rerank_score: result.score,
        generation_text: generationText,
      };
    })
  );

  return finalResults;
}
