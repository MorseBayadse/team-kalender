#!/bin/bash
# ============================================================
# BUILD-MOBILE.SH – Mobile-App (Capacitor: iOS + Android) bauen
# ============================================================

set -e
echo "📱 Team Kalender – Mobile-Build (Capacitor)"
echo "==============================================="

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE_DIR="$PROJECT_ROOT/platforms/mobile"

# 1. Dependencies installieren
echo "📦 Installiere Capacitor-Dependencies..."
cd "$MOBILE_DIR"
npm install

# 2. Native Projekte hinzufügen (falls noch nicht vorhanden)
TARGET="${1:-sync}"

case "$TARGET" in
  init)
    echo "🔧 Initialisiere native Projekte..."
    [ ! -d "ios" ] && npm run cap:add:ios && echo "  ✅ iOS hinzugefügt"
    [ ! -d "android" ] && npm run cap:add:android && echo "  ✅ Android hinzugefügt"
    npm run cap:sync
    echo "✅ Initialisierung abgeschlossen!"
    ;;
  sync)
    echo "🔄 Synchronisiere Web-App mit nativen Projekten..."
    npm run cap:sync
    echo "✅ Sync abgeschlossen!"
    ;;
  ios)
    echo "🍎 Öffne iOS-Projekt in Xcode..."
    npm run cap:sync
    npm run cap:open:ios
    ;;
  android)
    echo "🤖 Öffne Android-Projekt in Android Studio..."
    npm run cap:sync
    npm run cap:open:android
    ;;
  run:ios)
    echo "🍎 Starte auf iOS-Gerät/Simulator..."
    npm run cap:sync
    npm run cap:run:ios
    ;;
  run:android)
    echo "🤖 Starte auf Android-Gerät/Emulator..."
    npm run cap:sync
    npm run cap:run:android
    ;;
  *)
    echo "Verwendung: ./build-mobile.sh [init|sync|ios|android|run:ios|run:android]"
    echo ""
    echo "  init        – Native Projekte erstmalig hinzufügen"
    echo "  sync        – Web-Änderungen in native Projekte übernehmen"
    echo "  ios         – Xcode öffnen"
    echo "  android     – Android Studio öffnen"
    echo "  run:ios     – Auf iOS-Gerät/Simulator starten"
    echo "  run:android – Auf Android-Gerät/Emulator starten"
    exit 1
    ;;
esac
