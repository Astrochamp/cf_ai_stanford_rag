// ============================================================================
// CLOUDFLARE AI API - EMBEDDING FUNCTIONS
// ============================================================================

// Input types
export interface EmbeddingTextInput {
  text: string | string[];
  truncate_inputs?: boolean;
}

// ============================================================================
// CLOUDFLARE AI API - RERANKING TYPES
// ============================================================================

export interface RerankingInput {
  query: string;
  contexts: Array<{ text: string }>;
  top_k?: number;
}

export interface RerankingResponse {
  response: Array<{
    id: number;
    score: number;
  }>;
}

export interface EmbeddingContextsInput {
  query?: string;
  contexts: Array<{ text: string }>;
  truncate_inputs?: boolean;
}

export interface EmbeddingBatchRequest {
  requests: Array<EmbeddingTextInput | EmbeddingContextsInput>;
}

export type EmbeddingInput = EmbeddingTextInput | EmbeddingContextsInput | EmbeddingBatchRequest;

// Output types
export interface EmbeddingQueryResponse {
  response: Array<{
    id: number;
    score: number;
  }>;
}

export interface EmbeddingVectorResponse {
  shape: number[];
  data: number[][];
  pooling: 'mean' | 'cls';
}

export interface EmbeddingContextsResponse {
  response: number[][];
  shape: number[];
  pooling: 'mean' | 'cls';
}

export interface EmbeddingAsyncResponse {
  request_id: string;
}

export type EmbeddingResponse = 
  | EmbeddingQueryResponse 
  | EmbeddingVectorResponse 
  | EmbeddingContextsResponse
  | EmbeddingAsyncResponse;

// ============================================================================
// CONFIGURATION
// ============================================================================

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const EMBEDDING_MODEL = '@cf/baai/bge-m3';
const RERANKER_MODEL = '@cf/baai/bge-reranker-base';

if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) {
  throw new Error('Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN environment variables');
}

// ============================================================================
// EMBEDDING FUNCTIONS
// ============================================================================

/**
 * Generate embeddings for text using Cloudflare's AI API with BGE-M3 model.
 * 
 * @param text - Array of strings to embed (max 100 items per call)
 * @param options - Optional configuration
 * @returns Promise with embedding vectors
 * 
 * @example
 * const embeddings = await embedText([
 *   "This is a story about an orange cloud",
 *   "This is a story about a llama"
 * ]);
 */
