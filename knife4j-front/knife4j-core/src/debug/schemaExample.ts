/**
 * Schema 示例值生成与字段树递归（TASK-030 完整实现）
 *
 * 同时兼容 OAS2（definitions）与 OAS3（components.schemas），通过 resolveRef 统一引用解析。
 *
 * 规则：
 * - 优先级：example > default > enum[0] > 按 type/format 推断
 * - 递归处理 $ref / object.properties / array.items
 * - allOf：浅合并子 schema 的 properties / required
 * - oneOf / anyOf：取第一个可解析分支
 * - 循环引用：按引用链数组截断，重复命中同一 $ref 时返回占位值（example）或 null + truncated 标记（fieldTree）
 * - maxDepth：默认 8，超过后截断
 *
 * 不依赖浏览器 API、不依赖框架。
 */

import type { BuildSchemaExampleFn, BuildSchemaFieldTreeFn, SchemaFieldNode, SchemaResolveContext } from './types';
import { resolveRef } from './resolveRef';

// ─── 常量 ─────────────────────────────────────────────

const DEFAULT_MAX_DEPTH = 8;

/** 按 type + format 推断的 primitive 默认值 */
function primitiveExample(type: string | undefined, format: string | undefined): unknown {
  switch (type) {
    case 'string':
      switch (format) {
        case 'date':
          return '2024-01-01';
        case 'date-time':
          return '2024-01-01T00:00:00Z';
        case 'time':
          return '00:00:00';
        case 'email':
          return 'user@example.com';
        case 'uri':
        case 'url':
          return 'https://example.com';
        case 'uuid':
          return '3fa85f64-5717-4562-b3fc-2c963f66afa6';
        case 'hostname':
          return 'example.com';
        case 'ipv4':
          return '127.0.0.1';
        case 'ipv6':
          return '::1';
        case 'binary':
          return '';
        case 'byte':
          return 'dGVzdA==';
        case 'password':
          return 'password';
        default:
          return 'string';
      }
    case 'integer':
      switch (format) {
        case 'int64':
          return 0;
        case 'int32':
        default:
          return 0;
      }
    case 'number':
      switch (format) {
        case 'float':
          return 0.0;
        case 'double':
          return 0.0;
        default:
          return 0;
      }
    case 'boolean':
      return true;
    case 'file':
      return '';
    case 'null':
      return null;
    default:
      return null;
  }
}

/** type 归一化（null / undefined → 'unknown'） */
function normalizeType(type: unknown): string {
  if (Array.isArray(type)) {
    // OAS 3.1 允许 type: ['string', 'null']
    for (const t of type as unknown[]) {
      if (typeof t === 'string' && t !== 'null') return t;
    }
    return 'unknown';
  }
  return typeof type === 'string' ? type : 'unknown';
}

// ─── 内部递归上下文 ───────────────────────────────────

/**
 * 递归上下文：在外部的 SchemaResolveContext 基础上追加引用链和深度
 */
interface InternalCtx {
  doc: Record<string, unknown>;
  maxDepth: number;
  /** 当前递归深度（从 0 起） */
  depth: number;
  /** 当前引用链（用于检测循环），记录已访问的 $ref 字符串 */
  refChain: string[];
}

function toInternalCtx(ctx: SchemaResolveContext): InternalCtx {
  return {
    doc: ctx.doc,
    maxDepth: ctx.maxDepth ?? DEFAULT_MAX_DEPTH,
    depth: 0,
    refChain: [],
  };
}

function childCtx(ctx: InternalCtx, pushedRef?: string): InternalCtx {
  return {
    doc: ctx.doc,
    maxDepth: ctx.maxDepth,
    depth: ctx.depth + 1,
    refChain: pushedRef ? [...ctx.refChain, pushedRef] : ctx.refChain,
  };
}

// ─── allOf / oneOf / anyOf 合并 ───────────────────────

/**
 * 合并 allOf 所有子项：
 * - type / format / enum / example / default 取第一个非 undefined
 * - properties 浅合并
 * - required 拼接去重
 */
