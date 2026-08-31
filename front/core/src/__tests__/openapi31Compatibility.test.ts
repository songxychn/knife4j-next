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

  test('does not warn for local JSON Pointer refs and locally supported dialects', () => {
    expect(
      collectOas31CompatibilityDiagnostics({
        openapi: '3.1.1',
        jsonSchemaDialect: 'https://spec.openapis.org/oas/3.1/dialect/base',
        info: { title: 'Supported baseline', version: '1' },
        components: {
          schemas: {
            User: { type: ['object', 'null'] },
            Wrapper: {
              $schema: 'https://json-schema.org/draft/2020-12/schema',
              $ref: '#/components/schemas/User',
              description: 'nullable user',
            },
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

  test('redacts URL credentials and query values from diagnostics', () => {
    const diagnostics = collectOas31CompatibilityDiagnostics({
      openapi: '3.1.1',
      info: { title: 'Sensitive refs', version: '1' },
      components: {
        schemas: {
          Absolute: { $ref: 'https://user:secret@schemas.example.test/pet.json?token=secret#/$defs/Pet' },
          Relative: { $dynamicRef: './shared.json?signature=secret#node' },
        },
      },
    });

    expect(diagnostics.map((item) => item.value)).toEqual([
      'https://schemas.example.test/pet.json?…#/$defs/Pet',
      './shared.json?…#node',
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain('secret');
  });
});
