// Workflow Paket 2: animierter Startbildschirm und Projektseite.
// Beim ersten Öffnen im Browser-Fenster läuft der Start (Logo, Ladebalken mit echten Prüfungen), danach kommt die
// Projektseite. Nach einem Projektwechsel (Seite lädt neu) geht es direkt an den Arbeitsplatz.
(() => {
  const SEEN_KEY = 'workflow-start-gesehen';
  const project = window.workflowProject || null;
  const LOGO = '<path d="M30 92 C 70 92, 70 40, 110 40 S 150 92, 190 92" fill="none" stroke="#7b7ff0" stroke-width="12" stroke-linecap="round"/><circle cx="30" cy="92" r="20" fill="#5b5fd6"/><circle cx="110" cy="40" r="22" fill="currentColor"/><circle cx="190" cy="92" r="20" fill="#14b3a5"/>';
  // Bild oben auf der Projektkarte je nach Art (nur Formen, keine Fremd-Bilder)
  const ART = {
    roblox: '<rect width="360" height="150" fill="#1b1f3a"/><path d="M0 118 H360" stroke="#2b3060" stroke-width="2"/><rect x="40" y="62" width="70" height="56" rx="4" fill="#3a3f78"/><rect x="58" y="30" width="14" height="34" fill="#4a4f8f"/><rect x="130" y="48" width="90" height="70" rx="4" fill="#5b5fd6"/><rect x="146" y="64" width="22" height="16" rx="2" fill="#ffcf6b"/><rect x="180" y="64" width="22" height="16" rx="2" fill="#ffcf6b"/><rect x="240" y="72" width="80" height="46" rx="4" fill="#14b3a5"/><circle cx="66" cy="22" r="8" fill="#5c6199" opacity=".7"/><circle cx="76" cy="12" r="6" fill="#5c6199" opacity=".5"/>',
    web: '<rect width="360" height="150" fill="#0f2a33"/><rect x="60" y="22" width="240" height="110" rx="10" fill="#14404c"/><rect x="60" y="22" width="240" height="18" rx="9" fill="#1d5866"/><circle cx="74" cy="31" r="3" fill="#2fd3c2"/><circle cx="85" cy="31" r="3" fill="#7b7ff0"/><circle cx="96" cy="31" r="3" fill="#ffcf6b"/><rect x="84" y="96" width="40" height="12" rx="3" fill="#2fd3c2"/><circle cx="104" cy="84" r="8" fill="#ffcf6b"/><rect x="170" y="70" width="60" height="38" rx="4" fill="#7b7ff0"/><rect x="246" y="86" width="30" height="22" rx="3" fill="#2fd3c2"/>',
    godot: '<rect width="360" height="150" fill="#1b2a3f"/><circle cx="180" cy="78" r="44" fill="#478cbf"/><circle cx="164" cy="74" r="10" fill="#fff"/><circle cx="196" cy="74" r="10" fill="#fff"/><circle cx="164" cy="75" r="5" fill="#1b2a3f"/><circle cx="196" cy="75" r="5" fill="#1b2a3f"/><rect x="160" y="96" width="40" height="8" rx="4" fill="#d6ecff"/>',
    unity: '<rect width="360" height="150" fill="#1d1f24"/><path d="M180 30 L224 55 L224 105 L180 130 L136 105 L136 55 Z" fill="none" stroke="#e8eaf4" stroke-width="6" stroke-linejoin="round"/><path d="M180 80 L224 55 M180 80 L136 55 M180 80 L180 130" stroke="#e8eaf4" stroke-width="6"/>',
    andere: '<rect width="360" height="150" fill="#22253f"/><rect x="70" y="40" width="70" height="70" rx="16" fill="#5b5fd6"/><circle cx="190" cy="75" r="35" fill="#2fd3c2"/><path d="M250 110 L290 40 L330 110 Z" fill="#ffcf6b"/>'
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const svg = (markup, viewBox, width, height, label) => {
    const wrap = document.createElement('span');
    wrap.innerHTML = `<svg viewBox="${viewBox}" width="${width}" height="${height}" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${markup}</svg>`;
    return wrap.firstChild;
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function getJson(url, timeoutMs) {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.json();
  }

  let seen = false;
  try { seen = sessionStorage.getItem(SEEN_KEY) === '1'; } catch { /* privates Fenster: Start jedes Mal */ }
  const markSeen = () => { try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* egal */ } };

  function leave(layer, then) {
    layer.classList.add('ws-leaving');
    setTimeout(() => { layer.remove(); then?.(); }, 450);
  }

  // ---------- Startbildschirm ----------
  function showSplash() {
    const layer = el('div', 'ws-layer ws-splash');
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-label', 'Workflow startet');
    layer.append(el('div', 'ws-dots'), el('div', 'ws-glow ws-glow-a'), el('div', 'ws-glow ws-glow-b'));
    const center = el('div', 'ws-center');
    center.append(svg(
      '<path class="ws-line" d="M30 92 C 70 92, 70 40, 110 40 S 150 92, 190 92" fill="none" stroke="#7b7ff0" stroke-width="6" stroke-linecap="round"/>' +
      '<circle class="ws-node ws-n1" cx="30" cy="92" r="14" fill="#5b5fd6"/><circle class="ws-node ws-n2" cx="110" cy="40" r="17" fill="#eef0ff"/>' +
      '<circle class="ws-node ws-n3" cx="190" cy="92" r="14" fill="#2fd3c2"/><circle class="ws-spark" r="5" fill="#2fd3c2"/>',
      '0 0 220 132', 220, 132, 'Workflow-Zeichen: drei Punkte, verbunden durch eine fließende Linie'));
    const word = el('h1', 'ws-word');
    [...'Workflow'].forEach((letter, index) => {
      const span = el('span', index >= 6 ? 'ws-m' : index >= 4 ? 'ws-i' : '', letter);
      span.style.animationDelay = `${1 + index * 0.06}s`;
      word.append(span);
    });
    const tag = el('p', 'ws-tag', 'Sag, was du bauen willst. Worky baut es mit dir.');
    const load = el('div', 'ws-load');
    const track = el('div', 'ws-track');
    const bar = el('div', 'ws-bar');
    track.append(bar);
    const step = el('div', 'ws-step');
    step.setAttribute('aria-live', 'polite');
    load.append(track, step);
    const go = el('div', 'ws-go');
    const button = el('button', 'ws-go-btn', 'Los geht’s');
    button.type = 'button';
    button.append(svg('<path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>', '0 0 24 24', 18, 18));
    go.append(button, el('span', 'ws-note', 'Läuft lokal auf deinem PC'));
    center.append(word, tag, load, go);
    layer.append(center);
    document.body.append(layer);

    const setStep = (text, percent, ready = false) => { step.textContent = text; bar.style.width = `${percent}%`; step.classList.toggle('ws-ready', ready); };
    let projects = null;
    (async () => {
      await wait(2100);
      setStep('Projekte werden geladen', 20);
      const minimum = wait(900);
      try { projects = await getJson('/api/projekte', 5000); } catch { projects = null; }
      await minimum;
      setStep('Worky wacht auf und prüft die Anmeldung', 55);
      const minimum2 = wait(900);
      let auth = null;
      try { auth = await getJson('/api/status', 20_000); } catch { auth = null; }
      await minimum2;
      const count = projects?.projects?.length || 0;
      setStep(`${count === 1 ? '1 Projekt' : `${count} Projekte`} gefunden · ${auth?.ready ? 'Claude angemeldet' : 'Claude noch nicht angemeldet'}`, 85);
      await wait(800);
      setStep('Alles bereit', 100, true);
      go.classList.add('ws-show');
      button.focus();
    })();
    button.addEventListener('click', () => {
      markSeen();
      leave(layer, () => showProjects(projects));
    });
  }

  // ---------- Projektseite ----------
  async function showProjects(preloaded) {
    let data = preloaded;
    if (!data) { try { data = await getJson('/api/projekte', 5000); } catch { data = { projects: [], active: null }; } }
    document.querySelector('.ws-projects')?.remove();
    const layer = el('div', 'ws-layer ws-projects');
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-label', 'Projekt wählen');
    const head = el('header', 'ws-head');
    const brand = el('div', 'ws-brand');
    brand.append(svg(LOGO, '0 0 220 132', 40, 26), el('span', '', 'Workflow'));
    head.append(brand);
    if (project) {
      const back = el('button', 'quiet-button', `Weiter mit ${project.name} →`);
      back.type = 'button';
      back.addEventListener('click', () => leave(layer));
      head.append(back);
    }
    const main = el('main', 'ws-main');
    const hello = el('div', 'ws-hello');
    const titles = el('div');
    titles.append(el('small', '', 'Hey Timo'), el('h1', '', 'Woran bauen wir heute?'));
    const search = el('label', 'ws-search');
    search.append(svg('<circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>', '0 0 24 24', 18, 18));
    const input = el('input');
    input.type = 'search';
    input.placeholder = 'Projekt suchen';
    input.setAttribute('aria-label', 'Projekt suchen');
    search.append(input);
    hello.append(titles, search);
    const grid = el('div', 'ws-grid');
    main.append(hello, grid);
    layer.append(head, main);
    document.body.append(layer);

    const cards = [];
    (data.projects || []).forEach((item, index) => {
      const card = el('button', 'ws-card');
      card.type = 'button';
      card.style.animationDelay = `${index * 0.06}s`;
      card.disabled = !item.available;
      if (item.id === data.active) card.setAttribute('aria-current', 'true');
      const art = el('div', 'ws-art');
      const picture = svg(ART[item.kind] || ART.andere, '0 0 360 150', '100%', 150);
      picture.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      art.append(picture, el('span', 'ws-badge', item.kindLabel));
      const body = el('div', 'ws-body');
      body.append(el('h2', '', item.name));
      if (item.description) body.append(el('p', '', item.description));
      body.append(el('span', 'ws-folder', item.root));
      const chips = el('div', 'ws-chips');
      if (item.id === data.active) chips.append(el('span', 'ws-chip ws-mint', 'Zuletzt offen'));
      if (!item.available) chips.append(el('span', 'ws-chip', 'Ordner fehlt'));
      if (chips.childElementCount) body.append(chips);
      card.append(art, body);
      card.addEventListener('click', async () => {
        if (item.id === data.active && project) { leave(layer); return; }
        try {
          const response = await fetch('/api/projekte/waehlen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id }) });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || 'Wechsel hat nicht geklappt.');
          markSeen();
          location.reload();
        } catch (error) { alert(error.message); }
      });
      cards.push({ card, text: `${item.name} ${item.kindLabel} ${item.description || ''}`.toLocaleLowerCase('de') });
      grid.append(card);
    });

    const plusIcon = () => svg('<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>', '0 0 24 24', 26, 26);
    const folderIcon = () => svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>', '0 0 24 24', 24, 24);
    const add = el('button', 'ws-card ws-new');
    add.type = 'button';
    add.style.animationDelay = `${cards.length * 0.06}s`;
    const plus = el('span', 'ws-plus');
    plus.append(plusIcon());
    add.append(plus, el('strong', '', 'Neues Projekt'), el('span', '', 'Name, Spielart und eine kurze Beschreibung. Workflow legt Ordner, Startdateien, Regeln und Tresor an.'));
    add.addEventListener('click', () => window.workflowNewProject?.());
    const open = el('button', 'ws-card ws-new ws-open');
    open.type = 'button';
    open.style.animationDelay = `${(cards.length + 1) * 0.06}s`;
    const folder = el('span', 'ws-plus ws-plus-soft');
    folder.append(folderIcon());
    open.append(folder, el('strong', '', 'Ordner öffnen'), el('span', '', 'Ein Spiel, das schon auf deinem PC liegt, zu Workflow holen.'));
    open.addEventListener('click', () => window.workflowOpenProjects?.(true));
    grid.append(add, open);

    input.addEventListener('input', () => {
      const query = input.value.trim().toLocaleLowerCase('de');
      for (const { card, text } of cards) card.hidden = Boolean(query) && !text.includes(query);
    });
    (grid.querySelector('.ws-card:not(:disabled)') || add).focus({ preventScroll: true });
  }

  // „Alle Projekte“ oben in der Seitenleiste führt zurück zur Projektseite
  for (const element of document.querySelectorAll('[data-alle-projekte]')) element.addEventListener('click', (event) => { event.preventDefault(); void showProjects(); });

  if (!seen) showSplash();
  else if (!project) void showProjects();
})();
