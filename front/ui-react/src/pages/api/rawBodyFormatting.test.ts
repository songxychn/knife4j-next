import { describe, expect, it } from 'vitest';
import { formatBodyByRawMode } from './rawBodyFormatting';

describe('raw request body formatting', () => {
  it.each([
    ['const re = /a{2}/; return re.test("aa");', true],
    ['function f(){ return\n{value: 1}; } return f();', undefined],
    ['let a = 1; let b = 2; a\n++b; return [a,b];', [1, 3]],
    ['return `a${/a{2}/.test("aa") ? `{x}` : ""}`;', 'a{x}'],
  ])('preserves JavaScript meaning for %s', async (body, result) => {
    const input = `function run() { ${body} }`;
    const formatted = await formatBodyByRawMode(input, 'javascript');
    expect(formatted).toBeTypeOf('string');
    expect(new Function(`${formatted}\nreturn run();`)()).toEqual(result);
  });

  it('rejects malformed JavaScript', async () => {
    expect(await formatBodyByRawMode('const = ;', 'javascript')).toBeUndefined();
  });

  it('preserves JSON number precision and duplicate properties', async () => {
    const formatted = await formatBodyByRawMode(
      String.raw`{"id":9007199254740993,"id":1e400,"negative":-0,"escaped":"\u0061"}`,
      'json',
    );
    expect(formatted).toContain('9007199254740993');
    expect(formatted).toContain('1e400');
    expect(formatted).toContain('-0');
    expect(formatted).toContain(String.raw`"\u0061"`);
    expect(formatted?.match(/"id"/g)).toHaveLength(2);
  });

  it.each(['{"id":1,}', '{/*comment*/"id":1}', '', '{broken}'])('rejects invalid JSON %s', async (body) => {
    expect(await formatBodyByRawMode(body, 'json')).toBeUndefined();
  });

  it.each([
    ['xml', '<root xml:space="preserve"> a </root>'],
    ['xml', '<root>before <em>inside</em> after</root>'],
    ['xml', '<root title="a > b"><![CDATA[a < b]]></root>'],
    ['html', '<pre> a\n b </pre><script>if (a < b) run();</script>'],
    ['html', '<span>before </span><span>after</span>'],
    ['text', ' arbitrary text '],
  ] as const)('leaves %s request data intact when safe formatting is unavailable', async (mode, body) => {
    expect(await formatBodyByRawMode(body, mode)).toBeUndefined();
  });
});
