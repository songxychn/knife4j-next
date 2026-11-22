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
  collectOas32DocumentDiagnostics,
  getOpenApiSpecificationFeatures,
  interpretExampleObject,
  resolvePhysicalJsonPointer,
  schemaFieldXml,
  type ExportDiscriminator,
  type ExportDocument,
  type ExportEncoding,
  type ExportExample,
  type ExportNote,
  type ExportOperation,
  type ExportParameter,
  type ExportRequestBody,
  type ExportResponse,
  type ExportSchema,
  type ExportSecurityRequirement,
  type ExportSecurityScheme,
  type ExportServer,
  type OpenApiObjectLocation,
  hasOwn as owns,
  appendJsonPointer,
  encodeJsonPointerToken,
} from 'knife4j-core';
import { schemaNodeTypeLabel } from '../../components/schema/schemaUtils';
import { projectOas32Security } from '../../auth/oas32Security';
import { createSchemaDisplayProjector, type SchemaDisplayProjector } from '../../schema/schemaDisplayProjection';
import type { SchemaDocumentSession } from '../../schema/schemaDocumentSession';
import type { ResourceGraphSnapshot } from '../../schema/externalResourceGraph';
import {
  formatSchemaExampleValue,
  generateOperationSchemaExamples,
  type SelectedOperationSchemaExample,
} from '../../schema/operationSchemaExamples';
import { locateOperationResponses } from '../../schema/registeredResponse';
import { classifyOas32SequentialMedia } from 'knife4j-core/lib/openapi32/sequentialMedia';
import { asOpenApiRecord as asRecord } from '../../schema/openApiDocumentPointer';
import { prepareApiDocSchemaFields, type ApiDocSchemaAccessMode } from '../api/apiDocSchemaProjection';
import {
  buildOas32OperationOpenApiDocument,
  type Oas32OperationExportContext,
} from '../api/oas31OperationOpenApiDocument';
import { attachDiscriminatorMappingFields, describeSchemaDiscriminator } from '../../schema/schemaDiscriminatorView';
import { discriminatorSchemaLocation } from '../../schema/schemaDiscriminator';
import { resolveOas32Server, selectOas32Servers } from '../../schema/oas32ServerResolution';
import type { MenuOperation, MenuTag, OperationObject, SwaggerDoc } from '../../types/swagger';
import {
  createOfflineDocumentSnapshot,
  type OfflineDocumentIssue,
  type OfflineDocumentSnapshot,
} from './offlineDocumentSnapshot';

export type Oas32ExportSnapshotLimits = RegisteredExportLimits;

export interface BuildOas32ExportSnapshotOptions {
  readonly fallbackTitle?: string;
  readonly signal?: AbortSignal;
  readonly initialIssues?: readonly OfflineDocumentIssue[];
  readonly limits?: Oas32ExportSnapshotLimits;
  readonly retrievalUri?: string;
  readonly documentScope?: string;
  readonly resourceSnapshot?: ResourceGraphSnapshot;
}

export interface Oas32ExportResourceGraphIssueOptions {
  readonly snapshot?: ResourceGraphSnapshot;
  readonly retrievalUri?: string;
  readonly documentScope?: string;
  readonly graphStatus?: string;
  readonly registrationError?: { readonly code?: string } | null;
}

/**
 * Accept a resource graph only when it still matches the current entry URI
 * and, when provided, the current document scope. Callers must not fall back
 * to a menu-cached snapshot after this returns undefined.
 */
export function selectOas32ExportResourceSnapshot(
  snapshot: ResourceGraphSnapshot | undefined,
  retrievalUri: string | undefined,
  documentScope?: string,
): ResourceGraphSnapshot | undefined {
  if (!snapshot || !retrievalUri) return undefined;
  if (snapshot.entryRetrievalUri !== retrievalUri) return undefined;
  if (documentScope !== undefined && snapshot.documentScope !== documentScope) return undefined;
  return snapshot;
}

export function collectOas32ExportResourceGraphIssues(
  options: Oas32ExportResourceGraphIssueOptions,
): OfflineDocumentIssue[] {
  const current = selectOas32ExportResourceSnapshot(options.snapshot, options.retrievalUri, options.documentScope);
  const issues: OfflineDocumentIssue[] = [];
  if (options.snapshot && !current) {
    issues.push({ code: 'GRAPH_STALE', severity: 'warning' });
  } else if (
    !current ||
    current.complete === false ||
    (options.graphStatus !== undefined && options.graphStatus !== 'ready')
  ) {
    issues.push({ code: 'RESOURCE_GRAPH_INCOMPLETE', severity: 'warning' });
  }
  if (options.registrationError) {
    issues.push({
      code: 'RESOURCE_REGISTRATION_FAILED',
      severity: 'warning',
      ...(options.registrationError.code === undefined ? {} : { keyword: options.registrationError.code }),
    });
  }
  return issues;
}

export class Oas32ExportBudgetError extends Error {
  public readonly code = 'EXPORT_BUDGET_EXCEEDED';

  public constructor(
    public readonly dimension: ExportBudgetDimension,
    public readonly limit: number,
    public readonly actual: number,
  ) {
    super(`OAS 3.2 offline export ${dimension} budget exceeded (${actual} > ${limit}).`);
    this.name = 'Oas32ExportBudgetError';
  }
}

interface LocatedObject {
  readonly ownerRetrievalUri: string;
  readonly pointer: string;
  readonly value: Record<string, unknown>;
}

interface OperationBuildContext {
  readonly document: SwaggerDoc;
  readonly projector: SchemaDisplayProjector;
  readonly session: SchemaDocumentSession;
  readonly signal?: AbortSignal;
  readonly issues: ExportIssueCollector;
  readonly fields: ProjectedFieldBudget;
  readonly retrievalUri: string;
  readonly snapshot?: ResourceGraphSnapshot;
}

interface ProjectSchemaOptions {
  readonly reference: string;
  readonly mediaType: string;
  readonly mode: ApiDocSchemaAccessMode;
  readonly operation: MenuOperation;
  readonly operationObject?: OperationObject;
  readonly region: string;
  readonly role?: 'schema' | 'itemSchema';
  readonly sequentialKind?: string;
  readonly encodings?: ExportEncoding[];
  readonly snapshot?: ResourceGraphSnapshot;
}

