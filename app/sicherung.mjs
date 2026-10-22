// Sicherung mit einem Klick (Ausbau 2026-10-22): Projektliste, Gelerntes, Testkopie-Stand, gemerkte Sitzungen
// (alles in app/daten/ und app/.werkstatt-state.json) plus die Chats aus dem Browser in EINER Datei.
// Einspielen sichert vorher den aktuellen Stand, damit auch das Einspielen rückgängig gemacht werden kann.
// Automatisch: einmal am Tag beim Öffnen von Workflow (Ordner app/sicherungen/, die letzten 20 bleiben).
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const FORMAT = 'workflow-sicherung';
// Große oder wieder herunterladbare Ordner gehören nicht in die Sicherung
const SKIP_DIRS = new Set(['werkzeuge', 'roblox-doku', 'vorlagen']);
const MAX_FILE = 5 * 1024 * 1024;
const MAX_TOTAL = 40 * 1024 * 1024;
const MAX_BROWSER = 30 * 1024 * 1024;
const KEEP = 20;

export function createBackups({ dataDir, appDir }) {
  const folder = path.join(appDir, 'sicherungen');
  const stateFile = path.join(appDir, '.werkstatt-state.json');
  const fail = (message, status = 400) => Object.assign(new Error(message), { status });
  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  async function collect() {
    const files = [];
    let total = 0;
    const walk = async (dir, prefix) => {
      let entries = [];
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (!(prefix === '' && SKIP_DIRS.has(entry.name))) await walk(full, relative); continue; }
        if (!entry.isFile()) continue;
        const size = statSync(full).size;
        if (size > MAX_FILE || total + size > MAX_TOTAL) continue;
        const buffer = await readFile(full);
        const binary = buffer.includes(0);
        files.push({ path: relative, encoding: binary ? 'base64' : 'utf8', data: buffer.toString(binary ? 'base64' : 'utf8') });
        total += size;
      }
    };
    await walk(dataDir, '');
    let state = null;
    try { state = await readFile(stateFile, 'utf8'); } catch { /* noch kein Zustand */ }
    return { files, state };
  }

  function cleanBrowser(browser) {
    const result = {};
    let size = 0;
    if (!browser || typeof browser !== 'object') return result;
    for (const [key, value] of Object.entries(browser)) {
      if (typeof key !== 'string' || typeof value !== 'string' || key.length > 200) continue;
      size += key.length + value.length;
      if (size > MAX_BROWSER) break;
      result[key] = value;
    }
    return result;
  }

  async function create(browser, reason = 'hand') {
    const { files, state } = await collect();
    const backup = { format: FORMAT, version: 1, createdAt: new Date().toISOString(), reason, files, state, browser: cleanBrowser(browser) };
    mkdirSync(folder, { recursive: true });
    const name = `${stamp()}-${reason}.json`;
    await writeFile(path.join(folder, name), JSON.stringify(backup), 'utf8');
    await prune();
    return { backup, name };
  }

  async function prune() {
    const names = list().map((item) => item.name);
    for (const name of names.slice(KEEP)) await rm(path.join(folder, name), { force: true }).catch(() => {});
  }

  function list() {
    let names = [];
    try { names = readdirSync(folder).filter((name) => /^[\dT-]+-[a-z-]+\.json$/.test(name)); } catch { return []; }
    return names.sort().reverse().map((name) => {
      let size = 0;
      try { size = statSync(path.join(folder, name)).size; } catch { /* weg */ }
      return { name, size, reason: name.replace(/^[\dT-]+-|\.json$/g, ''), createdAt: name.slice(0, 19) };
    });
  }

  // Automatische Sicherung: höchstens eine pro Tag (Zeitstempel im Namen ist UTC)
  const autoDue = () => !list().some((item) => item.reason === 'auto' && item.createdAt.slice(0, 10) === stamp().slice(0, 10));

  async function read(name) {
    if (!/^[\dT-]+-[a-z-]+\.json$/.test(String(name))) throw fail('Diese Sicherung gibt es nicht.', 404);
    try { return JSON.parse(await readFile(path.join(folder, name), 'utf8')); } catch { throw fail('Diese Sicherung lässt sich nicht lesen.', 404); }
  }

  const safeRelative = (value) => {
    const relative = String(value || '').replace(/\\/g, '/');
    if (!relative || relative.startsWith('/') || /^[a-z]:/i.test(relative) || relative.split('/').some((part) => !part || part === '..' || part === '.')) return null;
    if (SKIP_DIRS.has(relative.split('/')[0])) return null;
    return relative;
  };

  // Einspielen: erst den jetzigen Stand sichern, dann die Dateien zurückschreiben. Dateien, die es in der
  // Sicherung nicht gibt, bleiben liegen (nichts wird gelöscht).
  async function restore(backup, currentBrowser) {
    if (!backup || backup.format !== FORMAT || !Array.isArray(backup.files)) throw fail('Das ist keine Workflow-Sicherung.');
    const safety = await create(currentBrowser, 'vor-einspielen');
    let written = 0;
    for (const file of backup.files) {
      const relative = safeRelative(file?.path);
      if (!relative || typeof file.data !== 'string') continue;
      const target = path.join(dataDir, ...relative.split('/'));
      if (!target.startsWith(dataDir + path.sep)) continue;
      mkdirSync(path.dirname(target), { recursive: true });
      await writeFile(target, file.encoding === 'base64' ? Buffer.from(file.data, 'base64') : file.data, file.encoding === 'base64' ? undefined : 'utf8');
      written += 1;
    }
    if (typeof backup.state === 'string') {
      try { JSON.parse(backup.state); await writeFile(stateFile, backup.state, 'utf8'); } catch { /* kaputter Zustand: alten behalten */ }
    }
    return { written, browser: cleanBrowser(backup.browser), safety: safety.name, createdAt: String(backup.createdAt || '') };
  }

  return { create, list, read, restore, autoDue, folder, exists: () => existsSync(folder) };
}
