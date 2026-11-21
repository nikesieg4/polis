/*
 * Schichtzeit: starten, Pause, weiter, beenden. Wochen laufen Montag 0:00 bis Sonntag 24:00 (Europe/Berlin).
 * Eine Schicht zählt zu der Woche, in der sie begonnen hat.
 * Rechte: „schicht“ (eigene Zeit), „schicht_alle“ (alle sehen, fremde Schicht beenden), „quote“ (Wochenquote).
 */

export const SCHICHT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS schichten (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     uid TEXT NOT NULL,
     name TEXT,
     start_ts INTEGER NOT NULL,
     end_ts INTEGER,
     pause_ms INTEGER NOT NULL DEFAULT 0,
     pause_start INTEGER,
     status TEXT NOT NULL DEFAULT 'aktiv'
   )`,
  `CREATE INDEX IF NOT EXISTS schicht_uid ON schichten(uid, start_ts)`,
  `CREATE INDEX IF NOT EXISTS schicht_start ON schichten(start_ts)`,
  `CREATE TABLE IF NOT EXISTS quoten (woche TEXT PRIMARY KEY, minuten INTEGER NOT NULL, gesetzt_von TEXT, gesetzt_am INTEGER)`
];
// Einheit (Polizei/SEK) der Schicht, für ältere Datenbanken nachgerüstet
export const SCHICHT_MIGRATIONS = ['ALTER TABLE schichten ADD COLUMN einheit TEXT'];

// ---------- Wochen in deutscher Zeit ----------
const TZ = 'Europe/Berlin';
const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
});
function tzOffset(ts) {
  const p = {};
  fmt.formatToParts(new Date(ts)).forEach((x) => { p[x.type] = x.value; });
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000;
}
const DAY = 864e5;
export function weekOf(ts) {
  const d = new Date(ts + tzOffset(ts));
  const mon = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  const next = mon + 7 * DAY;
  return {
    key: new Date(mon).toISOString().slice(0, 10),
    start: mon - tzOffset(mon),
    end: next - tzOffset(next),
    prev: new Date(mon - 7 * DAY).toISOString().slice(0, 10),
    next: new Date(next).toISOString().slice(0, 10)
  };
}
function weekFromKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key || '')) return weekOf(Date.now());
  const t = Date.parse(key + 'T12:00:00Z');
  return Number.isFinite(t) ? weekOf(t) : weekOf(Date.now());
}

function dauer(r, now) {
  const end = r.end_ts || now;
  const pause = (r.pause_ms || 0) + (r.status === 'pause' && r.pause_start ? end - r.pause_start : 0);
  return Math.max(0, end - r.start_ts - pause);
}
function out(r, now) {
  return r ? { id: r.id, name: r.name, start: r.start_ts, ende: r.end_ts, status: r.status, pauseMs: r.pause_ms || 0,
    pauseStart: r.pause_start, dauerMs: dauer(r, now) } : null;
}
async function quoteFor(db, key) {
  const q = await db.prepare('SELECT minuten, woche FROM quoten WHERE woche <= ? ORDER BY woche DESC LIMIT 1').bind(key).first();
  return q ? q.minuten : 0;
}

export async function handleSchicht(c) {
  const { method, parts, db, can, uid, officer, beamter, json, fail, readBody, logIt, url, einheit } = c;
  const now = Date.now();
  const woche = weekFromKey(url.searchParams.get('woche'));

  // GET /api/schicht – eigene Schicht und Woche
  if (parts.length === 1 && method === 'GET') {
    if (!can('schicht')) return fail(403, 'Du darfst keine Schichtzeit erfassen.');
    const aktiv = await db.prepare("SELECT * FROM schichten WHERE uid = ? AND status != 'beendet' ORDER BY id DESC LIMIT 1").bind(uid).first();
    const { results } = await db.prepare('SELECT * FROM schichten WHERE uid = ? AND start_ts >= ? AND start_ts < ? ORDER BY start_ts DESC')
      .bind(uid, woche.start, woche.end).all();
    return json({
      jetzt: now, woche, aktiv: out(aktiv, now), quoteMin: await quoteFor(db, woche.key),
      summeMs: results.reduce((a, r) => a + dauer(r, now), 0), schichten: results.map((r) => out(r, now))
    });
  }

  // POST /api/schicht  { aktion: 'start' | 'pause' | 'weiter' | 'ende' }
  if (parts.length === 1 && method === 'POST') {
    if (!can('schicht')) return fail(403, 'Du darfst keine Schichtzeit erfassen.');
    const b = await readBody(request(c));
    const aktiv = await db.prepare("SELECT * FROM schichten WHERE uid = ? AND status != 'beendet' ORDER BY id DESC LIMIT 1").bind(uid).first();
    if (b.aktion === 'start') {
      if (aktiv) return fail(409, 'Du bist schon im Dienst.');
      await db.prepare("INSERT INTO schichten (uid, name, start_ts, status, einheit) VALUES (?, ?, ?, 'aktiv', ?)").bind(uid, beamter, now, einheit || 'Polizei').run();
    } else if (!aktiv) {
      return fail(409, 'Keine laufende Schicht.');
    } else if (b.aktion === 'pause') {
      if (aktiv.status !== 'aktiv') return fail(409, 'Schicht ist schon pausiert.');
      await db.prepare("UPDATE schichten SET status = 'pause', pause_start = ? WHERE id = ?").bind(now, aktiv.id).run();
    } else if (b.aktion === 'weiter') {
      if (aktiv.status !== 'pause') return fail(409, 'Schicht ist nicht pausiert.');
      await db.prepare("UPDATE schichten SET status = 'aktiv', pause_ms = pause_ms + ?, pause_start = NULL WHERE id = ?")
        .bind(now - aktiv.pause_start, aktiv.id).run();
    } else if (b.aktion === 'ende') {
      const extra = aktiv.status === 'pause' && aktiv.pause_start ? now - aktiv.pause_start : 0;
      await db.prepare("UPDATE schichten SET status = 'beendet', end_ts = ?, pause_ms = pause_ms + ?, pause_start = NULL WHERE id = ?")
        .bind(now, extra, aktiv.id).run();
    } else {
      return fail(400, 'Unbekannte Aktion.');
    }
    return json({ ok: true });
  }

  // GET /api/schicht/aktiv – wer gerade im Dienst ist (für alle Beamten)
  if (parts[1] === 'aktiv' && method === 'GET') {
    const { results } = await db.prepare("SELECT * FROM schichten WHERE status != 'beendet' ORDER BY start_ts").all();
    return json({ jetzt: now, imDienst: results.map((r) => ({ name: r.name, einheit: r.einheit || 'Polizei', status: r.status,
      start: r.start_ts, dauerMs: dauer(r, now), ich: r.uid === uid })) });
  }

  // GET /api/schicht/uebersicht?woche=YYYY-MM-DD – alle Beamten (Management)
  if (parts[1] === 'uebersicht' && method === 'GET') {
    if (!can('schicht_alle')) return fail(403, 'Die Schichtzeit anderer sieht nur das Management.');
    const { results } = await db.prepare('SELECT * FROM schichten WHERE start_ts >= ? AND start_ts < ?').bind(woche.start, woche.end).all();
    const { results: alle } = await db.prepare(
      'SELECT s.uid, s.name FROM schichten s JOIN (SELECT uid, MAX(id) AS id FROM schichten GROUP BY uid) l ON l.id = s.id'
    ).all();
    const { results: laufend } = await db.prepare("SELECT * FROM schichten WHERE status != 'beendet'").all();
    const map = {};
    for (const a of alle) map[a.uid] = { uid: a.uid, name: a.name, summeMs: 0, anzahl: 0, aktiv: null };
    for (const r of results) {
      const m = map[r.uid] || (map[r.uid] = { uid: r.uid, name: r.name, summeMs: 0, anzahl: 0, aktiv: null });
      m.summeMs += dauer(r, now); m.anzahl++;
    }
    for (const r of laufend) if (map[r.uid]) map[r.uid].aktiv = out(r, now);
    const liste = Object.values(map).sort((a, b) => b.summeMs - a.summeMs || String(a.name).localeCompare(String(b.name)));
    return json({ jetzt: now, woche, quoteMin: await quoteFor(db, woche.key), beamte: liste });
  }

  // POST /api/schicht/beenden/:id – vergessene Schicht eines anderen beenden (Management)
  if (parts[1] === 'beenden' && parts.length === 3 && method === 'POST') {
    if (!can('schicht_alle')) return fail(403, 'Nur das Management kann fremde Schichten beenden.');
    const r = await db.prepare("SELECT * FROM schichten WHERE id = ? AND status != 'beendet'").bind(Number(parts[2])).first();
    if (!r) return fail(404, 'Keine laufende Schicht gefunden.');
    const extra = r.status === 'pause' && r.pause_start ? now - r.pause_start : 0;
    await db.batch([
      db.prepare("UPDATE schichten SET status = 'beendet', end_ts = ?, pause_ms = pause_ms + ?, pause_start = NULL WHERE id = ?").bind(now, extra, r.id),
      logIt('Schicht beendet (Management)', null, r.name)
    ]);
    return json({ ok: true });
  }

  // PUT /api/schicht/quote  { woche, stunden }  – gilt ab dieser Woche, bis eine neue festgelegt wird
  if (parts[1] === 'quote' && method === 'PUT') {
    if (!can('quote')) return fail(403, 'Die Wochenquote legt nur das Management fest.');
    const b = await readBody(request(c));
    const w = weekFromKey(b.woche);
    const minuten = Math.round(Number(b.stunden) * 60);
    if (!Number.isFinite(minuten) || minuten < 0 || minuten > 168 * 60) return fail(400, 'Ungültige Stundenzahl.');
    await db.batch([
      db.prepare(`INSERT INTO quoten (woche, minuten, gesetzt_von, gesetzt_am) VALUES (?, ?, ?, ?)
                  ON CONFLICT(woche) DO UPDATE SET minuten = excluded.minuten, gesetzt_von = excluded.gesetzt_von, gesetzt_am = excluded.gesetzt_am`)
        .bind(w.key, minuten, beamter, now),
      logIt('Wochenquote festgelegt', null, 'Ab Woche ' + w.key.split('-').reverse().join('.') + ': ' + (minuten / 60).toLocaleString('de-DE') + ' Stunden')
    ]);
    return json({ ok: true });
  }
  return null;
}
function request(c) { return c.request; }
