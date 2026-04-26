import { memo, useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

interface MarkdownProps {
  source: string;
}

const Markdown = memo(({ source }: MarkdownProps) => {
  const html = useMemo(() => {
    if (!source) return '';
    const rawHtml = marked.parse(source, { async: false }) as string;
    return DOMPurify.sanitize(rawHtml);
  }, [source]);

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
});

Markdown.displayName = 'Markdown';

export default Markdown;
