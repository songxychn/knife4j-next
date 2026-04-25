/**
 * Schema 示例生成与字段树递归 — 占位实现
 *
 * 完整递归逻辑在 TASK-030 实现。
 * 当前版本只处理基本类型和一层 object/array，不递归展开 $ref。
 * 目的：让 requestBuilder 和 OperationDebugModel 在 TASK-032 就能生成初始值。
 */

import type { BuildSchemaExampleFn, BuildSchemaFieldTreeFn } from './types';

/**
 * 基本类型 → 示例值的映射
 */
function primitiveExample(type?: string, format?: string, enumValues?: unknown[], example?: unknown, defaultValue?: unknown): unknown {
  // 优先使用显式 example
  if (example !== undefined) return example;
  // 其次 default
  if (defaultValue !== undefined) return defaultValue;
  // enum 取第一个
  if (enumValues && enumValues.length > 0) return enumValues[0];

  // 按 type + format 推断
  switch (type) {
    case 'string':
      switch (format) {
        case 'date': return '2024-01-01';
        case 'date-time': return '2024-01-01T00:00:00Z';
        case 'email': return 'user@example.com';
        case 'uri':
        case 'url': return 'https://example.com';
        case 'uuid': return '3fa85f64-5717-4562-b3fc-2c963f66afa6';
        case 'binary': return '(binary)';
        case 'byte': return 'dGVzdA==';
        default: return '';
      }
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return true;
    case 'file':
      return '(file)';
    default:
      return '';
  }
}

/**
 * 简易 schema → 示例值生成（不递归展开 $ref，仅处理基本类型和一层嵌套）
 *
 * TASK-030 会替换为完整实现（递归 $ref、allOf/oneOf/anyOf、循环引用检测、maxDepth）
 */
export const buildSchemaExample: BuildSchemaExampleFn = (
  schema,
  _ctx,
): unknown => {
  if (!schema) return undefined;

  // $ref: 不递归，返回空对象占位
  if (schema.$ref) return {};

  const type = schema.type as string | undefined;
  const format = schema.format as string | undefined;
  const enumVal = schema.enum as unknown[] | undefined;
  const example = schema.example;
  const defaultVal = schema.default;

  if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined;
    const itemExample = buildSchemaExample(items, _ctx);
    return [itemExample ?? {}];
  }

  if (type === 'object' || (!type && schema.properties)) {
    const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
    if (!props) return {};
    const result: Record<string, unknown> = {};
    for (const [key, propSchema] of Object.entries(props)) {
      result[key] = buildSchemaExample(propSchema, _ctx);
    }
    return result;
  }

  return primitiveExample(type, format, enumVal, example, defaultVal);
};

/**
 * 简易字段树生成（占位） — TASK-030 实现
 */
export const buildSchemaFieldTree: BuildSchemaFieldTreeFn = (
  _schema,
  _ctx,
): unknown => {
  // 占位：返回空数组
  return [];
};

