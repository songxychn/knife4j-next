import { afterEach, expect, test, vi } from 'vitest';
import type { JsonValue } from 'knife4j-schema-engine';
import type { SwaggerDoc } from '../types/swagger';
import * as sessionsModule from './schemaDocumentSession';
import { generateSchemaExample } from './schemaExampleGeneration';

const sessions: sessionsModule.SchemaDocumentSession[] = [];
const reference = '#/components/schemas/Value';
afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  vi.restoreAllMocks();
});
async function fixture(schema: JsonValue, openapi = '3.1.1', extra: Record<string, JsonValue> = {}) {
  const session = await sessionsModule.createSchemaDocumentSession(
    {
      openapi,
      info: { title: 'Bounded generation', version: '1' },
      paths: {},
      components: { schemas: { Value: schema, ...extra } },
    } as SwaggerDoc,
    'https://examples.knife4j.example/bounded.json',
  );
  sessions.push(session);
  return session;
}
function wide(required: number): JsonValue {
  const names = Array.from({ length: 1000 }, (_, i) => `field${i}`);
  return {
    type: 'object',
    properties: Object.fromEntries(names.map((name) => [name, { type: 'string' }])),
    required: names.slice(0, required),
    additionalProperties: false,
  };
}
test.each(['3.1.1', '3.2.0'].flatMap((version) => [0, 700, 1000].map((required) => [version, required] as const)))(
  'constructs every applicable field on its first complete root candidate (%s, %i required)',
  async (version, required) => {
    const session = await fixture(wide(required), version);
    const evaluate = vi.spyOn(sessionsModule, 'evaluateSchemaDocumentDirectionally');
    for (const direction of ['request', 'response'] as const) {
      evaluate.mockClear();
      const result = await generateSchemaExample(session, reference, { direction });
      expect(result).toMatchObject({ status: 'value', validation: 'valid', source: 'generated' });
      if (result.status !== 'value') throw new Error(result.reason);
      expect(Object.keys(result.value!)).toHaveLength(1000);
      expect(evaluate).toHaveBeenCalledTimes(1);
      await expect(session.evaluate(reference, result.value)).resolves.toMatchObject({ valid: true });
    }
  },
);
test('selects optional dependency closures before applying maxProperties and not.required', async () => {
  const session = await fixture({
    type: 'object',
    required: ['id'],
    minProperties: 3,
    maxProperties: 3,
    properties: { id: { type: 'integer' }, bad: { type: 'string' }, a: { type: 'string' }, b: { type: 'string' } },
    dependentRequired: { bad: ['a', 'b'], a: ['b'] },
    not: { required: ['bad'] },
    additionalProperties: false,
  });
  const result = await generateSchemaExample(session, reference, { direction: 'request' });
  expect(result).toMatchObject({ status: 'value', value: { id: 0, a: '', b: '' }, validation: 'valid' });
});
test('terminates optional recursion while retaining required dependency closures and ordinary fields', async () => {
  const session = await fixture({
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string' },
      next: { $ref: reference },
    },
    additionalProperties: false,
  });
  const result = await generateSchemaExample(session, reference, { direction: 'request' });
  expect(result).toMatchObject({ status: 'value', validation: 'valid', value: { id: '', next: { id: '' } } });
  if (result.status === 'value')
    await expect(session.evaluate(reference, result.value)).resolves.toMatchObject({ valid: true });
  sessions.pop()!.dispose();
  const required = await fixture({
    type: 'object',
    required: ['id'],
    dependentRequired: { id: ['next'] },
    properties: { id: { type: 'string' }, next: { $ref: reference } },
    additionalProperties: false,
  });
  await expect(generateSchemaExample(required, reference, { direction: 'request' })).resolves.toMatchObject({
    status: 'none',
  });
});

