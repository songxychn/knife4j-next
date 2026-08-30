/**
 * resolveRef — 统一处理 OAS2 definitions 与 OAS3 components.schemas 的 $ref 引用
 *
 * 规则：
 * - OAS3: #/components/schemas/{name}
 * - OAS2: #/definitions/{name}
 * - 支持 $ref 在数组/对象/嵌套结构中出现的场景
 * - 返回 undefined 表示引用不存在
 */

import type { SchemaValue } from './types';
import { dereferenceOasReferenceObject, isOpenApi31Version, resolveLocalJsonPointer } from '../openapi31/document';

function resolveRefValue(ref: string, doc: Record<string, unknown>): unknown {
  if (!isOpenApi31Version(doc.openapi)) {
    if (!ref || !ref.startsWith('#/')) return undefined;
    let pointer: string;
    try {
      pointer = decodeURIComponent(ref.slice(2));
    } catch {
      return undefined;
    }
    let current: unknown = doc;
    for (const encodedPart of pointer.split('/')) {
      if (current === null || typeof current !== 'object') return undefined;
      const part = encodedPart.replace(/~1/g, '/').replace(/~0/g, '~');
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
  const result = resolveLocalJsonPointer(doc, ref);
  return result.found ? result.value : undefined;
}

/**
 * 从 OpenAPI 文档中解析 $ref 指向的对象
 *
 * @param ref  引用路径，如 "#/components/schemas/User" 或 "#/definitions/User"
 * @param doc  完整的 OpenAPI 文档对象（OAS2 或 OAS3）
 * @returns    被引用的对象；找不到或目标不是对象时返回 undefined
 */
export function resolveRef(ref: string, doc: Record<string, unknown>): Record<string, unknown> | undefined {
  const value = resolveRefValue(ref, doc);
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** 解析 OAS 3.1 Schema Object，包括 JSON Schema 允许的 boolean schema。 */
export function resolveSchemaRef(ref: string, doc: Record<string, unknown>): SchemaValue | undefined {
  const value = resolveRefValue(ref, doc);
  if (typeof value === 'boolean') return value;
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** 从 $ref 目标 schema 中提取 description 和 title（不递归解析 $ref） */
export function resolveRefMeta(
  ref: string,
  doc: Record<string, unknown>,
): { refDescription?: string; refTitle?: string } {
  const schema = resolveRef(ref, doc);
  if (!schema) return {};
  return {
    refDescription: typeof schema.description === 'string' ? schema.description : undefined,
    refTitle: typeof schema.title === 'string' ? schema.title : undefined,
  };
}

/**
 * 如果对象含 $ref，则解析为实际对象；否则原样返回。
 * 递归解析直到不再出现 $ref 或达到最大深度。
 *
 * @param maxResolveDepth  防止 $ref 循环，默认 10
 */
export function dereference(
  obj: Record<string, unknown>,
  doc: Record<string, unknown>,
  maxResolveDepth = 10,
): Record<string, unknown> {
  let current = obj;
  let depth = 0;
  while (current.$ref && typeof current.$ref === 'string' && depth < maxResolveDepth) {
    const resolved = resolveRef(String(current.$ref), doc);
    if (!resolved) break;
    current = resolved;
    depth++;
  }
  return current;
}

function supportsReferenceObjectSiblings(doc: Record<string, unknown>): boolean {
  const version = typeof doc.openapi === 'string' ? doc.openapi : '';
  const match = version.match(/^(\d+)\.(\d+)(?:\.|$)/);
  if (!match) return false;
  return Number(match[1]) > 3 || (Number(match[1]) === 3 && Number(match[2]) >= 1);
}

/**
 * Resolve an OAS Reference Object. OAS 3.1 allows `summary` and `description`
 * beside `$ref`; those annotations override the referenced object's values.
 * OAS 3.0 keeps the historical rule that all siblings are ignored.
 */
export function dereferenceReferenceObject(
  obj: Record<string, unknown>,
  doc: Record<string, unknown>,
  maxResolveDepth = 10,
): Record<string, unknown> {
  if (isOpenApi31Version(doc.openapi)) {
    return dereferenceOasReferenceObject(obj, doc, maxResolveDepth);
  }

  // Keep the established non-3.1 behavior unchanged. In particular, an
  // unresolved reference is returned verbatim and OAS 3.0 siblings are only
  // discarded after a target has actually been resolved.
  const allowAnnotations = supportsReferenceObjectSiblings(doc);
  let current = obj;
  let depth = 0;
  while (typeof current.$ref === 'string' && depth < maxResolveDepth) {
    const summary = allowAnnotations && typeof current.summary === 'string' ? current.summary : undefined;
    const description = allowAnnotations && typeof current.description === 'string' ? current.description : undefined;
    const resolved = resolveRef(current.$ref, doc);
    if (!resolved) break;
    current = {
      ...resolved,
      ...(summary === undefined ? {} : { summary }),
      ...(description === undefined ? {} : { description }),
    };
    depth++;
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && jsonValuesEqual(left[key], right[key]))
  );
}

function declaredTypes(value: unknown): string[] | undefined {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return undefined;
  const types = value.filter((item): item is string => typeof item === 'string');
  return types.length > 0 ? Array.from(new Set(types)) : undefined;
}

function mergeAllOfSchemas(parts: Record<string, unknown>[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) {
      if (key === 'allOf' || key === '$ref') continue;
      if (key === 'properties' && isRecord(value)) {
        const properties = new Map<string, unknown>(
          isRecord(merged.properties) ? Object.entries(merged.properties) : [],
        );
        for (const [name, propertySchema] of Object.entries(value)) {
          const existing = properties.get(name);
          if (existing === undefined || existing === true) properties.set(name, propertySchema);
          else if (propertySchema === true) properties.set(name, existing);
          else if (existing === false || propertySchema === false) properties.set(name, false);
          else properties.set(name, { allOf: [existing, propertySchema] });
        }
        merged.properties = Object.fromEntries(properties);
        continue;
      }
      if (key === 'required' && Array.isArray(value)) {
        merged.required = Array.from(
          new Set([
            ...(Array.isArray(merged.required)
              ? merged.required.filter((item): item is string => typeof item === 'string')
              : []),
            ...value.filter((item): item is string => typeof item === 'string'),
          ]),
        );
        continue;
      }
      if (key === 'enum' && Array.isArray(value)) {
        const nextEnum = value as unknown[];
        const previousEnum = Array.isArray(merged.enum) ? (merged.enum as unknown[]) : undefined;
        merged.enum = previousEnum
          ? previousEnum.filter((candidate) => nextEnum.some((item) => jsonValuesEqual(candidate, item)))
          : Array.from(nextEnum);
        continue;
      }
      if (key === 'type') {
        const previousTypes = declaredTypes(merged.type);
        const nextTypes = declaredTypes(value);
        if (previousTypes && nextTypes) {
          const intersection = previousTypes.filter((type) => nextTypes.includes(type));
          merged.type = intersection.length === 1 ? intersection[0] : intersection;
        } else if (merged.type === undefined) {
          merged.type = value;
        }
        continue;
      }
      if (key === 'minimum' || key === 'exclusiveMinimum' || key === 'minLength' || key === 'minItems') {
        const previous = merged[key];
        merged[key] = typeof previous === 'number' && typeof value === 'number' ? Math.max(previous, value) : value;
        continue;
      }
      if (key === 'maximum' || key === 'exclusiveMaximum' || key === 'maxLength' || key === 'maxItems') {
        const previous = merged[key];
        merged[key] = typeof previous === 'number' && typeof value === 'number' ? Math.min(previous, value) : value;
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
  }

  if (merged.type === undefined && isRecord(merged.properties)) merged.type = 'object';
  return merged;
}

function normalizeAllOfSchemaInternal(
  schema: Record<string, unknown>,
  doc: Record<string, unknown>,
  maxResolveDepth: number,
  depth: number,
  refChain: readonly string[],
): Record<string, unknown> | undefined {
  if (depth > maxResolveDepth) return undefined;

  if (typeof schema.$ref === 'string') {
    if (refChain.includes(schema.$ref)) return undefined;
    const resolved = resolveRef(schema.$ref, doc);
    if (!resolved) return undefined;
    const normalized = normalizeAllOfSchemaInternal(resolved, doc, maxResolveDepth, depth + 1, [
      ...refChain,
      schema.$ref,
    ]);
    if (!normalized || !supportsReferenceObjectSiblings(doc)) return normalized;
    const siblings = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$ref'));
    return Object.keys(siblings).length > 0 ? mergeAllOfSchemas([normalized, siblings]) : normalized;
  }

  if (!Array.isArray(schema.allOf) || schema.allOf.length === 0) return schema;

  const normalizedParts: Record<string, unknown>[] = [];
  for (const part of schema.allOf) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) continue;
    const normalized = normalizeAllOfSchemaInternal(
      part as Record<string, unknown>,
      doc,
      maxResolveDepth,
      depth + 1,
      refChain,
    );
    if (normalized) normalizedParts.push(normalized);
  }

  const outer = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== 'allOf'));
  normalizedParts.push(outer);
  return mergeAllOfSchemas(normalizedParts);
}

/**
 * Canonicalize a structured request-body schema by resolving top-level `$ref`
 * chains and flattening nested `allOf` branches into one object schema. This
 * keeps form consumers on a single properties / required view while preserving
 * property schemas verbatim; oneOf / anyOf branches are not selected here.
 */
export function normalizeAllOfSchema(
  schema: Record<string, unknown>,
  doc: Record<string, unknown>,
  maxResolveDepth = 10,
): Record<string, unknown> {
  return normalizeAllOfSchemaInternal(schema, doc, maxResolveDepth, 0, []) ?? schema;
}
