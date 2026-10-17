import { describe, expect, it } from 'vitest';

import { parseMarkdown } from './markdown';

describe('parseMarkdown', () => {
  it('returns HTML synchronously and keeps empty input empty', () => {
    expect(parseMarkdown('')).toBe('');
    expect(parseMarkdown('**text**')).toBe('<p><strong>text</strong></p>\n');
  });

  it('preserves explicit line breaks when requested', () => {
    expect(parseMarkdown('第一行\n第二行', { preserveLineBreaks: true })).toContain('<br');
  });

  it('keeps default Markdown soft line break behavior', () => {
    expect(parseMarkdown('第一行\n第二行')).not.toContain('<br');
  });
});
