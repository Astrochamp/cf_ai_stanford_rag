// Types for SEP Oracle RAG system

export interface Source {
  id: number;
  article_id: string;
  doc_title: string;
  section_heading: string;
  text: string;
}

export interface QueryResponse {
  query: string;
  answer: string;
  sources: Source[];
  timestamp: Date;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  timestamp: Date;
  query?: string; // The query that generated this result
}