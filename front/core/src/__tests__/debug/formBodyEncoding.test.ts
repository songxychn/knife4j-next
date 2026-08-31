import {
  buildCurl,
  buildOperationDebugModel,
  buildRequest,
  serializeOas31FormBody,
  type OperationDebugModel,
} from '../../debug';

function debugModelFor(
  mediaType: string,
  schema: Record<string, unknown>,
  encoding?: Record<string, unknown>,
  version = '3.1.1',
): OperationDebugModel {
  return buildOperationDebugModel({
    doc: {
      openapi: version,
      info: { title: 'form fixture', version: '1.0.0' },
      paths: {
        '/submit': {
          post: {
            requestBody: {
              required: true,
              content: {
                [mediaType]: { schema, ...(encoding ? { encoding } : {}) },
              },
            },
          },
        },
      },
    },
    path: '/submit',
    method: 'post',
  });
}

describe('OAS 3.1 form body encoding', () => {
  test('uses content-based defaults for urlencoded primitives and objects', () => {
    const model = debugModelFor('application/x-www-form-urlencoded', {
      type: 'object',
      properties: {
        id: { type: 'string' },
        address: {
          type: 'object',
          properties: { city: { type: 'string' }, zip: { type: 'string' } },
        },
      },
    });

    const built = buildRequest({
      baseUrl: 'https://api.example.test',
      path: '/submit',
      method: 'post',
      debugModel: model,
      formValues: {
        pathParams: {},
        queryParams: {},
        headerParams: {},
        cookieParams: {},
        selectedContentType: 'application/x-www-form-urlencoded',
        formFields: {
          id: 'f81d4fae',
          address: '{"city":"Some where","zip":"99999+1234"}',
        },
      },
    });

    expect(built.body).toBe('id=f81d4fae&address=%7B%22city%22%3A%22Some+where%22%2C%22zip%22%3A%2299999%2B1234%22%7D');
    expect(built.formBodyPlan).toMatchObject({
      kind: 'urlencoded',
      instance: { id: 'f81d4fae', address: { city: 'Some where', zip: '99999+1234' } },
      ignoredProperties: [],
      diagnostics: [],
    });
  });

  test('applies urlencoded style, explode and allowReserved without a second encoder', () => {
    const model = debugModelFor(
      'application/x-www-form-urlencoded',
      {
        type: 'object',
        properties: {
          profile: {
            type: 'object',
            properties: { path: { type: 'string' }, label: { type: 'string' } },
          },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
      {
        profile: { style: 'deepObject', explode: true, allowReserved: true, contentType: 'application/json' },
        tags: { style: 'form', explode: false },
      },
    );

    const plan = serializeOas31FormBody(model.bodyContents[0], {
      formFields: {
        profile: '{"path":"/a?b","label":"a+b"}',
        tags: '["red","blue"]',
      },
    });

    expect(plan).toMatchObject({
      kind: 'urlencoded',
      body: 'profile%5Bpath%5D=/a?b&profile%5Blabel%5D=a%2Bb&tags=red,blue',
      diagnostics: [],
      instance: { profile: { path: '/a?b', label: 'a+b' }, tags: ['red', 'blue'] },
    });
  });

  test('builds one ordered multipart plan for JSON, single-file and multiple-file parts', () => {
    const model = debugModelFor(
      'multipart/form-data',
      {
        type: 'object',
        required: ['metadata', 'avatar', 'attachments'],
        properties: {
          metadata: {
            $ref: '#/paths/~1submit/post/requestBody/content/multipart~1form-data/schema/$defs/Metadata',
          },
          avatar: { format: 'binary' },
          attachments: { type: 'array', items: { type: 'string', format: 'binary' } },
        },
        $defs: {
          Metadata: {
            type: 'object',
            required: ['active'],
            properties: { active: { type: 'boolean' } },
          },
        },
      },
      {
        metadata: {
          contentType: 'application/json',
          headers: {
            'X-Part-Trace': { required: true, schema: { type: 'string' } },
          },
        },
        avatar: { contentType: 'image/png, image/jpeg' },
      },
    );

    const plan = serializeOas31FormBody(model.bodyContents[0], {
      formFields: { metadata: '{"active":true}' },
      fileFields: {
        avatar: [{ name: 'avatar.png', type: 'image/png', size: 12 }],
        attachments: [
          { name: 'a.bin', type: 'application/octet-stream', size: 1 },
          { name: 'b.bin', type: 'application/octet-stream', size: 2 },
        ],
      },
      partHeaders: { metadata: { 'X-Part-Trace': 'trace-1' } },
    });

    expect(plan).toMatchObject({
      kind: 'multipart',
      mediaType: 'multipart/form-data',
      instance: { metadata: { active: true } },
      ignoredProperties: ['avatar', 'attachments'],
      diagnostics: [],
      parts: [
        {
          kind: 'text',
          name: 'metadata',
          value: '{"active":true}',
          contentType: 'application/json',
          headers: { 'X-Part-Trace': 'trace-1' },
        },
        {
          kind: 'file',
          name: 'avatar',
          fileIndex: 0,
          fileName: 'avatar.png',
          contentType: 'image/png',
        },
        {
          kind: 'file',
          name: 'attachments',
          fileIndex: 0,
          fileName: 'a.bin',
          contentType: 'application/octet-stream',
        },
        {
          kind: 'file',
          name: 'attachments',
          fileIndex: 1,
          fileName: 'b.bin',
          contentType: 'application/octet-stream',
        },
      ],
    });

    const curl = buildCurl({
      url: 'https://api.example.test/submit',
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data' },
      query: {},
      contentType: 'multipart/form-data',
      formBodyPlan: plan,
    });
    expect(curl).toContain('="{\\"active\\":true}"');
    expect(curl).toContain('headers="Content-Disposition: form-data; name=\\"metadata\\""');
    expect(curl).toContain('headers="Content-Type: application/json"');
    expect(curl).toContain('headers="X-Part-Trace: trace-1"');
    expect(curl).toContain('=@"/path/to/avatar.png"');
    expect(curl).toContain('headers="Content-Type: image/png"');
    expect(curl).toContain('headers="Content-Disposition: form-data; name=\\"avatar\\"; filename=\\"avatar.png\\""');
    expect(curl).not.toContain('Content-Type: multipart/form-data');
  });

  test('quotes contentType inside curl MIME syntax and preserves declared parameters', () => {
    const model = debugModelFor(
      'multipart/form-data',
      {
        type: 'object',
        properties: {
          document: { type: 'string' },
          avatar: { type: 'string', format: 'binary' },
        },
      },
      {
        document: { contentType: 'application/xml;encoder=base64' },
        avatar: { contentType: 'image/png; profile=thumbnail' },
      },
    );
    const plan = serializeOas31FormBody(model.bodyContents[0], {
      formFields: { document: '<safe />' },
      fileFields: { avatar: [{ name: 'avatar.png', type: 'image/png' }] },
    });

    expect(plan).toMatchObject({
      kind: 'multipart',
      diagnostics: [],
      parts: [
        { name: 'document', contentType: 'application/xml;encoder=base64' },
        { name: 'avatar', contentType: 'image/png; profile=thumbnail' },
      ],
    });
    const curl = buildCurl({
      url: 'https://api.example.test/submit',
      method: 'POST',
      headers: {},
      query: {},
      contentType: 'multipart/form-data',
      formBodyPlan: plan,
    });
    expect(curl).toContain('headers="Content-Type: application/xml;encoder=base64"');
    expect(curl).toContain('headers="Content-Type: image/png; profile=thumbnail"');
    expect(curl).not.toContain(';type=application/xml;encoder=base64');

    const invalidModel = debugModelFor(
      'multipart/form-data',
      { type: 'object', properties: { document: { type: 'string' } } },
      { document: { contentType: 'application/xml;headers=@/etc/hosts' } },
    );
    expect(invalidModel.bodyContents[0].oas31Form?.diagnostics).toEqual([
      expect.objectContaining({ code: 'CONTENT_TYPE_INVALID', fieldName: 'document' }),
    ]);
  });

  test('preserves generic multipart media type and form-data property disposition in curl', () => {
    const model = debugModelFor('multipart/mixed', {
      type: 'object',
      properties: { note: { type: 'string' } },
    });
    const plan = serializeOas31FormBody(model.bodyContents[0], { formFields: { note: 'hello' } });
    const curl = buildCurl({
      url: 'https://api.example.test/submit',
      method: 'POST',
      headers: {},
      query: {},
      contentType: 'multipart/mixed',
      formBodyPlan: plan,
    });

    expect(curl).toContain("-H \\\n  'Content-Type: multipart/mixed'");
    expect(curl).toContain('headers="Content-Disposition: form-data; name=\\"note\\""');
  });

  test('applies RFC6570-style fields to multipart/form-data and keeps header diagnostics', () => {
    const model = debugModelFor(
      'multipart/form-data',
      {
        type: 'object',
        properties: {
          metadata: { type: 'object' },
        },
      },
      {
        metadata: {
          style: 'deepObject',
          explode: true,
          allowReserved: true,
          contentType: 'application/json',
          headers: [],
        },
      },
    );

    const plan = serializeOas31FormBody(model.bodyContents[0], {
      formFields: { metadata: '{"enabled":true}' },
    });

    expect(plan).toMatchObject({
      kind: 'multipart',
      instance: { metadata: { enabled: true } },
      parts: [{ kind: 'text', name: 'metadata[enabled]', value: 'true', contentType: 'text/plain' }],
    });
    expect(plan.diagnostics.map((item) => item.code)).toEqual(['HEADER_INVALID']);
  });

  test('diagnoses a part header value that conflicts with schema contentEncoding', () => {
    const model = debugModelFor(
      'multipart/form-data',
      {
        type: 'object',
        properties: { payload: { type: 'string', contentEncoding: 'base64' } },
      },
      {
        payload: {
          headers: {
            'Content-Transfer-Encoding': { schema: { type: 'string', enum: ['base64', 'gzip'] } },
          },
        },
      },
    );

    const plan = serializeOas31FormBody(model.bodyContents[0], {
      formFields: { payload: 'SGVsbG8=' },
      partHeaders: { payload: { 'Content-Transfer-Encoding': 'gzip' } },
    });

    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'CONTENT_ENCODING_HEADER_CONFLICT',
          fieldName: 'payload',
          headerName: 'Content-Transfer-Encoding',
        }),
      ]),
    );
  });

  test('rejects multipart Header values that could alter MIME framing', () => {
    const model = debugModelFor(
      'multipart/form-data',
      {
        type: 'object',
        properties: { payload: { type: 'string' } },
      },
      {
        payload: {
          headers: {
            'X-Part-Trace': {
              required: true,
              content: { 'text/plain': { schema: { type: 'string' } } },
            },
          },
        },
      },
    );

    const plan = serializeOas31FormBody(model.bodyContents[0], {
      formFields: { payload: 'safe' },
      partHeaders: { payload: { 'X-Part-Trace': 'trace\r\nInjected: true' } },
    });

    expect(plan.diagnostics).toEqual([
      expect.objectContaining({
        code: 'HEADER_INPUT_INVALID',
        fieldName: 'payload',
        headerName: 'X-Part-Trace',
      }),
    ]);
    if (plan.kind !== 'multipart') throw new Error('expected multipart plan');
    expect(plan.parts[0].headers).toEqual({});
  });

  test('validates part headers and file cardinality only for present optional parts', () => {
    const model = debugModelFor(
      'multipart/form-data',
      {
        type: 'object',
        properties: {
          optionalText: { type: 'string' },
          attachments: {
            type: 'array',
            minItems: 2,
            items: { type: 'string', format: 'binary' },
          },
        },
      },
      {
        optionalText: {
          headers: { 'X-Part-Trace': { required: true, schema: { type: 'string' } } },
        },
      },
    );

    const omitted = serializeOas31FormBody(model.bodyContents[0], {});
    expect(omitted.diagnostics).toEqual([]);

    const present = serializeOas31FormBody(model.bodyContents[0], {
      formFields: { optionalText: 'value' },
      fileFields: { attachments: [{ name: 'one.bin', type: 'application/octet-stream' }] },
    });
    expect(present.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(['HEADER_REQUIRED', 'FILE_CARDINALITY']),
    );
  });

  test('diagnoses dependentRequired across file and logical form properties', () => {
    const model = debugModelFor('multipart/form-data', {
      type: 'object',
      properties: {
        metadata: { type: 'string' },
        avatar: { type: 'string', format: 'binary' },
        caption: { type: 'string' },
      },
      dependentRequired: {
        metadata: ['avatar'],
        avatar: ['caption'],
      },
    });

    const missingFile = serializeOas31FormBody(model.bodyContents[0], {
      formFields: { metadata: 'present' },
    });
    expect(missingFile.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FORM_DEPENDENT_REQUIRED', fieldName: 'avatar' }),
    );

    const missingLogicalField = serializeOas31FormBody(model.bodyContents[0], {
      fileFields: { avatar: [{ name: 'avatar.png', type: 'image/png' }] },
    });
    expect(missingLogicalField.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FORM_DEPENDENT_REQUIRED', fieldName: 'caption' }),
    );

    const valid = serializeOas31FormBody(model.bodyContents[0], {
      formFields: { metadata: 'present', caption: 'ready' },
      fileFields: { avatar: [{ name: 'avatar.png', type: 'image/png' }] },
    });
    expect(valid.diagnostics).toEqual([]);
  });

  test('supports nullable, prefixItems, boolean schemas and property references in the logical instance', () => {
    const model = debugModelFor('application/x-www-form-urlencoded', {
      type: 'object',
      properties: {
        nullable: { type: ['string', 'null'] },
        tuple: {
          type: 'array',
          prefixItems: [{ type: 'integer' }, { type: 'boolean' }],
          items: false,
        },
        impossible: false,
        referenced: {
          $ref: '#/paths/~1submit/post/requestBody/content/application~1x-www-form-urlencoded/schema/$defs/Count',
        },
      },
      $defs: { Count: { type: 'integer', minimum: 1 } },
    });

    const plan = serializeOas31FormBody(model.bodyContents[0], {
      formFields: {
        nullable: 'null',
        tuple: '[1,true]',
        impossible: '"value"',
        referenced: '2',
      },
    });

    expect(plan.instance).toEqual({
      nullable: null,
      tuple: [1, true],
      impossible: 'value',
      referenced: 2,
    });
    expect(plan.diagnostics).toEqual([]);
  });

  test('keeps a stable raw fallback while reporting JSON, file, media and budget diagnostics', () => {
    const model = debugModelFor(
      'multipart/form-data',
      {
        type: 'object',
        required: ['metadata', 'avatar'],
        properties: {
          metadata: { type: 'object' },
          avatar: { format: 'binary' },
        },
      },
      {
        metadata: { contentType: 'application/json' },
        avatar: { contentType: 'image/png' },
      },
    );

    const plan = serializeOas31FormBody(model.bodyContents[0], {
      formFields: { metadata: '{broken' },
      fileFields: {
        avatar: [
          { name: 'first.txt', type: 'text/plain' },
          { name: 'second.txt', type: 'text/plain' },
        ],
      },
      limits: { maxFieldBytes: 4, maxTotalBytes: 8 },
    });

    expect(plan.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'FORM_INPUT_INVALID_JSON',
        'FORM_BUDGET_EXCEEDED',
        'FILE_CARDINALITY',
        'FILE_MEDIA_TYPE',
      ]),
    );
    if (plan.kind !== 'multipart') throw new Error('expected multipart plan');
    expect(plan.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'text', name: 'metadata', value: '{broken' }),
        expect.objectContaining({ kind: 'file', name: 'avatar', fileName: 'first.txt' }),
      ]),
    );
  });

  test('reports an empty required form body through the shared diagnostic plan', () => {
    const model = debugModelFor('application/x-www-form-urlencoded', {
      type: 'object',
      properties: { optional: { type: 'string' } },
    });

    const built = buildRequest({
      baseUrl: 'https://api.example.test',
      path: '/submit',
      method: 'post',
      debugModel: model,
      formValues: {
        pathParams: {},
        queryParams: {},
        headerParams: {},
        cookieParams: {},
        selectedContentType: 'application/x-www-form-urlencoded',
        formFields: { optional: '' },
      },
    });

    expect(built.formBodyPlan?.diagnostics.map((item) => item.code)).toContain('FORM_BODY_REQUIRED');
  });

  test('leaves OAS 3.0 form behavior on the legacy path', () => {
    const model = debugModelFor(
      'application/x-www-form-urlencoded',
      { type: 'object', properties: { value: { type: 'object' } } },
      undefined,
      '3.0.4',
    );
    const built = buildRequest({
      baseUrl: 'https://api.example.test',
      path: '/submit',
      method: 'post',
      debugModel: model,
      formValues: {
        pathParams: {},
        queryParams: {},
        headerParams: {},
        cookieParams: {},
        selectedContentType: 'application/x-www-form-urlencoded',
        formFields: { value: '{"a":1}' },
      },
    });

    expect(built.formBodyPlan).toBeUndefined();
    expect(built.body).toBe('value=%7B%22a%22%3A1%7D');
  });
});
