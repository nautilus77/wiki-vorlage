#!/usr/bin/env node
// /projektstand: formaler Teil des Lint nach Karpathy und Regelkern §7.
// Prüf-Skript, Stand der beiden Standards, offener Eingang (Register), Zahlen → projekt/status.md (immer neu erzeugt).
// Die inhaltliche Prüfung schreibt das Modell danach in den Abschnitt „Inhaltlich (Claude)“ (Ablauf: AGENTS.md, Regelkern §7).
// Aufruf: wiki-projektstand [--ohne-netz] [--json] [--eingang <Ordner>] [Wiki-Ordner]   (ohne Wiki-Ordner: aktuelles Verzeichnis)
// Eingang: --eingang, sonst WIKI_EINGANG, sonst „eingang.lokal“ aus wiki.json (relativ zur Wiki-Wurzel), sonst ../eingang.
// Ohne Netz auch mit PROJEKTSTAND_OHNE_NETZ=1.
// Exit 0 = grün oder gelb, 1 = rot (Fehler oder Standard geändert), 2 = Lauf nicht möglich.
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { pruefe, eintraege } from './wiki-pruefen.mjs';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

async function ladenNetz(url) {
  const antwort = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'wiki-vorlage-projektstand' } });
  if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
  return antwort.text();
}

// Vergleicht jeden Standard mit dem gespeicherten Stand (Prüfsumme; bei OKF zusätzlich letzter Commit an SPEC.md)
export async function standardsPruefen(gespeichert, laden = ladenNetz) {
  const ergebnis = [];
  for (const s of gespeichert.standards) {
    try {
      const text = await laden(s.abruf);
      const hinweise = [];
      if (sha256(text) !== s.sha256) hinweise.push('Inhalt geändert (andere Prüfsumme)');
      let commitFehler = null;
      if (s.commits_api) {
        // eigener Versuch: scheitert die API (Ratenlimit, Timeout), bleibt eine erkannte Textänderung trotzdem „geändert“
        try {
          const [letzter] = JSON.parse(await laden(s.commits_api));
          if (!letzter?.sha) throw new Error('keine Commits in der Antwort');
          if (!letzter.sha.startsWith(s.commit)) {
            hinweise.push(`neuer Commit ${letzter.sha.slice(0, 7)} (${letzter.commit?.committer?.date ?? '?'}), gespeichert ${s.commit}`);
          }
        } catch (fehler) {
          commitFehler = `Commit nicht prüfbar (${fehler.message})`;
        }
      }
      const stand = hinweise.length ? 'geändert' : commitFehler ? 'nur Prüfsumme geprüft' : 'unverändert';
      if (commitFehler) hinweise.push(commitFehler);
      ergebnis.push({ name: s.name, stand, hinweis: hinweise.join('; ') });
    } catch (fehler) {
      ergebnis.push({ name: s.name, stand: 'nicht erreichbar', hinweis: fehler.message });
    }
  }
  return ergebnis;
}

