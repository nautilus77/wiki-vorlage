// Tests für /projektstand: Standards-Vergleich, offener Eingang (Register), Zahlen, Bericht. Ohne Netz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { standardsPruefen, offeneEingaenge, zaehlen, bericht, ampel } from '../bin/wiki-projektstand.mjs';

const WURZEL = dirname(dirname(fileURLToPath(import.meta.url)));
const SKRIPT = join(WURZEL, 'bin', 'wiki-projektstand.mjs');
const JETZT = new Date('2026-10-06T12:00:00+02:00');
const sha = (t) => createHash('sha256').update(t).digest('hex');

const KARPATHY = 'Karpathy-Text';
const OKF = 'OKF-Text';
const STANDARDS = {
  standards: [
    { name: 'Karpathy LLM Wiki', abruf: 'https://k/raw', version: null, sha256: sha(KARPATHY) },
    { name: 'Open Knowledge Format', abruf: 'https://o/SPEC.md', version: '0.2', commit: '62432a0', sha256: sha(OKF),
      commits_api: 'https://api/commits' },
  ],
};

function netz({ karpathy = KARPATHY, okf = OKF, commit = '62432a0ffffffff', kaputt = [], liste = null } = {}) {
  return async (url) => {
    if (kaputt.includes(url)) throw new Error('nicht erreichbar');
    if (url === 'https://k/raw') return karpathy;
    if (url === 'https://o/SPEC.md') return okf;
    if (url === 'https://api/commits' && liste) return liste;
    if (url === 'https://api/commits') return JSON.stringify([{ sha: commit, commit: { committer: { date: '2026-08-21T01:44:53Z' } } }]);
    throw new Error('unbekannt ' + url);
  };
}

// ---------- Standards ----------

test('Standards unverändert', async () => {
  const e = await standardsPruefen(STANDARDS, netz());
  assert.deepEqual(e.map((s) => s.stand), ['unverändert', 'unverändert']);
});

test('Karpathy geändert (andere Prüfsumme)', async () => {
  const e = await standardsPruefen(STANDARDS, netz({ karpathy: 'neuer Text' }));
  assert.equal(e[0].stand, 'geändert');
  assert.equal(e[1].stand, 'unverändert');
});

test('OKF geändert (neuer Commit, auch bei gleichem Text)', async () => {
  const e = await standardsPruefen(STANDARDS, netz({ commit: 'abc1234ffff' }));
  assert.equal(e[1].stand, 'geändert');
  assert.match(e[1].hinweis, /abc1234/);
});

test('OKF geändert (anderer Text)', async () => {
  const e = await standardsPruefen(STANDARDS, netz({ okf: 'OKF v0.3' }));
  assert.equal(e[1].stand, 'geändert');
});

test('Änderung bleibt erkannt, auch wenn danach die Commits-API scheitert', async () => {
  const e = await standardsPruefen(STANDARDS, netz({ okf: 'OKF v0.3', kaputt: ['https://api/commits'] }));
  assert.equal(e[1].stand, 'geändert');
  assert.match(e[1].hinweis, /Commit nicht prüfbar/);
});

test('Commits-API liefert nichts Brauchbares → nur Prüfsumme geprüft (gelb, nicht still unverändert)', async () => {
  const e = await standardsPruefen(STANDARDS, netz({ liste: '[]' }));
  assert.equal(e[1].stand, 'nur Prüfsumme geprüft');
});

test('Quelle nicht erreichbar', async () => {
  const e = await standardsPruefen(STANDARDS, netz({ kaputt: ['https://k/raw'] }));
  assert.equal(e[0].stand, 'nicht erreichbar');
});

// ---------- Eingang ----------

function ordner(dateien) {
  const o = mkdtempSync(join(tmpdir(), 'projektstand-test-'));
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    mkdirSync(dirname(join(o, pfad)), { recursive: true });
    writeFileSync(join(o, pfad), inhalt);
  }
  return o;
}

const REGISTER = '- `2026-10-01-alt.md` · 2026-10-16 · wiki/themen/ideen\n- `Ordner mit Leerzeichen/b.md` · 2026-10-16 · wiki/themen/profil\n';

