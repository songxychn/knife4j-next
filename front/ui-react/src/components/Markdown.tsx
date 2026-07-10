import { memo, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { parseMarkdown } from '../utils/markdown';

interface MarkdownProps {
  source: string;
  preserveLineBreaks?: boolean;
}

const Markdown = memo(({ source, preserveLineBreaks = false }: MarkdownProps) => {
  const html = useMemo(() => {
    const rawHtml = parseMarkdown(source, { preserveLineBreaks });
    return DOMPurify.sanitize(rawHtml);
  }, [preserveLineBreaks, source]);

  return <div className="knife4j-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
});

Markdown.displayName = 'Markdown';

export default Markdown;
