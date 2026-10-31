# Knife4j Schema Engine

Internal modern-ESM adapter for JSON Schema Draft 2020-12 and the OpenAPI 3.1 base dialect.

The adapter owns Hyperjump's realm-global registry, disables network and filesystem retrieval, and exposes stable Knife4j types for document registration, schema resolution, evaluation, lifecycle cleanup, and resource budgets.

Phase 1 deliberately does not connect the engine to field-tree projection, example generation, or the React debugger. See `tools/spikes/json-schema-2020-12/DECISION.md` and issue #685 for the frozen boundary.

## Runtime boundaries

- One engine owns the Hyperjump registry in a JavaScript realm at a time. Register all related in-memory documents with that engine so their references can resolve; dispose it before another owner starts.
- Built-in HTTP, HTTPS, and file retrieval plugins are removed before public operations. Public URI/media plugins resolve only explicitly registered, typed Schema resources from memory; missing resources remain rejected without network or filesystem I/O. Resource objects are reused across documents, and engine-owned plugins are removed when their final registration is unloaded. URI-looking identifiers do not authorize network access.
- Public keyword decorators preserve upstream `$ref` / `$dynamicRef` compilation and interpretation while attributing meta-validation failures to the actual dependency owner. Compilation is serialized across roots because upstream meta-validation state is shared; compiled validators are still cached. The adapter does not access Browser `_cache` or upstream `validated` flags.
- Schema and instance size/depth limits bound inputs before compilation. Evaluation step, time, and `AbortSignal` checks run cooperatively through a Hyperjump evaluation plugin. Hyperjump compilation itself is synchronous between its internal awaits, so it cannot be preempted mid-step; the structural input limits are the compilation safety boundary.
- Hyperjump types and experimental exports remain private to this workspace. Callers receive Knife4j-owned nodes, errors, annotations, and error codes.

## Validation provenance

`tests/fixtures/official-2020-12-subset.json` pins unchanged cases from JSON Schema Test Suite commit `3c25e5f709192aadf67cf7f2eb19771a57131fec`; its MIT notice is kept beside the fixture. The standard front gate also runs a Springdoc-style OAS 3.1 fixture and a browser-target bundle/CSP compatibility scan.