test('offener Eingang: .md-Dateien (rekursiv), deren Pfad nicht im Register steht; Rohquellen bleiben unberührt', () => {
  const o = ordner({
    '2026-10-01-alt.md': '---\ntyp: notiz\n---\n',
    '2026-10-05-neu.md': '---\ntyp: notiz\ndatum: 2026-10-05\nvon: Betreiber\n---\nText',
    'Ordner mit Leerzeichen/b.md': 'registriert',
    'Ordner mit Leerzeichen/c.md': 'offen',
    'bild.png': 'PNG',
  });
  try {
    const vorher = readFileSync(join(o, '2026-10-05-neu.md'), 'utf8');
    const e = offeneEingaenge(o, REGISTER);
    assert.deepEqual(e.map((d) => d.datei), ['2026-10-05-neu.md', 'Ordner mit Leerzeichen/c.md']);
    assert.equal(e[0].typ, 'notiz');
    assert.equal(readFileSync(join(o, '2026-10-05-neu.md'), 'utf8'), vorher);
  } finally {
    rmSync(o, { recursive: true, force: true });
  }
});

test('Eingang: leeres Register → alle .md offen, vollständiges Register → nichts offen', () => {
  const o = ordner({ 'a.md': 'x', 'u/b.md': 'y' });
  try {
    assert.equal(offeneEingaenge(o, '').length, 2);
    assert.equal(offeneEingaenge(o, '- `a.md`\n- `u/b.md`\n').length, 0);
  } finally {
    rmSync(o, { recursive: true, force: true });
  }
});

test('Ordner-Zeile (F12): alte Datei darunter gilt als eingearbeitet, neuere bleibt offen, exakte Zeile weiter gültig', () => {
  const o = ordner({
    'Karriere export/alt.md': 'a',
    'Karriere export/unter/neu.md': 'b',
    'Karriere export/gleicher-tag.md': 'c',
    'Anderer Ordner/x.md': 'd',
    'exakt.md': 'e',
  });
  try {
    utimesSync(join(o, 'Karriere export/alt.md'), new Date(2026, 9, 1, 12), new Date(2026, 9, 1, 12));
    utimesSync(join(o, 'Karriere export/gleicher-tag.md'), new Date(2026, 9, 16, 23, 30), new Date(2026, 9, 16, 23, 30));
    utimesSync(join(o, 'Karriere export/unter/neu.md'), new Date(2026, 9, 17, 8), new Date(2026, 9, 17, 8));
    const register = '- `Karriere export/` · 2026-10-16 · `wiki/themen/karriere`\n- `exakt.md` · 2026-10-16 · `wiki/themen/ideen`\n';
    assert.deepEqual(offeneEingaenge(o, register).map((d) => d.datei), ['Anderer Ordner/x.md', 'Karriere export/unter/neu.md']);
  } finally {
    rmSync(o, { recursive: true, force: true });
  }
});

test('Ordner-Zeile gilt nur für den Ordner-Präfix, nicht für gleich beginnende Namen', () => {
  const o = ordner({ 'Karriere export 2/a.md': 'a', 'Karriere export/b.md': 'b' });
  try {
    utimesSync(join(o, 'Karriere export 2/a.md'), new Date(2026, 9, 1), new Date(2026, 9, 1));
    utimesSync(join(o, 'Karriere export/b.md'), new Date(2026, 9, 1), new Date(2026, 9, 1));
    const e = offeneEingaenge(o, '- `Karriere export/` · 2026-10-16 · `wiki/themen/karriere`\n');
    assert.deepEqual(e.map((d) => d.datei), ['Karriere export 2/a.md']);
  } finally {
    rmSync(o, { recursive: true, force: true });
  }
});

test('Eingang nicht vorhanden → null', () => {
  assert.equal(offeneEingaenge('/gibt/es/nicht'), null);
});

// ---------- Zahlen und Bericht ----------

const EINTRAG = (type, extra = '') => `---\ntype: ${type}\ntitle: T\ndescription: D.\n${extra}generated: { by: claude-code/opus-5.5, at: 2026-10-06T09:00:00+02:00 }\n---\n`;

test('Zahlen: Einträge je Art, Entwürfe, ungeprüft, offene Fragen', () => {
  const o = ordner({
    'wiki/index.md': '---\nokf_version: "0.2"\n---\n',
    'wiki/themen/a.md': EINTRAG('Thema', 'status: draft\n'),
    'wiki/themen/b.md': EINTRAG('Thema', 'verified: { by: human:betreiber, at: 2026-10-06T10:00:00+02:00 }\n'),
    'wiki/fragen/F-0001.md': EINTRAG('Frage', 'stand: offen\nan: betreiber\n'),
    'wiki/fragen/F-0002.md': EINTRAG('Frage', 'stand: beantwortet\nan: betreiber\n'),
  });
  try {
    const z = zaehlen(o);
    assert.equal(z.gesamt, 4);
    assert.deepEqual(z.jeArt, { Frage: 2, Thema: 2 });
    assert.equal(z.entwuerfe, 1);
    assert.equal(z.ungeprueft, 3);
    assert.deepEqual(z.offeneFragen, ['wiki/fragen/F-0001.md']);
  } finally {
    rmSync(o, { recursive: true, force: true });
  }
});

