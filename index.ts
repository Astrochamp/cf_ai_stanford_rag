import 'dotenv/config';
import { OpenAI } from "openai";
import { createVerifyWorkerAuth } from './lib/auth';
import { processIngestionQueue } from './lib/ingestion';
import { addToIngestionQueue } from './lib/queue';
import express from 'express';

function requireEnvVar(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing or empty required environment variable: ${name}`);
  }
  return value;
}

const privateKeyPem = requireEnvVar('JWT_PRIVATE_KEY');
const workerPublicKeyPem = requireEnvVar('WORKER_PUBLIC_KEY');
const expressServerUrl = requireEnvVar('EXPRESS_SERVER_URL');
const cloudflareAccountId = requireEnvVar('CLOUDFLARE_ACCOUNT_ID');
const cloudflareApiToken = requireEnvVar('CLOUDFLARE_API_TOKEN');
const dbWorkerUrl = requireEnvVar('DB_WORKER_URL');
const openaiApiKey = requireEnvVar('OPENAI_API_KEY');

const openai = new OpenAI({
  apiKey: openaiApiKey,
});

const verifyWorkerAuth = createVerifyWorkerAuth(workerPublicKeyPem, expressServerUrl);

const app = express();
const port = process.env.PORT || 3000;

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
    await addToIngestionQueue(id, dbWorkerUrl, privateKeyPem);
  }

  await processIngestionQueue(dbWorkerUrl, privateKeyPem, cloudflareAccountId, cloudflareApiToken, openai);
}

processAllWithQueue().catch(console.error);