#!/usr/bin/env node
// Diff-Wächter: prüft die Änderungen zwischen zwei Git-Referenzen im aktuellen Repo, bevor eine automatische Einarbeitung
// veröffentlicht wird (und in CI nach jedem Push).
// Aufruf: wiki-diffwaechter <base> <head>
// 1. Pfade: erlaubt sind nur Dateien unter wiki/ und projekt/eingang-register.md (hinzufügen, ändern, löschen).
//    Alles andere (Regeln, Werkzeuge, Workflows, package*.json, wiki.json …) wird abgelehnt.
// 2. Namen: hinzugefügte Zeilen in erlaubten Dateien dürfen keinen Klarnamen aus der Pseudonym-Liste enthalten.
//    Liste in $PSEUDO_LISTE, Zeilen „Klarname => Pseudonym“, „#“ = Kommentar. Groß/klein egal; der Name zählt ab
//    Wortanfang. Ausgenommen sind Repo-Namen und Domains: Name direkt gefolgt von -wissen, -eingang, -intern, -website
//    (auch mit Zwischenteil, z. B. name-muster-website) oder von einem Domain-Teil (name.de, namemuster.de; Dateiendungen
//    wie .md zählen nicht als Domain).
//    Ist PSEUDO_LISTE leer oder nicht gesetzt (CI), wird nur der Pfadteil geprüft. Gesetzt, aber nicht lesbar → Exit 2.
//    Meldungen nennen Datei und Zeile, nie den Namen selbst.
// Exit 0 = in Ordnung, 1 = abgelehnt, 2 = Prüfung nicht möglich.
import { readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ERLAUBT_DATEI = ['projekt/eingang-register.md'];
export const ERLAUBT_ORDNER = ['wiki/'];
// Dateiendungen sind keine Domain-Teile („Gespräch mit Name.md“ bleibt ein Treffer)
const DATEIENDUNG = '(?:md|markdown|txt|pdf|png|jpe?g|gif|webp|heic|docx?|xlsx?|pptx?|csv|json|ya?ml|zip|mjs|js|html?)(?![\\p{L}\\p{N}])';
const REPO_ENDUNG = `(?:[\\p{L}\\p{N}-]*-(?:wissen|eingang|intern|website)(?![\\p{L}\\p{N}])|[\\p{L}\\p{N}-]*\\.(?!${DATEIENDUNG})[a-z]{2,}(?![\\p{L}\\p{N}]))`;

export const pfadErlaubt = (pfad) => ERLAUBT_DATEI.includes(pfad) || ERLAUBT_ORDNER.some((o) => pfad.startsWith(o));

export function namenLesen(text) {
  const namen = [];
  for (const roh of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const zeile = roh.trim();
    if (!zeile || zeile.startsWith('#')) continue;
    const name = zeile.split('=>')[0].trim();
    if (name) namen.push(name.normalize('NFC'));
  }
  return namen;
}

const flucht = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Muster je Name: ab Wortanfang, nicht gefolgt von einer Repo- oder Domain-Endung
export function namensMuster(namen) {
  return namen.map((n) => new RegExp(`(?<![\\p{L}\\p{N}])${flucht(n).replace(/\s+/g, '\\s+')}(?!${REPO_ENDUNG})`, 'iu'));
}

export function zeileMitName(zeile, muster) {
  const t = zeile.normalize('NFC');
  return muster.some((m) => m.test(t));
}

function git(...argumente) {
  const r = spawnSync('git', argumente, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${argumente.join(' ')}: ${(r.stderr || '').trim()}`);
  return r.stdout;
}

export function pruefeDiff(base, head, { muster = null } = {}) {
  for (const ref of [base, head]) git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
  const verstoesse = [];
  // --no-renames: eine Verschiebung zählt als Löschen + Anlegen, beide Pfade werden geprüft
  const teile = git('-c', 'core.quotepath=off', 'diff', '--no-renames', '--name-status', '-z', base, head).split('\0').filter(Boolean);
  const pfade = [];
  for (let i = 0; i < teile.length; i += 2) pfade.push({ art: teile[i], pfad: teile[i + 1] });
  for (const { art, pfad } of pfade) {
    if (!pfadErlaubt(pfad)) verstoesse.push({ pfad, meldung: `Änderung (${art}) außerhalb von wiki/ und projekt/eingang-register.md nicht erlaubt` });
  }
  if (muster && muster.length) {
    const erlaubtePfade = pfade.filter(({ pfad }) => pfadErlaubt(pfad)).map(({ pfad }) => pfad);
    if (erlaubtePfade.length) {
      const diff = git('-c', 'core.quotepath=off', 'diff', '--no-renames', '--no-color', '--no-ext-diff', '-U0', base, head, '--', ...erlaubtePfade);
      let datei = null;
      let zeile = 0;
      for (const z of diff.split('\n')) {
        if (z.startsWith('+++ ')) {
          datei = z === '+++ /dev/null' ? null : z.slice(6);
          continue;
        }
        const kopf = /^@@ -\S+ \+(\d+)(?:,\d+)? @@/.exec(z);
        if (kopf) {
          zeile = Number(kopf[1]);
          continue;
        }
        if (z.startsWith('+') && datei) {
          if (zeileMitName(z.slice(1), muster)) verstoesse.push({ pfad: `${datei}:${zeile}`, meldung: 'Klarname aus der Pseudonym-Liste in hinzugefügter Zeile' });
          zeile += 1;
        }
      }
    }
  }
  return verstoesse;
}

const istHauptprogramm = (url) => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
};

if (istHauptprogramm(import.meta.url)) {
  const [base, head, ...rest] = process.argv.slice(2);
  if (!base || !head || rest.length) {
    console.error('Aufruf: wiki-diffwaechter <base> <head>   (Git-Referenzen im aktuellen Repo; Namensliste in $PSEUDO_LISTE)');
    process.exit(2);
  }
  let muster = null;
  const liste = process.env.PSEUDO_LISTE;
  try {
    if (liste) {
      muster = namensMuster(namenLesen(readFileSync(liste, 'utf8')));
    } else {
      console.log('Hinweis: PSEUDO_LISTE nicht gesetzt – nur Pfade geprüft, keine Namen.');
    }
  } catch (e) {
    console.error(`Pseudonym-Liste nicht lesbar (PSEUDO_LISTE): ${e.code ?? e.message}`);
    process.exit(2);
  }
  let verstoesse;
  try {
    verstoesse = pruefeDiff(base, head, { muster });
  } catch (e) {
    console.error(`Prüfung nicht möglich: ${e.message}`);
    process.exit(2);
  }
  if (verstoesse.length) {
    console.log(`✗ Diff ${base}..${head} abgelehnt (${verstoesse.length}):\n${verstoesse.map((v) => `  ${v.pfad} · ${v.meldung}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`✓ Diff ${base}..${head} in Ordnung${muster ? ` (Pfade und ${muster.length} Namen geprüft)` : ' (nur Pfade)'}`);
  process.exit(0);
}
