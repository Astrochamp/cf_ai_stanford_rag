/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

interface RequestBody {
  text: string;
}

function isRequestBody(obj: any): obj is RequestBody {
  return obj && typeof obj.text === 'string';
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

export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Please send a POST request with a JSON body.', { status: 405 });
    }

    const body: unknown = await request.json();

    if (!isRequestBody(body)) {
      return new Response('JSON body must be an object with a "text" property of type string.', {
        status: 400,
      });
    }

    const inputText = body.text;

    const inputData = {
      text: inputText,
      truncate_inputs: false
    } as Ai_Cf_Baai_Bge_M3_Input;

    const batchedResponse = await env.AI.run(
      '@cf/baai/bge-m3',
      inputData,
    ) as BGEM3OuputEmbedding;

    const embeddings = batchedResponse.data?.map(
      (item) => {
        return normalize(new Float32Array(item));
      },
    ) ?? [];

    const responseData = {
      shape: batchedResponse.shape,
      data: embeddings,
      pooling: batchedResponse.pooling,
    };

    return Response.json({ batchedInput: inputData, responseData });

  },
} satisfies ExportedHandler<Env>;