// `Env` object can be regenerated with `npm run cf-typegen`

import * as jose from 'jose';

export interface Env {
  d1: D1Database;
  JWT_PUBLIC_KEY: string; // RS256 public key in PEM format (for verifying incoming requests)
  JWT_AUDIENCE: string; // expected audience claim (for incoming requests)
  WORKER_PRIVATE_KEY: string; // RS256 private key in PEM format (for signing outgoing requests)
  EXPRESS_SERVER_URL: string; // URL of the Express server to call
}

/**
 * Verifies a JWT token from the Authorization header
 * Returns the verified payload or null if verification fails
 */
async function verifyAuthToken(request: Request, env: Env): Promise<jose.JWTVerifyResult | null> {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7); // remove 'Bearer ' prefix
    const publicKey = await jose.importSPKI(env.JWT_PUBLIC_KEY, 'RS256');

    const result = await jose.jwtVerify(token, publicKey, {
      audience: env.JWT_AUDIENCE,
      algorithms: ['RS256'],
    });

    return result;
  } catch (error) {
    console.error('JWT verification failed:', error);
    return null;
  }
}

/**
 * Middleware to check authentication
 * Returns an error Response if auth fails, or null if auth succeeds
 */
async function requireAuth(request: Request, env: Env): Promise<Response | null> {
  const verified = await verifyAuthToken(request, env);

  if (!verified) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null;
}

/**
 * Generates a signed JWT for authenticating Worker requests to the Express server
 * Uses RS256 algorithm with 5-minute expiration
 */
async function generateExpressAuthToken(env: Env): Promise<string> {
  if (!env.WORKER_PRIVATE_KEY) {
    throw new Error('WORKER_PRIVATE_KEY environment variable is not set');
  }
  if (!env.EXPRESS_SERVER_URL) {
    throw new Error('EXPRESS_SERVER_URL must be set');
  }

  // Import the private key for RS256 signing
  const privateKey = await jose.importPKCS8(env.WORKER_PRIVATE_KEY, 'RS256');

  // Create JWT with required claims
  const jwt = await new jose.SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setAudience(env.EXPRESS_SERVER_URL)
    .setExpirationTime('5m') // 5 minutes from now
    .sign(privateKey);

  return jwt;
}

/**
 * Helper function to make authenticated requests to the Express server
 */
async function callExpressEndpoint(
  env: Env,
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await generateExpressAuthToken(env);
  const url = `${env.EXPRESS_SERVER_URL}${endpoint}`;

  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);

  return fetch(url, {
    ...options,
    headers,
  });
}


async function searchChunks(env: Env, searchQuery: string, limit: number = 10) {
  // basic BM25 search - returns results ranked by relevance
  const results = await env.d1.prepare(`
    SELECT 
      chunks.chunk_id,
      chunks.section_id,
      chunks.chunk_text,
      chunks_fts.rank as bm25_score
    FROM chunks_fts
    JOIN chunks ON chunks.rowid = chunks_fts.rowid
    WHERE chunks_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).bind(searchQuery, limit).all();
  return results;
}

async function simpleSearchChunks(env: Env, searchQuery: string, limit: number = 10) {
  // simple search without joins - returns chunk text and rank only
  const results = await env.d1.prepare(`
  SELECT chunk_text, rank
  FROM chunks_fts
  WHERE chunks_fts MATCH ?
  ORDER BY rank
  LIMIT ?
`).bind(searchQuery, limit).all();
  return results;
}


export default {
  async fetch(request, env, ctx): Promise<Response> {
    const authError = await requireAuth(request, env);
    if (authError) {
      return authError;
    }

    return new Response('Hello World!');
  },
} satisfies ExportedHandler<Env>;
