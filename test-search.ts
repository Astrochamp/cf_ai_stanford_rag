import 'dotenv/config';
import { HybridSearchResult } from './lib/hybrid-search';

async function testSearch() {
  const query = 'What is temporal logic?';
  
  console.log('Testing hybrid search endpoint...');
  console.log(`Query: "${query}"\n`);

  try {
    const response = await fetch('http://localhost:3000/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        topK: 5,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }

    const data = await response.json() as {
      query: string;
      count: number;
      results: HybridSearchResult[];
    };
    
    console.log(`✓ Success! Found ${data.count} results\n`);
    
    data.results.forEach((result: HybridSearchResult, index: number) => {
      console.log('═'.repeat(70));
      console.log(`Result ${index + 1}`);
      console.log('─'.repeat(70));
      console.log(`Article: ${result.article_title}`);
      console.log(`Section: ${result.section_number} - ${result.heading}`);
      console.log(`Tokens: ${result.num_tokens}`);
      console.log(`R2 key: ${result.r2_key}`);
      console.log(`RRF Score: ${result.rrf_score.toFixed(4)}`);
      console.log(`Rerank Score: ${result.rerank_score.toFixed(4)}`);
      console.log(`Preview: ${result.chunk_text.substring(0, 150)}...`);
      console.log(`Generation Text: ${result.generation_text.substring(0, 150)}...`);
      console.log('');
    });
    
    console.log('═'.repeat(70));
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testSearch().then(() => {
  console.log('\n✓ Test completed successfully');
  process.exit(0);
});
