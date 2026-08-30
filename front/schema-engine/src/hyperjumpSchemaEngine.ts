import { removeUriSchemePlugin, UnsupportedUriSchemeError, type Browser } from '@hyperjump/browser';
import {
  getAllRegisteredSchemaUris,
  registerSchema,
  unregisterSchema,
  type OutputUnit,
  type SchemaObject,
} from '@hyperjump/json-schema/openapi-3-1';
import {
  AnnotationsPlugin,
  BASIC,
  buildSchemaDocument,
  canonicalUri,
  compile,
  getSchema,
  interpret,
  toSchema,
  type CompiledSchema,
  type SchemaDocument,
} from '@hyperjump/json-schema/experimental';
import { fromJs } from '@hyperjump/json-schema/instance/experimental';
import { isIriReference, normalizeIri, parseIri, resolveIri, toAbsoluteIri } from '@hyperjump/uri';
import { EvaluationBudgetPlugin, inspectJsonValue, normalizeLimits } from './budgets';
import { SchemaEngineError } from './errors';
import type {
  EvaluationAnnotation,
  EvaluationIssue,
  EvaluationOptions,
  EvaluationResult,
  JsonValue,
  SchemaEngine,
  SchemaEngineLimits,
  SchemaEngineOptions,
  SchemaNode,
} from './types';

export const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema';
export const OPENAPI_31_BASE_DIALECT = 'https://spec.openapis.org/oas/3.1/dialect/base';

const OPENAPI_31_SCHEMA_BASE = 'https://spec.openapis.org/oas/3.1/schema-base';
const OPENAPI_31_SCHEMA_DRAFT_2020_12 = 'https://spec.openapis.org/oas/3.1/schema-draft-2020-12';
const OAS_31_VERSION = /^3\.1\.\d+(?:-.+)?$/;
const ANCHOR_NAME = /^[A-Za-z_][-A-Za-z0-9._]*$/;
const NETWORK_SCHEMES = new Set(['http:', 'https:', 'file:']);

const lockDownExternalResourceLoading = (): void => {
  removeUriSchemePlugin('http');
  removeUriSchemePlugin('https');
  removeUriSchemePlugin('file');
};

lockDownExternalResourceLoading();

const builtInResourceUris = new Set(getAllRegisteredSchemaUris().map((uri) => withoutFragment(uri)));
let activeOwner: symbol | undefined;

