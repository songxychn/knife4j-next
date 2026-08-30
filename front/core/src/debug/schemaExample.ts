/**
 * Schema 示例值生成与字段树递归（TASK-030 完整实现）
 *
 * 同时兼容 OAS2（definitions）与 OAS3（components.schemas），通过 resolveRef 统一引用解析。
 *
 * 规则：
 * - 优先级：example > default > enum[0] > 按 type/format 推断
 * - 递归处理 $ref / object.properties / array.items
 * - allOf：浅合并子 schema 的 properties / required
 * - oneOf / anyOf：示例值取第一个可解析分支；字段树展示所有分支
 * - 循环引用：按引用链数组截断，重复命中同一 $ref 时返回占位值（example）或 null + truncated 标记（fieldTree）
 * - maxDepth：默认 8，超过后截断
 *
 * 不依赖浏览器 API、不依赖框架。
 */

import type {
  BuildSchemaExampleFn,
  BuildSchemaFieldTreeFn,
  SchemaFieldNode,
  SchemaResolveContext,
  SchemaValue,
} from './types';
import { resolveRef, resolveSchemaRef } from './resolveRef';

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
    return (type as unknown[]).some((value) => value === 'null') ? 'null' : 'unknown';
  }
  return typeof type === 'string' ? type : 'unknown';
}

function normalizeTypes(type: unknown): string[] | undefined {
  if (!Array.isArray(type)) return undefined;
  const types = type.filter((value): value is string => typeof value === 'string');
  return types.length > 0 ? Array.from(new Set(types)) : undefined;
}

function effectiveSchemaType(schema: Record<string, unknown>): string {
  const type = normalizeType(schema.type);
  if (type !== 'unknown') return type;
  if (schema.properties !== undefined || schema.additionalProperties !== undefined) return 'object';
  if (schema.items !== undefined || Array.isArray(schema.prefixItems)) return 'array';
  return 'unknown';
}

function isSchemaRecord(schema: unknown): schema is Record<string, unknown> {
  return schema !== null && typeof schema === 'object' && !Array.isArray(schema);
}

function supportsSchemaRefSiblings(doc: Record<string, unknown>): boolean {
  const version = typeof doc.openapi === 'string' ? doc.openapi : '';
  const match = version.match(/^(\d+)\.(\d+)(?:\.|$)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 3 || (major === 3 && minor >= 1);
}

function firstSchemaExample(schema: Record<string, unknown>): unknown {
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  return undefined;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => jsonValuesEqual(item, right[index]))
    );
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightRecord, key) && jsonValuesEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

function schemaTypes(type: unknown): string[] | undefined {
  if (typeof type === 'string') return [type];
  return normalizeTypes(type);
}

/**
 * Build the display/example projection of a JSON Schema conjunction. This is
 * intentionally not a validator, but it preserves the constraints Knife4j can
 * represent instead of silently discarding OAS 3.1 `$ref` siblings.
 */
function mergeSchemaIntersection(
  base: Record<string, unknown>,
  sibling: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(sibling)) {
    if (key === '$ref') continue;
    if (key === 'properties') {
      const baseProperties = isSchemaRecord(base.properties) ? base.properties : {};
      const siblingProperties = isSchemaRecord(value) ? value : {};
      const properties = new Map<string, unknown>(Object.entries(baseProperties));
      for (const [name, propertySchema] of Object.entries(siblingProperties)) {
        const existing = properties.get(name);
        if (existing === false || propertySchema === false) properties.set(name, false);
        else if (existing === true) properties.set(name, propertySchema);
        else if (propertySchema === true) properties.set(name, existing);
        else {
          properties.set(
            name,
            isSchemaRecord(existing) && isSchemaRecord(propertySchema)
              ? { allOf: [existing, propertySchema] }
              : propertySchema,
          );
        }
      }
      merged.properties = Object.fromEntries(properties);
      continue;
    }
    if (key === 'required') {
      merged.required = Array.from(
        new Set([
          ...(Array.isArray(base.required)
            ? base.required.filter((item): item is string => typeof item === 'string')
            : []),
          ...(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []),
        ]),
      );
      continue;
    }
    if (key === 'enum' && Array.isArray(value)) {
      merged.enum = Array.isArray(base.enum)
        ? base.enum.filter((candidate) => value.some((item) => jsonValuesEqual(candidate, item)))
        : value;
      continue;
    }
    if (key === 'type') {
      const baseTypes = schemaTypes(base.type);
      const siblingTypes = schemaTypes(value);
      if (baseTypes && siblingTypes) {
        const intersection = baseTypes.filter((type) => siblingTypes.includes(type));
        merged.type = intersection.length === 1 ? intersection[0] : intersection;
      } else {
        merged.type = value;
      }
      continue;
    }
    if (key === 'minimum' || key === 'exclusiveMinimum' || key === 'minLength' || key === 'minItems') {
      const oldValue = merged[key];
      merged[key] = typeof oldValue === 'number' && typeof value === 'number' ? Math.max(oldValue, value) : value;
      continue;
    }
    if (key === 'maximum' || key === 'exclusiveMaximum' || key === 'maxLength' || key === 'maxItems') {
      const oldValue = merged[key];
      merged[key] = typeof oldValue === 'number' && typeof value === 'number' ? Math.min(oldValue, value) : value;
      continue;
    }
    if (
      [
        'title',
        'description',
        'default',
        'example',
        'examples',
        'deprecated',
        'readOnly',
        'writeOnly',
        'const',
      ].includes(key) ||
      merged[key] === undefined
    ) {
      merged[key] = value;
    }
  }

  return merged;
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
 * - properties 合并，同名属性继续按交集处理
 * - required 拼接去重
 * - 可表达的 type / enum / 数值与长度边界保留交集
 */
