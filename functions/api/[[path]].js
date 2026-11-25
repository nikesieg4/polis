/*
 * POLIS API – Cloudflare Pages Function mit D1.
 *
 * Benötigt in den Cloudflare-Pages-Einstellungen:
 *   - D1-Binding mit dem Variablennamen  DB
 *   - Umgebungsvariable (verschlüsselt)  POLIS_KEY  = Dienstschlüssel für alle Beamten
 *   - optional (verschlüsselt)           POLIS_KEY_ADMIN = Admin-Passwort (Strafen löschen, Personen bearbeiten/löschen)
 * Die Tabellen werden beim ersten Aufruf automatisch angelegt.
 */

import { discordConfigured, discordMissing, handleAuth, requireMember, noAccess, guildRoleList, MEMBER_SCHEMA, MEMBER_MIGRATIONS } from '../../lib/discord.js';
import { PERMS, PERM_KEYS, RECHTE_SCHEMA, loadMatrix, permsFor, saveMatrix, aussperrFehler } from '../../lib/rechte.js';
import { SCHICHT_SCHEMA, SCHICHT_MIGRATIONS, handleSchicht } from '../../lib/schicht.js';
import { einheitFuer } from '../../lib/rollen.js';
import { KATALOG, KATALOG_BY_NR, label, katalogFuer } from '../../lib/katalog.js';
import { REGISTER_SCHEMA, handleRegister } from '../../lib/register.js';
import { GRUNDRISS_SCHEMA, handleGrundrisse } from '../../lib/grundriss.js';

const STATUSES = ['Sauber', 'Bewährung', 'Fahndung'];

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
  ...RECHTE_SCHEMA,
  ...SCHICHT_SCHEMA,
  ...REGISTER_SCHEMA,
  ...GRUNDRISS_SCHEMA,
  // Persönliche Einstellungen je Discord-Konto (z. B. Hintergrundmuster)
  // Eigener Tabellenname: „einstellungen“ ist schon die Tabelle der Rechte-Seite (key/value)
  `CREATE TABLE IF NOT EXISTS nutzer_einstellungen (
     uid TEXT PRIMARY KEY,
     hintergrund TEXT,
     updated_at INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS gruppen (
     name TEXT PRIMARY KEY COLLATE NOCASE,
     beschreibung TEXT,
     updated_at INTEGER,
     updated_by TEXT
   )`
];
// Erlaubte Hintergrundmuster (siehe style.css, Klassen „bg-…“); leer = Standard
const HINTERGRUENDE = ['', 'gitter', 'punkte', 'schraffur', 'scan', 'radar', 'karo'];
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
    ausgestelltDiscord: r.ausgestellt_discord || '',
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
    // Zeitpunkt des neuesten Eintrags (Strafe oder Haftbefehl), sonst Anlage der Person
    letzterEintrag: Math.max(r.letzte_strafe || 0, r.letzter_hb || 0, r.created_at || 0),
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
  for (const c of ['gruppe TEXT', 'gruppe_rang TEXT', 'beschreibung TEXT', 'kripo INTEGER NOT NULL DEFAULT 0', 'kripo_hinweis TEXT', 'kripo_von TEXT']) {
    try { await db.prepare('ALTER TABLE people ADD COLUMN ' + c).run(); } catch { /* existiert schon */ }
  }
  // Protokolleinträge, die nur sehen darf, wer die Kripo-Markierung sehen darf
  try { await db.prepare('ALTER TABLE log ADD COLUMN geheim INTEGER NOT NULL DEFAULT 0').run(); } catch { /* existiert schon */ }
  // Discord-ID des ausstellenden Beamten (für die Erwähnung beim Kopieren)
  try { await db.prepare('ALTER TABLE haftbefehle ADD COLUMN ausgestellt_discord TEXT').run(); } catch { /* existiert schon */ }
  // Katalognummer der Strafe (Paragraphen kommen im Katalog mehrfach vor)
  try { await db.prepare('ALTER TABLE akte ADD COLUMN nr INTEGER').run(); } catch { /* existiert schon */ }
  for (const m of SCHICHT_MIGRATIONS) { try { await db.prepare(m).run(); } catch { /* existiert schon */ } }
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
    headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; POLIS-Datenbank)' },
    body: JSON.stringify({ usernames: [handle], excludeBannedUsers: false })
  });
  if (!r.ok) throw new Error('roblox ' + r.status);
  const d = await r.json();
  const u = d.data && d.data[0];
  return u ? { id: u.id, name: u.name, displayName: u.displayName } : null;
}

