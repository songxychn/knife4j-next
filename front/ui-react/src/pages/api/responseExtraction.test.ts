import { describe, expect, test } from 'vitest';
import {
  MASKED_VALUE_PREVIEW,
  RESPONSE_EXTRACTION_MAX_BODY_BYTES,
  RESPONSE_EXTRACTION_MAX_EXPRESSION_LENGTH,
  RESPONSE_EXTRACTION_MAX_RULES,
  RESPONSE_EXTRACTION_MAX_VALUE_LENGTH,
  evaluateResponseExtraction,
  extractSingleJsonPathScalar,
  isCrossOriginUrl,
  normalizeResponseExtractionRules,
  type ResponseExtractionRule,
} from './responseExtraction';

function makeRule(overrides: Partial<ResponseExtractionRule> = {}): ResponseExtractionRule {
  return {
    id: 'rule-1',
    enabled: true,
    source: 'json-body',
    expression: '$.data.token',
    prefix: 'Bearer ',
    targetScope: 'group',
    targetIn: 'header',
    targetName: 'Authorization',
    masked: true,
    ...overrides,
  };
}

describe('responseExtraction core', () => {
  test('extracts JSON body scalar and response header in one pass with masking', () => {
    const rules: ResponseExtractionRule[] = [
      makeRule(),
      makeRule({
        id: 'rule-2',
        source: 'json-body',
        expression: '$.data.tenantId',
        prefix: '',
        targetScope: 'application',
        targetIn: 'query',
        targetName: 'tenant',
        masked: false,
      }),
      makeRule({
        id: 'rule-3',
        source: 'header',
        expression: 'X-Refresh-Token',
        prefix: '',
        targetScope: 'group',
        targetIn: 'header',
        targetName: 'X-Refresh-Token',
        masked: true,
      }),
    ];

    const result = evaluateResponseExtraction(
      rules,
      {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-refresh-token': 'r-123' },
        rawText: JSON.stringify({ data: { token: 'secret-tok', tenantId: 42 } }),
        kind: 'json',
      },
      { executedAt: 1000 },
    );

    expect(result.log.status).toBe('executed');
    expect(result.log.mode).toBe('auto');
    expect(result.log.executedAt).toBe(1000);
    expect(result.mutations).toEqual([
      {
        ruleId: 'rule-1',
        scope: 'group',
        in: 'header',
        name: 'Authorization',
        value: 'Bearer secret-tok',
        masked: true,
      },
      {
        ruleId: 'rule-2',
        scope: 'application',
        in: 'query',
        name: 'tenant',
        value: '42',
        masked: false,
      },
      {
        ruleId: 'rule-3',
        scope: 'group',
        in: 'header',
        name: 'X-Refresh-Token',
        value: 'r-123',
        masked: true,
      },
    ]);
    expect(result.log.items[0].valuePreview).toBe(MASKED_VALUE_PREVIEW);
    expect(result.log.items[1].valuePreview).toBe('42');
    expect(result.log.items[2].valuePreview).toBe(MASKED_VALUE_PREVIEW);
  });

  test('dry-run marks successful items as preview without changing mutations contract', () => {
    const result = evaluateResponseExtraction(
      [makeRule({ masked: false, prefix: '' })],
      {
        status: 201,
        headers: {},
        rawText: JSON.stringify({ data: { token: 'abc' } }),
        kind: 'json',
      },
      { mode: 'dry-run' },
    );

    expect(result.log.mode).toBe('dry-run');
    expect(result.log.items[0].status).toBe('preview');
    expect(result.log.items[0].valuePreview).toBe('abc');
    expect(result.mutations).toHaveLength(1);
  });

  test('skips non-2xx responses without producing mutations', () => {
    const result = evaluateResponseExtraction([makeRule()], {
      status: 401,
      headers: {},
      rawText: JSON.stringify({ data: { token: 'should-not-extract' } }),
      kind: 'json',
    });

    expect(result.log.status).toBe('skipped');
    expect(result.log.skipReason).toBe('non-2xx');
    expect(result.mutations).toEqual([]);
  });

  test.each(['binary', 'image'] as const)('skips unsupported %s response kind', (kind) => {
    const result = evaluateResponseExtraction([makeRule()], {
      status: 200,
      headers: { 'x-token': 'abc' },
      rawText: '',
      kind,
    });

    expect(result.log.status).toBe('skipped');
    expect(result.log.skipReason).toBe('unsupported-response-kind');
    expect(result.mutations).toEqual([]);
  });

  test('skips streaming responses', () => {
    const result = evaluateResponseExtraction([makeRule()], {
      status: 200,
      headers: {},
      rawText: '{"data":{"token":"abc"}}',
      kind: 'text',
      isStreaming: true,
    });

    expect(result.log.status).toBe('skipped');
    expect(result.log.skipReason).toBe('unsupported-response-kind');
    expect(result.mutations).toEqual([]);
  });

  test('skips when no enabled rules exist', () => {
    const result = evaluateResponseExtraction([makeRule({ enabled: false })], {
      status: 200,
      headers: {},
      rawText: '{"data":{"token":"abc"}}',
      kind: 'json',
    });

    expect(result.log.status).toBe('skipped');
    expect(result.log.skipReason).toBe('no-enabled-rules');
    expect(result.mutations).toEqual([]);
  });

  test('keeps header extraction working on 204 empty body while failing json-body rule independently', () => {
    const result = evaluateResponseExtraction(
      [
        makeRule({ id: 'body-rule' }),
        makeRule({
          id: 'header-rule',
          source: 'header',
          expression: 'X-Auth-Token',
          prefix: '',
          targetName: 'X-Auth-Token',
        }),
      ],
      {
        status: 204,
        headers: { 'x-auth-token': 'tok-204' },
        rawText: '',
        kind: 'text',
      },
    );

    expect(result.log.status).toBe('executed');
    expect(result.log.items[0]).toMatchObject({ ruleId: 'body-rule', status: 'failed', reasonCode: 'invalid-json' });
    expect(result.log.items[1]).toMatchObject({ ruleId: 'header-rule', status: 'updated' });
    expect(result.mutations).toHaveLength(1);
    expect(result.mutations[0].value).toBe('tok-204');
  });

  test('reports CORS hint when header is missing on cross-origin response', () => {
    const result = evaluateResponseExtraction(
      [makeRule({ source: 'header', expression: 'X-Token', targetName: 'X-Token' })],
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
        rawText: '{}',
        kind: 'json',
        isCrossOrigin: true,
      },
    );

    expect(result.log.items[0]).toMatchObject({ status: 'failed', reasonCode: 'header-not-found-cors' });
    expect(result.mutations).toEqual([]);
  });

  test('rejects empty string, null, objects, multiple matches, and eval JSONPath expressions', () => {
    const result = evaluateResponseExtraction(
      [
        makeRule({ id: 'empty', expression: '$.empty' }),
        makeRule({ id: 'nullv', expression: '$.nullv' }),
        makeRule({ id: 'obj', expression: '$.obj' }),
        makeRule({ id: 'multi', expression: '$.items[*].id' }),
        makeRule({ id: 'missing', expression: '$.missing' }),
        makeRule({ id: 'eval-filter', expression: '$[?(@.items)]' }),
      ],
      {
        status: 200,
        headers: {},
        rawText: JSON.stringify({
          empty: '',
          nullv: null,
          obj: { nested: true },
          items: [{ id: 'a' }, { id: 'b' }],
        }),
        kind: 'json',
      },
    );

    expect(result.mutations).toEqual([]);
    expect(result.log.items.map((item) => [item.ruleId, item.reasonCode])).toEqual([
      ['empty', 'empty-value'],
      ['nullv', 'non-scalar'],
      ['obj', 'non-scalar'],
      ['multi', 'multiple-matches'],
      ['missing', 'no-match'],
      ['eval-filter', 'eval-error'],
    ]);
  });

  test('enforces body size, expression length, and value length limits', () => {
    const oversizedBody = 'a'.repeat(RESPONSE_EXTRACTION_MAX_BODY_BYTES + 1);
    const bodyLimitResult = evaluateResponseExtraction([makeRule()], {
      status: 200,
      headers: {},
      rawText: oversizedBody,
      kind: 'json',
    });
    expect(bodyLimitResult.log.items[0]).toMatchObject({ status: 'failed', reasonCode: 'body-too-large' });

    const longExprResult = evaluateResponseExtraction(
      [makeRule({ expression: '$.' + 'a'.repeat(RESPONSE_EXTRACTION_MAX_EXPRESSION_LENGTH) })],
      {
        status: 200,
        headers: {},
        rawText: '{}',
        kind: 'json',
      },
    );
    expect(longExprResult.log.items[0]).toMatchObject({ status: 'failed', reasonCode: 'expression-too-long' });

    const longValueResult = evaluateResponseExtraction([makeRule({ prefix: '' })], {
      status: 200,
      headers: {},
      rawText: JSON.stringify({ data: { token: 'x'.repeat(RESPONSE_EXTRACTION_MAX_VALUE_LENGTH + 1) } }),
      kind: 'json',
    });
    expect(longValueResult.log.items[0]).toMatchObject({ status: 'failed', reasonCode: 'value-too-long' });
    expect(longValueResult.mutations).toEqual([]);
  });

  test('normalizes stored rules with safe defaults, truncation, deduplicated ids, and max count', () => {
    const raw = Array.from({ length: RESPONSE_EXTRACTION_MAX_RULES + 5 }, (_, idx) => ({
      id: idx < 2 ? 'dup-id' : `id-${idx}`,
      source: idx % 2 === 0 ? 'header' : 'invalid-source',
      targetScope: idx === 0 ? 'application' : 'unknown',
      targetIn: idx === 0 ? 'query' : 'cookie',
      expression: 'x'.repeat(RESPONSE_EXTRACTION_MAX_EXPRESSION_LENGTH + 10),
      targetName: 'Authorization',
      masked: idx === 0 ? false : undefined,
    }));

    const normalized = normalizeResponseExtractionRules(raw);
    expect(normalized).toHaveLength(RESPONSE_EXTRACTION_MAX_RULES);
    expect(normalized[0]).toMatchObject({
      id: 'dup-id',
      source: 'header',
      targetScope: 'application',
      targetIn: 'query',
      masked: false,
    });
    expect(normalized[0].expression).toHaveLength(RESPONSE_EXTRACTION_MAX_EXPRESSION_LENGTH);
    expect(normalized[1].id).not.toBe('dup-id');
    expect(normalized[1]).toMatchObject({
      source: 'json-body',
      targetScope: 'group',
      targetIn: 'header',
      masked: true,
    });
  });

  test('detects cross-origin request URLs safely', () => {
    expect(isCrossOriginUrl('https://auth.example.com/login', 'https://api.example.com')).toBe(true);
    expect(isCrossOriginUrl('/api/login', 'https://api.example.com')).toBe(false);
    expect(isCrossOriginUrl('https://api.example.com/login', 'https://api.example.com')).toBe(false);
    expect(isCrossOriginUrl(undefined, 'https://api.example.com')).toBe(false);
  });

  test('extractSingleJsonPathScalar rejects script evaluation', () => {
    expect(() => extractSingleJsonPathScalar([{ token: 'a' }], '$[?(@.token)]')).toThrow(
      /Eval .* prevented in JSONPath expression/,
    );
  });
});
