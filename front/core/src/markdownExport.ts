/**
 * markdownExport.ts
 *
 * Generates a Markdown document for a single OpenAPI operation.
 * Designed to be reusable from ApiDoc copy-action (TASK-042) and
 * OfficeDoc export (TASK-043).
 */

import { buildExportOperation } from './exportDocument';
import type {
  ExportDocument,
  ExportOperation,
  ExportSchemaField,
  MdDocContext,
  MdOperationObject,
  MdRequestBodyObject,
  MdResponseObject,
  MdSchemaObject,
} from './exportDocument';

export type {
  MdSchemaObject,
  MdParameterObject,
  MdRequestBodyObject,
  MdResponseObject,
  MdOperationObject,
  MdDocContext,
} from './exportDocument';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mdTable(headers: string[], rows: string[][]): string {
  const sep = headers.map(() => '---');
  const lines = [`| ${headers.join(' | ')} |`, `| ${sep.join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)];
  return lines.join('\n');
}

function escape(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function legacyContentSchema(
  content: Record<string, { schema?: MdSchemaObject }> | undefined,
): MdSchemaObject | undefined {
  return content?.['application/json']?.schema ?? Object.values(content ?? {})[0]?.schema;
}

function legacyRequestBody(requestBody: MdRequestBodyObject | undefined): MdRequestBodyObject | undefined {
  if (!requestBody) return undefined;
  const schema = legacyContentSchema(requestBody.content);
  return {
    ...requestBody,
    content: schema ? { 'application/json': { schema } } : undefined,
  };
}

function legacyResponse(response: MdResponseObject): MdResponseObject {
  const schema =
    response.content?.['application/json']?.schema ??
    response.schema ??
    Object.values(response.content ?? {})[0]?.schema;
  return {
    description: response.description,
    content: schema ? { 'application/json': { schema } } : undefined,
  };
}

function legacyOperationSource(operation: MdOperationObject): MdOperationObject {
  return {
    ...operation,
    requestBody: legacyRequestBody(operation.requestBody),
    responses: operation.responses
      ? Object.fromEntries(
          Object.entries(operation.responses).map(([statusCode, response]) => [statusCode, legacyResponse(response)]),
        )
      : undefined,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface GenerateApiMarkdownOptions {
  method: string;
  path: string;
  operation: MdOperationObject;
  docContext: MdDocContext;
  labels?: Partial<ApiMarkdownLabels>;
  headingLevel?: MarkdownOperationHeadingLevel;
}

export interface ApiMarkdownLabels {
  /** Full-document version label. Optional for backwards compatibility. */
  version?: string;
  deprecated: string;
  requestParameters: string;
  noRequestParameters: string;
  requestBody: string;
  /** Full-document request example label. Optional for backwards compatibility. */
  requestExample?: string;
  noRequestBody: string;
  requestBodyNotExpandable: string;
  /** Full-document request/response media type label. */
  mediaType?: string;
  responseStructure: string;
  /** Full-document response example label. Optional for backwards compatibility. */
  responseExample?: string;
  noResponse: string;
  name: string;
  location: string;
  type: string;
  required: string;
  description: string;
  field: string;
  yes: string;
  no: string;
  status: string;
  schema: string;
  /** Marker appended to a field whose recursive expansion was truncated. */
  truncated?: string;
}

type ResolvedApiMarkdownLabels = Required<ApiMarkdownLabels>;

const DEFAULT_LABELS: ResolvedApiMarkdownLabels = {
  version: 'Version',
  deprecated: 'This API is deprecated.',
  requestParameters: 'Request Parameters',
  noRequestParameters: 'No request parameters.',
  requestBody: 'Request Body',
  requestExample: 'Request Example',
  noRequestBody: 'No request body.',
  requestBodyNotExpandable: 'Request body schema cannot be expanded.',
  mediaType: 'Content-Type',
  responseStructure: 'Response Structure',
  responseExample: 'Response Example',
  noResponse: 'No response defined.',
  name: 'Name',
  location: 'In',
  type: 'Type',
  required: 'Required',
  description: 'Description',
  field: 'Field',
  yes: 'Yes',
  no: 'No',
  status: 'Status',
  schema: 'Schema',
  truncated: 'Truncated',
};

export type MarkdownOperationHeadingLevel = 1 | 2 | 3 | 4;

export interface RenderExportOperationMarkdownOptions {
  labels?: Partial<ApiMarkdownLabels>;
  headingLevel?: MarkdownOperationHeadingLevel;
}

export interface RenderExportDocumentMarkdownOptions {
  labels?: Partial<ApiMarkdownLabels>;
}

interface InternalRenderExportOperationMarkdownOptions extends RenderExportOperationMarkdownOptions {
  legacySingleOperation?: boolean;
}

function resolveLabels(labels: Partial<ApiMarkdownLabels> | undefined): ResolvedApiMarkdownLabels {
  return { ...DEFAULT_LABELS, ...labels };
}

function heading(level: number, title: string): string {
  return `${'#'.repeat(Math.max(1, Math.min(6, level)))} ${title}`;
}

function markdownCodeFence(value: string): string {
  const longestBacktickRun = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
  return '`'.repeat(Math.max(3, longestBacktickRun + 1));
}

function appendExampleCodeBlock(lines: string[], value: string): void {
  const fence = markdownCodeFence(value);
  lines.push(fence, value, fence);
}

function markdownTypeDisplay(typeDisplay: string): string {
  const byteArray = typeDisplay.match(/^string \/ byte((?:\[\])*)$/);
  if (byteArray) return `byte${byteArray[1]}`;
  return typeDisplay.replace(/ \/ /g, '/');
}

function fieldType(field: ExportSchemaField, labels: ResolvedApiMarkdownLabels): string {
  const typeDisplay = markdownTypeDisplay(field.typeDisplay);
  if (!field.truncated) return typeDisplay;
  return `${typeDisplay || 'object'} (${labels.truncated})`;
}

function fieldTable(
  fields: ExportSchemaField[],
  labels: ResolvedApiMarkdownLabels,
  showTruncatedMarker = true,
): string {
  return mdTable(
    [labels.field, labels.type, labels.required, labels.description],
    fields.map((field) => [
      escape(`\`${field.fieldPath}\``),
      escape(showTruncatedMarker ? fieldType(field, labels) : markdownTypeDisplay(field.typeDisplay)),
      field.required ? labels.yes : labels.no,
      escape(field.description),
    ]),
  );
}

/**
 * Generates a Markdown string for a single API operation.
 *
 * Sections:
 *  - Title (summary or path)
 *  - Method + path badge
 *  - Description (if any)
 *  - Request Parameters table
 *  - Request Body table
 *  - Response Structure table
 */
function renderExportOperationMarkdownInternal(
  operation: ExportOperation,
  options: InternalRenderExportOperationMarkdownOptions = {},
): string {
  const labels = resolveLabels(options.labels);
  const operationHeadingLevel = options.headingLevel ?? 1;
  const sectionHeadingLevel = operationHeadingLevel + 1;
  const legacySingleOperation = Boolean(options.legacySingleOperation);
  const lines: string[] = [];

  // Title
  lines.push(heading(operationHeadingLevel, operation.title));
  lines.push('');

  // Method + path
  lines.push(`**${operation.method}** \`${operation.path}\``);
  if (operation.deprecated) lines.push('');
  if (operation.deprecated) lines.push(`> ⚠️ ${labels.deprecated}`);
  lines.push('');

  // Description
  if (operation.description) {
    lines.push(operation.description);
    lines.push('');
  }

  // Request Parameters
  lines.push(heading(sectionHeadingLevel, labels.requestParameters));
  lines.push('');
  const params = operation.parameters;
  if (params.length === 0) {
    lines.push(`_${labels.noRequestParameters}_`);
  } else {
    lines.push(
      mdTable(
        [labels.name, labels.location, labels.type, labels.required, labels.description],
        params.map((p) => [
          escape(`\`${p.name}\``),
          escape(p.location),
          escape(p.compactTypeDisplay),
          p.required ? labels.yes : labels.no,
          escape(p.description),
        ]),
      ),
    );
  }
  lines.push('');

  // Request Body
  lines.push(heading(sectionHeadingLevel, labels.requestBody));
  lines.push('');
  const requestBody = operation.requestBody;
  const requestExample = legacySingleOperation ? undefined : requestBody?.example;
  if (!requestBody?.schema && requestExample?.value === undefined) {
    lines.push(`_${labels.noRequestBody}_`);
  } else {
    const schema = requestBody?.schema;
    if (!legacySingleOperation) {
      const mediaType = schema?.mediaType ?? requestExample?.mediaType;
      const metadata = [
        ...(mediaType ? [`**${labels.mediaType}:** \`${escape(mediaType)}\``] : []),
        ...(schema ? [`**${labels.type}:** \`${escape(markdownTypeDisplay(schema.typeDisplay))}\``] : []),
        `**${labels.required}:** ${requestBody?.required ? labels.yes : labels.no}`,
      ];
      lines.push(metadata.join(' · '));
      lines.push('');
    }
    if (!legacySingleOperation && requestBody?.description) {
      lines.push(requestBody.description);
      lines.push('');
    }
    if (schema) {
      const requestFields = legacySingleOperation ? schema.shallowFields : schema.fields;
      if (requestFields.length === 0) {
        lines.push(`_${labels.requestBodyNotExpandable}_`);
      } else {
        lines.push(fieldTable(requestFields, labels, !legacySingleOperation));
      }
    }
    if (requestExample?.value !== undefined) {
      if (lines[lines.length - 1] !== '') lines.push('');
      lines.push(heading(sectionHeadingLevel + 1, labels.requestExample));
      lines.push('');
      lines.push(`**${labels.mediaType}:** \`${escape(requestExample.mediaType)}\``);
      lines.push('');
      appendExampleCodeBlock(lines, requestExample.value);
    }
  }
  lines.push('');

  // Response Structure
  lines.push(heading(sectionHeadingLevel, labels.responseStructure));
  lines.push('');
  const responses = operation.responses;
  if (responses.length === 0) {
    lines.push(`_${labels.noResponse}_`);
  } else {
    lines.push(
      mdTable(
        [labels.status, labels.description, labels.schema],
        responses.map((response) => [
          escape(response.statusCode),
          escape(response.description),
          escape(markdownTypeDisplay(response.schema?.typeDisplay ?? '')),
        ]),
      ),
    );

    if (!legacySingleOperation) {
      for (const response of responses) {
        const schema = response.schema;
        const fields = schema?.fields ?? [];
        if (schema && fields.length > 0) {
          lines.push('');
          lines.push(heading(sectionHeadingLevel + 1, `${labels.status} \`${escape(response.statusCode)}\``));
          lines.push('');
          lines.push(
            `**${labels.mediaType}:** \`${escape(schema.mediaType)}\` · **${labels.type}:** \`${escape(
              markdownTypeDisplay(schema.typeDisplay),
            )}\``,
          );
          lines.push('');
          lines.push(fieldTable(fields, labels));
        }
        if (response.example?.value !== undefined) {
          lines.push('');
          lines.push(heading(sectionHeadingLevel + 1, `${labels.responseExample} \`${escape(response.statusCode)}\``));
          lines.push('');
          lines.push(`**${labels.mediaType}:** \`${escape(response.example.mediaType)}\``);
          lines.push('');
          appendExampleCodeBlock(lines, response.example.value);
        }
      }
    }
  }
  lines.push('');

  return lines.join('\n');
}

export function renderExportOperationMarkdown(
  operation: ExportOperation,
  options: RenderExportOperationMarkdownOptions = {},
): string {
  return renderExportOperationMarkdownInternal(operation, options);
}

/** Render a complete offline Markdown document from the shared export model. */
export function renderExportDocumentMarkdown(
  document: ExportDocument,
  options: RenderExportDocumentMarkdownOptions = {},
): string {
  const labels = resolveLabels(options.labels);
  const sections: string[] = [`# ${document.title}`, ''];

  if (document.version) {
    sections.push(`**${labels.version}:** ${document.version}`);
    sections.push('');
  }
  if (document.description) {
    sections.push(document.description);
    sections.push('');
  }

  for (const tag of document.tags) {
    sections.push(`# ${tag.name}`);
    if (tag.description) sections.push(tag.description);
    sections.push('');

    for (const operation of tag.operations) {
      sections.push(
        renderExportOperationMarkdown(operation, {
          labels,
          headingLevel: 2,
        }),
      );
      sections.push('---');
      sections.push('');
    }
  }

  return sections.join('\n');
}

/**
 * Compatibility entry point for the single-operation copy action.
 *
 * The raw OpenAPI operation is normalized by the same builder used by the
 * complete document, while the default heading level intentionally remains H1.
 */
export function generateApiMarkdown(opts: GenerateApiMarkdownOptions): string {
  const model = buildExportOperation(
    {
      method: opts.method,
      path: opts.path,
      operation: legacyOperationSource(opts.operation),
      title: opts.operation.summary ?? opts.path,
    },
    opts.docContext,
  );
  return renderExportOperationMarkdownInternal(model, {
    labels: opts.labels,
    headingLevel: opts.headingLevel ?? 1,
    legacySingleOperation: true,
  });
}
