import { buildSchemaExample, buildSchemaFieldTree } from '../../debug/schemaExample';
import type { SchemaResolveContext, SchemaFieldNode } from '../../debug/types';

// ─── 测试文档 ─────────────────────────────────────────

const doc: Record<string, unknown> = {
  components: {
    schemas: {
      User: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'integer', format: 'int64' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['ADMIN', 'USER'] },
        },
      },
      Pet: {
        type: 'object',
        properties: {
          name: { type: 'string', example: 'Buddy' },
          tag: { type: 'string' },
        },
      },
      Order: {
        type: 'object',
        required: ['id', 'user'],
        properties: {
          id: { type: 'integer' },
          user: { $ref: '#/components/schemas/User' },
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/Pet' },
          },
        },
      },
      SelfRef: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          parent: { $ref: '#/components/schemas/SelfRef' },
        },
      },
      MutualA: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          b: { $ref: '#/components/schemas/MutualB' },
        },
      },
      MutualB: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          a: { $ref: '#/components/schemas/MutualA' },
        },
      },
      AllOfDemo: {
        allOf: [
          { $ref: '#/components/schemas/User' },
          {
            type: 'object',
            properties: {
              avatar: { type: 'string', format: 'url' },
            },
          },
        ],
      },
      OneOfDemo: {
        oneOf: [{ $ref: '#/components/schemas/User' }, { $ref: '#/components/schemas/Pet' }],
      },
      AnyOfDemo: {
        anyOf: [{ $ref: '#/components/schemas/Pet' }, { type: 'string' }],
      },
      FreeFormMap: {
        type: 'object',
        additionalProperties: { type: 'string' },
      },
      ArrayOfPrimitives: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  },
  definitions: {
    LegacyCar: {
      type: 'object',
      properties: {
        brand: { type: 'string' },
        model: { type: 'string' },
      },
    },
  },
};

function ctx(overrides?: Partial<SchemaResolveContext>): SchemaResolveContext {
  return { doc, ...overrides };
}

// ─── buildSchemaExample 测试 ──────────────────────────

