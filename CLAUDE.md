# Projektnotizen für Claude (Workflow)

Workflow ist Timos lokale App zum Bauen von Spielen mit Worky (früher „IE Werkstatt“ im Repo `industrial-empire`, Ordner `workshop-prototype`). Timo ist Anfänger, spricht Deutsch (locker, „bruder“) und testet alles selbst auf seinem Windows-PC. Code ist erst „getestet“, wenn er es dort ausprobiert hat.

## Regeln

- Node-Server `app/server.mjs` (nur 127.0.0.1:4180), Seite `app/index.html` mit einfachen Skripten, keine Pakete, kein Build.
- Worky arbeitet immer im Ordner des gewählten Projekts (`PROJECT_ROOT`), nie im Workflow-Ordner selbst.
- Schlüssel nur in `app/.env.local` (git-ignoriert), nie lesen, ausgeben oder committen.
- Sperren für Worky bleiben: kein Push auf main, kein Force-Push, kein Merge, kein reset/rebase, Zweige nicht löschen.
- Kommentare und UI-Texte deutsch, Bezeichner englisch.
- Neue Projekte entstehen aus Vorlagen in `app/vorlagen.mjs` (Roblox, Browser-Spiel, Godot, Unity, Anderes); Browser-Spiele zeigt `/spiel/` in einer Sandbox ohne Zugriff auf die Workflow-API.
- Worky lernt (`app/lernen.mjs`): Lern-Runde und 👎 erzeugen nur Vorschläge in `app/daten/lernen.json`. In den Tresor (`Stolpersteine.md`, `Wissensdatenbank.md`) oder ins Wissen für alle Projekte (`app/daten/wissen/Allgemein.md`) kommt etwas erst nach Timos Klick auf „Übernehmen“.
- Vor jedem Commit: `for f in app/*.js app/*.mjs; do node --check "$f"; done`.
- Plan in Paketen: P1 Projekte, P2 neues Design, P3 neue Projekte mit Vorlagen, P4 Lernen, P5 Selbst-Verbesserung über Testkopie. Design-Entwurf: https://claude.ai/artifact/RoKsCQ9dTto4p28WT6oZRA
