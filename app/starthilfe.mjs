// Ideen-Starthilfe (Ausbau 2026-10-23): Beim Anlegen eines Projekts (oder per Knopf „Neue Ideen sammeln“) sammelt
// Worky mit einer kurzen Claude-Anfrage ohne Werkzeuge Inspiration: ähnliche Spiele, erste Bau-Schritte, weitere
// Ideen, fertige Start-Prompts und Fragen zum Nachdenken. Gespeichert in daten/starthilfe/<projekt>.json (für die
// Anzeige) und als docs/Starthilfe.md im Tresor des Projekts (damit Worky es später kennt). Nichts wird zur Aufgabe.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_WISH = 600;

// Was die Vorlage schon mitbringt, damit die Schritte zum echten Startpunkt passen
const KIND_HINTS = {
  roblox: 'Roblox-Spiel mit Rojo und Luau. Die Vorlage hat schon Server, Client und Spielwerte in src/shared/Config/. Worky baut und testet selbst in Roblox Studio. Ähnliche Spiele bitte vor allem aus Roblox.',
  web: 'Browser-Spiel in HTML, CSS und JavaScript ohne Pakete. Die Vorlage ist ein kleines Startspiel „Sammle die Sterne“ (Tasten und Touch). Worky testet das Spiel selbst im Browser ohne Fenster.',
  godot: 'Godot-Spiel mit GDScript (Szenen in scenes/, Skripte in scripts/). Die Vorlage hat nur Ordner, Regeln und Tresor.',
  unity: 'Unity-Spiel mit C# (Assets/Scripts/). Die Vorlage hat nur Ordner, Regeln und Tresor; getestet wird im Unity-Editor.',
  andere: 'Art noch offen. Die Vorlage hat nur Regeln und Tresor.'
};

const clean = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const list = (value, max) => Array.isArray(value) ? value.slice(0, max) : [];

// Antwort von Claude in eine sichere, kleine Form bringen (nur Text, feste Längen)
function normalize(raw) {
  const match = /\{[\s\S]*\}/.exec(String(raw || ''));
  if (!match) throw new Error('Worky hat keine lesbare Starthilfe geliefert. Probier es nochmal.');
  let data;
  try { data = JSON.parse(match[0]); } catch { throw new Error('Worky hat keine lesbare Starthilfe geliefert. Probier es nochmal.'); }
  const result = {
    kurz: clean(data.kurz, 400),
    aehnlich: list(data.aehnlich, 5).map((item) => ({ name: clean(item?.name, 80), was: clean(item?.was, 240), abgucken: clean(item?.abgucken, 240) })).filter((item) => item.name),
    schritte: list(data.schritte, 7).map((item) => ({ titel: clean(item?.titel, 80), text: clean(item?.text, 300) })).filter((item) => item.titel),
    ideen: list(data.ideen, 10).map((item) => ({ titel: clean(item?.titel, 80), text: clean(item?.text, 300) })).filter((item) => item.titel),
    prompts: list(data.prompts, 6).map((item) => ({ titel: clean(item?.titel, 60), prompt: clean(item?.prompt, 800) })).filter((item) => item.titel && item.prompt),
    fragen: list(data.fragen, 6).map((item) => clean(item, 200)).filter(Boolean)
  };
  if (!result.ideen.length && !result.schritte.length) throw new Error('Worky hat keine Ideen geliefert. Probier es nochmal.');
  return result;
}

