// Eigene Vorlagen (Ausbau 2026-10-22): Ein fertiges Projekt wird zur Vorlage für das nächste Spiel.
// Kopiert werden die Dateien, die Git im Projekt verwaltet (also ohne git-ignorierte Sachen wie .env.local), ohne
// Chatverlauf und ohne das Gedächtnis des alten Projekts. Gespeichert in app/daten/vorlagen/<name>/ (nur dieser PC).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { copyFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SKIP = [
  /^docs\/Werkstatt-Chatverlauf\//, /^docs\/(Werkstatt-Claude-Gedaechtnis|Workflow-Gedaechtnis)\.md$/,
  /(^|\/)\.env/, /^\.mcp\.json$/, /(^|\/)node_modules\//, /^\.git\//, /^rojo\.exe$/i, /^entwuerfe\//
];
const MAX_FILES = 5000;
const MAX_FILE = 20 * 1024 * 1024;
const MAX_TOTAL = 300 * 1024 * 1024;

export function createOwnTemplates({ dataDir, gitCommand, slug }) {
  const folder = path.join(dataDir, 'vorlagen');
  const fail = (message, status = 400) => Object.assign(new Error(message), { status });

  function gitFiles(root) {
    return new Promise((resolve) => {
      let out = '';
      let child;
      try { child = spawn(gitCommand, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return resolve(null); }
      const timer = setTimeout(() => child.kill(), 30_000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.once('error', () => { clearTimeout(timer); resolve(null); });
      child.once('close', (code) => { clearTimeout(timer); resolve(code === 0 ? out.split('\0').filter(Boolean) : null); });
    });
  }

  // Ohne Git: selbst durchgehen (versteckte Ordner wie .git auslassen, .claude aber mitnehmen)
  function walkFiles(root) {
    const files = [];
    const walk = (dir, prefix) => {
      let entries = [];
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (files.length >= MAX_FILES) return;
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) { if (entry.name !== '.git' && entry.name !== 'node_modules') walk(path.join(dir, entry.name), relative); }
        else if (entry.isFile()) files.push(relative);
      }
    };
    walk(root, '');
    return files;
  }

  function readMeta(id) {
    try { return JSON.parse(readFileSync(path.join(folder, id, 'vorlage.json'), 'utf8')); } catch { return null; }
  }

  function list() {
    let ids = [];
    try { ids = readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name); } catch { return []; }
    return ids.map(readMeta).filter((meta) => meta && meta.id && meta.name).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async function save(project, kindLabel, name) {
    const title = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 60) || `${project.name} (Vorlage)`;
    if (!existsSync(project.root)) throw fail('Der Projektordner ist nicht mehr da.', 409);
    const id = slug(title, new Set(list().map((meta) => meta.id)));
    const target = path.join(folder, id);
    const files = ((await gitFiles(project.root)) || walkFiles(project.root))
      .map((file) => file.replace(/\\/g, '/'))
      .filter((file) => !SKIP.some((pattern) => pattern.test(file)) && !file.split('/').includes('..'));
    if (!files.length) throw fail('Im Projekt gibt es keine Dateien zum Mitnehmen.', 409);
    let copied = 0;
    let bytes = 0;
    try {
      for (const file of files.slice(0, MAX_FILES)) {
        const source = path.join(project.root, ...file.split('/'));
        let info;
        try { info = statSync(source); } catch { continue; }
        if (!info.isFile() || info.size > MAX_FILE) continue;
        if (bytes + info.size > MAX_TOTAL) throw fail('Das Projekt ist zu groß für eine Vorlage (über 300 MB).', 413);
        const destination = path.join(target, 'dateien', ...file.split('/'));
        mkdirSync(path.dirname(destination), { recursive: true });
        await copyFile(source, destination);
        copied += 1;
        bytes += info.size;
      }
      const meta = { id, name: title, kind: project.kind, kindLabel, description: project.description || '', fromProject: project.name, files: copied, bytes, createdAt: new Date().toISOString() };
      await writeFile(path.join(target, 'vorlage.json'), JSON.stringify(meta, null, 2), 'utf8');
      return meta;
    } catch (error) {
      await rm(target, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async function remove(id) {
    if (!/^[a-z0-9-]{1,48}$/.test(String(id)) || !readMeta(id)) throw fail('Diese Vorlage gibt es nicht.', 404);
    await rm(path.join(folder, id), { recursive: true, force: true });
    return list();
  }

  // Neues Projekt aus eigener Vorlage: alle Dateien in den (leeren) neuen Ordner kopieren
  async function copyInto(id, destination, newName) {
    const meta = /^[a-z0-9-]{1,48}$/.test(String(id)) ? readMeta(id) : null;
    if (!meta) throw fail('Diese Vorlage gibt es nicht mehr.', 404);
    const source = path.join(folder, id, 'dateien');
    let count = 0;
    const walk = async (dir, prefix) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const from = path.join(dir, entry.name);
        const to = path.join(destination, prefix, entry.name);
        if (entry.isDirectory()) { mkdirSync(to, { recursive: true }); await walk(from, path.join(prefix, entry.name)); }
        else if (entry.isFile()) { await copyFile(from, to); count += 1; }
      }
    };
    await walk(source, '');
    // Worky soll wissen, woher das Projekt kommt (Namen und Werte gehören noch zum alten Spiel)
    const rules = path.join(destination, 'CLAUDE.md');
    const note = `\n\n> Angelegt mit Workflow am ${new Date().toISOString().slice(0, 10)} als „${newName}“ aus der eigenen Vorlage „${meta.name}“ (vom Projekt „${meta.fromProject}“). Namen, Texte und Spielwerte gehören teils noch zum alten Spiel: beim ersten Auftrag mit Timo klären, was bleibt.\n`;
    try { await writeFile(rules, readFileSync(rules, 'utf8').replace(/\s*$/, '') + note, 'utf8'); } catch { await writeFile(rules, `# Projektnotizen für Claude (${newName})${note}`, 'utf8'); }
    return { meta, files: count };
  }

  return { list, save, remove, copyInto };
}
