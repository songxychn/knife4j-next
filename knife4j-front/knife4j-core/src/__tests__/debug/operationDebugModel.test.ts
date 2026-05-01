import { buildOperationDebugModel } from '../../debug/operationDebugModel';

describe('buildOperationDebugModel — OAS3', () => {
  const oas3Doc = {
    openapi: '3.0.1',
    info: { title: 'Test', version: '1.0' },
    paths: {
      '/users/{id}': {
        get: {
          operationId: 'getUser',
          summary: 'Get user by ID',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer', format: 'int64' } },
            { name: 'detail', in: 'query', required: false, schema: { type: 'boolean' } },
            { name: 'X-Request-Id', in: 'header', required: false, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: { '200': { description: 'OK' } },
        },
        post: {
          operationId: 'createUser',
          summary: 'Create user',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    age: { type: 'integer' },
                  },
                  required: ['name'],
                },
              },
            },
          },
          responses: { '200': { description: 'OK' } },
        },
      },
    },
    components: {
      schemas: {
        User: {
          type: 'object',
          properties: { id: { type: 'integer' }, name: { type: 'string' } },
        },
      },
    },
  };

  test('parses OAS3 GET with path + query + header params', () => {
    const model = buildOperationDebugModel({
      doc: oas3Doc as any,
      path: '/users/{id}',
      method: 'get',
    });

    expect(model.pathParams).toHaveLength(1);
    expect(model.pathParams[0].name).toBe('id');
    expect(model.pathParams[0].required).toBe(true);
    expect(model.pathParams[0].type).toBe('integer');

    expect(model.queryParams).toHaveLength(1);
    expect(model.queryParams[0].name).toBe('detail');
    expect(model.queryParams[0].type).toBe('boolean');
    expect(model.queryParams[0].required).toBe(false);

    expect(model.headerParams).toHaveLength(1);
    expect(model.headerParams[0].name).toBe('X-Request-Id');

    expect(model.bodyContents).toHaveLength(0);
    expect(model.bodyRequired).toBe(false);
  });

  test('parses OAS3 POST with requestBody', () => {
    const model = buildOperationDebugModel({
      doc: oas3Doc as any,
      path: '/users/{id}',
      method: 'post',
    });

    expect(model.pathParams).toHaveLength(1);
    expect(model.bodyContents).toHaveLength(1);
    expect(model.bodyContents[0].mediaType).toBe('application/json');
    expect(model.bodyContents[0].category).toBe('json');
    expect(model.bodyRequired).toBe(true);

    expect(model.bodyContents[0].exampleValue).toBeDefined();
    const parsed = JSON.parse(model.bodyContents[0].exampleValue!);
    expect(parsed).toHaveProperty('name');
    expect(parsed).toHaveProperty('age');
  });

  test('parses OAS3 with $ref requestBody', () => {
    const docWithRef = {
      openapi: '3.0.1',
      info: { title: 'T', version: '1' },
      paths: {
        '/pets': {
          post: {
            requestBody: {
              $ref: '#/components/requestBodies/PetBody',
            },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
      components: {
        requestBodies: {
          PetBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
              },
            },
          },
        },
        schemas: {
          User: {
            type: 'object',
            properties: { id: { type: 'integer' }, name: { type: 'string' } },
          },
        },
      },
    };

    const model = buildOperationDebugModel({
      doc: docWithRef as any,
      path: '/pets',
      method: 'post',
    });

    expect(model.bodyContents).toHaveLength(1);
    expect(model.bodyContents[0].schema).toBeDefined();
    expect(model.bodyContents[0].schema!.type).toBe('object');
    expect(model.bodyRequired).toBe(true);
  });

  test('parses OAS3 multipart with file fields', () => {
    const doc = {
      openapi: '3.0.1',
      info: { title: 'T', version: '1' },
      paths: {
        '/upload': {
          post: {
            requestBody: {
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    properties: {
                      file: { type: 'string', format: 'binary' },
                      description: { type: 'string' },
                    },
                  },
                },
              },
            },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    };

    const model = buildOperationDebugModel({
      doc: doc as any,
      path: '/upload',
      method: 'post',
    });

    expect(model.bodyContents).toHaveLength(1);
    expect(model.bodyContents[0].category).toBe('multipart');
    expect(model.bodyContents[0].fileFields).toContain('file');
    expect(model.bodyContents[0].fileFields).not.toContain('description');
  });

  // WebFlux + springdoc: Flux<FilePart> generates {type:array, items:{type:string,format:binary}}
  // This test verifies extractFileFields() correctly identifies array-of-binary as a file field
  // (upstream xiaoymin/knife4j#733)
  test('parses OAS3 multipart with Flux<FilePart> — array-of-binary schema', () => {
    const doc = {
      openapi: '3.0.1',
      info: { title: 'T', version: '1' },
      paths: {
        '/upload/flux': {
          post: {
            requestBody: {
              required: true,
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    properties: {
                      // Flux<FilePart> → springdoc generates array of binary
                      files: { type: 'array', items: { type: 'string', format: 'binary' } },
                      // FilePart (single) → string/binary
                      avatar: { type: 'string', format: 'binary' },
                      // plain text field — must NOT be treated as file
                      description: { type: 'string' },
                    },
                  },
                },
              },
            },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    };

    const model = buildOperationDebugModel({
      doc: doc as any,
      path: '/upload/flux',
      method: 'post',
    });

    expect(model.bodyContents).toHaveLength(1);
    expect(model.bodyContents[0].category).toBe('multipart');
    // array-of-binary (Flux<FilePart>) must be in fileFields
    expect(model.bodyContents[0].fileFields).toContain('files');
    // single binary (FilePart) must be in fileFields
    expect(model.bodyContents[0].fileFields).toContain('avatar');
    // plain string must NOT be in fileFields
    expect(model.bodyContents[0].fileFields).not.toContain('description');
  });

  test('parses OAS3 multipart with array-of-base64 schema as file field', () => {
    const doc = {
      openapi: '3.0.1',
      info: { title: 'T', version: '1' },
      paths: {
        '/upload/b64': {
          post: {
            requestBody: {
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    properties: {
                      attachments: { type: 'array', items: { type: 'string', format: 'base64' } },
                    },
                  },
                },
              },
            },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    };

    const model = buildOperationDebugModel({
      doc: doc as any,
      path: '/upload/b64',
      method: 'post',
    });

    expect(model.bodyContents[0].fileFields).toContain('attachments');
  });

  test('parses OAS3 with multiple content types in requestBody', () => {
    const doc = {
      openapi: '3.0.1',
      info: { title: 'T', version: '1' },
      paths: {
        '/data': {
          post: {
            requestBody: {
              content: {
                'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } },
                'application/xml': { schema: { type: 'object', properties: { name: { type: 'string' } } } },
                'text/plain': { schema: { type: 'string' } },
              },
            },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    };

    const model = buildOperationDebugModel({
      doc: doc as any,
      path: '/data',
      method: 'post',
    });

    expect(model.bodyContents).toHaveLength(3);
    expect(model.bodyContents[0].category).toBe('json');
    expect(model.bodyContents[1].category).toBe('raw');
    expect(model.bodyContents[2].category).toBe('raw');
  });

  test('returns empty model for non-existent path', () => {
    const model = buildOperationDebugModel({
      doc: oas3Doc as any,
      path: '/nonexistent',
      method: 'get',
    });

    expect(model.pathParams).toHaveLength(0);
    expect(model.bodyContents).toHaveLength(0);
  });

  test('returns empty model for non-existent method', () => {
    const model = buildOperationDebugModel({
      doc: oas3Doc as any,
      path: '/users/{id}',
      method: 'delete',
    });

    expect(model.pathParams).toHaveLength(0);
    expect(model.bodyContents).toHaveLength(0);
  });

  test('path-level parameters are merged with operation-level', () => {
    const doc = {
      openapi: '3.0.1',
      info: { title: 'T', version: '1' },
      paths: {
        '/items': {
          parameters: [{ name: 'X-Common', in: 'header', required: true, schema: { type: 'string' } }],
          get: {
            parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    };

    const model = buildOperationDebugModel({
      doc: doc as any,
      path: '/items',
      method: 'get',
    });

    expect(model.headerParams).toHaveLength(1);
    expect(model.headerParams[0].name).toBe('X-Common');
    expect(model.queryParams).toHaveLength(1);
    expect(model.queryParams[0].name).toBe('page');
  });

  test('operation parameter overrides path-level with same name+in', () => {
    const doc = {
      openapi: '3.0.1',
      info: { title: 'T', version: '1' },
      paths: {
        '/items': {
          parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' }, description: 'path-level' }],
          get: {
            parameters: [{ name: 'page', in: 'query', schema: { type: 'string' }, description: 'op-level' }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    };

    const model = buildOperationDebugModel({
      doc: doc as any,
      path: '/items',
      method: 'get',
    });

    expect(model.queryParams).toHaveLength(1);
    expect(model.queryParams[0].description).toBe('op-level');
  });
});

describe('buildOperationDebugModel — OAS2', () => {
  const oas2Doc = {
    swagger: '2.0',
    info: { title: 'Test', version: '1.0' },
    basePath: '/api',
    paths: {
      '/users/{id}': {
        get: {
          operationId: 'getUser',
          parameters: [
            { name: 'id', in: 'path', required: true, type: 'integer', format: 'int64' },
            { name: 'verbose', in: 'query', type: 'boolean' },
            { name: 'X-Token', in: 'header', type: 'string' },
          ],
          responses: { '200': { description: 'OK' } },
        },
        post: {
          operationId: 'createUser',
          parameters: [
            { name: 'id', in: 'path', required: true, type: 'integer' },
            {
              name: 'body',
              in: 'body',
              required: true,
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  age: { type: 'integer' },
                },
              },
            },
          ],
          responses: { '200': { description: 'OK' } },
        },
      },
      '/upload': {
        post: {
          operationId: 'uploadFile',
          consumes: ['multipart/form-data'],
          parameters: [
            { name: 'file', in: 'formData', type: 'file', description: 'Upload file' },
            { name: 'description', in: 'formData', type: 'string', required: true },
          ],
          responses: { '200': { description: 'OK' } },
        },
      },
    },
    definitions: {
      User: {
        type: 'object',
        properties: { id: { type: 'integer' }, name: { type: 'string' } },
      },
    },
  };

  test('parses OAS2 GET with path + query + header params', () => {
    const model = buildOperationDebugModel({
      doc: oas2Doc as any,
      path: '/users/{id}',
      method: 'get',
      isOAS2: true,
    });

    expect(model.pathParams).toHaveLength(1);
    expect(model.pathParams[0].name).toBe('id');
    expect(model.pathParams[0].type).toBe('integer');
    expect(model.pathParams[0].required).toBe(true);

    expect(model.queryParams).toHaveLength(1);
    expect(model.queryParams[0].name).toBe('verbose');

    expect(model.headerParams).toHaveLength(1);
    expect(model.headerParams[0].name).toBe('X-Token');
  });

  test('parses OAS2 POST with in=body parameter', () => {
    const model = buildOperationDebugModel({
      doc: oas2Doc as any,
      path: '/users/{id}',
      method: 'post',
      isOAS2: true,
    });

    expect(model.pathParams).toHaveLength(1);
    expect(model.bodyContents).toHaveLength(1);
    expect(model.bodyContents[0].category).toBe('json');
    expect(model.bodyRequired).toBe(true);
  });

  test('parses OAS2 formData parameters into bodyContents', () => {
    const model = buildOperationDebugModel({
      doc: oas2Doc as any,
      path: '/upload',
      method: 'post',
      isOAS2: true,
    });

    expect(model.bodyContents).toHaveLength(1);
    expect(model.bodyContents[0].category).toBe('multipart');
    expect(model.bodyContents[0].mediaType).toBe('multipart/form-data');
    expect(model.bodyContents[0].fileFields).toContain('file');

    // schema.properties 应包含 formData 字段
    const props = model.bodyContents[0].schema!.properties as Record<string, any>;
    expect(props).toHaveProperty('description');
    expect(props).toHaveProperty('file');
  });

  test('OAS2 formData with urlencoded consumes', () => {
    const doc = {
      swagger: '2.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/login': {
          post: {
            consumes: ['application/x-www-form-urlencoded'],
            parameters: [
              { name: 'username', in: 'formData', type: 'string', required: true },
              { name: 'password', in: 'formData', type: 'string', required: true },
            ],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    };

    const model = buildOperationDebugModel({
      doc: doc as any,
      path: '/login',
      method: 'post',
      isOAS2: true,
    });

    expect(model.bodyContents).toHaveLength(1);
    expect(model.bodyContents[0].category).toBe('urlencoded');
    expect(model.bodyContents[0].mediaType).toBe('application/x-www-form-urlencoded');
  });

  test('OAS2 $ref parameter is resolved', () => {
    const doc = {
      swagger: '2.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/items': {
          get: {
            parameters: [{ $ref: '#/parameters/PageParam' }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
      parameters: {
        PageParam: { name: 'page', in: 'query', type: 'integer', description: 'Page number' },
      },
    };

    const model = buildOperationDebugModel({
      doc: doc as any,
      path: '/items',
      method: 'get',
      isOAS2: true,
    });

    expect(model.queryParams).toHaveLength(1);
    expect(model.queryParams[0].name).toBe('page');
    expect(model.queryParams[0].type).toBe('integer');
  });
});
