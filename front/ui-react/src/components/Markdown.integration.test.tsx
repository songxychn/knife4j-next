import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Markdown from './Markdown';
import LegacyMarkdown from '../compoents/Markdown';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

// Exercise both existing entry points with real React, marked and DOMPurify.
// These are policy-preservation tests, not claims of a vulnerability in 3.4.16.
describe.each([
  ['current', Markdown],
  ['legacy', LegacyMarkdown],
] as const)('%s Markdown sanitization', (_name, Component) => {
  async function render(source: string) {
    await act(async () => root.render(<Component source={source} />));
  }

  test.each([
    ['heading', '> # heading'],
    ['setext heading', '> setext heading\n> ---'],
    ['thematic break', '> ***'],
    ['HTML block', '> <div></div>'],
    ['comment', '> <!-- comment -->'],
  ])('ends the blockquote before a plain line after a %s', async (_label, quotedBlock) => {
    await render(`${quotedBlock}\nnot quoted`);
    const content = container.firstElementChild;
    expect(content?.querySelector('blockquote')).not.toBeNull();
    expect(content?.querySelector('blockquote')?.textContent).not.toContain('not quoted');
    expect(content?.lastElementChild?.tagName).toBe('P');
    expect(content?.lastElementChild?.textContent).toBe('not quoted');
  });

  test('keeps lazy continuation of a quoted paragraph inside the blockquote', async () => {
    await render('> quoted paragraph\ncontinued');
    const content = container.firstElementChild;
    expect(content?.children).toHaveLength(1);
    expect(content?.firstElementChild?.tagName).toBe('BLOCKQUOTE');
    expect(content?.querySelector('blockquote p')?.textContent).toBe('quoted paragraph\ncontinued');
  });

  test('ends a blockquote after a whitespace-only quoted line', async () => {
    await render('> a\n>  \nb');
    const content = container.firstElementChild;
    expect(Array.from(content?.children ?? [], (element) => element.tagName)).toEqual(['BLOCKQUOTE', 'P']);
    expect(content?.querySelector('blockquote')?.textContent?.trim()).toBe('a');
    expect(content?.lastElementChild?.textContent).toBe('b');
  });

  test('keeps lazy list continuation inside nested blockquotes', async () => {
    await render('> > - a\n> b\nc');
    const content = container.firstElementChild;
    expect(content?.children).toHaveLength(1);
    expect(content?.querySelector('blockquote blockquote li')?.textContent).toBe('a\nb\nc');
  });

  test('renders nested emphasis in image alt text as plain text', async () => {
    await render('![**a *b***](image.png)');
    expect(container.querySelector('img')?.getAttribute('src')).toBe('image.png');
    expect(container.querySelector('img')?.alt).toBe('a b');
  });

  test('preserves ordinary Markdown, safe links, images and inline attributes', async () => {
    await render(
      [
        '# API reference',
        '',
        '| Name | Value |',
        '| --- | --- |',
        '| greeting | hello |',
        '',
        '[Documentation](https://example.test/docs?q=1#intro "Docs")',
        '',
        '![Diagram](/diagram.png "Diagram")',
        '',
        '<span class="note" data-note="kept" aria-label="note">inline</span>',
        '',
        '```html',
        '<script>alert("shown as code")</script>',
        '```',
      ].join('\n'),
    );
    expect(container.querySelector('h1')?.textContent).toBe('API reference');
    expect(container.querySelector('tbody tr')?.textContent).toContain('greeting');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.test/docs?q=1#intro');
    expect(container.querySelector('a')?.title).toBe('Docs');
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/diagram.png');
    expect(container.querySelector('img')?.alt).toBe('Diagram');
    expect(container.querySelector('.note')?.getAttribute('data-note')).toBe('kept');
    expect(container.querySelector('.note')?.getAttribute('aria-label')).toBe('note');
    expect(container.querySelector('pre code')?.textContent).toContain('<script>alert("shown as code")</script>');
    expect(container.querySelector('script')).toBeNull();
  });

  test('removes executable elements, handlers and dangerous URL protocols', async () => {
    await render(
      [
        '<script>alert(1)</script><iframe src="https://example.test/frame"></iframe><object data="/payload"></object>',
        '<img src="/missing.png" onerror="alert(1)">',
        '<a href="jav&#x61;script:alert(1)" onclick="alert(1)">unsafe link</a>',
        '<a href="data:text/html,boom">unsafe data link</a>',
        '<a href="/relative#safe">safe relative link</a>',
      ].join('\n'),
    );
    expect(container.querySelector('script, iframe, object, [onerror], [onclick]')).toBeNull();
    const links = Array.from(container.querySelectorAll('a'));
    expect(links).toHaveLength(3);
    expect(links[0].hasAttribute('href')).toBe(false);
    expect(links[1].hasAttribute('href')).toBe(false);
    expect(links[2].getAttribute('href')).toBe('/relative#safe');
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/missing.png');
  });

  test('preserves safe SVG and MathML while removing executable foreign content', async () => {
    await render(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="10" height="10"/><script>alert(1)</script><a xlink:href="javascript:alert(1)"><text>vector</text></a></svg>',
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi><mo>+</mo><mn>1</mn></math>',
      ].join('\n'),
    );
    expect(container.querySelector('svg')?.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(container.querySelector('svg rect')?.getAttribute('width')).toBe('10');
    expect(container.querySelector('svg text')?.textContent).toBe('vector');
    expect(container.querySelector('svg a')?.hasAttribute('xlink:href')).toBe(false);
    expect(container.querySelector('math')?.namespaceURI).toBe('http://www.w3.org/1998/Math/MathML');
    expect(container.querySelector('math')?.textContent).toBe('x+1');
    expect(container.querySelector('script, [onload]')).toBeNull();
  });

  test('keeps default template text and replaces previous content without stale HTML', async () => {
    await render('<p>{{name}} ${value}</p>');
    expect(container.textContent).toBe('{{name}} ${value}');
    await render('<img src="/new.png" onerror="alert(1)"><strong>updated</strong>');
    expect(container.textContent).toBe('updated\n');
    expect(container.querySelector('[onerror]')).toBeNull();
    await render('');
    expect(container.textContent).toBe('');
    expect(container.querySelector('img, strong')).toBeNull();
  });

  test('keeps default Markdown soft line breaks', async () => {
    await render('first\nsecond');
    expect(container.querySelector('br')).toBeNull();
    expect(container.textContent).toContain('first\nsecond');
  });
});

test('retains the current component explicit line-break option across rerenders', async () => {
  await act(async () => root.render(<Markdown source={'first\nsecond'} preserveLineBreaks />));
  expect(container.querySelectorAll('br')).toHaveLength(1);
  await act(async () => root.render(<Markdown source={'first\nsecond'} preserveLineBreaks={false} />));
  expect(container.querySelector('br')).toBeNull();
});
