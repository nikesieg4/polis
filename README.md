# POLIS – Polizei-Datenbank · Berlin City Roleplay

Interne Datenbank für die Polizei-Fraktion von **Berlin City Roleplay** auf dem Roblox-Spiel *Emergency Hamburg*.

> **Testversion:** Alle Daten werden nur im Browser (localStorage) gespeichert. Jeder Beamte sieht nur seine eigenen Einträge.

## Funktionen
- **Schicht** (links): Dienstzeit starten, pausieren und beenden, mit Übersicht für heute und die Woche
- **Personensuche** (Mitte): Suche nach RP-Name, Personen-ID oder `@RobloxName`. Unbekannte Spieler lassen sich direkt erfassen.
- **Strafregister** (rechts): Einträge pro Person mit Summen für Geldstrafen und Haftzeit, neue Strafen aus dem Strafkatalog, Status und Gefährlich-Markierung
- **Geplant:** Fahrzeuge, Haftbefehle, Einsatzberichte, Lizenzen

## Hosting
Reine statische Seite (`index.html`, `style.css`, `app.js`), kein Build-Schritt.

- **GitHub Pages:** Settings → Pages → *Deploy from a branch* → `main` / `(root)`
- **Cloudflare Pages:** Workers & Pages → Create → Pages → *Connect to Git* → dieses Repo, Production branch `main`, Build command leer, Output directory `/`. Jeder Push auf `main` wird automatisch veröffentlicht.

## Hinweis
Dies ist ein **inoffizielles Roleplay-Tool**. Es hat keine Verbindung zur echten Polizei Berlin und enthält keine realen Personendaten. Alle Namen und Einträge sind fiktiv.
