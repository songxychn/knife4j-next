#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
script="$repo_root/tools/verify-current-version-docs.py"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

write_fixture() {
  local guide_version=$1 marker_version=$2 latest_version=$3
  rm -rf "$fixture/repo"
  mkdir -p "$fixture/repo/knife4j" "$fixture/repo/docs/guide" "$fixture/repo/docs/release-notes" "$fixture/repo/legacy"
  cat > "$fixture/repo/knife4j/pom.xml" <<'EOF'
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j</artifactId>
    <version>1.2.3</version>
</project>
EOF
  cat > "$fixture/repo/docs/guide/start.md" <<EOF
本文示例使用 Java \`$marker_version\`。

\`\`\`xml
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi3-boot4-spring-boot-starter</artifactId>
    <version>$guide_version</version>
</dependency>
\`\`\`

历史版本 \`1.2.2\` 的记录不受检查。
EOF
  cat > "$fixture/repo/docs/release-notes/index.md" <<EOF
### $latest_version <Badge type="tip" text="最新版本" />

### 1.2.2
EOF
  printf '<groupId>com.baizhukui</groupId><artifactId>x</artifactId><version>0.0.1</version>\n' > "$fixture/repo/legacy/old.md"
  git -C "$fixture/repo" init -q
  git -C "$fixture/repo" add .
}

expect() {
  local name=$1 expected_status=$2
  local status=0
  python3 "$script" "$fixture/repo" >/dev/null 2>&1 || status=$?
  if [ "$status" -ne "$expected_status" ]; then
    printf 'FAIL: %s (exit %s, expected %s)\n' "$name" "$status" "$expected_status" >&2
    exit 1
  fi
}

write_fixture 1.2.3 1.2.3 1.2.3
expect "current docs pass" 0

write_fixture 1.2.2 1.2.3 1.2.3
expect "stale dependency snippet fails" 1

write_fixture 1.2.3 1.2.2 1.2.3
expect "stale example marker fails" 1

write_fixture 1.2.3 1.2.3 1.2.2
expect "latest badge on old release fails" 1

printf 'current version docs tests passed\n'
