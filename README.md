# POLIS – Polizei-Datenbank · Berlin City Roleplay

Interne Datenbank für die Polizei-Fraktion von **Berlin City Roleplay** auf dem Roblox-Spiel *Emergency Hamburg*.

> **Testversion.** Auf Cloudflare Pages teilen sich alle Beamten eine Datenbank (Cloudflare D1), geschützt durch einen gemeinsamen Dienstschlüssel. Auf GitHub Pages (ohne Server) läuft die Seite im lokalen Modus: Daten nur im eigenen Browser.

## Funktionen
- **Personensuche** (links): Suche nach RP-Name oder Roblox-Name. Schon beim Tippen erscheinen Vorschläge mit Avatar: passende Personen aus der Datenbank und passende Roblox-Accounts (ab 3 Zeichen, über die Roblox-Suche). Ein Klick bzw. Pfeiltasten + Enter öffnet die Akte oder legt den Roblox-Account direkt als Person an.
- **Strafregister** (rechts): Strafe aus dem Strafkatalog (`lib/katalog.js`, Straftaten Nr. 1–27, Ordnungswidrigkeiten Nr. 31–52) suchen, z. B. „Raub“, „249“ oder „StVO“, und anklicken: Die Person bekommt sie sofort. Geldstrafen sind fest; „+ Haft“ heißt, die Person wird ins Gefängnis (Notruf Hamburg) gebracht, ohne feste Dauer. Zusätze wie „Diebesgut einziehen“ stehen dabei. Oben steht, was **ausstehend** ist (Geldstrafe, ob Haft); mit „Erledigt“ wird es abgehakt. Solange eine Person ausstehende Strafen hat, gilt sie automatisch als **Fahndung**; danach wieder der eingestellte Status. Listen sind nach Status sortiert (Fahndung, Bewährung, Sauber); innerhalb von Fahndung und Bewährung steht oben, wer den neuesten Eintrag hat (Strafe oder ausgestellter Haftbefehl). Ausstehende Strafen lassen sich bei einem Fehlklick entfernen.

- **Beschreibung** pro Person: Gruppierung (z. B. Kartell), Rang in der Gruppierung und freier Text. Jeder Beamte darf sie ändern, Änderungen stehen im Protokoll. Die Personensuche findet auch Gruppierungen; ein Klick auf die Gruppierung zeigt alle Mitglieder.
- **Gruppierungen** (Tab links): alle Gruppierungen mit Mitgliederzahl; die Seite einer Gruppierung zeigt ihre Beschreibung und alle Mitglieder mit Rang. Die Beschreibung der Gruppierung dürfen nur A6 und höher sowie Datenbank Admin ändern (`POLIS_GRUPPE_MIN_RANK`, Standard 6).
- **Kripo-Markierung**: Eine Person (z. B. verdeckt in einer Gruppierung) kann als Kripo-Mitglied markiert werden, mit Hinweis für Polizisten. Sichtbar als lila Balken „KRIPO“ in der Akte und als „Kripo“ in Personenliste und Gruppierung. Rechte „Kripo-Markierung sehen“ und „Kripo-Markierung setzen“; ohne Sehen-Recht liefert der Server die Markierung und die zugehörigen Protokolleinträge gar nicht aus.
- **Haftbefehle**: bei der Person ausstellen (Kennzeichen, Auto Modell, Grund, Beweise; ausgestellt von = eigener Name). Offene Haftbefehle stehen im Tab „Haftbefehle“ und als roter Balken bei der Person. Status: offen, vollstreckt, aufgehoben. „Für Discord kopieren“ erzeugt den Text im Discord-Format: Der ausstellende Beamte wird erwähnt (pingt, über seine beim Ausstellen gespeicherte Discord-ID), der Teamtag @Präsidium-Team steht nur als Text und pingt nicht.

- **Protokoll**: Jede Änderung (Person angelegt/geändert, Strafe vergeben/erledigt/entfernt, Haftbefehl ausgestellt/vollstreckt/aufgehoben) wird mit Name, Dienstnummer und Uhrzeit gespeichert und ist im Tab „Protokoll“ durchsuchbar. Ohne Name und Dienstnummer oben kann man nichts eintragen; die API lehnt Änderungen ohne die Header `x-polis-name` und `x-polis-nr` ab.

