# JSON Schema 2020-12 engine spike

Issue: [#683](https://github.com/songxychn/knife4j-next/issues/683)

This isolated package tests whether Knife4j can delegate JSON Schema Draft
2020-12 resource resolution and evaluation to Hyperjump without changing the
current product runtime. It is not a shipped workspace and is not imported by
`front/core` or `front/ui-react`.

## Run

From the repository root:

```bash
./tools/test-json-schema-engine-spike.sh
```

The command installs exact dependency versions from the official npm registry,
runs TypeScript checking and the semantic tests, produces a minified browser
bundle, scans it for dynamic code execution and Node built-ins, and runs
generated-schema timing probes. Generated files are written under `dist/` and
remain untracked.

To check the strict-CSP page manually:

```bash
cd tools/spikes/json-schema-2020-12/dist
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/`. The page uses `script-src 'self'` without
`'unsafe-eval'` and `connect-src 'none'`. A successful run sets
`document.body.dataset.status` to `passed`.

## Evidence covered

- `$id`, embedded Schema Resources, `$anchor`, `$dynamicAnchor` and
  `$dynamicRef`
- recursive evaluation and `unevaluatedProperties`
- `prefixItems` with `unevaluatedItems`
- boolean schemas
- evaluation-dependent annotations
- registry-only compound-schema bundling
- OpenAPI 3.1 base dialect with a springdoc-style component schema
- default denial of HTTP, HTTPS and file retrieval before `fetch`
- browser ESM bundling and strict-CSP execution

The dynamic-reference and unevaluated fixtures are reduced cases based on the
[JSON Schema Test Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite/tree/main/tests/draft2020-12).

See [DECISION.md](./DECISION.md) for the architectural conclusion and product
boundaries.
