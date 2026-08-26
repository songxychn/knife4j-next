import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SwaggerDoc } from '../../types/swagger';
import {
  buildOperationOpenApiDocument,
  buildOperationOpenApiFilename,
  downloadOperationOpenApiJson,
  serializeOperationOpenApiDocument,
} from './operationOpenApiDocument';

function makeDocument(): SwaggerDoc {
  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: { title: 'Pet API', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    security: [{ OAuth2: ['pets:read'] }],
    paths: {
      '/pets/{petId}': {
        parameters: [{ $ref: '#/components/parameters/PetId' }],
        servers: [{ url: 'https://pets.example.com' }],
        'x-path-name': 'pet',
        get: {
          operationId: 'getPet',
          parameters: [{ $ref: '#/components/parameters/TraceId' }],
          requestBody: { $ref: '#/components/requestBodies/PetBody' },
          callbacks: {
            changed: { $ref: '#/components/callbacks/PetChanged' },
          },
          responses: {
            200: { $ref: '#/components/responses/PetResponse' },
          },
        },
        post: {
          operationId: 'replacePet',
          responses: { 204: { description: 'replaced' } },
        },
      },
    },
    components: {
      schemas: {
        Pet: {
          type: 'object',
          properties: {
            owner: { $ref: '#/components/schemas/User' },
          },
        },
        User: {
          type: 'object',
          properties: {
            pet: { $ref: '#/components/schemas/Pet' },
          },
        },
        PetId: { type: 'string' },
        TraceId: { type: 'string' },
        RateLimit: { type: 'integer' },
        CallbackPayload: { type: 'object' },
        Unused: { type: 'string' },
      },
      parameters: {
        PetId: {
          name: 'petId',
          in: 'path',
          required: true,
          schema: { $ref: '#/components/schemas/PetId' },
        },
        TraceId: {
          name: 'X-Trace-Id',
          in: 'header',
          schema: { $ref: '#/components/schemas/TraceId' },
        },
      },
      requestBodies: {
        PetBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Pet' },
              examples: {
                pet: { $ref: '#/components/examples/PetExample' },
              },
            },
          },
        },
      },
      responses: {
        PetResponse: {
          description: 'ok',
          headers: {
            'X-Rate-Limit': { $ref: '#/components/headers/RateLimit' },
          },
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Pet' },
            },
          },
          links: {
            owner: { $ref: '#/components/links/PetOwner' },
          },
        },
      },
      headers: {
        RateLimit: {
          schema: { $ref: '#/components/schemas/RateLimit' },
        },
      },
      examples: {
        PetExample: { value: { id: 'pet-1', security: [{ UnusedKey: [] }] } },
      },
      links: {
        PetOwner: { operationId: 'getOwner' },
      },
      callbacks: {
        PetChanged: {
          '{$request.body#/callbackUrl}': {
            post: {
              security: [{ CallbackKey: [] }],
              requestBody: {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/CallbackPayload' },
                  },
                },
              },
              responses: { 204: { description: 'received' } },
            },
          },
        },
      },
      securitySchemes: {
        OAuth2: {
          type: 'oauth2',
          flows: {
            clientCredentials: {
              tokenUrl: 'https://auth.example.com/token',
              scopes: { 'pets:read': 'Read pets' },
            },
          },
        },
        CallbackKey: { type: 'apiKey', in: 'header', name: 'X-Callback-Key' },
        UnusedKey: { type: 'apiKey', in: 'header', name: 'X-Unused' },
      },
    },
  } as unknown as SwaggerDoc;
}

function resolveLocalRef(document: unknown, ref: string): unknown {
  return decodeURIComponent(ref.slice(1))
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>((current, token) => {
      if (!current || typeof current !== 'object') return undefined;
      return (current as Record<string, unknown>)[token];
    }, document);
}