// Roblox-Namenssuche für die Vorschläge im Suchfeld.
// Roblox drosselt Anfragen aus Rechenzentren oft; deshalb mehrere Wege nacheinander:
// 1. users/v1/users/search  2. search-api/omni-search (die Suche der Roblox-Webseite)  3. exakter Name
const RBX_HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; POLIS-Datenbank)', accept: 'application/json' };
const sucheCache = new Map();
async function robloxSuche(q) {
  const key = q.toLowerCase();
  const hit = sucheCache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data;
  let users = [], quelle = '';
  try {
    const r = await fetch('https://users.roblox.com/v1/users/search?limit=10&keyword=' + encodeURIComponent(q), { headers: RBX_HEADERS });
    if (r.ok) { users = ((await r.json()).data || []).map((u) => ({ id: u.id, name: u.name, displayName: u.displayName })); quelle = 'suche'; }
  } catch { /* nächster Weg */ }
  if (!users.length) {
    try {
      const r = await fetch('https://apis.roblox.com/search-api/omni-search?verticalType=user&pageToken=&globalSessionId=polis&sessionId=polis&searchQuery=' + encodeURIComponent(q), { headers: RBX_HEADERS });
      if (r.ok) {
        const d = await r.json();
        users = (d.searchResults || []).flatMap((g) => g.contents || []).filter((c) => c.contentType === 'User')
          .slice(0, 10).map((c) => ({ id: c.contentId, name: c.username, displayName: c.displayName }));
        if (users.length) quelle = 'omni';
      }
    } catch { /* nächster Weg */ }
  }
  if (!users.length && HANDLE_RE.test(q)) {
    const u = await robloxLookup(q).catch(() => null);
    if (u) users = [u];
    quelle = 'exakt';
  }
  if (users.length) {
    try {
      const t = await fetch('https://thumbnails.roblox.com/v1/users/avatar-headshot?size=48x48&format=Png&isCircular=false&userIds=' + users.map((u) => u.id).join(','), { headers: RBX_HEADERS });
      const img = {};
      ((await t.json()).data || []).forEach((x) => { img[x.targetId] = x.imageUrl; });
      users.forEach((u) => { u.avatar = img[u.id] || ''; });
    } catch { /* ohne Bilder */ }
  }
  const data = { users, quelle };
  if (sucheCache.size > 300) sucheCache.clear();
  // Volle Suchergebnisse 5 Minuten merken, Notfall-Ergebnisse nur 30 Sekunden
  sucheCache.set(key, { at: Date.now(), ttl: quelle === 'exakt' ? 30 * 1000 : 5 * 60 * 1000, data });
  return data;
}

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

// Jeder unerwartete Fehler wird als lesbare Meldung zurückgegeben statt als nackter Fehler 500
export async function onRequest(context) {
  try {
    return await handle(context);
  } catch (e) {
    console.error('POLIS Serverfehler', e && e.stack || e);
    return json({ error: 'Serverfehler: ' + String((e && e.message) || e).slice(0, 200) }, 500);
  }
}

