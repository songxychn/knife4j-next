import { describe, expect, it } from 'vitest';
import { dereference, resolveRef, resolveRefMeta } from './resolveRef';

// ─── fixtures ────────────────────────────────────────────────────────────────

const oas3Doc = {
  components: {
    schemas: {
      User: {
        type: 'object',
        title: 'User',
        description: 'A user account',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
        },
      },
      Address: {
        type: 'object',
        description: 'Postal address',
        properties: {
          street: { type: 'string' },
          user: { $ref: '#/components/schemas/User' },
        },
      },
      // Circular: A → B → A
      NodeA: {
        type: 'object',
        description: 'Node A',
        properties: {
          child: { $ref: '#/components/schemas/NodeB' },
        },
      },
      NodeB: {
        type: 'object',
        description: 'Node B',
        properties: {
          parent: { $ref: '#/components/schemas/NodeA' },
        },
      },
    },
  },
};

const oas2Doc = {
  definitions: {
    Pet: {
      type: 'object',
      title: 'Pet',
      description: 'A pet',
      properties: {
        name: { type: 'string' },
      },
    },
  },
};

// ─── resolveRef ───────────────────────────────────────────────────────────────

describe('resolveRef', () => {
  it('resolves OAS3 $ref', () => {
    const result = resolveRef('#/components/schemas/User', oas3Doc);
    expect(result).toBeDefined();
    expect((result as Record<string, unknown>).description).toBe('A user account');
  });

  it('resolves OAS2 $ref', () => {
    const result = resolveRef('#/definitions/Pet', oas2Doc);
    expect(result).toBeDefined();
    expect((result as Record<string, unknown>).description).toBe('A pet');
  });

  it('returns undefined for unknown ref', () => {
    expect(resolveRef('#/components/schemas/Missing', oas3Doc)).toBeUndefined();
  });

  it('returns undefined for non-hash ref', () => {
    expect(resolveRef('http://example.com/schema', oas3Doc)).toBeUndefined();
  });
});

// ─── resolveRefMeta ───────────────────────────────────────────────────────────

describe('resolveRefMeta', () => {
  it('extracts description and title from direct $ref', () => {
    const meta = resolveRefMeta('#/components/schemas/User', oas3Doc);
    expect(meta.refDescription).toBe('A user account');
    expect(meta.refTitle).toBe('User');
  });

  it('returns empty object for unknown ref', () => {
    const meta = resolveRefMeta('#/components/schemas/Missing', oas3Doc);
    expect(meta.refDescription).toBeUndefined();
    expect(meta.refTitle).toBeUndefined();
  });

  it('extracts description from OAS2 $ref', () => {
    const meta = resolveRefMeta('#/definitions/Pet', oas2Doc);
    expect(meta.refDescription).toBe('A pet');
    expect(meta.refTitle).toBe('Pet');
  });

  it('nested ref: resolves one level (does not recurse)', () => {
    // Address.user is a $ref to User; resolveRefMeta on Address gives Address's own description
    const meta = resolveRefMeta('#/components/schemas/Address', oas3Doc);
    expect(meta.refDescription).toBe('Postal address');
  });
});

// ─── dereference ─────────────────────────────────────────────────────────────

describe('dereference', () => {
  it('resolves a direct $ref', () => {
    const schema = { $ref: '#/components/schemas/User' };
    const result = dereference(schema, oas3Doc);
    expect(result.description).toBe('A user account');
    expect(result.title).toBe('User');
  });

  it('returns schema unchanged when no $ref', () => {
    const schema = { type: 'string', description: 'plain' };
    const result = dereference(schema, oas3Doc);
    expect(result).toBe(schema);
  });

  it('handles circular ref without infinite loop', () => {
    // NodeA → NodeB → NodeA (circular)
    const schema = { $ref: '#/components/schemas/NodeA' };
    // Should resolve NodeA without throwing; stops at maxResolveDepth
    expect(() => dereference(schema, oas3Doc)).not.toThrow();
    const result = dereference(schema, oas3Doc);
    expect(result.description).toBe('Node A');
  });

  it('resolves nested non-circular refs up to maxResolveDepth', () => {
    // Address itself is not a $ref, so dereference returns it unchanged
    const schema = { $ref: '#/components/schemas/Address' };
    const result = dereference(schema, oas3Doc);
    expect(result.description).toBe('Postal address');
  });
});
