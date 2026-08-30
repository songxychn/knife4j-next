export type Oas31CompatibilityDiagnosticCode =
  'unsupported-dialect' | 'external-ref' | 'anchor-ref' | 'dynamic-ref' | 'schema-base';

export interface Oas31CompatibilityDiagnostic {
  code: Oas31CompatibilityDiagnosticCode;
  /** RFC 6901 pointer to the keyword that requires degraded handling. */
  path: string;
  value?: string;
}

const OAS_BASE_DIALECT = /^https:\/\/spec\.openapis\.org\/oas\/3\.1\/dialect\/base#?$/;

function pointerSegment(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Find OAS 3.1 features that the local deterministic resolver cannot apply
 * safely. The raw document remains usable; callers can explain that generated
 * field trees, examples, and debug models may omit these portions.
 */
export function collectOas31CompatibilityDiagnostics(
  document: Record<string, unknown>,
  maxNodes = 20_000,
): Oas31CompatibilityDiagnostic[] {
  if (typeof document.openapi !== 'string' || !/^3\.1(?:\.|$)/.test(document.openapi)) return [];

  const diagnostics: Oas31CompatibilityDiagnostic[] = [];
  const seen = new Set<string>();
  let visited = 0;

  const add = (code: Oas31CompatibilityDiagnosticCode, path: string, value?: string) => {
    const identity = `${code}:${path}:${value ?? ''}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    diagnostics.push({ code, path, value });
  };

  if (typeof document.jsonSchemaDialect === 'string' && !OAS_BASE_DIALECT.test(document.jsonSchemaDialect)) {
    add('unsupported-dialect', '#/jsonSchemaDialect', document.jsonSchemaDialect);
  }

  const walk = (value: unknown, path: string): void => {
    if (++visited > maxNodes || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}/${index}`));
      return;
    }

    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      const childPath = `${path}/${pointerSegment(key)}`;
      // These fields carry literal instance data, not OpenAPI/JSON Schema
      // structure. A payload is allowed to contain keys such as `$ref` or
      // `$id` without changing document resolution semantics.
      if (
        key === 'example' ||
        key === 'default' ||
        key === 'const' ||
        key === 'enum' ||
        key === 'value' ||
        key.startsWith('x-') ||
        (key === 'examples' && Array.isArray(child))
      ) {
        continue;
      }
      if (key === '$ref' && typeof child === 'string') {
        if (!child.startsWith('#')) add('external-ref', childPath, child);
        else if (!child.startsWith('#/')) add('anchor-ref', childPath, child);
      } else if (key === '$dynamicRef' && typeof child === 'string') {
        add('dynamic-ref', childPath, child);
      } else if (['$id', '$anchor', '$dynamicAnchor'].includes(key) && typeof child === 'string') {
        add('schema-base', childPath, child);
      } else if (key === '$schema' && typeof child === 'string' && !OAS_BASE_DIALECT.test(child)) {
        add('unsupported-dialect', childPath, child);
      }
      walk(child, childPath);
    }
  };

  walk(document, '#');
  return diagnostics;
}