interface RegisteredDocument {
  retrievalUri: string;
  resourceUris: Set<string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function normalizeAbsoluteUri(uri: string, allowFragment: boolean): string {
  if (typeof uri !== 'string' || uri.length === 0) {
    throw new SchemaEngineError('INVALID_URI', 'Schema URI must be a non-empty absolute URI.', { uri });
  }
  if (!allowFragment && uri.includes('#')) {
    throw new SchemaEngineError('INVALID_URI', 'A retrieval URI must not contain a fragment.', { uri });
  }
  try {
    parseIri(uri);
    return normalizeIri(uri);
  } catch (error) {
    throw new SchemaEngineError('INVALID_URI', `Schema URI '${uri}' is not absolute.`, { uri }, error);
  }
}

function withoutFragment(uri: string): string {
  return toAbsoluteIri(uri);
}

const normalizeDialect = (dialect: string): string => (dialect.endsWith('#') ? dialect.slice(0, -1) : dialect);

function inspectResourceDeclarations(document: unknown, retrievalUri: string): void {
  const declared = new Map<string, string>([[withoutFragment(retrievalUri), '# (retrieval URI)']]);
  const anchors = new Map<string, Map<string, string>>();

  const addAnchor = (resourceUri: string, name: string, path: string): void => {
    if (!ANCHOR_NAME.test(name)) {
      throw new SchemaEngineError(
        'INVALID_DOCUMENT',
        `Schema anchor '${name}' at '${path}' is not a valid anchor name.`,
        {
          resourceUri,
        },
      );
    }
    const resourceAnchors = anchors.get(resourceUri) ?? new Map<string, string>();
    const previousPath = resourceAnchors.get(name);
    if (previousPath !== undefined) {
      throw new SchemaEngineError(
        'RESOURCE_URI_CONFLICT',
        `Schema anchor '${name}' in '${resourceUri}' is declared by both '${previousPath}' and '${path}'.`,
        { resourceUri },
      );
    }
    resourceAnchors.set(name, path);
    anchors.set(resourceUri, resourceAnchors);
  };

  const visit = (value: unknown, baseUri: string, path: string): void => {
    if (!isRecord(value)) {
      if (Array.isArray(value)) value.forEach((item, index) => visit(item, baseUri, `${path}/${index}`));
      return;
    }

    let resourceBase = baseUri;
    const declaresResource = path === '#' || typeof value.$id === 'string';
    if (typeof value.$id === 'string') {
      let resolved: string;
      try {
        if (!isIriReference(value.$id)) throw new Error('Value is not an IRI reference.');
        resolved = resolveIri(value.$id, baseUri);
      } catch (error) {
        throw new SchemaEngineError(
          'INVALID_DOCUMENT',
          `Schema resource identifier '${value.$id}' at '${path}/$id' is not a valid URI reference.`,
          { uri: value.$id },
          error,
        );
      }
      const fragment = parseIri(resolved).fragment;
      if (fragment !== undefined && fragment !== '') {
        throw new SchemaEngineError(
          'INVALID_DOCUMENT',
          `Schema resource identifier '${value.$id}' at '${path}/$id' must not contain a non-empty fragment.`,
          { uri: resolved },
        );
      }
      resourceBase = withoutFragment(resolved);
      const previousPath = declared.get(resourceBase);
      const rootIdentifierMatchesRetrieval = path === '#' && resourceBase === withoutFragment(retrievalUri);
      if (previousPath !== undefined && !rootIdentifierMatchesRetrieval) {
        throw new SchemaEngineError(
          'RESOURCE_URI_CONFLICT',
          `Schema resource URI '${resourceBase}' is declared by both '${previousPath}' and '${path}/$id'.`,
          { resourceUri: resourceBase },
        );
      }
      declared.set(resourceBase, `${path}/$id`);
    }

    if (declaresResource) {
      if (value.$vocabulary !== undefined) {
        throw new SchemaEngineError(
          'UNSUPPORTED_DIALECT',
          `Custom dialect declarations are not supported at schema resource '${resourceBase}'.`,
          { uri: resourceBase },
        );
      }
      if (typeof value.$schema === 'string') {
        const dialect = normalizeDialect(value.$schema);
        if (dialect !== JSON_SCHEMA_2020_12 && dialect !== OPENAPI_31_BASE_DIALECT) {
          throw new SchemaEngineError('UNSUPPORTED_DIALECT', `Unsupported JSON Schema dialect '${value.$schema}'.`, {
            uri: value.$schema,
          });
        }
      }
    }
    if (typeof value.$anchor === 'string') addAnchor(resourceBase, value.$anchor, `${path}/$anchor`);
    if (typeof value.$dynamicAnchor === 'string') {
      addAnchor(resourceBase, value.$dynamicAnchor, `${path}/$dynamicAnchor`);
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === '$id') continue;
      visit(child, resourceBase, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
    }
  };

  visit(document, retrievalUri, '#');
}

function contextDialectFor(document: unknown): string {
  if (!isRecord(document) || typeof document.openapi !== 'string') {
    if (isRecord(document) && typeof document.$schema === 'string') {
      const dialect = normalizeDialect(document.$schema);
      if (dialect !== JSON_SCHEMA_2020_12 && dialect !== OPENAPI_31_BASE_DIALECT) {
        throw new SchemaEngineError('UNSUPPORTED_DIALECT', `Unsupported JSON Schema dialect '${document.$schema}'.`, {
          uri: document.$schema,
        });
      }
    }
    return JSON_SCHEMA_2020_12;
  }

  if (!OAS_31_VERSION.test(document.openapi)) {
    throw new SchemaEngineError(
      'UNSUPPORTED_DIALECT',
      `SchemaEngine accepts OpenAPI 3.1.x documents; received '${document.openapi}'.`,
    );
  }

  if (document.jsonSchemaDialect === undefined) return OPENAPI_31_SCHEMA_BASE;
  if (typeof document.jsonSchemaDialect !== 'string') {
    throw new SchemaEngineError('INVALID_DOCUMENT', 'OpenAPI jsonSchemaDialect must be a URI string.');
  }
  const dialect = normalizeDialect(document.jsonSchemaDialect);
  if (dialect === OPENAPI_31_BASE_DIALECT) return OPENAPI_31_SCHEMA_BASE;
  if (dialect === JSON_SCHEMA_2020_12) return OPENAPI_31_SCHEMA_DRAFT_2020_12;
  throw new SchemaEngineError(
    'UNSUPPORTED_DIALECT',
    `Unsupported OpenAPI Schema dialect '${document.jsonSchemaDialect}'.`,
    {
      uri: document.jsonSchemaDialect,
    },
  );
}

function findCause<T extends Error>(error: unknown, type: new (...args: never[]) => T): T | undefined {
  let current = error;
  while (current instanceof Error) {
    if (current instanceof type) return current;
    current = current.cause;
  }
  return undefined;
}

function referencedResourceFrom(error: unknown): string | undefined {
  let current = error;
  while (current instanceof Error) {
    const match = /Unable to load resource '([^']+)'/.exec(current.message);
    if (match) return match[1];
    current = current.cause;
  }
  return undefined;
}