function throwIfAborted(signal?: AbortSignal): void {
  throwIfExportAborted(signal, '3.2');
}

function displayMethod(operation: MenuOperation): string {
  return operation.identity?.method ?? operation.method;
}

function executionExportNotes(operation: MenuOperation, method: string): ExportNote[] {
  const notes: ExportNote[] = [];
  if (operation.source && operation.source !== 'path') {
    notes.push({ code: 'NON_EXECUTABLE_SOURCE', detail: operation.source });
  }
  if (method === 'QUERY' || operation.identity?.methodSource === 'additional') {
    notes.push({ code: 'BROWSER_EXECUTION_UNSUPPORTED', detail: method });
  }
  return notes;
}

function operationLabel(operation: MenuOperation): string {
  return `${displayMethod(operation)} ${operation.path}`;
}

function pointerChild(pointer: string, token: string): string {
  return appendJsonPointer(pointer, token);
}

function schemaReference(ownerRetrievalUri: string, pointer: string, ...tokens: string[]): string {
  return `${ownerRetrievalUri}${tokens.reduce(pointerChild, pointer)}`;
}

function followLocation(
  snapshot: ResourceGraphSnapshot | undefined,
  location: OpenApiObjectLocation,
): LocatedObject | null {
  let current = location;
  const seen = new Set<string>();
  for (let depth = 0; depth <= 20; depth += 1) {
    const value = asRecord(current.value);
    if (!value) return null;
    if (typeof value.$ref !== 'string') {
      return { ownerRetrievalUri: current.ownerRetrievalUri, pointer: current.pointer, value };
    }
    const key = `${current.ownerRetrievalUri}\0${current.pointer}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const edge = snapshot?.edges.find(
      (candidate) =>
        candidate.sourceRetrievalUri === current.ownerRetrievalUri &&
        candidate.sourcePointer === `${current.pointer}/$ref` &&
        ['loaded', 'local'].includes(candidate.state) &&
        candidate.target,
    );
    const target = edge?.target;
    if (target && snapshot) {
      const owner = snapshot.nodes.get(target.ownerRetrievalUri)?.document;
      const resolved = resolvePhysicalJsonPointer(owner, target.pointer);
      if (!resolved.found) return null;
      current = { ownerRetrievalUri: target.ownerRetrievalUri, pointer: target.pointer, value: resolved.value };
      continue;
    }
    if (!value.$ref.startsWith('#')) return null;
    const owner = snapshot?.nodes.get(current.ownerRetrievalUri)?.document;
    const resolved = resolvePhysicalJsonPointer(owner, value.$ref);
    if (!resolved.found) return null;
    current = { ownerRetrievalUri: current.ownerRetrievalUri, pointer: value.$ref, value: resolved.value };
  }
  return null;
}

function encodingNotes(encodings: ExportEncoding[] | undefined, conflict: boolean): ExportNote[] | undefined {
  const nested = (encodings ?? []).flatMap((encoding) => encoding.notes ?? []);
  const notes = conflict
    ? [{ code: 'ENCODING_CONFLICT', detail: 'encoding cannot be used together with prefixEncoding or itemEncoding.' }]
    : nested;
  return notes.length ? notes : undefined;
}

function collectEncodings(media: Record<string, unknown>): { encodings?: ExportEncoding[]; notes?: ExportNote[] } {
  const named = asRecord(media.encoding);
  const prefix = Array.isArray(media.prefixEncoding) ? media.prefixEncoding : undefined;
  const item = asRecord(media.itemEncoding);
  const hasNamed = named !== null;
  const hasPrefix = prefix !== undefined || owns(media, 'prefixEncoding');
  const hasItem = item !== null || owns(media, 'itemEncoding');
  const conflict = hasNamed && (hasPrefix || hasItem);
  const encodings: ExportEncoding[] = [];
  if (named) {
    Object.entries(named).forEach(([name, value]) => {
      const encoding = asRecord(value);
      encodings.push({
        kind: 'named',
        name,
        ...(typeof encoding?.contentType === 'string' ? { contentType: encoding.contentType } : {}),
        ...(typeof encoding?.style === 'string' ? { style: encoding.style } : {}),
        ...(typeof encoding?.explode === 'boolean' ? { explode: encoding.explode } : {}),
        ...(typeof encoding?.allowReserved === 'boolean' ? { allowReserved: encoding.allowReserved } : {}),
      });
    });
  }
  if (prefix) {
    prefix.forEach((value, index) => {
      const encoding = asRecord(value);
      encodings.push({
        kind: 'prefix',
        name: String(index),
        ...(typeof encoding?.contentType === 'string' ? { contentType: encoding.contentType } : {}),
      });
    });
  } else if (owns(media, 'prefixEncoding') && !Array.isArray(media.prefixEncoding)) {
    encodings.push({
      kind: 'prefix',
      notes: [{ code: 'ENCODING_INVALID', detail: 'prefixEncoding must be an array of Encoding Objects.' }],
    });
  }
  if (item) {
    encodings.push({
      kind: 'item',
      ...(typeof item.contentType === 'string' ? { contentType: item.contentType } : {}),
    });
  }
  const notes = encodingNotes(encodings, conflict);
  return {
    ...(encodings.length ? { encodings } : {}),
    ...(notes ? { notes } : {}),
  };
}

function discriminatorFromSchema(schema: unknown): ExportDiscriminator | undefined {
  const record = asRecord(schema);
  const discriminator = asRecord(record?.discriminator);
  if (!discriminator) return undefined;
  const mapping = asRecord(discriminator.mapping);
  return {
    ...(typeof discriminator.propertyName === 'string' ? { propertyName: discriminator.propertyName } : {}),
    ...(mapping
      ? {
          mapping: Object.fromEntries(
            Object.entries(mapping).flatMap(([key, value]) => (typeof value === 'string' ? [[key, value]] : [])),
          ),
        }
      : {}),
    ...(typeof discriminator.defaultMapping === 'string' ? { defaultMapping: discriminator.defaultMapping } : {}),
  };
}

async function projectSchema(
  context: OperationBuildContext,
  options: ProjectSchemaOptions,
): Promise<ExportSchema | undefined> {
  try {
    throwIfAborted(context.signal);
    const projection = await context.projector.project(options.reference, { signal: context.signal });
    throwIfAborted(context.signal);
    let fields = prepareApiDocSchemaFields(projection.fields, options.mode, options.operationObject);
    const snapshot = options.snapshot ?? context.snapshot;
    if (snapshot) {
      try {
        const url = new URL(options.reference, context.retrievalUri);
        const pointer = url.hash || '#';
        url.hash = '';
        const metadata = describeSchemaDiscriminator(
          snapshot,
          discriminatorSchemaLocation({ ownerRetrievalUri: url.href, pointer }, context.retrievalUri),
        );
        fields = attachDiscriminatorMappingFields(fields, metadata);
        if (metadata.status !== 'ready' && metadata.status !== 'no-discriminator') {
          context.issues.add({
            code: `DISCRIMINATOR_${metadata.status.replace(/-/g, '_').toUpperCase()}`,
            severity: 'warning',
            operation: operationLabel(options.operation),
            region: options.region,
          });
        }
      } catch {
        // Discriminator indexing is additive; schema projection still stands.
      }
    }
    recordExportProjectionIssues(
      context.issues,
      projection.diagnostics,
      operationLabel(options.operation),
      options.region,
    );
    const schema = exportSchemaFromProjection(options.mediaType, projection.root, fields, {
      typeLabel: schemaNodeTypeLabel,
      includeXml: true,
      extras: {
        ...(options.role === undefined ? {} : { role: options.role }),
        ...(options.sequentialKind === undefined ? {} : { sequentialKind: options.sequentialKind }),
        ...(options.encodings === undefined ? {} : { encodings: options.encodings }),
        ...(projection.root.xml === undefined ? {} : { xml: projection.root.xml }),
      },
    });
    context.fields.add(schema.fields.length);
    return schema;
  } catch (error) {
    if (isExportAbortError(error) || error instanceof Oas32ExportBudgetError) throw error;
    context.issues.add({
      code: exportDiagnosticCode(error, 'PROJECTION_FAILED'),
      severity: 'warning',
      operation: operationLabel(options.operation),
      region: options.region,
    });
    return undefined;
  }
}

function exampleFromMedia(
  media: Record<string, unknown>,
  mediaType: string,
  documentBaseUri: string,
  issues: ExportIssueCollector,
  operation: MenuOperation,
  region: string,
): ExportExample | undefined {
  const notes: ExportNote[] = [];
  if (owns(media, 'example')) {
    const representation = interpretExampleObject(
      { value: media.example },
      { layer: 'media', mediaType, documentBaseUri },
    );
    notes.push(...representation.diagnostics.map((diagnostic) => ({ code: diagnostic.code })));
    if (representation.external) {
      issues.add({
        code: 'EXTERNAL_EXAMPLE_NOT_LOADED',
        severity: 'warning',
        operation: operationLabel(operation),
        region,
      });
      return {
        mediaType,
        value: representation.external.value,
        notes: [...notes, { code: 'EXTERNAL_EXAMPLE_NOT_LOADED' }],
      };
    }
    if (representation.data !== undefined) {
      return {
        mediaType,
        value: formatSchemaExampleValue(representation.data as never, mediaType),
        ...(notes.length ? { notes } : {}),
      };
    }
    if (representation.text !== undefined)
      return { mediaType, value: representation.text, ...(notes.length ? { notes } : {}) };
  }
  const examples = asRecord(media.examples);
  if (!examples) return undefined;
  for (const [name, raw] of Object.entries(examples)) {
    const record = asRecord(raw);
    if (!record) continue;
    if (
      typeof record.$ref === 'string' &&
      !owns(record, 'value') &&
      !owns(record, 'dataValue') &&
      !owns(record, 'serializedValue')
    ) {
      issues.add({
        code: 'EXAMPLE_REFERENCE_UNAVAILABLE',
        severity: 'warning',
        operation: operationLabel(operation),
        region: `${region} ${name}`,
      });
      continue;
    }
    const representation = interpretExampleObject(record, { layer: 'media', mediaType, documentBaseUri });
    notes.push(...representation.diagnostics.map((diagnostic) => ({ code: diagnostic.code })));
    if (representation.external) {
      issues.add({
        code: 'EXTERNAL_EXAMPLE_NOT_LOADED',
        severity: 'warning',
        operation: operationLabel(operation),
        region,
      });
      return {
        mediaType,
        value: representation.external.value,
        notes: [...notes, { code: 'EXTERNAL_EXAMPLE_NOT_LOADED' }],
      };
    }
    if (representation.data !== undefined) {
      return {
        mediaType,
        value: formatSchemaExampleValue(representation.data as never, mediaType),
        ...(notes.length ? { notes } : {}),
      };
    }
    if (representation.text !== undefined)
      return { mediaType, value: representation.text, ...(notes.length ? { notes } : {}) };
  }
  return undefined;
}

function recordGeneratedExample(
  selection: SelectedOperationSchemaExample | undefined,
  operation: MenuOperation,
  region: string,
  issues: ExportIssueCollector,
): ExportExample | undefined {
  if (!selection) return undefined;
  const result = selection.result;
  if (result.status === 'value') {
    if (result.validation !== 'valid') {
      issues.add({
        code: result.diagnostics[0]?.code ?? 'EXAMPLE_VALIDATION_UNAVAILABLE',
        severity: 'warning',
        operation: operationLabel(operation),
        region,
      });
    }
    return { mediaType: selection.mediaType, value: formatSchemaExampleValue(result.value, selection.mediaType) };
  }
  if (result.diagnostics.length) {
    issues.add({
      code: result.diagnostics[0]?.code ?? 'EXAMPLE_UNAVAILABLE',
      severity: 'warning',
      operation: operationLabel(operation),
      region,
    });
  }
  return undefined;
}

function preferredMediaType(content: Record<string, unknown>): string | undefined {
  const keys = Object.keys(content);
  return (
    keys.find((mediaType) => mediaType === 'application/json') ??
    keys.find((mediaType) => classifyOas32SequentialMedia(mediaType) !== 'unknown') ??
    keys[0]
  );
}

async function projectMedia(
  context: OperationBuildContext,
  operation: MenuOperation,
  mediaLocation: LocatedObject,
  mediaType: string,
  mode: ApiDocSchemaAccessMode,
  region: string,
): Promise<{
  schema?: ExportSchema;
  itemSchema?: ExportSchema;
  encodings?: ExportEncoding[];
  sequentialKind?: string;
  notes?: ExportNote[];
  example?: ExportExample;
}> {
  const followed = followLocation(context.snapshot, mediaLocation);
  if (!followed) {
    if (typeof asRecord(mediaLocation.value)?.$ref === 'string') {
      context.issues.add({
        code: 'MEDIA_TYPE_REFERENCE_UNAVAILABLE',
        severity: 'warning',
        operation: operationLabel(operation),
        region,
      });
      return { notes: [{ code: 'MEDIA_TYPE_REFERENCE_UNAVAILABLE' }] };
    }
    return {};
  }
  const media = asRecord(followed.value);
  if (!media) return {};
  const sequentialKind = classifyOas32SequentialMedia(mediaType);
  const encoding = collectEncodings(media);
  if (encoding.notes) {
    encoding.notes.forEach((note) =>
      context.issues.add({
        code: note.code,
        severity: 'warning',
        operation: operationLabel(operation),
        region,
        ...(note.detail === undefined ? {} : { keyword: note.detail }),
      }),
    );
  }
  const extras = {
    ...(sequentialKind === 'unknown' ? {} : { sequentialKind }),
    ...(encoding.encodings === undefined ? {} : { encodings: encoding.encodings }),
  };
  let schema: ExportSchema | undefined;
  let itemSchema: ExportSchema | undefined;
  if (owns(media, 'schema')) {
    schema = await projectSchema(context, {
      reference: schemaReference(followed.ownerRetrievalUri, followed.pointer, 'schema'),
      mediaType,
      mode,
      operation,
      operationObject: operation.operation,
      region,
      role: 'schema',
      snapshot: context.snapshot,
      ...extras,
    });
    const discriminator = discriminatorFromSchema(media.schema);
    if (schema && discriminator) schema = { ...schema, discriminator };
    const xml = schemaFieldXml(media.schema);
    if (schema && xml) schema = { ...schema, xml };
  }
  if (owns(media, 'itemSchema')) {
    itemSchema = await projectSchema(context, {
      reference: schemaReference(followed.ownerRetrievalUri, followed.pointer, 'itemSchema'),
      mediaType,
      mode,
      operation,
      region: `${region} itemSchema`,
      role: 'itemSchema',
      snapshot: context.snapshot,
      ...extras,
    });
  } else if (sequentialKind !== 'unknown') {
    context.issues.add({
      code: 'ITEM_SCHEMA_ABSENT',
      severity: 'warning',
      operation: operationLabel(operation),
      region,
    });
  }
  const notes = [
    ...(encoding.notes ?? []),
    ...(owns(media, 'schema') || owns(media, 'itemSchema')
      ? []
      : [{ code: 'MEDIA_SCHEMA_ABSENT', detail: 'Media Type has neither schema nor itemSchema.' }]),
    ...(sequentialKind === 'unknown' || owns(media, 'itemSchema') ? [] : [{ code: 'ITEM_SCHEMA_ABSENT' }]),
  ];
  const example = exampleFromMedia(
    media,
    mediaType,
    followed.ownerRetrievalUri,
    context.issues,
    operation,
    `${region} example`,
  );
  return {
    ...(schema === undefined ? {} : { schema }),
    ...(itemSchema === undefined ? {} : { itemSchema }),
    ...(encoding.encodings === undefined ? {} : { encodings: encoding.encodings }),
    ...(sequentialKind === 'unknown' ? {} : { sequentialKind }),
    ...(notes.length ? { notes } : {}),
    ...(example === undefined ? {} : { example }),
  };
}

async function buildParameters(context: OperationBuildContext, operation: MenuOperation): Promise<ExportParameter[]> {
  const parameters = operation.operation.parameters ?? [];
  const result: ExportParameter[] = [];
  for (const parameter of parameters) {
    throwIfAborted(context.signal);
    const key = exportParameterKey(parameter);
    const located = operation.identity?.parameterLocations[key];
    let typeDisplay = [parameter.type, parameter.format].filter(Boolean).join(' / ') || '-';
    let schema: ExportSchema | undefined;
    let encodings: ExportEncoding[] | undefined;
    let notes: ExportNote[] | undefined;
    let example: ExportExample | undefined;
    if (located) {
      const followed = followLocation(context.snapshot, located);
      const value = followed?.value ?? asRecord(located.value);
      if (!followed && typeof asRecord(located.value)?.$ref === 'string') {
        context.issues.add({
          code: 'SCHEMA_REFERENCE_UNAVAILABLE',
          severity: 'warning',
          operation: operationLabel(operation),
          region: `parameter ${key}`,
        });
      }
      if (value && owns(value, 'schema') && followed) {
        schema = await projectSchema(context, {
          reference: schemaReference(followed.ownerRetrievalUri, followed.pointer, 'schema'),
          mediaType: '',
          mode: 'request',
          operation,
          region: `parameter ${key}`,
        });
        typeDisplay = schema?.typeDisplay ?? typeDisplay;
        example = exampleFromMedia(
          value,
          '',
          followed.ownerRetrievalUri,
          context.issues,
          operation,
          `parameter ${key} example`,
        );
      }
      const content = value ? asRecord(value.content) : undefined;
      if (content) {
        const mediaType = preferredMediaType(content);
        const media = mediaType ? asRecord(content[mediaType]) : undefined;
        if (mediaType && media && followed) {
          const resolved = await projectMedia(
            context,
            operation,
            {
              ownerRetrievalUri: followed.ownerRetrievalUri,
              pointer: pointerChild(pointerChild(followed.pointer, 'content'), mediaType),
              value: media,
            },
            mediaType,
            'request',
            `parameter ${key}`,
          );
          schema = resolved.schema ?? schema;
          encodings = resolved.encodings;
          notes = resolved.notes;
          example = resolved.example ?? example;
          typeDisplay = schema?.typeDisplay ?? typeDisplay;
        }
      }
    } else if (parameter.schema !== undefined || parameter.content) {
      context.issues.add({
        code: 'SCHEMA_REFERENCE_UNAVAILABLE',
        severity: 'warning',
        operation: operationLabel(operation),
        region: `parameter ${key}`,
      });
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
      ...(encodings === undefined ? {} : { encodings }),
      ...(notes === undefined ? {} : { notes }),
    });
  }
  return result;
}

function exportServers(
  document: SwaggerDoc,
  operation: MenuOperation,
  retrievalUri: string,
  issues: ExportIssueCollector,
): ExportServer[] | undefined {
  const identity = operation.identity;
  if (!identity) return undefined;
  const rootPointer = document.servers ? '#/servers' : '#';
  const selected = selectOas32Servers({
    root: { ownerRetrievalUri: retrievalUri, pointer: rootPointer, value: document.servers },
    ...(identity.pathItemMembers.servers
      ? {
          pathItem: {
            ownerRetrievalUri: identity.pathItemMembers.servers.ownerRetrievalUri,
            pointer: identity.pathItemMembers.servers.pointer,
            value: identity.pathItemMembers.servers.value,
          },
        }
      : {}),
    ...(Array.isArray(asRecord(identity.rawOperation.value)?.servers)
      ? {
          operation: {
            ownerRetrievalUri: identity.rawOperation.ownerRetrievalUri,
            pointer: `${identity.rawOperation.pointer}/servers`,
            value: asRecord(identity.rawOperation.value)?.servers,
          },
        }
      : {}),
  });
  selected.diagnostics.forEach((diagnostic) => {
    issues.add({
      code: diagnostic.code,
      severity: 'warning',
      operation: operationLabel(operation),
      region: 'servers',
    });
  });
  const servers = selected.servers.map((source) => {
    const resolved = resolveOas32Server(source);
    resolved.diagnostics.forEach((diagnostic) => {
      issues.add({
        code: diagnostic.code,
        severity: diagnostic.category === 'unsupported' ? 'info' : 'warning',
        operation: operationLabel(operation),
        region: 'servers',
      });
    });
    const value = asRecord(source.value);
    return {
      url: resolved.rawUrl ?? (typeof value?.url === 'string' ? value.url : ''),
      ...(typeof value?.name === 'string' ? { name: value.name } : {}),
      ...(typeof value?.description === 'string' ? { description: value.description } : {}),
      level: source.level,
      ...(resolved.variables.length
        ? {
            variables: resolved.variables.map((variable) => ({
              name: variable.name,
              default: String(variable.default),
              ...(variable.enum ? { enum: variable.enum.map((item) => String(item)) } : {}),
            })),
          }
        : {}),
      ...(resolved.diagnostics.length
        ? {
            notes: resolved.diagnostics.map((diagnostic) => ({
              code: diagnostic.code,
              detail: 'reason' in diagnostic ? diagnostic.reason : undefined,
            })),
          }
        : {}),
    } satisfies ExportServer;
  });
  return servers.length ? servers : undefined;
}

function exportSecurity(
  snapshot: ResourceGraphSnapshot | undefined,
  operation: MenuOperation,
  issues: ExportIssueCollector,
): { requirements?: ExportSecurityRequirement[]; schemes: ExportSecurityScheme[] } {
  if (!snapshot) return { schemes: [] };
  const projection = projectOas32Security(snapshot, operation.identity);
  if (projection.status === 'unavailable') {
    issues.add({
      code: projection.diagnostic?.code ?? 'SECURITY_UNAVAILABLE',
      severity: 'warning',
      operation: operationLabel(operation),
      region: 'security',
    });
  }
  const schemes: ExportSecurityScheme[] = projection.schemes.map((entry) => {
    if (entry.resolution.status !== 'resolved') {
      issues.add({
        code: entry.resolution.diagnostic?.code ?? 'SECURITY_SCHEME_UNAVAILABLE',
        severity: 'warning',
        operation: operationLabel(operation),
        region: `security ${entry.name}`,
      });
      return {
        name: entry.name,
        type: 'unavailable',
        notes: [{ code: entry.resolution.diagnostic?.code ?? 'SECURITY_SCHEME_UNAVAILABLE' }],
      };
    }
    const scheme = entry.resolution.scheme;
    const notes: ExportNote[] = [];
    if (scheme.oauth2MetadataUrl) notes.push({ code: 'METADATA_URL_NOT_FETCHED', detail: 'oauth2MetadataUrl' });
    if (scheme.openIdConnectUrl) notes.push({ code: 'METADATA_URL_NOT_FETCHED', detail: 'openIdConnectUrl' });
    return {
      name: entry.name,
      type: scheme.type,
      ...(typeof scheme.description === 'string' ? { description: scheme.description } : {}),
      ...(typeof scheme.in === 'string' ? { in: scheme.in } : {}),
      ...(typeof scheme.scheme === 'string' ? { scheme: scheme.scheme } : {}),
      ...(typeof scheme.bearerFormat === 'string' ? { bearerFormat: scheme.bearerFormat } : {}),
      ...(typeof scheme.oauth2MetadataUrl === 'string' ? { oauth2MetadataUrl: scheme.oauth2MetadataUrl } : {}),
      ...(typeof scheme.openIdConnectUrl === 'string' ? { openIdConnectUrl: scheme.openIdConnectUrl } : {}),
      ...(scheme.deprecated === undefined ? {} : { deprecated: scheme.deprecated }),
      ...(notes.length ? { notes } : {}),
    };
  });
  const requirements: ExportSecurityRequirement[] = projection.branches.map((branch) => {
    if (!branch.valid) {
      issues.add({
        code: branch.diagnostic?.code ?? 'INVALID_SECURITY',
        severity: 'warning',
        operation: operationLabel(operation),
        region: 'security',
      });
    }
    return {
      ...(branch.anonymous ? { anonymous: true } : {}),
      schemes: branch.members.map((member) => ({
        name: member.key,
        scopes: member.values ?? [],
      })),
      ...(branch.diagnostic ? { notes: [{ code: branch.diagnostic.code }] } : {}),
    };
  });
  return {
    ...(projection.declaration === 'absent' ? {} : { requirements }),
    schemes,
  };
}

async function buildRequestBody(
  context: OperationBuildContext,
  operation: MenuOperation,
): Promise<ExportRequestBody | undefined> {
  const location = operation.identity?.requestBodyLocation;
  if (!location && !operation.operation.requestBody) return undefined;
  if (!location) {
    context.issues.add({
      code: 'REQUEST_BODY_REFERENCE_UNAVAILABLE',
      severity: 'warning',
      operation: operationLabel(operation),
      region: 'requestBody',
    });
    return {
      description: operation.operation.requestBody?.description ?? '',
      required: Boolean(operation.operation.requestBody?.required),
      notes: [{ code: 'REQUEST_BODY_REFERENCE_UNAVAILABLE' }],
    };
  }
  const followed = followLocation(context.snapshot, location);
  if (!followed) {
    context.issues.add({
      code: 'REQUEST_BODY_REFERENCE_UNAVAILABLE',
      severity: 'warning',
      operation: operationLabel(operation),
      region: 'requestBody',
    });
    return {
      description: operation.operation.requestBody?.description ?? '',
      required: Boolean(operation.operation.requestBody?.required),
      notes: [{ code: 'REQUEST_BODY_REFERENCE_UNAVAILABLE' }],
    };
  }
  const content = asRecord(followed.value.content);
  const mediaType = content ? preferredMediaType(content) : undefined;
  const media = mediaType && content ? asRecord(content[mediaType]) : undefined;
  const projected =
    mediaType && media
      ? await projectMedia(
          context,
          operation,
          {
            ownerRetrievalUri: followed.ownerRetrievalUri,
            pointer: pointerChild(pointerChild(followed.pointer, 'content'), mediaType),
            value: media,
          },
          mediaType,
          'request',
          'requestBody',
        )
      : {};
  return {
    description: typeof followed.value.description === 'string' ? followed.value.description : '',
    required: Boolean(followed.value.required),
    ...(projected.schema === undefined ? {} : { schema: projected.schema }),
    ...(projected.example === undefined ? {} : { example: projected.example }),
    ...(projected.itemSchema === undefined ? {} : { itemSchema: projected.itemSchema }),
    ...(projected.encodings === undefined ? {} : { encodings: projected.encodings }),
    ...(projected.sequentialKind === undefined ? {} : { sequentialKind: projected.sequentialKind }),
    ...(projected.notes === undefined ? {} : { notes: projected.notes }),
  };
}

async function buildResponses(context: OperationBuildContext, operation: MenuOperation): Promise<ExportResponse[]> {
  const responses: ExportResponse[] = [];
  for (const { statusCode, location } of locateOperationResponses(context.document, operation, context.session)) {
    throwIfAborted(context.signal);
    if (!location) {
      context.issues.add({
        code: 'RESPONSE_REFERENCE_UNAVAILABLE',
        severity: 'warning',
        operation: operationLabel(operation),
        region: `response ${statusCode}`,
      });
      responses.push({ statusCode, description: '', notes: [{ code: 'RESPONSE_REFERENCE_UNAVAILABLE' }] });
      continue;
    }
    const content = asRecord(location.value.content);
    const mediaType = content ? preferredMediaType(content) : undefined;
    const media = mediaType && content ? asRecord(content[mediaType]) : undefined;
    const tokens = location.tokens;
    const projected =
      mediaType && media
        ? await projectMedia(
            context,
            operation,
            {
              ownerRetrievalUri: location.retrievalUri ?? context.retrievalUri,
              pointer: `#${tokens.length ? `/${tokens.map(encodeJsonPointerToken).join('/')}` : ''}/content/${encodeJsonPointerToken(mediaType)}`,
              value: media,
            },
            mediaType,
            'response',
            `response ${statusCode}`,
          )
        : {};
    responses.push({
      statusCode,
      description: typeof location.value.description === 'string' ? location.value.description : '',
      ...(typeof location.value.summary === 'string' ? { summary: location.value.summary } : {}),
      ...(projected.schema === undefined ? {} : { schema: projected.schema }),
      ...(projected.example === undefined ? {} : { example: projected.example }),
      ...(projected.itemSchema === undefined ? {} : { itemSchema: projected.itemSchema }),
      ...(projected.encodings === undefined ? {} : { encodings: projected.encodings }),
      ...(projected.sequentialKind === undefined ? {} : { sequentialKind: projected.sequentialKind }),
      ...(projected.notes === undefined ? {} : { notes: projected.notes }),
    });
  }
  return responses;
}

