// Neues Projekt aus einer Vorlage (Workflow Paket 3): Name, Spielart, Beschreibung und Speicherort abfragen,
// dann legt der Server Ordner, Startdateien, Regeln, Tresor und Git an (POST /api/projekte/anlegen).
(() => {
  const dialog = document.querySelector('#new-project-dialog');
  if (!dialog) return;
  const form = dialog.querySelector('#new-project-form');
  const nameInput = dialog.querySelector('#np-name');
  const kindList = dialog.querySelector('#np-kind-list');
  const kindNote = dialog.querySelector('#np-kind-note');
  const description = dialog.querySelector('#np-description');
  const parentInput = dialog.querySelector('#np-parent');
  const target = dialog.querySelector('#np-target');
  const message = dialog.querySelector('#np-message');
  const createButton = dialog.querySelector('#np-create');

  // Ehrlich sagen, was Worky bei welcher Spielart kann
  const KINDS = [
    { id: 'roblox', label: 'Roblox', note: 'Rojo-Vorlage mit Server, Client und Spielwerten. Worky baut und testet selbst in Roblox Studio.' },
    { id: 'web', label: 'Browser-Spiel', note: 'Startspiel „Sammle die Sterne“ in HTML und JavaScript. Vorschau direkt aus Workflow, läuft auch am Handy.' },
    { id: 'godot', label: 'Godot', note: 'Ordner, Regeln und Tresor. Worky schreibt GDScript. Ist Godot unter Werkzeuge eingerichtet, startet Worky dein Spiel selbst ohne Fenster und liest die Fehler.' },
    { id: 'unity', label: 'Unity', note: 'Ordner, Regeln und Tresor. Worky schreibt C#, testen machst du im Unity-Editor.' },
    { id: 'andere', label: 'Anderes', note: 'Nur Regeln und Tresor. Du sagst Worky, was es werden soll.' }
  ];
  let kind = 'roblox';
  // Eigene Vorlage (Ausbau 2026-10-22): aus einem fertigen Projekt, Spielart kommt aus der Vorlage
  let template = null;

  const say = (text, isError = false) => { message.textContent = text; message.dataset.state = isError ? 'error' : 'ok'; };

  // Gleiche Regel wie im Server (projectSlug), nur für die Anzeige des Zielordners
  const slug = (name) => name.toLocaleLowerCase('de').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'projekt';
  function showTarget() {
    const parent = parentInput.value.trim().replace(/[\\/]+$/, '');
    const separator = parent.includes('\\') ? '\\' : '/';
    target.textContent = parent ? `${parent}${separator}${slug(nameInput.value.trim())}` : 'bitte Ordner angeben';
  }

  for (const item of KINDS) {
    const label = document.createElement('label');
    label.className = 'np-kind';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'np-kind';
    radio.value = item.id;
    radio.checked = item.id === kind;
    radio.addEventListener('change', () => { kind = item.id; template = null; kindNote.textContent = item.note; });
    label.append(radio, document.createTextNode(item.label));
    kindList.append(label);
  }
  kindNote.textContent = KINDS[0].note;
  nameInput.addEventListener('input', showTarget);
  parentInput.addEventListener('input', showTarget);

  async function post(url, body) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Workflow antwortet gerade nicht.');
    return data;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    // × und „Zurück“ schließen nur den Dialog (früher lief auch hier „Projekt anlegen“ los)
    if (event.submitter?.value === 'cancel') { dialog.close(); return; }
    if (!nameInput.value.trim()) { nameInput.focus(); return; }
    createButton.disabled = true;
    say('Lege das Projekt an …');
    try {
      const result = await post('/api/projekte/anlegen', { name: nameInput.value, kind, vorlage: template?.id || '', description: description.value, parent: parentInput.value });
      const notes = [];
      if (result.git === 'kein-git') notes.push('Git wurde nicht gefunden, das Projekt ist ohne Git angelegt.');
      if (result.git === 'ohne-commit') notes.push('Git ist angelegt, aber der erste Commit fehlt noch. Mach ihn in GitHub Desktop (dort ggf. Name und E-Mail einrichten).');
      if (result.rojo === 'fehlt') notes.push('rojo.exe liegt noch nicht im neuen Ordner. Kopier sie aus deinem anderen Roblox-Projekt hinein, dann geht der Rojo-Knopf.');
      await post('/api/projekte/waehlen', { id: result.added });
      try {
        sessionStorage.setItem('workflow-start-gesehen', '1');
        // Starthilfe läuft: nach dem Neuladen gleich den Ideen-Bereich zeigen (starthilfe.js)
        if (result.starthilfe) sessionStorage.setItem('workflow-starthilfe-oeffnen', '1');
      } catch { /* privates Fenster */ }
      if (notes.length) {
        say(`Fertig: ${result.folder}. ${notes.join(' ')} Klick „Öffnen“.`);
        createButton.disabled = false;
        createButton.textContent = 'Öffnen →';
        form.onsubmit = (next) => { next.preventDefault(); location.reload(); };
        return;
      }
      say(result.starthilfe ? `Fertig: ${result.folder}. Worky sammelt jetzt Ideen für dich …` : `Fertig: ${result.folder}`);
      location.reload();
    } catch (error) {
      say(error.message, true);
      createButton.disabled = false;
    }
  }, { once: false });

  // Eigene Vorlagen als zusätzliche Auswahl hinter den Spielarten
  async function loadOwnTemplates() {
    for (const old of kindList.querySelectorAll('.np-own')) old.remove();
    let list = [];
    try { list = (await (await fetch('/api/projekte/vorlagen')).json()).vorlagen || []; } catch { return; }
    for (const item of list) {
      const label = document.createElement('label');
      label.className = 'np-kind np-own';
      label.title = `Aus dem Projekt „${item.fromProject}“, ${item.files} Dateien`;
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'np-kind';
      radio.value = `vorlage:${item.id}`;
      radio.addEventListener('change', () => {
        kind = item.kind;
        template = item;
        kindNote.textContent = `Deine Vorlage „${item.name}“ (${item.kindLabel}, aus „${item.fromProject}“): ${item.files} Dateien mit Code, Regeln, Skills und Tresor-Wissen, ohne Chatverlauf. Namen und Werte vom alten Spiel passt Worky mit dir an.`;
        if (!description.value && item.description) description.placeholder = item.description;
      });
      label.append(radio, document.createTextNode(`⭐ ${item.name}`));
      kindList.append(label);
    }
  }

  window.workflowNewProject = async () => {
    say('');
    form.reset();
    kind = 'roblox';
    template = null;
    void loadOwnTemplates();
    kindList.querySelector('input[value="roblox"]').checked = true;
    kindNote.textContent = KINDS[0].note;
    try {
      const response = await fetch('/api/projekte');
      const data = await response.json();
      if (!parentInput.value && data.defaultParent) parentInput.value = data.defaultParent;
    } catch { /* Ordner trägt Timo dann selbst ein */ }
    showTarget();
    if (!dialog.open) dialog.showModal();
    nameInput.focus();
  };
})();
