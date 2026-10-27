import type { JsonValue } from 'knife4j-schema-engine';
import type { SchemaDocumentSession } from './schemaDocumentSession';
import type { SchemaExampleSource } from './schemaExampleGeneration';

export interface SelectedAuthoredExample {
  readonly source: Exclude<SchemaExampleSource, 'generated'>;
  readonly value: JsonValue;
}

const listeners = new WeakMap<SchemaDocumentSession, (value: SelectedAuthoredExample) => void>();

/** Only the selected root author value is reported, before potentially non-interruptible validation. */
export function observeSelectedAuthoredExample(
  session: SchemaDocumentSession,
  listener: (value: SelectedAuthoredExample) => void,
): () => void {
  listeners.set(session, listener);
  return () => listeners.delete(session);
}

export function notifySelectedAuthoredExample(session: SchemaDocumentSession, value: SelectedAuthoredExample): void {
  listeners.get(session)?.({ source: value.source, value: value.value });
}
