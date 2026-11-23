#!/usr/bin/env node
// Regelkern: schreibt regeln/AGENTS-kern.md dieser Vorlage als Kopie zwischen Markern (mit Version) in die AGENTS.md
// eines Wikis und prüft, ob die Kopie noch stimmt.
// Aufruf: wiki-regelkern --schreiben <AGENTS.md>   legt die Datei an oder ersetzt nur den Block zwischen den Markern;
//                                                  fehlt der Block, kommt er an den Anfang, danach „## Nur dieses Wiki“
//         wiki-regelkern --pruefen <AGENTS.md>     Exit 0 = Block genau einmal da und wortgleich mit dieser Version,
//                                                  1 = Abweichung (oder Datei/Marker fehlen), 2 = falscher Aufruf
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = dirname(dirname(fileURLToPath(import.meta.url)));
export const VERSION = JSON.parse(readFileSync(join(WURZEL, 'package.json'), 'utf8')).version;
const ANFANG = '<!-- wiki-regelkern:anfang';
const ENDE = '<!-- wiki-regelkern:ende -->';

export const kern = () => readFileSync(join(WURZEL, 'regeln', 'AGENTS-kern.md'), 'utf8').replace(/\r\n?/g, '\n').trim();

export const block = () =>
  `${ANFANG} v${VERSION} · Kopie aus wiki-vorlage/regeln/AGENTS-kern.md, nicht von Hand ändern (wiki-regelkern --schreiben) -->\n` +
  `${kern()}\n${ENDE}`;

const NUR_DIESES_WIKI = '## Nur dieses Wiki\n\n(Regeln, die nur für dieses Wiki gelten: Eingang, Register, Pseudonym-Liste, Besonderheiten.)\n';

// Lage des Blocks: { start, ende } oder null; mehrere Blöcke → 'mehrfach'
function finde(text) {
  const start = text.indexOf(ANFANG);
  if (start < 0) return null;
  const e = text.indexOf(ENDE, start);
  if (e < 0) return null;
  if (text.indexOf(ANFANG, start + 1) >= 0) return 'mehrfach';
  return { start, ende: e + ENDE.length };
}

export function schreiben(datei) {
  const text = existsSync(datei) ? readFileSync(datei, 'utf8').replace(/\r\n?/g, '\n') : '';
  const lage = finde(text);
  if (lage === 'mehrfach') throw new Error('Regelkern-Block mehrfach vorhanden – von Hand bereinigen');
  let neu;
  if (lage) neu = text.slice(0, lage.start) + block() + text.slice(lage.ende);
  else if (text.trim()) neu = `${block()}\n\n${text.replace(/^\n+/, '')}`;
  else neu = `${block()}\n\n${NUR_DIESES_WIKI}`;
  writeFileSync(datei, neu.endsWith('\n') ? neu : `${neu}\n`);
}

export function pruefen(datei) {
  if (!existsSync(datei)) return [`${datei} fehlt`];
  const text = readFileSync(datei, 'utf8').replace(/\r\n?/g, '\n');
  const lage = finde(text);
  if (lage === null) return ['Regelkern-Block (Marker) fehlt'];
  if (lage === 'mehrfach') return ['Regelkern-Block mehrfach vorhanden'];
  const ist = text.slice(lage.start, lage.ende);
  const soll = block();
  if (ist === soll) return [];
  const kopfIst = ist.split('\n')[0];
  if (!kopfIst.startsWith(`${ANFANG} v${VERSION} `)) return [`Regelkern-Version weicht ab: „${kopfIst}“, erwartet v${VERSION}`];
  const a = ist.split('\n');
  const b = soll.split('\n');
  const n = a.findIndex((z, i) => z !== b[i]);
  return [`Regelkern weicht ab (erste Abweichung in Zeile ${n + 1} des Blocks: „${(a[n] ?? '').slice(0, 80)}“)`];
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
  if (!['--schreiben', '--pruefen'].includes(modus) || !datei || rest.length) {
    console.error('Aufruf: wiki-regelkern --schreiben|--pruefen <AGENTS.md>');
    process.exit(2);
  }
  try {
    if (modus === '--schreiben') {
      schreiben(datei);
      console.log(`✓ Regelkern v${VERSION} in ${datei} geschrieben`);
      process.exit(0);
    }
    const f = pruefen(datei);
    if (f.length) {
      console.log(`✗ ${datei}: ${f.join('; ')}`);
      process.exit(1);
    }
    console.log(`✓ ${datei}: Regelkern v${VERSION} unverändert`);
    process.exit(0);
  } catch (e) {
    console.error(`Regelkern nicht möglich: ${e.message}`);
    process.exit(e.message.includes('mehrfach') ? 1 : 2);
  }
}
