#!/bin/bash
# =================================================================
# Team-Kalender: Code zu GitHub pushen  (EINMAL ausfuehren)
#
# Was macht dieses Script?
#   1. Verbindet den lokalen Ordner mit deinem GitHub-Repo
#   2. Fuegt alle Dateien hinzu
#   3. Erstellt einen Commit
#   4. Pusht zu GitHub  (Vercel baut dann automatisch neu)
#
# Benutzung:
#   Terminal oeffnen, dann:
#     cd "/Users/morsebayadse/Documents/Claude/Projects/Team-Kalender/team-kalender-app"
#     bash push-to-github.sh
#
# Wenn GitHub nach Login fragt, nimm deinen GitHub-Nutzer + ein
# Personal Access Token als Passwort (nicht dein normales Passwort).
# Token holen: https://github.com/settings/tokens  ->  "repo" Scope
# =================================================================

set -e

REPO_URL="https://github.com/MorseBayadse/team-kalender.git"
BRANCH="main"

cd "$(dirname "$0")"

echo "Schritt 1/5: Git-Identitaet sicherstellen..."
git config user.email  2>/dev/null || git config user.email "bayadse@gmail.com"
git config user.name   2>/dev/null || git config user.name  "Morse Bayadse"

echo "Schritt 2/5: Remote 'origin' setzen..."
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REPO_URL"
else
  git remote add origin "$REPO_URL"
fi

echo "Schritt 3/5: Alle Dateien stagen..."
git add -A

echo "Schritt 4/5: Commit erstellen..."
if git diff --cached --quiet; then
  echo "  (Nichts zu committen - Arbeitskopie ist sauber.)"
else
  git commit -m "Team-Kalender: Personal calendar, event sharing, ICS subscription"
fi

echo "Schritt 5/5: Pushen zu GitHub ($BRANCH)..."
git branch -M "$BRANCH"
git push -u origin "$BRANCH"

echo ""
echo "=========================================="
echo "FERTIG. Vercel baut jetzt automatisch neu."
echo "Status anschauen: https://vercel.com/dashboard"
echo "Live-URL:         https://team-kalender-mocha.vercel.app"
echo "=========================================="
