import { useMemo } from 'react';
import { Button } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import hljs from 'highlight.js/lib/core';
import json from 'highlight.js/lib/languages/json';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import { useTranslation } from 'react-i18next';

hljs.registerLanguage('json', json);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
import 'highlight.js/styles/github.css';
import JsonViewer from '../../components/JsonViewer';
import { prepareJsonDocument } from '../../utils/jsonFolding';

interface CodeBlockProps {
  /** Pre-formatted code string to display */
  code: string;
  language?: string;
  /** Keep serialized wire text exactly as authored, including whitespace. */
  preserveText?: boolean;
  /** Called when the copy button is clicked */
  onCopy?: () => void;
  maxHeight?: number | string;
}

/**
 * Unified syntax-highlighted code block used for request/response examples.
 * JSON uses the shared folding viewer; other languages retain highlight.js.
 */
export default function CodeBlock({
  code,
  language = 'json',
  onCopy,
  maxHeight = 400,
  preserveText = false,
}: CodeBlockProps) {
  const { t } = useTranslation();
  const model = useMemo(
    () => (language === 'json' ? prepareJsonDocument(code, preserveText) : null),
    [code, language, preserveText],
  );
  const highlighted = useMemo(() => {
    if (model?.valid) return '';
    try {
      if (!hljs.getLanguage(language)) return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return hljs.highlight(code, { language }).value;
    } catch {
      return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }, [code, language, model]);

  return (
    <div style={{ position: 'relative' }}>
      {onCopy && (
        <Button
          size="small"
          aria-label={t('apiDebug.preview.copyValue')}
          icon={<CopyOutlined aria-hidden="true" />}
          style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}
          onClick={onCopy}
        />
      )}
      {model?.valid ? (
        <JsonViewer model={model} maxHeight={maxHeight} />
      ) : (
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
      )}
    </div>
  );
}
