---
name: projektstand
description: Stand eines Wikis nach wiki-vorlage prüfen (Karpathy „Lint“) – Prüf-Skript, Standards, offener Eingang laut Register, Zahlen, dazu inhaltliche Prüfung. Wöchentlich und vor jedem Arbeitsstart. Aufruf mit /projektstand im Wurzelordner eines Wikis mit AGENTS.md.
---

# /projektstand – Wiki prüfen (Lint)

Der Ablauf ist modellneutral und steht im Wiki selbst: **`AGENTS.md`, Abschnitt 7, „`/projektstand` (Lint)“**, mit
den Besonderheiten unter **„Nur dieses Wiki“**. Diese Anleitung fügt nichts hinzu; bei Widerspruch gilt `AGENTS.md`.

1. Im Wurzelordner des Wikis arbeiten (dort liegen `AGENTS.md` und `wiki.json`); sonst nachfragen.
2. `AGENTS.md` lesen, dann `npm run projektstand` (ohne Netz: `PROJEKTSTAND_OHNE_NETZ=1 npm run projektstand`) und
   die Schritte 1–4 des Ablaufs befolgen.
3. Im Wiki selbst nichts ändern; Befunde nur in `projekt/status.md` und als kurze Antwort an den Betreiber.
4. Kein Commit und kein Push ohne Go des Betreibers.
