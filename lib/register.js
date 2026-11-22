/*
 * Polizei-Register: Liste der Beamten mit Dienstnummer, Rang, Status, Eintritt, Ausbildungen und Notizen.
 * Rechte: „register_sehen“, „register_bearbeiten“ (z. B. Ausbilder).
 */

export const REGISTER_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS beamte (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     dienstnummer TEXT,
     rang TEXT,
     discord TEXT,
     eintritt TEXT,
     status TEXT NOT NULL DEFAULT 'Aktiv',
     ausbildungen TEXT,
     notizen TEXT,
     updated_at INTEGER,
     updated_by TEXT
   )`
];
const STATUS = ['Aktiv', 'In Ausbildung', 'Beurlaubt', 'Suspendiert', 'Ausgeschieden'];

function out(r) {
  return { id: r.id, name: r.name, dienstnummer: r.dienstnummer || '', rang: r.rang || '', discord: r.discord || '',
    eintritt: r.eintritt || '', status: r.status, ausbildungen: r.ausbildungen || '', notizen: r.notizen || '',
    updatedAt: r.updated_at, updatedBy: r.updated_by || '' };
}

export async function handleRegister(c) {
  const { request, method, parts, db, can, beamter, json, fail, readBody, logIt, clean } = c;

  if (parts.length === 1 && method === 'GET') {
    if (!can('register_sehen')) return fail(403, 'Du darfst das Polizei-Register nicht ansehen.');
    const { results } = await db.prepare('SELECT * FROM beamte ORDER BY name').all();
    let discord = [];
    if (can('register_bearbeiten')) {
      const r = await db.prepare('SELECT name, username FROM discord_members WHERE ok = 1 ORDER BY name').all();
      discord = r.results.map((x) => ({ name: x.name, username: x.username }));
    }
    return json({ beamte: results.map(out), status: STATUS, discord });
  }

  if (!can('register_bearbeiten')) return fail(403, 'Du darfst das Polizei-Register nicht bearbeiten.');
  const read = async () => {
    const b = await readBody(request);
    const v = {
      name: clean(b.name, 80), dienstnummer: clean(b.dienstnummer, 30), rang: clean(b.rang, 40),
      discord: clean(b.discord, 60).replace(/^@+/, ''), eintritt: /^\d{4}-\d{2}-\d{2}$/.test(b.eintritt || '') ? b.eintritt : '',
      status: STATUS.includes(b.status) ? b.status : 'Aktiv',
      ausbildungen: String(b.ausbildungen || '').replace(/\r/g, '').trim().slice(0, 1000),
      notizen: String(b.notizen || '').replace(/\r/g, '').trim().slice(0, 2000)
    };
    return v;
  };

  // Gleicher Beamter darf nur einmal im Register stehen: gleicher Discord-Name, gleiche Dienstnummer oder gleicher Name
  const doppelt = async (v, ohneId) => {
    const gleich = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
    const { results } = await db.prepare('SELECT * FROM beamte WHERE id != ?').bind(ohneId || 0).all();
    let grund = '';
    const r = results.find((x) => {
      if (gleich(x.discord, v.discord)) { grund = 'gleicher Discord-Name @' + x.discord; return true; }
      if (gleich(x.dienstnummer, v.dienstnummer)) { grund = 'gleiche Dienstnummer ' + x.dienstnummer; return true; }
      if (gleich(x.name, v.name)) { grund = 'gleicher Name'; return true; }
      return false;
    });
    if (!r) return null;
    return json({ error: 'Dieser Beamte steht schon im Register: ' + r.name + (r.dienstnummer ? ' (' + r.dienstnummer + ')' : '') +
      ' – ' + grund + '.', vorhandenId: r.id }, 409);
  };

  if (parts.length === 1 && method === 'POST') {
    const v = await read();
    if (!v.name) return fail(400, 'Name fehlt.');
    const d = await doppelt(v);
    if (d) return d;
    const row = await db.prepare(
      `INSERT INTO beamte (name, dienstnummer, rang, discord, eintritt, status, ausbildungen, notizen, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).bind(v.name, v.dienstnummer, v.rang, v.discord, v.eintritt, v.status, v.ausbildungen, v.notizen, Date.now(), beamter).first();
    await logIt('Beamter eingetragen', null, v.name + (v.dienstnummer ? ' (' + v.dienstnummer + ')' : '')).run();
    return json({ beamter: out(row) }, 201);
  }

  const id = Number(parts[1]);
  const old = Number.isInteger(id) ? await db.prepare('SELECT * FROM beamte WHERE id = ?').bind(id).first() : null;
  if (!old) return fail(404, 'Eintrag nicht gefunden.');

  if (parts.length === 2 && method === 'PUT') {
    const v = await read();
    if (!v.name) return fail(400, 'Name fehlt.');
    const d = await doppelt(v, id);
    if (d) return d;
    const row = await db.prepare(
      `UPDATE beamte SET name = ?, dienstnummer = ?, rang = ?, discord = ?, eintritt = ?, status = ?, ausbildungen = ?, notizen = ?,
         updated_at = ?, updated_by = ? WHERE id = ? RETURNING *`
    ).bind(v.name, v.dienstnummer, v.rang, v.discord, v.eintritt, v.status, v.ausbildungen, v.notizen, Date.now(), beamter, id).first();
    const ch = [];
    if (old.rang !== v.rang) ch.push('Rang: ' + (old.rang || 'leer') + ' zu ' + (v.rang || 'leer'));
    if (old.status !== v.status) ch.push('Status: ' + old.status + ' zu ' + v.status);
    if ((old.ausbildungen || '') !== v.ausbildungen) ch.push('Ausbildungen geändert');
    if ((old.notizen || '') !== v.notizen) ch.push('Notizen geändert');
    if (old.name !== v.name || (old.dienstnummer || '') !== v.dienstnummer || (old.discord || '') !== v.discord || (old.eintritt || '') !== v.eintritt) ch.push('Stammdaten geändert');
    if (ch.length) await logIt('Beamter geändert', null, v.name + ': ' + ch.join(', ')).run();
    return json({ beamter: out(row) });
  }

  if (parts.length === 2 && method === 'DELETE') {
    await db.batch([
      db.prepare('DELETE FROM beamte WHERE id = ?').bind(id),
      logIt('Beamter entfernt', null, old.name + (old.dienstnummer ? ' (' + old.dienstnummer + ')' : ''))
    ]);
    return json({ ok: true });
  }
  return null;
}
