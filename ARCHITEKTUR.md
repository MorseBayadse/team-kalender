# Team Kalender – Projektarchitektur

## Prinzip: Eine Codebasis, alle Plattformen

Die App nutzt eine **einzige Web-Codebasis** (`src/`), die auf allen Plattformen läuft:

| Plattform | Technologie | Wie es funktioniert |
|-----------|------------|-------------------|
| **Browser (PWA)** | Vanilla HTML/JS/CSS | Direkt im Browser, installierbar als PWA |
| **Desktop** | Electron | Natives Fenster, das die Web-App lädt |
| **iPhone/iPad** | Capacitor (iOS) | Native iOS-App mit WebView |
| **Android** | Capacitor (Android) | Native Android-App mit WebView |

**Wenn du Code in `src/` änderst, ändern sich automatisch ALLE Versionen.**

---

## Ordnerstruktur

```
team-kalender-app/
│
├── src/                        ← GEMEINSAMER CODE (alle Plattformen)
│   ├── index.html              ← Haupt-HTML (Einstiegspunkt)
│   ├── manifest.json           ← PWA-Manifest
│   │
│   ├── core/                   ← Geschäftslogik & Datenbank
│   │   ├── config.js           ← Supabase-Konfiguration
│   │   └── api.js              ← Alle DB-Operationen (Supabase)
│   │
│   ├── ui/                     ← Benutzeroberfläche
│   │   ├── app.js              ← Haupt-App-Logik (UI-Steuerung)
│   │   ├── styles.css          ← Alle Styles
│   │   └── components/         ← Wiederverwendbare UI-Komponenten
│   │
│   └── platform/               ← Plattform-Abstraktionsschicht
│       ├── index.js            ← Zentraler Export
│       ├── platform.js         ← Plattform-Erkennung (Web/Desktop/Mobile)
│       ├── notifications.js    ← Push-Benachrichtigungen
│       └── storage.js          ← Lokaler Speicher
│
├── platforms/                  ← PLATTFORM-SPEZIFISCH
│   ├── desktop/                ← Electron (Desktop-App)
│   │   ├── main.js             ← Electron Main-Process
│   │   ├── preload.js          ← Brücke Main↔Web
│   │   └── package.json        ← Electron-Dependencies
│   │
│   └── mobile/                 ← Capacitor (iPhone + Android)
│       ├── capacitor.config.ts ← Capacitor-Konfiguration
│       ├── package.json        ← Capacitor-Dependencies
│       ├── ios/                ← (generiert) Xcode-Projekt
│       └── android/            ← (generiert) Android-Studio-Projekt
│
├── assets/                     ← GEMEINSAME RESSOURCEN
│   └── icons/                  ← App-Icons (alle Größen)
│
├── supabase/                   ← DATENBANK
│   ├── schema.sql              ← Datenbank-Schema
│   ├── functions/              ← Edge Functions
│   └── *.sql                   ← Migrations
│
├── scripts/                    ← BUILD-SCRIPTS
│   ├── build-web.sh            ← Web/PWA bauen
│   ├── build-desktop.sh        ← Electron bauen
│   └── build-mobile.sh         ← Capacitor bauen
│
├── package.json                ← Root-Config mit allen Befehlen
├── vercel.json                 ← Web-Deployment
└── .gitignore                  ← Git-Ausschlüsse
```

---

## Wo ändere ich was?

| Ich will ... | Datei(en) |
|---|---|
| UI/Design ändern | `src/ui/styles.css` |
| Neue Funktion (Button, Ansicht) | `src/ui/app.js` |
| Datenbank-Abfrage ändern | `src/core/api.js` |
| Supabase-Keys ändern | `src/core/config.js` |
| Benachrichtigungen anpassen | `src/platform/notifications.js` |
| Desktop-Fenster anpassen | `platforms/desktop/main.js` |
| Mobile-Einstellungen | `platforms/mobile/capacitor.config.ts` |

---

## Befehle

```bash
# Web (Browser)
npm start                    # Lokaler Preview-Server
npm run dev                  # Development-Server (Port 3000)
npm run build:web            # Web-Build erstellen
npm run deploy:web           # Auf Vercel deployen

# Desktop (Electron)
npm run desktop:start        # Desktop-App starten
npm run desktop:build:mac    # macOS-App bauen
npm run desktop:build:win    # Windows-App bauen
npm run desktop:build:linux  # Linux-App bauen

# Mobile (Capacitor)
npm run mobile:init          # iOS/Android erstmalig einrichten
npm run mobile:sync          # Web-Änderungen übernehmen
npm run mobile:ios           # In Xcode öffnen
npm run mobile:android       # In Android Studio öffnen
npm run mobile:run:ios       # Auf iPhone/Simulator starten
npm run mobile:run:android   # Auf Android-Gerät starten
```

---

## Wie die Plattform-Abstraktionsschicht funktioniert

Der Code in `src/platform/` erkennt automatisch, auf welcher Plattform die App läuft, und verwendet die passende API:

```
┌─────────────────────────────────────────────────┐
│           src/ui/app.js (UI-Logik)              │
│         src/core/api.js (Datenbank)             │
├─────────────────────────────────────────────────┤
│        src/platform/ (Abstraktionsschicht)       │
├───────────┬───────────┬──────────┬──────────────┤
│  Browser  │  Electron │   iOS    │   Android    │
│  (PWA)    │  (Desktop)│(Capacitor)│ (Capacitor) │
└───────────┴───────────┴──────────┴──────────────┘
```

Wenn du z.B. `sendLocalNotification()` aufrufst:
- **Browser:** `new Notification(...)` (Web API)
- **Desktop:** `Electron.Notification` (natives System)
- **Mobile:** `LocalNotifications.schedule(...)` (natives iOS/Android)

---

*Zuletzt aktualisiert: 16.04.2026*
