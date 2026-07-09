import { describe, expect, it } from 'vitest';
import { resolveSchemaActiveKeys } from './schemaActiveKeys';

describe('resolveSchemaActiveKeys', () => {
  it('keeps the schema list collapsed by default', () => {
    expect(resolveSchemaActiveKeys()).toEqual([]);
  });

  it('opens the model selected by the route', () => {
    expect(resolveSchemaActiveKeys('UserDTO')).toEqual(['UserDTO']);
  });
});
