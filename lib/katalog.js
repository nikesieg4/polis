/*
 * Strafkatalog Berlin City Roleplay (Stand: Aushang der Anwaltskanzlei).
 * Einzige Quelle für Server und Seite: die Seite lädt ihn über GET /api/katalog.
 *
 * nr     Nummer laut Aushang (eindeutig; Paragraphen kommen mehrfach vor)
 * geld   feste Geldstrafe in €
 * haft   true = Person kommt ins Gefängnis (Notruf Hamburg), ohne feste Dauer
 * zusatz z. B. „Diebesgut einziehen“
 * hinweis z. B. „nur für Polizisten“
 */

export const KATALOG = [
  // Straftaten
  { nr: 1, gruppe: 'Straftaten', para: '§ 211 StGB', name: 'Mord', geld: 8000, haft: true },
  { nr: 2, gruppe: 'Straftaten', para: '§ 223 StGB i.V.m. § 211b StGB', name: 'Versuchter Mord', geld: 5000, haft: true },
  { nr: 3, gruppe: 'Straftaten', para: '§ 224 StGB', name: 'Gefährliche Körperverletzung', geld: 8000, haft: true },
  { nr: 4, gruppe: 'Straftaten', para: '§ 223 StGB', name: 'Körperverletzung', geld: 5000, haft: false },
  { nr: 5, gruppe: 'Straftaten', para: '§ 239b StGB', name: 'Geiselnahme/Freiheitsberaubung', geld: 8000, haft: true },
  { nr: 6, gruppe: 'Straftaten', para: '§ 239 StGB i.V.m. § 239b StGB', name: 'Versuchte Geiselnahme', geld: 6000, haft: true },
  { nr: 7, gruppe: 'Straftaten', para: '§ 250 StGB', name: 'Schwerer Raub', geld: 6000, haft: true, zusatz: 'Diebesgut einziehen' },
  { nr: 8, gruppe: 'Straftaten', para: '§ 249 StGB', name: 'Raub', geld: 4500, haft: true, zusatz: 'Diebesgut einziehen' },
  { nr: 9, gruppe: 'Straftaten', para: '§ 242 StGB', name: 'Diebstahl', geld: 1000, haft: false, zusatz: 'Diebesgut einziehen' },
  { nr: 10, gruppe: 'Straftaten', para: '§ 114 StGB', name: 'Tätlicher Angriff auf Vollstreckungsbeamte', geld: 3000, haft: false },
  { nr: 11, gruppe: 'Straftaten', para: '§ 259 StGB', name: 'Hehlerei', geld: 3000, haft: false, zusatz: 'Hehlerware einziehen' },
  { nr: 12, gruppe: 'Straftaten', para: '§ 52 WaffG', name: 'Illegales Abfeuern einer Schusswaffe', geld: 4000, haft: false },
  { nr: 13, gruppe: 'Straftaten', para: '§ 52 WaffG', name: 'Illegaler Waffenbesitz', geld: 4000, haft: false },
  { nr: 14, gruppe: 'Straftaten', para: '§ 113 Abs. 2 StGB', name: 'Widerstand gegen Vollstreckungsbeamte', geld: 6000, haft: false },
  { nr: 15, gruppe: 'Straftaten', para: '§ 164 StPO', name: 'Entziehung einer Amtshandlung', geld: 2500, haft: false },
  { nr: 16, gruppe: 'Straftaten', para: '§ 120 StGB', name: 'Gefangenenbefreiung', geld: 4000, haft: true },
  { nr: 17, gruppe: 'Straftaten', para: '§ 241 StGB', name: 'Mord- oder Verletzungsdrohung', geld: 4000, haft: false },
  { nr: 18, gruppe: 'Straftaten', para: '§ 153 StGB', name: 'Falschaussage vor Beamten', geld: 2000, haft: false },
  { nr: 19, gruppe: 'Straftaten', para: '§ 334 StGB', name: 'Bestechung', geld: 5000, haft: false },
  { nr: 20, gruppe: 'Straftaten', para: '§ 339 StGB', name: 'Amtsmissbrauch', geld: 5000, haft: false, hinweis: 'für Polizisten' },
  { nr: 21, gruppe: 'Straftaten', para: '§ 123 StGB', name: 'Hausfriedensbruch', geld: 2500, haft: false },
  { nr: 22, gruppe: 'Straftaten', para: '§ 27 StGB', name: 'Beihilfe', geld: 3000, haft: false },
  { nr: 23, gruppe: 'Straftaten', para: '§ 126 StGB i.V.m. § 241 StGB', name: 'Androhung einer Straftat', geld: 2000, haft: false },
  { nr: 24, gruppe: 'Straftaten', para: '§ 23 StGB', name: 'Strafbarkeit des Versuchs', geld: 2500, haft: false },
  { nr: 25, gruppe: 'Straftaten', para: '§ 323c StGB', name: 'Unterlassene Hilfeleistung', geld: 2500, haft: false },
  { nr: 26, gruppe: 'Straftaten', para: '§ 113 StGB', name: 'Behinderung der Polizeiarbeit', geld: 3500, haft: false },
  { nr: 27, gruppe: 'Straftaten', para: '§ 315c StGB', name: 'Gefährdung des Straßenverkehrs', geld: 4000, haft: false },
  // Ordnungswidrigkeiten (Nr. 40, 42 und 43 stehen doppelt im Aushang: gleich wie 18, 36 und 37)
  { nr: 31, gruppe: 'Ordnungswidrigkeiten', para: '§ 267 StGB', name: 'Urkundenfälschung', geld: 2500, haft: false },
  { nr: 32, gruppe: 'Ordnungswidrigkeiten', para: '§ 258a StGB', name: 'Strafvereitelung im Amt', geld: 3500, haft: false, hinweis: 'für Polizisten' },
  { nr: 33, gruppe: 'Ordnungswidrigkeiten', para: '§ 315 StGB', name: 'Gefährlicher Eingriff in den Bahn- und Schiffsverkehr', geld: 2500, haft: false },
  { nr: 34, gruppe: 'Ordnungswidrigkeiten', para: '§ 315b StGB', name: 'Gefährlicher Eingriff in den Straßenverkehr', geld: 2500, haft: false },
  { nr: 35, gruppe: 'Ordnungswidrigkeiten', para: '§ 315d StGB', name: 'Verbotene Kraftfahrzeugrennen', geld: 3000, haft: false },
  { nr: 36, gruppe: 'Ordnungswidrigkeiten', para: '§ 305a StGB', name: 'Sachbeschädigung von Einsatzmitteln', geld: 2000, haft: false },
  { nr: 37, gruppe: 'Ordnungswidrigkeiten', para: '§ 303 StGB', name: 'Sachbeschädigung im / am Gebäude', geld: 1500, haft: false },
  { nr: 38, gruppe: 'Ordnungswidrigkeiten', para: '§ 32 StGB', name: 'Amtsanmaßung', geld: 2500, haft: false },
  { nr: 39, gruppe: 'Ordnungswidrigkeiten', para: '§ 145 StGB', name: 'Missbrauch des Notrufs', geld: 2500, haft: false },
  { nr: 41, gruppe: 'Ordnungswidrigkeiten', para: '§ 153a StGB', name: 'Falschaussage vor Beamten', geld: 2000, haft: false },
  { nr: 44, gruppe: 'Ordnungswidrigkeiten', para: '§ 142 StGB', name: 'Unerlaubtes Entfernen vom Unfallort', geld: 2000, haft: false },
  { nr: 45, gruppe: 'Ordnungswidrigkeiten', para: '§ 34 StVO i.V.m. § 315b StGB', name: 'Unfall', geld: 2500, haft: false },
  { nr: 46, gruppe: 'Ordnungswidrigkeiten', para: '§ 34 StVO', name: 'Unfall', geld: 2500, haft: false },
  { nr: 47, gruppe: 'Ordnungswidrigkeiten', para: 'Verstoß StVO', name: 'Ordnungswidrigkeiten (im Straßenverkehr)', geld: 2000, haft: false },
  { nr: 48, gruppe: 'Ordnungswidrigkeiten', para: '§ 23 StVO', name: 'Sonstige Pflichten von Fahrzeugführenden', geld: 1500, haft: false },
  { nr: 49, gruppe: 'Ordnungswidrigkeiten', para: '§ 12 StVO', name: 'Halten und Parken', geld: 1000, haft: false },
  { nr: 50, gruppe: 'Ordnungswidrigkeiten', para: '§ 3 StVO', name: 'Geschwindigkeit (unter 30 km/h zu schnell)', geld: 2000, haft: false },
  { nr: 51, gruppe: 'Ordnungswidrigkeiten', para: '§ 3 StVO', name: 'Geschwindigkeit (30 bis 50 km/h zu schnell)', geld: 2500, haft: false },
  { nr: 52, gruppe: 'Ordnungswidrigkeiten', para: '§ 3 StVO', name: 'Geschwindigkeit (über 70 km/h zu schnell)', geld: 3000, haft: false }
];

export const KATALOG_BY_NR = Object.fromEntries(KATALOG.map((k) => [k.nr, k]));
export const label = (k) => k.para + ' ' + k.name;
// Eintrag aus dem Strafregister -> Katalogeintrag (über nr, sonst über den Text)
export function katalogFuer(row) {
  if (row.nr && KATALOG_BY_NR[row.nr]) return KATALOG_BY_NR[row.nr];
  return KATALOG.find((k) => label(k) === row.delikt) || null;
}
