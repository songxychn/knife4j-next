# Contributing to knife4j-next

Thank you for your interest in contributing! This guide covers the development setup, coding standards, and workflow expectations so that every contributor produces consistent, reviewable changes.

## Quick Start

```bash
# 1. Fork & clone
git clone https://github.com/<your-username>/knife4j-next.git
cd knife4j-next

# 2. Install front-end dependencies (all front-end tooling: stable Node 26.x; see .nvmrc and .bun-version)
node front/scripts/check-node.cjs
cd front && bun install --frozen-lockfile && cd ..

# 3. Enable the versioned pre-commit checks (optional)
git config core.hooksPath .githooks

# 4. Build and test Java modules (JDK 17, see .java-version)
./tools/test-java.sh
```

`./tools/test-java.sh` runs Spotless, Maven `verify` with tests enabled, and the smoke/compatibility gates. A bare `mvn -B -ntp verify` skips tests because the root POM defaults `knife4j-skipTests` to `true`; do not use it as pre-submit validation.

The optional pre-commit hook runs `format:check` and `lint` for the whole `knife4j-core` / `knife4j-ui-react` package when any staged file is under `front/core/` or `front/ui-react/`. It checks the working tree rather than only the staged content, and does not cover `front/schema-engine/`. CI remains the required merge gate.

OAS3, Vue3, the docs site, and Knife4x UI synchronization share this Node baseline. Source development/builds/tests support only stable Node 26.x; other major versions and prereleases are excluded. Using the published Maven artifacts or Go module does not require Node; browser and Java/Go runtime requirements are unchanged.

## Front-End Layout

There are two independent front-end product lines. Work in the one that matches the issue's `area:*` label:

| Source | Package manager | Build output (webjar) | Downstream starter | OpenAPI |
|---|---|---|---|---|
| `front/ui-react` (React + Vite) | Bun (baseline in `.bun-version`; lockfile in `front/bun.lock`) | `knife4j/knife4j-openapi3-ui` | Direct: `knife4j-openapi3-spring-boot-starter`, `knife4j-openapi3-jakarta-spring-boot-starter`, `knife4j-openapi3-webflux-spring-boot-starter`, `knife4j-openapi3-webflux-jakarta-spring-boot-starter`, `knife4j-gateway-spring-boot-starter`, `knife4j-gateway-webmvc-spring-boot-starter`, `knife4j-gateway-boot4-spring-boot-starter`, `knife4j-aggregation-jakarta-spring-boot-starter`; transitive: `knife4j-openapi3-boot4-spring-boot-starter`, `knife4j-aggregation-boot4-spring-boot-starter` | **OAS 3 only — main line** |
| `front/vue3` (Vue 3 + Vite) | Bun (baseline in `.bun-version`; lockfile in `front/vue3/bun.lock`) | `knife4j/knife4j-openapi2-ui` | `knife4j-openapi2-spring-boot-starter`, `knife4j-aggregation-spring-boot-starter` | **Swagger 2 / OAS 2 only — compatibility maintenance** |

The upstream Vue 2 source under `legacy/vue2/` is frozen as of `5.0.0-SNAPSHOT` and is no longer part of any Maven build. See `legacy/vue2/README.md`.

### OAS 3 main line (`front/ui-react`)

```bash
cd front
bun install --frozen-lockfile
bun run --filter knife4j-ui-react dev
```

The OAS 3 workspace in `front/` contains `core` (`knife4j-core`), `schema-engine` (`knife4j-schema-engine`) and `ui-react` (`knife4j-ui-react`).

Maven pipeline: `knife4j/knife4j-openapi3-ui/pom.xml` drives `bun install --frozen-lockfile`, `bun run --filter knife4j-core build`, `bun run --filter knife4j-schema-engine build` and `bun x vite build` during `generate-resources`, then copies the dist into `META-INF/resources/`.

### OAS 2 compatibility line (`front/vue3`)

```bash
cd front/vue3
bun install --frozen-lockfile
bun run dev
```

Maven pipeline: `knife4j/knife4j-openapi2-ui/pom.xml` drives `bun install --frozen-lockfile` + `bun run build:Knife4jSpringUi --outDir=...` (the Springfox `swagger-resources` mode required by the OAS 2 webjar) during `generate-resources` and copies the dist into `META-INF/resources/`.

Scope reminder (also in `.agent/PROJECT.md`): the OAS 2 line only takes regression fixes, security patches, and display-layer bugs. New features go to the OAS 3 main line.

## Code Formatting

The repository enforces consistent formatting through a combination of tool-side and CI-side checks. **All PRs must pass these checks before merge.**

