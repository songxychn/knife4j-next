import { resolvePathItemObject } from 'knife4j-core';
import type { MenuOperation, SwaggerDoc } from '../types/swagger';

export type OpenApiRecord = Record<string, unknown>;

export interface LocatedRecord {
  readonly value: OpenApiRecord;
  readonly tokens: readonly string[];
}

export interface LocatedValue {
  readonly value: unknown;
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

  for (let depth = 0; value && typeof value.$ref === 'string' && depth < 12; depth++) {
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

function locatedPathItemChain(document: SwaggerDoc, operation: MenuOperation): LocatedRecord[] | null {
  const source = operation.source === 'webhook' ? 'webhooks' : 'paths';
  const sourceItems = source === 'webhooks' ? document.webhooks : document.paths;
  const initial = asOpenApiRecord(sourceItems?.[operation.path]);
  if (!initial) return null;
  if (resolvePathItemObject(initial, document as unknown as Record<string, unknown>).status !== 'resolved') {
    return null;
  }

  const chain: LocatedRecord[] = [];
  const seen = new Set<string>();
  let value: OpenApiRecord | null = initial;
  let tokens = [source, operation.path];
  for (let depth = 0; value && depth <= 20; depth += 1) {
    chain.push({ value, tokens });
    if (typeof value.$ref !== 'string') return chain;
    if (seen.has(value.$ref)) return null;
    seen.add(value.$ref);
    const targetTokens = localPointerTokens(value.$ref);
    if (!targetTokens) return null;
    value = asOpenApiRecord(valueAtPointer(document, targetTokens));
    tokens = targetTokens;
  }
  return null;
}

/**
 * Locate the exact raw member that participates in a resolved Path Item.
 * Non-conflicting `$ref` siblings may live at either the reference site or
 * its target, so following only the `$ref` target would lose valid members.
 */
export function locatePathItemMember(
  document: SwaggerDoc,
  operation: MenuOperation,
  member: string,
): LocatedValue | null {
  const matches = (locatedPathItemChain(document, operation) ?? []).filter(({ value }) =>
    Object.prototype.hasOwnProperty.call(value, member),
  );
  if (matches.length !== 1) return null;
  return { value: matches[0].value[member], tokens: [...matches[0].tokens, member] };
}

export function locateOperationRecord(document: SwaggerDoc, operation: MenuOperation): LocatedRecord | null {
  const method = operation.method.toLowerCase();
  const located = locatePathItemMember(document, operation, method);
  const value = asOpenApiRecord(located?.value);
  return value && located ? { value, tokens: located.tokens } : null;
}