- **Admin** (Knopf „Admin“ oben, Passwort = Secret `POLIS_KEY_ADMIN`): RP-Name und Roblox-Namen einer Person ändern (neuer Account wird bei Roblox geprüft), auch erledigte Strafen löschen, Haftbefehle löschen, Personen mit allen Einträgen löschen. Alles landet mit „(Admin)“ im Protokoll. Das Admin-Passwort gilt nur bis der Tab geschlossen wird.

- **Im Dienst** (Seite „Schicht“, für alle): Liste aller, die gerade eine Schicht laufen haben, mit Status, Startzeit und laufender Zeit sowie Schild **Polizei** oder **SEK**. SEK ist, wer eine SEK-Rolle (S1–S16) hat; wer eine Polizei- oder Kripo-Rolle (A1–A18, B1–B12) hat, ist Polizei (auch Kripo). Auf anderen Servern zählen nur Rollen, deren Name mit „SEK“ beginnt. Die Einheit wird bei jedem Laden aus den aktuellen Discord-Rollen bestimmt; wer Rechte verwalten darf, sieht beim Schild, welche Rolle entschieden hat.
- **Schicht** (oben „Schicht“): Schicht starten, Pause, Fortsetzen, Beenden. Jeder sieht seine eigene Zeit pro Woche (Montag bis Sonntag, deutsche Zeit) und den Stand zur Wochenquote. Das Management sieht alle Beamten, kann vergessene Schichten beenden und die Wochenquote festlegen (gilt ab der gewählten Woche, bis eine neue festgelegt wird). Code: `lib/schicht.js`.
- **Polizei-Register** (oben „Polizei-Register“): Beamte mit Dienstnummer, Rang, Status, Discord-Name, Eintritt, Ausbildungen und Notizen; bearbeiten z. B. für Ausbilder. Jeder Beamte kann nur einmal eingetragen sein (gleicher Discord-Name, gleiche Dienstnummer oder gleicher Name werden abgelehnt). Code: `lib/register.js`.
- **Grundrisse** (oben „Grundrisse“): Pläne von Gebäuden wie Bank oder Juwelier mit echten Maßen in Studs zeichnen: Räume, Wände, Türen, Fenster und Markierungen (Tresor, Kamera, Eingang …), Maße direkt eintippen, Abstände messen, als PNG speichern. Dazu ein Lauf-Rechner (Sekunden × Studs pro Sekunde). Nur mit dem Recht „Grundrisse“, das keiner Rolle automatisch gegeben wird und auf der Seite „Rechte“ zugeteilt werden muss. Code: `lib/grundriss.js`.

