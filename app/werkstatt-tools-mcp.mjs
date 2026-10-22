// Werkstatt-Werkzeuge (MCP-Server über stdio) | workshop-prototype/werkstatt-tools-mcp.mjs
// Zusätzliche Werkzeuge für Worky, die über den Werkstatt-Server laufen. Schlüssel (z. B. für Freesound)
// liegen nur beim Server in .env.local; dieser Prozess und Claude sehen sie nie.
// Werkzeug „sound_suche“: lizenzfreie Geräusche auf Freesound suchen (nur lesen, nichts herunterladen).
// Seit 2026-10-22: „spiel_testen“ (Browser-Spiel ohne Fenster: Bild + Konsole), „godot_testen“ (Godot ohne Fenster)
// und „rechen_tests“ (alle Lune-Tests in tests/). Die Arbeit macht der Workflow-Server (werkzeuge.mjs).

import { createInterface } from 'node:readline';

const SERVER = process.env.IE_WORKSHOP_URL || 'http://127.0.0.1:4180';
const TOKEN = process.env.IE_APPROVAL_TOKEN || '';

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function text(value) {
  return { content: [{ type: 'text', text: value }] };
}

async function soundSearch(args) {
  const query = typeof args?.suchbegriff === 'string' ? args.suchbegriff.trim().slice(0, 120) : '';
  if (!query) return text('Bitte einen Suchbegriff angeben (am besten auf Englisch, z. B. "metal hammer hit").');
  const maxSeconds = Number.isFinite(Number(args?.max_sekunden)) ? Math.min(Math.max(Number(args.max_sekunden), 0.2), 600) : 30;
  const onlyCc0 = args?.nur_cc0 !== false;
  const url = `${SERVER}/api/tools/sounds?q=${encodeURIComponent(query)}&max=${maxSeconds}&cc0=${onlyCc0 ? 1 : 0}`;
  let response;
  try {
    response = await fetch(url, { headers: { 'X-Approval-Token': TOKEN } });
  } catch (error) {
    return text(`Die Werkstatt ist nicht erreichbar: ${error.message}`);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return text(result.error || 'Die Sound-Suche hat nicht geklappt.');
  if (!result.sounds?.length) return text(`Keine passenden Sounds für „${query}“ gefunden${onlyCc0 ? ' (nur CC0)' : ''}. Anderen englischen Begriff probieren.`);
  const lines = result.sounds.map((sound, index) => [
    `${index + 1}. ${sound.name} – ${sound.duration} s – Lizenz: ${sound.license} – von ${sound.username}`,
    `   Vorschau (mp3): ${sound.preview}`,
    `   Seite: ${sound.url}`
  ].join('\n'));
  return text(`Freesound-Treffer für „${query}“ (${result.total} insgesamt, ${onlyCc0 ? 'nur CC0' : 'alle Lizenzen'}):\n\n${lines.join('\n')}\n\nHinweis: Für das Spiel nur CC0 nehmen. Herunterladen und bei Roblox hochladen macht Timo; die Asset-ID kommt danach von ihm.`);
}

// Werkstatt-Server fragen (POST mit Token), Antwort als JSON
async function callServer(pathAndQuery) {
  let response;
  try {
    response = await fetch(`${SERVER}${pathAndQuery}`, { method: 'POST', headers: { 'X-Approval-Token': TOKEN } });
  } catch (error) {
    return { error: `Workflow ist nicht erreichbar: ${error.message}` };
  }
  const result = await response.json().catch(() => ({}));
  return response.ok ? result : { error: result.error || 'Das Werkzeug hat nicht geklappt.' };
}

async function gameTest(args) {
  const file = typeof args?.datei === 'string' ? args.datei.trim().slice(0, 120) : '';
  const seconds = Number.isFinite(Number(args?.sekunden)) ? Number(args.sekunden) : 5;
  const result = await callServer(`/api/werkzeuge/spiel/testen?datei=${encodeURIComponent(file)}&sekunden=${seconds}`);
  if (result.error) return text(result.error);
  const lines = result.console.map((line) => `${line.error ? '❌' : '·'} ${line.text} (${line.source})`);
  const summary = [
    `Spiel-Test mit ${result.browser}: ${result.url}`,
    result.errors ? `${result.errors} Fehler in der Konsole.` : 'Keine Fehler in der Konsole.',
    ...(result.maybeEmpty ? ['Achtung: Das Bild ist fast einfarbig, vielleicht zeigt die Seite nichts an.'] : []),
    '', 'Konsole:', ...(lines.length ? lines : ['(leer)']),
    '', 'Das Bild unten zeigt das Spiel nach ein paar Sekunden.'
  ].join('\n');
  return { content: [{ type: 'text', text: summary }, { type: 'image', data: result.image, mimeType: 'image/png' }] };
}

async function godotTest(args) {
  const frames = Number.isFinite(Number(args?.frames)) ? Number(args.frames) : 300;
  const result = await callServer(`/api/werkzeuge/godot/testen?frames=${frames}`);
  if (result.error) return text(result.error);
  return text([
    `Godot (${result.file}) ohne Fenster gestartet, Ende mit Code ${result.exitCode}${result.timedOut ? ' (Zeitgrenze erreicht)' : ''}.`,
    result.errors.length ? `Fehler (${result.errors.length}):\n${result.errors.join('\n')}` : 'Keine Fehlerzeilen gefunden.',
    '', 'Letzte Ausgabe:', result.output || '(keine)'
  ].join('\n'));
}

async function mathTests() {
  const result = await callServer('/api/werkzeuge/lune/testen');
  if (result.error) return text(result.error);
  if (!result.files) return text(result.hint);
  return text([
    `Rechen-Tests mit Lune: ${result.passed} von ${result.files} bestanden.`,
    ...result.results.map((item) => `${item.ok ? '✅' : '❌'} ${item.file}${item.ok ? '' : `\n${item.output.split('\n').slice(-12).join('\n')}`}`)
  ].join('\n'));
}

const TOOLS = [{
  name: 'sound_suche',
  description: 'Sucht lizenzfreie Geräusche auf Freesound.org (Titel, Dauer, Lizenz, Vorschau-Link als mp3). Nur lesen. Suchbegriffe am besten auf Englisch.',
  inputSchema: {
    type: 'object',
    properties: {
      suchbegriff: { type: 'string', description: 'Was gesucht wird, z. B. "hydraulic press hiss"' },
      max_sekunden: { type: 'number', description: 'Höchstens so lang (Standard 30)' },
      nur_cc0: { type: 'boolean', description: 'Nur CC0 (frei nutzbar, Standard: ja)' }
    },
    required: ['suchbegriff']
  }
}, {
  name: 'spiel_testen',
  description: 'Browser-Spiel des offenen Projekts ohne Fenster in Edge laden, ein paar Sekunden laufen lassen und Bildschirmfoto plus Konsole (Fehler) zurückgeben. Nur für Browser-Spiele.',
  inputSchema: {
    type: 'object',
    properties: {
      datei: { type: 'string', description: 'Welche Seite (Standard: index.html)' },
      sekunden: { type: 'number', description: 'Wie lange das Spiel vor dem Foto läuft (1 bis 30, Standard 5)' }
    }
  }
}, {
  name: 'godot_testen',
  description: 'Godot-Projekt des offenen Projekts ohne Fenster starten (vorher importieren), ein paar hundert Frames laufen lassen und Fehler aus der Ausgabe zurückgeben. Nur für Godot-Projekte.',
  inputSchema: { type: 'object', properties: { frames: { type: 'number', description: 'Wie viele Frames (Standard 300)' } } }
}, {
  name: 'rechen_tests',
  description: 'Alle Lune-Tests im Ordner tests/ des offenen Projekts ausführen (jede .luau-Datei mit „lune run“) und Ergebnis je Datei zurückgeben.',
  inputSchema: { type: 'object', properties: {} }
}];

async function handle(message) {
  const { id, method, params } = message;
  if (method === 'initialize') {
    return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'werkstatt_tools', version: '1.0.0' } } });
  }
  if (method === 'notifications/initialized' || id === undefined) return undefined;
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    if (params?.name === 'sound_suche') return send({ jsonrpc: '2.0', id, result: await soundSearch(params.arguments) });
    if (params?.name === 'spiel_testen') return send({ jsonrpc: '2.0', id, result: await gameTest(params.arguments) });
    if (params?.name === 'godot_testen') return send({ jsonrpc: '2.0', id, result: await godotTest(params.arguments) });
    if (params?.name === 'rechen_tests') return send({ jsonrpc: '2.0', id, result: await mathTests() });
    return send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unbekanntes Werkzeug.' } });
  }
  return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Methode nicht unterstützt: ${method}` } });
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch { return; }
  handle(message).catch((error) => {
    if (message?.id !== undefined) send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } });
  });
});
