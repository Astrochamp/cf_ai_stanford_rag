/**
 * Reset Incomplete Articles Script
 * 
 * This script identifies articles that have been marked as "completed" but
 * haven't been processed correctly. It finds articles matching these conditions:
 * 1. Articles with fewer than 2 associated chunks
 * 2. Articles with at least 1 section that has an empty `number` field
 * 
 * Once identified, these articles are marked as "pending" (or "failed") in the
 * ingestion queue so they can be reprocessed by the ingestion script.
 * 
 * Usage:
 *   yarn reset-incomplete
 */

import 'dotenv/config';
import { executeD1Query } from '../lib/worker-api';

// ANSI color codes for better terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function requireEnvVar(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing or empty required environment variable: ${name}`);
  }
  return value;
}

interface IncompleteArticle {
  article_id: string;
  reason: string;
  chunk_count?: number;
  empty_number_sections?: number;
}

async function findIncompleteArticles(
  dbWorkerUrl: string,
  privateKeyPem: string
): Promise<IncompleteArticle[]> {
  const incomplete: IncompleteArticle[] = [];

  // Query 1: Find articles with fewer than 2 chunks that are marked as completed
  log('🔍 Searching for articles with fewer than 2 chunks...', colors.cyan);
  const fewChunksQuery = `
    SELECT 
      a.article_id,
      COUNT(c.chunk_id) as chunk_count
    FROM articles a
    INNER JOIN ingestion_queue iq ON a.article_id = iq.article_id
    LEFT JOIN sections s ON a.article_id = s.article_id
    LEFT JOIN chunks c ON s.section_id = c.section_id
    WHERE iq.status = 'completed'
    GROUP BY a.article_id
    HAVING COUNT(c.chunk_id) < 2
  `;

  const fewChunksResult = await executeD1Query(fewChunksQuery, dbWorkerUrl, privateKeyPem);

  if (fewChunksResult.results && fewChunksResult.results.length > 0) {
    for (const row of fewChunksResult.results) {
      incomplete.push({
        article_id: row.article_id as string,
        reason: 'fewer than 2 chunks',
        chunk_count: row.chunk_count as number,
      });
    }
    log(`  Found ${colors.bright}${fewChunksResult.results.length}${colors.reset}${colors.cyan} articles with fewer than 2 chunks`, colors.cyan);
  } else {
    log('  No articles found with fewer than 2 chunks', colors.cyan);
  }

  // Query 2: Find articles with sections that have empty number field
  log('🔍 Searching for articles with sections having empty number field...', colors.cyan);
  const emptyNumberQuery = `
    SELECT 
      a.article_id,
      COUNT(DISTINCT s.section_id) as empty_number_sections
    FROM articles a
    INNER JOIN ingestion_queue iq ON a.article_id = iq.article_id
    INNER JOIN sections s ON a.article_id = s.article_id
    WHERE iq.status = 'completed'
      AND (s.number IS NULL OR s.number = '')
    GROUP BY a.article_id
  `;

  const emptyNumberResult = await executeD1Query(emptyNumberQuery, dbWorkerUrl, privateKeyPem);

  if (emptyNumberResult.results && emptyNumberResult.results.length > 0) {
    for (const row of emptyNumberResult.results) {
      const articleId = row.article_id as string;

      // Check if already in the list from the first query
      const existing = incomplete.find(a => a.article_id === articleId);
      if (existing) {
        existing.reason += '; has sections with empty number field';
        existing.empty_number_sections = row.empty_number_sections as number;
      } else {
        incomplete.push({
          article_id: articleId,
          reason: 'has sections with empty number field',
          empty_number_sections: row.empty_number_sections as number,
        });
      }
    }
    log(`  Found ${colors.bright}${emptyNumberResult.results.length}${colors.reset}${colors.cyan} articles with empty number sections`, colors.cyan);
  } else {
    log('  No articles found with empty number sections', colors.cyan);
  }

  return incomplete;
}

async function resetArticleStatus(
  articleId: string,
  dbWorkerUrl: string,
  privateKeyPem: string,
  targetStatus: 'pending' | 'failed'
): Promise<void> {
  const now = Date.now();
  await executeD1Query(
    `UPDATE ingestion_queue
     SET status = ?, last_attempt = ?, error_message = ?
     WHERE article_id = ?`,
    dbWorkerUrl,
    privateKeyPem,
    [
      targetStatus,
      now,
      'Reset by reset-incomplete-articles script - article did not process correctly',
      articleId
    ]
  );
}

