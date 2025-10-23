/**
 * Standalone Initial Ingestion Script
 * 
 * This script performs the complete initial ingestion of all Stanford Encyclopedia
 * of Philosophy articles. It can be run independently without needing the Express
 * server or Cloudflare Worker.
 * 
 * Usage:
 *   yarn ingest
 * 
 * Features:
 * - Fetches all article IDs from SEP
 * - Adds them to the ingestion queue
 * - Processes them sequentially with progress reporting
 * - Can be safely interrupted and resumed (tracks progress in database)
 * - Shows real-time statistics
 */

import 'dotenv/config';
import { OpenAI } from 'openai';
import { fetchArticlesList } from '../lib/fetch';
import { processIngestionQueue } from '../lib/ingestion';
import { addToIngestionQueue, getQueueStats } from '../lib/queue';

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

async function main() {
  log('\n╔══════════════════════════════════════════════════════════════╗', colors.bright);
  log('║  Stanford Encyclopedia of Philosophy - Initial Ingestion    ║', colors.bright);
  log('╚══════════════════════════════════════════════════════════════╝\n', colors.bright);

  try {
    // Validate required environment variables
    log('🔍 Validating environment variables...', colors.cyan);
    const privateKeyPem = requireEnvVar('JWT_PRIVATE_KEY');
    const dbWorkerUrl = requireEnvVar('DB_WORKER_URL');
    const cloudflareAccountId = requireEnvVar('CLOUDFLARE_ACCOUNT_ID');
    const cloudflareApiToken = requireEnvVar('CLOUDFLARE_API_TOKEN');
    const openaiApiKey = requireEnvVar('OPENAI_API_KEY');
    log('✓ All required environment variables are set\n', colors.green);

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: openaiApiKey,
    });

    // Step 1: Fetch article list
    log('📚 Step 1: Fetching article list from SEP...', colors.cyan);
    const articleIds = await fetchArticlesList();
    log(`✓ Found ${colors.bright}${articleIds.length}${colors.reset}${colors.green} articles\n`, colors.green);

    // Step 2: Add articles to queue
    log('📝 Step 2: Adding articles to ingestion queue...', colors.cyan);
    const queued: string[] = [];
    const failed: { articleId: string; error: string; }[] = [];

    for (const articleId of articleIds) {
      try {
        await addToIngestionQueue(articleId, dbWorkerUrl, privateKeyPem);
        queued.push(articleId);

        // Show progress every 100 articles
        if (queued.length % 100 === 0) {
          process.stdout.write(`  Queued: ${queued.length}/${articleIds.length}\r`);
        }
      } catch (error) {
        failed.push({
          articleId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    log(`✓ Queued ${colors.bright}${queued.length}${colors.reset}${colors.green} articles`, colors.green);

    if (failed.length > 0) {
      log(`⚠ Failed to queue ${colors.bright}${failed.length}${colors.reset}${colors.yellow} articles`, colors.yellow);
      failed.slice(0, 5).forEach(f => log(`  - ${f.articleId}: ${f.error}`, colors.yellow));
      if (failed.length > 5) {
        log(`  ... and ${failed.length - 5} more`, colors.yellow);
      }
    }
    console.log();

    // Step 3: Show initial queue statistics
    log('📊 Step 3: Current queue status...', colors.cyan);
    const initialStats = await getQueueStats(dbWorkerUrl, privateKeyPem);
    log(`  Pending:    ${initialStats.pending || 0}`, colors.blue);
    log(`  Processing: ${initialStats.processing || 0}`, colors.yellow);
    log(`  Completed:  ${initialStats.completed || 0}`, colors.green);
    log(`  Failed:     ${initialStats.failed || 0}`, colors.red);
    console.log();

    // Step 4: Process the queue
    log('⚙️  Step 4: Starting article processing...', colors.cyan);
    log('    This will take several hours. You can safely interrupt with Ctrl+C', colors.yellow);
    log('    and resume later - progress is saved in the database.\n', colors.yellow);

    const startTime = Date.now();

    // Set up periodic status updates
    const statusInterval = setInterval(async () => {
      const stats = await getQueueStats(dbWorkerUrl, privateKeyPem);
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;

      log(`\n📊 Status Update (${minutes}m ${seconds}s elapsed):`, colors.cyan);
      log(`  Pending:    ${stats.pending || 0}`, colors.blue);
      log(`  Processing: ${stats.processing || 0}`, colors.yellow);
      log(`  Completed:  ${stats.completed || 0}`, colors.green);
      log(`  Failed:     ${stats.failed || 0}`, colors.red);

      const total = Object.values(stats).reduce((sum, count) => sum + count, 0);
      const completed = stats.completed || 0;
      const percentage = total > 0 ? ((completed / total) * 100).toFixed(1) : '0.0';
      log(`  Progress:   ${percentage}% (${completed}/${total})`, colors.bright);
      console.log();
    }, 60000); // Update every minute

    // Process the queue
    await processIngestionQueue(
      dbWorkerUrl,
      privateKeyPem,
      cloudflareAccountId,
      cloudflareApiToken,
      openai
    );

    clearInterval(statusInterval);

    // Step 5: Final statistics
    const endTime = Date.now();
    const totalTime = Math.floor((endTime - startTime) / 1000);
    const hours = Math.floor(totalTime / 3600);
    const minutes = Math.floor((totalTime % 3600) / 60);
    const seconds = totalTime % 60;

    log('\n╔══════════════════════════════════════════════════════════════╗', colors.bright);
    log('║                   Ingestion Complete! 🎉                     ║', colors.bright);
    log('╚══════════════════════════════════════════════════════════════╝\n', colors.bright);

    const finalStats = await getQueueStats(dbWorkerUrl, privateKeyPem);
    log('📊 Final Statistics:', colors.cyan);
    log(`  Total articles:     ${articleIds.length}`, colors.blue);
    log(`  Successfully added: ${queued.length}`, colors.green);
    log(`  Completed:          ${finalStats.completed || 0}`, colors.green);
    log(`  Failed:             ${finalStats.failed || 0}`, colors.red);
    log(`  Time elapsed:       ${hours}h ${minutes}m ${seconds}s`, colors.blue);
    console.log();

    if (finalStats.failed && finalStats.failed > 0) {
      log('⚠️  Some articles failed to process. You can:', colors.yellow);
      log('   1. Check the database ingestion_queue table for error messages', colors.yellow);
      log('   2. Re-run this script to retry failed articles', colors.yellow);
      log('   3. Use the /ingest-updates endpoint for incremental updates\n', colors.yellow);
    }

    process.exit(0);
  } catch (error) {
    log('\n❌ Fatal error during ingestion:', colors.red);
    log(error instanceof Error ? error.message : String(error), colors.red);
    console.error(error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  log('\n\n⚠️  Interrupt received. Gracefully shutting down...', colors.yellow);
  log('    Current progress is saved in the database.', colors.yellow);
  log('    You can resume by running this script again.\n', colors.yellow);
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log('\n\n⚠️  Termination signal received. Gracefully shutting down...', colors.yellow);
  log('    Current progress is saved in the database.', colors.yellow);
  log('    You can resume by running this script again.\n', colors.yellow);
  process.exit(0);
});

// Run the script
main();
