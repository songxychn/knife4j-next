#!/usr/bin/env bash
set -euo pipefail

java=false
react=false
vue3=false
docs=false
knife4x_go=false
knife4x_rust=false
saw_path=false
full=false

while IFS= read -r path || [ -n "$path" ]; do
  saw_path=true
  case "$path" in
    README.md|CONTRIBUTING.md|MAINTENANCE.md|SECURITY.md|AGENTS.md|.agent/*|.github/ISSUE_TEMPLATE/*|.github/PULL_REQUEST_TEMPLATE.md|.gitignore)
      ;;
    front/README.md|front/core/README.md|front/schema-engine/README.md|front/ui-react/README.md|front/vue3/README.md)
      ;;
    knife4j/README.md|knife4j/MIGRATION.md|knife4j/RELEASE.md|knife4x/README.md|knife4x/go/README.md|knife4x/go/RELEASE.md|knife4x/go/MIGRATING_FROM_GIN_SWAGGER.md|knife4x/examples/gin/README.md)
      ;;
    tools/README.md|tools/test-all.sh|tools/upload-images.sh|tools/extract-release-note.sh|tools/verify-github-release.sh|tools/verify-maven-central.sh|tools/verify-release-context.sh|tools/verify-release-modules.sh|tools/release-modules.txt)
      ;;
    docs/snippets/*)
      java=true
      docs=true
      ;;
    docs/*|static/*|tools/test-docs.sh)
      docs=true
      ;;
    knife4j/*|tools/test-java.sh|tools/smoke-evidence.sh|.java-version)
      java=true
      ;;
    front/core/src/__tests__/*|front/core/src/*.test.ts|front/schema-engine/tests/*|front/ui-react/src/*.test.ts|front/ui-react/src/*.test.tsx)
      react=true
      ;;
    front/core/*|front/schema-engine/*|front/ui-react/*|front/package.json|front/bun.lock|front/scripts/*)
      java=true
      react=true
      knife4x_go=true
      knife4x_rust=true
      ;;
    tools/test-front-core.sh)
      java=true
      react=true
      ;;
    front/vue3/*|tools/test-vue3.sh)
      java=true
      vue3=true
      ;;
    tools/sync-knife4x-ui.sh)
      knife4x_go=true
      knife4x_rust=true
      ;;
    knife4x/rust/*|knife4x/examples/axum/*|tools/test-knife4x-rust.sh)
      knife4x_rust=true
      ;;
    knife4x/go/*|knife4x/examples/gin/*|tools/test-knife4x-go.sh)
      knife4x_go=true
      ;;
    .github/workflows/*|.bun-version|.editorconfig|.gitattributes|tools/ci-changes.sh|tools/ci-changed-paths.sh)
      full=true
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
  knife4x_go=true
  knife4x_rust=true
fi

printf 'java=%s\nreact=%s\nvue3=%s\ndocs=%s\nknife4x_go=%s\nknife4x_rust=%s\n' \
  "$java" "$react" "$vue3" "$docs" "$knife4x_go" "$knife4x_rust"
