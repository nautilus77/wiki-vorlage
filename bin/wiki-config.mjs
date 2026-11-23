#!/usr/bin/env node
// wiki.json: Steckbrief eines Wikis für Werkzeuge und den automatischen Lauf.
// Aufruf: wiki-config pruefen <wiki.json>   Exit 0 = gültig, 1 = ungültig (oder nicht lesbar), 2 = falscher Aufruf.
// Felder:
//   name             Kennung des Wikis (Kleinbuchstaben, Ziffern, Bindestrich), z. B. „beispiel-wissen“
//   betreiber        optional: Akteur-Kennung des Betreibers (human:<betreiber>, entscheidet, wortlaut-<betreiber>)
//   eingang.quelle   Ort der Rohquellen im rclone-Stil „remote:pfad“ (werkzeugunabhängig: WebDAV, Google Drive …)
//   eingang.lokal    Arbeitskopie des Eingangs, relativ zur Wiki-Wurzel (z. B. ../eingang)
//   register         Register der eingearbeiteten Eingangsdateien, relativ im Repo (z. B. projekt/eingang-register.md)
//   zielmodus        „direkt-main“ (Push nach Diff-Wächter direkt auf main) | „pr-automerge“ (Zweig + Pull Request mit Automerge)
//   ki_autoren       optional: Autor-E-Mails der automatischen Einarbeitung (Server/Bot); nur deren Commits prüft der
//                    Diff-Wächter in CI (F27), Korrekturen des Betreibers bleiben frei
//   pseudonym_liste.quelle  Ort der Zuordnungsliste „Klarname => Pseudonym“ (nie im Repo), rclone-Stil
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ZIELMODI = ['direkt-main', 'pr-automerge'];
const FELDER = ['name', 'betreiber', 'eingang', 'register', 'zielmodus', 'pseudonym_liste', 'ki_autoren'];
const RCLONE = /^[A-Za-z0-9_][A-Za-z0-9_. -]*:\S.*$/;
const KENNUNG = /^[a-z0-9][a-z0-9._-]*$/;

const istObjekt = (w) => w !== null && typeof w === 'object' && !Array.isArray(w);
const relativImRepo = (p) => typeof p === 'string' && p !== '' && !isAbsolute(p) && !posix.normalize(p).startsWith('../') && posix.normalize(p) !== '..';

// Liste der Fehler (leer = gültig)
export function pruefeConfig(c) {
  if (!istObjekt(c)) return ['wiki.json muss ein Objekt sein'];
  const f = [];
  for (const k of Object.keys(c)) if (!FELDER.includes(k)) f.push(`unbekanntes Feld „${k}“ (erlaubt: ${FELDER.join(', ')})`);
  if (typeof c.name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(c.name)) f.push('name: fehlt oder nicht in Kleinbuchstaben/Ziffern/Bindestrich');
  if (c.betreiber !== undefined && !(typeof c.betreiber === 'string' && KENNUNG.test(c.betreiber))) f.push('betreiber: Akteur-Kennung in Kleinbuchstaben (z. B. „betreiber“)');
  if (!istObjekt(c.eingang)) f.push('eingang: fehlt (Objekt mit quelle und lokal)');
  else {
    if (typeof c.eingang.quelle !== 'string' || !RCLONE.test(c.eingang.quelle)) f.push('eingang.quelle: im rclone-Stil „remote:pfad“ angeben');
    if (typeof c.eingang.lokal !== 'string' || c.eingang.lokal === '' || isAbsolute(c.eingang.lokal)) f.push('eingang.lokal: relativer Pfad zur Wiki-Wurzel (z. B. ../eingang)');
    for (const k of Object.keys(c.eingang)) if (!['quelle', 'lokal'].includes(k)) f.push(`eingang: unbekanntes Feld „${k}“`);
  }
  if (!relativImRepo(c.register)) f.push('register: fehlt oder kein relativer Pfad im Repo');
  if (!ZIELMODI.includes(c.zielmodus)) f.push(`zielmodus: „${c.zielmodus ?? '–'}“ nicht erlaubt (${ZIELMODI.join(' | ')})`);
  if (c.ki_autoren !== undefined && !(Array.isArray(c.ki_autoren) && c.ki_autoren.every((a) => typeof a === 'string' && /^[^\s@]+@[^\s@]+$/.test(a))))
    f.push('ki_autoren: Liste von E-Mail-Adressen (Autoren der automatischen Einarbeitung)');
  if (!istObjekt(c.pseudonym_liste)) f.push('pseudonym_liste: fehlt (Objekt mit quelle)');
  else {
    if (typeof c.pseudonym_liste.quelle !== 'string' || !RCLONE.test(c.pseudonym_liste.quelle)) f.push('pseudonym_liste.quelle: im rclone-Stil „remote:pfad“ angeben');
    for (const k of Object.keys(c.pseudonym_liste)) if (k !== 'quelle') f.push(`pseudonym_liste: unbekanntes Feld „${k}“`);
  }
  return f;
}

const istHauptprogramm = (url) => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
};

if (istHauptprogramm(import.meta.url)) {
  const [modus, datei, ...rest] = process.argv.slice(2);
  if (modus !== 'pruefen' || !datei || rest.length) {
    console.error('Aufruf: wiki-config pruefen <wiki.json>');
    process.exit(2);
  }
  let c;
  try {
    c = JSON.parse(readFileSync(datei, 'utf8'));
  } catch (e) {
    console.log(`✗ ${datei} nicht lesbar: ${e.code ?? e.message}`);
    process.exit(1);
  }
  const f = pruefeConfig(c);
  if (f.length) {
    console.log(`✗ ${datei}: ${f.length} Fehler\n${f.map((z) => `  ${z}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`✓ ${datei} gültig (${c.name}, ${c.zielmodus})`);
  process.exit(0);
}
