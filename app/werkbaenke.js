// Werkbänke (Ausbau 2026-10-23): Neben Worky arbeiten bis zu drei weitere Workys (Worky 2, 3, 4) gleichzeitig an
// anderen Themen, jeder in einer eigenen Kopie des Projekts. Sie sitzen als Reiter oben im Worky-Chat und sehen aus
// wie Worky, nur in eigener Farbe. Die Arbeit macht der Server (werkbaenke.mjs); hier nur Reiter, Chat und Knöpfe.
// Gezeichnet wird nur, was sich geändert hat, damit beim Lesen und Scrollen nichts springt.
(() => {
  const panel = document.querySelector('#claude-chat');
  const project = window.workflowProject || null;
  if (!panel) return;

  const COLORS = ['wk-mint', 'wk-violet', 'wk-rose'];
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  async function api(url, body) {
    const response = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || 'Workflow antwortet gerade nicht.'), { status: response.status });
    return data;
  }
  const button = (label, className, onClick, title) => {
    const node = el('button', className, label);
    node.type = 'button';
    if (title) node.title = title;
    node.addEventListener('click', onClick);
    return node;
  };
  const logo = (color, small) => {
    const node = el('span', `worky-logo ${small ? 'small ' : ''}${color || ''}`);
    node.setAttribute('aria-hidden', 'true');
    node.append(el('i'), el('i'), el('i'));
    return node;
  };
  const markdown = (node, text) => { if (window.IEMarkdown) window.IEMarkdown.renderInto(node, text, []); else node.textContent = text; };
  const toolText = (name) => name.replace(/^mcp__werkstatt_freigabe__.*/, 'wartet auf deine Freigabe').replace(/^Bash$/, 'führt einen Befehl aus').replace(/^(Edit|Write)$/, 'ändert eine Datei')
    .replace(/^(Read|Glob|Grep)$/, 'liest Dateien').replace(/^(Agent|Task)$/, 'fragt einen Spezialisten').replace(/^Skill$/, 'nutzt eine Fähigkeit').replace(/^TodoWrite$|^Task(Create|Update|List|Get)$/, 'plant die Schritte');
  const say = (text) => { if (typeof showToast === 'function') showToast(text); };

  // ---------- Grundgerüst: Reiter oben, eigener Bereich für Worky 2+ ----------
  const tabs = el('div', 'wbk-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Workys');
  panel.prepend(tabs);
  const pane = el('div', 'wbk-pane');
  pane.hidden = true;
  panel.append(pane);

  let data = { available: true, max: 3, benches: [] };
  let active = 'worky'; // 'worky', 'neu' oder die ID einer Werkbank
  const views = new Map(); // ID → { root, messages, key, live, input, footer, head }
  const seen = new Map(); // ID → Anzahl gesehener Nachrichten (für den Punkt am Reiter)
  let timer = null;

  const numberOf = (bench) => data.benches.indexOf(bench) + 2;
  const colorOf = (bench) => COLORS[Math.max(0, data.benches.indexOf(bench)) % COLORS.length];
  const titleOf = (bench) => `Worky ${numberOf(bench)} · ${bench.name}`;

  function select(id) {
    active = id;
    const bench = data.benches.find((item) => item.id === id);
    panel.classList.toggle('wbk-on', id !== 'worky');
    pane.hidden = id === 'worky';
    if (bench) seen.set(bench.id, bench.messages.length);
    renderTabs();
    if (id === 'neu') showNewForm();
    else if (bench) showBench(bench, true);
    if (id === 'worky') document.querySelector('#claude-question')?.focus({ preventScroll: true });
  }

  function renderTabs() {
    const list = [{ id: 'worky', label: 'Worky', sub: 'dein Projektordner', color: '' }];
    for (const bench of data.benches) list.push({ id: bench.id, label: `Worky ${numberOf(bench)}`, sub: bench.name, color: colorOf(bench), bench });
    const nodes = list.map((item) => {
      const tab = button('', `wbk-tab${active === item.id ? ' active' : ''}`, () => select(item.id), item.bench ? `${titleOf(item.bench)} (eigene Kopie, Zweig ${item.bench.branch})` : 'Worky im Projektordner (mit Studio und Blender)');
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(active === item.id));
      const text = el('span', 'wbk-tab-text');
      text.append(el('strong', '', item.label), el('small', '', item.sub));
      tab.append(logo(item.color, true), text);
      const bench = item.bench;
      if (bench?.status === 'arbeitet' || bench?.status === 'laedt') tab.append(el('i', 'wbk-dot busy', ''));
      else if (bench && active !== bench.id && bench.messages.length > (seen.get(bench.id) ?? bench.messages.length)) tab.append(el('i', 'wbk-dot new', ''));
      else if (bench?.prUrl) tab.append(el('i', 'wbk-dot pr', ''));
      return tab;
    });
    if (data.available && data.benches.length < data.max) {
      const add = button('', `wbk-tab wbk-add${active === 'neu' ? ' active' : ''}`, () => select('neu'), 'Noch einen Worky dazuholen, der parallel an etwas anderem arbeitet');
      add.setAttribute('role', 'tab');
      add.append(el('span', 'wbk-plus', '＋'), el('span', 'wbk-tab-text', 'Worky dazu'));
      nodes.push(add);
    }
    tabs.replaceChildren(...nodes);
  }

  // ---------- Neuer Worky ----------
  function showNewForm() {
    views.clear();
    const box = el('div', 'wbk-new');
    const color = COLORS[data.benches.length % COLORS.length];
    const intro = el('div', 'chat-welcome wbk-welcome');
    const copy = el('div');
    copy.append(el('strong', '', `Worky ${data.benches.length + 2} dazuholen`), el('p', '', 'Er arbeitet gleichzeitig mit Worky an einem anderen Thema, in einer eigenen Kopie deines Projekts. Keiner kommt dem anderen in die Quere. Wenn er fertig ist, wird daraus ein Pull Request, den du wie immer testest und mergst.'));
    intro.append(logo(color), copy);
    const form = el('form', 'chat-compose wbk-new-form');
    const nameLabel = el('label', '', 'Woran soll er arbeiten? (kurzer Name)');
    const name = el('input');
    name.maxLength = 30;
    name.placeholder = 'z. B. Höhle, Maschinen, HUD';
    name.id = 'wbk-new-name';
    nameLabel.htmlFor = name.id;
    const taskLabel = el('label', '', 'Erster Auftrag');
    const task = el('textarea');
    task.rows = 4;
    task.maxLength = 6000;
    task.id = 'wbk-new-task';
    task.placeholder = 'So, wie du es Worky schreiben würdest, z. B. „Mach die Höhle größer und bau Stalaktiten an die Decke“';
    taskLabel.htmlFor = task.id;
    const footer = el('div', 'chat-compose-footer');
    const hint = el('span', '', 'Kein Roblox Studio und kein Blender hier (Studio zeigt deinen Projektordner). Worky testet mit den Prüf-Skripten, in Studio testest du den Pull Request. Mehrere Workys verbrauchen dein Claude-Kontingent schneller.');
    const go = el('button', 'primary-button', 'Loslegen ');
    go.append(el('span', '', '→'));
    go.type = 'submit';
    footer.append(hint, go);
    form.append(nameLabel, name, taskLabel, task, footer);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!name.value.trim()) { name.focus(); say('Gib ihm einen kurzen Namen, z. B. „Höhle“.'); return; }
      if (!task.value.trim()) { task.focus(); say('Schreib ihm einen ersten Auftrag.'); return; }
      go.disabled = true;
      const started = Date.now();
      const tick = () => { hint.textContent = `Workflow legt die Kopie deines Projekts an (${Math.round((Date.now() - started) / 1000)} s). Das kann bei großen Projekten ein, zwei Minuten dauern …`; };
      tick();
      const ticker = setInterval(tick, 1000);
      try {
        const before = new Set(data.benches.map((bench) => bench.id));
        data = await api('/api/werkbaenke/anlegen', { projekt: project?.id, name: name.value, auftrag: task.value });
        const created = data.benches.find((bench) => !before.has(bench.id));
        select(created ? created.id : 'worky');
        schedule();
      } catch (error) { hint.textContent = error.message; go.disabled = false; }
      finally { clearInterval(ticker); }
    });
    box.append(intro, form);
    pane.replaceChildren(box);
    name.focus({ preventScroll: true });
  }

  // ---------- Chat eines Workys ----------
  function showBench(bench, fresh) {
    let view = views.get(bench.id);
    if (!view || fresh || !pane.contains(view.root)) view = buildBench(bench);
    updateBench(view, bench);
  }

  function buildBench(bench) {
    views.clear();
    const root = el('div', `wbk-bench ${colorOf(bench)}`);
    const head = el('div', 'chat-header wbk-head');
    const identity = el('div', 'wb-chat-identity');
    const who = el('div', 'wf-chat-who');
    const title = el('h3', '', titleOf(bench));
    const status = el('p', 'wbk-status');
    who.append(title, status);
    identity.append(logo(colorOf(bench)), who);
    const tools = el('div', 'wbk-head-tools');
    head.append(identity, tools);
    const messages = el('div', 'chat-messages wbk-messages');
    messages.setAttribute('role', 'log');
    messages.setAttribute('aria-live', 'polite');
    const form = el('form', 'chat-compose');
    const input = el('textarea');
    input.rows = 3;
    input.maxLength = 6000;
    input.setAttribute('aria-label', `Nachricht an ${titleOf(bench)}`);
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });
    const footer = el('div', 'chat-compose-footer');
    form.append(input, footer);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text || view.bench.status !== 'bereit') return;
      view.send.disabled = true;
      try {
        data = await api('/api/werkbaenke/senden', { id: bench.id, text });
        input.value = '';
        refresh();
        schedule();
      } catch (error) { say(error.message); view.send.disabled = false; }
    });
    root.append(head, messages, form);
    pane.replaceChildren(root);
    const view = { root, head, status, tools, messages, input, footer, key: '', liveNode: null, bench };
    views.set(bench.id, view);
    return view;
  }

  function messageNode(item, bench) {
    if (item.role === 'timo') return el('div', 'chat-message user', item.text);
    const box = el('div', `chat-message worky${item.role === 'fehler' ? ' error' : ''}`);
    const head = el('div', 'worky-head');
    head.append(logo(colorOf(bench), true), el('strong', '', `Worky ${numberOf(bench)}`));
    const body = el('div', 'worky-body');
    if (item.role === 'worky') markdown(body, item.text);
    else body.textContent = item.text;
    box.append(head, body);
    return box;
  }

  function updateBench(view, bench) {
    view.bench = bench;
    const busy = bench.status === 'arbeitet';
    const nearBottom = view.messages.scrollHeight - view.messages.scrollTop - view.messages.clientHeight < 80;
    // Nachrichten nur neu aufbauen, wenn wirklich neue da sind
    const key = bench.messages.map((item) => item.at).join('|');
    if (key !== view.key) {
      view.key = key;
      view.liveNode = null;
      const nodes = bench.messages.map((item) => messageNode(item, bench));
      if (!nodes.length) nodes.push(el('div', 'chat-welcome', 'Noch keine Nachrichten.'));
      view.messages.replaceChildren(...nodes);
    }
    // Live-Antwort: eine Blase, deren Text sich ändert
    if (busy && bench.live) {
      if (!view.liveNode) {
        view.liveNode = el('div', 'chat-message worky thinking');
        const head = el('div', 'worky-head');
        head.append(logo(colorOf(bench), true), el('strong', '', `Worky ${numberOf(bench)}`), el('span', 'wbk-live-tool'));
        view.liveNode.append(head, el('div', 'worky-body'));
        view.messages.append(view.liveNode);
        view.liveText = null;
      }
      view.liveNode.querySelector('.wbk-live-tool').textContent = bench.live.tool ? `${toolText(bench.live.tool)} …` : (bench.live.text ? 'schreibt …' : 'denkt nach …');
      if (bench.live.text !== view.liveText) {
        view.liveText = bench.live.text;
        markdown(view.liveNode.querySelector('.worky-body'), bench.live.text.slice(-6000) || '…');
      }
    } else if (view.liveNode) { view.liveNode.remove(); view.liveNode = null; }
    if (nearBottom || view.firstPaint !== true) { view.messages.scrollTop = view.messages.scrollHeight; view.firstPaint = true; }

    // Kopfzeile: Status, Pull Request, Stopp
    view.status.textContent = busy ? 'arbeitet gerade …' : bench.status === 'laedt' ? 'einen Moment …'
      : bench.prUrl ? (bench.dirty ? 'Pull Request offen · neue Änderungen noch nicht hochgeladen' : 'Pull Request offen · alles hochgeladen') : (bench.dirty ? 'hat Änderungen, noch nicht hochgeladen' : 'bereit');
    view.status.title = `Zweig ${bench.branch} · Kopie ${bench.folder}`;
    const toolNodes = [];
    if (bench.prUrl) {
      const link = el('a', 'outline-button wbk-pr', 'Pull Request ↗');
      link.href = bench.prUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      toolNodes.push(link);
    }
    if (busy) toolNodes.push(button('■ Stopp', 'wf-stop', async () => { try { data = await api('/api/werkbaenke/stoppen', { id: bench.id }); refresh(); } catch (error) { say(error.message); } }));
    else if (bench.status === 'bereit') toolNodes.push(button('🗑', 'tiny-action wbk-trash', () => discard(bench), 'Alles von diesem Worky wegwerfen'));
    view.tools.replaceChildren(...toolNodes);

    // Eingabe und Knöpfe unten
    view.input.disabled = bench.status !== 'bereit';
    view.input.placeholder = busy ? `Worky ${numberOf(bench)} arbeitet gerade …` : (bench.messages.length ? 'Weiter mit diesem Worky, z. B. „mach weiter“ oder eine Änderung …' : `Was soll Worky ${numberOf(bench)} machen?`);
    const hasWork = bench.dirty || Boolean(bench.prUrl) || bench.messages.some((item) => item.role === 'worky');
    const footerKey = [bench.status, bench.dirty, Boolean(bench.prUrl), hasWork].join();
    if (footerKey !== view.footerKey) {
      view.footerKey = footerKey;
      const hint = el('span', '', bench.message || (bench.prUrl ? 'Testen: GitHub Desktop → Fetch origin → Zweig ' + bench.branch + ' → Studio.' : 'Arbeitet in einer eigenen Kopie. Dein Projektordner bleibt unberührt.'));
      const buttons = el('div', 'wbk-actions');
      const ready = bench.status === 'bereit';
      if (ready && (bench.dirty || (!bench.prUrl && hasWork))) {
        buttons.append(button(bench.prUrl ? '⬆ Neues hochladen' : '⬆ Hochladen', 'tiny-action', () => upload(bench), bench.prUrl ? 'Die neuen Änderungen zum Pull Request hochladen, damit du sie testen kannst' : 'Pull Request machen, damit du zwischendurch in Studio testen kannst. Du kannst danach weiter mit ihm arbeiten.'));
      }
      if (ready && hasWork) buttons.append(button('✔ Fertig', 'tiny-action wbk-done', () => done(bench), 'Fertig: alles in den Pull Request hochladen und diesen Worky schließen'));
      view.send = el('button', 'primary-button', 'Senden ');
      view.send.append(el('span', '', '→'));
      view.send.type = 'submit';
      view.send.disabled = !ready;
      buttons.append(view.send);
      view.footer.replaceChildren(hint, buttons);
    }
  }

  // ---------- Hochladen, Fertig, Wegwerfen ----------
  async function upload(bench) {
    say('Wird hochgeladen …');
    try { data = await api('/api/werkbaenke/fertig', { id: bench.id }); refresh(); say('Hochgeladen. Der Pull Request ist auf GitHub.'); } catch (error) { say(error.message); refresh(); }
  }

  async function done(bench) {
    const label = titleOf(bench);
    const needsUpload = bench.dirty || (!bench.prUrl && bench.messages.some((item) => item.role === 'worky'));
    if (!confirm(`Fertig mit ${label}?\n\n${needsUpload ? 'Workflow lädt alles in den Pull Request hoch und schließt diesen Worky.' : 'Alles ist schon im Pull Request. Workflow schließt diesen Worky.'}\n\nEs geht nichts verloren: Dein Projekt und der Pull Request bleiben. Weggeräumt wird nur die Arbeitskopie neben deinem Projekt.`)) return;
    try {
      if (needsUpload) {
        say('Wird hochgeladen …');
        try { data = await api('/api/werkbaenke/fertig', { id: bench.id }); } catch (error) {
          // Nichts geändert: dann gibt es auch nichts hochzuladen, einfach schließen
          if (!/nichts geändert/.test(error.message)) throw error;
        }
      }
      data = await api('/api/werkbaenke/wegraeumen', { id: bench.id });
      select('worky');
      say(`${label} ist fertig.`);
    } catch (error) { say(error.message); refresh(); }
  }

  async function discard(bench) {
    if (!confirm(`Alles von ${titleOf(bench)} wegwerfen?\n\nÄnderungen, die noch nicht hochgeladen sind, gehen verloren. Ein schon angelegter Pull Request bleibt auf GitHub.`)) return;
    try { data = await api('/api/werkbaenke/wegraeumen', { id: bench.id, sicher: true }); select('worky'); } catch (error) { say(error.message); }
  }

  // ---------- Neu laden ----------
  function refresh() {
    if (active !== 'worky' && active !== 'neu' && !data.benches.some((bench) => bench.id === active)) { select('worky'); return; }
    renderTabs();
    const bench = data.benches.find((item) => item.id === active);
    if (bench) { seen.set(bench.id, bench.messages.length); showBench(bench, false); }
  }
  async function poll() {
    try { data = await api(`/api/werkbaenke?projekt=${encodeURIComponent(project?.id || '')}`); } catch { schedule(); return; }
    if (!data.available) { tabs.hidden = true; return; }
    for (const bench of data.benches) if (!seen.has(bench.id)) seen.set(bench.id, bench.messages.length);
    refresh();
    schedule();
  }
  function schedule() {
    clearTimeout(timer);
    const busy = data.benches.some((bench) => bench.status !== 'bereit');
    timer = setTimeout(poll, busy ? 2500 : 15_000);
  }
  renderTabs();
  void poll();
})();
