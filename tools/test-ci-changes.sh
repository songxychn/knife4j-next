#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
classifier="$repo_root/tools/ci-changes.sh"

outputs() {
  printf 'java=%s\nreact=%s\nvue3=%s\ndocs=%s\nknife4x_go=%s\n' "$1" "$2" "$3" "$4" "$5"
}

assert_case() {
  local name=$1
  local expected=$2
  local input=$3
  local actual

  if [ "$input" = "__EMPTY__" ]; then
    actual="$("$classifier" </dev/null)"
  else
    actual="$(printf '%s\n' "$input" | "$classifier")"
  fi

  if [ "$actual" != "$expected" ]; then
    printf 'FAIL: %s\nexpected:\n%s\nactual:\n%s\n' "$name" "$expected" "$actual" >&2
    exit 1
  fi
}

none="$(outputs false false false false false)"
docs_only="$(outputs false false false true false)"
java_only="$(outputs true false false false false)"
react_only="$(outputs false true false false false)"
react_and_java="$(outputs true true false false false)"
react_java_and_knife4x="$(outputs true true false false true)"
vue3_and_java="$(outputs true false true false false)"
knife4x_only="$(outputs false false false false true)"
all="$(outputs true true true true true)"

assert_case "docs" "$docs_only" $'docs/guide/index.md\nstatic/home.png\ntools/test-docs.sh'
assert_case "area readmes and process docs" "$none" $'knife4j/README.md\nknife4j/MIGRATION.md\nknife4j/RELEASE.md\nknife4j/knife4j-demo-openapi2/SECURITY-ASSESSMENT.md\nknife4j/knife4j-gateway-spring-boot-starter/README.md\nknife4x/README.md\nknife4x/rust/README.md\ntools/demo-images/README.md\ntools/spikes/json-schema-2020-12/README.md\ntools/spikes/oas31-resource-loader/DECISION.md'
assert_case "module sources stay java" "$java_only" $'knife4j/knife4j-gateway-spring-boot-starter/pom.xml\nknife4j/knife4j-demo-openapi2/README.txt'
assert_case "spike sources stay full" "$all" "tools/spikes/oas31-resource-loader/package.json"
assert_case "java" "$java_only" $'knife4j/knife4j-core/pom.xml\ntools/test-java.sh\ntools/test-java-compatibility.sh\ntools/java-compatibility-report.sh\ntools/java-compatibility-summary.py\ntools/java-compatibility-baseline.properties\ntools/java-compatibility-contracts.tsv\ntools/verify-java-compatibility-contracts.py\ntools/test-release-tools.sh\ntools/test-fixtures/mock-maven-central-curl.sh\ntools/extract-release-note.sh\ntools/verify-configuration-metadata.sh\ntools/verify-release-context.sh\ntools/verify-maven-central.sh\ntools/verify-release-modules.sh\ntools/release-modules.txt\n.java-version'
for path in front/core/src/index.ts front/schema-engine/src/index.ts front/schema-engine/package.json front/ui-react/src/App.tsx front/package.json front/bun.lock; do
  assert_case "react and knife4x: $path" "$react_java_and_knife4x" "$path"
done
for path in front/core/src/__tests__/debug/requestBuilder.test.ts front/schema-engine/tests/schemaEngine.test.ts front/ui-react/src/schema/schemaExampleGeneration.test.ts front/ui-react/src/pages/api/useDebugFormState.integration.test.tsx; do
  assert_case "front tests: $path" "$react_only" "$path"
done
assert_case "front internal readmes" "$none" $'front/README.md\nfront/core/README.md\nfront/schema-engine/README.md\nfront/ui-react/README.md\nfront/vue3/README.md'
assert_case "mixed test and production" "$react_java_and_knife4x" $'front/ui-react/src/schema/schemaExampleGeneration.test.ts\nfront/schema-engine/src/index.ts'
assert_case "unknown still widens tests" "$all" $'front/ui-react/src/schema/schemaExampleGeneration.test.ts\nunknown-file'
assert_case "react test script" "$react_and_java" "tools/test-front-core.sh"
assert_case "vue3" "$vue3_and_java" $'front/vue3/src/App.vue\ntools/test-vue3.sh'
assert_case "knife4x go" "$knife4x_only" $'knife4x/go/README.md\nknife4x/examples/gin/main.go\ntools/sync-knife4x-ui.sh\ntools/test-knife4x-go.sh'
assert_case "shared configuration" "$all" $'.github/workflows/build.yml\n.bun-version\n.editorconfig\n.gitattributes\n.nvmrc\ntools/ci-changes.sh\ntools/test-ci-changes.sh'
assert_case "unknown path" "$all" "new-area/example.txt"
assert_case "maintenance files" "$none" $'README.md\nCONTRIBUTING.md\nMAINTENANCE.md\nSECURITY.md\nAGENTS.md\n.agent/PROJECT.md\n.github/ISSUE_TEMPLATE/bug_report.yml\n.github/PULL_REQUEST_TEMPLATE.md\n.gitignore\ntools/README.md\ntools/agent-status.sh\ntools/test-agent-status.sh\ntools/test-fixtures/agent-status/gh\ntools/test-all.sh\ntools/verify-github-release.sh'
assert_case "removed claude tooling path widens tests" "$all" "tools/claude/run.sh"
assert_case "empty input" "$all" "__EMPTY__"
assert_case "aggregation parity" "$java_only" $'tools/aggregation-shared-sources.txt\ntools/verify-aggregation-parity.py\ntools/test-aggregation-parity.py'

printf 'ci change classification tests passed\n'
