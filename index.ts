import 'dotenv/config';
import * as jose from 'jose';
import { fetchArticleContent } from './lib/fetch';
import { processArticleSectionDual } from './lib/preprocess';
import { m3embedSingleText, m3embedTextBatch } from './lib/cf';
import type { ArticleID, DBArticle, DBChunk, DBSection } from './lib/shared/types';


const MAX_TOKENS_PER_CHUNK = 1024;
const dbWorkerUrl = process.env.DB_WORKER_URL;
const privateKeyPem = process.env.JWT_PRIVATE_KEY;
const jwtAudience = dbWorkerUrl;
const workerPublicKeyPem = process.env.WORKER_PUBLIC_KEY; // Public key to verify Worker's requests
const expressServerUrl = process.env.EXPRESS_SERVER_URL; // This server's URL for audience validation

/**
 * Generates a signed JWT for authenticating requests to the Worker
 * Uses RS256 algorithm with 5-minute expiration
 */
async function generateWorkerAuthToken(): Promise<string> {
  if (!privateKeyPem) {
    throw new Error('JWT_PRIVATE_KEY environment variable is not set');
  }
  if (!jwtAudience) {
    throw new Error('DB_WORKER_URL must be set');
  }

  // Import the private key for RS256 signing
  const privateKey = await jose.importPKCS8(privateKeyPem, 'RS256');

  // Create JWT with required claims
  const jwt = await new jose.SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setAudience(jwtAudience)
    .setExpirationTime('5m') // 5 minutes from now
    .sign(privateKey);

  return jwt;
}

/**
 * Verifies a JWT token from the Worker in incoming Express requests
 * Returns the verified payload or null if verification fails
 */
async function verifyWorkerAuthToken(token: string): Promise<jose.JWTVerifyResult | null> {
  try {
    if (!workerPublicKeyPem) {
      throw new Error('WORKER_PUBLIC_KEY environment variable is not set');
    }
    if (!expressServerUrl) {
      throw new Error('EXPRESS_SERVER_URL environment variable is not set');
    }

    // Import the public key for RS256 verification
    const publicKey = await jose.importSPKI(workerPublicKeyPem, 'RS256');

    // Verify the JWT
    const result = await jose.jwtVerify(token, publicKey, {
      audience: expressServerUrl,
      algorithms: ['RS256'],
    });

    return result;
  } catch (error) {
    console.error('Worker JWT verification failed:', error);
    return null;
  }
}

/**
 * Express middleware to verify Worker authentication
 * Usage: app.post('/endpoint', verifyWorkerAuth, (req, res) => { ... })
 */
export async function verifyWorkerAuth(req: any, res: any, next: any) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    const verified = await verifyWorkerAuthToken(token);

    if (!verified) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    // Store verified payload in request for later use
    req.workerAuth = verified.payload;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}


// ============================================================================
// WORKER API FUNCTIONS
// ============================================================================

/**
 * Upload content to R2 via Worker proxy
 */
async function uploadToR2(key: string, content: string, contentType: string = 'text/plain'): Promise<void> {
  if (!dbWorkerUrl) {
    throw new Error('DB_WORKER_URL is not set');
  }

  const token = await generateWorkerAuthToken();
  const url = `${dbWorkerUrl}/r2/${key}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': contentType,
    },
    body: content,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to upload to R2: ${response.status} ${errorText}`);
  }
}

/**
 * Execute a single D1 query via Worker proxy
 */
async function executeD1Query(query: string, params?: any[]): Promise<any> {
  if (!dbWorkerUrl) {
    throw new Error('DB_WORKER_URL is not set');
  }

  const token = await generateWorkerAuthToken();
  const url = `${dbWorkerUrl}/d1/query`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, params }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to execute D1 query: ${response.status} ${errorText}`);
  }

  return response.json();
}

/**
 * Execute batch D1 queries via Worker proxy
 */
async function executeD1Batch(queries: Array<{ query: string; params?: any[]; }>): Promise<any[]> {
  if (!dbWorkerUrl) {
    throw new Error('DB_WORKER_URL is not set');
  }

  const token = await generateWorkerAuthToken();
  const url = `${dbWorkerUrl}/d1/batch`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ queries }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to execute D1 batch: ${response.status} ${errorText}`);
  }

  return response.json();
}

