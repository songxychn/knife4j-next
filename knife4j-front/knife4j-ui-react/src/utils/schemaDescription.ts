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
import type { SchemaObject, SwaggerDoc } from '../types/swagger';

/** Resolve a `$ref` string against the doc's component/definition registry. */
function resolveRef(ref: string, doc: Pick<SwaggerDoc, 'components' | 'definitions'>): SchemaObject | undefined {
  const match = ref.match(/^#\/components\/schemas\/(.+)$/) ?? ref.match(/^#\/definitions\/(.+)$/);
  if (!match) return undefined;
  return (doc.components?.schemas ?? doc.definitions ?? {})[match[1]];
}

/** Resolve a schema, following at most 10 levels of `$ref`. */
function resolveSchema(
  schema: SchemaObject | undefined,
  doc: Pick<SwaggerDoc, 'components' | 'definitions'>,
  depth = 0,
): SchemaObject | undefined {
  if (!schema || depth > 10) return schema;
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, doc);
    return resolveSchema(resolved, doc, depth + 1);
  }
  return schema;
}

/**
 * Build a flat map of `path → description` from a response schema.
 *
 * @param schema  The top-level response schema (may be a `$ref`).
 * @param doc     The full SwaggerDoc for ref resolution.
 * @returns       e.g. `{ "data": "响应数据", "data.name": "用户名", "items[*].id": "ID" }`
 */
export function buildSchemaDescriptionMap(
  schema: SchemaObject | undefined,
  doc: Pick<SwaggerDoc, 'components' | 'definitions'>,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!schema) return map;

  const resolved = resolveSchema(schema, doc);
  if (!resolved) return map;

  walk(resolved, '', doc, map);
  return map;
}

function walk(
  schema: SchemaObject,
  prefix: string,
  doc: Pick<SwaggerDoc, 'components' | 'definitions'>,
  map: Map<string, string>,
  depth = 0,
) {
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

}

/**
 * Given a pretty-printed JSON string, return an array of rendered lines
 * with optional description annotations appended.
 *
 * The function walks the text line-by-line, maintaining a path stack so
 * that each JSON key can be mapped to its schema description.
 */
export function annotateJsonWithDescriptions(json: string, descMap: Map<string, string>): string {
  const lines = json.split('\n');
  const pathStack: string[] = [];
  const result: string[] = [];

  for (const line of lines) {
    // Detect opening brace/bracket → push to stack
    const openMatch = line.match(/[{[]\s*$/);
    // Detect closing brace/bracket → pop from stack
    const closeMatch = line.match(/^[ \t]*[}\]]/);

    if (closeMatch) {
      pathStack.pop();
    }

    // Detect a key line:  "fieldName": value
    const keyMatch = line.match(/^(\s*)"([^"]+)"\s*:/);
    let annotation = '';

    if (keyMatch) {
      const key = keyMatch[2];
      const currentPath = [...pathStack, key].join('.');
      const desc = descMap.get(currentPath) ?? descMap.get(`${currentPath}[*]`);
      if (desc) {
        annotation = `  // ${desc}`;
      }

      // If the value is an opening object/array, push this key onto the stack
      if (openMatch) {
        pathStack.push(key);
      }
    } else if (openMatch) {
      // Opening brace/bracket without a key (top-level array)
      pathStack.push('[*]');
    }

    result.push(line + annotation);
  }

  return result.join('\n');
}

