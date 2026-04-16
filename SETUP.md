# 🚀 Team Kalender – Setup-Anleitung

Diese Anleitung führt dich in 3 Schritten zur fertigen, echten App.
Dauer: ca. 15–20 Minuten.

---

## Schritt 1: Supabase einrichten (die Datenbank)

### 1.1 Kostenlosen Account erstellen
1. Gehe zu **[supabase.com](https://supabase.com)**
2. Klicke auf **"Start your project"**
3. Registriere dich (GitHub-Login oder E-Mail)

### 1.2 Neues Projekt anlegen
1. Klicke auf **"New project"**
2. Fülle aus:
   - **Name:** `team-kalender` (oder beliebig)
   - **Database Password:** sicheres Passwort – **merke es dir!**
   - **Region:** `West EU (Ireland)` – für kurze Ladezeiten in DE
3. Klicke **"Create new project"** → warte ~1 Minute

### 1.3 Datenbank-Schema einspielen
1. Im Supabase-Dashboard: Klicke links auf **"SQL Editor"**
2. Klicke auf **"New query"**
3. Öffne die Datei `supabase/schema.sql` aus diesem Ordner
4. Kopiere den gesamten Inhalt und füge ihn in den SQL-Editor ein
5. Klicke auf **"Run"** (grüner Button) → alle Tabellen und Sicherheitsregeln werden erstellt

### 1.4 API-Schlüssel kopieren
1. Klicke links auf **"Project Settings"** (Zahnrad-Icon)
2. Dann auf **"API"**
3. Kopiere dir:
   - **Project URL** → sieht aus wie `https://abcdefgh.supabase.co`
   - **anon public** Key → langer String

---

## Schritt 2: App konfigurieren

Öffne die Datei `js/config.js` und trage deine Supabase-Werte ein:

```javascript
export const SUPABASE_URL  = 'https://DEIN_PROJEKT.supabase.co';
export const SUPABASE_ANON = 'dein_anon_public_key_hier';
```

> ⚠️ Der `anon`-Key ist öffentlich sichtbar – das ist OK und so gedacht.
> Er alleine gibt keinen Zugriff auf Daten, weil die Datenbank-Sicherheitsregeln (RLS) das verhindern.

---

## Schritt 3: Online stellen mit Vercel

### 3.1 GitHub-Repository erstellen
1. Gehe zu **[github.com](https://github.com)** und erstelle ein neues Repository (z.B. `team-kalender`)
2. Lade alle Dateien aus diesem Ordner hoch (oder nutze Git auf der Kommandozeile):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/DEIN_NAME/team-kalender.git
   git push -u origin main
   ```

### 3.2 Auf Vercel deployen
1. Gehe zu **[vercel.com](https://vercel.com)** und registriere dich (kostenlos)
2. Klicke auf **"Add New Project"**
3. Wähle dein GitHub-Repository `team-kalender`
4. Klicke **"Deploy"** → Vercel erkennt automatisch die Konfiguration
5. Nach ~1 Minute bekommst du eine URL wie `https://team-kalender-xyz.vercel.app`

### 3.3 E-Mail-Bestätigung in Supabase deaktivieren (optional, für einfacheres Testen)
1. Supabase Dashboard → **Authentication** → **Providers** → **Email**
2. Deaktiviere **"Confirm email"** – dann können sich Nutzer sofort einloggen

---

## Projektstruktur

```
team-kalender-app/
├── index.html          ← Haupt-HTML-Datei
├── css/
│   └── styles.css      ← Alle Styles
├── js/
│   ├── config.js       ← Supabase URL + Key (hier eintragen!)
│   ├── db.js           ← Alle Datenbankoperationen
│   └── app.js          ← App-Logik und UI
├── supabase/
│   └── schema.sql      ← Datenbankschema (einmalig ausführen)
├── manifest.json       ← PWA-Konfiguration
├── vercel.json         ← Deployment + Sicherheits-Header
├── .gitignore          ← Schützt sensible Dateien vor Git
└── .env.example        ← Vorlage für Umgebungsvariablen
```

---

## Sicherheit im Überblick

| Maßnahme | Beschreibung |
|---|---|
| **Row Level Security** | Jeder Nutzer sieht nur Daten, zu denen er berechtigt ist |
| **Supabase Auth** | Echte, sichere Authentifizierung (bcrypt, JWT) |
| **Passwort-Validierung** | Min. 8 Zeichen, Großbuchstabe + Zahl erforderlich |
| **XSS-Schutz** | Alle Ausgaben werden HTML-escaped |
| **Security Headers** | X-Frame-Options, CSP, Referrer-Policy etc. |
| **Keine Passwörter im Code** | Credentials nur über config.js oder Umgebungsvariablen |

---

## Häufige Probleme

**„User not found" beim Login**
→ Supabase sendet standardmäßig eine Bestätigungs-E-Mail. Prüfe dein Postfach oder deaktiviere E-Mail-Bestätigung (siehe Schritt 3.3).

**Daten werden nicht geladen**
→ Prüfe ob URL und Key in `js/config.js` korrekt eingetragen sind. Kein Leerzeichen, kein Anführungszeichen vergessen.

**„RLS policy violation"**
→ Das SQL-Schema wurde nicht vollständig ausgeführt. Führe `schema.sql` nochmal im SQL-Editor aus.

---

*Erstellt mit Claude Cowork – April 2026*