/**
 * Generate embeddings using Cloudflare Workers AI (BGE-M3 model)
 */
async function generateEmbedding(text: string): Promise<number[]> {
  return m3embedSingleText(text);
}

/**
 * Generate embeddings in batches using Cloudflare Workers AI (BGE-M3 model)
 * The CF API handles batching internally with max 100 texts per call
 */
async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  return m3embedTextBatch(texts);
}

// ============================================================================
// ARTICLE PROCESSING FUNCTIONS
// ============================================================================

/**
 * Store article metadata in D1
 */
async function storeArticleMetadata(article: DBArticle): Promise<void> {
  await executeD1Query(
    `INSERT OR REPLACE INTO articles (article_id, title, authors, created, updated)
     VALUES (?, ?, ?, ?, ?)`,
    [article.article_id, article.title, article.authors, article.created, article.updated]
  );
}

/**
 * Store section metadata in D1
 */
async function storeSectionMetadata(section: DBSection): Promise<void> {
  await executeD1Query(
    `INSERT OR REPLACE INTO sections (section_id, article_id, number, heading, num_chunks)
     VALUES (?, ?, ?, ?, ?)`,
    [section.section_id, section.article_id, section.number, section.heading, section.num_chunks]
  );
}

/**
 * Store chunk metadata in D1 (retrieval format)
 */
async function storeChunkMetadata(chunk: DBChunk): Promise<void> {
  await executeD1Query(
    `INSERT OR REPLACE INTO chunks (chunk_id, section_id, chunk_index, chunk_text, r2_url)
     VALUES (?, ?, ?, ?, ?)`,
    [chunk.chunk_id, chunk.section_id, chunk.chunk_index, chunk.chunk_text, chunk.r2_url]
  );
}

/**
 * Store generation format chunk in R2
 */
async function storeGenerationChunk(chunkId: string, generationText: string): Promise<string> {
  const key = `chunks/${chunkId}.txt`;
  await uploadToR2(key, generationText, 'text/plain');
  return key;
}

/**
 * Store multiple chunks in batch (optimized for performance)
 */