type DtoKind = 'mixed' | 'shared-ref' | 'distinct-ref' | 'nested8' | 'nested16' | 'allOf';
function ordinaryDto(kind: DtoKind, requiredCount: number) {
  const names = Array.from({ length: 1000 }, (_, i) => `field${i}`);
  const required = new Set(names.slice(0, requiredCount));
  const extra: Record<string, JsonValue> = {};
  const variants: JsonValue[] = [
    { type: 'string', minLength: 3, maxLength: 16 },
    { type: 'integer', minimum: 3, maximum: 99 },
    { type: 'number', minimum: 0.5, maximum: 9 },
    { type: 'boolean' },
    { type: 'string', enum: ['ready', 'done'] },
    { type: ['string', 'null'] },
  ];
  const properties = Object.fromEntries(
    names.map((name, i) => {
      if (kind === 'shared-ref' || kind === 'distinct-ref') {
        const target = kind === 'shared-ref' ? 'Text' : `Text${i}`;
        extra[target] = { type: 'string', minLength: 2 };
        return [name, { $ref: `#/components/schemas/${target}` }];
      }
      return [name, kind === 'mixed' ? variants[i % variants.length] : { type: 'string' }];
    }),
  );
  const object = (selected: string[], closed = true): JsonValue => ({
    type: 'object',
    properties: Object.fromEntries(selected.map((name) => [name, properties[name]])),
    required: selected.filter((name) => required.has(name)),
    ...(closed ? { additionalProperties: false } : {}),
  });
  let schema = object(names);
  if (kind === 'allOf')
    schema = {
      type: 'object',
      allOf: Array.from({ length: 10 }, (_, i) => object(names.slice(i * 100, (i + 1) * 100), false)),
      unevaluatedProperties: false,
    };
  if (kind === 'nested8' || kind === 'nested16') {
    const groups = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`group${i}`, object(names.slice(i * 100, (i + 1) * 100))]),
    );
    schema = {
      type: 'array',
      minItems: 1,
      maxItems: 1,
      items: { type: 'object', properties: groups, required: Object.keys(groups), additionalProperties: false },
    };
    for (let depth = 3; depth < (kind === 'nested8' ? 8 : 16); depth += 1)
      schema = { type: 'object', properties: { child: schema }, required: ['child'], additionalProperties: false };
  }
  return { schema, extra };
}
function leaves(value: JsonValue): number {
  if (value !== null && typeof value === 'object')
    return Object.values(value).reduce<number>((sum, child) => sum + leaves(child), 0);
  return 1;
}
test.each(
  ['3.1.1', '3.2.0'].flatMap((version) =>
    (['mixed', 'shared-ref', 'distinct-ref', 'nested8', 'nested16', 'allOf'] as const).flatMap((kind) =>
      [0, 700, 1000].map((required) => [version, kind, required] as const),
    ),
  ),
)('keeps all 1000 leaves in %s %s (%i required)', async (version, kind, required) => {
  const dto = ordinaryDto(kind, required);
  const session = await fixture(dto.schema, version, dto.extra);
  const evaluate = vi.spyOn(sessionsModule, 'evaluateSchemaDocumentDirectionally');
  for (const direction of ['request', 'response'] as const) {
    evaluate.mockClear();
    const result = await generateSchemaExample(session, reference, { direction });
    expect(result).toMatchObject({ status: 'value', validation: 'valid', source: 'generated' });
    if (result.status !== 'value') throw new Error(`${version} ${kind}: ${JSON.stringify(result)}`);
    expect(leaves(result.value)).toBe(1000);
    expect(evaluate).toHaveBeenCalledTimes(1);
    await expect(session.evaluate(reference, result.value)).resolves.toMatchObject({ valid: true });
  }
});

