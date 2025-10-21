// `Env` object can be regenerated with `npm run cf-typegen`

export interface Env {
  d1: D1Database;
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
    return new Response('Hello World!');
  },
} satisfies ExportedHandler<Env>;
