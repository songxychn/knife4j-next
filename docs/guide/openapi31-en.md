---
title: OpenAPI 3.1 Support and Migration
description: Knife4j Next support matrix, JSON Schema 2020-12 boundary, security model, browser constraints, and migration notes for OpenAPI 3.1.x.
lang: en-US
---

# OpenAPI 3.1 Support and Migration

[中文契约](./openapi31) · [Download minimal JSON](/examples/openapi-3.1-minimal.json) · [Download minimal YAML](/examples/openapi-3.1-minimal.yaml)

This page describes the OpenAPI 3.1 contract of the current `master` source. Check the
[release notes](../release-notes/) and [version reference](../reference/version-ref) before assuming that a released artifact contains these capabilities.
This document does not change any starter, default setting, or release version.

## Supported versions

OpenAPI defines its feature set at the `major.minor` level. The currently published `3.1.0`, `3.1.1`, and `3.1.2`
therefore share one **OpenAPI 3.1 feature set** without patch-specific capability forks. Existing OpenAPI 3.0.x behavior remains available;
OpenAPI 3.2.x is out of scope. A future 3.1 patch is not promised before verification; the explicit offline-export allowlist is tracked by
[#739](https://github.com/songxychn/knife4j-next/issues/739).

| Document version | UI | Status | Contract |
| --- | --- | --- | --- |
| Swagger / OpenAPI 2.0 | Vue 3 | Maintenance | Provided by the openapi2 starters; no OAS 3.1 expansion |
| OpenAPI 3.0.x | React | Supported | Existing parsing, debugging, export, and change-tracking paths remain |
| OpenAPI 3.1.0 / 3.1.1 / 3.1.2 | React | Supported | The currently published 3.1 patches share one contract, subject to the boundaries below |
| Future OpenAPI 3.1 patch | React | Pending verification | Not promised automatically; offline export rejects a patch outside its allowlist, tracked by [#739](https://github.com/songxychn/knife4j-next/issues/739) |
| OpenAPI 3.2.x | React | Unsupported | Never guessed or treated as 3.1 |

### springdoc generation matrix

| Spring Boot | starter / springdoc | Generated document | Verified path | Evidence |
| --- | --- | --- | --- | --- |
| Boot 2.x | non-Jakarta openapi3 / springdoc `1.8.0` | OpenAPI 3.0.x | Existing compatibility baseline | [#737](https://github.com/songxychn/knife4j-next/pull/737) |
| Boot 3.x WebMVC | Jakarta openapi3 / springdoc `2.8.9` | OpenAPI 3.1 when explicitly enabled | Real `/v3/api-docs` → Java smoke → React / SchemaEngine | [#737](https://github.com/songxychn/knife4j-next/pull/737) |
| Boot 3.x WebFlux | Jakarta webflux / springdoc `2.8.9` | OpenAPI 3.1 when explicitly enabled | Real `/v3/api-docs` → Java smoke → React / SchemaEngine | [#737](https://github.com/songxychn/knife4j-next/pull/737) |
| Boot 4.x WebMVC | Boot4 starter / springdoc `3.0.3` | OpenAPI 3.1 by default or explicitly | Both configurations passed the end-to-end matrix | [#737](https://github.com/songxychn/knife4j-next/pull/737) |

Enable OAS 3.1 generation explicitly on Boot 3:

```yaml
springdoc:
  api-docs:
    version: OPENAPI_3_1
```

Boot 2 with springdoc 1.8.0 remains on OAS 3.0. Changing only the `openapi` string does not turn a 3.0 document into a valid 3.1 document.
See the complete starter combinations in the [compatibility matrix](../reference/compatibility).

## Product capability matrix

Unless a row says otherwise, “supported” below means the currently published `3.1.0`, `3.1.1`, and `3.1.2`.

| Capability | OAS 3.1.0–3.1.2 behavior | Boundary | Merged evidence |
| --- | --- | --- | --- |
| Single and multi-document loading | The entry document and controlled cross-document resources share one 3.1 parsing session | A 3.2 document does not enter the 3.1 workflow | [#682](https://github.com/songxychn/knife4j-next/pull/682), [#689](https://github.com/songxychn/knife4j-next/pull/689), [#727](https://github.com/songxychn/knife4j-next/pull/727) |
| Document objects and Webhooks | Supports `paths`, `components`, `webhooks`, and 3.1 Reference Objects; at least one of the three fields must be declared | A Webhook is an inbound contract, not a regular Path request | [#717](https://github.com/songxychn/knife4j-next/pull/717) |
| Schema dialect | OAS 3.1 Base Dialect and the standard JSON Schema Draft 2020-12 vocabularies | Arbitrary custom dialects are not assigned invented semantics | [#687](https://github.com/songxychn/knife4j-next/pull/687), [#689](https://github.com/songxychn/knife4j-next/pull/689) |
| Field tree and models | Handles union types, boolean schemas, `const`, conditional/composition keywords, and dynamic references | Custom vocabularies are not executed; see [#740](https://github.com/songxychn/knife4j-next/issues/740) for the reserved-key pre-scan limitation in opaque payloads | [#692](https://github.com/songxychn/knife4j-next/pull/692), [#694](https://github.com/songxychn/knife4j-next/pull/694) |
| Examples | Keeps authored examples and diagnoses mismatches; can generate a deterministic, budgeted fallback | Not a general JSON Schema solver | [#715](https://github.com/songxychn/knife4j-next/pull/715) |
| Parameter debugging | Validates Path, Query, Header, and Cookie logical instances before `style` / `explode` serialization | A parameter uses either `schema` or one `content` media type; Cookie reaches preview / cURL only and is blocked before a real browser request | [#716](https://github.com/songxychn/knife4j-next/pull/716) |
| urlencoded / multipart bodies | Handles structured fields, `encoding`, JSON parts, and file metadata checks | Never reads or validates uploaded file bytes | [#728](https://github.com/songxychn/knife4j-next/pull/728), [#730](https://github.com/songxychn/knife4j-next/pull/730) |
| Request diagnostics | Schema diagnostics block first; the user may explicitly send the same snapshot for a negative test | Does not bypass browser, security, or resource policy | [#696](https://github.com/songxychn/knife4j-next/pull/696), [#716](https://github.com/songxychn/knife4j-next/pull/716), [#728](https://github.com/songxychn/knife4j-next/pull/728) |
| Response diagnostics | Matches JSON responses by exact/range/`default` status and media type | Non-blocking; no response Header, Cookie, SSE, or binary validation | [#713](https://github.com/songxychn/knife4j-next/pull/713) |
| Single-operation export | Exports a portable OpenAPI JSON closure for Path or Webhook operations when the resource graph is complete | No YAML, ZIP, multi-file, or whole-service closure export | [#732](https://github.com/songxychn/knife4j-next/pull/732), [#733](https://github.com/songxychn/knife4j-next/pull/733) |
| Change tracking | Creates a 3.1 semantic fingerprint for a complete resource graph, isolated from 3.0 baselines | Tracks `paths` only, not Webhooks or field-level diffs | [#736](https://github.com/songxychn/knife4j-next/pull/736) |
| Offline documents | HTML, Markdown, DOC, and DOCX share one immutable 3.1 snapshot | Only 3.1.0 / 3.1.1 / 3.1.2 are accepted; see [#739](https://github.com/songxychn/knife4j-next/issues/739) for future patches. Missing resources or unresolved diagnostics require cancel or explicit degraded export | [#734](https://github.com/songxychn/knife4j-next/pull/734) |

The complete springdoc-to-browser acceptance matrix is recorded in [#737](https://github.com/songxychn/knife4j-next/pull/737).

## JSON Schema dialects and vocabularies

### Default dialect

An OAS 3.1 Schema Object is a JSON Schema Draft 2020-12 dialect. When root-level `jsonSchemaDialect` is absent,
Knife4j uses the OAS 3.1 Base Dialect:

```yaml
jsonSchemaDialect: https://spec.openapis.org/oas/3.1/dialect/base
```

SchemaEngine currently evaluates validation semantics only for these known dialects:

- `https://spec.openapis.org/oas/3.1/dialect/base`
- `https://json-schema.org/draft/2020-12/schema`

### Standard and custom vocabularies

The standard JSON Schema 2020-12 Core, Applicator, Validation, Unevaluated, Meta-Data, Format Annotation, and Content
vocabularies follow their dialect semantics. `format` is an annotation by default; a format string does not grant network, file, or certificate access.

Unknown extension keywords and custom-vocabulary payloads remain intact in the source document. When the SchemaEngine session succeeds,
copy and portable-export surfaces retain them as well, but Knife4j defines no validation, example-generation, or field-tree semantics for them.

The current resource-declaration safety pre-scan still recursively inspects arbitrary object payloads. `$id`, `$anchor`, or `$dynamicAnchor` in ordinary
data under an unknown keyword, example, or extension can be mistaken for Schema control data. An encountered `$id` also marks that object as a resource
root and causes sibling `$schema` / `$vocabulary` declarations to be checked, which can fail the session. This is the known limitation tracked by
[#740](https://github.com/songxychn/knife4j-next/issues/740). A real Schema resource root that selects
an unsupported `$schema` or declares a custom `$vocabulary` also receives a resource-level unsupported-dialect diagnostic and blocks actions that
require complete Schema semantics. Neither case falls back to an approximate dialect or executes the custom vocabulary.

## External Schema resources

SchemaEngine never performs network access. The React UI first loads external `$ref`, `$dynamicRef`, and base-URI dependencies through a
controlled resource graph, then passes an immutable registry to parsing, validation, export, and fingerprinting.

### Authorization scope

- All external resources are denied by default. Only an **exact HTTP(S) URI** discovered and displayed for the current document can be authorized.
- A temporary grant lasts only for the current document generation and is lost after reload, group change, or document change.
- A remembered grant is bound to the entry document's normalized retrieval URI and content digest. The URI retains its resolved Origin, app path, and group query; it is never a host wildcard.
- Persistent records contain only a resource-URI hash, a redacted display value, and grant time—never credentials. Each document retains at most 128 grants and 128 KiB of serialized grant data.
- “Reset all local data” in Settings revokes remembered grants. “Clear request cache” does not revoke resource grants.

### Requests and credentials

Resource loading uses browser CORS, `GET`, `credentials: omit`, no redirects, no referrer, and no cache. It never sends Knife4j authorization,
cookies, global parameters, or business request headers. An HTTPS entry document cannot downgrade to HTTP, and a URI cannot contain userinfo.

The server must return `200`, UTF-8, and a JSON or YAML media type. A cross-origin server must also allow the documentation page's Origin.

### Fixed budgets

| Budget | Limit |
| --- | --- |
| Decoded size per resource | 4 MiB |
| Total decoded size | 16 MiB |
| External documents | 64 |
| References | 10,000 |
| Reference depth | 32 |
| Parsed nodes per document | 100,000 |
| Parsed nodes in the graph | 250,000 |
| Schema resources | 1,000 |
| Concurrent requests | 4 |
| Request timeout | 10 seconds |
| Load-wave timeout | 30 seconds |
| Explicit retry | Once per resource |
| YAML aliases | 100 |

Authorization, CORS, media-type, parsing, redirect, timeout, and budget failures become structured, redacted resource diagnostics.
Actions that require a complete closure stay unavailable instead of silently emitting a broken result; already loaded documentation and diagnostics remain visible.

## Browser debugging boundaries

An OpenAPI contract can describe behavior that browser JavaScript cannot safely send.

| Case | Documentation | Browser debugger |
| --- | --- | --- |
| `TRACE` | Displayed as an OAS 3.1 Path Item operation | Fetch cannot send it |
| `CONNECT` / `TRACK` | Displayed only if compatibility input reaches the debugger | Fetch cannot send them; they are not OAS 3.1 Path Item fixed fields |
| `GET` / `HEAD` request body | Schema, examples, and cURL can be shown | Fetch cannot send a body |
| Explicit Cookie parameter | Schema validation, serialized preview, and cURL can be shown | Browser scripts cannot set the `Cookie` header, so the real request is blocked first |
| Webhook | Display, field tree, offline docs, and single-operation export are available with a complete closure | Describes an inbound callback; the docs page does not initiate it |
| `mutualTLS` | Security scheme is recognized and displayed | UI never stores or injects a client certificate; configure the browser, OS, or trusted proxy |
| Cross-origin Schema | An authorized resource can participate in parsing | CORS and the credential-free policy still apply |
| Negative test override | The user may explicitly ignore the current request Schema diagnostics | Skips only the Schema block, never Fetch, auth, or resource policy |

These boundaries are fixed by the [browser request constraint tests](https://github.com/songxychn/knife4j-next/blob/master/front/ui-react/src/pages/api/browserRequestConstraints.test.ts),
document-object [#717](https://github.com/songxychn/knife4j-next/pull/717), request-diagnostic
[#696](https://github.com/songxychn/knife4j-next/pull/696), and resource-security
[#727](https://github.com/songxychn/knife4j-next/pull/727) evidence.

## Migrating from OpenAPI 3.0

Configure the generator to produce a real 3.1 document and review each semantic change below. Do not replace only the `openapi` version string.

### Replace `nullable` with a type union

```yaml
# OpenAPI 3.0
type: string
nullable: true

# OpenAPI 3.1
type: [string, "null"]
```

### Boolean schemas

```yaml
# Accept every instance
schema: true

# Reject every instance
schema: false
```

A boolean Schema is a complete Schema, not a missing one.

### `example`, `examples`, and `const`

```yaml
# OpenAPI 3.0 Schema
type: string
enum: [stable]
example: stable

# OpenAPI 3.1 Schema
type: string
const: stable
examples: [stable]
```

OpenAPI objects such as Media Type and Parameter can still have their own `example` / `examples` fields. Do not merge different object levels mechanically.

### `$ref` siblings

```yaml
# Common OpenAPI 3.0 Schema wrapper
allOf:
  - $ref: "#/components/schemas/User"
maxLength: 64

# OpenAPI 3.1 Schema composition
$ref: "#/components/schemas/User"
maxLength: 64
```

This rule is for a **Schema Object**. An OAS 3.1 **Reference Object** defines only `summary` and `description` as useful sibling fields;
other siblings are not patches to the referenced object.

### Raw binary and encoded strings

```yaml
# Common OpenAPI 3.0 raw binary response
content:
  application/octet-stream:
    schema:
      type: string
      format: binary

# OpenAPI 3.1 raw binary response
content:
  image/png:
    schema:
      contentMediaType: image/png

# OpenAPI 3.1: base64 in a JSON string, not a raw body
schema:
  type: string
  contentEncoding: base64
  contentMediaType: image/png
```

Knife4j also preserves compatibility display for generators that still emit `type: string` plus `format: binary`.
`contentEncoding` describes an encoded string; it is not a browser file object or raw upload body.

### Webhooks and mutual TLS

```yaml
webhooks:
  paymentSettled:
    post:
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PaymentEvent"
      responses:
        "204":
          description: Callback accepted
components:
  securitySchemes:
    ClientCertificate:
      type: mutualTLS
```

A Webhook describes an inbound call from the API provider to the API consumer; it is not a regular `paths` request.
`mutualTLS` declares a security scheme, while the browser, OS, or trusted proxy owns the client certificate.

## Minimal valid fixtures

The repository provides equivalent, directly downloadable fixtures:

- [OpenAPI 3.1 JSON](/examples/openapi-3.1-minimal.json)
- [OpenAPI 3.1 YAML](/examples/openapi-3.1-minimal.yaml)

They cover the OAS 3.1 Base Dialect, `const`, a nullable type union, and Media Type `examples` for loading, field-tree, example, and response-diagnostic checks.

## Language and diagnostic parity

This page and the [Chinese contract](./openapi31) share the same version, capability, security, and migration boundaries.
The existing OAS 3.1 diagnostic keys remain aligned across the Chinese, English, and Japanese React locales. The
[locale parity test](https://github.com/songxychn/knife4j-next/blob/master/front/ui-react/src/locales/locales.test.ts) rejects missing keys,
empty translations, or mismatched interpolation variables. Changing language never changes a diagnostic code or relaxes policy.

## Specifications and implementation evidence

- [OpenAPI Specification 3.1.2](https://spec.openapis.org/oas/v3.1.2.html)
- [OpenAPI 3.1 Schema and Base Dialect](https://spec.openapis.org/oas/)
- [JSON Schema Draft 2020-12 Core](https://json-schema.org/draft/2020-12/json-schema-core)
- [JSON Schema Draft 2020-12 Validation](https://json-schema.org/draft/2020-12/json-schema-validation)
- [springdoc-openapi properties](https://springdoc.org/properties)
- [Knife4j Next OAS 3.1 end-to-end matrix PR #737](https://github.com/songxychn/knife4j-next/pull/737)
