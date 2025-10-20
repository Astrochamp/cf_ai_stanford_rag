/**
 * Cloudflare Workers RPC-enabled embedding service
 * 
 * This worker provides text embedding functionality using Cloudflare AI (BGE-M3 model)
 * and can be called via both HTTP fetch and RPC from other Workers.
 *
 * === HOW TO CALL THIS WORKER VIA RPC FROM OTHER WORKERS ===
 * 
 * 1. Add this worker as a service binding in your calling worker's wrangler.jsonc:
 * 
 *    "services": [
 *      {
 *        "binding": "EMBED_SERVICE",
 *        "service": "embed-text",
 *        "environment": "production"
 *      }
 *    ]
 * 
 * 2. Update your Env interface to include the binding:
 * 
 *    interface Env {
 *      EMBED_SERVICE: Service<EmbedTextService>;
 *      // ... other bindings
 *    }
 * 
 * 3. Call the embedding function from your worker:
 * 
 *    const result = await env.EMBED_SERVICE.getEmbedding("Your text here");
 *    console.log(result.data); // Normalized embedding vectors
 * 
 * 4. Type the import (optional but recommended):
 * 
 *    import type { EmbedTextService } from './path/to/embed-text/src/index';
 * 
 * Benefits of RPC over HTTP:
 * - Lower latency (no network overhead)
 * - Type safety with TypeScript
 * - No serialization overhead for complex types
 * - Automatic authentication (no need for API keys between your workers)
 */

import { WorkerEntrypoint } from 'cloudflare:workers';

interface Env {
  AI: Ai;
  // Add other bindings as needed
}

interface EmbeddingResult {
  shape: number[];
  data: Float32Array[];
  pooling: string;
}

function normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) {
    sum += vector[i] * vector[i];
  }
  const magnitude = Math.sqrt(sum);

  if (magnitude === 0) {
    return vector;
  }

  const normalizedVector = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    normalizedVector[i] = vector[i] / magnitude;
  }
  return normalizedVector;
}

/**
 * RPC-compatible class that exposes the embedding functionality
 * This can be called directly from other Workers via service bindings
 */
export class EmbedTextService extends WorkerEntrypoint<Env> {
  /**
   * Generate normalized embeddings for the given text
   * @param text - The input text to embed
   * @returns EmbeddingResult containing shape, normalized vectors, and pooling method
   */
  async getEmbedding(text: string): Promise<EmbeddingResult> {
    const inputData = {
      text: text,
      truncate_inputs: false
    } as Ai_Cf_Baai_Bge_M3_Input;

    const batchedResponse = await this.env.AI.run(
      '@cf/baai/bge-m3',
      inputData,
    ) as BGEM3OuputEmbedding;

    const embeddings = batchedResponse.data?.map(
      (item) => {
        return normalize(new Float32Array(item));
      },
    ) ?? [];

    return {
      shape: batchedResponse.shape ?? [],
      data: embeddings,
      pooling: batchedResponse.pooling ?? 'cls',
    };
  }
}