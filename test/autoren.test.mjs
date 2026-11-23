// Tests für F27 (Grilling 23.11.2026): In CI prüft der Diff-Wächter nur Commits der KI-Autoren aus wiki.json
// (Server/Bot); Korrekturen des Betreibers bleiben frei (D59 F8). Jeder KI-Commit wird einzeln gegen seinen Vorgänger
// geprüft, damit ein gemischter Push den Betreiber-Teil nicht mitprüft und den KI-Teil nicht versteckt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pruefeConfig } from '../bin/wiki-config.mjs';

const WURZEL = dirname(dirname(fileURLToPath(import.meta.url)));
const SKRIPT = join(WURZEL, 'bin', 'wiki-diffwaechter.mjs');
const BOT = 'ki-bot@beispiel.invalid';
const MENSCH = 'betreiber@beispiel.invalid';

const git = (o, mail, ...a) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', `user.email=${mail}`, ...a], { cwd: o, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const schreib = (o, p, t) => {
  mkdirSync(dirname(join(o, p)), { recursive: true });
  writeFileSync(join(o, p), t);
};

// commits: Liste [autor, {pfad: inhalt}] nach dem Grundstand; config: Inhalt von wiki.json (Objekt oder Rohtext)
function lauf(commits, { config = { ki_autoren: [BOT] }, liste = null, argumente = null } = {}) {
  const o = mkdtempSync(join(tmpdir(), 'autoren-'));
  try {
    git(o, MENSCH, 'init', '-q', '-b', 'main');
    for (const [p, t] of Object.entries({ 'wiki/a.md': 'a\n', 'AGENTS.md': 'Regeln\n', 'projekt/eingang-register.md': '# R\n' })) schreib(o, p, t);
    git(o, MENSCH, 'add', '-A');
    git(o, MENSCH, 'commit', '-qm', 'basis');
    git(o, MENSCH, 'tag', 'vorher');
    for (const [autor, dateien] of commits) {
      for (const [p, t] of Object.entries(dateien)) schreib(o, p, t);
      git(o, autor, 'add', '-A');
      git(o, autor, 'commit', '-qm', 'c', '--allow-empty');
    }
    const cfg = join(o, '..', `${o.split('/').pop()}.json`);
    if (config !== undefined) writeFileSync(cfg, typeof config === 'string' ? config : JSON.stringify(config));
    let listeDatei = '';
    if (liste) {
      listeDatei = join(o, '..', `${o.split('/').pop()}.pseudo`);
      writeFileSync(listeDatei, liste);
    }
    const r = spawnSync(process.execPath, [SKRIPT, ...(argumente ?? ['--nur-ki-autoren', cfg, 'vorher', 'HEAD'])], {
      cwd: o, encoding: 'utf8', env: { ...process.env, PSEUDO_LISTE: listeDatei },
    });
    rmSync(cfg, { force: true });
    if (listeDatei) rmSync(listeDatei, { force: true });
    return r;
  } finally {
    rmSync(o, { recursive: true, force: true });
  }
}

test('nur Betreiber-Commits, auch außerhalb von wiki/ → übersprungen (Exit 0, mit Hinweis)', () => {
  const r = lauf([[MENSCH, { 'AGENTS.md': 'neu\n', 'werkzeuge/x.mjs': '//\n' }]]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /übersprungen|kein Commit/i);
});

test('KI-Commit ändert AGENTS.md → abgelehnt (Exit 1)', () => {
  const r = lauf([[BOT, { 'AGENTS.md': 'eingeschleust\n' }]]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /AGENTS\.md/);
});

test('KI-Commit nur in wiki/ und Register → in Ordnung', () => {
  const r = lauf([[BOT, { 'wiki/b.md': 'b\n', 'projekt/eingang-register.md': '# R\nx\n' }]]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✓/);
});

test('gemischt: Betreiber ändert AGENTS.md, KI nur wiki/ → in Ordnung (Betreiber-Teil frei)', () => {
  const r = lauf([[MENSCH, { 'AGENTS.md': 'korrektur\n' }], [BOT, { 'wiki/b.md': 'b\n' }]]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('gemischt: KI ändert AGENTS.md, danach Betreiber in wiki/ → abgelehnt (KI-Teil nicht versteckt)', () => {
  const r = lauf([[BOT, { 'AGENTS.md': 'eingeschleust\n' }], [MENSCH, { 'wiki/b.md': 'b\n' }]]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
});

test('Autor-Vergleich ohne Groß/klein', () => {
  const r = lauf([[BOT.toUpperCase(), { 'AGENTS.md': 'eingeschleust\n' }]]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
});

test('KI-Commit mit Klarnamen bei gesetzter PSEUDO_LISTE → abgelehnt', () => {
  const r = lauf([[BOT, { 'wiki/b.md': 'Treffen mit Erika Testperson\n' }]], { liste: 'Erika Testperson => Kontakt Z\n' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /Erika/);
});

test('wiki.json ohne ki_autoren → übersprungen mit Hinweis (Exit 0)', () => {
  const r = lauf([[BOT, { 'AGENTS.md': 'x\n' }]], { config: { name: 'x' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ki_autoren/);
});

test('wiki.json nicht lesbar → Exit 2 (nicht still durchlassen)', () => {
  const r = lauf([[BOT, { 'AGENTS.md': 'x\n' }]], { config: '{kaputt' });
  assert.equal(r.status, 2, r.stdout + r.stderr);
});

test('ohne Option bleibt das Verhalten: ganzer Bereich, auch Betreiber-Commits', () => {
  const r = lauf([[MENSCH, { 'AGENTS.md': 'korrektur\n' }]], { argumente: ['vorher', 'HEAD'] });
  assert.equal(r.status, 1, r.stdout + r.stderr);
});

test('wiki.json: ki_autoren optional, wenn gesetzt Liste von E-Mail-Adressen', () => {
  const basis = JSON.parse(readFileSync(join(WURZEL, 'beispiel', 'wiki.json'), 'utf8'));
  assert.deepEqual(pruefeConfig({ ...basis }), []);
  assert.deepEqual(pruefeConfig({ ...basis, ki_autoren: [BOT] }), []);
  assert.ok(pruefeConfig({ ...basis, ki_autoren: 'x@y' }).some((f) => /ki_autoren/.test(f)));
  assert.ok(pruefeConfig({ ...basis, ki_autoren: ['kein-mail'] }).some((f) => /ki_autoren/.test(f)));
});

test('Prüf-Workflow ruft den Diff-Wächter mit --nur-ki-autoren wiki.json auf', () => {
  const w = readFileSync(join(WURZEL, '.github', 'workflows', 'pruefen.yml'), 'utf8');
  assert.match(w, /wiki-diffwaechter --nur-ki-autoren wiki\.json "\$BEFORE" "\$AFTER"/);
});
