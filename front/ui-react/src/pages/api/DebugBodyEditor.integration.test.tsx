import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationDebugModel } from 'knife4j-core';
import { createReactTestRoot, stubLayoutApis } from '../../test/reactTestRoot';
import { BodyTab } from './DebugBodyEditor';
import type { RawMode } from './apiDebugShared';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

let view: ReturnType<typeof createReactTestRoot>;

beforeEach(() => {
  view = createReactTestRoot();
  stubLayoutApis();
});

afterEach(async () => {
  await view.unmount();
  vi.restoreAllMocks();
});

const debugModel: OperationDebugModel = {
  method: 'POST',
  path: '/items',
  pathParams: [],
  queryParams: [],
  headerParams: [],
  cookieParams: [],
  bodyContents: [{ mediaType: 'application/json', category: 'json', required: false }],
  securitySchemes: [],
  operationSecurity: [],
  hasRequestBody: true,
};

const sampleJson = JSON.stringify({ id: 1, nested: { a: 1, b: 2 } }, null, 2);

describe('DebugBodyEditor', () => {
  it('supports resizing the JSON CodeEditor without remounting and folding JSON nodes', async () => {
    function Harness() {
      const [body, setBody] = useState(sampleJson);
      const [rawMode, setRawMode] = useState<RawMode>('json');
      const [bodyHeight, setBodyHeight] = useState<number | undefined>(undefined);
      return (
        <BodyTab
          debugModel={debugModel}
          bodyDefaults={{ bodyByMediaType: {}, formFieldsByMediaType: {} }}
          body={body}
          setBody={setBody}
          selectedContentType="application/json"
          setSelectedContentType={vi.fn()}
          formFields={{}}
          setFormFields={vi.fn()}
          formPartHeaders={{}}
          setFormPartHeaders={vi.fn()}
          formPartContentTypes={{}}
          setFormPartContentTypes={vi.fn()}
          enableDynamicParameter={false}
          customBodyParams={[]}
          setCustomBodyParams={vi.fn()}
          setFileFields={vi.fn()}
          setBinaryBodyFile={vi.fn()}
          rawMode={rawMode}
          setRawMode={setRawMode}
          bodyHeight={bodyHeight}
          onBodyHeightChange={setBodyHeight}
        />
      );
    }

    await view.render(<Harness />);
    const editorBefore = view.container.querySelector('.cm-editor');
    const handle = view.container.querySelector<HTMLElement>('[data-resize-handle="vertical"]')!;
    expect(editorBefore).not.toBeNull();

    await act(async () => {
      handle.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true }),
      );
    });

    const content = view.container.querySelector<HTMLElement>('.knife4j-resizable-box-content')!;
    expect(content.style.height).toBe('496px');
    expect(view.container.querySelector('.cm-editor')).toBe(editorBefore);

    const collapseBtn = Array.from(view.container.querySelectorAll('button')).find(
      (b) => b.textContent === 'json.collapseToFirstLevel',
    )!;
    const expandBtn = Array.from(view.container.querySelectorAll('button')).find(
      (b) => b.textContent === 'json.expandAll',
    )!;
    expect(collapseBtn).toBeDefined();
    expect(expandBtn).toBeDefined();

    await act(async () => collapseBtn.click());
    expect(view.container.querySelector('.cm-foldPlaceholder')).not.toBeNull();

    await act(async () => expandBtn.click());
    expect(view.container.querySelector('.cm-foldPlaceholder')).toBeNull();

    await act(async () => {
      handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(content.dataset.resized).toBe('false');
    expect(content.style.height).toBe('');
  });

  it('supports resizing plain text request bodies', async () => {
    function Harness() {
      const [body, setBody] = useState('hello');
      const [bodyHeight, setBodyHeight] = useState<number | undefined>(undefined);
      return (
        <BodyTab
          debugModel={{
            ...debugModel,
            bodyContents: [{ mediaType: 'text/plain', category: 'raw', required: false }],
          }}
          bodyDefaults={{ bodyByMediaType: {}, formFieldsByMediaType: {} }}
          body={body}
          setBody={setBody}
          selectedContentType="text/plain"
          setSelectedContentType={vi.fn()}
          formFields={{}}
          setFormFields={vi.fn()}
          formPartHeaders={{}}
          setFormPartHeaders={vi.fn()}
          formPartContentTypes={{}}
          setFormPartContentTypes={vi.fn()}
          enableDynamicParameter={false}
          customBodyParams={[]}
          setCustomBodyParams={vi.fn()}
          setFileFields={vi.fn()}
          setBinaryBodyFile={vi.fn()}
          rawMode="text"
          setRawMode={vi.fn()}
          bodyHeight={bodyHeight}
          onBodyHeightChange={setBodyHeight}
        />
      );
    }

    await view.render(<Harness />);
    const handle = view.container.querySelector<HTMLElement>('[data-resize-handle="vertical"]')!;
    const textarea = view.container.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(textarea.style.resize).toBe('none');

    await act(async () => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    });

    const content = view.container.querySelector<HTMLElement>('.knife4j-resizable-box-content')!;
    expect(content.style.height).toBe('424px');
    expect(textarea.style.height).toBe('100%');
  });
});
