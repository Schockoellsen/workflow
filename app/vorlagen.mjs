// Vorlagen für neue Projekte (Workflow Paket 3): Startdateien, Regeln (CLAUDE.md) und Tresor (docs/) je Spielart.
// Nur Text-Dateien, nichts wird heruntergeladen. server.mjs legt den Ordner an und ruft createProjectFiles auf.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const today = () => new Date().toISOString().slice(0, 10);

function commonRules(name, kindLabel, description) {
  return [
    `# Projektnotizen für Claude (${name})`,
    '',
    `${kindLabel}${description ? ` – ${description}` : ''}. Angelegt mit Workflow am ${today()}.`,
    'Der Entwickler ist Anfänger, spricht Deutsch (locker, „bruder“) und testet alles selbst. Code ist erst „getestet“, wenn er es ausprobiert hat.',
    '',
    '## Regeln',
    '',
    '- Kleine Schritte: erst erklären und planen, dann bauen. Vor größeren Änderungen fragen.',
    '- Kommentare und UI-Texte deutsch, Bezeichner englisch.',
    '- Schlüssel und Passwörter nur in `.env.local` (git-ignoriert), nie lesen, ausgeben oder committen.',
    '- Keine Assets, Asset-IDs, Schnittstellen oder Testergebnisse erfinden.',
    '- Jede Änderung mit Ziel, Test (was man sehen soll) und Abnahme-Checkliste erklären.'
  ];
}

const docsRules = [
  '',
  '## Dokumentation (Obsidian-Tresor in `docs/`)',
  '',
  '- Einstieg `docs/Start.md`, Schritte in `docs/Fahrplan.md`, Ideen in `docs/Ideen.md`.',
  '- Passierte Fehler mit Lösung als Zeile in `docs/Stolpersteine.md`, die Regel daraus in `docs/Wissensdatenbank.md`. Vor Arbeit an einem Thema dort nachlesen.',
  '- Nach jedem getesteten Schritt `docs/Fahrplan.md` ergänzen. Notizen des Entwicklers nie löschen, nur ergänzen.'
];

const KIND_RULES = {
  roblox: [
    '',
    '## Roblox',
    '',
    '- Rojo verwaltet `src/` (siehe `default.project.json`): `src/server` → ServerScriptService, `src/client` → StarterPlayerScripts, `src/shared` → ReplicatedStorage.',
    '- Der Server rechnet, der Client zeigt nur an. Client → Server schickt nur Wünsche, nie Preise oder Mengen; der Server prüft alles.',
    '- Spielwerte stehen in `src/shared/Config/`. Jedes ModuleScript endet mit `return`.',
    '- Jede Datei beginnt mit `-- Name (Typ) | Pfad in Studio`.',
    '- Vor jedem Commit alle `.luau`-Dateien mit `luau-compile` auf Syntax prüfen, wenn es installiert ist.'
  ],
  web: [
    '',
    '## Browser-Spiel',
    '',
    '- Einfaches HTML, CSS und JavaScript ohne Pakete und ohne Build: `index.html`, `style.css`, `spiel.js`.',
    '- Läuft am PC und auf dem Handy (Tasten und Touch). Workflow zeigt das Spiel über den Knopf „Spiel ansehen“.',
    '- Vor jedem Commit `node --check spiel.js` (und jede weitere .js-Datei).'
  ],
  godot: [
    '',
    '## Godot',
    '',
    '- GDScript, Szenen in `scenes/`, Skripte in `scripts/`. Worky kann Godot noch nicht selbst starten: der Entwickler testet im Godot-Editor.'
  ],
  unity: [
    '',
    '## Unity',
    '',
    '- C#-Skripte in `Assets/Scripts/`. Worky kann Unity noch nicht selbst starten: der Entwickler testet im Unity-Editor.'
  ],
  andere: []
};

function docsFiles(name, kindLabel, description) {
  return {
    'docs/Start.md': `# ${name}\n\n${kindLabel}${description ? `: ${description}` : ''}\n\n- [[Fahrplan]]: was schon fertig ist und was als Nächstes kommt\n- [[Ideen]]: Gedanken für später\n- [[Stolpersteine]]: Fehler, die passiert sind, und ihre Lösung\n- [[Wissensdatenbank]]: Regeln, die daraus entstanden sind\n`,
    'docs/Fahrplan.md': `# Fahrplan\n\n| Schritt | Inhalt | Stand |\n|---|---|---|\n| 1 | Projekt mit Workflow angelegt (${today()}) | erledigt |\n| 2 | Erste Spielidee mit Worky planen | offen |\n`,
    'docs/Ideen.md': '# Ideen\n\nHier sammeln wir Ideen. Eine Idee bleibt eine Idee, bis du sie freigibst.\n',
    'docs/Stolpersteine.md': '# Stolpersteine\n\nJede Zeile: Symptom → Ursache → Lösung (Datum).\n',
    'docs/Wissensdatenbank.md': '# Wissensdatenbank\n\nRegeln, die aus Stolpersteinen entstanden sind. Vor Arbeit an einem Thema hier nachlesen.\n',
    'docs/Workflow-Gedaechtnis.md': `# Workflow-Gedächtnis\n\nDas merkt sich Worky über dieses Projekt (kurz halten, nur was später wichtig ist).\n\n- ${today()}: Projekt „${name}“ angelegt (${kindLabel}).\n`
  };
}