function localRefs(document: unknown): string[] {
  const refs: string[] = [];
  const seen = new WeakSet<object>();

  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.$ref === 'string' && record.$ref.startsWith('#/')) refs.push(record.$ref);
    Object.values(record).forEach(visit);
  };

  visit(document);
  return refs;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildOperationOpenApiDocument', () => {
  it('keeps one operation and recursively closes all referenced components', () => {
    const result = buildOperationOpenApiDocument(makeDocument(), '/pets/{petId}', 'GET');

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      openapi: '3.1.0',
      jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
      info: { title: 'Pet API', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com' }],
      security: [{ OAuth2: ['pets:read'] }],
      paths: {
        '/pets/{petId}': {
          parameters: [{ $ref: '#/components/parameters/PetId' }],
          servers: [{ url: 'https://pets.example.com' }],
          'x-path-name': 'pet',
          get: { operationId: 'getPet' },
        },
      },
    });
    expect(result?.paths).not.toHaveProperty(['/pets/{petId}', 'post']);

    const components = result?.components as Record<string, Record<string, unknown>>;
    expect(Object.keys(components.schemas).sort()).toEqual([
      'CallbackPayload',
      'Pet',
      'PetId',
      'RateLimit',
      'TraceId',
      'User',
    ]);
    expect(Object.keys(components.parameters).sort()).toEqual(['PetId', 'TraceId']);
    expect(Object.keys(components.requestBodies)).toEqual(['PetBody']);
    expect(Object.keys(components.responses)).toEqual(['PetResponse']);
    expect(Object.keys(components.headers)).toEqual(['RateLimit']);
    expect(Object.keys(components.examples)).toEqual(['PetExample']);
    expect(Object.keys(components.links)).toEqual(['PetOwner']);
    expect(Object.keys(components.callbacks)).toEqual(['PetChanged']);
    expect(Object.keys(components.securitySchemes).sort()).toEqual(['CallbackKey', 'OAuth2']);

    localRefs(result).forEach((ref) => expect(resolveLocalRef(result, ref), ref).toBeDefined());
  });

  it('materializes referenced path support without exposing unselected operations', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Referenced Path Item API', version: '1.0.0' },
      paths: {
        '/pets': {
          $ref: '#/components/pathItems/SharedPets',
          description: 'selected pets',
          get: {
            operationId: 'getSelectedPets',
            responses: { 200: { description: 'ok' } },
          },
        },
      },
      components: {
        pathItems: {
          SharedPets: {
            summary: 'shared pets',
            description: 'shared description',
            servers: [{ url: 'https://shared.example.com' }],
            parameters: [{ $ref: '#/components/parameters/TraceId' }],
            'x-shared-path': true,
            get: {
              operationId: 'getSharedPets',
              responses: { 200: { description: 'shared' } },
            },
            post: {
              operationId: 'createPet',
              responses: { 201: { description: 'created' } },
            },
          },
        },
        parameters: {
          TraceId: { name: 'X-Trace-Id', in: 'header', schema: { type: 'string' } },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/pets', 'get');
    const paths = result?.paths as Record<string, Record<string, unknown>>;
    const outputPathItem = paths['/pets'];

    expect(outputPathItem).toMatchObject({
      summary: 'shared pets',
      description: 'selected pets',
      servers: [{ url: 'https://shared.example.com' }],
      parameters: [{ $ref: '#/components/parameters/TraceId' }],
      'x-shared-path': true,
      get: { operationId: 'getSelectedPets' },
    });
    expect(outputPathItem).not.toHaveProperty('$ref');
    expect(Object.keys(outputPathItem).filter((key) => ['get', 'post'].includes(key))).toEqual(['get']);
    const components = result?.components as Record<string, Record<string, unknown>>;
    expect(components.parameters).toHaveProperty('TraceId');
    expect(components).not.toHaveProperty('pathItems');
  });

  it('indexes schema resources through local path-item refs before pruning methods', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Referenced Inline Resources API', version: '1.0.0' },
      paths: {
        '/selected': {
          $ref: '#/x-path-items/Base',
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: 'urn:hidden' } },
                },
              },
            },
          },
        },
      },
      'x-path-items': {
        Base: {
          summary: 'base path',
          post: {
            responses: {
              200: {
                description: 'hidden resource',
                content: {
                  'application/json': { schema: { $id: 'urn:hidden', type: 'object' } },
                },
              },
            },
          },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/selected', 'get');
    const paths = result?.paths as Record<string, Record<string, unknown>>;
    const localTargets = result?.['x-knife4j-local-ref-targets'] as Record<string, Record<string, unknown>>;

    expect(paths['/selected']).toMatchObject({ summary: 'base path', get: expect.any(Object) });
    expect(paths['/selected']).not.toHaveProperty('$ref');
    expect(paths['/selected']).not.toHaveProperty('post');
    expect(Object.values(localTargets)).toContainEqual(expect.objectContaining({ $id: 'urn:hidden' }));
    expect(result).not.toHaveProperty('x-path-items');
  });

  it('includes schemas referenced only by discriminator mappings', () => {
    const document = {
      openapi: '3.0.3',
      info: { title: 'Polymorphic API', version: '1.0.0' },
      paths: {
        '/pets': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Pet: {
            type: 'object',
            required: ['petType'],
            properties: { petType: { type: 'string' } },
            discriminator: {
              propertyName: 'petType',
              mapping: {
                dog: '#/components/schemas/Dog',
                cat: 'Cat',
                monster: 'https://schemas.example.com/Monster.json',
              },
            },
          },
          Dog: {
            allOf: [
              { $ref: '#/components/schemas/Pet' },
              {
                type: 'object',
                properties: { owner: { $ref: '#/components/schemas/Owner' } },
              },
            ],
          },
          Cat: { allOf: [{ $ref: '#/components/schemas/Pet' }] },
          Owner: { type: 'object' },
          Unused: { type: 'string' },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/pets', 'get');
    const schemas = (result?.components as Record<string, Record<string, unknown>>).schemas;

    expect(Object.keys(schemas).sort()).toEqual(['Cat', 'Dog', 'Owner', 'Pet']);
    localRefs(result).forEach((ref) => expect(resolveLocalRef(result, ref), ref).toBeDefined());
  });

  it('decodes URI fragments before splitting component JSON pointers', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Encoded References API', version: '1.0.0' },
      paths: {
        '/encoded': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: {
                      oneOf: [
                        { $ref: '#/components/schemas/Foo%2Fproperties%2Fid' },
                        { $ref: '#%2Fcomponents%2Fschemas%2FBar%2Fproperties%2Fid' },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Foo: { type: 'object', properties: { id: { type: 'string' } } },
          Bar: { type: 'object', properties: { id: { type: 'integer' } } },
          Unused: { type: 'string' },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/encoded', 'get');
    const schemas = (result?.components as Record<string, Record<string, unknown>>).schemas;

    expect(Object.keys(schemas).sort()).toEqual(['Bar', 'Foo']);
    localRefs(result).forEach((ref) => expect(resolveLocalRef(result, ref), ref).toBeDefined());
  });

  it('rewrites local refs outside components without exporting referenced operations', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Shared Response API', version: '1.0.0' },
      paths: {
        '/selected': {
          get: {
            responses: {
              200: { $ref: '#/paths/~1shared/get/responses/200' },
            },
          },
        },
        '/shared': {
          get: {
            responses: {
              200: {
                description: 'shared response',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/SharedPayload' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          SharedPayload: { $ref: '#/x-shared-schemas/Node' },
          Unused: { type: 'string' },
        },
      },
      'x-shared-schemas': {
        Node: {
          type: 'object',
          properties: {
            child: { $ref: '#/x-shared-schemas/Node' },
          },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/selected', 'get');
    const outputPaths = result?.paths as Record<string, Record<string, Record<string, unknown>>>;
    const response = outputPaths['/selected'].get.responses as Record<string, { $ref: string }>;

    expect(Object.keys(outputPaths)).toEqual(['/selected']);
    expect(response[200].$ref).not.toBe('#/paths/~1shared/get/responses/200');
    expect(resolveLocalRef(result, response[200].$ref)).toMatchObject({ description: 'shared response' });
    expect((result?.components as Record<string, Record<string, unknown>>).schemas).toHaveProperty('SharedPayload');
    localRefs(result).forEach((ref) => expect(resolveLocalRef(result, ref), ref).toBeDefined());
    expect(response[200].$ref).toBe('#/x-knife4j-local-ref-targets/target-1');

    const inputPaths = document.paths as Record<string, Record<string, Record<string, unknown>>>;
    const inputResponse = inputPaths['/selected'].get.responses as Record<string, { $ref: string }>;
    expect(inputResponse[200].$ref).toBe('#/paths/~1shared/get/responses/200');
  });

  it('keeps example and JSON Schema instance data opaque while collecting real example refs', () => {
    const payloadRef = '#/paths/~1shared/get';
    const document = {
      openapi: '3.1.0',
      info: { title: 'Opaque Examples API', version: '1.0.0' },
      paths: {
        '/selected': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      example: { $ref: payloadRef },
                      examples: [{ $ref: payloadRef }],
                      default: { $ref: payloadRef },
                      enum: [{ $ref: payloadRef }],
                      const: { $ref: payloadRef },
                    },
                    example: { $ref: payloadRef },
                    examples: {
                      inline: { value: { $ref: payloadRef } },
                      reusable: { $ref: '#/components/examples/Reusable' },
                    },
                  },
                },
              },
            },
          },
        },
        '/shared': {
          get: { responses: { 204: { description: 'shared' } } },
        },
      },
      components: {
        examples: {
          Reusable: { value: { $ref: payloadRef } },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/selected', 'get');
    const paths = result?.paths as Record<string, Record<string, Record<string, unknown>>>;
    const response = paths['/selected'].get.responses as Record<string, Record<string, unknown>>;
    const mediaType = (response[200].content as Record<string, Record<string, unknown>>)['application/json'];
    const schema = mediaType.schema as Record<string, unknown>;
    const examples = mediaType.examples as Record<string, Record<string, unknown>>;
    const reusable = (result?.components as Record<string, Record<string, unknown>>).examples.Reusable as Record<
      string,
      unknown
    >;

    expect(schema.example).toEqual({ $ref: payloadRef });
    expect(schema.examples).toEqual([{ $ref: payloadRef }]);
    expect(schema.default).toEqual({ $ref: payloadRef });
    expect(schema.enum).toEqual([{ $ref: payloadRef }]);
    expect(schema.const).toEqual({ $ref: payloadRef });
    expect(mediaType.example).toEqual({ $ref: payloadRef });
    expect(examples.inline.value).toEqual({ $ref: payloadRef });
    expect(examples.reusable.$ref).toBe('#/components/examples/Reusable');
    expect(reusable.value).toEqual({ $ref: payloadRef });
    expect(result).not.toHaveProperty('x-knife4j-local-ref-targets');
  });

  it('relocates local Link operationRef targets and closes their dependencies', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Linked Operations API', version: '1.0.0' },
      paths: {
        '/selected': {
          get: {
            responses: {
              200: {
                description: 'ok',
                links: {
                  next: { operationRef: '#/paths/~1next/get' },
                },
              },
            },
          },
        },
        '/next': {
          get: {
            operationId: 'getNext',
            responses: {
              200: {
                description: 'next',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/NextPayload' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          NextPayload: { type: 'object' },
          Unused: { type: 'string' },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/selected', 'get');
    const paths = result?.paths as Record<string, Record<string, Record<string, unknown>>>;
    const responses = paths['/selected'].get.responses as Record<string, Record<string, unknown>>;
    const links = responses[200].links as Record<string, { operationRef: string }>;

    expect(Object.keys(paths)).toEqual(['/selected']);
    expect(links.next.operationRef).toBe('#/x-knife4j-local-ref-targets/target-1');
    expect(resolveLocalRef(result, links.next.operationRef)).toMatchObject({ operationId: 'getNext' });
    expect((result?.components as Record<string, Record<string, unknown>>).schemas).toHaveProperty('NextPayload');
  });

  it('relocates Link operationId targets while preserving links to the selected operation', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Linked Operation IDs API', version: '1.0.0' },
      paths: {
        '/selected': {
          get: {
            operationId: 'getSelected',
            responses: {
              200: {
                description: 'ok',
                links: {
                  next: { operationId: 'getNext' },
                  self: { operationId: 'getSelected' },
                },
              },
            },
          },
        },
        '/next': {
          get: {
            operationId: 'getNext',
            responses: {
              200: {
                description: 'next',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/NextPayload' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          NextPayload: { type: 'object' },
          Unused: { type: 'string' },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/selected', 'get');
    const paths = result?.paths as Record<string, Record<string, Record<string, unknown>>>;
    const responses = paths['/selected'].get.responses as Record<string, Record<string, unknown>>;
    const links = responses[200].links as Record<string, Record<string, string>>;

    expect(Object.keys(paths)).toEqual(['/selected']);
    expect(links.next).not.toHaveProperty('operationId');
    expect(links.next.operationRef).toBe('#/x-knife4j-local-ref-targets/target-1');
    expect(resolveLocalRef(result, links.next.operationRef)).toMatchObject({ operationId: 'getNext' });
    expect(links.self).toEqual({ operationId: 'getSelected' });
    expect((result?.components as Record<string, Record<string, unknown>>).schemas).toHaveProperty('NextPayload');
  });

  it('traverses OAS 3.2 QUERY operations in paths and callbacks', () => {
    const document = {
      openapi: '3.2.0',
      info: { title: 'QUERY Operations API', version: '1.0.0' },
      paths: {
        '/selected': {
          get: {
            callbacks: {
              result: {
                '{$request.body#/callbackUrl}': {
                  query: {
                    security: [{ QueryKey: [] }],
                    responses: {
                      200: {
                        description: 'callback result',
                        content: {
                          'application/json': { schema: { $ref: '#/components/schemas/CallbackResult' } },
                        },
                      },
                    },
                  },
                },
              },
            },
            responses: {
              200: {
                description: 'ok',
                links: { search: { operationId: 'runQuery' } },
              },
            },
          },
        },
        '/search': {
          query: {
            operationId: 'runQuery',
            responses: {
              200: {
                description: 'query result',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/QueryResult' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          CallbackResult: { type: 'object' },
          QueryResult: { type: 'array' },
          Unused: { type: 'string' },
        },
        securitySchemes: {
          QueryKey: { type: 'apiKey', name: 'X-Query-Key', in: 'header' },
          UnusedKey: { type: 'http', scheme: 'bearer' },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/selected', 'get');
    const paths = result?.paths as Record<string, Record<string, Record<string, unknown>>>;
    const selected = paths['/selected'].get;
    const responses = selected.responses as Record<string, Record<string, unknown>>;
    const links = responses[200].links as Record<string, Record<string, string>>;
    const components = result?.components as Record<string, Record<string, unknown>> | undefined;

    expect(links.search).not.toHaveProperty('operationId');
    expect(resolveLocalRef(result, links.search.operationRef)).toMatchObject({ operationId: 'runQuery' });
    expect(Object.keys(components?.schemas ?? {}).sort()).toEqual(['CallbackResult', 'QueryResult']);
    expect(Object.keys(components?.securitySchemes ?? {})).toEqual(['QueryKey']);
  });

  it('relocates Link operationId targets from reusable callback and path-item components', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Reusable Operation IDs API', version: '1.0.0' },
      paths: {
        '/selected': {
          get: {
            responses: {
              200: {
                description: 'ok',
                links: {
                  callback: { operationId: 'receiveChange' },
                  pathItem: { operationId: 'reusePet' },
                },
              },
            },
          },
        },
      },
      components: {
        callbacks: {
          ReusableCallback: {
            '{$request.body#/callbackUrl}': {
              post: {
                operationId: 'receiveChange',
                responses: {
                  200: {
                    description: 'received',
                    content: {
                      'application/json': { schema: { $ref: '#/components/schemas/CallbackPayload' } },
                    },
                  },
                },
              },
            },
          },
        },
        pathItems: {
          ReusablePathItem: {
            post: {
              operationId: 'reusePet',
              responses: {
                200: {
                  description: 'reused',
                  content: {
                    'application/json': { schema: { $ref: '#/components/schemas/ReusablePayload' } },
                  },
                },
              },
            },
          },
        },
        schemas: {
          CallbackPayload: { type: 'object' },
          ReusablePayload: { type: 'object' },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/selected', 'get');
    const paths = result?.paths as Record<string, Record<string, Record<string, unknown>>>;
    const responses = paths['/selected'].get.responses as Record<string, Record<string, unknown>>;
    const links = responses[200].links as Record<string, Record<string, string>>;

    expect(links.callback).not.toHaveProperty('operationId');
    expect(links.pathItem).not.toHaveProperty('operationId');
    expect(resolveLocalRef(result, links.callback.operationRef)).toMatchObject({ operationId: 'receiveChange' });
    expect(resolveLocalRef(result, links.pathItem.operationRef)).toMatchObject({ operationId: 'reusePet' });
    expect(Object.keys((result?.components as Record<string, Record<string, unknown>>).schemas).sort()).toEqual([
      'CallbackPayload',
      'ReusablePayload',
    ]);
  });

  it('collects component schemas referenced by OAS 3.1 dynamic refs', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Dynamic References API', version: '1.0.0' },
      paths: {
        '/nodes': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': { schema: { $dynamicRef: '#/components/schemas/Node' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Node: {
            $dynamicAnchor: 'node',
            type: 'object',
            properties: { child: { $dynamicRef: '#node' } },
          },
          Unused: { type: 'string' },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/nodes', 'get');
    const schemas = (result?.components as Record<string, Record<string, unknown>>).schemas;

    expect(Object.keys(schemas)).toEqual(['Node']);
    expect(schemas.Node).toMatchObject({ $dynamicAnchor: 'node' });
  });

  it('collects schemas referenced by OAS 3.2 media type itemSchema', () => {
    const document = {
      openapi: '3.2.0',
      info: { title: 'Streaming Events API', version: '1.0.0' },
      paths: {
        '/events': {
          get: {
            responses: {
              200: {
                description: 'event stream',
                content: {
                  'application/json-seq': { itemSchema: { $ref: '#/components/schemas/Event' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Event: { type: 'object' },
          Unused: { type: 'string' },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/events', 'get');
    const schemas = (result?.components as Record<string, Record<string, unknown>> | undefined)?.schemas;

    expect(Object.keys(schemas ?? {})).toEqual(['Event']);
  });

  it('resolves plain-name schema anchors within the matching schema resource', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Schema Anchors API', version: '1.0.0' },
      paths: {
        '/pets': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: '#Pet' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Pet: { $anchor: 'Pet', type: 'object' },
          OtherResourcePet: { $id: 'urn:example:other', $anchor: 'Pet', type: 'string' },
          Unused: { type: 'integer' },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/pets', 'get');
    const schemas = (result?.components as Record<string, Record<string, unknown>>).schemas;

    expect(Object.keys(schemas)).toEqual(['Pet']);
    expect(schemas.Pet).toMatchObject({ $anchor: 'Pet', type: 'object' });
  });

  it('collects schemas referenced through absolute embedded resource URIs', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Embedded Schema Resources API', version: '1.0.0' },
      paths: {
        '/pets': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: 'urn:pet#Pet' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          EmbeddedPet: { $id: 'urn:pet', $anchor: 'Pet', type: 'object' },
          Unused: { type: 'string' },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/pets', 'get');
    const schemas = (result?.components as Record<string, Record<string, unknown>> | undefined)?.schemas;

    expect(Object.keys(schemas ?? {})).toEqual(['EmbeddedPet']);
    expect(schemas?.EmbeddedPet).toMatchObject({ $id: 'urn:pet', $anchor: 'Pet', type: 'object' });
  });

  it('collects schemas referenced by embedded resource root URIs', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Embedded Schema Resource Roots API', version: '1.0.0' },
      paths: {
        '/pets': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: 'urn:pet' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          EmbeddedPet: { $id: 'urn:pet', type: 'object' },
          Unused: { type: 'string' },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/pets', 'get');
    const schemas = (result?.components as Record<string, Record<string, unknown>> | undefined)?.schemas;

    expect(Object.keys(schemas ?? {})).toEqual(['EmbeddedPet']);
    expect(schemas?.EmbeddedPet).toMatchObject({ $id: 'urn:pet', type: 'object' });
  });

  it('uses the document retrieval URI to resolve relative embedded resource ids', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Relative Embedded Resources API', version: '1.0.0' },
      paths: {
        '/pets': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: 'https://api.example.com/schemas/Pet' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          EmbeddedPet: { $id: '/schemas/Pet', type: 'object' },
          Unused: { type: 'string' },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/pets', 'get', 'https://api.example.com/v3/api-docs');
    const schemas = (result?.components as Record<string, Record<string, unknown>> | undefined)?.schemas;

    expect(Object.keys(schemas ?? {})).toEqual(['EmbeddedPet']);
    expect(schemas?.EmbeddedPet).toMatchObject({ $id: 'https://api.example.com/schemas/Pet' });
  });

  it('relocates embedded schema resources declared under pruned paths', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Inline Embedded Resources API', version: '1.0.0' },
      paths: {
        '/selected': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: 'urn:pet' } },
                },
              },
            },
          },
        },
        '/resource': {
          get: {
            responses: {
              200: {
                description: 'resource',
                content: {
                  'application/json': {
                    schema: {
                      $id: 'urn:pet',
                      type: 'object',
                      properties: { owner: { $ref: '#/$defs/Owner' } },
                      $defs: { Owner: { type: 'object' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Unused: { type: 'string' },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/selected', 'get');
    const paths = result?.paths as Record<string, Record<string, Record<string, unknown>>>;
    const responses = paths['/selected'].get.responses as Record<string, Record<string, unknown>>;
    const mediaType = (responses[200].content as Record<string, Record<string, unknown>>)['application/json'];
    const localTargets = result?.['x-knife4j-local-ref-targets'] as Record<string, unknown> | undefined;
    const schemas = (result?.components as Record<string, Record<string, unknown>> | undefined)?.schemas;

    expect(Object.keys(paths)).toEqual(['/selected']);
    expect((mediaType.schema as { $ref: string }).$ref).toBe('urn:pet');
    expect(Object.values(localTargets ?? {})).toContainEqual(
      expect.objectContaining({ $id: 'urn:pet', type: 'object' }),
    );
    expect(Object.keys(schemas ?? {})).toEqual([]);
  });

  it('ignores Paths specification extensions during semantic indexing', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Paths Extensions API', version: '1.0.0' },
      paths: {
        '/selected': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: 'urn:external' } },
                },
              },
            },
          },
        },
        'x-metadata': { $ref: '#/x-path-items/Metadata' },
      },
      'x-path-items': {
        Metadata: {
          post: {
            responses: {
              200: {
                description: 'metadata',
                content: {
                  'application/json': { schema: { $id: 'urn:external', type: 'string' } },
                },
              },
            },
          },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/selected', 'get');
    const paths = result?.paths as Record<string, Record<string, Record<string, unknown>>>;
    const responses = paths['/selected'].get.responses as Record<string, Record<string, unknown>>;
    const mediaType = (responses[200].content as Record<string, Record<string, unknown>>)['application/json'];

    expect(Object.keys(paths)).toEqual(['/selected']);
    expect((mediaType.schema as { $ref: string }).$ref).toBe('urn:external');
    expect(result).not.toHaveProperty('x-knife4j-local-ref-targets');
  });

  it('relocates embedded schema resources declared under pruned webhooks and callbacks', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Inline Webhook Resources API', version: '1.0.0' },
      paths: {
        '/selected': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { oneOf: [{ $ref: 'urn:webhook' }, { $ref: 'urn:callback' }] },
                  },
                },
              },
            },
          },
        },
        '/callback-source': {
          post: {
            callbacks: {
              changed: {
                '{$request.body#/callbackUrl}': {
                  post: {
                    responses: {
                      200: {
                        description: 'callback',
                        content: {
                          'application/json': { schema: { $id: 'urn:callback', type: 'object' } },
                        },
                      },
                    },
                  },
                },
              },
            },
            responses: { 202: { description: 'accepted' } },
          },
        },
      },
      webhooks: {
        petHook: {
          post: {
            responses: {
              200: {
                description: 'webhook',
                content: {
                  'application/json': { schema: { $id: 'urn:webhook', type: 'object' } },
                },
              },
            },
          },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/selected', 'get');
    const localTargets = result?.['x-knife4j-local-ref-targets'] as Record<string, Record<string, unknown>>;

    expect(Object.keys(result?.paths as Record<string, unknown>)).toEqual(['/selected']);
    expect(result).not.toHaveProperty('webhooks');
    expect(
      Object.values(localTargets)
        .map((target) => target.$id)
        .sort(),
    ).toEqual(['urn:callback', 'urn:webhook']);
  });

  it('indexes schema resources in x-prefixed response headers', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Header Schema Resources API', version: '1.0.0' },
      paths: {
        '/selected': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: 'urn:hidden-header' } },
                },
              },
            },
          },
        },
        '/resource': {
          get: {
            responses: {
              200: {
                description: 'resource',
                headers: {
                  'x-hidden': { schema: { $id: 'urn:hidden-header', type: 'string' } },
                },
              },
            },
          },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/selected', 'get');
    const localTargets = result?.['x-knife4j-local-ref-targets'] as Record<string, Record<string, unknown>>;

    expect(Object.values(localTargets)).toContainEqual(
      expect.objectContaining({ $id: 'urn:hidden-header', type: 'string' }),
    );
  });

  it('collects schemas referenced through JSON Pointers into embedded resources', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Embedded Schema Pointers API', version: '1.0.0' },
      paths: {
        '/owners': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: 'urn:pet#/$defs/Owner' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          EmbeddedPet: {
            $id: 'urn:pet',
            $defs: { Owner: { type: 'object' } },
          },
          Unused: { type: 'string' },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/owners', 'get');
    const schemas = (result?.components as Record<string, Record<string, unknown>> | undefined)?.schemas;

    expect(Object.keys(schemas ?? {})).toEqual(['EmbeddedPet']);
    expect(schemas?.EmbeddedPet).toMatchObject({
      $id: 'urn:pet',
      $defs: { Owner: { type: 'object' } },
    });
  });

  it('preserves enclosing schema resources when relocating nested subschemas', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Nested Schema Resources API', version: '1.0.0' },
      paths: {
        '/parents': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/x-schemas/Parent/$defs/Child' },
                  },
                },
              },
            },
          },
        },
      },
      'x-schemas': {
        Parent: {
          $id: 'urn:parent',
          $defs: {
            Child: {
              type: 'object',
              properties: { leaf: { $ref: '#/$defs/Leaf' } },
            },
            Leaf: { type: 'string' },
          },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/parents', 'get');
    const paths = result?.paths as Record<string, Record<string, Record<string, unknown>>>;
    const responses = paths['/parents'].get.responses as Record<string, Record<string, unknown>>;
    const mediaType = (responses[200].content as Record<string, Record<string, unknown>>)['application/json'];
    const schema = mediaType.schema as { $ref: string };

    expect(schema.$ref).toBe('#/x-knife4j-local-ref-targets/target-1/$defs/Child');
    expect(resolveLocalRef(result, '#/x-knife4j-local-ref-targets/target-1')).toMatchObject({
      $id: 'urn:parent',
      $defs: {
        Child: { properties: { leaf: { $ref: '#/$defs/Leaf' } } },
        Leaf: { type: 'string' },
      },
    });
  });

  it('ignores unrelated ids on non-schema ancestors of local schema pointers', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Schema Pointer Ancestors API', version: '1.0.0' },
      paths: {
        '/dogs': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: '#/x-container/Dog' } },
                },
              },
            },
          },
        },
      },
      'x-container': {
        $id: 'urn:not-a-schema-resource',
        Dog: {
          type: 'object',
          properties: { owner: { $ref: '#/components/schemas/Owner' } },
        },
      },
      components: {
        schemas: {
          Owner: { type: 'object' },
          Unused: { type: 'string' },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/dogs', 'get');
    const paths = result?.paths as Record<string, Record<string, Record<string, unknown>>>;
    const responses = paths['/dogs'].get.responses as Record<string, Record<string, unknown>>;
    const mediaType = (responses[200].content as Record<string, Record<string, unknown>>)['application/json'];
    const schemaRef = (mediaType.schema as { $ref: string }).$ref;
    const relocated = resolveLocalRef(result, schemaRef) as Record<string, unknown>;
    const schemas = (result?.components as Record<string, Record<string, unknown>>).schemas;

    expect(relocated).toMatchObject({
      type: 'object',
      properties: { owner: { $ref: '#/components/schemas/Owner' } },
    });
    expect(relocated).not.toHaveProperty('$id');
    expect(Object.keys(schemas)).toEqual(['Owner']);
  });

  it('preserves schema semantics for refs into Components extensions', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Components Extensions API', version: '1.0.0' },
      paths: {
        '/dogs': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: '#/components/x-schemas/Dog' } },
                },
              },
            },
          },
        },
      },
      components: {
        'x-schemas': {
          Dog: {
            type: 'object',
            properties: { owner: { $ref: '#/components/schemas/Owner' } },
          },
        },
        schemas: {
          Owner: { type: 'object' },
          Unused: { type: 'string' },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/dogs', 'get');
    const paths = result?.paths as Record<string, Record<string, Record<string, unknown>>>;
    const responses = paths['/dogs'].get.responses as Record<string, Record<string, unknown>>;
    const mediaType = (responses[200].content as Record<string, Record<string, unknown>>)['application/json'];
    const schemaRef = (mediaType.schema as { $ref: string }).$ref;
    const relocated = resolveLocalRef(result, schemaRef);
    const components = result?.components as Record<string, Record<string, unknown>>;

    expect(schemaRef).toBe('#/x-knife4j-local-ref-targets/target-1');
    expect(relocated).toMatchObject({ type: 'object' });
    expect(Object.keys(components.schemas)).toEqual(['Owner']);
    expect(components).not.toHaveProperty('x-schemas');
  });

  it('relocates the same local target separately for each semantic kind', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Shared Extension Target API', version: '1.0.0' },
      paths: {
        '/shared': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: '#/x-targets/Shared' } },
                },
                headers: {
                  Shared: { $ref: '#/x-targets/Shared' },
                },
              },
            },
          },
        },
      },
      'x-targets': {
        Shared: {
          description: 'shared target',
          schema: { $ref: '#/components/schemas/Owner' },
        },
      },
      components: {
        schemas: {
          Owner: { type: 'object' },
          Unused: { type: 'string' },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/shared', 'get');
    const paths = result?.paths as Record<string, Record<string, Record<string, unknown>>>;
    const responses = paths['/shared'].get.responses as Record<string, Record<string, unknown>>;
    const response = responses[200];
    const mediaType = (response.content as Record<string, Record<string, unknown>>)['application/json'];
    const schemaRef = (mediaType.schema as { $ref: string }).$ref;
    const headerRef = ((response.headers as Record<string, { $ref: string }>).Shared as { $ref: string }).$ref;
    const relocatedHeader = resolveLocalRef(result, headerRef) as Record<string, unknown>;
    const schemas = (result?.components as Record<string, Record<string, unknown>> | undefined)?.schemas;

    expect(schemaRef).not.toBe(headerRef);
    expect(resolveLocalRef(result, schemaRef)).toMatchObject({ description: 'shared target' });
    expect(relocatedHeader).toMatchObject({
      schema: { $ref: '#/components/schemas/Owner' },
    });
    expect(Object.keys(schemas ?? {})).toEqual(['Owner']);
  });

  it('relocates non-component discriminator mapping targets as schemas', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Discriminator References API', version: '1.0.0' },
      paths: {
        '/pets': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Pet: {
            $id: 'urn:pet',
            oneOf: [{ type: 'object' }],
            discriminator: {
              propertyName: 'petType',
              mapping: {
                dog: '#/x-schemas/Dog',
                owner: '#/components/schemas/Owner',
              },
            },
          },
          Owner: { type: 'object' },
        },
      },
      'x-schemas': {
        Dog: {
          type: 'object',
          properties: { owner: { $ref: '#/components/schemas/Owner' } },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/pets', 'get');
    const schemas = (result?.components as Record<string, Record<string, unknown>>).schemas;
    const pet = schemas.Pet as Record<string, Record<string, Record<string, string>>>;
    const mapping = pet.discriminator.mapping;

    expect(mapping.dog).toBe('#/x-knife4j-local-ref-targets/target-1');
    expect(mapping.owner).toBe('#/components/schemas/Owner');
    expect(resolveLocalRef(result, mapping.dog)).toMatchObject({ type: 'object' });
    expect(schemas).toHaveProperty('Owner');
    expect(result).not.toHaveProperty('x-schemas');
  });

  it('collects security requirements from relocated callback targets', () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Relocated Callbacks API', version: '1.0.0' },
      security: [{ RootKey: [] }],
      paths: {
        '/selected': {
          post: {
            security: [],
            callbacks: {
              changed: { $ref: '#/x-callbacks/Changed' },
            },
            responses: { 202: { description: 'accepted' } },
          },
        },
      },
      components: {
        securitySchemes: {
          RootKey: { type: 'apiKey', in: 'header', name: 'X-Root-Key' },
          ChildKey: { type: 'apiKey', in: 'header', name: 'X-Child-Key' },
          Unused: { type: 'apiKey', in: 'header', name: 'X-Unused' },
        },
      },
      'x-callbacks': {
        Changed: {
          '{$request.body#/callbackUrl}': {
            post: {
              security: [{ ChildKey: [] }],
              responses: { 204: { description: 'changed' } },
            },
            put: {
              responses: { 204: { description: 'changed with root security' } },
            },
          },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/selected', 'post');
    const components = result?.components as Record<string, Record<string, unknown>>;

    expect(result?.security).toEqual([{ RootKey: [] }]);
    expect(Object.keys(components.securitySchemes).sort()).toEqual(['ChildKey', 'RootKey']);
    expect(result).not.toHaveProperty('x-callbacks');
  });

  it('stores prototype-named component entries as own properties', () => {
    const document = JSON.parse(`{
      "openapi": "3.1.0",
      "info": { "title": "Prototype Keys API", "version": "1.0.0" },
      "security": [{ "__proto__": [] }],
      "paths": {
        "/prototype": {
          "get": {
            "responses": {
              "200": {
                "description": "ok",
                "content": {
                  "application/json": {
                    "schema": { "$ref": "#/components/schemas/__proto__" }
                  }
                }
              }
            }
          }
        }
      },
      "components": {
        "schemas": {
          "__proto__": { "type": "object" }
        },
        "securitySchemes": {
          "__proto__": { "type": "http", "scheme": "bearer" }
        }
      }
    }`) as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/prototype', 'get');
    const components = result?.components as Record<string, Record<string, unknown>>;

    expect(Object.getPrototypeOf(components)).toBeNull();
    expect(Object.getPrototypeOf(components.schemas)).toBeNull();
    expect(Object.getPrototypeOf(components.securitySchemes)).toBeNull();
    expect(Object.hasOwn(components.schemas, '__proto__')).toBe(true);
    expect(Object.hasOwn(components.securitySchemes, '__proto__')).toBe(true);
    localRefs(result).forEach((ref) => expect(resolveLocalRef(result, ref), ref).toBeDefined());

    const serialized = JSON.parse(serializeOperationOpenApiDocument(result!)) as {
      components: Record<string, Record<string, unknown>>;
    };
    expect(Object.hasOwn(serialized.components.schemas, '__proto__')).toBe(true);
    expect(Object.hasOwn(serialized.components.securitySchemes, '__proto__')).toBe(true);
  });

  it('preserves root security inherited by callback operations when the selected operation overrides it', () => {
    const document = makeDocument() as unknown as Record<string, unknown>;
    const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>;
    paths['/pets/{petId}'].get.security = [];
    const components = document.components as Record<string, Record<string, Record<string, unknown>>>;
    const callback = components.callbacks.PetChanged['{$request.body#/callbackUrl}'] as Record<
      string,
      Record<string, unknown>
    >;
    delete callback.post.security;

    const result = buildOperationOpenApiDocument(document as unknown as SwaggerDoc, '/pets/{petId}', 'get');

    expect(result).toHaveProperty('security', [{ OAuth2: ['pets:read'] }]);
    const outputPaths = result?.paths as Record<string, Record<string, Record<string, unknown>>>;
    expect(outputPaths['/pets/{petId}'].get.security).toEqual([]);
    const securitySchemes = (result?.components as Record<string, Record<string, unknown>>).securitySchemes;
    expect(securitySchemes).toHaveProperty('OAuth2');
    expect(securitySchemes).not.toHaveProperty('CallbackKey');
  });

  it('omits unused root security when the selected operation overrides it without callbacks', () => {
    const document = makeDocument() as unknown as Record<string, unknown>;
    const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>;
    paths['/pets/{petId}'].get.security = [];
    delete paths['/pets/{petId}'].get.callbacks;

    const result = buildOperationOpenApiDocument(document as unknown as SwaggerDoc, '/pets/{petId}', 'get');

    expect(result).not.toHaveProperty('security');
    const securitySchemes = (result?.components as Record<string, Record<string, unknown>>).securitySchemes;
    expect(securitySchemes).toBeUndefined();
  });

  it('returns null for a non-OAS3 document or missing operation', () => {
    const document = makeDocument();

    expect(buildOperationOpenApiDocument({ ...document, openapi: undefined }, '/pets/{petId}', 'get')).toBeNull();
    expect(buildOperationOpenApiDocument(document, '/pets/{petId}', 'delete')).toBeNull();
  });

  it('serializes the constructed document as formatted JSON', () => {
    const result = buildOperationOpenApiDocument(makeDocument(), '/pets/{petId}', 'get');

    expect(serializeOperationOpenApiDocument(result!)).toBe(JSON.stringify(result, null, 2));
  });

  it('surfaces JSON serialization failures', () => {
    expect(() => serializeOperationOpenApiDocument({ invalid: BigInt(1) })).toThrow(TypeError);
  });
});

