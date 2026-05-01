# ISSUE-197 Triage: Upstream springdoc Annotation Parsing Issues

## Overview

This document triages all upstream issues listed in ISSUE-197 against the current
knife4j-next codebase (Spring Boot 3.x / springdoc-openapi 2.x / OAS3).

Reproduction controllers have been added to `knife4j-demo` for manual verification.
Start the demo with `./mvnw -pl knife4j/knife4j-demo -am spring-boot:run` and open
`http://localhost:8080/doc.html`.

---

## Group 1: Generic / Nested / $ref

| Issue | Summary | Status | Notes |
|-------|---------|--------|-------|
| #683 | Generic display problem (rendering incorrect) | **planned** | Reproduced via `GET /api/issue/generic/wrapped-user`. springdoc resolves generic types at the schema level; rendering differences may be a UI concern. Needs runtime verification. |
| #826 | `@Schema` on generic field not effective | **planned** | Reproduced via `GET /api/issue/generic/wrapped-user`. The `data` field in `GenericWrapper<T>` may lose its `@Schema` description when T is resolved. Needs runtime verification. |
| #677 | Multi-level nested docs not shown | **planned** | Reproduced via `GET /api/issue/generic/deep-nested` (4-level nesting). Needs runtime verification to confirm whether springdoc 2.x still truncates nested schemas. |
| #649 | `@Schema(title)` not shown beyond 3 nesting levels | **planned** | Reproduced via `GET /api/issue/generic/deep-nested`. `NestedLevel3` and `NestedLevel4` carry `@Schema(title=...)`. Needs runtime verification. |
| #757 | `$ref` value not correctly displayed in response | **planned** | Reproduced via `GET /api/issue/generic/explicit-ref` with explicit `@ApiResponse(content=@Content(schema=@Schema(implementation=UserVO.class)))`. Needs runtime verification. |
| #812 | `List<List<Object>>` 2D structure parse error | **planned** | Reproduced via `GET /api/issue/generic/2d-list`. springdoc may not correctly render nested array schemas. Needs runtime verification. |

**Reproduction controller**: `GenericNestedController` (`/api/issue/generic`)

---

## Group 2: Annotation / Parameter Parsing

| Issue | Summary | Status | Notes |
|-------|---------|--------|-------|
| #717 | `ResponseBodyAdvice<T>` unified return: entity field descriptions not shown | **planned** | Partially reproduced via `POST /api/issue/annotation/advice-wrapped`. Full reproduction requires a `ResponseBodyAdvice` bean that wraps the response at runtime — the schema declared in the controller is correct, but the actual JSON structure differs. This is a runtime/schema mismatch, not a pure annotation issue. |
| #746 | `@ApiOperationSupport(ignoreParameters)` not effective | **wontfix (OAS3 scope)** | `@ApiOperationSupport` is a knife4j-openapi2 (Swagger 2) annotation. Not applicable to the OAS3 demo. The fix would be in `knife4j-openapi2-spring-boot-starter/spring/plugin/OperationIgnoreParameterPlugin.java`. |
| #675 | Single lowercase camel field `@Schema` not effective | **planned** | Reproduced via `GET /api/issue/annotation/camel-field`. Fields `iCode` and `eTag` have getters `getiCode()` / `geteTag()`. springdoc's Jackson introspection may fail to match these to the field-level `@Schema`. Root cause: Jackson's `BeanPropertyDefinition` uses the getter name to derive the property name, and `getiCode()` → `iCode` mapping may be inconsistent. |
| #745 | `@ApiResponse` defined Response Content not displayed | **planned** | Reproduced via `GET /api/issue/annotation/api-response-content`. Needs runtime verification. |
| #743 | `@JsonView` per-view field visibility | **planned** | Reproduced via `GET /api/issue/annotation/json-view`. springdoc should respect `@JsonView` on fields and filter schema properties accordingly. Needs runtime verification. |
| #887 | `@RestControllerAdvice` interface docs not shown | **wontfix (OAS3 scope)** | `@RestControllerAdvice` is typically used for exception handling, not for exposing API endpoints. In OAS3 / springdoc, advice classes are not scanned as controllers by default. This is expected behavior. If the user wants to document error responses, use `@ApiResponse` on individual operations. |
| #767 | Object as GET parameter not expanded | **not-reproducible (with @ParameterObject)** | springdoc provides `@ParameterObject` to expand objects into individual query params. Reproduced the difference via `GET /api/issue/generic/get-object-param` (with) vs `GET /api/issue/annotation/get-object-param-no-expand` (without). The fix is to use `@ParameterObject` — this is documented behavior, not a bug in knife4j-next. |

**Reproduction controller**: `AnnotationIssueController` (`/api/issue/annotation`)

---

## Group 3: "Field Not Shown" (Dedup Investigation)

| Issue | Summary | Status | Notes |
|-------|---------|--------|-------|
| #828 | Fields not shown in interface | **planned** | Reproduced via `GET /api/issue/fields/single-entity`. Needs runtime verification. Likely duplicate of #754. |
| #754 | Multiple object properties not displayed | **planned** | Reproduced via `GET /api/issue/fields/multi-property` (9-field DTO). Needs runtime verification. |
| #911 | Entity-received parameter interface doc display anomaly | **planned** | Reproduced via `POST /api/issue/fields/entity-param`. Needs runtime verification. |
| #895 | Interface doc display incorrect | **planned** | Reproduced via `GET /api/issue/fields/entity-list`. Likely duplicate of #889. Needs runtime verification. |
| #889 | knife4j generated doc differs from swagger doc | **planned** | Reproduced via `GET /api/issue/fields/entity-list`. This is a rendering difference between knife4j's doc.html and the standard swagger-ui. May be a frontend rendering issue rather than a schema generation issue. |

**Reproduction controller**: `FieldNotShownController` (`/api/issue/fields`)

---

## Issues Not Reproducible in OAS3 Demo

| Issue | Reason |
|-------|--------|
| #746 | `@ApiOperationSupport` is knife4j-openapi2 only |
| #887 | `@RestControllerAdvice` is not an API endpoint; expected behavior |

---

## Suggested Follow-up PRs

1. **PR-A** (Group 1 — Generic/Nested): After runtime verification, fix springdoc
   schema resolution for generic types via a `ModelConverter` or `OpenApiCustomizer`
   in `knife4j-openapi3-jakarta-spring-boot-starter/spring/extension/`.

2. **PR-B** (Group 2 — #675 camel field): Fix getter-to-field mapping for single
   lowercase camel fields. Likely needs a custom `ModelConverter` that uses field
   annotations when the getter name doesn't match Jackson's default introspection.

3. **PR-C** (Group 3 — Field dedup): After runtime verification, determine if these
   are duplicates of each other or of Group 1 issues. If they reproduce, investigate
   whether the root cause is in springdoc schema generation or knife4j's frontend
   rendering.

---

## Verification Commands

```bash
# Build and start demo
./mvnw -pl knife4j/knife4j-demo -am spring-boot:run

# Check API docs JSON
curl -s http://localhost:8080/v3/api-docs | python3 -m json.tool | grep -A5 "GenericWrapper"

# Check specific schema
curl -s http://localhost:8080/v3/api-docs | python3 -c "
import json, sys
doc = json.load(sys.stdin)
schemas = doc.get('components', {}).get('schemas', {})
for name in sorted(schemas):
    print(name)
"
```
