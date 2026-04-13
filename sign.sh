#!/bin/bash
# Script de signature de l'extension NotebookLM Web Clipper
# Usage: ./sign.sh JWT_ISSUER JWT_SECRET

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: ./sign.sh <JWT_ISSUER> <JWT_SECRET>"
  echo ""
  echo "Obtiens tes clés sur: https://addons.mozilla.org/en-US/developers/addon/api/key/"
  exit 1
fi

cd "$(dirname "$0")"

web-ext sign \
  --source-dir=. \
  --artifacts-dir=./dist \
  --api-key="$1" \
  --api-secret="$2" \
  --channel=unlisted \
  --ignore-files="dist/*" ".git/*" ".agents/*" "*.md" "*.DS_Store" "Scripts.code-workspace"

echo ""
echo "✅ Extension signée ! Le fichier .xpi signé est dans ./dist/"
