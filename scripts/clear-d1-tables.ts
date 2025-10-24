/**
 * Script to delete all rows from D1 database tables
 * Usage: yarn ts-node scripts/clear-d1-tables.ts
 */

import 'dotenv/config';
import { executeD1Query } from '../lib/worker-api';

const DB_WORKER_URL = process.env.DB_WORKER_URL;
const PRIVATE_KEY = process.env.JWT_PRIVATE_KEY;

if (!DB_WORKER_URL || !PRIVATE_KEY) {
  console.error('Missing required environment variables: DB_WORKER_URL, JWT_PRIVATE_KEY');
  process.exit(1);
}

async function getTableCounts() {
  const tables = ['chunks', 'sections', 'articles', 'ingestion_queue'];
  const counts: Record<string, number> = {};
  
  for (const table of tables) {
    const result = await executeD1Query(
      `SELECT COUNT(*) as count FROM ${table}`,
      DB_WORKER_URL!,
      PRIVATE_KEY!
    );
    counts[table] = result.results[0].count;
  }
  
  return counts;
}

async function clearTable(tableName: string) {
  await executeD1Query(
    `DELETE FROM ${tableName}`,
    DB_WORKER_URL!,
    PRIVATE_KEY!
  );
}

async function main() {
  console.log('🗑️  Clearing all rows from D1 database tables');
  console.log('');

  // Get initial counts
  console.log('📊 Current row counts:');
  const beforeCounts = await getTableCounts();
  for (const [table, count] of Object.entries(beforeCounts)) {
    console.log(`  ${table}: ${count} rows`);
  }
  console.log('');

  const totalRows = Object.values(beforeCounts).reduce((sum, count) => sum + count, 0);
  if (totalRows === 0) {
    console.log('✅ All tables are already empty!');
    return;
  }

  // Delete in correct order (respecting foreign keys)
  // chunks -> sections -> articles, and ingestion_queue (no FK constraints)
  console.log('🗑️  Deleting rows...');
  
  console.log('  Deleting from chunks...');
  await clearTable('chunks');
  
  console.log('  Deleting from sections...');
  await clearTable('sections');
  
  console.log('  Deleting from articles...');
  await clearTable('articles');
  
  console.log('  Deleting from ingestion_queue...');
  await clearTable('ingestion_queue');
  
  console.log('');

  // Verify deletion
  console.log('📊 Final row counts:');
  const afterCounts = await getTableCounts();
  for (const [table, count] of Object.entries(afterCounts)) {
    console.log(`  ${table}: ${count} rows`);
  }
  console.log('');

  const deletedRows = totalRows - Object.values(afterCounts).reduce((sum, count) => sum + count, 0);
  console.log(`✅ Successfully deleted ${deletedRows} rows from D1 database`);
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
