// Werkzeuge für Worky (Ausbau 2026-10-22): Roblox-Doku zum Nachschlagen, Lune für Rechen-Tests ohne Studio,
// Selbsttest für Browser-Spiele (Edge ohne Fenster) und Godot ohne Fenster.
// Heruntergeladen wird nur nach Timos Klick auf der Werkzeuge-Seite, alles landet in app/daten/ (nicht im Repo).
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

const DOCS_REPO = 'https://github.com/Roblox/creator-docs';
// Nur Texte und die API-Referenz, keine Bilder (das ganze Repo ist riesig)
const DOCS_PATTERNS = ['/content/en-us/**/*.md', '/content/en-us/reference/engine/**/*.yaml'];
const LUNE_RELEASE_API = 'https://api.github.com/repos/lune-org/lune/releases/latest';
const LUNE_RELEASES_PAGE = 'https://github.com/lune-org/lune/releases';
const MAX_TESTS = 40;
const MAX_TOOL_OUTPUT = 200_000;

export function createTools({ dataDir, gitCommand }) {
  const binDir = path.join(dataDir, 'werkzeuge');
  const docsDir = path.join(dataDir, 'roblox-doku');
  const configFile = path.join(dataDir, 'werkzeuge.json');
  const windows = process.platform === 'win32';
  let busy = '';

  function loadConfig() {
    try { return JSON.parse(readFileSync(configFile, 'utf8')) || {}; } catch { return {}; }
  }
  function saveConfig(config) {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8');
  }
  const fail = (message, status = 409) => Object.assign(new Error(message), { status });

  // Programm starten und Ausgabe sammeln (nie mit Shell, Argumente einzeln)
  function run(command, args, { cwd, timeoutMs = 60_000, env } = {}) {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let child;
      try { child = spawn(command, args, { cwd, env: env || process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (error) { return resolve({ code: -1, stdout: '', stderr: error.message, timedOut }); }
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { if (stdout.length < MAX_TOOL_OUTPUT) stdout += chunk; });
      child.stderr.on('data', (chunk) => { if (stderr.length < MAX_TOOL_OUTPUT) stderr += chunk; });
      child.once('error', (error) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: stderr + error.message, timedOut, missing: error.code === 'ENOENT' }); });
      child.once('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    });
  }

  // Nur einer dieser Abläufe gleichzeitig (Download, Installation)
  async function exclusive(name, work) {
    if (busy) throw fail(`Gerade läuft schon: ${busy}. Kurz warten.`);
    busy = name;
    try { return await work(); } finally { busy = ''; }
  }

  // Für Claude-Läufe: Workflows Werkzeug-Ordner (Lune) vorne in den Suchpfad. Unter Windows heißt die Variable „Path“.
  function pathEnv(base = process.env) {
    const env = { ...base };
    const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') || 'PATH';
    env[key] = binDir + path.delimiter + (env[key] || '');
    return env;
  }

  // ---------- Roblox-Doku (offiziell, github.com/Roblox/creator-docs, Texte CC BY 4.0, Code-Beispiele MIT) ----------
  const docsContent = () => path.join(docsDir, 'content', 'en-us');
  const docsReady = () => existsSync(path.join(docsContent(), 'reference', 'engine'));

  async function docsStatus() {
    if (!docsReady()) return { installed: false };
    const log = await run(gitCommand, ['log', '-1', '--format=%cI'], { cwd: docsDir, timeoutMs: 10_000 });
    return { installed: true, folder: docsContent(), updatedAt: log.code === 0 ? log.stdout.trim() : null };
  }

  function docsDownload() {
    return exclusive('Roblox-Doku holen', async () => {
      // Bilder der Doku liegen in Git LFS: nie mitladen
      const env = { ...process.env, GIT_LFS_SKIP_SMUDGE: '1', GIT_TERMINAL_PROMPT: '0' };
      const step = async (args, cwd, timeoutMs = 10 * 60_000) => {
        const result = await run(gitCommand, args, { cwd, env, timeoutMs });
        if (result.code !== 0) throw fail(`Git: ${(result.stderr || result.stdout).trim().split(/\r?\n/).slice(-2).join(' ').slice(0, 300) || 'unbekannter Fehler'}`, 502);
        return result;
      };
      if (existsSync(path.join(docsDir, '.git'))) {
        await step(['pull', '--ff-only', '--depth', '1'], docsDir);
      } else {
        await rm(docsDir, { recursive: true, force: true });
        mkdirSync(dataDir, { recursive: true });
        await step(['clone', '--depth', '1', '--filter=blob:none', '--no-checkout', DOCS_REPO, docsDir], dataDir);
        await step(['sparse-checkout', 'set', '--no-cone', ...DOCS_PATTERNS], docsDir);
        await step(['checkout', 'main'], docsDir);
      }
      if (!docsReady()) throw fail('Die Doku ist angekommen, aber die API-Referenz fehlt. Bitte nochmal versuchen.', 502);
      return docsStatus();
    });
  }

  // ---------- Lune (github.com/lune-org/lune): Luau-Skripte ohne Roblox Studio ausführen ----------
  const luneFile = () => path.join(binDir, windows ? 'lune.exe' : 'lune');

  async function luneStatus() {
    if (!existsSync(luneFile())) return { installed: false };
    const version = await run(luneFile(), ['--version'], { timeoutMs: 10_000 });
    return { installed: true, version: version.stdout.trim().slice(0, 60) || 'unbekannt' };
  }

  function luneInstall() {
    return exclusive('Lune installieren', async () => {
      const platform = windows ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
      const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
      const releaseResponse = await fetch(LUNE_RELEASE_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Workflow' }, signal: AbortSignal.timeout(20_000) });
      if (!releaseResponse.ok) throw fail(`GitHub antwortet mit ${releaseResponse.status}. Später nochmal versuchen oder Lune von ${LUNE_RELEASES_PAGE} selbst holen.`, 502);
      const release = await releaseResponse.json();
      const asset = (release.assets || []).find((item) => new RegExp(`-${platform}-${arch}\\.zip$`).test(String(item.name)));
      if (!asset || !/^https:\/\/github\.com\//.test(String(asset.browser_download_url))) throw fail(`Keine passende Lune-Datei für ${platform}-${arch} gefunden. Schau auf ${LUNE_RELEASES_PAGE}.`, 502);
      const download = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Workflow' }, signal: AbortSignal.timeout(5 * 60_000) });
      if (!download.ok) throw fail(`Download ging nicht (${download.status}).`, 502);
      const work = await mkdtemp(path.join(tmpdir(), 'workflow-lune-'));
      try {
        const zip = path.join(work, 'lune.zip');
        await writeFile(zip, Buffer.from(await download.arrayBuffer()));
        // Windows 10/11 bringt tar.exe mit, das auch Zip auspackt; sonst PowerShell bzw. unzip
        let unpacked = windows
          ? await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', work])
          : await run('unzip', ['-o', zip, '-d', work]);
        if (unpacked.code !== 0 && windows) {
          unpacked = await run('powershell.exe', ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force', zip, work]);
        }
        if (unpacked.code !== 0) throw fail(`Auspacken ging nicht: ${unpacked.stderr.slice(0, 200)}`, 502);
        const name = windows ? 'lune.exe' : 'lune';
        const found = findFile(work, name, 3);
        if (!found) throw fail('In der Lune-Datei war kein Programm drin.', 502);
        mkdirSync(binDir, { recursive: true });
        await writeFile(luneFile(), await readFile(found), { mode: 0o755 });
      } finally {
        await rm(work, { recursive: true, force: true }).catch(() => {});
      }
      return { ...(await luneStatus()), release: String(release.tag_name || '') };
    });
  }

  function findFile(folder, name, depth) {
    let entries = [];
    try { entries = readdirSync(folder, { withFileTypes: true }); } catch { return null; }
    for (const entry of entries) if (entry.isFile() && entry.name === name) return path.join(folder, entry.name);
    if (depth <= 0) return null;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const found = findFile(path.join(folder, entry.name), name, depth - 1);
      if (found) return found;
    }
    return null;
  }

  // Tests: jede .luau-Datei in tests/ des Projekts (auch Unterordner) mit „lune run“. Exit 0 = bestanden.
  function testFiles(root) {
    const files = [];
    const walk = (folder, depth) => {
      let entries = [];
      try { entries = readdirSync(folder, { withFileTypes: true }); } catch { return; }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (files.length >= MAX_TESTS) return;
        const full = path.join(folder, entry.name);
        if (entry.isDirectory() && depth < 3 && !entry.name.startsWith('.')) walk(full, depth + 1);
        else if (entry.isFile() && entry.name.endsWith('.luau')) files.push(path.relative(root, full).replace(/\\/g, '/'));
      }
    };
    walk(path.join(root, 'tests'), 0);
    return files;
  }

  async function luneTests(root) {
    if (!existsSync(luneFile())) throw fail('Lune ist noch nicht installiert. Auf der Werkzeuge-Seite „Lune holen“ klicken.');
    const files = testFiles(root);
    if (!files.length) return { files: 0, passed: 0, results: [], hint: 'Im Projekt gibt es noch keine Tests (Ordner tests/ mit .luau-Dateien). Sag Worky: „Schreib Rechen-Tests mit Lune für …“.' };
    const results = [];
    for (const file of files) {
      const result = await run(luneFile(), ['run', file], { cwd: root, timeoutMs: 60_000 });
      const output = `${result.stdout}\n${result.stderr}`.trim();
      results.push({ file, ok: result.code === 0 && !result.timedOut, output: (result.timedOut ? 'Zeitgrenze (60 s) erreicht.\n' : '') + output.slice(-1500) });
    }
    return { files: files.length, passed: results.filter((item) => item.ok).length, results };
  }

  // ---------- Browser-Spiel ohne Fenster testen (Edge, sonst Chrome) ----------
  function browserCandidates() {
    const list = [];
    if (windows) {
      for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean)) {
        list.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
        list.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      }
    } else {
      list.push('/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    }
    return list;
  }
  const findBrowser = () => process.env.WORKFLOW_BROWSER || browserCandidates().find((file) => existsSync(file)) || null;
  const browserName = (file) => /edge/i.test(file) ? 'Edge' : /chrom/i.test(file) ? 'Chrome' : path.basename(file);

  // Lädt die Seite, wartet ein paar Sekunden Spielzeit, macht ein Bildschirmfoto und sammelt die Konsole
  async function browserTest(url, { width = 1280, height = 720, seconds = 5 } = {}) {
    const browser = findBrowser();
    if (!browser) throw fail('Weder Edge noch Chrome gefunden. Ohne Browser geht der Selbsttest nicht.');
    const profile = await mkdtemp(path.join(tmpdir(), 'workflow-spieltest-'));
    const shot = path.join(profile, 'bild.png');
    try {
      const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
        `--user-data-dir=${profile}`, `--window-size=${width},${height}`, '--hide-scrollbars', `--virtual-time-budget=${Math.round(seconds * 1000)}`,
        `--screenshot=${shot}`, '--enable-logging=stderr', '--v=0', url];
      if (!windows && process.getuid?.() === 0) args.unshift('--no-sandbox');
      const result = await run(browser, args, { timeoutMs: 60_000 });
      const consoleLines = [];
      for (const line of result.stderr.split(/\r?\n/)) {
        const match = /:CONSOLE[:(](\d+)\)?\] "(.*)", source: (.*?) \((\d+)\)\s*$/.exec(line);
        if (!match) continue;
        const source = match[3].replace(/^https?:\/\/[^/]+/, '');
        consoleLines.push({ text: match[2].slice(0, 400), source: `${source}:${match[4]}`, error: /^Uncaught|Error\b|Fehler|failed/i.test(match[2]) });
        if (consoleLines.length >= 40) break;
      }
      let image = null;
      try { image = (await readFile(shot)).toString('base64'); } catch { /* kein Bild */ }
      if (!image) throw fail(`Der Browser hat kein Bild geliefert${result.timedOut ? ' (Zeitgrenze erreicht)' : ''}. ${result.stderr.split(/\r?\n/).filter(Boolean).slice(-2).join(' ').slice(0, 200)}`, 502);
      const errors = consoleLines.filter((line) => line.error).length;
      // Ein fast einfarbiges Bild ist als PNG winzig: Hinweis, dass die Seite leer sein könnte
      const bytes = Buffer.byteLength(image, 'base64');
      return { browser: browserName(browser), url, image, console: consoleLines, errors, maybeEmpty: bytes < 4000 };
    } finally {
      await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }).catch(() => {});
    }
  }

  // ---------- Godot ohne Fenster ----------
  function godotCandidates() {
    const roots = windows
      ? [process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'), path.join(homedir(), 'Downloads'), path.join(homedir(), 'Desktop'), path.join(homedir(), 'Documents'), path.join(homedir(), 'scoop', 'apps')]
      : ['/usr/bin', '/usr/local/bin', path.join(homedir(), 'Downloads'), '/Applications'];
    const found = [];
    const look = (folder, depth) => {
      let entries = [];
      try { entries = readdirSync(folder, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(folder, entry.name);
        if (entry.isFile() && /^godot.*(\.exe)?$/i.test(entry.name) && (!windows || entry.name.toLowerCase().endsWith('.exe'))) found.push(full);
        else if (entry.isDirectory() && depth > 0 && /godot|scoop|apps/i.test(entry.name)) look(full, depth - 1);
      }
    };
    for (const root of roots.filter(Boolean)) look(root, 2);
    // Die _console-Variante gibt die Ausgabe zuverlässig weiter
    return found.sort((a, b) => Number(/_console/i.test(b)) - Number(/_console/i.test(a)) || statSafe(b) - statSafe(a));
  }
  const statSafe = (file) => { try { return statSync(file).mtimeMs; } catch { return 0; } };

  function godotFile() {
    const saved = loadConfig().godot;
    if (saved && existsSync(saved)) return saved;
    return godotCandidates()[0] || null;
  }

  async function godotStatus() {
    const file = godotFile();
    if (!file) return { installed: false };
    const version = await run(file, ['--version', '--headless'], { timeoutMs: 15_000 });
    return { installed: true, file, version: version.stdout.trim().split(/\r?\n/).pop()?.slice(0, 80) || 'unbekannt' };
  }

  function setGodot(value) {
    const raw = String(value || '').trim().replace(/^"|"$/g, '');
    if (!raw) { const config = loadConfig(); delete config.godot; saveConfig(config); return godotStatus(); }
    if (!path.isAbsolute(raw) || !existsSync(raw) || !statSync(raw).isFile() || !/godot/i.test(path.basename(raw))) throw fail('Bitte den vollen Pfad zur Godot-Datei angeben (z. B. …\\Godot_v4.3-stable_win64_console.exe).', 400);
    saveConfig({ ...loadConfig(), godot: path.resolve(raw) });
    return godotStatus();
  }

  // Startet das Projekt ohne Fenster für ein paar Sekunden und sammelt Fehler (Skriptfehler, fehlende Dateien)
  async function godotTest(root, frames = 300) {
    const file = godotFile();
    if (!file) throw fail('Godot nicht gefunden. Auf der Werkzeuge-Seite den Pfad zur Godot-Datei eintragen.');
    if (!existsSync(path.join(root, 'project.godot'))) throw fail('Im Projekt fehlt project.godot. Erst im Godot-Editor ein Projekt in diesem Ordner anlegen (oder Worky bitten).');
    // Erst importieren (neue Bilder, Szenen), dann laufen lassen
    await run(file, ['--headless', '--path', root, '--import'], { cwd: root, timeoutMs: 120_000 });
    const result = await run(file, ['--headless', '--path', root, '--quit-after', String(Math.min(Math.max(Number(frames) || 300, 30), 3000))], { cwd: root, timeoutMs: 120_000 });
    const lines = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
    const errors = lines.filter((line) => /\b(SCRIPT ERROR|ERROR|Parse Error|Failed|Invalid)\b/.test(line)).slice(0, 40);
    return { file: path.basename(file), exitCode: result.code, timedOut: result.timedOut, errors, output: lines.slice(-60).join('\n') };
  }

  async function overview() {
    return { busy, docs: await docsStatus(), lune: await luneStatus(), godot: await godotStatus(), browser: findBrowser() ? browserName(findBrowser()) : null };
  }

  return {
    run, pathEnv, overview, docsStatus, docsDownload, docsReady, docsFolder: docsContent,
    luneStatus, luneInstall, luneTests, luneReady: () => existsSync(luneFile()),
    browserTest, findBrowser, godotStatus, setGodot, godotTest, godotReady: () => Boolean(godotFile())
  };
}
