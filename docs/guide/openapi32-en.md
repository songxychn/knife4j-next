---
title: OpenAPI 3.2 Support and Migration
description: Unpublished Knife4j Next support matrix, regression table, host loading, browser limits, and migration notes for OpenAPI 3.2.x.
lang: en-US
---

# OpenAPI 3.2 Support and Migration

[中文契约](./openapi32) · [Download minimal JSON](/examples/openapi-3.2-minimal.json) · [Download minimal YAML](/examples/openapi-3.2-minimal.yaml)

::: warning Unpublished
This page describes OpenAPI 3.2.x consumption on the `integration/oas32` branch. It is **not** a published Java `5.6.1` or Knife4x Go `v0.7.1` promise. Do not document 3.2 as a released capability until a maintainer merges the integration branch to `master` and ships a new release.
:::

Published OpenAPI 3.0.x / 3.1.x contracts are unchanged; see [OpenAPI 3.1 Support and Migration](./openapi31-en). The Vue 3 UI remains OAS2-only. This page does not change starter defaults and does not upgrade springdoc or Java production dependencies.

## Supported versions

OpenAPI defines its feature set at the `major.minor` level. `3.2.x` shares one **OpenAPI 3.2 feature set**. 3.2 documents use a separate parse, resource graph, Schema session, export, and change-tracking path and are never rewritten as 3.1.

| Document version | UI | Status | Contract |
| --- | --- | --- | --- |
| Swagger / OpenAPI 2.0 | Vue 3 | Maintenance | No OAS 3 expansion |
| OpenAPI 3.0.x | React | Published | Java `5.6.1` / Go `v0.7.1` |
| OpenAPI 3.1.x | React | Published | Java `5.6.1` / Go `v0.7.1` |
| OpenAPI 3.2.x | React | **Unpublished** (integration branch) | Full consumption of valid 3.2 documents; never treated as 3.1 |

## Specification fixtures versus generator output

Java production dependencies remain springdoc `1.8.0` / `2.8.9` / Boot4 `3.0.3`. They currently emit OpenAPI 3.0.x or 3.1.x. Changing the `openapi` string in `/v3/api-docs` to `3.2.0` is **not** real 3.2 generation evidence.

| Source | Actual output | Use in this roadmap |
| --- | --- | --- |
| Boot 2.x + springdoc `1.8.0` | OpenAPI 3.0.x | 3.0 regression |
| Boot 3.x / 4.x + springdoc `2.8.9` / `3.0.3` | OpenAPI 3.1.x | 3.1 regression |
| Handwritten specification fixtures | OpenAPI 3.2.0 | 3.2 display, debug, export, change tracking, and host loading |

3.2 fixtures are labeled as specification documents. Real Java 3.2 generation would require a separate maintainer decision to upgrade production dependencies.

## Product capability matrix

Unless a row says otherwise, “supported” means the complete OpenAPI 3.2.x feature set on the integration branch.

