import { afterEach, describe, expect, test, vi } from 'vitest';
import { addUriSchemePlugin } from '@hyperjump/browser';
import officialSubset from './fixtures/official-2020-12-subset.json';
import springdocDocument from './fixtures/springdoc-openapi-3.1.json';
import boot3MvcSpringdocDocument from '../../ui-react/src/test-fixtures/springdoc-oas31/boot3-mvc-springdoc-2.8.9.json';
import boot3WebfluxSpringdocDocument from '../../ui-react/src/test-fixtures/springdoc-oas31/boot3-webflux-springdoc-2.8.9.json';
import boot4MvcSpringdocDocument from '../../ui-react/src/test-fixtures/springdoc-oas31/boot4-mvc-springdoc-3.0.3.json';
import browserSupplementDocument from '../../ui-react/src/test-fixtures/springdoc-oas31/browser-supplement-3.1.2.json';
import { HyperjumpSchemaEngine, JSON_SCHEMA_2020_12, SchemaEngineError, type SchemaEngine } from '../src';

const engines: SchemaEngine[] = [];

const createEngine = (limits: ConstructorParameters<typeof HyperjumpSchemaEngine>[0] = {}): SchemaEngine => {
  const engine = new HyperjumpSchemaEngine(limits);
  engines.push(engine);
  return engine;
};

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
  vi.restoreAllMocks();
});

describe('official JSON Schema Draft 2020-12 subset', () => {
  test('matches the pinned official cases', async () => {
    const engine = createEngine();

    for (const [groupIndex, group] of officialSubset.groups.entries()) {
      const retrievalUri = `https://official-tests.knife4j.example/group-${groupIndex}`;
      await engine.registerDocument(group.schema, retrievalUri);
      for (const scenario of group.tests) {
        const result = await engine.evaluate(retrievalUri, scenario.data);
        expect(result.valid, `${group.description}: ${scenario.description}`).toBe(scenario.valid);
      }
    }
  });
});

