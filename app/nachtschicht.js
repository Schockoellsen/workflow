// Nacht-Schicht (Ausbau 2026-10-22): Aufgabenliste für die Nacht, Zeitplan und die Berichte am Morgen.
// Die Arbeit selbst macht der Server (nachtschicht.mjs) in einer Kopie des Projekts; hier nur Anzeige und Liste.
(() => {
  const area = document.querySelector('details[data-bereich="nacht"]');
  const root = document.querySelector('#nachtschicht');
  const badge = document.querySelector('#night-count');
  const project = window.workflowProject || null;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  async function api(url, body) {
    const response = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Workflow antwortet gerade nicht.');
    return data;
  }
  const button = (label, className, onClick) => {
    const node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  };
  const when = (iso) => { try { return new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  const ICONS = { erledigt: '✅', teilweise: '⚠️', nichts: '➖', fehler: '❌', abgebrochen: '⏹', laeuft: '⏳' };
  const RUN_LABEL = { laeuft: 'läuft gerade', fertig: 'fertig', fehler: 'mit Problem beendet', abgebrochen: 'von dir gestoppt' };
  const link = (href, text) => {
    const node = el('a', '', text);
    node.href = href;
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
    return node;
  };

  function showBadge(data) {
    if (!badge) return;
    const count = data.unseen.length || 0;
    badge.hidden = !count && !data.running;
    badge.textContent = data.running ? '⏳' : String(count);
    badge.title = data.running ? 'Die Nacht-Schicht läuft gerade' : `${count} neue ${count === 1 ? 'Bericht' : 'Berichte'}`;
  }

  // ---------- Bereich „Nacht-Schicht“ ----------
  let timer = null;
  async function render() {
    if (!root) return;
    let data;
    try { data = await api(`/api/nachtschicht?projekt=${encodeURIComponent(project?.id || '')}`); } catch (error) { root.replaceChildren(el('p', 'wz-bad', error.message)); return; }
    showBadge(data);
    if (!data.available) { root.replaceChildren(el('p', 'wz-hint', 'Die Testkopie macht keine Nacht-Schicht.')); return; }
    const all = await api('/api/nachtschicht').catch(() => data);
    root.replaceChildren(listCard(data, all), planCard(data, all), reportCard(data));
    // Läuft sie, alle 20 Sekunden neu zeigen, solange der Bereich offen ist
    clearTimeout(timer);
    if (data.running && area?.open) timer = setTimeout(render, 20_000);
  }

  function listCard(data, all) {
    const card = el('section', 'wz-card');
    card.append(el('h3', '', 'Aufgaben für heute Nacht'), el('p', 'wz-hint', 'Schreib so, wie du es Worky im Chat sagen würdest, eine Aufgabe pro Eintrag. Er arbeitet sie der Reihe nach ab, ganz ohne Rückfragen. Gut geeignet: klar umrissene Sachen wie „Bau ein Pausenmenü mit Fortsetzen und Beenden“ oder „Räum die Sound-Skripte auf“.'));
    const form = el('form', 'ns-add');
    const input = el('textarea');
    input.rows = 3;
    input.maxLength = 2000;
    input.placeholder = 'Was soll Worky heute Nacht machen?';
    input.setAttribute('aria-label', 'Neue Aufgabe für die Nacht-Schicht');
    const add = el('button', 'primary-button', '＋ Auf die Liste');
    add.type = 'submit';
    const say = el('p', 'wz-hint');
    form.append(input, add);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!input.value.trim()) return;
      add.disabled = true;
      try { await api('/api/nachtschicht/aufgabe', { projekt: project?.id, text: input.value }); input.value = ''; await render(); } catch (error) { say.textContent = error.message; } finally { add.disabled = false; }
    });
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); form.requestSubmit(); } });
    card.append(form, say);
    const list = el('ol', 'ns-list');
    for (const [index, task] of data.tasks.entries()) {
      const item = el('li', 'ns-task');
      const working = data.currentTask?.id === task.id;
      item.append(el('span', 'ns-text', `${working ? '⏳ ' : ''}${task.text}`));
      const actions = el('span', 'wz-actions');
      if (index > 0) actions.append(button('↑', 'tiny-action', () => move(task.id, 'hoch')));
      if (index < data.tasks.length - 1) actions.append(button('↓', 'tiny-action', () => move(task.id, 'runter')));
      if (!working) actions.append(button('✕', 'tiny-action', async () => { try { await api('/api/nachtschicht/entfernen', { id: task.id }); await render(); } catch (error) { say.textContent = error.message; } }));
      for (const action of actions.children) action.setAttribute('aria-label', { '↑': 'Nach oben', '↓': 'Nach unten', '✕': 'Von der Liste nehmen' }[action.textContent]);
      item.append(actions);
      list.append(item);
    }
    if (data.tasks.length) card.append(list);
    else card.append(el('p', 'ns-empty', 'Noch nichts auf der Liste.'));
    const others = all.tasks.length - data.tasks.length;
    if (others > 0) card.append(el('p', 'wz-hint', `Dazu ${others} ${others === 1 ? 'Aufgabe' : 'Aufgaben'} in anderen Projekten; die macht Worky in derselben Nacht.`));
    return card;
  }
  async function move(id, richtung) {
    try { await api('/api/nachtschicht/verschieben', { id, richtung }); await render(); } catch { /* nächstes Mal */ }
  }

  function planCard(data, all) {
    const card = el('section', 'wz-card');
    card.append(el('h3', '', 'Wann'));
    const row = el('div', 'ns-plan');
    const toggle = el('label', 'ns-toggle');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = data.settings.enabled;
    toggle.append(box, document.createTextNode(' Jede Nacht von selbst starten um'));
    const time = el('input');
    time.type = 'time';
    time.value = data.settings.start;
    time.setAttribute('aria-label', 'Startzeit');
    const say = el('p', 'wz-hint');
    const saveSettings = async () => {
      try { await api('/api/nachtschicht/einstellungen', { an: box.checked, start: time.value || '02:00' }); await render(); } catch (error) { say.textContent = error.message; }
    };
    box.addEventListener('change', saveSettings);
    time.addEventListener('change', saveSettings);
    row.append(toggle, time);
    card.append(row);
    if (data.running) {
      const now = el('div', 'ns-now');
      now.append(el('strong', '', data.currentTask ? `Worky arbeitet gerade an: ${data.currentTask.text.split('\n')[0].slice(0, 140)}` : 'Die Nacht-Schicht läuft.'),
        button('■ Stoppen', 'outline-button', async () => {
          if (!confirm('Nacht-Schicht stoppen? Fertige Aufgaben bleiben im Zweig, die angefangene wird verworfen und bleibt auf der Liste.')) return;
          try { await api('/api/nachtschicht/stoppen', {}); await render(); } catch (error) { say.textContent = error.message; }
        }));
      card.append(now);
    } else {
      const next = data.nextStart ? `Nächster Start: ${when(data.nextStart)}${all.tasks.length ? '' : ' (nur wenn etwas auf der Liste steht)'}.` : 'Automatisch ist aus. Du kannst sie auch jetzt gleich starten.';
      const actions = el('div', 'wz-actions');
      const go = button('Jetzt starten', 'outline-button', async () => {
        if (!confirm('Nacht-Schicht jetzt starten? Worky arbeitet die ganze Liste ab (in einer Kopie neben deinem Projekt, dein Projektordner bleibt unberührt). Das braucht dein Claude-Kontingent.')) return;
        go.disabled = true;
        try { await api('/api/nachtschicht/starten', {}); await render(); } catch (error) { say.textContent = error.message; go.disabled = false; }
      });
      go.disabled = !all.tasks.length;
      actions.append(go);
      card.append(el('p', 'wz-hint', next), actions);
    }
    card.append(say, el('p', 'wz-hint', 'Wichtig: Dein PC muss nachts an sein und Workflow offen. Stell in Windows unter Einstellungen → System → Netzbetrieb und Akku „Energiesparmodus“ auf „Nie“. Während die Nacht-Schicht läuft, hält Workflow den PC selbst wach. Worky arbeitet in einer Kopie neben deinem Projekt auf einem eigenen Zweig; morgens wartet ein Pull Request auf dich.'));
    return card;
  }

  function runView(run, compact) {
    const box = el('div', 'ns-run');
    const head = el('div', 'ns-run-head');
    const done = run.report.filter((item) => item.status === 'erledigt' || item.status === 'teilweise').length;
    head.append(el('strong', '', `${compact ? `${run.projectName} · ` : ''}${when(run.startedAt)} · ${RUN_LABEL[run.status] || run.status}`), el('span', 'wz-hint', `${done} von ${run.report.length} ${run.report.length === 1 ? 'Aufgabe' : 'Aufgaben'} erledigt`));
    if (run.prUrl) head.append(link(run.prUrl, 'Pull Request ansehen →'));
    box.append(head);
    if (run.message) box.append(el('p', run.status === 'fehler' ? 'wz-bad' : 'wz-hint', run.message));
    if (run.folderKept) box.append(el('p', 'wz-hint', `Die Arbeitskopie ${run.folderKept} ließ sich nicht wegräumen. Du kannst den Ordner löschen.`));
    for (const item of run.report) {
      const line = el('details', 'ns-item');
      line.append(el('summary', '', `${ICONS[item.status] || '•'} ${item.task.split('\n')[0].slice(0, 160)}`));
      if (item.summary) line.append(el('pre', '', item.summary));
      if (item.files?.length) line.append(el('p', 'wz-hint', `Dateien: ${item.files.slice(0, 12).join(', ')}${item.files.length > 12 ? ' …' : ''}`));
      if (!compact && (item.status === 'fehler' || item.status === 'nichts')) {
        line.append(button('Nochmal auf die Liste', 'tiny-action', async () => { try { await api('/api/nachtschicht/aufgabe', { projekt: run.project, text: item.task }); await render(); } catch { /* egal */ } }));
      }
      if (item.status === 'fehler' || item.status === 'teilweise') line.open = !compact;
      box.append(line);
    }
    return box;
  }

  function reportCard(data) {
    const card = el('section', 'wz-card');
    card.append(el('h3', '', 'Berichte'));
    if (!data.runs.length) { card.append(el('p', 'ns-empty', 'Hier steht morgens, was Worky in der Nacht geschafft hat.')); return card; }
    card.append(el('p', 'wz-hint', 'Jede Aufgabe ist ein eigener Commit im Pull Request. Testen, dann auf GitHub mergen; danach in GitHub Desktop „Pull origin“.'));
    for (const run of data.runs) card.append(runView(run, false));
    if (data.unseen.length) void api('/api/nachtschicht/gelesen', {}).then(showBadge).catch(() => {});
    return card;
  }

  // ---------- Morgens auf der Projektseite ----------
  window.workflowNightReport = async (main) => {
    let data;
    try { data = await api('/api/nachtschicht'); } catch { return; }
    if (!data.unseen?.length || main.querySelector('.ns-morning')) return;
    const box = el('section', 'ws-waiting ns-morning');
    box.append(el('h2', '', '🌙 Bericht der Nacht-Schicht'));
    for (const run of data.unseen.slice(0, 4)) box.append(runView(run, true));
    box.append(button('Gelesen', 'outline-button', async () => { try { await api('/api/nachtschicht/gelesen', {}); } catch { /* egal */ } box.remove(); if (badge) badge.hidden = true; }));
    main.prepend(box);
  };

  if (area) {
    area.addEventListener('toggle', () => { if (area.open) void render(); else clearTimeout(timer); });
    if (area.open) void render();
    // Auch neu laden, wenn der Bereich schon offen war und erneut gewählt wird
    document.querySelector('[data-bereich-knopf="nacht"]')?.addEventListener('click', () => { if (area.open) void render(); });
  }
  // Zähler in der Seitenleiste: neue Berichte oder läuft gerade
  api('/api/nachtschicht').then(showBadge).catch(() => {});
})();
