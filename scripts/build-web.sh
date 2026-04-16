#!/bin/bash
# ============================================================
# BUILD-WEB.SH – Web/Browser-Version (PWA) bauen & deployen
# ============================================================

set -e
echo "🌐 Team Kalender – Web-Build"
echo "================================"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$PROJECT_ROOT/dist/web"

# 1. Dist-Ordner vorbereiten
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# 2. Quelldateien kopieren
echo "📦 Kopiere Quelldateien..."
cp -r "$PROJECT_ROOT/src/"* "$DIST_DIR/"
cp -r "$PROJECT_ROOT/assets" "$DIST_DIR/"

# 3. Manifest & Icons in Root kopieren (für PWA)
cp "$PROJECT_ROOT/src/manifest.json" "$DIST_DIR/"

# 4. Vercel-Config kopieren (falls vorhanden)
if [ -f "$PROJECT_ROOT/vercel.json" ]; then
  cp "$PROJECT_ROOT/vercel.json" "$DIST_DIR/"
fi

echo "✅ Web-Build fertig: $DIST_DIR"
echo ""
echo "Zum Deployen:"
echo "  cd $DIST_DIR && npx vercel --prod"
echo "  oder: npx serve $DIST_DIR"