async function handle(context) {
  const { request, env, params } = context;
  const parts = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  const method = request.method;
  const route = parts.join('/');

  // --- Öffentlich: Strafkatalog (für die Seite) ---
  if (route === 'katalog' && method === 'GET') {
    return json({ katalog: KATALOG }, 200, { 'cache-control': 'public, max-age=300' });
  }

  // --- Öffentlich: Status ---
  if (route === 'health') {
    const discord = discordConfigured(env);
    // Kann der Bot den Discord-Server lesen? (Rollenliste, 10 Minuten zwischengespeichert)
    let discordBot = null;
    if (discord) {
      try { const r = await guildRoleList(env); discordBot = 'ok (' + r.length + ' Rollen)'; }
      catch (e) { discordBot = 'Fehler: ' + String(e.message || e).slice(0, 150); }
    }
    return json({ ok: true, db: !!env.DB, auth: discord ? 'discord' : 'key', keySet: discord || !!env.POLIS_KEY,
      // Testphase: solange POLIS_KEY gesetzt ist, geht auch die Anmeldung ohne Discord
      keyLogin: discord && !!env.POLIS_KEY, adminSet: !!env.POLIS_KEY_ADMIN,
      discordMissing: discordMissing(env), discordServer: env.DISCORD_GUILD_ID || null, discordBot });
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

  let officer, uid, perms, roleList = [], einheit = 'Polizei';
  // Ohne Discord anmelden (Testphase): nur wenn POLIS_KEY noch existiert und der Client ihn mitschickt
  const viaKey = !!env.POLIS_KEY && !!request.headers.get('x-polis-key');
  if (discordConfigured(env) && !viaKey) {
    // --- Anmeldung über Discord: Name und Rollen kommen vom Discord-Server ---
    const permsOf = async (m) => {
      roleList = await guildRoleList(env);
      return permsFor(m, (await loadMatrix(env, db, roleList)).matrix);
    };
    if (parts[0] === 'auth') {
      const r = await handleAuth(request, env, db, parts, async (m) => (await permsOf(m)).has('zugriff'));
      if (r) return r;
    }
    const auth = await requireMember(request, env, db);
    if (auth.error) return auth.error;
    try { perms = await permsOf(auth.member); } catch (e) { return fail(502, e.message); }
    if (!perms.has('zugriff')) return noAccess();
    // Schutz gegen fremde Seiten, die mit dem Cookie Änderungen auslösen wollen
    if (method !== 'GET' && request.headers.get('x-polis') !== '1') return fail(403, 'Ungültige Anfrage.');
    officer = { name: auth.member.name || auth.member.username, nr: '@' + auth.member.username };
    uid = auth.member.uid;
    einheit = einheitFuer(auth.member.roles, roleList).einheit;
    if (route === 'me') {
      const e = await db.prepare('SELECT hintergrund FROM nutzer_einstellungen WHERE uid = ?').bind(uid).first();
      return json({ name: officer.name, username: auth.member.username, avatar: auth.member.avatar,
        admin: perms.has('admin'), perms: [...perms], rang: auth.member.rang || 0,
        einstellungen: { hintergrund: (e && e.hintergrund) || '' } });
    }
    // PUT /api/einstellungen – eigene Einstellungen speichern (gilt nur für dieses Discord-Konto)
    if (route === 'einstellungen' && method === 'PUT') {
      const body = await readBody(request);
      const hg = clean(body && body.hintergrund, 20);
      if (!HINTERGRUENDE.includes(hg)) return fail(400, 'Unbekannter Hintergrund.');
      await db.prepare(`INSERT INTO nutzer_einstellungen (uid, hintergrund, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(uid) DO UPDATE SET hintergrund = excluded.hintergrund, updated_at = excluded.updated_at`)
        .bind(uid, hg, Date.now()).run();
      return json({ einstellungen: { hintergrund: hg } });
    }
  } else {
    // --- Alter Weg: gemeinsamer Dienstschlüssel, Name und Dienstnummer selbst eingetragen ---
    if (!env.POLIS_KEY) return fail(503, 'Dienstschlüssel nicht eingerichtet (Variable „POLIS_KEY“ fehlt).');
    if (!keyMatches(request.headers.get('x-polis-key'), env.POLIS_KEY)) return fail(401, 'Falscher Dienstschlüssel.');
    const keyAdmin = keyMatches(request.headers.get('x-polis-admin'), env.POLIS_KEY_ADMIN);
    // Ohne Discord gibt es keine Rollen: alles außer Admin-Funktionen; Admin-Passwort schaltet Management und Admin frei
    perms = new Set(PERM_KEYS.filter((k) => k !== 'rechte' && (keyAdmin || !['admin', 'schicht_alle', 'quote', 'grundrisse'].includes(k))));
    if (route === 'auth') return json({ ok: true });
    const dec = (h) => { try { return clean(decodeURIComponent(request.headers.get(h) || ''), 60); } catch { return ''; } };
    officer = { name: dec('x-polis-name'), nr: dec('x-polis-nr').slice(0, 20) };
    uid = 'key:' + officer.nr.toLowerCase();
    if (route === 'me') return json({ name: officer.name, admin: perms.has('admin'), perms: [...perms] });
    if (method !== 'GET' && (!officer.name || !officer.nr)) {
      return fail(403, 'Bitte oben Name und Dienstnummer eintragen.');
    }
    // Im Protokoll erkennbar machen, dass der Name nicht von Discord geprüft ist
    if (discordConfigured(env)) officer.nr += ', ohne Discord';
  }
  const can = (k) => perms.has(k);
  const isAdmin = can('admin');
  const deny = (k) => fail(403, 'Dafür fehlt dir das Recht „' + (PERMS.find((p) => p.key === k) || { label: k }).label + '“.');
  const needAdmin = () => deny('admin');
  const beamter = officer.name + ' (' + officer.nr + ')';
  const logIt = (aktion, personNum, details, geheim) => db.prepare(
    'INSERT INTO log (ts, beamter_name, beamter_nr, aktion, person_num, details, geheim) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(Date.now(), officer.name, officer.nr, aktion, personNum ?? null, clean(details, 300) || null, geheim ? 1 : 0);
  // Person nach außen; die Kripo-Markierung nur an Beamte mit Recht „kripo_sehen“
  const pOut = (r) => {
    const o = personOut(r);
    if (can('kripo_sehen') && r.kripo) { o.kripo = true; o.kripoHinweis = r.kripo_hinweis || ''; o.kripoVon = r.kripo_von || ''; }
    return o;
  };

  // GET /api/admin – Admin-Passwort prüfen
  if (route === 'admin' && method === 'GET') {
    if (!env.POLIS_KEY_ADMIN) return fail(503, 'Admin-Passwort ist auf dem Server nicht eingerichtet (POLIS_KEY_ADMIN).');
    return keyMatches(request.headers.get('x-polis-admin'), env.POLIS_KEY_ADMIN) ? json({ ok: true }) : fail(401, 'Falsches Admin-Passwort.');
  }

  // GET /api/log?limit=200&person=P-1001
  if (route === 'log' && method === 'GET') {
    if (!can('protokoll')) return deny('protokoll');
    const sp = new URL(request.url).searchParams;
    const limit = Math.min(500, Math.max(1, Number(sp.get('limit')) || 200));
    const pnum = parseId(sp.get('person'));
    const base = `SELECT l.*, p.name AS p_name, p.roblox AS p_roblox FROM log l LEFT JOIN people p ON p.num = l.person_num WHERE `
      + (can('kripo_sehen') ? '1 = 1' : 'l.geheim = 0');
    const q = pnum != null
      ? db.prepare(base + ' AND l.person_num = ? ORDER BY l.id DESC LIMIT ?').bind(pnum, limit)
      : db.prepare(base + ' ORDER BY l.id DESC LIMIT ?').bind(limit);
    const { results } = await q.all();
    return json({ log: results.map((r) => ({
      id: r.id, ts: r.ts, name: r.beamter_name, nr: r.beamter_nr, aktion: r.aktion, details: r.details || '',
      personId: r.person_num != null ? 'P-' + (1000 + r.person_num) : null, personName: r.p_name || '', roblox: r.p_roblox || ''
    })) });
  }

  // GET /api/roblox/suche?q=… – Roblox-Accounts für die Vorschläge, mit Avatar und ob schon erfasst
  if (route === 'roblox/suche' && method === 'GET') {
    const q = clean(new URL(request.url).searchParams.get('q'), 20).replace(/^@+/, '');
    if (!/^[A-Za-z0-9_.]{3,20}$/.test(q)) return json({ accounts: [] });
    let users, quelle;
    try { ({ users, quelle } = await robloxSuche(q)); } catch { return fail(502, 'Roblox ist gerade nicht erreichbar.'); }
    const known = {};
    if (users.length) {
      const { results } = await db.prepare('SELECT num, roblox_id FROM people WHERE roblox_id IN (' + users.map(() => '?').join(',') + ')')
        .bind(...users.map((u) => u.id)).all();
      results.forEach((r) => { known[r.roblox_id] = 'P-' + (1000 + r.num); });
    }
    return json({ quelle, accounts: users.map((u) => ({ ...u, personId: known[u.id] || null })) });
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

  // ---------- Schichtzeit, Polizei-Register, Rechte ----------
  // Einheit eines anderen Beamten aus seinen zuletzt gesehenen Discord-Rollen (für „Im Dienst“)
  const einheitVon = async (uids) => {
    const out = {};
    if (!discordConfigured(env) || !uids.length) return out;
    if (!roleList.length) { try { roleList = await guildRoleList(env); } catch { return out; } }
    const { results } = await db.prepare('SELECT uid, roles FROM discord_members WHERE uid IN (' + uids.map(() => '?').join(',') + ')').bind(...uids).all();
    for (const r of results) {
      let roles = []; try { roles = JSON.parse(r.roles || '[]'); } catch { /* leer */ }
      out[r.uid] = einheitFuer(roles, roleList);
    }
    return out;
  };
  const ctx = { request, method, parts, db, can, uid, officer, beamter, json, fail, readBody, logIt, clean, einheit, einheitVon, url: new URL(request.url) };
  if (parts[0] === 'schicht') {
    const r = await handleSchicht(ctx);
    if (r) return r;
  }
  if (parts[0] === 'beamte') {
    const r = await handleRegister(ctx);
    if (r) return r;
  }
  if (parts[0] === 'grundrisse') {
    const r = await handleGrundrisse(ctx);
    if (r) return r;
  }
  if (parts[0] === 'rechte') {
    if (!discordConfigured(env) || viaKey) return fail(400, 'Rechte gibt es nur mit Discord-Anmeldung.');
    if (!can('rechte')) return deny('rechte');
    roleList = roleList.length ? roleList : await guildRoleList(env);
    if (method === 'GET') {
      const m = await loadMatrix(env, db, roleList);
      return json({ perms: PERMS, rollen: roleList.map((r) => ({ id: r.id, name: r.name })), matrix: m.matrix, gespeichert: m.gespeichert });
    }
    if (method === 'PUT') {
      const b = await readBody(request);
      const valid = new Set(roleList.map((r) => r.id));
      const matrix = {};
      for (const k of PERM_KEYS) matrix[k] = (Array.isArray((b.matrix || {})[k]) ? b.matrix[k] : []).map(String).filter((id) => valid.has(id));
      const f = aussperrFehler(matrix);
      if (f) return fail(400, f);
      await saveMatrix(db, matrix, [...valid]);
      await logIt('Rechte geändert', null, 'Rechtetabelle gespeichert').run();
      return json({ ok: true });
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
              (SELECT COUNT(*) FROM haftbefehle h WHERE h.person_num = p.num AND h.status = 'offen') AS hb,
                (SELECT MAX(created_at) FROM akte a WHERE a.person_num = p.num) AS letzte_strafe,
                (SELECT MAX(created_at) FROM haftbefehle h WHERE h.person_num = p.num) AS letzter_hb
         FROM people p WHERE p.gruppe = ? COLLATE NOCASE ORDER BY p.name`
    ).bind(name).all();
    if (!g && !results.length) return fail(404, 'Gruppierung nicht gefunden.');
    return json({
      name: results[0] ? results[0].gruppe : g.name,
      beschreibung: (g && g.beschreibung) || '',
      updatedAt: g ? g.updated_at : null,
      updatedBy: (g && g.updated_by) || '',
      mitglieder: results.map((r) => pOut(r))
    });
  }

  // PUT /api/gruppen/:name  { beschreibung }  – ab A6 (bzw. POLIS_GRUPPE_MIN_RANK) oder Admin
  if (parts[0] === 'gruppen' && parts.length === 2 && method === 'PUT') {
    if (!can('gruppen')) return deny('gruppen');
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
    if (!can('haftbefehle')) return deny('haftbefehle');
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
                (SELECT COUNT(*) FROM haftbefehle h WHERE h.person_num = p.num AND h.status = 'offen') AS hb,
                (SELECT MAX(created_at) FROM akte a WHERE a.person_num = p.num) AS letzte_strafe,
                (SELECT MAX(created_at) FROM haftbefehle h WHERE h.person_num = p.num) AS letzter_hb
           FROM people p ORDER BY p.num DESC`
      ).all();
      return json({ people: results.map((r) => pOut(r)) });
    }

    // POST /api/people  { roblox, name, beamter }
    if (parts.length === 1 && method === 'POST') {
      if (!can('personen')) return deny('personen');
      const b = await readBody(request);
      const handle = clean(b.roblox, 30).replace(/^@+/, '');
      if (!HANDLE_RE.test(handle)) return fail(400, 'Ungültiger Roblox-Name.');
      const existing = await db.prepare('SELECT * FROM people WHERE roblox = ?').bind(handle).first();
      if (existing) return json({ person: pOut(existing), existed: true });
      let u;
      try { u = await robloxLookup(handle); } catch { return fail(502, 'Roblox ist gerade nicht erreichbar.'); }
      if (!u) return fail(404, `Es gibt keinen Roblox-Account „@${handle}“.`);
      const dupe = await db.prepare('SELECT * FROM people WHERE roblox = ? OR roblox_id = ?').bind(u.name, u.id).first();
      if (dupe) return json({ person: pOut(dupe), existed: true });
      const name = clean(b.name, 60) || u.displayName || u.name;
      const row = await db.prepare(
        `INSERT INTO people (name, roblox, roblox_id, status, danger, created_at, created_by)
         VALUES (?, ?, ?, 'Sauber', 0, ?, ?) RETURNING *`
      ).bind(name, u.name, u.id, Date.now(), beamter).first();
      await logIt('Person angelegt', row.num, '@' + u.name + (name !== u.name ? ' als ' + name : '')).run();
      return json({ person: pOut(row) }, 201);
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
      if ((status !== person.status || danger !== person.danger) && !can('personen')) return deny('personen');
      if ((b.gruppe != null || b.gruppeRang != null || b.beschreibung != null) && !can('beschreibung')) return deny('beschreibung');
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
      return json({ person: pOut(row) });
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

    // PUT /api/people/:id/kripo  { aktiv, hinweis }  –  Kripo-Markierung (Recht „kripo_setzen“)
    if (parts.length === 3 && parts[2] === 'kripo' && method === 'PUT') {
      if (!can('kripo_setzen')) return deny('kripo_setzen');
      const b = await readBody(request);
      const aktiv = b.aktiv === true;
      const hinweis = aktiv ? clean(b.hinweis, 200) : '';
      const aktion = !aktiv ? 'Kripo-Markierung entfernt' : person.kripo ? 'Kripo-Markierung geändert' : 'Kripo-Markierung gesetzt';
      if (!aktiv && !person.kripo) return json({ person: pOut(person) });
      await db.batch([
        db.prepare('UPDATE people SET kripo = ?, kripo_hinweis = ?, kripo_von = ? WHERE num = ?').bind(aktiv ? 1 : 0, hinweis || null, aktiv ? beamter : null, num),
        logIt(aktion, num, hinweis, true)
      ]);
      const row = await db.prepare('SELECT * FROM people WHERE num = ?').bind(num).first();
      return json({ person: pOut(row) });
    }

    // GET /api/people/:id/haftbefehle
    if (parts.length === 3 && parts[2] === 'haftbefehle' && method === 'GET') {
      const { results } = await db.prepare(HB_SELECT + ' WHERE h.person_num = ? ORDER BY h.id DESC').bind(num).all();
      return json({ haftbefehle: results.map(hbOut) });
    }

    // POST /api/people/:id/haftbefehle  { kennzeichen, modell, grund, beweise, beamter }
    if (parts.length === 3 && parts[2] === 'haftbefehle' && method === 'POST') {
      if (!can('haftbefehle')) return deny('haftbefehle');
      const b = await readBody(request);
      const grund = clean(b.grund, 200);
      if (!grund) return fail(400, 'Grund fehlt.');
      const ins = await db.prepare(
        `INSERT INTO haftbefehle (person_num, kennzeichen, modell, grund, beweise, ausgestellt_von, created_at, status, ausgestellt_discord)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'offen', ?) RETURNING id`
      ).bind(num, clean(b.kennzeichen, 20), clean(b.modell, 60), grund, clean(b.beweise, 500), beamter, Date.now(), /^\d{15,22}$/.test(String(uid)) ? String(uid) : null).first();
      await logIt('Haftbefehl ausgestellt', num, grund).run();
      const full = await db.prepare(HB_SELECT + ' WHERE h.id = ?').bind(ins.id).first();
      return json({ haftbefehl: hbOut(full) }, 201);
    }

    // GET /api/people/:id/akte
    if (parts.length === 3 && parts[2] === 'akte' && method === 'GET') {
      const { results } = await db.prepare(
        'SELECT id, delikt, geld, haft, datum, beamter, erledigt, nr, created_at FROM akte WHERE person_num = ? ORDER BY id DESC'
      ).bind(num).all();
      return json({ akte: results });
    }

    // POST /api/people/:id/akte  { entries: [{delikt, geld, haft}], beamter, datum }
    if (parts.length === 3 && parts[2] === 'akte' && method === 'POST') {
      if (!can('strafen')) return deny('strafen');
      const b = await readBody(request);
      const entries = Array.isArray(b.entries) ? b.entries.slice(0, 30) : [];
      if (!entries.length) return fail(400, 'Keine Delikte ausgewählt.');
      const datum = clean(b.datum, 20) || new Date().toISOString().slice(0, 10);
      const now = Date.now();
      const rows = [];
      for (const e of entries) {
        const k = KATALOG_BY_NR[Number(e.nr)];
        if (!k) return fail(400, 'Unbekannte Strafe.');
        // Geldstrafe ist fest; haft = 1 heißt: ins Gefängnis bringen (keine Dauer)
        rows.push([label(k), k.geld, k.haft ? 1 : 0, k.nr]);
      }
      const stmts = rows.map(([delikt, geld, haft, nr]) => db.prepare(
        'INSERT INTO akte (person_num, delikt, geld, haft, datum, beamter, created_at, erledigt, nr) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
      ).bind(num, delikt, geld, haft, datum, beamter, now, nr));
      rows.forEach(([delikt, geld, haft]) => stmts.push(logIt('Strafe vergeben', num, delikt + ': ' + geld.toLocaleString('de-DE') + ' €' + (haft ? ' + Haft' : ''))));
      await db.batch(stmts);
      return json({ ok: true, added: rows.length }, 201);
    }

    // PATCH /api/people/:id/akte  { erledigt: true } – alle offenen Strafen erledigt
    if (parts.length === 3 && parts[2] === 'akte' && method === 'PATCH') {
      if (!can('strafen')) return deny('strafen');
      const b = await readBody(request);
      if (b.erledigt !== true) return fail(400, 'Nur „erledigt: true“ möglich.');
      const r = await db.prepare('UPDATE akte SET erledigt = 1 WHERE person_num = ? AND erledigt = 0').bind(num).run();
      const n = r.meta ? r.meta.changes : 0;
      if (n) await logIt('Strafen erledigt', num, n === 1 ? '1 ausstehende Strafe' : n + ' ausstehende Strafen').run();
      return json({ ok: true, changed: r.meta ? r.meta.changes : null });
    }

    // /api/people/:id/akte/:eintrag
    if (parts.length === 4 && parts[2] === 'akte') {
      if (method !== 'GET' && !can('strafen')) return deny('strafen');
      const eid = Number(parts[3]);
      if (!Number.isInteger(eid)) return fail(404, 'Eintrag nicht gefunden.');
      const row = await db.prepare('SELECT * FROM akte WHERE id = ? AND person_num = ?').bind(eid, num).first();
      if (!row) return fail(404, 'Eintrag nicht gefunden.');
      // PATCH { erledigt: bool }  oder  { geld, haft } (Strafe anpassen)
      if (method === 'PATCH') {
        const b = await readBody(request);
        if (typeof b.erledigt !== 'boolean' && (b.geld != null || b.haft != null)) {
          return fail(400, 'Strafen sind laut Katalog fest und können nicht angepasst werden.');
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
        await logIt(row.erledigt ? 'Strafe gelöscht (Admin)' : 'Strafe entfernt', num, row.delikt + ': ' + Number(row.geld).toLocaleString('de-DE') + ' €' + (row.haft ? ' + Haft' : '')).run();
        return json({ ok: true });
      }
    }
  }

  return fail(404, 'Unbekannter Endpunkt.');
}
