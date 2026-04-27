import { buildSchemaFieldTree } from '../debug/schemaExample';
import type { SchemaResolveContext } from '../debug/types';

// Test document with descriptions on ref target schemas
const doc: Record<string, unknown> = {
  components: {
    schemas: {
      UserWithDesc: {
        type: 'object',
        title: 'User Model',
        description: 'A user entity',
        required: ['id'],
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
        },
      },
      OrderWithDesc: {
        type: 'object',
        properties: {
          // field has no own description — refDescription should come from UserWithDesc
          user: { $ref: '#/components/schemas/UserWithDesc' },
          // field has own description — refDescription should be secondary
          owner: { $ref: '#/components/schemas/UserWithDesc', description: 'The order owner' },
        },
      },
      NestedRef: {
        type: 'object',
        properties: {
          inner: { $ref: '#/components/schemas/UserWithDesc' },
        },
      },
      SelfRefWithDesc: {
        type: 'object',
        description: 'Self-referencing node',
        properties: {
          id: { type: 'integer' },
          parent: { $ref: '#/components/schemas/SelfRefWithDesc' },
        },
      },
    },
  },
};

function ctx(overrides?: Partial<SchemaResolveContext>): SchemaResolveContext {
  return { doc, ...overrides };
}

describe('$ref target description/title pass-through', () => {
  // 1. ref target description used as primary description when field has no own description
  test('uses ref target description as primary description when field has no own description', () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/OrderWithDesc' }, ctx());
    const userNode = nodes.find((n) => n.name === 'user')!;
    expect(userNode).toBeDefined();
    // No own description on the field — description falls back to ref target's description
    expect(userNode.description).toBe('A user entity');
    // refDescription is undefined (no secondary needed when field has no own description)
    expect(userNode.refDescription).toBeUndefined();
  });

  // 2. ref target title exposed as refTitle
  test('exposes ref target title as refTitle', () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/OrderWithDesc' }, ctx());
    const userNode = nodes.find((n) => n.name === 'user')!;
    expect(userNode.refTitle).toBe('User Model');
  });

  // 3. field's own description takes priority; refDescription is secondary
  test("field's own description takes priority over ref target description", () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/OrderWithDesc' }, ctx());
    const ownerNode = nodes.find((n) => n.name === 'owner')!;
    expect(ownerNode).toBeDefined();
    // Own description is preserved
    expect(ownerNode.description).toBe('The order owner');
    // refDescription is the ref target's description (secondary)
    expect(ownerNode.refDescription).toBe('A user entity');
  });

  // 4. nested ref: inner field gets ref target description as primary description
  test('nested ref field gets ref target description as primary description', () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/NestedRef' }, ctx());
    const innerNode = nodes.find((n) => n.name === 'inner')!;
    expect(innerNode).toBeDefined();
    // No own description — falls back to ref target's description
    expect(innerNode.description).toBe('A user entity');
    expect(innerNode.refTitle).toBe('User Model');
  });

  // 5. circular ref: truncated field gets ref target description as primary description
  test('circular ref field gets ref target description as primary description', () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/SelfRefWithDesc' }, ctx());
    const parentNode = nodes.find((n) => n.name === 'parent')!;
    expect(parentNode).toBeDefined();
    expect(parentNode.truncated).toBe(true);
    // No own description — falls back to ref target's description
    expect(parentNode.description).toBe('Self-referencing node');
  });

  // 6. non-ref field has no refDescription
  test('non-ref field has no refDescription', () => {
    const nodes = buildSchemaFieldTree(
      {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The name' },
        },
      },
      ctx(),
    );
    const nameNode = nodes.find((n) => n.name === 'name')!;
    expect(nameNode.description).toBe('The name');
    expect(nameNode.refDescription).toBeUndefined();
    expect(nameNode.refTitle).toBeUndefined();
  });

  // 7. ref target with no description: refDescription is undefined
  test('ref target with no description yields undefined refDescription', () => {
    const docNoDesc: Record<string, unknown> = {
      components: {
        schemas: {
          Simple: {
            type: 'object',
            properties: { id: { type: 'integer' } },
          },
          Container: {
            type: 'object',
            properties: {
              item: { $ref: '#/components/schemas/Simple' },
            },
          },
        },
      },
    };
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/Container' }, { doc: docNoDesc });
    const itemNode = nodes.find((n) => n.name === 'item')!;
    expect(itemNode.refDescription).toBeUndefined();
    expect(itemNode.refTitle).toBeUndefined();
  });
});
// hash-shift: 1
