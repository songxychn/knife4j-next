import type { SchemaFieldNode } from './debug/types';
import type {
  ExportDocumentSource,
  ExportDocument,
  ExportOperation,
  ExportSchema,
  ExportSchemaField,
  ExportTag,
} from './exportDocument';

export type OfflineDocumentIssueSeverity = 'info' | 'warning';

export interface OfflineDocumentIssue {
  readonly code: string;
  readonly severity: OfflineDocumentIssueSeverity;
  readonly operation?: string;
  readonly region?: string;
  readonly keyword?: string;
}

export interface OfflineDocumentSnapshot {
  readonly document: ExportDocument;
  readonly complete: boolean;
  readonly issues: readonly OfflineDocumentIssue[];
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  Reflect.ownKeys(object).forEach((key) => {
    deepFreeze((object as Record<PropertyKey, unknown>)[key], seen);
  });
  return Object.freeze(value);
}

export function createOfflineDocumentSnapshot(
  document: ExportDocument,
  issues: readonly OfflineDocumentIssue[] = [],
): OfflineDocumentSnapshot {
  const snapshot: OfflineDocumentSnapshot = {
    document,
    complete: issues.every((issue) => issue.severity === 'info'),
    issues: issues.map((issue) => ({ ...issue })),
  };
  return deepFreeze(snapshot);
}

export function incompleteOfflineDocumentIssues(snapshot: OfflineDocumentSnapshot): readonly OfflineDocumentIssue[] {
  return snapshot.issues.filter((issue) => issue.severity !== 'info');
}

const DEFAULT_MAX_OPERATIONS = 500;
const DEFAULT_MAX_PROJECTED_FIELDS = 20_000;
const DEFAULT_MAX_DIAGNOSTICS = 200;
const PROJECTION_CONCURRENCY = 4;

export interface RegisteredExportLimits {
  readonly maxOperations?: number;
  readonly maxProjectedFields?: number;
  readonly maxDiagnostics?: number;
}

export type ExportBudgetDimension = 'operations' | 'projected-fields';

type ExportBudgetErrorConstructor = new (dimension: ExportBudgetDimension, limit: number, actual: number) => Error;
type SchemaTypeLabel = (node: SchemaFieldNode) => string;
type ExportSchemaExtras = Pick<
  ExportSchema,
  'role' | 'sequentialKind' | 'encodings' | 'xml' | 'discriminator' | 'notes'
>;

interface ExportSchemaProjectionOptions {
  readonly typeLabel: SchemaTypeLabel;
  readonly includeXml?: boolean;
  readonly extras?: ExportSchemaExtras;
}

interface EffectiveLimits {
  readonly maxOperations: number;
  readonly maxProjectedFields: number;
  readonly maxDiagnostics: number;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(1, Math.floor(value));
}

export function effectiveExportLimits(limits: RegisteredExportLimits | undefined): EffectiveLimits {
  return {
    maxOperations: positiveInteger(limits?.maxOperations, DEFAULT_MAX_OPERATIONS),
    maxProjectedFields: positiveInteger(limits?.maxProjectedFields, DEFAULT_MAX_PROJECTED_FIELDS),
    maxDiagnostics: positiveInteger(limits?.maxDiagnostics, DEFAULT_MAX_DIAGNOSTICS),
  };
}

export function throwIfExportAborted(signal: AbortSignal | undefined, family: '3.1' | '3.2'): void {
  if (!signal?.aborted) return;
  const error = new Error(`OAS ${family} offline export snapshot was aborted.`);
  error.name = 'AbortError';
  throw error;
}

export function isExportAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function exportDiagnosticCode(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
  return fallback;
}

export class ExportIssueCollector {
  private readonly collected: OfflineDocumentIssue[] = [];
  private overflow = false;

  public constructor(
    private readonly limit: number,
    initial: readonly OfflineDocumentIssue[],
  ) {
    initial.forEach((issue) => this.add(issue));
  }

  public add(issue: OfflineDocumentIssue): void {
    const contentLimit = Math.max(0, this.limit - 1);
    if (this.collected.length < contentLimit) {
      this.collected.push(issue);
      return;
    }
    this.overflow = true;
  }

  public result(): OfflineDocumentIssue[] {
    if (!this.overflow) return [...this.collected];
    return [
      ...this.collected,
      {
        code: 'DIAGNOSTIC_BUDGET_EXCEEDED',
        severity: 'warning',
      },
    ];
  }
}

export class ProjectedFieldBudget {
  private count = 0;

  public constructor(
    private readonly limit: number,
    private readonly BudgetError: ExportBudgetErrorConstructor,
  ) {}

