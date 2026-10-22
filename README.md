# Workflow

Lokale App zum Bauen von Spielen mit **Worky**, deinem KI-Team (Claude Code, Codex, Gemini, Gratis-KI). Workflow läuft nur auf deinem PC unter http://127.0.0.1:4180.

Hervorgegangen aus der IE Werkstatt im Repo `industrial-empire` (Ordner `workshop-prototype`). Plan und Design: `plaene/Workflow-App-Plan.md` im Projektordner von Claude, Design-Entwurf https://claude.ai/artifact/RoKsCQ9dTto4p28WT6oZRA.

## Starten

1. Repo mit GitHub Desktop klonen, am besten nach `Documents\GitHub\workflow` (direkt neben `industrial-empire`).
2. `Start-Workflow.bat` doppelklicken. Die Seite öffnet sich im Browser.
3. Beim ersten Start trägt Workflow `industrial-empire` automatisch als Projekt ein, wenn es daneben liegt.

Voraussetzungen wie bei der IE Werkstatt: Node.js, Claude Code (mit Claude Max angemeldet), Git. Codex, Antigravity und OpenRouter sind optional.

## Projekte

- Oben links auf den Projektnamen klicken: Projekt wechseln oder ein neues hinzufügen (Name, Ordner, Art).
- Worky arbeitet immer im Ordner des gewählten Projekts: dessen `CLAUDE.md`, `docs/` (Tresor), `.claude/agents`, Skills und `.mcp.json` (Studio, Blender).
- Chats, Ideen und der Tresor-Ordner werden im Browser je Projekt getrennt gemerkt.
- „Aus der Liste nehmen“ löscht nie Dateien.
- Die Projektliste liegt nur auf diesem PC in `app/daten/projekte.json`.

## Schlüssel

Optionale Schlüssel stehen in `app/.env.local` (nie committen): `OPENROUTER_API_KEY`, `FREESOUND_API_KEY`. Die Datei aus der alten Werkstatt (`industrial-empire\workshop-prototype\.env.local`) kann einfach hierher kopiert werden.

## Prüfen vor dem Commit

```
node --check app/server.mjs
for f in app/*.js app/*.mjs; do node --check "$f"; done
```