export async function m3embedText(
  text: string[],
  options: {
    truncate_inputs?: boolean;
    signal?: AbortSignal;
  } = {}
): Promise<number[][]> {
  if (text.length === 0) {
    throw new Error('Text array cannot be empty');
  }

  if (text.length > 100) {
    throw new Error('Maximum 100 texts can be embedded per call');
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${EMBEDDING_MODEL}`;

  const requestBody: EmbeddingTextInput = {
    text,
    ...(options.truncate_inputs !== undefined && { truncate_inputs: options.truncate_inputs })
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Cloudflare AI API error (${response.status}): ${errorText}`
      );
    }

    const result = await response.json() as { result: EmbeddingResponse };
    
    // Extract embedding data from response
    if ('data' in result.result) {
      return result.result.data;
    } else if ('response' in result.result && Array.isArray(result.result.response[0])) {
      // Handle contexts response format
      return result.result.response as number[][];
    } else {
      throw new Error('Unexpected response format from Cloudflare AI API');
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to generate embeddings: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Generate embeddings for a single text string.
 * 
 * @param text - Single string to embed
 * @param options - Optional configuration
 * @returns Promise with embedding vector
 */
export async function m3embedSingleText(
  text: string,
  options: {
    truncate_inputs?: boolean;
    signal?: AbortSignal;
  } = {}
): Promise<number[]> {
  const embeddings = await m3embedText([text], options);
  return embeddings[0];
}

/**
 * Query contexts using a query string and get relevance scores.
 * 
 * @param query - The query string to match against contexts
 * @param contexts - Array of context strings to score
 * @param options - Optional configuration
 * @returns Promise with scored contexts
 */
export async function m3queryContexts(
  query: string,
  contexts: string[],
  options: {
    truncate_inputs?: boolean;
    signal?: AbortSignal;
  } = {}
): Promise<Array<{ id: number; score: number }>> {
  if (contexts.length === 0) {
    throw new Error('Contexts array cannot be empty');
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${EMBEDDING_MODEL}`;

  const requestBody: EmbeddingContextsInput = {
    query,
    contexts: contexts.map(text => ({ text })),
    ...(options.truncate_inputs !== undefined && { truncate_inputs: options.truncate_inputs })
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Cloudflare AI API error (${response.status}): ${errorText}`
      );
    }

    const result = await response.json() as { result: EmbeddingQueryResponse };
    
    if ('response' in result.result && Array.isArray(result.result.response)) {
      return result.result.response;
    } else {
      throw new Error('Unexpected response format from Cloudflare AI API');
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to query contexts: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Batch process large arrays of text by splitting into chunks of 100.
 * 
 * @param texts - Array of strings to embed (can exceed 100)
 * @param options - Optional configuration
 * @returns Promise with all embedding vectors
 */
export async function m3embedTextBatch(
  texts: string[],
  options: {
    truncate_inputs?: boolean;
    signal?: AbortSignal;
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Promise<number[][]> {
  const BATCH_SIZE = 100;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const embeddings = await m3embedText(batch, {
      truncate_inputs: options.truncate_inputs,
      signal: options.signal,
    });
    
    allEmbeddings.push(...embeddings);
    
    if (options.onProgress) {
      options.onProgress(Math.min(i + BATCH_SIZE, texts.length), texts.length);
    }
  }

  return allEmbeddings;
}

// ============================================================================
// RERANKING FUNCTIONS
// ============================================================================

/**
 * Rerank chunks/contexts against a query using Cloudflare's BGE reranker model.
 * Returns contexts sorted by relevance score (highest first).
 * 
 * @param query - The query to compare contexts against
 * @param contexts - Array of context strings to rerank
 * @param options - Optional configuration
 * @returns Promise with sorted array of context results with id and score
 * 
 * @example
 * const results = await rerankChunks(
 *   "Which one is better?",
 *   ["a cyberpunk lizard", "a cyberpunk cat"]
 * );
 * // Returns: [{ id: 1, score: 0.85 }, { id: 0, score: 0.72 }]
 */
export async function rerankChunks(
  query: string,
  contexts: string[],
  options: {
    top_k?: number;
    signal?: AbortSignal;
  } = {}
): Promise<Array<{ id: number; score: number }>> {
  if (!query || query.trim().length === 0) {
    throw new Error('Query cannot be empty');
  }

  if (contexts.length === 0) {
    throw new Error('Contexts array cannot be empty');
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${RERANKER_MODEL}`;

  const requestBody: RerankingInput = {
    query,
    contexts: contexts.map(text => ({ text })),
    ...(options.top_k !== undefined && { top_k: options.top_k })
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Cloudflare AI API error (${response.status}): ${errorText}`
      );
    }

    const result = await response.json() as { result: RerankingResponse };
    
    if ('response' in result.result && Array.isArray(result.result.response)) {
      return result.result.response;
    } else {
      throw new Error('Unexpected response format from Cloudflare AI API');
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to rerank contexts: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Rerank chunks and return the full context objects with their scores.
 * Useful when you want to get the actual text content back with scores.
 * 
 * @param query - The query to compare contexts against
 * @param contexts - Array of context strings to rerank
 * @param options - Optional configuration
 * @returns Promise with sorted array of objects containing text and score
 * 
 * @example
 * const results = await rerankChunksWithText(
 *   "Which one is better?",
 *   ["a cyberpunk lizard", "a cyberpunk cat"],
 *   { top_k: 1 }
 * );
 * // Returns: [{ text: "a cyberpunk cat", score: 0.85 }]
 */
export async function rerankChunksWithText(
  query: string,
  contexts: string[],
  options: {
    top_k?: number;
    signal?: AbortSignal;
  } = {}
): Promise<Array<{ text: string; score: number }>> {
  const results = await rerankChunks(query, contexts, options);
  
  return results.map(result => ({
    text: contexts[result.id],
    score: result.score
  }));
}