function recordPortableSnapshot(context: OperationBuildContext, operation: MenuOperation): void {
  const snapshot = context.snapshot;
  if (!snapshot) {
    context.issues.add({
      code: 'RESOURCE_GRAPH_INCOMPLETE',
      severity: 'warning',
      operation: operationLabel(operation),
      region: 'portable',
    });
    return;
  }
  const identity = operation.identity;
  const sourceKind = operation.source === 'webhook' ? 'webhook' : 'path';
  const exportContext: Oas32OperationExportContext = {
    retrievalUri: context.retrievalUri,
    snapshot,
  };
  const portable = buildOas32OperationOpenApiDocument(
    context.document,
    operation.path,
    displayMethod(operation),
    sourceKind,
    exportContext,
    identity
      ? {
          source: identity.source,
          operationPointer: identity.operationPointer,
          pathItemPointer: identity.pathItemPointer,
          methodField: identity.methodField,
          methodSource: identity.methodSource,
          ownerRetrievalUri: identity.ownerRetrievalUri,
        }
      : undefined,
  );
  if (!portable) {
    context.issues.add({
      code: 'PORTABLE_SNAPSHOT_UNAVAILABLE',
      severity: 'warning',
      operation: operationLabel(operation),
      region: 'portable',
    });
    return;
  }
  if (portable.status === 'unavailable') {
    portable.blockers.forEach((blocker) => {
      context.issues.add({
        code: blocker.code,
        severity: 'warning',
        operation: operationLabel(operation),
        region: 'portable',
        ...(blocker.referenceKind === undefined ? {} : { keyword: blocker.referenceKind }),
      });
    });
  }
}

