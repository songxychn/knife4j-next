import { resolveRef, dereference } from '../../debug/resolveRef';

describe('resolveRef', () => {
  const doc = {
    components: {
      schemas: {
        User: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } },
        Pet: { type: 'object', properties: { name: { type: 'string' } } },
      },
    },
    definitions: {
      Car: { type: 'object', properties: { brand: { type: 'string' } } },
    },
  };

  test('resolves OAS3 #/components/schemas/{name}', () => {
    const result = resolveRef('#/components/schemas/User', doc);
    expect(result).toBeDefined();
    expect(result!.type).toBe('object');
    expect(result!.properties).toHaveProperty('id');
    expect(result!.properties).toHaveProperty('name');
  });

  test('resolves OAS2 #/definitions/{name}', () => {
    const result = resolveRef('#/definitions/Car', doc);
    expect(result).toBeDefined();
    expect(result!.type).toBe('object');
    expect(result!.properties).toHaveProperty('brand');
  });

  test('returns undefined for non-existent ref', () => {
    const result = resolveRef('#/components/schemas/NotExist', doc);
    expect(result).toBeUndefined();
  });

  test('returns undefined for empty ref', () => {
    expect(resolveRef('', doc)).toBeUndefined();
  });

  test('returns undefined for external ref (not starting with #/)', () => {
    expect(resolveRef('https://example.com/schema.json', doc)).toBeUndefined();
  });

  test('returns undefined for broken path', () => {
    expect(resolveRef('#/nonexistent/path', doc)).toBeUndefined();
  });

  test('handles JSON Pointer ~1 and ~0 escaping', () => {
    const docWithSpecialChars = {
      components: {
        schemas: {
          'my/type': { type: 'string' },
          'my~tilde': { type: 'integer' },
        },
      },
    };
    expect(resolveRef('#/components/schemas/my~1type', docWithSpecialChars)).toEqual({ type: 'string' });
    expect(resolveRef('#/components/schemas/my~0tilde', docWithSpecialChars)).toEqual({ type: 'integer' });
  });
});

describe('dereference', () => {
  const doc = {
    components: {
      schemas: {
        User: { $ref: '#/components/schemas/UserBase' },
        UserBase: { type: 'object', properties: { id: { type: 'integer' } } },
      },
    },
  };

  test('resolves single $ref', () => {
    const result = dereference({ $ref: '#/components/schemas/User' }, doc);
    expect(result.type).toBe('object');
  });

  test('resolves chained $ref', () => {
    const result = dereference({ $ref: '#/components/schemas/User' }, doc);
    expect(result.properties).toHaveProperty('id');
  });

  test('returns original object when no $ref', () => {
    const obj = { type: 'string' };
    expect(dereference(obj, doc)).toBe(obj);
  });

  test('stops at maxResolveDepth', () => {
    const circularDoc = {
      components: {
        schemas: {
          A: { $ref: '#/components/schemas/B' },
          B: { $ref: '#/components/schemas/A' },
        },
      },
    };
    // Should not infinite loop
    const result = dereference({ $ref: '#/components/schemas/A' }, circularDoc, 10);
    expect(result.$ref).toBeDefined(); // 最终停在某一层
  });

  test('returns original when $ref cannot be resolved', () => {
    const obj = { $ref: '#/components/schemas/NotExist' };
    const result = dereference(obj, doc);
    expect(result.$ref).toBe('#/components/schemas/NotExist');
  });
});
