/*
 * Grundrisse: Pläne von Gebäuden (Bank, Juwelier …) mit Maßen in Studs.
 * Recht: „grundrisse“ (ansehen, zeichnen, löschen). Es wird keiner Rolle vorgeschlagen,
 * sondern muss auf der Seite „Rechte“ ausdrücklich zugeteilt werden.
 *
 * Ein Plan wird als Ganzes gespeichert (Spalte „daten“, JSON):
 *   { elemente: [ { t: 'raum',  x, y, w, h, name },
 *                 { t: 'wand' | 'tuer' | 'fenster', x1, y1, x2, y2 },
 *                 { t: 'punkt', x, y, art, name },
 *                 { t: 'moebel', art: 'Stuhl' | 'Schrank', x, y, r: 0 | 90 | 180 | 270 } ] }
 * Möbel haben feste Größen (MOEBEL); bei 90° und 270° sind Breite und Tiefe vertauscht.
 * Alle Werte in Studs. Gegen gleichzeitiges Überschreiben schickt der Client den Stand mit,
 * den er geladen hat; ist der Plan inzwischen geändert worden, gibt es 409.
 */

export const GRUNDRISS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS grundrisse (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     notizen TEXT,
     daten TEXT NOT NULL DEFAULT '{"elemente":[]}',
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     updated_by TEXT
   )`
];

export const PUNKT_ARTEN = ['Eingang', 'Tresor', 'Kasse', 'Vitrine', 'Kamera', 'Alarm', 'Deckung', 'Treppe', 'Sonstiges'];
// Feste Möbelgrößen in Studs: Breite × Tiefe ohne Drehung
export const MOEBEL = { Stuhl: { w: 3, h: 3 }, Schrank: { w: 4, h: 2 } };
const DREHUNG = [0, 90, 180, 270];
const LINIEN = ['wand', 'tuer', 'fenster'];
const MAX_ELEMENTE = 800;
const GRENZE = 5000; // Studs vom Nullpunkt

function zahl(v) {
  const n = Math.round(Number(v) * 10) / 10; // eine Nachkommastelle reicht
  return Number.isFinite(n) ? Math.max(-GRENZE, Math.min(GRENZE, n)) : 0;
}
function text(v, max) { return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim().slice(0, max); }

// Nur bekannte Felder übernehmen, alles andere verwerfen
function pruefeElemente(liste) {
  const out = [];
  for (const e of Array.isArray(liste) ? liste.slice(0, MAX_ELEMENTE) : []) {
    if (!e || typeof e !== 'object') continue;
    if (e.t === 'raum') {
      const w = Math.abs(zahl(e.w)), h = Math.abs(zahl(e.h));
      if (w > 0 && h > 0) out.push({ t: 'raum', x: zahl(e.x), y: zahl(e.y), w, h, name: text(e.name, 60) });
    } else if (LINIEN.includes(e.t)) {
      const l = { t: e.t, x1: zahl(e.x1), y1: zahl(e.y1), x2: zahl(e.x2), y2: zahl(e.y2) };
      if (l.x1 !== l.x2 || l.y1 !== l.y2) out.push(l);
    } else if (e.t === 'moebel') {
      if (MOEBEL[e.art]) out.push({ t: 'moebel', art: e.art, x: zahl(e.x), y: zahl(e.y), r: DREHUNG.includes(Number(e.r)) ? Number(e.r) : 0 });
    } else if (e.t === 'punkt') {
      out.push({ t: 'punkt', x: zahl(e.x), y: zahl(e.y), art: PUNKT_ARTEN.includes(e.art) ? e.art : 'Sonstiges', name: text(e.name, 60) });
    }
  }
  return out;
}

function liste(r) {
  let n = 0;
  try { n = (JSON.parse(r.daten).elemente || []).length; } catch { /* leer */ }
  return { id: r.id, name: r.name, elemente: n, updatedAt: r.updated_at, updatedBy: r.updated_by || '' };
}
function voll(r) {
  let elemente = [];
  try { elemente = JSON.parse(r.daten).elemente || []; } catch { /* leer */ }
  return { ...liste(r), notizen: r.notizen || '', elemente };
}

export async function handleGrundrisse(c) {
  const { request, method, parts, db, can, beamter, json, fail, readBody, logIt, clean } = c;
  if (!can('grundrisse')) return fail(403, 'Dafür fehlt dir das Recht „Grundrisse“.');

  if (parts.length === 1 && method === 'GET') {
    const { results } = await db.prepare('SELECT id, name, daten, updated_at, updated_by FROM grundrisse ORDER BY name COLLATE NOCASE').all();
    return json({ grundrisse: results.map(liste), arten: PUNKT_ARTEN, moebel: MOEBEL });
  }

  if (parts.length === 1 && method === 'POST') {
    const b = await readBody(request);
    const name = clean(b.name, 80);
    if (!name) return fail(400, 'Name fehlt.');
    const now = Date.now();
    const row = await db.prepare(
      'INSERT INTO grundrisse (name, notizen, daten, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING *'
    ).bind(name, '', JSON.stringify({ elemente: [] }), now, now, beamter).first();
    await logIt('Grundriss angelegt', null, name).run();
    return json({ grundriss: voll(row) }, 201);
  }

  const id = Number(parts[1]);
  const old = Number.isInteger(id) ? await db.prepare('SELECT * FROM grundrisse WHERE id = ?').bind(id).first() : null;
  if (!old) return fail(404, 'Grundriss nicht gefunden.');

  if (parts.length === 2 && method === 'GET') return json({ grundriss: voll(old) });

  if (parts.length === 2 && method === 'PUT') {
    const b = await readBody(request);
    if (b.stand != null && Number(b.stand) !== old.updated_at) {
      return json({ error: 'Der Plan wurde inzwischen von ' + (old.updated_by || 'jemand anderem') + ' geändert. Lade ihn neu, bevor du speicherst.', konflikt: true }, 409);
    }
    const name = clean(b.name, 80) || old.name;
    const notizen = String(b.notizen || '').replace(/\r/g, '').trim().slice(0, 2000);
    const elemente = pruefeElemente(b.elemente);
    const row = await db.prepare(
      'UPDATE grundrisse SET name = ?, notizen = ?, daten = ?, updated_at = ?, updated_by = ? WHERE id = ? RETURNING *'
    ).bind(name, notizen, JSON.stringify({ elemente }), Date.now(), beamter, id).first();
    await logIt('Grundriss geändert', null, name + (name !== old.name ? ' (vorher ' + old.name + ')' : '')).run();
    return json({ grundriss: voll(row) });
  }

  if (parts.length === 2 && method === 'DELETE') {
    await db.batch([
      db.prepare('DELETE FROM grundrisse WHERE id = ?').bind(id),
      logIt('Grundriss gelöscht', null, old.name)
    ]);
    return json({ ok: true });
  }
  return null;
}
