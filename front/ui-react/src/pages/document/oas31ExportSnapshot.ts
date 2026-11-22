import {
  assembleRegisteredExportTags,
  collectRegisteredExportOperations,
  compactTypeDisplay,
  effectiveExportLimits,
  exportDiagnosticCode,
  ExportIssueCollector,
  exportParameterKey,
  exportSchemaFromProjection,
  isExportAbortError,
  ProjectedFieldBudget,
  projectRegisteredExportOperations,
  recordExportProjectionIssues,
  registeredExportDocumentInfo,
  throwIfExportAborted,
  type ExportBudgetDimension,
  type RegisteredExportLimits,
} from 'knife4j-core/lib/offlineDocumentSnapshot';
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
} from 'knife4j-core';
import { schemaNodeTypeLabel } from '../../components/schema/schemaUtils';
import { createSchemaDisplayProjector, type SchemaDisplayProjector } from '../../schema/schemaDisplayProjection';
import type { SchemaDocumentSession } from '../../schema/schemaDocumentSession';
import {
  formatSchemaExampleValue,
  generateOperationSchemaExamples,
  locateRequestSchemaExampleTargets,
  locateResponseSchemaExampleTargets,
  type OperationSchemaExampleTarget,
  type SelectedOperationSchemaExample,
} from '../../schema/operationSchemaExamples';
import {
  locateOperationParameterSchemaTargets,
  type OperationParameterSchemaTarget,
} from '../../schema/parameterSchemaValidation';
import { generateSchemaExample } from '../../schema/schemaExampleGeneration';
import { locateOperationResponses } from '../../schema/registeredResponse';
import { prepareApiDocSchemaFields, type ApiDocSchemaAccessMode } from '../api/apiDocSchemaProjection';
import type { MenuOperation, MenuTag, OperationObject, ParameterObject, SwaggerDoc } from '../../types/swagger';
import {
  createOfflineDocumentSnapshot,
  type OfflineDocumentIssue,
  type OfflineDocumentSnapshot,
} from './offlineDocumentSnapshot';

export type Oas31ExportSnapshotLimits = RegisteredExportLimits;

export interface BuildOas31ExportSnapshotOptions {
  readonly fallbackTitle?: string;
  readonly signal?: AbortSignal;
  readonly initialIssues?: readonly OfflineDocumentIssue[];
  readonly limits?: Oas31ExportSnapshotLimits;
}

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

