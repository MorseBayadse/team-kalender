#!/bin/bash
# Team-Kalender – lokale Vorschau starten
# Doppelklick auf diese Datei startet einen lokalen Webserver
# und öffnet die App im Standardbrowser.

cd "$(dirname "$0")"

PORT=8000

# Falls Port 8000 belegt ist, nächsten freien Port suchen
while lsof -i :$PORT >/dev/null 2>&1; do
  PORT=$((PORT+1))
done

echo ""
echo "======================================================"
echo "  Team-Kalender – Lokale Vorschau"
echo "======================================================"
echo ""
echo "  Server läuft auf: http://localhost:$PORT"
echo ""
echo "  Zum Beenden: dieses Fenster schließen"
echo "  oder Strg+C drücken."
echo ""
echo "======================================================"
echo ""

# Browser nach kurzer Verzögerung öffnen
(sleep 1 && open "http://localhost:$PORT") &

# Python-Webserver starten aus dem src/ Ordner
# (Python 3 ist auf macOS vorinstalliert)
cd src
python3 -m http.server $PORT
