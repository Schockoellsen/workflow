// Nacht-Schicht (Ausbau 2026-10-22): Timo schreibt abends Aufgaben auf eine Liste, Worky arbeitet sie nachts allein ab.
// Gearbeitet wird nie in Timos Projektordner, sondern in einer Kopie daneben (git worktree „<projekt>-nachtschicht“)
// auf einem eigenen Zweig claude/nachtschicht-<datum>. Nach jeder Aufgabe committet Workflow selbst, am Ende lädt es
// den Zweig hoch und legt einen Pull Request an. Morgens steht der Bericht auf der Projektseite; mergen macht Timo.
// Nachts kann niemand Freigabe-Karten klicken: Worky darf nur lesen, Dateien ändern und die Prüfungen des Projekts
// laufen lassen. Kein Studio, kein Blender, kein Commit, kein Push durch Worky selbst.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const TASK_TIMEOUT_MS = 45 * 60_000;
const NIGHT_BUDGET_MS = 6 * 60 * 60_000;
const MAX_TASKS_PER_NIGHT = 8;
const MAX_OPEN_TASKS = 30;
const KEEP_RUNS = 12;
const END_HOUR = 8; // nach 8 Uhr morgens startet keine Nacht-Schicht mehr von selbst
const MAX_GIT_OUTPUT = 200_000;

// SPERRE-ANFANG (Worky darf diesen Abschnitt in der Testkopie nicht ändern, siehe testkopie.mjs)
// Nachts ohne Rückfrage erlaubt. Alles andere ist nachts verboten, weil keiner eine Freigabe-Karte klicken kann.
const NIGHT_ALLOWED_TOOLS = [
  'Read', 'Glob', 'Grep', 'Edit', 'Write', 'Agent', 'Task', 'Skill', 'TodoWrite',
  'Bash(sh tools/check_all.sh)', 'Bash(sh tools/check_modules.sh)', 'Bash(sh tools/codepruefung.sh:*)', 'Bash(sh tools/codepruefung.sh)',
  'Bash(sh tools/preview/machine.sh:*)', 'Bash(sh tools/preview/cave.sh:*)', 'Bash(sh tools/balance/tabelle.sh:*)', 'Bash(sh tools/balance/simulation.sh:*)',
  'Bash(lune run:*)', 'Bash(node --check:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)'
];
const NIGHT_DENIED_TOOLS = [
  'Read(**/.env.local)', 'Edit(**/.env.local)', 'Write(**/.env.local)', 'Read(**/.env)', 'Edit(**/.env)', 'Write(**/.env)',
  'Bash(git commit:*)', 'Bash(git push:*)', 'Bash(git merge:*)', 'Bash(git reset:*)', 'Bash(git rebase:*)', 'Bash(git checkout:*)',
  'Bash(git switch:*)', 'Bash(git branch:*)', 'Bash(git worktree:*)', 'Bash(git stash:*)', 'Bash(git clean:*)', 'Bash(gh:*)',
  'PowerShell', 'WebFetch', 'NotebookEdit',
  'ScheduleWakeup', 'Workflow', 'CronCreate', 'CronDelete', 'RemoteTrigger', 'Monitor', 'PushNotification',
  'EnterWorktree', 'ExitWorktree', 'SendMessage', 'ListAgents', 'ReportFindings', 'TaskStop'
];
// SPERRE-ENDE