describe('buildSchemaExample', () => {
  // 1. primitive 类型
  test('generates example for string type', () => {
    const result = buildSchemaExample({ type: 'string' }, ctx());
    expect(result).toBe('string');
  });

  test('generates example for string format date-time', () => {
    const result = buildSchemaExample({ type: 'string', format: 'date-time' }, ctx());
    expect(result).toBe('2024-01-01T00:00:00Z');
  });

  test('generates example for integer type', () => {
    const result = buildSchemaExample({ type: 'integer' }, ctx());
    expect(result).toBe(0);
  });

  test('generates example for boolean type', () => {
    const result = buildSchemaExample({ type: 'boolean' }, ctx());
    expect(result).toBe(true);
  });

  // 2. enum
  test('uses first enum value as example', () => {
    const result = buildSchemaExample({ type: 'string', enum: ['cat', 'dog'] }, ctx());
    expect(result).toBe('cat');
  });

  // 3. example/default 优先级
  test('explicit example takes highest priority', () => {
    const result = buildSchemaExample(
      { type: 'string', enum: ['a', 'b'], default: 'default', example: 'explicit' },
      ctx(),
    );
    expect(result).toBe('explicit');
  });

  test('default takes priority over enum and type inference', () => {
    const result = buildSchemaExample({ type: 'string', enum: ['a'], default: 'my-default' }, ctx());
    expect(result).toBe('my-default');
  });

  // 4. $ref 解析
  test('resolves $ref to OAS3 components.schemas', () => {
    const result = buildSchemaExample({ $ref: '#/components/schemas/User' }, ctx());
    expect(result).toEqual({
      id: 0,
      name: 'string',
      email: 'user@example.com',
      role: 'ADMIN',
    });
  });

  test('resolves $ref to OAS2 definitions', () => {
    const result = buildSchemaExample({ $ref: '#/definitions/LegacyCar' }, ctx());
    expect(result).toEqual({
      brand: 'string',
      model: 'string',
    });
  });

  // 5. object
  test('generates example for inline object with properties', () => {
    const result = buildSchemaExample(
      {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'integer' },
        },
      },
      ctx(),
    );
    expect(result).toEqual({ name: 'string', age: 0 });
  });

  // 6. array
  test('generates example for array of primitives', () => {
    const result = buildSchemaExample({ type: 'array', items: { type: 'string' } }, ctx());
    expect(result).toEqual(['string']);
  });

  test('generates example for array of $ref items', () => {
    const result = buildSchemaExample({ type: 'array', items: { $ref: '#/components/schemas/Pet' } }, ctx());
    expect(result).toEqual([{ name: 'Buddy', tag: 'string' }]);
  });

  // 7. 循环引用
  test('handles self-referencing schema without infinite loop', () => {
    const result = buildSchemaExample({ $ref: '#/components/schemas/SelfRef' }, ctx());
    expect(result).toEqual({ id: 0, parent: null });
  });

  test('handles mutual circular references', () => {
    const result = buildSchemaExample({ $ref: '#/components/schemas/MutualA' }, ctx());
    // MutualA.id=0, MutualA.b → MutualB (展开), MutualB.a → MutualA (截断为null)
    expect(result).toEqual({
      id: 0,
      b: { id: 0, a: null },
    });
  });

  // 8. allOf
  test('merges allOf schemas', () => {
    const result = buildSchemaExample({ $ref: '#/components/schemas/AllOfDemo' }, ctx());
    expect(result).toEqual({
      id: 0,
      name: 'string',
      email: 'user@example.com',
      role: 'ADMIN',
      avatar: 'https://example.com',
    });
  });

  // 9. oneOf
  test('uses first resolvable branch of oneOf', () => {
    const result = buildSchemaExample({ $ref: '#/components/schemas/OneOfDemo' }, ctx());
    // First branch is User
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('name');
  });

  // 10. anyOf
  test('uses first resolvable branch of anyOf', () => {
    const result = buildSchemaExample({ $ref: '#/components/schemas/AnyOfDemo' }, ctx());
    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('tag');
  });

  // 11. additionalProperties (map)
  test('generates example for additionalProperties map', () => {
    const result = buildSchemaExample({ $ref: '#/components/schemas/FreeFormMap' }, ctx());
    expect(result).toEqual({ additionalProp1: 'string' });
  });

  // 12. maxDepth 保护
  test('respects maxDepth and returns null beyond it', () => {
    const result = buildSchemaExample({ $ref: '#/components/schemas/User' }, ctx({ maxDepth: 0 }));
    expect(result).toBeNull();
  });

  // 13. 空输入
  test('returns null for undefined schema', () => {
    const result = buildSchemaExample(undefined, ctx());
    expect(result).toBeNull();
  });

  // 14. 不存在的 $ref
  test('returns null for non-existent $ref', () => {
    const result = buildSchemaExample({ $ref: '#/components/schemas/NotExist' }, ctx());
    expect(result).toBeNull();
  });

  // 15. object with nested $ref
  test('generates example for object containing $ref properties', () => {
    const result = buildSchemaExample({ $ref: '#/components/schemas/Order' }, ctx());
    expect(result).toEqual({
      id: 0,
      user: { id: 0, name: 'string', email: 'user@example.com', role: 'ADMIN' },
      items: [{ name: 'Buddy', tag: 'string' }],
    });
  });

  // 16. array with no items
  test('returns empty array when items is missing', () => {
    const result = buildSchemaExample({ type: 'array' }, ctx());
    expect(result).toEqual([]);
  });

  // 17. format-specific examples
  test('generates uuid format example', () => {
    const result = buildSchemaExample({ type: 'string', format: 'uuid' }, ctx());
    expect(result).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6');
  });
});

// ─── buildSchemaFieldTree 测试 ────────────────────────

