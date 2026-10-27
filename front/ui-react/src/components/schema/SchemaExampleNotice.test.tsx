import { describe, expect, test, vi } from 'vitest';

const { jsxFactory } = vi.hoisted(() => ({
  jsxFactory: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
}));
vi.mock('react/jsx-runtime', () => ({ jsx: jsxFactory, jsxs: jsxFactory, jsxDEV: jsxFactory }));
vi.mock('react/jsx-dev-runtime', () => ({ jsx: jsxFactory, jsxs: jsxFactory, jsxDEV: jsxFactory }));

vi.mock('antd', () => ({ Alert: 'Alert' }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: unknown) => (values === undefined ? key : `${key}:${JSON.stringify(values)}`),
  }),
}));

import SchemaExampleNotice from './SchemaExampleNotice';

describe('SchemaExampleNotice', () => {
  test('shows the actual limit and instance location instead of calling an output limit unbounded backtracking', () => {
    const notice = SchemaExampleNotice({
      result: {
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
      },
    });
    expect(notice?.props.description).toContain('schema.example.none.budgetDetail');
    expect(notice?.props.description).toContain('schema.example.budget.maxOutputBytes');
    expect(notice?.props.description).toContain('1048576');
    expect(notice?.props.description).toContain('1048577');
    expect(notice?.props.description).toContain('$/payload');
  });

  test('identifies a missing authored reference without claiming that its value was preserved', () => {
    const notice = SchemaExampleNotice({
      result: {
        status: 'none',
        reason: 'evaluation-unavailable',
        diagnostics: [{ code: 'EXAMPLE_REFERENCE_UNAVAILABLE' }],
      },
    });
    expect(notice?.props).toMatchObject({
      type: 'warning',
      title: 'schema.example.referenceUnavailable.title',
      description: 'schema.example.referenceUnavailable.description',
    });
  });

  test('preserves the validation-only notice when an authored value is available', () => {
    const notice = SchemaExampleNotice({
      result: {
        status: 'value',
        value: 'authored',
        source: 'example-object',
        authored: true,
        validation: 'unavailable',
        diagnostics: [{ code: 'EVALUATION_UNAVAILABLE' }],
      },
    });
    expect(notice?.props.title).toBe('schema.example.validationUnavailable.title');
  });
});
