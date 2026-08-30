import type { SchemaFieldNode } from 'knife4j-core';
import type { JsonValue, SchemaNode } from 'knife4j-schema-engine';
import type { SchemaDocumentSession } from './schemaDocumentSession';

const DEFAULT_MAX_DEPTH = 8;

const COMPOSITION_KEYWORDS = ['allOf', 'oneOf', 'anyOf'] as const;
type CompositionKeyword = (typeof COMPOSITION_KEYWORDS)[number];

const UNSUPPORTED_PROJECTION_KEYWORDS = new Set([
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'contains',
  'minContains',
  'maxContains',
  'minProperties',
  'maxProperties',
  'patternProperties',
  'propertyNames',
  'dependentRequired',
  'dependentSchemas',
  'unevaluatedItems',
  'unevaluatedProperties',
  'not',
  'if',
  'then',
  'else',
  'contentSchema',
]);

const REF_ASSERTION_SIBLINGS = new Set([
  'type',
  'enum',
  'const',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'pattern',
  'prefixItems',
  'items',
  'properties',
  'additionalProperties',
  'required',
  'allOf',
  'oneOf',
  'anyOf',
]);

export type SchemaProjectionDiagnosticSeverity = 'info' | 'warning';

export type SchemaProjectionDiagnosticCode =
  'CIRCULAR_REFERENCE' | 'MAX_DEPTH' | 'DYNAMIC_REFERENCE' | 'REFERENCE_UNAVAILABLE' | 'UNREPRESENTABLE_KEYWORD';

export interface SchemaProjectionDiagnostic {
  readonly code: SchemaProjectionDiagnosticCode;
  readonly severity: SchemaProjectionDiagnosticSeverity;
  readonly schemaUri: string;
  readonly path: string;
  readonly keyword?: string;
  readonly message?: string;
}

export interface SchemaDisplayProjection {
  readonly fields: SchemaFieldNode[];
  readonly diagnostics: SchemaProjectionDiagnostic[];
}

export interface SchemaDisplayProjectionOptions {
  readonly maxDepth?: number;
}

export interface SchemaDisplayProjectionRunOptions {
  readonly signal?: AbortSignal;
}

export interface SchemaDisplayProjector {
  project(reference: string, options?: SchemaDisplayProjectionRunOptions): Promise<SchemaDisplayProjection>;
}

