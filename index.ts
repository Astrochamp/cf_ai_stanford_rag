import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { OpenAI } from "openai";
import { createVerifyWorkerAuth } from './lib/auth';
import { hybridSearch } from './lib/hybrid-search';
import { processIngestionQueue } from './lib/ingestion';
import { addToIngestionQueue } from './lib/queue';
import { generateResponse, createEvidenceJson, EvidenceItem } from './lib/generation';


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

// Enable CORS for frontend
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());

// ============================================================================
// API ENDPOINTS
// ============================================================================

/**
 * POST /search
 * Hybrid search endpoint combining vector search, BM25, RRF fusion, reranking, and LLM generation
 * 
 * Body:
 * - query: string (required) - The search query
 * - topK: number (optional, default 12, [1,12]) - Number of final results
 */
app.post('/search', async (req, res) => {
  try {
    let { query, topK = 12 } = req.body;

    const vectorTopK = 50;
    const bm25TopK = 50;
    const rrfTopK = 50;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({ error: 'Query is required and must be a non-empty string' });
    }

    if (topK < 1 || topK > 12 || !Number.isInteger(topK)) {
      return res.status(400).json({ error: 'topK must be an integer between 1 and 12 (inclusive)' });
    }

    // console.log(`\nSearch query: "${query}"`);
    // console.log(`Parameters: topK=${topK}, vectorTopK=${vectorTopK}, bm25TopK=${bm25TopK}, rrfTopK=${rrfTopK}`);

    const results = await hybridSearch(
      query,
      dbWorkerUrl,
      privateKeyPem,
      cloudflareAccountId,
      cloudflareApiToken,
      topK,
      vectorTopK,
      bm25TopK,
      rrfTopK
    );

    // console.log(`Found ${results.length} results`);

    // Convert search results to evidence items
    const evidenceJson = createEvidenceJson(results);
    const evidenceItems: EvidenceItem[] = JSON.parse(evidenceJson);

    // Generate LLM response using the evidence
    const responseText = await generateResponse(query, evidenceItems, openai);

    return res.json({
      query,
      response: responseText,
      sources: evidenceItems,
      count: evidenceItems.length,
    });
  } catch (error) {
    console.error('Search error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

app.listen(port, () => {
  console.log(`\n🚀 Server running on http://localhost:${port}`);
  console.log(`   POST /search - Hybrid search endpoint`);
  console.log(`   GET  /health - Health check\n`);
});

// ============================================================================
// INGESTION SCRIPT (uncomment to run)
// ============================================================================

// async function processAllWithQueue() {
//   const articleIds = ['logic-temporal'];
//   for (const id of articleIds) {
//     await addToIngestionQueue(id, dbWorkerUrl, privateKeyPem);
//   }

//   await processIngestionQueue(dbWorkerUrl, privateKeyPem, cloudflareAccountId, cloudflareApiToken, openai);
// }

// processAllWithQueue().catch(console.error);