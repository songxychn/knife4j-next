import { useEffect, useMemo, useRef } from 'react';
import { Button, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { Compartment, EditorState } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { json } from '@codemirror/lang-json';
import {
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  foldService,
  foldedRanges,
  syntaxHighlighting,
  unfoldAll,
} from '@codemirror/language';
import { annotateJsonWithDescriptions } from '../../utils/schemaDescription';
import { firstLevelFoldEffects, prepareResponseJson } from './responseJsonFolding';
import CodeBlock from './CodeBlock';

class DescriptionWidget extends WidgetType {
  constructor(readonly description: string) {
    super();
  }

  eq(other: DescriptionWidget) {
    return other.description === this.description;
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'response-json-description';
    span.textContent = this.description;
    span.title = this.description;
    return span;
  }
}

function descriptionExtension(text: string, descMap: Map<string, string>) {
  let position = 0;
  const annotations = annotateJsonWithDescriptions(text, descMap).flatMap((line) => {
    position += line.code.length;
    const result = line.description ? [{ position, description: line.description }] : [];
    position++;
    return result;
  });
  function decorate(view: EditorView) {
    const folds = new Map<number, number>();
    foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
      folds.set(from, to);
    });
    return Decoration.set(
      annotations.map(({ position, description }) => {
        const foldedEnd = folds.get(position);
        // A folded container's description belongs after its closing bracket,
        // while an expanded container keeps the annotation on its opening line.
        const anchor = foldedEnd === undefined ? position : view.state.doc.lineAt(foldedEnd).to;
        return Decoration.widget({ widget: new DescriptionWidget(description), side: 1 }).range(anchor);
      }),
      true,
    );
  }
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorate(view);
      }
      update(update: ViewUpdate) {
        if (foldedRanges(update.state) !== foldedRanges(update.startState)) {
          this.decorations = decorate(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

const theme = EditorView.theme({
  '&': {
    fontSize: '13px',
    background: '#f6f8fa',
    color: '#24292e',
    borderRadius: '4px',
    '--response-description-width': '200px',
  },
  '@media (max-width: 600px)': {
    '&': { '--response-description-width': '140px' },
  },
  '.cm-scroller': {
    maxHeight: '400px',
    overflow: 'auto',
    fontFamily: "Menlo, Monaco, Consolas, 'Courier New', monospace",
  },
  '.cm-content': { padding: '12px 0' },
  '.cm-line': { paddingRight: '16px' },
  '&.response-json-annotated .cm-line': {
    position: 'relative',
    paddingRight: 'calc(var(--response-description-width) + 32px)',
  },
  '.cm-gutters': { background: '#f6f8fa', border: 'none', color: '#667085' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 6px', cursor: 'pointer' },
  '.response-json-description': {
    position: 'absolute',
    top: '0',
    right: '16px',
    width: 'var(--response-description-width)',
    boxSizing: 'border-box',
    paddingLeft: '12px',
    borderLeft: '1px solid #d9d9d9',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '12px',
    color: '#8c8c8c',
    userSelect: 'none',
  },
});

export default function ResponseJsonViewer({
  response,
  descMap,
  showDescription,
}: {
  response: { readonly rawText: string };
  descMap: Map<string, string>;
  showDescription: boolean;
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const descriptions = useMemo(() => new Compartment(), []);
  const model = useMemo(() => prepareResponseJson(response.rawText), [response.rawText]);
  const annotations = useMemo(
    () =>
      model.valid && showDescription
        ? [
            EditorView.editorAttributes.of({ class: 'response-json-annotated' }),
            descriptionExtension(model.text, descMap),
          ]
        : [],
    [model, descMap, showDescription],
  );

  useEffect(() => {
    if (!containerRef.current || !model.valid) return;
    const foldByLine = new Map(model.folds.map((range) => [range.lineStart, range]));
    let state = EditorState.create({
      doc: model.text,
      extensions: [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({ tabindex: '0', 'aria-label': t('apiDebug.response.jsonViewer') }),
        json(),
        syntaxHighlighting(defaultHighlightStyle),
        foldService.of((_state, from) => foldByLine.get(from) ?? null),
        foldGutter(),
        keymap.of(foldKeymap),
        descriptions.of([]),
        theme,
      ],
    });
    state = state.update({ effects: firstLevelFoldEffects(state, model.folds) }).state;
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Response identity intentionally resets folds even when two requests return identical text.
  }, [response, model, descriptions, t]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: descriptions.reconfigure(annotations) });
  }, [annotations, descriptions, response, model, t]);

  if (!model.valid) return <CodeBlock code={model.text} />;

  return (
    <div data-response-json-viewer>
      {model.folds.length > 0 && (
        <Space style={{ marginBottom: 6 }}>
          <Button size="small" onClick={() => viewRef.current && unfoldAll(viewRef.current)}>
            {t('apiDebug.response.expandAll')}
          </Button>
          <Button
            size="small"
            onClick={() => {
              const view = viewRef.current;
              if (view) view.dispatch({ effects: firstLevelFoldEffects(view.state, model.folds) });
            }}
          >
            {t('apiDebug.response.collapseToFirstLevel')}
          </Button>
        </Space>
      )}
      <div ref={containerRef} />
    </div>
  );
}
