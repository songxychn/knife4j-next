import { useEffect, useRef } from 'react';
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, placeholder } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { bracketMatching, syntaxHighlighting, defaultHighlightStyle, indentOnInput } from '@codemirror/language';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';

export type CodeEditorLanguage = 'json' | 'xml' | 'text';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: CodeEditorLanguage;
  /** min height in px, default 120 */
  minHeight?: number;
  /** max height in px, default 400 */
  maxHeight?: number;
  placeholderText?: string;
}

const baseTheme = EditorView.theme({
  '&': {
    fontSize: '13px',
    fontFamily: 'monospace',
    border: '1px solid #d9d9d9',
    borderRadius: '6px',
    backgroundColor: '#fff',
  },
  '&.cm-focused': {
    outline: 'none',
    borderColor: '#4096ff',
    boxShadow: '0 0 0 2px rgba(5,145,255,0.1)',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'inherit',
  },
  '.cm-content': {
    padding: '8px 4px',
    minHeight: '80px',
  },
  '.cm-gutters': {
    borderRight: '1px solid #f0f0f0',
    backgroundColor: '#fafafa',
    color: '#bbb',
  },
});

function buildExtensions(language: CodeEditorLanguage, onChange: (v: string) => void, placeholderText?: string) {
  const langExt = language === 'json' ? json() : language === 'xml' ? xml() : [];
  return [
    lineNumbers(),
    drawSelection(),
    highlightActiveLine(),
    history(),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    langExt,
    baseTheme,
    ...(placeholderText ? [placeholder(placeholderText)] : []),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChange(update.state.doc.toString());
      }
    }),
  ];
}

export default function CodeEditor({
  value,
  onChange,
  language = 'text',
  minHeight = 120,
  maxHeight = 400,
  placeholderText,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Mount / remount when language changes
  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: buildExtensions(language, (v) => onChangeRef.current(v), placeholderText),
      }),
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // Sync external value changes (beautify, operation switch)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      style={{
        minHeight,
        maxHeight,
        overflow: 'auto',
      }}
    />
  );
}
