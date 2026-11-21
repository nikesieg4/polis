# POLIS – Polizei-Datenbank · Berlin City Roleplay

Interne Datenbank für die Polizei-Fraktion von **Berlin City Roleplay** auf dem Roblox-Spiel *Emergency Hamburg*.

> **Testversion.** Auf Cloudflare Pages teilen sich alle Beamten eine Datenbank (Cloudflare D1), geschützt durch einen gemeinsamen Dienstschlüssel. Auf GitHub Pages (ohne Server) läuft die Seite im lokalen Modus: Daten nur im eigenen Browser.

## Funktionen
- **Personensuche** (links): Suche nach RP-Name, Personen-ID oder `@RobloxName`. Unbekannte Spieler lassen sich direkt anlegen; der Account wird bei Roblox geprüft und der Avatar angezeigt.
- **Strafregister** (rechts): Strafe suchen (z. B. „Raub“ oder „8“) und anklicken, die Person bekommt sie sofort mit der Mindeststrafe aus dem Strafgesetzbuch (§ 1 bis 10). Oben steht, was **ausstehend** ist (Geld und Haftzeit); mit „Erledigt“ wird es abgehakt. Ausstehende Strafen lassen sich mit „Anpassen“ innerhalb der Spanne des Paragraphen erhöhen (Geld und Haftzeit, wird protokolliert) oder bei einem Fehlklick entfernen.

- **Haftbefehle**: bei der Person ausstellen (Kennzeichen, Auto Modell, Grund, Beweise; ausgestellt von = eigener Name). Offene Haftbefehle stehen im Tab „Haftbefehle“ und als roter Balken bei der Person. Status: offen, vollstreckt, aufgehoben. „Für Discord kopieren“ erzeugt den Text im Discord-Format; der Teamtag pingt die Rolle @Präsidium-Team (`TEAMTAG` in `app.js`, Rollen-ID 1476650119700156618).

- **Protokoll**: Jede Änderung (Person angelegt/geändert, Strafe vergeben/erledigt/entfernt, Haftbefehl ausgestellt/vollstreckt/aufgehoben) wird mit Name, Dienstnummer und Uhrzeit gespeichert und ist im Tab „Protokoll“ durchsuchbar. Ohne Name und Dienstnummer oben kann man nichts eintragen; die API lehnt Änderungen ohne die Header `x-polis-name` und `x-polis-nr` ab.

- **Admin** (Knopf „Admin“ oben, Passwort = Secret `POLIS_KEY_ADMIN`): RP-Name und Roblox-Namen einer Person ändern (neuer Account wird bei Roblox geprüft), auch erledigte Strafen löschen, Haftbefehle löschen, Personen mit allen Einträgen löschen. Alles landet mit „(Admin)“ im Protokoll. Das Admin-Passwort gilt nur bis der Tab geschlossen wird.

## Anmeldung mit Discord
Sobald die Discord-Secrets gesetzt sind, meldet man sich mit Discord an statt mit Dienstschlüssel und selbst eingetragenem Namen. Der Bot liest vom Discord-Server den **Server-Nickname** und die **Rollen** (über ihre Namen):

| Rolle | Rechte |
|---|---|
| A1 bis A10 | Zugriff, Personen anlegen, Strafen vergeben, Haftbefehle ansehen |
| ab A4 | zusätzlich Haftbefehle ausstellen, vollstrecken, aufheben |
| Datenbank Admin | alles, auch ohne A-Rolle: Personen bearbeiten/löschen, Strafen und Haftbefehle löschen |

Grenzen änderbar per Secret `POLIS_MIN_RANK` (Standard 1), `POLIS_HB_MIN_RANK` (Standard 4), Admin-Rollenname per `POLIS_ADMIN_ROLE_NAME`. Im Protokoll steht der Nickname (mit Dienstnummer) und der Discord-Name. Rollen werden höchstens alle 5 Minuten neu geprüft; wer die Rolle verliert, fliegt danach raus. Code: `lib/discord.js`.

