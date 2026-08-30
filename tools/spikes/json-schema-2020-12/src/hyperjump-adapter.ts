import {
  removeUriSchemePlugin,
  UnsupportedUriSchemeError,
  type Browser,
} from '@hyperjump/browser'
import {
  registerSchema,
  unregisterSchema,
  type Output,
  type OutputUnit,
  type SchemaObject,
} from '@hyperjump/json-schema/openapi-3-1'
import { interpret as collectEvaluationAnnotations } from '@hyperjump/json-schema/annotations/experimental'
import {
  allNodes,
  fromJs,
  type JsonNode,
} from '@hyperjump/json-schema/annotated-instance/experimental'
import { bundle } from '@hyperjump/json-schema/bundle'
import {
  BASIC,
  canonicalUri,
  compile,
  getSchema,
  interpret,
  toSchema,
  type CompiledSchema,
  type SchemaDocument,
} from '@hyperjump/json-schema/experimental'

export const JSON_SCHEMA_2020_12 =
  'https://json-schema.org/draft/2020-12/schema'
export const OPENAPI_31_BASE_DIALECT =
  'https://spec.openapis.org/oas/3.1/dialect/base'

const OPENAPI_31_SCHEMA_BASE =
  'https://spec.openapis.org/oas/3.1/schema-base'
const OPENAPI_31_SCHEMA_DRAFT_2020_12 =
  'https://spec.openapis.org/oas/3.1/schema-draft-2020-12'

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export interface AnnotationResult {
  instanceLocation: string
  keywordId: string
  values: unknown[]
}

export interface EvaluationResult {
  valid: boolean
  errors: OutputUnit[]
  annotations: AnnotationResult[]
}

export interface ResolvedSchemaResource {
  requestedUri: string
  canonicalUri: string
  baseUri: string
  dialectId: string
  anchors: Record<string, string>
  dynamicAnchors: Record<string, string>
  schema: unknown
}

export class SchemaResourcePolicyError extends Error {
  public readonly code = 'EXTERNAL_RESOURCE_LOADING_DISABLED'
  public readonly resourceUri?: string

  public constructor(operationUri: string, cause: unknown) {
    const retrievalMessage =
      cause instanceof Error
        ? /Unable to load resource '([^']+)'/.exec(cause.message)
        : null
    super(
      `External schema resource loading is disabled while resolving '${operationUri}'.`,
      { cause },
    )
    this.name = 'SchemaResourcePolicyError'
    this.resourceUri = retrievalMessage?.[1]
  }
}

/**
 * Hyperjump enables http(s) and file retrieval by default. Knife4j must start
 * from a registry-only policy and add any future loader explicitly.
 */