function mergeAllOf(parts: SchemaValue[], ctx: InternalCtx): Record<string, unknown> | false {
  let merged: Record<string, unknown> = {};

  for (const part of parts) {
    const resolved = deref(part, ctx);
    if (resolved === undefined || resolved === true) continue;
    if (resolved === false) return false;
    merged = mergeSchemaIntersection(merged, resolved);
  }

  if (!merged.type && isSchemaRecord(merged.properties)) merged.type = 'object';
  return merged;
}

interface ResolveOptions {
  /** 字段树展示需要保留 oneOf / anyOf 的完整分支，不在解析阶段折叠为第一项 */
  preserveComposition?: boolean;
}

/** 解析 schema 的显式分支（$ref / allOf / oneOf / anyOf），返回归一化后的 schema */
function resolveSchema(
  schema: SchemaValue | undefined,
  ctx: InternalCtx,
  options: ResolveOptions = {},
): { schema: SchemaValue | undefined; ref?: string; truncated: boolean } {
  if (schema === undefined) return { schema: undefined, truncated: false };
  if (typeof schema === 'boolean') return { schema, truncated: false };

  // 1. $ref
  if (typeof schema.$ref === 'string') {
    const ref = schema.$ref;
    if (ctx.refChain.includes(ref)) {
      return { schema: undefined, ref, truncated: true };
    }
    const resolved = resolveSchemaRef(ref, ctx.doc);
    if (resolved === undefined) return { schema: undefined, ref, truncated: false };
    // 递归解析（解析后可能仍是 $ref / allOf 等）
    const deeper = resolveSchema(
      resolved,
      {
        ...ctx,
        refChain: [...ctx.refChain, ref],
      },
      options,
    );
    if (deeper.schema !== undefined && supportsSchemaRefSiblings(ctx.doc)) {
      const siblings = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$ref'));
      if (Object.keys(siblings).length > 0) {
        if (deeper.schema === false) return { ...deeper, ref };
        if (deeper.schema === true) {
          const resolvedSiblings = resolveSchema(siblings, ctx, options);
          return { ...resolvedSiblings, ref };
        }
        return { ...deeper, schema: mergeSchemaIntersection(deeper.schema, siblings), ref };
      }
    }
    return { ...deeper, ref };
  }

  // 2. allOf：浅合并
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const merged = mergeAllOf(schema.allOf as SchemaValue[], ctx);
    if (merged === false) return { schema: false, truncated: false };
    // 若 allOf 外层还带 properties/required/type，进一步合并
    const outer: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === 'allOf') continue;
      outer[k] = v;
    }
    const combined = mergeAllOf([merged, outer], ctx);
    return { schema: combined, truncated: false };
  }

  if (options.preserveComposition && (hasComposition(schema, 'oneOf') || hasComposition(schema, 'anyOf'))) {
    return { schema, truncated: false };
  }

  // 3. oneOf / anyOf：取第一个可解析分支
  const union = (schema.oneOf ?? schema.anyOf) as SchemaValue[] | undefined;
  if (Array.isArray(union) && union.length > 0) {
    for (const branch of union) {
      const branchResolved = resolveSchema(branch, ctx);
      if (branchResolved.schema) return branchResolved;
    }
    return { schema: undefined, truncated: false };
  }

  return { schema, truncated: false };
}

