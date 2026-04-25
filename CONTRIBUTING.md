# Contributing to knife4j-next

Thank you for your interest in contributing! This guide covers the development setup, coding standards, and workflow expectations so that every contributor produces consistent, reviewable changes.

## Quick Start

```bash
# 1. Fork & clone
git clone https://github.com/<your-username>/knife4j-next.git
cd knife4j-next

# 2. Install front-end dependencies (Node ≥ 22, see .nvmrc)
cd knife4j-front && npm ci && cd ..

# 3. Build Java modules (JDK 17, see .java-version)
cd knife4j && mvn -B -ntp verify && cd ..
```

## Code Formatting

The repository enforces consistent formatting through a combination of tool-side and CI-side checks. **All PRs must pass these checks before merge.**

### Front-End (TypeScript / React)

| Tool | Config | Scope |
|---|---|---|
| Prettier | `knife4j-front/knife4j-core/.prettierrc`, `knife4j-front/knife4j-ui-react/.prettierrc` | All `.ts`, `.tsx`, `.css`, `.json` under `src/` |
| ESLint | Per-project `.eslintrc` | Same scope |

```bash
# Check formatting (CI uses this)
cd knife4j-front
npm run format:check -w knife4j-core
npm run format:check -w knife4j-ui-react

# Auto-fix formatting
npm run format -w knife4j-core
npm run format -w knife4j-ui-react
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
# Front-end (format:check + test + lint + build)
./scripts/test-front-core.sh

# Java (spotless:check + verify)
./scripts/test-java.sh

# Docs site build
./scripts/test-docs.sh
```

## Branch & Commit Conventions

- **Branch naming**: `agent/<task-id>-<short-slug>` (for automated PRs) or any descriptive name.
- **Commit messages**: Use [Conventional Commits](https://www.conventionalcommits.org/) style where practical (e.g., `fix:`, `feat:`, `chore:`, `style:`, `ci:`, `docs:`).
- **One concern per PR**: Avoid mixing formatting changes with feature changes in the same PR.

## PR Checklist

Before submitting a PR, verify:

- [ ] `npm run format:check` passes for all front-end workspaces
- [ ] `mvn spotless:check` passes for Java changes
- [ ] `./scripts/test-front-core.sh` passes (if front-end code changed)
- [ ] `./scripts/test-java.sh` passes (if Java code changed)
- [ ] No unintended line-ending or whitespace-only diffs

## Questions?

Feel free to open an issue or discussion on GitHub.

