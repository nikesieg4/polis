/*
 * Discord-Anmeldung (OAuth2) + Rollenprüfung über den Bot.
 *
 * Secrets im Worker (alle als Typ „Secret“ anlegen, damit sie Deploys überleben):
 *   DISCORD_CLIENT_ID       Application ID
 *   DISCORD_CLIENT_SECRET   OAuth2 Client Secret (signiert auch die Sitzungs-Cookies)
 *   DISCORD_BOT_TOKEN       Bot-Token; der Bot muss auf dem Server sein (keine Rechte nötig)
 *   DISCORD_GUILD_ID        Server-ID
 *
 * Rollen werden über ihre Namen erkannt (der Bot liest die Rollenliste des Servers):
 *   A1 … A10          Dienstgrad; Zugriff ab POLIS_MIN_RANK (Standard 1),
 *                     Haftbefehle bearbeiten ab POLIS_HB_MIN_RANK (Standard 4),
 *                     Beschreibung von Gruppierungen ab POLIS_GRUPPE_MIN_RANK (Standard 6)
 *   „Datenbank Admin“ Admin-Rechte (Name änderbar über POLIS_ADMIN_ROLE_NAME)
 * Optional zusätzlich per ID: POLIS_ROLE_IDS (Zugriff), POLIS_ADMIN_ROLE_IDS (Admin), Komma-getrennt.
 *
 * Ablauf: /api/auth/discord/login -> Discord -> /api/auth/discord/callback
 *   -> Sitzungs-Cookie (HttpOnly, signiert, 12 h). Bei jeder Anfrage prüft der Server
 *   Mitgliedschaft und Rollen über den Bot; das Ergebnis wird höchstens 5 Minuten gecacht.
 */

const SESSION_COOKIE = 'polis_session';
const STATE_COOKIE = 'polis_oauth_state';
const SESSION_TTL = 12 * 3600 * 1000;
const MEMBER_TTL = 5 * 60 * 1000;

const REQUIRED = ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID'];
// Nur die Namen fehlender Secrets, nie Werte
export function discordMissing(env) { return REQUIRED.filter((k) => !env[k]); }

export function discordConfigured(env) {
  return !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET && env.DISCORD_BOT_TOKEN && env.DISCORD_GUILD_ID);
}

const apiBase = (env) => env.DISCORD_API_BASE || 'https://discord.com/api/v10';
const authorizeUrl = (env) => env.DISCORD_AUTHORIZE_URL || 'https://discord.com/oauth2/authorize';
const ids = (s) => String(s || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

export const MEMBER_SCHEMA = `CREATE TABLE IF NOT EXISTS discord_members (
  uid TEXT PRIMARY KEY,
  name TEXT,
  username TEXT,
  avatar TEXT,
  ok INTEGER NOT NULL DEFAULT 0,
  admin INTEGER NOT NULL DEFAULT 0,
  rang INTEGER NOT NULL DEFAULT 0,
  roles TEXT,
  checked_at INTEGER NOT NULL
)`;
// Für Datenbanken, in denen die Tabelle schon ohne „rang“ existiert
export const MEMBER_MIGRATIONS = [
  'ALTER TABLE discord_members ADD COLUMN rang INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE discord_members ADD COLUMN roles TEXT'
];

export function rankLimits(env) {
  return {
    min: Math.max(1, Number(env.POLIS_MIN_RANK) || 1),
    hb: Math.max(1, Number(env.POLIS_HB_MIN_RANK) || 4),
    gruppe: Math.max(1, Number(env.POLIS_GRUPPE_MIN_RANK) || 6)
  };
}

// ---------- Cookies & Signatur ----------
function b64url(bytes) {
  let s = '';
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function hmacKey(env) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode('polis-session:' + env.DISCORD_CLIENT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function sign(env, payload) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env), new TextEncoder().encode(body)));
  return body + '.' + b64url(sig);
}
async function verify(env, token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), b64urlDecode(sig), new TextEncoder().encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    return p && p.exp > Date.now() ? p : null;
  } catch { return null; }
}
function getCookie(request, name) {
  const all = request.headers.get('cookie') || '';
  for (const part of all.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return '';
}
function cookie(name, value, maxAgeSec) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}
function redirect(location, cookies = []) {
  const h = new Headers({ location, 'cache-control': 'no-store' });
  cookies.forEach((c) => h.append('set-cookie', c));
  return new Response(null, { status: 302, headers: h });
}
function jsonRes(data, status = 200, cookies = []) {
  const h = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  cookies.forEach((c) => h.append('set-cookie', c));
  return new Response(JSON.stringify(data), { status, headers: h });
}

