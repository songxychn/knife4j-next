#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../knife4j-doc"

npm ci
npm run build-netlify
