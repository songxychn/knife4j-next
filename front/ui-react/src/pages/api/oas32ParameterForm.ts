import {
  assertOas32BrowserRequest,
  Oas32ParameterRequestError,
  replaceOas32PathParameters,
  serializeOas32Parameters,
  type BuiltRequest,
  type Oas32Parameter,
  type Oas32ParameterCollection,
  type Oas32ParameterDiagnostic,
  type Oas32ParameterInput,
  type SerializedExampleParameter,
} from 'knife4j-core';
import type { SchemaDocumentSession } from '../../schema/schemaDocumentSession';
import {
  collectOas32ParameterInputs,
  readOas32ParameterEntries,
  type Oas32ParameterEntries,
  type Oas32ParameterEntry,
} from '../../schema/oas32ParameterAdapter';
import type { CookieParameterSource } from './cookieParameterSource';
import { readExampleParameterInputs } from './debugCache';

const own = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export function oas32QuerystringParameter(
  collection: Oas32ParameterCollection | undefined,
): Oas32Parameter | undefined {
  return collection?.parameters.find((parameter) => parameter.in === 'querystring');
}

export function oas32QuerystringMediaType(parameter: Oas32Parameter | undefined): string | undefined {
  return parameter?.serialization?.kind === 'content' ? parameter.serialization.mediaType : undefined;
}

export function oas32EntriesFromSerializedExamples(value: unknown): Oas32ParameterEntries {
  const result = emptyRecord<Oas32ParameterEntry>();
  for (const [key, input] of Object.entries(readExampleParameterInputs(value))) {
    result[key] = { kind: input.layer, text: input.text, enabled: true };
  }
  return result;
}

export function restoreOas32ParameterEntries(entries: unknown, serializedExamples: unknown): Oas32ParameterEntries {
  const restored = emptyRecord<Oas32ParameterEntry>();
  Object.assign(restored, oas32EntriesFromSerializedExamples(serializedExamples));
  Object.assign(restored, readOas32ParameterEntries(entries));
  return restored;
}

export function editableOas32ParameterEntries(entries: Oas32ParameterEntries): Oas32ParameterEntries {
  return readOas32ParameterEntries(entries);
}

export function serializedExampleParametersFromEntries(
  entries: Oas32ParameterEntries,
): Record<string, SerializedExampleParameter> {
  const result = emptyRecord<SerializedExampleParameter>();
  for (const [key, entry] of Object.entries(entries)) {
    if (entry.kind === 'parameter' || entry.kind === 'media') result[key] = { text: entry.text, layer: entry.kind };
  }
  return result;
}

export function serializedExampleParameterForKey(
  entries: Oas32ParameterEntries,
  key: string,
): SerializedExampleParameter | undefined {
  const entry = own(entries, key) ? entries[key] : undefined;
  if (!entry || (entry.kind !== 'parameter' && entry.kind !== 'media')) return undefined;
  return { text: entry.text, layer: entry.kind };
}

/** Merge table values into codec entries without inventing a querystring row. */
export function resolveOas32ParameterEntries(
  collection: Oas32ParameterCollection,
  entries: Oas32ParameterEntries,
  paramValues: Readonly<Record<string, string>>,
  paramEnabled: Readonly<Record<string, boolean>>,
): Oas32ParameterEntries {
  const next = emptyRecord<Oas32ParameterEntry>();
  for (const parameter of collection.parameters) {
    const existing = own(entries, parameter.key) ? entries[parameter.key] : undefined;
    if (parameter.in === 'querystring') {
      if (existing) next[parameter.key] = existing;
      continue;
    }
    const enabled = paramEnabled[parameter.key] !== false;
    if (existing) {
      next[parameter.key] = { ...existing, enabled: existing.enabled && enabled };
      continue;
    }
    if (!enabled) continue;
    next[parameter.key] = { kind: 'editor', text: paramValues[parameter.key] ?? '', enabled: true };
  }
  return next;
}

export function collectResolvedOas32ParameterInputs(
  collection: Oas32ParameterCollection,
  entries: Oas32ParameterEntries,
  paramValues: Readonly<Record<string, string>>,
  paramEnabled: Readonly<Record<string, boolean>>,
  cookieSource: CookieParameterSource,
  revision: number,
  session?: SchemaDocumentSession,
): Readonly<Record<string, Oas32ParameterInput>> {
  return collectOas32ParameterInputs(
    collection,
    resolveOas32ParameterEntries(collection, entries, paramValues, paramEnabled),
    cookieSource,
    revision,
    session,
  );
}

export function previewOas32DisplayPath(
  path: string,
  collection: Oas32ParameterCollection,
  entries: Oas32ParameterEntries,
  paramValues: Readonly<Record<string, string>>,
  paramEnabled: Readonly<Record<string, boolean>>,
  cookieSource: CookieParameterSource,
  revision: number,
): string {
  try {
    const plan = serializeOas32Parameters(
      collection,
      collectResolvedOas32ParameterInputs(collection, entries, paramValues, paramEnabled, cookieSource, revision),
    );
    return replaceOas32PathParameters(path, plan.path);
  } catch {
    return path;
  }
}

export function oas32BrowserSendDiagnostics(built: BuiltRequest): readonly Oas32ParameterDiagnostic[] {
  try {
    assertOas32BrowserRequest(built);
    return [];
  } catch (error) {
    if (error instanceof Oas32ParameterRequestError) return error.diagnostics;
    throw error;
  }
}

export function oas32DiagnosticMessages(diagnostics: readonly Oas32ParameterDiagnostic[]): string {
  return diagnostics.map((diagnostic) => diagnostic.message).join('\n');
}

export function oas32PreviewDiagnostics(built: BuiltRequest): readonly Oas32ParameterDiagnostic[] {
  return built.oas32ParameterPlan?.diagnostics ?? [];
}