async function storeChunksBatch(
  chunks: DBChunk[],
  generationTexts: string[]
): Promise<void> {
  if (chunks.length !== generationTexts.length) {
    throw new Error('Chunks and generation texts arrays must have the same length');
  }

  // Upload all generation texts to R2
  const r2UploadPromises = chunks.map((chunk, index) =>
    storeGenerationChunk(chunk.chunk_id, generationTexts[index])
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

  await executeD1Batch(queries);
}

/**
 * Add article to ingestion queue
 */
async function addToIngestionQueue(articleId: string): Promise<void> {
  await executeD1Query(
    `INSERT OR IGNORE INTO ingestion_queue (article_id, status, retry_count)
     VALUES (?, 'pending', 0)`,
    [articleId]
  );
}

/**
 * Update ingestion queue status
 */
async function updateIngestionStatus(
  articleId: string,
  status: 'pending' | 'processing' | 'completed' | 'failed',
  errorMessage?: string
): Promise<void> {
  const now = Date.now();

  if (errorMessage) {
    await executeD1Query(
      `UPDATE ingestion_queue
       SET status = ?, last_attempt = ?, error_message = ?, retry_count = retry_count + 1
       WHERE article_id = ?`,
      [status, now, errorMessage, articleId]
    );
  } else {
    await executeD1Query(
      `UPDATE ingestion_queue
       SET status = ?, last_attempt = ?, error_message = NULL
       WHERE article_id = ?`,
      [status, now, articleId]
    );
  }
}

/**
 * Complete article processing pipeline
 */
async function processAndStoreArticle(articleId: string): Promise<void> {
  console.log(`Starting processing for article: ${articleId}`);

  try {
    // Update status to processing
    await updateIngestionStatus(articleId, 'processing');

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
    await storeArticleMetadata(dbArticle);

    // Step 3: Process preamble (always keep as single chunk)
    console.log('Step 3: Processing preamble...');
    const preambleChunks = await processArticleSectionDual(
      {
        number: '0',
        heading: 'Preamble',
        content: article.preamble
      },
      article.title,
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
    });

    // Store preamble chunks
    const preambleDbChunks: DBChunk[] = preambleChunks.map((chunk, index) => ({
      chunk_id: `${preambleSectionId}/chunk-${index}`,
      section_id: preambleSectionId,
      chunk_index: index,
      chunk_text: chunk.retrievalText,
      r2_url: null,
    }));

    const preambleGenerationTexts = preambleChunks.map(c => c.generationText);
    await storeChunksBatch(preambleDbChunks, preambleGenerationTexts);

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
      });

      // Prepare chunk data
      const dbChunks: DBChunk[] = chunks.map((chunk, index) => ({
        chunk_id: `${sectionId}/chunk-${index}`,
        section_id: sectionId,
        chunk_index: index,
        chunk_text: chunk.retrievalText,
        r2_url: null,
      }));

      const generationTexts = chunks.map(c => c.generationText);

      // Store chunks
      await storeChunksBatch(dbChunks, generationTexts);

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
    await vectorizeChunks(allChunksForVectorization);

    // Update status to completed
    await updateIngestionStatus(articleId, 'completed');
    console.log(`✓ Article ${articleId} processed successfully`);

  } catch (error) {
    console.error(`Error processing article ${articleId}:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    await updateIngestionStatus(articleId, 'failed', errorMessage);
    throw error;
  }
}

/**
 * Vectorize chunks and store embeddings
 * Generates embeddings using OpenAI and stores them in Cloudflare Vectorize
 */
async function vectorizeChunks(chunks: Array<{ chunkId: string; text: string; }>): Promise<void> {
  if (chunks.length === 0) {
    return;
  }

  console.log(`  Vectorizing ${chunks.length} chunks...`);

  // Process in batches of 100 (OpenAI API limit is 2048, but we stay conservative)
  const BATCH_SIZE = 100;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map(c => c.text);

    console.log(`  Generating embeddings for chunks ${i + 1}-${Math.min(i + BATCH_SIZE, chunks.length)}...`);
    const embeddings = await generateEmbeddingsBatch(texts);

    // Store embeddings in Cloudflare Vectorize
    const vectors = batch.map((c, idx) => ({
      id: c.chunkId,
      values: embeddings[idx],
      metadata: { chunkId: c.chunkId },
    }));

    await insertVectorsBatch(vectors);
    console.log(`  ✓ Stored ${embeddings.length} embeddings in Vectorize`);
  }
}

/**
 * Insert vectors into Vectorize via Worker proxy
 */
async function insertVectorsBatch(vectors: Array<{ id: string; values: number[]; metadata?: Record<string, any>; }>): Promise<void> {
  if (!dbWorkerUrl) {
    throw new Error('DB_WORKER_URL is not set');
  }

  const token = await generateWorkerAuthToken();
  const url = `${dbWorkerUrl}/vectorize/insert`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ vectors }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to insert vectors: ${response.status} ${errorText}`);
  }
}

/**
 * Query Vectorize for similar chunks
 */
async function queryVectorize(
  vector: number[],
  topK: number = 10,
  filter?: Record<string, any>
): Promise<any> {
  if (!dbWorkerUrl) {
    throw new Error('DB_WORKER_URL is not set');
  }

  const token = await generateWorkerAuthToken();
  const url = `${dbWorkerUrl}/vectorize/query`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      vector,
      topK,
      filter,
      returnMetadata: true,
      returnValues: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to query vectorize: ${response.status} ${errorText}`);
  }

  return response.json();
}

/**
 * Delete vectors from Vectorize
 */
async function deleteVectors(chunkIds: string[]): Promise<void> {
  if (!dbWorkerUrl) {
    throw new Error('DB_WORKER_URL is not set');
  }

  const token = await generateWorkerAuthToken();
  const url = `${dbWorkerUrl}/vectorize/delete`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ids: chunkIds }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to delete vectors: ${response.status} ${errorText}`);
  }
}

// ============================================================================
// QUEUE MANAGEMENT FUNCTIONS
// ============================================================================

/**
 * Get the next pending article from the ingestion queue
 */
async function getNextPendingArticle(): Promise<string | null> {
  const result = await executeD1Query(
    `SELECT article_id FROM ingestion_queue
     WHERE status IN ('pending', 'failed')
     ORDER BY last_attempt ASC NULLS FIRST
     LIMIT 1`
  );

  if (result.results && result.results.length > 0) {
    return result.results[0].article_id;
  }
  return null;
}

