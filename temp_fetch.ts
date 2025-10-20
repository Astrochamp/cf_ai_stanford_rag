/**
 * Stanford Encyclopedia of Philosophy - Article Processing Pipeline
 * 
 * This script provides a complete pipeline for fetching, preprocessing, and chunking
 * articles from the Stanford Encyclopedia of Philosophy for use in RAG systems.
 * 
 * MAIN FEATURES:
 * 
 * 1. HTML to Text Preprocessing:
 *    - Removes diacritics and normalizes Unicode
 *    - Converts HTML lists to text format with proper markers
 *    - Converts HTML tables to natural language descriptions (via GPT)
 *    - Converts TeX mathematical notation to Unicode symbols or natural language
 *    - Preserves paragraph structure with double newlines
 * 
 * 2. Semantic Chunking:
 *    - Splits text into chunks up to 1024 tokens (configurable)
 *    - Respects semantic boundaries (paragraphs, tables, lists)
 *    - Never splits in the middle of a semantic unit
 *    - Uses accurate GPT tokenization for chunk sizing
 */

import 'dotenv/config';
import * as fs from 'fs';
import { fetchArticleContent } from './lib/fetch';
import { processArticleSectionDual } from './lib/preprocess';
import { ArticleID, ArticleSection, ProcessedChunk } from './lib/shared/types';


// ============================================================================
// TEST CONFIGURATION
// ============================================================================

/**
 * Set the article ID to test (e.g., "logic-propositional", "consciousness", "kant")
 * Find article IDs in URLs like: https://plato.stanford.edu/entries/logic-propositional/
 */
const TEST_ARTICLE_ID = "logic-propositional"; // <-- CHANGE THIS TO TEST DIFFERENT ARTICLES

/**
 * Maximum tokens per chunk (default: 1024)
 */
const MAX_TOKENS_PER_CHUNK = 1024;

/**
 * Output directory for test results
 */
const OUTPUT_DIR = "./test_output";

// ============================================================================
// TEST RUNNER
// ============================================================================