interface OperationBuildContext {
  readonly document: SwaggerDoc;
  readonly projector: SchemaDisplayProjector;
  readonly session: SchemaDocumentSession;
  readonly signal?: AbortSignal;
  readonly issues: ExportIssueCollector;
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

function throwIfAborted(signal?: AbortSignal): void {
  throwIfExportAborted(signal, '3.1');
}

function operationLabel(operation: MenuOperation): string {
  return `${operation.method.toUpperCase()} ${operation.path}`;
}

async function projectSchema(
  context: OperationBuildContext,
  options: ProjectSchemaOptions,
): Promise<ExportSchema | undefined> {
  try {
    throwIfAborted(context.signal);
    const projection = await context.projector.project(options.reference, { signal: context.signal });
    throwIfAborted(context.signal);
    recordExportProjectionIssues(
      context.issues,
      projection.diagnostics,
      operationLabel(options.operation),
      options.region,
    );
    const fields = prepareApiDocSchemaFields(projection.fields, options.mode, options.operationObject);
    const schema = exportSchemaFromProjection(options.mediaType, projection.root, fields, {
      typeLabel: schemaNodeTypeLabel,
    });
    context.fields.add(schema.fields.length);
    return schema;
  } catch (error) {
    if (isExportAbortError(error) || error instanceof Oas31ExportBudgetError) throw error;
    context.issues.add({
      code: exportDiagnosticCode(error, 'PROJECTION_FAILED'),
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
  issues: ExportIssueCollector,
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
  if (target?.schemaReference || target?.explicitReferenceUnavailable) {
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

async function buildParameterExample(
  context: OperationBuildContext,
  operation: MenuOperation,
  parameter: ParameterObject,
  target: OperationParameterSchemaTarget,
): Promise<ExportExample | undefined> {
  const region = `parameter ${parameter.in}:${parameter.name} example`;
  try {
    const result = await generateSchemaExample(context.session, target.reference, {
      direction: 'request',
      explicit: target.explicit,
      signal: context.signal,
    });
    return recordExampleResult(
      { mediaType: target.mediaType, result },
      {
        key: target.key,
        mediaType: target.mediaType,
        schemaReference: target.reference,
        explicit: target.explicit,
      },
      operation,
      region,
      context.issues,
    );
  } catch (error) {
    if (isExportAbortError(error)) throw error;
    context.issues.add({
      code: exportDiagnosticCode(error, 'PARAMETER_EXAMPLE_GENERATION_FAILED'),
      severity: 'warning',
      operation: operationLabel(operation),
      region,
    });
    return undefined;
  }
}

async function buildParameters(
  context: OperationBuildContext,
  operation: MenuOperation,
  fallback: () => ExportOperation,
): Promise<ExportParameter[]> {
  const targets = new Map(
    locateOperationParameterSchemaTargets(context.document, operation).map((target) => [target.key, target]),
  );
  const parameters = operation.operation.parameters ?? [];
  const result: ExportParameter[] = [];
  for (const [index, parameter] of parameters.entries()) {
    throwIfAborted(context.signal);
    const target = targets.get(exportParameterKey(parameter));
    let typeDisplay = [parameter.type, parameter.format].filter(Boolean).join(' / ') || '-';
    let schema: ExportSchema | undefined;
    let example: ExportExample | undefined;
    if (target) {
      schema = await projectSchema(context, {
        reference: target.reference,
        mediaType: target.mediaType,
        mode: 'request',
        operation,
        region: `parameter ${parameter.in}:${parameter.name}`,
        fallback: () => undefined,
      });
      typeDisplay = schema?.typeDisplay ?? fallback().parameters[index]?.typeDisplay ?? '-';
      example = await buildParameterExample(context, operation, parameter, target);
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
      ...(schema === undefined ? {} : { schema }),
      ...(example === undefined ? {} : { example }),
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
    locateResponseSchemaExampleTargets(context.document, operation, context.session).map((target) => [
      target.statusCode,
      target,
    ]),
  );

  const parameters = await buildParameters(context, operation, fallback);
  let examples: Awaited<ReturnType<typeof generateOperationSchemaExamples>> | undefined;
  try {
    examples = await generateOperationSchemaExamples(context.document, operation, context.session, {
      signal: context.signal,
    });
  } catch (error) {
    if (isExportAbortError(error)) throw error;
    context.issues.add({
      code: exportDiagnosticCode(error, 'EXAMPLE_GENERATION_FAILED'),
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
  for (const { statusCode, location } of locateOperationResponses(context.document, operation, context.session)) {
    if (!location) {
      context.issues.add({
        code: 'RESPONSE_REFERENCE_UNAVAILABLE',
        severity: 'warning',
        operation: operationLabel(operation),
        region: `response ${statusCode}`,
      });
    }
    const response = location?.value ?? {};
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
      description: typeof response.description === 'string' ? response.description : '',
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
    throw new TypeError('OAS 3.1 offline export snapshot requires a valid OpenAPI 3.1.x version.');
  }
  throwIfAborted(options.signal);
  const limits = effectiveExportLimits(options.limits);
  const flattened = collectRegisteredExportOperations(tags, limits.maxOperations, Oas31ExportBudgetError);
  const issues = new ExportIssueCollector(limits.maxDiagnostics, options.initialIssues ?? []);
  const projector = createSchemaDisplayProjector(session);
  const fields = new ProjectedFieldBudget(limits.maxProjectedFields, Oas31ExportBudgetError);
  const context: OperationBuildContext = {
    document,
    projector,
    session,
    signal: options.signal,
    issues,
    fields,
  };
  const operations = await projectRegisteredExportOperations(flattened, (operation, numberPath) =>
    buildOperation(context, operation, numberPath),
  );
  throwIfAborted(options.signal);

  const exportDocument: ExportDocument = {
    ...registeredExportDocumentInfo(document.info, options.fallbackTitle),
    tags: assembleRegisteredExportTags(tags, flattened, operations, (tag) => ({
      name: tag.tag,
      description: tag.description ?? '',
    })),
  };
  return createOfflineDocumentSnapshot(exportDocument, issues.result());
}
