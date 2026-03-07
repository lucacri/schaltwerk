#!/bin/bash

set -e

echo "🔨 Building Lucode for macOS release"

VERSION=${1:-$(grep '"version"' src-tauri/tauri.conf.json | head -1 | cut -d'"' -f4)}
ARCH=${2:-$(uname -m)}

if [ "$ARCH" = "arm64" ]; then
    TARGET="aarch64-apple-darwin"
else
    TARGET="x86_64-apple-darwin"
fi

echo "📦 Version: $VERSION"
echo "🎯 Target: $TARGET"

echo "📦 Installing dependencies..."
node scripts/package-manager.mjs install --frozen-lockfile

echo "🏗️ Building frontend..."
node scripts/package-manager.mjs run build

echo "🦀 Building Tauri app for $TARGET..."
node scripts/package-manager.mjs run tauri -- build --target "$TARGET"

APP_PATH="src-tauri/target/$TARGET/release/bundle/macos/Lucode.app"

if [ ! -d "$APP_PATH" ]; then
    echo "❌ Build failed: App not found at $APP_PATH"
    exit 1
fi

echo "🔏 Ad-hoc signing the application..."
codesign --force --deep -s - "$APP_PATH"

echo "✅ Verifying signature..."
codesign --verify --verbose "$APP_PATH"

echo "📦 Creating release archive..."
cd "$(dirname "$APP_PATH")"
ARCHIVE_NAME="lucode-${VERSION}-${TARGET}.tar.gz"
tar -czf "$ARCHIVE_NAME" "$(basename "$APP_PATH")"

echo "🔢 Calculating SHA256..."
shasum -a 256 "$ARCHIVE_NAME"

echo "✅ Build complete!"
echo "📦 Archive: $(pwd)/$ARCHIVE_NAME"

echo ""
echo "📝 To install locally with Homebrew:"
echo "1. Copy the archive to a web server or use file://"
echo "2. Update the formula with the correct URL and SHA256"
echo "3. brew install --build-from-source ./homebrew/Formula/lucode.rb"
