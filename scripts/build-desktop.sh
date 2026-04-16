#!/bin/bash
# ============================================================
# BUILD-DESKTOP.SH – Desktop-App (Electron) bauen
# ============================================================

set -e
echo "🖥️  Team Kalender – Desktop-Build (Electron)"
echo "================================================"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_DIR="$PROJECT_ROOT/platforms/desktop"

# 1. Dependencies installieren
echo "📦 Installiere Electron-Dependencies..."
cd "$DESKTOP_DIR"
npm install

# 2. Plattform erkennen & bauen
PLATFORM="${1:-$(uname -s)}"
case "$PLATFORM" in
  Darwin|mac)
    echo "🍎 Baue macOS-App..."
    npm run build:mac
    ;;
  Linux|linux)
    echo "🐧 Baue Linux-App..."
    npm run build:linux
    ;;
  MINGW*|MSYS*|win)
    echo "🪟 Baue Windows-App..."
    npm run build:win
    ;;
  all)
    echo "📦 Baue für alle Plattformen..."
    npm run build:all
    ;;
  *)
    echo "⚠️  Unbekannte Plattform: $PLATFORM"
    echo "Nutze: ./build-desktop.sh [mac|linux|win|all]"
    exit 1
    ;;
esac

echo ""
echo "✅ Desktop-Build fertig!"
echo "   Ausgabe: $PROJECT_ROOT/dist/desktop/"
