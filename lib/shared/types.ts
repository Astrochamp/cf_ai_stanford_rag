// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type ArticleID = string & { __id: true; };

export type RssFeedItem = {
  articleId: ArticleID;
  pubDate: Date; // Publication date from RSS feed
};

export type ArticleSection = {
  number: string; // 3.3
  heading: string; // Relevance and connexive logics
  content: string; // raw HTML content of the section
};

export type Article = {
  id: ArticleID;
  title: string; // e.g. Yogacara
  originalTitle: string; // not normalised, may contain diacritics. e.g. Yogācāra
  authors: string[]; // list of author names
  preamble: string; // raw HTML content of the preamble
  sections: ArticleSection[];
  related: ArticleID[];
  created: string; // YYYY-MM-DD format
  updated: string; // YYYY-MM-DD format
};

export type ProcessedChunk = {
  retrievalText: string; // Fully normalized for embedding/search
  generationText: string; // Formatted for LLM context and display
  tokenCount: number; // Based on retrieval text
};

// New: Item-based processing types
export type ItemKind = 'paragraph' | 'list' | 'table' | 'pre' | 'blockquote' | 'figure' | 'other';
export type SectionItem = {
  kind: ItemKind;
  html: string; // raw HTML for the item
};

// ============================================================================
// DATABASE SCHEMA TYPES
// ============================================================================

export type DBArticle = {
  article_id: string;
  title: string;
  authors: string | null;
  created: string; // YYYY-MM-DD format
  updated: string; // YYYY-MM-DD format
};

export type DBSection = {
  section_id: string; // format: article-id/a.b.c
  article_id: string;
  number: string; // a.b.c format
  heading: string | null;
  num_chunks: number;
};

export type DBChunk = {
  chunk_id: string;
  section_id: string;
  chunk_index: number; // scoped to section
  chunk_text: string;
  num_tokens: number;
  r2_key: string | null;
};

export type IngestionStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type DBIngestionQueue = {
  article_id: string;
  status: IngestionStatus;
  retry_count: number;
  last_attempt: number | null; // unix timestamp
  error_message: string | null;
};