| Capability | OAS 3.2 behavior | Boundary | Merged evidence |
| --- | --- | --- | --- |
| Version and standard methods | One minor feature set; QUERY is a fixed Path Item field | No patch allowlist | [#768](https://github.com/songxychn/knife4j-next/issues/768) / [#784](https://github.com/songxychn/knife4j-next/pull/784) |
| Document structure | 3.2 objects, `additionalOperations`, structural diagnostics | Illegal input is rejected, not rewritten | [#769](https://github.com/songxychn/knife4j-next/issues/769) / [#785](https://github.com/songxychn/knife4j-next/pull/785) |
| Resource graph | `$self`, cross-document references, controlled loading | External resources denied by default; fingerprints/export do not initiate network I/O | [#770](https://github.com/songxychn/knife4j-next/issues/770) / [#787](https://github.com/songxychn/knife4j-next/pull/787) |
| SchemaEngine | Official 3.2 dialect and JSON Schema 2020-12 | Unknown dialects are not treated as 3.1 | [#771](https://github.com/songxychn/knife4j-next/issues/771) / [#788](https://github.com/songxychn/knife4j-next/pull/788) |
| QUERY / custom methods | QUERY and case-preserving `COPY` / `Copy` | TRACE/CONNECT/TRACK remain Fetch-forbidden | [#772](https://github.com/songxychn/knife4j-next/issues/772) / [#789](https://github.com/songxychn/knife4j-next/pull/789) |
| Tags / Server / Response | Nested tags, server `name`, response `summary` | | [#773](https://github.com/songxychn/knife4j-next/issues/773) / [#791](https://github.com/songxychn/knife4j-next/pull/791) |
| Examples | `dataValue` / `serializedValue` plus existing `value` | Not a general JSON Schema solver | [#774](https://github.com/songxychn/knife4j-next/issues/774) / [#790](https://github.com/songxychn/knife4j-next/pull/790) |
| `discriminator.defaultMapping` | Default mapping hint when the discriminator property is absent | Does not change JSON Schema validation | [#775](https://github.com/songxychn/knife4j-next/issues/775) / [#795](https://github.com/songxychn/knife4j-next/pull/795) |
| XML `nodeType` | | | [#776](https://github.com/songxychn/knife4j-next/issues/776) / [#797](https://github.com/songxychn/knife4j-next/pull/797) |
| querystring / Cookie style | querystring uses `content` and cannot mix with effective query parameters | Cookie is preview/cURL only and blocked before a real send | [#777](https://github.com/songxychn/knife4j-next/issues/777) / [#793](https://github.com/songxychn/knife4j-next/pull/793) |
| Multipart location encoding | | Uploaded file bytes are never read | [#778](https://github.com/songxychn/knife4j-next/issues/778) / [#796](https://github.com/songxychn/knife4j-next/pull/796) |
| Sequential media | SSE, JSONL/NDJSON, JSON-seq, multipart | Unknown media keep raw bytes plus a codec diagnostic | [#779](https://github.com/songxychn/knife4j-next/issues/779) / [#799](https://github.com/songxychn/knife4j-next/pull/799) |
| Security | URI references and Device Authorization | No client-certificate injection and no active webhook calls | [#780](https://github.com/songxychn/knife4j-next/issues/780) / [#801](https://github.com/songxychn/knife4j-next/pull/801) |
| Single-operation export | 3.2 closure when the resource graph is complete | The 3.1 exporter rejects 3.2 documents | [#781](https://github.com/songxychn/knife4j-next/issues/781) / [#802](https://github.com/songxychn/knife4j-next/pull/802) |
| Change tracking | Isolated protocol `oas3.2-v1` | Isolated from 3.0 / 3.1 baselines; `paths` only | [#766](https://github.com/songxychn/knife4j-next/issues/766) / [#803](https://github.com/songxychn/knife4j-next/pull/803) |
| Offline documents | Separate 3.2 HTML / Markdown / Word snapshot | The 3.1 snapshot rejects 3.2 | [#782](https://github.com/songxychn/knife4j-next/issues/782) / [#804](https://github.com/songxychn/knife4j-next/pull/804) |
| Host loading | WebJar `doc.html`, aggregation disk, Knife4x SpecURL | 3.2 uses specification fixtures, never relabeled springdoc output | [#783](https://github.com/songxychn/knife4j-next/issues/783) |

Schema dialects:

```yaml
jsonSchemaDialect: https://spec.openapis.org/oas/3.2/dialect/2025-09-17
```

An explicit official 3.2 dialect URI is executed as written. When root-level `jsonSchemaDialect` is **omitted**, SchemaEngine follows the OpenAPI prose default `https://spec.openapis.org/oas/3.1/dialect/base` and does not rewrite it as the 3.2 dialect. `https://spec.openapis.org/oas/3.2/dialect/base` and other unregistered URIs raise `UNSUPPORTED_DIALECT`; they are not silently treated as 3.1. SchemaEngine also executes `https://json-schema.org/draft/2020-12/schema`.

## 3.0 / 3.1 / 3.2 regression matrix

| Topic | 3.0.x | 3.1.x | 3.2.x (unpublished) |
| --- | --- | --- | --- |
| Entry version | Existing 3.0 path | Existing 3.1 path | Separate 3.2 path, never downgraded |
| Standard methods | No QUERY field | Same as 3.0 | Path Item adds `query` |
| Custom methods | No `additionalOperations` | No | Case-preserving; reserved methods cannot be stored there |
| A `query` field on a 3.1 document | — | Ignored | QUERY operation |
| Schema dialect | OAS 3.0 Schema | `oas/3.1/dialect/base` | Explicit `oas/3.2/dialect/2025-09-17`; omitted falls back to `oas/3.1/dialect/base` |
| Examples | `value` / `externalValue` | Same, plus JSON Schema `examples` | Adds `dataValue` / `serializedValue` |
| Change tracking | `oas3.0-v1` | `oas3.1-v1` | `oas3.2-v1` |
| Offline export | 3.0 snapshot | 3.1 snapshot rejects 3.2 | 3.2 snapshot rejects 3.1 |
| Generators | springdoc 1.8.0 → 3.0 | springdoc 2.8.9 / 3.0.3 → 3.1 | No current production generator; specification fixtures only |
| Failure paths | OAS2 stays on Vue 3 | Unknown dialect / resource failures stay unavailable | Structural errors such as mixing querystring with query are diagnosed |

The executable matrix is `front/ui-react/src/schema/oas32HostAcceptanceMatrix.test.ts`, in addition to the existing 3.0/3.1 tests.

## Browser limits

An OpenAPI contract can describe more than browser JavaScript can send.

| Scenario | Documentation | Browser debug |
| --- | --- | --- |
| QUERY / COPY | Shown with exact spelling | Fetch can send them (CORS still applies); offline export may still note `BROWSER_EXECUTION_UNSUPPORTED` |
| TRACE / CONNECT / TRACK | May be shown | Fetch forbids the method |
| Explicit Cookie parameters | Preview and cURL | Blocked before a real send |
| GET / HEAD with a body | Schema / example / cURL | Fetch forbids the body |
| Webhooks | Shown and exported | Never sent from the documentation page |
| `mutualTLS` | Shown | No client-certificate injection |
| Unknown sequential media | Raw bytes plus a codec diagnostic | Not decoded as a known stream |
| External `$ref` / `$self` / OAuth metadata URL | Location shown | Denied by default; only discovered exact URIs can be authorized, with no automatic network grant |

## Host entry points

The integration-branch React WebJar, starter, aggregation disk routes, and Knife4x can **host** a valid 3.2 JSON document:

- `GET /doc.html` still serves `webjars/knife4j-ui-react/`.
- A starter’s real `/v3/api-docs` remains current springdoc 3.0/3.1 output. Smoke tests serve the specification fixture on a separate `/synthetic/oas32.json` path and do not rewrite the generator version string.
- Aggregation disk can expose both an OpenAPI 3.1 document and a labeled 3.2 specification fixture; `swagger-instance` returns the file as stored. Disk routes still use `swagger-version: "3.0"` (the OpenAPI 3 family label versus Swagger 2). Do not invent a published `"3.2"` configuration value.
- Knife4x `NewHandler` only requires an HTTP(S) SpecURL and does not parse the OpenAPI version. The embedded UI loads 3.2 JSON and rejects Swagger 2. YAML entry points remain unsupported.

Headless UI acceptance:

```bash
node front/ui-react/scripts/run-oas32-host-acceptance.mjs
```

The script binds `127.0.0.1` only, uses in-repo fixtures and the embedded React assets, and does not call real third-party credential or PII services.

## Migrating from OpenAPI 3.1

Produce a real 3.2 document. Do not only change the version string.

### QUERY and custom methods

```yaml
paths:
  /health:
    get:
      summary: Read
    query:
      summary: Query
    additionalOperations:
      COPY:
        summary: Copy
```

A field named `query` on a 3.1 document is not QUERY. Standard methods such as `GET`, `QUERY`, and `POST` cannot be placed in `additionalOperations`.

### querystring cannot mix with query

```yaml
# Valid: QUERY uses querystring only
parameters:
  - name: filter
    in: querystring
    content:
      application/json:
        schema:
          type: object

# Invalid: query and querystring in the same effective parameter set
```

### Example fields

```yaml
# OpenAPI 3.1 Media Type
examples:
  healthy:
    value:
      status: ok

# OpenAPI 3.2
examples:
  healthy:
    dataValue:
      status: ok
```

`value` is exclusive with `dataValue` / `serializedValue` / `externalValue`.

### Dialects

When `jsonSchemaDialect` is omitted, a 3.2 document still uses the prose default `https://spec.openapis.org/oas/3.1/dialect/base`. To execute the 3.2 dialect, declare `https://spec.openapis.org/oas/3.2/dialect/2025-09-17` explicitly. Unknown dialects, including `oas/3.2/dialect/base`, are rejected rather than treated as 3.1.

## Minimal valid fixtures

- [OpenAPI 3.2 JSON](/examples/openapi-3.2-minimal.json)
- [OpenAPI 3.2 YAML](/examples/openapi-3.2-minimal.yaml)

They cover the 3.2 dialect, QUERY, COPY, `const`, a nullable union, SSE `itemSchema`, and a `dataValue` example. The fuller host fixture lives in `front/ui-react/src/test-fixtures/oas32-normative/`.

## Specifications

- [OpenAPI Specification 3.2.0](https://spec.openapis.org/oas/v3.2.0.html)
- [OAS 3.2 release notes](https://github.com/OAI/OpenAPI-Specification/releases/tag/3.2.0)
- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)
- [Roadmap #767](https://github.com/songxychn/knife4j-next/issues/767)
