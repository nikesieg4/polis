/*
 * Rechte pro Discord-Rolle.
 *
 * Die Tabelle „rechte“ speichert, welche Rolle welches Recht hat. Solange sie noch nie
 * gespeichert wurde, gelten Voreinstellungen nach Rollennamen (A1 … A10, „Ausbilder“).
 * Wer die Admin-Rolle („Datenbank Admin“) hat, hat immer alle Rechte – so kann sich
 * niemand aus der Rechteverwaltung aussperren.
 */

import { vorschlagFuer } from './rollen.js';

export const PERMS = [
  { key: 'zugriff', label: 'Datenbank öffnen', desc: 'Personen, Strafregister, Haftbefehle und Gruppierungen ansehen' },
  { key: 'personen', label: 'Personen anlegen', desc: 'Neue Personen anlegen, Status und „Gefährlich“ ändern' },
  { key: 'strafen', label: 'Strafen vergeben', desc: 'Strafen vergeben, anpassen, erledigen und ausstehende entfernen' },
  { key: 'beschreibung', label: 'Personen beschreiben', desc: 'Gruppierung, Rang und Beschreibung einer Person ändern' },
  { key: 'haftbefehle', label: 'Haftbefehle bearbeiten', desc: 'Haftbefehle ausstellen, vollstrecken und aufheben' },
  { key: 'gruppen', label: 'Gruppierungen beschreiben', desc: 'Beschreibung einer Gruppierung ändern' },
  { key: 'protokoll', label: 'Protokoll ansehen', desc: 'Wer hat wann was eingetragen' },
  { key: 'kripo_sehen', label: 'Kripo-Markierung sehen', desc: 'Sehen, welche Personen als Kripo-Mitglied markiert sind (inkl. Hinweis)' },
  { key: 'kripo_setzen', label: 'Kripo-Markierung setzen', desc: 'Personen als Kripo-Mitglied markieren, Hinweis ändern, Markierung entfernen' },
  { key: 'schicht', label: 'Schichtzeit erfassen', desc: 'Eigene Schicht starten, pausieren und beenden' },
  { key: 'schicht_alle', label: 'Management: Schichtzeiten', desc: 'Schichtzeit aller Beamten sehen' },
  { key: 'quote', label: 'Management: Wochenquote', desc: 'Wochenquote für die Schichtzeit festlegen' },
  { key: 'register_sehen', label: 'Polizei-Register ansehen', desc: 'Liste aller Beamten mit Rang und Ausbildungen' },
  { key: 'register_bearbeiten', label: 'Polizei-Register bearbeiten', desc: 'Beamte eintragen, ändern, Ausbildungen vermerken (z. B. Ausbilder)' },
  { key: 'admin', label: 'Admin', desc: 'Personen umbenennen und löschen, erledigte Strafen und Haftbefehle löschen' },
  { key: 'rechte', label: 'Rechte verwalten', desc: 'Diese Tabelle ändern' }
];
export const PERM_KEYS = PERMS.map((p) => p.key);

export const RECHTE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS rechte (perm TEXT NOT NULL, role_id TEXT NOT NULL, PRIMARY KEY (perm, role_id))`,
  `CREATE TABLE IF NOT EXISTS einstellungen (key TEXT PRIMARY KEY, value TEXT)`
];

function defaults(env) {
  return {
    rank: {
      zugriff: Math.max(1, Number(env.POLIS_MIN_RANK) || 1),
      personen: 1, strafen: 1, beschreibung: 1, protokoll: 1, schicht: 1, register_sehen: 1, kripo_sehen: 1,
      haftbefehle: Math.max(1, Number(env.POLIS_HB_MIN_RANK) || 4),
      gruppen: Math.max(1, Number(env.POLIS_GRUPPE_MIN_RANK) || 6)
    },
    // Rollen, deren Name dieses Wort enthält
    names: { register_bearbeiten: ['ausbilder'] }
  };
}

// Voreinstellung aus den Rollennamen
export function defaultMatrix(env, roles) {
  const d = defaults(env);
  const m = {};
  PERM_KEYS.forEach((k) => { m[k] = []; });
  for (const r of roles) {
    if (r.admin) continue; // Admin hat sowieso alles
    // Bekannte Rollen des Polizei-Discords: Vorschlag aus lib/rollen.js
    const v = vorschlagFuer(r.id);
    if (v) { v.forEach((k) => m[k].push(r.id)); continue; }
    for (const k of PERM_KEYS) {
      if (d.rank[k] && r.rang >= d.rank[k]) m[k].push(r.id);
      else if (d.names[k] && d.names[k].some((w) => r.name.toLowerCase().includes(w))) m[k].push(r.id);
    }
  }
  return m;
}

export async function loadMatrix(env, db, roles) {
  const saved = await db.prepare("SELECT value FROM einstellungen WHERE key = 'rechte_gespeichert'").first();
  if (!saved) return { matrix: defaultMatrix(env, roles), gespeichert: false };
  const { results } = await db.prepare('SELECT perm, role_id FROM rechte').all();
  const m = {};
  PERM_KEYS.forEach((k) => { m[k] = []; });
  for (const r of results) if (m[r.perm]) m[r.perm].push(r.role_id);
  return { matrix: m, gespeichert: true, am: Number(saved.value) || null };
}

export function permsFor(member, matrix) {
  if (member.admin) return new Set(PERM_KEYS);
  const roles = new Set(member.roles || []);
  return new Set(PERM_KEYS.filter((k) => (matrix[k] || []).some((id) => roles.has(id))));
}

export async function saveMatrix(db, matrix, validRoleIds) {
  const valid = new Set(validRoleIds);
  const stmts = [db.prepare('DELETE FROM rechte')];
  for (const k of PERM_KEYS) {
    const ids = Array.isArray(matrix[k]) ? matrix[k] : [];
    for (const id of new Set(ids.map(String))) if (valid.has(id)) stmts.push(db.prepare('INSERT INTO rechte (perm, role_id) VALUES (?, ?)').bind(k, id));
  }
  stmts.push(db.prepare("INSERT INTO einstellungen (key, value) VALUES ('rechte_gespeichert', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(Date.now())));
  await db.batch(stmts);
}
