/**
 * issue-114: allOf/oneOf/anyOf schema merge coverage
 *
 * Scenarios:
 * - Single inheritance (allOf with one $ref parent)
 * - Double inheritance (allOf chain: GuideDog → Dog → Animal)
 * - oneOf polymorphism
 * - anyOf polymorphism
 * - additionalProperties alongside allOf
 */
import { buildSchemaExample, buildSchemaFieldTree } from '../debug/schemaExample';
import type { SchemaResolveContext } from '../debug/types';

const doc: Record<string, unknown> = {
  components: {
    schemas: {
      Animal: {
        type: 'object',
        required: ['species'],
        properties: {
          species: { type: 'string' },
          age: { type: 'integer' },
        },
      },
      // Single inheritance: Dog extends Animal
      Dog: {
        allOf: [
          { $ref: '#/components/schemas/Animal' },
          {
            type: 'object',
            required: ['breed'],
            properties: {
              breed: { type: 'string' },
              trained: { type: 'boolean' },
            },
          },
        ],
      },
      // Double inheritance: GuideDog extends Dog (which extends Animal)
      GuideDog: {
        allOf: [
          { $ref: '#/components/schemas/Dog' },
          {
            type: 'object',
            properties: {
              certNumber: { type: 'string' },
            },
          },
        ],
      },
      // oneOf polymorphism: Dog or Cat (inline)
      DogOrCat: {
        oneOf: [
          { $ref: '#/components/schemas/Dog' },
          {
            type: 'object',
            properties: {
              indoor: { type: 'boolean' },
              lives: { type: 'integer' },
            },
          },
        ],
      },
      // anyOf polymorphism
      AnyAnimal: {
        anyOf: [{ $ref: '#/components/schemas/Animal' }, { $ref: '#/components/schemas/Dog' }],
      },
      // additionalProperties alongside allOf
      ExtendedMap: {
        allOf: [
          { $ref: '#/components/schemas/Animal' },
          {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
        ],
      },
      // allOf with outer-level properties (discriminator pattern)
      PetWrapper: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
        },
        allOf: [{ $ref: '#/components/schemas/Animal' }],
      },
    },
  },
};

function ctx(overrides?: Partial<SchemaResolveContext>): SchemaResolveContext {
  return { doc, ...overrides };
}

// ─── buildSchemaExample: allOf/oneOf/anyOf ────────────────────────────────────

describe('buildSchemaExample – allOf/oneOf/anyOf inheritance (issue-114)', () => {
  test('single inheritance: Dog merges Animal + own properties', () => {
    const result = buildSchemaExample({ $ref: '#/components/schemas/Dog' }, ctx()) as Record<string, unknown>;
    expect(result).toHaveProperty('species');
    expect(result).toHaveProperty('age');
    expect(result).toHaveProperty('breed');
    expect(result).toHaveProperty('trained');
  });

  test('double inheritance: GuideDog merges Animal + Dog + own properties', () => {
    const result = buildSchemaExample({ $ref: '#/components/schemas/GuideDog' }, ctx()) as Record<string, unknown>;
    // From Animal (via Dog)
    expect(result).toHaveProperty('species');
    expect(result).toHaveProperty('age');
    // From Dog
    expect(result).toHaveProperty('breed');
    expect(result).toHaveProperty('trained');
    // Own
    expect(result).toHaveProperty('certNumber');
  });

  test('oneOf polymorphism: uses first resolvable branch (Dog)', () => {
    const result = buildSchemaExample({ $ref: '#/components/schemas/DogOrCat' }, ctx()) as Record<string, unknown>;
    // First branch is Dog (which includes Animal fields)
    expect(result).toHaveProperty('breed');
  });

  test('anyOf polymorphism: uses first resolvable branch (Animal)', () => {
    const result = buildSchemaExample({ $ref: '#/components/schemas/AnyAnimal' }, ctx()) as Record<string, unknown>;
    expect(result).toHaveProperty('species');
    expect(result).toHaveProperty('age');
  });

  test('additionalProperties alongside allOf: parent fields present', () => {
    const result = buildSchemaExample({ $ref: '#/components/schemas/ExtendedMap' }, ctx()) as Record<string, unknown>;
    expect(result).toHaveProperty('species');
    expect(result).toHaveProperty('age');
  });

  test('allOf with outer properties: both outer and allOf fields merged', () => {
    const result = buildSchemaExample({ $ref: '#/components/schemas/PetWrapper' }, ctx()) as Record<string, unknown>;
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('species');
    expect(result).toHaveProperty('age');
  });
});

// ─── buildSchemaFieldTree: allOf/oneOf/anyOf ─────────────────────────────────

describe('buildSchemaFieldTree – allOf/oneOf/anyOf inheritance (issue-114)', () => {
  test('single inheritance: Dog field tree contains Animal + own fields', () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/Dog' }, ctx());
    const names = nodes.map((n) => n.name);
    expect(names).toContain('species');
    expect(names).toContain('age');
    expect(names).toContain('breed');
    expect(names).toContain('trained');
  });

  test('single inheritance: required fields from parent are preserved', () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/Dog' }, ctx());
    const speciesNode = nodes.find((n) => n.name === 'species');
    expect(speciesNode).toBeDefined();
    expect(speciesNode!.required).toBe(true);
    const breedNode = nodes.find((n) => n.name === 'breed');
    expect(breedNode).toBeDefined();
    expect(breedNode!.required).toBe(true);
  });

  test('double inheritance: GuideDog field tree contains all ancestor fields', () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/GuideDog' }, ctx());
    const names = nodes.map((n) => n.name);
    expect(names).toContain('species');
    expect(names).toContain('age');
    expect(names).toContain('breed');
    expect(names).toContain('trained');
    expect(names).toContain('certNumber');
  });

  test('oneOf polymorphism: field tree uses first branch', () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/DogOrCat' }, ctx());
    const names = nodes.map((n) => n.name);
    // First branch is Dog → should have breed
    expect(names).toContain('breed');
  });

  test('anyOf polymorphism: field tree uses first branch (Animal)', () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/AnyAnimal' }, ctx());
    const names = nodes.map((n) => n.name);
    expect(names).toContain('species');
    expect(names).toContain('age');
  });

  test('additionalProperties alongside allOf: parent fields in tree', () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/ExtendedMap' }, ctx());
    const names = nodes.map((n) => n.name);
    expect(names).toContain('species');
    expect(names).toContain('age');
  });

  test('allOf with outer properties: all fields in tree', () => {
    const nodes = buildSchemaFieldTree({ $ref: '#/components/schemas/PetWrapper' }, ctx());
    const names = nodes.map((n) => n.name);
    expect(names).toContain('id');
    expect(names).toContain('species');
    expect(names).toContain('age');
  });

  test('inline allOf without $ref: merges all sub-schemas', () => {
    const schema: Record<string, unknown> = {
      allOf: [
        { type: 'object', properties: { x: { type: 'integer' } } },
        { type: 'object', properties: { y: { type: 'string' } } },
      ],
    };
    const nodes = buildSchemaFieldTree(schema, ctx());
    const names = nodes.map((n) => n.name);
    expect(names).toContain('x');
    expect(names).toContain('y');
  });
});
