import { jsonLanguage } from '@codemirror/lang-json';
import { EditorState } from '@codemirror/state';
import { foldEffect, foldedRanges, unfoldEffect } from '@codemirror/language';

export interface JsonFoldRange {
  readonly from: number;
  readonly to: number;
  readonly lineStart: number;
  /** The root container has depth zero. */
  readonly depth: number;
}

export interface JsonDocument {
  readonly text: string;
  readonly valid: boolean;
  readonly folds: readonly JsonFoldRange[];
}

/** Reindent valid JSON without parsing values into JavaScript numbers or objects. */
function formatJsonText(raw: string): string {
  const tokens = raw.match(/"(?:\\.|[^"\\])*"|[{}[\],:]|[^\s{}[\],:]+/g) ?? [];
  let depth = 0;
  let text = '';
  const newline = () => '\n' + '  '.repeat(depth);
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === '{' || token === '[') {
      text += token;
      if (tokens[index + 1] === (token === '{' ? '}' : ']')) {
        text += tokens[++index];
      } else {
        depth++;
        text += newline();
      }
    } else if (token === '}' || token === ']') {
      depth--;
      text += newline() + token;
    } else if (token === ',') {
      text += token + newline();
    } else if (token === ':') {
      text += ': ';
    } else {
      text += token;
    }
  }
  return text;
}

/** Validate syntax and derive fold ranges, optionally preserving every authored character. */
export function prepareJsonDocument(raw: string, preserveText = false): JsonDocument {
  const tree = jsonLanguage.parser.parse(raw);
  let valid = tree.topNode.firstChild !== null;
  tree.iterate({
    enter: (node) => {
      if (node.type.isError) valid = false;
    },
  });
  if (!valid) return { text: raw, valid: false, folds: [] };
  const text = preserveText ? raw : formatJsonText(raw);
  // Build complete fold ranges once, independently of the editor's incremental
  // viewport parser. Initial folding must also cover nodes outside the viewport.
  const folds: JsonFoldRange[] = [];
  let depth = -1;
  jsonLanguage.parser.parse(text).iterate({
    enter(node) {
      if (node.name !== 'Object' && node.name !== 'Array') return;
      depth++;
      const content = node.node.firstChild?.nextSibling;
      const newline = text.indexOf('\n', node.from);
      if (content && content.name !== '}' && content.name !== ']' && newline !== -1 && newline < node.to) {
        folds.push({
          from: node.from + 1,
          to: node.to - 1,
          lineStart: text.lastIndexOf('\n', node.from) + 1,
          depth,
        });
      }
    },
    leave(node) {
      if (node.name === 'Object' || node.name === 'Array') depth--;
    },
  });
  return { text, valid: true, folds };
}

/** Open the root and keep all nested containers folded. Safe to repeat. */
export function firstLevelFoldEffects(state: EditorState, folds: readonly JsonFoldRange[]) {
  const effects = [];
  const nested = folds.filter((range) => range.depth > 0);
  const desired = new Set(nested.map((range) => `${range.from}:${range.to}`));
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    if (!desired.has(`${from}:${to}`)) effects.push(unfoldEffect.of({ from, to }));
  });
  for (const range of nested) effects.push(foldEffect.of(range));
  return effects;
}