async function main() {
  log('\n╔══════════════════════════════════════════════════════════════╗', colors.bright);
  log('║          Reset Incomplete Articles Script                   ║', colors.bright);
  log('╚══════════════════════════════════════════════════════════════╝\n', colors.bright);

  try {
    // Validate required environment variables
    log('🔍 Validating environment variables...', colors.cyan);
    const privateKeyPem = requireEnvVar('JWT_PRIVATE_KEY');
    const dbWorkerUrl = requireEnvVar('DB_WORKER_URL');
    log('✓ All required environment variables are set\n', colors.green);

    // Ask user for target status (default to pending)
    const targetStatus: 'pending' | 'failed' = 'pending'; // Can be made configurable via CLI args
    log(`📝 Articles will be marked as: ${colors.bright}${targetStatus}${colors.reset}\n`, colors.blue);

    // Step 1: Find incomplete articles
    log('Step 1: Identifying incomplete articles...', colors.cyan);
    const incompleteArticles = await findIncompleteArticles(dbWorkerUrl, privateKeyPem);

    if (incompleteArticles.length === 0) {
      log('\n✓ No incomplete articles found! All completed articles appear to be valid.\n', colors.green);
      process.exit(0);
    }

    log(`\n⚠️  Found ${colors.bright}${incompleteArticles.length}${colors.reset}${colors.yellow} incomplete articles\n`, colors.yellow);

    // Step 2: Display findings
    log('📋 Incomplete Articles:', colors.cyan);
    const displayLimit = 20;
    const articlesToDisplay = incompleteArticles.slice(0, displayLimit);

    for (const article of articlesToDisplay) {
      let details = `  • ${article.article_id} - ${article.reason}`;
      if (article.chunk_count !== undefined) {
        details += ` (${article.chunk_count} chunk${article.chunk_count !== 1 ? 's' : ''})`;
      }
      if (article.empty_number_sections !== undefined) {
        details += ` (${article.empty_number_sections} section${article.empty_number_sections !== 1 ? 's' : ''} affected)`;
      }
      log(details, colors.yellow);
    }

    if (incompleteArticles.length > displayLimit) {
      log(`  ... and ${incompleteArticles.length - displayLimit} more`, colors.yellow);
    }
    console.log();

    // Step 3: Reset articles
    log(`Step 2: Resetting ${incompleteArticles.length} articles to "${targetStatus}" status...`, colors.cyan);

    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < incompleteArticles.length; i++) {
      const article = incompleteArticles[i];
      try {
        await resetArticleStatus(article.article_id, dbWorkerUrl, privateKeyPem, targetStatus);
        successCount++;

        // Show progress every 50 articles
        if ((i + 1) % 50 === 0) {
          process.stdout.write(`  Progress: ${i + 1}/${incompleteArticles.length}\r`);
        }
      } catch (error) {
        failureCount++;
        log(`  ✗ Failed to reset ${article.article_id}: ${error instanceof Error ? error.message : 'Unknown error'}`, colors.red);
      }
    }

    console.log(); // Clear progress line

    // Step 4: Summary
    log('\n╔══════════════════════════════════════════════════════════════╗', colors.bright);
    log('║                    Reset Complete! 🎉                        ║', colors.bright);
    log('╚══════════════════════════════════════════════════════════════╝\n', colors.bright);

    log('📊 Summary:', colors.cyan);
    log(`  Total incomplete articles found:  ${incompleteArticles.length}`, colors.blue);
    log(`  Successfully reset:               ${colors.bright}${successCount}${colors.reset}${colors.green}`, colors.green);
    if (failureCount > 0) {
      log(`  Failed to reset:                  ${colors.bright}${failureCount}${colors.reset}${colors.red}`, colors.red);
    }
    console.log();

    log('✓ You can now run the ingestion script to reprocess these articles:', colors.green);
    log('  yarn ingest\n', colors.cyan);

    process.exit(0);
  } catch (error) {
    log('\n❌ Fatal error:', colors.red);
    log(error instanceof Error ? error.message : String(error), colors.red);
    console.error(error);
    process.exit(1);
  }
}

// Run the script
main();