type CompositionKind = 'oneOf' | 'anyOf';

function hasComposition(schema: Record<string, unknown>, kind: CompositionKind): boolean {
  const branches = schema[kind];
  return Array.isArray(branches) && branches.length > 0;
}

function getComposition(
  schema: Record<string, unknown>,
): { kind: CompositionKind; branches: SchemaValue[] } | undefined {
  if (hasComposition(schema, 'oneOf')) {
    return { kind: 'oneOf', branches: schema.oneOf as SchemaValue[] };
  }
  if (hasComposition(schema, 'anyOf')) {
    return { kind: 'anyOf', branches: schema.anyOf as SchemaValue[] };
  }
  return undefined;
}

/** dereference：$ref → 解析后 schema（循环或失败时原样返回） */
function deref(schema: SchemaValue | undefined, ctx: InternalCtx): SchemaValue | undefined {
  if (schema === undefined || typeof schema === 'boolean') return schema;
  if (typeof schema.$ref !== 'string') return schema;
  if (ctx.refChain.includes(schema.$ref)) return undefined;
  const r = resolveSchemaRef(schema.$ref, ctx.doc);
  if (r === undefined || !supportsSchemaRefSiblings(ctx.doc)) return r;
  const siblings = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$ref'));
  if (Object.keys(siblings).length === 0 || r === false) return r;
  return r === true ? siblings : mergeSchemaIntersection(r, siblings);
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

function buildExampleInternal(schema: SchemaValue | undefined, ctx: InternalCtx): unknown {
  if (schema === true) return {};
  if (schema === false || !schema) return null;

  // maxDepth 保护
  if (ctx.depth >= ctx.maxDepth) {
    return null;
  }

  const { schema: resolved, truncated, ref } = resolveSchema(schema, ctx);
  if (resolved === undefined || truncated) {
    // 循环引用或解析失败：给一个占位值（保持类型尽量合理）
    if (schema.example !== undefined) return schema.example;
    return null;
  }
  if (resolved === true) return {};
  if (resolved === false) return null;

  // 如果 resolveSchema 解析了 $ref，将 ref 加入后续递归的上下文
  // 这样子属性递归时能检测到祖先 $ref，避免循环引用
  const ctxWithRef = ref ? pushRefIfAny(ctx, ref) : ctx;

  const explicitExample = firstSchemaExample(resolved);
  if (explicitExample !== undefined) return explicitExample;

  const type = effectiveSchemaType(resolved);
  const format = typeof resolved.format === 'string' ? resolved.format : undefined;

  // array
  if (type === 'array') {
    const prefixItems = Array.isArray(resolved.prefixItems) ? (resolved.prefixItems as SchemaValue[]) : [];
    if (prefixItems.length > 0) {
      return prefixItems.map((item) => buildExampleInternal(item, childCtx(ctxWithRef)));
    }
    const items = resolved.items as SchemaValue | undefined;
    if (!items) return [];
    const child = buildExampleInternal(items, childCtx(ctxWithRef));
    return child === null && type === 'array' ? [] : [child];
  }

  // object（type=object 或未声明但有 properties）
  if (type === 'object' || (type === 'unknown' && (resolved.properties || resolved.additionalProperties))) {
    const props = resolved.properties as Record<string, Record<string, unknown>> | undefined;
    const result = new Map<string, unknown>();
    if (props) {
      for (const [key, propSchema] of Object.entries(props)) {
        result.set(key, buildExampleInternal(propSchema, childCtx(ctxWithRef)));
      }
    } else if (resolved.additionalProperties && typeof resolved.additionalProperties === 'object') {
      const addSchema = resolved.additionalProperties as Record<string, unknown>;
      result.set('additionalProp1', buildExampleInternal(addSchema, childCtx(ctxWithRef)));
    }
    return Object.fromEntries(result);
  }

  // primitive
  return primitiveExample(type, format);
}

// ─── buildSchemaFieldTree 实现 ────────────────────────

export const buildSchemaFieldTree: BuildSchemaFieldTreeFn = (schema, ctx) => {
  return buildFieldTreeInternal(schema, toInternalCtx(ctx));
};

function buildFieldTreeInternal(schema: SchemaValue | undefined, ctx: InternalCtx): SchemaFieldNode[] {
  if (schema === true) return [{ name: '', type: 'unknown', required: false, booleanSchema: true }];
  if (schema === false) return [{ name: '', type: 'never', required: false, booleanSchema: false }];
  if (!schema) return [];
  if (ctx.depth >= ctx.maxDepth) return [];

  const { schema: resolved, ref, truncated } = resolveSchema(schema, ctx, { preserveComposition: true });
  if (resolved === undefined) return [];
  if (truncated) return [];
  if (resolved === true) {
    return [{ name: '', type: 'unknown', required: false, booleanSchema: true, refName: refToName(ref) }];
  }
  if (resolved === false) {
    return [{ name: '', type: 'never', required: false, booleanSchema: false, refName: refToName(ref) }];
  }

  const composition = getComposition(resolved);
  if (composition) {
    return buildTopLevelCompositionNodes(resolved, composition, ctx, ref);
  }

  const type = effectiveSchemaType(resolved);
  const types = normalizeTypes(resolved.type);

  // 顶层 object → 展开 properties
  if (type === 'object' || (type === 'unknown' && resolved.properties)) {
    return objectToFieldNodes(resolved, ctx, ref);
  }

  // 顶层 array → 返回 array 节点 + items 子节点
  if (type === 'array') {
    const arrayNode: SchemaFieldNode = {
      name: '',
      type: 'array',
      types,
      format: typeof resolved.format === 'string' ? resolved.format : undefined,
      required: false,
      description: typeof resolved.description === 'string' ? resolved.description : undefined,
      refName: refToName(ref),
    };
    const prefixItems = Array.isArray(resolved.prefixItems) ? (resolved.prefixItems as SchemaValue[]) : [];
    const items = resolved.items as SchemaValue | undefined;
    if (ctx.depth + 1 < ctx.maxDepth) {
      if (prefixItems.length > 0) {
        arrayNode.children = prefixItems.map((item, index) =>
          buildSingleFieldNode(`[${index}]`, item, false, childCtx(pushRefIfAny(ctx, ref))),
        );
      } else if (items !== undefined) {
        arrayNode.children = [buildSingleFieldNode('items', items, false, childCtx(pushRefIfAny(ctx, ref)))];
      }
    }
    return [arrayNode];
  }

  // 顶层 primitive → 返回单节点
  return [
    {
      name: '',
      type,
      types,
      format: typeof resolved.format === 'string' ? resolved.format : undefined,
      required: false,
      description: typeof resolved.description === 'string' ? resolved.description : undefined,
      default: resolved.default,
      example: firstSchemaExample(resolved),
      enum: Array.isArray(resolved.enum) ? resolved.enum : undefined,
      constValue: resolved.const,
      exclusiveMinimum: typeof resolved.exclusiveMinimum === 'number' ? resolved.exclusiveMinimum : undefined,
      exclusiveMaximum: typeof resolved.exclusiveMaximum === 'number' ? resolved.exclusiveMaximum : undefined,
      contentMediaType: typeof resolved.contentMediaType === 'string' ? resolved.contentMediaType : undefined,
      contentEncoding: typeof resolved.contentEncoding === 'string' ? resolved.contentEncoding : undefined,
      refName: refToName(ref),
    },
  ];
}

function buildCompositionBranchNodes(
  kind: CompositionKind,
  branches: SchemaValue[],
  ctx: InternalCtx,
): SchemaFieldNode[] {
  return branches.map((branch, index) => {
    const branchNode = buildSingleFieldNode(`${kind}[${index + 1}]`, branch, false, childCtx(ctx));
    return branchNode;
  });
}

function buildTopLevelCompositionNodes(
  resolved: Record<string, unknown>,
  composition: { kind: CompositionKind; branches: SchemaValue[] },
  ctx: InternalCtx,
  ref: string | undefined,
): SchemaFieldNode[] {
  return [
    ...objectToFieldNodes(resolved, ctx, ref),
    ...buildCompositionBranchNodes(composition.kind, composition.branches, pushRefIfAny(ctx, ref)),
  ];
}

function buildNestedCompositionChildren(
  resolved: Record<string, unknown>,
  composition: { kind: CompositionKind; branches: SchemaValue[] },
  ctx: InternalCtx,
  ref: string | undefined,
): SchemaFieldNode[] {
  const nextCtx = pushRefIfAny(ctx, ref);
  return [
    ...objectToFieldNodes(resolved, childCtx(nextCtx), ref),
    ...buildCompositionBranchNodes(composition.kind, composition.branches, nextCtx),
  ];
}

function objectToFieldNodes(
  resolved: Record<string, unknown>,
  ctx: InternalCtx,
  parentRef?: string,
): SchemaFieldNode[] {
  const props = (resolved.properties as Record<string, SchemaValue> | undefined) ?? {};
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
    nodes.push(buildSingleFieldNode('*', resolved.additionalProperties as SchemaValue, false, ctx));
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
  rawSchema: SchemaValue | undefined,
  required: boolean,
  ctx: InternalCtx,
): SchemaFieldNode {
  if (rawSchema === true) {
    return { name, type: 'unknown', required, booleanSchema: true };
  }
  if (rawSchema === false) {
    return { name, type: 'never', required, booleanSchema: false };
  }
  if (!rawSchema) {
    return { name, type: 'unknown', required };
  }

  // 循环检测：$ref 重复命中 → truncated
  if (typeof rawSchema.$ref === 'string' && ctx.refChain.includes(rawSchema.$ref)) {
    // Shallow-resolve the ref target to get its description/title without recursing
    const circularTarget = resolveRef(rawSchema.$ref, ctx.doc);
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

  const { schema: resolved, ref, truncated } = resolveSchema(rawSchema, ctx, { preserveComposition: true });
  if (resolved === undefined) {
    return {
      name,
      type: 'unknown',
      refName: refToName(ref),
      required,
      truncated,
    };
  }
  if (resolved === true) return { name, type: 'unknown', required, booleanSchema: true, refName: refToName(ref) };
  if (resolved === false) return { name, type: 'never', required, booleanSchema: false, refName: refToName(ref) };

  const type = effectiveSchemaType(resolved);
  const types = normalizeTypes(resolved.type);
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

  const composition = getComposition(resolved);
  if (composition) {
    const node: SchemaFieldNode = {
      name,
      type: composition.kind,
      required,
      description,
      refDescription,
      refTitle,
      refName: refToName(ref),
    };
    if (ctx.depth + 1 >= ctx.maxDepth) {
      node.truncated = true;
      return node;
    }
    node.children = buildNestedCompositionChildren(resolved, composition, ctx, ref);
    return node;
  }

  const node: SchemaFieldNode = {
    name,
    type: type === 'unknown' && resolved.properties ? 'object' : type,
    types,
    format,
    required,
    description,
    refDescription,
    refTitle,
    default: resolved.default,
    example: firstSchemaExample(resolved),
    enum: Array.isArray(resolved.enum) ? resolved.enum : undefined,
    constValue: resolved.const,
    minLength: typeof resolved.minLength === 'number' ? resolved.minLength : undefined,
    maxLength: typeof resolved.maxLength === 'number' ? resolved.maxLength : undefined,
    minimum: typeof resolved.minimum === 'number' ? resolved.minimum : undefined,
    maximum: typeof resolved.maximum === 'number' ? resolved.maximum : undefined,
    exclusiveMinimum: typeof resolved.exclusiveMinimum === 'number' ? resolved.exclusiveMinimum : undefined,
    exclusiveMaximum: typeof resolved.exclusiveMaximum === 'number' ? resolved.exclusiveMaximum : undefined,
    contentMediaType: typeof resolved.contentMediaType === 'string' ? resolved.contentMediaType : undefined,
    contentEncoding: typeof resolved.contentEncoding === 'string' ? resolved.contentEncoding : undefined,
    pattern: typeof resolved.pattern === 'string' ? resolved.pattern : undefined,
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
    const prefixItems = Array.isArray(resolved.prefixItems) ? (resolved.prefixItems as SchemaValue[]) : [];
    const items = resolved.items as SchemaValue | undefined;
    if (prefixItems.length > 0) {
      node.children = prefixItems.map((item, index) => buildSingleFieldNode(`[${index}]`, item, false, deeperCtx));
    } else if (items !== undefined) {
      // 循环检测
      if (isSchemaRecord(items) && typeof items.$ref === 'string' && deeperCtx.refChain.includes(items.$ref)) {
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