test('Bericht: alle Abschnitte und Ampel', () => {
  const md = bericht({
    jetzt: JETZT,
    pruefung: { fehler: [{ datei: 'wiki/x.md', regel: 'link', meldung: 'führt ins Leere' }], hinweise: [] },
    standards: [{ name: 'Open Knowledge Format', stand: 'geändert', hinweis: 'neuer Commit abc1234' }],
    eingang: [{ datei: '2026-10-05-neu.md', typ: 'material', datum: '2026-10-05', von: 'Betreiber' }],
    zahlen: { gesamt: 0, jeArt: {}, entwuerfe: 0, ungeprueft: 0, offeneFragen: [] },
  });
  for (const teil of ['# Projektstand', '## Ampel', '## Prüf-Skript', '## Standards', '## Eingang', '## Wiki in Zahlen', '## Inhaltlich (Claude)']) {
    assert.ok(md.includes(teil), `fehlt: ${teil}`);
  }
  assert.match(md, /wiki\/x\.md/);
  assert.match(md, /abc1234/);
  assert.match(md, /2026-10-05-neu\.md/);
  assert.match(md, /Ampel[\s\S]*rot/i);
});

test('Bericht: alles in Ordnung → grün', () => {
  const md = bericht({
    jetzt: JETZT,
    pruefung: { fehler: [], hinweise: [] },
    standards: [{ name: 'Karpathy LLM Wiki', stand: 'unverändert', hinweis: '' }],
    eingang: [],
    zahlen: { gesamt: 0, jeArt: {}, entwuerfe: 0, ungeprueft: 0, offeneFragen: [] },
  });
  assert.match(md, /Ampel[\s\S]*grün/i);
});

test('Ampel: rot, gelb, grün', () => {
  const ok = { fehler: [], hinweise: [] };
  const un = [{ stand: 'unverändert' }];
  assert.equal(ampel({ pruefung: ok, standards: un }), 'grün');
  assert.equal(ampel({ pruefung: { fehler: [], hinweise: [{}] }, standards: un }), 'gelb');
  assert.equal(ampel({ pruefung: ok, standards: [{ stand: 'nicht erreichbar' }] }), 'gelb');
  assert.equal(ampel({ pruefung: ok, standards: [{ stand: 'nicht geprüft (ohne Netz)' }] }), 'gelb');
  assert.equal(ampel({ pruefung: ok, standards: [{ stand: 'geändert' }] }), 'rot');
  assert.equal(ampel({ pruefung: { fehler: [{}], hinweise: [] }, standards: un }), 'rot');
});

test('Bericht übernimmt den inhaltlichen Teil des letzten Laufs', () => {
  const daten = {
    jetzt: JETZT, pruefung: { fehler: [], hinweise: [] }, standards: [], eingang: [],
    zahlen: { gesamt: 0, jeArt: {}, entwuerfe: 0, ungeprueft: 0, offeneFragen: [] },
  };
  const alt = bericht(daten).replace('(Noch nicht ergänzt.)', '06.10.2026: Glossar fehlt noch.');
  const neu = bericht({ ...daten, vorher: alt });
  assert.match(neu, /Glossar fehlt noch/);
  assert.match(neu, /vom letzten Lauf/);
});

// ---------- Kommandozeile ----------

// minimales, gültiges Wiki (Stand der Standards aus beispiel/standards.json)
function kleinesWiki(o) {
  mkdirSync(join(o, 'wiki/themen'), { recursive: true });
  mkdirSync(join(o, 'projekt'), { recursive: true });
  writeFileSync(join(o, 'wiki/index.md'), '---\nokf_version: "0.2"\n---\n\n# Wiki\n');
  cpSync(join(WURZEL, 'beispiel/standards.json'), join(o, 'projekt/standards.json'));
}

