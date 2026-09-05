import { describe, expect, test } from 'vitest';
import type { DebugParam, OperationDebugModel } from 'knife4j-core';
import {
  buildInitialParamEnabled,
  collectOas31ParameterValues,
  isNullableOas31Parameter,
  isOas31RequiredParameterError,
} from './oas31ParameterForm';

function parameter(name: string, options: Partial<DebugParam> = {}): DebugParam {
  return {
    name,
    in: 'query',
    required: false,
    type: 'string',
    parameterSerialization: { kind: 'schema', style: 'form', explode: true, allowReserved: false },
    ...options,
  };
}

function model(parameters: DebugParam[]): OperationDebugModel {
  return {
    pathParams: [],
    queryParams: parameters,
    headerParams: [],
    cookieParams: [],
    bodyContents: [],
    bodyRequired: false,
  };
}

describe('OAS 3.1 parameter form snapshots', () => {
  test('allows explicit required-parameter overrides without loosening legacy or body required checks', () => {
    const current = model([
      parameter('tags', { required: true }),
      parameter('legacy', { required: true, parameterSerialization: undefined }),
    ]);
    expect(isOas31RequiredParameterError(current, { name: 'tags', in: 'query', message: 'required' })).toBe(true);
    expect(isOas31RequiredParameterError(current, { name: 'legacy', in: 'query', message: 'required' })).toBe(false);
    expect(isOas31RequiredParameterError(current, { name: 'tags', in: 'body', message: 'required' })).toBe(false);
  });
  test('starts empty optional 3.1 parameters disabled while preserving legacy and required defaults', () => {
    const current = model([
      parameter('optional'),
      parameter('required', { required: true }),
      parameter('example'),
      parameter('legacy', { parameterSerialization: undefined }),
    ]);

    expect(
      buildInitialParamEnabled(current, {
        'query:optional': '',
        'query:required': '',
        'query:example': 'active',
        'query:legacy': '',
      }),
    ).toEqual({
      'query:optional': false,
      'query:required': true,
      'query:example': true,
      'query:legacy': true,
    });
  });

  test('distinguishes an enabled empty value from an omitted value in one request snapshot', () => {
    const current = model([
      parameter('empty'),
      parameter('omitted'),
      parameter('legacy', { parameterSerialization: undefined }),
    ]);
    expect(
      collectOas31ParameterValues(
        current,
        { 'query:empty': '', 'query:omitted': 'ignored', 'query:legacy': 'legacy-value' },
        { 'query:empty': true, 'query:omitted': false, 'query:legacy': true },
      ),
    ).toEqual({ 'query:empty': '' });
  });

  test('recognizes nullable OAS 3.1 type arrays without changing legacy controls', () => {
    expect(
      isNullableOas31Parameter(parameter('nullable', { type: 'boolean', schema: { type: ['boolean', 'null'] } })),
    ).toBe(true);
    expect(isNullableOas31Parameter(parameter('boolean', { type: 'boolean', schema: { type: 'boolean' } }))).toBe(
      false,
    );
    expect(
      isNullableOas31Parameter(
        parameter('legacy', {
          type: 'boolean',
          schema: { type: ['boolean', 'null'] },
          parameterSerialization: undefined,
        }),
      ),
    ).toBe(false);
  });
});
