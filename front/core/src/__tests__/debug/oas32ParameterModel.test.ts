import { buildOperationDebugModel } from '../../debug/operationDebugModel';
import { buildOas32ParameterCollection } from '../../debug/oas32ParameterModel';
import { enumerateOpenApiOperations, type OpenApiObjectLocation } from '../../openapiOperations';
import { buildRequest } from '../../debug/requestBuilder';
import { collectOas32DocumentDiagnostics } from '../../openapi32';
import type { Oas32ParameterContext } from '../../debug/oas32ParameterTypes';

const plain = (name: string, in_ = 'query') => ({ name, in: in_, schema: { type: 'string' } });
const whole = (name = 'whole') => ({
  name,
  in: 'querystring',
  content: { 'text/plain': { schema: { type: 'string' } } },
});
const documentWith = (pathParameters: unknown[], parameters: unknown[], components: Record<string, unknown> = {}) => ({
  openapi: '3.2.99',
  info: { title: 'Effective collection fixtures', version: '1' },
  components,
  paths: {
    '/items': { parameters: pathParameters, get: { parameters, responses: { '200': { description: 'Synthetic' } } } },
  },
});
const build = (doc: ReturnType<typeof documentWith>, context?: Oas32ParameterContext) =>
  buildOperationDebugModel({
    doc: doc as Parameters<typeof buildOperationDebugModel>[0]['doc'],
    path: '/items',
    method: 'get',
    parameterContext: context,
  });
const request = (doc: ReturnType<typeof documentWith>) =>
  buildRequest({
    baseUrl: 'https://example.test',
    path: '/items',
    method: 'GET',
    debugModel: build(doc),
    formValues: { pathParams: {}, queryParams: {}, headerParams: {}, cookieParams: {} },
  });

