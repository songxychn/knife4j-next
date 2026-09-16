import { describe, expect, test } from 'vitest';
import { EditorState } from '@codemirror/state';
import { codeFolding, foldedRanges, foldEffect, unfoldEffect } from '@codemirror/language';
import { firstLevelFoldEffects, prepareResponseJson } from './responseJsonFolding';

function ranges(state: EditorState) {
  const result: Array<{ from: number; to: number }> = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => result.push({ from, to }));
  return result.sort((a, b) => a.from - b.from);
}

describe('JSON response folding', () => {
  test('opens the root and folds every non-empty nested object and array, ignoring braces in strings', () => {
    const model = prepareResponseJson(
      JSON.stringify({ code: 200, data: { name: '[{}]"', child: { id: 1 } }, items: [{ id: 2 }], empty: {} }),
    );
    let state = EditorState.create({ doc: model.text, extensions: codeFolding() });
    state = state.update({ effects: firstLevelFoldEffects(state, model.folds) }).state;
    expect(model.folds.map((range) => range.depth)).toEqual([0, 1, 2, 1, 2]);
    expect(ranges(state)).toEqual(model.folds.slice(1).map(({ from, to }) => ({ from, to })));
    expect(model.folds.map((range) => model.text.slice(range.from - 1, range.from))).toEqual(['{', '{', '{', '[', '{']);

    // Opening a parent retains independently folded grandchildren.
    state = state.update({ effects: unfoldEffect.of(model.folds[1]) }).state;
    expect(ranges(state)).toHaveLength(3);
    expect(ranges(state)).toContainEqual({ from: model.folds[2].from, to: model.folds[2].to });
  });

  test('collapse to first level is idempotent and reopens a manually folded root', () => {
    const model = prepareResponseJson('{"data":{"items":[{"id":1}]}}');
    let state = EditorState.create({ doc: model.text, extensions: codeFolding() });
    state = state.update({ effects: firstLevelFoldEffects(state, model.folds) }).state;
    const expected = ranges(state);
    state = state.update({ effects: firstLevelFoldEffects(state, model.folds) }).state;
    expect(ranges(state)).toEqual(expected);
    state = state.update({ effects: foldEffect.of(model.folds[0]) }).state;
    state = state.update({ effects: firstLevelFoldEffects(state, model.folds) }).state;
    expect(ranges(state)).toEqual(expected);
  });

  test('top-level arrays keep their root open and allow separate item folding', () => {
    const model = prepareResponseJson('[{"id":1},[1,2],{},[],null]');
    expect(model.folds.map((range) => range.depth)).toEqual([0, 1, 1]);
  });

  test.each(['{}', '[]', 'null', '42', 'true', '"hello"'])('scalar or empty %s needs no folding controls', (raw) => {
    expect(prepareResponseJson(raw)).toMatchObject({ valid: true, folds: [] });
  });

  test.each(['', '{"data":', '{"x":1,}', '[1,2', '<html>error</html>'])('invalid JSON remains intact: %s', (raw) => {
    expect(prepareResponseJson(raw)).toEqual({ text: raw, valid: false, folds: [] });
  });

  test('folds include the end of a large document and deeply nested containers', () => {
    const items = Array.from({ length: 5000 }, (_, id) => ({ id, nested: { value: 'x' } }));
    const model = prepareResponseJson(JSON.stringify({ items, tail: { found: true } }));
    expect(model.folds).toHaveLength(10003);
    expect(model.folds.at(-1)?.depth).toBe(1);
    expect(model.text.slice(model.folds.at(-1)!.from, model.folds.at(-1)!.to)).toContain('"found": true');
    const deep = prepareResponseJson('['.repeat(150) + '0' + ']'.repeat(150));
    expect(deep.folds).toHaveLength(150);
    expect(deep.folds.at(-1)?.depth).toBe(149);
  });
});
