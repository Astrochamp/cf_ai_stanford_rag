// API service for SEP Oracle

import type { QueryResponse, Source } from './types';
import { extractSourcesJson } from './parse';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export async function queryOracle(question: string): Promise<QueryResponse> {
	const response = await fetch(`${API_BASE_URL}/search`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			query: question,
			topK: 12
		}),
	});

	if (!response.ok) {
		throw new Error(`API request failed: ${response.statusText}`);
	}

	const data = await response.json();

	// Extract used evidence from the LLM response
	const usedEvidence = extractSourcesJson(data.response);

	// Remove the "## Sources" section and everything after from the displayed answer
	let cleanedAnswer = data.response;
	const sourcesHeadingIndex = cleanedAnswer.indexOf('## Sources');
	if (sourcesHeadingIndex !== -1) {
		cleanedAnswer = cleanedAnswer.substring(0, sourcesHeadingIndex).trim();
	}

	// Transform the API response to match our QueryResponse type
	return {
		query: data.query,
		answer: cleanedAnswer,
		sources: data.sources,
		usedEvidence: usedEvidence || [],
		timestamp: new Date()
	};
}
