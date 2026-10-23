// Werkbänke (Ausbau 2026-10-23): Bis zu drei Worky-Aufträge laufen gleichzeitig, ohne sich in die Quere zu kommen.
// Jede Werkbank ist eine eigene Kopie des Projekts neben Timos Ordner (git worktree „<projekt>-werkbank-<name>“) mit
// eigenem Chat. Timos Projektordner bleibt unberührt. „Fertig“ committet, lädt den Zweig claude/werkbank-<name> hoch
// und legt einen Pull Request an; testen und mergen macht Timo wie gewohnt.
// Die Kopie arbeitet ohne lokalen Zweig (losgelöster Stand) und lädt per HEAD:refs/heads/<zweig> hoch. So kann Timo
// den Zweig in GitHub Desktop auschecken, obwohl die Werkbank noch offen ist (Git erlaubt einen Zweig nur einmal).
// Roblox Studio und Blender gibt es auf Werkbänken nicht: Studio zeigt immer Timos Projektordner (Rojo), nicht die
// Kopie. Getestet wird mit den Prüf-Skripten und Lune; in Studio testet Timo den Pull Request.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const MAX_BENCHES = 3; // je Projekt
const RUN_TIMEOUT_MS = 90 * 60_000;
const KEEP_MESSAGES = 40;
const MAX_LIVE_TEXT = 12_000;
const MAX_GIT_OUTPUT = 200_000;

// SPERRE-ANFANG (Worky darf diesen Abschnitt in der Testkopie nicht ändern, siehe testkopie.mjs)
// Ohne Rückfrage erlaubt. Alles andere (andere Befehle) fragt Timo über eine Freigabe-Karte „Werkbank …“.
const BENCH_ALLOWED_TOOLS = [
  'Read', 'Glob', 'Grep', 'Edit', 'Write', 'Agent', 'Task', 'Skill', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'WebSearch',
  'Bash(sh tools/check_all.sh)', 'Bash(sh tools/check_modules.sh)', 'Bash(sh tools/codepruefung.sh:*)', 'Bash(sh tools/codepruefung.sh)',
  'Bash(sh tools/preview/machine.sh:*)', 'Bash(sh tools/preview/cave.sh:*)', 'Bash(sh tools/balance/tabelle.sh:*)', 'Bash(sh tools/balance/simulation.sh:*)',
  'Bash(lune run:*)', 'Bash(node --check:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)'
];
// Commit, Push und Zweige macht Workflow selbst („Fertig“), nie Worky
const BENCH_DENIED_TOOLS = [
  'Read(**/.env.local)', 'Edit(**/.env.local)', 'Write(**/.env.local)', 'Read(**/.env)', 'Edit(**/.env)', 'Write(**/.env)',
  'Bash(git commit:*)', 'Bash(git push:*)', 'Bash(git merge:*)', 'Bash(git reset:*)', 'Bash(git rebase:*)', 'Bash(git checkout:*)',
  'Bash(git switch:*)', 'Bash(git branch:*)', 'Bash(git worktree:*)', 'Bash(git stash:*)', 'Bash(git clean:*)', 'Bash(gh:*)',
  'PowerShell', 'NotebookEdit',
  'ScheduleWakeup', 'Workflow', 'CronCreate', 'CronDelete', 'RemoteTrigger', 'Monitor', 'PushNotification',
  'EnterWorktree', 'ExitWorktree', 'SendMessage', 'ListAgents', 'ReportFindings', 'TaskStop'
];
// SPERRE-ENDE