function asEngineError(error: unknown, operationUri: string): SchemaEngineError {
  if (error instanceof SchemaEngineError) return error;
  const resourceUri = referencedResourceFrom(error);
  const unsupportedScheme = findCause(error, UnsupportedUriSchemeError);
  if (unsupportedScheme) {
    const scheme = `${unsupportedScheme.scheme}:`;
    return new SchemaEngineError(
      NETWORK_SCHEMES.has(scheme) ? 'EXTERNAL_RESOURCE_LOADING_DISABLED' : 'RESOURCE_NOT_REGISTERED',
      NETWORK_SCHEMES.has(scheme)
        ? `External schema resource loading is disabled while resolving '${operationUri}'.`
        : `Schema resource '${resourceUri ?? operationUri}' is not registered.`,
      { uri: operationUri, resourceUri },
      error,
    );
  }
  if (error instanceof Error && error.message.includes('Encountered unknown dialect')) {
    return new SchemaEngineError('UNSUPPORTED_DIALECT', error.message, { uri: operationUri }, error);
  }
  return new SchemaEngineError(
    'SCHEMA_RESOLUTION_FAILED',
    `Unable to resolve or compile schema '${operationUri}'.`,
    { uri: operationUri, resourceUri },
    error,
  );
}

const normalizeInstanceLocation = (location: string): string =>
  location === '#' ? '' : location.startsWith('#/') ? location.slice(1) : location;

const clonePublicValue = <T>(value: T): T => structuredClone(value);

const cloneIssue = (unit: OutputUnit, budget: EvaluationBudgetPlugin): EvaluationIssue => {
  budget.assertWithinBudget();
  return {
    keyword: unit.keyword,
    absoluteKeywordLocation: unit.absoluteKeywordLocation,
    instanceLocation: normalizeInstanceLocation(unit.instanceLocation),
    // Hyperjump's runtime BASIC output omits `valid` on error units even though
    // its declaration currently marks the field as required. Do not leak that
    // upstream mismatch through Knife4j's stable result shape.
    valid: unit.valid ?? false,
    ...(unit.annotation === undefined ? {} : { annotation: clonePublicValue(unit.annotation) }),
    ...(unit.errors === undefined ? {} : { errors: unit.errors.map((nested) => cloneIssue(nested, budget)) }),
  };
};

const collectAnnotations = (units: OutputUnit[], budget: EvaluationBudgetPlugin): EvaluationAnnotation[] => {
  const grouped = new Map<string, EvaluationAnnotation>();
  for (const unit of units) {
    budget.assertWithinBudget();
    if (unit.annotation === undefined) continue;
    const instanceLocation = normalizeInstanceLocation(unit.instanceLocation);
    const key = `${instanceLocation}\u0000${unit.keyword}`;
    const existing = grouped.get(key);
    if (existing) existing.values.push(clonePublicValue(unit.annotation));
    else {
      grouped.set(key, {
        instanceLocation,
        keywordId: unit.keyword,
        values: [clonePublicValue(unit.annotation)],
      });
    }
  }
  return [...grouped.values()];
};

export class HyperjumpSchemaEngine implements SchemaEngine {
  private readonly owner = Symbol('knife4j-schema-engine');
  private readonly limits: Readonly<SchemaEngineLimits>;
  private readonly documents = new Map<string, RegisteredDocument>();
  private readonly resources = new Map<string, RegisteredDocument>();
  private readonly pendingRetrievalUris = new Set<string>();
  private readonly pendingResourceUris = new Set<string>();
  private readonly compiled = new Map<string, Promise<CompiledSchema>>();
  private generation = 0;
  private disposed = false;

  public constructor(options: SchemaEngineOptions = {}) {
    this.limits = normalizeLimits(options.limits);
  }

