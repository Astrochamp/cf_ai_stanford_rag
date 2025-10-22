import type { IngestionStatus } from './shared/types';
import { executeD1Query } from './worker-api';

/**
 * Add article to ingestion queue
 */
export async function addToIngestionQueue(articleId: string): Promise<void> {
  await executeD1Query(
    `INSERT OR IGNORE INTO ingestion_queue (article_id, status, retry_count)
     VALUES (?, 'pending', 0)`,
    [articleId]
  );
}

/**
 * Update ingestion queue status
 */
export async function updateIngestionStatus(
  articleId: string,
  status: IngestionStatus,
  errorMessage?: string
): Promise<void> {
  const now = Date.now();

  if (errorMessage) {
    await executeD1Query(
      `UPDATE ingestion_queue
       SET status = ?, last_attempt = ?, error_message = ?, retry_count = retry_count + 1
       WHERE article_id = ?`,
      [status, now, errorMessage, articleId]
    );
  } else {
    await executeD1Query(
      `UPDATE ingestion_queue
       SET status = ?, last_attempt = ?, error_message = NULL
       WHERE article_id = ?`,
      [status, now, articleId]
    );
  }
}

/**
 * Get the next pending article from the ingestion queue
 */
export async function getNextPendingArticle(): Promise<string | null> {
  const result = await executeD1Query(
    `SELECT article_id FROM ingestion_queue
     WHERE status IN ('pending', 'failed')
     ORDER BY last_attempt ASC NULLS FIRST
     LIMIT 1`
  );

  if (result.results && result.results.length > 0) {
    return result.results[0].article_id;
  }
  return null;
}

/**
 * Get ingestion queue statistics
 */
export async function getQueueStats(): Promise<Record<string, number>> {
  const result = await executeD1Query(
    `SELECT status, COUNT(*) as count
     FROM ingestion_queue
     GROUP BY status`
  );

  const stats: Record<string, number> = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  };

  if (result.results) {
    for (const row of result.results) {
      stats[row.status] = row.count;
    }
  }

  return stats;
}
