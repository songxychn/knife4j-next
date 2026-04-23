#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../knife4j"

mvn -B -ntp -Dknife4j-skipTests=false verify
