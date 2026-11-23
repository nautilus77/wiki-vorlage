// Tests für den Diff-Wächter: erlaubt sind nur Änderungen unter wiki/ und an projekt/eingang-register.md,
// hinzugefügte Zeilen dürfen keinen Klarnamen aus der Pseudonym-Liste enthalten (Repo-Namen und Domains ausgenommen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WURZEL = dirname(dirname(fileURLToPath(import.meta.url)));
const SKRIPT = join(WURZEL, 'bin', 'wiki-diffwaechter.mjs');
const LISTE = '# Kommentar\nErika Testperson => Kontakt Z\n\nMaxi => Kontakt Y\n';

const git = (o, ...a) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: o, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};

// Wegwerf-Repo mit Grundstand auf main; aendern(o) verändert auf Zweig probe, danach Commit
function lauf(aendern, { liste = LISTE, env = {}, basis = {} } = {}) {
  const o = mkdtempSync(join(tmpdir(), 'diffwaechter-'));
  try {
    git(o, 'init', '-q', '-b', 'main');
    const dateien = {
      'wiki/a.md': 'a\n', 'wiki/log.md': '# Verlauf\n', 'projekt/eingang-register.md': '# Register\n', 'projekt/standards.json': '{}\n',
      'AGENTS.md': 'Regeln\n', 'CLAUDE.md': '@AGENTS.md\n', 'werkzeuge/x.mjs': '//\n', '.github/workflows/w.yml': 'on: push\n',
      'package.json': '{}\n', 'wiki.json': '{}\n', ...basis,
    };
    for (const [p, t] of Object.entries(dateien)) {
      mkdirSync(dirname(join(o, p)), { recursive: true });
      writeFileSync(join(o, p), t);
    }
    git(o, 'add', '-A');
    git(o, 'commit', '-qm', 'basis');
    git(o, 'checkout', '-q', '-b', 'probe');
    aendern(o);
    git(o, 'add', '-A');
    git(o, 'commit', '-qm', 'probe', '--allow-empty');
    let listeDatei = null;
    if (liste !== null) {
      listeDatei = join(o, '..', `${o.split('/').pop()}.pseudo`);
      writeFileSync(listeDatei, liste);
    }
    const r = spawnSync(process.execPath, [SKRIPT, 'main', 'probe'], {
      cwd: o, encoding: 'utf8', env: { ...process.env, PSEUDO_LISTE: listeDatei ?? '', ...env },
    });
    if (listeDatei) rmSync(listeDatei, { force: true });
    return r;
  } finally {
    rmSync(o, { recursive: true, force: true });
  }
}

const neu = (o, p, t) => {
  mkdirSync(dirname(join(o, p)), { recursive: true });
  writeFileSync(join(o, p), t);
};

