import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, type CSSProperties } from 'react';
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, placeholder } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { firstLevelFoldEffects, foldableJsonLanguage, prepareJsonDocument } from '../utils/jsonFolding';
import { xml } from '@codemirror/lang-xml';
import {
  bracketMatching,
  syntaxHighlighting,
  defaultHighlightStyle,
  indentOnInput,
  foldGutter,
  foldKeymap,
  unfoldAll,
} from '@codemirror/language';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';

export type CodeEditorLanguage = 'json' | 'xml' | 'text';

export interface CodeEditorHandle {
  expandAll: () => void;
  collapseToFirstLevel: () => void;
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: CodeEditorLanguage;
  /** explicit height in px or CSS length; overrides natural sizing without remounting */
  height?: number | string;
  /** min height in px, default 120 */
  minHeight?: number;
  /** max height in px, default 400 */
  maxHeight?: number | string;
  placeholderText?: string;
  ariaLabel?: string;
}

const baseTheme = EditorView.theme({
  '&': {
    fontSize: '13px',
    fontFamily: 'monospace',
    border: '1px solid #d9d9d9',
    borderRadius: '6px',
    backgroundColor: '#fff',
    height: 'var(--knife4j-code-editor-height, auto)',
    minHeight: 'var(--knife4j-code-editor-min-height, 120px)',
    maxHeight: 'var(--knife4j-code-editor-max-height, 400px)',
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

const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { value, onChange, language = 'text', height, minHeight = 120, maxHeight = 400, placeholderText, ariaLabel },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const accessibleNameRef = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useImperativeHandle(
    ref,
    () => ({
      expandAll: () => {
        const view = viewRef.current;
        if (view) unfoldAll(view);
      },
      collapseToFirstLevel: () => {
        const view = viewRef.current;
        if (!view || language !== 'json') return;
        const doc = prepareJsonDocument(view.state.doc.toString(), true);
        if (!doc.valid || doc.folds.length === 0) return;
        const effects = firstLevelFoldEffects(view.state, doc.folds);
        if (effects.length > 0) view.dispatch({ effects });
      },
    }),
    [language],
  );

  const buildExtensions = useCallback(
    (onChange: (v: string) => void) => {
      const langExt = language === 'json' ? foldableJsonLanguage : language === 'xml' ? xml() : [];
      return [
        accessibleNameRef.current.of(EditorView.contentAttributes.of({})),
        lineNumbers(),
        drawSelection(),
        highlightActiveLine(),
        history(),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        langExt,
        ...(language === 'json' ? [foldGutter(), keymap.of(foldKeymap)] : []),
        baseTheme,
        ...(placeholderText ? [placeholder(placeholderText)] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
      ];
    },
    [language, placeholderText],
  );

  // Mount / remount when language or placeholderText changes.
  // value is intentionally read only on first mount; subsequent changes are
  // handled by the sync effect below, so we capture it via a ref here.
  const initialValueRef = useRef(value);
  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: buildExtensions((v) => onChangeRef.current(v)),
      }),
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [buildExtensions]);

  // Updating the accessible name must not replace the editable DOM or lose unsaved edits.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: accessibleNameRef.current.reconfigure(
        EditorView.contentAttributes.of(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      ),
    });
  }, [ariaLabel, buildExtensions]);

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

  const resolvedHeight = height !== undefined ? (typeof height === 'number' ? `${height}px` : height) : 'auto';
  const resolvedMinHeight = `${minHeight}px`;
  const resolvedMaxHeight =
    height !== undefined ? 'none' : typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight;

  return (
    <div
      ref={containerRef}
      style={
        {
          '--knife4j-code-editor-height': resolvedHeight,
          '--knife4j-code-editor-min-height': resolvedMinHeight,
          '--knife4j-code-editor-max-height': resolvedMaxHeight,
          ...(height !== undefined ? { height: resolvedHeight } : {}),
        } as CSSProperties
      }
    />
  );
});

export default CodeEditor;
