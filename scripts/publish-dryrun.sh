#!/usr/bin/env bash
set -euo pipefail

echo "==> Running format and type checks..."
npm run check

echo "==> Running test suite..."
npm test

echo "==> Verifying doctor diagnostic health..."
npm run doctor

echo "==> Running npm pack dry run..."
npm pack --dry-run

echo ""
echo "✔ Package verification complete: ready for publishing."
