// Tests für den Regelkern: regeln/AGENTS-kern.md wird als Kopie zwischen Markern (mit Version) in die AGENTS.md
// eines Wikis geschrieben; --pruefen erkennt jede Abweichung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WURZEL = dirname(dirname(fileURLToPath(import.meta.url)));
const SKRIPT = join(WURZEL, 'bin', 'wiki-regelkern.mjs');
const KERN = readFileSync(join(WURZEL, 'regeln', 'AGENTS-kern.md'), 'utf8');
const VERSION = JSON.parse(readFileSync(join(WURZEL, 'package.json'), 'utf8')).version;

const rk = (...a) => spawnSync(process.execPath, [SKRIPT, ...a], { encoding: 'utf8' });

function mitOrdner(fn) {
  const o = mkdtempSync(join(tmpdir(), 'regelkern-'));
  try {
    return fn(o);
  } finally {
    rmSync(o, { recursive: true, force: true });
  }
}

test('Regelkern ist allgemein: enthält den Ablauf zum Einarbeiten und verweist auf „Nur dieses Wiki“', () => {
  assert.match(KERN, /einarbeit/i);
  assert.match(KERN, /Nur dieses Wiki/);
  assert.match(KERN, /wiki\.json/);
});

test('--schreiben legt AGENTS.md an: Marker mit Version, Kern wörtlich, danach Abschnitt „Nur dieses Wiki“', () => {
  mitOrdner((o) => {
    const datei = join(o, 'AGENTS.md');
    const r = rk('--schreiben', datei);
    assert.equal(r.status, 0, r.stderr);
    const t = readFileSync(datei, 'utf8');
    assert.match(t, new RegExp(`<!-- wiki-regelkern:anfang v${VERSION.replace(/\./g, '\\.')} `));
    assert.match(t, /<!-- wiki-regelkern:ende -->/);
    assert.ok(t.includes(KERN.trim()), 'Kern nicht wörtlich enthalten');
    assert.match(t.slice(t.indexOf('wiki-regelkern:ende')), /## Nur dieses Wiki/);
    assert.equal(rk('--pruefen', datei).status, 0);
  });
});

test('--schreiben ersetzt nur den Block zwischen den Markern, eigener Text davor und danach bleibt', () => {
  mitOrdner((o) => {
    const datei = join(o, 'AGENTS.md');
    rk('--schreiben', datei);
    const alt = readFileSync(datei, 'utf8');
    const anfang = alt.indexOf('<!-- wiki-regelkern:anfang');
    const ende = alt.indexOf('<!-- wiki-regelkern:ende -->');
    const kaputt = '# Kopf eigen\n\n' + alt.slice(anfang, ende).replace(/Karpathy/g, 'Fremd') + alt.slice(ende) + '\nEigene Zeile am Ende.\n';
    writeFileSync(datei, kaputt);
    assert.notEqual(rk('--pruefen', datei).status, 0);
    assert.equal(rk('--schreiben', datei).status, 0);
    const neu = readFileSync(datei, 'utf8');
    assert.ok(neu.startsWith('# Kopf eigen\n'));
    assert.ok(neu.endsWith('Eigene Zeile am Ende.\n'));
    assert.ok(neu.includes(KERN.trim()));
    assert.equal(rk('--pruefen', datei).status, 0);
  });
});

test('--schreiben ist idempotent', () => {
  mitOrdner((o) => {
    const datei = join(o, 'AGENTS.md');
    rk('--schreiben', datei);
    const eins = readFileSync(datei, 'utf8');
    rk('--schreiben', datei);
    assert.equal(readFileSync(datei, 'utf8'), eins);
  });
});

test('Gegenprobe --pruefen: eine geänderte Zeile im Kern → Exit 1 mit Meldung', () => {
  mitOrdner((o) => {
    const datei = join(o, 'AGENTS.md');
    rk('--schreiben', datei);
    writeFileSync(datei, readFileSync(datei, 'utf8').replace(/[Ee]inarbeit/, 'EINGESCHLEUST'));
    const r = rk('--pruefen', datei);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /weicht ab|Abweichung/);
  });
});

test('Gegenprobe --pruefen: andere Version im Marker → Exit 1', () => {
  mitOrdner((o) => {
    const datei = join(o, 'AGENTS.md');
    rk('--schreiben', datei);
    writeFileSync(datei, readFileSync(datei, 'utf8').replace(`anfang v${VERSION}`, 'anfang v0.0.1'));
    assert.equal(rk('--pruefen', datei).status, 1);
  });
});

test('Gegenprobe --pruefen: Marker fehlen oder Datei fehlt → Exit 1', () => {
  mitOrdner((o) => {
    const datei = join(o, 'AGENTS.md');
    writeFileSync(datei, '# nur eigener Text\n' + KERN);
    assert.equal(rk('--pruefen', datei).status, 1);
    assert.equal(rk('--pruefen', join(o, 'fehlt.md')).status, 1);
    assert.ok(!existsSync(join(o, 'fehlt.md')));
  });
});

test('Gegenprobe --pruefen: Block doppelt → Exit 1', () => {
  mitOrdner((o) => {
    const datei = join(o, 'AGENTS.md');
    rk('--schreiben', datei);
    const t = readFileSync(datei, 'utf8');
    writeFileSync(datei, t + t);
    assert.equal(rk('--pruefen', datei).status, 1);
  });
});

test('falscher Aufruf → Exit 2', () => {
  assert.equal(rk().status, 2);
  assert.equal(rk('--loeschen', 'x').status, 2);
});
