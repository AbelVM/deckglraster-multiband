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

# Set npm token from .env
NPM_TOKEN=$(grep NPM_TOKEN .env | cut -d '=' -f2)
if [ -n "$NPM_TOKEN" ]; then
  npm config set //registry.npmjs.org/:_authToken=$NPM_TOKEN
fi

# Commit changes if any
if ! git commit -am "chore: release v$VERSION"; then
  echo "No changes to commit, proceeding to publish"
fi

git tag -a "v$VERSION" -m "Release v$VERSION"
git push && git push --tags

echo "🚀 Building all artifacts..."
pnpm run build:all && pnpm run build:docs

echo "📦 Publishing to npm..."
pnpm publish --access public

echo "✅ Release v$VERSION published to npm, unpkg, jsDelivr"
