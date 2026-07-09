import { describe, expect, it } from 'vitest';
import { normalizeOperationAuthors, operationAuthors } from './operationAuthor';

describe('operation author formatting', () => {
  it('splits comma-joined x-author values and trims empty entries', () => {
    expect(normalizeOperationAuthors(' Alice, Bob ,, Carol ')).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('keeps a single non-empty author value', () => {
    expect(operationAuthors({ 'x-author': '张三' })).toEqual(['张三']);
  });

  it('ignores blank or unsupported x-author values', () => {
    expect(normalizeOperationAuthors('   ')).toEqual([]);
    expect(normalizeOperationAuthors(['Alice'])).toEqual([]);
    expect(normalizeOperationAuthors({ name: 'Alice' })).toEqual([]);
    expect(operationAuthors(undefined)).toEqual([]);
  });
});
