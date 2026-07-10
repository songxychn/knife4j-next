# Contributing to knife4j-next

Thank you for your interest in contributing! This guide covers the development setup, coding standards, and workflow expectations so that every contributor produces consistent, reviewable changes.

## Quick Start

```bash
# 1. Fork & clone
git clone https://github.com/<your-username>/knife4j-next.git
cd knife4j-next

# 2. Install front-end dependencies (Node ≥ 22, see .nvmrc; Bun, see front/package.json)
cd front && bun install --frozen-lockfile && cd ..

# 3. Build Java modules (JDK 17, see .java-version)
cd knife4j && mvn -B -ntp verify && cd ..
```

On a first clone, run `bun install` in `front/`; the root `prepare` script installs Lefthook automatically so staged front-end files are formatted before commit.

## Front-End Layout

There are two independent front-end product lines. Work in the one that matches the issue's `area:*` label:

| Source | Package manager | Build output (webjar) | Downstream starter | OpenAPI |
|---|---|---|---|---|
| `front/ui-react` (React + Vite) | Bun (see `front/package.json` and `front/bun.lock`) | `knife4j/knife4j-openapi3-ui` | `knife4j-openapi3-spring-boot-starter`, `knife4j-openapi3-jakarta-spring-boot-starter`, `knife4j-gateway-spring-boot-starter`, `knife4j-aggregation-jakarta-spring-boot-starter` | **OAS 3 only — main line** |
| `front/vue3` (Vue 3 + Vite) | Bun (`packageManager: "bun@1.3.13"`, see `front/vue3/bun.lock`) | `knife4j/knife4j-openapi2-ui` | `knife4j-openapi2-spring-boot-starter`, `knife4j-aggregation-spring-boot-starter` | **Swagger 2 / OAS 2 only — compatibility maintenance** |

The upstream Vue 2 source under `legacy/vue2/` is frozen as of `5.0.0-SNAPSHOT` and is no longer part of any Maven build. See `legacy/vue2/README.md`.

### OAS 3 main line (`front/ui-react`)

```bash
cd front
bun install --frozen-lockfile
bun run --filter knife4j-ui-react dev
```

Maven pipeline: `knife4j/knife4j-openapi3-ui/pom.xml` drives `bun install --frozen-lockfile` + `bun x vite build` during `generate-resources` and copies the dist into `META-INF/resources/`.

### OAS 2 compatibility line (`front/vue3`)

```bash
cd front/vue3
bun install --frozen-lockfile
bun run dev
```

Maven pipeline: `knife4j/knife4j-openapi2-ui/pom.xml` drives `bun install --frozen-lockfile` + `bun run build --outDir=...` during `generate-resources` and copies the dist into `META-INF/resources/`.

Scope reminder (also in `.agent/PROJECT.md`): the OAS 2 line only takes regression fixes, security patches, and display-layer bugs. New features go to the OAS 3 main line.

## Code Formatting

The repository enforces consistent formatting through a combination of tool-side and CI-side checks. **All PRs must pass these checks before merge.**

### Front-End (TypeScript / React)

| Tool | Config | Scope |
|---|---|---|
| Prettier | `front/core/.prettierrc`, `front/ui-react/.prettierrc` | All `.ts`, `.tsx`, `.css`, `.json` under `src/` |
| ESLint | Per-project `.eslintrc` | Same scope |

```bash
# Check formatting (CI uses this)
cd front
bun run --filter knife4j-core format:check
bun run --filter knife4j-ui-react format:check

# Auto-fix formatting
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
   - Select `knife4j/knife4j-openapi3-ui/src/main/resources/spotless_knife4j_formatter.xml`
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
# Front-end React / core
./tools/test-front-core.sh

# Front-end Vue3 (OAS2 doc.html)
./tools/test-vue3.sh

# Java (spotless + verify + smoke evidence)
./tools/test-java.sh

# Docs site build
./tools/test-docs.sh

# Cross-area
./tools/test-all.sh
```

## Branch & Commit Conventions

- **Branch naming**: `agent/<task-id>-<short-slug>` (for automated PRs) or any descriptive name.
- **Commit messages**: Use [Conventional Commits](https://www.conventionalcommits.org/) style where practical (e.g., `fix:`, `feat:`, `chore:`, `style:`, `ci:`, `docs:`).
- **One concern per PR**: Avoid mixing formatting changes with feature changes in the same PR.

## PR Checklist

Before submitting a PR, verify:

- [ ] `bun run format:check` passes for all front-end workspaces (via `bun run --filter <pkg> format:check`)
- [ ] `mvn spotless:check` passes for Java changes
- [ ] `./tools/test-front-core.sh` passes (if React / core changed)
- [ ] `./tools/test-vue3.sh` passes (if Vue3 / OAS2 UI changed)
- [ ] `./tools/test-java.sh` passes (if Java code changed)
- [ ] No unintended line-ending or whitespace-only diffs

## Questions?

Feel free to open an issue or discussion on GitHub.