async function buildOperation(
  context: OperationBuildContext,
  operation: MenuOperation,
  numberPath: readonly number[],
): Promise<ExportOperation> {
  throwIfAborted(context.signal);
  recordPortableSnapshot(context, operation);
  const method = displayMethod(operation);
  const parameters = await buildParameters(context, operation);
  let generated: Awaited<ReturnType<typeof generateOperationSchemaExamples>> | undefined;
  try {
    generated = await generateOperationSchemaExamples(context.document, operation, context.session, {
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
  const requestBody = await buildRequestBody(context, operation);
  if (requestBody && !requestBody.example) {
    const generatedExample = recordGeneratedExample(
      generated?.request,
      operation,
      'requestBody example',
      context.issues,
    );
    if (generatedExample) requestBody.example = generatedExample;
  }
  const responses = await buildResponses(context, operation);
  const generatedResponses = new Map((generated?.responses ?? []).map((response) => [response.statusCode, response]));
  for (const response of responses) {
    if (response.example) continue;
    const generatedExample = recordGeneratedExample(
      generatedResponses.get(response.statusCode),
      operation,
      `response ${response.statusCode} example`,
      context.issues,
    );
    if (generatedExample) response.example = generatedExample;
  }
  const security = exportSecurity(context.snapshot, operation, context.issues);
  const servers = exportServers(context.document, operation, context.retrievalUri, context.issues);
  const notes = executionExportNotes(operation, method);
  return {
    title: operation.operation.summary?.trim() || `${method} ${operation.path}`,
    numberPath,
    method,
    path: operation.path,
    summary: operation.operation.summary ?? '',
    description: operation.operation.description ?? '',
    deprecated: Boolean(operation.operation.deprecated),
    parameters,
    ...(requestBody === undefined ? {} : { requestBody }),
    responses,
    ...(operation.identity?.methodSource === undefined ? {} : { methodSource: operation.identity.methodSource }),
    ...(security.requirements === undefined ? {} : { security: security.requirements }),
    ...(servers === undefined ? {} : { servers }),
    ...(notes.length ? { notes } : {}),
  };
}

function tagMetadata(
  document: SwaggerDoc,
  name: string,
): Pick<ExportDocument['tags'][number], 'summary' | 'parent' | 'kind' | 'description'> {
  const declared = (Array.isArray(document.tags) ? document.tags : []).find((tag) => asRecord(tag)?.name === name);
  const record = asRecord(declared);
  return {
    description: typeof record?.description === 'string' ? record.description : '',
    ...(typeof record?.summary === 'string' ? { summary: record.summary } : {}),
    ...(typeof record?.parent === 'string' ? { parent: record.parent } : {}),
    ...(typeof record?.kind === 'string' ? { kind: record.kind } : {}),
  };
}

function documentServers(
  document: SwaggerDoc,
  retrievalUri: string,
  issues: ExportIssueCollector,
): ExportServer[] | undefined {
  if (!Array.isArray(document.servers) || document.servers.length === 0) return undefined;
  const selected = selectOas32Servers({
    root: { ownerRetrievalUri: retrievalUri, pointer: '#/servers', value: document.servers },
  });
  selected.diagnostics.forEach((diagnostic) => {
    issues.add({ code: diagnostic.code, severity: 'warning', region: 'servers' });
  });
  return selected.servers.map((source) => {
    const resolved = resolveOas32Server(source);
    const value = asRecord(source.value);
    resolved.diagnostics.forEach((diagnostic) => {
      issues.add({
        code: diagnostic.code,
        severity: diagnostic.category === 'unsupported' ? 'info' : 'warning',
        region: 'servers',
      });
    });
    return {
      url: resolved.rawUrl ?? (typeof value?.url === 'string' ? value.url : ''),
      ...(typeof value?.name === 'string' ? { name: value.name } : {}),
      ...(typeof value?.description === 'string' ? { description: value.description } : {}),
      level: source.level,
      ...(resolved.diagnostics.length
        ? { notes: resolved.diagnostics.map((diagnostic) => ({ code: diagnostic.code })) }
        : {}),
    };
  });
}

function documentSecuritySchemes(
  snapshot: ResourceGraphSnapshot | undefined,
  issues: ExportIssueCollector,
): ExportSecurityScheme[] | undefined {
  if (!snapshot) return undefined;
  const projection = projectOas32Security(snapshot);
  if (projection.status === 'unavailable') {
    issues.add({
      code: projection.diagnostic?.code ?? 'SECURITY_UNAVAILABLE',
      severity: 'warning',
      region: 'security',
    });
  }
  const schemes = projection.schemes.map((entry) => {
    if (entry.resolution.status !== 'resolved') {
      issues.add({
        code: entry.resolution.diagnostic?.code ?? 'SECURITY_SCHEME_UNAVAILABLE',
        severity: 'warning',
        region: `security ${entry.name}`,
      });
      return {
        name: entry.name,
        type: 'unavailable',
        notes: [{ code: entry.resolution.diagnostic?.code ?? 'SECURITY_SCHEME_UNAVAILABLE' }],
      };
    }
    const scheme = entry.resolution.scheme;
    const notes: ExportNote[] = [];
    if (scheme.oauth2MetadataUrl) notes.push({ code: 'METADATA_URL_NOT_FETCHED', detail: 'oauth2MetadataUrl' });
    if (scheme.openIdConnectUrl) notes.push({ code: 'METADATA_URL_NOT_FETCHED', detail: 'openIdConnectUrl' });
    return {
      name: entry.name,
      type: scheme.type,
      ...(typeof scheme.description === 'string' ? { description: scheme.description } : {}),
      ...(typeof scheme.in === 'string' ? { in: scheme.in } : {}),
      ...(typeof scheme.scheme === 'string' ? { scheme: scheme.scheme } : {}),
      ...(typeof scheme.bearerFormat === 'string' ? { bearerFormat: scheme.bearerFormat } : {}),
      ...(typeof scheme.oauth2MetadataUrl === 'string' ? { oauth2MetadataUrl: scheme.oauth2MetadataUrl } : {}),
      ...(typeof scheme.openIdConnectUrl === 'string' ? { openIdConnectUrl: scheme.openIdConnectUrl } : {}),
      ...(scheme.deprecated === undefined ? {} : { deprecated: scheme.deprecated }),
      ...(notes.length ? { notes } : {}),
    };
  });
  return schemes.length ? schemes : undefined;
}

export function buildOas32DegradedExportSnapshot(
  document: SwaggerDoc,
  tags: readonly MenuTag[],
  issues: readonly OfflineDocumentIssue[],
  options: { readonly fallbackTitle?: string } = {},
): OfflineDocumentSnapshot {
  return createOfflineDocumentSnapshot(buildOas32FallbackExportDocument(document, tags, options), issues);
}

export function buildOas32FallbackExportDocument(
  document: SwaggerDoc,
  tags: readonly MenuTag[],
  options: { readonly fallbackTitle?: string } = {},
): ExportDocument {
  return {
    ...registeredExportDocumentInfo(document.info, options.fallbackTitle),
    openapi: typeof document.openapi === 'string' ? document.openapi : undefined,
    tags: tags.map((tag, tagIndex) => ({
      name: tag.tag,
      ...tagMetadata(document, tag.tag),
      numberPath: [tagIndex + 1],
      operations: tag.operations.map((operation, operationIndex) => {
        const method = displayMethod(operation);
        const notes = executionExportNotes(operation, method);
        return {
          title: operation.operation.summary?.trim() || `${method} ${operation.path}`,
          numberPath: [tagIndex + 1, operationIndex + 1],
          method,
          path: operation.path,
          summary: operation.operation.summary ?? '',
          description: operation.operation.description ?? '',
          deprecated: Boolean(operation.operation.deprecated),
          parameters: (operation.operation.parameters ?? []).map((parameter) => ({
            name: parameter.name,
            location: parameter.in,
            required: Boolean(parameter.required),
            typeDisplay: [parameter.type, parameter.format].filter(Boolean).join(' / ') || '-',
            compactTypeDisplay: compactTypeDisplay(
              [parameter.type, parameter.format].filter(Boolean).join(' / ') || '-',
            ),
            description: parameter.description ?? '',
          })),
          requestBody: operation.operation.requestBody
            ? {
                description: operation.operation.requestBody.description ?? '',
                required: Boolean(operation.operation.requestBody.required),
              }
            : undefined,
          responses: Object.entries(operation.operation.responses ?? {})
            .filter(([status]) => !status.startsWith('x-'))
            .map(([statusCode, response]) => ({
              statusCode,
              description:
                typeof asRecord(response)?.description === 'string' ? String(asRecord(response)?.description) : '',
              ...(typeof asRecord(response)?.summary === 'string'
                ? { summary: String(asRecord(response)?.summary) }
                : {}),
            })),
          ...(operation.identity?.methodSource === undefined ? {} : { methodSource: operation.identity.methodSource }),
          ...(notes.length ? { notes } : {}),
        };
      }),
    })),
  };
}

/**
 * Build the one immutable model consumed by every human-readable offline
 * renderer. The builder only reads the registry-backed session and the already
 * loaded 3.2 resource graph; it never owns a loader or fetch capability.
 */
export async function buildOas32ExportSnapshot(
  document: SwaggerDoc,
  tags: readonly MenuTag[],
  session: SchemaDocumentSession,
  options: BuildOas32ExportSnapshotOptions = {},
): Promise<OfflineDocumentSnapshot> {
  if (getOpenApiSpecificationFeatures(document.openapi)?.family !== '3.2') {
    throw new TypeError('OAS 3.2 offline export snapshot requires a valid OpenAPI 3.2.x version.');
  }
  throwIfAborted(options.signal);
  const limits = effectiveExportLimits(options.limits);
  const flattened = collectRegisteredExportOperations(tags, limits.maxOperations, Oas32ExportBudgetError);
  const issues = new ExportIssueCollector(limits.maxDiagnostics, options.initialIssues ?? []);
  collectOas32DocumentDiagnostics(document).forEach((diagnostic) => {
    issues.add({
      code: diagnostic.code,
      severity: 'warning',
      region: diagnostic.path,
    });
  });
  const retrievalUri = options.retrievalUri ?? session.retrievalUri;
  const snapshot = selectOas32ExportResourceSnapshot(options.resourceSnapshot, retrievalUri, options.documentScope);
  if (options.resourceSnapshot && !snapshot) {
    issues.add({ code: 'GRAPH_STALE', severity: 'warning' });
  }
  const projector = createSchemaDisplayProjector(session);
  const fields = new ProjectedFieldBudget(limits.maxProjectedFields, Oas32ExportBudgetError);
  const context: OperationBuildContext = {
    document,
    projector,
    session,
    signal: options.signal,
    issues,
    fields,
    retrievalUri,
    snapshot,
  };
  const operations = await projectRegisteredExportOperations(flattened, (operation, numberPath) =>
    buildOperation(context, operation, numberPath),
  );
  throwIfAborted(options.signal);

  const exportDocument: ExportDocument = {
    ...registeredExportDocumentInfo(document.info, options.fallbackTitle),
    openapi: document.openapi,
    ...((): Partial<ExportDocument> => {
      const servers = documentServers(document, retrievalUri, issues);
      const securitySchemes = documentSecuritySchemes(snapshot, issues);
      return {
        ...(servers === undefined ? {} : { servers }),
        ...(securitySchemes === undefined ? {} : { securitySchemes }),
      };
    })(),
    tags: assembleRegisteredExportTags(tags, flattened, operations, (tag) => ({
      name: tag.tag,
      ...tagMetadata(document, tag.tag),
    })),
  };
  return createOfflineDocumentSnapshot(exportDocument, issues.result());
}
