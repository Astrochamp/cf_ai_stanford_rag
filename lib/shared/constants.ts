// ============================================================================
// CONSTANTS & REGEX PATTERNS
// ============================================================================

export const articlesListURL = "https://plato.stanford.edu/published.html";
export const baseArticleURL = "https://plato.stanford.edu/entries/";
export const TEX_PATTERN = /(?:\\\(|\\\[)(.*?)(?:\\\)|\\\])/s;
export const TABLE_REGEX = /<table[^>]*>[\s\S]*?<\/table>/gi;
export const NESTED_LIST_PLACEHOLDER = '__NESTED_LIST__';
export const NESTED_LIST_END_PLACEHOLDER = '__END_NESTED_LIST__';

export const EXCLUDED_TEX_COMMANDS = new Set([
  'sum', 'int', 'prod', 'lim', 'bigcup', 'bigcap', // operators
  'frac', 'sqrt',                                  // fractions, roots
  'hat', 'bar', 'vec', 'dot', 'tilde',             // accents
  'begin', 'end'                                   // structural
]);