/** Text projection only: never insert formula-generated HTML or load its assets. */
import katex from 'katex';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { safeKatexOptions } from '@openmaic/dsl';
import { requireContent } from '../content/model';
type Node = DefaultTreeAdapterMap['node'];
export function formulaText(value: unknown): string {
  requireContent(
    typeof value === 'string' && value.trim().length > 0 && value.isWellFormed(),
    'UNSUPPORTED_GENERATED_FORMULA',
    409,
  );
  requireContent(value.length <= 16000, 'GENERATED_PAGE_TOO_LONG', 409);
  const plain = (s: string) =>
    s
      .replace(/[<>&]/g, (c) => ({ '<': '＜', '>': '＞', '&': '＆' })[c]!)
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '')
      .trim();
  try {
    const math = katex.renderToString(
      value,
      safeKatexOptions({ output: 'mathml', throwOnError: true, strict: 'error' }),
    );
    let visited = 0;
    const read = (n: Node): string => {
      if (++visited > 10000) throw Error('Formula too complex');
      if (n.nodeName === '#text') return (n as DefaultTreeAdapterMap['textNode']).value;
      const children =
        'childNodes' in n ? n.childNodes.filter((x) => x.nodeName !== 'annotation') : [];
      const values = () => children.map(read);
      switch (n.nodeName) {
        case '#document-fragment':
        case 'span':
        case 'math':
        case 'semantics':
        case 'mrow':
        case 'mstyle':
        case 'mi':
        case 'mn':
        case 'mo':
        case 'mtext':
        case 'mpadded':
        case 'mphantom':
          // Phantom content is not visible and must not become a new formula term.
          return n.nodeName === 'mphantom' ? '' : values().join('');
        case 'mspace':
          return ' ';
        case 'mfrac': {
          const [a, b] = values();
          return `(${a}) / (${b})`;
        }
        case 'msup': {
          const [a, b] = values();
          return `(${a})^(${b})`;
        }
        case 'msub': {
          const [a, b] = values();
          return `(${a})_(${b})`;
        }
        case 'msubsup': {
          const [a, b, c] = values();
          return `(${a})_(${b})^(${c})`;
        }
        case 'msqrt':
          return `√(${values().join('')})`;
        case 'mroot': {
          const [a, b] = values();
          return `root(${b}, ${a})`;
        }
        // Never flatten unfamiliar operators into a mathematically different expression.
        default:
          throw Error('Keep original notation');
      }
    };
    const result = plain(read(parseFragment(math)));
    if (result) return result;
  } catch {
    /* Unsupported syntax remains visible as literal text, never evaluated. */
  }
  return `[LaTeX 原式] ${plain(value)}`;
}
