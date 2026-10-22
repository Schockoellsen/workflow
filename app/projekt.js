// Projekt-Auswahl in Workflow: zeigt das offene Projekt, wechselt Projekte und fügt neue hinzu.
// Läuft vor allen anderen Skripten: workflowKey('name') hängt die Projekt-ID an Speicher-Namen im Browser,
// damit Chats, Ideen und der Tresor-Ordner je Projekt getrennt bleiben.
(() => {
  const project = window.WORKFLOW_PROJECT || null;
  window.workflowProject = project;
  window.workflowKey = (base) => `${base}:${project ? project.id : 'ohne-projekt'}`;

  async function api(url, body) {
    const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Workflow antwortet gerade nicht.');
    return data;
  }

  function init() {
    document.title = project ? `${project.name} · Workflow` : 'Workflow';
    for (const element of document.querySelectorAll('[data-projekt-name]')) element.textContent = project ? project.name : 'Kein Projekt';
    for (const element of document.querySelectorAll('[data-projekt-art]')) element.textContent = project ? `${project.kindLabel} · Workflow` : 'Projekt wählen';
    // Studio und Rojo gibt es nur bei Roblox-Projekten
    for (const element of document.querySelectorAll('[data-nur-roblox]')) element.hidden = project?.kind !== 'roblox';

    const dialog = document.querySelector('#project-dialog');
    const list = document.querySelector('#project-list');
    const message = document.querySelector('#project-message');
    const kindSelect = document.querySelector('#project-kind');
    const addBox = document.querySelector('#project-add');
    if (!dialog || !list) return;
    const say = (text, isError = false) => { message.textContent = text; message.dataset.state = isError ? 'error' : 'ok'; };

    function render(data) {
      list.replaceChildren();
      if (!data.projects.length) {
        const empty = document.createElement('p');
        empty.className = 'project-empty';
        empty.textContent = 'Noch keine Projekte. Füg unten dein erstes hinzu.';
        list.append(empty);
        addBox.open = true;
      }
      for (const item of data.projects) {
        const row = document.createElement('div');
        row.className = 'project-row';
        row.setAttribute('role', 'listitem');
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'project-open';
        open.disabled = !item.available;
        if (item.id === data.active) open.setAttribute('aria-current', 'true');
        const name = document.createElement('strong');
        name.textContent = item.name;
        const info = document.createElement('small');
        info.textContent = `${item.kindLabel}${item.id === data.active ? ' · offen' : ''}${item.available ? '' : ' · Ordner fehlt'}`;
        const folder = document.createElement('small');
        folder.className = 'project-folder';
        folder.textContent = item.root;
        open.append(name, info, folder);
        open.addEventListener('click', async () => {
          if (item.id === data.active) { dialog.close(); return; }
          try {
            say(`Wechsle zu „${item.name}“ …`);
            await api('/api/projekte/waehlen', { id: item.id });
            location.reload();
          } catch (error) { say(error.message, true); }
        });
        row.append(open);
        if (item.id !== data.active) {
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'project-remove';
          remove.textContent = '×';
          remove.setAttribute('aria-label', `„${item.name}“ aus der Liste nehmen`);
          remove.title = 'Aus der Liste nehmen (Dateien bleiben auf dem PC)';
          remove.addEventListener('click', async () => {
            if (!confirm(`„${item.name}“ aus der Liste nehmen? Der Ordner und alle Dateien bleiben auf deinem PC.`)) return;
            try { render(await api('/api/projekte/entfernen', { id: item.id })); say('Aus der Liste genommen.'); } catch (error) { say(error.message, true); }
          });
          row.append(remove);
        }
        list.append(row);
      }
      if (!kindSelect.options.length) {
        for (const [value, label] of Object.entries(data.kinds || {})) kindSelect.append(new Option(label, value));
      }
    }

    async function openDialog() {
      say('');
      try { render(await api('/api/projekte')); } catch (error) { say(error.message, true); }
      if (!dialog.open) dialog.showModal();
    }

    document.querySelector('#project-switch')?.addEventListener('click', openDialog);
    document.querySelector('#project-add-button')?.addEventListener('click', async () => {
      const body = {
        name: document.querySelector('#project-name').value,
        root: document.querySelector('#project-root').value,
        kind: kindSelect.value,
        description: document.querySelector('#project-description').value
      };
      try {
        say('Füge hinzu …');
        const data = await api('/api/projekte/neu', body);
        await api('/api/projekte/waehlen', { id: data.added });
        location.reload();
      } catch (error) { say(error.message, true); }
    });
    // Ohne Projekt geht nichts: Auswahl gleich zeigen
    if (!project) void openDialog();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
