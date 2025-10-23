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
  usedEvidence: UsedEvidenceItem[];
  timestamp: Date;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  usedEvidence?: UsedEvidenceItem[];
  timestamp: Date;
  query?: string; // The query that generated this result
}

export interface UsedEvidenceItem {
  id: string;
  verbatim_quote: string;
  role_in_answer: string;
}