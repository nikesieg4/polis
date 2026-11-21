# POLIS – Polizei-Datenbank · Berlin City Roleplay

Interne Datenbank für die Polizei-Fraktion von **Berlin City Roleplay** auf dem Roblox-Spiel *Emergency Hamburg*.

> **Testversion.** Auf Cloudflare Pages teilen sich alle Beamten eine Datenbank (Cloudflare D1), geschützt durch einen gemeinsamen Dienstschlüssel. Auf GitHub Pages (ohne Server) läuft die Seite im lokalen Modus: Daten nur im eigenen Browser.

## Funktionen
- **Personensuche** (links): Suche nach RP-Name, Personen-ID oder `@RobloxName`. Unbekannte Spieler lassen sich direkt anlegen; der Account wird bei Roblox geprüft und der Avatar angezeigt.
- **Strafregister** (rechts): Strafe suchen (z. B. „Raub“ oder „8“) und anklicken, die Person bekommt sie sofort mit der Mindeststrafe aus dem Strafgesetzbuch (§ 1 bis 10). Oben steht, was **ausstehend** ist (Geld und Haftzeit); mit „Erledigt“ wird es abgehakt. Offene Einträge lassen sich bei einem Fehlklick entfernen.

- **Haftbefehle**: bei der Person ausstellen (Kennzeichen, Auto Modell, Grund, Beweise; ausgestellt von = eigener Name). Offene Haftbefehle stehen im Tab „Haftbefehle“ und als roter Balken bei der Person. Status: offen, vollstreckt, aufgehoben. „Für Discord kopieren“ erzeugt den Text im Discord-Format inkl. Teamtag (`TEAMTAG` in `app.js`).

## Hosting
Statische Seite (`index.html`, `style.css`, `app.js`) plus API in `functions/api/` (Cloudflare Pages Functions). Kein Build-Schritt.

### Cloudflare Workers (aktuell genutzt)
`wrangler.jsonc` + `worker.js`: Der Worker liefert die Dateien aus und leitet `/api/*` an `functions/api/[[path]].js`. Die D1-Datenbank wird in `wrangler.jsonc` unter `d1_databases` eingetragen (Binding `DB`). Der Dienstschlüssel `POLIS_KEY` wird im Dashboard als **Secret** gesetzt (Worker → Settings → Variables and Secrets). Jeder Push auf `main` wird automatisch gebaut.

### Cloudflare Pages (Alternative)
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
| GET | `/api/people/:id/akte` | Strafregister lesen |
| POST | `/api/people/:id/akte` | Strafe vergeben (`entries: [{ para: "§ 8" }]`), Beträge werden auf die Spanne des Paragraphen begrenzt |
| PATCH | `/api/people/:id/akte` | `{ erledigt: true }`: alle ausstehenden Strafen erledigt |
| PATCH / DELETE | `/api/people/:id/akte/:eintrag` | einzelnen Eintrag erledigen / ausstehenden Eintrag löschen |
| GET / POST | `/api/people/:id/haftbefehle` | Haftbefehle einer Person / neuen ausstellen (`grund` Pflicht) |
| GET | `/api/haftbefehle?status=offen` | Alle Haftbefehle (optional nach Status) |
| PATCH | `/api/haftbefehle/:id` | `status`: `offen`, `vollstreckt`, `aufgehoben` |
| GET | `/api/roblox/:name` | Roblox-Account nachschlagen |
| GET | `/api/avatar/:robloxId` | Weiterleitung auf das Roblox-Avatarbild |

## Hinweis
Dies ist ein **inoffizielles Roleplay-Tool**. Es hat keine Verbindung zur echten Polizei Berlin und enthält keine realen Personendaten. Alle Namen und Einträge sind fiktiv.