function robloxFiles(slug) {
  const project = {
    name: slug,
    tree: {
      $className: 'DataModel',
      ReplicatedStorage: { Shared: { $path: 'src/shared' } },
      ServerScriptService: { Server: { $path: 'src/server' } },
      StarterPlayer: { StarterPlayerScripts: { Client: { $path: 'src/client' } } }
    }
  };
  return {
    'default.project.json': JSON.stringify(project, null, 2) + '\n',
    'src/shared/Config/GameConfig.luau': [
      '-- GameConfig (ModuleScript) | ReplicatedStorage/Shared/Config/GameConfig',
      '-- Alle Spielwerte an einem Ort. Neue Werte hier eintragen, nicht im Code verstreuen.',
      '',
      'local GameConfig = {',
      '\tStartCoins = 0, -- Münzen, mit denen ein neuer Spieler startet',
      '}',
      '',
      'return GameConfig',
      ''
    ].join('\n'),
    'src/server/Main.server.luau': [
      '-- Main (Script) | ServerScriptService/Server/Main',
      '-- Startpunkt auf dem Server: gibt jedem Spieler eine Münz-Anzeige in der Bestenliste.',
      '',
      'local Players = game:GetService("Players")',
      'local ReplicatedStorage = game:GetService("ReplicatedStorage")',
      '',
      'local GameConfig = require(ReplicatedStorage.Shared.Config.GameConfig)',
      '',
      'local function onPlayerAdded(player: Player)',
      '\tlocal leaderstats = Instance.new("Folder")',
      '\tleaderstats.Name = "leaderstats"',
      '\tleaderstats.Parent = player',
      '',
      '\tlocal coins = Instance.new("IntValue")',
      '\tcoins.Name = "Münzen"',
      '\tcoins.Value = GameConfig.StartCoins',
      '\tcoins.Parent = leaderstats',
      'end',
      '',
      'Players.PlayerAdded:Connect(onPlayerAdded)',
      'for _, player in Players:GetPlayers() do',
      '\tonPlayerAdded(player)',
      'end',
      '',
      'print("Server gestartet")',
      ''
    ].join('\n'),
    'src/client/Main.client.luau': [
      '-- Main (LocalScript) | StarterPlayer/StarterPlayerScripts/Client/Main',
      '-- Startpunkt auf dem Client: zeigt nur an, rechnet nichts.',
      '',
      'local Players = game:GetService("Players")',
      '',
      'print("Hallo " .. Players.LocalPlayer.Name .. ", das Spiel läuft!")',
      ''
    ].join('\n')
  };
}

