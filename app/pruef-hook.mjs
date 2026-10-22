// Prüfen nach jeder Änderung (Claude-Code-Hook „PostToolUse“, Ausbau 2026-10-22).
// Claude Code ruft dieses Skript nach jedem Edit/Write auf und gibt die geänderte Datei als JSON auf stdin mit.
// Findet es einen Fehler, endet es mit Code 2: Dann sieht Worky die Meldung sofort und repariert die Datei,
// statt dass der Fehler erst beim Testen auffällt. Läuft schnell und ändert nichts.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const windows = process.platform === 'win32';

function readInput() {
  try { return JSON.parse(readFileSync(0, 'utf8')); } catch { return null; }
}

// Programm im Suchpfad oder in ~/.luau (dort liegen auf Timos PC luau-compile und selene)
function findTool(name) {
  const exe = windows ? `${name}.exe` : name;
  for (const folder of (process.env.PATH || process.env.Path || '').split(path.delimiter)) {
    if (folder && existsSync(path.join(folder, exe))) return path.join(folder, exe);
  }
  const local = path.join(homedir(), '.luau', exe);
  return existsSync(local) ? local : null;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 4_000_000 });
  return { code: result.status, out: `${result.stdout || ''}\n${result.stderr || ''}`.trim() };
}

function checkFile(file, cwd) {
  const extension = path.extname(file).toLowerCase();
  const name = path.relative(cwd, file).replace(/\\/g, '/') || file;
  const problems = [];
  if (['.js', '.mjs', '.cjs'].includes(extension)) {
    const result = run(process.execPath, ['--check', file], cwd);
    // Nur die aussagekräftigen Zeilen (Stelle, Code-Ausschnitt, Meldung), ohne Leerzeilen und Node-Aufrufkette
    if (result.code !== 0) problems.push(`Syntaxfehler in ${name}:\n${result.out.split('\n').filter((line) => line.trim() && !/^\s+at /.test(line)).slice(0, 6).join('\n')}`);
  } else if (extension === '.json') {
    try { JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch (error) { problems.push(`${name} ist kein gültiges JSON: ${error.message}`); }
  } else if (extension === '.luau' || extension === '.lua') {
    const compiler = findTool('luau-compile');
    if (compiler) {
      // Nur Syntax: Ausgabe (Bytecode) wegwerfen, Fehler stehen auf stderr
      const result = spawnSync(compiler, ['--binary', file], { cwd, encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 16_000_000 });
      if (result.status !== 0) problems.push(`Luau-Syntaxfehler in ${name}:\n${String(result.stderr || 'luau-compile meldet einen Fehler.').trim().split('\n').slice(0, 6).join('\n')}`);
    }
    // selene nur, wenn das Projekt es eingerichtet hat; nur echte Fehler, keine Hinweise
    const selene = findTool('selene');
    if (selene && !problems.length && existsSync(path.join(cwd, 'selene.toml'))) {
      const result = run(selene, ['--display-style', 'quiet', file], cwd);
      const errors = result.out.split('\n').filter((line) => /: error\[/.test(line)).slice(0, 8);
      if (errors.length) problems.push(`selene meldet Fehler in ${name}:\n${errors.join('\n')}`);
    }
  }
  return problems;
}

const input = readInput();
const file = input?.tool_input?.file_path;
const cwd = typeof input?.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
if (typeof file !== 'string' || !existsSync(file)) process.exit(0);
const problems = checkFile(path.resolve(cwd, file), cwd);
if (!problems.length) process.exit(0);
process.stderr.write(`Workflow-Prüfung nach deiner Änderung:\n${problems.join('\n\n')}\nBitte gleich beheben, bevor du weitermachst.\n`);
process.exit(2);
