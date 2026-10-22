// Material-Ordner (Ausbau 2026-10-22): Bilder, Modelle, Sounds und andere Dateien für ein Projekt an einem Ort,
// im Ordner material/ des Projekts (sortiert nach Art: bilder, modelle, sounds, texte, sonstiges). Workflow zeigt sie
// mit Vorschau, Timo kann Dateien hineinziehen und eine Beschreibung dazuschreiben (material/material.json).
// Worky bekommt die Liste mit und benutzt die Dateien, statt etwas zu erfinden. Gelöscht wird hier nichts.
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const FOLDER = 'material';
const NOTES_FILE = 'material.json';
const MAX_UPLOAD = 100 * 1024 * 1024; // GitHub nimmt keine Dateien über 100 MB
const MAX_FILES = 600;
const KINDS = {
  bilder: { label: 'Bild', ext: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tga', '.psd'] },
  modelle: { label: 'Modell', ext: ['.fbx', '.obj', '.glb', '.gltf', '.blend', '.stl', '.dae', '.rbxm', '.rbxmx', '.mtl'] },
  sounds: { label: 'Sound', ext: ['.mp3', '.ogg', '.wav', '.flac', '.m4a'] },
  texte: { label: 'Text', ext: ['.txt', '.md', '.json', '.csv'] },
  sonstiges: { label: 'Datei', ext: ['.zip', '.ttf', '.otf', '.woff2', '.pdf', '.svg', '.aseprite'] }
};
// Vorschau im Browser nur für Bilder und Sounds, die der Browser sicher anzeigt (kein SVG: das kann Skripte enthalten)
const PREVIEW_TYPES = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.gif', 'image/gif'], ['.bmp', 'image/bmp'],
  ['.mp3', 'audio/mpeg'], ['.ogg', 'audio/ogg'], ['.wav', 'audio/wav'], ['.m4a', 'audio/mp4'], ['.flac', 'audio/flac']
]);

const kindOf = (file) => {
  const extension = path.extname(file).toLowerCase();
  return Object.keys(KINDS).find((kind) => KINDS[kind].ext.includes(extension)) || null;
};