function webFiles(name) {
  const title = name.replace(/[<>&"]/g, '');
  return {
    'index.html': `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <header class="hud"><strong>${title}</strong><span>Sterne: <b id="score">0</b></span></header>
    <canvas id="spiel" aria-label="Spielfeld"></canvas>
    <p class="hilfe">Pfeiltasten oder WASD · am Handy: Finger aufs Feld</p>
    <script src="spiel.js"></script>
  </body>
</html>
`,
    'style.css': `/* Aussehen des Spiels */
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { display: flex; flex-direction: column; background: #0b0d1f; color: #eef0ff; font-family: "Segoe UI", system-ui, sans-serif; touch-action: none; }
.hud { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; font-size: 18px; }
.hud b { color: #2fd3c2; }
canvas { flex: 1; width: 100%; min-height: 0; display: block; }
.hilfe { margin: 0; padding: 10px 16px; font-size: 13px; color: #9ea3c6; text-align: center; }
`,
    'spiel.js': `// Startspiel: Sammle die Sterne. Ein kleines Beispiel, das Worky mit dir zu deinem Spiel umbaut.
const canvas = document.querySelector('#spiel');
const ctx = canvas.getContext('2d');
const scoreText = document.querySelector('#score');

const SPEED = 260; // Pixel pro Sekunde
const player = { x: 0, y: 0, r: 18 };
const star = { x: 0, y: 0, r: 12 };
const keys = new Set();
let target = null; // Ziel beim Tippen am Handy
let score = 0;

function resize() {
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

function placeStar() {
  star.x = 30 + Math.random() * (canvas.clientWidth - 60);
  star.y = 30 + Math.random() * (canvas.clientHeight - 60);
}

addEventListener('resize', resize);
addEventListener('keydown', (event) => keys.add(event.key.toLowerCase()));
addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
canvas.addEventListener('pointerdown', (event) => { target = { x: event.offsetX, y: event.offsetY }; });
canvas.addEventListener('pointermove', (event) => { if (event.buttons) target = { x: event.offsetX, y: event.offsetY }; });

function update(dt) {
  let dx = (keys.has('arrowright') || keys.has('d')) - (keys.has('arrowleft') || keys.has('a'));
  let dy = (keys.has('arrowdown') || keys.has('s')) - (keys.has('arrowup') || keys.has('w'));
  if (dx || dy) target = null;
  if (target) {
    dx = target.x - player.x;
    dy = target.y - player.y;
    if (Math.hypot(dx, dy) < 4) target = null;
  }
  const length = Math.hypot(dx, dy);
  if (length) {
    player.x += (dx / length) * SPEED * dt;
    player.y += (dy / length) * SPEED * dt;
  }
  player.x = Math.max(player.r, Math.min(canvas.clientWidth - player.r, player.x));
  player.y = Math.max(player.r, Math.min(canvas.clientHeight - player.r, player.y));
  if (Math.hypot(player.x - star.x, player.y - star.y) < player.r + star.r) {
    score += 1;
    scoreText.textContent = score;
    placeStar();
  }
}

function draw(time) {
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  const pulse = 1 + Math.sin(time / 200) * 0.15;
  ctx.fillStyle = '#ffcf6b';
  ctx.beginPath();
  ctx.arc(star.x, star.y, star.r * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5b5fd6';
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2fd3c2';
  ctx.beginPath();
  ctx.arc(player.x - 6, player.y - 3, 3.5, 0, Math.PI * 2);
  ctx.arc(player.x + 6, player.y - 3, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

let last = performance.now();
function loop(time) {
  const dt = Math.min(0.05, (time - last) / 1000);
  last = time;
  update(dt);
  draw(time);
  requestAnimationFrame(loop);
}

resize();
player.x = canvas.clientWidth / 2;
player.y = canvas.clientHeight / 2;
placeStar();
requestAnimationFrame(loop);
`
  };
}

function gitignore(kind) {
  const lines = ['# Geheimnisse und lokale Dateien', '.env', '.env.local', 'node_modules/', '.DS_Store', 'Thumbs.db', '.obsidian/workspace*.json'];
  if (kind === 'roblox') lines.push('', '# Roblox und Rojo', 'rojo.exe', 'rojo', 'sourcemap.json', '*.rbxl.lock', '*.rbxlx.lock');
  if (kind === 'godot') lines.push('', '# Godot', '.godot/');
  if (kind === 'unity') lines.push('', '# Unity', '[Ll]ibrary/', '[Tt]emp/', '[Oo]bj/', '[Bb]uild/', '[Ll]ogs/', '[Uu]ser[Ss]ettings/');
  return lines.join('\n') + '\n';
}

function readme(name, kindLabel, description, kind) {
  const start = {
    roblox: 'In GitHub Desktop: Repository → Open in Command Prompt, dann `rojo serve` starten (oder in Workflow auf „Rojo“ klicken) und in Roblox Studio über das Rojo-Plugin verbinden.',
    web: 'In Workflow auf „Spiel ansehen“ klicken. Oder `index.html` doppelt anklicken.',
    godot: 'Ordner im Godot-Editor als Projekt importieren.',
    unity: 'Ordner im Unity Hub als Projekt hinzufügen.',
    andere: 'Frag Worky in Workflow, wie es losgeht.'
  }[kind];
  return `# ${name}\n\n${kindLabel}${description ? `: ${description}` : ''}\n\n## Loslegen\n\n${start}\n\nAngelegt mit Workflow. Die Notizen stehen in \`docs/\` (Obsidian-Tresor).\n`;
}

// Schreibt alle Vorlagen-Dateien in einen leeren, schon angelegten Ordner. Gibt die Liste der Dateien zurück.
export async function createProjectFiles({ folder, slug, name, kind, kindLabel, description }) {
  const files = {
    'CLAUDE.md': [...commonRules(name, kindLabel, description), ...(KIND_RULES[kind] || []), ...docsRules, ''].join('\n'),
    'README.md': readme(name, kindLabel, description, kind),
    '.gitignore': gitignore(kind),
    // Gleiche Zeilenenden für alle (Obsidian unter Windows schreibt sonst CRLF und blockiert Pulls)
    '.gitattributes': '* text=auto eol=lf\n*.bat text eol=crlf\n*.png binary\n*.jpg binary\n*.rbxl binary\n*.rbxm binary\n*.fbx binary\n',
    ...docsFiles(name, kindLabel, description),
    ...(kind === 'roblox' ? robloxFiles(slug) : {}),
    ...(kind === 'web' ? webFiles(name) : {}),
    ...(kind === 'godot' ? { 'scenes/.gitkeep': '', 'scripts/.gitkeep': '' } : {}),
    ...(kind === 'unity' ? { 'Assets/Scripts/.gitkeep': '' } : {})
  };
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(folder, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, { encoding: 'utf8', flag: 'wx' });
  }
  return Object.keys(files);
}