// ---------- Rollen des Servers (Name -> Bedeutung), 10 Minuten gecacht ----------
let roleCache = null;
// Liste aller Rollen (ohne @everyone und Bot-Rollen), höchste zuerst
export async function guildRoleList(env) {
  await guildRoles(env);
  return roleCache.list;
}
async function guildRoles(env) {
  if (roleCache && Date.now() - roleCache.at < 10 * 60 * 1000) return roleCache.map;
  const r = await fetch(`${apiBase(env)}/guilds/${env.DISCORD_GUILD_ID}/roles`, {
    headers: { authorization: 'Bot ' + env.DISCORD_BOT_TOKEN }
  });
  if (!r.ok) {
    if (roleCache) return roleCache.map;
    throw new Error('Discord-Rollen nicht lesbar (' + r.status + ').');
  }
  const adminName = String(env.POLIS_ADMIN_ROLE_NAME || 'Datenbank Admin').trim().toLowerCase();
  const map = {};
  const list = [];
  for (const role of await r.json()) {
    const name = String(role.name || '').trim();
    const m = /^A\s*(\d{1,2})$/i.exec(name);
    map[role.id] = { rang: m ? Number(m[1]) : 0, admin: name.toLowerCase() === adminName };
    if (role.id !== env.DISCORD_GUILD_ID && !role.managed) {
      list.push({ id: role.id, name, position: role.position || 0, rang: map[role.id].rang, admin: map[role.id].admin });
    }
  }
  list.sort((a, b) => b.position - a.position);
  roleCache = { at: Date.now(), map, list };
  return map;
}

// ---------- Mitglied über den Bot prüfen ----------
async function fetchMember(env, uid) {
  const r = await fetch(`${apiBase(env)}/guilds/${env.DISCORD_GUILD_ID}/members/${uid}`, {
    headers: { authorization: 'Bot ' + env.DISCORD_BOT_TOKEN }
  });
  if (r.status === 404) return { found: false };
  if (!r.ok) throw new Error('Discord antwortet nicht (' + r.status + ').');
  const m = await r.json();
  const roles = m.roles || [];
  const u = m.user || {};
  const map = await guildRoles(env);
  const rang = roles.reduce((max, id) => Math.max(max, (map[id] && map[id].rang) || 0), 0);
  const admin = roles.some((id) => (map[id] && map[id].admin) || ids(env.POLIS_ADMIN_ROLE_IDS).includes(id));
  const extra = roles.some((id) => ids(env.POLIS_ROLE_IDS).includes(id));
  return {
    found: true,
    name: (m.nick || u.global_name || u.username || '').slice(0, 80),
    username: (u.username || '').slice(0, 40),
    avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : '',
    rang,
    roles,
    ok: true, // ob jemand rein darf, entscheiden die Rechte (lib/rechte.js)
    admin
  };
}

