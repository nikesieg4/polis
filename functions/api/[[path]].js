/*
 * POLIS API – Cloudflare Pages Function mit D1.
 *
 * Benötigt in den Cloudflare-Pages-Einstellungen:
 *   - D1-Binding mit dem Variablennamen  DB
 *   - Umgebungsvariable (verschlüsselt)  POLIS_KEY  = Dienstschlüssel für alle Beamten
 * Die Tabellen werden beim ersten Aufruf automatisch angelegt.
 */

const STATUSES = ['Sauber', 'Bewährung', 'Fahndung'];

// Strafgesetzbuch: Spannen [min, max]. Muss zu KATALOG in app.js passen.
const KATALOG = {
  '§ 1': { name: 'Körperverletzung', geld: [2000, 5000], haft: [10, 20] },
  '§ 2': { name: 'Versuchter / Vollendeter Totschlag / Mord', geld: [15000, 30000], haft: [30, 60] },
  '§ 3': { name: 'Geiselnahme / Entführung', geld: [10000, 20000], haft: [25, 45] },
  '§ 4': { name: 'Widerstand gegen Vollstreckungsbeamte', geld: [3000, 7000], haft: [15, 25] },
  '§ 5': { name: 'Amtsanmaßung', geld: [5000, 10000], haft: [15, 30] },
  '§ 6': { name: 'Bestechung / Korruption', geld: [8000, 15000], haft: [20, 35] },
  '§ 7': { name: 'Diebstahl & Raub', geld: [4000, 10000], haft: [15, 30] },
  '§ 8': { name: 'Laden- & Bankraub', geld: [12000, 25000], haft: [30, 50] },
  '§ 9': { name: 'Drogenbesitz & -handel', geld: [3000, 12000], haft: [10, 30] },
  '§ 10': { name: 'Verstoß gegen das Waffengesetz', geld: [6000, 15000], haft: [20, 40] }
};
function clampTo(v, r) { v = Math.round(Number(v)); if (!Number.isFinite(v)) v = r[0]; return Math.min(r[1], Math.max(r[0], v)); }
const HANDLE_RE = /^[A-Za-z0-9_.]{3,20}$/;
let schemaReady = false;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS people (
     num INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     roblox TEXT NOT NULL UNIQUE COLLATE NOCASE,
     roblox_id INTEGER,
     status TEXT NOT NULL DEFAULT 'Sauber',
     danger INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     created_by TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS akte (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     person_num INTEGER NOT NULL REFERENCES people(num),
     delikt TEXT NOT NULL,
     geld INTEGER NOT NULL DEFAULT 0,
     haft INTEGER NOT NULL DEFAULT 0,
     datum TEXT NOT NULL,
     beamter TEXT,
     created_at INTEGER NOT NULL,
     erledigt INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS akte_person ON akte(person_num)`,
  `CREATE TABLE IF NOT EXISTS haftbefehle (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     person_num INTEGER NOT NULL REFERENCES people(num),
     kennzeichen TEXT,
     modell TEXT,
     grund TEXT NOT NULL,
     beweise TEXT,
     ausgestellt_von TEXT,
     created_at INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'offen',
     closed_at INTEGER,
     closed_by TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS hb_person ON haftbefehle(person_num)`,
  `CREATE INDEX IF NOT EXISTS hb_status ON haftbefehle(status)`
];
const HB_STATUS = ['offen', 'vollstreckt', 'aufgehoben'];
function hbOut(r) {
  return {
    id: r.id,
    personId: 'P-' + (1000 + r.person_num),
    name: r.name,
    roblox: r.roblox,
    robloxId: r.roblox_id,
    kennzeichen: r.kennzeichen || '',
    modell: r.modell || '',
    grund: r.grund,
    beweise: r.beweise || '',
    ausgestelltVon: r.ausgestellt_von || '',
    createdAt: r.created_at,
    status: r.status,
    closedAt: r.closed_at,
    closedBy: r.closed_by || ''
  };
}
const HB_SELECT = `SELECT h.*, p.name, p.roblox, p.roblox_id FROM haftbefehle h JOIN people p ON p.num = h.person_num`;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }
  });
}
const fail = (status, error) => json({ error }, status);

function personOut(r) {
  return {
    id: 'P-' + (1000 + r.num),
    num: r.num,
    name: r.name,
    roblox: r.roblox,
    robloxId: r.roblox_id,
    status: r.status,
    danger: !!r.danger,
    count: r.count || 0,
    offen: r.offen || 0,
    haftbefehle: r.hb || 0
  };
}
function parseId(id) {
  const m = /^P-(\d+)$/.exec(id || '');
  return m ? Number(m[1]) - 1000 : null;
}
function clean(s, max) { return String(s == null ? '' : s).trim().slice(0, max); }

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  // Ältere Datenbanken: Spalte „erledigt“ nachrüsten
  try { await db.prepare('ALTER TABLE akte ADD COLUMN erledigt INTEGER NOT NULL DEFAULT 0').run(); } catch { /* existiert schon */ }
  schemaReady = true;
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function robloxLookup(handle) {
  const r = await fetch('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usernames: [handle], excludeBannedUsers: false })
  });
  if (!r.ok) throw new Error('roblox ' + r.status);
  const d = await r.json();
  const u = d.data && d.data[0];
  return u ? { id: u.id, name: u.name, displayName: u.displayName } : null;
}

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const parts = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  const method = request.method;
  const route = parts.join('/');

  // --- Öffentlich: Status ---
  if (route === 'health') {
    return json({ ok: true, db: !!env.DB, keySet: !!env.POLIS_KEY });
  }

  // --- Öffentlich: Avatarbild (nur Weiterleitung auf Roblox-CDN) ---
  if (parts[0] === 'avatar' && parts.length === 2 && method === 'GET') {
    const uid = Number(parts[1]);
    if (!Number.isInteger(uid) || uid <= 0) return fail(400, 'Ungültige ID');
    try {
      const r = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${uid}&size=150x150&format=Png&isCircular=false`);
      const d = await r.json();
      const url = d.data && d.data[0] && d.data[0].imageUrl;
      if (!url) return fail(404, 'Kein Avatar');
      return new Response(null, { status: 302, headers: { location: url, 'cache-control': 'public, max-age=3600' } });
    } catch {
      return fail(502, 'Roblox nicht erreichbar');
    }
  }

  // --- Ab hier: Dienstschlüssel nötig ---
  if (!env.DB) return fail(503, 'Datenbank nicht verbunden (D1-Binding „DB“ fehlt).');
  if (!env.POLIS_KEY) return fail(503, 'Dienstschlüssel nicht eingerichtet (Variable „POLIS_KEY“ fehlt).');
  if (!safeEqual(request.headers.get('x-polis-key') || '', env.POLIS_KEY)) return fail(401, 'Falscher Dienstschlüssel.');

  const db = env.DB;
  await ensureSchema(db);

  // GET /api/auth – Schlüssel prüfen
  if (route === 'auth') return json({ ok: true });

  // GET /api/roblox/:name
  if (parts[0] === 'roblox' && parts.length === 2 && method === 'GET') {
    if (!HANDLE_RE.test(parts[1])) return fail(400, 'Ungültiger Roblox-Name.');
    try {
      const u = await robloxLookup(parts[1]);
      return u ? json({ exists: true, ...u }) : json({ exists: false });
    } catch {
      return fail(502, 'Roblox ist gerade nicht erreichbar.');
    }
  }

  // GET /api/haftbefehle?status=offen
  if (parts[0] === 'haftbefehle' && parts.length === 1 && method === 'GET') {
    const st = new URL(request.url).searchParams.get('status');
    const q = HB_STATUS.includes(st)
      ? db.prepare(HB_SELECT + ' WHERE h.status = ? ORDER BY h.id DESC LIMIT 200').bind(st)
      : db.prepare(HB_SELECT + ' ORDER BY h.id DESC LIMIT 200');
    const { results } = await q.all();
    return json({ haftbefehle: results.map(hbOut) });
  }

  // PATCH /api/haftbefehle/:id  { status: 'vollstreckt' | 'aufgehoben' | 'offen', beamter }
  if (parts[0] === 'haftbefehle' && parts.length === 2 && method === 'PATCH') {
    const hid = Number(parts[1]);
    const b = await readBody(request);
    if (!Number.isInteger(hid) || !HB_STATUS.includes(b.status)) return fail(400, 'Ungültiger Status.');
    const closed = b.status === 'offen' ? [null, null] : [Date.now(), clean(b.beamter, 60) || 'Unbekannt'];
    const row = await db.prepare('UPDATE haftbefehle SET status = ?, closed_at = ?, closed_by = ? WHERE id = ? RETURNING id')
      .bind(b.status, closed[0], closed[1], hid).first();
    if (!row) return fail(404, 'Haftbefehl nicht gefunden.');
    const full = await db.prepare(HB_SELECT + ' WHERE h.id = ?').bind(hid).first();
    return json({ haftbefehl: hbOut(full) });
  }

  // /api/people
  if (parts[0] === 'people') {
    // GET /api/people
    if (parts.length === 1 && method === 'GET') {
      const { results } = await db.prepare(
        `SELECT p.*,
                (SELECT COUNT(*) FROM akte a WHERE a.person_num = p.num) AS count,
                (SELECT COUNT(*) FROM akte a WHERE a.person_num = p.num AND a.erledigt = 0) AS offen,
                (SELECT COUNT(*) FROM haftbefehle h WHERE h.person_num = p.num AND h.status = 'offen') AS hb
           FROM people p ORDER BY p.num DESC`
      ).all();
      return json({ people: results.map(personOut) });
    }

    // POST /api/people  { roblox, name, beamter }
    if (parts.length === 1 && method === 'POST') {
      const b = await readBody(request);
      const handle = clean(b.roblox, 30).replace(/^@+/, '');
      if (!HANDLE_RE.test(handle)) return fail(400, 'Ungültiger Roblox-Name.');
      const existing = await db.prepare('SELECT * FROM people WHERE roblox = ?').bind(handle).first();
      if (existing) return json({ person: personOut(existing), existed: true });
      let u;
      try { u = await robloxLookup(handle); } catch { return fail(502, 'Roblox ist gerade nicht erreichbar.'); }
      if (!u) return fail(404, `Es gibt keinen Roblox-Account „@${handle}“.`);
      const dupe = await db.prepare('SELECT * FROM people WHERE roblox = ? OR roblox_id = ?').bind(u.name, u.id).first();
      if (dupe) return json({ person: personOut(dupe), existed: true });
      const name = clean(b.name, 60) || u.displayName || u.name;
      const row = await db.prepare(
        `INSERT INTO people (name, roblox, roblox_id, status, danger, created_at, created_by)
         VALUES (?, ?, ?, 'Sauber', 0, ?, ?) RETURNING *`
      ).bind(name, u.name, u.id, Date.now(), clean(b.beamter, 60)).first();
      return json({ person: personOut(row) }, 201);
    }

    const num = parseId(parts[1]);
    if (num == null) return fail(404, 'Person nicht gefunden.');
    const person = await db.prepare('SELECT * FROM people WHERE num = ?').bind(num).first();
    if (!person) return fail(404, 'Person nicht gefunden.');

    // PATCH /api/people/:id  { status?, danger?, name? }
    if (parts.length === 2 && method === 'PATCH') {
      const b = await readBody(request);
      const status = STATUSES.includes(b.status) ? b.status : person.status;
      const danger = typeof b.danger === 'boolean' ? (b.danger ? 1 : 0) : person.danger;
      const name = b.name != null && clean(b.name, 60) ? clean(b.name, 60) : person.name;
      const row = await db.prepare('UPDATE people SET status = ?, danger = ?, name = ? WHERE num = ? RETURNING *')
        .bind(status, danger, name, num).first();
      return json({ person: personOut(row) });
    }

    // GET /api/people/:id/haftbefehle
    if (parts.length === 3 && parts[2] === 'haftbefehle' && method === 'GET') {
      const { results } = await db.prepare(HB_SELECT + ' WHERE h.person_num = ? ORDER BY h.id DESC').bind(num).all();
      return json({ haftbefehle: results.map(hbOut) });
    }

    // POST /api/people/:id/haftbefehle  { kennzeichen, modell, grund, beweise, beamter }
    if (parts.length === 3 && parts[2] === 'haftbefehle' && method === 'POST') {
      const b = await readBody(request);
      const grund = clean(b.grund, 200);
      if (!grund) return fail(400, 'Grund fehlt.');
      const ins = await db.prepare(
        `INSERT INTO haftbefehle (person_num, kennzeichen, modell, grund, beweise, ausgestellt_von, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'offen') RETURNING id`
      ).bind(num, clean(b.kennzeichen, 20), clean(b.modell, 60), grund, clean(b.beweise, 500), clean(b.beamter, 100) || 'Unbekannt', Date.now()).first();
      const full = await db.prepare(HB_SELECT + ' WHERE h.id = ?').bind(ins.id).first();
      return json({ haftbefehl: hbOut(full) }, 201);
    }

    // GET /api/people/:id/akte
    if (parts.length === 3 && parts[2] === 'akte' && method === 'GET') {
      const { results } = await db.prepare(
        'SELECT id, delikt, geld, haft, datum, beamter, erledigt FROM akte WHERE person_num = ? ORDER BY id DESC'
      ).bind(num).all();
      return json({ akte: results });
    }

    // POST /api/people/:id/akte  { entries: [{delikt, geld, haft}], beamter, datum }
    if (parts.length === 3 && parts[2] === 'akte' && method === 'POST') {
      const b = await readBody(request);
      const entries = Array.isArray(b.entries) ? b.entries.slice(0, 30) : [];
      if (!entries.length) return fail(400, 'Keine Delikte ausgewählt.');
      const datum = clean(b.datum, 20) || new Date().toISOString().slice(0, 10);
      const beamter = clean(b.beamter, 60) || 'Unbekannt';
      const now = Date.now();
      const rows = [];
      for (const e of entries) {
        const para = clean(e.para, 6);
        const k = KATALOG[para];
        if (!k) return fail(400, 'Unbekannter Paragraph.');
        rows.push([para + ' ' + k.name, clampTo(e.geld ?? k.geld[0], k.geld), clampTo(e.haft ?? k.haft[0], k.haft)]);
      }
      const stmts = rows.map(([delikt, geld, haft]) => db.prepare(
        'INSERT INTO akte (person_num, delikt, geld, haft, datum, beamter, created_at, erledigt) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
      ).bind(num, delikt, geld, haft, datum, beamter, now));
      await db.batch(stmts);
      return json({ ok: true, added: stmts.length }, 201);
    }

    // PATCH /api/people/:id/akte  { erledigt: true } – alle offenen Strafen erledigt
    if (parts.length === 3 && parts[2] === 'akte' && method === 'PATCH') {
      const b = await readBody(request);
      if (b.erledigt !== true) return fail(400, 'Nur „erledigt: true“ möglich.');
      const r = await db.prepare('UPDATE akte SET erledigt = 1 WHERE person_num = ? AND erledigt = 0').bind(num).run();
      return json({ ok: true, changed: r.meta ? r.meta.changes : null });
    }

    // /api/people/:id/akte/:eintrag
    if (parts.length === 4 && parts[2] === 'akte') {
      const eid = Number(parts[3]);
      if (!Number.isInteger(eid)) return fail(404, 'Eintrag nicht gefunden.');
      const row = await db.prepare('SELECT * FROM akte WHERE id = ? AND person_num = ?').bind(eid, num).first();
      if (!row) return fail(404, 'Eintrag nicht gefunden.');
      // PATCH { erledigt: bool }
      if (method === 'PATCH') {
        const b = await readBody(request);
        if (typeof b.erledigt !== 'boolean') return fail(400, 'Feld „erledigt“ fehlt.');
        await db.prepare('UPDATE akte SET erledigt = ? WHERE id = ?').bind(b.erledigt ? 1 : 0, eid).run();
        return json({ ok: true });
      }
      // DELETE – nur offene Einträge (z. B. Fehlklick)
      if (method === 'DELETE') {
        if (row.erledigt) return fail(409, 'Erledigte Einträge können nicht gelöscht werden.');
        await db.prepare('DELETE FROM akte WHERE id = ?').bind(eid).run();
        return json({ ok: true });
      }
    }
  }

  return fail(404, 'Unbekannter Endpunkt.');
}
