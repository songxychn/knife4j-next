import {
  analyzeOas32FormBody,
  authoredMultipartPlan,
  buildCurl,
  buildOperationDebugModel,
  buildRequest,
  oas32FormFieldsFromInstance,
  serializeOas32FormBody,
  validateRequired,
  type OperationDebugModel,
} from '../../debug';

function debugModel32(mediaType: string, media: Record<string, unknown>, version = '3.2.0'): OperationDebugModel {
  return buildOperationDebugModel({
    doc: {
      openapi: version,
      info: { title: 'oas32 form fixture', version: '1.0.0' },
      paths: {
        '/submit': {
          post: {
            requestBody: {
              required: true,
              content: { [mediaType]: media },
            },
          },
        },
      },
    },
    path: '/submit',
    method: 'post',
  });
}

const emptyForm = {
  pathParams: {},
  queryParams: {},
  headerParams: {},
  cookieParams: {},
};

describe('OAS 3.2 form body encoding', () => {
  test('does not treat form-data X-* part headers as a successful example', () => {
    const model = debugModel32('multipart/form-data', {
      schema: {
        type: 'object',
        properties: {
          metadata: { type: 'object' },
        },
      },
      encoding: {
        metadata: {
          contentType: 'application/json',
          headers: {
            'X-Part-Trace': { schema: { type: 'string' } },
          },
        },
      },
    });
    const form = model.bodyContents[0].oas32Form;
    expect(form?.fields[0].encoding.headers).toEqual([]);
    expect(form?.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'HEADER_NOT_ALLOWED', headerName: 'X-Part-Trace' })]),
    );
  });

  test('keeps named encoding, prefixEncoding and itemEncoding mutually exclusive', () => {
    const model = debugModel32('multipart/form-data', {
      schema: {
        type: 'object',
        properties: { name: { type: 'string' } },
      },
      encoding: { name: { contentType: 'text/plain' } },
      prefixEncoding: [{ headers: { 'Content-Disposition': { schema: { type: 'string' } } } }],
    });
    const form = model.bodyContents[0].oas32Form;
    expect(form?.fields).toEqual([]);
    expect(form?.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ENCODING_CONFLICT' })]));
  });

  test('ignores named encoding on multipart/mixed and positional encoding on urlencoded', () => {
    const mixed = debugModel32('multipart/mixed', {
      schema: { type: 'object', properties: { name: { type: 'string' } } },
      encoding: { name: { contentType: 'text/plain' } },
    });
    expect(mixed.bodyContents[0].oas32Form?.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'ENCODING_IGNORED' })]),
    );

    const urlencoded = debugModel32('application/x-www-form-urlencoded', {
      schema: { type: 'array', prefixItems: [{ type: 'string' }] },
      prefixEncoding: [{}],
    });
    expect(urlencoded.bodyContents[0].oas32Form?.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'ENCODING_IGNORED' })]),
    );
  });

  test('keeps prefixEncoding, prefixItems and instance length independent without padding', () => {
    const model = debugModel32('multipart/mixed', {
      schema: {
        type: 'array',
        prefixItems: [{ type: 'string' }, { type: 'integer' }, { type: 'boolean' }],
        items: { type: 'string' },
      },
      prefixEncoding: [{ contentType: 'text/plain' }, { contentType: 'text/plain' }],
      itemEncoding: { contentType: 'text/plain' },
    });
    const form = model.bodyContents[0].oas32Form;
    expect(form?.fields.map((field) => field.name)).toEqual(['0', '1', '2']);
    expect(form?.extraItemTemplate?.name).toBe('3');

    const plan = serializeOas32FormBody(model.bodyContents[0], {
      formFields: { '0': 'alpha', '2': 'true', '4': 'tail' },
    });
    expect(plan.kind).toBe('multipart');
    if (plan.kind !== 'multipart') return;
    expect(plan.parts.map((part) => [part.kind === 'text' ? part.value : '', part.sourceField])).toEqual([
      ['alpha', '0'],
      ['true', '2'],
      ['tail', '4'],
    ]);
    expect(plan.parts).toHaveLength(3);
  });

  test('materializes one nested multipart/mixed level and rejects a second', () => {
    const nested = debugModel32('multipart/mixed', {
      schema: {
        type: 'array',
        prefixItems: [
          {
            type: 'array',
            prefixItems: [{ type: 'string' }, { type: 'string' }],
          },
        ],
      },
      prefixEncoding: [
        {
          contentType: 'multipart/mixed',
          prefixEncoding: [{ contentType: 'text/plain' }, { contentType: 'text/plain' }],
        },
      ],
    });
    expect(nested.bodyContents[0].oas32Form?.fields[0].nestedFields?.map((field) => field.name)).toEqual([
      '0.0',
      '0.1',
    ]);

    const plan = serializeOas32FormBody(nested.bodyContents[0], {
      formFields: { '0.0': 'inner-a', '0.1': 'inner-b' },
    });
    expect(plan).toMatchObject({
      kind: 'multipart',
      specFamily: '3.2',
      parts: [
        {
          kind: 'nested',
          contentType: 'multipart/mixed',
          parts: [
            { kind: 'text', sourceField: '0.0', value: 'inner-a', name: '' },
            { kind: 'text', sourceField: '0.1', value: 'inner-b', name: '' },
          ],
        },
      ],
    });

    const tooDeep = debugModel32('multipart/mixed', {
      schema: { type: 'array', prefixItems: [{ type: 'array', prefixItems: [{ type: 'string' }] }] },
      prefixEncoding: [
        {
          contentType: 'multipart/mixed',
          prefixEncoding: [
            {
              contentType: 'multipart/mixed',
              prefixEncoding: [{ contentType: 'text/plain' }],
            },
          ],
        },
      ],
    });
    expect(tooDeep.bodyContents[0].oas32Form?.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'NESTING_UNSUPPORTED' })]),
    );
  });

  test('requires an explicit part Content-Type instead of sniffing files or the first listed type', () => {
    const model = debugModel32('multipart/form-data', {
      schema: {
        type: 'object',
        properties: { avatar: { type: 'string', format: 'binary' } },
      },
      encoding: { avatar: { contentType: 'image/*, application/octet-stream' } },
    });
    const field = model.bodyContents[0].oas32Form?.fields[0];
    expect(field?.contentTypeRequiresChoice).toBe(true);

    const sniffed = serializeOas32FormBody(model.bodyContents[0], {
      fileFields: { avatar: [{ name: 'avatar.png', type: 'image/png', size: 4 }] },
    });
    expect(sniffed.kind).toBe('multipart');
    if (sniffed.kind !== 'multipart') return;
    expect(sniffed.parts).toEqual([]);
    expect(sniffed.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CONTENT_TYPE_CHOICE_REQUIRED' })]),
    );

    const chosen = serializeOas32FormBody(model.bodyContents[0], {
      fileFields: { avatar: [{ name: 'avatar.png', type: 'image/gif', size: 4 }] },
      partContentTypes: { avatar: 'image/png' },
    });
    expect(chosen).toMatchObject({
      kind: 'multipart',
      parts: [{ kind: 'file', contentType: 'image/png', fileName: 'avatar.png' }],
    });
  });

  test('keeps authored MIME text paired with the media-type boundary and does not regenerate it', () => {
    const body = '--keep-me\r\nContent-Type: text/plain\r\n\r\nhello\r\n--keep-me--\r\n';
    const plan = authoredMultipartPlan('multipart/mixed; boundary=keep-me', body);
    expect(plan).toMatchObject({
      specFamily: '3.2',
      wire: 'authored',
      authoredBody: body,
      authoredContentType: 'multipart/mixed; boundary=keep-me',
      diagnostics: [],
    });
    expect(authoredMultipartPlan('multipart/mixed', body)).toMatchObject({
      authoredBody: body,
      authoredContentType: 'multipart/mixed; boundary=keep-me',
      diagnostics: [],
    });
    expect(authoredMultipartPlan('multipart/mixed', '').diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'AUTHORED_BOUNDARY_MISMATCH' })]),
    );
  });

  test('fills logical nested fields from a dataValue instance without a second encoder', () => {
    const model = debugModel32('multipart/mixed', {
      schema: {
        type: 'array',
        prefixItems: [{ type: 'array', prefixItems: [{ type: 'string' }, { type: 'integer' }] }],
      },
      prefixEncoding: [
        {
          contentType: 'multipart/mixed',
          prefixEncoding: [{ contentType: 'text/plain' }, { contentType: 'text/plain' }],
        },
      ],
    });
    expect(oas32FormFieldsFromInstance(model.bodyContents[0].oas32Form!, [['alpha', 7]])).toEqual({
      '0.0': 'alpha',
      '0.1': '7',
    });
  });

  test('enforces part, byte and time budgets and honors cancellation', () => {
    const model = debugModel32('multipart/mixed', {
      schema: { type: 'array', items: { type: 'string' } },
      itemEncoding: { contentType: 'text/plain' },
    });
    const overParts = serializeOas32FormBody(model.bodyContents[0], {
      formFields: Object.fromEntries(Array.from({ length: 5 }, (_, index) => [String(index), 'x'])),
      limits: { maxParts: 3 },
    });
    expect(overParts.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'FORM_BUDGET_EXCEEDED' })]),
    );

    const cancelled = serializeOas32FormBody(model.bodyContents[0], {
      formFields: { '0': 'x' },
      signal: AbortSignal.abort(),
    });
    expect(cancelled.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'FORM_MATERIALIZATION_TIMEOUT' })]),
    );

    const timedOut = serializeOas32FormBody(model.bodyContents[0], {
      formFields: { '0': 'x', '1': 'y' },
      now: (() => {
        let current = 0;
        return () => {
          current += 5_000;
          return current;
        };
      })(),
      limits: { maxMaterializationMs: 1 },
    });
    expect(timedOut.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'FORM_MATERIALIZATION_TIMEOUT' })]),
    );
  });

  test('diagnoses streaming itemSchema and still materializes a finite editor list', () => {
    const model = debugModel32('multipart/mixed', {
      itemSchema: { type: 'string' },
      itemEncoding: { contentType: 'text/plain' },
    });
    const form = model.bodyContents[0].oas32Form;
    expect(form?.streaming).toBe(true);
    expect(form?.schemaAppliesTo).toBe('items');
    expect(form?.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'STREAMING_UNSUPPORTED' })]),
    );
    const plan = serializeOas32FormBody(model.bodyContents[0], { formFields: { '0': 'one', '1': 'two' } });
    expect(plan).toMatchObject({
      kind: 'multipart',
      parts: [
        { kind: 'text', value: 'one', sourceField: '0' },
        { kind: 'text', value: 'two', sourceField: '1' },
      ],
    });
  });

  test('positional form-data without Content-Disposition stays a diagnostic, not a successful unnamed example', () => {
    const model = debugModel32('multipart/form-data', {
      schema: { type: 'array', prefixItems: [{ type: 'string' }] },
      prefixEncoding: [{ contentType: 'text/plain' }],
    });
    expect(model.bodyContents[0].oas32Form?.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'HEADER_REQUIRED', headerName: 'Content-Disposition' })]),
    );
  });

  test('buildRequest shares the 3.2 plan with --data-binary cURL and keeps 3.1 -F X-Part-Trace working', () => {
    const model = debugModel32('multipart/mixed', {
      schema: { type: 'array', prefixItems: [{ type: 'string' }] },
      prefixEncoding: [{ contentType: 'text/plain' }],
    });
    const built = buildRequest({
      baseUrl: 'https://api.example.test',
      path: '/submit',
      method: 'post',
      debugModel: model,
      formValues: {
        ...emptyForm,
        selectedContentType: 'multipart/mixed',
        formFields: { '0': 'hello' },
      },
    });
    expect(built.formBodyPlan).toMatchObject({ specFamily: '3.2', parts: [{ value: 'hello' }] });
    const curl = buildCurl(built);
    expect(curl).toContain('--data-binary');
    expect(curl).toContain('@knife4j-multipart-body.bin');
    expect(curl).not.toContain(' -F ');

    const authored = buildRequest({
      baseUrl: 'https://api.example.test',
      path: '/submit',
      method: 'post',
      debugModel: model,
      formValues: {
        ...emptyForm,
        selectedContentType: 'multipart/mixed',
        serializedExampleBody: {
          mediaType: 'multipart/mixed',
          text: '--keep-me\r\n\r\nhello\r\n--keep-me--\r\n',
        },
      },
    });
    expect(authored.headers['Content-Type']).toBe('multipart/mixed; boundary=keep-me');
    expect(authored.formBodyPlan).toMatchObject({
      wire: 'authored',
      authoredBody: '--keep-me\r\n\r\nhello\r\n--keep-me--\r\n',
      authoredContentType: 'multipart/mixed; boundary=keep-me',
    });
    expect(buildCurl(authored)).toContain('--data-binary');

    const legacy = debugModel32(
      'multipart/form-data',
      {
        schema: {
          type: 'object',
          properties: { metadata: { type: 'object' } },
        },
        encoding: {
          metadata: {
            contentType: 'application/json',
            headers: { 'X-Part-Trace': { schema: { type: 'string' } } },
          },
        },
      },
      '3.1.1',
    );
    expect(legacy.bodyContents[0].oas32Form).toBeUndefined();
    expect(legacy.bodyContents[0].oas31Form?.fields[0].encoding.headers.map((header) => header.name)).toEqual([
      'X-Part-Trace',
    ]);
    const legacyBuilt = buildRequest({
      baseUrl: 'https://api.example.test',
      path: '/submit',
      method: 'post',
      debugModel: legacy,
      formValues: {
        ...emptyForm,
        selectedContentType: 'multipart/form-data',
        formFields: { metadata: '{"active":true}' },
        formPartHeaders: { metadata: { 'X-Part-Trace': 'trace-1' } },
      },
    });
    const legacyCurl = buildCurl(legacyBuilt);
    expect(legacyCurl).toContain(' -F ');
    expect(legacyCurl).toContain('headers="X-Part-Trace: trace-1"');
    expect(legacyCurl).not.toContain('--data-binary');
  });

  test('does not hard-fail an empty required OAS 3.2 multipart body before the form plan', () => {
    const model = debugModel32('multipart/mixed', {
      schema: { type: 'array', prefixItems: [{ type: 'string' }] },
      prefixEncoding: [{ contentType: 'text/plain' }],
    });
    expect(model.bodyRequired).toBe(true);
    expect(model.bodyContents[0].oas32Form).toBeDefined();
    expect(
      validateRequired(model, {
        ...emptyForm,
        selectedContentType: 'multipart/mixed',
        formFields: { '0': '' },
      }),
    ).toEqual([]);
    expect(
      serializeOas32FormBody(model.bodyContents[0], { formFields: { '0': '' }, bodyRequired: true }).diagnostics,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'FORM_BODY_REQUIRED' })]));
  });

  test('3.0 documents still take the legacy multipart/form-data path without oas32Form', () => {
    const model = debugModel32(
      'multipart/form-data',
      {
        schema: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
      },
      '3.0.3',
    );
    expect(model.bodyContents[0].oas32Form).toBeUndefined();
    expect(model.bodyContents[0].oas31Form).toBeUndefined();
  });
});

describe('analyzeOas32FormBody direct options', () => {
  test('requires an array schema or itemSchema for positional encoding', () => {
    const analyzed = analyzeOas32FormBody({
      mediaType: 'multipart/mixed',
      schema: { type: 'object', properties: { name: { type: 'string' } } },
      itemSchema: undefined,
      encoding: undefined,
      prefixEncoding: [{}],
      itemEncoding: undefined,
      fileFields: [],
      multipleFileFields: [],
      document: {},
    });
    expect(analyzed.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'POSITIONAL_SCHEMA_REQUIRED' })]),
    );
  });
});