  public async registerDocument(document: unknown, retrievalUri: string): Promise<void> {
    this.assertUsable();
    const normalizedRetrievalUri = normalizeAbsoluteUri(retrievalUri, false);
    if (this.documents.has(normalizedRetrievalUri) || this.pendingRetrievalUris.has(normalizedRetrievalUri)) {
      throw new SchemaEngineError(
        'DOCUMENT_ALREADY_REGISTERED',
        `A document is already registered for '${normalizedRetrievalUri}'.`,
        { uri: normalizedRetrievalUri },
      );
    }
    if (activeOwner !== undefined && activeOwner !== this.owner) {
      throw new SchemaEngineError(
        'ENGINE_SCOPE_CONFLICT',
        'Hyperjump uses a realm-global registry; dispose the active SchemaEngine before registering with another instance.',
      );
    }

    inspectJsonValue(document, {
      kind: 'schema',
      maxNodes: this.limits.maxSchemaNodes,
      maxDepth: this.limits.maxSchemaDepth,
      maxReferences: this.limits.maxReferencesPerDocument,
    });
    if (typeof document !== 'boolean' && !isRecord(document)) {
      throw new SchemaEngineError('INVALID_DOCUMENT', 'A schema document must be an object or a boolean schema.');
    }
    const contextDialect = contextDialectFor(document);
    inspectResourceDeclarations(document, normalizedRetrievalUri);

    let preview: SchemaDocument;
    try {
      preview = buildSchemaDocument(
        structuredClone(document) as SchemaObject | boolean,
        normalizedRetrievalUri,
        contextDialect,
      );
    } catch (error) {
      throw asEngineError(error, normalizedRetrievalUri);
    }
    const resourceUris = new Set(
      Object.keys(preview.embedded ?? { [preview.baseUri]: preview }).map((uri) => withoutFragment(uri)),
    );
    resourceUris.add(withoutFragment(preview.baseUri));
    if (resourceUris.size > this.limits.maxResourcesPerDocument) {
      throw new SchemaEngineError('SCHEMA_BUDGET_EXCEEDED', 'Schema resource limit exceeded.', {
        limit: this.limits.maxResourcesPerDocument,
        actual: resourceUris.size,
      });
    }

    for (const resourceUri of resourceUris) {
      if (
        builtInResourceUris.has(resourceUri) ||
        this.resources.has(resourceUri) ||
        this.pendingResourceUris.has(resourceUri)
      ) {
        throw new SchemaEngineError(
          'RESOURCE_URI_CONFLICT',
          `Schema resource URI '${resourceUri}' is already registered.`,
          {
            resourceUri,
          },
        );
      }
    }
    if (
      builtInResourceUris.has(normalizedRetrievalUri) ||
      this.resources.has(normalizedRetrievalUri) ||
      this.pendingResourceUris.has(normalizedRetrievalUri)
    ) {
      throw new SchemaEngineError(
        'RESOURCE_URI_CONFLICT',
        `Schema retrieval URI '${normalizedRetrievalUri}' is already registered.`,
        { resourceUri: normalizedRetrievalUri },
      );
    }

    this.pendingRetrievalUris.add(normalizedRetrievalUri);
    this.pendingResourceUris.add(normalizedRetrievalUri);
    for (const resourceUri of resourceUris) this.pendingResourceUris.add(resourceUri);
    activeOwner = this.owner;
    let registered = false;
    try {
      registerSchema(document as SchemaObject | boolean, normalizedRetrievalUri, contextDialect);
      registered = true;
      const registration: RegisteredDocument = {
        retrievalUri: normalizedRetrievalUri,
        resourceUris,
      };
      this.documents.set(normalizedRetrievalUri, registration);
      this.resources.set(normalizedRetrievalUri, registration);
      for (const resourceUri of resourceUris) this.resources.set(resourceUri, registration);
      this.invalidateCompiledSchemas();
    } catch (error) {
      if (registered) unregisterSchema(normalizedRetrievalUri);
      throw asEngineError(error, normalizedRetrievalUri);
    } finally {
      this.pendingRetrievalUris.delete(normalizedRetrievalUri);
      this.pendingResourceUris.delete(normalizedRetrievalUri);
      for (const resourceUri of resourceUris) this.pendingResourceUris.delete(resourceUri);
      if (this.documents.size === 0 && this.pendingRetrievalUris.size === 0 && activeOwner === this.owner) {
        activeOwner = undefined;
      }
    }
  }

  public async resolve(schemaUri: string): Promise<SchemaNode> {
    this.assertUsable();
    const normalizedSchemaUri = normalizeAbsoluteUri(schemaUri, true);
    const generation = this.generation;
    try {
      const resource = await this.getResource(normalizedSchemaUri);
      this.assertGeneration(generation);
      return {
        requestedUri: normalizedSchemaUri,
        canonicalUri: canonicalUri(resource),
        resourceUri: resource.document.baseUri,
        dialectId: resource.document.dialectId,
        anchors: Object.freeze({ ...resource.document.anchors }),
        dynamicAnchors: Object.freeze({ ...resource.document.dynamicAnchors }),
        schema: toSchema(resource, { includeDialect: 'always', includeEmbedded: true }) as JsonValue,
      };
    } catch (error) {
      throw asEngineError(error, normalizedSchemaUri);
    }
  }

