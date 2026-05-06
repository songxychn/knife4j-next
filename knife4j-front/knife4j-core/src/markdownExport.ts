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
  if (schema.type === 'object' || schema.properties) return 'object';
  const parts = [schema.type, schema.format].filter((v): v is string => typeof v === 'string' && v.length > 0);
  return parts.join('/') || 'object';
}

function paramType(p: MdParameterObject): string {
  if (p.schema) return schemaName(p.schema);
  const parts = [p.type, p.format].filter((v): v is string => typeof v === 'string' && v.length > 0);
  return parts.join('/') || '-';
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
): Array<{ name: string; type: string; required: boolean; description: string }> {
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
export function generateApiMarkdown(opts: GenerateApiMarkdownOptions): string {
  const { method, path, operation, docContext } = opts;
  const m = method.toUpperCase();
  const op = operation;

  const lines: string[] = [];

  // Title
  lines.push(`# ${op.summary ?? path}`);
  lines.push('');

  // Method + path
  lines.push(`**${m}** \`${path}\``);
  if (op.deprecated) lines.push('');
  if (op.deprecated) lines.push('> ⚠️ This API is deprecated.');
  lines.push('');

  // Description
  if (op.description) {
    lines.push(op.description);
    lines.push('');
  }

  // Request Parameters
  lines.push('## Request Parameters');
  lines.push('');
  const params = op.parameters ?? [];
  if (params.length === 0) {
    lines.push('_No request parameters._');
  } else {
    lines.push(
      mdTable(
        ['Name', 'In', 'Type', 'Required', 'Description'],
        params.map((p) => [
          escape(`\`${p.name}\``),
          escape(p.in),
          escape(paramType(p)),
          p.required ? 'Yes' : 'No',
          escape(p.description ?? ''),
        ]),
      ),
    );
  }
  lines.push('');

  // Request Body
  lines.push('## Request Body');
  lines.push('');
  const bodySchema = firstRequestSchema(op.requestBody);
  if (!bodySchema) {
    lines.push('_No request body._');
  } else {
    const rows = bodyRows(bodySchema, docContext);
    if (rows.length === 0) {
      lines.push('_Request body schema cannot be expanded._');
    } else {
      lines.push(
        mdTable(
          ['Field', 'Type', 'Required', 'Description'],
          rows.map((r) => [escape(`\`${r.name}\``), escape(r.type), r.required ? 'Yes' : 'No', escape(r.description)]),
        ),
      );
    }
  }
  lines.push('');

  // Response Structure
  lines.push('## Response Structure');
  lines.push('');
  const responses = Object.entries(op.responses ?? {});
  if (responses.length === 0) {
    lines.push('_No response defined._');
  } else {
    lines.push(
      mdTable(
        ['Status', 'Description', 'Schema'],
        responses.map(([code, r]) => [escape(code), escape(r.description ?? ''), escape(responseSchemaName(r))]),
      ),
    );
  }
  lines.push('');

  return lines.join('\n');
}
