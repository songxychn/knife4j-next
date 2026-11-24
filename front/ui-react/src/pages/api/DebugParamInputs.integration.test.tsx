import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createReactTestRoot, stubLayoutApis } from '../../test/reactTestRoot';
import { CustomParamsSection, InjectedGlobalParamsSection, type CustomParamRow } from './DebugParamInputs';

// Rendering Ant Design Table under parallel Linux CI load can exceed the default 5s timeout.
vi.setConfig({ testTimeout: 60_000 });

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

describe('DebugParamInputs', () => {
  test('CustomParamsSection renders lightweight hint and add button when empty, expands on add, and collapses when cleared', async () => {
    function Harness({ emptyHint }: { emptyHint?: string }) {
      const [rows, setRows] = useState<CustomParamRow[]>([]);
      return (
        <CustomParamsSection
          title="apiDebug.customQuery.title"
          addLabel="apiDebug.customParams.add"
          emptyAddLabel="apiDebug.customQuery.add"
          emptyHint={emptyHint}
          compact={Boolean(emptyHint)}
          namePlaceholder="apiDebug.customQuery.namePlaceholder"
          valuePlaceholder="apiDebug.customParams.valuePlaceholder"
          rows={rows}
          onChange={setRows}
        />
      );
    }

    await view.render(<Harness emptyHint="apiDebug.noQueryParams" />);
    expect(view.container.querySelectorAll('table')).toHaveLength(0);
    expect(view.container.textContent).toContain('apiDebug.noQueryParams');
    const addButton = Array.from(view.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('apiDebug.customQuery.add'),
    )!;
    expect(addButton).toBeDefined();

    await act(async () => addButton.click());
    expect(view.container.querySelectorAll('table')).toHaveLength(1);
    expect(view.container.textContent).toContain('apiDebug.customQuery.title');
    expect(view.container.textContent).not.toContain('apiDebug.noQueryParams');

    const deleteButton = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="globalParam.btn.delete"]',
    )!;
    expect(deleteButton).not.toBeNull();
    await act(async () => deleteButton.click());

    expect(view.container.querySelectorAll('table')).toHaveLength(0);
    expect(view.container.textContent).toContain('apiDebug.noQueryParams');
    expect(view.container.textContent).toContain('apiDebug.customQuery.add');
  });

  test('CustomParamsSection renders only the lightweight add button when emptyHint is omitted', async () => {
    function Harness() {
      const [rows, setRows] = useState<CustomParamRow[]>([]);
      return (
        <CustomParamsSection
          title="apiDebug.customBody.title"
          addLabel="apiDebug.customParams.add"
          emptyAddLabel="apiDebug.customBody.add"
          namePlaceholder="apiDebug.customBody.namePlaceholder"
          valuePlaceholder="apiDebug.customParams.valuePlaceholder"
          rows={rows}
          onChange={setRows}
        />
      );
    }

    await view.render(<Harness />);
    expect(view.container.querySelectorAll('table')).toHaveLength(0);
    expect(view.container.textContent).toContain('apiDebug.customBody.add');
  });

  test('InjectedGlobalParamsSection uses inherited global parameter heading and read-only override subtitle', async () => {
    await view.render(
      <InjectedGlobalParamsSection
        compact
        rows={[
          { key: 'app:X-Tenant-Id', name: 'X-Tenant-Id', value: 'acme', masked: false, source: 'application' },
          { key: 'group:locale', name: 'locale', value: 'zh-CN', masked: false, source: 'global' },
        ]}
      />,
    );

    expect(view.container.querySelectorAll('table')).toHaveLength(1);
    expect(view.container.textContent).toContain('apiDebug.globalParams.title');
    expect(view.container.textContent).toContain('apiDebug.globalParams.readOnly');
    expect(view.container.textContent).toContain('X-Tenant-Id');
    expect(view.container.textContent).toContain('locale');
  });
});