  public add(fields: number): void {
    this.count += fields;
    if (this.count > this.limit) {
      throw new this.BudgetError('projected-fields', this.limit, this.count);
    }
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (values.length === 0) return [];
  const results = new Array<R>(values.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

export function compactTypeDisplay(typeDisplay: string): string {
  return typeDisplay.replace(/ \/ /g, '/').replace(/ \| /g, '|') || '-';
}

function descriptionForNode(node: SchemaFieldNode): string {
  const descriptions = [node.description];
  if (node.refDescription && node.refDescription !== node.description) {
    descriptions.push(`${node.refTitle ? `[${node.refTitle}] ` : ''}${node.refDescription}`);
  }
  return descriptions.filter((value): value is string => Boolean(value)).join('\n');
}

function fieldPath(parent: string, node: SchemaFieldNode, typeLabel: SchemaTypeLabel): string {
  if (!node.name) return parent || node.refName || typeLabel(node) || '$';
  if (node.name === 'items') return parent ? `${parent}[]` : '[]';
  if (/^\[\d+\]$/.test(node.name)) return `${parent}${node.name}`;
  return parent ? `${parent}.${node.name}` : node.name;
}

function flattenProjectedFields(
  fields: readonly SchemaFieldNode[],
  recursive: boolean,
  options: ExportSchemaProjectionOptions,
  parent = '',
  depth = 0,
): ExportSchemaField[] {
  const rows: ExportSchemaField[] = [];
  for (const field of fields) {
    const path = fieldPath(parent, field, options.typeLabel);
    rows.push({
      fieldPath: path,
      typeDisplay: options.typeLabel(field),
      required: field.required,
      description: descriptionForNode(field),
      truncated: Boolean(field.truncated),
      ...(field.truncationReason === undefined ? {} : { truncationReason: field.truncationReason }),
      depth,
      ...(options.includeXml && field.xml !== undefined ? { xml: field.xml } : {}),
    });
    if (recursive && field.children?.length) {
      rows.push(...flattenProjectedFields(field.children, true, options, path, depth + 1));
    }
  }
  return rows;
}

function exportProjectionFields(
  fields: readonly SchemaFieldNode[],
  recursive: boolean,
  options: ExportSchemaProjectionOptions,
): ExportSchemaField[] {
  if (fields.length !== 1 || fields[0].name) return flattenProjectedFields(fields, recursive, options);
  const root = fields[0];
  if (!root.children?.length) return [];
  return flattenProjectedFields(root.children, recursive, options);
}

function projectionKind(root: SchemaFieldNode): ExportSchema['kind'] {
  if (root.type === 'array') return 'array';
  if (root.type === 'object' || root.children?.length) return 'object';
  if (['string', 'integer', 'number', 'boolean', 'null', 'never'].includes(root.type)) return 'primitive';
  return 'unknown';
}

export function exportSchemaFromProjection(
  mediaType: string,
  root: SchemaFieldNode,
  fields: readonly SchemaFieldNode[],
  options: ExportSchemaProjectionOptions,
): ExportSchema {
  return {
    mediaType,
    typeDisplay: options.typeLabel(root),
    kind: projectionKind(root),
    shallowFields: exportProjectionFields(fields, false, options),
    fields: exportProjectionFields(fields, true, options),
    ...options.extras,
  };
}

export function recordExportProjectionIssues(
  issues: ExportIssueCollector,
  diagnostics: readonly Pick<OfflineDocumentIssue, 'code' | 'severity' | 'keyword'>[],
  operation: string,
  region: string,
): void {
  diagnostics.forEach((diagnostic) => {
    issues.add({
      code: diagnostic.code,
      severity: diagnostic.severity,
      operation,
      region,
      ...(diagnostic.keyword === undefined ? {} : { keyword: diagnostic.keyword }),
    });
  });
}

export function exportParameterKey(parameter: { readonly in: string; readonly name: string }): string {
  return `${parameter.in}:${parameter.name}`;
}

type ExportOperationGroup<T> = { readonly operations: readonly T[] };

interface IndexedOperation<T> {
  readonly tagIndex: number;
  readonly operationIndex: number;
  readonly operation: T;
}

export function collectRegisteredExportOperations<T>(
  tags: readonly ExportOperationGroup<T>[],
  limit: number,
  BudgetError: ExportBudgetErrorConstructor,
): IndexedOperation<T>[] {
  const flattened = tags.flatMap((tag, tagIndex) =>
    tag.operations.map((operation, operationIndex) => ({ tagIndex, operationIndex, operation })),
  );
  if (flattened.length > limit) throw new BudgetError('operations', limit, flattened.length);
  return flattened;
}

export function projectRegisteredExportOperations<T>(
  operations: readonly IndexedOperation<T>[],
  project: (operation: T, numberPath: readonly number[]) => Promise<ExportOperation>,
): Promise<ExportOperation[]> {
  return mapWithConcurrency(operations, PROJECTION_CONCURRENCY, ({ operation, tagIndex, operationIndex }) =>
    project(operation, [tagIndex + 1, operationIndex + 1]),
  );
}

export function assembleRegisteredExportTags<T extends ExportOperationGroup<unknown>>(
  tags: readonly T[],
  sourceOperations: readonly IndexedOperation<unknown>[],
  operations: readonly ExportOperation[],
  metadata: (tag: T) => Omit<ExportTag, 'numberPath' | 'operations'>,
): ExportTag[] {
  const operationsByTag: ExportOperation[][] = [];
  for (const [index, { tagIndex, operationIndex }] of sourceOperations.entries()) {
    (operationsByTag[tagIndex] ??= [])[operationIndex] = operations[index];
  }
  return tags.map((tag, tagIndex) => {
    const projected = operationsByTag[tagIndex] ?? [];
    return {
      ...metadata(tag),
      numberPath: [tagIndex + 1],
      operations: tag.operations.map((_, index) => projected[index]),
    };
  });
}

export function registeredExportDocumentInfo(
  info: ExportDocumentSource['info'],
  fallbackTitle?: string,
): Pick<ExportDocument, 'title' | 'version' | 'description'> {
  return {
    title: info.title || fallbackTitle || 'API Documentation',
    version: info.version ?? '',
    description: info.description ?? '',
  };
}