function toMarkdown(project, wish, result, date) {
  const lines = [`# Starthilfe für ${project.name}`, '', `Gesammelt von Worky am ${date} aus: „${wish}“ (${project.kindLabel}).`, 'Das sind Vorschläge zum Nachdenken. Eine Idee bleibt eine Idee, bis du sie freigibst.', ''];
  if (result.kurz) lines.push(result.kurz, '');
  if (result.aehnlich.length) {
    lines.push('## Ähnliche Spiele', '', '_Aus Workys Wissen, nicht live im Internet gesucht._', '');
    for (const item of result.aehnlich) lines.push(`- **${item.name}**: ${item.was}${item.abgucken ? ` Abgucken: ${item.abgucken}` : ''}`);
    lines.push('');
  }
  if (result.schritte.length) {
    lines.push('## So gehst du es an', '');
    result.schritte.forEach((item, index) => lines.push(`${index + 1}. **${item.titel}**: ${item.text}`));
    lines.push('');
  }
  if (result.ideen.length) {
    lines.push('## Weitere Ideen', '');
    for (const item of result.ideen) lines.push(`- **${item.titel}**: ${item.text}`);
    lines.push('');
  }
  if (result.prompts.length) {
    lines.push('## Start-Prompts für Worky', '');
    for (const item of result.prompts) lines.push(`- **${item.titel}**: ${item.prompt}`);
    lines.push('');
  }
  if (result.fragen.length) {
    lines.push('## Fragen zum Nachdenken', '');
    for (const item of result.fragen) lines.push(`- ${item}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function createStarterHelp(dataDir, ask) {
  const folder = path.join(dataDir, 'starthilfe');
  const running = new Map(); // Projekt-ID → Wunsch, solange Worky sammelt
  const fileOf = (id) => path.join(folder, `${String(id).replace(/[^a-z0-9-]/gi, '_')}.json`);

  async function read(id) {
    try { return JSON.parse(await readFile(fileOf(id), 'utf8')); } catch { return null; }
  }

  function prompt(project, wish) {
    return [
      'Du bist Worky, ein freundlicher Spiele-Mentor für einen deutschsprachigen Anfänger (locker, du-Form, gern „bruder“).',
      `Er startet gerade ein neues Spiel namens „${project.name}“. Seine grobe Idee: „${wish}“`,
      `Technik: ${KIND_HINTS[project.kind] || KIND_HINTS.andere}`,
      '',
      'Sammle Starthilfe, damit er schnell auf gute Ideen kommt und weiß, wie er anfängt:',
      '- kurz: 1–2 Sätze, wie das Spiel werden könnte (motivierend, konkret).',
      '- aehnlich: 3–5 echte, bekannte Spiele mit ähnlicher Idee. Nur Spiele, bei denen du sicher bist, dass es sie gibt; nichts erfinden. Je Spiel: was es gut macht und was er sich davon abgucken kann.',
      '- schritte: 4–6 erste Bau-Schritte in sinnvoller Reihenfolge, klein angefangen (erst etwas Spielbares, dann ausbauen).',
      '- ideen: 6–10 weitere mögliche Ideen (Spielmechaniken, Ziele, Belohnungen, Stil, Überraschungen), jede kurz erklärt.',
      '- prompts: 4–6 fertige Aufträge an Worky (den KI-Helfer, der im Projekt programmiert), die er nur abschicken muss. Jeder Auftrag ist ein kleiner, konkreter Schritt, auf Deutsch, in Ich-Form („Bau mir …“), und endet mit „Erklär mir danach, wie ich es teste.“',
      '- fragen: 3–5 Fragen, die ihm helfen, sein Spiel genauer zu überlegen.',
      'Keine Links, keine Asset-IDs, keine erfundenen Zahlen oder Werkzeuge.',
      '',
      'Antworte NUR mit diesem JSON, ohne Text davor oder danach:',
      '{"kurz":"…","aehnlich":[{"name":"…","was":"…","abgucken":"…"}],"schritte":[{"titel":"…","text":"…"}],"ideen":[{"titel":"…","text":"…"}],"prompts":[{"titel":"…","prompt":"…"}],"fragen":["…"]}'
    ].join('\n');
  }

  // Startet im Hintergrund; das Ergebnis holt die Seite mit get() ab
  function start(project, wishValue) {
    const wish = clean(wishValue, MAX_WISH);
    if (!wish) throw Object.assign(new Error('Schreib kurz, worum es in deinem Spiel gehen soll.'), { status: 400 });
    if (running.has(project.id)) throw Object.assign(new Error('Worky sammelt gerade schon Ideen für dieses Projekt.'), { status: 409 });
    running.set(project.id, wish);
    const startedAt = new Date().toISOString();
    (async () => {
      let entry;
      try {
        const result = normalize(await ask(prompt(project, wish)));
        entry = { status: 'fertig', wish, at: new Date().toISOString(), result };
        // In den Tresor des Projekts, damit Worky die Starthilfe später mitliest
        try {
          const docs = path.join(project.root, 'docs');
          if (existsSync(project.root)) {
            await mkdir(docs, { recursive: true });
            await writeFile(path.join(docs, 'Starthilfe.md'), toMarkdown(project, wish, result, entry.at.slice(0, 10)), 'utf8');
            entry.note = 'docs/Starthilfe.md';
          }
        } catch (error) { console.error(`Starthilfe in den Tresor: ${error.message}`); }
      } catch (error) {
        const old = await read(project.id);
        entry = { ...(old?.status === 'fertig' ? old : {}), status: old?.status === 'fertig' ? 'fertig' : 'fehler', error: error.message || 'Das hat nicht geklappt.', failedAt: new Date().toISOString() };
        console.error(`Starthilfe für ${project.name}: ${error.message}`);
      } finally {
        running.delete(project.id);
      }
      try {
        await mkdir(folder, { recursive: true });
        await writeFile(fileOf(project.id), JSON.stringify(entry, null, 2), 'utf8');
      } catch (error) { console.error(`Starthilfe speichern: ${error.message}`); }
    })();
    return { status: 'laeuft', wish, startedAt };
  }

  async function get(project) {
    const saved = await read(project.id);
    if (running.has(project.id)) return { ...(saved || {}), status: 'laeuft', wish: running.get(project.id), previous: saved?.status || null };
    return saved || { status: 'leer' };
  }

  return { start, get, running: (id) => running.has(id) };
}
