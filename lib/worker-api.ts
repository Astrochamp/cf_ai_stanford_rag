import { generateWorkerAuthToken } from './auth';
import { m3embedSingleText, m3embedTextBatch } from './cf';

const dbWorkerUrl = process.env.DB_WORKER_URL;

/**
 * Upload content to R2 via Worker proxy
 */
export async function uploadToR2(key: string, content: string, contentType: string = 'text/plain'): Promise<void> {
  if (!dbWorkerUrl) {
    throw new Error('DB_WORKER_URL is not set');
  }

  const token = await generateWorkerAuthToken(dbWorkerUrl);
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
export async function executeD1Query(query: string, params?: any[]): Promise<any> {
  if (!dbWorkerUrl) {
    throw new Error('DB_WORKER_URL is not set');
  }

  const token = await generateWorkerAuthToken(dbWorkerUrl);
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
export async function executeD1Batch(queries: Array<{ query: string; params?: any[]; }>): Promise<any[]> {
  if (!dbWorkerUrl) {
    throw new Error('DB_WORKER_URL is not set');
  }

  const token = await generateWorkerAuthToken(dbWorkerUrl);
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
export async function generateEmbedding(text: string): Promise<number[]> {
  return m3embedSingleText(text);
}

/**
 * Generate embeddings in batches using Cloudflare Workers AI (BGE-M3 model)
 * The CF API handles batching internally with max 100 texts per call
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  return m3embedTextBatch(texts);
}

/**
 * Insert vectors into Vectorize via Worker proxy
 */
export async function insertVectorsBatch(vectors: Array<{ id: string; values: number[]; metadata?: Record<string, any>; }>): Promise<void> {
  if (!dbWorkerUrl) {
    throw new Error('DB_WORKER_URL is not set');
  }

  const token = await generateWorkerAuthToken(dbWorkerUrl);
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
export async function queryVectorize(
  vector: number[],
  topK: number = 10,
  filter?: Record<string, any>
): Promise<any> {
  if (!dbWorkerUrl) {
    throw new Error('DB_WORKER_URL is not set');
  }

  const token = await generateWorkerAuthToken(dbWorkerUrl);
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
export async function deleteVectors(chunkIds: string[]): Promise<void> {
  if (!dbWorkerUrl) {
    throw new Error('DB_WORKER_URL is not set');
  }

  const token = await generateWorkerAuthToken(dbWorkerUrl);
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

/**
 * Search chunks using BM25 full-text search
 */
export async function searchChunks(query: string, limit: number = 10): Promise<any> {
  if (!dbWorkerUrl) {
    throw new Error('DB_WORKER_URL is not set');
  }

  const token = await generateWorkerAuthToken(dbWorkerUrl);
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
export async function getGenerationText(chunkId: string): Promise<string> {
  if (!dbWorkerUrl) {
    throw new Error('DB_WORKER_URL is not set');
  }

  const token = await generateWorkerAuthToken(dbWorkerUrl);
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
