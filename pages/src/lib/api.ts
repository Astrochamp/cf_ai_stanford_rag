// API service for SEP Oracle
// Placeholder implementation - replace with actual API calls when backend is ready

import type { QueryResponse, SearchResult } from './types';

const PLACEHOLDER_SOURCES: SearchResult[] = [
	{
		id: '1',
		title: 'Epistemology',
		excerpt: 'The study of knowledge and justified belief. Epistemology is concerned with the nature, sources, limitations, and validity of knowledge...',
		url: 'https://plato.stanford.edu/entries/epistemology/',
		relevanceScore: 0.95,
		lastModified: '2023-09-15'
	},
	{
		id: '2',
		title: 'Metaphysics',
		excerpt: 'The branch of philosophy that examines the fundamental nature of reality, including the relationship between mind and matter, substance and attribute, fact and value...',
		url: 'https://plato.stanford.edu/entries/metaphysics/',
		relevanceScore: 0.87,
		lastModified: '2023-08-20'
	},
	{
		id: '3',
		title: 'Ethics',
		excerpt: 'Moral philosophy is the branch of philosophy that contemplates what is right and wrong. It explores the nature of morality and examines how people should live their lives...',
		url: 'https://plato.stanford.edu/entries/ethics/',
		relevanceScore: 0.82,
		lastModified: '2023-10-01'
	}
];

export async function queryOracle(question: string): Promise<QueryResponse> {
	// Simulate API delay
	await new Promise(resolve => setTimeout(resolve, 1500));

	// Placeholder response
	const response: QueryResponse = {
		query: question,
		answer: `This is a placeholder response to your question: "${question}". 

The Stanford Encyclopedia of Philosophy offers comprehensive coverage of philosophical topics. When the API is implemented, this will provide a detailed, contextual answer drawn from relevant SEP articles using retrieval-augmented generation (RAG).

The response will synthesize information from multiple sources, provide accurate citations, and maintain the scholarly rigor expected from philosophical discourse.`,
		sources: PLACEHOLDER_SOURCES,
		timestamp: new Date()
	};

	return response;
}

export async function searchEntries(query: string): Promise<SearchResult[]> {
	// Simulate API delay
	await new Promise(resolve => setTimeout(resolve, 800));

	// Return placeholder sources
	return PLACEHOLDER_SOURCES.filter(source => 
		source.title.toLowerCase().includes(query.toLowerCase()) ||
		source.excerpt.toLowerCase().includes(query.toLowerCase())
	);
}