function mergeAllOf(parts: Record<string, unknown>[], ctx: InternalCtx): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const mergedProps: Record<string, Record<string, unknown>> = {};
  const mergedRequired = new Set<string>();
  let hasProps = false;
  let hasRequired = false;

  for (const part of parts) {
    const resolved = deref(part, ctx);
    if (!resolved) continue;
    for (const [key, value] of Object.entries(resolved)) {
      if (key === 'properties') {
        hasProps = true;
        if (value && typeof value === 'object') {
          for (const [pname, pschema] of Object.entries(value as Record<string, unknown>)) {
            mergedProps[pname] = pschema as Record<string, unknown>;
          }
        }
      } else if (key === 'required') {
        hasRequired = true;
        if (Array.isArray(value)) {
          for (const r of value) {
            if (typeof r === 'string') mergedRequired.add(r);
          }
        }
      } else if (merged[key] === undefined) {
        merged[key] = value;
      }
    }
  }

  if (hasProps) merged.properties = mergedProps;
  if (hasRequired) merged.required = Array.from(mergedRequired);
  if (!merged.type && hasProps) merged.type = 'object';
  return merged;
}

/** 解析 schema 的显式分支（$ref / allOf / oneOf / anyOf），返回归一化后的 schema */
function resolveSchema(
  schema: Record<string, unknown> | undefined,
  ctx: InternalCtx,
): { schema: Record<string, unknown> | undefined; ref?: string; truncated: boolean } {
  if (!schema) return { schema: undefined, truncated: false };

  // 1. $ref
  if (typeof schema.$ref === 'string') {
    const ref = schema.$ref;
    if (ctx.refChain.includes(ref)) {
      return { schema: undefined, ref, truncated: true };
    }
    const resolved = resolveRef(ref, ctx.doc);
    if (!resolved) return { schema: undefined, ref, truncated: false };
    // 递归解析（解析后可能仍是 $ref / allOf 等）
    const deeper = resolveSchema(resolved, {
      ...ctx,
      refChain: [...ctx.refChain, ref],
    });
    return { ...deeper, ref };
  }

  // 2. allOf：浅合并
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const merged = mergeAllOf(schema.allOf as Record<string, unknown>[], ctx);
    // 若 allOf 外层还带 properties/required/type，进一步合并
    const outer: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === 'allOf') continue;
      outer[k] = v;
    }
    const combined = mergeAllOf([merged, outer], ctx);
    return { schema: combined, truncated: false };
  }

  // 3. oneOf / anyOf：取第一个可解析分支
  const union = (schema.oneOf ?? schema.anyOf) as Record<string, unknown>[] | undefined;
  if (Array.isArray(union) && union.length > 0) {
    for (const branch of union) {
      const branchResolved = resolveSchema(branch, ctx);
      if (branchResolved.schema) return branchResolved;
    }
    return { schema: undefined, truncated: false };
  }

  return { schema, truncated: false };
}

/** dereference：$ref → 解析后 schema（循环或失败时原样返回） */
function deref(schema: Record<string, unknown> | undefined, ctx: InternalCtx): Record<string, unknown> | undefined {
  if (!schema) return schema;
  if (typeof schema.$ref !== 'string') return schema;
  if (ctx.refChain.includes(schema.$ref)) return undefined;
  const r = resolveRef(schema.$ref, ctx.doc);
  return r;
}

/** 从 $ref 字符串中提取类型名（最后一段） */
function refToName(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  const idx = ref.lastIndexOf('/');
  return idx >= 0 ? ref.slice(idx + 1) : ref;
}

// ─── buildSchemaExample 实现 ──────────────────────────

export const buildSchemaExample: BuildSchemaExampleFn = (schema, ctx) => {
  return buildExampleInternal(schema, toInternalCtx(ctx));
};

