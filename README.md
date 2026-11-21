# POLIS – Polizei-Datenbank · Berlin City Roleplay

Interne Datenbank für die Polizei-Fraktion von **Berlin City Roleplay** auf dem Roblox-Spiel *Emergency Hamburg*.

> **Testversion.** Auf Cloudflare Pages teilen sich alle Beamten eine Datenbank (Cloudflare D1), geschützt durch einen gemeinsamen Dienstschlüssel. Auf GitHub Pages (ohne Server) läuft die Seite im lokalen Modus: Daten nur im eigenen Browser.

## Funktionen
- **Schicht** (links): Dienstzeit starten, pausieren und beenden, mit Übersicht für heute und die Woche (pro Browser gespeichert)
- **Personensuche** (Mitte): Suche nach RP-Name, Personen-ID oder `@RobloxName`. Unbekannte Spieler lassen sich direkt erfassen; der Account wird bei Roblox geprüft und der Avatar angezeigt.
- **Strafregister** (rechts): Einträge pro Person mit Summen für Geldstrafen und Haftzeit, neue Strafen aus dem Strafkatalog, Status und Gefährlich-Markierung
- **Geplant:** Fahrzeuge, Haftbefehle, Einsatzberichte, Lizenzen

## Hosting
Statische Seite (`index.html`, `style.css`, `app.js`) plus API in `functions/api/` (Cloudflare Pages Functions). Kein Build-Schritt.

### Cloudflare Pages (mit geteilter Datenbank)
1. **D1-Datenbank anlegen:** Workers & Pages → D1 → *Create database* → Name z. B. `polis-db`.
2. **Pages-Projekt verbinden:** Workers & Pages → Create → Pages → *Connect to Git* → dieses Repo. Production branch `main`, Build command leer, Build output directory `/`.
3. **Datenbank verbinden:** Pages-Projekt → Settings → Bindings → *Add* → D1 database. Variable name **`DB`**, Datenbank `polis-db`.
4. **Dienstschlüssel festlegen:** Settings → Variables and Secrets → *Add* → Typ *Secret*, Name **`POLIS_KEY`**, Wert = ein langes Passwort, das nur die Polizei-Fraktion bekommt.
5. **Neu ausrollen:** Deployments → letzter Deploy → *Retry deployment* (Bindings und Secrets gelten erst ab dem nächsten Deploy).

Die Tabellen werden beim ersten Aufruf automatisch angelegt. Jeder Push auf `main` wird automatisch veröffentlicht.

### GitHub Pages (nur lokaler Modus)
Settings → Pages → *Deploy from a branch* → `main` / `(root)`.

## API (`/api`)
Alle Endpunkte außer `health` und `avatar` brauchen den Header `x-polis-key`.

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/health` | Status (DB verbunden, Schlüssel gesetzt) |
| GET | `/api/people` | Alle Personen mit Anzahl Einträge |
| POST | `/api/people` | Person anlegen (`roblox`, `name`), prüft den Account bei Roblox |
| PATCH | `/api/people/:id` | `status`, `danger`, `name` ändern |
| GET / POST | `/api/people/:id/akte` | Strafregister lesen / Einträge hinzufügen |
| GET | `/api/roblox/:name` | Roblox-Account nachschlagen |
| GET | `/api/avatar/:robloxId` | Weiterleitung auf das Roblox-Avatarbild |

## Hinweis
Dies ist ein **inoffizielles Roleplay-Tool**. Es hat keine Verbindung zur echten Polizei Berlin und enthält keine realen Personendaten. Alle Namen und Einträge sind fiktiv.
