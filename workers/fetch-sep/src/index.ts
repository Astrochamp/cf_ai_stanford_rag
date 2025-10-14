import texToUnicodeMap from './tex-unicode-map.json';

const texMap = texToUnicodeMap as Record<string, string>;
const texSymbolRegex = /\\([a-zA-Z]+)/g;
const remainingTexRegex = /\\/;
const mathExpressionRegex = /(?:\\\(|\\\[)(.*?)(?:\\\)|\\\])/g;

const EXCLUDED_COMMANDS = new Set([
  'sum', 'int', 'prod', 'lim', 'bigcup', 'bigcap', // operators
  'frac', 'sqrt',                                  // fractions, roots
  'hat', 'bar', 'vec', 'dot', 'tilde',             // accents
  'mathbb', 'mathcal', 'mathbf', 'mathrm',         // fonts
  'left', 'right', 'begin', 'end'                  // structural
]);

function processTex(text: string): string {
  return text.replace(mathExpressionRegex, (originalMatch, content) => {

    const firstPassContent = content.replace(texSymbolRegex, (match: string, command: string) => {
      if (EXCLUDED_COMMANDS.has(command) || !texMap[command]) {
        return match; // keep complex commands e.g \frac, \sum
      }
      return texMap[command]; // replace simple symbols
    });

    // clean up braces and loose backslashes
    const processedContent = firstPassContent.replace("\\{", "{").replace("\\}", "}").replace(/\s+\\\s+/g, ' ');

    if (remainingTexRegex.test(processedContent)) {
      const startDelimiter = originalMatch.slice(0, 2); // e.g., "\(" or "\["
      const endDelimiter = originalMatch.slice(-2);
      return `${startDelimiter}${processedContent}${endDelimiter}`;
    } else {
      return processedContent.replace(/\\/g, ''); // remove any remaining backslashes
    }
  });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    return new Response('Hello World!');
  },
} satisfies ExportedHandler<Env>;
