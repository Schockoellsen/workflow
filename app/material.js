// Material-Ordner (Ausbau 2026-10-22): Bilder, Modelle und Sounds des Projekts mit Vorschau. Dateien hineinziehen,
// eine kurze Beschreibung dazuschreiben (die liest Worky mit) und mit „An Worky“ direkt in einen Auftrag geben.
(() => {
  const area = document.querySelector('details[data-bereich="material"]');
  const root = document.querySelector('#material');
  const fill = document.querySelector('#material-fill');
  if (!area || !root || !window.workflowProject) return;

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
  const size = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const ICONS = { bilder: '🖼️', modelle: '🧊', sounds: '🔊', texte: '📄', sonstiges: '📦' };
  const FILTERS = [['', 'Alle'], ['bilder', 'Bilder'], ['modelle', 'Modelle'], ['sounds', 'Sounds'], ['texte', 'Texte'], ['sonstiges', 'Sonstiges']];
  let filter = '';
  let files = [];

  // Kopf: Hineinziehen, Ordner öffnen, Filter
  const say = el('p', 'wz-hint');
  const input = el('input');
  input.type = 'file';
  input.multiple = true;
  input.hidden = true;
  const drop = el('button', 'mt-drop');
  drop.type = 'button';
  drop.append(el('strong', '', 'Dateien hierher ziehen'), el('span', '', 'oder klicken zum Auswählen · Bilder, Modelle (.fbx .obj .glb .blend …), Sounds, Texte · bis 100 MB'));
  drop.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { void upload([...input.files]); input.value = ''; });
  for (const name of ['dragenter', 'dragover']) drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.add('over'); });
  for (const name of ['dragleave', 'drop']) drop.addEventListener(name, () => drop.classList.remove('over'));
  drop.addEventListener('drop', (event) => { event.preventDefault(); void upload([...(event.dataTransfer?.files || [])]); });
  const openFolder = button('Ordner öffnen', 'outline-button', async () => {
    try {
      const result = await api('/api/material/ordner', {});
      say.textContent = result.opened ? 'Der Ordner ist im Explorer offen.' : `Der Ordner liegt hier: ${result.folder}`;
    } catch (error) { say.textContent = error.message; }
  });
  const chips = el('div', 'mt-filter');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Nach Art filtern');
  for (const [value, label] of FILTERS) {
    const chip = button(label, 'mt-chip', () => { filter = value; renderGrid(); });
    chip.dataset.value = value;
    chips.append(chip);
  }
  const grid = el('div', 'mt-grid');
  const intro = el('p', 'wz-hint', 'Alles, was du für dieses Spiel sammelst, an einem Ort: im Ordner material/ deines Projekts. Worky sieht die Liste samt deiner Beschreibungen und nimmt passendes Material, statt etwas zu erfinden.');
  const actions = el('div', 'wz-actions');
  actions.append(openFolder);
  const card = el('section', 'wz-card');
  card.append(intro, drop, input, actions, say, chips, grid);
  root.append(card);

  async function upload(list) {
    if (!list.length) return;
    let done = 0;
    const problems = [];
    for (const file of list) {
      say.textContent = `Lädt ${done + 1} von ${list.length}: ${file.name} …`;
      try {
        const response = await fetch('/api/material/hochladen', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Datei-Name': encodeURIComponent(file.name) }, body: file });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Ging nicht.');
        done += 1;
      } catch (error) { problems.push(`${file.name}: ${error.message}`); }
    }
    say.textContent = `${done} ${done === 1 ? 'Datei' : 'Dateien'} im Material-Ordner.${problems.length ? ` Nicht geklappt: ${problems.join(' · ')}` : ''}`;
    await load();
  }

  function giveToWorky(item) {
    if (!fill) return;
    fill.dataset.fill = `Nimm ${item.path}${item.note ? ` (${item.note})` : ''} und `;
    fill.click();
  }

  function tile(item) {
    const box = el('article', 'mt-item');
    const view = el('div', 'mt-view');
    const src = `/api/material/vorschau?datei=${encodeURIComponent(item.path)}`;
    if (item.preview === 'bild') {
      const image = el('img');
      image.src = src;
      image.alt = item.note || item.name;
      image.loading = 'lazy';
      view.append(image);
    } else {
      view.append(el('span', 'mt-icon', ICONS[item.kind] || '📦'));
    }
    box.append(view);
    if (item.preview === 'ton') {
      const audio = el('audio');
      audio.controls = true;
      audio.preload = 'none';
      audio.src = src;
      box.append(audio);
    }
    const name = el('strong', '', item.name);
    name.title = item.path;
    box.append(name, el('small', '', `${item.label} · ${size(item.size)}${item.size > 50 * 1024 * 1024 ? ' · groß für GitHub' : ''}`));
    const note = el('input', 'mt-note');
    note.value = item.note;
    note.maxLength = 300;
    note.placeholder = 'Wofür? z. B. „Logo fürs Hauptmenü“';
    note.setAttribute('aria-label', `Beschreibung für ${item.name}`);
    note.addEventListener('change', async () => {
      try { item.note = (await api('/api/material/notiz', { datei: item.path, notiz: note.value })).note; note.classList.add('saved'); setTimeout(() => note.classList.remove('saved'), 1200); } catch (error) { say.textContent = error.message; }
    });
    const row = el('div', 'wz-actions');
    row.append(button('An Worky', 'tiny-action', () => giveToWorky(item)), button('Pfad kopieren', 'tiny-action', async (event) => {
      try { await navigator.clipboard.writeText(item.path); event.target.textContent = 'Kopiert ✓'; } catch { say.textContent = item.path; }
      setTimeout(() => { event.target.textContent = 'Pfad kopieren'; }, 1500);
    }));
    box.append(note, row);
    return box;
  }

  function renderGrid() {
    for (const chip of chips.children) {
      const count = chip.dataset.value ? files.filter((item) => item.kind === chip.dataset.value).length : files.length;
      chip.classList.toggle('active', chip.dataset.value === filter);
      chip.setAttribute('aria-pressed', String(chip.dataset.value === filter));
      chip.hidden = Boolean(chip.dataset.value) && !count;
      chip.textContent = `${FILTERS.find(([value]) => value === chip.dataset.value)[1]} ${count}`;
    }
    chips.hidden = !files.length;
    const shown = files.filter((item) => !filter || item.kind === filter);
    grid.replaceChildren(...shown.map(tile));
    if (!files.length) grid.append(el('p', 'ns-empty', 'Noch kein Material. Zieh z. B. Konzeptbilder, Modelle aus Blender oder Sounds von Freesound hier hinein.'));
  }

  async function load() {
    try {
      const data = await api('/api/material');
      files = data.files;
      if (filter && !files.some((item) => item.kind === filter)) filter = '';
      renderGrid();
      if (data.truncated) say.textContent = 'Sehr viele Dateien: Workflow zeigt die neuesten 600.';
    } catch (error) { say.textContent = error.message; }
  }

  area.addEventListener('toggle', () => { if (area.open) void load(); });
  document.querySelector('[data-bereich-knopf="material"]')?.addEventListener('click', () => { if (area.open) void load(); });
  if (area.open) void load();
})();
