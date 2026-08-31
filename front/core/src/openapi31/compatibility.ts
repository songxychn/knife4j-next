import { escapeJsonPointerSegment, isOpenApi31Version, parseLocalJsonPointer } from './document';

export type Oas31CompatibilityDiagnosticCode =
  'unsupported-dialect' | 'external-ref' | 'anchor-ref' | 'dynamic-ref' | 'schema-base';

export interface Oas31CompatibilityDiagnostic {
  code: Oas31CompatibilityDiagnosticCode;
  /** RFC 6901 pointer to the keyword that requires degraded handling. */
  path: string;
  reason: string;
  value?: string;
}

const SUPPORTED_SCHEMA_DIALECT =
  /^(?:https:\/\/spec\.openapis\.org\/oas\/3\.1\/dialect\/base|https:\/\/json-schema\.org\/draft\/2020-12\/schema)#?$/;
const LITERAL_FIELDS = new Set(['example', 'default', 'const', 'enum', 'value']);
const SINGLE_SCHEMA_KEYWORDS = new Set([
  'additionalItems',
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
]);
const ARRAY_SCHEMA_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const MAP_SCHEMA_KEYWORDS = new Set(['$defs', 'definitions', 'dependentSchemas', 'patternProperties', 'properties']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Keep diagnostic values useful without echoing URL credentials or query values. */
function safeDiagnosticValue(value: string): string {
  const urlLike = /^(?:[A-Za-z][A-Za-z0-9+.-]*:|[\\/]{2})/.test(value);
  if (urlLike) {
    try {
      const normalized = /^https?:/i.test(value) ? value.replace(/\\/g, '/') : value;
      const networkRelative = /^[\\/]{2}/.test(normalized);
      const parsed = networkRelative ? new URL(normalized, 'https://diagnostic.invalid/') : new URL(normalized);
      parsed.username = '';
      parsed.password = '';
      const hadQuery = parsed.search.length > 0;
      parsed.search = '';
      let safeValue = parsed.href;
      if (networkRelative) safeValue = safeValue.replace(/^https:/, '');
      if (hadQuery) {
        const fragmentIndex = safeValue.indexOf('#');
        safeValue =
          fragmentIndex < 0
            ? `${safeValue}?…`
            : `${safeValue.slice(0, fragmentIndex)}?…${safeValue.slice(fragmentIndex)}`;
      }
      return safeValue.slice(0, 512);
    } catch {
      // Fall through to bounded lexical redaction for malformed URI text.
    }
  }
  const withoutCredentials = value.replace(/^((?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/)[^/@?#\s]+@/, '$1');
  const fragmentIndex = withoutCredentials.indexOf('#');
  const queryIndex = withoutCredentials.indexOf('?');
  if (queryIndex < 0 || (fragmentIndex >= 0 && queryIndex > fragmentIndex)) {
    return withoutCredentials.slice(0, 512);
  }
  const fragment = fragmentIndex >= 0 ? withoutCredentials.slice(fragmentIndex) : '';
  return `${withoutCredentials.slice(0, queryIndex)}?…${fragment}`.slice(0, 512);
}

/**
 * Find OAS 3.1 features that the local deterministic resolver cannot apply
 * safely. Schema traversal follows only standard subschema-bearing keywords;
 * arbitrary vocabulary payloads and extension/example data remain opaque.
 */
export function collectOas31CompatibilityDiagnostics(
  document: Record<string, unknown>,
  maxNodes = 20_000,
): Oas31CompatibilityDiagnostic[] {
  if (!isOpenApi31Version(document.openapi)) return [];

  const diagnostics: Oas31CompatibilityDiagnostic[] = [];
  const identities = new Set<string>();
  let visited = 0;

  const add = (code: Oas31CompatibilityDiagnosticCode, path: string, reason: string, value?: string) => {
    const safeValue = value === undefined ? undefined : safeDiagnosticValue(value);
    const identity = `${code}:${path}:${safeValue ?? ''}`;
    if (identities.has(identity)) return;
    identities.add(identity);
    diagnostics.push({ code, path, reason, value: safeValue });
  };

  const inspectRef = (ref: string, path: string) => {
    if (!ref.startsWith('#')) {
      add('external-ref', path, '当前只安全解析同一 OpenAPI 文档内的引用', ref);
    } else if (!parseLocalJsonPointer(ref).valid) {
      add('anchor-ref', path, '当前不解析锚点形式的引用', ref);
    }
  };

  const walkSchema = (value: unknown, path: string): void => {
    if (++visited > maxNodes || !isRecord(value)) return;
    const schema = value;

    if (typeof schema.$ref === 'string') inspectRef(schema.$ref, `${path}/$ref`);
    if (typeof schema.$dynamicRef === 'string') {
      add('dynamic-ref', `${path}/$dynamicRef`, '当前不执行 JSON Schema 动态引用解析', schema.$dynamicRef);
    }
    for (const keyword of ['$id', '$anchor', '$dynamicAnchor'] as const) {
      const keywordValue = schema[keyword];
      if (typeof keywordValue === 'string') {
        add('schema-base', `${path}/${keyword}`, '当前不重设嵌套 Schema 的解析基址或锚点', keywordValue);
      }
    }
    if (typeof schema.$schema === 'string' && !SUPPORTED_SCHEMA_DIALECT.test(schema.$schema)) {
      add('unsupported-dialect', `${path}/$schema`, '当前 Schema 投影只支持 OAS 3.1 基础方言', schema.$schema);
    }

    for (const [key, child] of Object.entries(schema)) {
      const childPath = `${path}/${escapeJsonPointerSegment(key)}`;
      if (SINGLE_SCHEMA_KEYWORDS.has(key)) {
        if (typeof child !== 'boolean') walkSchema(child, childPath);
      } else if (ARRAY_SCHEMA_KEYWORDS.has(key) && Array.isArray(child)) {
        child.forEach((item, index) => {
          if (typeof item !== 'boolean') walkSchema(item, `${childPath}/${index}`);
        });
      } else if (MAP_SCHEMA_KEYWORDS.has(key) && isRecord(child)) {
        Object.entries(child).forEach(([name, item]) => {
          if (typeof item !== 'boolean') walkSchema(item, `${childPath}/${escapeJsonPointerSegment(name)}`);
        });
      }
    }
  };

  const walkOpenApi = (value: unknown, path: string): void => {
    if (++visited > maxNodes || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walkOpenApi(item, `${path}/${index}`));
      return;
    }

    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      const childPath = `${path}/${escapeJsonPointerSegment(key)}`;
      if (key.startsWith('x-') || LITERAL_FIELDS.has(key)) continue;

      if (key === '$ref' && typeof child === 'string') {
        inspectRef(child, childPath);
        continue;
      }
      if (key === 'schema') {
        if (typeof child !== 'boolean') walkSchema(child, childPath);
        continue;
      }
      if (path === '#/components' && key === 'schemas' && isRecord(child)) {
        Object.entries(child).forEach(([name, schema]) => {
          if (typeof schema !== 'boolean') walkSchema(schema, `${childPath}/${escapeJsonPointerSegment(name)}`);
        });
        continue;
      }
      // In a Schema Object this field is literal data; outside Schema Objects
      // an examples map can still contain Reference Objects and is traversed.
      if (key === 'examples' && Array.isArray(child)) continue;
      walkOpenApi(child, childPath);
    }
  };

  if (typeof document.jsonSchemaDialect === 'string' && !SUPPORTED_SCHEMA_DIALECT.test(document.jsonSchemaDialect)) {
    add(
      'unsupported-dialect',
      '#/jsonSchemaDialect',
      '当前 Schema 投影只支持 OAS 3.1 基础方言',
      document.jsonSchemaDialect,
    );
  }

  walkOpenApi(document, '#');
  return diagnostics;
}
