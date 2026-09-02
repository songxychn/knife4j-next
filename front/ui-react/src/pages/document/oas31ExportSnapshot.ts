import {
  buildExportOperation,
  isOpenApi31Version,
  type ExportDocument,
  type ExportExample,
  type ExportOperation,
  type ExportParameter,
  type ExportRequestBody,
  type ExportResponse,
  type ExportSchema,
  type ExportSchemaField,
  type SchemaFieldNode,
} from 'knife4j-core';
import { schemaNodeTypeLabel } from '../../components/schema/schemaUtils';
import {
  createSchemaDisplayProjector,
  type SchemaDisplayProjection,
  type SchemaDisplayProjector,
} from '../../schema/schemaDisplayProjection';
import type { SchemaDocumentSession } from '../../schema/schemaDocumentSession';
import {
  formatSchemaExampleValue,
  generateOperationSchemaExamples,
  locateRequestSchemaExampleTargets,
  locateResponseSchemaExampleTargets,
  type OperationSchemaExampleTarget,
  type SelectedOperationSchemaExample,
} from '../../schema/operationSchemaExamples';
import { locateOperationParameterSchemaTargets } from '../../schema/parameterSchemaValidation';
import { prepareApiDocSchemaFields, type ApiDocSchemaAccessMode } from '../api/apiDocSchemaProjection';
import type { MenuOperation, MenuTag, OperationObject, ParameterObject, SwaggerDoc } from '../../types/swagger';
import {
  createOfflineDocumentSnapshot,
  type OfflineDocumentIssue,
  type OfflineDocumentSnapshot,
} from './offlineDocumentSnapshot';

const DEFAULT_MAX_OPERATIONS = 500;
const DEFAULT_MAX_PROJECTED_FIELDS = 20_000;
const DEFAULT_MAX_DIAGNOSTICS = 200;
const PROJECTION_CONCURRENCY = 4;

export interface Oas31ExportSnapshotLimits {
  readonly maxOperations?: number;
  readonly maxProjectedFields?: number;
  readonly maxDiagnostics?: number;
}

export interface BuildOas31ExportSnapshotOptions {
  readonly fallbackTitle?: string;
  readonly signal?: AbortSignal;
  readonly initialIssues?: readonly OfflineDocumentIssue[];
  readonly limits?: Oas31ExportSnapshotLimits;
}

type ExportBudgetDimension = 'operations' | 'projected-fields';

export class Oas31ExportBudgetError extends Error {
  public readonly code = 'EXPORT_BUDGET_EXCEEDED';

  public constructor(
    public readonly dimension: ExportBudgetDimension,
    public readonly limit: number,
    public readonly actual: number,
  ) {
    super(`OAS 3.1 offline export ${dimension} budget exceeded (${actual} > ${limit}).`);
    this.name = 'Oas31ExportBudgetError';
  }
}

interface EffectiveLimits {
  readonly maxOperations: number;
  readonly maxProjectedFields: number;
  readonly maxDiagnostics: number;
}

interface OperationBuildContext {
  readonly document: SwaggerDoc;
  readonly projector: SchemaDisplayProjector;
  readonly session: SchemaDocumentSession;
  readonly signal?: AbortSignal;
  readonly issues: IssueCollector;
  readonly fields: ProjectedFieldBudget;
}

interface ProjectSchemaOptions {
  readonly reference: string;
  readonly mediaType: string;
  readonly mode: ApiDocSchemaAccessMode;
  readonly operation: MenuOperation;
  readonly operationObject?: OperationObject;
  readonly region: string;
  readonly fallback: () => ExportSchema | undefined;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(1, Math.floor(value));
}

function effectiveLimits(limits: Oas31ExportSnapshotLimits | undefined): EffectiveLimits {
  return {
    maxOperations: positiveInteger(limits?.maxOperations, DEFAULT_MAX_OPERATIONS),
    maxProjectedFields: positiveInteger(limits?.maxProjectedFields, DEFAULT_MAX_PROJECTED_FIELDS),
    maxDiagnostics: positiveInteger(limits?.maxDiagnostics, DEFAULT_MAX_DIAGNOSTICS),
  };
}

