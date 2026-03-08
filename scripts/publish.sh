#!/bin/bash
# TAG.sh: Automate version tagging and npm publish for release

set -e

# Get version from package.json
VERSION=$(jq -r .version package.json)

if [ -z "$VERSION" ]; then
  echo "Could not find version in package.json"
  exit 1
fi

echo "🔖 Using package.json version $VERSION"

git add .
git commit -am "chore: release v$VERSION"

git tag "v$VERSION"
git push && git push --tags

echo "🚀 Building all artifacts..."
pnpm run build:all && pnpm run build:docs

echo "📦 Publishing to npm..."
pnpm publish --access public

echo "✅ Release v$VERSION published to npm, unpkg, jsDelivr"