export function createWorkbenches({ dataDir, gitCommand, ghCommand, runClaude, projects, hookSettings, mcpConfig, approvalTool, context, docsFolder }) {
  const stateFile = path.join(dataDir, 'werkbaenke.json');
  const disabled = process.env.WORKFLOW_TESTKOPIE === '1';
  const running = new Map(); // Werkbank-ID → { abort, live: { text, tool } }

  function load() {
    try {
      const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
      const benches = Array.isArray(saved.benches) ? saved.benches : [];
      // Workflow wurde mitten in einem Auftrag beendet: Werkbank wieder freigeben
      for (const bench of benches) {
        if (bench.status === 'arbeitet') Object.assign(bench, { status: 'bereit', message: 'Workflow wurde beendet, während Worky hier gearbeitet hat. Was schon geändert war, liegt in der Werkbank. Schreib „mach weiter“.' });
        if (bench.status === 'laedt') Object.assign(bench, { status: 'bereit' });
      }
      return { benches };
    } catch {
      return { benches: [] };
    }
  }
  let state = load();
  function save() {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
  }
  const fail = (message, status = 409) => Object.assign(new Error(message), { status });
  const find = (id) => {
    const bench = state.benches.find((item) => item.id === id);
    if (!bench) throw fail('Diese Werkbank gibt es nicht mehr.', 404);
    return bench;
  };

  function run(command, args, cwd, timeoutMs = 60_000) {
    return new Promise((resolve) => {
      let output = '';
      let child;
      try { child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }); } catch (error) { return resolve({ ok: false, output: error.message }); }
      const timer = setTimeout(() => child.kill(), timeoutMs);
      const add = (chunk) => { if (output.length < MAX_GIT_OUTPUT) output += chunk; };
      child.stdout.on('data', add);
      child.stderr.on('data', add);
      child.once('error', (error) => { clearTimeout(timer); resolve({ ok: false, output: error.message, missing: error.code === 'ENOENT' }); });
      child.once('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, output: output.trimEnd() }); });
    });
  }
  const git = (cwd, args, timeoutMs) => run(gitCommand, args, cwd, timeoutMs);

  // ---------- Anzeige ----------
  function publicBench(bench) {
    const live = running.get(bench.id)?.live;
    return {
      id: bench.id, name: bench.name, project: bench.project, projectName: bench.projectName, folder: bench.folder, branch: bench.branch,
      status: bench.status, message: bench.message || '', prUrl: bench.prUrl || '', createdAt: bench.createdAt, pushedAt: bench.pushedAt || '',
      messages: bench.messages.slice(-KEEP_MESSAGES), live: live ? { text: live.text.slice(-MAX_LIVE_TEXT), tool: live.tool } : null
    };
  }
  function overview(projectId) {
    const benches = state.benches.filter((bench) => !projectId || bench.project === projectId);
    return { available: !disabled, max: MAX_BENCHES, busy: running.size, benches: benches.map(publicBench) };
  }

  // ---------- Anlegen ----------
  const slugOf = (name) => name.toLocaleLowerCase('de').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'werkbank';

  async function create(project, rawName) {
    if (disabled) throw fail('Die Testkopie hat keine Werkbänke.');
    const name = String(rawName || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    if (!name) throw fail('Gib der Werkbank einen kurzen Namen, z. B. „Höhle“ oder „HUD“.', 400);
    if (state.benches.filter((bench) => bench.project === project.id).length >= MAX_BENCHES) {
      throw fail(`Höchstens ${MAX_BENCHES} Werkbänke pro Projekt. Räum erst eine fertige weg.`);
    }
    const root = path.resolve(project.root);
    if (!existsSync(path.join(root, '.git'))) throw fail('Der Projektordner ist kein Git-Ordner. Werkbänke brauchen Git (für die eigene Kopie und den Zweig).');
    // Vom neuesten Stand auf GitHub aus arbeiten, ohne Internet vom lokalen main
    const fetched = await git(root, ['fetch', 'origin', 'main'], 90_000);
    let base = '';
    for (const candidate of [fetched.ok ? 'origin/main' : '', 'main', 'master', 'HEAD'].filter(Boolean)) {
      if ((await git(root, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`])).ok) { base = candidate; break; }
    }
    if (!base) throw fail('Im Projekt gibt es noch keinen Commit, von dem die Werkbank ausgehen kann.');
    // Freien Ordner- und Zweignamen suchen (auch auf GitHub darf der Zweig noch nicht existieren)
    const slug = slugOf(name);
    const remote = fetched.ok ? await git(root, ['ls-remote', '--heads', 'origin', `claude/werkbank-${slug}*`], 60_000) : { output: '' };
    const taken = (branch, folder) => existsSync(folder)
      || state.benches.some((bench) => bench.branch === branch || path.resolve(bench.folder) === path.resolve(folder))
      || remote.output.split(/\r?\n/).some((line) => line.endsWith(`refs/heads/${branch}`));
    let suffix = '';
    for (let n = 2; taken(`claude/werkbank-${slug}${suffix}`, `${root}-werkbank-${slug}${suffix}`); n += 1) suffix = `-${n}`;
    const branch = `claude/werkbank-${slug}${suffix}`;
    const folder = `${root}-werkbank-${slug}${suffix}`;
    const bench = {
      id: randomUUID(), name, project: project.id, projectName: project.name, root, folder, branch, base,
      status: 'laedt', sessionId: null, messages: [], createdAt: new Date().toISOString()
    };
    state.benches.push(bench);
    save();
    const added = await git(root, ['worktree', 'add', '--detach', folder, base], 180_000);
    if (!added.ok) {
      state.benches = state.benches.filter((item) => item.id !== bench.id);
      save();
      throw fail(`Die Kopie für die Werkbank ließ sich nicht anlegen: ${added.output.slice(-300)}`, 500);
    }
    bench.status = 'bereit';
    save();
    return bench;
  }

  // ---------- Auftrag ----------
  function send(id, rawText) {
    const bench = find(id);
    const text = String(rawText || '').trim().slice(0, 6000);
    if (!text) throw fail('Schreib, was Worky an dieser Werkbank machen soll.', 400);
    if (running.has(id) || bench.status === 'arbeitet') throw fail('Worky arbeitet an dieser Werkbank gerade. Warte oder drück Stopp.');
    if (bench.status === 'laedt') throw fail('Die Werkbank wird gerade eingerichtet oder hochgeladen. Einen Moment.');
    if (!existsSync(bench.folder)) throw fail(`Der Ordner der Werkbank fehlt (${bench.folder}). Räum sie weg und leg eine neue an.`);
    bench.messages.push({ role: 'timo', text, at: new Date().toISOString() });
    bench.status = 'arbeitet';
    bench.message = '';
    save();
    const abort = new AbortController();
    const live = { text: '', tool: '' };
    running.set(id, { abort, live });
    void work(bench, text, abort.signal, live).finally(() => running.delete(id));
    return publicBench(bench);
  }

  async function work(bench, text, signal, live) {
    try {
      const project = projects().find((item) => item.id === bench.project);
      if (!project) throw new Error('Dieses Projekt ist nicht mehr in der Projektliste.');
      const extra = bench.sessionId ? '' : await context(project, bench.folder);
      const others = state.benches.filter((item) => item.project === bench.project && item.id !== bench.id).map((item) => `„${item.name}“`);
      const prompt = bench.sessionId ? text : [
        `WERKBANK „${bench.name}“ im Projekt „${project.name}“. Erster Auftrag von Timo:`,
        text,
        ...(others.length ? ['', `Gleichzeitig arbeiten andere Werkbänke an: ${others.join(', ')}. Bleib bei deinem Thema.`] : []),
        ...(extra ? ['', extra] : [])
      ].join('\n');
      const args = [
        '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
        '--permission-mode', 'acceptEdits', '--max-turns', '100',
        '--strict-mcp-config', '--mcp-config', await mcpConfig(bench.id, `Werkbank ${bench.name}`), '--permission-prompt-tool', approvalTool,
        '--append-system-prompt', benchRules(project, bench),
        '--allowedTools', ...BENCH_ALLOWED_TOOLS,
        '--disallowedTools', ...BENCH_DENIED_TOOLS
      ];
      if (bench.sessionId) args.push('--resume', bench.sessionId);
      const settings = await hookSettings().catch(() => '');
      if (settings) args.push('--settings', settings);
      const docs = project.kind === 'roblox' ? docsFolder() : '';
      if (docs) args.push('--add-dir', docs);
      let result = null;
      const onLine = (line) => {
        const event = JSON.parse(line);
        if (event.type === 'result') { result = event; return; }
        if (event.type !== 'stream_event' || event.parent_tool_use_id) return;
        const inner = event.event || {};
        if (inner.type === 'content_block_delta' && inner.delta?.type === 'text_delta') { live.text += inner.delta.text; live.tool = ''; }
        else if (inner.type === 'content_block_start' && inner.content_block?.type === 'tool_use') live.tool = String(inner.content_block.name || '').slice(0, 80);
        else if (inner.type === 'message_start' && live.text && !live.text.endsWith('\n\n')) live.text += '\n\n';
        if (live.text.length > MAX_LIVE_TEXT * 2) live.text = live.text.slice(-MAX_LIVE_TEXT);
      };
      await runClaude(args, prompt, RUN_TIMEOUT_MS, onLine, signal, bench.folder);
      if (!result || typeof result.result !== 'string') throw new Error('Worky hat keine lesbare Antwort geliefert.');
      if (typeof result.session_id === 'string' && /^[0-9a-f-]{36}$/i.test(result.session_id)) bench.sessionId = result.session_id;
      if (result.is_error) throw new Error(result.result.slice(0, 600));
      bench.messages.push({ role: 'worky', text: result.result.trim().slice(0, 20_000), at: new Date().toISOString() });
      bench.status = 'bereit';
    } catch (error) {
      const stopped = signal.aborted;
      // Alter Lauf ließ sich nicht fortsetzen (z. B. zu voll): beim nächsten Auftrag frisch beginnen
      if (!stopped && bench.sessionId && !live.text && !live.tool) bench.sessionId = null;
      bench.messages.push({ role: 'fehler', text: stopped ? 'Von dir gestoppt. Was bis dahin geändert war, bleibt in der Werkbank.' : (error.message || 'Worky konnte den Auftrag nicht abschließen.'), at: new Date().toISOString() });
      bench.status = 'bereit';
    }
    bench.messages = bench.messages.slice(-KEEP_MESSAGES);
    save();
  }

  function benchRules(project, bench) {
    const roblox = project.kind === 'roblox';
    return [
      `Du bist Worky aus der App Workflow und arbeitest an der Werkbank „${bench.name}“ im Projekt „${project.name}“. Eine Werkbank ist eine eigene Kopie des Projekts (eigener Ordner). Bis zu zwei andere Werkbänke arbeiten gleichzeitig in ihren eigenen Kopien an anderen Themen. Timos Projektordner ist nicht dieser Ordner.`,
      'Antworte auf Deutsch, locker und einfach (Timo ist Anfänger). Lies zuerst CLAUDE.md und halte dich an die Regeln dort. Ändere nur, was dein Thema braucht, und bewahre bestehende Spiellogik. Gemeinsame Übersichtsdateien (z. B. Code-Karte, Fahrplan, Testpaket in docs/) nur knapp ergänzen, nicht umbauen: Die anderen Werkbänke ändern sie vielleicht auch, sonst gibt es beim Mergen Konflikte.',
      'Erlaubt sind: Dateien lesen und ändern, Spezialisten und Skills des Projekts, die Prüfungen des Projekts (z. B. sh tools/check_all.sh, lune run …, node --check …) und git status/diff/log. Andere Befehle fragen Timo über eine Freigabe-Karte. Kein git commit, push, switch oder reset: Wenn Timo „Fertig“ drückt, committet Workflow, lädt den Zweig hoch und macht einen Pull Request.',
      roblox ? 'Kein Roblox Studio und kein Blender an der Werkbank: Studio zeigt Timos Projektordner, nicht diese Kopie. Teste mit den Prüf-Skripten und Lune-Tests. Was Timo in Studio prüfen soll, schreibst du ihm Klick für Klick auf; er testet den Pull Request.' : 'Keine Programme mit Fenster.',
      'Nach jeder Änderung prüft Workflow die Datei automatisch (Syntax). Meldet die Prüfung einen Fehler, behebe ihn sofort.',
      'Sparsam arbeiten: große Notizen in docs/ erst mit Grep durchsuchen, nur passende Abschnitte lesen, lange Ausgaben begrenzen.',
      'Antworte zum Schluss kurz: was du geändert hast (Dateien), was getestet ist, was Timo in Studio testen soll, offene Fragen. Ist das Thema fertig, sag Timo, dass er „Fertig“ drücken kann.'
    ].join('\n');
  }

  function stop(id) {
    const current = running.get(id);
    if (!current) throw fail('An dieser Werkbank läuft gerade nichts.');
    current.abort.abort();
    return { stopping: true };
  }

  // ---------- Fertig: committen, hochladen, Pull Request ----------
  async function changedFiles(folder) {
    const listed = await git(folder, ['status', '--porcelain=v1', '-uall']);
    return listed.output.split(/\r?\n/).filter((line) => line.length > 3).map((line) => line.slice(3).replace(/^"|"$/g, '').split(' -> ').pop());
  }

  async function finish(id) {
    const bench = find(id);
    if (running.has(id) || bench.status !== 'bereit') throw fail('Worky arbeitet an dieser Werkbank noch. Warte, bis er fertig ist.');
    bench.status = 'laedt';
    save();
    try {
      const files = await changedFiles(bench.folder);
      if (files.length) {
        await git(bench.folder, ['add', '-A']);
        const first = bench.messages.find((item) => item.role === 'timo')?.text || bench.name;
        const lastReply = [...bench.messages].reverse().find((item) => item.role === 'worky')?.text || '';
        const committed = await git(bench.folder, ['commit', '--quiet', '-m', `Werkbank ${bench.name}: ${first.split('\n')[0].slice(0, 60)}`, '-m', lastReply.slice(0, 5000) || first.slice(0, 2000)]);
        if (!committed.ok) throw new Error(`Commit ging nicht: ${committed.output.slice(-300)}`);
      }
      const ahead = await git(bench.folder, ['rev-list', '--count', `${bench.base}..HEAD`]);
      if (!ahead.ok || Number(ahead.output) === 0) throw new Error('Worky hat an dieser Werkbank noch nichts geändert, deshalb gibt es nichts hochzuladen.');
      const pushed = await git(bench.folder, ['push', 'origin', `HEAD:refs/heads/${bench.branch}`], 180_000);
      if (!pushed.ok) throw new Error(`Hochladen zu GitHub ging nicht: ${pushed.output.split(/\r?\n/).slice(-2).join(' ').slice(0, 300)}`);
      bench.pushedAt = new Date().toISOString();
      if (!bench.prUrl) await createPullRequest(bench);
      bench.message = bench.prUrl ? '' : bench.message;
    } finally {
      bench.status = 'bereit';
      save();
    }
    return publicBench(bench);
  }

  async function createPullRequest(bench) {
    const asks = bench.messages.filter((item) => item.role === 'timo').map((item) => `- ${item.text.split('\n')[0].slice(0, 200)}`);
    const lastReply = [...bench.messages].reverse().find((item) => item.role === 'worky')?.text || '';
    const body = [`Worky hat das an der Werkbank „${bench.name}“ gebaut (eigene Kopie des Projekts, parallel zu anderen Werkbänken). Bitte in Studio testen, dann mergen.`, '', '## Aufträge', ...asks, '', '## Worky sagt', lastReply.slice(0, 8000)].join('\n').slice(0, 12_000);
    const baseBranch = bench.base === 'HEAD' ? [] : ['--base', bench.base.replace(/^origin\//, '')];
    for (const gh of [ghCommand, 'gh']) {
      const created = await run(gh, ['pr', 'create', ...baseBranch, '--head', bench.branch, '--title', `Werkbank ${bench.name}: ${(asks[0] || '').slice(2, 70)}`, '--body', body], bench.folder, 90_000);
      const match = /https:\/\/github\.com\/\S+\/pull\/\d+/.exec(created.output);
      if (match) { bench.prUrl = match[0]; return; }
      if (!created.missing) break;
    }
    bench.message = `Der Zweig ${bench.branch} ist auf GitHub, aber der Pull Request ließ sich nicht automatisch anlegen. Auf GitHub „Compare & pull request“ klicken.`;
  }

  // ---------- Wegräumen ----------
  async function remove(id, sure) {
    const bench = find(id);
    if (running.has(id) || bench.status === 'arbeitet' || bench.status === 'laedt') throw fail('Worky arbeitet an dieser Werkbank noch. Erst stoppen.');
    if (!sure && existsSync(bench.folder)) {
      const files = await changedFiles(bench.folder);
      if (files.length) throw fail(`In der Werkbank ${files.length === 1 ? "ist 1 Änderung" : `sind ${files.length} Änderungen`} noch nicht hochgeladen. Drück erst „Fertig“ oder bestätige, dass sie verloren gehen dürfen.`, 428);
    }
    if (existsSync(bench.folder)) {
      const removed = await git(bench.root, ['worktree', 'remove', '--force', bench.folder], 120_000);
      if (!removed.ok) throw fail(`Der Werkbank-Ordner ließ sich nicht wegräumen (vielleicht ist er im Explorer offen): ${removed.output.slice(-200)}`, 500);
    }
    await git(bench.root, ['worktree', 'prune']);
    state.benches = state.benches.filter((item) => item.id !== id);
    save();
    // Der Zweig auf GitHub bleibt (Zweige löscht Workflow nie)
    return { removed: true };
  }

  return { overview, create, send, stop, finish, remove, running: () => running.size > 0 };
}
