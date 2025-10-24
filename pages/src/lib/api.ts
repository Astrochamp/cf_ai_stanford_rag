// API service for SEP Oracle

import type Turnstile from './components/Turnstile.svelte';
import type { QueryResponse } from './types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export async function queryOracle(question: string, turnstileToken: string | null, turnstileComponent: Turnstile): Promise<QueryResponse> {
  if (!question.trim()) {
    throw new Error('Question cannot be empty');
  }

  if (!turnstileToken) {
    throw new Error('Please complete CAPTCHA verification');
  }

  const response = await fetch(`${API_BASE_URL}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: question,
      topK: 12,
      token: turnstileToken
    }),
  });

  if (turnstileComponent) {
    turnstileComponent.reset();
    turnstileToken = null;
  }

  if (!response.ok) {
    throw new Error(`API request failed: ${response.statusText}`);
  }

  const data = await response.json();
  const cleanedAnswer = data.response.trim();

  // Transform the API response to match our QueryResponse type
  return {
    query: data.query,
    answer: cleanedAnswer,
    sources: data.sources,
    timestamp: new Date()
  };
}
