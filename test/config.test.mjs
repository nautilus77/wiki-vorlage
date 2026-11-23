// Tests für wiki.json und `wiki-config pruefen`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pruefeConfig } from '../bin/wiki-config.mjs';

const WURZEL = dirname(dirname(fileURLToPath(import.meta.url)));
const SKRIPT = join(WURZEL, 'bin', 'wiki-config.mjs');
const BEISPIEL = JSON.parse(readFileSync(join(WURZEL, 'beispiel', 'wiki.json'), 'utf8'));

const gut = () => structuredClone(BEISPIEL);
const fehler = (c) => pruefeConfig(c);
const mit = (fn) => {
  const c = gut();
  fn(c);
  return fehler(c);
};

test('Beispiel ist gültig und enthält alle Pflichtfelder', () => {
  assert.deepEqual(fehler(gut()), []);
  for (const f of ['name', 'eingang', 'register', 'zielmodus', 'pseudonym_liste']) assert.ok(f in BEISPIEL, f);
});

test('beide Zielmodi sind erlaubt', () => {
  assert.deepEqual(mit((c) => (c.zielmodus = 'direkt-main')), []);
  assert.deepEqual(mit((c) => (c.zielmodus = 'pr-automerge')), []);
});

test('Gegenprobe: unbekannter Zielmodus', () => {
  assert.ok(mit((c) => (c.zielmodus = 'push')).some((f) => /zielmodus/.test(f)));
});

for (const feld of ['name', 'eingang', 'register', 'zielmodus', 'pseudonym_liste']) {
  test(`Gegenprobe: Pflichtfeld ${feld} fehlt`, () => {
    assert.ok(mit((c) => delete c[feld]).some((f) => f.includes(feld)));
  });
}

test('Gegenprobe: eingang.quelle nicht im rclone-Stil remote:pfad', () => {
  for (const q of ['AI-OS/eingang', '/abs/pfad', ':pfad', 'remote:', '', 42]) {
    assert.ok(mit((c) => (c.eingang.quelle = q)).some((f) => /eingang\.quelle/.test(f)), String(q));
  }
});

test('Gegenprobe: eingang.lokal fehlt, ist absolut oder kein Text', () => {
  assert.ok(mit((c) => delete c.eingang.lokal).some((f) => /eingang\.lokal/.test(f)));
  assert.ok(mit((c) => (c.eingang.lokal = '/abs/eingang')).some((f) => /eingang\.lokal/.test(f)));
  assert.ok(mit((c) => (c.eingang.lokal = 3)).some((f) => /eingang\.lokal/.test(f)));
});

test('Gegenprobe: register absolut oder außerhalb des Repos', () => {
  assert.ok(mit((c) => (c.register = '/x.md')).some((f) => /register/.test(f)));
  assert.ok(mit((c) => (c.register = '../x.md')).some((f) => /register/.test(f)));
});

test('Gegenprobe: pseudonym_liste ohne quelle', () => {
  assert.ok(mit((c) => (c.pseudonym_liste = {})).some((f) => /pseudonym_liste\.quelle/.test(f)));
  assert.ok(mit((c) => (c.pseudonym_liste = 'x:y')).some((f) => /pseudonym_liste/.test(f)));
});

test('Gegenprobe: name nicht in Kleinbuchstaben mit Bindestrich', () => {
  assert.ok(mit((c) => (c.name = 'Mein Wiki')).some((f) => /name/.test(f)));
});

test('betreiber ist optional, wenn gesetzt eine Akteur-Kennung', () => {
  assert.deepEqual(mit((c) => delete c.betreiber), []);
  assert.ok(mit((c) => (c.betreiber = 'Mit Leerzeichen')).some((f) => /betreiber/.test(f)));
});

test('Gegenprobe: unbekanntes Feld (Tippfehler) und keine Zuordnung', () => {
  assert.ok(mit((c) => (c.zielmodu = 'direkt-main')).some((f) => /zielmodu/.test(f)));
  assert.ok(fehler([]).length > 0);
  assert.ok(fehler(null).length > 0);
});

function aufruf(inhalt) {
  const o = mkdtempSync(join(tmpdir(), 'wiki-config-'));
  try {
    if (inhalt !== undefined) writeFileSync(join(o, 'wiki.json'), inhalt);
    return spawnSync(process.execPath, [SKRIPT, 'pruefen', join(o, 'wiki.json')], { encoding: 'utf8' });
  } finally {
    rmSync(o, { recursive: true, force: true });
  }
}

test('Kommandozeile: gültig → Exit 0', () => {
  const r = aufruf(JSON.stringify(gut()));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('Kommandozeile: ungültig → Exit 1 mit Meldung', () => {
  const r = aufruf(JSON.stringify({ ...gut(), zielmodus: 'x' }));
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /zielmodus/);
});

test('Kommandozeile: kein JSON oder Datei fehlt → Exit 1', () => {
  assert.equal(aufruf('{ kaputt').status, 1);
  assert.equal(aufruf(undefined).status, 1);
});

test('Kommandozeile: falscher Aufruf → Exit 2', () => {
  assert.equal(spawnSync(process.execPath, [SKRIPT], { encoding: 'utf8' }).status, 2);
});