function buildExampleInternal(schema: Record<string, unknown> | undefined, ctx: InternalCtx): unknown {
  if (!schema) return null;

  // maxDepth 保护
  if (ctx.depth >= ctx.maxDepth) {
    return null;
  }

  const { schema: resolved, truncated, ref } = resolveSchema(schema, ctx);
  if (!resolved || truncated) {
    // 循环引用或解析失败：给一个占位值（保持类型尽量合理）
    if (schema.example !== undefined) return schema.example;
    return null;
  }

  // 如果 resolveSchema 解析了 $ref，将 ref 加入后续递归的上下文
  // 这样子属性递归时能检测到祖先 $ref，避免循环引用
  const ctxWithRef = ref ? pushRefIfAny(ctx, ref) : ctx;

  // 显式 example 覆盖一切（OpenAPI 官方约定）
  if (resolved.example !== undefined) {
    return resolved.example;
  }
  // default 次优
  if (resolved.default !== undefined) {
    return resolved.default;
  }
  // enum 第一个
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    return resolved.enum[0];
  }

  const type = normalizeType(resolved.type);
  const format = typeof resolved.format === 'string' ? resolved.format : undefined;

  // array
  if (type === 'array') {
    const items = resolved.items as Record<string, unknown> | undefined;
    if (!items) return [];
    const child = buildExampleInternal(items, childCtx(ctxWithRef));
    return child === null && type === 'array' ? [] : [child];
  }

  // object（type=object 或未声明但有 properties）
  if (type === 'object' || (type === 'unknown' && (resolved.properties || resolved.additionalProperties))) {
    const props = resolved.properties as Record<string, Record<string, unknown>> | undefined;
    const result: Record<string, unknown> = {};
    if (props) {
      for (const [key, propSchema] of Object.entries(props)) {
        result[key] = buildExampleInternal(propSchema, childCtx(ctxWithRef));
      }
    } else if (resolved.additionalProperties && typeof resolved.additionalProperties === 'object') {
      const addSchema = resolved.additionalProperties as Record<string, unknown>;
      result['additionalProp1'] = buildExampleInternal(addSchema, childCtx(ctxWithRef));
    }
    return result;
  }

  // primitive
  return primitiveExample(type, format);
}

// ─── buildSchemaFieldTree 实现 ────────────────────────

export const buildSchemaFieldTree: BuildSchemaFieldTreeFn = (schema, ctx) => {
  return buildFieldTreeInternal(schema, toInternalCtx(ctx));
};

function buildFieldTreeInternal(schema: Record<string, unknown> | undefined, ctx: InternalCtx): SchemaFieldNode[] {
  if (!schema) return [];
  if (ctx.depth >= ctx.maxDepth) return [];

  const { schema: resolved, ref, truncated } = resolveSchema(schema, ctx);
  if (!resolved) return [];
  if (truncated) return [];

  const type = normalizeType(resolved.type);

  // 顶层 object → 展开 properties
  if (type === 'object' || (type === 'unknown' && resolved.properties)) {
    return objectToFieldNodes(resolved, ctx, ref);
  }

  // 顶层 array → 返回 array 节点 + items 子节点
  if (type === 'array') {
    const items = resolved.items as Record<string, unknown> | undefined;
    const arrayNode: SchemaFieldNode = {
      name: '',
      type: 'array',
      format: typeof resolved.format === 'string' ? resolved.format : undefined,
      required: false,
      description: typeof resolved.description === 'string' ? resolved.description : undefined,
      refName: refToName(ref),
    };
    if (items && ctx.depth + 1 < ctx.maxDepth) {
      const itemNode = buildSingleFieldNode('items', items, false, childCtx(pushRefIfAny(ctx, ref)));
      arrayNode.children = [itemNode];
    }
    return [arrayNode];
  }

  // 顶层 primitive → 返回单节点
  return [
    {
      name: '',
      type,
      format: typeof resolved.format === 'string' ? resolved.format : undefined,
      required: false,
      description: typeof resolved.description === 'string' ? resolved.description : undefined,
      default: resolved.default,
      example: resolved.example,
      enum: Array.isArray(resolved.enum) ? resolved.enum : undefined,
      refName: refToName(ref),
    },
  ];
}

function objectToFieldNodes(
  resolved: Record<string, unknown>,
  ctx: InternalCtx,
  parentRef?: string,
): SchemaFieldNode[] {
  const props = (resolved.properties as Record<string, Record<string, unknown>> | undefined) ?? {};
  const requiredSet = new Set<string>(Array.isArray(resolved.required) ? (resolved.required as string[]) : []);

  const nodes: SchemaFieldNode[] = [];
  for (const [name, propSchema] of Object.entries(props)) {
    nodes.push(buildSingleFieldNode(name, propSchema, requiredSet.has(name), pushRefIfAny(ctx, parentRef)));
  }
  // additionalProperties 作为伪字段（只有在没有 properties 时展示）
  if (
    Object.keys(props).length === 0 &&
    resolved.additionalProperties &&
    typeof resolved.additionalProperties === 'object'
  ) {
    nodes.push(buildSingleFieldNode('*', resolved.additionalProperties as Record<string, unknown>, false, ctx));
  }
  return nodes;
}

function pushRefIfAny(ctx: InternalCtx, ref: string | undefined): InternalCtx {
  if (!ref) return ctx;
  if (ctx.refChain.includes(ref)) return ctx;
  return { ...ctx, refChain: [...ctx.refChain, ref] };
}