Einrichtung:
1. [Discord Developer Portal](https://discord.com/developers/applications) → *New Application*.
2. **OAuth2** → *Redirects* → `https://<deine-worker-adresse>/api/auth/discord/callback` eintragen (genau so, mit `https`).
3. **Bot** → *Reset Token* → Token kopieren. Bot auf den Server einladen: OAuth2 → URL Generator → Scope `bot`, keine Rechte → Link öffnen.
4. `DISCORD_CLIENT_ID` und `DISCORD_GUILD_ID` stehen in `wrangler.jsonc` unter `vars` (nicht geheim). Im Worker unter Settings → Variables and Secrets nur noch als **Secret** anlegen:
   - `DISCORD_CLIENT_SECRET` (OAuth2 → Client Secret)
   - `DISCORD_BOT_TOKEN`

   Rollen-IDs sind nicht nötig, die Rollen werden über ihre Namen (A1 … A10, Datenbank Admin) erkannt.
5. Neu deployen.

**Testphase:** Solange das Secret `POLIS_KEY` noch existiert, gibt es im Anmeldefenster zusätzlich „Ohne Discord anmelden“ (Dienstschlüssel, Name und Dienstnummer selbst eingetragen, Admin über `POLIS_KEY_ADMIN`). Solche Einträge stehen im Protokoll mit „ohne Discord“. Zum Abschalten `POLIS_KEY` und `POLIS_KEY_ADMIN` löschen und neu deployen, dann geht nur noch Discord.

## Hosting
Statische Seite (`index.html`, `style.css`, `app.js`) plus API in `functions/api/` (Cloudflare Pages Functions). Kein Build-Schritt.

### Cloudflare Workers (aktuell genutzt)
`wrangler.jsonc` + `worker.js`: Der Worker liefert die Dateien aus und leitet `/api/*` an `functions/api/[[path]].js`. Die D1-Datenbank wird in `wrangler.jsonc` unter `d1_databases` eingetragen (Binding `DB`). Der Dienstschlüssel `POLIS_KEY` wird im Dashboard als **Secret** gesetzt (Worker → Settings → Variables and Secrets). Jeder Push auf `main` wird automatisch gebaut.

### Cloudflare Pages (Alternative)
1. **D1-Datenbank anlegen:** Workers & Pages → D1 → *Create database* → Name z. B. `polis-db`.
2. **Pages-Projekt verbinden:** Workers & Pages → Create → Pages → *Connect to Git* → dieses Repo. Production branch `main`, Build command leer, Build output directory `/`.
3. **Datenbank verbinden:** Pages-Projekt → Settings → Bindings → *Add* → D1 database. Variable name **`DB`**, Datenbank `polis-db`.
4. **Dienstschlüssel festlegen** (optional zusätzlich Secret `POLIS_KEY_ADMIN` für Admins): Settings → Variables and Secrets → *Add* → Typ *Secret*, Name **`POLIS_KEY`**, Wert = ein langes Passwort, das nur die Polizei-Fraktion bekommt.
5. **Neu ausrollen:** Deployments → letzter Deploy → *Retry deployment* (Bindings und Secrets gelten erst ab dem nächsten Deploy).

Die Tabellen werden beim ersten Aufruf automatisch angelegt. Jeder Push auf `main` wird automatisch veröffentlicht.

### GitHub Pages (nur lokaler Modus)
Settings → Pages → *Deploy from a branch* → `main` / `(root)`.

## API (`/api`)
Mit Discord-Anmeldung: Sitzungs-Cookie `polis_session` (über `/api/auth/discord/login`), ändernde Anfragen zusätzlich Header `x-polis: 1`; `/api/me` liefert Nickname, Discord-Name und Admin-Status, `POST /api/auth/logout` meldet ab. Ohne Discord (alter Weg): alle Endpunkte außer `health` und `avatar` brauchen den Header `x-polis-key`. Ändernde Anfragen (POST, PATCH, DELETE) zusätzlich `x-polis-name` und `x-polis-nr` (URL-kodiert); sie landen im Protokoll.

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/health` | Status (DB verbunden, Schlüssel gesetzt) |
| GET | `/api/people` | Alle Personen mit Anzahl Einträge |
| POST | `/api/people` | Person anlegen (`roblox`, `name`), prüft den Account bei Roblox |
| PATCH | `/api/people/:id` | `status`, `danger`, `name` ändern |
| GET | `/api/people/:id/akte` | Strafregister lesen |
| POST | `/api/people/:id/akte` | Strafe vergeben (`entries: [{ para: "§ 8" }]`), Beträge werden auf die Spanne des Paragraphen begrenzt |
| PATCH | `/api/people/:id/akte` | `{ erledigt: true }`: alle ausstehenden Strafen erledigt |
| PATCH / DELETE | `/api/people/:id/akte/:eintrag` | `{ erledigt }` erledigen, `{ geld, haft }` anpassen (auf die Spanne begrenzt) / ausstehenden Eintrag löschen |
| GET / POST | `/api/people/:id/haftbefehle` | Haftbefehle einer Person / neuen ausstellen (`grund` Pflicht) |
| GET | `/api/haftbefehle?status=offen` | Alle Haftbefehle (optional nach Status) |
| PATCH | `/api/haftbefehle/:id` | `status`: `offen`, `vollstreckt`, `aufgehoben` |
| GET | `/api/log?limit=200&person=P-1001` | Protokoll (optional nur eine Person) |
| GET | `/api/admin` | Admin-Passwort prüfen (Header `x-polis-admin`) |
| PATCH | `/api/people/:id` mit `name` / `roblox` | Person bearbeiten (Admin) |
| DELETE | `/api/people/:id` | Person mit allen Einträgen löschen (Admin) |
| DELETE | `/api/haftbefehle/:id` | Haftbefehl löschen (Admin) |
| GET | `/api/roblox/:name` | Roblox-Account nachschlagen |
| GET | `/api/avatar/:robloxId` | Weiterleitung auf das Roblox-Avatarbild |

## Hinweis
Dies ist ein **inoffizielles Roleplay-Tool**. Es hat keine Verbindung zur echten Polizei Berlin und enthält keine realen Personendaten. Alle Namen und Einträge sind fiktiv.
