// Types for SEP Oracle RAG system

export interface Source {
  id: string;
  doc_title: string;
  section_id: string;
  section_heading: string;
  chunk_index: number;
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
}

export interface UsedEvidenceItem {
  id: string;
  verbatim_quote: string;
  role_in_answer: string;
}