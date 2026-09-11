import type { Oas32SequentialKind, Oas32SequentialRecord } from './oas32SequentialMedia';
import type {
  Oas32SequentialConsumeResult,
  Oas32SequentialItemView,
  Oas32SequentialSchemaStatus,
  Oas32SequentialTermination,
} from './oas32SequentialResponse';

export interface Oas32SequentialDisplayedItem {
  readonly index: number;
  readonly timestamp: number;
  readonly complete: boolean;
  readonly preview: string;
  readonly itemSchema: Oas32SequentialSchemaStatus;
  readonly diagnostics: readonly string[];
}

export interface Oas32SequentialStreamView {
  readonly kind: Oas32SequentialKind | 'unknown';
  readonly streaming: boolean;
  readonly termination?: Oas32SequentialTermination;
  readonly truncated: boolean;
  readonly receivedBytes: number;
  readonly droppedItems: number;
  readonly completeSchema: Oas32SequentialSchemaStatus;
  readonly items: readonly Oas32SequentialDisplayedItem[];
}

export function sequentialRecordPreview(record: Oas32SequentialRecord): string {
  const { value } = record;
  if (value.kind === 'sse') {
    const fields = [`event: ${value.event.event}`, `data: ${value.event.data}`];
    if (value.event.id !== undefined) fields.push(`id: ${value.event.id}`);
    if (value.event.retry !== undefined) fields.push(`retry: ${value.event.retry}`);
    return fields.join('\n');
  }
  if (value.kind === 'json') {
    try {
      return JSON.stringify(value.json);
    } catch {
      return value.raw;
    }
  }
  if (value.kind === 'multipart') {
    const headers = Object.entries(value.part.headers)
      .map(([name, header]) => `${name}: ${header}`)
      .join('\n');
    const body = value.part.text ?? `<${value.part.body.byteLength} bytes>`;
    return headers ? `${headers}\n\n${body}` : body;
  }
  return `<${value.bytes.byteLength} bytes>`;
}

export function toSequentialDisplayedItem(
  item: Oas32SequentialItemView,
  timestamp = Date.now(),
): Oas32SequentialDisplayedItem {
  return {
    index: item.record.index,
    timestamp,
    complete: item.record.complete,
    preview: sequentialRecordPreview(item.record),
    itemSchema: item.itemSchema,
    diagnostics: item.record.diagnostics.map((diagnostic) => diagnostic.code),
  };
}

export function sequentialStreamFromConsumeResult(
  result: Oas32SequentialConsumeResult,
  previous?: Oas32SequentialStreamView,
): Oas32SequentialStreamView {
  const previousByIndex = new Map((previous?.items ?? []).map((item) => [item.index, item]));
  return {
    kind: result.kind,
    streaming: false,
    termination: result.termination,
    truncated: result.truncated,
    receivedBytes: result.receivedBytes,
    droppedItems: result.droppedItems,
    completeSchema: result.completeSchema,
    items: result.items.map((item) => {
      const existing = previousByIndex.get(item.record.index);
      return existing ?? toSequentialDisplayedItem(item);
    }),
  };
}

export function formatSequentialHistoryBody(items: readonly Oas32SequentialDisplayedItem[]): string {
  if (items.length === 0) return '';
  return items
    .map((item) => {
      const time = Number.isFinite(item.timestamp) ? ` ${new Date(item.timestamp).toISOString()}` : '';
      return `#${item.index + 1}${time}\n${item.preview}`;
    })
    .join('\n\n');
}
