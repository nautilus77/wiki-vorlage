// Tests für das Prüf-Skript (wiki-pruefen). Jeder Test baut ein kleines, gültiges Bündel und verändert genau eine Sache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pruefe } from '../bin/wiki-pruefen.mjs';

const WURZEL = dirname(dirname(fileURLToPath(import.meta.url)));
const SKRIPT = join(WURZEL, 'bin', 'wiki-pruefen.mjs');
const JETZT = new Date('2026-10-06T12:00:00+02:00');
const GEN = 'generated: { by: claude-code/opus-5.5, at: 2026-10-06T09:52:09+02:00 }';

function grundbestand() {
  return {
    'wiki/index.md': `---
okf_version: "0.2"
---

# Bereiche

* [Themen](themen/index.md) - Themen
* [Quellen](quellen/index.md) - Quellen
* [Glossar](glossar.md) - Begriffe.
`,
    'wiki/log.md': `# Verlauf

## 2026-10-06
* **Struktur**: Gerüst angelegt.

## 2026-10-05
* **Ingest**: Erste Quelle.
`,
    'wiki/glossar.md': `---
type: Glossar
title: Glossar
description: Begriffe.
${GEN}
---

# Begriffe
`,
    'wiki/themen/index.md': `# Themen

# Schlaf

* [Insomnie](insomnie.md) - Schlafstörung mit Ein- oder Durchschlafproblemen.
`,
    'wiki/themen/insomnie.md': `---
type: Thema
title: Insomnie
description: Schlafstörung mit Ein- oder Durchschlafproblemen.
bereich: schlaf
${GEN}
sources:
  - id: q-muster-2020
    resource: ../quellen/q-muster-2020.md
    title: Muster 2020
    stufe: literatur
---

# Kurz

Insomnie ist häufig.[^q-muster-2020]

[^q-muster-2020]: [Muster 2020](../quellen/q-muster-2020.md)
`,
    'wiki/quellen/index.md': `# Quellen

# Studien

* [Muster 2020](q-muster-2020.md) - Übersichtsarbeit zur Insomnie.
`,
    'wiki/quellen/q-muster-2020.md': `---
type: Quelle
title: Muster 2020
description: Übersichtsarbeit zur Insomnie.
art: studie
angabe: "Muster A. 2020. Insomnie. Journal 1:1."
${GEN}
sources:
  - id: original
    resource: https://example.org/muster-2020
    author: ext:muster-a
    stufe: literatur
---

# Was sie aussagt

Insomnie ist häufig.[^original]

# Verwendet in

[Insomnie](../themen/insomnie.md)

[^original]: [Original](https://example.org/muster-2020)
`,
  };
}

function buendel(aenderungen = {}) {
  const ordner = mkdtempSync(join(tmpdir(), 'wiki-test-'));
  const dateien = { ...grundbestand(), ...aenderungen };
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    if (inhalt === null) continue;
    mkdirSync(dirname(join(ordner, pfad)), { recursive: true });
    writeFileSync(join(ordner, pfad), inhalt);
  }
  return ordner;
}

