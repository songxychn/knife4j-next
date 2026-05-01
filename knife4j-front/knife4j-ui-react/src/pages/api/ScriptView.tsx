import { useMemo, useState } from 'react';
import { Alert, Radio, Space, Spin, Typography, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { useCurrentOperation } from './useCurrentOperation';
import { OperationModeTabs } from './useCurrentOperation';
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
  schema?: SchemaObject;
  description?: string;
}

function resolveSchema(
  schema: SchemaObject | undefined,
  doc: Pick<SwaggerDoc, 'components' | 'definitions'>,
  depth = 0,
): SchemaObject | undefined {
  if (!schema || depth > 8) return schema;
  if (schema.$ref) {
    const match = schema.$ref.match(/^#\/components\/schemas\/(.+)$/) ?? schema.$ref.match(/^#\/definitions\/(.+)$/);
    if (match) {
      const resolved = (doc.components?.schemas ?? doc.definitions ?? {})[match[1]];
      return resolveSchema(resolved, doc, depth + 1);
    }
  }
  return schema;
}

function schemaToTsType(
  schema: SchemaObject | undefined,
  doc: Pick<SwaggerDoc, 'components' | 'definitions'>,
  depth = 0,
): string {
  if (!schema || depth > 6) return 'unknown';
  const resolved = resolveSchema(schema, doc, 0);
  if (!resolved) return 'unknown';

  if (resolved.$ref) {
    const name = resolved.$ref.split('/').pop();
    return name ?? 'unknown';
  }

  const type = resolved.type;
  if (type === 'string') return resolved.format === 'date-time' ? 'string /* date-time */' : 'string';
  if (type === 'integer' || type === 'number') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'array') {
    const itemType = schemaToTsType(resolved.items, doc, depth + 1);
    return `${itemType}[]`;
  }
  if (type === 'object' || resolved.properties) {
    if (!resolved.properties) return 'Record<string, unknown>';
    const props = Object.entries(resolved.properties)
      .map(([k, v]) => {
        const required = Array.isArray(resolved.required) && resolved.required.includes(k);
        return `  ${k}${required ? '' : '?'}: ${schemaToTsType(v, doc, depth + 1)};`;
      })
      .join('\n');
    return `{\n${props}\n}`;
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
    return operationId.replace(/Using(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)(_\d+)?$/i, '');
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

function generateCode(
  method: string,
  path: string,
  operationId: string | undefined,
  summary: string | undefined,
  parameters: ParameterObject[],
  requestBodySchema: SchemaObject | undefined,
  responseSchema: SchemaObject | undefined,
  doc: SwaggerDoc,
): GeneratedCode {
  const fnName = deriveFunctionName(operationId, method, path);
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

  const jsComment = [
    `/**`,
    ` * ${summary ?? fnName}`,
    ...pathParams.map((p) => ` * @param {string} ${p.name} ${p.description ?? ''}`),
    ...queryParams.map((p) => ` * @param {string} ${p.name} ${p.description ?? ''}`),
    ...(hasBody ? [` * @param {object} params request body`] : []),
    ` * @returns {Promise}`,
    ` */`,
  ].join('\n');

  const jsBody = [
    jsComment,
    `export function ${fnName}(${jsParamList.join(', ')}) {${jsQueryStr}`,
    `  return request.${method.toLowerCase()}(${jsRequestArgs.join(', ')});`,
    `}`,
  ].join('\n');

  // ---- TS interfaces ----
  let tsParamsInterface = '';
  if (hasBody && requestBodySchema) {
    const resolved = resolveSchema(requestBodySchema, doc);
    if (resolved?.type === 'object' || resolved?.properties) {
      const props = Object.entries(resolved?.properties ?? {})
        .map(([k, v]) => {
          const req = Array.isArray(resolved?.required) && resolved.required.includes(k);
          return `  ${k}${req ? '' : '?'}: ${schemaToTsType(v, doc)};`;
        })
        .join('\n');
      tsParamsInterface = `// 请求参数接口\nexport interface ${interfaceName}Params {\n${props}\n}\n\n`;
    } else if (resolved?.type === 'array') {
      tsParamsInterface = `// 请求参数类型\nexport type ${interfaceName}Params = ${schemaToTsType(resolved, doc)};\n\n`;
    }
  }

  let tsResInterface = '';
  if (responseSchema) {
    const resolved = resolveSchema(responseSchema, doc);
    if (resolved?.type === 'object' || resolved?.properties) {
      const props = Object.entries(resolved?.properties ?? {})
        .map(([k, v]) => {
          const req = Array.isArray(resolved?.required) && resolved.required.includes(k);
          return `  ${k}${req ? '' : '?'}: ${schemaToTsType(v, doc)};`;
        })
        .join('\n');
      tsResInterface = `// 响应接口\nexport interface ${interfaceName}Res {\n${props}\n}\n\n`;
    } else if (resolved?.type === 'array') {
      tsResInterface = `// 响应类型\nexport type ${interfaceName}Res = ${schemaToTsType(resolved, doc)};\n\n`;
    }
  }

  // TS function params with type annotations
  const tsParamList: string[] = [
    ...pathParams.map((p) => `${p.name}: string`),
    ...queryParams.map((p) => {
      const t = schemaToTsType(p.schema, doc);
      return `${p.name}${p.required ? '' : '?'}: ${t}`;
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
    ...(hasBody ? [` * @param params request body`] : []),
    ` * @returns Promise<${resType}>`,
    ` */`,
  ].join('\n');

  const tsBody = [
    tsParamsInterface + tsResInterface + tsComment,
    `export function ${fnName}(${tsParamList.join(', ')}): Promise<${resType}> {${tsQueryStr}`,
    `  return request.${method.toLowerCase()}(${jsRequestArgs.join(', ')});`,
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
    const method = operation.method.toUpperCase();

    const parameters: ParameterObject[] = (op.parameters ?? []) as ParameterObject[];

    // resolve request body schema
    let requestBodySchema: SchemaObject | undefined;
    if (op.requestBody?.content) {
      requestBodySchema =
        op.requestBody.content['application/json']?.schema ?? Object.values(op.requestBody.content)[0]?.schema;
    } else {
      // OAS2 body parameter
      const bodyParam = parameters.find((p) => p.in === 'body');
      requestBodySchema = bodyParam?.schema;
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
      return generateCode(
        method,
        operation.path,
        op.operationId,
        op.summary,
        parameters,
        requestBodySchema,
        responseSchema,
        swaggerDoc,
      );
    } catch {
      return null;
    }
  }, [swaggerDoc, operation]);

  if (loading) {
    return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  }

  if (!swaggerDoc || !operation) {
    return (
      <Alert
        type="warning"
        showIcon
        message={t('apiScript.notFound.title')}
        description={t('apiScript.notFound.desc')}
      />
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
    <div style={{ padding: '0 24px 24px', maxWidth: 1080 }}>
      <OperationModeTabs activeKey="script" />

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
    </div>
  );
}
