/**
 * Script to delete all objects from an R2 bucket
 * Usage: yarn ts-node scripts/clear-r2-bucket.ts
 */

import 'dotenv/config';

const BUCKET_NAME = 'sep-articles';
const DB_WORKER_URL = process.env.DB_WORKER_URL;
const PRIVATE_KEY = process.env.JWT_PRIVATE_KEY;

if (!DB_WORKER_URL || !PRIVATE_KEY) {
  console.error('Missing required environment variables: DB_WORKER_URL, JWT_PRIVATE_KEY');
  process.exit(1);
}

// Import auth function
import { generateWorkerAuthToken } from '../lib/auth';

async function listAllObjects(): Promise<string[]> {
  const token = await generateWorkerAuthToken(DB_WORKER_URL!, PRIVATE_KEY!);
  const allKeys: string[] = [];
  let cursor: string | undefined;
  
  do {
    const url = new URL(`${DB_WORKER_URL}/r2`);
    url.searchParams.set('limit', '1000');
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to list objects: ${response.status} ${await response.text()}`);
    }

    const data = await response.json() as {
      objects: Array<{ key: string }>;
      truncated: boolean;
      cursor?: string;
    };

    allKeys.push(...data.objects.map(obj => obj.key));
    cursor = data.truncated ? data.cursor : undefined;
    
    console.log(`Listed ${allKeys.length} objects so far...`);
  } while (cursor);

  return allKeys;
}

async function deleteObject(key: string): Promise<void> {
  const token = await generateWorkerAuthToken(DB_WORKER_URL!, PRIVATE_KEY!);
  const url = `${DB_WORKER_URL}/r2/${encodeURIComponent(key)}`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to delete ${key}: ${response.status} ${await response.text()}`);
  }
}

async function main() {
  console.log(`🗑️  Clearing all objects from R2 bucket: ${BUCKET_NAME}`);
  console.log('');

  // List all objects
  console.log('📋 Listing all objects...');
  const keys = await listAllObjects();
  
  if (keys.length === 0) {
    console.log('✅ Bucket is already empty!');
    return;
  }

  console.log(`Found ${keys.length} objects to delete`);
  console.log('');

  // Delete all objects
  console.log('🗑️  Deleting objects...');
  let deleted = 0;
  const batchSize = 10; // Delete 10 at a time to avoid rate limits

  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);
    await Promise.all(batch.map(async (key) => {
      try {
        await deleteObject(key);
        deleted++;
        if (deleted % 50 === 0 || deleted === keys.length) {
          console.log(`  Deleted ${deleted}/${keys.length} objects...`);
        }
      } catch (error) {
        console.error(`  Failed to delete ${key}:`, error);
      }
    }));
  }

  console.log('');
  console.log(`✅ Successfully deleted ${deleted} objects from ${BUCKET_NAME}`);
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
