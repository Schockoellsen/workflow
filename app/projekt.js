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

  // Projekt löschen (2026-10-23): Name eintippen, dann kommt der Ordner in den Windows-Papierkorb.
  // Gibt die neue Projektliste zurück, oder null, wenn Timo abbricht.
  window.workflowDeleteProject = async (item) => {
    let warning = '';
    try {
      const status = (await api('/api/projekte/status')).status?.[item.id];
      if (status?.changes) warning += `\n⚠️ ${status.changes} Änderungen sind noch nicht committet.`;
      if (status?.ahead) warning += `\n⚠️ ${status.ahead} Commits sind noch nicht auf GitHub hochgeladen.`;
    } catch { /* ohne Status weiter */ }
    const typed = prompt(`Projekt „${item.name}“ löschen?\n\nDer Ordner ${item.root} kommt in den Windows-Papierkorb. Dort kannst du ihn wiederherstellen, bis du den Papierkorb leerst.${warning}\n\nZum Bestätigen tippe den Namen ein: ${item.name}`);
    if (typed === null) return null;
    if (typed.trim() !== item.name) { alert('Der Name passt nicht, es wurde nichts gelöscht.'); return null; }
    return api('/api/projekte/loeschen', { id: item.id, name: typed.trim() });
  };

  function init() {
    document.title = project ? `${project.name} · Workflow` : 'Workflow';
    for (const element of document.querySelectorAll('[data-projekt-name]')) element.textContent = project ? project.name : 'Kein Projekt';
    for (const element of document.querySelectorAll('[data-projekt-art]')) element.textContent = project ? `${project.kindLabel} · Workflow` : 'Projekt wählen';
    for (const element of document.querySelectorAll('[data-projekt-initial]')) element.textContent = project ? project.name.trim().charAt(0).toUpperCase() : '?';
    for (const element of document.querySelectorAll('[data-projekt-beschreibung]')) if (project?.description) element.textContent = project.description;
    if (project) document.documentElement.dataset.projektArt = project.kind;
    // Studio und Rojo gibt es nur bei Roblox-Projekten
    for (const element of document.querySelectorAll('[data-nur-roblox]')) element.hidden = project?.kind !== 'roblox';
    for (const element of document.querySelectorAll('[data-nur-web]')) element.hidden = project?.kind !== 'web';

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
        const state = document.createElement('small');
        state.className = 'project-state';
        state.dataset.statusFor = item.id;
        open.append(name, info, folder, state);
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
          const trash = document.createElement('button');
          trash.type = 'button';
          trash.className = 'project-remove project-delete';
          trash.textContent = '🗑';
          trash.setAttribute('aria-label', `„${item.name}“ löschen`);
          trash.title = 'Projekt löschen (Ordner kommt in den Papierkorb)';
          trash.addEventListener('click', async () => {
            try {
              const result = await window.workflowDeleteProject(item);
              if (result) { render(result); say(`„${item.name}“ ist gelöscht. Der Ordner liegt im Papierkorb.`); }
            } catch (error) { say(error.message, true); }
          });
          row.append(remove, trash);
        }
        list.append(row);
      }
      if (!kindSelect.options.length) {
        for (const [value, label] of Object.entries(data.kinds || {})) kindSelect.append(new Option(label, value));
      }
    }

    // Projekt-Status (Ausbau 2026-10-22): kurz unter jedem Projekt, was offen ist
    async function showStatus() {
      let data;
      try { data = await api('/api/projekte/status'); } catch { return; }
      for (const [id, status] of Object.entries(data.status || {})) {
        const target = list.querySelector(`[data-status-for="${CSS.escape(id)}"]`);
        if (!target || !status?.git) continue;
        const parts = [];
        if (status.branch && !['main', 'master'].includes(status.branch)) parts.push(`Zweig ${status.branch}`);
        if (status.changes) parts.push(`${status.changes} nicht committet`);
        if (status.ahead) parts.push(`${status.ahead} nicht hochgeladen`);
        if (status.prs?.length) parts.push(`${status.prs.length} PR wartet`);
        target.textContent = parts.length ? parts.join(' · ') : 'alles gespeichert';
        target.dataset.state = status.changes || status.ahead || status.prs?.length ? 'offen' : 'ok';
      }
    }

    async function openDialog() {
      say('');
      try { render(await api('/api/projekte')); } catch (error) { say(error.message, true); }
      if (!dialog.open) dialog.showModal();
      void showStatus();
    }

    document.querySelector('#project-switch')?.addEventListener('click', openDialog);
    document.querySelector('[data-neues-projekt]')?.addEventListener('click', () => { dialog.close(); window.workflowNewProject?.(); });
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
    // Für die Projektseite (start.js): Dialog öffnen, auf Wunsch gleich mit „Projekt hinzufügen“
    window.workflowOpenProjects = async (add = false) => { await openDialog(); if (add) { addBox.open = true; document.querySelector('#project-name')?.focus(); } };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
