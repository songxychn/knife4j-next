#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../docs-site"

npm ci
npm run build
