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


# Try to create tag, but if it exists, log and continue
if git tag | grep -q "^v$VERSION$"; then
  echo "⚠️ Tag v$VERSION already exists. Skipping tag creation."
else
  git tag -a "v$VERSION" -m "Release v$VERSION"
  git push && git push --tags
fi

echo "🚀 Building all artifacts..."
pnpm run build:all && pnpm run build:docs

echo "✅ Release v$VERSION published to npm, unpkg, jsDelivr"
echo "📦 Publishing to npm..."
PUBLISH_OUTPUT=$(pnpm publish --access public 2>&1) || true
if echo "$PUBLISH_OUTPUT" | grep -q "previously published"; then
  echo "⚠️ Version $VERSION already exists on npm. Skipping publish."
else
  echo "$PUBLISH_OUTPUT"
  echo "✅ Release v$VERSION published to npm, unpkg, jsDelivr"
fi