/**
 * Process all pending articles in the queue
 */
async function processIngestionQueue(): Promise<void> {
  console.log('Starting ingestion queue processing...');

  let articleId = await getNextPendingArticle();
  let processed = 0;

  while (articleId) {
    try {
      await processAndStoreArticle(articleId);
      processed++;
    } catch (error) {
      console.error(`Failed to process article ${articleId}:`, error);
      // Error is already logged in updateIngestionStatus
    }

    articleId = await getNextPendingArticle();
  }

  console.log(`\nIngestion queue processing complete. Processed ${processed} article(s).`);
}

/**
 * Get ingestion queue statistics
 */
async function getQueueStats(): Promise<Record<string, number>> {
  const result = await executeD1Query(
    `SELECT status, COUNT(*) as count
     FROM ingestion_queue
     GROUP BY status`
  );

  const stats: Record<string, number> = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  };

  if (result.results) {
    for (const row of result.results) {
      stats[row.status] = row.count;
    }
  }

  return stats;
}

// ============================================================================
// SEARCH & RETRIEVAL FUNCTIONS
// ============================================================================

/**
 * Search chunks using BM25 full-text search
 */
async function searchChunks(query: string, limit: number = 10): Promise<any> {
  if (!dbWorkerUrl) {
    throw new Error('DB_WORKER_URL is not set');
  }

  const token = await generateWorkerAuthToken();
  const url = new URL(`${dbWorkerUrl}/d1/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', limit.toString());

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to search chunks: ${response.status} ${errorText}`);
  }

  return response.json();
}

/**
 * Retrieve generation format text from R2
 */
async function getGenerationText(chunkId: string): Promise<string> {
  if (!dbWorkerUrl) {
    throw new Error('DB_WORKER_URL is not set');
  }

  const token = await generateWorkerAuthToken();
  const key = `chunks/${chunkId}.txt`;
  const url = `${dbWorkerUrl}/r2/${key}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to retrieve generation text: ${response.status} ${errorText}`);
  }

  return response.text();
}

/**
 * Perform semantic search using vector embeddings
 * Returns chunks ranked by semantic similarity
 */
async function semanticSearch(query: string, topK: number = 10): Promise<any[]> {
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

// ============================================================================
// EXAMPLE USAGE (uncomment to run)
// ============================================================================

/*
// Example 1: Process a single article
async function example1() {
  const articleId = 'logic-ancient';
  
  // Add to queue
  await addToIngestionQueue(articleId);
  
  // Process
  await processAndStoreArticle(articleId);
}

// Example 2: Batch processing
async function example2() {
  const articleIds = ['logic-ancient', 'logic-modal', 'logic-temporal'];
  
  // Add all to queue
  for (const id of articleIds) {
    await addToIngestionQueue(id);
  }
  
  // Process queue
  await processIngestionQueue();
}

// Example 3: BM25 full-text search and retrieve
async function example3() {
  const query = 'aristotle logic';
  
  // Search for relevant chunks using BM25
  const results = await searchChunks(query, 5);
  console.log('BM25 search results:', results);
  
  // Get generation format for first result
  if (results.results && results.results.length > 0) {
    const chunkId = results.results[0].chunk_id;
    const generationText = await getGenerationText(chunkId);
    console.log('Generation text:', generationText);
  }
}

// Example 4: Semantic search using embeddings
async function example4() {
  const query = 'What is the relationship between truth and validity in logic?';
  
  // Perform semantic search
  const results = await semanticSearch(query, 5);
  console.log('Semantic search results:');
  
  for (const result of results) {
    console.log(`
    Article: ${result.title}
    Section: ${result.number} - ${result.heading || '(untitled)'}
    Score: ${result.score}
    Preview: ${result.chunk_text.substring(0, 200)}...
    `);
  }
}

// Example 5: Monitor queue
async function example5() {
  const stats = await getQueueStats();
  console.log('Queue statistics:', stats);
}

// Run examples
// example1().catch(console.error);
// example2().catch(console.error);
// example3().catch(console.error);
// example4().catch(console.error);
// example5().catch(console.error);
*/