interface ProjectionContext {
  readonly baseUri: string;
  readonly schemaUri: string;
  readonly path: string;
  readonly depth: number;
  readonly maxDepth: number;
  readonly referenceChain: ReadonlySet<string>;
  readonly diagnostics: SchemaProjectionDiagnostic[];
  readonly signal?: AbortSignal;
  readonly baseAlreadyIncludesOwnId: boolean;
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSchemaValue(value: JsonValue | undefined): value is JsonValue {
  return value !== undefined;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Schema display projection was aborted.');
  error.name = 'AbortError';
  throw error;
}

function jsonPointerToken(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function decodePointerToken(value: string): string {
  return value.replace(/~1/g, '/').replace(/~0/g, '~');
}

export function componentSchemaReference(name: string): string {
  return `#/components/schemas/${jsonPointerToken(name)}`;
}

function normalizedTypes(type: JsonValue | undefined): string[] | undefined {
  if (!Array.isArray(type)) return undefined;
  const values = type.filter((value): value is string => typeof value === 'string');
  return values.length > 0 ? Array.from(new Set(values)) : undefined;
}

function effectiveType(schema: { [key: string]: JsonValue }): string {
  if (typeof schema.type === 'string') return schema.type;
  const types = normalizedTypes(schema.type);
  const preferred = types?.find((type) => type !== 'null') ?? types?.[0];
  if (preferred) return preferred;
  if (schema.properties !== undefined || schema.additionalProperties !== undefined) return 'object';
  if (schema.items !== undefined || Array.isArray(schema.prefixItems)) return 'array';
  return 'unknown';
}

function firstExample(schema: { [key: string]: JsonValue }): unknown {
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];
  return undefined;
}

function schemaAnnotations(name: string, schema: { [key: string]: JsonValue }, required: boolean): SchemaFieldNode {
  return {
    name,
    type: effectiveType(schema),
    types: normalizedTypes(schema.type),
    format: typeof schema.format === 'string' ? schema.format : undefined,
    required,
    description: typeof schema.description === 'string' ? schema.description : undefined,
    default: schema.default,
    example: firstExample(schema),
    enum: Array.isArray(schema.enum) ? schema.enum : undefined,
    minLength: typeof schema.minLength === 'number' ? schema.minLength : undefined,
    maxLength: typeof schema.maxLength === 'number' ? schema.maxLength : undefined,
    minimum: typeof schema.minimum === 'number' ? schema.minimum : undefined,
    maximum: typeof schema.maximum === 'number' ? schema.maximum : undefined,
    exclusiveMinimum: typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum : undefined,
    exclusiveMaximum: typeof schema.exclusiveMaximum === 'number' ? schema.exclusiveMaximum : undefined,
    contentMediaType: typeof schema.contentMediaType === 'string' ? schema.contentMediaType : undefined,
    contentEncoding: typeof schema.contentEncoding === 'string' ? schema.contentEncoding : undefined,
    pattern: typeof schema.pattern === 'string' ? schema.pattern : undefined,
    readOnly: typeof schema.readOnly === 'boolean' ? schema.readOnly : undefined,
    writeOnly: typeof schema.writeOnly === 'boolean' ? schema.writeOnly : undefined,
    deprecated: typeof schema.deprecated === 'boolean' ? schema.deprecated : undefined,
    constValue: schema.const,
  };
}

function booleanNode(name: string, schema: boolean, required: boolean): SchemaFieldNode {
  return {
    name,
    type: schema ? 'unknown' : 'never',
    required,
    booleanSchema: schema,
  };
}

function appendDiagnostic(
  ctx: ProjectionContext,
  code: SchemaProjectionDiagnosticCode,
  severity: SchemaProjectionDiagnosticSeverity,
  keyword?: string,
  message?: string,
): void {
  ctx.diagnostics.push({
    code,
    severity,
    schemaUri: ctx.schemaUri,
    path: ctx.path,
    ...(keyword === undefined ? {} : { keyword }),
    ...(message === undefined ? {} : { message }),
  });
}

function reportUnsupportedKeywords(schema: { [key: string]: JsonValue }, ctx: ProjectionContext): boolean {
  let found = false;
  for (const keyword of UNSUPPORTED_PROJECTION_KEYWORDS) {
    if (Object.prototype.hasOwnProperty.call(schema, keyword)) {
      found = true;
      appendDiagnostic(ctx, 'UNREPRESENTABLE_KEYWORD', 'warning', keyword);
    }
  }
  return found;
}

function childContext(ctx: ProjectionContext, path: string, baseUri = ctx.baseUri): ProjectionContext {
  return {
    ...ctx,
    baseUri,
    schemaUri: baseUri,
    path,
    depth: ctx.depth + 1,
    baseAlreadyIncludesOwnId: false,
  };
}

function withResolvedNode(ctx: ProjectionContext, node: SchemaNode, referenceUri: string): ProjectionContext {
  return {
    ...ctx,
    baseUri: node.resourceUri,
    schemaUri: node.canonicalUri,
    referenceChain: new Set([...ctx.referenceChain, referenceUri, node.canonicalUri]),
    baseAlreadyIncludesOwnId: true,
  };
}

function effectiveBaseUri(schema: { [key: string]: JsonValue }, ctx: ProjectionContext): string {
  if (ctx.baseAlreadyIncludesOwnId || typeof schema.$id !== 'string') return ctx.baseUri;
  return new URL(schema.$id, ctx.baseUri).href;
}

function resolvedReferenceUri(reference: string, baseUri: string): string {
  return new URL(reference, baseUri).href;
}

function referenceName(reference: string): string | undefined {
  try {
    const url = new URL(reference);
    const fragment = url.hash.slice(1);
    if (fragment.startsWith('/')) {
      const pointerTokens = fragment.slice(1).split('/');
      const token = pointerTokens[pointerTokens.length - 1];
      return token ? decodePointerToken(decodeURIComponent(token)) : undefined;
    }
    if (fragment && !fragment.startsWith('/')) return decodeURIComponent(fragment);
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const pathName = pathSegments[pathSegments.length - 1];
    return pathName ? decodeURIComponent(pathName) : undefined;
  } catch {
    return undefined;
  }
}

function hasRefAssertionSiblings(schema: { [key: string]: JsonValue }): boolean {
  return Object.keys(schema).some((keyword) => keyword !== '$ref' && REF_ASSERTION_SIBLINGS.has(keyword));
}

function annotationOverlay(
  target: SchemaFieldNode,
  outer: { [key: string]: JsonValue },
  targetSchema: JsonValue,
  refName: string | undefined,
): SchemaFieldNode {
  const own = schemaAnnotations(target.name, outer, target.required);
  const targetRecord = isRecord(targetSchema) ? targetSchema : undefined;
  const ownDescription = typeof outer.description === 'string' ? outer.description : undefined;
  const targetDescription = target.description;
  return {
    ...target,
    refName,
    description: ownDescription ?? targetDescription,
    refDescription:
      ownDescription && targetDescription && ownDescription !== targetDescription
        ? targetDescription
        : target.refDescription,
    refTitle: targetRecord && typeof targetRecord.title === 'string' ? targetRecord.title : target.refTitle,
    format: own.format ?? target.format,
    default: outer.default !== undefined ? outer.default : target.default,
    example: firstExample(outer) ?? target.example,
    readOnly: own.readOnly ?? target.readOnly,
    writeOnly: own.writeOnly ?? target.writeOnly,
    deprecated: own.deprecated ?? target.deprecated,
    contentMediaType: own.contentMediaType ?? target.contentMediaType,
    contentEncoding: own.contentEncoding ?? target.contentEncoding,
  };
}

function compositionType(schema: { [key: string]: JsonValue }): string | undefined {
  const keywords = COMPOSITION_KEYWORDS.filter((keyword) => Array.isArray(schema[keyword]));
  return keywords.length > 0 ? keywords.join(' + ') : undefined;
}

function rootFields(node: SchemaFieldNode): SchemaFieldNode[] {
  const composition = node.type
    .split(' + ')
    .every((keyword) => COMPOSITION_KEYWORDS.includes(keyword as CompositionKeyword));
  if (node.type === 'object' || composition) {
    return node.children ?? [];
  }
  return [node];
}

export function createSchemaDisplayProjector(
  session: SchemaDocumentSession,
  options: SchemaDisplayProjectionOptions = {},
): SchemaDisplayProjector {
  const maxDepth = Math.max(1, Math.floor(options.maxDepth ?? DEFAULT_MAX_DEPTH));
  const resolvedNodes = new Map<string, Promise<SchemaNode>>();

  const resolveNode = (reference: string, baseUri: string): { uri: string; node: Promise<SchemaNode> } => {
    const uri = resolvedReferenceUri(reference, baseUri);
    let node = resolvedNodes.get(uri);
    if (!node) {
      node = session.resolve(uri);
      resolvedNodes.set(uri, node);
      node.catch(() => {
        if (resolvedNodes.get(uri) === node) resolvedNodes.delete(uri);
      });
    }
    return { uri, node };
  };

  const projectNode = async (
    name: string,
    schema: JsonValue,
    required: boolean,
    ctx: ProjectionContext,
  ): Promise<SchemaFieldNode> => {
    throwIfAborted(ctx.signal);
    if (typeof schema === 'boolean') return booleanNode(name, schema, required);
    if (!isRecord(schema)) return { name, type: 'unknown', required };

    const baseUri = effectiveBaseUri(schema, ctx);
    const localCtx: ProjectionContext = {
      ...ctx,
      baseUri,
      schemaUri: baseUri,
      baseAlreadyIncludesOwnId: true,
    };
    const hasUnsupportedKeywords = reportUnsupportedKeywords(schema, localCtx);
    const hasDynamicReference = typeof schema.$dynamicRef === 'string';
    let hasProjectionLoss = hasUnsupportedKeywords || hasDynamicReference;
    if (hasDynamicReference) appendDiagnostic(localCtx, 'DYNAMIC_REFERENCE', 'warning', '$dynamicRef');

    if (ctx.depth >= ctx.maxDepth) {
      appendDiagnostic(localCtx, 'MAX_DEPTH', 'info');
      const refName =
        typeof schema.$ref === 'string' ? referenceName(resolvedReferenceUri(schema.$ref, baseUri)) : undefined;
      return {
        ...schemaAnnotations(name, schema, required),
        ...(refName === undefined ? {} : { refName }),
        truncated: true,
      };
    }

    if (typeof schema.$ref === 'string') {
      const { uri, node: pendingNode } = resolveNode(schema.$ref, baseUri);
      const refName = referenceName(uri);
      if (ctx.referenceChain.has(uri)) {
        appendDiagnostic(localCtx, 'CIRCULAR_REFERENCE', 'info', '$ref');
        return {
          ...schemaAnnotations(name, schema, required),
          type: 'object',
          refName,
          truncated: true,
        };
      }

      try {
        const target = await pendingNode;
        throwIfAborted(ctx.signal);
        if (ctx.referenceChain.has(target.canonicalUri)) {
          appendDiagnostic(localCtx, 'CIRCULAR_REFERENCE', 'info', '$ref');
          return {
            ...schemaAnnotations(name, schema, required),
            type: 'object',
            refName,
            truncated: true,
          };
        }

        const targetNode = await projectNode(name, target.schema, required, withResolvedNode(localCtx, target, uri));
        const projectedTarget = {
          ...annotationOverlay(targetNode, schema, target.schema, refName),
          ...(!hasUnsupportedKeywords && !hasDynamicReference ? {} : { truncated: true }),
        };
        if (!hasRefAssertionSiblings(schema)) return projectedTarget;

        const siblingSchema = { ...schema };
        delete siblingSchema.$ref;
        delete siblingSchema.$dynamicRef;
        for (const keyword of UNSUPPORTED_PROJECTION_KEYWORDS) delete siblingSchema[keyword];
        const siblingContext = childContext(localCtx, `${ctx.path}.$ref-siblings`, baseUri);
        const siblingNode = await projectNode('allOf[2]', siblingSchema, false, {
          ...siblingContext,
          baseAlreadyIncludesOwnId: true,
        });
        return {
          ...schemaAnnotations(name, schema, required),
          type: 'allOf',
          refName,
          ...(!hasUnsupportedKeywords && !hasDynamicReference ? {} : { truncated: true }),
          children: [{ ...projectedTarget, name: 'allOf[1]', required: false }, siblingNode],
        };
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        const message =
          error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
            ? error.code
            : error instanceof Error
              ? error.message
              : undefined;
        appendDiagnostic(localCtx, 'REFERENCE_UNAVAILABLE', 'warning', '$ref', message);
        return {
          ...schemaAnnotations(name, schema, required),
          refName,
          truncated: true,
        };
      }
    }

    const node = schemaAnnotations(name, schema, required);
    const children: SchemaFieldNode[] = [];

    if (isRecord(schema.properties)) {
      const requiredNames = new Set(
        Array.isArray(schema.required)
          ? schema.required.filter((value): value is string => typeof value === 'string')
          : [],
      );
      for (const [propertyName, propertySchema] of Object.entries(schema.properties)) {
        children.push(
          await projectNode(
            propertyName,
            propertySchema,
            requiredNames.has(propertyName),
            childContext(localCtx, `${ctx.path}.properties.${propertyName}`, baseUri),
          ),
        );
      }
    }

    const propertyCount = isRecord(schema.properties) ? Object.keys(schema.properties).length : 0;
    if (propertyCount === 0 && isRecord(schema.additionalProperties)) {
      children.push(
        await projectNode(
          '*',
          schema.additionalProperties,
          false,
          childContext(localCtx, `${ctx.path}.additionalProperties`, baseUri),
        ),
      );
    } else if (
      schema.additionalProperties !== undefined &&
      schema.additionalProperties !== true &&
      (propertyCount > 0 || schema.additionalProperties === false)
    ) {
      appendDiagnostic(localCtx, 'UNREPRESENTABLE_KEYWORD', 'warning', 'additionalProperties');
      hasProjectionLoss = true;
    }

    if (Array.isArray(schema.prefixItems)) {
      for (const [index, item] of schema.prefixItems.entries()) {
        children.push(
          await projectNode(
            `[${index}]`,
            item,
            false,
            childContext(localCtx, `${ctx.path}.prefixItems[${index}]`, baseUri),
          ),
        );
      }
    }

    if (schema.items !== undefined && isSchemaValue(schema.items)) {
      children.push(
        await projectNode('items', schema.items, false, childContext(localCtx, `${ctx.path}.items`, baseUri)),
      );
    }

    for (const keyword of COMPOSITION_KEYWORDS) {
      const branches = schema[keyword];
      if (!Array.isArray(branches)) continue;
      for (const [index, branch] of branches.entries()) {
        children.push(
          await projectNode(
            `${keyword}[${index + 1}]`,
            branch,
            false,
            childContext(localCtx, `${ctx.path}.${keyword}[${index}]`, baseUri),
          ),
        );
      }
    }

    if (hasProjectionLoss) node.truncated = true;

    const composition = compositionType(schema);
    if (composition) node.type = composition;
    if (children.length > 0) node.children = children;
    return node;
  };

  return {
    async project(reference, runOptions = {}) {
      throwIfAborted(runOptions.signal);
      const diagnostics: SchemaProjectionDiagnostic[] = [];
      const { uri, node: pendingNode } = resolveNode(reference, session.retrievalUri);
      const schemaNode = await pendingNode;
      throwIfAborted(runOptions.signal);
      const context: ProjectionContext = {
        baseUri: schemaNode.resourceUri,
        schemaUri: schemaNode.canonicalUri,
        path: '$',
        depth: 0,
        maxDepth,
        referenceChain: new Set([uri, schemaNode.canonicalUri]),
        diagnostics,
        signal: runOptions.signal,
        baseAlreadyIncludesOwnId: true,
      };
      const projected = await projectNode('', schemaNode.schema, false, context);
      return { fields: rootFields(projected), diagnostics };
    },
  };
}
