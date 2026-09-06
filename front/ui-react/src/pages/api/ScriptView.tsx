import { operationSchemaDocuments } from '../../schema/operationRegistry';
import type { OperationSchemaDocuments } from 'knife4j-core';
import { getOpenApiSpecificationFeatures } from 'knife4j-core';
import { browserRequestConstraint } from './browserRequestConstraints';
import { operationHttpMethod } from 'knife4j-core';
import { useMemo, useState } from 'react';
import { normalizeAllOfSchema } from 'knife4j-core';
import { Alert, Radio, Space, Spin, Typography, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { OperationModeLayout, useCurrentOperation } from './useCurrentOperation';
import CodeBlock from './CodeBlock';
import { copyToClipboard } from '../../utils/clipboard';
import type { ParameterObject, SchemaObject, SwaggerDoc } from '../../types/swagger';

const { Title } = Typography;

// ---------------------------------------------------------------------------
// OAS3-aware code generator (pure TypeScript, no AST library needed)
// ---------------------------------------------------------------------------

type Lang = 'js' | 'ts';

interface ParamInfo {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie' | 'body' | 'formData' | string;
  required?: boolean;
  schema?: SchemaObject | boolean;
  description?: string;
}

function resolveSchema(
  schema: SchemaObject | undefined,
  doc: Pick<SwaggerDoc, 'openapi' | 'components' | 'definitions'>,
  depth = 0,
): SchemaObject | undefined {
  if (!schema || depth > 8) return schema;
  return normalizeAllOfSchema(
    schema as Record<string, unknown>,
    doc as unknown as Record<string, unknown>,
    8 - depth,
  ) as SchemaObject;
}

function schemaToTsType(
  schema: SchemaObject | boolean | undefined,
  doc: Pick<SwaggerDoc, 'components' | 'definitions'>,
  depth = 0,
): string {
  if (schema === undefined || depth > 6) return 'unknown';
  if (typeof schema === 'boolean') return schema ? 'unknown' : 'never';
  const resolved = resolveSchema(schema, doc, 0);
  if (!resolved) return 'unknown';

  if (resolved.$ref) {
    const name = resolved.$ref.split('/').pop();
    return name ?? 'unknown';
  }

  const declaredTypes = Array.isArray(resolved.type) ? resolved.type : resolved.type ? [resolved.type] : [];
  const type = declaredTypes.find((value) => value !== 'null') ?? declaredTypes[0];
  const nullable = declaredTypes.includes('null');
  const withNullable = (value: string) => (nullable ? `${value} | null` : value);
  if (type === 'string') return withNullable(resolved.format === 'date-time' ? 'string /* date-time */' : 'string');
  if (type === 'integer' || type === 'number') return withNullable('number');
  if (type === 'boolean') return withNullable('boolean');
  if (type === 'array') {
    const itemType = schemaToTsType(resolved.items, doc, depth + 1);
    return withNullable(`${itemType.includes('|') ? `(${itemType})` : itemType}[]`);
  }
  if (type === 'object' || resolved.properties) {
    if (!resolved.properties) return withNullable('Record<string, unknown>');
    const props = Object.entries(resolved.properties)
      .map(([k, v]) => {
        const required = Array.isArray(resolved.required) && resolved.required.includes(k);
        return `  ${k}${required ? '' : '?'}: ${schemaToTsType(v, doc, depth + 1)};`;
      })
      .join('\n');
    return withNullable(`{\n${props}\n}`);
  }
  return 'unknown';
}

function upperFirst(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Derive a camelCase function name from operationId or method+path */
function deriveFunctionName(operationId: string | undefined, method: string, path: string): string {
  if (operationId) {
    // strip common suffixes like "UsingGET", "UsingPOST"
    return operationId.replace(/Using(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE)(_\d+)?$/i, '');
  }
  // fallback: methodPathSegments
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((s) => s.replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]/g, '_'))
    .filter(Boolean);
  return method.toLowerCase() + segments.map(upperFirst).join('');
}

