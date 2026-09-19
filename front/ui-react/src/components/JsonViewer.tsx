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
import { annotateJsonWithDescriptions } from '../utils/schemaDescription';
import { firstLevelFoldEffects, type JsonDocument } from '../utils/jsonFolding';

class DescriptionWidget extends WidgetType {
  constructor(
    readonly description: string,
    readonly indentation: number,
  ) {
    super();
  }

  eq(other: DescriptionWidget) {
    return other.description === this.description && other.indentation === this.indentation;
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'response-json-description';
    span.textContent = this.description;
    span.title = this.description;
    span.dataset.indentation = String(this.indentation);
    return span;
  }
}

function descriptionExtension(text: string, descMap: Map<string, string>) {
  let position = 0;
  const annotations = annotateJsonWithDescriptions(text, descMap).flatMap((line) => {
    position += line.code.length;
    const result = line.description
      ? [{ position, description: line.description, indentation: line.code.length - line.code.trimStart().length }]
      : [];
    position++;
    return result;
  });
  function decorate(view: EditorView) {
    const folds = new Map<number, number>();
    foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
      folds.set(from, to);
    });
    return Decoration.set(
      annotations.map(({ position, description, indentation }) => {
        const foldedEnd = folds.get(position);
        // A folded container's description belongs after its closing bracket,
        // while an expanded container keeps the annotation on its opening line.
        const anchor = foldedEnd === undefined ? position : view.state.doc.lineAt(foldedEnd).to;
        return Decoration.widget({ widget: new DescriptionWidget(description, indentation), side: 1 }).range(anchor);
      }),
      true,
    );
  }
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorate(view);
        this.align(view);
      }
      update(update: ViewUpdate) {
        if (foldedRanges(update.state) !== foldedRanges(update.startState)) {
          this.decorations = decorate(update.view);
        }
        if (
          update.geometryChanged ||
          update.viewportChanged ||
          foldedRanges(update.state) !== foldedRanges(update.startState)
        ) {
          this.align(update.view);
        }
      }
      align(view: EditorView) {
        // Use actual rendered code width, including CJK text and folded nodes.
        // Short lines share a nearby tab stop that follows their indentation;
        // long lines retain a minimum gap instead of overlapping the annotation.
        view.requestMeasure({
          key: this,
          read: () =>
            Array.from(view.dom.querySelectorAll<HTMLElement>('.response-json-description')).map((note) => {
              const line = note.closest<HTMLElement>('.cm-line')!;
              const range = document.createRange();
              range.setStart(line, 0);
              range.setEndBefore(note);
              const codeEnd = range.getBoundingClientRect().right;
              const codeStart = line.getBoundingClientRect().left + parseFloat(getComputedStyle(line).paddingLeft);
              const column = codeStart + (28 + Number(note.dataset.indentation)) * view.defaultCharacterWidth;
              return { note, margin: Math.max(12, column - codeEnd) };
            }),
          write: (measurements) => {
            for (const { note, margin } of measurements) {
              if (Math.abs((parseFloat(note.style.marginLeft) || 0) - margin) > 0.5) {
                note.style.marginLeft = `${margin}px`;
              }
            }
          },
        });
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
    overflow: 'auto',
    fontFamily: "Menlo, Monaco, Consolas, 'Courier New', monospace",
  },
  '.cm-content': { padding: '12px 0' },
  '.cm-line': { paddingRight: '16px' },
  '@media (hover: hover)': {
    '.cm-line:hover': { backgroundColor: '#e6f4ff' },
    '.cm-line:hover .response-json-description': {
      color: '#0958d9',
      borderLeftColor: '#69b1ff',
      fontWeight: '600',
    },
  },
  '.cm-gutters': { background: '#f6f8fa', border: 'none', color: '#667085' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 6px', cursor: 'pointer' },
  '.response-json-description': {
    display: 'inline-block',
    verticalAlign: 'top',
    marginLeft: '12px',
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

export default function JsonViewer({
  model,
  resetKey = model,
  descMap,
  showDescription = false,
  maxHeight = 400,
  ariaLabel,
  lineWrapping = true,
}: {
  model: JsonDocument;
  resetKey?: unknown;
  descMap?: Map<string, string>;
  showDescription?: boolean;
  maxHeight?: number | string;
  ariaLabel?: string;
  lineWrapping?: boolean;
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const descriptions = useMemo(() => new Compartment(), []);
  const annotations = useMemo(
    () => (model.valid && showDescription && descMap ? descriptionExtension(model.text, descMap) : []),
    [model, descMap, showDescription],
  );

  useEffect(() => {
    if (!containerRef.current || !model.valid) return;
    const foldByLine = new Map<number, (typeof model.folds)[number]>();
    for (const range of model.folds) {
      if (!foldByLine.has(range.lineStart)) foldByLine.set(range.lineStart, range);
    }
    let state = EditorState.create({
      doc: model.text,
      extensions: [
        EditorState.readOnly.of(true),
        EditorState.lineSeparator.of('\n'),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({ tabindex: '0', 'aria-label': ariaLabel ?? t('json.viewer') }),
        json(),
        syntaxHighlighting(defaultHighlightStyle),
        foldService.of((_state, from) => foldByLine.get(from) ?? null),
        foldGutter(),
        keymap.of(foldKeymap),
        descriptions.of([]),
        theme,
        ...(lineWrapping ? [EditorView.lineWrapping] : []),
        EditorView.theme({
          '.cm-scroller': { maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight },
        }),
      ],
    });
    state = state.update({ effects: firstLevelFoldEffects(state, model.folds) }).state;
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // A new response resets folds even when its text is unchanged; other viewers reset when their model changes.
  }, [resetKey, model, descriptions, t, maxHeight, ariaLabel, lineWrapping]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: descriptions.reconfigure(annotations) });
  }, [annotations, descriptions, resetKey, model, t, maxHeight, ariaLabel, lineWrapping]);

  return (
    <div data-json-viewer>
      {model.folds.length > 0 && (
        <Space style={{ marginBottom: 6 }}>
          <Button size="small" onClick={() => viewRef.current && unfoldAll(viewRef.current)}>
            {t('json.expandAll')}
          </Button>
          <Button
            size="small"
            onClick={() => {
              const view = viewRef.current;
              if (view) view.dispatch({ effects: firstLevelFoldEffects(view.state, model.folds) });
            }}
          >
            {t('json.collapseToFirstLevel')}
          </Button>
        </Space>
      )}
      <div ref={containerRef} />
    </div>
  );
}
