import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SwaggerDoc } from '../../types/swagger';
import {
  buildOperationOpenApiDocument,
  buildOperationOpenApiFilename,
  buildOperationOpenApiPreviewDocument,
  downloadOperationOpenApiJson,
  serializeOperationOpenApiDocument,
  supportsOperationOpenApiDownload,
} from './operationOpenApiDocument';

function makeDocument(): SwaggerDoc {
  return {
    openapi: '3.0.3',
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
      openapi: '3.0.3',
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

  it('keeps example payloads and specification extensions opaque', () => {
    const document = {
      openapi: '3.0.3',
      info: { title: 'Opaque Values API', version: '1.0.0' },
      paths: {
        '/events': {
          get: {
            'x-debug-payload': { $ref: '#/components/schemas/Unused' },
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': {
                    examples: {
                      event: { $ref: '#/components/examples/Event' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        examples: {
          Event: {
            value: { $ref: '#/components/schemas/Unused' },
          },
        },
        schemas: {
          Unused: { type: 'object' },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/events', 'get');
    const components = result?.components as Record<string, Record<string, Record<string, unknown>>>;
    const paths = result?.paths as Record<string, Record<string, Record<string, unknown>>>;

    expect(components.examples.Event.value).toEqual({ $ref: '#/components/schemas/Unused' });
    expect(components.schemas).toBeUndefined();
    expect(paths['/events'].get['x-debug-payload']).toEqual({ $ref: '#/components/schemas/Unused' });
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

  it('relocates discriminator mappings to inline schemas outside components', () => {
    const document = {
      openapi: '3.0.3',
      info: { title: 'Inline Discriminator API', version: '1.0.0' },
      paths: {
        '/selected': {
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
        '/catalog': {
          get: {
            responses: {
              200: {
                description: 'catalog entry',
                content: {
                  'application/json': {
                    schema: {
                      allOf: [
                        { $ref: '#/components/schemas/Pet' },
                        {
                          type: 'object',
                          properties: { details: { $ref: '#/components/schemas/CatalogDetails' } },
                        },
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
          Pet: {
            type: 'object',
            discriminator: {
              propertyName: 'kind',
              mapping: {
                catalog: '#/paths/~1catalog/get/responses/200/content/application~1json/schema',
              },
            },
          },
          CatalogDetails: { type: 'object' },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/selected', 'get');
    const serialized = JSON.parse(serializeOperationOpenApiDocument(result!)) as {
      paths: Record<string, unknown>;
      components: { schemas: Record<string, { discriminator?: { mapping?: Record<string, string> } }> };
    };
    const mapping = serialized.components.schemas.Pet.discriminator?.mapping?.catalog;

    expect(Object.keys(serialized.paths)).toEqual(['/selected']);
    expect(mapping).toBe('#/x-knife4j-local-ref-targets/target-1');
    expect(resolveLocalRef(result, mapping!)).toHaveProperty('allOf');
    expect(Object.keys(serialized.components.schemas).sort()).toEqual(['CatalogDetails', 'Pet']);
    localRefs(result).forEach((ref) => expect(resolveLocalRef(result, ref), ref).toBeDefined());
  });

  it('decodes URI fragments before splitting component JSON pointers', () => {
    const document = {
      openapi: '3.0.3',
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
      openapi: '3.0.3',
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

  it('relocates local Link operationRefs without exporting the target operation', () => {
    const document = {
      openapi: '3.0.3',
      info: { title: 'Operation Link API', version: '1.0.0' },
      paths: {
        '/selected': {
          get: {
            responses: {
              200: {
                description: 'ok',
                links: {
                  deleteOrder: { operationRef: '#/paths/~1orders/delete' },
                },
              },
            },
          },
        },
        '/orders': {
          delete: {
            operationId: 'deleteOrder',
            responses: {
              204: {
                description: 'deleted',
                headers: { 'X-Receipt': { $ref: '#/components/headers/Receipt' } },
              },
            },
          },
        },
      },
      components: {
        headers: {
          Receipt: { schema: { type: 'string' } },
        },
      },
    } as unknown as SwaggerDoc;

    const result = buildOperationOpenApiDocument(document, '/selected', 'get');
    const serialized = JSON.parse(serializeOperationOpenApiDocument(result!)) as {
      paths: Record<
        string,
        { get: { responses: Record<string, { links: Record<string, { operationRef: string }> }> } }
      >;
    };
    const operationRef = serialized.paths['/selected'].get.responses[200].links.deleteOrder.operationRef;

    expect(Object.keys(serialized.paths)).toEqual(['/selected']);
    expect(operationRef).toBe('#/x-knife4j-local-ref-targets/target-1');
    expect(resolveLocalRef(result, operationRef)).toMatchObject({ operationId: 'deleteOrder' });
    expect((result?.components as Record<string, Record<string, unknown>>).headers).toHaveProperty('Receipt');
    localRefs(result).forEach((ref) => expect(resolveLocalRef(result, ref), ref).toBeDefined());
  });

  it('stores prototype-named component entries as own properties', () => {
    const document = JSON.parse(`{
      "openapi": "3.0.3",
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

  it('returns null outside the OAS 3.0.x download contract or when the operation is missing', () => {
    const document = makeDocument();

    expect(buildOperationOpenApiDocument({ ...document, openapi: undefined }, '/pets/{petId}', 'get')).toBeNull();
    expect(buildOperationOpenApiDocument({ ...document, openapi: '3.1.0' }, '/pets/{petId}', 'get')).toBeNull();
    expect(buildOperationOpenApiDocument({ ...document, openapi: '3.2.0' }, '/pets/{petId}', 'get')).toBeNull();
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

describe('operation OpenAPI preview compatibility', () => {
  it('keeps preview and copy data available when the download contract does not cover the OAS version', () => {
    const document = { ...makeDocument(), openapi: '3.1.0' } as SwaggerDoc;

    expect(supportsOperationOpenApiDownload(document)).toBe(false);
    expect(buildOperationOpenApiDocument(document, '/pets/{petId}', 'get')).toBeNull();

    const preview = buildOperationOpenApiPreviewDocument(document, '/pets/{petId}', 'get');
    const paths = preview?.paths as Record<string, Record<string, unknown>>;
    expect(preview).toMatchObject({ openapi: '3.1.0', info: { title: 'Pet API' } });
    expect(Object.keys(paths)).toEqual(['/pets/{petId}']);
    expect(paths['/pets/{petId}']).toHaveProperty('get');
    expect(paths['/pets/{petId}']).not.toHaveProperty('post');
  });

  it('uses the closed document for OAS 3.0.x previews', () => {
    const document = makeDocument();

    expect(supportsOperationOpenApiDownload(document)).toBe(true);
    expect(buildOperationOpenApiPreviewDocument(document, '/pets/{petId}', 'get')).toEqual(
      buildOperationOpenApiDocument(document, '/pets/{petId}', 'get'),
    );
  });

  it('preserves a webhook operation under webhooks in an OAS 3.1 preview', () => {
    const document = {
      openapi: '3.1.1',
      jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
      info: { title: 'Event API', version: '1.0.0' },
      webhooks: {
        petChanged: { $ref: '#/components/pathItems/PetChanged' },
      },
      components: {
        pathItems: {
          PetChanged: {
            post: {
              operationId: 'petChanged',
              responses: { 200: { description: 'Accepted' } },
            },
          },
        },
      },
    } as SwaggerDoc;

    expect(buildOperationOpenApiPreviewDocument(document, 'petChanged', 'post', 'webhook')).toEqual({
      openapi: '3.1.1',
      jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
      info: { title: 'Event API', version: '1.0.0' },
      webhooks: {
        petChanged: {
          post: {
            operationId: 'petChanged',
            responses: { 200: { description: 'Accepted' } },
          },
        },
      },
    });
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

    expect(downloadOperationOpenApiJson('{\n  "openapi": "3.0.3"\n}', 'GET-getPet.openapi.json')).toBe(true);
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