// Offener Eingang: alle .md-Dateien im Eingang (rekursiv), deren Pfad relativ zum Eingang nicht im Register
// (projekt/eingang-register.md) vorkommt. Rohquellen werden nie geändert, „eingearbeitet“ steht nur im Register.
// Ordner-Zeilen: ``- `<ordner>/` · JJJJ-MM-TT · <seiten>`` (Pfad endet mit /) decken jede .md darunter, deren
// Änderungsdatum (mtime, lokales Datum) nicht nach dem Datum der Zeile liegt; neuere Dateien bleiben offen.
// null = Ordner fehlt
const lokalesDatum = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function offeneEingaenge(ordner, register = '') {
  if (!existsSync(ordner)) return null;
  const reg = register.normalize('NFC');
  const ordnerZeilen = [...reg.matchAll(/^- `([^`]+\/)` · (\d{4}-\d{2}-\d{2})/gm)].map((m) => ({ pfad: m[1], datum: m[2] }));
  const offen = [];
  const gehe = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
      const pfad = join(dir, e.name);
      if (e.isDirectory()) gehe(pfad);
      else if (e.isFile() && e.name.endsWith('.md')) {
        const rel = relative(ordner, pfad).split(sep).join('/');
        if (reg.includes(rel.normalize('NFC')) || reg.includes(rel)) continue;
        const tag = lokalesDatum(statSync(pfad).mtime);
        if (ordnerZeilen.some((z) => rel.normalize('NFC').startsWith(z.pfad) && tag <= z.datum)) continue;
        let kopf = {};
        const m = /^---\n([\s\S]*?)\n---/.exec(readFileSync(pfad, 'utf8').replace(/\r\n?/g, '\n'));
        try {
          kopf = (m && parse(m[1])) || {};
        } catch {
          kopf = {};
        }
        offen.push({ datei: rel, typ: kopf.typ ?? '', datum: kopf.datum ?? '', von: kopf.von ?? '' });
      }
    }
  };
  gehe(ordner);
  return offen;
}

export function zaehlen(wurzel) {
  const liste = eintraege(wurzel);
  const jeArt = {};
  for (const { kopf } of liste) jeArt[kopf.type] = (jeArt[kopf.type] ?? 0) + 1;
  return {
    gesamt: liste.length,
    jeArt: Object.fromEntries(Object.entries(jeArt).sort(([a], [b]) => a.localeCompare(b))),
    entwuerfe: liste.filter(({ kopf }) => kopf.status === 'draft').length,
    ungeprueft: liste.filter(({ kopf }) => kopf.verified === undefined).length,
    offeneFragen: liste.filter(({ kopf }) => kopf.type === 'Frage' && kopf.stand === 'offen').map(({ datei }) => datei),
  };
}

export function ampel({ pruefung, standards }) {
  if (pruefung.fehler.length || standards.some((s) => s.stand === 'geändert')) return 'rot';
  if (pruefung.hinweise.length || standards.some((s) => s.stand !== 'unverändert')) return 'gelb';
  return 'grün';
}

// ISO 8601 mit Zeitzone des Rechners (z. B. 2026-10-06T14:05:00+02:00)
const zeit = (d) => {
  const versatz = -d.getTimezoneOffset();
  const z = (n) => String(Math.abs(n)).padStart(2, '0');
  const lokal = new Date(d.getTime() + versatz * 60000).toISOString().slice(0, 19);
  return `${lokal}${versatz >= 0 ? '+' : '-'}${z(Math.trunc(versatz / 60))}:${z(versatz % 60)}`;
};

const AMPEL_TEXT = {
  rot: 'Fehler oder geänderter Standard: erst klären, dann weiterarbeiten.',
  gelb: 'Hinweise ansehen, kein Hindernis.',
  grün: 'alles in Ordnung.',
};

const INHALTLICH = '## Inhaltlich (Claude)';
const LEER = '(Noch nicht ergänzt.)';

// Inhaltlichen Teil aus dem letzten Bericht übernehmen, damit ein neuer Skriptlauf Claudes Befunde nicht löscht
function inhaltlichVorher(vorher) {
  const i = vorher?.indexOf(INHALTLICH) ?? -1;
  if (i < 0) return null;
  const text = vorher.slice(i + INHALTLICH.length).replace(/^_\(vom letzten Lauf[^\n]*\n+/, '').trim();
  return text && text !== LEER ? text : null;
}

export function bericht({ jetzt, pruefung, standards, eingang, zahlen, vorher = null, eingangOrt = 'Eingang' }) {
  const farbe = ampel({ pruefung, standards });
  const zeile = (f) => `* \`${f.datei}\` · ${f.regel} · ${f.meldung}`;
  const eingangZeile = (e) => `* \`${e.datei}\`${e.typ ? ` · ${e.typ}` : ''}${e.datum ? ` · ${e.datum}` : ''}${e.von ? ` · von ${e.von}` : ''}`;
  const alt = inhaltlichVorher(vorher);
  const arten = Object.entries(zahlen.jeArt).map(([a, n]) => `${a} ${n}`).join(', ');
  return [
    '# Projektstand',
    '',
    `Erzeugt von \`process:projektstand\` am ${zeit(jetzt)}. Wird bei jedem Lauf neu geschrieben; von Hand nur den Abschnitt`,
    '„Inhaltlich (Claude)“ ersetzen (/projektstand, Schritt 3).',
    '',
    '## Ampel',
    '',
    `**${farbe}** – ${AMPEL_TEXT[farbe]}`,
    '',
    '## Prüf-Skript',
    '',
    pruefung.fehler.length ? `${pruefung.fehler.length} Fehler:\n\n${pruefung.fehler.map(zeile).join('\n')}` : 'Keine Fehler.',
    '',
    pruefung.hinweise.length ? `${pruefung.hinweise.length} Hinweise:\n\n${pruefung.hinweise.map(zeile).join('\n')}` : 'Keine Hinweise.',
    '',
    '## Standards',
    '',
    '| Standard | Stand | Hinweis |',
    '|---|---|---|',
    ...standards.map((s) => `| ${s.name} | ${s.stand} | ${s.hinweis || '–'} |`),
    '',
    '## Eingang',
    '',
    eingang === null
      ? `Eingangsordner nicht gefunden (${eingangOrt}).`
      : eingang.length ? `Eingang offen: ${eingang.length}\n\n${eingang.slice(0, 50).map(eingangZeile).join('\n')}${eingang.length > 50 ? `\n* … und ${eingang.length - 50} weitere` : ''}`
      : 'Eingang offen: 0 (Nichts offen).',
    '',
    '## Wiki in Zahlen',
    '',
    `* Einträge: ${zahlen.gesamt}${arten ? ` (${arten})` : ''}`,
    `* Entwürfe (\`status: draft\`): ${zahlen.entwuerfe}`,
    `* Ungeprüft (ohne \`verified\`): ${zahlen.ungeprueft}`,
    `* Offene Fragen: ${zahlen.offeneFragen.length}${zahlen.offeneFragen.length ? ` (${zahlen.offeneFragen.map((f) => `\`${f}\``).join(', ')})` : ''}`,
    '',
    INHALTLICH,
    '',
    ...(alt ? ['_(vom letzten Lauf übernommen – bei Schritt 3 erneuern)_', '', alt] : [LEER]),
    '',
  ].join('\n');
}