async function memberFor(env, db, uid, force) {
  const cached = await db.prepare('SELECT * FROM discord_members WHERE uid = ?').bind(uid).first();
  if (cached && cached.roles != null && !force && Date.now() - cached.checked_at < MEMBER_TTL) return withRoles(cached);
  let m;
  try { m = await fetchMember(env, uid); } catch (e) {
    if (cached) return withRoles(cached); // Discord kurz weg: letzten Stand weiter nutzen
    throw e;
  }
  const row = {
    uid, name: m.found ? m.name : (cached ? cached.name : ''), username: m.found ? m.username : (cached ? cached.username : ''),
    avatar: m.found ? m.avatar : '', ok: m.found && m.ok ? 1 : 0, admin: m.found && m.ok && m.admin ? 1 : 0,
    rang: m.found ? m.rang : 0, roles: JSON.stringify(m.found ? m.roles : []), checked_at: Date.now()
  };
  await db.prepare(
    `INSERT INTO discord_members (uid, name, username, avatar, ok, admin, rang, roles, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uid) DO UPDATE SET name = excluded.name, username = excluded.username, avatar = excluded.avatar,
       ok = excluded.ok, admin = excluded.admin, rang = excluded.rang, roles = excluded.roles, checked_at = excluded.checked_at`
  ).bind(row.uid, row.name, row.username, row.avatar, row.ok, row.admin, row.rang, row.roles, row.checked_at).run();
  return withRoles(row);
}
function withRoles(row) {
  let roles = [];
  try { roles = JSON.parse(row.roles || '[]'); } catch { /* leer */ }
  return Object.assign({}, row, { roles });
}

// ---------- Routen /api/auth/... ----------
// hasAccess(member) entscheidet, ob jemand nach dem Login rein darf (Recht „zugriff“)
export async function handleAuth(request, env, db, parts, hasAccess) {
  const url = new URL(request.url);
  const callbackUrl = url.origin + '/api/auth/discord/callback';

  if (parts[1] === 'discord' && parts[2] === 'login' && request.method === 'GET') {
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const q = new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID, response_type: 'code', redirect_uri: callbackUrl,
      scope: 'identify', state, prompt: 'none'
    });
    return redirect(authorizeUrl(env) + '?' + q.toString(), [cookie(STATE_COOKIE, state, 600)]);
  }

  if (parts[1] === 'discord' && parts[2] === 'callback' && request.method === 'GET') {
    const clearState = cookie(STATE_COOKIE, '', 0);
    const back = (reason) => redirect('/?login=' + reason, [clearState]);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (url.searchParams.get('error')) return back('abgebrochen');
    if (!code || !state || state !== getCookie(request, STATE_COOKIE)) return back('ungueltig');
    try {
      const tr = await fetch(apiBase(env) + '/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code', code, redirect_uri: callbackUrl
        })
      });
      if (!tr.ok) return back('fehler');
      const tok = await tr.json();
      const ur = await fetch(apiBase(env) + '/users/@me', { headers: { authorization: 'Bearer ' + tok.access_token } });
      if (!ur.ok) return back('fehler');
      const me = await ur.json();
      const m = await memberFor(env, db, String(me.id), true);
      if (!m.ok || !(await hasAccess(m))) return back('keine-rolle');
      const session = await sign(env, { uid: String(me.id), exp: Date.now() + SESSION_TTL });
      return redirect('/', [clearState, cookie(SESSION_COOKIE, session, SESSION_TTL / 1000)]);
    } catch {
      return back('fehler');
    }
  }

  if (parts[1] === 'logout' && request.method === 'POST') {
    return jsonRes({ ok: true }, 200, [cookie(SESSION_COOKIE, '', 0)]);
  }
  return null;
}

// Liefert das geprüfte Mitglied oder eine Fehler-Antwort.
export async function requireMember(request, env, db) {
  const s = await verify(env, getCookie(request, SESSION_COOKIE));
  if (!s) return { error: jsonRes({ error: 'Bitte mit Discord anmelden.', login: true }, 401) };
  let m;
  try { m = await memberFor(env, db, s.uid, false); } catch (e) {
    return { error: jsonRes({ error: e.message }, 502) };
  }
  if (!m.ok) return { error: noAccess() };
  return { member: m };
}

export function noAccess() {
  return jsonRes({ error: 'Kein Zugriff: Deine Discord-Rollen haben kein Recht, die Datenbank zu öffnen.', login: true }, 403, [cookie(SESSION_COOKIE, '', 0)]);
}
