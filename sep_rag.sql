CREATE TABLE IF NOT EXISTS articles (
  article_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  created INTEGER NOT NULL, -- unix timestamp
  updated INTEGER NOT NULL  -- unix timestamp
);

CREATE TABLE IF NOT EXISTS sections (
  section_id TEXT PRIMARY KEY, -- format: article-id/a.b.c
  article_id TEXT NOT NULL,
  number TEXT NOT NULL, -- a.b.c format
  heading TEXT,
  num_chunks INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (article_id) REFERENCES articles(article_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sections_article ON sections(article_id);

CREATE TABLE IF NOT EXISTS chunks (
  chunk_id TEXT PRIMARY KEY,
  section_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL, -- scoped to section
  chunk_text TEXT NOT NULL,
  FOREIGN KEY (section_id) REFERENCES sections(section_id) ON DELETE CASCADE,
  UNIQUE(section_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS ingestion_queue (
  article_id TEXT PRIMARY KEY,
  -- 'pending', 'processing', 'completed', 'failed'
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_attempt INTEGER, -- unix timestamp
  error_message TEXT
);

-- index to quickly find the next job
CREATE INDEX IF NOT EXISTS idx_pending_jobs ON ingestion_queue (status, last_attempt)
  WHERE status IN ('pending','failed');

-- virtual table for full-text search on chunks
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED,
  section_id UNINDEXED,
  chunk_text,
  content=chunks,
  content_rowid=rowid,
  tokenize = "unicode61"
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, chunk_id, section_id, chunk_text)
  VALUES (new.rowid, new.chunk_id, new.section_id, new.chunk_text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, chunk_id, section_id, chunk_text)
  VALUES ('delete', old.rowid, old.chunk_id, old.section_id, old.chunk_text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, chunk_id, section_id, chunk_text)
  VALUES ('delete', old.rowid, old.chunk_id, old.section_id, old.chunk_text);
  INSERT INTO chunks_fts(rowid, chunk_id, section_id, chunk_text)
  VALUES (new.rowid, new.chunk_id, new.section_id, new.chunk_text);
END;