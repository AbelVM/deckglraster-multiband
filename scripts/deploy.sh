#!/bin/bash
set -e

# Get commit message from parameter or use default
COMMIT_MSG="${1:-chore: release build artifacts}"

echo "🚀 Starting deployment process..."
echo "📝 Commit message: $COMMIT_MSG"

# Step 1: Run release script (build:all and build:docs)
echo "📦 Building all artifacts..."
pnpm run release

# Step 2: Generate llms.txt
echo "📝 Generating llms.txt..."
node scripts/generate-llms-txt.mjs

# Step 3: Copy doc folder and llms.txt to dist-deploy
echo "📚 Copying documentation to deployment folder..."
if [ -d "doc" ]; then
  mkdir -p example/dist-deploy/doc
  cp -r doc/* example/dist-deploy/doc/
  echo "✅ Documentation copied to example/dist-deploy/doc/"
else
  echo "⚠️  Warning: doc folder not found"
fi

if [ -f "llms.txt" ]; then
  cp llms.txt example/dist-deploy/
  echo "✅ llms.txt copied to example/dist-deploy/"
else
  echo "⚠️  Warning: llms.txt not found"
fi

# Step 4: Prepare gh-pages deployment
echo "🌐 Preparing gh-pages deployment..."

# Create temporary directory
TMP_DIR=$(mktemp -d)
echo "Created temporary directory: $TMP_DIR"

# Verify dist-deploy exists (it's in example/dist-deploy because of vite config root)
if [ ! -d "example/dist-deploy" ]; then
  echo "❌ Error: example/dist-deploy directory not found"
  rm -rf "$TMP_DIR"
  exit 1
fi

# Copy dist-deploy content to tmp
echo "Copying example/dist-deploy to temporary directory..."
cp -r example/dist-deploy/* "$TMP_DIR/"

# Step 5: Commit and push to main
echo "💾 Committing and pushing to main..."
git add .
git commit -m "$COMMIT_MSG" || echo "No changes to commit"
git push origin main

# Step 6: Deploy to gh-pages
echo "🚀 Deploying to gh-pages..."

# Get the repository URL
REPO_URL=$(git config --get remote.origin.url)

# Navigate to tmp directory
cd "$TMP_DIR"

# Initialize git repo
git init
git add -A
git commit -m "Deploy to GitHub Pages"

# Push to gh-pages branch (force push)
git push -f "$REPO_URL" HEAD:gh-pages

# Cleanup
cd -
rm -rf "$TMP_DIR"

echo "✅ Deployment complete!"
echo "📄 Documentation: Check the doc/ folder"
echo "🌍 Live demo: https://abelvm.github.io/deckglraster-multiband/"
