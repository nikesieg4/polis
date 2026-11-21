# Arbeitsregeln für dieses Repo

- Änderungen direkt auf `main` committen und pushen, ohne Pull Request und ohne vorher nachzufragen.
- Die Seite ist statisch (`index.html`, `style.css`, `app.js`), die API liegt in `functions/api/` (Cloudflare Pages Functions + D1-Binding `DB`, Secret `POLIS_KEY`). Kein Build-Schritt einführen.
- Oberfläche und Texte auf Deutsch.
- Bei jeder Änderung an `style.css` oder `app.js` die Versionsnummer `?v=N` in `index.html` um 1 erhöhen, damit Browser nicht die alte Datei aus dem Cache nehmen.
