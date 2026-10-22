// Testkopie (Workflow Paket 5): Worky ändert die App Workflow nie direkt. Er baut eine Verbesserung in einer
// Kopie neben dem Workflow-Ordner (git worktree „<ordner>-testkopie“), Timo probiert sie auf Port 4181 aus und
// entscheidet: „Übernehmen“ macht daraus einen Pull Request (mergen macht Timo), „Verwerfen“ löscht die Kopie.
// Diese Datei ist gesperrt: Worky darf sie in der Testkopie nicht ändern (sonst könnte er seinen eigenen Schutz lockern).
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import path from 'node:path';

// Ganze Dateien, die in der Testkopie gleich bleiben müssen
const PROTECTED_FILES = ['app/testkopie.mjs', 'app/approval-mcp.mjs', '.gitignore', 'Start-Workflow.bat'];
// Dazu alle Abschnitte zwischen „SPERRE-ANFANG“ und „SPERRE-ENDE“ (z. B. Sperrliste, Freigaben, nur-lokal-Prüfung)
const REGION_START = 'SPERRE-ANFANG';
const REGION_END = 'SPERRE-ENDE';
const TEST_PORT = 4181;
const BUILD_TIMEOUT_MS = 40 * 60_000;
const MAX_GIT_OUTPUT = 400_000;
const MAX_REVIEW_DIFF = 60_000;
const BUSY = ['baut', 'pruefen'];

