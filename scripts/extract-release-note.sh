#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Usage: $0 <version-or-tag> [release-notes-file]" >&2
  exit 2
fi

version="${1#v}"
notes_file="${2:-docs-site/release-notes/index.md}"

if [ ! -f "$notes_file" ]; then
  echo "Release notes file not found: $notes_file" >&2
  exit 1
fi

awk -v version="$version" '
  BEGIN {
    found = 0
    emitted = 0
    heading = "^###[ \t]+" version "([ \t]|$|<)"
  }

  $0 ~ heading {
    found = 1
    emitted++
    print "## " version
    next
  }

  found && /^###[ \t]+/ {
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
