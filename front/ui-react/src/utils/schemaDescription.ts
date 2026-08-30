/**
 * Recursively walk an OpenAPI response schema and produce a mapping from
 * JSON-path to the `description` string of each field.
 *
 * Paths use a simplified dot-notation:
 *   - object properties  →  "propName"
 *   - nested objects     →  "outer.inner"
 *   - array items        →  "arr[*]"  (star for all items)
 *
 * The resulting map can be looked up while iterating the pretty-printed
 * JSON response so that field descriptions can be rendered inline.
 */
import { normalizeAllOfSchema } from 'knife4j-core';
import type { SchemaObject, SwaggerDoc } from '../types/swagger';

type SchemaDoc = Pick<SwaggerDoc, 'openapi' | 'components' | 'definitions'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Resolve local refs and conjunctions with the core OAS 3.1 projection. */
function resolveSchema(schema: SchemaObject | undefined, doc: SchemaDoc, depth = 0): SchemaObject | undefined {
  if (!schema || depth > 10) return schema;
  return normalizeAllOfSchema(
    schema as Record<string, unknown>,
    doc as unknown as Record<string, unknown>,
    10 - depth,
  ) as SchemaObject;
}

/**
 * Build a flat map of `path → description` from a response schema.
 *
 * @param schema  The top-level response schema (may be a `$ref`).
 * @param doc     The full SwaggerDoc for ref resolution.
 * @returns       e.g. `{ "data": "响应数据", "data.name": "用户名", "items[*].id": "ID" }`
 */
export function buildSchemaDescriptionMap(schema: SchemaObject | undefined, doc: SchemaDoc): Map<string, string> {
  const map = new Map<string, string>();
  if (!schema) return map;

  const resolved = resolveSchema(schema, doc);
  if (!resolved) return map;

  walk(resolved, '', doc, map);
  return map;
}

function walk(schema: SchemaObject, prefix: string, doc: SchemaDoc, map: Map<string, string>, depth = 0) {
  if (depth > 15) return; // safety guard

  const resolved = resolveSchema(schema, doc, depth);
  if (!resolved) return;

  if (resolved.description && prefix) {
    map.set(prefix, resolved.description);
  }

  // Object with properties
  if (resolved.properties) {
    for (const [name, prop] of Object.entries(resolved.properties)) {
      const path = prefix ? `${prefix}.${name}` : name;
      walk(prop, path, doc, map, depth + 1);
    }
  }

  // Array → walk items with [*]
  if (resolved.items) {
    const path = prefix ? `${prefix}[*]` : '[*]';
    walk(resolved.items, path, doc, map, depth + 1);
  }

  for (const keyword of ['allOf', 'oneOf', 'anyOf'] as const) {
    const branches = resolved[keyword];
    if (Array.isArray(branches)) {
      branches.forEach((branch) => {
        if (isRecord(branch)) walk(branch as SchemaObject, prefix, doc, map, depth + 1);
      });
    }
  }
}

/** One rendered line of annotated JSON. */
export interface AnnotatedJsonLine {
  /** Original JSON line (pretty-printed) with trailing whitespace preserved. */
  code: string;
  /** Optional description to render as a subdued inline comment next to `code`. */
  description?: string;
}

/**
 * Parse a pretty-printed JSON string and attach a schema description to each
 * recognized field line. Returns an array of `{ code, description? }` so the
 * caller can style the description separately from the JSON itself.
 *
 * The walker maintains two parallel stacks:
 *   - `pathStack`       — path fragments joined to look up a description
 *   - `containerStack`  — frames describing each currently open container
 *
 * Path rules:
 *   - inside an `object`, a `"key":` line contributes its key to the path
 *   - inside an `array`, every element's opening `{` / `[` shares the
 *     parent's `[*]` slot, so we don't push another path segment
 *
 * Path lookup tries both the exact path and `path[*]`, so array-of-primitives
 * descriptions (keyed by `"field[*]"` in the schema map) also match.
 */
export function annotateJsonWithDescriptions(json: string, descMap: Map<string, string>): AnnotatedJsonLine[] {
  const lines = json.split('\n');

  /**
   * Each entry describes one currently open container and how many path
   * segments were pushed when it opened, so that closing it pops exactly
   * as many segments from `pathStack`.
   */
  interface Frame {
    kind: 'object' | 'array' | 'top-object' | 'top-array' | 'array-elem';
    pushed: number;
  }
  const pathStack: string[] = [];
  const containerStack: Frame[] = [];
  const result: AnnotatedJsonLine[] = [];

  const isArrayLike = (f: Frame | undefined) => !!f && (f.kind === 'array' || f.kind === 'top-array');

  for (const line of lines) {
    const trimmed = line.trim();
    const opensObject = /{\s*$/.test(trimmed);
    const opensArray = /\[\s*$/.test(trimmed);
    const opensContainer = opensObject || opensArray;
    const closesContainer = /^[}\]]/.test(trimmed);

    // 1) Close first (a closing line never carries a new key)
    if (closesContainer) {
      const frame = containerStack.pop();
      if (frame) {
        for (let i = 0; i < frame.pushed; i++) pathStack.pop();
      }
    }

    const parent = containerStack[containerStack.length - 1];
    const keyMatch = /^"([^"]+)"\s*:/.exec(trimmed);
    let description: string | undefined;

    if (keyMatch && !isArrayLike(parent)) {
      // Normal object property — look up description and possibly open container
      const key = keyMatch[1];
      const currentPath = [...pathStack, key].join('.').replace(/\.\[/g, '[');
      description = descMap.get(currentPath) ?? descMap.get(`${currentPath}[*]`);

      if (opensContainer) {
        pathStack.push(key);
        if (opensArray) {
          pathStack.push('[*]');
          containerStack.push({ kind: 'array', pushed: 2 });
        } else {
          containerStack.push({ kind: 'object', pushed: 1 });
        }
      }
    } else if (opensContainer) {
      // Opening brace/bracket with no key on the same line
      if (isArrayLike(parent)) {
        containerStack.push({ kind: 'array-elem', pushed: 0 });
      } else if (containerStack.length === 0) {
        if (opensArray) {
          pathStack.push('[*]');
          containerStack.push({ kind: 'top-array', pushed: 1 });
        } else {
          containerStack.push({ kind: 'top-object', pushed: 0 });
        }
      } else {
        // Defensive fallback (shouldn't happen with well-formed JSON)
        containerStack.push({ kind: 'array-elem', pushed: 0 });
      }
    }

    result.push({ code: line, description });
  }

  return result;
}