test('erlaubt: Änderungen unter wiki/ (auch log.md, neue Ordner) und am Register', () => {
  const r = lauf((o) => {
    appendFileSync(join(o, 'wiki/a.md'), 'b\n');
    appendFileSync(join(o, 'wiki/log.md'), '* **Ingest**: x\n');
    neu(o, 'wiki/themen/neu.md', 'neu\n');
    appendFileSync(join(o, 'projekt/eingang-register.md'), '- `x.md` · 2026-11-23 · wiki/a\n');
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('erlaubt: keine Änderung', () => {
  const r = lauf(() => {});
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

for (const [name, pfad] of [
  ['Regeln (AGENTS.md)', 'AGENTS.md'], ['CLAUDE.md', 'CLAUDE.md'], ['Werkzeuge', 'werkzeuge/x.mjs'], ['Workflow', '.github/workflows/w.yml'],
  ['package.json', 'package.json'], ['wiki.json', 'wiki.json'], ['andere Projektdatei', 'projekt/standards.json'],
]) {
  test(`abgelehnt: Änderung an ${name}`, () => {
    const r = lauf((o) => appendFileSync(join(o, pfad), 'x\n'));
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stdout + r.stderr, new RegExp(pfad.replace(/[.]/g, '\\.')));
  });
}

test('abgelehnt: neue Datei außerhalb von wiki/ (auch package-lock.json, Wurzel)', () => {
  for (const p of ['package-lock.json', 'neu.md', 'projekt/neu.md', 'wikifoo/a.md']) {
    const r = lauf((o) => neu(o, p, 'x\n'));
    assert.notEqual(r.status, 0, `${p}: ${r.stdout}`);
  }
});

test('abgelehnt: Löschen oder Verschieben aus wiki/ hinaus', () => {
  assert.notEqual(lauf((o) => rmSync(join(o, 'AGENTS.md'))).status, 0);
  const r = lauf((o) => {
    git(o, 'mv', 'wiki/a.md', 'a.md');
  });
  assert.notEqual(r.status, 0, r.stdout);
});

test('abgelehnt: Klarname aus der Pseudonym-Liste in einer hinzugefügten Zeile (Groß/klein egal)', () => {
  const r = lauf((o) => appendFileSync(join(o, 'wiki/a.md'), 'erika testperson sagte etwas\n'));
  assert.notEqual(r.status, 0, r.stdout);
  assert.match(r.stdout + r.stderr, /wiki\/a\.md/);
});

test('abgelehnt: Klarname im Register und als Wortanfang (Maxis)', () => {
  assert.notEqual(lauf((o) => appendFileSync(join(o, 'projekt/eingang-register.md'), '- `von Maxi.md` · x\n')).status, 0);
  assert.notEqual(lauf((o) => appendFileSync(join(o, 'wiki/a.md'), 'Maxis Plan\n')).status, 0);
});

test('Meldung nennt den Klarnamen nicht (nur Datei und Zeile)', () => {
  const r = lauf((o) => appendFileSync(join(o, 'wiki/a.md'), 'Erika Testperson\n'));
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stdout + r.stderr, /Erika|Testperson/i);
});

test('erlaubt: Repo-Namen und Domains (maxi-wissen, maxi-eingang, maxi-intern, maxi-website, maxi-muster-website, maxi.de, maximuster.de)', () => {
  const r = lauf((o) => appendFileSync(join(o, 'wiki/a.md'),
    'siehe maxi-wissen, Maxi-Eingang, maxi-intern, maxi-website, maxi-muster-website, https://maxi.de und maximuster.de\n'));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('erlaubt: Name nur im Wortinneren (kein Wortanfang)', () => {
  const r = lauf((o) => appendFileSync(join(o, 'wiki/a.md'), 'ein Rumaxi-Effekt\n'));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('entfernte Zeilen mit Klarnamen sind erlaubt (Bereinigung)', () => {
  const r = lauf((o) => writeFileSync(join(o, 'wiki/a.md'), 'Kontakt Z\n'), { basis: { 'wiki/a.md': 'Erika Testperson\n' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('ohne PSEUDO_LISTE: nur der Pfadteil (Klarname fällt nicht auf, Pfad schon), mit Hinweis', () => {
  const ohne = lauf((o) => appendFileSync(join(o, 'wiki/a.md'), 'Erika Testperson\n'), { liste: null });
  assert.equal(ohne.status, 0, ohne.stdout + ohne.stderr);
  assert.match(ohne.stdout + ohne.stderr, /PSEUDO_LISTE/);
  assert.notEqual(lauf((o) => appendFileSync(join(o, 'AGENTS.md'), 'x\n'), { liste: null }).status, 0);
});

test('PSEUDO_LISTE gesetzt, Datei fehlt → Abbruch (Exit 2), nicht still durchlassen', () => {
  const r = lauf((o) => appendFileSync(join(o, 'wiki/a.md'), 'b\n'), { liste: null, env: { PSEUDO_LISTE: '/gibt/es/nicht.txt' } });
  assert.equal(r.status, 2, r.stdout + r.stderr);
});

test('unbekannte Git-Referenz → Exit 2', () => {
  const o = mkdtempSync(join(tmpdir(), 'diffwaechter-'));
  try {
    git(o, 'init', '-q', '-b', 'main');
    const r = spawnSync(process.execPath, [SKRIPT, 'main', 'gibt-es-nicht'], { cwd: o, encoding: 'utf8', env: { ...process.env, PSEUDO_LISTE: '' } });
    assert.equal(r.status, 2, r.stdout + r.stderr);
  } finally {
    rmSync(o, { recursive: true, force: true });
  }
});

test('ohne Argumente → Exit 2 mit Aufrufhilfe', () => {
  const r = spawnSync(process.execPath, [SKRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Aufruf/);
});
