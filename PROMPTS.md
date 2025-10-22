```
Write a TypeScript function using Cheerio to accept a HTML string as input and search for list elements within it (ul, ol). Then, unordered lists should be converted to text, e.g.
- apple
- banana
- cherry

And ordered lists should be converted to the appropriate format, e.g.
1. United States
2. China
3. Germany

Pay attention to `reversed`, `start`, and `type` attributes for `ol` elements. The text lists should be enclosed in <pre> tags. The rest of the HTML should remain unchanged.
```

```
Update the code to handle nested lists (as in the example_text) properly
```

```
Read carefully through this script. Add a semantic chunking function to accept a section (after appropriate preprocessing), tokenise it, and split it into chunks no longer than 1024 tokens each. Each chunk should contain as many paragraphs as possible up to 1024 tokens, without exceeding that number. Think carefully and step-by-step about how to detect paragraphs, and how to handle tables, lists, and TeX.
```

```
From each SEP article, I need to obtain chunks in two formats:
(1) fully cleaned and normalised, for vectorisation and retrieval
(2) processed to remove anything unnecessary, but in a format suitable for sending to an LLM for the RAG generation step, and for displaying to the user.

Reflecting on the current pipeline, make changes to create these two formats. Think carefully about retrieval and generation - consider best practices for each, e.g. table source HTML vs natural-language description, presence or absence of text markers, TeX, etc. - anything relevant that should be different between the two formats
```

```
Implement this flow:

1. split text by tag e.g. p, table, ul, ol, etc., thus creating a list of "items"
2. process each item into both retrieval and generation formats - these are now your lists of semantic units
3. chunk based on the retrieval format, without splitting units - apply same chunking to generation format

Decompose the implementation task into manageable steps, and attempt one step at a time
```

```
Look at the example of a figure taken from the SEP HTML source. The current implementation won't handle it properly. Update the following:

(1) when fetching the article, look for figures and links to an extended figure description page. the extended descriptions are typically all on one page, with a section for each. figures in an article may have both a short caption and a link to an extended description, or just a caption, or just a link. always prefer the extended description if present, then fall back to the short caption, then fall back to alt text. update figures in the saved html to store only a caption/description, but in a structured html-ish format compatible with the rest of the script
(2) update existing functions to correctly handle figures
```

```
Read this script carefully. So far, it manages preprocessing and chunking as part of a RAG system for the SEP. The intended data pipeline is:

1. fetch all articles (one-time) / fetch new or updated articles (ongoing, cron)
2. vectorise chunks (dense & sparse)
3. store vectors and chunk text + metadata

Look closely at the script. Without changing any of the functionality, tidy up the code where possible to improve readability, maintainability, and performance (where applicable). Don't make unnecessary changes.

Before you start making changes, clearly set out exactly what it is that you will modify, perhaps using todos. Stick to this list while making changes.
```

```
Create a single-page static site (connecting to external API) for an unofficial RAG system for the Stanford Encyclopedia of Philosophy. Use TypeScript, Tailwind, and Tailwind Typography (https://raw.githubusercontent.com/tailwindlabs/tailwindcss-typography/refs/heads/main/README.md) where relevant. Adopt a clean, classy, stylish design with serif or slab serif fonts. The site is called SEP Oracle. Use placeholders for the API calls for now.
```

```
Add a dark theme with a toggle (set initial state based on default browser preference, save chosen state in localStorage)
```

```
Write a function for embedding text (array of strings) using the following info:

curl example: ...
input schema: ...
output schema: ...
```

```
Add functions for reranking chunks against a query using `@cf/baai/bge-reranker-base`, based on the following info:

curl example: ...
input schema: ...
output schema: ...
```

```
Move functions in this file to new modules in ./lib
```

```
I have added a single document (56 chunks) to Vectorize. Could you update the backend to add an express endpoint to handle search?

Here are the steps for search:
1. query Vectorize and get top 50 chunks
2. search D1 with BM25 (FTS5 extension) - top 50 chunks
3. dedupe, unify top-K from both with RRF and rerank using bge-reranker-base

I'll work on the remaining steps once you've completed the above.
```

```
Add a function to get the immediate neighbours (+- 1) of a chunk, but only from the same section.
If a section has only one chunk, return an empty list. If a section has two chunks, return the only neighbour of the chunk.
If the chunk is the first in its section, attempt to fetch n+1 and n+2. If it's the last, try n-2 and n-1. Otherwise, n-1 and n+1.
```