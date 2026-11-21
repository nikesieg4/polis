/*
 * Rollen des Polizei-Discords (Polizei A1–A18, Kripo B1–B12, SEK S1–S16) mit vorgeschlagenen Rechten.
 * Diese Voreinstellung gilt nur, solange die Rechte-Tabelle auf der Seite „Rechte“ noch nie gespeichert wurde.
 * Danach zählt ausschließlich, was dort angehakt ist.
 */

export const ROLLEN = {
  // Polizei
  '1469859437031329824': 'A18', // Polizei Leitung
  '1469859858479186081': 'A17', // Stv. Polizei Leitung
  '1462428234036547757': 'A16', // Polizei Ausbilderleitung
  '1462374115062185984': 'A15', // Stv. Polizei Ausbilderleitung
  '1536447626902511666': 'A14', // Polizei Ausbilder
  '1462374111371071499': 'A13', // Polizeidirektor
  '1464563189248168162': 'A12', // Polizei-Oberrat
  '1462374116664545415': 'A11', // Polizeirat
  '1462374116580659222': 'A10', // Erster Polizeihauptkommissar
  '1462374117444554923': 'A9',  // Polizeihauptkommissar
  '1462428225945997508': 'A8',  // Polizeikommissar
  '1464143066171572244': 'A7',  // Polizeikommissar Anwärter
  '1464142201457213564': 'A6',  // Erster Polizeihauptmeister
  '1462428229821268123': 'A5',  // Polizeihauptmeister
  '1462428230853328980': 'A4',  // Polizeimeister
  '1462428230014468253': 'A3',  // Polizeimeister-Anwärter
  '1464273693738799337': 'A2',  // Polizist
  '1485976895786061925': 'A1',  // Polizei-Anwärter
  // Kripo
  '1469856352909398168': 'B12', // Kripo Leitung
  '1469856350543548548': 'B11', // Stv. Kripo Leitung
  '1482782534130602134': 'B10', // Kripo Management
  '1482782773961031772': 'B9',  // Stv. Kripo Management
  '1469854739255529472': 'B8',  // Kripo Ausbilder
  '1555539527378927677': 'B7',  // Kripo Undercover
  '1485591188315570317': 'B6',  // Kripo Spurensicherung
  '1485591702940029060': 'B5',  // Kripo Stellv. Spurensicherung
  '1469854750857101365': 'B4',  // Kriminalobermeister
  '1469854751767138478': 'B3',  // Kriminalmeister
  '1469854754254622926': 'B2',  // Kripomitglied
  '1469854754774581288': 'B1',  // Kripo in Ausbildung
  // SEK
  '1469989163024777216': 'S16', // SEK Leitung
  '1469987571634536452': 'S15', // Stv. SEK Leitung
  '1502018773866250321': 'S14', // SEK Management
  '1542934628988493895': 'S13', // SEK Supervisor
  '1534274166742847578': 'S12', // SEK Ausbilderleitung
  '1534274167971512331': 'S11', // Stv. SEK Ausbilderleitung
  '1469987574020833452': 'S10', // SEK Ausbilder
  '1544776829938831461': 'S9',  // SEK Truppführer
  '1502018770066083870': 'S8',  // SEK Hauptoperator
  '1502018186059710564': 'S7',  // SEK Operator
  '1502018184046317618': 'S6',  // SEK Hauptspezialist
  '1502018124269228203': 'S5',  // SEK Spezialist
  '1502017589977809050': 'S4',  // SEK Hauptbeamter
  '1502017583585431745': 'S3',  // SEK Beamter
  '1502015362382954637': 'S2',  // SEK Anwärter
  '1469987565317918814': 'S1'   // SEK in Ausbildung
};

// Ab welcher Stufe je Bereich (A = Polizei, B = Kripo, S = SEK) ein Recht vorgeschlagen wird.
// null = dieser Bereich bekommt das Recht nicht.
const AB = {
  zugriff:             { A: 1,  B: 1,  S: 1 },
  personen:            { A: 1,  B: 1,  S: 1 },
  strafen:             { A: 1,  B: 1,  S: 1 },
  beschreibung:        { A: 1,  B: 1,  S: 1 },
  protokoll:           { A: 1,  B: 1,  S: 1 },
  schicht:             { A: 1,  B: 1,  S: 1 },
  register_sehen:      { A: 1,  B: 1,  S: 1 },
  kripo_sehen:         { A: 1,  B: 1,  S: 1 },   // alle sollen wissen, wen sie nicht festnehmen
  kripo_setzen:        { A: 17, B: 2,  S: null }, // Kripo ab Kripomitglied, Polizei Leitung
  haftbefehle:         { A: 4,  B: 3,  S: 3 },   // Polizeimeister, Kriminalmeister, SEK Beamter
  gruppen:             { A: 6,  B: 4,  S: 9 },   // Erster Polizeihauptmeister, Kriminalobermeister, SEK Truppführer
  register_bearbeiten: { A: 14, B: 8,  S: 10 },  // ab den Ausbildern
  schicht_alle:        { A: 17, B: 9,  S: 13 },  // Leitung und Management der Bereiche
  quote:               { A: 17, B: null, S: null }, // eine Quote für alle: nur Polizei Leitung
  admin:               { A: 17, B: null, S: null }, // Polizei Leitung und Stellvertretung
  rechte:              { A: 18, B: null, S: null }  // nur Polizei Leitung
};

// Rechte-Vorschlag für eine bekannte Rolle, sonst null
export function vorschlagFuer(roleId) {
  const code = ROLLEN[roleId];
  if (!code) return null;
  const bereich = code[0], stufe = Number(code.slice(1));
  return Object.keys(AB).filter((k) => AB[k][bereich] != null && stufe >= AB[k][bereich]);
}