describe('OAS 3.2 effective parameter declaration integrity', () => {
  test('uses operation override with physical parameter and boolean Schema location intact', () => {
    const doc = documentWith(
      [{ $ref: '#/components/parameters/Inherited' }],
      [{ $ref: '#/components/parameters/Override' }],
      {
        parameters: {
          Inherited: whole(),
          Override: { ...whole(), required: true, content: { 'application/json': { schema: false } } },
        },
      },
    );
    expect(collectOas32DocumentDiagnostics(doc)).toEqual([]);
    const model = build(doc).oas32Parameters!;
    expect(model.complete).toBe(true);
    expect(model.parameters).toHaveLength(1);
    expect(model.declarations).toHaveLength(2);
    expect(model.parameters[0]).toMatchObject({
      key: 'querystring:whole',
      required: true,
      schema: false,
      location: { pointer: '#/components/parameters/Override' },
      schemaReference: '#/components/parameters/Override/content/application~1json/schema',
    });
  });

  test('retains unavailable path-level references even when an operation parameter appears to override them', () => {
    const doc = documentWith([{ $ref: 'unloaded.json#/p' }], [whole()]);
    const result = build(doc).oas32Parameters!;
    expect(result.complete).toBe(false);
    expect(result.declarations[0].site.value).toEqual({ $ref: 'unloaded.json#/p' });
    expect(result.declarations[0].target).toBeUndefined();
    expect(() => request(doc)).toThrow(/incomplete/);
  });

  test.each([
    ['query and whole', [plain('q')], [whole()], 'QUERY_QUERYSTRING_CONFLICT'],
    ['two whole queries', [whole('a')], [whole('b')], 'MULTIPLE_QUERYSTRING'],
    ['duplicate declarations', [], [plain('q'), plain('q')], 'DUPLICATE_PARAMETER'],
    ['querystring schema', [], [{ name: 'q', in: 'querystring', schema: {} }], 'QUERYSTRING_ENCODING'],
    [
      'content cardinality',
      [],
      [{ name: 'q', in: 'querystring', content: { 'text/plain': {}, 'application/json': {} } }],
      'CONTENT_CARDINALITY',
    ],
    ['content style conflict', [], [{ ...whole(), style: 'form' }], 'CONTENT_STYLE_CONFLICT'],
    ['schema/content conflict', [], [{ ...whole(), schema: {} }], 'SCHEMA_CONTENT_EXCLUSIVE'],
    ['missing name', [], [{ in: 'querystring', content: { 'text/plain': {} } }], 'PARAMETER_IDENTITY_INVALID'],
  ])('blocks %s independently of input selection', (_name, inherited, own, code) => {
    const doc = documentWith(inherited as unknown[], own as unknown[]);
    expect(build(doc).oas32Parameters!.diagnostics).toContainEqual(
      expect.objectContaining({ code, phase: 'declaration', blocks: 'all' }),
    );
    expect(() => request(doc)).toThrow();
  });

  test('Header declaration names are case-sensitive, including the own-property edge cases', () => {
    const doc = documentWith([], [plain('X-Id', 'header'), plain('x-id', 'header'), plain('__proto__', 'header')]);
    expect(collectOas32DocumentDiagnostics(doc)).toEqual([]);
    expect(build(doc).oas32Parameters!.parameters.map((parameter) => parameter.name)).toEqual([
      'X-Id',
      'x-id',
      '__proto__',
    ]);
  });

  test('the ignored Header names do not become explicit declarations', () => {
    const doc = documentWith(
      [],
      [
        plain('Accept', 'header'),
        plain('Content-Type', 'header'),
        plain('Authorization', 'header'),
        plain('X-Keep', 'header'),
      ],
    );
    expect(build(doc).oas32Parameters!.parameters.map((parameter) => parameter.name)).toEqual(['X-Keep']);
  });

  test('an external typed Parameter to Media Type chain keeps actual owner and Schema refs', () => {
    const doc = documentWith([], [{ $ref: 'parameters.json#/p' }]);
    const parameter: OpenApiObjectLocation = {
      ownerRetrievalUri: 'https://schemas.example.test/parameters.json',
      pointer: '#/p',
      value: { name: 'whole', in: 'querystring', content: { 'application/json': { $ref: 'media.json#/m' } } },
    };
    const schema = { $ref: '#/components/schemas/Filter' };
    const media: OpenApiObjectLocation = {
      ownerRetrievalUri: 'https://schemas.example.test/media.json',
      pointer: '#/m',
      value: {
        schema,
        itemSchema: false,
        examples: { opaque: { dataValue: { $ref: 'do-not-load', $id: 'ordinary' } } },
      },
    };
    const calls: string[] = [];
    const resolveReference: NonNullable<Oas32ParameterContext['resolveReference']> = (site, kind) => {
      calls.push(`${kind} ${site.ownerRetrievalUri}${site.pointer}`);
      if (kind === 'parameter') return parameter;
      if (kind === 'media-type' && site.ownerRetrievalUri === parameter.ownerRetrievalUri) return media;
      return null;
    };
    const identity = enumerateOpenApiOperations(doc, {
      retrievalUri: 'https://entry.example.test/openapi.json',
      resolveReference: (site, kind) => (kind === 'parameter' ? resolveReference(site, kind) : null),
    })[0];
    calls.length = 0;
    const schemaView = jest.fn(() => ({ type: 'object' }));
    const result = buildOas32ParameterCollection(doc, identity, { resolveReference, schemaView });
    expect(result.complete).toBe(true);
    expect(result.parameters[0]).toMatchObject({
      location: parameter,
      mediaLocation: media,
      schema,
      schemaView: { type: 'object' },
      schemaReference: 'https://schemas.example.test/media.json#/m/schema',
      itemSchemaReference: 'https://schemas.example.test/media.json#/m/itemSchema',
    });
    expect(schemaView).toHaveBeenCalledWith(
      expect.objectContaining({ ownerRetrievalUri: media.ownerRetrievalUri, pointer: '#/m/schema', value: schema }),
    );
    expect(calls).toEqual([
      'parameter https://entry.example.test/openapi.json#/paths/~1items/get/parameters/0',
      'media-type https://schemas.example.test/parameters.json#/p/content/application~1json',
    ]);
  });

  test('a typed resolver denial cannot fall back to an opaque lookalike', () => {
    const doc = documentWith([], [{ $ref: '#/components/parameters/Real' }], { parameters: { Real: whole() } });
    const result = build(doc, { resolveReference: () => null }).oas32Parameters!;
    expect(result.complete).toBe(false);
    expect(result.parameters).toEqual([]);
  });

  test('unavailable Media Type and cyclic Parameter refs keep completeness false', () => {
    const media = documentWith(
      [],
      [{ name: 'q', in: 'querystring', content: { 'text/plain': { $ref: 'media.json#/m' } } }],
    );
    expect(build(media).oas32Parameters!.complete).toBe(false);
    const cycle = documentWith([], [{ $ref: '#/components/parameters/A' }], {
      parameters: { A: { $ref: '#/components/parameters/B' }, B: { $ref: '#/components/parameters/A' } },
    });
    expect(build(cycle).oas32Parameters!.complete).toBe(false);
  });

  test('overriding does not legalize an invalid inherited declaration', () => {
    const doc = documentWith([{ ...whole(), schema: true }], [whole()]);
    expect(build(doc).oas32Parameters!.parameters).toHaveLength(1);
    expect(() => request(doc)).toThrow(/exactly one/);
  });

  test('malformed parameter entries produce diagnostics instead of falling into the legacy parser', () => {
    const doc = documentWith([], [null, 1, whole()]);
    expect(build(doc).oas32Parameters!.complete).toBe(false);
    expect(() => request(doc)).toThrow(/incomplete/);
  });

  test.each(['3.0.4', '3.1.2'])('retains the existing %s parameter path', (openapi) => {
    const doc = { ...documentWith([], [plain('q')]), openapi };
    const result = build(doc);
    expect(result.oas32Parameters).toBeUndefined();
    expect(result.queryParams[0].parameterSerialization !== undefined).toBe(openapi.startsWith('3.1.'));
  });
});
