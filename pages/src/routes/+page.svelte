<script lang="ts">
  import { queryOracle } from "$lib/api";
  import type { Message } from "$lib/types";
  import { onMount } from "svelte";

  let query = $state("");
  let messages = $state<Message[]>([]);
  let isLoading = $state(false);
  let isDark = $state(false);
  let inputElement: HTMLTextAreaElement;

  const exampleQuestions = [
    "What is epistemology?",
    "Explain the mind-body problem",
    "What are the main arguments for free will?",
    "Describe the trolley problem",
  ];

  // Initialize theme based on localStorage or system preference
  onMount(() => {
    const stored = localStorage.getItem("theme");
    if (stored) {
      isDark = stored === "dark";
    } else {
      isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
  });

  function toggleTheme() {
    isDark = !isDark;
    localStorage.setItem("theme", isDark ? "dark" : "light");
  }

  async function handleSubmit() {
    if (!query.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: query.trim(),
      timestamp: new Date(),
    };

    messages = [...messages, userMessage];
    const currentQuery = query;
    query = "";
    isLoading = true;

    try {
      const response = await queryOracle(currentQuery);

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.answer,
        sources: response.sources,
        timestamp: response.timestamp,
      };

      messages = [...messages, assistantMessage];
    } catch (error) {
      console.error("Error querying oracle:", error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          "I apologize, but I encountered an error processing your query. Please try again.",
        timestamp: new Date(),
      };
      messages = [...messages, errorMessage];
    } finally {
      isLoading = false;
      setTimeout(() => inputElement?.focus(), 0);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function selectExample(example: string) {
    query = example;
    inputElement?.focus();
  }

  function clearConversation() {
    messages = [];
    query = "";
  }
</script>

<svelte:head>
  <title>SEP Oracle - Stanford Encyclopedia of Philosophy RAG</title>
  <meta
    name="description"
    content="An unofficial RAG system for querying the Stanford Encyclopedia of Philosophy"
  />
</svelte:head>

<div
  class="min-h-screen transition-colors duration-300 {isDark
    ? 'bg-linear-to-br from-slate-900 via-stone-900 to-slate-900'
    : 'bg-linear-to-br from-slate-50 via-stone-50 to-amber-50/30'}"
>
  <!-- Header -->
  <header
    class="border-b sticky top-0 z-10 shadow-sm transition-colors duration-300 {isDark
      ? 'border-stone-700 bg-stone-900/80 backdrop-blur-sm'
      : 'border-stone-200 bg-white/80 backdrop-blur-sm'}"
  >
    <div class="max-w-5xl mx-auto px-6 py-6">
      <div class="flex items-center justify-between">
        <div>
          <h1
            class="text-3xl font-bold font-serif tracking-tight {isDark
              ? 'text-stone-100'
              : 'text-stone-900'}"
          >
            SEP Oracle
          </h1>
          <p
            class="text-sm mt-1 font-light {isDark
              ? 'text-stone-400'
              : 'text-stone-600'}"
          >
            Stanford Encyclopedia of Philosophy · Retrieval-Augmented Generation
          </p>
        </div>
        <div class="flex items-center gap-3">
          <!-- Theme Toggle -->
          <button
            onclick={toggleTheme}
            class="p-2 rounded-lg transition-colors {isDark
              ? 'hover:bg-stone-800 text-amber-400'
              : 'hover:bg-stone-100 text-stone-600'}"
            aria-label="Toggle theme"
          >
            {#if isDark}
              <!-- Sun icon -->
              <svg
                class="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
            {:else}
              <!-- Moon icon -->
              <svg
                class="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
              </svg>
            {/if}
          </button>
          {#if messages.length > 0}
            <button
              onclick={clearConversation}
              class="text-sm transition-colors px-4 py-2 rounded-lg {isDark
                ? 'text-stone-400 hover:text-stone-100 hover:bg-stone-800'
                : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'}"
            >
              Clear
            </button>
          {/if}
        </div>
      </div>
    </div>
  </header>

  <main class="max-w-5xl mx-auto px-6 py-12">
    {#if messages.length === 0}
      <!-- Welcome Screen -->
      <div class="text-center mb-16 mt-8">
        <div
          class="inline-block p-4 rounded-full mb-6 {isDark
            ? 'bg-amber-900/30'
            : 'bg-amber-100/50'}"
        >
          <svg
            class="w-16 h-16 {isDark ? 'text-amber-400' : 'text-amber-800'}"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
          </svg>
        </div>
        <h2
          class="text-4xl font-serif font-bold mb-4 {isDark
            ? 'text-stone-100'
            : 'text-stone-900'}"
        >
          Welcome to SEP Oracle
        </h2>
        <p
          class="text-lg max-w-2xl mx-auto leading-relaxed mb-8 {isDark
            ? 'text-stone-300'
            : 'text-stone-700'}"
        >
          Ask questions about philosophy and receive answers grounded in the
          <span class="font-semibold">Stanford Encyclopedia of Philosophy</span
          >. This unofficial tool uses retrieval-augmented generation to provide
          scholarly insights.
        </p>
        <div
          class="inline-block px-4 py-2 rounded-lg text-sm {isDark
            ? 'bg-amber-900/20 border border-amber-800 text-amber-300'
            : 'bg-amber-50 border border-amber-200 text-amber-900'}"
        >
          ⚠️ <span class="font-medium">Demo Mode:</span> Using placeholder API responses
        </div>
      </div>

      <!-- Example Questions -->
      <div class="mb-12">
        <h3
          class="text-sm font-semibold uppercase tracking-wider mb-4 {isDark
            ? 'text-stone-400'
            : 'text-stone-600'}"
        >
          Try asking:
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          {#each exampleQuestions as example}
            <button
              onclick={() => selectExample(example)}
              class="text-left p-4 rounded-xl border transition-all group {isDark
                ? 'border-stone-700 hover:border-amber-600 hover:bg-amber-950/30'
                : 'border-stone-200 hover:border-amber-300 hover:bg-amber-50/50'}"
            >
              <span
                class={isDark
                  ? "text-stone-300 group-hover:text-stone-100"
                  : "text-stone-700 group-hover:text-stone-900"}
              >
                {example}
              </span>
            </button>
          {/each}
        </div>
      </div>
    {:else}
      <!-- Conversation -->
      <div class="space-y-8 mb-12">
        {#each messages as message (message.id)}
          <div
            class="flex gap-4 {message.role === 'user'
              ? 'justify-end'
              : 'justify-start'}"
          >
            <div
              class="flex gap-4 max-w-4xl {message.role === 'user'
                ? 'flex-row-reverse'
                : 'flex-row'}"
            >
              <!-- Avatar -->
              <div class="shrink-0">
                {#if message.role === "user"}
                  <div
                    class="w-10 h-10 rounded-full bg-stone-600 flex items-center justify-center"
                  >
                    <svg
                      class="w-6 h-6 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                  </div>
                {:else}
                  <div
                    class="w-10 h-10 rounded-full bg-amber-600 flex items-center justify-center"
                  >
                    <svg
                      class="w-6 h-6 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                      />
                    </svg>
                  </div>
                {/if}
              </div>

              <!-- Message Content -->
              <div class="flex-1">
                <div
                  class="px-6 py-4 {message.role === 'user'
                    ? isDark
                      ? 'bg-stone-700 text-white rounded-2xl rounded-tr-sm'
                      : 'bg-stone-700 text-white rounded-2xl rounded-tr-sm'
                    : isDark
                      ? 'bg-stone-800 border border-stone-700 rounded-2xl rounded-tl-sm shadow-sm text-stone-100'
                      : 'bg-white border border-stone-200 rounded-2xl rounded-tl-sm shadow-sm'}"
                >
                  <div
                    class="prose max-w-none {message.role === 'user'
                      ? 'prose-invert'
                      : isDark
                        ? 'prose-invert prose-stone'
                        : 'prose-stone'}"
                  >
                    <p class="whitespace-pre-wrap leading-relaxed">
                      {message.content}
                    </p>
                  </div>
                </div>

                <!-- Sources -->
                {#if message.sources && message.sources.length > 0}
                  <div class="mt-4 space-y-2">
                    <p
                      class="text-xs font-semibold uppercase tracking-wider {isDark
                        ? 'text-stone-400'
                        : 'text-stone-600'}"
                    >
                      Sources
                    </p>
                    {#each message.sources as source}
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="block p-3 rounded-lg border transition-all group {isDark
                          ? 'border-stone-700 hover:border-amber-600 hover:bg-amber-950/30'
                          : 'border-stone-200 hover:border-amber-300 hover:bg-amber-50/50'}"
                      >
                        <div class="flex items-start justify-between gap-3">
                          <div class="flex-1 min-w-0">
                            <h4
                              class="font-semibold text-sm mb-1 {isDark
                                ? 'text-stone-200 group-hover:text-amber-400'
                                : 'text-stone-900 group-hover:text-amber-900'}"
                            >
                              {source.title}
                            </h4>
                            <p
                              class="text-xs line-clamp-2 {isDark
                                ? 'text-stone-400'
                                : 'text-stone-600'}"
                            >
                              {source.excerpt}
                            </p>
                          </div>
                          <div
                            class="shrink-0 text-xs {isDark
                              ? 'text-stone-500'
                              : 'text-stone-500'}"
                          >
                            {Math.round(source.relevanceScore * 100)}%
                          </div>
                        </div>
                      </a>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
          </div>
        {/each}

        {#if isLoading}
          <div class="flex gap-4">
            <div class="shrink-0">
              <div
                class="w-10 h-10 rounded-full bg-amber-600 flex items-center justify-center"
              >
                <svg
                  class="w-6 h-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  />
                </svg>
              </div>
            </div>
            <div
              class="rounded-2xl rounded-tl-sm shadow-sm px-6 py-4 {isDark
                ? 'bg-stone-800 border border-stone-700'
                : 'bg-white border border-stone-200'}"
            >
              <div class="flex gap-1">
                <div
                  class="w-2 h-2 rounded-full animate-bounce {isDark
                    ? 'bg-stone-500'
                    : 'bg-stone-400'}"
                  style="animation-delay: 0ms"
                ></div>
                <div
                  class="w-2 h-2 rounded-full animate-bounce {isDark
                    ? 'bg-stone-500'
                    : 'bg-stone-400'}"
                  style="animation-delay: 150ms"
                ></div>
                <div
                  class="w-2 h-2 rounded-full animate-bounce {isDark
                    ? 'bg-stone-500'
                    : 'bg-stone-400'}"
                  style="animation-delay: 300ms"
                ></div>
              </div>
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Input Area -->
    <div class="sticky bottom-6">
      <div
        class="rounded-2xl shadow-lg border p-4 {isDark
          ? 'bg-stone-800 border-stone-700'
          : 'bg-white border-stone-200'}"
      >
        <form
          onsubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          class="flex gap-3"
        >
          <textarea
            bind:this={inputElement}
            bind:value={query}
            onkeydown={handleKeydown}
            placeholder="Ask a philosophical question..."
            rows="1"
            class="flex-1 resize-none rounded-lg px-4 py-3 border focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent font-light {isDark
              ? 'bg-stone-900 border-stone-600 text-stone-100 placeholder:text-stone-500'
              : 'bg-white border-stone-300 text-stone-900 placeholder:text-stone-400'}"
            disabled={isLoading}
          ></textarea>
          <button
            type="submit"
            disabled={!query.trim() || isLoading}
            class="px-6 py-3 bg-amber-600 hover:bg-amber-700 disabled:bg-stone-300 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center gap-2"
          >
            {#if isLoading}
              <svg class="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                ></circle>
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
            {:else}
              <svg
                class="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M14 5l7 7m0 0l-7 7m7-7H3"
                />
              </svg>
            {/if}
          </button>
        </form>
        <p
          class="text-xs mt-3 text-center {isDark
            ? 'text-stone-500'
            : 'text-stone-500'}"
        >
          Press <kbd
            class="px-1.5 py-0.5 rounded border font-mono {isDark
              ? 'bg-stone-900 border-stone-600'
              : 'bg-stone-100 border-stone-300'}">Enter</kbd
          >
          to send,
          <kbd
            class="px-1.5 py-0.5 rounded border font-mono {isDark
              ? 'bg-stone-900 border-stone-600'
              : 'bg-stone-100 border-stone-300'}">Shift+Enter</kbd
          > for new line
        </p>
      </div>
    </div>
  </main>

  <!-- Footer -->
  <footer
    class="border-t backdrop-blur-sm mt-20 {isDark
      ? 'border-stone-800 bg-stone-900/50'
      : 'border-stone-200 bg-white/50'}"
  >
    <div
      class="max-w-5xl mx-auto px-6 py-8 text-center text-sm {isDark
        ? 'text-stone-400'
        : 'text-stone-600'}"
    >
      <p class="mb-2">
        Unofficial tool for the
        <a
          href="https://plato.stanford.edu/"
          target="_blank"
          rel="noopener noreferrer"
          class="font-medium underline {isDark
            ? 'text-amber-400 hover:text-amber-300'
            : 'text-amber-700 hover:text-amber-900'}"
        >
          Stanford Encyclopedia of Philosophy
        </a>
      </p>
      <p class="text-xs {isDark ? 'text-stone-500' : 'text-stone-500'}">
        Not affiliated with Stanford University or the Stanford Encyclopedia of
        Philosophy
      </p>
    </div>
  </footer>
</div>

<style>
  @keyframes bounce {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-0.25rem);
    }
  }

  .animate-bounce {
    animation: bounce 1s infinite;
  }
</style>
