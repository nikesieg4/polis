/*
 * POLIS API – Cloudflare Pages Function mit D1.
 *
 * Benötigt in den Cloudflare-Pages-Einstellungen:
 *   - D1-Binding mit dem Variablennamen  DB
 *   - Umgebungsvariable (verschlüsselt)  POLIS_KEY  = Dienstschlüssel für alle Beamten
 *   - optional (verschlüsselt)           POLIS_KEY_ADMIN = Admin-Passwort (Strafen löschen, Personen bearbeiten/löschen)
 * Die Tabellen werden beim ersten Aufruf automatisch angelegt.
 */

import { discordConfigured, discordMissing, handleAuth, requireMember, rankLimits, MEMBER_SCHEMA, MEMBER_MIGRATIONS } from '../../lib/discord.js';

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
  `CREATE INDEX IF NOT EXISTS hb_status ON haftbefehle(status)`,
  `CREATE TABLE IF NOT EXISTS log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts INTEGER NOT NULL,
     beamter_name TEXT NOT NULL,
     beamter_nr TEXT NOT NULL,
     aktion TEXT NOT NULL,
     person_num INTEGER,
     details TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS log_person ON log(person_num)`,
  MEMBER_SCHEMA,
  `CREATE TABLE IF NOT EXISTS gruppen (
     name TEXT PRIMARY KEY COLLATE NOCASE,
     beschreibung TEXT,
     updated_at INTEGER,
     updated_by TEXT
   )`
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
    haftbefehle: r.hb || 0,
    gruppe: r.gruppe || '',
    gruppeRang: r.gruppe_rang || '',
    beschreibung: r.beschreibung || ''
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
  for (const c of ['gruppe TEXT', 'gruppe_rang TEXT', 'beschreibung TEXT']) {
    try { await db.prepare('ALTER TABLE people ADD COLUMN ' + c).run(); } catch { /* existiert schon */ }
  }
  for (const m of MEMBER_MIGRATIONS) { try { await db.prepare(m).run(); } catch { /* existiert schon */ } }
  schemaReady = true;
}

