# wiki-vorlage

Werkzeuge und gemeinsame Regeln für Wikis nach dem
[Open Knowledge Format (OKF) v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
und Karpathys [„LLM Wiki“](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Ein Wiki enthält nur
noch Inhalt, `wiki.json`, eine `AGENTS.md` (Regelkern + „Nur dieses Wiki“) und eine kurze `CLAUDE.md` mit `@AGENTS.md`.
Dieses Repo enthält keine Inhalte, keine Namen und keine privaten Orte.

## Inhalt

| Teil | Zweck |
|---|---|
| `bin/wiki-pruefen.mjs` | Prüfskript: OKF v0.2 und die festen Regeln des Regelkerns (`--json`, `--ohne-eingang` für CI) |
| `bin/wiki-projektstand.mjs` | Projektstand: Prüfskript, Standards, offener Eingang laut Register, Zahlen → `projekt/status.md` |
| `bin/wiki-diffwaechter.mjs` | Diff-Wächter `<base> <head>`: nur `wiki/` und `projekt/eingang-register.md`, keine Klarnamen aus `$PSEUDO_LISTE` |
| `bin/wiki-regelkern.mjs` | Regelkern als Kopie zwischen Markern in die AGENTS.md schreiben (`--schreiben`) oder abgleichen (`--pruefen`) |
| `bin/wiki-config.mjs` | `wiki-config pruefen wiki.json` |
| `regeln/AGENTS-kern.md` | gemeinsamer Regelkern samt modellneutralem Ablauf für Einarbeiten (Ingest) und Projektstand (Lint) |
| `beispiel/` | Muster für `wiki.json` und `projekt/standards.json` |
| `.github/workflows/pruefen.yml` | wiederverwendbarer Prüf-Workflow (`workflow_call`) |
| `.claude-plugin/`, `plugins/wiki/` | Claude-Plugin `wiki` mit den Skills `/eingang` und `/projektstand` (verweisen auf AGENTS.md) |

## In einem Wiki nutzen

`package.json` des Wikis:

```json
{
  "private": true,
  "type": "module",
  "scripts": {
    "pruefen": "wiki-pruefen",
    "projektstand": "wiki-projektstand"
  },
  "dependencies": {
    "wiki-vorlage": "github:nautilus77/wiki-vorlage#v1.0.0"
  }
}
```

Dann `npm install`, `npx wiki-regelkern --schreiben AGENTS.md` (danach unter „## Nur dieses Wiki“ die eigenen Regeln
ergänzen), `wiki.json` nach `beispiel/wiki.json` anlegen und `.github/workflows/pruefen.yml` im Wiki:

```yaml
on:
  push:
    branches: [main]
jobs:
  pruefen:
    uses: nautilus77/wiki-vorlage/.github/workflows/pruefen.yml@v1.0.0
```

Skills für Claude Code: `/plugin marketplace add nautilus77/wiki-vorlage`, dann `/plugin install wiki@wiki-vorlage`.

## wiki.json

| Feld | Bedeutung |
|---|---|
| `name` | Kennung des Wikis (Kleinbuchstaben, Ziffern, Bindestrich) |
| `betreiber` | optional: Akteur-Kennung des Betreibers (`human:<betreiber>`, `entscheidet`, `wortlaut-<betreiber>`); Standard `betreiber` |
| `eingang.quelle` | Ort der Rohquellen im rclone-Stil `remote:pfad` |
| `eingang.lokal` | Arbeitskopie des Eingangs, relativ zur Wiki-Wurzel |
| `register` | Register der eingearbeiteten Eingangsdateien |
| `zielmodus` | `direkt-main` oder `pr-automerge` |
| `pseudonym_liste.quelle` | Ort der Liste `Klarname => Pseudonym` (nie im Repo), rclone-Stil |

## Entwickeln

`npm test` (Node ≥ 24). Änderungen am Regelkern brauchen eine neue Version (Tag `vX.Y.Z`); die Wikis ziehen sie mit
neuer Abhängigkeit und `wiki-regelkern --schreiben AGENTS.md` nach.

## Lizenz

MIT