export function createMaterial() {
  const fail = (message, status = 400) => Object.assign(new Error(message), { status });
  const folderOf = (root) => path.join(root, FOLDER);

  async function readNotes(root) {
    try {
      const notes = JSON.parse(await readFile(path.join(folderOf(root), NOTES_FILE), 'utf8'));
      return notes && typeof notes === 'object' && !Array.isArray(notes) ? notes : {};
    } catch { return {}; }
  }

  // Relativer Pfad innerhalb von material/ (z. B. „bilder/logo.png“), ohne Tricks wie „..“ oder versteckte Ordner
  function safeRelative(root, value) {
    const relative = String(value || '').replace(/\\/g, '/').replace(/^material\//, '');
    const parts = relative.split('/');
    if (!relative || relative.length > 240 || parts.some((part) => !part || part === '..' || part.startsWith('.'))) throw fail('Ungültiger Dateiname.');
    const file = path.join(folderOf(root), ...parts);
    if (!file.startsWith(folderOf(root) + path.sep)) throw fail('Ungültiger Dateiname.');
    return { relative: parts.join('/'), file };
  }

  async function list(root) {
    const base = folderOf(root);
    if (!existsSync(base)) return { folder: base, exists: false, files: [], kinds: labels() };
    const notes = await readNotes(root);
    const files = [];
    async function walk(folder, depth) {
      let entries = [];
      try { entries = await readdir(folder, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (files.length >= MAX_FILES || entry.name.startsWith('.')) continue;
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) { if (depth < 3) await walk(full, depth + 1); continue; }
        if (!entry.isFile() || (folder === base && entry.name === NOTES_FILE)) continue;
        const relative = path.relative(base, full).split(path.sep).join('/');
        let info;
        try { info = await stat(full); } catch { continue; }
        const kind = kindOf(entry.name) || 'sonstiges';
        files.push({
          path: `${FOLDER}/${relative}`, name: entry.name, kind, label: KINDS[kind].label, size: info.size,
          changedAt: info.mtime.toISOString(), note: typeof notes[relative] === 'string' ? notes[relative] : '',
          preview: PREVIEW_TYPES.has(path.extname(entry.name).toLowerCase()) ? (PREVIEW_TYPES.get(path.extname(entry.name).toLowerCase()).startsWith('image') ? 'bild' : 'ton') : ''
        });
      }
    }
    await walk(base, 0);
    files.sort((a, b) => b.changedAt.localeCompare(a.changedAt));
    return { folder: base, exists: true, files, kinds: labels(), truncated: files.length >= MAX_FILES };
  }
  const labels = () => Object.fromEntries(Object.entries(KINDS).map(([kind, value]) => [kind, value.label]));

  // Datei speichern (Inhalt kommt als Strom direkt vom Browser). Ordner nach Art, gleicher Name bekommt „-2“ usw.
  async function save(root, rawName, request) {
    const cleaned = String(rawName || '').split(/[\\/]/).pop().normalize('NFC').replace(/[^\p{L}\p{N} ._()-]/gu, '_').replace(/\s+/g, ' ').trim().slice(0, 100);
    const kind = kindOf(cleaned);
    if (!cleaned || cleaned.startsWith('.') || !kind) {
      throw fail(`Diese Dateiart nimmt der Material-Ordner nicht. Erlaubt: ${Object.values(KINDS).flatMap((value) => value.ext).join(' ')}`);
    }
    const length = Number(request.headers['content-length'] || 0);
    if (length > MAX_UPLOAD) throw fail('Die Datei ist größer als 100 MB. So große Dateien nimmt GitHub nicht. Leg sie selbst in den Ordner (Knopf „Ordner öffnen“), wenn du sie nur auf deinem PC brauchst.', 413);
    const folder = path.join(folderOf(root), kind);
    await mkdir(folder, { recursive: true });
    const extension = path.extname(cleaned);
    const stem = cleaned.slice(0, cleaned.length - extension.length);
    let name = cleaned;
    for (let n = 2; existsSync(path.join(folder, name)); n += 1) name = `${stem}-${n}${extension}`;
    const target = path.join(folder, name);
    const temporary = `${target}.teil`;
    await new Promise((resolve, reject) => {
      let size = 0;
      const out = createWriteStream(temporary);
      const stop = (error) => { request.unpipe(out); out.destroy(); request.resume(); reject(error); };
      request.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_UPLOAD) stop(fail('Die Datei ist größer als 100 MB.', 413));
      });
      request.on('error', stop);
      out.on('error', stop);
      out.on('finish', resolve);
      request.pipe(out);
    }).catch(async (error) => { await rm(temporary, { force: true }); throw error; });
    await rename(temporary, target);
    return { path: `${FOLDER}/${kind}/${name}`, name, kind };
  }

  async function setNote(root, file, note) {
    const { relative, file: full } = safeRelative(root, file);
    if (!existsSync(full)) throw fail('Diese Datei gibt es nicht mehr.', 404);
    const notes = await readNotes(root);
    const text = String(note || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (text) notes[relative] = text; else delete notes[relative];
    await writeFile(path.join(folderOf(root), NOTES_FILE), JSON.stringify(notes, null, 2) + '\n', 'utf8');
    return { path: `${FOLDER}/${relative}`, note: text };
  }

  // Vorschau-Datei für die Seite (nur Bilder und Sounds)
  async function preview(root, file) {
    const { file: full } = safeRelative(root, file);
    const type = PREVIEW_TYPES.get(path.extname(full).toLowerCase());
    if (!type) throw fail('Für diese Dateiart gibt es keine Vorschau.', 404);
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) throw fail('Diese Datei gibt es nicht.', 404);
    return { type, body: await readFile(full) };
  }

  // Kurze Liste für Worky (Regeln im Gründlich-Modus und in der Nacht-Schicht)
  async function summary(root, max = 40) {
    const { files } = await list(root);
    if (!files.length) return '';
    const size = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
    const lines = files.slice(0, max).map((item) => `- ${item.path} (${item.label}, ${size(item.size)})${item.note ? `: ${item.note}` : ''}`);
    if (files.length > max) lines.push(`- … und ${files.length - max} weitere im Ordner material/`);
    return lines.join('\n');
  }

  return { list, save, setNote, preview, summary, folderOf };
}
