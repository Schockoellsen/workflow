// Ideen-Starthilfe (Ausbau 2026-10-23): Kasten oben unter „Ideen“. Zeigt, was Worky zum Projekt gesammelt hat
// (ähnliche Spiele, erste Schritte, weitere Ideen, Start-Prompts, Fragen). Ideen kommen per Klick auf den Parkplatz,
// Start-Prompts per Klick ins Worky-Eingabefeld. Server: /api/starthilfe (starthilfe.mjs).
(() => {
  const root = document.querySelector('#starthilfe');
  const fill = document.querySelector('#starthilfe-fill');
  const area = root?.closest('details');
  if (!root || !fill || !window.workflowProject) return;
  const OPEN_KEY = 'workflow-starthilfe-oeffnen';

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (label, className, onClick) => {
    const node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  };
  async function api(url, body) {
    const response = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Workflow antwortet gerade nicht.');
    return data;
  }

  let state = { status: 'leer' };
  let timer = null;
  let editing = false;

  // Eingabe „Worum geht's?“ mit Knopf zum Sammeln
  function askBox(label, value) {
    const box = el('div', 'sh-ask');
    const input = el('textarea');
    input.rows = 2;
    input.maxLength = 600;
    input.value = value || '';
    input.placeholder = 'z. B. Ein Spiel, in dem man eine kleine Pizzeria zu einer Kette ausbaut';
    input.setAttribute('aria-label', 'Worum geht es in deinem Spiel?');
    const say = el('p', 'wz-hint');
    const go = button(label, 'primary-button', async () => {
      if (!input.value.trim()) { input.focus(); say.textContent = 'Schreib kurz, worum es gehen soll.'; return; }
      go.disabled = true;
      try {
        state = await api('/api/starthilfe/sammeln', { wunsch: input.value });
        editing = false;
        render();
        poll();
      } catch (error) { say.textContent = error.message; go.disabled = false; }
    });
    const actions = el('div', 'wz-actions');
    actions.append(go);
    box.append(input, actions, say);
    return box;
  }

  function section(title, hint) {
    const node = el('section', 'sh-block');
    node.append(el('h4', '', title));
    if (hint) node.append(el('p', 'wz-hint', hint));
    return node;
  }

  function renderResult(result) {
    const parts = [];
    if (result.kurz) parts.push(el('p', 'sh-lead', result.kurz));
    if (result.aehnlich?.length) {
      const block = section('🎮 Ähnliche Spiele', 'Aus Workys Wissen, nicht live im Internet gesucht. Schau sie dir an und klau gute Ideen.');
      const list = el('ul', 'sh-list');
      for (const item of result.aehnlich) {
        const li = el('li');
        li.append(el('strong', '', item.name), el('span', '', item.was));
        if (item.abgucken) li.append(el('em', '', `Abgucken: ${item.abgucken}`));
        list.append(li);
      }
      block.append(list);
      parts.push(block);
    }
    if (result.schritte?.length) {
      const block = section('🪜 So gehst du es an');
      const list = el('ol', 'sh-list');
      for (const item of result.schritte) {
        const li = el('li');
        li.append(el('strong', '', item.titel), el('span', '', item.text));
        list.append(li);
      }
      block.append(list);
      parts.push(block);
    }
    if (result.prompts?.length) {
      const block = section('🚀 Start-Prompts', 'Klick einen an, dann steht er fertig im Worky-Feld. Du kannst ihn noch anpassen und schickst ihn selbst ab.');
      const row = el('div', 'sh-prompts');
      for (const item of result.prompts) {
        const node = button('', 'sh-prompt', () => { fill.dataset.fill = item.prompt; fill.click(); });
        node.title = item.prompt;
        node.append(el('strong', '', item.titel), el('small', '', item.prompt));
        row.append(node);
      }
      block.append(row);
      parts.push(block);
    }
    if (result.ideen?.length) {
      const block = section('💡 Weitere Ideen', 'Gefällt dir eine, leg sie mit ＋ auf deinen Ideen-Parkplatz. Sie wird dadurch noch keine Aufgabe.');
      const list = el('ul', 'sh-list sh-ideas');
      for (const item of result.ideen) {
        const li = el('li');
        const text = el('div');
        text.append(el('strong', '', item.titel), el('span', '', item.text));
        const add = button('＋ Als Idee merken', 'tiny-action', () => {
          if (window.workflowAddIdea?.(item.titel, item.text)) { add.textContent = '✓ Gemerkt'; add.disabled = true; }
        });
        li.append(text, add);
        list.append(li);
      }
      block.append(list);
      parts.push(block);
    }
    if (result.fragen?.length) {
      const block = section('🤔 Fragen zum Nachdenken');
      const list = el('ul', 'sh-list');
      for (const item of result.fragen) list.append(el('li', '', item));
      block.append(list);
      parts.push(block);
    }
    return parts;
  }

  function render() {
    const card = el('section', 'wz-card sh-card');
    const head = el('div', 'sh-head');
    head.append(el('h3', '', '✨ Starthilfe von Worky'));
    card.append(head);

    if (state.status === 'laeuft') {
      const wait = el('div', 'sh-wait');
      wait.append(el('span', 'pulse-dot'), el('span', '', `Worky sammelt gerade Ideen zu „${state.wish}“ … das dauert meist ein bis zwei Minuten. Du kannst schon im Chat loslegen.`));
      card.append(wait);
    }
    if (state.status === 'leer') {
      card.append(el('p', 'wz-hint', 'Schreib grob, worum es in deinem Spiel gehen soll. Worky sammelt dann ähnliche Spiele zum Anschauen, erste Bau-Schritte, weitere Ideen und fertige Start-Prompts.'));
      card.append(askBox('✨ Ideen sammeln', state.description));
    }
    if (state.error) card.append(el('p', 'wz-bad', `Das hat nicht geklappt: ${state.error}`));
    if (state.status === 'fehler') card.append(askBox('Nochmal versuchen', state.wish || state.description));

    if (state.result) {
      if (state.wish) card.append(el('p', 'wz-hint', `Zu: „${state.wish}“${state.at ? ` · ${new Date(state.at).toLocaleDateString('de-DE')}` : ''}${state.note ? ` · steht auch im Tresor unter ${state.note}` : ''}`));
      card.append(...renderResult(state.result));
      if (state.status === 'fertig') {
        if (editing) card.append(askBox('✨ Neue Ideen sammeln', state.wish || state.description));
        else {
          const actions = el('div', 'wz-actions');
          actions.append(button('↻ Neue Ideen sammeln', 'outline-button', () => { editing = true; render(); }));
          card.append(actions);
        }
      }
    }
    root.replaceChildren(card);
  }

  async function load() {
    try { state = await api('/api/starthilfe'); } catch (error) { state = { status: 'fehler', error: error.message }; }
    render();
    if (state.status === 'laeuft') poll();
  }
  function poll() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const before = state.status;
      await load();
      if (before === 'laeuft' && state.status === 'fertig' && area && !area.open) area.open = true;
    }, 4000);
  }

  // Direkt nach „Projekt anlegen“: Ideen-Bereich aufklappen, damit man die Starthilfe kommen sieht
  let openNow = false;
  try { openNow = sessionStorage.getItem(OPEN_KEY) === '1'; sessionStorage.removeItem(OPEN_KEY); } catch { /* privates Fenster */ }
  if (openNow && window.workflowShowArea) window.workflowShowArea('ideen');
  void load();
})();
