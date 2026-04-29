/**
 * scriptGenerator.ts
 *
 * Generates JavaScript and TypeScript client code from an OAS3 operation.
 * Pure string-based generation — no AST dependencies required.
 */

import type { OperationObject, ParameterObject, SchemaObject, SwaggerDoc } from '../types/swagger';

export interface ScriptConfig {
  name: string;
  method: string;
  url: string;
  summary: string;
  pathParams: Array<{ name: string; type: string }>;
  queryParams: Array<{ name: string; type: string }>;
  bodySchema: SchemaObject | null;
  responseSchema: SchemaObject | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function upperFirst(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Sanitise an operationId / path segment into a valid JS identifier. */
function toIdentifier(raw: string): string {
  // strip leading non-alpha, replace non-alphanumeric runs with _
  return raw
    .replace(/[^a-zA-Z0-9_$]/g, '_')
    .replace(/^[^a-zA-Z_$]+/, '')
    .replace(/_+/g, '_')
    .replace(/_$/, '');
}

/** Map an OAS3 schema type to a TypeScript type string. */
function oasTypeToTs(schema: SchemaObject | undefined, depth = 0): string {
  if (!schema) return 'unknown';
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop() ?? 'unknown';
    return name;
  }
  switch (schema.type) {
    case 'string':
      return schema.enum ? schema.enum.map((v) => JSON.stringify(v)).join(' | ') : 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return `${oasTypeToTs(schema.items, depth)}[]`;
    case 'object': {
      if (!schema.properties || depth > 3) return 'Record<string, unknown>';
      const props = Object.entries(schema.properties)
        .map(([k, v]) => {
          const required = Array.isArray(schema.required) && schema.required.includes(k);
          return `  ${k}${required ? '' : '?'}: ${oasTypeToTs(v as SchemaObject, depth + 1)};`;
        })
        .join('\n');
      return `{\n${props}\n}`;
    }
    default:
      return 'unknown';
  }
}

/** Map an OAS3 schema type to a JS type comment string. */
function oasTypeToJs(schema: SchemaObject | undefined): string {
  if (!schema) return 'any';
  if (schema.$ref) return 'object';
  switch (schema.type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'Array';
    case 'object':
      return 'object';
    default:
      return 'any';
  }
}

/** Build a template-literal URL string, e.g. `` `/users/${id}` `` */
function buildUrlExpression(url: string, pathParams: Array<{ name: string }>): string {
  if (pathParams.length === 0) return `'${url}'`;
  const interpolated = url.replace(/\{([^}]+)\}/g, (_, name) => `\${${name}}`);
  return `\`${interpolated}\``;
}

// ---------------------------------------------------------------------------
// Resolve schema from doc
// ---------------------------------------------------------------------------

