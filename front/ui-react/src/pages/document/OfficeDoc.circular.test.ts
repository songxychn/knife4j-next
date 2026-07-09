/**
 * Unit tests for circular $ref guard in offline HTML export schema flattening.
 *
 * These tests verify the algorithm directly (no React/antd/docx imports needed).
 * The same logic is implemented in OfficeDoc.tsx::flattenSchemaFields.
 *
 * Covers:
 *  1. Direct circular ref: A.$ref -> A
 *  2. Indirect circular ref: A->B->A
 *  3. Depth limit (> 30) renders placeholder
 *  4. Normal (non-circular) schema returns correct fields
 */
import { describe, test, expect } from 'vitest';

// ── Minimal types ────────────────────────────────────────────────────────────

interface SchemaObject {
  type?: string;
  $ref?: string;
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  required?: string[];
  format?: string;
  description?: string;
}

interface SwaggerDoc {
  components?: { schemas?: Record<string, SchemaObject> };
}

interface FieldRow {
  fieldPath: string;
  typeDisplay: string;
  required: boolean;
  description: string;
}

// ── Algorithm (mirrors OfficeDoc.tsx) ────────────────────────────────────────

const CIRCULAR_REF_PLACEHOLDER = '... circular reference ...';
const MAX_FLATTEN_DEPTH = 30;

function circularPlaceholder(prefix: string): FieldRow[] {
  return [
    {
      fieldPath: prefix || CIRCULAR_REF_PLACEHOLDER,
      typeDisplay: CIRCULAR_REF_PLACEHOLDER,
      required: false,
      description: '',
    },
  ];
}

function resolveRef(ref: string, doc: SwaggerDoc): SchemaObject | undefined {
  const parts = ref.replace(/^#\//, '').split('/');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = doc;
  for (const p of parts) cur = cur?.[p];
  return cur as SchemaObject | undefined;
}

function typeLabel(schema: SchemaObject): string {
  if (schema.type === 'array' && schema.items) return `array[${typeLabel(schema.items)}]`;
  return schema.format ? `${schema.type}(${schema.format})` : (schema.type ?? 'object');
}

function flattenSchemaFields(
  schema: SchemaObject,
  doc: SwaggerDoc,
  prefix = '',
  requiredSet: Set<string> = new Set(),
  depth = 0,
  seenRefs: Set<string> = new Set(),
): FieldRow[] {
  if (depth > MAX_FLATTEN_DEPTH) return circularPlaceholder(prefix);

  if (schema.$ref) {
    if (seenRefs.has(schema.$ref)) return circularPlaceholder(prefix);
    const nextSeen = new Set(seenRefs);
    nextSeen.add(schema.$ref);
    const resolved = resolveRef(schema.$ref, doc);
    if (!resolved) return [];
    return flattenSchemaFields(resolved, doc, prefix, requiredSet, depth + 1, nextSeen);
  }

  if (schema.type === 'object' && schema.properties) {
    const req = new Set<string>(schema.required ?? []);
    return Object.entries(schema.properties).flatMap(([key, val]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      const isRequired = req.has(key) || requiredSet.has(key);
      if (val.$ref || (val.type === 'object' && val.properties)) {
        const row: FieldRow = {
          fieldPath: path,
          typeDisplay: val.$ref ? val.$ref.split('/').pop()! : 'object',
          required: isRequired,
          description: val.description ?? '',
        };
        const children = flattenSchemaFields(val, doc, path, new Set(), depth + 1, seenRefs);
        return [row, ...children];
      }
      return [
        { fieldPath: path, typeDisplay: typeLabel(val), required: isRequired, description: val.description ?? '' },
      ];
    });
  }

  return [];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDoc(schemas: Record<string, SchemaObject>): SwaggerDoc {
  return { components: { schemas } };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('flattenSchemaFields — circular $ref guard', () => {
  test('direct self-referencing $ref does not stack overflow', () => {
    const doc = makeDoc({
      A: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          child: { $ref: '#/components/schemas/A' },
        },
      },
    });
    const schema: SchemaObject = { $ref: '#/components/schemas/A' };

    let rows: FieldRow[] = [];
    expect(() => {
      rows = flattenSchemaFields(schema, doc);
    }).not.toThrow();

    const types = rows.map((r) => r.typeDisplay);
    expect(types).toContain(CIRCULAR_REF_PLACEHOLDER);
  });

  test('indirect circular ref A->B->A does not stack overflow', () => {
    const doc = makeDoc({
      A: {
        type: 'object',
        properties: { b: { $ref: '#/components/schemas/B' } },
      },
      B: {
        type: 'object',
        properties: { a: { $ref: '#/components/schemas/A' } },
      },
    });
    const schema: SchemaObject = { $ref: '#/components/schemas/A' };

    let rows: FieldRow[] = [];
    expect(() => {
      rows = flattenSchemaFields(schema, doc);
    }).not.toThrow();

    const types = rows.map((r) => r.typeDisplay);
    expect(types).toContain(CIRCULAR_REF_PLACEHOLDER);
  });

  test('placeholder row typeDisplay is "... circular reference ..."', () => {
    const doc = makeDoc({
      Loop: {
        type: 'object',
        properties: { self: { $ref: '#/components/schemas/Loop' } },
      },
    });
    const schema: SchemaObject = { $ref: '#/components/schemas/Loop' };
    const rows = flattenSchemaFields(schema, doc);
    const placeholder = rows.find((r) => r.typeDisplay === CIRCULAR_REF_PLACEHOLDER);
    expect(placeholder).toBeDefined();
  });

  test('non-circular schema returns correct fields without placeholder', () => {
    const doc = makeDoc({
      User: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'integer', format: 'int64' },
          name: { type: 'string' },
        },
      },
    });
    const schema: SchemaObject = { $ref: '#/components/schemas/User' };
    const rows = flattenSchemaFields(schema, doc);

    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.fieldPath === 'id')?.required).toBe(true);
    expect(rows.find((r) => r.fieldPath === 'name')?.required).toBe(false);
    expect(rows.every((r) => r.typeDisplay !== CIRCULAR_REF_PLACEHOLDER)).toBe(true);
  });

  test('depth > 30 returns placeholder instead of infinite recursion', () => {
    const doc = makeDoc({
      A: { type: 'object', properties: { x: { type: 'string' } } },
    });
    const schema: SchemaObject = { $ref: '#/components/schemas/A' };
    // depth=31 exceeds MAX_FLATTEN_DEPTH=30
    const rows = flattenSchemaFields(schema, doc, '', new Set(), 31);
    expect(rows.length).toBe(1);
    expect(rows[0].typeDisplay).toBe(CIRCULAR_REF_PLACEHOLDER);
  });
});