function ergebnis(aenderungen) {
  const ordner = buendel(aenderungen);
  try {
    return pruefe(ordner, { jetzt: JETZT });
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

const regeln = (liste) => liste.map((f) => f.regel);

function erwarteFehler(regel, aenderungen, muster = /./) {
  const e = ergebnis(aenderungen);
  assert.ok(e.fehler.some((f) => f.regel === regel && muster.test(f.meldung)),
    `Fehler ${regel} (${muster}) erwartet, bekommen: ${JSON.stringify(e.fehler)}`);
}

function erwarteNichts(aenderungen) {
  const e = ergebnis(aenderungen);
  assert.deepEqual(e.fehler, []);
}

function erwarteHinweis(regel, aenderungen) {
  const e = ergebnis(aenderungen);
  assert.ok(regeln(e.hinweise).includes(regel), `Hinweis ${regel} erwartet, bekommen: ${JSON.stringify(e.hinweise)}`);
}

const thema = (kopf, rumpf = '\n# Kurz\n') => `---\n${kopf}\n---\n${rumpf}`;
const ersetze = (pfad, alt, neu) => {
  const inhalt = grundbestand()[pfad];
  assert.ok(inhalt.includes(alt), `Testfehler: „${alt}“ nicht in ${pfad}`);
  return { [pfad]: inhalt.replace(alt, neu) };
};

// ---------- Grundfall ----------

test('gültiges Bündel: keine Fehler, keine Hinweise', () => {
  const e = ergebnis({});
  assert.deepEqual(e.fehler, []);
  assert.deepEqual(e.hinweise, []);
});

// ---------- OKF v0.2 (§3, §4, §8, §9, §11) ----------

test('OKF: Eintrag ohne Kopfdaten', () => {
  erwarteFehler('kopfdaten', { 'wiki/themen/insomnie.md': '# Insomnie\n' });
});

test('OKF: Kopfdaten nicht lesbar (kaputtes YAML)', () => {
  erwarteFehler('kopfdaten', { 'wiki/themen/insomnie.md': '---\ntype: [Thema\n---\n' });
});

test('OKF: type fehlt oder ist leer', () => {
  erwarteFehler('type', ersetze('wiki/themen/insomnie.md', 'type: Thema', 'type: ""'));
});

test('OKF: index.md mit Kopfdaten (außer okf_version in der Wurzel)', () => {
  erwarteFehler('index', { 'wiki/themen/index.md': '---\ntype: Thema\n---\n' + grundbestand()['wiki/themen/index.md'] });
});

test('OKF: Wurzel-index.md ohne okf_version "0.2"', () => {
  erwarteFehler('index', ersetze('wiki/index.md', 'okf_version: "0.2"', 'okf_version: "0.1"'));
});

test('OKF: log.md mit falscher Datumsüberschrift', () => {
  erwarteFehler('log', ersetze('wiki/log.md', '## 2026-10-05', '## 05.10.2026'));
});

test('Log: neueste zuerst', () => {
  erwarteFehler('log', ersetze('wiki/log.md', '## 2026-10-05', '## 2026-10-07'));
});

test('Log: nur die festen Stichworte', () => {
  erwarteFehler('log', ersetze('wiki/log.md', '**Ingest**', '**Update**'));
});

// ---------- Arten und Pflichtfelder (CLAUDE §4) ----------

test('Art nicht in der Liste (Schreibweise)', () => {
  erwarteFehler('art', ersetze('wiki/themen/insomnie.md', 'type: Thema', 'type: thema'));
});

test('Pflichtfeld fehlt: description', () => {
  erwarteFehler('pflicht', ersetze('wiki/themen/insomnie.md', 'description: Schlafstörung mit Ein- oder Durchschlafproblemen.\n', ''));
});

test('Pflichtfeld fehlt: generated', () => {
  erwarteFehler('pflicht', ersetze('wiki/themen/insomnie.md', GEN + '\n', ''));
});

test('Pflichtfeld fehlt: bereich beim Thema', () => {
  erwarteFehler('pflicht', ersetze('wiki/themen/insomnie.md', 'bereich: schlaf\n', ''));
});

test('Pflichtfeld fehlt: angabe bei Fachquelle', () => {
  erwarteFehler('pflicht', ersetze('wiki/quellen/q-muster-2020.md', 'angabe: "Muster A. 2020. Insomnie. Journal 1:1."\n', ''));
});

test('Pflichtfeld fehlt: stale_after bei Leitlinie', () => {
  erwarteFehler('pflicht', ersetze('wiki/quellen/q-muster-2020.md', 'art: studie', 'art: leitlinie'));
});

test('Wert nicht erlaubt: status', () => {
  erwarteFehler('wert', ersetze('wiki/themen/insomnie.md', 'bereich: schlaf', 'bereich: schlaf\nstatus: fertig'));
});

test('Wert nicht erlaubt: stufe', () => {
  erwarteFehler('wert', ersetze('wiki/themen/insomnie.md', 'stufe: literatur', 'stufe: hoch'));
});

test('verified: [] ist verboten', () => {
  erwarteFehler('verified', ersetze('wiki/themen/insomnie.md', 'bereich: schlaf', 'bereich: schlaf\nverified: []'));
});

test('verified als einzelne Angabe ist erlaubt (OKF §5.2)', () => {
  const e = ergebnis(ersetze('wiki/themen/insomnie.md', 'bereich: schlaf',
    'bereich: schlaf\nverified: { by: human:betreiber, at: 2026-10-06T10:00:00+02:00 }'));
  assert.deepEqual(e.fehler, []);
});

test('verified als einzelne Angabe wird auch geprüft (Akteur)', () => {
  erwarteFehler('akteur', ersetze('wiki/themen/insomnie.md', 'bereich: schlaf',
    'bereich: schlaf\nverified: { by: Betreiber, at: 2026-10-06T10:00:00+02:00 }'));
});

test('Zeit ohne Zeitzone', () => {
  erwarteFehler('zeit', ersetze('wiki/themen/insomnie.md', 'at: 2026-10-06T09:52:09+02:00', 'at: 2026-10-06T09:52:09'));
});

test('Datum nicht JJJJ-MM-TT', () => {
  const e = ergebnis(entscheidung('status: draft\ngeltung: vorschlag', '06.10.2026'));
  assert.deepEqual(regeln(e.fehler), ['zeit']);
});

test('Akteur im falschen Format', () => {
  erwarteFehler('akteur', ersetze('wiki/themen/insomnie.md', 'by: claude-code/opus-5.5', 'by: Claude'));
});

// ---------- Kopplung status ↔ geltung ----------

function entscheidung(kopf, datum = '2026-10-06', entscheidet = 'betreiber', quellen = null) {
  return {
    'wiki/index.md': grundbestand()['wiki/index.md'] + '* [Entscheidungen](entscheidungen/index.md) - Entscheidungen\n',
    'wiki/entscheidungen/index.md': '# Entscheidungen\n\n# Alle\n\n* [Anrede](E-0001.md) - Ohne Anrede.\n',
    'wiki/entscheidungen/E-0001.md': thema(`type: Entscheidung
title: Anrede
description: Ohne Anrede.
${kopf}
entscheidet: ${entscheidet}
entschieden_am: ${datum}
${GEN}
${quellen ?? `sources:
  - id: s
    resource: https://example.org/s
    author: human:betreiber
    stufe: bestaetigt`}`, '\nText.[^s]\n\n[^s]: [S](https://example.org/s)\n'),
  };
}

test('Kopplung: vorschlag mit status stable', () => {
  erwarteFehler('kopplung', entscheidung('status: stable\ngeltung: vorschlag'));
});

test('Kopplung: gilt mit status draft', () => {
  erwarteFehler('kopplung', entscheidung('status: draft\ngeltung: gilt'));
});

test('Kopplung: gilt ohne status (= stable) ist richtig', () => {
  const e = ergebnis(entscheidung('geltung: gilt'));
  assert.deepEqual(e.fehler, []);
});

test('vorläufig ohne frage', () => {
  erwarteFehler('pflicht', entscheidung('status: stable\ngeltung: vorläufig'), /„frage“/);
});

test('Kopplung: deprecated ist bei jeder geltung erlaubt', () => {
  erwarteNichts(entscheidung('status: deprecated\ngeltung: gilt'));
});

test('Wert nicht erlaubt: entscheidet fremd (nur der Betreiber)', () => {
  erwarteFehler('wert', entscheidung('geltung: gilt', '2026-10-06', 'fremd'), /^entscheidet:/);
});

test('Pflichtfeld: leere Quellenliste zählt als fehlend', () => {
  erwarteFehler('pflicht', entscheidung('status: draft\ngeltung: vorschlag', '2026-10-06', 'betreiber', 'sources: []'), /„sources“/);
});

// ---------- Herkunft (CLAUDE §5) ----------

test('Fußnote ohne passenden sources-Eintrag', () => {
  erwarteFehler('fussnote', ersetze('wiki/themen/insomnie.md', 'Insomnie ist häufig.[^q-muster-2020]', 'Insomnie ist häufig.[^gibt-es-nicht]'));
});

test('sources-Eintrag ohne resource', () => {
  erwarteFehler('quellen', ersetze('wiki/themen/insomnie.md', '    resource: ../quellen/q-muster-2020.md\n', ''));
});

test('Stufe passt nicht zum Autor: wortlaut ohne human:betreiber', () => {
  erwarteFehler('stufe', ersetze('wiki/quellen/q-muster-2020.md', 'stufe: literatur', 'stufe: wortlaut'));
});

test('Stufe passt nicht zum Autor: wortlaut von einem LLM', () => {
  erwarteFehler('stufe', ersetze('wiki/quellen/q-muster-2020.md', 'author: ext:muster-a\n    stufe: literatur', 'author: claude-code/opus-5.5\n    stufe: wortlaut'));
});

test('Stufe passt nicht zum Autor: llm von einem Menschen', () => {
  erwarteFehler('stufe', ersetze('wiki/quellen/q-muster-2020.md', 'author: ext:muster-a\n    stufe: literatur', 'author: human:betreiber\n    stufe: llm'));
});

// ---------- Index (OKF §8, CLAUDE §3) ----------

test('Eintrag fehlt im Ordner-Index', () => {
  erwarteFehler('index', { 'wiki/themen/index.md': '# Themen\n\n# Schlaf\n' });
});

test('Index-Beschreibung nicht wortgleich mit description', () => {
  erwarteFehler('index', ersetze('wiki/themen/index.md', 'Ein- oder Durchschlafproblemen.', 'Durchschlafproblemen.'));
});

test('Index-Titel nicht wortgleich mit title', () => {
  erwarteFehler('index', ersetze('wiki/themen/index.md', '[Insomnie]', '[Schlaflosigkeit]'));
});

test('Ordner fehlt im Wurzel-Index', () => {
  erwarteFehler('index', ersetze('wiki/index.md', '* [Quellen](quellen/index.md) - Quellen\n', ''));
});

// ---------- Links und Dateien ----------

test('Link ins Leere (im Text)', () => {
  erwarteFehler('link', ersetze('wiki/quellen/q-muster-2020.md', '(../themen/insomnie.md)', '(../themen/gibt-es-nicht.md)'));
});

test('Link ins Leere (sources-Pfad)', () => {
  erwarteFehler('link', ersetze('wiki/themen/insomnie.md', 'resource: ../quellen/q-muster-2020.md', 'resource: ../quellen/q-fehlt-2020.md'));
});

test('Link ins Leere (Text, Ziel in <…> mit Leerzeichen)', () => {
  erwarteFehler('link', ersetze('wiki/themen/insomnie.md', '# Kurz\n', '# Kurz\n\n[x](<../quellen/gibt es nicht.md>)\n'));
});

test('erlaubt: Log verweist auf einen gelöschten Eintrag (Geschichte, nie ändern)', () => {
  erwarteNichts(ersetze('wiki/log.md', '* **Ingest**: Erste Quelle.', '* **Ingest**: Erste Quelle [Alt](themen/geloescht.md).'));
});

test('Link ab / (findet Obsidian nicht)', () => {
  erwarteFehler('link', ersetze('wiki/quellen/q-muster-2020.md', '(../themen/insomnie.md)', '(/themen/insomnie.md)'));
});

test('Link in einem Code-Block wird nicht geprüft', () => {
  const e = ergebnis(ersetze('wiki/themen/insomnie.md', '# Kurz\n', '# Kurz\n\n```\n[x](gibt-es-nicht.md)\n```\n'));
  assert.deepEqual(e.fehler, []);
});

test('Platzhalter aus einer Vorlage stehen geblieben', () => {
  erwarteFehler('platzhalter', ersetze('wiki/themen/insomnie.md', 'title: Insomnie', 'title: <Titel>'));
});

test('Platzhalter JJJJ-MM-TT im Text', () => {
  erwarteFehler('platzhalter', ersetze('wiki/themen/insomnie.md', '# Kurz\n', '# Kurz\n\nStand JJJJ-MM-TT.\n'));
});

test('Konfliktkopie von iCloud oder Obsidian', () => {
  erwarteFehler('konflikt', { 'wiki/themen/insomnie 2.md': grundbestand()['wiki/themen/insomnie.md'] });
});

// ---------- Hinweise (kein Fehler) ----------

test('Hinweis: stale_after erreicht', () => {
  erwarteHinweis('veraltet', ersetze('wiki/quellen/q-muster-2020.md', 'art: studie', 'art: studie\nstale_after: 2026-10-01T00:00:00+02:00'));
});

test('Hinweis: stale_after in weniger als 60 Tagen', () => {
  erwarteHinweis('veraltet', ersetze('wiki/quellen/q-muster-2020.md', 'art: studie', 'art: studie\nstale_after: 2026-11-15T00:00:00+01:00'));
});

test('stale_after in mehr als 60 Tagen: kein Hinweis', () => {
  const e = ergebnis(ersetze('wiki/quellen/q-muster-2020.md', 'art: studie', 'art: studie\nstale_after: 2027-06-01T00:00:00+02:00'));
  assert.deepEqual(e.hinweise, []);
});

test('Hinweis: Waise (kein anderer Eintrag verlinkt hierher)', () => {
  erwarteHinweis('waise', ersetze('wiki/quellen/q-muster-2020.md', '[Insomnie](../themen/insomnie.md)', 'Insomnie'));
});

test('Hinweis: Thema deutlich länger als 1.500 Wörter', () => {
  erwarteHinweis('groesse', ersetze('wiki/themen/insomnie.md', '# Kurz\n', '# Kurz\n\n' + 'Wort '.repeat(2000) + '\n'));
});

// ---------- Nach Sparring-Review: Werte, Pflichtfelder, verified ----------

test('Wert nicht erlaubt: art bei Quelle', () => {
  erwarteFehler('wert', ersetze('wiki/quellen/q-muster-2020.md', 'art: studie', 'art: artikel'), /^art:/);
});

test('Wert nicht erlaubt: stand bei Frage', () => {
  erwarteFehler('wert', {
    'wiki/index.md': grundbestand()['wiki/index.md'] + '* [Fragen](fragen/index.md) - Fragen\n',
    'wiki/fragen/index.md': '# Fragen\n\n# Offen\n\n* [Anrede](F-0001.md) - Wie sprechen wir an?\n',
    'wiki/fragen/F-0001.md': thema(`type: Frage\ntitle: Anrede\ndescription: Wie sprechen wir an?\nstand: zu\nan: betreiber\n${GEN}`),
  }, /^stand:/);
});

test('Pflichtfeld fehlt: anlass bei Präsentation', () => {
  erwarteFehler('pflicht', {
    'wiki/index.md': grundbestand()['wiki/index.md'] + '* [Präsentationen](praesentationen/index.md) - Vorträge\n',
    'wiki/praesentationen/index.md': '# Präsentationen\n\n# 2026\n\n* [Allergie](allergie.md) - Vortrag Allergie.\n',
    'wiki/praesentationen/allergie.md': thema(`type: Präsentation\ntitle: Allergie\ndescription: Vortrag Allergie.\ndatum: 2026-10-07\n${GEN}\nsources:\n  - id: s\n    resource: https://example.org/s`),
  }, /„anlass“/);
});

// Entität und Synthese: Pflicht ist `sources`
const neueArt = (ordner, datei, kopf, rumpf) => ({
  'wiki/index.md': grundbestand()['wiki/index.md'] + `* [${ordner}](${ordner}/index.md) - ${ordner}\n`,
  [`wiki/${ordner}/index.md`]: `# ${ordner}\n\n# Alle\n\n* [Eintrag](${datei}) - Ein Eintrag.\n`,
  [`wiki/${ordner}/${datei}`]: thema(`${kopf}\ntitle: Eintrag\ndescription: Ein Eintrag.\n${GEN}`, rumpf),
});
const QUELLE_S = 'sources:\n  - id: s\n    resource: https://example.org/s';

test('erlaubt: Entität mit sources', () => {
  erwarteNichts(neueArt('entitaeten', 'awmf.md', `type: Entität\n${QUELLE_S}`));
});

const MIT_GRUNDGEDANKE = '\n# Eintrag\n\n> **Grundgedanke:** „Ein Satz, wörtlich.“\n\nText.\n';

test('erlaubt: Synthese mit sources und Grundgedanke', () => {
  erwarteNichts(neueArt('synthesen', 'tinnitus-geraeusch.md', `type: Synthese\nstatus: draft\n${QUELLE_S}`, MIT_GRUNDGEDANKE));
});

test('erlaubt: Idee mit sources und Grundgedanke (Art Idee ist in der Liste)', () => {
  erwarteNichts(neueArt('ideen', 'garten.md', `type: Idee\n${QUELLE_S}`, MIT_GRUNDGEDANKE));
});

// D51: Idee und Synthese tragen den Grundgedanken wörtlich als erste nicht leere Zeile nach der Überschrift
test('D51: Synthese ohne Grundgedanke ist ein Fehler (Meldung nennt Grundgedanke)', () => {
  erwarteFehler('grundgedanke', neueArt('synthesen', 'x.md', `type: Synthese\n${QUELLE_S}`, '\n# Eintrag\n\nOhne Grundgedanke.\n'), /Grundgedanke/);
});

test('D51: Idee ohne Grundgedanke ist ein Fehler', () => {
  erwarteFehler('grundgedanke', neueArt('ideen', 'x.md', `type: Idee\n${QUELLE_S}`), /Grundgedanke/);
});

test('D51: Grundgedanke nicht als erste Zeile nach der Überschrift ist ein Fehler', () => {
  erwarteFehler('grundgedanke', neueArt('synthesen', 'x.md', `type: Synthese\n${QUELLE_S}`,
    '\n# Eintrag\n\nErst Text.\n\n> **Grundgedanke:** „Zu spät.“\n'), /Grundgedanke/);
});

test('D51: Grundgedanke ohne Anführungszeichen oder ohne Text ist ein Fehler', () => {
  erwarteFehler('grundgedanke', neueArt('synthesen', 'x.md', `type: Synthese\n${QUELLE_S}`, '\n# Eintrag\n\n> **Grundgedanke:** ohne Zitat\n'));
  erwarteFehler('grundgedanke', neueArt('synthesen', 'y.md', `type: Synthese\n${QUELLE_S}`, '\n# Eintrag\n\n> **Grundgedanke:**\n'));
});

test('D51 Gegenprobe: Thema braucht keinen Grundgedanken', () => {
  erwarteNichts({});
});

test('Pflichtfeld fehlt: sources bei Entität', () => {
  erwarteFehler('pflicht', neueArt('entitaeten', 'awmf.md', 'type: Entität'), /„sources“/);
});

test('Pflichtfeld fehlt: sources bei Synthese', () => {
  erwarteFehler('pflicht', neueArt('synthesen', 'x.md', 'type: Synthese', MIT_GRUNDGEDANKE), /„sources“/);
});

test('unbekannte Art bleibt ein Fehler', () => {
  erwarteFehler('art', neueArt('synthesen', 'x.md', `type: Steckbrief\n${QUELLE_S}`));
});

test('verified als reiner Text ist ein Fehler', () => {
  erwarteFehler('verified', ersetze('wiki/themen/insomnie.md', 'bereich: schlaf', 'bereich: schlaf\nverified: human:betreiber'));
});

test('verified ohne Zeitpunkt ist ein Fehler', () => {
  erwarteFehler('verified', ersetze('wiki/themen/insomnie.md', 'bereich: schlaf', 'bereich: schlaf\nverified: { by: human:betreiber }'), /„at“/);
});

test('generated ohne Zeitpunkt ist ein Fehler', () => {
  erwarteFehler('pflicht', ersetze('wiki/themen/insomnie.md', ', at: 2026-10-06T09:52:09+02:00', ''), /„at“/);
});

// ---------- Quellen außerhalb des Repos (Rohquellen in ../eingang) ----------

// legt neben dem Bündel (in tmpdir) eine Datei an und führt fn mit ihrem relativen Pfad (von wiki/themen/ aus) aus
function mitAussendatei(name, fn) {
  const datei = join(tmpdir(), name);
  writeFileSync(datei, 'Rohquelle');
  try {
    fn(`../../../${name}`);
  } finally {
    rmSync(datei, { force: true });
  }
}

test('erlaubt: Quelle außerhalb des Repos, wenn die Datei existiert (auch in <…> mit Leerzeichen)', () => {
  mitAussendatei('wiki-test aussen ok.md', (rel) => {
    erwarteNichts(ersetze('wiki/themen/insomnie.md', 'resource: ../quellen/q-muster-2020.md', `resource: "<${rel}>"`));
    erwarteNichts(ersetze('wiki/themen/insomnie.md', '# Kurz\n', `# Kurz\n\n[Roh](<${rel}>)\n`));
  });
});

test('Gegenprobe: Quelle außerhalb des Repos ohne vorhandene Datei ist ein Fehler', () => {
  const fehlt = '../../../wiki-test-gibt-es-nicht.md';
  assert.ok(!existsSync(join(tmpdir(), 'wiki-test-gibt-es-nicht.md')));
  erwarteFehler('link', ersetze('wiki/themen/insomnie.md', 'resource: ../quellen/q-muster-2020.md', `resource: "${fehlt}"`), /außerhalb des Repos/);
  erwarteFehler('link', ersetze('wiki/themen/insomnie.md', '# Kurz\n', `# Kurz\n\n[Roh](${fehlt})\n`));
});

test('ohne Eingang (CI): mit aussenPruefen: false sind Ziele außerhalb des Repos kein Fehler, innerhalb weiter schon', () => {
  const fehlt = '../../../wiki-test-gibt-es-nicht.md';
  const o = buendel(ersetze('wiki/themen/insomnie.md', '# Kurz\n', `# Kurz\n\n[Roh](${fehlt}) [Kaputt](gibt-es-nicht.md)\n`));
  try {
    const e = pruefe(o, { jetzt: JETZT, aussenPruefen: false });
    assert.deepEqual(e.fehler.map((f) => f.meldung.includes('gibt-es-nicht.md') && !f.meldung.includes('außerhalb')), [true], JSON.stringify(e.fehler));
  } finally {
    rmSync(o, { recursive: true, force: true });
  }
});

test('Kommandozeile: --ohne-eingang schaltet die Prüfung von Zielen außerhalb des Repos ab', () => {
  const aenderung = ersetze('wiki/themen/insomnie.md', 'resource: ../quellen/q-muster-2020.md', 'resource: "../../../wiki-test-gibt-es-nicht.md"');
  assert.equal(aufruf(aenderung).status, 1);
  assert.equal(aufruf(aenderung, '--ohne-eingang').status, 0);
});

// ---------- Erlaubtes wird nicht gemeldet ----------

test('erlaubt: nackte DOI als resource', () => {
  erwarteNichts(ersetze('wiki/quellen/q-muster-2020.md', 'resource: https://example.org/muster-2020', 'resource: 10.1093/sleep/zsu001'));
});

test('erlaubt: Links auf Anker und auf Ordner', () => {
  erwarteNichts(ersetze('wiki/themen/insomnie.md', '# Kurz\n', '# Kurz\n\n[Anker](#kurz) · [Quellen](../quellen/)\n'));
});

test('erlaubt: HTML, Autolinks und Vergleichszeichen im Text', () => {
  erwarteNichts(ersetze('wiki/themen/insomnie.md', '# Kurz\n',
    '# Kurz\n\n<u>wichtig</u> und <b>fett</b>, Hinweis<sup>1</sup>, <https://example.org> und <kontakt@example.org>. Schlaf <6 h oder >9 h.\n'));
});

test('erlaubt: Windows-Zeilenenden und BOM', () => {
  const insomnie = grundbestand()['wiki/themen/insomnie.md'];
  erwarteNichts({ 'wiki/themen/insomnie.md': '\uFEFF' + insomnie.replace(/\n/g, '\r\n') });
});

// ---------- Vorlagen-Platzhalter ----------

test('Platzhalter im Kopf aus der Quellen-Vorlage', () => {
  erwarteFehler('platzhalter', ersetze('wiki/quellen/q-muster-2020.md', 'resource: https://example.org/muster-2020', 'resource: <DOI oder URL>'));
});

test('Platzhalter, der wie ein Link beginnt (Quellen-Vorlage)', () => {
  erwarteFehler('platzhalter', ersetze('wiki/quellen/q-muster-2020.md', 'resource: https://example.org/muster-2020', 'resource: <https://doi.org/… oder URL>'));
});

test('Platzhalter im Fußnotentext aus der Vorlage', () => {
  erwarteFehler('platzhalter', ersetze('wiki/themen/insomnie.md', '(../quellen/q-muster-2020.md)\n', '(<resource>)\n'));
});

// ---------- Ungewöhnliche Eingaben ----------

test('Link mit % bricht die Prüfung nicht ab', () => {
  erwarteFehler('link', ersetze('wiki/themen/insomnie.md', '# Kurz\n', '# Kurz\n\n[x](50%.md)\n'));
});

test('leere Datei', () => {
  erwarteFehler('kopfdaten', { 'wiki/themen/insomnie.md': '' });
});

// ---------- Aufruf von der Kommandozeile ----------

function aufruf(aenderungen, ...argumente) {
  const ordner = buendel(aenderungen);
  try {
    return spawnSync(process.execPath, [SKRIPT, ...argumente, ordner], { encoding: 'utf8' });
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

test('Kommandozeile: gültig → Exit 0', () => {
  const r = aufruf({});
  assert.equal(r.status, 0, r.stderr + r.stdout);
});

test('Kommandozeile: Fehler → Exit 1 und Meldung mit Datei', () => {
  const r = aufruf(ersetze('wiki/themen/insomnie.md', 'type: Thema', 'type: thema'));
  assert.equal(r.status, 1, r.stderr + r.stdout);
  assert.match(r.stdout, /wiki\/themen\/insomnie\.md/);
});

test('Kommandozeile: --json liefert fehler und hinweise', () => {
  const r = aufruf(ersetze('wiki/themen/insomnie.md', 'type: Thema', 'type: thema'), '--json');
  const daten = JSON.parse(r.stdout);
  assert.ok(Array.isArray(daten.fehler) && daten.fehler.length > 0);
  assert.ok(Array.isArray(daten.hinweise));
});

test('Kommandozeile: Ordner ohne wiki/ → Exit 2', () => {
  const ordner = mkdtempSync(join(tmpdir(), 'wiki-leer-'));
  try {
    const r = spawnSync(process.execPath, [SKRIPT, ordner], { encoding: 'utf8' });
    assert.equal(r.status, 2, r.stderr + r.stdout);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
});

// ---------- Betreiber aus wiki.json (Vorlage: keine Personennamen im Code) ----------

test('Betreiber aus wiki.json: entscheidet, wortlaut-<betreiber> und human:<betreiber> gelten für ihn', () => {
  const e = ergebnis({
    'wiki.json': JSON.stringify({ betreiber: 'erika' }),
    ...entscheidung('geltung: gilt', '2026-10-06', 'erika', `sources:
  - id: s
    resource: https://example.org/s
    author: human:erika
    stufe: wortlaut`),
  });
  assert.deepEqual(e.fehler, []);
});

test('Gegenprobe Betreiber: steht in wiki.json ein anderer, ist der Standard-Betreiber fremd', () => {
  const e = ergebnis({ 'wiki.json': JSON.stringify({ betreiber: 'erika' }), ...entscheidung('geltung: gilt') });
  assert.ok(e.fehler.some((f) => f.regel === 'wert' && /^entscheidet:/.test(f.meldung)), JSON.stringify(e.fehler));
  const w = ergebnis({ 'wiki.json': JSON.stringify({ betreiber: 'erika' }), ...ersetze('wiki/quellen/q-muster-2020.md', 'author: ext:muster-a\n    stufe: literatur', 'author: human:betreiber\n    stufe: wortlaut') });
  assert.ok(w.fehler.some((f) => f.regel === 'stufe'), JSON.stringify(w.fehler));
});

test('Betreiber als Option geht vor wiki.json', () => {
  const o = buendel({ 'wiki.json': JSON.stringify({ betreiber: 'erika' }), ...entscheidung('geltung: gilt', '2026-10-06', 'max') });
  try {
    assert.deepEqual(pruefe(o, { jetzt: JETZT, betreiber: 'max' }).fehler, []);
  } finally {
    rmSync(o, { recursive: true, force: true });
  }
});

test('Kommandozeile: läuft auch über einen Symlink (npm legt bin-Befehle als Link an) und prüft ohne Argument das aktuelle Verzeichnis', () => {
  const ordner = buendel({});
  const link = join(mkdtempSync(join(tmpdir(), 'wiki-bin-')), 'wiki-pruefen');
  try {
    symlinkSync(SKRIPT, link);
    const r = spawnSync(process.execPath, [link], { encoding: 'utf8', cwd: ordner });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /keine Fehler/);
    const kaputt = buendel(ersetze('wiki/themen/insomnie.md', 'type: Thema', 'type: thema'));
    const r2 = spawnSync(process.execPath, [link], { encoding: 'utf8', cwd: kaputt });
    rmSync(kaputt, { recursive: true, force: true });
    assert.equal(r2.status, 1, r2.stderr + r2.stdout);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
    rmSync(dirname(link), { recursive: true, force: true });
  }
});
