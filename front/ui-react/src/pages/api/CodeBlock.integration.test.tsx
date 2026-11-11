import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import CodeBlock from './CodeBlock';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
it.each([
  ['javascript', 'const value = 42;', '.hljs-keyword'],
  ['typescript', 'const value: number = 42;', '.hljs-keyword'],
  ['xml', '<root value="42">text</root>', '.hljs-tag'],
])('preserves %s code text and highlighting after language registration', async (language, code, token) => {
  await act(async () => root.render(<CodeBlock language={language} code={code} />));
  expect(container.querySelector('code')?.textContent).toBe(code);
  expect(container.querySelector(token)).not.toBeNull();
});
it('renders unsupported language content as text without interpreting markup', async () => {
  const code = '<script>alert("example")</script>&';
  await act(async () => root.render(<CodeBlock language="not-a-language" code={code} onCopy={() => {}} />));
  expect(container.querySelector('code')?.textContent).toBe(code);
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('button')?.getAttribute('aria-label')).toBeTruthy();
});
