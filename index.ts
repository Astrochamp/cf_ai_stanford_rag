import 'dotenv/config';
import * as jose from 'jose';
import { fetchArticleContent } from './lib/fetch';
import { processArticleSectionDual } from './lib/preprocess';
import type { ArticleID, DBArticle, DBChunk, DBSection, ProcessedChunk } from './lib/shared/types';


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


async function processArticle(articleId: string) {
  try {
    // Step 1: Fetch article
    const article = await fetchArticleContent(articleId as ArticleID);
    const dbArticle: DBArticle = {
      article_id: article.id,
      title: article.title,
      authors: article.authors.length > 0 ? article.authors.join('; ') : null,
      created: article.created,
      updated: article.updated
    };

    // Step 2: Process preamble (always keep as single chunk)
    const preambleChunks = await processArticleSectionDual(
      {
        number: '0',
        heading: 'Preamble',
        content: article.preamble
      },
      article.title,
      Infinity // Use Infinity to ensure preamble is never split
    );

    // Step 3: Process all sections
    const dbSections: DBSection[] = [];
    const dbChunks: DBChunk[] = [];
    const sectionChunksMap: Record<string, ProcessedChunk[]> = {};

    for (let i = 0; i < article.sections.length; i++) {
      const section = article.sections[i];

      const chunks = await processArticleSectionDual(
        section,
        article.title,
        MAX_TOKENS_PER_CHUNK
      );

      // Create DBSection entry
      const sectionId = `${article.id}/${section.number}`;
      dbSections.push({
        section_id: sectionId,
        article_id: article.id,
        number: section.number,
        heading: section.heading || null,
        num_chunks: chunks.length
      });

      // Create DBChunk entries
      chunks.forEach((chunk, index) => {
        dbChunks.push({
          chunk_id: `${sectionId}/chunk-${index}`,
          section_id: sectionId,
          chunk_index: index,
          chunk_text: chunk.retrievalText,
          r2_url: null // Placeholder, to be filled after R2 upload
        });
      });

      sectionChunksMap[sectionId] = chunks; // to allow generationText to be stored in R2
    }

    // upload chunk generationText to R2 via Worker


  } catch (error) {
    console.error('Error processing article:', error);
  }
}