#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
modules_file="$repo_root/scripts/release-modules.txt"
parent_pom="$repo_root/knife4j/pom.xml"
bom_pom="$repo_root/knife4j/knife4j-dependencies/pom.xml"

release_modules=()
while IFS= read -r line; do
  line="${line%%#*}"
  line="$(printf '%s' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  if [ -n "$line" ]; then
    release_modules+=("$line")
  fi
done < "$modules_file"

if [ "${#release_modules[@]}" -eq 0 ]; then
  echo "::error::release module list is empty: $modules_file"
  exit 1
fi

status=0

duplicates="$(printf '%s\n' "${release_modules[@]}" | sort | uniq -d)"
if [ -n "$duplicates" ]; then
  echo "::error::duplicate release modules:"
  printf '%s\n' "$duplicates"
  status=1
fi

for module in "${release_modules[@]}"; do
  if [ ! -d "$repo_root/knife4j/$module" ]; then
    echo "::error::release module directory is missing: knife4j/$module"
    status=1
  fi
  if ! grep -Fq "<module>$module</module>" "$parent_pom"; then
    echo "::error::release module is not listed in knife4j/pom.xml: $module"
    status=1
  fi
done

bom_artifacts="$(
  awk '
    /<dependencyManagement>/ { in_dm = 1; next }
    /<\/dependencyManagement>/ { in_dm = 0 }
    in_dm && /<dependency>/ { in_dep = 1; group = ""; artifact = "" }
    in_dep && /<groupId>com\.baizhukui<\/groupId>/ { group = "com.baizhukui" }
    in_dep && /<artifactId>/ {
      line = $0
      sub(/.*<artifactId>/, "", line)
      sub(/<\/artifactId>.*/, "", line)
      artifact = line
    }
    in_dep && /<\/dependency>/ {
      if (group == "com.baizhukui" && artifact ~ /^knife4j-/) print artifact
      in_dep = 0
    }
  ' "$bom_pom" | sort -u
)"

for artifact in $bom_artifacts; do
  if ! printf '%s\n' "${release_modules[@]}" | grep -Fxq "$artifact"; then
    echo "::error::BOM artifact is missing from scripts/release-modules.txt: $artifact"
    status=1
  fi
done

for module in "${release_modules[@]}"; do
  if [ "$module" = "knife4j-dependencies" ]; then
    continue
  fi
  if ! printf '%s\n' "$bom_artifacts" | grep -Fxq "$module"; then
    echo "::error::release module is missing from knife4j-dependencies dependencyManagement: $module"
    status=1
  fi
done

if [ "$status" -ne 0 ]; then
  exit "$status"
fi

echo "Release module list OK (${#release_modules[@]} modules)."
