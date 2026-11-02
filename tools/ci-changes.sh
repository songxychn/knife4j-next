#!/usr/bin/env bash
set -euo pipefail

java=false
react=false
vue3=false
docs=false
knife4x_go=false
saw_path=false
full=false

while IFS= read -r path || [ -n "$path" ]; do
  saw_path=true
  case "$path" in
    tools/aggregation-shared-sources.txt|tools/verify-aggregation-parity.py|tools/test-aggregation-parity.py)
      java=true
      ;;
    front/README.md|front/core/README.md|front/schema-engine/README.md|front/ui-react/README.md|front/vue3/README.md)
      ;;
    knife4j/README.md|knife4j/MIGRATION.md|knife4j/RELEASE.md|knife4j/knife4j-demo-openapi2/SECURITY-ASSESSMENT.md|knife4j/knife4j-gateway-spring-boot-starter/README.md)
      ;;
    knife4x/README.md|knife4x/rust/README.md|tools/demo-images/README.md|tools/spikes/*/README.md|tools/spikes/*/DECISION.md)
      ;;
    front/core/src/__tests__/*|front/core/src/*.test.ts|front/schema-engine/tests/*|front/ui-react/src/*.test.ts|front/ui-react/src/*.test.tsx)
      react=true
      ;;
    docs/*|static/*|tools/test-docs.sh)
      docs=true
      ;;
    knife4j/*|tools/test-java.sh|tools/test-java-compatibility.sh|tools/java-compatibility-*|tools/verify-java-compatibility-contracts.py|tools/test-release-tools.sh|tools/test-fixtures/mock-maven-central-curl.sh|tools/extract-release-note.sh|tools/verify-configuration-metadata.sh|tools/verify-release-context.sh|tools/verify-maven-central.sh|tools/verify-release-modules.sh|tools/release-modules.txt|.java-version)
      java=true
      ;;
    front/core/*|front/schema-engine/*|front/ui-react/*|front/package.json|front/bun.lock)
      java=true
      react=true
      knife4x_go=true
      ;;
    tools/test-front-core.sh)
      java=true
      react=true
      ;;
    front/vue3/*|tools/test-vue3.sh)
      java=true
      vue3=true
      ;;
    knife4x/go/*|knife4x/examples/gin/*|tools/sync-knife4x-ui.sh|tools/test-knife4x-go.sh)
      knife4x_go=true
      ;;
    .github/workflows/*|.bun-version|.editorconfig|.gitattributes|.nvmrc|tools/ci-changes.sh|tools/test-ci-changes.sh)
      full=true
      ;;
    README.md|CONTRIBUTING.md|MAINTENANCE.md|SECURITY.md|AGENTS.md|.agent/*|.github/ISSUE_TEMPLATE/*|.github/PULL_REQUEST_TEMPLATE.md|.gitignore|tools/README.md|tools/agent-status.sh|tools/test-agent-status.sh|tools/test-fixtures/agent-status/*|tools/test-all.sh|tools/verify-github-release.sh)
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
fi

printf 'java=%s\nreact=%s\nvue3=%s\ndocs=%s\nknife4x_go=%s\n' \
  "$java" "$react" "$vue3" "$docs" "$knife4x_go"
