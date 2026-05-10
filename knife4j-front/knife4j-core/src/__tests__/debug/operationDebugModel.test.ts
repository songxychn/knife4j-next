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
    // Single-binary (not array) must NOT appear in fileFieldsMultiple (issue #251).
    // Without this, the React UI renders <Upload multiple /> for single-file endpoints
    // and happily sends multiple parts that the server silently drops.
    expect(model.bodyContents[0].fileFieldsMultiple ?? []).not.toContain('file');
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

    // issue #251: the array / non-array distinction must be preserved so the UI can
    // decide between <Upload multiple /> and <Upload /> (single). fileFields alone
    // cannot carry this (it is string[] consumed by existing callers).
    const multiple = model.bodyContents[0].fileFieldsMultiple ?? [];
    expect(multiple).toContain('files'); // Flux<FilePart> / MultipartFile[]
    expect(multiple).not.toContain('avatar'); // single FilePart / MultipartFile
    expect(multiple).not.toContain('description'); // not a file field at all
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
    // base64 array should also be treated as a multi-file field (issue #251).
    expect(model.bodyContents[0].fileFieldsMultiple ?? []).toContain('attachments');
  });

  // Regression guard for issue #251 live repro against knife4j-demo:
  //
  //   springdoc 2.x (OAS 3.1) emits `@ArraySchema(schema=@Schema(type="string",
  //   format="binary"))` as `{ items: { format: "binary", description: ... } }` —
  //   it DROPS `type:"string"` from items. Matching `items.type === 'string'`
  //   silently fails, the 'files' field falls out of both fileFields and
  //   fileFieldsMultiple, and the React UI renders a plain text input instead of
  //   a multi-file Upload widget.
  //
  //   This test uses the exact shape produced by `curl /v3/api-docs` against the
  //   knife4j-demo `POST /upload/files-with-meta` endpoint (UploadController).
  test('parses OAS3 multipart with items.type omitted (springdoc 2.x reality) — array-of-binary still detected', () => {
    const doc = {
      openapi: '3.0.1',
      info: { title: 'T', version: '1' },
      paths: {
        '/upload/files-with-meta': {
          post: {
            requestBody: {
              required: true,
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    properties: {
                      // NOTE: no `type: 'string'` inside items — matches springdoc 2.x output.
                      files: {
                        type: 'array',
                        items: { format: 'binary', description: 'Files to upload' },
                        minItems: 1,
                      },
                      meta: { type: 'object', description: 'JSON meta' },
                    },
                    required: ['meta'],
                  },
                  encoding: { meta: { contentType: 'application/json' } },
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
      path: '/upload/files-with-meta',
      method: 'post',
    });

    expect(model.bodyContents[0].fileFields).toContain('files');
    expect(model.bodyContents[0].fileFieldsMultiple ?? []).toContain('files');
    // meta is not a file field.
    expect(model.bodyContents[0].fileFields).not.toContain('meta');
  });

  // Negative case to make sure we don't over-trigger: a plain number[] array
  // must not be mistaken for a file just because the loosened items check no
  // longer requires type:"string".
  test('does not mistake non-binary array for file field', () => {
    const doc = {
      openapi: '3.0.1',
      info: { title: 'T', version: '1' },
      paths: {
        '/x': {
          post: {
            requestBody: {
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    properties: {
                      // Explicit non-string items — must stay out of fileFields.
                      ids: { type: 'array', items: { type: 'integer' } },
                      // No format — must stay out.
                      tags: { type: 'array', items: { type: 'string' } },
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
      path: '/x',
      method: 'post',
    });

    expect(model.bodyContents[0].fileFields ?? []).not.toContain('ids');
    expect(model.bodyContents[0].fileFields ?? []).not.toContain('tags');
    expect(model.bodyContents[0].fileFieldsMultiple ?? []).not.toContain('ids');
    expect(model.bodyContents[0].fileFieldsMultiple ?? []).not.toContain('tags');
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

  // Regression test for upstream #964 / issue #287:
  // @ParameterObject flattens a Java POJO into individual query params.
  // springdoc may generate parameters with schema.$ref pointing to a component
  // schema that has no explicit `type` field (OAS3.1 permits omitting type).
  // In that case extractType must NOT blindly fall back to 'string' — it should
  // infer the type from enum values, properties, items, etc.
  test('@ParameterObject — field types preserved when schema.$ref resolves to typeless schema', () => {
    const doc = {
      openapi: '3.0.1',
      info: { title: 'T', version: '1' },
      paths: {
        '/api/query': {
          get: {
            parameters: [
              // inline schema with explicit type — must still work
              { name: 'keyword', in: 'query', schema: { type: 'string' } },
              // schema.$ref → resolves to integer type
              { name: 'page', in: 'query', schema: { $ref: '#/components/schemas/PageNum' } },
              // schema.$ref → resolves to schema with no type but integer enum values
              { name: 'status', in: 'query', schema: { $ref: '#/components/schemas/StatusCode' } },
              // schema.$ref → resolves to object (has properties)
              { name: 'filter', in: 'query', schema: { $ref: '#/components/schemas/FilterObj' } },
              // schema.$ref → resolves to array (has items)
              { name: 'tags', in: 'query', schema: { $ref: '#/components/schemas/TagList' } },
              // schema.$ref → boolean flag without explicit type
              { name: 'active', in: 'query', schema: { $ref: '#/components/schemas/BoolFlag' } },
            ],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
      components: {
        schemas: {
          // explicit type field — normal case
          PageNum: { type: 'integer', format: 'int32' },
          // no type field but all enum values are integers
          StatusCode: { description: 'Status', enum: [1, 2, 3] },
          // no type field but has properties → should be 'object'
          FilterObj: { description: 'Filter', properties: { key: { type: 'string' } } },
          // no type field but has items → should be 'array'
          TagList: { description: 'Tags', items: { type: 'string' } },
          // no type field but all enum values are boolean
          BoolFlag: { description: 'Active flag', enum: [true, false] },
        },
      },
    };

    const model = buildOperationDebugModel({ doc: doc as any, path: '/api/query', method: 'get' });

    expect(model.queryParams).toHaveLength(6);

    const byName = Object.fromEntries(model.queryParams.map((p) => [p.name, p]));

    // inline schema — must work as before
    expect(byName['keyword'].type).toBe('string');
    // $ref resolves to schema with explicit type
    expect(byName['page'].type).toBe('integer');
    // $ref resolves to schema with integer enum values → must be 'integer', NOT 'string'
    expect(byName['status'].type).toBe('integer');
    // $ref resolves to schema with properties → must be 'object', NOT 'string'
    expect(byName['filter'].type).toBe('object');
    // $ref resolves to schema with items → must be 'array', NOT 'string'
    expect(byName['tags'].type).toBe('array');
    // $ref resolves to schema with boolean enum values → must be 'boolean', NOT 'string'
    expect(byName['active'].type).toBe('boolean');
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
