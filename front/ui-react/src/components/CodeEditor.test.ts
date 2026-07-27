import { describe, expect, test } from 'vitest';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';

describe('CodeEditor language extensions', () => {
  test.each([
    ['JSON', json()],
    ['XML', xml()],
  ])('%s loads with the shared EditorState', (_name, language) => {
    expect(() => EditorState.create({ doc: '', extensions: [language] })).not.toThrow();
  });
});
