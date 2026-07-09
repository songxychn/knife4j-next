import { describe, expect, it } from 'vitest';
import type { SchemaFieldNode } from 'knife4j-core';
import type { OperationObject } from '../../types/swagger';
import { applyValidationGroupRequiredFields, validationGroupRequiredFields } from './validationGroups';

function field(name: string, required = false): SchemaFieldNode {
  return {
    name,
    type: 'string',
    required,
  };
}

describe('validation groups', () => {
  it('unions operation validation group fields', () => {
    const operation: OperationObject = {
      responses: {},
      'x-validation-groups': {
        AddGroup: ['firstName', 'lastName'],
        UpdateGroup: ['id', 'firstName'],
      },
    };

    expect(Array.from(validationGroupRequiredFields(operation) ?? []).sort()).toEqual(['firstName', 'id', 'lastName']);
  });

  it('overrides top-level request body required flags when extension exists', () => {
    const operation: OperationObject = {
      responses: {},
      'x-validation-groups': {
        AddGroup: ['firstName', 'lastName'],
      },
    };

    expect(
      applyValidationGroupRequiredFields([field('id', true), field('firstName'), field('email')], operation),
    ).toEqual([field('id', false), field('firstName', true), field('email', false)]);
  });

  it('keeps schema required flags when extension is absent', () => {
    const fields = [field('id', true), field('name')];
    expect(applyValidationGroupRequiredFields(fields, { responses: {} })).toBe(fields);
  });
});