export function createTestCopy({ appDir, dataDir, gitCommand, runClaude, askClaude, isBusy }) {
  const repoRoot = path.dirname(appDir);
  const folder = path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-testkopie`);
  const stateFile = path.join(dataDir, 'testkopie.json');
  // Die Testkopie selbst baut keine weitere Testkopie
  const disabled = process.env.WORKFLOW_TESTKOPIE === '1';
  let testServer = null;
  let serverLog = '';

  function load() {
    try {
      const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
      // Workflow wurde mitten im Bau neu gestartet: Der Lauf ist weg, die Kopie bleibt zum Verwerfen
      if (BUSY.includes(saved.status)) Object.assign(saved, { status: 'fehler', reason: 'Der Bau wurde unterbrochen, weil Workflow neu gestartet wurde. Verwirf die Testkopie und starte ihn neu.' });
      return saved && typeof saved.status === 'string' ? saved : { status: 'leer' };
    } catch { return { status: 'leer' }; }
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
      try { child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (error) { return resolve({ ok: false, output: error.message }); }
      const timer = setTimeout(() => child.kill(), timeoutMs);
      const add = (chunk) => { if (output.length < MAX_GIT_OUTPUT) output += chunk; };
      child.stdout.on('data', add);
      child.stderr.on('data', add);
      child.once('error', (error) => { clearTimeout(timer); resolve({ ok: false, output: error.message }); });
      child.once('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, output: output.trimEnd() }); });
    });
  }
  const git = (cwd, args, timeoutMs) => run(gitCommand, args, cwd, timeoutMs);

  function available() {
    if (disabled) return { ok: false, why: 'Das hier ist selbst die Testkopie.' };
    if (!existsSync(path.join(repoRoot, '.git'))) return { ok: false, why: 'Der Workflow-Ordner ist kein Git-Ordner, deshalb geht keine Testkopie.' };
    return { ok: true };
  }

  function portOpen(port) {
    return new Promise((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.setTimeout(700);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('timeout', () => { socket.destroy(); resolve(false); });
      socket.once('error', () => resolve(false));
    });
  }

  async function status() {
    const can = available();
    return {
      ...state, folder, available: can.ok, why: can.why || '',
      server: Boolean(testServer) && await portOpen(TEST_PORT), url: `http://127.0.0.1:${TEST_PORT}/`
    };
  }

  // ---------- Bauen ----------
  function buildPrompt(proposal) {
    return [
      'Du verbesserst die App Workflow (Timos lokale App, mit der er mit Worky Spiele baut). Du arbeitest in einer Testkopie im aktuellen Ordner. Timo probiert sie danach auf Port 4181 aus und entscheidet selbst, ob sie übernommen wird.',
      '',
      `AUFTRAG: ${proposal.titel}`,
      `Was sich ändern soll: ${proposal.text}`,
      ...(proposal.warum ? [`Warum: ${proposal.warum}`] : []),
      '',
      'Regeln:',
      '- Lies zuerst CLAUDE.md und die betroffenen Dateien in app/. Halte dich an die Regeln dort: keine Pakete, kein Build-Schritt, Kommentare und UI-Texte deutsch, Bezeichner englisch, Stil des umgebenden Codes.',
      '- Ändere nur, was der Auftrag braucht. Alles, was Workflow heute kann, bleibt.',
      `- Gesperrt, nicht ändern: ${PROTECTED_FILES.join(', ')} und alles zwischen ${REGION_START} und ${REGION_END}. Sicherheitsregeln, Sperren, Freigabe-Karten und der Schutz von .env.local werden nie gelockert. .env.local nie lesen.`,
      '- Prüfe am Ende jede geänderte .js- und .mjs-Datei mit node --check <datei>.',
      '- Antworte zum Schluss auf Deutsch in höchstens 8 Zeilen: was du geändert hast (welche Dateien) und wie Timo es in der Testkopie Klick für Klick ausprobiert.'
    ].join('\n');
  }

  async function start(proposal) {
    const can = available();
    if (!can.ok) throw fail(can.why);
    if (state.status !== 'leer' && state.status !== 'pr') throw fail('Es gibt schon eine Testkopie. Übernimm oder verwirf sie zuerst.');
    if (existsSync(folder)) throw fail(`Der Ordner ${folder} ist schon da. Verschieb oder lösch ihn, dann geht die Testkopie.`);
    // Immer vom neuesten Stand auf GitHub aus bauen, ohne Internet vom lokalen main
    const fetched = await git(repoRoot, ['fetch', 'origin', 'main'], 60_000);
    const base = fetched.ok ? 'origin/main' : 'main';
    const added = await git(repoRoot, ['worktree', 'add', '--detach', folder, base], 120_000);
    if (!added.ok) throw fail(`Die Testkopie ließ sich nicht anlegen: ${added.output.slice(-400)}`, 502);
    // Gleiche Projektliste, damit die Testkopie dieselben Projekte zeigt (Schlüssel aus .env.local kommen nicht mit)
    try {
      mkdirSync(path.join(folder, 'app', 'daten'), { recursive: true });
      copyFileSync(path.join(dataDir, 'projekte.json'), path.join(folder, 'app', 'daten', 'projekte.json'));
    } catch { /* ohne Liste fragt die Testkopie beim Start nach dem Projekt */ }
    state = { status: 'baut', proposalId: proposal.id, titel: proposal.titel, text: proposal.text, base, startedAt: new Date().toISOString() };
    save();
    void build(proposal);
    return status();
  }

  async function build(proposal) {
    try {
      const args = [
        '-p', '--output-format', 'json', '--permission-mode', 'acceptEdits', '--max-turns', '80', '--strict-mcp-config',
        '--tools', 'Read,Edit,Write,Glob,Grep,Bash',
        '--allowedTools', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(node --check:*)',
        '--disallowedTools', 'Read(**/.env.local)', 'Edit(**/.env.local)', 'Write(**/.env.local)'
      ];
      const raw = await runClaude(args, buildPrompt(proposal), BUILD_TIMEOUT_MS, folder);
      const result = JSON.parse(raw.split(/\r?\n/).filter((line) => line.startsWith('{')).pop() || '{}');
      if (result.is_error || typeof result.result !== 'string') throw new Error(String(result.result || 'Worky hat keine Antwort geliefert.'));
      state.summary = result.result.trim().slice(0, 3000);
      state.status = 'pruefen';
      save();
      await check({ review: true });
    } catch (error) {
      Object.assign(state, { status: 'fehler', reason: error.message || 'Der Bau ging schief.', finishedAt: new Date().toISOString() });
      save();
    }
  }

  // ---------- Prüfen: Sperren, Syntax, zweiter Blick ----------
  const regions = (text) => {
    const found = [];
    let current = null;
    for (const line of String(text).split(/\r?\n/)) {
      if (line.includes(REGION_START)) current = [];
      if (current) current.push(line.trimEnd());
      if (current && line.includes(REGION_END)) { found.push(current.join('\n')); current = null; }
    }
    if (current) found.push(current.join('\n'));
    return found;
  };

  async function changedFiles() {
    const listed = await git(folder, ['status', '--porcelain=v1', '-uall']);
    if (!listed.ok) throw new Error(`Git in der Testkopie: ${listed.output.slice(-300)}`);
    const files = [];
    for (const line of listed.output.split(/\r?\n/)) {
      if (line.length < 4) continue;
      for (const part of line.slice(3).split(' -> ')) {
        const file = part.replace(/^"|"$/g, '');
        if (!file.startsWith('app/daten/') && !files.includes(file)) files.push(file);
      }
    }
    return files;
  }

  async function guard(files) {
    for (const file of files) {
      if (PROTECTED_FILES.includes(file)) return `Gesperrte Datei geändert: ${file}`;
      const before = await git(folder, ['show', `HEAD:${file}`]);
      let after = '';
      try { after = await readFile(path.join(folder, file), 'utf8'); } catch { after = ''; }
      if (JSON.stringify(regions(before.ok ? before.output : '')) !== JSON.stringify(regions(after))) return `Gesperrter Abschnitt geändert in ${file}`;
    }
    return '';
  }

  async function syntaxCheck(files) {
    for (const file of files.filter((name) => /\.(m?js)$/.test(name) && existsSync(path.join(folder, name)))) {
      const checked = await run(process.execPath, ['--check', file], folder, 30_000);
      if (!checked.ok) return `${file}: ${checked.output.slice(-400)}`;
    }
    return '';
  }

  async function check({ review }) {
    const files = await changedFiles();
    state.files = files;
    if (!files.length) Object.assign(state, { status: 'fehler', reason: 'Worky hat in der Testkopie nichts geändert.' });
    else {
      const blocked = await guard(files);
      const broken = blocked ? '' : await syntaxCheck(files);
      if (blocked) Object.assign(state, { status: 'gesperrt', reason: `${blocked}. Das darf Worky nicht. Verwirf die Testkopie.` });
      else if (broken) Object.assign(state, { status: 'fehler', reason: `Die geänderte Datei hat einen Syntaxfehler: ${broken}` });
      else if (review) {
        // Zweiter Blick (eigene Claude-Anfrage ohne Werkzeuge): lockert die Änderung etwas, und passt sie zum Auftrag?
        await git(folder, ['add', '-A']);
        const diff = await git(folder, ['diff', '--cached', 'HEAD']);
        let verdict;
        try { verdict = await askClaude(reviewPrompt(diff.output.slice(0, MAX_REVIEW_DIFF))); } catch { verdict = { passt: false, grund: 'Der Prüfer hat nicht geantwortet. Schau dir die Änderung im Pull Request genau an.' }; }
        state.review = verdict.grund || '';
        if (verdict.sicher === false) Object.assign(state, { status: 'gesperrt', reason: `Der Prüfer hat ein Sicherheitsproblem gefunden: ${verdict.grund || 'ohne Begründung'}` });
        else Object.assign(state, { status: 'fertig', reviewWarn: verdict.passt === false });
      } else state.status = 'fertig';
    }
    state.finishedAt = new Date().toISOString();
    save();
  }

  function reviewPrompt(diff) {
    return [
      'Du bist der Prüfer für Workflow, Timos lokale App (Node-Server auf 127.0.0.1, Seite ohne Pakete). Worky hat in einer Testkopie diese Änderung gebaut:',
      `Auftrag: ${state.titel}: ${state.text}`,
      '',
      'Prüfe den Diff unten. „sicher“ ist false, wenn die Änderung irgendetwas davon tut: Sperren oder Sicherheitsregeln lockern (gesperrte Werkzeuge, Freigabe-Karten, nur-lokal-Prüfung von Host und Origin), .env.local oder Schlüssel lesen oder ausgeben, neue Verbindungen ins Internet, neue Wege, Befehle oder Programme auszuführen, Dateien außerhalb von Workflow und den Projektordnern zu löschen oder zu ändern, git push, merge oder reset. „passt“ ist false, wenn die Änderung den Auftrag nicht erfüllt oder offensichtlich etwas kaputt macht.',
      'Antworte NUR mit JSON: {"sicher":true,"passt":true,"grund":"1 bis 2 Sätze auf Deutsch, was du gesehen hast"}',
      '',
      'DIFF:',
      diff || '(leer)'
    ].join('\n');
  }

  // ---------- Ausprobieren auf Port 4181 ----------
  async function serverStart() {
    if (!['fertig'].includes(state.status) || !existsSync(folder)) throw fail('Es gibt gerade keine fertige Testkopie.');
    if (testServer && await portOpen(TEST_PORT)) return status();
    if (await portOpen(TEST_PORT)) throw fail(`Port ${TEST_PORT} ist schon belegt. Schließ das andere Programm darauf.`);
    serverLog = '';
    testServer = spawn(process.execPath, ['server.mjs'], {
      cwd: path.join(folder, 'app'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WORKFLOW_PORT: String(TEST_PORT), WORKFLOW_TESTKOPIE: '1' }
    });
    const keep = (chunk) => { serverLog = (serverLog + chunk).slice(-3000); };
    testServer.stdout.on('data', keep);
    testServer.stderr.on('data', keep);
    testServer.once('close', () => { testServer = null; });
    for (let tries = 0; tries < 30; tries += 1) {
      if (await portOpen(TEST_PORT)) return status();
      if (!testServer) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    serverStop();
    throw fail(`Die Testkopie startet nicht. Letzte Meldung: ${serverLog.trim().split(/\r?\n/).slice(-3).join(' ') || 'keine'}`, 502);
  }
  function serverStop() {
    if (testServer) { try { testServer.kill(); } catch { /* schon weg */ } }
    testServer = null;
  }
  process.on('exit', serverStop);

  // ---------- Übernehmen: Zweig, Commit, Push, Pull Request ----------
  const slug = (value) => String(value || '').toLocaleLowerCase('de').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'verbesserung';

  async function adopt() {
    if (state.status !== 'fertig' || !existsSync(folder)) throw fail('Es gibt gerade keine fertige Testkopie zum Übernehmen.');
    serverStop();
    // Sperren noch einmal prüfen, falls in der Kopie seit dem Bau etwas geändert wurde
    const files = await changedFiles();
    const blocked = await guard(files);
    if (blocked) {
      Object.assign(state, { status: 'gesperrt', reason: `${blocked}. Das darf Worky nicht. Verwirf die Testkopie.` });
      save();
      throw fail(state.reason);
    }
    if (!state.branch) {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      const branch = `claude/worky-${slug(state.titel)}-${stamp}`;
      const switched = await git(folder, ['switch', '-c', branch]);
      if (!switched.ok) throw fail(`Zweig ließ sich nicht anlegen: ${switched.output.slice(-300)}`, 502);
      state.branch = branch;
      save();
    }
    if (files.length) {
      await git(folder, ['add', '-A']);
      const committed = await git(folder, ['commit', '-m', `Worky-Verbesserung: ${state.titel}`, '-m', `${state.text}\n\nGebaut von Worky in der Testkopie, von Timo ausprobiert und übernommen.`]);
      if (!committed.ok) throw fail(`Commit ging nicht: ${committed.output.slice(-300)}`, 502);
    }
    const pushed = await git(folder, ['push', '-u', 'origin', state.branch], 120_000);
    if (!pushed.ok) throw fail(`Hochladen zu GitHub ging nicht: ${pushed.output.slice(-300)}. Der Commit liegt im Zweig ${state.branch}, du kannst ihn in GitHub Desktop veröffentlichen.`, 502);
    // Pull Request mit der GitHub CLI, falls installiert; sonst legt Timo ihn in GitHub Desktop an
    const body = `Vorher: ${state.text}\n\nNachher: siehe Änderung. Worky hat das in der Testkopie gebaut, Timo hat es auf Port ${TEST_PORT} ausprobiert.\n\n${state.summary || ''}`.slice(0, 6000);
    let prUrl = '';
    for (const gh of ghCommands()) {
      const created = await run(gh, ['pr', 'create', '--base', 'main', '--head', state.branch, '--title', `Worky-Verbesserung: ${state.titel}`, '--body', body], folder, 60_000);
      const match = /https:\/\/github\.com\/\S+\/pull\/\d+/.exec(created.output);
      if (match) { prUrl = match[0]; break; }
    }
    const removed = await git(repoRoot, ['worktree', 'remove', folder], 60_000);
    Object.assign(state, { status: 'pr', prUrl, folderKept: !removed.ok, finishedAt: new Date().toISOString() });
    save();
    return status();
  }
  function ghCommands() {
    const list = ['gh'];
    if (process.env.ProgramFiles) list.push(path.join(process.env.ProgramFiles, 'GitHub CLI', 'gh.exe'));
    return list;
  }

  async function discard() {
    serverStop();
    if (existsSync(folder)) {
      const removed = await git(repoRoot, ['worktree', 'remove', '--force', folder], 60_000);
      if (!removed.ok) throw fail(`Die Testkopie ließ sich nicht löschen: ${removed.output.slice(-300)}`, 502);
    }
    await git(repoRoot, ['worktree', 'prune']);
    const proposalId = state.proposalId;
    state = { status: 'leer' };
    save();
    return { proposalId };
  }

  // ---------- Nach dem Mergen: echten Workflow-Ordner auf den neuen Stand bringen ----------
  // Workflow läuft mit „node --watch“, startet also nach dem Pull von selbst neu.
  async function update() {
    if (disabled) throw fail('Die Testkopie aktualisiert sich nicht selbst.');
    if (isBusy() || BUSY.includes(state.status)) throw fail('Worky arbeitet gerade. Warte, bis er fertig ist.');
    const branch = await git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch.output.trim() !== 'main') throw fail(`Dein Workflow-Ordner ist gerade auf dem Zweig „${branch.output.trim()}“. Wechsel in GitHub Desktop auf main und klick dort „Pull origin“.`);
    const dirty = await git(repoRoot, ['status', '--porcelain', '--untracked-files=no']);
    if (dirty.output) throw fail('Im Workflow-Ordner gibt es ungespeicherte Änderungen. Hol den neuen Stand in GitHub Desktop mit „Pull origin“.');
    const pulled = await git(repoRoot, ['pull', '--ff-only', 'origin', 'main'], 120_000);
    if (!pulled.ok) throw fail(`Holen ging nicht: ${pulled.output.slice(-300)}`, 502);
    if (state.status === 'pr') { state = { status: 'leer' }; save(); }
    return { output: pulled.output.slice(-600), changed: !/Already up to date|Bereits aktuell/i.test(pulled.output) };
  }

  return { status, start, serverStart, serverStop, adopt, discard, update, check: () => check({ review: false }) };
}