test('Kommandozeile --ohne-netz schreibt projekt/status.md und endet mit 0', () => {
  const o = mkdtempSync(join(tmpdir(), 'projektstand-cli-'));
  try {
    kleinesWiki(o);
    const r = spawnSync(process.execPath, [SKRIPT, '--ohne-netz', '--eingang', join(o, 'kein-eingang'), o], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const md = readFileSync(join(o, 'projekt/status.md'), 'utf8');
    assert.match(md, /# Projektstand/);
    assert.match(md, /nicht geprüft \(ohne Netz\)/);
  } finally {
    rmSync(o, { recursive: true, force: true });
  }
});

test('Kommandozeile --json schreibt status.md nicht, rot endet mit 1', () => {
  const o = mkdtempSync(join(tmpdir(), 'projektstand-cli-'));
  try {
    kleinesWiki(o);
    writeFileSync(join(o, 'projekt/status.md'), 'unverändert');
    writeFileSync(join(o, 'wiki/themen/kaputt.md'), '# ohne Kopfdaten\n');
    const r = spawnSync(process.execPath, [SKRIPT, '--ohne-netz', '--json', '--eingang', join(o, 'x'), o], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stderr);
    assert.equal(JSON.parse(r.stdout).ampel, 'rot');
    assert.equal(readFileSync(join(o, 'projekt/status.md'), 'utf8'), 'unverändert');
  } finally {
    rmSync(o, { recursive: true, force: true });
  }
});

test('Kommandozeile gibt „Eingang offen: N“ aus (Eingang per Umgebungsvariable, Register zählt)', () => {
  const o = mkdtempSync(join(tmpdir(), 'projektstand-cli-'));
  const ein = ordner({ 'x.md': 'a', 'u/y.md': 'b', 'u/z.md': 'c' });
  try {
    kleinesWiki(o);
    writeFileSync(join(o, 'projekt/eingang-register.md'), '# Register\n\n- `u/y.md` · 2026-10-16 · wiki/themen/ideen\n');
    const r = spawnSync(process.execPath, [SKRIPT, '--ohne-netz', o], { encoding: 'utf8', env: { ...process.env, WIKI_EINGANG: ein } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /Eingang offen: 2\b/);
    const md = readFileSync(join(o, 'projekt/status.md'), 'utf8');
    assert.match(md, /Eingang offen: 2/);
    assert.match(md, /`x\.md`/);
    assert.doesNotMatch(md, /`u\/y\.md`/);
  } finally {
    rmSync(o, { recursive: true, force: true });
    rmSync(ein, { recursive: true, force: true });
  }
});

test('Kommandozeile: Standard-Eingang ist ../eingang relativ zur Repo-Wurzel', () => {
  const base = mkdtempSync(join(tmpdir(), 'projektstand-cli-'));
  try {
    const o = join(base, 'wissen');
    mkdirSync(join(base, 'eingang'), { recursive: true });
    writeFileSync(join(base, 'eingang', 'n.md'), 'Notiz');
    mkdirSync(o);
    kleinesWiki(o);
    const env = { ...process.env };
    delete env.WIKI_EINGANG;
    const r = spawnSync(process.execPath, [SKRIPT, '--ohne-netz', '--json', o], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.deepEqual(JSON.parse(r.stdout).eingang.map((e) => e.datei), ['n.md']);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('Kommandozeile: Eingang aus wiki.json (eingang.lokal, relativ zur Wiki-Wurzel) geht vor ../eingang', () => {
  const base = mkdtempSync(join(tmpdir(), 'projektstand-cli-'));
  try {
    const o = join(base, 'wissen');
    mkdirSync(join(base, 'eingang'), { recursive: true });
    writeFileSync(join(base, 'eingang', 'falsch.md'), 'Notiz');
    mkdirSync(join(base, 'anderer-eingang', 'u'), { recursive: true });
    writeFileSync(join(base, 'anderer-eingang', 'u', 'richtig.md'), 'Notiz');
    mkdirSync(o);
    kleinesWiki(o);
    writeFileSync(join(o, 'wiki.json'), JSON.stringify({ eingang: { quelle: 'remote:x', lokal: '../anderer-eingang' } }));
    const env = { ...process.env };
    delete env.WIKI_EINGANG;
    const r = spawnSync(process.execPath, [SKRIPT, '--ohne-netz', '--json', o], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.deepEqual(JSON.parse(r.stdout).eingang.map((e) => e.datei), ['u/richtig.md']);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('Kommandozeile: ohne Argument zählt das aktuelle Verzeichnis als Wiki-Wurzel (Aufruf über npx/npm-Skript)', () => {
  const base = mkdtempSync(join(tmpdir(), 'projektstand-cli-'));
  try {
    const o = join(base, 'wissen');
    mkdirSync(join(base, 'eingang'), { recursive: true });
    writeFileSync(join(base, 'eingang', 'n.md'), 'Notiz');
    mkdirSync(o);
    kleinesWiki(o);
    const env = { ...process.env, PROJEKTSTAND_OHNE_NETZ: '1' };
    delete env.WIKI_EINGANG;
    const r = spawnSync(process.execPath, [SKRIPT], { encoding: 'utf8', env, cwd: o });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /Eingang offen: 1\b/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
