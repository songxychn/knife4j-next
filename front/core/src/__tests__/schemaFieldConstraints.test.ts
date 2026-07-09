// v1
import { buildSchemaFieldTree } from '../debug/schemaExample';
import type { SchemaResolveContext } from '../debug/types';

const doc: Record<string, unknown> = {};

function ctx(overrides?: Partial<SchemaResolveContext>): SchemaResolveContext {
  return { doc, ...overrides };
}

describe('buildSchemaFieldTree — constraint field pass-through', () => {
  test('passes through minLength, maxLength, pattern for string fields', () => {
    const nodes = buildSchemaFieldTree(
      {
        type: 'object',
        properties: {
          username: { type: 'string', minLength: 3, maxLength: 20, pattern: '^[a-z]+$' },
        },
      },
      ctx(),
    );
    const node = nodes.find((n) => n.name === 'username')!;
    expect(node.minLength).toBe(3);
    expect(node.maxLength).toBe(20);
    expect(node.pattern).toBe('^[a-z]+$');
  });

  test('passes through minimum and maximum for numeric fields', () => {
    const nodes = buildSchemaFieldTree(
      {
        type: 'object',
        properties: {
          age: { type: 'integer', minimum: 0, maximum: 120 },
          score: { type: 'number', minimum: 0.0, maximum: 100.0 },
        },
      },
      ctx(),
    );
    const ageNode = nodes.find((n) => n.name === 'age')!;
    expect(ageNode.minimum).toBe(0);
    expect(ageNode.maximum).toBe(120);
    const scoreNode = nodes.find((n) => n.name === 'score')!;
    expect(scoreNode.minimum).toBe(0.0);
    expect(scoreNode.maximum).toBe(100.0);
  });

  test('constraint fields are undefined when not present in schema', () => {
    const nodes = buildSchemaFieldTree(
      {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      },
      ctx(),
    );
    const node = nodes.find((n) => n.name === 'name')!;
    expect(node.minLength).toBeUndefined();
    expect(node.maxLength).toBeUndefined();
    expect(node.minimum).toBeUndefined();
    expect(node.maximum).toBeUndefined();
    expect(node.pattern).toBeUndefined();
  });

  test('passes through all constraints together on a single field', () => {
    const nodes = buildSchemaFieldTree(
      {
        type: 'object',
        properties: {
          code: { type: 'string', minLength: 1, maxLength: 10, pattern: '^[A-Z]+$' },
        },
      },
      ctx(),
    );
    const node = nodes.find((n) => n.name === 'code')!;
    expect(node.minLength).toBe(1);
    expect(node.maxLength).toBe(10);
    expect(node.pattern).toBe('^[A-Z]+$');
    expect(node.minimum).toBeUndefined();
    expect(node.maximum).toBeUndefined();
  });
});
