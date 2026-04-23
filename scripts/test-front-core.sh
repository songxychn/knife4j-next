#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../knife4j-front/knife4j-core"

npm ci
npm test
npm run lint
npm run build
