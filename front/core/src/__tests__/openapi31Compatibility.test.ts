import { collectOas31CompatibilityDiagnostics } from '../openapi31/compatibility';

describe('collectOas31CompatibilityDiagnostics', () => {
  test('reports reference and dialect features that Knife4j cannot resolve safely', () => {
    const diagnostics = collectOas31CompatibilityDiagnostics({
      openapi: '3.1.1',
      jsonSchemaDialect: 'https://example.com/custom-dialect',
      info: { title: 'Unsupported features', version: '1' },
      components: {
        schemas: {
          External: { $ref: './shared.yaml#/User' },
          Anchored: { $ref: '#User' },
          Dynamic: { $dynamicRef: '#node' },
          Based: { $id: 'nested/', type: 'string' },
        },
      },
    });

    expect(diagnostics.map((item) => item.code)).toEqual([
      'unsupported-dialect',
      'external-ref',
      'anchor-ref',
      'dynamic-ref',
      'schema-base',
    ]);
    expect(diagnostics.every((item) => item.path.startsWith('#/'))).toBe(true);
  });

  test('does not warn for local JSON Pointer refs and the OAS base dialect', () => {
    expect(
      collectOas31CompatibilityDiagnostics({
        openapi: '3.1.1',
        jsonSchemaDialect: 'https://spec.openapis.org/oas/3.1/dialect/base',
        info: { title: 'Supported baseline', version: '1' },
        components: {
          schemas: {
            User: { type: ['object', 'null'] },
            Wrapper: { $ref: '#/components/schemas/User', description: 'nullable user' },
          },
        },
      }),
    ).toEqual([]);
  });

  test('does not interpret literal examples or extension payloads as document references', () => {
    expect(
      collectOas31CompatibilityDiagnostics({
        openapi: '3.1.2',
        info: { title: 'Literal payloads', version: '1' },
        components: {
          schemas: {
            Message: {
              type: 'object',
              example: { $ref: './not-a-schema.yaml', $id: 'payload-id' },
              examples: [{ $dynamicRef: '#payload' }],
              default: { $anchor: 'payload' },
              const: { $schema: 'payload-value' },
              enum: [{ $ref: '#payload' }],
              'x-sample': { $ref: './extension-data.json' },
            },
          },
        },
      }),
    ).toEqual([]);
  });
});