const budgetCases = [
  ['maxNodes', 2, { type: 'integer' }],
  ['maxDepth', 2, { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }],
  [
    'maxInstanceDepth',
    2,
    {
      type: 'object',
      properties: { nested: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
      required: ['nested'],
    },
  ],
  ['maxOutputNodes', 2, { type: 'object', properties: { id: { const: 1 } }, required: ['id'] }],
  ['maxOutputBytes', 13, { type: 'object', properties: { 中: { const: '文' } }, required: ['中'] }],
  ['maxConstructedNodes', 15, { type: 'integer' }],
  ['maxStringLength', 3, { type: 'string', minLength: 3, maxLength: 3 }],
  ['maxArrayLength', 3, { type: 'array', minItems: 3, maxItems: 3, items: { type: 'integer' } }],
  ['maxSearchChoices', 2, { type: 'integer', not: { enum: [0, 1] } }],
  ['maxEvaluations', 3, { type: 'integer', not: { enum: [0, 1] } }],
] as const;
test.each(budgetCases)('keeps %s shared and enforces its L-1 / L / L+1 boundary', async (name, boundary, schema) => {
  const session = await fixture(schema as unknown as JsonValue);
  for (const limit of [boundary - 1, boundary, boundary + 1]) {
    const result = await generateSchemaExample(session, reference, { direction: 'request', limits: { [name]: limit } });
    if (limit < boundary) {
      expect(result).toMatchObject({
        status: 'none',
        reason: 'search-budget-exceeded',
        diagnostics: [expect.objectContaining({ code: 'SEARCH_BUDGET_EXCEEDED', budget: name, limit })],
      });
    } else {
      expect(result).toMatchObject({ status: 'value', validation: 'valid' });
      if (result.status === 'value')
        await expect(session.evaluate(reference, result.value)).resolves.toMatchObject({ valid: true });
    }
  }
});
test('uses one visit budget across failed branch selections', async () => {
  const session = await fixture({ anyOf: [{ type: 'integer', not: {} }, { type: 'boolean' }] });
  await expect(
    generateSchemaExample(session, reference, { direction: 'request', limits: { maxNodes: 4 } }),
  ).resolves.toMatchObject({
    status: 'none',
    reason: 'search-budget-exceeded',
    diagnostics: [expect.objectContaining({ budget: 'maxNodes', actual: 5 })],
  });
});
test('does not expand unreachable recursive array items and constructs distinct tuple values', async () => {
  const session = await fixture({ type: 'array', items: { $ref: reference } });
  await expect(
    generateSchemaExample(session, reference, { direction: 'response', limits: { maxReferences: 1 } }),
  ).resolves.toMatchObject({ status: 'value', value: [], validation: 'valid' });
  sessions.pop()!.dispose();
  const unique = await fixture({
    type: 'array',
    minItems: 3,
    maxItems: 3,
    uniqueItems: true,
    items: { enum: [1, 2, 3] },
  });
  await expect(generateSchemaExample(unique, reference, { direction: 'response' })).resolves.toMatchObject({
    status: 'value',
    value: [1, 2, 3],
    validation: 'valid',
  });
});
test('retains root authored values even when automatic construction limits are smaller', async () => {
  const value = { text: 'an authored string', values: [1, 2, 3] };
  const session = await fixture({ type: 'object', examples: [value] });
  await expect(
    generateSchemaExample(session, reference, {
      direction: 'request',
      limits: {
        maxNodes: 1,
        maxOutputNodes: 1,
        maxOutputBytes: 1,
        maxConstructedNodes: 1,
        maxStringLength: 1,
        maxArrayLength: 1,
      },
    }),
  ).resolves.toMatchObject({ status: 'value', value, source: 'schema-examples', authored: true, validation: 'valid' });
});

const finiteCases: Array<{
  name: string;
  schema: JsonValue;
  extra?: Record<string, JsonValue>;
  status: 'value' | 'none';
}> = [
  {
    name: 'mutual optional references',
    schema: { $ref: '#/components/schemas/A' },
    extra: {
      A: { type: 'object', properties: { a: { const: 1 }, next: { $ref: '#/components/schemas/B' } }, required: ['a'] },
      B: { type: 'object', properties: { b: { const: 2 }, next: { $ref: '#/components/schemas/A' } }, required: ['b'] },
    },
    status: 'value',
  },
  {
    name: 'required non-terminal recursion',
    schema: { type: 'object', properties: { next: { $ref: reference } }, required: ['next'] },
    status: 'none',
  },
  ...[false, true].map((nullFirst) => ({
    name: `nullable recursive choice ${nullFirst}`,
    schema: {
      type: 'object',
      properties: {
        next: { anyOf: nullFirst ? [{ type: 'null' }, { $ref: reference }] : [{ $ref: reference }, { type: 'null' }] },
      },
      required: ['next'],
    } as JsonValue,
    status: 'value' as const,
  })),
  {
    name: 'nullable recursive type',
    schema: { type: ['object', 'null'], properties: { next: { $ref: reference } }, required: ['next'] },
    status: 'value',
  },
  { name: 'empty recursive array terminal', schema: { type: 'array', items: { $ref: reference } }, status: 'value' },
  {
    name: 'required recursive array has no finite terminal',
    schema: { type: 'array', items: { $ref: reference }, minItems: 1 },
    status: 'none',
  },
  {
    name: 'recursive object fills remaining cardinality',
    schema: {
      type: 'object',
      minProperties: 2,
      properties: { id: { const: 1 }, next: { $ref: reference } },
      additionalProperties: { type: 'integer' },
    },
    status: 'value',
  },
  {
    name: 'mandatory transitive dependency',
    schema: {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' } },
      required: ['a'],
      dependentRequired: { a: ['b'], b: ['c'] },
      maxProperties: 3,
    },
    status: 'value',
  },
  {
    name: 'mandatory cyclic dependency',
    schema: {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      required: ['a'],
      dependentRequired: { a: ['b'], b: ['a'] },
      maxProperties: 2,
    },
    status: 'value',
  },
  {
    name: 'mandatory dependency exceeds cap',
    schema: {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      required: ['a'],
      dependentRequired: { a: ['b'] },
      maxProperties: 1,
    },
    status: 'none',
  },
  {
    name: 'unknown required uses additional schema',
    schema: { type: 'object', required: ['extra'], additionalProperties: { type: 'integer' } },
    status: 'value',
  },
  {
    name: 'unknown dependency uses additional schema',
    schema: {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      dependentRequired: { a: ['extra'] },
      additionalProperties: { type: 'integer' },
    },
    status: 'value',
  },
  {
    name: 'additional properties fill minProperties',
    schema: {
      type: 'object',
      properties: { a: { type: 'string' } },
      minProperties: 3,
      additionalProperties: { type: 'integer' },
    },
    status: 'value',
  },
  {
    name: 'optional false conjunction is omitted',
    schema: {
      type: 'object',
      properties: { ok: { const: 1 }, bad: { allOf: [{ type: 'string' }, false] } },
      minProperties: 1,
    },
    status: 'value',
  },
  {
    name: 'optional false reference is omitted',
    schema: {
      type: 'object',
      properties: { ok: { const: 1 }, bad: { $ref: '#/components/schemas/Forbidden' } },
      minProperties: 1,
    },
    extra: { Forbidden: false },
    status: 'value',
  },
  {
    name: 'optional impossible lengths are omitted',
    schema: {
      type: 'object',
      properties: { ok: { const: 1 }, bad: { type: 'string', minLength: 3, maxLength: 2 }, never: false },
      minProperties: 1,
      additionalProperties: false,
    },
    status: 'value',
  },
  {
    name: 'zero properties excludes optional fields',
    schema: { type: 'object', properties: { a: { type: 'string' } }, maxProperties: 0 },
    status: 'value',
  },
];
test.each(['3.1.1', '3.2.0'].flatMap((version) => finiteCases.map((fixture) => [version, fixture] as const)))(
  'finds a complete finite candidate or stops without a value in %s: $name',
  async (version, item) => {
    const session = await fixture(item.schema, version, item.extra);
    for (const direction of ['request', 'response'] as const) {
      const result = await generateSchemaExample(session, reference, { direction });
      expect(result.status).toBe(item.status);
      if (result.status === 'value') {
        expect(result).toMatchObject({ validation: 'valid', source: 'generated', authored: false });
        await expect(session.evaluate(reference, result.value)).resolves.toMatchObject({ valid: true });
      }
    }
  },
);
test('keeps separate canonical reference-target and traversal boundaries', async () => {
  const session = await fixture({ $ref: '#/components/schemas/Target' }, '3.1.1', { Target: { type: 'integer' } });
  for (const limit of [2, 3, 4]) {
    const result = await generateSchemaExample(session, reference, {
      direction: 'request',
      limits: { maxReferences: limit },
    });
    expect(result.status).toBe(limit < 3 ? 'none' : 'value');
    if (limit < 3)
      expect(result).toMatchObject({
        reason: 'search-budget-exceeded',
        diagnostics: [expect.objectContaining({ budget: 'maxReferences', actual: 3 })],
      });
  }
  sessions.pop()!.dispose();
  const distinct = await fixture(
    {
      type: 'object',
      properties: { a: { $ref: '#/components/schemas/A' }, b: { $ref: '#/components/schemas/B' } },
      required: ['a', 'b'],
    },
    '3.2.0',
    { A: { type: 'string' }, B: { type: 'string' } },
  );
  for (const limit of [1, 2, 3]) {
    const result = await generateSchemaExample(distinct, reference, {
      direction: 'request',
      limits: { maxReferenceTargets: limit },
    });
    expect(result.status).toBe(limit < 2 ? 'none' : 'value');
    if (limit < 2)
      expect(result).toMatchObject({
        reason: 'search-budget-exceeded',
        diagnostics: [expect.objectContaining({ budget: 'maxReferenceTargets', actual: 2 })],
      });
  }
});

test('enforces checkpoint duration at L-1 / L / L+1 without changing explicit author values', async () => {
  const session = await fixture({ type: 'integer' });
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const controlled: sessionsModule.SchemaDocumentSession = {
    ...session,
    resolve: async (ref) => {
      const node = await session.resolve(ref);
      now = 2;
      return node;
    },
    evaluateDirectionally: (ref, value, direction, _ignored, options) =>
      sessionsModule.evaluateSchemaDocumentDirectionally(session, ref, value, direction, options),
  };
  for (const limit of [1, 2, 3]) {
    now = 0;
    const result = await generateSchemaExample(controlled, reference, {
      direction: 'request',
      limits: { maxDurationMs: limit },
    });
    if (limit === 1)
      expect(result).toMatchObject({
        status: 'none',
        reason: 'search-budget-exceeded',
        diagnostics: [expect.objectContaining({ budget: 'maxDurationMs', limit: 1, actual: 2 })],
      });
    else expect(result).toMatchObject({ status: 'value', validation: 'valid' });
  }
  now = 0;
  await expect(
    generateSchemaExample(controlled, reference, {
      direction: 'request',
      limits: { maxDurationMs: 1 },
      explicit: [{ source: 'media-example', value: 7 }],
    }),
  ).resolves.toMatchObject({ status: 'value', value: 7, source: 'media-example', authored: true, validation: 'valid' });
});
test.each([19_999, 20_000, 20_001])('enforces the frozen output-node limit for %i complete nodes', async (nodes) => {
  const object = Object.fromEntries(Array.from({ length: nodes - 2 }, (_, i) => [`key${i}`, null]));
  const session = await fixture({ type: 'object', properties: { payload: { const: object } }, required: ['payload'] });
  const result = await generateSchemaExample(session, reference, { direction: 'request' });
  if (nodes > 20_000)
    expect(result).toMatchObject({
      status: 'none',
      reason: 'search-budget-exceeded',
      diagnostics: [expect.objectContaining({ budget: 'maxOutputNodes', limit: 20_000, actual: nodes })],
    });
  else {
    expect(result).toMatchObject({ status: 'value', validation: 'valid' });
    if (result.status === 'value')
      await expect(session.evaluate(reference, result.value)).resolves.toMatchObject({ valid: true });
  }
});
test.each([1_048_575, 1_048_576, 1_048_577])(
  'measures compact JSON UTF-8 bytes at the frozen %i-byte boundary',
  async (bytes) => {
    const baseBytes = new TextEncoder().encode(JSON.stringify({ payload: { '': '' } })).byteLength;
    const key = `中${'x'.repeat(bytes - baseBytes - 3)}`;
    const value = { payload: { [key]: '' } };
    expect(new TextEncoder().encode(JSON.stringify(value)).byteLength).toBe(bytes);
    const session = await fixture({
      type: 'object',
      properties: { payload: { const: value.payload } },
      required: ['payload'],
    });
    const result = await generateSchemaExample(session, reference, { direction: 'response' });
    if (bytes > 1_048_576)
      expect(result).toMatchObject({
        status: 'none',
        reason: 'search-budget-exceeded',
        diagnostics: [expect.objectContaining({ budget: 'maxOutputBytes', limit: 1_048_576, actual: bytes })],
      });
    else expect(result).toMatchObject({ status: 'value', validation: 'valid' });
  },
);

test('counts supplementary Unicode characters as one generated string code point', async () => {
  const session = await fixture({ type: 'object', properties: { emoji: { const: '😀😀' } }, required: ['emoji'] });
  await expect(
    generateSchemaExample(session, reference, { direction: 'response', limits: { maxStringLength: 2 } }),
  ).resolves.toMatchObject({ status: 'value', validation: 'valid', value: { emoji: '😀😀' } });
  await expect(
    generateSchemaExample(session, reference, { direction: 'response', limits: { maxStringLength: 1 } }),
  ).resolves.toMatchObject({
    status: 'none',
    reason: 'search-budget-exceeded',
    diagnostics: [expect.objectContaining({ budget: 'maxStringLength', limit: 1, actual: 2 })],
  });
});

test.each([true, false])(
  'stops incremental object output assembly before resolving later fields (required=%s)',
  async (required) => {
    const names = Array.from({ length: 1000 }, (_, index) => `field${index}`);
    const targets = Object.fromEntries(names.map((_, index) => [`Text${index}`, { const: 'x'.repeat(4096) }]));
    const session = await fixture(
      {
        type: 'object',
        properties: Object.fromEntries(
          names.map((name, index) => [name, { $ref: `#/components/schemas/Text${index}` }]),
        ),
        required: required ? names : [],
      },
      '3.1.1',
      targets,
    );
    const resolve = vi.fn(session.resolve.bind(session));
    const result = await generateSchemaExample({ ...session, resolve }, reference, { direction: 'request' });
    expect(result).toMatchObject({
      status: 'none',
      reason: 'search-budget-exceeded',
      diagnostics: [expect.objectContaining({ budget: 'maxOutputBytes', limit: 1_048_576 })],
    });
    const indices = resolve.mock.calls.flatMap(([ref]) => {
      const match = /Text(\d+)$/.exec(ref);
      return match ? [Number(match[1])] : [];
    });
    expect(indices.length).toBeGreaterThan(0);
    expect(Math.max(...indices)).toBeLessThan(256);
    expect(indices).not.toContain(999);
  },
);
test('stops incremental array output assembly before resolving later prefix items', async () => {
  const chunk = {
    type: 'object',
    properties: Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [`text${index}`, { const: 'x'.repeat(4096) }]),
    ),
    required: Array.from({ length: 8 }, (_, index) => `text${index}`),
  };
  const targets = Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`Chunk${index}`, chunk]));
  const session = await fixture(
    {
      type: 'array',
      prefixItems: Array.from({ length: 64 }, (_, index) => ({ $ref: `#/components/schemas/Chunk${index}` })),
      minItems: 64,
      maxItems: 64,
    },
    '3.2.0',
    targets,
  );
  const resolve = vi.fn(session.resolve.bind(session));
  const result = await generateSchemaExample({ ...session, resolve }, reference, { direction: 'response' });
  expect(result).toMatchObject({
    status: 'none',
    reason: 'search-budget-exceeded',
    diagnostics: [expect.objectContaining({ budget: 'maxOutputBytes', limit: 1_048_576 })],
  });
  const indices = resolve.mock.calls.flatMap(([ref]) => {
    const match = /Chunk(\d+)$/.exec(ref);
    return match ? [Number(match[1])] : [];
  });
  expect(Math.max(...indices)).toBeLessThan(32);
});

