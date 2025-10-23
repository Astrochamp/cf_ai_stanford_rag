<script lang="ts">
  import { queryOracle } from "$lib/api";
  import { parseTeX } from "$lib/parse";
  import type { Message } from "$lib/types";
  import { marked } from "marked";
  import { onMount } from "svelte";

  let query = $state("");
  let results = $state<Message[]>([]);
  let isLoading = $state(false);
  let isDark = $state(false);
  let inputElement: HTMLTextAreaElement;
  let showUnusedSources = $state<Record<string, boolean>>({});

  const MAX_CHAR_LIMIT = 4000;
  const WARNING_THRESHOLD = 3500;

  const charCount = $derived(query.length);
  const showCharCounter = $derived(charCount >= WARNING_THRESHOLD);
  const isOverLimit = $derived(charCount > MAX_CHAR_LIMIT);
  const charCountColor = $derived(
    isOverLimit
      ? "text-red-600 dark:text-red-400"
      : charCount >= WARNING_THRESHOLD
        ? "text-amber-600 dark:text-amber-400"
        : "",
  );

  const citationRegex =
    /\((UNSUPPORTED BY PROVIDED SOURCES|[A-Za-z0-9_-]+\/\d+(\.\d+)*\/chunk-\d+(\s*;\s*[A-Za-z0-9_-]+\/\d+(\.\d+)*\/chunk-\d+)*)\)/g;
  const validSourceIdPattern = /^[A-Za-z0-9_-]+\/\d+(\.\d+)*\/chunk-\d+$/;

  // Configure marked for better output
  marked.setOptions({
    breaks: true,
    gfm: true,
    async: false,
  });

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

    // Handle citation link clicks
    const handleCitationClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.classList.contains("citation") &&
        !target.classList.contains("unsupported")
      ) {
        e.preventDefault();
        const sourceId = target.getAttribute("data-source-id");
        if (sourceId) {
          scrollToSource(sourceId);
        }
      }
    };

    document.addEventListener("click", handleCitationClick);
    return () => {
      document.removeEventListener("click", handleCitationClick);
    };
  });

  function toggleTheme() {
    isDark = !isDark;
    localStorage.setItem("theme", isDark ? "dark" : "light");
  }

  function autoResizeTextarea() {
    if (inputElement) {
      inputElement.style.height = "auto";
      inputElement.style.height = inputElement.scrollHeight + "px";
    }
  }

  async function handleSubmit() {
    if (!query.trim() || isLoading || isOverLimit) return;

    const currentQuery = query.trim();
    query = "";
    isLoading = true;

    // Reset textarea height after clearing
    setTimeout(() => autoResizeTextarea(), 0);

    try {
      const response = await queryOracle(currentQuery);

      const result: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.answer,
        sources: response.sources,
        usedEvidence: response.usedEvidence,
        timestamp: response.timestamp,
        query: currentQuery, // Store the query that generated this result
      };

      // Add new result at the beginning (most recent first)
      results = [result, ...results];
    } catch (error) {
      console.error("Error querying oracle:", error);
      const errorResult: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          "I apologize, but I encountered an error processing your query. Please try again.",
        timestamp: new Date(),
        query: currentQuery,
      };
      results = [errorResult, ...results];
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
    results = [];
    query = "";
  }

  function toggleUnusedSources(messageId: string) {
    showUnusedSources[messageId] = !showUnusedSources[messageId];
  }

  // Helper function to categorize sources into used and unused
  function categorizeSources(message: Message) {
    const allSources = message.sources || [];
    const usedEvidence = message.usedEvidence || [];
    const usedSourceIds = new Set(usedEvidence.map((e) => e.id));

    const usedSources = allSources.filter((s) => usedSourceIds.has(s.id));
    const unusedSources = allSources.filter((s) => !usedSourceIds.has(s.id));

    // Create a map for quick lookup of used evidence details
    const evidenceMap = new Map(usedEvidence.map((e) => [e.id, e]));

    // Extract citation numbers from the message content to order sources
    const citationOrder = extractCitationOrder(message.content);

    // Sort used sources by their citation number
    const sortedUsedSources = usedSources.sort((a, b) => {
      const citationA = citationOrder.get(a.id) ?? Infinity;
      const citationB = citationOrder.get(b.id) ?? Infinity;
      return citationA - citationB;
    });

    return {
      usedSources: sortedUsedSources,
      unusedSources,
      evidenceMap,
      citationOrder,
    };
  }

  // Helper function to extract citation ordering from text
  function extractCitationOrder(text: string): Map<string, number> {
    const sourceIdToCitationNumber = new Map<string, number>();
    let nextCitationNumber = 1;

    // Match citations in the same format as parseCitations
    let match;
    while ((match = citationRegex.exec(text)) !== null) {
      const content = match[1];

      // Skip unsupported claims
      if (content.trim() === "UNSUPPORTED BY PROVIDED SOURCES") {
        continue;
      }

      // Split by semicolon for multiple citations
      const sourceIds = content.split(";").map((id: string) => id.trim());

      // Validate source IDs
      const allValid = sourceIds.every((id: string) =>
        validSourceIdPattern.test(id),
      );

      if (!allValid) {
        continue;
      }

      // Assign citation numbers in order of appearance
      for (const sourceId of sourceIds) {
        if (!sourceIdToCitationNumber.has(sourceId)) {
          sourceIdToCitationNumber.set(sourceId, nextCitationNumber++);
        }
      }
    }

    return sourceIdToCitationNumber;
  }

  // Helper function to parse and convert citations to clickable links
  // Also handles TeX math expressions
  function parseCitations(text: string | Promise<string>): string {
    // Ensure text is a string (marked can return Promise in some configs)
    const textStr = typeof text === "string" ? text : "";

    // Create a map to track unique citation numbers for each source ID
    const sourceIdToCitationNumber = new Map<string, number>();
    let nextCitationNumber = 1;

    // More specific regex that matches:
    // 1. (UNSUPPORTED BY PROVIDED SOURCES) - exact match
    // 2. Source IDs in format: (word/1.2/chunk-N) or (word/2.3.4/chunk-N; word/5/chunk-N)
    //    Source IDs contain alphanumeric, hyphens, underscores, forward slashes
    //    Multiple sources are separated by semicolons
    return textStr.replace(citationRegex, (match, content) => {
      // Check if it's the unsupported claim marker
      if (content.trim() === "UNSUPPORTED BY PROVIDED SOURCES") {
        return `<span class="citation unsupported" title="This claim is not supported by the provided sources">[citation needed]</span>`;
      }

      // Split by semicolon for multiple citations
      const sourceIds = content.split(";").map((id: string) => id.trim());

      // Validate that all source IDs match the expected format (e.g., "word/1.2.3/chunk-N")
      const allValid = sourceIds.every((id: string) =>
        validSourceIdPattern.test(id),
      );

      // If not all IDs are valid, don't treat this as a citation
      if (!allValid) {
        return match; // Return the original text unchanged
      }

      // Create clickable citation links with unique numbers
      const citationLinks = sourceIds
        .map((sourceId: string) => {
          // Get or assign a unique citation number for this source
          if (!sourceIdToCitationNumber.has(sourceId)) {
            sourceIdToCitationNumber.set(sourceId, nextCitationNumber++);
          }
          const citationNumber = sourceIdToCitationNumber.get(sourceId)!;

          const safeId = sourceId.replace(/[^a-zA-Z0-9-]/g, "_");
          return `<a href="#source-${safeId}" class="citation" data-source-id="${sourceId}" title="Jump to source: ${sourceId}">[${citationNumber}]</a>`;
        })
        .join("");

      return citationLinks;
    });
  }

  // Helper function to render content with TeX, markdown, and citations
  function renderContent(content: string): string {
    // Step 1: Parse TeX expressions first (before markdown)
    const withTeX = parseTeX(content);
    // Step 2: Parse markdown
    const withMarkdown = marked(withTeX);
    // Step 3: Parse citations
    const withCitations = parseCitations(withMarkdown);
    return withCitations;
  }

  // Function to scroll to a source element
  function scrollToSource(sourceId: string) {
    const safeId = sourceId.replace(/[^a-zA-Z0-9-]/g, "_");
    const element = document.getElementById(`source-${safeId}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      // Add a highlight effect
      element.classList.add("highlight-source");
      setTimeout(() => {
        element.classList.remove("highlight-source");
      }, 2000);
    }
  }

  // Helper function to extract article ID from source ID
  function getArticleId(sourceId: string): string | null {
    // Format: article-id/section/chunk-N
    const parts = sourceId.split("/");
    return parts.length > 0 ? parts[0] : null;
  }

  // Helper function to get SEP URL for a source
  function getSEPUrl(sourceId: string): string | null {
    const articleId = getArticleId(sourceId);
    return articleId
      ? `https://plato.stanford.edu/entries/${articleId}/`
      : null;
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
          {#if results.length > 0}
            <button
              onclick={clearConversation}
              class="text-sm transition-colors px-4 py-2 rounded-lg {isDark
                ? 'text-stone-400 hover:text-stone-100 hover:bg-stone-800'
                : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'}"
            >
              Clear All
            </button>
          {/if}
        </div>
      </div>
    </div>
  </header>

  <main class="max-w-5xl mx-auto px-6 py-8">
    <!-- Search Input Area (Always at top) -->
    <div class="mb-8">
      <div
        class="rounded-2xl shadow-lg border p-5 {isDark
          ? 'bg-stone-800 border-stone-700'
          : 'bg-white border-stone-200'}"
      >
        <form
          onsubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          class="flex gap-3 items-end"
        >
          <textarea
            bind:this={inputElement}
            bind:value={query}
            oninput={autoResizeTextarea}
            onkeydown={handleKeydown}
            placeholder="Ask a philosophical question..."
            rows="1"
            style="max-height: 400px; overflow-y: auto;"
            class="flex-1 resize-none rounded-lg px-4 py-3 border focus:outline-none focus:ring-2 focus:border-transparent font-light {isOverLimit
              ? isDark
                ? 'border-red-500 focus:ring-red-500 bg-stone-900 text-stone-100 placeholder:text-stone-500'
                : 'border-red-500 focus:ring-red-500 bg-white text-stone-900 placeholder:text-stone-400'
              : isDark
                ? 'border-stone-600 focus:ring-amber-500 bg-stone-900 text-stone-100 placeholder:text-stone-500'
                : 'border-stone-300 focus:ring-amber-500 bg-white text-stone-900 placeholder:text-stone-400'}"
            disabled={isLoading}
          ></textarea>
          <button
            type="submit"
            disabled={!query.trim() || isLoading || isOverLimit}
            class="px-6 py-3 h-[50px] shrink-0 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center gap-2 {isOverLimit
              ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-300'
              : 'bg-amber-600 hover:bg-amber-700 disabled:bg-stone-300'}"
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
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            {/if}
          </button>
        </form>
        <div class="flex items-center justify-between mt-3 text-xs">
          <p class="text-center {isDark ? 'text-stone-500' : 'text-stone-500'}">
            Press <kbd
              class="px-1.5 py-0.5 rounded border font-mono {isDark
                ? 'bg-stone-900 border-stone-600'
                : 'bg-stone-100 border-stone-300'}">Enter</kbd
            >
            to search,
            <kbd
              class="px-1.5 py-0.5 rounded border font-mono {isDark
                ? 'bg-stone-900 border-stone-600'
                : 'bg-stone-100 border-stone-300'}">Shift+Enter</kbd
            > for new line
          </p>
          {#if showCharCounter}
            <p class="font-mono font-semibold {charCountColor}">
              {charCount}/{MAX_CHAR_LIMIT}
              {#if isOverLimit}
                <span class="ml-1">- Query too long</span>
              {/if}
            </p>
          {/if}
        </div>
      </div>
    </div>

    {#if results.length === 0 && !isLoading}
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
    {/if}

    <!-- Loading State -->
    {#if isLoading}
      <div class="mb-8">
        <div
          class="rounded-xl border shadow-sm p-6 {isDark
            ? 'bg-stone-800 border-stone-700'
            : 'bg-white border-stone-200'}"
        >
          <div class="flex items-center gap-3">
            <svg
              class="animate-spin h-6 w-6 text-amber-600"
              fill="none"
              viewBox="0 0 24 24"
            >
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
            <span
              class="text-lg {isDark ? 'text-stone-300' : 'text-stone-700'}"
            >
              Searching the Stanford Encyclopedia of Philosophy...
            </span>
          </div>
        </div>
      </div>
    {/if}

    <!-- Results Section -->
    {#if results.length > 0}
      <div class="space-y-6">
        <h2
          class="text-lg font-semibold {isDark
            ? 'text-stone-300'
            : 'text-stone-700'}"
        >
          {results.length}
          {results.length === 1 ? "Result" : "Results"}
        </h2>

        {#each results as result (result.id)}
          <article
            class="rounded-xl border shadow-sm overflow-hidden {isDark
              ? 'bg-stone-800 border-stone-700'
              : 'bg-white border-stone-200'}"
          >
            <!-- Query Header -->
            <div
              class="px-6 py-4 border-b {isDark
                ? 'bg-stone-800/50 border-stone-700'
                : 'bg-stone-50 border-stone-200'}"
            >
              <div class="flex items-start gap-3">
                <svg
                  class="w-5 h-5 mt-0.5 shrink-0 {isDark
                    ? 'text-amber-400'
                    : 'text-amber-600'}"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div class="flex-1 min-w-0">
                  <p
                    class="font-medium text-base leading-relaxed {isDark
                      ? 'text-stone-100'
                      : 'text-stone-900'}"
                  >
                    {result.query || "Query"}
                  </p>
                </div>
              </div>
            </div>

            <!-- Answer Content -->
            <div class="px-6 py-5">
              <div
                class="prose max-w-none {isDark
                  ? 'prose-invert prose-stone'
                  : 'prose-stone'}"
              >
                {@html renderContent(result.content)}
              </div>
            </div>

            <!-- Sources -->
            {#if result.sources && result.sources.length > 0}
              {@const {
                usedSources,
                unusedSources,
                evidenceMap,
                citationOrder,
              } = categorizeSources(result)}
              <div class="px-6 pb-5 space-y-3">
                <!-- Used Sources Section -->
                {#if usedSources.length > 0}
                  <div>
                    <p
                      class="text-xs font-semibold uppercase tracking-wider mb-3 {isDark
                        ? 'text-stone-400'
                        : 'text-stone-600'}"
                    >
                      Evidence Used ({usedSources.length})
                    </p>
                    <div class="space-y-2">
                      {#each usedSources as source}
                        {@const evidence = evidenceMap.get(source.id)}
                        {@const safeId = source.id.replace(
                          /[^a-zA-Z0-9-]/g,
                          "_",
                        )}
                        {@const citationNum = citationOrder.get(source.id)}
                        {@const sepUrl = getSEPUrl(source.id)}
                        <div
                          id="source-{safeId}"
                          class="block p-3 rounded-lg border transition-all {isDark
                            ? 'border-amber-700 bg-amber-950/30'
                            : 'border-amber-200 bg-amber-50/50'}"
                        >
                          <div
                            class="flex items-start justify-between gap-3 mb-2"
                          >
                            <div class="flex-1 min-w-0">
                              <div class="flex items-center gap-2">
                                {#if citationNum !== undefined}
                                  <span
                                    class="inline-flex items-center justify-center w-6 h-6 text-xs font-bold rounded {isDark
                                      ? 'bg-amber-700 text-amber-100'
                                      : 'bg-amber-600 text-white'}"
                                  >
                                    {citationNum}
                                  </span>
                                {/if}
                                <h4
                                  class="font-semibold text-sm {isDark
                                    ? 'text-stone-200'
                                    : 'text-stone-900'}"
                                >
                                  {(source.doc_title ?? "").replace(
                                    /\s+\(Stanford Encyclopedia of Philosophy\)$/,
                                    "",
                                  )}
                                </h4>
                              </div>
                              {#if source.section_heading}
                                <p
                                  class="text-xs mt-1 {isDark
                                    ? 'text-stone-400'
                                    : 'text-stone-600'}"
                                >
                                  § {@html parseTeX(source.section_heading)}
                                </p>
                              {/if}
                            </div>
                            {#if sepUrl}
                              <a
                                href={sepUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="shrink-0 p-1.5 rounded transition-colors {isDark
                                  ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-900/30'
                                  : 'text-amber-600 hover:text-amber-700 hover:bg-amber-100'}"
                                title="View on Stanford Encyclopedia of Philosophy"
                              >
                                <svg
                                  class="w-4 h-4"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                                  />
                                </svg>
                              </a>
                            {/if}
                          </div>
                          {#if evidence}
                            <div class="mb-2">
                              <p
                                class="text-xs font-semibold mb-1 {isDark
                                  ? 'text-amber-400'
                                  : 'text-amber-700'}"
                              >
                                Quote:
                              </p>
                              <div
                                class="text-xs italic {isDark
                                  ? 'text-stone-300'
                                  : 'text-stone-700'}"
                              >
                                "{@html parseTeX(evidence.verbatim_quote)}"
                              </div>
                            </div>
                            <!-- <div class="mb-2">
                              <p
                                class="text-xs font-semibold mb-1 {isDark
                                  ? 'text-amber-400'
                                  : 'text-amber-700'}"
                              >
                                Role:
                              </p>
                              <p
                                class="text-xs {isDark
                                  ? 'text-stone-300'
                                  : 'text-stone-700'}"
                              >
                                {evidence.role_in_answer}
                              </p>
                            </div> -->
                          {/if}
                          <p
                            class="text-xs mt-2 font-mono {isDark
                              ? 'text-stone-500'
                              : 'text-stone-500'}"
                          >
                            {source.id}
                          </p>
                        </div>
                      {/each}
                    </div>
                  </div>
                {/if}

                <!-- Toggle for Unused Sources -->
                {#if unusedSources.length > 0}
                  <div>
                    <button
                      onclick={() => toggleUnusedSources(result.id)}
                      class="w-full text-left text-xs font-semibold uppercase tracking-wider flex items-center gap-2 transition-colors py-2 {isDark
                        ? 'text-stone-400 hover:text-stone-300'
                        : 'text-stone-600 hover:text-stone-700'}"
                    >
                      Show unused sources ({unusedSources.length})
                      <svg
                        class="w-4 h-4 transition-transform {showUnusedSources[
                          result.id
                        ]
                          ? 'rotate-180'
                          : ''}"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </button>

                    <!-- Unused Sources (Collapsed by Default) -->
                    {#if showUnusedSources[result.id]}
                      <div class="space-y-2 mt-2">
                        {#each unusedSources as source}
                          {@const safeId = source.id.replace(
                            /[^a-zA-Z0-9-]/g,
                            "_",
                          )}
                          {@const sepUrl = getSEPUrl(source.id)}
                          <div
                            id="source-{safeId}"
                            class="block p-3 rounded-lg border transition-all {isDark
                              ? 'border-stone-700 bg-stone-800/50'
                              : 'border-stone-200 bg-stone-50/50'}"
                          >
                            <div
                              class="flex items-start justify-between gap-3 mb-2"
                            >
                              <div class="flex-1 min-w-0">
                                <h4
                                  class="font-semibold text-sm {isDark
                                    ? 'text-stone-200'
                                    : 'text-stone-900'}"
                                >
                                  {(source.doc_title ?? "").replace(
                                    /\s+\(Stanford Encyclopedia of Philosophy\)$/,
                                    "",
                                  )}
                                </h4>
                                {#if source.section_heading}
                                  <p
                                    class="text-xs mt-1 {isDark
                                      ? 'text-stone-400'
                                      : 'text-stone-600'}"
                                  >
                                    § {@html parseTeX(source.section_heading)}
                                  </p>
                                {/if}
                              </div>
                              {#if sepUrl}
                                <a
                                  href={sepUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  class="shrink-0 p-1.5 rounded transition-colors {isDark
                                    ? 'text-stone-400 hover:text-stone-300 hover:bg-stone-700'
                                    : 'text-stone-600 hover:text-stone-700 hover:bg-stone-100'}"
                                  title="View on Stanford Encyclopedia of Philosophy"
                                >
                                  <svg
                                    class="w-4 h-4"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      stroke-linecap="round"
                                      stroke-linejoin="round"
                                      stroke-width="2"
                                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                                    />
                                  </svg>
                                </a>
                              {/if}
                            </div>
                            <div
                              class="text-xs line-clamp-3 {isDark
                                ? 'text-stone-400'
                                : 'text-stone-600'}"
                            >
                              {@html parseTeX(source.text)}
                            </div>
                            <p
                              class="text-xs mt-2 font-mono {isDark
                                ? 'text-stone-500'
                                : 'text-stone-500'}"
                            >
                              {source.id}
                            </p>
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
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

  /* Enhanced prose styling for markdown content */
  :global(.prose h2) {
    font-weight: 700;
    margin-top: 1.5em;
    margin-bottom: 0.75em;
    font-size: 1.5em;
    line-height: 1.3;
  }

  :global(.prose h3) {
    font-weight: 600;
    margin-top: 1.25em;
    margin-bottom: 0.5em;
    font-size: 1.25em;
  }

  :global(.prose p) {
    margin-top: 0.75em;
    margin-bottom: 0.75em;
    line-height: 1.7;
  }

  :global(.prose code) {
    font-size: 0.875em;
    padding: 0.125em 0.25em;
    border-radius: 0.25em;
    font-family: ui-monospace, monospace;
  }

  :global(.prose pre) {
    margin-top: 1em;
    margin-bottom: 1em;
    padding: 1em;
    border-radius: 0.5em;
    overflow-x: auto;
    font-size: 0.875em;
    line-height: 1.5;
  }

  :global(.prose pre code) {
    padding: 0;
    background-color: transparent;
  }

  :global(.prose ul, .prose ol) {
    margin-top: 0.75em;
    margin-bottom: 0.75em;
    padding-left: 1.5em;
  }

  :global(.prose li) {
    margin-top: 0.25em;
    margin-bottom: 0.25em;
  }

  :global(.prose strong) {
    font-weight: 600;
  }

  :global(.prose a) {
    text-decoration: underline;
    font-weight: 500;
  }

  :global(.prose blockquote) {
    border-left: 3px solid;
    padding-left: 1em;
    font-style: italic;
    margin: 1em 0;
  }

  /* Citation link styling */
  :global(.citation) {
    display: inline-block;
    font-size: 0.75em;
    font-weight: 600;
    color: #d97706;
    background-color: rgba(217, 119, 6, 0.1);
    border: 1px solid rgba(217, 119, 6, 0.3);
    border-radius: 0.25rem;
    padding: 0.1em 0.35em;
    margin: 0 0.15em;
    text-decoration: none;
    vertical-align: super;
    line-height: 1;
    transition: all 0.2s ease;
    cursor: pointer;
  }

  :global(.citation:hover) {
    background-color: rgba(217, 119, 6, 0.2);
    border-color: rgba(217, 119, 6, 0.5);
    transform: translateY(-1px);
  }

  :global(.citation.unsupported) {
    color: #dc2626;
    background-color: rgba(220, 38, 38, 0.1);
    border: 1px solid rgba(220, 38, 38, 0.3);
    cursor: help;
    font-style: italic;
  }

  :global(.citation.unsupported:hover) {
    background-color: rgba(220, 38, 38, 0.2);
    border-color: rgba(220, 38, 38, 0.5);
  }

  /* Highlight effect for scrolled-to sources */
  @keyframes highlight-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(217, 119, 6, 0);
    }
    50% {
      box-shadow: 0 0 0 8px rgba(217, 119, 6, 0.3);
    }
  }

  :global(.highlight-source) {
    animation: highlight-pulse 1s ease-in-out 2;
  }
</style>