describe('resource graph and evaluation semantics', () => {
  test('honors dynamic scope across registered resources', async () => {
    const engine = createEngine();
    const treeUri = 'https://fixtures.knife4j.example/tree';
    const strictTreeUri = 'https://fixtures.knife4j.example/strict-tree';

    await engine.registerDocument(
      {
        $schema: JSON_SCHEMA_2020_12,
        $id: treeUri,
        $dynamicAnchor: 'node',
        type: 'object',
        properties: {
          data: true,
          children: { type: 'array', items: { $dynamicRef: '#node' } },
        },
      },
      treeUri,
    );
    await engine.registerDocument(
      {
        $schema: JSON_SCHEMA_2020_12,
        $id: strictTreeUri,
        $dynamicAnchor: 'node',
        $ref: treeUri,
        unevaluatedProperties: false,
      },
      strictTreeUri,
    );

    await expect(
      engine.evaluate(strictTreeUri, { data: 1, children: [{ data: 2, children: [] }] }),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      engine.evaluate(strictTreeUri, { data: 1, children: [{ data: 2, extra: true }] }),
    ).resolves.toMatchObject({ valid: false });

    const node = await engine.resolve(strictTreeUri);
    expect(node.dialectId).toBe(JSON_SCHEMA_2020_12);
    expect(node.dynamicAnchors).toHaveProperty('node');
  });

  test('resolves embedded resources, anchors, and boolean schemas', async () => {
    const engine = createEngine();
    const containerUri = 'https://fixtures.knife4j.example/container';
    const embeddedUri = 'https://fixtures.knife4j.example/postal';
    const falseUri = 'https://fixtures.knife4j.example/never';

    await engine.registerDocument(
      {
        $schema: JSON_SCHEMA_2020_12,
        $id: containerUri,
        $defs: {
          postal: {
            $id: embeddedUri,
            $anchor: 'value',
            type: 'string',
            pattern: '^[0-9]{6}$',
          },
        },
        $ref: `${embeddedUri}#value`,
      },
      containerUri,
    );
    await engine.registerDocument(false, falseUri);

    const embedded = await engine.resolve(`${embeddedUri}#value`);
    expect(embedded.resourceUri).toBe(embeddedUri);
    expect(embedded.anchors).toHaveProperty('value');
    expect(embedded.schema).toMatchObject({ type: 'string', pattern: '^[0-9]{6}$' });
    await expect(engine.evaluate(containerUri, '310000')).resolves.toMatchObject({ valid: true });
    await expect(engine.evaluate(containerUri, 'invalid')).resolves.toMatchObject({ valid: false });
    await expect(engine.evaluate(falseUri, null)).resolves.toMatchObject({ valid: false });
  });

  test('normalizes empty-fragment identifiers and resolves non-HTTP IRI resources', async () => {
    const engine = createEngine();
    const retrievalUri = 'urn:knife4j:container';
    await engine.registerDocument(
      {
        $schema: JSON_SCHEMA_2020_12,
        $id: `${retrievalUri}#`,
        $defs: {
          value: { $id: 'value', type: 'string' },
        },
      },
      retrievalUri,
    );

    const root = await engine.resolve(retrievalUri);
    expect(root.resourceUri).toBe(retrievalUri);
    await expect(engine.evaluate('urn:value', 'ok')).resolves.toMatchObject({ valid: true });
    await expect(engine.evaluate('urn:value', 1)).resolves.toMatchObject({ valid: false });
  });

  test('returns Knife4j-owned annotations and validation issues', async () => {
    const engine = createEngine();
    const uri = 'https://fixtures.knife4j.example/annotations';
    await engine.registerDocument(
      {
        $schema: JSON_SCHEMA_2020_12,
        title: 'Pet identifier',
        type: 'string',
        minLength: 3,
      },
      uri,
    );

    const valid = await engine.evaluate(uri, 'pet-1');
    expect(valid.annotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instanceLocation: '',
          keywordId: 'https://json-schema.org/keyword/title',
          values: ['Pet identifier'],
        }),
      ]),
    );
    const invalid = await engine.evaluate(uri, 'x');
    expect(invalid.valid).toBe(false);
    expect(invalid.errors[0]).toMatchObject({ valid: false, instanceLocation: '' });
  });

  test('invalidates compiled schemas and browser contexts when dependencies change', async () => {
    const engine = createEngine();
    const valueUri = 'https://fixtures.knife4j.example/cache-value';
    const rootUri = 'https://fixtures.knife4j.example/cache-root';

    await engine.registerDocument({ $schema: JSON_SCHEMA_2020_12, type: 'string' }, valueUri);
    await engine.registerDocument({ $schema: JSON_SCHEMA_2020_12, $ref: valueUri }, rootUri);
    await expect(engine.evaluate(rootUri, 'value')).resolves.toMatchObject({ valid: true });

    engine.unregisterDocument(valueUri);
    await expect(engine.evaluate(rootUri, 'value')).rejects.toMatchObject({
      code: 'EXTERNAL_RESOURCE_LOADING_DISABLED',
    });

    await engine.registerDocument({ $schema: JSON_SCHEMA_2020_12, type: 'integer' }, valueUri);
    await expect(engine.evaluate(rootUri, 1)).resolves.toMatchObject({ valid: true });
    await expect(engine.evaluate(rootUri, 'value')).resolves.toMatchObject({ valid: false });
  });
});