test('rolls back incremental optional dependency output without charging abandoned members again', async () => {
  const expected = { id: 1, c: 'cccc' };
  const session = await fixture(
    {
      type: 'object',
      properties: {
        id: { const: 1 },
        a: { const: 'aaa' },
        b: { $ref: '#/components/schemas/Forbidden' },
        c: { const: 'cccc' },
      },
      required: ['id'],
      dependentRequired: { a: ['b'] },
      additionalProperties: false,
    },
    '3.1.1',
    { Forbidden: false },
  );
  await expect(
    generateSchemaExample(session, reference, {
      direction: 'request',
      limits: {
        maxOutputNodes: 3,
        maxOutputBytes: new TextEncoder().encode(JSON.stringify(expected)).byteLength,
      },
    }),
  ).resolves.toMatchObject({ status: 'value', value: expected, validation: 'valid' });
});
test('measures incremental allOf overlays at exact final-member node and UTF-8 boundaries', async () => {
  const expected = { id: 1, x: '中😀' };
  const bytes = new TextEncoder().encode(JSON.stringify(expected)).byteLength;
  const session = await fixture({
    type: 'object',
    allOf: [
      { type: 'object', properties: { id: { const: 1 }, x: { type: 'string', minLength: 1 } }, required: ['id', 'x'] },
      { type: 'object', properties: { x: { const: '中😀' } }, required: ['x'] },
    ],
  });
  for (const limit of [bytes - 1, bytes, bytes + 1]) {
    const result = await generateSchemaExample(session, reference, {
      direction: 'response',
      limits: { maxOutputBytes: limit, maxOutputNodes: 3 },
    });
    if (limit < bytes)
      expect(result).toMatchObject({
        status: 'none',
        reason: 'search-budget-exceeded',
        diagnostics: [expect.objectContaining({ budget: 'maxOutputBytes', limit, actual: bytes })],
      });
    else expect(result).toMatchObject({ status: 'value', value: expected, validation: 'valid' });
  }
});
test('measures incremental array punctuation and Unicode at L-1 / L / L+1', async () => {
  const expected = ['中', '😀'];
  const bytes = new TextEncoder().encode(JSON.stringify(expected)).byteLength;
  const session = await fixture({
    type: 'array',
    prefixItems: [{ const: '中' }, { const: '😀' }],
    minItems: 2,
    maxItems: 2,
    items: false,
  });
  for (const limit of [bytes - 1, bytes, bytes + 1]) {
    const result = await generateSchemaExample(session, reference, {
      direction: 'request',
      limits: { maxOutputBytes: limit, maxOutputNodes: 3 },
    });
    if (limit < bytes)
      expect(result).toMatchObject({
        status: 'none',
        reason: 'search-budget-exceeded',
        diagnostics: [expect.objectContaining({ budget: 'maxOutputBytes', limit, actual: bytes })],
      });
    else expect(result).toMatchObject({ status: 'value', value: expected, validation: 'valid' });
  }
});

