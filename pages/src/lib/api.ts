// API service for SEP Oracle

import type Turnstile from './components/Turnstile.svelte';
import type { QueryResponse } from './types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Error code to user-friendly message mapping
const ERROR_MESSAGES: Record<string, string> = {
  'missing_turnstile_token': 'Please complete the CAPTCHA verification before searching.',
  'turnstile_verification_failed': 'CAPTCHA verification failed. Please try again.',
  'invalid_turnstile_token': 'Your CAPTCHA verification has expired or is invalid. Please verify again.',
  'turnstile_internal_error': 'An error occurred during CAPTCHA verification. Please refresh the page and try again.',
  'invalid_query': 'Your query is invalid. Please ensure it\'s not empty and doesn\'t exceed 4000 characters.',
  'invalid_topK': 'Invalid search parameters. Please refresh the page and try again.',
  'query_not_relevant': 'Your question doesn\'t appear to be related to philosophy. The SEP Oracle is designed for asking about philosophical topics, theories, arguments, and related academic content. Please try asking a philosophy-related question.',
  'internal_server_error': 'Sorry, something went wrong on our end. Please try again in a moment.',
};

export async function queryOracle(question: string, turnstileToken: string | null, turnstileComponent: Turnstile): Promise<QueryResponse> {
  if (!question.trim()) {
    throw new Error('Question cannot be empty');
  }

  if (!turnstileToken) {
    throw new Error('Please complete the CAPTCHA verification before searching.');
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
    // Try to parse error response
    let errorMessage = 'Sorry, something went wrong. Please try again.';

    try {
      const errorData = await response.json();

      // Check if we have a specific error code
      if (errorData.code && ERROR_MESSAGES[errorData.code]) {
        errorMessage = ERROR_MESSAGES[errorData.code];
      } else if (errorData.message) {
        // Fall back to server-provided message if available
        errorMessage = errorData.message;
      } else if (errorData.error) {
        errorMessage = errorData.error;
      }
    } catch (parseError) {
      // If we can't parse the error response, use status-based message
      if (response.status === 400) {
        errorMessage = 'Invalid request. Please check your input and try again.';
      } else if (response.status === 403) {
        errorMessage = 'Access denied. Please complete the CAPTCHA verification.';
      } else if (response.status === 429) {
        errorMessage = 'Too many requests. Please wait a moment and try again.';
      } else if (response.status >= 500) {
        errorMessage = 'Server error. Please try again in a moment.';
      }
    }

    throw new Error(errorMessage);
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