describe('OpenAPI 3.1 and resource policy', () => {
  test('registers and evaluates the real Springdoc 2.8.9 and 3.0.3 matrix snapshots', async () => {
    const engine = createEngine();
    const snapshots = [
      ['boot3-mvc', boot3MvcSpringdocDocument],
      ['boot3-webflux', boot3WebfluxSpringdocDocument],
      ['boot4-mvc', boot4MvcSpringdocDocument],
    ] as const;

    for (const [name, document] of snapshots) {
      const documentUri = `https://fixtures.knife4j.example/springdoc/${name}.json`;
      await engine.registerDocument(document, documentUri);

      await expect(engine.evaluate('https://spec.openapis.org/oas/3.1/schema-base', document)).resolves.toMatchObject({
        valid: true,
      });
      await expect(
        engine.evaluate(`${documentUri}#/components/schemas/Oas31MatrixRequest`, {
          nullableName: null,
          metadata: {},
          mode: 'stable',
          tuple: ['first', 2],
        }),
      ).resolves.toMatchObject({ valid: true });
      await expect(
        engine.evaluate(`${documentUri}#/components/schemas/Oas31MatrixRequest`, {
          mode: 'changed',
          tuple: ['only-one'],
        }),
      ).resolves.toMatchObject({ valid: false });

      const response = await engine.resolve(`${documentUri}#/components/schemas/Oas31MatrixResponse`);
      expect(response.schema).toMatchObject({
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'integer', format: 'int64' },
          serverValue: { readOnly: true },
          clientSecret: { writeOnly: true },
        },
      });
    }
  });

  test('validates the standards-only supplement and keeps its external schema registry-only', async () => {
    const engine = createEngine();
    const documentUri = 'https://fixtures.knife4j.example/springdoc/browser-supplement.json';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not be called'));
    await engine.registerDocument(browserSupplementDocument, documentUri);

    await expect(
      engine.evaluate('https://spec.openapis.org/oas/3.1/schema-base', browserSupplementDocument),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      engine.evaluate(`${documentUri}#/components/schemas/TypedTuple`, ['stable', 1]),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      engine.evaluate(`${documentUri}#/components/schemas/TypedTuple`, ['stable', 'one']),
    ).resolves.toMatchObject({ valid: false });
    await expect(engine.evaluate(`${documentUri}#/components/schemas/ExternalPayload`, {})).rejects.toMatchObject({
      code: 'EXTERNAL_RESOURCE_LOADING_DISABLED',
      details: { resourceUri: 'https://unapproved.knife4j.example/schema.json' },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('validates a fixed Springdoc-style document and its component schemas', async () => {
    const engine = createEngine();
    const documentUri = 'https://fixtures.knife4j.example/springdoc.openapi.json';
    await engine.registerDocument(springdocDocument, documentUri);

    await expect(
      engine.evaluate('https://spec.openapis.org/oas/3.1/schema-base', springdocDocument),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      engine.evaluate(`${documentUri}#/components/schemas/Pet`, { id: 1, name: 'Knife', nickname: null }),
    ).resolves.toMatchObject({ valid: true });
    await expect(engine.evaluate(`${documentUri}#/components/schemas/Pet`, { name: '' })).resolves.toMatchObject({
      valid: false,
    });

    const pet = await engine.resolve(`${documentUri}#/components/schemas/Pet`);
    expect(pet.schema).toMatchObject({ type: 'object', required: ['id', 'name'] });
    expect(pet.schema).not.toHaveProperty('openapi');
  });

  test('rejects custom OpenAPI dialects explicitly', async () => {
    const engine = createEngine();
    await expect(
      engine.registerDocument(
        {
          openapi: '3.1.1',
          jsonSchemaDialect: 'https://dialects.knife4j.example/custom',
          info: { title: 'Unsupported', version: '1.0.0' },
          paths: {},
        },
        'https://fixtures.knife4j.example/custom.openapi.json',
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_DIALECT' });

    await expect(
      engine.registerDocument(
        { $schema: 'https://json-schema.org/draft/2019-09/schema', type: 'string' },
        'https://fixtures.knife4j.example/unsupported-json-schema',
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_DIALECT' });
  });

  test('rejects missing external resources without calling fetch', async () => {
    const engine = createEngine();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not be called'));
    const rootUri = 'https://fixtures.knife4j.example/network-root';
    await engine.registerDocument(
      {
        $schema: JSON_SCHEMA_2020_12,
        $ref: 'https://unregistered.knife4j.example/external',
      },
      rootUri,
    );

    await expect(engine.evaluate(rootUri, 'value')).rejects.toMatchObject({
      code: 'EXTERNAL_RESOURCE_LOADING_DISABLED',
      details: { resourceUri: 'https://unregistered.knife4j.example/external' },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('reapplies the registry-only policy before every public operation', async () => {
    const engine = createEngine();
    const rootUri = 'https://fixtures.knife4j.example/relock-root';
    let retrievalCalls = 0;
    await engine.registerDocument(
      { $schema: JSON_SCHEMA_2020_12, $ref: 'https://unregistered.knife4j.example/relocked' },
      rootUri,
    );
    addUriSchemePlugin('https', {
      retrieve: async () => {
        retrievalCalls += 1;
        throw new Error('The re-enabled network plugin must be removed before evaluation.');
      },
    });

    await expect(engine.evaluate(rootUri, null)).rejects.toMatchObject({
      code: 'EXTERNAL_RESOURCE_LOADING_DISABLED',
    });
    expect(retrievalCalls).toBe(0);
  });

  test('detects URI conflicts and isolates the realm-global registry owner', async () => {
    const first = createEngine();
    const second = createEngine();
    const uri = 'https://fixtures.knife4j.example/owner';
    await first.registerDocument(true, uri);

    await expect(second.registerDocument(true, 'https://fixtures.knife4j.example/second')).rejects.toMatchObject({
      code: 'ENGINE_SCOPE_CONFLICT',
    });
    await expect(first.registerDocument(false, uri)).rejects.toMatchObject({
      code: 'DOCUMENT_ALREADY_REGISTERED',
    });

    first.dispose();
    await expect(second.registerDocument(true, 'https://fixtures.knife4j.example/second')).resolves.toBeUndefined();
  });

  test('does not leak registry entries when disposal follows registration immediately', async () => {
    const first = createEngine();
    const uri = 'https://fixtures.knife4j.example/immediate-dispose';
    const registration = first.registerDocument(true, uri);
    first.dispose();
    await registration;

    const second = createEngine();
    await expect(second.registerDocument(false, uri)).resolves.toBeUndefined();
    await expect(second.evaluate(uri, null)).resolves.toMatchObject({ valid: false });
  });

  test('rejects duplicate embedded resource identifiers without contaminating the registry', async () => {
    const engine = createEngine();
    const retrievalUri = 'https://fixtures.knife4j.example/duplicate-root';
    await expect(
      engine.registerDocument(
        {
          $schema: JSON_SCHEMA_2020_12,
          $defs: {
            first: { $id: 'shared', type: 'string' },
            second: { $id: 'shared', type: 'integer' },
          },
        },
        retrievalUri,
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_URI_CONFLICT' });

    await expect(engine.registerDocument(true, retrievalUri)).resolves.toBeUndefined();
  });

  test('rejects duplicate or malformed anchors within one schema resource', async () => {
    const engine = createEngine();
    await expect(
      engine.registerDocument(
        {
          $schema: JSON_SCHEMA_2020_12,
          $defs: {
            first: { $anchor: 'shared', type: 'string' },
            second: { $dynamicAnchor: 'shared', type: 'integer' },
          },
        },
        'https://fixtures.knife4j.example/duplicate-anchor',
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_URI_CONFLICT' });
    await expect(
      engine.registerDocument(
        { $schema: JSON_SCHEMA_2020_12, $anchor: 'contains space' },
        'https://fixtures.knife4j.example/invalid-anchor',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' });
  });
});

describe('resource budgets and cancellation', () => {
  test('rejects schemas and instances before they exceed structural budgets', async () => {
    const schemaLimited = createEngine({ limits: { maxSchemaNodes: 5 } });
    await expect(
      schemaLimited.registerDocument(
        { $schema: JSON_SCHEMA_2020_12, type: 'object', properties: { a: { type: 'string' } } },
        'https://fixtures.knife4j.example/schema-budget',
      ),
    ).rejects.toMatchObject({ code: 'SCHEMA_BUDGET_EXCEEDED' });
    schemaLimited.dispose();

    const instanceLimited = createEngine({ limits: { maxInstanceDepth: 2 } });
    const uri = 'https://fixtures.knife4j.example/instance-budget';
    await instanceLimited.registerDocument(true, uri);
    await expect(instanceLimited.evaluate(uri, { a: { b: { c: true } } })).rejects.toMatchObject({
      code: 'INSTANCE_BUDGET_EXCEEDED',
    });
  });

  test('enforces evaluation steps and AbortSignal cancellation', async () => {
    const stepLimited = createEngine({ limits: { maxEvaluationSteps: 1 } });
    const uri = 'https://fixtures.knife4j.example/evaluation-budget';
    await stepLimited.registerDocument(
      { $schema: JSON_SCHEMA_2020_12, allOf: [{ type: 'string' }, { minLength: 1 }] },
      uri,
    );
    await expect(stepLimited.evaluate(uri, 'value')).rejects.toMatchObject({ code: 'EVALUATION_BUDGET_EXCEEDED' });
    stepLimited.dispose();

    const cancellable = createEngine();
    const cancelUri = 'https://fixtures.knife4j.example/cancel';
    await cancellable.registerDocument(true, cancelUri);
    const controller = new AbortController();
    controller.abort();
    await expect(cancellable.evaluate(cancelUri, null, { signal: controller.signal })).rejects.toMatchObject({
      code: 'OPERATION_ABORTED',
    });
  });

  test('enforces the evaluation time deadline', async () => {
    const engine = createEngine({ limits: { maxEvaluationMs: 1 } });
    const uri = 'https://fixtures.knife4j.example/time-budget';
    await engine.registerDocument(true, uri);
    vi.spyOn(globalThis.performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(2);

    await expect(engine.evaluate(uri, null)).rejects.toMatchObject({ code: 'EVALUATION_BUDGET_EXCEEDED' });
  });

  test('rejects non-JSON instances with a stable classification', async () => {
    const engine = createEngine();
    const uri = 'https://fixtures.knife4j.example/json-only';
    await engine.registerDocument(true, uri);
    await expect(engine.evaluate(uri, Number.NaN)).rejects.toBeInstanceOf(SchemaEngineError);
    await expect(engine.evaluate(uri, Number.NaN)).rejects.toMatchObject({ code: 'INVALID_INSTANCE' });
  });
});
