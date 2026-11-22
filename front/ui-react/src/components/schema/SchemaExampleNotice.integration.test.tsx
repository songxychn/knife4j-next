import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createReactTestRoot } from '../../test/reactTestRoot';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: unknown) => (values === undefined ? key : `${key}:${JSON.stringify(values)}`),
  }),
}));

import SchemaExampleNotice from './SchemaExampleNotice';

let view: ReturnType<typeof createReactTestRoot>;
beforeEach(() => {
  view = createReactTestRoot();
});
afterEach(async () => {
  await view.unmount();
});

describe('SchemaExampleNotice', () => {
  test('shows a pattern compilation diagnostic without claiming a meta-schema failure or exposing engine addresses', async () => {
    const pointer = '#/components/schemas/Role/properties/roleName/pattern';
    const pattern = '^[\\p{IsHan}A-Za-z0-9]+$';
    await view.render(
      <SchemaExampleNotice
        result={{
          status: 'none',
          reason: 'evaluation-unavailable',
          diagnostics: [
            {
              code: 'EVALUATION_UNAVAILABLE',
              message: 'private engine error https://knife4j.invalid/schema-projections/session/',
              regexIssues: [{ documentUri: 'https://example.test/openapi.json', pointer, pattern }],
            },
          ],
        }}
      />,
    );
    expect(view.container.querySelector('.ant-alert-title')?.textContent).toBe(
      'schema.example.patternUnavailable.title',
    );
    const rendered = view.container.textContent;
    expect(rendered).toContain(pointer);
    expect(rendered).toContain(pattern);
    expect(rendered).toContain('schema.example.patternUnavailable.preserved');
    expect(rendered).toContain('schema.example.patternUnavailable.location');
    expect(rendered).not.toMatch(/schema-projections|private engine|invalidDocument/);
  });

  test('shows the actual limit and instance location instead of calling an output limit unbounded backtracking', async () => {
    await view.render(
      <SchemaExampleNotice
        result={{
          status: 'none',
          reason: 'search-budget-exceeded',
          diagnostics: [
            {
              code: 'SEARCH_BUDGET_EXCEEDED',
              budget: 'maxOutputBytes',
              limit: 1048576,
              actual: 1048577,
              path: '/payload',
            },
          ],
        }}
      />,
    );
    expect(view.container.querySelector('.ant-alert-description')?.textContent).toContain(
      'schema.example.none.budgetDetail',
    );
    expect(view.container.querySelector('.ant-alert-description')?.textContent).toContain(
      'schema.example.budget.maxOutputBytes',
    );
    expect(view.container.querySelector('.ant-alert-description')?.textContent).toContain('1048576');
    expect(view.container.querySelector('.ant-alert-description')?.textContent).toContain('1048577');
    expect(view.container.querySelector('.ant-alert-description')?.textContent).toContain('$/payload');
  });

  test('identifies a missing authored reference without claiming that its value was preserved', async () => {
    await view.render(
      <SchemaExampleNotice
        result={{
          status: 'none',
          reason: 'evaluation-unavailable',
          diagnostics: [{ code: 'EXAMPLE_REFERENCE_UNAVAILABLE' }],
        }}
      />,
    );
    expect(view.container.querySelector('[role="alert"]')?.classList.contains('ant-alert-warning')).toBe(true);
    expect(view.container.textContent).toContain('schema.example.referenceUnavailable.title');
    expect(view.container.textContent).toContain('schema.example.referenceUnavailable.description');
  });

  test('preserves the validation-only notice when an authored value is available', async () => {
    await view.render(
      <SchemaExampleNotice
        result={{
          status: 'value',
          value: 'authored',
          source: 'example-object',
          authored: true,
          validation: 'unavailable',
          diagnostics: [{ code: 'EVALUATION_UNAVAILABLE' }],
        }}
      />,
    );
    expect(view.container.querySelector('.ant-alert-title')?.textContent).toBe(
      'schema.example.validationUnavailable.title',
    );
  });

  test('renders the original invalid Schema location and omits a notice for a valid result', async () => {
    const pointer = '#/components/schemas/Bad~1% 中文~0/properties/file/type';
    const result = {
      status: 'value',
      value: { ids: ['one'] },
      authored: true,
      source: 'example-object',
    } as const;
    await view.render(
      <SchemaExampleNotice
        result={{
          ...result,
          validation: 'unavailable',
          diagnostics: [
            {
              code: 'EVALUATION_UNAVAILABLE',
              schemaIssues: [{ documentUri: 'https://example.test/original.json', pointer, keyword: 'type' }],
            },
          ],
        }}
      />,
    );
    expect(view.container.textContent).toContain('schema.example.invalidDocument.title');
    expect(view.container.querySelector('code')?.textContent).toBe(pointer);

    await view.render(<SchemaExampleNotice result={{ ...result, validation: 'valid', diagnostics: [] }} />);
    expect(view.container.childElementCount).toBe(0);
  });
});