describe('buildOperationOpenApiFilename', () => {
  it('prefers method and operationId while removing unsafe path characters', () => {
    const filename = buildOperationOpenApiFilename('get', '/pets/{id}', '../pet\\detail:*?"<>|');

    expect(filename).toBe('GET-.._pet_detail_.openapi.json');
    expect(filename).not.toMatch(/[/\\:*?"<>|]/);
  });

  it('falls back to the method and path', () => {
    expect(buildOperationOpenApiFilename('post', '/pets/{id}')).toBe('POST-_pets_{id}.openapi.json');
  });

  it('preserves legal underscores from the operationId', () => {
    expect(buildOperationOpenApiFilename('get', '/pets', 'get__pet')).toBe('GET-get__pet.openapi.json');
  });
});

describe('downloadOperationOpenApiJson', () => {
  it('clicks a temporary anchor and revokes its Blob URL', () => {
    vi.useFakeTimers();
    const click = vi.fn();
    const remove = vi.fn();
    const appendChild = vi.fn();
    const anchor = { href: '', download: '', style: { display: '' }, click, remove };
    const createObjectURL = vi.fn(() => 'blob:http://localhost/operation');
    const revokeObjectURL = vi.fn();

    vi.stubGlobal('document', {
      body: { appendChild },
      createElement: vi.fn(() => anchor),
    });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    expect(downloadOperationOpenApiJson('{\n  "openapi": "3.1.0"\n}', 'GET-getPet.openapi.json')).toBe(true);
    expect(anchor.download).toBe('GET-getPet.openapi.json');
    expect(anchor.href).toBe('blob:http://localhost/operation');
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/operation');
  });

  it('returns false when browser download APIs are unavailable', () => {
    vi.stubGlobal('document', undefined);

    expect(downloadOperationOpenApiJson('{}', 'GET-operation.openapi.json')).toBe(false);
  });
});
