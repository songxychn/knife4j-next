import { buildOperationDebugModel } from 'knife4j-core';
import { describe, expect, it } from 'vitest';
import { customRowsToRecord, mergeCustomBodyParams, reservedBodyFieldNames } from './customParamRows';

describe('customRowsToRecord', () => {
  it('trims complete rows and ignores incomplete rows', () => {
    expect(
      customRowsToRecord([
        { id: '1', name: ' traceId ', value: ' abc ' },
        { id: '2', name: '', value: 'ignored' },
        { id: '3', name: 'empty', value: '   ' },
      ]),
    ).toEqual({ traceId: 'abc' });
  });
});

describe('mergeCustomBodyParams', () => {
  const customRows = [
    { id: '1', name: 'dynamic', value: 'value' },
    { id: '2', name: 'declared', value: 'must-not-override' },
  ];

  it('adds enabled dynamic rows while preserving declared field precedence', () => {
    expect(mergeCustomBodyParams({ declared: 'schema-value' }, customRows, true)).toEqual({
      formFields: {
        dynamic: 'value',
        declared: 'schema-value',
      },
      formFieldNamesToIncludeWhenEmpty: [],
    });
  });

  it('does not send stored dynamic rows while the setting is disabled', () => {
    const formFields = { declared: 'schema-value' };
    const merged = mergeCustomBodyParams(formFields, customRows, false);
    expect(merged.formFields).toBe(formFields);
    expect(merged.formFieldNamesToIncludeWhenEmpty).toEqual([]);
  });

  it('preserves dynamic Body values verbatim and marks explicitly empty fields', () => {
    expect(
      mergeCustomBodyParams(
        {},
        [
          { id: '1', name: ' padded ', value: '  value  ' },
          { id: '2', name: 'empty', value: '' },
          { id: '3', name: 'whitespace', value: '   ' },
          { id: '4', name: '   ', value: 'ignored' },
        ],
        true,
      ),
    ).toEqual({
      formFields: {
        padded: '  value  ',
        empty: '',
        whitespace: '   ',
      },
      formFieldNamesToIncludeWhenEmpty: ['empty'],
    });
  });

  it('keeps a dynamic Body field named __proto__ as an own property', () => {
    const merged = mergeCustomBodyParams({}, [{ id: '1', name: '__proto__', value: '' }], true);

    expect(Object.prototype.hasOwnProperty.call(merged.formFields, '__proto__')).toBe(true);
    expect(merged.formFields.__proto__).toBe('');
    expect(merged.formFieldNamesToIncludeWhenEmpty).toEqual(['__proto__']);
  });

  it('does not mark an empty dynamic field that loses to a declared field', () => {
    expect(mergeCustomBodyParams({ declared: '' }, [{ id: '1', name: ' declared ', value: '' }], true)).toEqual({
      formFields: { declared: '' },
      formFieldNamesToIncludeWhenEmpty: [],
    });
  });

  it('uses the last duplicate dynamic row to decide whether an empty value is explicit', () => {
    expect(
      mergeCustomBodyParams(
        {},
        [
          { id: '1', name: 'duplicate', value: '' },
          { id: '2', name: 'duplicate', value: 'final' },
          { id: '3', name: 'empty-last', value: 'initial' },
          { id: '4', name: 'empty-last', value: '' },
        ],
        true,
      ),
    ).toEqual({
      formFields: { duplicate: 'final', 'empty-last': '' },
      formFieldNamesToIncludeWhenEmpty: ['empty-last'],
    });
  });

  it('reserves every schema field even when current or restored form values omit it', () => {
    const reserved = reservedBodyFieldNames({
      mediaType: 'multipart/form-data',
      category: 'multipart',
      schema: {
        type: 'object',
        properties: {
          readOnlyField: { type: 'string', readOnly: true },
          regularField: { type: 'string' },
        },
      },
      fileFields: ['file'],
      jsonFields: ['metadata'],
    });

    expect(
      mergeCustomBodyParams(
        {},
        [
          { id: '1', name: 'readOnlyField', value: 'injected' },
          { id: '2', name: 'regularField', value: 'from-old-history' },
          { id: '3', name: 'file', value: 'not-a-file' },
          { id: '4', name: 'metadata', value: '{"injected":true}' },
          { id: '5', name: 'dynamic', value: '' },
        ],
        true,
        reserved,
      ),
    ).toEqual({
      formFields: { dynamic: '' },
      formFieldNamesToIncludeWhenEmpty: ['dynamic'],
    });
  });

  it('reserves declared fields inherited through allOf refs', () => {
    const doc = {
      openapi: '3.0.3',
      info: { title: 'T', version: '1' },
      paths: {
        '/upload': {
          post: {
            requestBody: {
              content: {
                'multipart/form-data': {
                  schema: { $ref: '#/components/schemas/UploadRequest' },
                  encoding: { metadata: { contentType: 'application/json' } },
                },
              },
            },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
      components: {
        schemas: {
          UploadBase: {
            type: 'object',
            properties: {
              regularField: { type: 'string' },
              readOnlyField: { type: 'string', readOnly: true },
              file: { type: 'string', format: 'binary' },
              metadata: { type: 'object' },
            },
          },
          UploadRequest: {
            allOf: [
              { $ref: '#/components/schemas/UploadBase' },
              { type: 'object', properties: { ownField: { type: 'string' } } },
            ],
          },
        },
      },
    };
    const bodyContent = buildOperationDebugModel({ doc, path: '/upload', method: 'post' }).bodyContents[0];
    const reserved = reservedBodyFieldNames(bodyContent);

    expect([...reserved]).toEqual(
      expect.arrayContaining(['regularField', 'readOnlyField', 'file', 'metadata', 'ownField']),
    );
    expect(
      mergeCustomBodyParams(
        {},
        [
          { id: '1', name: 'regularField', value: 'injected' },
          { id: '2', name: 'readOnlyField', value: 'injected' },
          { id: '3', name: 'file', value: 'not-a-file' },
          { id: '4', name: 'metadata', value: '{"injected":true}' },
          { id: '5', name: 'ownField', value: 'injected' },
          { id: '6', name: 'dynamic', value: '' },
        ],
        true,
        reserved,
      ),
    ).toEqual({
      formFields: { dynamic: '' },
      formFieldNamesToIncludeWhenEmpty: ['dynamic'],
    });
  });
});