## Anmeldung mit Discord
Sobald die Discord-Secrets gesetzt sind, meldet man sich mit Discord an statt mit Dienstschlüssel und selbst eingetragenem Namen. Der Bot liest vom Discord-Server den **Server-Nickname** und die **Rollen**. Was welche Rolle darf, wird auf der Seite **Rechte** festgelegt (Tabelle Recht × Rolle, nur für Datenbank Admin bzw. wer das Recht „Rechte verwalten“ hat). Es gibt keine Rolle mit Sonderrechten; alles steht in der Rechte-Tabelle. Damit sich niemand aussperrt, lässt sie sich nur speichern, wenn mindestens eine Rolle „Rechte verwalten“ und „Datenbank öffnen“ hat. Solange die Tabelle nie gespeichert wurde, gelten Voreinstellungen: für die Rollen des Polizei-Discords (Polizei A1–A18, Kripo B1–B12, SEK S1–S16) nach Rollen-ID und Stufe, siehe `lib/rollen.js`; für andere Server nach Rollennamen: Zugriff, Personen, Strafen, Beschreibungen, Protokoll, Schichtzeit und Register ansehen ab A1, Haftbefehle ab A4, Gruppierungen beschreiben ab A6, Register bearbeiten für Rollen mit „Ausbilder“ im Namen; Management (Schichtzeiten aller, Wochenquote) und Admin nur Datenbank Admin. Code: `lib/rechte.js`. Im Protokoll steht der Nickname (mit Dienstnummer) und der Discord-Name. Rollen werden höchstens alle 5 Minuten neu geprüft; wer die Rolle verliert, fliegt danach raus. Code: `lib/discord.js`.

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
| GET | `/api/katalog` | Strafkatalog (öffentlich, für die Seite) |
| POST | `/api/people/:id/akte` | Strafe vergeben (`entries: [{ nr: 8 }]`, Nummer laut Katalog); Betrag und Haft kommen aus dem Katalog |
| PATCH | `/api/people/:id/akte` | `{ erledigt: true }`: alle ausstehenden Strafen erledigt |
| PATCH / DELETE | `/api/people/:id/akte/:eintrag` | `{ erledigt }` erledigen / ausstehenden Eintrag löschen |
| PUT | `/api/people/:id/kripo` | `{ aktiv, hinweis }` Kripo-Markierung setzen/entfernen (Recht „kripo_setzen“) |
| GET / POST | `/api/people/:id/haftbefehle` | Haftbefehle einer Person / neuen ausstellen (`grund` Pflicht) |
| GET | `/api/haftbefehle?status=offen` | Alle Haftbefehle (optional nach Status) |
| PATCH | `/api/haftbefehle/:id` | `status`: `offen`, `vollstreckt`, `aufgehoben` |
| GET | `/api/log?limit=200&person=P-1001` | Protokoll (optional nur eine Person) |
| GET | `/api/admin` | Admin-Passwort prüfen (Header `x-polis-admin`) |
| PATCH | `/api/people/:id` mit `gruppe` / `gruppeRang` / `beschreibung` | Beschreibung ändern (alle Beamten) |
| PATCH | `/api/people/:id` mit `name` / `roblox` | Person bearbeiten (Admin) |
| DELETE | `/api/people/:id` | Person mit allen Einträgen löschen (Admin) |
| DELETE | `/api/haftbefehle/:id` | Haftbefehl löschen (Admin) |
| GET | `/api/gruppen` | Alle Gruppierungen mit Mitgliederzahl |
| GET / PUT | `/api/gruppen/:name` | Beschreibung und Mitglieder / Beschreibung ändern (ab A6) |
| GET / POST | `/api/schicht` | Eigene Schicht und Woche (`?woche=YYYY-MM-DD`) / `{ aktion: start, pause, weiter, ende }` |
| GET | `/api/schicht/aktiv` | Wer gerade im Dienst ist, mit Einheit (für alle) |
| GET | `/api/schicht/uebersicht` | Alle Beamten der Woche (Management) |
| POST | `/api/schicht/beenden/:id` | Fremde Schicht beenden (Management) |
| PUT | `/api/schicht/quote` | `{ woche, stunden }` Wochenquote festlegen |
| GET / POST | `/api/beamte` | Polizei-Register lesen / Beamten eintragen |
| GET / POST | `/api/grundrisse` | Grundrisse auflisten / neuen anlegen (Recht „Grundrisse“) |
| GET / PUT / DELETE | `/api/grundrisse/:id` | Grundriss lesen / speichern / löschen |
| PUT / DELETE | `/api/beamte/:id` | Eintrag ändern / entfernen |
| GET / PUT | `/api/rechte` | Rechtetabelle lesen / speichern (`{ matrix: { recht: [rollenIds] } }`) |
| GET | `/api/roblox/suche?q=` | Roblox-Accounts für die Vorschläge, mit Avatar und ob schon erfasst |
| GET | `/api/roblox/:name` | Roblox-Account nachschlagen |
| GET | `/api/avatar/:robloxId` | Weiterleitung auf das Roblox-Avatarbild |

## Hinweis
Dies ist ein **inoffizielles Roleplay-Tool**. Es hat keine Verbindung zur echten Polizei Berlin und enthält keine realen Personendaten. Alle Namen und Einträge sind fiktiv.
