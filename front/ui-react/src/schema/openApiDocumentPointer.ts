import type { SwaggerDoc } from '../types/swagger';

export type OpenApiRecord = Record<string, unknown>;

export interface LocatedRecord {
  readonly value: OpenApiRecord;
  readonly tokens: readonly string[];
}

export function asOpenApiRecord(value: unknown): OpenApiRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as OpenApiRecord) : null;
}

function decodePointerToken(value: string): string {
  return value.replace(/~1/g, '/').replace(/~0/g, '~');
}

function encodePointerToken(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function localPointerTokens(reference: string): string[] | null {
  if (!reference.startsWith('#')) return null;
  let pointer: string;
  try {
    pointer = decodeURIComponent(reference.slice(1));
  } catch {
    return null;
  }
  if (!pointer.startsWith('/')) return null;
  return pointer.slice(1).split('/').map(decodePointerToken);
}

function valueAtPointer(document: SwaggerDoc, tokens: readonly string[]): unknown {
  let current: unknown = document;
  for (const token of tokens) {
    const record = asOpenApiRecord(current);
    if (!record || !Object.prototype.hasOwnProperty.call(record, token)) return undefined;
    current = record[token];
  }
  return current;
}

export function followLocalReference(
  document: SwaggerDoc,
  initialValue: unknown,
  initialTokens: readonly string[],
): LocatedRecord | null {
  let value = asOpenApiRecord(initialValue);
  let tokens = [...initialTokens];
  const seen = new Set<string>();

  for (let depth = 0; value && typeof value.$ref === 'string' && depth < 10; depth++) {
    if (seen.has(value.$ref)) return null;
    seen.add(value.$ref);
    const targetTokens = localPointerTokens(value.$ref);
    if (!targetTokens) return null;
    value = asOpenApiRecord(valueAtPointer(document, targetTokens));
    tokens = targetTokens;
  }

  if (!value || typeof value.$ref === 'string') return null;
  return { value, tokens };
}

export function pointerReference(tokens: readonly string[]): string {
  return `#/${tokens.map((token) => encodeURIComponent(encodePointerToken(token))).join('/')}`;
}