// ---------- Kommandozeile ----------
// Eingang laut wiki.json (eingang.lokal relativ zur Wiki-Wurzel); null = keine Angabe
function eingangAusConfig(wurzel) {
  const datei = join(wurzel, 'wiki.json');
  if (!existsSync(datei)) return null;
  const c = JSON.parse(readFileSync(datei, 'utf8'));
  return typeof c?.eingang?.lokal === 'string' && c.eingang.lokal ? { lokal: join(wurzel, c.eingang.lokal), quelle: c.eingang.quelle } : null;
}

// realpath: npm legt bin-Befehle als Symlink an (node_modules/.bin/wiki-projektstand)
const istHauptprogramm = (url) => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
};
if (istHauptprogramm(import.meta.url)) {
  const argumente = process.argv.slice(2);
  const i = argumente.indexOf('--eingang');
  const frei = argumente.filter((a, n) => !a.startsWith('--') && (i < 0 || n !== i + 1));
  const wurzel = resolve(frei[0] ?? process.cwd());
  try {
    const config = eingangAusConfig(wurzel);
    const eingangOrdner = resolve(i >= 0 ? argumente[i + 1] : process.env.WIKI_EINGANG || config?.lokal || join(wurzel, '..', 'eingang'));
    const eingangOrt = config?.quelle ? `${config.quelle}, lokal ${eingangOrdner}` : eingangOrdner;
    const jetzt = new Date();
    const pruefung = pruefe(wurzel, { jetzt });
    const gespeichert = JSON.parse(readFileSync(join(wurzel, 'projekt/standards.json'), 'utf8'));
    const standards = (argumente.includes('--ohne-netz') || process.env.PROJEKTSTAND_OHNE_NETZ === '1')
      ? gespeichert.standards.map((s) => ({ name: s.name, stand: 'nicht geprüft (ohne Netz)', hinweis: '' }))
      : await standardsPruefen(gespeichert);
    const statusDatei = join(wurzel, 'projekt/status.md');
    const vorher = existsSync(statusDatei) ? readFileSync(statusDatei, 'utf8') : null;
    const registerDatei = join(wurzel, 'projekt/eingang-register.md');
    const register = existsSync(registerDatei) ? readFileSync(registerDatei, 'utf8') : '';
    const daten = { jetzt, pruefung, standards, eingang: offeneEingaenge(eingangOrdner, register), zahlen: zaehlen(wurzel) };
    const farbe = ampel(daten);
    if (argumente.includes('--json')) {
      console.log(JSON.stringify({ ampel: farbe, ...daten, jetzt: zeit(jetzt) }, null, 2));
    } else {
      writeFileSync(statusDatei, bericht({ ...daten, vorher, eingangOrt }));
      const kurz = standards.map((s) => `${s.name} ${s.stand}`).join(', ');
      console.log(`Ampel ${farbe} · ${pruefung.fehler.length} Fehler · ${pruefung.hinweise.length} Hinweise · Standards: ${kurz} · Eingang offen: ${daten.eingang?.length ?? '–'} → projekt/status.md`);
    }
    process.exit(farbe === 'rot' ? 1 : 0);
  } catch (fehler) {
    console.error(`Projektstand nicht möglich: ${fehler.message}`);
    process.exit(2);
  }
}
