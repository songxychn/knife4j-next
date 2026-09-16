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

export interface ResponseJsonDocument {
  readonly text: string;
  readonly valid: boolean;
  readonly folds: readonly JsonFoldRange[];
}

/** Preserve the response panel's formatting and invalid-JSON fallback. */
export function prepareResponseJson(raw: string): ResponseJsonDocument {
  let text: string;
  try {
    text = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return { text: raw, valid: false, folds: [] };
  }

  // Build complete fold ranges once, independently of the editor's incremental
  // viewport parser. Initial folding must also cover nodes outside the viewport.
  const folds: JsonFoldRange[] = [];
  let depth = -1;
  jsonLanguage.parser.parse(text).iterate({
    enter(node) {
      if (node.name !== 'Object' && node.name !== 'Array') return;
      depth++;
      if (text.indexOf('\n', node.from) < node.to && text.indexOf('\n', node.from) !== -1) {
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
