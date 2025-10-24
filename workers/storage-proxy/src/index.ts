// `Env` object can be regenerated with `npm run cf-typegen`

import * as jose from 'jose';

export interface Env {
  d1: D1Database;
  r2: R2Bucket;
  vectorize: VectorizeIndex; // Vectorize binding for embeddings
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


// Sanitize FTS5 query by escaping special characters and removing problematic punctuation
function sanitizeFTS5Query(query: string): string {
  // Remove or escape FTS5 special characters: " * ? : ( ) [ ] { } ^ $ + - = < > ! | & ~ \
  // For simplicity, we'll just remove punctuation except spaces and basic word characters
  return query
    .replace(/[^\w\s]/g, ' ')  // Replace non-alphanumeric (except spaces) with space
    .replace(/\s+/g, ' ')       // Normalize multiple spaces to single space
    .trim();
}

async function searchChunks(env: Env, searchQuery: string, limit: number = 10) {
  // basic BM25 search - returns results ranked by relevance
  const sanitizedQuery = sanitizeFTS5Query(searchQuery);

  const results = await env.d1.prepare(`
    SELECT 
      chunks.chunk_id,
      chunks.section_id,
      chunks.chunk_text,
      chunks.num_tokens,
      chunks_fts.rank as bm25_score
    FROM chunks_fts
    JOIN chunks ON chunks.rowid = chunks_fts.rowid
    WHERE chunks_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).bind(sanitizedQuery, limit).all();
  return results;
}

async function simpleSearchChunks(env: Env, searchQuery: string, limit: number = 10) {
  // simple search without joins - returns chunk text and rank only
  const sanitizedQuery = sanitizeFTS5Query(searchQuery);

  const results = await env.d1.prepare(`
  SELECT chunk_text, rank
  FROM chunks_fts
  WHERE chunks_fts MATCH ?
  ORDER BY rank
  LIMIT ?
`).bind(sanitizedQuery, limit).all();
  return results;
}

/**
 * R2 Proxy Functions
 */

async function handleR2Get(env: Env, key: string): Promise<Response> {
  const object = await env.r2.get(key);

  if (object === null) {
    return new Response(JSON.stringify({ error: 'Object not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);

  return new Response(object.body, {
    headers,
  });
}

async function handleR2Put(env: Env, key: string, request: Request): Promise<Response> {
  const body = await request.arrayBuffer();

  const metadata: Record<string, string> = {};
  const customMetadataPrefix = 'x-r2-metadata-';
  request.headers.forEach((value, key) => {
    if (key.toLowerCase().startsWith(customMetadataPrefix)) {
      const metaKey = key.substring(customMetadataPrefix.length);
      metadata[metaKey] = value;
    }
  });

  const httpMetadata: R2HTTPMetadata = {};
  const contentType = request.headers.get('content-type');
  if (contentType) {
    httpMetadata.contentType = contentType;
  }

  await env.r2.put(key, body, {
    httpMetadata,
    customMetadata: metadata,
  });

  return new Response(JSON.stringify({ success: true, key }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleR2Delete(env: Env, key: string): Promise<Response> {
  await env.r2.delete(key);

  return new Response(JSON.stringify({ success: true, key }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleR2List(env: Env, url: URL): Promise<Response> {
  const prefix = url.searchParams.get('prefix') || undefined;
  const limit = parseInt(url.searchParams.get('limit') || '1000');
  const cursor = url.searchParams.get('cursor') || undefined;

  const listed = await env.r2.list({
    prefix,
    limit,
    cursor,
  });

  const response: any = {
    objects: listed.objects.map(obj => ({
      key: obj.key,
      size: obj.size,
      etag: obj.etag,
      uploaded: obj.uploaded,
      httpEtag: obj.httpEtag,
    })),
    truncated: listed.truncated,
  };

  // Add cursor if available (only present when truncated)
  if ('cursor' in listed && listed.cursor) {
    response.cursor = listed.cursor;
  }

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleR2Head(env: Env, key: string): Promise<Response> {
  const object = await env.r2.head(key);

  if (object === null) {
    return new Response(JSON.stringify({ error: 'Object not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    key: object.key,
    size: object.size,
    etag: object.etag,
    httpEtag: object.httpEtag,
    uploaded: object.uploaded,
    httpMetadata: object.httpMetadata,
    customMetadata: object.customMetadata,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * D1 Proxy Functions
 */

async function handleD1Query(env: Env, request: Request): Promise<Response> {
  try {
    const body = await request.json() as { query: string; params?: any[]; };

    if (!body.query) {
      return new Response(JSON.stringify({ error: 'Query is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let stmt = env.d1.prepare(body.query);

    if (body.params && body.params.length > 0) {
      stmt = stmt.bind(...body.params);
    }

    const results = await stmt.all();

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      error: 'Query execution failed',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleD1Batch(env: Env, request: Request): Promise<Response> {
  try {
    const body = await request.json() as { queries: Array<{ query: string; params?: any[]; }>; };

    if (!body.queries || !Array.isArray(body.queries)) {
      return new Response(JSON.stringify({ error: 'Queries array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const statements = body.queries.map(q => {
      let stmt = env.d1.prepare(q.query);
      if (q.params && q.params.length > 0) {
        stmt = stmt.bind(...q.params);
      }
      return stmt;
    });

    const results = await env.d1.batch(statements);

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      error: 'Batch execution failed',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleD1SearchChunks(env: Env, url: URL): Promise<Response> {
  const query = url.searchParams.get('q');
  const limit = parseInt(url.searchParams.get('limit') || '10');
  const simple = url.searchParams.get('simple') === 'true';

  if (!query) {
    return new Response(JSON.stringify({ error: 'Query parameter "q" is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const results = simple
    ? await simpleSearchChunks(env, query, limit)
    : await searchChunks(env, query, limit);

  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Vectorize Proxy Functions
 */

async function handleVectorizeInsert(env: Env, request: Request): Promise<Response> {
  try {
    const body = await request.json() as { vectors: Array<{ id: string; values: number[]; metadata?: Record<string, any>; }>; };

    if (!body.vectors || !Array.isArray(body.vectors)) {
      return new Response(JSON.stringify({ error: 'Vectors array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await env.vectorize.upsert(body.vectors);

    return new Response(JSON.stringify({
      success: true,
      inserted: body.vectors.length
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      error: 'Vectorize insert failed',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleVectorizeQuery(env: Env, request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      vector: number[];
      topK?: number;
      filter?: Record<string, any>;
      returnValues?: boolean;
      returnMetadata?: boolean;
    };

    if (!body.vector || !Array.isArray(body.vector)) {
      return new Response(JSON.stringify({ error: 'Vector array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const results = await env.vectorize.query(body.vector, {
      topK: body.topK || 10,
      filter: body.filter,
      returnValues: body.returnValues ?? false,
      returnMetadata: body.returnMetadata ?? true,
    });

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      error: 'Vectorize query failed',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleVectorizeDelete(env: Env, request: Request): Promise<Response> {
  try {
    const body = await request.json() as { ids: string[]; };

    if (!body.ids || !Array.isArray(body.ids)) {
      return new Response(JSON.stringify({ error: 'IDs array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await env.vectorize.deleteByIds(body.ids);

    return new Response(JSON.stringify({
      success: true,
      deleted: body.ids.length
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      error: 'Vectorize delete failed',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Router function to handle different endpoints
 */
async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // R2 endpoints
  if (path.startsWith('/r2/')) {
    const encodedKey = path.substring(4); // Remove '/r2/' prefix
    const key = decodeURIComponent(encodedKey); // Decode the key

    switch (method) {
      case 'GET':
        return handleR2Get(env, key);
      case 'PUT':
        return handleR2Put(env, key, request);
      case 'DELETE':
        return handleR2Delete(env, key);
      case 'HEAD':
        return handleR2Head(env, key);
      default:
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json' },
        });
    }
  }

  // R2 list endpoint
  if (path === '/r2' && method === 'GET') {
    return handleR2List(env, url);
  }

  // D1 endpoints
  if (path === '/d1/query' && method === 'POST') {
    return handleD1Query(env, request);
  }

  if (path === '/d1/batch' && method === 'POST') {
    return handleD1Batch(env, request);
  }

  if (path === '/d1/search' && method === 'GET') {
    return handleD1SearchChunks(env, url);
  }

  // Vectorize endpoints
  if (path === '/vectorize/insert' && method === 'POST') {
    return handleVectorizeInsert(env, request);
  }

  if (path === '/vectorize/query' && method === 'POST') {
    return handleVectorizeQuery(env, request);
  }

  if (path === '/vectorize/delete' && method === 'POST') {
    return handleVectorizeDelete(env, request);
  }

  return new Response(JSON.stringify({
    error: 'Not found',
    availableEndpoints: {
      r2: {
        'GET /r2': 'List objects (query params: prefix, limit, cursor)',
        'GET /r2/{key}': 'Get object',
        'PUT /r2/{key}': 'Upload object',
        'DELETE /r2/{key}': 'Delete object',
        'HEAD /r2/{key}': 'Get object metadata',
      },
      d1: {
        'POST /d1/query': 'Execute single query (body: {query, params})',
        'POST /d1/batch': 'Execute batch queries (body: {queries: [{query, params}]})',
        'GET /d1/search': 'Search chunks (query params: q, limit, simple)',
      },
      vectorize: {
        'POST /vectorize/insert': 'Insert vectors (body: {vectors: [{id, values, metadata?}]})',
        'POST /vectorize/query': 'Query vectors (body: {vector, topK?, filter?, returnValues?, returnMetadata?})',
        'POST /vectorize/delete': 'Delete vectors (body: {ids: []})',
      },
    },
  }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const authError = await requireAuth(request, env);
    if (authError) {
      return authError;
    }

    return handleRequest(request, env);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Scheduled task: POST to /ingest-updates on Express server daily at 03:00 UTC
    try {
      console.log('Running scheduled ingest-updates task at', new Date(controller.scheduledTime).toISOString());
      
      const response = await callExpressEndpoint(env, '/ingest-updates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scheduledTime: controller.scheduledTime,
          cron: controller.cron,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to trigger ingest-updates:', response.status, errorText);
        throw new Error(`Express server returned ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      console.log('Successfully triggered ingest-updates:', result);
    } catch (error) {
      console.error('Error in scheduled task:', error);
      // Optionally re-throw to mark the scheduled event as failed
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;
