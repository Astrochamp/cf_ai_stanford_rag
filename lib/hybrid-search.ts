import { executeD1Query, generateEmbedding, queryVectorize, searchChunks } from './worker-api';
import { rerankChunks } from './cf';

/**
 * Reciprocal Rank Fusion (RRF) score calculation
 * @param rank - Position in the ranked list (0-indexed)
 * @param k - Constant to reduce impact of high rankings (default 60)
 */
function rrfScore(rank: number, k: number = 60): number {
  return 1 / (k + rank + 1);
}

/**
 * Deduplicate and merge results from multiple search methods using RRF
 */
function mergeWithRRF(
  vectorResults: Array<{ id: string; score: number }>,
  bm25Results: Array<{ chunk_id: string; rank: number }>,
  topK: number = 50
): Array<{ chunk_id: string; rrf_score: number }> {
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
  heading: string | null;
  section_number: string;
  article_title: string;
  rrf_score: number;
  rerank_score: number;
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
  console.log('Step 1: Querying Vectorize...');
  const queryEmbedding = await generateEmbedding(query, accountId, apiToken);
  const vectorResults = await queryVectorize(
    queryEmbedding,
    vectorTopK,
    dbWorkerUrl,
    privateKeyPem
  );

  // Step 2: BM25 search
  console.log('Step 2: Performing BM25 search...');
  const bm25Response = await searchChunks(query, dbWorkerUrl, privateKeyPem, bm25TopK);
  const bm25Results = bm25Response.results || [];

  // Step 3: Dedupe and merge with RRF
  console.log('Step 3: Merging results with RRF...');
  const vectorMatches = vectorResults.matches || [];
  const mergedResults = mergeWithRRF(vectorMatches, bm25Results, rrfTopK);

  if (mergedResults.length === 0) {
    return [];
  }

  // Fetch full chunk data from D1
  console.log(`Fetching ${mergedResults.length} chunks from D1...`);
  const chunkIds = mergedResults.map(r => r.chunk_id);
  const placeholders = chunkIds.map(() => '?').join(',');
  
  const chunksResult = await executeD1Query(
    `SELECT c.chunk_id, c.section_id, c.chunk_text, s.heading, s.number as section_number, 
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
  console.log('Step 4: Reranking with BGE reranker...');
  const contexts = chunksWithScores.map(c => c.chunk_text);
  const rerankResults = await rerankChunks(
    query,
    contexts,
    accountId,
    apiToken,
    { top_k: topK }
  );

  // Map rerank results back to chunks
  const finalResults: HybridSearchResult[] = rerankResults.map(result => ({
    ...chunksWithScores[result.id],
    rerank_score: result.score,
  }));

  return finalResults;
}
