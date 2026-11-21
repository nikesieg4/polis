# Arbeitsregeln für dieses Repo

- Änderungen direkt auf `main` committen und pushen, ohne Pull Request und ohne vorher nachzufragen.
- Die Seite ist statisch (`index.html`, `style.css`, `app.js`), die API liegt in `functions/api/`, die Discord-Anmeldung in `lib/discord.js`, Rechte in `lib/rechte.js` (Rollen-IDs und Vorschläge in `lib/rollen.js`), Schichtzeit in `lib/schicht.js`, Polizei-Register in `lib/register.js`. Läuft als Cloudflare Worker (`wrangler.jsonc`, `worker.js`, D1-Binding `DB`, Secret `POLIS_KEY`). Kein eigener Build-Schritt; neue Nicht-Website-Dateien in `.assetsignore` eintragen.
- Oberfläche und Texte auf Deutsch.
- Bei jeder Änderung an `style.css` oder `app.js` die Versionsnummer `?v=N` in `index.html` um 1 erhöhen, damit Browser nicht die alte Datei aus dem Cache nehmen.