function buildSingleFieldNode(
  name: string,
  rawSchema: Record<string, unknown> | undefined,
  required: boolean,
  ctx: InternalCtx,
): SchemaFieldNode {
  if (!rawSchema) {
    return { name, type: 'unknown', required };
  }

  // 循环检测：$ref 重复命中 → truncated
  if (typeof rawSchema.$ref === 'string' && ctx.refChain.includes(rawSchema.$ref)) {
    // Shallow-resolve the ref target to get its description/title without recursing
    const circularTarget = resolveRef(rawSchema.$ref, ctx.doc as Record<string, unknown>);
    const circularOwnDesc = typeof rawSchema.description === 'string' ? rawSchema.description : undefined;
    const circularRefDesc =
      circularTarget && typeof circularTarget.description === 'string' ? circularTarget.description : undefined;
    return {
      name,
      type: 'object',
      refName: refToName(rawSchema.$ref),
      required,
      truncated: true,
      // Primary description: own description if present, otherwise fall back to ref target's description
      description: circularOwnDesc ?? circularRefDesc,
      // refDescription: only when field has own description AND ref target also has a different description
      refDescription:
        circularOwnDesc && circularRefDesc && circularRefDesc !== circularOwnDesc ? circularRefDesc : undefined,
      refTitle: circularTarget && typeof circularTarget.title === 'string' ? circularTarget.title : undefined,
    };
  }

  const { schema: resolved, ref, truncated } = resolveSchema(rawSchema, ctx);
  if (!resolved) {
    return {
      name,
      type: 'unknown',
      refName: refToName(ref),
      required,
      truncated,
    };
  }

  const type = normalizeType(resolved.type);
  const format = typeof resolved.format === 'string' ? resolved.format : undefined;
  // Field's own description takes priority; ref target description is kept as refDescription for secondary display
  const ownDescription = typeof rawSchema.description === 'string' ? rawSchema.description : undefined;
  const refTargetDescription = typeof resolved.description === 'string' ? resolved.description : undefined;
  // Primary description: own description if present, otherwise fall back to ref target's description
  const description = ownDescription ?? refTargetDescription;
  // refDescription: only set when the field has its own description AND the ref target also has a description
  // (so the UI can show the ref target's description as secondary info alongside the field's own description)
  const refDescription =
    ref && ownDescription && refTargetDescription && refTargetDescription !== ownDescription
      ? refTargetDescription
      : undefined;
  const refTitle = ref ? (typeof resolved.title === 'string' ? resolved.title : undefined) : undefined;

  const node: SchemaFieldNode = {
    name,
    type: type === 'unknown' && resolved.properties ? 'object' : type,
    format,
    required,
    description,
    refDescription,
    refTitle,
    default: resolved.default,
    example: resolved.example,
    enum: Array.isArray(resolved.enum) ? resolved.enum : undefined,
    readOnly: typeof resolved.readOnly === 'boolean' ? resolved.readOnly : undefined,
    writeOnly: typeof resolved.writeOnly === 'boolean' ? resolved.writeOnly : undefined,
    deprecated: typeof resolved.deprecated === 'boolean' ? resolved.deprecated : undefined,
    refName: refToName(ref),
  };

  // 子字段展开
  // 达到 maxDepth 时只保留当前层，不再递归
  if (ctx.depth + 1 >= ctx.maxDepth) {
    if (type === 'object' || type === 'array') {
      node.truncated = true;
    }
    return node;
  }

  const nextCtx = ref ? pushRefIfAny(ctx, ref) : ctx;
  const deeperCtx = childCtx(nextCtx);

  if (node.type === 'object') {
    const children = objectToFieldNodes(resolved, deeperCtx, ref);
    if (children.length > 0) node.children = children;
  } else if (node.type === 'array') {
    const items = resolved.items as Record<string, unknown> | undefined;
    if (items) {
      // 循环检测
      if (typeof items.$ref === 'string' && deeperCtx.refChain.includes(items.$ref)) {
        node.children = [
          {
            name: 'items',
            type: 'object',
            refName: refToName(items.$ref),
            required: false,
            truncated: true,
          },
        ];
      } else {
        const itemNode = buildSingleFieldNode('items', items, false, deeperCtx);
        node.children = [itemNode];
      }
    }
  }

  return node;
}
