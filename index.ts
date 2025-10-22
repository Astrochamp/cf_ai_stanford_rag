import 'dotenv/config';
import { createVerifyWorkerAuth } from './lib/auth';
import { processAndStoreArticle, processIngestionQueue } from './lib/ingestion';
import { addToIngestionQueue, getQueueStats } from './lib/queue';
import { getGenerationText, searchChunks, semanticSearch } from './lib/search';
import { deleteVectors } from './lib/worker-api';
import { OpenAI } from "openai";

const privateKeyPem = process.env.JWT_PRIVATE_KEY;
const workerPublicKeyPem = process.env.WORKER_PUBLIC_KEY;
const expressServerUrl = process.env.EXPRESS_SERVER_URL;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const dbWorkerUrl = process.env.DB_WORKER_URL;

const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
}) : null;

const verifyWorkerAuth = createVerifyWorkerAuth(workerPublicKeyPem, expressServerUrl);

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

async function processAllWithQueue() {
  const articleIds = ['logic-ancient', 'logic-modal', 'logic-temporal'];
  for (const id of articleIds) {
    await addToIngestionQueue(id);
  }

  await processIngestionQueue();
}