  public async evaluate(
    schemaUri: string,
    instance: unknown,
    options: EvaluationOptions = {},
  ): Promise<EvaluationResult> {
    this.assertUsable();
    const normalizedSchemaUri = normalizeAbsoluteUri(schemaUri, true);
    inspectJsonValue(instance, {
      kind: 'instance',
      maxNodes: this.limits.maxInstanceNodes,
      maxDepth: this.limits.maxInstanceDepth,
    });
    const budget = new EvaluationBudgetPlugin(
      this.limits.maxEvaluationSteps,
      this.limits.maxEvaluationMs,
      options.signal,
    );
    const generation = this.generation;

    try {
      const resource = await this.getResource(normalizedSchemaUri);
      const key = canonicalUri(resource);
      let compiled = this.compiled.get(key);
      if (!compiled) {
        compiled = compile(resource);
        this.compiled.set(key, compiled);
        compiled.catch(() => {
          if (this.compiled.get(key) === compiled) this.compiled.delete(key);
        });
      }
      const validator = await compiled;
      this.assertGeneration(generation);
      budget.assertWithinBudget();

      const annotations = new AnnotationsPlugin();
      const output = interpret(validator, fromJs(instance as JsonValue), {
        outputFormat: BASIC,
        plugins: [budget, annotations],
      });
      budget.assertWithinBudget();
      if (!output.valid) {
        return {
          valid: false,
          errors: output.errors?.map((unit) => cloneIssue(unit, budget)) ?? [],
          annotations: [],
        };
      }
      return {
        valid: true,
        errors: [],
        annotations: collectAnnotations(annotations.annotations, budget),
      };
    } catch (error) {
      throw asEngineError(error, normalizedSchemaUri);
    }
  }

  public unregisterDocument(retrievalUri: string): void {
    if (this.disposed) return;
    const normalizedRetrievalUri = normalizeAbsoluteUri(retrievalUri, false);
    const registration = this.documents.get(normalizedRetrievalUri);
    if (!registration) return;

    unregisterSchema(normalizedRetrievalUri);
    this.documents.delete(normalizedRetrievalUri);
    this.resources.delete(normalizedRetrievalUri);
    for (const resourceUri of registration.resourceUris) {
      if (this.resources.get(resourceUri) === registration) this.resources.delete(resourceUri);
    }
    this.invalidateCompiledSchemas();
    if (this.documents.size === 0 && this.pendingRetrievalUris.size === 0 && activeOwner === this.owner) {
      activeOwner = undefined;
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    for (const retrievalUri of [...this.documents.keys()]) this.unregisterDocument(retrievalUri);
    this.disposed = true;
    this.compiled.clear();
    if (activeOwner === this.owner) activeOwner = undefined;
  }

  private async getResource(schemaUri: string): Promise<Browser<SchemaDocument>> {
    const resourceUri = withoutFragment(schemaUri);
    const registration = this.resources.get(resourceUri);
    if (registration) {
      // Start from a fresh browser context so an unregistered document cannot
      // survive in Hyperjump's per-browser cache after lifecycle invalidation.
      const rootBrowser = await getSchema(registration.retrievalUri);
      return getSchema(schemaUri, rootBrowser);
    }
    if (builtInResourceUris.has(resourceUri)) return getSchema(schemaUri);

    const scheme = `${parseIri(resourceUri).scheme}:`;
    if (NETWORK_SCHEMES.has(scheme)) {
      throw new SchemaEngineError(
        'EXTERNAL_RESOURCE_LOADING_DISABLED',
        `External schema resource loading is disabled for '${resourceUri}'.`,
        { uri: schemaUri, resourceUri },
      );
    }
    throw new SchemaEngineError('RESOURCE_NOT_REGISTERED', `Schema resource '${resourceUri}' is not registered.`, {
      uri: schemaUri,
      resourceUri,
    });
  }

  private invalidateCompiledSchemas(): void {
    this.generation += 1;
    this.compiled.clear();
  }

  private assertUsable(): void {
    if (this.disposed) throw new SchemaEngineError('ENGINE_DISPOSED', 'SchemaEngine has been disposed.');
    lockDownExternalResourceLoading();
  }

  private assertGeneration(expected: number): void {
    if (expected !== this.generation) {
      throw new SchemaEngineError('ENGINE_STATE_CHANGED', 'Schema registry changed while an operation was running.');
    }
  }
}

export const createSchemaEngine = (options: SchemaEngineOptions = {}): SchemaEngine =>
  new HyperjumpSchemaEngine(options);