describe('buildSchemaFieldTree', () => {
  // 1. object 展开
  test('expands object properties into field nodes', () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/User' }, ctx());
    expect(nodes).toHaveLength(4);
    const idNode = nodes.find((n) => n.name === 'id')!;
    expect(idNode.type).toBe('integer');
    expect(idNode.format).toBe('int64');
    expect(idNode.required).toBe(true);
    const emailNode = nodes.find((n) => n.name === 'email')!;
    expect(emailNode.required).toBe(false);
  });

  // 2. $ref refName
  test('sets refName for $ref properties', () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/Order' }, ctx());
    const userNode = nodes.find((n) => n.name === 'user')!;
    expect(userNode.refName).toBe('User');
    expect(userNode.type).toBe('object');
    // 应该有 children（User 的字段）
    expect(userNode.children).toBeDefined();
    expect(userNode.children!.length).toBeGreaterThan(0);
  });

  // 3. array items
  test('represents array as node with items child', () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/Order' }, ctx());
    const itemsNode = nodes.find((n) => n.name === 'items')!;
    expect(itemsNode.type).toBe('array');
    expect(itemsNode.children).toBeDefined();
    expect(itemsNode.children![0].name).toBe('items');
    expect(itemsNode.children![0].refName).toBe('Pet');
  });

  // 4. enum
  test('includes enum values in field node', () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/User' }, ctx());
    const roleNode = nodes.find((n) => n.name === 'role')!;
    expect(roleNode.enum).toEqual(['ADMIN', 'USER']);
  });

  // 5. 循环引用截断
  test('marks circular ref fields as truncated', () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/SelfRef' }, ctx());
    const parentNode = nodes.find((n) => n.name === 'parent')!;
    expect(parentNode.truncated).toBe(true);
    expect(parentNode.refName).toBe('SelfRef');
  });

  // 6. maxDepth
  test('marks object/array as truncated when hitting maxDepth', () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/User' }, ctx({ maxDepth: 1 }));
    // depth=0: User 本身 → 展开 properties → depth=1 到达 User 的各字段
    // 但 User 的字段不会再递归了，因为 depth=1 >= maxDepth=1
    // email 是 string，不截断；其他也是 primitive，不截断
    // 只有 array / object 子字段会被截断
    const orderNodes = buildSchemaFieldTree({ $ref: '#/components/schemas/Order' }, ctx({ maxDepth: 1 }));
    const userNode = orderNodes.find((n) => n.name === 'user')!;
    expect(userNode.truncated).toBe(true);
  });

  // 7. allOf
  test('merges allOf in field tree', () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/AllOfDemo' }, ctx());
    const names = nodes.map((n) => n.name);
    expect(names).toContain('id');
    expect(names).toContain('name');
    expect(names).toContain('email');
    expect(names).toContain('role');
    expect(names).toContain('avatar');
  });

  // 8. oneOf / anyOf
  test('uses first resolvable branch in oneOf field tree', () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/OneOfDemo' }, ctx());
    const names = nodes.map((n) => n.name);
    expect(names).toContain('id');
    expect(names).toContain('name');
  });

  // 9. 空输入
  test('returns empty array for undefined schema', () => {
    const result = buildSchemaFieldTree(undefined, ctx());
    expect(result).toEqual([]);
  });

  // 10. primitive 顶层
  test('returns single node for top-level primitive schema', () => {
    const result = buildSchemaFieldTree({ type: 'string', format: 'email' }, ctx());
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('string');
    expect(result[0].format).toBe('email');
    expect(result[0].name).toBe('');
  });

  // 11. array 顶层
  test('returns items node for top-level array schema', () => {
    const result = buildSchemaFieldTree({ type: 'array', items: { type: 'integer' } }, ctx());
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('array');
    expect(result[0].children).toBeDefined();
    expect(result[0].children![0].name).toBe('items');
    expect(result[0].children![0].type).toBe('integer');
  });

  // 12. example / default / description 透传
  test('passes through example, default, and description to field nodes', () => {
    const nodes = buildSchemaFieldTree(
      {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'active', default: 'pending', description: 'Current status' },
        },
      },
      ctx(),
    );
    const statusNode = nodes[0];
    expect(statusNode.example).toBe('active');
    expect(statusNode.default).toBe('pending');
    expect(statusNode.description).toBe('Current status');
  });

  // 13. readOnly / writeOnly / deprecated
  test('passes through readOnly, writeOnly, and deprecated', () => {
    const nodes = buildSchemaFieldTree(
      {
        type: 'object',
        properties: {
          createdAt: { type: 'string', readOnly: true },
          password: { type: 'string', writeOnly: true },
          oldField: { type: 'string', deprecated: true },
        },
      },
      ctx(),
    );
    const createdNode = nodes.find((n) => n.name === 'createdAt')!;
    expect(createdNode.readOnly).toBe(true);
    const passwordNode = nodes.find((n) => n.name === 'password')!;
    expect(passwordNode.writeOnly).toBe(true);
    const oldNode = nodes.find((n) => n.name === 'oldField')!;
    expect(oldNode.deprecated).toBe(true);
  });

  // 14. mutual circular reference
  test('handles mutual circular reference in field tree', () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/MutualA' }, ctx());
    const bNode = nodes.find((n) => n.name === 'b')!;
    expect(bNode.refName).toBe('MutualB');
    // b 的 children 应包含 MutualB 的字段，其中 a 应被截断
    if (bNode.children) {
      const aInB = bNode.children.find((n) => n.name === 'a');
      if (aInB) {
        expect(aInB.truncated).toBe(true);
      }
    }
  });

  // 15. additionalProperties map
  test('represents additionalProperties map as * field', () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/FreeFormMap' }, ctx());
    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe('*');
    expect(nodes[0].type).toBe('string');
  });
});
