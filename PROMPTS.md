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