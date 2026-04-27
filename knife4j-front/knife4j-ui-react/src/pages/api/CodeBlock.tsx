import { useMemo } from 'react';
import { Button } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
// Use the full highlight.js bundle (includes all languages) for simplicity.
// Tree-shaking via lib/core sub-path is not needed at this scale.
import hljs from 'highlight.js';

interface CodeBlockProps {
  /** Pre-formatted code string to display */
  code: string;
  language?: string;
  /** Called when the copy button is clicked */
  onCopy?: () => void;
  maxHeight?: number | string;
}

/**
 * Unified syntax-highlighted code block used for request/response examples.
 * Uses highlight.js so all example panels share the same visual style and
 * avoid horizontal overflow.
 */
export default function CodeBlock({ code, language = 'json', onCopy, maxHeight = 400 }: CodeBlockProps) {
  const highlighted = useMemo(() => {
    try {
      return hljs.highlight(code, { language }).value;
    } catch {
      return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }, [code, language]);

  return (
    <div style={{ position: 'relative' }}>
      {onCopy && (
        <Button
          size="small"
          icon={<CopyOutlined />}
          style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}
          onClick={onCopy}
        />
      )}
      <pre
        className="hljs"
        style={{
          borderRadius: 4,
          fontSize: 13,
          maxHeight,
          margin: 0,
          padding: '12px 16px',
          overflowX: 'auto',
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          background: '#f6f8fa',
          color: '#24292e',
        }}
      >
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}
