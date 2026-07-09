import { resolveRefMeta } from '../debug/resolveRef';

describe('resolveRefMeta', () => {
  const doc = {
    components: {
      schemas: {
        User: {
          type: 'object',
          title: 'User Schema',
          description: 'A user entity',
          properties: { id: { type: 'integer' } },
        },
        NoMeta: { type: 'object', properties: {} },
      },
    },
    definitions: {
      Car: { type: 'object', title: 'Car', description: 'A car entity' },
    },
  };

  test('returns refDescription and refTitle from OAS3 ref target', () => {
    const meta = resolveRefMeta('#/components/schemas/User', doc);
    expect(meta.refDescription).toBe('A user entity');
    expect(meta.refTitle).toBe('User Schema');
  });

  test('returns refDescription and refTitle from OAS2 definitions ref', () => {
    const meta = resolveRefMeta('#/definitions/Car', doc);
    expect(meta.refDescription).toBe('A car entity');
    expect(meta.refTitle).toBe('Car');
  });

  test('returns empty object when ref target has no description/title', () => {
    const meta = resolveRefMeta('#/components/schemas/NoMeta', doc);
    expect(meta.refDescription).toBeUndefined();
    expect(meta.refTitle).toBeUndefined();
  });

  test('returns empty object for non-existent ref', () => {
    const meta = resolveRefMeta('#/components/schemas/NotExist', doc);
    expect(meta.refDescription).toBeUndefined();
    expect(meta.refTitle).toBeUndefined();
  });

  test('nested ref: resolveRefMeta on a $ref-only schema returns no description', () => {
    const nestedDoc = {
      components: {
        schemas: {
          Alias: { $ref: '#/components/schemas/User' },
          User: { type: 'object', description: 'User entity', title: 'User' },
        },
      },
    };
    // Alias schema itself has no description/title — it's just a $ref wrapper
    const meta = resolveRefMeta('#/components/schemas/Alias', nestedDoc);
    expect(meta.refDescription).toBeUndefined();
    expect(meta.refTitle).toBeUndefined();
  });

  test('circular ref: does not throw', () => {
    const circularDoc = {
      components: {
        schemas: {
          A: { $ref: '#/components/schemas/B', description: 'Schema A' },
          B: { $ref: '#/components/schemas/A', description: 'Schema B' },
        },
      },
    };
    expect(() => resolveRefMeta('#/components/schemas/A', circularDoc)).not.toThrow();
    const meta = resolveRefMeta('#/components/schemas/A', circularDoc);
    expect(meta.refDescription).toBe('Schema A');
  });
});
