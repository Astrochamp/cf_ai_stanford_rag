// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type ArticleID = string & { __id: true; };

export type ArticleSection = {
  shortName: string; // e.g. ReleConnLogi
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