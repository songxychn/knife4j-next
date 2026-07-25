/**
 * markdownExport.ts
 *
 * Generates a Markdown document for a single OpenAPI operation.
 * Designed to be reusable from ApiDoc copy-action (TASK-042) and
 * OfficeDoc export (TASK-043).
 */

// ── Minimal local type aliases (mirrors knife4j-ui-react swagger types) ──────

export interface MdSchemaObject {
  type?: string;
  format?: string;
  description?: string;
  properties?: Record<string, MdSchemaObject>;
  items?: MdSchemaObject;
  $ref?: string;
  required?: string[];
  enum?: unknown[];
}

export interface MdParameterObject {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: MdSchemaObject;
  type?: string;
  format?: string;
}

export interface MdRequestBodyObject {
  description?: string;
  required?: boolean;
  content?: Record<string, { schema?: MdSchemaObject }>;
}

export interface MdResponseObject {
  description?: string;
  content?: Record<string, { schema?: MdSchemaObject }>;
  schema?: MdSchemaObject; // OAS2
}

export interface MdOperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: MdParameterObject[];
  requestBody?: MdRequestBodyObject;
  responses?: Record<string, MdResponseObject>;
  deprecated?: boolean;
}

export interface MdDocContext {
  components?: { schemas?: Record<string, MdSchemaObject> };
  definitions?: Record<string, MdSchemaObject>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveRef(ref: string, ctx: MdDocContext): MdSchemaObject | undefined {
  const m = ref.match(/^#\/components\/schemas\/(.+)$/) ?? ref.match(/^#\/definitions\/(.+)$/);
  if (!m) return undefined;
  return (ctx.components?.schemas ?? ctx.definitions ?? {})[m[1]];
}

function schemaName(schema?: MdSchemaObject): string {
  if (!schema) return '';
  if (schema.$ref) return schema.$ref.split('/').pop() ?? '$ref';
  if (schema.type === 'array') return `${schemaName(schema.items) || 'object'}[]`;
  // string+byte is the OAS representation of Java Byte — display as 'byte' for clarity
  if (schema.type === 'string' && schema.format === 'byte') return 'byte';
  return [schema.type, schema.format].filter(Boolean).join('/') || 'object';
}

function paramType(p: MdParameterObject): string {
  return schemaName(p.schema) || [p.type, p.format].filter(Boolean).join('/') || '-';
}

function firstRequestSchema(rb: MdRequestBodyObject | undefined): MdSchemaObject | undefined {
  if (!rb?.content) return undefined;
  return rb.content['application/json']?.schema ?? Object.values(rb.content)[0]?.schema;
}

function responseSchemaName(r: MdResponseObject): string {
  const s = r.content?.['application/json']?.schema ?? r.schema ?? Object.values(r.content ?? {})[0]?.schema;
  return schemaName(s);
}

function bodyRows(
  schema: MdSchemaObject,
  ctx: MdDocContext,
): Array<{
  name: string;
  type: string;
  required: boolean;
  description: string;
}> {
  const resolved = schema.$ref ? resolveRef(schema.$ref, ctx) : schema;
  if (!resolved?.properties) return [];
  const req = new Set(resolved.required ?? []);
  return Object.entries(resolved.properties).map(([name, prop]) => ({
    name,
    type: schemaName(prop),
    required: req.has(name),
    description: prop.description ?? '',
  }));
}

function mdTable(headers: string[], rows: string[][]): string {
  const sep = headers.map(() => '---');
  const lines = [`| ${headers.join(' | ')} |`, `| ${sep.join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)];
  return lines.join('\n');
}

function escape(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface GenerateApiMarkdownOptions {
  method: string;
  path: string;
  operation: MdOperationObject;
  docContext: MdDocContext;
  labels?: Partial<ApiMarkdownLabels>;
}

export interface ApiMarkdownLabels {
  deprecated: string;
  requestParameters: string;
  noRequestParameters: string;
  requestBody: string;
  noRequestBody: string;
  requestBodyNotExpandable: string;
  responseStructure: string;
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
}

const DEFAULT_LABELS: ApiMarkdownLabels = {
  deprecated: 'This API is deprecated.',
  requestParameters: 'Request Parameters',
  noRequestParameters: 'No request parameters.',
  requestBody: 'Request Body',
  noRequestBody: 'No request body.',
  requestBodyNotExpandable: 'Request body schema cannot be expanded.',
  responseStructure: 'Response Structure',
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
};

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
export function generateApiMarkdown(opts: GenerateApiMarkdownOptions): string {
  const { method, path, operation, docContext } = opts;
  const labels = { ...DEFAULT_LABELS, ...opts.labels };
  const m = method.toUpperCase();
  const op = operation;

  const lines: string[] = [];

  // Title
  lines.push(`# ${op.summary ?? path}`);
  lines.push('');

  // Method + path
  lines.push(`**${m}** \`${path}\``);
  if (op.deprecated) lines.push('');
  if (op.deprecated) lines.push(`> ⚠️ ${labels.deprecated}`);
  lines.push('');

  // Description
  if (op.description) {
    lines.push(op.description);
    lines.push('');
  }

  // Request Parameters
  lines.push(`## ${labels.requestParameters}`);
  lines.push('');
  const params = op.parameters ?? [];
  if (params.length === 0) {
    lines.push(`_${labels.noRequestParameters}_`);
  } else {
    lines.push(
      mdTable(
        [labels.name, labels.location, labels.type, labels.required, labels.description],
        params.map((p) => [
          escape(`\`${p.name}\``),
          escape(p.in),
          escape(paramType(p)),
          p.required ? labels.yes : labels.no,
          escape(p.description ?? ''),
        ]),
      ),
    );
  }
  lines.push('');

  // Request Body
  lines.push(`## ${labels.requestBody}`);
  lines.push('');
  const bodySchema = firstRequestSchema(op.requestBody);
  if (!bodySchema) {
    lines.push(`_${labels.noRequestBody}_`);
  } else {
    const rows = bodyRows(bodySchema, docContext);
    if (rows.length === 0) {
      lines.push(`_${labels.requestBodyNotExpandable}_`);
    } else {
      lines.push(
        mdTable(
          [labels.field, labels.type, labels.required, labels.description],
          rows.map((r) => [
            escape(`\`${r.name}\``),
            escape(r.type),
            r.required ? labels.yes : labels.no,
            escape(r.description),
          ]),
        ),
      );
    }
  }
  lines.push('');

  // Response Structure
  lines.push(`## ${labels.responseStructure}`);
  lines.push('');
  const responses = Object.entries(op.responses ?? {});
  if (responses.length === 0) {
    lines.push(`_${labels.noResponse}_`);
  } else {
    lines.push(
      mdTable(
        [labels.status, labels.description, labels.schema],
        responses.map(([code, r]) => [escape(code), escape(r.description ?? ''), escape(responseSchemaName(r))]),
      ),
    );
  }
  lines.push('');

  return lines.join('\n');
}