### Front-End (TypeScript / React)

| Tool | Config | Scope |
|---|---|---|
| Prettier | Per-package `.prettierrc` in `front/core/`, `front/schema-engine/`, `front/ui-react/` | Defined by each package's `format` / `format:check` script |
| ESLint | Per-package flat config `eslint.config.cjs` | Defined by each package's `lint` script |

```bash
# Check formatting (CI uses this)
cd front
bun run --filter knife4j-schema-engine format:check
bun run --filter knife4j-core format:check
bun run --filter knife4j-ui-react format:check

# Auto-fix formatting
bun run --filter knife4j-schema-engine format
bun run --filter knife4j-core format
bun run --filter knife4j-ui-react format
```

### Java (Maven + Spotless)

The Java modules use [Spotless](https://github.com/diffplug/spotless) with an Eclipse formatter profile.

```bash
# Check formatting (CI uses this — fails if any file is off)
cd knife4j && mvn -B -ntp spotless:check

# Auto-fix formatting
cd knife4j && mvn -B -ntp spotless:apply
```

### IDEA Users

IntelliJ IDEA does not automatically follow the project's formatter rules. To avoid "reformat on save" noise:

1. **Disable auto-format on save**: `Settings → Tools → Actions on Save → uncheck "Reformat code" and "Optimize imports"`.
2. **Import the Eclipse code style** (optional, for manual reformat):
   - `Settings → Editor → Code Style → Java → ⚙ → Import Scheme → Eclipse XML Profile`
   - Select `knife4j/src/main/resources/spotless_knife4j_formatter.xml`
3. **Install EditorConfig plugin** (bundled in IDEA 2024+): ensures indentation and line endings match `.editorconfig`.

### VS Code Users

Install the recommended extensions (a `.vscode/extensions.json` may be added later):

- `EditorConfig.EditorConfig`
- `esbenp.prettier-vscode`
- `dbaeumer.vscode-eslint`

VS Code will automatically pick up `.prettierrc` and `.editorconfig` in each sub-project.

## Line Endings & Whitespace

- The repository uses **LF** line endings for all text files (enforced by `.gitattributes`).
- `.bat` / `.cmd` / `.ps1` files use CRLF.
- Trailing whitespace is trimmed on save (except in Markdown, where two trailing spaces mean a line break).
- A final newline is inserted at the end of every file.

These rules are enforced by `.editorconfig` and `.gitattributes` at the repository root.

## Local Validation Scripts

Run the same checks that CI runs:

```bash
# Front-end schema-engine / core / React
./tools/test-front-core.sh

# Front-end Vue3 (OAS2 doc.html)
./tools/test-vue3.sh

# Java (spotless + verify + smoke evidence + compatibility contracts)
./tools/test-java.sh

# Docs site build
./tools/test-docs.sh

# Knife4x Go and the Gin example
./tools/test-knife4x-go.sh

# All areas (Java, front-core, Vue3, docs, Knife4x Go, embedded UI sync check)
./tools/test-all.sh
```

For changes spanning a few areas, run the union of the affected scripts; `test-all.sh` is for all-area changes or full acceptance. `git diff --name-only <base>...<head> | ./tools/ci-changes.sh` shows which CI jobs a change triggers (three dots match the merge-base diff that PR CI uses).

## Branch & Commit Conventions

- **Branch naming**: `agent/<task-id>-<short-slug>` for agent PRs with an issue, `agent/adhoc-<short-slug>` for agent PRs without one, or any descriptive name.
- **Commit messages**: Repository history uses Chinese commit messages with short prefixes such as `修复：`, `文档：`, `维护：`, `构建：`; keep code identifiers, paths and commands as-is. Agent-created commits, issues and PRs must follow the language rule in `AGENTS.md`.
- **One concern per PR**: Avoid mixing formatting changes with feature changes in the same PR.

## PR Checklist

Before submitting a PR, verify:

- [ ] `bun run format:check` passes for all front-end workspaces (via `bun run --filter <pkg> format:check`)
- [ ] `mvn spotless:check` passes for Java changes
- [ ] `./tools/test-front-core.sh` passes (if schema-engine / core / React changed)
- [ ] `./tools/test-vue3.sh` passes (if Vue3 / OAS2 UI changed)
- [ ] `./tools/test-java.sh` passes (if Java code changed)
- [ ] `./tools/test-docs.sh` passes (if the docs site changed)
- [ ] `./tools/test-knife4x-go.sh` passes (if Knife4x Go changed)
- [ ] No unintended line-ending or whitespace-only diffs

## Questions?

Feel free to open an issue or discussion on GitHub.
