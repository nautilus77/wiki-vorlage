#!/usr/bin/env node
// Prüf-Skript für ein Wiki: OKF v0.2 (§3, §4, §5, §7, §8, §9, §11) und die Regeln im Regelkern (AGENTS.md).
// Aufruf: wiki-pruefen [--json] [--ohne-eingang] [Ordner]   (ohne Ordner: aktuelles Verzeichnis)
// Exit 0 = keine Fehler, 1 = Fehler, 2 = Skript/Ordner kaputt. --ohne-eingang (CI): Ziele außerhalb des Repos nicht prüfen.
// Rohquellen liegen außerhalb des Repos (Eingang, z. B. ../eingang); Verweise dorthin werden gegen das Dateisystem geprüft.
// Der Betreiber des Wikis (Akteur-Kennung) steht in wiki.json („betreiber“); ohne Angabe gilt „betreiber“.
// Fehler verletzen eine feste Regel; Hinweise sind Arbeitsaufträge für /projektstand (veraltet, Waisen, Größe …).
import { readdirSync, readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { join, dirname, relative, resolve, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

// Regelkern §4: verbindliche Liste der Arten und Pflichtfelder (außer type, title, description, generated)
const PFLICHT = {
  Thema: ['bereich'],
  Quelle: ['art'],
  Entscheidung: ['geltung', 'entscheidet', 'entschieden_am', 'sources'],
  Frage: ['stand', 'an'],
  Regel: ['geltung', 'sources'],
  Präsentation: ['anlass', 'datum', 'sources'],
  Analyse: ['sources'],
  Entität: ['sources'],
  Synthese: ['sources'],
  Idee: ['sources'],
  Glossar: [],
};
const FACHQUELLE = ['leitlinie', 'studie', 'übersicht', 'buch'];
const STANDARD_BETREIBER = 'betreiber';
const werte = (betreiber) => ({
  status: ['draft', 'stable', 'deprecated'],
  geltung: ['gilt', 'vorläufig', 'vorschlag'],
  entscheidet: [betreiber],
});
const artWerte = (betreiber) => ({
  Quelle: [...FACHQUELLE, `wortlaut-${betreiber}`, 'material', 'notiz', 'präsentation', 'sonstiges'],
});

// Betreiber aus wiki.json der Wiki-Wurzel (fehlt die Datei oder das Feld: Standard)
export function betreiberAus(wurzel) {
  const datei = join(wurzel, 'wiki.json');
  if (!existsSync(datei)) return STANDARD_BETREIBER;
  let c;
  try {
    c = JSON.parse(readFileSync(datei, 'utf8'));
  } catch (e) {
    throw new Error(`wiki.json nicht lesbar: ${e.message}`);
  }
  return typeof c?.betreiber === 'string' && c.betreiber ? c.betreiber : STANDARD_BETREIBER;
}
const STAND = ['offen', 'beantwortet', 'ohne-antwort'];
const STUFEN = ['wortlaut', 'bestaetigt', 'llm', 'literatur'];
const LOG_STICHWORTE = ['Ingest', 'Query', 'Lint', 'Struktur', 'Standard'];
const RESERVIERT = ['index.md', 'log.md'];
const HTML_TAGS = new Set(('a abbr b blockquote br caption cite code dd del details div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 ' +
  'hr i img ins kbd li mark ol p pre q s small span strong sub summary sup table tbody td th thead tr u ul').split(' '));
const DOI = /^10\.\d{4,}\//;

const ZEIT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const AKTEUR = /^(human|process|ext):[a-z0-9][a-z0-9._-]*$|^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const KONFLIKT = /( \d+|[ _-]conflict(ed)?( copy)?[^/]*)\.[a-z0-9]+$/i;
const TAG = 24 * 60 * 60 * 1000;

const posixPfad = (p) => p.split(sep).join('/').normalize('NFC');

function alleDateien(ordner, wurzel = ordner) {
  if (!existsSync(ordner)) return [];
  const liste = [];
  for (const e of readdirSync(ordner, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const pfad = join(ordner, e.name);
    if (e.isDirectory()) liste.push(...alleDateien(pfad, wurzel));
    else liste.push(posixPfad(relative(wurzel, pfad)));
  }
  return liste.sort();
}

// Text ohne Code-Blöcke und Inline-Code, damit Beispiele nicht als Links oder Platzhalter zählen
function ohneCode(text) {
  return text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');
}

function trenne(text) {
  if (!text.startsWith('---\n')) return null;
  const ende = text.indexOf('\n---', 3);
  if (ende < 0) return null;
  const nachEnde = text.slice(ende + 4);
  if (nachEnde !== '' && !nachEnde.startsWith('\n')) return null;
  return { kopf: text.slice(4, ende + 1), rumpf: nachEnde };
}

function links(text) {
  const funde = [];
  // Ziel in <…> darf Leerzeichen enthalten (Markdown): [Text](<pfad mit leerzeichen.md>)
  for (const m of ohneCode(text).matchAll(/(?<!!)\[([^\]\n]*)\]\((?:<([^>\n]+)>|([^)\s]+))\)/g)) funde.push({ text: m[1], ziel: m[2] ?? m[3] });
  return funde;
}

const istUrl = (z) => /^[a-z][a-z0-9+.-]*:/i.test(z);

function alsListe(wert) {
  if (wert === undefined || wert === null) return [];
  return Array.isArray(wert) ? wert : [wert];
}

function kopfLesen(teile) {
  try {
    return parse(teile.kopf) ?? {};
  } catch {
    return null;
  }
}

// BOM weg, Windows-Zeilenenden zu \n, Unicode NFC (macOS speichert Umlaute in Dateinamen zerlegt)
const lesen = (wurzel, pfad) => readFileSync(join(wurzel, pfad), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').normalize('NFC');

// Alle lesbaren Einträge in wiki/ (ohne index.md, log.md) mit Kopfdaten – für /projektstand
export function eintraege(wurzel) {
  const liste = [];
  for (const d of alleDateien(join(wurzel, 'wiki')).map((d) => 'wiki/' + d)) {
    if (!d.endsWith('.md') || RESERVIERT.includes(posix.basename(d))) continue;
    const teile = trenne(lesen(wurzel, d));
    const kopf = teile ? kopfLesen(teile) : null;
    if (kopf && typeof kopf === 'object' && !Array.isArray(kopf)) liste.push({ datei: d, kopf });
  }
  return liste;
}

export function pruefe(wurzel, { jetzt = new Date(), betreiber = betreiberAus(wurzel), aussenPruefen = true } = {}) {
  const WERTE = werte(betreiber);
  const ART_WERTE = artWerte(betreiber);
  const fehler = [];
  const hinweise = [];
  const melde = (liste) => (datei, regel, meldung) => liste.push({ datei, regel, meldung });
  const F = melde(fehler);
  const H = melde(hinweise);

  if (!existsSync(join(wurzel, 'wiki')) || !statSync(join(wurzel, 'wiki')).isDirectory()) {
    throw new Error(`kein Ordner wiki/ in ${wurzel}`);
  }

  const dateien = alleDateien(join(wurzel, 'wiki')).map((d) => 'wiki/' + d);
  const lies = (pfad) => lesen(wurzel, pfad);

  // Pfad relativ zu einer Datei auflösen; null = außerhalb des Repos
  const ziel = (von, z) => {
    let ohneAnker;
    try {
      ohneAnker = decodeURI(z.split('#')[0]);
    } catch {
      return undefined; // kaputte %-Kodierung
    }
    if (ohneAnker === '') return von;
    const voll = posix.normalize(posix.join(posix.dirname(von), ohneAnker));
    return voll.startsWith('../') ? null : voll.replace(/\/$/, '');
  };
  const pruefeLink = (von, z, wo) => {
    if (istUrl(z) || z.startsWith('#')) return null;
    if (z.startsWith('/')) {
      F(von, 'link', `${wo}: „${z}“ beginnt mit / – Links immer relativ (Obsidian findet sie sonst nicht)`);
      return null;
    }
    const p = ziel(von, z);
    if (p === undefined) {
      F(von, 'link', `${wo}: „${z}“ – ungültige %-Kodierung im Pfad`);
      return null;
    }
    if (p === null) {
      // Ziel außerhalb des Repos (Rohquellen im Eingang): erlaubt, wenn die Datei im Dateisystem vorhanden ist
      if (!aussenPruefen) return null;
      let abs;
      try {
        abs = resolve(wurzel, dirname(von), decodeURI(z.split('#')[0]));
      } catch {
        abs = null;
      }
      if (!abs || !existsSync(abs)) F(von, 'link', `${wo}: „${z}“ führt ins Leere (Ziel außerhalb des Repos nicht gefunden)`);
      return null;
    }
    if (!existsSync(join(wurzel, p))) {
      F(von, 'link', `${wo}: „${z}“ führt ins Leere`);
      return null;
    }
    return p;
  };

  for (const d of dateien) {
    if (KONFLIKT.test(posix.basename(d))) F(d, 'konflikt', 'sieht aus wie eine Konfliktkopie (iCloud/Obsidian) – prüfen und entfernen');
  }

  const md = dateien.filter((d) => d.startsWith('wiki/') && d.endsWith('.md'));
  const konzepte = new Map(); // pfad → { kopf, rumpf }
  const eingehend = new Map(); // pfad → Anzahl Links aus anderen Einträgen

  // ---------- Einträge (Konzepte) ----------
  for (const d of md.filter((d) => !RESERVIERT.includes(posix.basename(d)))) {
    const text = lies(d);
    const teile = trenne(text);
    if (!teile) {
      F(d, 'kopfdaten', 'keine Kopfdaten (--- … --- am Dateianfang), OKF §4');
      continue;
    }
    let kopf;
    try {
      kopf = parse(teile.kopf) ?? {};
    } catch (e) {
      F(d, 'kopfdaten', `Kopfdaten nicht lesbar: ${e.message.split('\n')[0]}`);
      continue;
    }
    if (typeof kopf !== 'object' || Array.isArray(kopf)) {
      F(d, 'kopfdaten', 'Kopfdaten sind keine Zuordnung (Feld: Wert)');
      continue;
    }
    konzepte.set(d, { kopf, rumpf: teile.rumpf });

    const type = kopf.type;
    if (typeof type !== 'string' || type.trim() === '') {
      F(d, 'type', '„type“ fehlt oder ist leer (OKF §4.1, einziges Pflichtfeld)');
      continue;
    }
    if (!(type in PFLICHT)) {
      F(d, 'art', `Art „${type}“ nicht in der Liste (${Object.keys(PFLICHT).join(', ')})`);
      continue;
    }

    // Pflichtfelder
    const leer = (w) => w === undefined || w === null || w === '' || (Array.isArray(w) && w.length === 0);
    const fehlt = ['title', 'description', 'generated', ...PFLICHT[type]].filter((f) => leer(kopf[f]));
    if (type === 'Quelle' && FACHQUELLE.includes(kopf.art)) {
      if (!kopf.angabe) fehlt.push('angabe');
      if (kopf.art === 'leitlinie' && !kopf.stale_after) fehlt.push('stale_after');
    }
    if (kopf.geltung === 'vorläufig' && !kopf.frage) fehlt.push('frage');
    for (const f of fehlt) F(d, 'pflicht', `Pflichtfeld „${f}“ fehlt (Art ${type})`);
    if (!leer(kopf.generated)) {
      if (typeof kopf.generated !== 'object' || Array.isArray(kopf.generated)) F(d, 'pflicht', '„generated“ muss { by, at } sein (OKF §5.2)');
      else for (const f of ['by', 'at']) if (!kopf.generated[f]) F(d, 'pflicht', `„generated“ braucht „${f}“ (OKF §5.2, Regelkern §4)`);
    }

    // Werte
    for (const [feld, erlaubt] of Object.entries(WERTE)) {
      if (kopf[feld] !== undefined && !erlaubt.includes(kopf[feld])) F(d, 'wert', `${feld}: „${kopf[feld]}“ nicht erlaubt (${erlaubt.join(', ')})`);
    }
    if (ART_WERTE[type] && kopf.art !== undefined && !ART_WERTE[type].includes(kopf.art)) {
      F(d, 'wert', `art: „${kopf.art}“ nicht erlaubt (${ART_WERTE[type].join(', ')})`);
    }
    if (type === 'Frage' && kopf.stand !== undefined && !STAND.includes(kopf.stand)) F(d, 'wert', `stand: „${kopf.stand}“ nicht erlaubt (${STAND.join(', ')})`);

    // Kopplung status ↔ geltung (Regelkern §4)
    if (kopf.geltung !== undefined) {
      const status = kopf.status ?? 'stable';
      const soll = kopf.geltung === 'vorschlag' ? 'draft' : 'stable';
      if (status !== 'deprecated' && status !== soll) F(d, 'kopplung', `geltung „${kopf.geltung}“ verlangt status „${soll}“, steht „${status}“`);
    }

    // Zeiten und Akteure (OKF §5.2, §5.5, §7)
    const zeit = (wert, wo) => {
      if (wert !== undefined && !(typeof wert === 'string' && ZEIT.test(wert))) F(d, 'zeit', `${wo}: „${wert}“ ist keine ISO-8601-Zeit mit Zeitzone`);
    };
    const akteur = (wert, wo) => {
      if (wert !== undefined && !(typeof wert === 'string' && AKTEUR.test(wert))) F(d, 'akteur', `${wo}: „${wert}“ – erwartet human:…, process:…, ext:… oder werkzeug/version`);
    };
    if (kopf.generated && typeof kopf.generated === 'object') {
      zeit(kopf.generated.at, 'generated.at');
      akteur(kopf.generated.by, 'generated.by');
    }
    zeit(kopf.stale_after, 'stale_after');
    for (const f of ['datum', 'entschieden_am']) {
      if (kopf[f] !== undefined && !(typeof kopf[f] === 'string' && DATUM.test(kopf[f]))) F(d, 'zeit', `${f}: „${kopf[f]}“ nicht im Format JJJJ-MM-TT`);
    }
    if (Array.isArray(kopf.verified) && kopf.verified.length === 0) F(d, 'verified', '„verified: []“ – ungeprüft heißt: Feld weglassen (OKF §5.3)');
    const verified = alsListe(kopf.verified);
    for (const v of verified) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        F(d, 'verified', `„verified“ braucht Einträge { by, at }, steht „${JSON.stringify(v)}“ (OKF §5.2)`);
        continue;
      }
      for (const f of ['by', 'at']) if (!v[f]) F(d, 'verified', `verified-Eintrag ohne „${f}“ (OKF §5.2)`);
      akteur(v.by, 'verified.by');
      zeit(v.at, 'verified.at');
    }

    // Quellen und Fußnoten (OKF §5.1, Regelkern §5)
    const ids = new Set();
    for (const [i, q] of alsListe(kopf.sources).entries()) {
      const wo = `sources[${i}]${q?.id ? ` (${q.id})` : ''}`;
      if (!q || typeof q !== 'object' || !q.resource) {
        F(d, 'quellen', `${wo}: „resource“ fehlt (OKF §5.1)`);
        if (q?.id !== undefined) ids.add(String(q.id));
        continue;
      }
      if (q.id !== undefined) {
        if (ids.has(String(q.id))) F(d, 'quellen', `${wo}: id doppelt`);
        ids.add(String(q.id));
      }
      akteur(q.author, `${wo}.author`);
      zeit(q.last_modified, `${wo}.last_modified`);
      if (q.stufe !== undefined && !STUFEN.includes(q.stufe)) F(d, 'wert', `${wo}: stufe „${q.stufe}“ nicht erlaubt (${STUFEN.join(', ')})`);
      if (q.author && STUFEN.includes(q.stufe)) {
        const a = String(q.author);
        const passt = {
          wortlaut: a === `human:${betreiber}`,
          bestaetigt: a.startsWith('human:'),
          llm: !a.startsWith('human:') && !a.startsWith('ext:'),
          literatur: a.startsWith('ext:'),
        }[q.stufe];
        if (!passt) F(d, 'stufe', `${wo}: stufe „${q.stufe}“ passt nicht zu author „${a}“ (Regelkern §5)`);
      }
      const r = String(q.resource).replace(/^<(.*)>$/, '$1');
      if (!istUrl(r) && !DOI.test(r) && (r.includes('/') || r.endsWith('.md'))) {
        const p = pruefeLink(d, r, `${wo}.resource`);
        if (p && p !== d) eingehend.set(p, (eingehend.get(p) ?? 0) + 1);
      }
    }
    for (const m of ohneCode(teile.rumpf).matchAll(/\[\^([^\]\s]+)\](?!:)/g)) {
      if (!ids.has(m[1])) F(d, 'fussnote', `Fußnote [^${m[1]}] hat keinen Eintrag in sources (OKF §5.1)`);
    }

    // Pfad-Felder
    for (const feld of ['frage', 'ersetzt', 'ersetzt_durch']) {
      for (const w of alsListe(kopf[feld])) {
        if (typeof w === 'string' && w && !istUrl(w)) pruefeLink(d, w, feld);
      }
    }

    // Idee und Synthese tragen den Grundgedanken wörtlich als erste nicht leere Zeile nach der Überschrift
    if (type === 'Synthese' || type === 'Idee') {
      const zeilen = teile.rumpf.split('\n');
      const h1 = zeilen.findIndex((z) => /^# \S/.test(z));
      const erste = h1 < 0 ? undefined : zeilen.slice(h1 + 1).find((z) => z.trim() !== '');
      if (!erste || !/^> \*\*Grundgedanke:\*\* [„"].+[“"]\s*$/.test(erste)) {
        F(d, 'grundgedanke', `${type} ohne „> **Grundgedanke:** „…“ als erste nicht leere Zeile nach der Überschrift (Regelkern §4)`);
      }
    }

    // Veraltet (OKF §5.5; /projektstand warnt 60 Tage vorher)
    if (typeof kopf.stale_after === 'string' && ZEIT.test(kopf.stale_after)) {
      const ab = new Date(kopf.stale_after);
      if (jetzt >= ab) H(d, 'veraltet', `veraltet seit ${kopf.stale_after} – neu prüfen`);
      else if (ab - jetzt < 60 * TAG) H(d, 'veraltet', `veraltet ab ${kopf.stale_after} (weniger als 60 Tage)`);
    }

    // Größe (Regelkern §8)
    const woerter = ohneCode(teile.rumpf).split(/\s+/).filter(Boolean).length;
    // §8 sagt „etwa 1.500“: Hinweis erst ab 1.800, damit nicht jedes längere Thema meldet
    if (type === 'Thema' && woerter > 1800) H(d, 'groesse', `${woerter} Wörter – Themen etwa 1.500 Wörter, teilen?`);
  }

  // ---------- Platzhalter und Links in allen Wiki-Dateien ----------
  // Platzhalter = <…> aus den Vorlagen: beginnt mit Buchstabe oder …, ist kein HTML-Tag und kein Autolink
  const platzhalter = (text) => {
    const funde = [];
    for (const m of text.matchAll(/<([^<>\n]+)>/g)) {
      const inhalt = m[1].trim();
      if (!/^[\p{L}…]/u.test(inhalt) || /^([a-z][a-z0-9+.-]*:\S+|\S+@\S+)$/i.test(inhalt)) continue; // Autolink
      const tag = /^\/?([a-z][a-z0-9]*)(\s[^>]*)?\/?$/i.exec(inhalt);
      if (tag && HTML_TAGS.has(tag[1].toLowerCase())) continue;
      funde.push(`<${inhalt}>`);
    }
    for (const p of ['JJJJ-MM-TT', 'F-0000', 'E-0000']) if (text.includes(p)) funde.push(p);
    return funde;
  };
  const texteIn = (wert) => (typeof wert === 'string' ? [wert] : wert && typeof wert === 'object' ? Object.values(wert).flatMap(texteIn) : []);
  for (const d of md) {
    const text = lies(d);
    const teile = trenne(text);
    const kopf = konzepte.get(d)?.kopf;
    const funde = [
      ...(kopf ? texteIn(kopf).flatMap(platzhalter) : []),
      ...platzhalter(ohneCode(teile ? teile.rumpf : text).replace(/<!--[\s\S]*?-->/g, '')),
    ];
    for (const f of new Set(funde)) F(d, 'platzhalter', `Platzhalter „${f}“ aus einer Vorlage steht noch`);
    const name = posix.basename(d);
    if (name === 'log.md') continue; // Log = Geschichte: darf auf gelöschte Einträge zeigen (OKF §6.1, §9)
    for (const l of links(teile?.rumpf ?? text)) {
      const p = pruefeLink(d, l.ziel, 'Link');
      if (p && !RESERVIERT.includes(name) && p !== d) eingehend.set(p, (eingehend.get(p) ?? 0) + 1);
    }
  }

  // ---------- Index-Dateien (OKF §8) ----------
  const ordner = [...new Set(md.map((d) => posix.dirname(d)))];
  for (const o of ordner) {
    const indexPfad = `${o}/index.md`;
    const istWurzel = o === 'wiki';
    if (!existsSync(join(wurzel, indexPfad))) {
      F(indexPfad, 'index', 'index.md fehlt in diesem Ordner');
      continue;
    }
    const text = lies(indexPfad);
    const teile = trenne(text);
    const kopf = teile ? kopfLesen(teile) : {};
    if (teile && !istWurzel) F(indexPfad, 'index', 'index.md darf keine Kopfdaten haben (OKF §8)');
    if (istWurzel) {
      if (!kopf || Object.keys(kopf).some((k) => k !== 'okf_version')) F(indexPfad, 'index', 'Wurzel-index.md: Kopfdaten nur „okf_version“ (OKF §8)');
      const version = kopf?.okf_version;
      if (String(version) !== '0.2') F(indexPfad, 'index', `okf_version muss „0.2“ sein, steht „${version ?? '–'}“`);
    }
    const eintraege = new Map();
    for (const m of ohneCode(teile ? teile.rumpf : text).matchAll(/^\* \[([^\]]*)\]\(([^)\s]+)\)(?: - (.*))?$/gm)) {
      const p = ziel(indexPfad, m[2]);
      if (p) eintraege.set(p, { titel: m[1], beschreibung: (m[3] ?? '').trim() });
    }
    // jeder Eintrag des Ordners steht im Index, wortgleich
    for (const [pfad, { kopf: k }] of konzepte) {
      if (posix.dirname(pfad) !== o) continue;
      const e = eintraege.get(pfad);
      const datei = posix.basename(pfad);
      if (!e) {
        F(indexPfad, 'index', `${datei} fehlt im Index`);
        continue;
      }
      if (k.title !== undefined && e.titel !== String(k.title)) F(indexPfad, 'index', `${datei}: Titel „${e.titel}“ ≠ title „${k.title}“`);
      if (k.description !== undefined && e.beschreibung !== String(k.description).trim()) {
        F(indexPfad, 'index', `${datei}: Beschreibung nicht wortgleich mit description`);
      }
    }
    // jeder Unterordner steht im Index darüber
    for (const u of ordner) {
      if (u !== o && posix.dirname(u) === o && !eintraege.has(`${u}/index.md`) && !eintraege.has(u)) {
        F(indexPfad, 'index', `Ordner ${posix.basename(u)}/ fehlt im Index`);
      }
    }
  }

  // ---------- Log (OKF §9, Regelkern §7) ----------
  for (const d of md.filter((d) => posix.basename(d) === 'log.md')) {
    const text = ohneCode(lies(d));
    let vorher = null;
    for (const m of text.matchAll(/^## (.*)$/gm)) {
      const datum = m[1].trim();
      if (!DATUM.test(datum)) {
        F(d, 'log', `Datumsüberschrift „${datum}“ nicht im Format JJJJ-MM-TT (OKF §9)`);
        continue;
      }
      if (vorher && datum >= vorher) F(d, 'log', `„${datum}“ steht unter „${vorher}“ – neueste zuerst`);
      vorher = datum;
    }
    for (const m of text.matchAll(/^\* \*\*([^*]+)\*\*/gm)) {
      if (!LOG_STICHWORTE.includes(m[1])) F(d, 'log', `Stichwort „${m[1]}“ nicht erlaubt (${LOG_STICHWORTE.join(', ')})`);
    }
  }

  // ---------- Waisen (Karpathy Lint) ----------
  for (const [pfad] of konzepte) {
    if (pfad !== 'wiki/glossar.md' && !eingehend.get(pfad)) H(pfad, 'waise', 'kein anderer Eintrag verlinkt hierher (nur der Index)');
  }

  // Größe des Einstiegs
  if (existsSync(join(wurzel, 'wiki/index.md')) && lies('wiki/index.md').split('\n').length > 60) {
    H('wiki/index.md', 'groesse', 'mehr als 60 Zeilen – höchstens eine Seite');
  }

  const ordnen = (a, b) => a.datei.localeCompare(b.datei) || a.regel.localeCompare(b.regel);
  return { fehler: fehler.sort(ordnen), hinweise: hinweise.sort(ordnen) };
}

// ---------- Kommandozeile ----------
// realpath: npm legt bin-Befehle als Symlink an (node_modules/.bin/wiki-pruefen)
const istHauptprogramm = (url) => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
};
if (istHauptprogramm(import.meta.url)) {
  const argumente = process.argv.slice(2);
  const json = argumente.includes('--json');
  const wurzel = resolve(argumente.find((a) => !a.startsWith('--')) ?? process.cwd());
  let e;
  try {
    e = pruefe(wurzel, { aussenPruefen: !argumente.includes('--ohne-eingang') });
  } catch (fehler) {
    console.error(`Prüfung nicht möglich: ${fehler.message}`);
    process.exit(2);
  }
  if (json) {
    console.log(JSON.stringify(e, null, 2));
  } else {
    const zeile = (f) => `  ${f.datei} · ${f.regel} · ${f.meldung}`;
    console.log(e.fehler.length ? `✗ ${e.fehler.length} Fehler:\n${e.fehler.map(zeile).join('\n')}` : '✓ keine Fehler');
    if (e.hinweise.length) console.log(`${e.hinweise.length} Hinweise:\n${e.hinweise.map(zeile).join('\n')}`);
  }
  process.exit(e.fehler.length ? 1 : 0);
}