function resolveSchema(schema: SchemaObject | undefined, doc: SwaggerDoc): SchemaObject | undefined {
  if (!schema) return undefined;
  if (schema.$ref) {
    const match = schema.$ref.match(/^#\/components\/schemas\/(.+)$/) ?? schema.$ref.match(/^#\/definitions\/(.+)$/);
    if (match) {
      return (doc.components?.schemas ?? doc.definitions ?? {})[match[1]] as SchemaObject | undefined;
    }
    return undefined;
  }
  return schema;
}

function firstBodySchema(op: OperationObject, doc: SwaggerDoc): SchemaObject | null {
  // OAS3 requestBody
  if (op.requestBody?.content) {
    const schema =
      op.requestBody.content['application/json']?.schema ?? Object.values(op.requestBody.content)[0]?.schema;
    if (schema) return resolveSchema(schema as SchemaObject, doc) ?? (schema as SchemaObject);
  }
  // OAS2 body parameter
  const bodyParam = (op.parameters ?? []).find((p) => p.in === 'body');
  if (bodyParam?.schema)
    return resolveSchema(bodyParam.schema as SchemaObject, doc) ?? (bodyParam.schema as SchemaObject);
  return null;
}

function firstResponseSchema(op: OperationObject, doc: SwaggerDoc): SchemaObject | null {
  const resp = op.responses?.['200'] ?? op.responses?.['201'] ?? Object.values(op.responses ?? {})[0];
  if (!resp) return null;
  const schema =
    resp.content?.['application/json']?.schema ??
    resp.schema ??
    (resp.content ? Object.values(resp.content)[0]?.schema : undefined);
  if (!schema) return null;
  return resolveSchema(schema as SchemaObject, doc) ?? (schema as SchemaObject);
}

// ---------------------------------------------------------------------------
// Public: build ScriptConfig from operation
// ---------------------------------------------------------------------------

export function buildScriptConfig(method: string, path: string, op: OperationObject, doc: SwaggerDoc): ScriptConfig {
  const rawName = op.operationId ?? path.replace(/[^a-zA-Z0-9]/g, '_');
  // strip "Using..." suffix like Vue3 does
  const name = toIdentifier(rawName.split('Using')[0]);

  const pathParams: ScriptConfig['pathParams'] = [];
  const queryParams: ScriptConfig['queryParams'] = [];

  for (const param of (op.parameters ?? []) as ParameterObject[]) {
    const tsType = oasTypeToTs(param.schema as SchemaObject | undefined);
    if (param.in === 'path') {
      pathParams.push({ name: param.name, type: tsType });
    } else if (param.in === 'query') {
      queryParams.push({ name: param.name, type: tsType });
    }
  }

  return {
    name,
    method: method.toLowerCase(),
    url: path,
    summary: op.summary ?? path,
    pathParams,
    queryParams,
    bodySchema: firstBodySchema(op, doc),
    responseSchema: firstResponseSchema(op, doc),
  };
}

// ---------------------------------------------------------------------------
// JavaScript code generation
// ---------------------------------------------------------------------------

export function generateJsCode(config: ScriptConfig): string {
  const { name, method, url, summary, pathParams, queryParams, bodySchema } = config;

  const allParams = [...pathParams, ...queryParams];
  const hasBody = bodySchema !== null;

  // JSDoc comment
  let code = `/**\n * ${summary}\n`;
  for (const p of allParams) {
    code += ` * @param {${oasTypeToJs(undefined)}} ${p.name}\n`;
  }
  if (hasBody) {
    code += ` * @param {object} params\n`;
  }
  code += ` * @returns {Promise<any>}\n */\n`;

  // Function signature
  const paramList = [...allParams.map((p) => p.name), ...(hasBody ? ['params'] : [])].join(', ');
  code += `export function ${name}(${paramList}) {\n`;

  // URL
  const urlExpr = buildUrlExpression(url, pathParams);

  // Query string
  if (queryParams.length > 0) {
    const qPairs = queryParams.map((p) => `${p.name}=\${${p.name}}`).join('&');
    if (pathParams.length > 0) {
      code += `  const url = \`${url.replace(/\{([^}]+)\}/g, (_, n) => `\${${n}}`)}?${qPairs}\`;\n`;
    } else {
      code += `  const url = \`${url}?${qPairs}\`;\n`;
    }
    if (hasBody) {
      code += `  return request.${method}(url, params);\n`;
    } else {
      code += `  return request.${method}(url);\n`;
    }
  } else {
    if (hasBody) {
      code += `  return request.${method}(${urlExpr}, params);\n`;
    } else {
      code += `  return request.${method}(${urlExpr});\n`;
    }
  }

  code += `}\n`;
  return code;
}

// ---------------------------------------------------------------------------
// TypeScript code generation
// ---------------------------------------------------------------------------

function generateTsInterface(schema: SchemaObject | null, name: string, optional: boolean): string {
  if (!schema) return '';
  if (schema.type === 'object' && schema.properties) {
    const props = Object.entries(schema.properties)
      .map(([k, v]) => {
        const required = !optional && Array.isArray(schema.required) && schema.required.includes(k);
        const tsType = oasTypeToTs(v as SchemaObject, 1);
        return `  ${k}${required ? '' : '?'}: ${tsType};`;
      })
      .join('\n');
    return `export interface ${name} {\n${props}\n}\n\n`;
  }
  if (schema.type === 'array' && schema.items) {
    const itemType = oasTypeToTs(schema.items as SchemaObject, 0);
    return `export type ${name} = ${itemType}[];\n\n`;
  }
  // fallback: alias
  const tsType = oasTypeToTs(schema, 0);
  return `export type ${name} = ${tsType};\n\n`;
}

export function generateTsCode(config: ScriptConfig): string {
  const { name, method, url, summary, pathParams, queryParams, bodySchema, responseSchema } = config;

  const interfaceName = upperFirst(name);
  let code = '';

  // Params interface
  if (bodySchema) {
    code += `// 参数接口\n`;
    code += generateTsInterface(bodySchema, `${interfaceName}Params`, true);
  }

  // Response interface
  if (responseSchema) {
    code += `// 响应接口\n`;
    code += generateTsInterface(responseSchema, `${interfaceName}Res`, false);
  }

  const allParams = [...pathParams, ...queryParams];
  const hasBody = bodySchema !== null;
  const resType = responseSchema
    ? responseSchema.type === 'array'
      ? `${interfaceName}Res[]`
      : `${interfaceName}Res`
    : 'unknown';

  // JSDoc
  code += `/**\n * ${summary}\n`;
  for (const p of allParams) {
    code += ` * @param ${p.name}\n`;
  }
  if (hasBody) code += ` * @param params\n`;
  code += ` */\n`;

  // Function signature
  const tsParamList = [
    ...allParams.map((p) => `${p.name}: ${p.type}`),
    ...(hasBody ? [`params: ${interfaceName}Params`] : []),
  ].join(', ');

  code += `export function ${name}(${tsParamList}): Promise<${resType}> {\n`;

  // URL
  const urlExpr = buildUrlExpression(url, pathParams);

  if (queryParams.length > 0) {
    const qPairs = queryParams.map((p) => `${p.name}=\${${p.name}}`).join('&');
    if (pathParams.length > 0) {
      code += `  const url = \`${url.replace(/\{([^}]+)\}/g, (_, n) => `\${${n}}`)}?${qPairs}\`;\n`;
    } else {
      code += `  const url = \`${url}?${qPairs}\`;\n`;
    }
    if (hasBody) {
      code += `  return request.${method}(url, params);\n`;
    } else {
      code += `  return request.${method}(url);\n`;
    }
  } else {
    if (hasBody) {
      code += `  return request.${method}(${urlExpr}, params);\n`;
    } else {
      code += `  return request.${method}(${urlExpr});\n`;
    }
  }

  code += `}\n`;
  return code;
}
