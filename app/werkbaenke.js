// Werkbänke (Ausbau 2026-10-23): bis zu drei Worky-Aufträge gleichzeitig, jeder in einer eigenen Kopie des Projekts
// mit eigenem Chat. Die Arbeit macht der Server (werkbaenke.mjs); hier nur Anzeige, Chat und Knöpfe.
(() => {
  const area = document.querySelector('details[data-bereich="werkbaenke"]');
  const root = document.querySelector('#werkbaenke');
  const badge = document.querySelector('#bench-count');
  const project = window.workflowProject || null;
  if (!root) return;

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
  const button = (label, className, onClick) => {
    const node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  };
  const link = (href, text) => {
    const node = el('a', '', text);
    node.href = href;
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
    return node;
  };
  const markdown = (node, text) => { if (window.IEMarkdown) window.IEMarkdown.renderInto(node, text, []); else node.textContent = text; };
  const toolText = (name) => name.replace(/^mcp__werkstatt_freigabe__.*/, 'wartet auf deine Freigabe').replace(/^Bash$/, 'führt einen Befehl aus').replace(/^(Edit|Write)$/, 'ändert eine Datei')
    .replace(/^(Read|Glob|Grep)$/, 'liest Dateien').replace(/^(Agent|Task)$/, 'fragt einen Spezialisten').replace(/^Skill$/, 'nutzt eine Fähigkeit').replace(/^TodoWrite$|^Task(Create|Update)$/, 'plant die Schritte');

  const drafts = new Map(); // angefangene Nachrichten je Werkbank, damit das Neu-Zeichnen nichts löscht
  const openLogs = new Set();
  let timer = null;
  let last = null;

  function showBadge(data) {
    if (!badge) return;
    const busy = data.benches.filter((bench) => bench.status === 'arbeitet').length;
    badge.hidden = !data.benches.length;
    badge.textContent = busy ? `⏳${busy}` : String(data.benches.length);
    badge.title = busy ? `${busy} ${busy === 1 ? 'Werkbank arbeitet' : 'Werkbänke arbeiten'} gerade` : `${data.benches.length} offene ${data.benches.length === 1 ? 'Werkbank' : 'Werkbänke'}`;
  }

  async function render() {
    let data;
    try { data = await api(`/api/werkbaenke?projekt=${encodeURIComponent(project?.id || '')}`); } catch (error) { root.replaceChildren(el('p', 'wz-bad', error.message)); return; }
    last = data;
    showBadge(data);
    if (!data.available) { root.replaceChildren(el('p', 'wz-hint', 'Die Testkopie hat keine Werkbänke.')); return; }
    // Fokus und Cursor im Eingabefeld behalten, während neu gezeichnet wird
    const focused = document.activeElement?.closest?.('.wbk-bench')?.dataset.id;
    const caret = document.activeElement?.selectionStart;
    root.replaceChildren(...data.benches.map(benchCard), ...(data.benches.length < data.max ? [newCard(data)] : []), helpCard());
    if (focused) {
      const input = root.querySelector(`.wbk-bench[data-id="${focused}"] textarea`);
      if (input) { input.focus({ preventScroll: true }); if (typeof caret === 'number') input.setSelectionRange(caret, caret); }
    }
    clearTimeout(timer);
    const busy = data.benches.some((bench) => bench.status !== 'bereit');
    if (area?.open) timer = setTimeout(render, busy ? 2500 : 20_000);
  }

  function benchCard(bench) {
    const card = el('section', 'wz-card wbk-bench');
    card.dataset.id = bench.id;
    const head = el('div', 'wbk-bench-head');
    const state = { arbeitet: '⏳ arbeitet', laedt: '⏳ einen Moment …', bereit: bench.prUrl ? '✅ PR offen' : '● bereit' }[bench.status] || bench.status;
    head.append(el('h3', '', bench.name), el('span', `wbk-state wbk-${bench.status}`, state));
    if (bench.prUrl) head.append(link(bench.prUrl, 'Pull Request →'));
    const copy = el('p', 'wz-hint', `Zweig ${bench.branch} · Ordner ${bench.folder.split(/[\\/]/).pop()} neben deinem Projekt`);
    copy.title = bench.folder;
    card.append(head, copy);
    if (bench.message) card.append(el('p', 'wz-hint', bench.message));

    // Verlauf: ältere Nachrichten eingeklappt, die letzten offen
    const log = el('div', 'wbk-log');
    const messages = bench.messages;
    const older = messages.slice(0, -2);
    if (older.length) {
      const more = el('details', 'wbk-older');
      more.open = openLogs.has(bench.id);
      more.addEventListener('toggle', () => { if (more.open) openLogs.add(bench.id); else openLogs.delete(bench.id); });
      more.append(el('summary', '', `${older.length} ältere ${older.length === 1 ? 'Nachricht' : 'Nachrichten'}`));
      for (const item of older) more.append(messageView(item));
      log.append(more);
    }
    for (const item of messages.slice(-2)) log.append(messageView(item));
    if (bench.live) {
      const now = el('div', 'wbk-msg wb-worky wb-live');
      now.append(el('small', '', bench.live.tool ? `Worky ${toolText(bench.live.tool)} …` : 'Worky schreibt …'));
      const body = el('div', 'wbk-text');
      markdown(body, bench.live.text.slice(-4000) || '…');
      now.append(body);
      log.append(now);
    }
    if (messages.length || bench.live) card.append(log);

    // Eingabe und Knöpfe
    const form = el('form', 'ns-add');
    const input = el('textarea');
    input.rows = 2;
    input.maxLength = 6000;
    input.placeholder = bench.status === 'arbeitet' ? 'Worky arbeitet gerade …' : (messages.length ? 'Weiter an dieser Werkbank, z. B. „mach weiter“ oder eine Änderung' : `Was soll Worky an „${bench.name}“ machen?`);
    input.value = drafts.get(bench.id) || '';
    input.disabled = bench.status !== 'bereit';
    input.setAttribute('aria-label', `Nachricht an die Werkbank ${bench.name}`);
    input.addEventListener('input', () => drafts.set(bench.id, input.value));
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });
    const say = el('p', 'wz-hint');
    const actions = el('div', 'wz-actions');
    const sendButton = el('button', 'primary-button', 'Senden');
    sendButton.type = 'submit';
    sendButton.disabled = bench.status !== 'bereit';
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!input.value.trim()) return;
      sendButton.disabled = true;
      try { await api('/api/werkbaenke/senden', { id: bench.id, text: input.value }); drafts.delete(bench.id); await render(); } catch (error) { say.textContent = error.message; sendButton.disabled = false; }
    });
    actions.append(sendButton);
    if (bench.status === 'arbeitet') {
      actions.append(button('■ Stopp', 'outline-button', async () => { try { await api('/api/werkbaenke/stoppen', { id: bench.id }); await render(); } catch (error) { say.textContent = error.message; } }));
    }
    if (bench.status === 'bereit' && messages.some((item) => item.role === 'worky')) {
      const done = button(bench.prUrl ? '⬆ Neues hochladen' : '✔ Fertig → Pull Request', 'outline-button', async () => {
        if (!confirm(bench.prUrl ? 'Neue Änderungen dieser Werkbank committen und zum Pull Request hochladen?' : 'Fertig? Workflow committet die Änderungen dieser Werkbank, lädt den Zweig zu GitHub hoch und legt einen Pull Request an. Du kannst danach trotzdem weiter an der Werkbank arbeiten.')) return;
        done.disabled = true;
        say.textContent = 'Wird hochgeladen …';
        try { await api('/api/werkbaenke/fertig', { id: bench.id }); say.textContent = ''; await render(); } catch (error) { say.textContent = error.message; done.disabled = false; }
      });
      actions.append(done);
    }
    if (bench.status === 'bereit') {
      actions.append(button('Wegräumen', 'tiny-action delete', async () => {
        if (!confirm(`Werkbank „${bench.name}“ wegräumen? Der Ordner neben deinem Projekt wird gelöscht. Was hochgeladen ist, bleibt auf GitHub (Zweig und Pull Request).`)) return;
        try { await api('/api/werkbaenke/wegraeumen', { id: bench.id }); await render(); } catch (error) {
          if (error.status === 428 && confirm(`${error.message}\n\nTrotzdem wegräumen? Die nicht hochgeladenen Änderungen sind dann weg.`)) {
            try { await api('/api/werkbaenke/wegraeumen', { id: bench.id, sicher: true }); await render(); } catch (again) { say.textContent = again.message; }
          } else say.textContent = error.message;
        }
      }));
    }
    form.append(input, actions);
    card.append(form, say);
    return card;
  }

  function messageView(item) {
    const box = el('div', `wbk-msg wbk-${item.role}`);
    box.append(el('small', '', { timo: 'Du', worky: 'Worky', fehler: 'Problem' }[item.role] || item.role));
    const body = el('div', 'wbk-text');
    if (item.role === 'worky') markdown(body, item.text);
    else body.textContent = item.text;
    box.append(body);
    return box;
  }

  function newCard(data) {
    const card = el('section', 'wz-card');
    card.append(el('h3', '', 'Neue Werkbank'));
    card.append(el('p', 'wz-hint', `Eine Werkbank pro Thema, z. B. „Höhle“, „Maschinen“, „HUD“. Noch ${data.max - data.benches.length} von ${data.max} frei.`));
    const form = el('form', 'ns-add');
    const name = el('input');
    name.maxLength = 30;
    name.placeholder = 'Name, z. B. Höhle';
    name.setAttribute('aria-label', 'Name der Werkbank');
    const task = el('textarea');
    task.rows = 3;
    task.maxLength = 6000;
    task.placeholder = 'Erster Auftrag (so wie du ihn Worky im Chat schreiben würdest)';
    task.setAttribute('aria-label', 'Erster Auftrag für die Werkbank');
    const go = el('button', 'primary-button', '＋ Werkbank anlegen und starten');
    go.type = 'submit';
    const say = el('p', 'wz-hint');
    form.append(name, task, go);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!name.value.trim()) { say.textContent = 'Gib der Werkbank einen Namen.'; return; }
      go.disabled = true;
      say.textContent = 'Workflow legt die Kopie des Projekts an (das kann bei großen Projekten eine Minute dauern) …';
      try { await api('/api/werkbaenke/anlegen', { projekt: project?.id, name: name.value, auftrag: task.value }); await render(); } catch (error) { say.textContent = error.message; go.disabled = false; }
    });
    card.append(form, say);
    return card;
  }

  function helpCard() {
    const card = el('section', 'wz-card');
    card.append(el('h3', '', 'So funktioniert’s'));
    const list = el('ol', 'ns-list');
    for (const line of [
      'Jede Werkbank ist eine eigene Kopie deines Projekts neben deinem Ordner, mit eigenem Zweig. Die Werkbänke kommen sich nicht in die Quere, dein Projektordner bleibt unberührt.',
      'Worky testet dort mit den Prüf-Skripten und Lune, aber ohne Roblox Studio und Blender (Studio zeigt immer deinen Projektordner).',
      'Ist ein Thema fertig: „Fertig → Pull Request“. Dann in GitHub Desktop „Fetch origin“, auf den Zweig wechseln, in Studio testen und „merge“ sagen.',
      'Nach dem letzten Merge alles zusammen in Studio anschauen. Haben zwei Werkbänke dieselbe Datei geändert, meldet GitHub einen Konflikt.',
      'Drei Werkbänke gleichzeitig verbrauchen dein Claude-Kontingent etwa dreimal so schnell.'
    ]) list.append(el('li', 'ns-task', line));
    card.append(list);
    return card;
  }

  if (area) {
    area.addEventListener('toggle', () => { if (area.open) void render(); else clearTimeout(timer); });
    if (area.open) void render();
    document.querySelector('[data-bereich-knopf="werkbaenke"]')?.addEventListener('click', () => { if (area.open) void render(); });
  }
  // Zähler in der Seitenleiste, auch wenn der Bereich zu ist (alle 30 Sekunden)
  const poll = () => api(`/api/werkbaenke?projekt=${encodeURIComponent(project?.id || '')}`).then(showBadge).catch(() => {});
  void poll();
  setInterval(() => { if (!area?.open) void poll(); }, 30_000);
  window.workflowBenches = { render, last: () => last };
})();
