import { registerSchema } from '@hyperjump/json-schema/openapi-3-1';
import { defineVocabulary } from '@hyperjump/json-schema/experimental';
import { SchemaEngineError } from './errors';

export const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema';
export const OPENAPI_31_BASE_DIALECT = 'https://spec.openapis.org/oas/3.1/dialect/base';
export const OPENAPI_32_DIALECT = 'https://spec.openapis.org/oas/3.2/dialect/2025-09-17';
export const OAS32_SCHEMA_ADAPTER = 'urn:knife4j-internal:oas32:schema:1';
export const OAS32_DOCUMENT_WRAPPER = 'urn:knife4j-internal:oas32:document:1';
const OAS32_META = 'https://spec.openapis.org/oas/3.2/meta/2025-09-17';
const OAS32_VOCABULARY = 'https://spec.openapis.org/oas/3.2/vocab/base';

export function publicSchemaDialect(value: unknown, fallback = OPENAPI_31_BASE_DIALECT): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string')
    throw new SchemaEngineError('INVALID_DOCUMENT', 'Schema dialect must be a URI string.');
  const dialect = value.endsWith('#') ? value.slice(0, -1) : value;
  if (![JSON_SCHEMA_2020_12, OPENAPI_31_BASE_DIALECT, OPENAPI_32_DIALECT].includes(dialect)) {
    throw new SchemaEngineError('UNSUPPORTED_DIALECT', `Unsupported Schema dialect '${value}'.`, { uri: value });
  }
  return dialect;
}

export const processingSchemaDialect = (dialect: string): string =>
  dialect === JSON_SCHEMA_2020_12 ? dialect : OAS32_SCHEMA_ADAPTER;

/**
 * Pinned from the official 2025-09-17 OAS vocabulary/meta-schema. The prose
 * (§4.25.1) additionally requires propertyName; no global 3.1 definition changes.
 * https://spec.openapis.org/oas/3.2/meta/2025-09-17.html
 */
const annotations = {
  type: ['object', 'boolean'],
  properties: {
    discriminator: {
      type: 'object',
      properties: {
        propertyName: { type: 'string' },
        mapping: { type: 'object', additionalProperties: { type: 'string' } },
        defaultMapping: { type: 'string' },
      },
      required: ['propertyName'],
      patternProperties: { '^x-': true },
      additionalProperties: false,
    },
    example: { deprecated: true },
    externalDocs: {
      type: 'object',
      properties: { url: { type: 'string', format: 'uri-reference' }, description: { type: 'string' } },
      required: ['url'],
      patternProperties: { '^x-': true },
      additionalProperties: false,
    },
    xml: {
      type: 'object',
      properties: {
        nodeType: { enum: ['element', 'attribute', 'text', 'cdata', 'none'] },
        name: { type: 'string' },
        namespace: { type: 'string', format: 'iri' },
        prefix: { type: 'string' },
        attribute: { type: 'boolean', deprecated: true },
        wrapped: { type: 'boolean', deprecated: true },
      },
      dependentSchemas: { nodeType: { properties: { attribute: false, wrapped: false } } },
      patternProperties: { '^x-': true },
      additionalProperties: false,
    },
  },
};
const vocabulary = Object.fromEntries(
  ['core', 'applicator', 'unevaluated', 'validation', 'meta-data', 'format-annotation', 'content'].map((name) => [
    `https://json-schema.org/draft/2020-12/vocab/${name}`,
    true,
  ]),
);

/** Called once, before the engine captures its immutable built-in URI set. */
export function registerOpenApi32Dialects(): void {
  defineVocabulary(
    OAS32_VOCABULARY,
    Object.fromEntries(
      ['discriminator', 'example', 'externalDocs', 'xml'].map((name) => [
        name,
        `https://spec.openapis.org/oas/3.0/keyword/${name}`,
      ]),
    ),
  );
  registerSchema({ $schema: JSON_SCHEMA_2020_12, $dynamicAnchor: 'meta', ...annotations }, OAS32_META);
  registerSchema(
    {
      $schema: JSON_SCHEMA_2020_12,
      $dynamicAnchor: 'meta',
      $vocabulary: { ...vocabulary, [OAS32_VOCABULARY]: false },
      allOf: [{ $ref: JSON_SCHEMA_2020_12 }, { $ref: OAS32_META }],
    },
    OPENAPI_32_DIALECT,
  );
  registerSchema(
    {
      $schema: JSON_SCHEMA_2020_12,
      $dynamicAnchor: 'meta',
      $vocabulary: { ...vocabulary, 'https://spec.openapis.org/oas/3.1/vocab/base': false },
      allOf: [
        { $ref: JSON_SCHEMA_2020_12 },
        {
          // Every real Schema position receives its effective processing dialect
          // in the private copy. Explicit pure JSON Schema keeps OAS annotations opaque.
          if: { properties: { $schema: { const: JSON_SCHEMA_2020_12 } }, required: ['$schema'] },
          then: true,
          else: annotations,
        },
      ],
    },
    OAS32_SCHEMA_ADAPTER,
  );
  // This wrapper handles OAS containers only; it is not a complete OAS validator.
  // Schema meta-validation runs explicitly over typed roots, including schemas
  // in external OAS fragments. Core separately reports partial structural diagnostics.
  registerSchema(
    {
      $schema: JSON_SCHEMA_2020_12,
      $vocabulary: { ...vocabulary, 'https://spec.openapis.org/oas/3.1/vocab/base': false },
      type: ['object', 'boolean'],
    },
    OAS32_DOCUMENT_WRAPPER,
  );
}