async function testArticleProcessing(articleId: string) {
  console.log('\n' + '='.repeat(80));
  console.log(`TESTING ARTICLE: ${articleId}`);
  console.log('='.repeat(80) + '\n');

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const startTime = Date.now();

  try {
    // Step 1: Fetch article
    console.log(`\n[1/4] Fetching article "${articleId}"...`);
    const article = await fetchArticleContent(articleId as ArticleID);
    console.log(`✓ Fetched article: "${article.title}" (${article.originalTitle})`);
    console.log(`  Authors: ${article.authors.join(', ')}`);
    console.log(`  Sections: ${article.sections.length}`);
    console.log(`  Related articles: ${article.related.length}`);

    // Step 2: Process preamble (always keep as single chunk)
    console.log(`\n[2/4] Processing preamble...`);
    const preambleChunks = await processArticleSectionDual(
      {
        shortName: 'preamble',
        number: '',
        heading: 'Preamble',
        content: article.preamble
      },
      article.title,
      Infinity // Use Infinity to ensure preamble is never split
    );
    console.log(`✓ Preamble kept as single chunk (${preambleChunks[0]?.tokenCount || 0} tokens)`);

    // Step 3: Process all sections
    console.log(`\n[3/4] Processing ${article.sections.length} section(s)...`);
    const allSectionChunks: {
      section: ArticleSection;
      chunks: ProcessedChunk[];
    }[] = [];

    for (let i = 0; i < article.sections.length; i++) {
      const section = article.sections[i];
      const sectionLabel = section.number
        ? `${section.number} ${section.heading}`
        : section.heading;

      console.log(`  [${i + 1}/${article.sections.length}] Processing: ${sectionLabel}...`);

      const chunks = await processArticleSectionDual(
        section,
        article.title,
        MAX_TOKENS_PER_CHUNK
      );

      allSectionChunks.push({ section, chunks });
      console.log(`    → ${chunks.length} chunk(s) | ${chunks.reduce((sum, c) => sum + c.tokenCount, 0)} total tokens`);
    }

    // Step 4: Generate output files
    console.log(`\n[4/4] Writing output files...`);

    // Create article-specific output directory
    const articleDir = `${OUTPUT_DIR}/${articleId}`;
    if (!fs.existsSync(articleDir)) {
      fs.mkdirSync(articleDir, { recursive: true });
    }

    // Write article metadata
    const metadata = {
      id: article.id,
      title: article.title,
      originalTitle: article.originalTitle,
      authors: article.authors,
      related: article.related,
      sectionCount: article.sections.length,
      totalChunks: preambleChunks.length + allSectionChunks.reduce((sum, s) => sum + s.chunks.length, 0),
      maxTokensPerChunk: MAX_TOKENS_PER_CHUNK,
      processedAt: new Date().toISOString()
    };
    fs.writeFileSync(`${articleDir}/metadata.json`, JSON.stringify(metadata, null, 2));
    console.log(`  ✓ metadata.json`);

    // Write preamble chunks
    if (preambleChunks.length > 0) {
      const preambleOutput = {
        section: "Preamble",
        chunks: preambleChunks.map((c, i) => ({
          chunkNumber: i + 1,
          tokenCount: c.tokenCount,
          retrievalText: c.retrievalText,
          generationText: c.generationText
        }))
      };
      fs.writeFileSync(`${articleDir}/preamble.json`, JSON.stringify(preambleOutput, null, 2));
      console.log(`  ✓ preamble.json (${preambleChunks.length} chunks)`);
    }

    // Write section chunks
    for (let i = 0; i < allSectionChunks.length; i++) {
      const { section, chunks } = allSectionChunks[i];
      const filename = section.shortName
        ? `section_${i + 1}_${section.shortName}.json`
        : `section_${i + 1}.json`;

      const sectionOutput = {
        sectionNumber: section.number,
        sectionHeading: section.heading,
        shortName: section.shortName,
        chunks: chunks.map((c, j) => ({
          chunkNumber: j + 1,
          tokenCount: c.tokenCount,
          retrievalText: c.retrievalText,
          generationText: c.generationText
        }))
      };

      fs.writeFileSync(`${articleDir}/${filename}`, JSON.stringify(sectionOutput, null, 2));
      console.log(`  ✓ ${filename} (${chunks.length} chunks)`);
    }

    // Write complete article (all chunks in one file)
    const completeOutput = {
      metadata,
      preamble: preambleChunks.map((c, i) => ({
        section: "Preamble",
        chunkNumber: i + 1,
        tokenCount: c.tokenCount,
        retrievalText: c.retrievalText,
        generationText: c.generationText
      })),
      sections: allSectionChunks.map(({ section, chunks }) => ({
        sectionNumber: section.number,
        sectionHeading: section.heading,
        shortName: section.shortName,
        chunks: chunks.map((c, i) => ({
          chunkNumber: i + 1,
          tokenCount: c.tokenCount,
          retrievalText: c.retrievalText,
          generationText: c.generationText
        }))
      }))
    };
    fs.writeFileSync(`${articleDir}/complete.json`, JSON.stringify(completeOutput, null, 2));
    console.log(`  ✓ complete.json (full article)`);

    // Write human-readable summary
    let summary = `ARTICLE PROCESSING SUMMARY\n`;
    summary += `${'='.repeat(80)}\n\n`;
    summary += `Article ID: ${article.id}\n`;
    summary += `Title: ${article.title}\n`;
    summary += `Original Title: ${article.originalTitle}\n`;
    summary += `Authors: ${article.authors.join(', ')}\n`;
    summary += `Related Articles: ${article.related.length}\n`;
    summary += `Processed: ${new Date().toISOString()}\n`;
    summary += `Max Tokens/Chunk: ${MAX_TOKENS_PER_CHUNK}\n`;
    summary += `\n${'-'.repeat(80)}\n\n`;

    summary += `PREAMBLE:\n`;
    summary += `  Chunks: ${preambleChunks.length}\n`;
    summary += `  Total Tokens: ${preambleChunks.reduce((sum, c) => sum + c.tokenCount, 0)}\n\n`;

    summary += `SECTIONS (${article.sections.length}):\n\n`;
    allSectionChunks.forEach(({ section, chunks }, i) => {
      const sectionLabel = section.number
        ? `${section.number} ${section.heading}`
        : section.heading;
      const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);
      summary += `  ${i + 1}. ${sectionLabel}\n`;
      summary += `     Chunks: ${chunks.length} | Tokens: ${totalTokens}\n`;
    });

    summary += `\n${'-'.repeat(80)}\n\n`;
    summary += `TOTALS:\n`;
    summary += `  Total Chunks: ${metadata.totalChunks}\n`;
    summary += `  Total Tokens: ${preambleChunks.reduce((sum, c) => sum + c.tokenCount, 0) + allSectionChunks.reduce((sum, s) => sum + s.chunks.reduce((s2, c) => s2 + c.tokenCount, 0), 0)}\n`;

    fs.writeFileSync(`${articleDir}/SUMMARY.txt`, summary);
    console.log(`  ✓ SUMMARY.txt`);

    // Write sample chunks for inspection
    const sampleChunks = [];
    if (preambleChunks.length > 0) {
      sampleChunks.push({
        location: 'Preamble - Chunk 1',
        ...preambleChunks[0]
      });
    }
    if (allSectionChunks.length > 0 && allSectionChunks[0].chunks.length > 0) {
      const firstSection = allSectionChunks[0];
      sampleChunks.push({
        location: `${firstSection.section.number || 'Section 1'} ${firstSection.section.heading} - Chunk 1`,
        ...firstSection.chunks[0]
      });
    }

    let samplesText = `SAMPLE CHUNKS FOR INSPECTION\n`;
    samplesText += `${'='.repeat(80)}\n\n`;

    sampleChunks.forEach((sample, i) => {
      samplesText += `${'='.repeat(80)}\n`;
      samplesText += `SAMPLE ${i + 1}: ${sample.location}\n`;
      samplesText += `Tokens: ${sample.tokenCount}\n`;
      samplesText += `${'='.repeat(80)}\n\n`;

      samplesText += `RETRIEVAL FORMAT (for embedding/search):\n`;
      samplesText += `${'-'.repeat(80)}\n`;
      samplesText += sample.retrievalText + '\n\n';

      samplesText += `GENERATION FORMAT (for LLM context):\n`;
      samplesText += `${'-'.repeat(80)}\n`;
      samplesText += sample.generationText + '\n\n\n';
    });

    fs.writeFileSync(`${articleDir}/SAMPLES.txt`, samplesText);
    console.log(`  ✓ SAMPLES.txt (${sampleChunks.length} sample chunks)`);

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n' + '='.repeat(80));
    console.log('SUCCESS!');
    console.log('='.repeat(80));
    console.log(`\nProcessed ${article.title} in ${elapsedTime}s`);
    console.log(`Output directory: ${articleDir}`);
    console.log(`\nFiles created:`);
    console.log(`  • metadata.json - Article metadata and statistics`);
    console.log(`  • complete.json - All chunks in one file`);
    console.log(`  • preamble.json - Preamble chunks`);
    console.log(`  • section_*.json - Individual section chunks`);
    console.log(`  • SUMMARY.txt - Human-readable summary`);
    console.log(`  • SAMPLES.txt - Sample chunks for inspection\n`);

  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('ERROR DURING PROCESSING');
    console.error('='.repeat(80));
    console.error(error);
    process.exit(1);
  }
}

// Run test with configured article
testArticleProcessing(TEST_ARTICLE_ID);