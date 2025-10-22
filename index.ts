import 'dotenv/config';

// Export auth middleware for use in Express apps
export { verifyWorkerAuth } from './lib/auth';

// Export all public API functions
export { processAndStoreArticle, processIngestionQueue } from './lib/ingestion';
export { addToIngestionQueue, getQueueStats } from './lib/queue';
export { getGenerationText, searchChunks, semanticSearch } from './lib/search';
export { deleteVectors } from './lib/worker-api';

// ============================================================================
// EXAMPLE USAGE (uncomment to run)
// ============================================================================

/*
// Example 1: Process a single article
async function example1() {
  const articleId = 'logic-ancient';
  
  // Add to queue
  await addToIngestionQueue(articleId);
  
  // Process
  await processAndStoreArticle(articleId);
}

// Example 2: Batch processing
async function example2() {
  const articleIds = ['logic-ancient', 'logic-modal', 'logic-temporal'];
  
  // Add all to queue
  for (const id of articleIds) {
    await addToIngestionQueue(id);
  }
  
  // Process queue
  await processIngestionQueue();
}

// Example 3: BM25 full-text search and retrieve
async function example3() {
  const query = 'aristotle logic';
  
  // Search for relevant chunks using BM25
  const results = await searchChunks(query, 5);
  console.log('BM25 search results:', results);
  
  // Get generation format for first result
  if (results.results && results.results.length > 0) {
    const chunkId = results.results[0].chunk_id;
    const generationText = await getGenerationText(chunkId);
    console.log('Generation text:', generationText);
  }
}

// Example 4: Semantic search using embeddings
async function example4() {
  const query = 'What is the relationship between truth and validity in logic?';
  
  // Perform semantic search
  const results = await semanticSearch(query, 5);
  console.log('Semantic search results:');
  
  for (const result of results) {
    console.log(`
    Article: ${result.title}
    Section: ${result.number} - ${result.heading || '(untitled)'}
    Score: ${result.score}
    Preview: ${result.chunk_text.substring(0, 200)}...
    `);
  }
}

// Example 5: Monitor queue
async function example5() {
  const stats = await getQueueStats();
  console.log('Queue statistics:', stats);
}

// Run examples
// example1().catch(console.error);
// example2().catch(console.error);
// example3().catch(console.error);
// example4().catch(console.error);
// example5().catch(console.error);
*/