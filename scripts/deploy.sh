#!/bin/bash
set -e

# Get commit message from parameter or use default
COMMIT_MSG="${1:-chore: release build artifacts}"

echo "🚀 Starting deployment process..."
echo "📝 Commit message: $COMMIT_MSG"

# Step 1: Run release script (build:all and build:docs)
echo "📦 Building all artifacts..."
pnpm run release

# Step 2: Commit and push to main
echo "💾 Committing and pushing to main..."
git add .
git commit -am "$COMMIT_MSG" || echo "No changes to commit"
git push origin main

# Step 3: Deploy to gh-pages
echo "🌐 Deploying to gh-pages..."

# Create temporary directory
TMP_DIR=$(mktemp -d)
echo "Created temporary directory: $TMP_DIR"

# Copy dist-deploy content to tmp
cp -r dist-deploy/* "$TMP_DIR/"

# Navigate to tmp directory
cd "$TMP_DIR"

# Initialize git repo
git init
git add -A
git commit -m "Deploy to GitHub Pages"

# Get the repository URL
cd -
REPO_URL=$(git config --get remote.origin.url)

# Push to gh-pages branch (force push)
cd "$TMP_DIR"
git push -f "$REPO_URL" HEAD:gh-pages

# Cleanup
cd -
rm -rf "$TMP_DIR"

echo "✅ Deployment complete!"
echo "📄 Documentation: Check the doc/ folder"
echo "🌍 Live demo: https://abelvm.github.io/deckglraster-multiband/"
