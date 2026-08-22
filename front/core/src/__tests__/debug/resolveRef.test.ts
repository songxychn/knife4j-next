import { resolveRef, dereference, normalizeAllOfSchema } from '../../debug/resolveRef';

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

describe('normalizeAllOfSchema', () => {
  test('recursively merges referenced allOf properties and required names', () => {
    const doc = {
      components: {
        schemas: {
          Base: {
            type: 'object',
            required: ['base'],
            properties: { base: { type: 'string' } },
          },
          Nested: {
            allOf: [
              { $ref: '#/components/schemas/Base' },
              { type: 'object', required: ['nested'], properties: { nested: { type: 'integer' } } },
            ],
          },
        },
      },
    };

    expect(normalizeAllOfSchema({ $ref: '#/components/schemas/Nested' }, doc)).toEqual({
      type: 'object',
      required: ['base', 'nested'],
      properties: {
        base: { type: 'string' },
        nested: { type: 'integer' },
      },
    });
  });

  test('stops circular allOf refs while retaining non-circular fields', () => {
    const doc = {
      components: {
        schemas: {
          A: {
            allOf: [{ $ref: '#/components/schemas/B' }, { type: 'object', properties: { a: { type: 'string' } } }],
          },
          B: {
            allOf: [{ $ref: '#/components/schemas/A' }, { type: 'object', properties: { b: { type: 'string' } } }],
          },
        },
      },
    };

    const normalized = normalizeAllOfSchema({ $ref: '#/components/schemas/A' }, doc);
    expect(normalized.type).toBe('object');
    expect(normalized.properties).toEqual({ b: { type: 'string' }, a: { type: 'string' } });
  });

  test('preserves a property named __proto__ as an own field', () => {
    const properties = Object.fromEntries([['__proto__', { type: 'string' }]]);
    const normalized = normalizeAllOfSchema(
      {
        allOf: [
          { type: 'object', properties },
          { type: 'object', properties: { regular: { type: 'string' } } },
        ],
      },
      {},
    );

    expect(Object.prototype.hasOwnProperty.call(normalized.properties, '__proto__')).toBe(true);
    expect(normalized.properties).toEqual(
      Object.fromEntries([
        ['__proto__', { type: 'string' }],
        ['regular', { type: 'string' }],
      ]),
    );
  });

  test('keeps shallow allOf fields when max depth truncates a deeper ref', () => {
    const doc = {
      components: {
        schemas: {
          Deep: { type: 'object', properties: { deep: { type: 'string' } } },
        },
      },
    };
    const normalized = normalizeAllOfSchema(
      {
        allOf: [{ type: 'object', properties: { shallow: { type: 'string' } } }, { $ref: '#/components/schemas/Deep' }],
      },
      doc,
      1,
    );

    expect(normalized.properties).toEqual({ shallow: { type: 'string' } });
  });

  test('resolves an object reached at exactly max depth', () => {
    const schemas: Record<string, Record<string, unknown>> = {};
    for (let index = 0; index < 7; index++) {
      schemas[`S${index}`] = { $ref: `#/components/schemas/S${index + 1}` };
    }
    schemas.S7 = { type: 'object', properties: { value: { type: 'string' } } };

    const normalized = normalizeAllOfSchema({ $ref: '#/components/schemas/S0' }, { components: { schemas } }, 8);
    expect(normalized.properties).toEqual({ value: { type: 'string' } });
  });

  test('safely stops a ref chain deeper than max depth', () => {
    const schemas: Record<string, Record<string, unknown>> = {};
    for (let index = 0; index < 8; index++) {
      schemas[`S${index}`] = { $ref: `#/components/schemas/S${index + 1}` };
    }
    schemas.S8 = { type: 'object', properties: { value: { type: 'string' } } };

    const original = { $ref: '#/components/schemas/S0' };
    expect(normalizeAllOfSchema(original, { components: { schemas } }, 8)).toBe(original);
  });
});
