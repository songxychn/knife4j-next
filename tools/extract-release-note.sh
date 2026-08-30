#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Usage: $0 <version-or-tag> [release-notes-file]" >&2
  exit 2
fi

version="${1#v}"
notes_file="${2:-docs/release-notes/index.md}"

if [ ! -f "$notes_file" ]; then
  echo "Release notes file not found: $notes_file" >&2
  exit 1
fi

awk -v version="$version" '
  function matches_version_heading(line, text, suffix) {
    text = line
    sub(/^###[ \t]+/, "", text)
    if (substr(text, 1, length(version)) != version) {
      return 0
    }
    suffix = substr(text, length(version) + 1, 1)
    return suffix == "" || suffix == " " || suffix == "\t" || suffix == "<"
  }

  BEGIN {
    found = 0
    emitted = 0
  }

  /^###[ \t]+/ && matches_version_heading($0) {
    found = 1
    emitted++
    print "## " version
    next
  }

  found && /^###[ \t]+/ {
    exit
  }

  found && /^##[ \t]+/ {
    exit
  }

  found && /^---$/ {
    exit
  }

  found {
    emitted++
    print
  }

  END {
    if (!found) {
      printf("Release note section not found for version %s\n", version) > "/dev/stderr"
      exit 1
    }
    if (emitted <= 1) {
      printf("Release note section is empty for version %s\n", version) > "/dev/stderr"
      exit 1
    }
  }
' "$notes_file"
