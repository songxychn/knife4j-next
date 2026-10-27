import { afterEach, describe, expect, test, vi } from 'vitest';
import { createSchemaEngine, type SchemaEngine, type SchemaEngineOptions } from '../src';

const materializations = vi.hoisted(() => ({ count: 0 }));
vi.mock('@hyperjump/json-schema/experimental', async (importOriginal) => {
  const original = await importOriginal<typeof import('@hyperjump/json-schema/experimental')>();
  return {
    ...original,
    toSchema: (...args: Parameters<typeof original.toSchema>) => {
      materializations.count += 1;
      return original.toSchema(...args);
    },
  };
});

const engines: SchemaEngine[] = [];
const engine = (options?: SchemaEngineOptions): SchemaEngine => {
  const value = createSchemaEngine(options);
  engines.push(value);
  return value;
};
afterEach(() => {
  engines.splice(0).forEach((value) => value.dispose());
  vi.restoreAllMocks();
  materializations.count = 0;
});

const wideDocument = (version: string, width = 1000, composed = false) => ({
  openapi: version,
  info: { title: 'Legal wide component references', version: '1' },
  paths: {},
  components: {
    schemas: {
      Root: {
        type: 'object',
        required: Array.from({ length: width }, (_, i) => `field${i}`),
        properties: Object.fromEntries(
          Array.from({ length: width }, (_, i) => [`field${i}`, { $ref: `#/components/schemas/Value${i}` }]),
        ),
      },
      ...Object.fromEntries(
        Array.from({ length: width }, (_, i) => [
          `Value${i}`,
          {
            type: 'string',
            minLength: 1,
            maxLength: 40,
            ...(composed
              ? { allOf: [{ type: 'string', minLength: 1 }, { maxLength: 40 }, { pattern: '^value' }] }
              : {}),
          },
        ]),
      ),
    },
  },
});
const instance = (width = 1000) =>
  Object.fromEntries(Array.from({ length: width }, (_, i) => [`field${i}`, `value${i}`]));

describe('wide registered schemas', () => {
  test('validates a legal 3.2 thousand-component model with the default independent meta budget', async () => {
    const value = engine();
    await value.registerDocument(wideDocument('3.2.0', 1000, true), 'https://wide.test/openapi.json');
    await expect(
      value.evaluate('https://wide.test/openapi.json#/components/schemas/Root', instance()),
    ).resolves.toMatchObject({
      valid: true,
    });
  });

  test('materializes a registered 3.1 resource once across a thousand distinct real Schema targets', async () => {
    const value = engine();
    const uri = 'https://wide.test/openapi.json';
    await value.registerDocument(wideDocument('3.1.1'), uri);
    const start = performance.now();
    for (let i = 0; i < 1000; i += 1) {
      expect((await value.resolve(`${uri}#/components/schemas/Value${i}`)).schema).toMatchObject({ type: 'string' });
    }
    console.info(`1000 distinct registered component resolves: ${(performance.now() - start).toFixed(2)}ms`);
    expect(materializations.count).toBe(1);
    const first = await value.resolve(`${uri}#/components/schemas/Value0`);
    (first.schema as Record<string, unknown>).type = 'number';
    expect((await value.resolve(`${uri}#/components/schemas/Value0`)).schema).toMatchObject({ type: 'string' });
    value.unregisterDocument(uri);
    await expect(value.resolve(`${uri}#/components/schemas/Value0`)).rejects.toMatchObject({
      code: 'EXTERNAL_RESOURCE_LOADING_DISABLED',
    });
    const changed = wideDocument('3.1.1');
    changed.components.schemas.Value0.type = 'number';
    await value.registerDocument(changed, uri);
    expect((await value.resolve(`${uri}#/components/schemas/Value0`)).schema).toMatchObject({ type: 'number' });
    expect(materializations.count).toBe(2);
  });
});

describe('independent 3.2 meta-validation limits', () => {
  test('keeps the instance keyword budget independent from successful meta-validation', async () => {
    const value = engine({ limits: { maxEvaluationSteps: 10 } });
    const uri = 'urn:test:separate-steps';
    await value.registerDocument(wideDocument('3.2.0', 10), uri);
    for (let attempt = 0; attempt < 2; attempt += 1)
      await expect(value.evaluate(`${uri}#/components/schemas/Root`, instance(10))).rejects.toMatchObject({
        code: 'EVALUATION_BUDGET_EXCEEDED',
        details: { limit: 10, actual: 11 },
      });
    // A cached successful meta check must allow a small sibling evaluation.
    await expect(value.evaluate(`${uri}#/components/schemas/Value0`, 'ok')).resolves.toMatchObject({ valid: true });
  });

  test('enforces the separate meta keyword limit without caching a budget failure', async () => {
    const value = engine({ limits: { maxMetaEvaluationSteps: 1 } });
    const uri = 'urn:test:meta-limit';
    await value.registerDocument(wideDocument('3.2.0', 1), uri);
    for (let attempt = 0; attempt < 2; attempt += 1)
      await expect(value.evaluate(`${uri}#/components/schemas/Value0`, 'ok')).rejects.toMatchObject({
        code: 'EVALUATION_BUDGET_EXCEEDED',
        details: { limit: 1, actual: 2 },
      });
  });

  test('shares one meta step budget across the entry and all registered dependencies', async () => {
    const dependency = 'https://wide.test/dependency.json';
    const entry = 'https://wide.test/entry.json';
    const limit = 10_000;
    const value = engine({ limits: { maxMetaEvaluationSteps: limit } });
    await value.registerDocument(wideDocument('3.2.0', 60), dependency);
    await expect(value.evaluate(`${dependency}#/components/schemas/Root`, instance(60))).resolves.toMatchObject({
      valid: true,
    });
    value.unregisterDocument(dependency);
    await value.registerDocument(wideDocument('3.2.0', 60), dependency);
    const document = wideDocument('3.2.0', 60);
    document.components.schemas.Root.properties.field0.$ref = `${dependency}#/components/schemas/Value0`;
    await value.registerDocument(document, entry);
    await expect(value.evaluate(`${entry}#/components/schemas/Root`, instance(60))).rejects.toMatchObject({
      code: 'EVALUATION_BUDGET_EXCEEDED',
      details: { limit, actual: limit + 1 },
    });
  });

  test('preserves the whole evaluation deadline, mid-flight cancellation and retry', async () => {
    const value = engine();
    const uri = 'urn:test:wide-cancellation';
    await value.registerDocument(wideDocument('3.2.0', 10), uri);
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const pending = value.evaluate(`${uri}#/components/schemas/Root`, instance(10));
    now.mockReturnValue(1001);
    await expect(pending).rejects.toMatchObject({ code: 'EVALUATION_BUDGET_EXCEEDED' });
    now.mockRestore();
    const controller = new AbortController();
    const cancelled = value.evaluate(`${uri}#/components/schemas/Root`, instance(10), { signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'OPERATION_ABORTED' });
    await expect(value.evaluate(`${uri}#/components/schemas/Root`, instance(10))).resolves.toMatchObject({
      valid: true,
    });
  });
});
