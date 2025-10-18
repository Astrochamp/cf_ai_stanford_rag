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