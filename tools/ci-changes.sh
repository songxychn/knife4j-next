#!/usr/bin/env bash
set -euo pipefail

java=false
react=false
vue3=false
docs=false
saw_path=false
full=false

while IFS= read -r path || [ -n "$path" ]; do
  saw_path=true
  case "$path" in
    docs/*|tools/test-docs.sh)
      docs=true
      ;;
    knife4j/*|tools/test-java.sh|tools/verify-release-modules.sh|tools/release-modules.txt|.java-version)
      java=true
      ;;
    front/core/*|front/ui-react/*|front/package.json|front/bun.lock|tools/test-front-core.sh)
      java=true
      react=true
      ;;
    front/vue3/*|tools/test-vue3.sh)
      java=true
      vue3=true
      ;;
    .github/workflows/*|.editorconfig|.gitattributes|.nvmrc|tools/ci-changes.sh|tools/test-ci-changes.sh)
      full=true
      ;;
    README.md|CONTRIBUTING.md|AGENTS.md|.agent/*|.gitignore|tools/README.md|tools/agent-status.sh|tools/claude/*|tools/test-all.sh|tools/extract-release-note.sh|tools/verify-github-release.sh)
      ;;
    *)
      full=true
      ;;
  esac
done

if [ "$saw_path" = false ] || [ "$full" = true ]; then
  java=true
  react=true
  vue3=true
  docs=true
fi

printf 'java=%s\nreact=%s\nvue3=%s\ndocs=%s\n' "$java" "$react" "$vue3" "$docs"
