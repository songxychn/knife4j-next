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
react_and_java="$(outputs true true false false false)"
react_java_and_knife4x="$(outputs true true false false true)"
vue3_and_java="$(outputs true false true false false)"
knife4x_only="$(outputs false false false false true)"
all="$(outputs true true true true true)"

assert_case "docs" "$docs_only" $'docs/guide/index.md\ntools/test-docs.sh'
assert_case "java" "$java_only" $'knife4j/knife4j-core/pom.xml\ntools/test-java.sh\ntools/verify-configuration-metadata.sh\ntools/verify-release-modules.sh\ntools/release-modules.txt\n.java-version'
for path in front/core/src/index.ts front/ui-react/src/App.tsx front/package.json front/bun.lock; do
  assert_case "react and knife4x: $path" "$react_java_and_knife4x" "$path"
done
assert_case "react test script" "$react_and_java" "tools/test-front-core.sh"
assert_case "vue3" "$vue3_and_java" $'front/vue3/src/App.vue\ntools/test-vue3.sh'
assert_case "knife4x go" "$knife4x_only" $'knife4x/go/README.md\nknife4x/examples/gin/main.go\ntools/sync-knife4x-ui.sh\ntools/test-knife4x-go.sh'
assert_case "shared configuration" "$all" $'.github/workflows/build.yml\n.editorconfig\n.gitattributes\n.nvmrc\ntools/ci-changes.sh\ntools/test-ci-changes.sh'
assert_case "unknown path" "$all" "new-area/example.txt"
assert_case "maintenance files" "$none" $'README.md\nCONTRIBUTING.md\nAGENTS.md\n.agent/PROJECT.md\n.gitignore\ntools/README.md\ntools/agent-status.sh\ntools/claude/run.sh\ntools/test-all.sh\ntools/extract-release-note.sh\ntools/verify-github-release.sh'
assert_case "empty input" "$all" "__EMPTY__"

printf 'ci change classification tests passed\n'