/** Build a template-literal URL string for JS/TS */
function buildUrlExpression(path: string, pathParams: ParamInfo[]): string {
  if (pathParams.length === 0) return `'${path}'`;
  // replace {param} with ${param}
  const tpl = path.replace(/\{([^}]+)\}/g, '${$1}');
  return `\`${tpl}\``;
}

interface GeneratedCode {
  js: string;
  ts: string;
}

export interface CodeCommentLabels {
  requestBody: string;
  requestInterface: string;
  requestType: string;
  responseInterface: string;
  responseType: string;
}

// eslint-disable-next-line react-refresh/only-export-components
export function generateCode(
  method: string,
  path: string,
  operationId: string | undefined,
  summary: string | undefined,
  parameters: ParameterObject[],
  requestBodySchema: SchemaObject | undefined,
  responseSchema: SchemaObject | undefined,
  doc: SwaggerDoc,
  labels: CodeCommentLabels,
  schemaDocuments?: OperationSchemaDocuments,
): GeneratedCode {
  const uses32 = getOpenApiSpecificationFeatures(doc.openapi)?.family === '3.2';
  const requestDocument = (schemaDocuments?.requestBody ?? doc) as SwaggerDoc;
  const responseDocument = (schemaDocuments?.responses.values().next().value ??
    schemaDocuments?.operation ??
    doc) as SwaggerDoc;
  const exactMethodName = method.replace(/[^a-zA-Z0-9]/g, (character) => `_x${character.charCodeAt(0).toString(16)}_`);
  const fnName = uses32
    ? `operation_${operationId ? operationId.replace(/[^a-zA-Z0-9]/g, (character) => `_x${character.charCodeAt(0).toString(16)}_`) : exactMethodName + deriveFunctionName(undefined, '', path)}`
    : deriveFunctionName(operationId, method, path);
  const interfaceName = upperFirst(fnName);

  const pathParams = parameters.filter((p) => p.in === 'path');
  const queryParams = parameters.filter((p) => p.in === 'query');
  const hasBody = !!requestBodySchema;

  // ---- JS ----
  const jsParamList: string[] = [
    ...pathParams.map((p) => p.name),
    ...queryParams.map((p) => p.name),
    ...(hasBody ? ['params'] : []),
  ];

  const jsQueryStr =
    queryParams.length > 0 ? `\n  const query = { ${queryParams.map((p) => p.name).join(', ')} };` : '';

  const jsRequestArgs: string[] = [buildUrlExpression(path, pathParams)];
  if (queryParams.length > 0) jsRequestArgs.push('query');
  if (hasBody) jsRequestArgs.push('params');

  const requestCall = (typescript: boolean): string => {
    if (!uses32) return `request.${method.toLowerCase()}(${jsRequestArgs.join(', ')})`;
    const constraint = browserRequestConstraint(method, hasBody);
    if (constraint)
      return `Promise.reject(new TypeError(${JSON.stringify(`Fetch cannot send the documented ${method} request (${constraint}); use the cURL preview.`)}))`;
    const url = queryParams.length
      ? `${buildUrlExpression(path, pathParams)} + '?' + new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))`
      : buildUrlExpression(path, pathParams);
    const init = [
      `method: ${JSON.stringify(method)}`,
      ...(hasBody ? [`headers: { 'Content-Type': 'application/json' }`, 'body: JSON.stringify(params)'] : []),
    ];
    return `fetch(${url}, { ${init.join(', ')} }).then(response => response.json()${typescript ? ' as Promise<' + resType + '>' : ''})`;
  };

  const jsComment = [
    `/**`,
    ` * ${summary ?? fnName}`,
    ...pathParams.map((p) => ` * @param {string} ${p.name} ${p.description ?? ''}`),
    ...queryParams.map((p) => ` * @param {string} ${p.name} ${p.description ?? ''}`),
    ...(hasBody ? [` * @param {object} params ${labels.requestBody}`] : []),
    ` * @returns {Promise}`,
    ` */`,
  ].join('\n');

  const jsBody = [
    jsComment,
    `export function ${fnName}(${jsParamList.join(', ')}) {${jsQueryStr}`,
    `  return ${requestCall(false)};`,
    `}`,
  ].join('\n');

  // ---- TS interfaces ----
  let tsParamsInterface = '';
  if (hasBody && requestBodySchema) {
    const resolved = resolveSchema(requestBodySchema, requestDocument);
    const resolvedType = Array.isArray(resolved?.type)
      ? resolved.type.find((value) => value !== 'null')
      : resolved?.type;
    if (resolvedType === 'object' || resolved?.properties) {
      const props = Object.entries(resolved?.properties ?? {})
        .map(([k, v]) => {
          const req = Array.isArray(resolved?.required) && resolved.required.includes(k);
          return `  ${k}${req ? '' : '?'}: ${schemaToTsType(v, requestDocument)};`;
        })
        .join('\n');
      tsParamsInterface = `// ${labels.requestInterface}\nexport interface ${interfaceName}Params {\n${props}\n}\n\n`;
    } else if (resolvedType === 'array' || (uses32 && resolvedType)) {
      tsParamsInterface = `// ${labels.requestType}\nexport type ${interfaceName}Params = ${schemaToTsType(resolved, requestDocument)};\n\n`;
    }
  }

  let tsResInterface = '';
  if (responseSchema) {
    const resolved = resolveSchema(responseSchema, responseDocument);
    const resolvedType = Array.isArray(resolved?.type)
      ? resolved.type.find((value) => value !== 'null')
      : resolved?.type;
    if (resolvedType === 'object' || resolved?.properties) {
      const props = Object.entries(resolved?.properties ?? {})
        .map(([k, v]) => {
          const req = Array.isArray(resolved?.required) && resolved.required.includes(k);
          return `  ${k}${req ? '' : '?'}: ${schemaToTsType(v, responseDocument)};`;
        })
        .join('\n');
      tsResInterface = `// ${labels.responseInterface}\nexport interface ${interfaceName}Res {\n${props}\n}\n\n`;
    } else if (resolvedType === 'array' || (uses32 && resolvedType)) {
      tsResInterface = `// ${labels.responseType}\nexport type ${interfaceName}Res = ${schemaToTsType(resolved, responseDocument)};\n\n`;
    }
  }

  // TS function params with type annotations
  const tsParamList: string[] = [
    ...pathParams.map((p) => `${p.name}: string`),
    ...queryParams.map((p) => {
      const t = schemaToTsType(
        p.schema,
        (schemaDocuments?.parameters.get(`${p.in}:${p.name}`) ?? schemaDocuments?.operation ?? doc) as SwaggerDoc,
      );
      return uses32 ? `${p.name}: ${t}${p.required ? '' : ' | undefined'}` : `${p.name}${p.required ? '' : '?'}: ${t}`;
    }),
    ...(hasBody ? [`params: ${tsParamsInterface ? `${interfaceName}Params` : 'Record<string, unknown>'}`] : []),
  ];

  const resType = tsResInterface ? `${interfaceName}Res` : 'unknown';
  const tsQueryStr =
    queryParams.length > 0
      ? `\n  const query: Record<string, unknown> = { ${queryParams.map((p) => p.name).join(', ')} };`
      : '';

  const tsComment = [
    `/**`,
    ` * ${summary ?? fnName}`,
    ...pathParams.map((p) => ` * @param ${p.name} ${p.description ?? ''}`),
    ...queryParams.map((p) => ` * @param ${p.name} ${p.description ?? ''}`),
    ...(hasBody ? [` * @param params ${labels.requestBody}`] : []),
    ` * @returns Promise<${resType}>`,
    ` */`,
  ].join('\n');

  const tsBody = [
    tsParamsInterface + tsResInterface + tsComment,
    `export function ${fnName}(${tsParamList.join(', ')}): Promise<${resType}> {${tsQueryStr}`,
    `  return ${requestCall(true)};`,
    `}`,
  ].join('\n');

  return { js: jsBody, ts: tsBody };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ScriptView() {
  const { t } = useTranslation();
  const { loading, swaggerDoc, operation } = useCurrentOperation();
  const [lang, setLang] = useState<Lang>('ts');

  const code = useMemo(() => {
    if (!swaggerDoc || !operation) return null;
    const op = operation.operation;
    const method = operationHttpMethod(operation);

    const parameters: ParameterObject[] = (op.parameters ?? []) as ParameterObject[];

    // resolve request body schema
    let requestBodySchema: SchemaObject | undefined;
    if (op.requestBody?.content) {
      requestBodySchema =
        op.requestBody.content['application/json']?.schema ?? Object.values(op.requestBody.content)[0]?.schema;
    } else {
      // OAS2 body parameter
      const bodyParam = parameters.find((p) => p.in === 'body');
      requestBodySchema = typeof bodyParam?.schema === 'object' ? bodyParam.schema : undefined;
    }

    // resolve first 2xx response schema
    let responseSchema: SchemaObject | undefined;
    const responses = op.responses ?? {};
    const successCode = Object.keys(responses).find((k) => k.startsWith('2')) ?? Object.keys(responses)[0];
    if (successCode) {
      const resp = responses[successCode];
      responseSchema =
        resp.content?.['application/json']?.schema ??
        resp.schema ??
        (resp.content ? Object.values(resp.content)[0]?.schema : undefined);
    }

    try {
      const documents = operationSchemaDocuments(swaggerDoc, operation);
      // Match the same selected response used above, not response map iteration order.
      const responseDocument = successCode ? documents.responses.get(successCode) : undefined;
      return generateCode(
        method,
        operation.path,
        op.operationId,
        op.summary,
        parameters,
        requestBodySchema,
        responseSchema,
        swaggerDoc,
        {
          requestBody: t('apiScript.comment.requestBody'),
          requestInterface: t('apiScript.comment.requestInterface'),
          requestType: t('apiScript.comment.requestType'),
          responseInterface: t('apiScript.comment.responseInterface'),
          responseType: t('apiScript.comment.responseType'),
        },
        { ...documents, responses: new Map(responseDocument ? [[successCode!, responseDocument]] : []) },
      );
    } catch {
      return null;
    }
  }, [swaggerDoc, operation, t]);

  if (loading) {
    return (
      <OperationModeLayout activeKey="script">
        <Spin style={{ display: 'block', margin: '80px auto' }} />
      </OperationModeLayout>
    );
  }

  if (!swaggerDoc || !operation) {
    return (
      <OperationModeLayout activeKey="script">
        <Alert
          type="warning"
          showIcon
          message={t('apiScript.notFound.title')}
          description={t('apiScript.notFound.desc')}
        />
      </OperationModeLayout>
    );
  }

  const currentCode = lang === 'js' ? code?.js : code?.ts;

  const handleCopy = () => {
    if (!currentCode) return;
    copyToClipboard(
      currentCode,
      () => message.success(t('apiScript.copied')),
      () => message.error(t('apiDoc.copy.failed')),
    );
  };

  return (
    <OperationModeLayout activeKey="script">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={5} style={{ margin: 0 }}>
          {t('apiScript.title')}
        </Title>
        <Space>
          <Radio.Group value={lang} onChange={(e) => setLang(e.target.value as Lang)} size="small">
            <Radio.Button value="ts">TypeScript</Radio.Button>
            <Radio.Button value="js">JavaScript</Radio.Button>
          </Radio.Group>
        </Space>
      </div>

      {code ? (
        <CodeBlock
          code={currentCode ?? ''}
          language={lang === 'ts' ? 'typescript' : 'javascript'}
          maxHeight={600}
          onCopy={handleCopy}
        />
      ) : (
        <Alert type="info" showIcon message={t('apiScript.noCode')} />
      )}
    </OperationModeLayout>
  );
}
