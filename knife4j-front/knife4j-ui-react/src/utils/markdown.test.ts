import { describe, expect, it } from 'vitest';

import { parseMarkdown } from './markdown';

describe('parseMarkdown', () => {
  it('preserves explicit line breaks when requested', () => {
    expect(parseMarkdown('第一行\n第二行', { preserveLineBreaks: true })).toContain('<br');
  });

  it('keeps default Markdown soft line break behavior', () => {
    expect(parseMarkdown('第一行\n第二行')).not.toContain('<br');
  });
});
