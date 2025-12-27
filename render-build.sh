#!/usr/bin/env bash
# Render.com Build Script for YTGrab

echo "🔧 Installing dependencies..."
npm install

echo "📥 Installing yt-dlp..."
# Download yt-dlp binary
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /opt/render/project/src/yt-dlp
chmod a+rx /opt/render/project/src/yt-dlp

# Also try to install via pip as fallback
pip install --upgrade yt-dlp || true

echo "✅ Build complete!"
echo "yt-dlp location: $(which yt-dlp || echo '/opt/render/project/src/yt-dlp')"