export const lockDownExternalResourceLoading = (): void => {
  removeUriSchemePlugin('http')
  removeUriSchemePlugin('https')
  removeUriSchemePlugin('file')
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const contextDialectFor = (document: unknown): string => {
  if (!isRecord(document) || typeof document.openapi !== 'string') {
    return JSON_SCHEMA_2020_12
  }

  if (!/^3\.1\.\d+(?:-.+)?$/.test(document.openapi)) {
    throw new Error(
      `The spike adapter only accepts OpenAPI 3.1.x documents; received '${document.openapi}'.`,
    )
  }

  const dialect = document.jsonSchemaDialect
  if (dialect === undefined || dialect === OPENAPI_31_BASE_DIALECT) {
    return OPENAPI_31_SCHEMA_BASE
  }
  if (dialect === JSON_SCHEMA_2020_12) {
    return OPENAPI_31_SCHEMA_DRAFT_2020_12
  }

  throw new Error(
    `The spike adapter does not load the custom OpenAPI dialect '${String(dialect)}'.`,
  )
}

const collectAnnotations = (root: JsonNode): AnnotationResult[] => {
  const annotations: AnnotationResult[] = []

  for (const node of allNodes(root)) {
    for (const [keywordId, values] of Object.entries(node.annotations)) {
      annotations.push({
        instanceLocation: node.pointer,
        keywordId,
        values,
      })
    }
  }

  return annotations
}

const hasUnsupportedSchemeCause = (error: unknown): boolean => {
  let current = error
  while (current instanceof Error) {
    if (current instanceof UnsupportedUriSchemeError) {
      return true
    }
    current = current.cause
  }
  return false
}

const normalizeResourceError = (error: unknown, operationUri: string): never => {
  if (hasUnsupportedSchemeCause(error)) {
    throw new SchemaResourcePolicyError(operationUri, error)
  }
  throw error
}

/**
 * A deliberately small anti-corruption layer for the phase 0 probe. It keeps
 * Hyperjump's experimental graph and annotation APIs out of Knife4j product
 * code while their stability is evaluated.
 */
export class HyperjumpSchemaEngineProbe {
  private readonly registeredUris = new Set<string>()

  public constructor() {
    lockDownExternalResourceLoading()
  }

  public async registerDocument(
    document: JsonValue,
    retrievalUri: string,
  ): Promise<void> {
    const parsedUri = new URL(retrievalUri)
    if (parsedUri.hash) {
      throw new Error('A retrieval URI must not contain a fragment.')
    }

    registerSchema(
      document as SchemaObject | boolean,
      parsedUri.href,
      contextDialectFor(document),
    )
    this.registeredUris.add(parsedUri.href)
  }

  public async resolve(schemaUri: string): Promise<ResolvedSchemaResource> {
    const resource = await this.getRegisteredResource(schemaUri)

    return {
      requestedUri: schemaUri,
      canonicalUri: canonicalUri(resource),
      baseUri: resource.document.baseUri,
      dialectId: resource.document.dialectId,
      anchors: { ...resource.document.anchors },
      dynamicAnchors: { ...resource.document.dynamicAnchors },
      schema: toSchema(resource, {
        includeDialect: 'always',
        includeEmbedded: true,
      }),
    }
  }

  public async evaluate(
    schemaUri: string,
    instance: JsonValue,
  ): Promise<EvaluationResult> {
    try {
      const resource = await this.getRegisteredResource(schemaUri)
      const compiledSchema: CompiledSchema = await compile(resource)
      const validation: Output = interpret(
        compiledSchema,
        fromJs(instance),
        BASIC,
      )
      if (!validation.valid) {
        return {
          valid: false,
          errors: 'errors' in validation ? validation.errors ?? [] : [],
          annotations: [],
        }
      }

      const annotatedInstance = collectEvaluationAnnotations(
        compiledSchema,
        fromJs(instance),
        BASIC,
      )
      return {
        valid: true,
        errors: [],
        annotations: collectAnnotations(annotatedInstance),
      }
    } catch (error) {
      return normalizeResourceError(error, schemaUri)
    }
  }

  public async bundle(schemaUri: string): Promise<unknown> {
    try {
      return await bundle(schemaUri, { alwaysIncludeDialect: true })
    } catch (error) {
      normalizeResourceError(error, schemaUri)
    }
  }

  public unregisterDocument(retrievalUri: string): void {
    const normalizedUri = new URL(retrievalUri).href
    if (!this.registeredUris.delete(normalizedUri)) {
      return
    }
    unregisterSchema(normalizedUri)
  }

  public dispose(): void {
    for (const uri of this.registeredUris) {
      unregisterSchema(uri)
    }
    this.registeredUris.clear()
  }

  private async getRegisteredResource(
    schemaUri: string,
  ): Promise<Browser<SchemaDocument>> {
    let directError: unknown
    try {
      return await getSchema(schemaUri)
    } catch (error) {
      directError = error
    }

    // Hyperjump keeps embedded $id resources in the root document's browser
    // context rather than adding every embedded identifier to its global
    // registry. Hide that lookup detail behind the adapter.
    for (const rootUri of this.registeredUris) {
      try {
        const root = await getSchema(rootUri)
        return await getSchema(schemaUri, root)
      } catch {
        // Try the next registered root. Network schemes have already been
        // removed, so a miss cannot trigger I/O.
      }
    }

    return normalizeResourceError(directError, schemaUri)
  }
}
