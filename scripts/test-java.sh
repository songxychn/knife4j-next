#!/usr/bin/env bash
set -euo pipefail

# Auto-detect JAVA_HOME if not set (needed for maven-javadoc-plugin)
if [ -z "${JAVA_HOME:-}" ]; then
  JAVA_HOME=$(dirname "$(dirname "$(readlink -f "$(which java)")")") && export JAVA_HOME
fi

cd "$(dirname "$0")/../knife4j"

mvn -B -ntp spotless:check
mvn -B -ntp -Dknife4j-skipTests=false verify
