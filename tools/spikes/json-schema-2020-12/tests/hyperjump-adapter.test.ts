import { afterAll, describe, expect, test } from 'bun:test'
import {
  HyperjumpSchemaEngineProbe,
  JSON_SCHEMA_2020_12,
  SchemaResourcePolicyError,
} from '../src/hyperjump-adapter'

const engine = new HyperjumpSchemaEngineProbe()

afterAll(() => {
  engine.dispose()
})

describe('JSON Schema 2020-12 resource and evaluation semantics', () => {
  test('honors dynamic scope across registered schema resources', async () => {
    const treeUri = 'https://fixtures.knife4j.example/tree'
    const strictTreeUri = 'https://fixtures.knife4j.example/strict-tree'

    await engine.registerDocument(
      {
        $schema: JSON_SCHEMA_2020_12,
        $id: treeUri,
        $dynamicAnchor: 'node',
        type: 'object',
        properties: {
          data: true,
          children: {
            type: 'array',
            items: { $dynamicRef: '#node' },
          },
        },
      },
      treeUri,
    )
    await engine.registerDocument(
      {
        $schema: JSON_SCHEMA_2020_12,
        $id: strictTreeUri,
        $dynamicAnchor: 'node',
        $ref: treeUri,
        unevaluatedProperties: false,
      },
      strictTreeUri,
    )

    await expect(
      engine.evaluate(strictTreeUri, {
        data: 1,
        children: [{ data: 2, children: [] }],
      }),
    ).resolves.toMatchObject({ valid: true })
    await expect(
      engine.evaluate(strictTreeUri, {
        data: 1,
        children: [{ data: 2, extra: true }],
      }),
    ).resolves.toMatchObject({ valid: false })

    const resource = await engine.resolve(strictTreeUri)
    expect(resource.dialectId).toBe(JSON_SCHEMA_2020_12)
    expect(resource.dynamicAnchors).toHaveProperty('node')
  })

  test('resolves embedded resources, anchors, and boolean schemas', async () => {
    const containerUri = 'https://fixtures.knife4j.example/container'
    const embeddedUri = 'https://fixtures.knife4j.example/postal'
    const falseUri = 'https://fixtures.knife4j.example/never'

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
    )
    await engine.registerDocument(false, falseUri)

    const embedded = await engine.resolve(`${embeddedUri}#value`)
    expect(embedded.baseUri).toBe(embeddedUri)
    expect(embedded.anchors).toHaveProperty('value')
    await expect(
      engine.evaluate(`${embeddedUri}#value`, '310000'),
    ).resolves.toMatchObject({ valid: true })
    await expect(engine.evaluate(containerUri, '310000')).resolves.toMatchObject({
      valid: true,
    })
    await expect(engine.evaluate(containerUri, 'invalid')).resolves.toMatchObject({
      valid: false,
    })
    await expect(engine.evaluate(falseUri, null)).resolves.toMatchObject({
      valid: false,
    })
  })

  test('honors unevaluatedItems after prefixItems', async () => {
    const tupleUri = 'https://fixtures.knife4j.example/tuple'
    await engine.registerDocument(
      {
        $schema: JSON_SCHEMA_2020_12,
        prefixItems: [{ type: 'string' }],
        unevaluatedItems: false,
      },
      tupleUri,
    )

    await expect(engine.evaluate(tupleUri, ['ok'])).resolves.toMatchObject({
      valid: true,
    })
    await expect(engine.evaluate(tupleUri, ['ok', 2])).resolves.toMatchObject({
      valid: false,
    })
  })

  test('returns annotations from the actual successful evaluation', async () => {
    const annotationUri = 'https://fixtures.knife4j.example/annotations'
    await engine.registerDocument(
      {
        $schema: JSON_SCHEMA_2020_12,
        title: 'Pet identifier',
        description: 'A stable pet id',
        type: 'string',
        default: 'pet-1',
        examples: ['pet-2'],
      },
      annotationUri,
    )

    const result = await engine.evaluate(annotationUri, 'pet-3')
    expect(result.valid).toBe(true)
    expect(result.annotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instanceLocation: '',
          keywordId: 'https://json-schema.org/keyword/title',
          values: ['Pet identifier'],
        }),
      ]),
    )
  })

  test('bundles registered resources without rewriting their reference identity', async () => {
    const valueUri = 'https://fixtures.knife4j.example/value'
    const rootUri = 'https://fixtures.knife4j.example/bundle-root'
    await engine.registerDocument(
      {
        $schema: JSON_SCHEMA_2020_12,
        $id: valueUri,
        type: 'string',
      },
      valueUri,
    )
    await engine.registerDocument(
      {
        $schema: JSON_SCHEMA_2020_12,
        $id: rootUri,
        type: 'object',
        properties: { value: { $ref: valueUri } },
      },
      rootUri,
    )

    const bundled = (await engine.bundle(rootUri)) as Record<string, unknown>
    expect(JSON.stringify(bundled)).toContain(valueUri)
    expect(bundled).toHaveProperty('$defs')
  })
})

describe('OpenAPI 3.1 dialect and browser resource policy', () => {
  test('evaluates a springdoc-style Schema Object in an OpenAPI 3.1 document', async () => {
    const documentUri = 'https://fixtures.knife4j.example/springdoc.openapi.json'
    const document = {
      openapi: '3.1.1',
      info: { title: 'Springdoc probe', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          Pet: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'integer', format: 'int64' },
              nickname: { type: ['string', 'null'] },
            },
          },
        },
      },
    }

    await engine.registerDocument(document, documentUri)
    await expect(
      engine.evaluate('https://spec.openapis.org/oas/3.1/schema-base', document),
    ).resolves.toMatchObject({ valid: true })
    await expect(
      engine.evaluate(`${documentUri}#/components/schemas/Pet`, {
        id: 1,
        nickname: null,
      }),
    ).resolves.toMatchObject({ valid: true })
    await expect(
      engine.evaluate(`${documentUri}#/components/schemas/Pet`, {
        nickname: 'missing id',
      }),
    ).resolves.toMatchObject({ valid: false })
  })

  test('rejects custom OpenAPI dialects instead of guessing their vocabulary', async () => {
    await expect(
      engine.registerDocument(
        {
          openapi: '3.1.1',
          jsonSchemaDialect: 'https://dialects.knife4j.example/custom',
          info: { title: 'Unsupported dialect', version: '1.0.0' },
          paths: {},
        },
        'https://fixtures.knife4j.example/custom-dialect.openapi.json',
      ),
    ).rejects.toThrow('does not load the custom OpenAPI dialect')
  })

  test('rejects unregistered external resources before fetch', async () => {
    const rootUri = 'https://fixtures.knife4j.example/network-root'
    let fetchCalls = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      fetchCalls += 1
      throw new Error('fetch must not be called')
    }) as typeof fetch

    try {
      await engine.registerDocument(
        {
          $schema: JSON_SCHEMA_2020_12,
          $ref: 'https://unregistered.knife4j.example/external',
        },
        rootUri,
      )

      await expect(engine.evaluate(rootUri, 'value')).rejects.toMatchObject({
        name: SchemaResourcePolicyError.name,
        code: 'EXTERNAL_RESOURCE_LOADING_DISABLED',
        resourceUri: 'https://unregistered.knife4j.example/external',
      })
      expect(fetchCalls).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
