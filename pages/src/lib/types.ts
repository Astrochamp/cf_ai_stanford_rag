// Types for SEP Oracle RAG system

export interface SearchResult {
	id: string;
	title: string;
	excerpt: string;
	url: string;
	relevanceScore: number;
	lastModified?: string;
}

export interface QueryResponse {
	query: string;
	answer: string;
	sources: SearchResult[];
	timestamp: Date;
}

export interface Message {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	sources?: SearchResult[];
	timestamp: Date;
}