test.each([256, 257])(
  'allows exactly 256 global changes before a usable branch (%i false branches)',
  async (falseBranches) => {
    const session = await fixture({ anyOf: [...Array.from({ length: falseBranches }, () => false), { const: 257 }] });
    const evaluate = vi.spyOn(sessionsModule, 'evaluateSchemaDocumentDirectionally');
    const result = await generateSchemaExample(session, reference, { direction: 'request' });
    if (falseBranches === 256) {
      expect(result).toMatchObject({ status: 'value', source: 'generated', validation: 'valid', value: 257 });
      expect(evaluate).toHaveBeenCalledTimes(1);
    } else {
      expect(result).toMatchObject({
        status: 'none',
        reason: 'search-budget-exceeded',
        diagnostics: [expect.objectContaining({ budget: 'maxSearchChoices', limit: 256, actual: 257 })],
      });
      expect(evaluate).not.toHaveBeenCalled();
    }
  },
);
test('measures escaped characters and lone surrogates without serializing a full output prefix', async () => {
  const key = 'quote"\\\n\u0001中';
  const value = 'quote"\\\t\b\f\r\u0002\udfff';
  const expected = { [key]: value };
  const bytes = new TextEncoder().encode(JSON.stringify(expected)).byteLength;
  const session = await fixture({ type: 'object', properties: { [key]: { const: value } }, required: [key] });
  for (const limit of [bytes - 1, bytes, bytes + 1]) {
    const result = await generateSchemaExample(session, reference, {
      direction: 'request',
      limits: { maxOutputBytes: limit },
    });
    if (limit < bytes)
      expect(result).toMatchObject({
        status: 'none',
        reason: 'search-budget-exceeded',
        diagnostics: [expect.objectContaining({ budget: 'maxOutputBytes', actual: bytes })],
      });
    else expect(result).toMatchObject({ status: 'value', value: expected, validation: 'valid' });
  }
});

test('rejects an oversized nested author literal before cloning the automatic candidate', async () => {
  const literal = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`part${index}`, 'x'.repeat(4096)]));
  const session = await fixture({ type: 'object', properties: { payload: { const: literal } }, required: ['payload'] });
  const clone = vi.spyOn(globalThis, 'structuredClone');
  const result = await generateSchemaExample(session, reference, { direction: 'request' });
  expect(result).toMatchObject({
    status: 'none',
    reason: 'search-budget-exceeded',
    diagnostics: [expect.objectContaining({ budget: 'maxOutputBytes', limit: 1_048_576, path: '/payload' })],
  });
  expect(clone.mock.calls.some(([value]) => value !== null && typeof value === 'object' && 'part299' in value)).toBe(
    false,
  );
});