// Passwort aus dem Header mit dem Secret vergleichen. Der Client schickt URL-kodiert,
// damit Umlaute (ä, ö, ü, ß, €) heil ankommen; Leerzeichen am Rand zählen nicht.
function keyMatches(headerValue, secret) {
  if (!secret || !headerValue) return false;
  const want = String(secret).trim().normalize('NFC');
  let got = headerValue;
  try { got = decodeURIComponent(headerValue); } catch { /* alter Client: unkodiert */ }
  got = got.trim().normalize('NFC');
  return safeEqual(got, want) || safeEqual(headerValue.trim(), want);
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
    const discord = discordConfigured(env);
    return json({ ok: true, db: !!env.DB, auth: discord ? 'discord' : 'key', keySet: discord || !!env.POLIS_KEY,
      // Testphase: solange POLIS_KEY gesetzt ist, geht auch die Anmeldung ohne Discord
      keyLogin: discord && !!env.POLIS_KEY, adminSet: !!env.POLIS_KEY_ADMIN,
      discordMissing: discordMissing(env) });
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

  if (!env.DB) return fail(503, 'Datenbank nicht verbunden (D1-Binding „DB“ fehlt).');
  const db = env.DB;
  await ensureSchema(db);

  let isAdmin, officer, canHb = true, canGruppe = true;
  // Ohne Discord anmelden (Testphase): nur wenn POLIS_KEY noch existiert und der Client ihn mitschickt
  const viaKey = !!env.POLIS_KEY && !!request.headers.get('x-polis-key');
  if (discordConfigured(env) && !viaKey) {
    // --- Anmeldung über Discord: Name und Rollen kommen vom Discord-Server ---
    if (parts[0] === 'auth') {
      const r = await handleAuth(request, env, db, parts);
      if (r) return r;
    }
    const auth = await requireMember(request, env, db);
    if (auth.error) return auth.error;
    // Schutz gegen fremde Seiten, die mit dem Cookie Änderungen auslösen wollen
    if (method !== 'GET' && request.headers.get('x-polis') !== '1') return fail(403, 'Ungültige Anfrage.');
    isAdmin = !!auth.member.admin;
    canHb = isAdmin || (auth.member.rang || 0) >= rankLimits(env).hb;
    canGruppe = isAdmin || (auth.member.rang || 0) >= rankLimits(env).gruppe;
    officer = { name: auth.member.name || auth.member.username, nr: '@' + auth.member.username };
    if (route === 'me') {
      return json({ name: officer.name, username: auth.member.username, avatar: auth.member.avatar, admin: isAdmin,
        rang: auth.member.rang || 0, canHb, hbMinRank: rankLimits(env).hb, canGruppe, gruppeMinRank: rankLimits(env).gruppe });
    }
  } else {
    // --- Alter Weg: gemeinsamer Dienstschlüssel, Name und Dienstnummer selbst eingetragen ---
    if (!env.POLIS_KEY) return fail(503, 'Dienstschlüssel nicht eingerichtet (Variable „POLIS_KEY“ fehlt).');
    if (!keyMatches(request.headers.get('x-polis-key'), env.POLIS_KEY)) return fail(401, 'Falscher Dienstschlüssel.');
    isAdmin = keyMatches(request.headers.get('x-polis-admin'), env.POLIS_KEY_ADMIN);
    if (route === 'auth') return json({ ok: true });
    const dec = (h) => { try { return clean(decodeURIComponent(request.headers.get(h) || ''), 60); } catch { return ''; } };
    officer = { name: dec('x-polis-name'), nr: dec('x-polis-nr').slice(0, 20) };
    if (method !== 'GET' && (!officer.name || !officer.nr)) {
      return fail(403, 'Bitte oben Name und Dienstnummer eintragen.');
    }
    // Im Protokoll erkennbar machen, dass der Name nicht von Discord geprüft ist
    if (discordConfigured(env)) officer.nr += ', ohne Discord';
  }
  const needHb = () => fail(403, 'Haftbefehle bearbeiten darf man erst ab A' + rankLimits(env).hb + '.');
  const needAdmin = () => fail(403, discordConfigured(env) && !viaKey ? 'Dafür brauchst du die Admin-Rolle auf dem Discord-Server.' : 'Dafür ist das Admin-Passwort nötig.');
  const beamter = officer.name + ' (' + officer.nr + ')';
  const logIt = (aktion, personNum, details) => db.prepare(
    'INSERT INTO log (ts, beamter_name, beamter_nr, aktion, person_num, details) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(Date.now(), officer.name, officer.nr, aktion, personNum ?? null, clean(details, 300) || null);

  // GET /api/admin – Admin-Passwort prüfen
  if (route === 'admin' && method === 'GET') {
    if (!env.POLIS_KEY_ADMIN) return fail(503, 'Admin-Passwort ist auf dem Server nicht eingerichtet (POLIS_KEY_ADMIN).');
    return isAdmin ? json({ ok: true }) : fail(401, 'Falsches Admin-Passwort.');
  }

  // GET /api/log?limit=200&person=P-1001
  if (route === 'log' && method === 'GET') {
    const sp = new URL(request.url).searchParams;
    const limit = Math.min(500, Math.max(1, Number(sp.get('limit')) || 200));
    const pnum = parseId(sp.get('person'));
    const base = `SELECT l.*, p.name AS p_name, p.roblox AS p_roblox FROM log l LEFT JOIN people p ON p.num = l.person_num`;
    const q = pnum != null
      ? db.prepare(base + ' WHERE l.person_num = ? ORDER BY l.id DESC LIMIT ?').bind(pnum, limit)
      : db.prepare(base + ' ORDER BY l.id DESC LIMIT ?').bind(limit);
    const { results } = await q.all();
    return json({ log: results.map((r) => ({
      id: r.id, ts: r.ts, name: r.beamter_name, nr: r.beamter_nr, aktion: r.aktion, details: r.details || '',
      personId: r.person_num != null ? 'P-' + (1000 + r.person_num) : null, personName: r.p_name || '', roblox: r.p_roblox || ''
    })) });
  }

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

  // ---------- Gruppierungen ----------
  // GET /api/gruppen – alle Gruppierungen mit Mitgliederzahl
  if (parts[0] === 'gruppen' && parts.length === 1 && method === 'GET') {
    const { results } = await db.prepare(
      `SELECT g.name, COUNT(p.num) AS count, gr.beschreibung
         FROM (SELECT gruppe AS name FROM people WHERE gruppe IS NOT NULL AND gruppe != ''
               UNION SELECT name FROM gruppen WHERE beschreibung IS NOT NULL AND beschreibung != '') g
         LEFT JOIN people p ON p.gruppe = g.name COLLATE NOCASE
         LEFT JOIN gruppen gr ON gr.name = g.name COLLATE NOCASE
        GROUP BY g.name COLLATE NOCASE ORDER BY COUNT(p.num) DESC, g.name`
    ).all();
    return json({ gruppen: results.map((r) => ({ name: r.name, count: r.count || 0, hatBeschreibung: !!r.beschreibung })) });
  }

  // GET /api/gruppen/:name – Beschreibung und Mitglieder
  if (parts[0] === 'gruppen' && parts.length === 2 && method === 'GET') {
    const name = clean(parts[1], 60);
    const g = await db.prepare('SELECT * FROM gruppen WHERE name = ?').bind(name).first();
    const { results } = await db.prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM akte a WHERE a.person_num = p.num) AS count,
              (SELECT COUNT(*) FROM akte a WHERE a.person_num = p.num AND a.erledigt = 0) AS offen,
              (SELECT COUNT(*) FROM haftbefehle h WHERE h.person_num = p.num AND h.status = 'offen') AS hb
         FROM people p WHERE p.gruppe = ? COLLATE NOCASE ORDER BY p.name`
    ).bind(name).all();
    if (!g && !results.length) return fail(404, 'Gruppierung nicht gefunden.');
    return json({
      name: results[0] ? results[0].gruppe : g.name,
      beschreibung: (g && g.beschreibung) || '',
      updatedAt: g ? g.updated_at : null,
      updatedBy: (g && g.updated_by) || '',
      mitglieder: results.map(personOut)
    });
  }

  // PUT /api/gruppen/:name  { beschreibung }  – ab A6 (bzw. POLIS_GRUPPE_MIN_RANK) oder Admin
  if (parts[0] === 'gruppen' && parts.length === 2 && method === 'PUT') {
    if (!canGruppe) return fail(403, 'Die Beschreibung von Gruppierungen darf man erst ab A' + rankLimits(env).gruppe + ' ändern.');
    const name = clean(parts[1], 60);
    if (!name) return fail(400, 'Name fehlt.');
    const b = await readBody(request);
    const text = String(b.beschreibung == null ? '' : b.beschreibung).replace(/\r/g, '').trim().slice(0, 4000);
    const old = await db.prepare('SELECT beschreibung FROM gruppen WHERE name = ?').bind(name).first();
    if ((old && old.beschreibung || '') === text) return json({ ok: true, unchanged: true });
    await db.batch([
      db.prepare(`INSERT INTO gruppen (name, beschreibung, updated_at, updated_by) VALUES (?, ?, ?, ?)
                  ON CONFLICT(name) DO UPDATE SET beschreibung = excluded.beschreibung, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
        .bind(name, text || null, Date.now(), beamter),
      logIt('Gruppierung beschrieben', null, name + (text ? '' : ' (Beschreibung gelöscht)'))
    ]);
    return json({ ok: true });
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

  // DELETE /api/haftbefehle/:id  (Admin)
  if (parts[0] === 'haftbefehle' && parts.length === 2 && method === 'DELETE') {
    if (!isAdmin) return needAdmin();
    const hid = Number(parts[1]);
    const row = Number.isInteger(hid) ? await db.prepare('SELECT * FROM haftbefehle WHERE id = ?').bind(hid).first() : null;
    if (!row) return fail(404, 'Haftbefehl nicht gefunden.');
    await db.batch([
      db.prepare('DELETE FROM haftbefehle WHERE id = ?').bind(hid),
      logIt('Haftbefehl gelöscht (Admin)', row.person_num, row.grund + (row.kennzeichen ? ', ' + row.kennzeichen : ''))
    ]);
    return json({ ok: true });
  }

  // PATCH /api/haftbefehle/:id  { status: 'vollstreckt' | 'aufgehoben' | 'offen', beamter }
  if (parts[0] === 'haftbefehle' && parts.length === 2 && method === 'PATCH') {
    if (!canHb) return needHb();
    const hid = Number(parts[1]);
    const b = await readBody(request);
    if (!Number.isInteger(hid) || !HB_STATUS.includes(b.status)) return fail(400, 'Ungültiger Status.');
    const closed = b.status === 'offen' ? [null, null] : [Date.now(), beamter];
    const row = await db.prepare('UPDATE haftbefehle SET status = ?, closed_at = ?, closed_by = ? WHERE id = ? RETURNING id, person_num, grund')
      .bind(b.status, closed[0], closed[1], hid).first();
    if (!row) return fail(404, 'Haftbefehl nicht gefunden.');
    const verb = { offen: 'wieder geöffnet', vollstreckt: 'vollstreckt', aufgehoben: 'aufgehoben' }[b.status];
    await logIt('Haftbefehl ' + verb, row.person_num, row.grund).run();
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
      ).bind(name, u.name, u.id, Date.now(), beamter).first();
      await logIt('Person angelegt', row.num, '@' + u.name + (name !== u.name ? ' als ' + name : '')).run();
      return json({ person: personOut(row) }, 201);
    }

    const num = parseId(parts[1]);
    if (num == null) return fail(404, 'Person nicht gefunden.');
    const person = await db.prepare('SELECT * FROM people WHERE num = ?').bind(num).first();
    if (!person) return fail(404, 'Person nicht gefunden.');

    // PATCH /api/people/:id  { status?, danger?, gruppe?, gruppeRang?, beschreibung? }  –  name und roblox nur als Admin
    if (parts.length === 2 && method === 'PATCH') {
      const b = await readBody(request);
      const status = STATUSES.includes(b.status) ? b.status : person.status;
      const danger = typeof b.danger === 'boolean' ? (b.danger ? 1 : 0) : person.danger;
      let name = person.name, roblox = person.roblox, robloxId = person.roblox_id;
      if (b.name != null || b.roblox != null) {
        if (!isAdmin) return needAdmin();
        if (b.name != null && clean(b.name, 60)) name = clean(b.name, 60);
        if (b.roblox != null) {
          const handle = clean(b.roblox, 30).replace(/^@+/, '');
          if (!HANDLE_RE.test(handle)) return fail(400, 'Ungültiger Roblox-Name.');
          if (handle.toLowerCase() !== person.roblox.toLowerCase()) {
            let u;
            try { u = await robloxLookup(handle); } catch { return fail(502, 'Roblox ist gerade nicht erreichbar.'); }
            if (!u) return fail(404, `Es gibt keinen Roblox-Account „@${handle}“.`);
            const dupe = await db.prepare('SELECT num FROM people WHERE (roblox = ? OR roblox_id = ?) AND num != ?').bind(u.name, u.id, num).first();
            if (dupe) return fail(409, `@${u.name} ist schon als P-${1000 + dupe.num} erfasst.`);
            roblox = u.name; robloxId = u.id;
          }
        }
      }
      // Beschreibung: Gruppierung, Rang darin, freier Text – darf jeder Beamte ändern
      const gruppe = b.gruppe != null ? clean(b.gruppe, 60) : (person.gruppe || '');
      const gruppeRang = b.gruppeRang != null ? clean(b.gruppeRang, 60) : (person.gruppe_rang || '');
      const beschreibung = b.beschreibung != null ? String(b.beschreibung).replace(/\r/g, '').trim().slice(0, 2000) : (person.beschreibung || '');
      const row = await db.prepare('UPDATE people SET status = ?, danger = ?, name = ?, roblox = ?, roblox_id = ?, gruppe = ?, gruppe_rang = ?, beschreibung = ? WHERE num = ? RETURNING *')
        .bind(status, danger, name, roblox, robloxId, gruppe || null, gruppeRang || null, beschreibung || null, num).first();
      const changes = [];
      const was = (v) => v ? v : 'leer';
      if (gruppe !== (person.gruppe || '')) changes.push('Gruppierung: ' + was(person.gruppe) + ' zu ' + was(gruppe));
      if (gruppeRang !== (person.gruppe_rang || '')) changes.push('Rang: ' + was(person.gruppe_rang) + ' zu ' + was(gruppeRang));
      if (beschreibung !== (person.beschreibung || '')) changes.push('Beschreibung geändert');
      if (status !== person.status) changes.push('Status: ' + person.status + ' zu ' + status);
      if (danger !== person.danger) changes.push(danger ? 'als gefährlich markiert' : 'nicht mehr gefährlich');
      if (name !== person.name) changes.push('Name: ' + person.name + ' zu ' + name);
      if (roblox !== person.roblox) changes.push('Roblox: @' + person.roblox + ' zu @' + roblox);
      const adminEdit = name !== person.name || roblox !== person.roblox;
      if (changes.length) await logIt(adminEdit ? 'Person bearbeitet (Admin)' : 'Person geändert', num, changes.join(', ')).run();
      return json({ person: personOut(row) });
    }

    // DELETE /api/people/:id  (Admin) – Person mit Strafregister und Haftbefehlen löschen
    if (parts.length === 2 && method === 'DELETE') {
      if (!isAdmin) return needAdmin();
      await db.batch([
        db.prepare('DELETE FROM akte WHERE person_num = ?').bind(num),
        db.prepare('DELETE FROM haftbefehle WHERE person_num = ?').bind(num),
        db.prepare('DELETE FROM people WHERE num = ?').bind(num),
        logIt('Person gelöscht (Admin)', null, person.name + ' (@' + person.roblox + ', P-' + (1000 + num) + ')')
      ]);
      return json({ ok: true });
    }

    // GET /api/people/:id/haftbefehle
    if (parts.length === 3 && parts[2] === 'haftbefehle' && method === 'GET') {
      const { results } = await db.prepare(HB_SELECT + ' WHERE h.person_num = ? ORDER BY h.id DESC').bind(num).all();
      return json({ haftbefehle: results.map(hbOut) });
    }

    // POST /api/people/:id/haftbefehle  { kennzeichen, modell, grund, beweise, beamter }
    if (parts.length === 3 && parts[2] === 'haftbefehle' && method === 'POST') {
      if (!canHb) return needHb();
      const b = await readBody(request);
      const grund = clean(b.grund, 200);
      if (!grund) return fail(400, 'Grund fehlt.');
      const ins = await db.prepare(
        `INSERT INTO haftbefehle (person_num, kennzeichen, modell, grund, beweise, ausgestellt_von, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'offen') RETURNING id`
      ).bind(num, clean(b.kennzeichen, 20), clean(b.modell, 60), grund, clean(b.beweise, 500), beamter, Date.now()).first();
      await logIt('Haftbefehl ausgestellt', num, grund).run();
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
      rows.forEach(([delikt, geld, haft]) => stmts.push(logIt('Strafe vergeben', num, delikt + ': ' + geld.toLocaleString('de-DE') + ' €, ' + haft + ' Min.')));
      await db.batch(stmts);
      return json({ ok: true, added: rows.length }, 201);
    }

    // PATCH /api/people/:id/akte  { erledigt: true } – alle offenen Strafen erledigt
    if (parts.length === 3 && parts[2] === 'akte' && method === 'PATCH') {
      const b = await readBody(request);
      if (b.erledigt !== true) return fail(400, 'Nur „erledigt: true“ möglich.');
      const r = await db.prepare('UPDATE akte SET erledigt = 1 WHERE person_num = ? AND erledigt = 0').bind(num).run();
      const n = r.meta ? r.meta.changes : 0;
      if (n) await logIt('Strafen erledigt', num, n === 1 ? '1 ausstehende Strafe' : n + ' ausstehende Strafen').run();
      return json({ ok: true, changed: r.meta ? r.meta.changes : null });
    }

    // /api/people/:id/akte/:eintrag
    if (parts.length === 4 && parts[2] === 'akte') {
      const eid = Number(parts[3]);
      if (!Number.isInteger(eid)) return fail(404, 'Eintrag nicht gefunden.');
      const row = await db.prepare('SELECT * FROM akte WHERE id = ? AND person_num = ?').bind(eid, num).first();
      if (!row) return fail(404, 'Eintrag nicht gefunden.');
      // PATCH { erledigt: bool }  oder  { geld, haft } (Strafe anpassen)
      if (method === 'PATCH') {
        const b = await readBody(request);
        if (typeof b.erledigt !== 'boolean' && (b.geld != null || b.haft != null)) {
          if (row.erledigt && !isAdmin) return fail(409, 'Erledigte Strafen kann nur ein Admin anpassen.');
          const para = Object.keys(KATALOG).find((k) => row.delikt.indexOf(k + ' ') === 0);
          if (!para) return fail(400, 'Für diesen Eintrag gibt es keinen Strafrahmen.');
          const k = KATALOG[para];
          const geld = clampTo(b.geld ?? row.geld, k.geld);
          const haft = clampTo(b.haft ?? row.haft, k.haft);
          if (geld === row.geld && haft === row.haft) return json({ ok: true, geld, haft, unchanged: true });
          await db.batch([
            db.prepare('UPDATE akte SET geld = ?, haft = ? WHERE id = ?').bind(geld, haft, eid),
            logIt('Strafe angepasst', num, row.delikt + ': ' + Number(row.geld).toLocaleString('de-DE') + ' € zu ' +
              geld.toLocaleString('de-DE') + ' €, ' + row.haft + ' zu ' + haft + ' Min.')
          ]);
          return json({ ok: true, geld, haft });
        }
        if (typeof b.erledigt !== 'boolean') return fail(400, 'Feld „erledigt“ fehlt.');
        await db.prepare('UPDATE akte SET erledigt = ? WHERE id = ?').bind(b.erledigt ? 1 : 0, eid).run();
        await logIt(b.erledigt ? 'Strafe erledigt' : 'Strafe wieder ausstehend', num, row.delikt).run();
        return json({ ok: true });
      }
      // DELETE – nur offene Einträge (z. B. Fehlklick)
      if (method === 'DELETE') {
        if (row.erledigt && !isAdmin) return fail(409, 'Erledigte Einträge kann nur ein Admin löschen.');
        await db.prepare('DELETE FROM akte WHERE id = ?').bind(eid).run();
        await logIt(row.erledigt ? 'Strafe gelöscht (Admin)' : 'Strafe entfernt', num, row.delikt + ': ' + Number(row.geld).toLocaleString('de-DE') + ' €, ' + row.haft + ' Min.').run();
        return json({ ok: true });
      }
    }
  }

  return fail(404, 'Unbekannter Endpunkt.');
}
