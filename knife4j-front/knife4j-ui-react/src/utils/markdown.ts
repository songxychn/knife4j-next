import { marked } from 'marked';

export interface MarkdownRenderOptions {
  preserveLineBreaks?: boolean;
}

export function parseMarkdown(source: string, options: MarkdownRenderOptions = {}): string {
  if (!source) return '';
  return marked.parse(source, { async: false, breaks: options.preserveLineBreaks ?? false }) as string;
}
