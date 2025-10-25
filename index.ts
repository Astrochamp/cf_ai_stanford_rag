import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import { OpenAI } from "openai";
import { createVerifyWorkerAuth } from './lib/auth';
import { fetchArticlesList, fetchRssArticles } from './lib/fetch';
import { createEvidenceJson, generateResponse, LLMEvidenceItem } from './lib/generation';
import { hybridSearch } from './lib/hybrid-search';
import { processIngestionQueue } from './lib/ingestion';
import { addToIngestionQueue } from './lib/queue';
import { classifyQueryRelevance, turnstileMiddleware } from './lib/security';
import { getArticleUpdatedDate } from './lib/worker-api';


function requireEnvVar(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing or empty required environment variable: ${name}`);
  }
  return value;
}

const privateKeyPem = requireEnvVar('JWT_PRIVATE_KEY').replace(/\\n/g, '\n');
const workerPublicKeyPem = requireEnvVar('WORKER_PUBLIC_KEY').replace(/\\n/g, '\n');
const expressServerUrl = requireEnvVar('EXPRESS_SERVER_URL');
const cloudflareAccountId = requireEnvVar('CLOUDFLARE_ACCOUNT_ID');
const cloudflareApiToken = requireEnvVar('CLOUDFLARE_API_TOKEN');
const dbWorkerUrl = requireEnvVar('DB_WORKER_URL');
const openaiApiKey = requireEnvVar('OPENAI_API_KEY');
const turnstileSecretKey = requireEnvVar('TURNSTILE_SECRET_KEY');

const openai = new OpenAI({
  apiKey: openaiApiKey,
});

const verifyWorkerAuth = createVerifyWorkerAuth(workerPublicKeyPem, expressServerUrl);

const turnstile = turnstileMiddleware({
  secretKey: turnstileSecretKey,
});

const app = express();
const port = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'", "'unsafe-inline'", "challenges.cloudflare.com"],
      "frame-src": ["'self'", "'unsafe-inline'", "challenges.cloudflare.com"],
      "style-src": ["'self'", "'unsafe-inline'"]
    }
  }
})); // Set security HTTP headers

app.use(express.json());

// Enable CORS for frontend
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Logging
app.use(morgan('combined'));

// proxy config
app.set('trust proxy', 2); // Trust first proxy (for Heroku, etc.)

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // limit each IP to 15 requests per windowMs
  standardHeaders: true,
  legacyHeaders: true,
});

app.use('/search', limiter);

// ============================================================================
// API ENDPOINTS
// ============================================================================

/**
 * POST /search
 * Hybrid search endpoint combining vector search, BM25, RRF fusion, reranking, and LLM generation
 * 
 * Body:
 * - query: string (required) - The search query (max 4000 characters)
 * - topK: number (optional, default 12, [1,12]) - Number of final results
 */
app.post('/search', turnstile, async (req, res) => {
  try {
    let { query, topK = 12 } = req.body;

    const vectorTopK = 50;
    const bm25TopK = 50;
    const rrfTopK = 50;

    if (!query || typeof query !== 'string' || query.trim().length === 0 || query.length > 4000) {
      return res.status(400).json(
        {
          error: 'Query is required and must be a non-empty string with a maximum length of 4000 characters',
          code: 'invalid_query'
        }
      );
    }

    if (topK < 1 || topK > 12 || !Number.isInteger(topK)) {
      return res.status(400).json(
        {
        error: 'topK must be an integer between 1 and 12 (inclusive)',
        code: 'invalid_topK'
        }
      );
    }

    // Classify query relevance before proceeding with RAG
    const relevance = await classifyQueryRelevance(query, openai);

    if (relevance === 'not_relevant') {
      return res.status(400).json({
        error: 'Query not relevant',
        code: 'query_not_relevant',
        message: 'Your query does not appear to be related to philosophy. This search system is designed for philosophical topics, theories, arguments, and related academic content.'
      });
    }

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

    // Convert search results to evidence items
    const { evidenceJson, articleIdMap } = createEvidenceJson(results);
    const llmEvidenceItems: LLMEvidenceItem[] = JSON.parse(evidenceJson);
    const sources = llmEvidenceItems.map(item => {
      return {
        id: item.id,
        article_id: articleIdMap.get(item.id) || '',
        doc_title: item.doc_title,
        section_heading: item.section_heading,
        text: item.text,
      };
    });


    // Generate LLM response using the evidence
    const responseText = await generateResponse(query, llmEvidenceItems, openai);

    return res.json({
      query,
      response: responseText,
      sources: sources,
      count: sources.length,
    });
  } catch (error) {
    console.error('Search error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      code: 'internal_server_error'
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

/**
 * POST /ingest
 * Authenticated endpoint to begin article ingestion
 * Requires valid JWT token from worker
 */
app.post('/ingest', verifyWorkerAuth, async (req, res) => {
  try {
    const articleIds = await fetchArticlesList();

    // Add articles to ingestion queue
    const queued: string[] = [];
    const failed: { articleId: string; error: string; }[] = [];

    for (const articleId of articleIds) {
      try {
        await addToIngestionQueue(articleId, dbWorkerUrl, privateKeyPem);
        queued.push(articleId);
      } catch (error) {
        failed.push({
          articleId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Start processing the queue in background
    processIngestionQueue(dbWorkerUrl, privateKeyPem, cloudflareAccountId, cloudflareApiToken, openai)
      .catch(error => {
        console.error('Background ingestion processing error:', error);
      });

    return res.json({
      message: 'Ingestion started',
      queued,
      failed,
      total: articleIds.length,
      queuedCount: queued.length,
      failedCount: failed.length
    });
  } catch (error) {
    console.error('Ingestion endpoint error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      code: 'internal_server_error'
    });
  }
});

/**
 * POST /ingest-updates
 * Authenticated endpoint to process new and revised articles from RSS feed
 * Requires valid JWT token from worker
 * No parameters required - fetches latest updates from SEP RSS feed
 * 
 * Only processes articles that are:
 * - New (not in database), OR
 * - Revised (RSS pubDate is more recent than database updated date)
 */
app.post('/ingest-updates', verifyWorkerAuth, async (req, res) => {
  try {
    // Fetch RSS feed items with article IDs and publication dates
    const rssItems = await fetchRssArticles();

    // Track results
    const queued: string[] = [];
    const skipped: string[] = [];
    const failed: { articleId: string; error: string; }[] = [];

    // Check each article and determine if it needs processing
    for (const item of rssItems) {
      try {
        const articleId = item.articleId;
        const rssPubDate = item.pubDate;

        // Get the article's updated date from the database (null if doesn't exist)
        const dbUpdatedDate = await getArticleUpdatedDate(articleId, dbWorkerUrl, privateKeyPem);

        let shouldQueue = false;

        if (dbUpdatedDate === null) {
          // Article doesn't exist in database - queue it
          shouldQueue = true;
        } else {
          // Article exists - compare dates
          // Database stores dates in YYYY-MM-DD format (UTC)
          // RSS pubDate is a Date object parsed from RFC 2822 format (Pacific Time)

          // Convert database date string to Date object (treat as UTC midnight)
          const dbDate = new Date(dbUpdatedDate + 'T00:00:00Z');

          // Convert RSS pubDate to just the date (ignore time) for comparison
          // Extract YYYY-MM-DD in UTC from the RSS date
          const rssPubDateUTC = new Date(Date.UTC(
            rssPubDate.getUTCFullYear(),
            rssPubDate.getUTCMonth(),
            rssPubDate.getUTCDate()
          ));

          // Queue if RSS publication date is newer than database date
          if (rssPubDateUTC > dbDate) {
            shouldQueue = true;
          }
        }

        if (shouldQueue) {
          await addToIngestionQueue(articleId, dbWorkerUrl, privateKeyPem);
          queued.push(articleId);
        } else {
          skipped.push(articleId);
        }
      } catch (error) {
        failed.push({
          articleId: item.articleId,
          error: 'Unknown error'
        });
      }
    }

    // Start processing the queue in background if there are items to process
    if (queued.length > 0) {
      processIngestionQueue(dbWorkerUrl, privateKeyPem, cloudflareAccountId, cloudflareApiToken, openai)
        .catch(error => {
          console.error('Background ingestion processing error:', error);
        });
    }

    return res.json({
      message: 'Update ingestion started',
      queued,
      skipped,
      failed,
      total: rssItems.length,
      queuedCount: queued.length,
      skippedCount: skipped.length,
      failedCount: failed.length
    });
  } catch (error) {
    console.error('Update ingestion endpoint error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      code: 'internal_server_error'
    });
  }
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

app.listen(port, () => {
  console.log(`\n🚀 Server running on http://localhost:${port}`);
  console.log(`   POST /search - Hybrid search endpoint`);
  console.log(`   POST /ingest - Authenticated full ingestion endpoint`);
  console.log(`   POST /ingest-updates - Authenticated RSS updates endpoint`);
  console.log(`   GET  /health - Health check\n`);
});