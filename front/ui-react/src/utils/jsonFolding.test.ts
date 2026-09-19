import { describe, expect, test } from 'vitest';
import { EditorState } from '@codemirror/state';
import { codeFolding, foldedRanges, foldable, foldService } from '@codemirror/language';
import { prepareJsonDocument, firstLevelFoldEffects, foldableJsonLanguage } from './jsonFolding';

describe('shared JSON display folding', () => {
  test('formats compact JSON without rounding numbers, removing duplicate keys or changing escapes', () => {
    const raw = String.raw`{"n":9007199254740993,"n":1e400,"negative":-0,"escaped":"\u0061\n\"{}[],:","array":[{"ok":true},null,{}]}`;
    const model = prepareJsonDocument(raw);
    expect(model.valid).toBe(true);
    expect(model.text).toContain('9007199254740993');
    expect(model.text).toContain('"n": 1e400');
    expect(model.text).toContain('"negative": -0');
    expect(model.text).toContain(String.raw`"escaped": "\u0061\n\"{}[],:"`);
    expect(model.text.match(/"n":/g)).toHaveLength(2);
    expect(model.folds.map(({ depth }) => depth)).toEqual([0, 1, 2]);
    expect(JSON.parse(model.text)).toEqual(JSON.parse(raw));
  });

  test.each([
    '',
    ' ',
    '{"x":',
    '{"x":1,}',
    '[1,2',
    '{"x":01}',
    'true false',
    'NaN',
    '/* comment */{}',
    '"line\nbreak"',
  ])('preserves invalid JSON: %s', (raw) => {
    expect(prepareJsonDocument(raw)).toEqual({ text: raw, valid: false, folds: [] });
  });

  test.each(['null', 'true', '42', '"hello"', '{}', '[]', '{\n}', '[\n]'])(
    'no fold range for scalar or empty container: %s',
    (raw) => {
      expect(prepareJsonDocument(raw).folds).toEqual([]);
      expect(prepareJsonDocument(raw, true).folds).toEqual([]);
    },
  );

  test('preserves serialized text including CRLF, tabs, large numbers and spacing', () => {
    const raw = '{\r\n\t"items" : [\r\n\t\t{ "id": 9007199254740993 }\r\n\t]\r\n}\r\n';
    const model = prepareJsonDocument(raw, true);
    expect(model.text).toBe(raw);
    expect(model.folds.map(({ depth }) => depth)).toEqual([0, 1]);
    let state = EditorState.create({
      doc: model.text,
      extensions: [EditorState.lineSeparator.of('\n'), codeFolding()],
    });
    state = state.update({ effects: firstLevelFoldEffects(state, model.folds) }).state;
    expect(state.doc.toString()).toBe(raw);
    foldedRanges(state).between(0, state.doc.length, (from, to) => {
      expect(state.doc.sliceString(from - 1, from)).toBe('[');
      expect(state.doc.sliceString(to, to + 1)).toBe(']');
    });
  });

  test.each(['{\n}', '[\n]', '{\r\n\t}'])('language fallback offers no fold for empty wire JSON: %s', (raw) => {
    const model = prepareJsonDocument(raw, true);
    const state = EditorState.create({
      doc: model.text,
      extensions: [
        EditorState.lineSeparator.of('\n'),
        foldableJsonLanguage,
        foldService.of((_state, from) => model.folds.find((range) => range.lineStart === from) ?? null),
      ],
    });
    expect(foldable(state, 0, state.doc.line(1).to)).toBeNull();
  });

  test('editable JSON language still folds non-empty containers', () => {
    const state = EditorState.create({ doc: '{\n  "items": [\n    1\n  ]\n}', extensions: [foldableJsonLanguage] });
    expect(foldable(state, 0, state.doc.line(1).to)).not.toBeNull();
    const line = state.doc.line(2);
    expect(foldable(state, line.from, line.to)).not.toBeNull();
  });

  test('keeps a compact wire representation untouched', () => {
    const raw = '{"nested":{"values":[1,2]}}';
    expect(prepareJsonDocument(raw, true)).toEqual({ text: raw, valid: true, folds: [] });
    expect(prepareJsonDocument(raw).folds.map(({ depth }) => depth)).toEqual([0, 1, 2]);
  });

  test('folds large and deeply nested examples through the last node', () => {
    const model = prepareJsonDocument(
      JSON.stringify({ items: Array.from({ length: 5000 }, (_, id) => ({ id })), tail: { ok: true } }),
    );
    expect(model.folds).toHaveLength(5003);
    expect(model.text.slice(model.folds.at(-1)!.from, model.folds.at(-1)!.to)).toContain('"ok": true');
    expect(prepareJsonDocument('['.repeat(150) + '0' + ']'.repeat(150)).folds).toHaveLength(150);
  });
});
