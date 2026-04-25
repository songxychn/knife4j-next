#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../knife4j-front"

npm ci
npm test -w knife4j-core
npm run lint -w knife4j-core
npm run build -w knife4j-core
