import { describe, expect, test, vi } from 'vitest';

const { jsxFactory } = vi.hoisted(() => ({
  jsxFactory: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
}));
vi.mock('react/jsx-runtime', () => ({ jsx: jsxFactory, jsxs: jsxFactory, jsxDEV: jsxFactory }));
vi.mock('react/jsx-dev-runtime', () => ({ jsx: jsxFactory, jsxs: jsxFactory, jsxDEV: jsxFactory }));

vi.mock('antd', () => ({ Alert: 'Alert' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import SchemaExampleNotice from './SchemaExampleNotice';

describe('SchemaExampleNotice', () => {
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
      message: 'schema.example.referenceUnavailable.title',
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
    expect(notice?.props.message).toBe('schema.example.validationUnavailable.title');
  });
});