export function createNightShift({ dataDir, gitCommand, ghCommand, runClaude, projects, hookSettings, context, docsFolder, isBusy }) {
  const stateFile = path.join(dataDir, 'nachtschicht.json');
  const disabled = process.env.WORKFLOW_TESTKOPIE === '1';
  let current = null; // { runId, abort, task } solange eine Nacht-Schicht läuft
  let keepAwake = null;

  function load() {
    try {
      const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
      const state = {
        settings: { enabled: saved.settings?.enabled === true, start: /^\d{2}:\d{2}$/.test(saved.settings?.start) ? saved.settings.start : '02:00' },
        tasks: Array.isArray(saved.tasks) ? saved.tasks : [],
        runs: Array.isArray(saved.runs) ? saved.runs : [],
        lastNight: typeof saved.lastNight === 'string' ? saved.lastNight : ''
      };
      // Workflow wurde mitten in der Nacht-Schicht beendet: Lauf als unterbrochen markieren
      for (const run of state.runs) if (run.status === 'laeuft') Object.assign(run, { status: 'fehler', message: 'Workflow wurde während der Nacht-Schicht beendet (PC aus oder neu gestartet). Was schon committet war, liegt im Zweig.' });
      return state;
    } catch {
      return { settings: { enabled: false, start: '02:00' }, tasks: [], runs: [], lastNight: '' };
    }
  }
  let state = load();
  function save() {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
  }
  const fail = (message, status = 409) => Object.assign(new Error(message), { status });

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

  // ---------- Liste ----------
  const openTasks = (projectId) => state.tasks.filter((task) => !projectId || task.project === projectId);
  function overview(projectId) {
    return {
      available: !disabled, settings: state.settings, running: Boolean(current), currentTask: current?.task || null,
      tasks: openTasks(projectId), runs: state.runs.filter((item) => !projectId || item.project === projectId).slice(0, 6),
      unseen: state.runs.filter((item) => !item.seen && item.status !== 'laeuft'), nextStart: nextStart()
    };
  }
  function addTask(project, text) {
    const clean = String(text || '').trim().slice(0, 2000);
    if (!clean) throw fail('Schreib, was Worky machen soll.', 400);
    if (state.tasks.length >= MAX_OPEN_TASKS) throw fail(`Höchstens ${MAX_OPEN_TASKS} Aufgaben auf der Liste.`);
    const task = { id: randomUUID(), project: project.id, projectName: project.name, text: clean, addedAt: new Date().toISOString() };
    state.tasks.push(task);
    save();
    return task;
  }
  function removeTask(id) {
    if (current?.task?.id === id) throw fail('An dieser Aufgabe arbeitet Worky gerade.');
    state.tasks = state.tasks.filter((task) => task.id !== id);
    save();
  }
  function moveTask(id, direction) {
    const index = state.tasks.findIndex((task) => task.id === id);
    const other = index + (direction === 'hoch' ? -1 : 1);
    if (index < 0 || other < 0 || other >= state.tasks.length) return;
    [state.tasks[index], state.tasks[other]] = [state.tasks[other], state.tasks[index]];
    save();
  }
  function setSettings(value) {
    if (typeof value.enabled === 'boolean') state.settings.enabled = value.enabled;
    if (typeof value.start === 'string') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.start)) throw fail('Startzeit bitte als HH:MM, z. B. 02:00.', 400);
      state.settings.start = value.start;
    }
    save();
  }
  function markSeen() {
    for (const item of state.runs) if (item.status !== 'laeuft') item.seen = true;
    save();
  }

  // ---------- Zeitplan ----------
  // Die „Nacht“ heißt nach dem Abend, an dem sie beginnt (vor 12 Uhr zählt zum Vortag)
  const localDate = (date) => new Intl.DateTimeFormat('sv-SE').format(date);
  const nightOf = (date) => localDate(date.getHours() < 12 ? new Date(date.getTime() - 12 * 3600_000) : date);
  const minutes = (value) => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
  function inWindow(date) {
    const now = date.getHours() * 60 + date.getMinutes();
    const start = minutes(state.settings.start);
    const end = END_HOUR * 60;
    return start < end ? now >= start && now < end : now >= start || now < end;
  }
  function nextStart() {
    if (!state.settings.enabled) return null;
    const now = new Date();
    const [h, m] = state.settings.start.split(':').map(Number);
    const next = new Date(now);
    next.setHours(h, m, 0, 0);
    if (next <= now || nightOf(next) === state.lastNight) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }
  function tick() {
    if (disabled || current || !state.settings.enabled || !state.tasks.length || isBusy()) return;
    const now = new Date();
    if (!inWindow(now) || state.lastNight === nightOf(now)) return;
    start('zeitplan').catch((error) => console.error(`Nacht-Schicht: ${error.message}`));
  }

  // ---------- Ablauf ----------
  async function start(trigger = 'hand') {
    if (disabled) throw fail('Die Testkopie macht keine Nacht-Schicht.');
    if (current) throw fail('Die Nacht-Schicht läuft schon.');
    if (!state.tasks.length) throw fail('Die Liste ist leer. Schreib erst eine Aufgabe drauf.');
    if (trigger === 'hand' && isBusy()) throw fail('Worky arbeitet gerade im Chat. Warte, bis er fertig ist.');
    state.lastNight = nightOf(new Date());
    save();
    const abort = new AbortController();
    current = { abort, task: null };
    holdAwake(true);
    void work(abort.signal, trigger).finally(() => { current = null; holdAwake(false); });
    return overview();
  }

  function stop() {
    if (!current) throw fail('Die Nacht-Schicht läuft gerade nicht.');
    current.abort.abort();
    return { stopping: true };
  }

  async function work(signal, trigger) {
    const startedAt = Date.now();
    let done = 0;
    // Projekte in der Reihenfolge der Liste, jedes mit seinen Aufgaben
    const order = [...new Set(state.tasks.map((task) => task.project))];
    for (const projectId of order) {
      if (signal.aborted || done >= MAX_TASKS_PER_NIGHT || Date.now() - startedAt > NIGHT_BUDGET_MS) break;
      const project = projects().find((item) => item.id === projectId);
      const tasks = state.tasks.filter((task) => task.project === projectId).slice(0, MAX_TASKS_PER_NIGHT - done);
      const record = {
        id: randomUUID(), project: projectId, projectName: project?.name || tasks[0]?.projectName || projectId, trigger, night: state.lastNight,
        status: 'laeuft', startedAt: new Date().toISOString(), report: [], seen: false
      };
      state.runs.unshift(record);
      state.runs = state.runs.slice(0, KEEP_RUNS);
      save();
      try {
        if (!project) throw new Error('Dieses Projekt ist nicht mehr in der Projektliste.');
        done += await workProject(project, tasks, record, signal, startedAt);
        if (signal.aborted) record.status = 'abgebrochen';
        else if (record.status === 'laeuft') record.status = 'fertig';
      } catch (error) {
        Object.assign(record, { status: 'fehler', message: error.message || 'Die Nacht-Schicht ging schief.' });
      }
      record.finishedAt = new Date().toISOString();
      save();
      if (record.stopAll) break;
    }
  }

  async function workProject(project, tasks, record, signal, nightStartedAt) {
    const root = path.resolve(project.root);
    if (!existsSync(path.join(root, '.git'))) throw new Error('Der Projektordner ist kein Git-Ordner. Die Nacht-Schicht braucht Git (für den eigenen Zweig).');
    // Vom neuesten Stand auf GitHub aus arbeiten, ohne Internet vom lokalen main
    const fetched = await git(root, ['fetch', 'origin', 'main'], 90_000);
    let base = '';
    for (const candidate of [fetched.ok ? 'origin/main' : '', 'main', 'master', 'HEAD'].filter(Boolean)) {
      if ((await git(root, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`])).ok) { base = candidate; break; }
    }
    if (!base) throw new Error('Im Projekt gibt es noch keinen Commit, von dem die Nacht-Schicht ausgehen kann.');
    const folder = `${root}-nachtschicht`;
    await clearFolder(root, folder);
    const added = await git(root, ['worktree', 'add', '--detach', folder, base], 180_000);
    if (!added.ok) throw new Error(`Die Arbeitskopie ließ sich nicht anlegen: ${added.output.slice(-300)}`);
    Object.assign(record, { base, folder });
    save();
    let count = 0;
    let failures = 0;
    try {
      for (const [index, task] of tasks.entries()) {
        if (signal.aborted || Date.now() - nightStartedAt > NIGHT_BUDGET_MS) break;
        current.task = { id: task.id, text: task.text, projectName: record.projectName };
        const entry = { task: task.text, status: 'laeuft', startedAt: new Date().toISOString() };
        record.report.push(entry);
        save();
        try {
          const summary = await runTask(project, folder, task, index, tasks.length, record.report, signal);
          const files = await commitTask(folder, record, task, summary);
          Object.assign(entry, { status: files.length ? (/^\s*⚠️/.test(summary) ? 'teilweise' : 'erledigt') : 'nichts', summary, files });
          failures = 0;
        } catch (error) {
          // Halbfertiges der abgebrochenen Aufgabe nicht mitnehmen (nur in der Arbeitskopie; macht Workflow, nicht Worky)
          await git(folder, ['reset', '--hard', '--quiet']);
          await git(folder, ['clean', '-fdq']);
          Object.assign(entry, { status: signal.aborted ? 'abgebrochen' : 'fehler', summary: signal.aborted ? 'Von dir gestoppt.' : (error.message || 'Fehler') });
          failures += 1;
          if (!signal.aborted && (/kontingent|limit|anmeld|logged in/i.test(error.message || '') || failures >= 2)) {
            record.stopAll = true;
            record.message = 'Worky hat zweimal hintereinander nicht fertig bekommen (oft: Claude-Kontingent für heute leer). Die übrigen Aufgaben bleiben auf der Liste.';
          }
        }
        entry.finishedAt = new Date().toISOString();
        // Erledigte (und fehlgeschlagene) Aufgaben verlassen die Liste, sie stehen im Bericht; abgebrochene bleiben
        if (entry.status !== 'abgebrochen') state.tasks = state.tasks.filter((item) => item.id !== task.id);
        else break;
        count += 1;
        save();
        if (record.stopAll) break;
      }
      if (record.branch) await publish(root, folder, record);
      else if (!record.message) record.message = 'Worky hat in dieser Nacht nichts geändert, deshalb gibt es keinen Pull Request.';
    } finally {
      const removed = await git(root, ['worktree', 'remove', '--force', folder], 120_000);
      if (!removed.ok) record.folderKept = folder;
      await git(root, ['worktree', 'prune']);
    }
    return count;
  }

  // Ordner einer alten, unterbrochenen Nacht-Schicht wegräumen, aber nur, wenn Git ihn als eigene Arbeitskopie kennt
  async function clearFolder(root, folder) {
    if (!existsSync(folder)) { await git(root, ['worktree', 'prune']); return; }
    const listed = await git(root, ['worktree', 'list', '--porcelain']);
    const known = listed.output.split(/\r?\n/).some((line) => line.startsWith('worktree ') && path.resolve(line.slice(9)) === path.resolve(folder));
    if (!known) throw new Error(`Neben dem Projekt liegt schon ein Ordner ${folder}, der nicht von der Nacht-Schicht ist. Verschieb oder lösch ihn.`);
    const removed = await git(root, ['worktree', 'remove', '--force', folder], 120_000);
    if (!removed.ok) throw new Error(`Die alte Arbeitskopie ${folder} ließ sich nicht wegräumen: ${removed.output.slice(-200)}`);
  }

  async function runTask(project, folder, task, index, total, report, signal) {
    const extra = await context(project, folder);
    const before = report.slice(0, -1).filter((item) => item.summary).map((item, number) => `${number + 1}. ${item.task.slice(0, 200)} → ${item.summary.split('\n')[0].slice(0, 200)}`);
    const prompt = [
      `NACHT-SCHICHT, Aufgabe ${index + 1} von ${total} im Projekt „${project.name}“:`,
      task.text,
      ...(before.length ? ['', 'Vorher in dieser Nacht erledigt (schon committet):', ...before] : []),
      ...(extra ? ['', extra] : [])
    ].join('\n');
    const args = [
      '-p', '--output-format', 'json', '--permission-mode', 'acceptEdits', '--max-turns', '90', '--strict-mcp-config',
      '--append-system-prompt', nightRules(project),
      '--allowedTools', ...NIGHT_ALLOWED_TOOLS,
      '--disallowedTools', ...NIGHT_DENIED_TOOLS
    ];
    const settings = await hookSettings().catch(() => '');
    if (settings) args.push('--settings', settings);
    // Roblox-Doku zum Nachschlagen (liegt außerhalb der Arbeitskopie, deshalb freigeben)
    const docs = project.kind === 'roblox' ? docsFolder() : '';
    if (docs) args.push('--add-dir', docs);
    const raw = await runClaude(args, prompt, TASK_TIMEOUT_MS, folder, signal);
    let result = {};
    try { result = JSON.parse(raw.split(/\r?\n/).filter((line) => line.startsWith('{')).pop() || '{}'); } catch { result = {}; }
    if (result.is_error || typeof result.result !== 'string') throw new Error(String(result.result || 'Worky hat keine Antwort geliefert.').slice(0, 400));
    return result.result.trim().slice(0, 2500);
  }

  function nightRules(project) {
    const roblox = project.kind === 'roblox';
    return [
      `Du bist Worky aus der App Workflow und arbeitest in der Nacht-Schicht: Timo schläft, du erledigst allein Aufgaben aus seiner Liste im Projekt „${project.name}“. Du arbeitest in einer Kopie des Projekts (eigener Ordner, eigener Zweig). Workflow committet deine Änderungen nach jeder Aufgabe selbst und macht morgens einen Pull Request daraus; Timo prüft und mergt.`,
      'Niemand kann nachts Fragen beantworten oder Freigabe-Karten klicken. Ist eine Aufgabe unklar oder zu riskant, bau die kleinste sichere Variante oder ändere nichts und schreib die Frage in deinen Bericht. Nichts veröffentlichen, nichts hochladen, keine Konten, keine Geheimnisse (.env, .env.local) lesen.',
      'Erlaubt sind: Dateien lesen und ändern, Spezialisten und Skills des Projekts, die Prüfungen des Projekts (z. B. sh tools/check_all.sh, lune run …, node --check …) und git status/diff/log. Kein git commit, push, switch oder reset (macht Workflow). ' + (roblox ? 'Kein Roblox Studio und kein Blender (nachts nicht verbunden): Teste mit den Prüf-Skripten und Lune-Tests, Studio-Tests schreibst du Timo in den Bericht.' : 'Keine Programme mit Fenster.'),
      'Lies zuerst CLAUDE.md und halte dich an die Regeln dort. Ändere nur, was die Aufgabe braucht, und bewahre bestehende Spiellogik. Lass am Ende die Prüfungen des Projekts laufen, falls es welche gibt, und behebe gefundene Fehler.',
      'Nach jeder Änderung prüft Workflow die Datei automatisch (Syntax). Meldet die Prüfung einen Fehler, behebe ihn sofort.',
      'Sparsam arbeiten: große Notizen in docs/ erst mit Grep durchsuchen, nur passende Abschnitte lesen, lange Ausgaben begrenzen.',
      'Antworte zum Schluss auf Deutsch in höchstens 8 Zeilen. Erste Zeile genau eins von: „✅ erledigt“, „⚠️ teilweise“ oder „❌ nicht gemacht“, dazu ein kurzer Satz. Dann: welche Dateien, was Timo morgens selbst testen soll (Klick für Klick, kurz) und offene Fragen.'
    ].join('\n');
  }

  async function commitTask(folder, record, task, summary) {
    const listed = await git(folder, ['status', '--porcelain=v1', '-uall']);
    const files = listed.output.split(/\r?\n/).filter((line) => line.length > 3).map((line) => line.slice(3).replace(/^"|"$/g, '').split(' -> ').pop());
    if (!files.length) return [];
    if (!record.branch) {
      const night = record.night || record.startedAt.slice(0, 10);
      let branch = `claude/nachtschicht-${night}`;
      for (let n = 2; (await git(folder, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).ok; n += 1) branch = `claude/nachtschicht-${night}-${n}`;
      const switched = await git(folder, ['switch', '-c', branch]);
      if (!switched.ok) throw new Error(`Zweig ließ sich nicht anlegen: ${switched.output.slice(-300)}`);
      record.branch = branch;
    }
    await git(folder, ['add', '-A']);
    const title = task.text.split('\n')[0].slice(0, 70);
    const committed = await git(folder, ['commit', '--quiet', '-m', `Nacht-Schicht: ${title}`, '-m', `${task.text}\n\n${summary}`.slice(0, 6000)]);
    if (!committed.ok) throw new Error(`Commit ging nicht: ${committed.output.slice(-300)}`);
    return files.slice(0, 60);
  }

  async function publish(root, folder, record) {
    const pushed = await git(folder, ['push', '-u', 'origin', record.branch], 180_000);
    if (!pushed.ok) {
      record.message = `Hochladen zu GitHub ging nicht (${pushed.output.split(/\r?\n/).pop()?.slice(0, 160) || 'ohne Meldung'}). Die Commits liegen im Zweig ${record.branch}: In GitHub Desktop auf den Zweig wechseln und „Publish branch“ klicken.`;
      return;
    }
    const lines = record.report.map((item) => `### ${item.status === 'erledigt' ? '✅' : item.status === 'teilweise' ? '⚠️' : item.status === 'nichts' ? '➖' : '❌'} ${item.task.split('\n')[0].slice(0, 120)}\n\n${item.summary || ''}`);
    const body = [`Worky hat diese Aufgaben in der Nacht-Schicht allein abgearbeitet (jede Aufgabe ein Commit). Bitte testen, dann mergen.`, '', ...lines].join('\n\n').slice(0, 12_000);
    for (const gh of [ghCommand, 'gh']) {
      const baseBranch = record.base === 'HEAD' ? [] : ['--base', record.base.replace(/^origin\//, '')];
      const created = await run(gh, ['pr', 'create', ...baseBranch, '--head', record.branch, '--title', `Nacht-Schicht ${record.night || record.startedAt.slice(0, 10)}: ${record.report.length} ${record.report.length === 1 ? 'Aufgabe' : 'Aufgaben'}`, '--body', body], folder, 90_000);
      const match = /https:\/\/github\.com\/\S+\/pull\/\d+/.exec(created.output);
      if (match) { record.prUrl = match[0]; return; }
      if (!created.missing) break;
    }
    record.message = `Der Zweig ${record.branch} ist auf GitHub, aber der Pull Request ließ sich nicht automatisch anlegen. Auf GitHub „Compare & pull request“ klicken.`;
  }

  // Windows soll während der Nacht-Schicht nicht einschlafen (gilt nur, solange sie läuft)
  function holdAwake(on) {
    if (process.platform !== 'win32') return;
    if (!on) { try { keepAwake?.kill(); } catch { /* schon weg */ } keepAwake = null; return; }
    const script = '$s=Add-Type -Name W -Namespace N -PassThru -MemberDefinition \'[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);\'; $null=$s::SetThreadExecutionState(2147483649); while($true){Start-Sleep -Seconds 60}';
    try { keepAwake = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: 'ignore' }); keepAwake.on('error', () => { keepAwake = null; }); } catch { keepAwake = null; }
  }
  process.on('exit', () => holdAwake(false));

  if (!disabled) {
    setTimeout(tick, 2 * 60_000).unref();
    setInterval(tick, 5 * 60_000).unref();
  }

  return { overview, addTask, removeTask, moveTask, setSettings, markSeen, start, stop, running: () => Boolean(current) };
}