function abortError(): Error {
  const error = new Error('OAS 3.1 offline export snapshot was aborted.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function diagnosticCode(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
  return fallback;
}

class IssueCollector {
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

class ProjectedFieldBudget {
  private count = 0;

  public constructor(private readonly limit: number) {}

  public add(fields: number): void {
    this.count += fields;
    if (this.count > this.limit) {
      throw new Oas31ExportBudgetError('projected-fields', this.limit, this.count);
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

function operationLabel(operation: MenuOperation): string {
  return `${operation.method.toUpperCase()} ${operation.path}`;
}

function parameterKey(parameter: ParameterObject): string {
  return `${parameter.in}:${parameter.name}`;
}

function compactTypeDisplay(typeDisplay: string): string {
  return typeDisplay.replace(/ \/ /g, '/').replace(/ \| /g, '|') || '-';
}

function descriptionForNode(node: SchemaFieldNode): string {
  const descriptions = [node.description];
  if (node.refDescription && node.refDescription !== node.description) {
    descriptions.push(`${node.refTitle ? `[${node.refTitle}] ` : ''}${node.refDescription}`);
  }
  return descriptions.filter((value): value is string => Boolean(value)).join('\n');
}

function fieldPath(parent: string, node: SchemaFieldNode): string {
  if (!node.name) return parent || node.refName || schemaNodeTypeLabel(node) || '$';
  if (node.name === 'items') return parent ? `${parent}[]` : '[]';
  if (/^\[\d+\]$/.test(node.name)) return `${parent}${node.name}`;
  return parent ? `${parent}.${node.name}` : node.name;
}

function flattenProjectedFields(
  fields: readonly SchemaFieldNode[],
  recursive: boolean,
  parent = '',
  depth = 0,
): ExportSchemaField[] {
  const rows: ExportSchemaField[] = [];
  for (const field of fields) {
    const path = fieldPath(parent, field);
    rows.push({
      fieldPath: path,
      typeDisplay: schemaNodeTypeLabel(field),
      required: field.required,
      description: descriptionForNode(field),
      truncated: Boolean(field.truncated),
      ...(field.truncationReason === undefined ? {} : { truncationReason: field.truncationReason }),
      depth,
    });
    if (recursive && field.children?.length) {
      rows.push(...flattenProjectedFields(field.children, true, path, depth + 1));
    }
  }
  return rows;
}

function exportProjectionFields(fields: readonly SchemaFieldNode[], recursive: boolean): ExportSchemaField[] {
  if (fields.length !== 1 || fields[0].name) return flattenProjectedFields(fields, recursive);
  const root = fields[0];
  if (!root.children?.length) return [];
  return flattenProjectedFields(root.children, recursive);
}

function projectionKind(root: SchemaFieldNode): ExportSchema['kind'] {
  if (root.type === 'array') return 'array';
  if (root.type === 'object' || root.children?.length) return 'object';
  if (['string', 'integer', 'number', 'boolean', 'null', 'never'].includes(root.type)) return 'primitive';
  return 'unknown';
}

function exportSchemaFromProjection(
  mediaType: string,
  projection: SchemaDisplayProjection,
  fields: readonly SchemaFieldNode[],
): ExportSchema {
  return {
    mediaType,
    typeDisplay: schemaNodeTypeLabel(projection.root),
    kind: projectionKind(projection.root),
    shallowFields: exportProjectionFields(fields, false),
    fields: exportProjectionFields(fields, true),
  };
}

function recordProjectionIssues(
  projection: SchemaDisplayProjection,
  operation: MenuOperation,
  region: string,
  issues: IssueCollector,
): void {
  projection.diagnostics.forEach((diagnostic) => {
    issues.add({
      code: diagnostic.code,
      severity: diagnostic.severity,
      operation: operationLabel(operation),
      region,
      ...(diagnostic.keyword === undefined ? {} : { keyword: diagnostic.keyword }),
    });
  });
}

async function projectSchema(
  context: OperationBuildContext,
  options: ProjectSchemaOptions,
): Promise<ExportSchema | undefined> {
  try {
    throwIfAborted(context.signal);
    const projection = await context.projector.project(options.reference, { signal: context.signal });
    throwIfAborted(context.signal);
    recordProjectionIssues(projection, options.operation, options.region, context.issues);
    const fields = prepareApiDocSchemaFields(projection.fields, options.mode, options.operationObject);
    const schema = exportSchemaFromProjection(options.mediaType, projection, fields);
    context.fields.add(schema.fields.length);
    return schema;
  } catch (error) {
    if (isAbortError(error) || error instanceof Oas31ExportBudgetError) throw error;
    context.issues.add({
      code: diagnosticCode(error, 'PROJECTION_FAILED'),
      severity: 'warning',
      operation: operationLabel(options.operation),
      region: options.region,
    });
    return options.fallback();
  }
}

function preferredTarget<T extends OperationSchemaExampleTarget>(targets: readonly T[]): T | undefined {
  return targets.find((target) => target.mediaType === 'application/json') ?? targets[0];
}

function recordExampleResult(
  selection: SelectedOperationSchemaExample | undefined,
  target: OperationSchemaExampleTarget | undefined,
  operation: MenuOperation,
  region: string,
  issues: IssueCollector,
): ExportExample | undefined {
  if (!selection) return undefined;
  const result = selection.result;
  if (result.status === 'value') {
    if (result.validation !== 'valid') {
      const diagnostic = result.diagnostics[0];
      issues.add({
        code: diagnostic?.code ?? 'EXAMPLE_VALIDATION_UNAVAILABLE',
        severity: 'warning',
        operation: operationLabel(operation),
        region,
      });
    }
    return {
      mediaType: selection.mediaType,
      value: formatSchemaExampleValue(result.value, selection.mediaType),
    };
  }
  if (target?.schemaReference) {
    issues.add({
      code: result.diagnostics[0]?.code ?? 'EXAMPLE_UNAVAILABLE',
      severity: 'warning',
      operation: operationLabel(operation),
      region,
    });
  }
  return undefined;
}

function legacyOperationBuilder(document: SwaggerDoc, operation: MenuOperation, numberPath: readonly number[]) {
  let cached: ExportOperation | undefined;
  return (): ExportOperation => {
    cached ??= buildExportOperation(
      {
        method: operation.method,
        path: operation.path,
        operation: operation.operation,
        title: operation.operation.summary?.trim() || `${operation.method.toUpperCase()} ${operation.path}`,
        numberPath,
      } as never,
      document as never,
    );
    return cached;
  };
}

function rawParameterHasSchema(parameter: ParameterObject): boolean {
  if (parameter.schema !== undefined) return true;
  return Object.values(parameter.content ?? {}).some((media) => media.schema !== undefined);
}

async function buildParameters(
  context: OperationBuildContext,
  operation: MenuOperation,
  fallback: () => ExportOperation,
): Promise<ExportParameter[]> {
  const references = new Map(
    locateOperationParameterSchemaTargets(context.document, operation).map((target) => [target.key, target.reference]),
  );
  const parameters = operation.operation.parameters ?? [];
  const result: ExportParameter[] = [];
  for (const [index, parameter] of parameters.entries()) {
    throwIfAborted(context.signal);
    const reference = references.get(parameterKey(parameter));
    let typeDisplay = [parameter.type, parameter.format].filter(Boolean).join(' / ') || '-';
    if (reference) {
      const projected = await projectSchema(context, {
        reference,
        mediaType: '',
        mode: 'request',
        operation,
        region: `parameter ${parameter.in}:${parameter.name}`,
        fallback: () => undefined,
      });
      typeDisplay = projected?.typeDisplay ?? fallback().parameters[index]?.typeDisplay ?? '-';
    } else if (rawParameterHasSchema(parameter)) {
      context.issues.add({
        code: 'SCHEMA_REFERENCE_UNAVAILABLE',
        severity: 'warning',
        operation: operationLabel(operation),
        region: `parameter ${parameter.in}:${parameter.name}`,
      });
      typeDisplay = fallback().parameters[index]?.typeDisplay ?? '-';
    }
    result.push({
      name: parameter.name,
      location: parameter.in,
      required: Boolean(parameter.required),
      typeDisplay,
      compactTypeDisplay: compactTypeDisplay(typeDisplay),
      description: parameter.description ?? '',
    });
  }
  return result;
}

async function buildOperation(
  context: OperationBuildContext,
  operation: MenuOperation,
  numberPath: readonly number[],
): Promise<ExportOperation> {
  throwIfAborted(context.signal);
  const fallback = legacyOperationBuilder(context.document, operation, numberPath);
  const requestTarget = preferredTarget(locateRequestSchemaExampleTargets(context.document, operation));
  const responseTargets = new Map(
    locateResponseSchemaExampleTargets(context.document, operation).map((target) => [target.statusCode, target]),
  );

  const parameters = await buildParameters(context, operation, fallback);
  let examples: Awaited<ReturnType<typeof generateOperationSchemaExamples>> | undefined;
  try {
    examples = await generateOperationSchemaExamples(context.document, operation, context.session, {
      signal: context.signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    context.issues.add({
      code: diagnosticCode(error, 'EXAMPLE_GENERATION_FAILED'),
      severity: 'warning',
      operation: operationLabel(operation),
      region: 'examples',
    });
  }

  const requestBodyValue = operation.operation.requestBody;
  let requestBody: ExportRequestBody | undefined;
  if (requestBodyValue) {
    const schema = requestTarget?.schemaReference
      ? await projectSchema(context, {
          reference: requestTarget.schemaReference,
          mediaType: requestTarget.mediaType,
          mode: 'request',
          operation,
          operationObject: operation.operation,
          region: 'requestBody',
          fallback: () => fallback().requestBody?.schema,
        })
      : undefined;
    requestBody = {
      description: requestBodyValue.description ?? '',
      required: Boolean(requestBodyValue.required),
      schema,
      example:
        recordExampleResult(examples?.request, requestTarget, operation, 'requestBody example', context.issues) ??
        (examples === undefined ? fallback().requestBody?.example : undefined),
    };
  }

  const exampleResponses = new Map((examples?.responses ?? []).map((response) => [response.statusCode, response]));
  const responses: ExportResponse[] = [];
  for (const [statusCode, response] of Object.entries(operation.operation.responses ?? {})) {
    const target = responseTargets.get(statusCode);
    const schema = target?.schemaReference
      ? await projectSchema(context, {
          reference: target.schemaReference,
          mediaType: target.mediaType,
          mode: 'response',
          operation,
          region: `response ${statusCode}`,
          fallback: () => fallback().responses.find((item) => item.statusCode === statusCode)?.schema,
        })
      : undefined;
    responses.push({
      statusCode,
      description: response.description ?? '',
      schema,
      example:
        recordExampleResult(
          exampleResponses.get(statusCode),
          target,
          operation,
          `response ${statusCode} example`,
          context.issues,
        ) ??
        (examples === undefined
          ? fallback().responses.find((item) => item.statusCode === statusCode)?.example
          : undefined),
    });
  }

  return {
    title: operation.operation.summary?.trim() || `${operation.method.toUpperCase()} ${operation.path}`,
    numberPath,
    method: operation.method.toUpperCase(),
    path: operation.path,
    summary: operation.operation.summary ?? '',
    description: operation.operation.description ?? '',
    deprecated: Boolean(operation.operation.deprecated),
    parameters,
    requestBody,
    responses,
  };
}

interface FlattenedOperation {
  readonly tagIndex: number;
  readonly operationIndex: number;
  readonly operation: MenuOperation;
}

/**
 * Build the one immutable model consumed by every human-readable offline
 * renderer. The builder only reads the registry-backed session and never owns
 * a loader or fetch capability.
 */
export async function buildOas31ExportSnapshot(
  document: SwaggerDoc,
  tags: readonly MenuTag[],
  session: SchemaDocumentSession,
  options: BuildOas31ExportSnapshotOptions = {},
): Promise<OfflineDocumentSnapshot> {
  if (!isOpenApi31Version(document.openapi)) {
    throw new TypeError('OAS 3.1 offline export snapshot requires an OpenAPI 3.1.x document.');
  }
  throwIfAborted(options.signal);
  const limits = effectiveLimits(options.limits);
  const flattened: FlattenedOperation[] = tags.flatMap((tag, tagIndex) =>
    tag.operations.map((operation, operationIndex) => ({ tagIndex, operationIndex, operation })),
  );
  if (flattened.length > limits.maxOperations) {
    throw new Oas31ExportBudgetError('operations', limits.maxOperations, flattened.length);
  }

  const issues = new IssueCollector(limits.maxDiagnostics, options.initialIssues ?? []);
  const projector = createSchemaDisplayProjector(session);
  const fields = new ProjectedFieldBudget(limits.maxProjectedFields);
  const context: OperationBuildContext = {
    document,
    projector,
    session,
    signal: options.signal,
    issues,
    fields,
  };
  const operations = await mapWithConcurrency(
    flattened,
    PROJECTION_CONCURRENCY,
    ({ operation, tagIndex, operationIndex }) => buildOperation(context, operation, [tagIndex + 1, operationIndex + 1]),
  );
  throwIfAborted(options.signal);

  const operationMap = new Map(
    flattened.map((entry, index) => [`${entry.tagIndex}:${entry.operationIndex}`, operations[index]]),
  );
  const exportDocument: ExportDocument = {
    title: document.info.title || options.fallbackTitle || 'API Documentation',
    version: document.info.version ?? '',
    description: document.info.description ?? '',
    tags: tags.map((tag, tagIndex) => ({
      name: tag.tag,
      description: tag.description ?? '',
      numberPath: [tagIndex + 1],
      operations: tag.operations.map((_, operationIndex) => operationMap.get(`${tagIndex}:${operationIndex}`)!),
    })),
  };
  return createOfflineDocumentSnapshot(exportDocument, issues.result());
}
