#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
classifier="$repo_root/tools/ci-changes.sh"

outputs() {
  printf 'java=%s\nreact=%s\nvue3=%s\ndocs=%s\n' "$1" "$2" "$3" "$4"
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

none="$(outputs false false false false)"
docs_only="$(outputs false false false true)"
java_only="$(outputs true false false false)"
react_and_java="$(outputs true true false false)"
vue3_and_java="$(outputs true false true false)"
all="$(outputs true true true true)"

assert_case "docs" "$docs_only" $'docs/guide/index.md\ntools/test-docs.sh'
assert_case "java" "$java_only" $'knife4j/knife4j-core/pom.xml\ntools/test-java.sh\ntools/verify-release-modules.sh\ntools/release-modules.txt\n.java-version'
assert_case "react" "$react_and_java" $'front/core/src/index.ts\nfront/ui-react/src/App.tsx\nfront/package.json\nfront/bun.lock\ntools/test-front-core.sh'
assert_case "vue3" "$vue3_and_java" $'front/vue3/src/App.vue\ntools/test-vue3.sh'
assert_case "shared configuration" "$all" $'.github/workflows/build.yml\n.editorconfig\n.gitattributes\n.nvmrc\ntools/ci-changes.sh\ntools/test-ci-changes.sh'
assert_case "unknown path" "$all" "new-area/example.txt"
assert_case "maintenance files" "$none" $'README.md\nCONTRIBUTING.md\nAGENTS.md\n.agent/PROJECT.md\n.gitignore\ntools/README.md\ntools/agent-status.sh\ntools/claude/run.sh\ntools/test-all.sh\ntools/extract-release-note.sh\ntools/verify-github-release.sh'
assert_case "empty input" "$all" "__EMPTY__"

printf 'ci change classification tests passed\n'
