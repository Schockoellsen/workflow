// Ideen und Aufgaben je Projekt getrennt
const IDEA_KEY = window.workflowKey('workflow-ideen-v1');
const TASK_KEY = window.workflowKey('workflow-aufgaben-v1');
const dialog = document.querySelector('#idea-dialog');
const planDialog = document.querySelector('#plan-dialog');
const form = document.querySelector('#idea-form');
const planForm = document.querySelector('#plan-form');
const titleInput = document.querySelector('#idea-title');
const detailsInput = document.querySelector('#idea-details');
const ideaList = document.querySelector('#idea-list');
const taskList = document.querySelector('#task-list');
const ideaEmptyState = document.querySelector('#empty-state');
const taskEmptyState = document.querySelector('#task-empty');
const toast = document.querySelector('#toast');
const vaultPreviewDialog = document.querySelector('#vault-preview-dialog');
const vaultPreviewForm = document.querySelector('#vault-preview-form');
let editingTaskId = null;
let vaultDirectory = null;
let vaultSnapshotContent = null;
let vaultPreviewContent = null;
const VAULT_TARGET_FILE = 'IE-Werkstatt.md';
const VAULT_START_MARKER = '<!-- INDUSTRIAL-EMPIRE-WERKSTATT:START -->';
const VAULT_END_MARKER = '<!-- INDUSTRIAL-EMPIRE-WERKSTATT:END -->';
let ideas = loadList(IDEA_KEY);
let tasks = loadList(TASK_KEY);

function loadList(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(saved) ? saved.filter((item) => item && typeof item.title === 'string') : [];
  } catch {
    return [];
  }
}

function saveAll() {
  localStorage.setItem(IDEA_KEY, JSON.stringify(ideas));
  localStorage.setItem(TASK_KEY, JSON.stringify(tasks));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2500);
}

function shortDate() {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short' }).format(new Date());
}

function guessArea(title, details) {
  const text = `${title} ${details}`.toLocaleLowerCase('de');
  if (/hud|ui|oberfl|fenster|men[uü]|anzeige/.test(text)) return 'UI & Bedienung';
  if (/bohrer|maschine|fabrik|band|ofen|produktion|werkstatt/.test(text)) return 'Maschinen & Produktion';
  if (/code|system|speicher|daten|handel|lager|wirtschaft/.test(text)) return 'Spielsysteme';
  if (/welt|halle|h[oö]hle|gel[aä]nde|modell|design|farbe|stil/.test(text)) return 'Welt & Design';
  return 'Konzept & Spielgefühl';
}

function renderIdeas() {
  const openIdeas = ideas.filter((idea) => idea.status === 'idee' || !idea.status);
  ideaList.innerHTML = openIdeas.map((idea) => `
    <article class="idea-card" data-id="${escapeHtml(idea.id)}">
      <span class="idea-bullet">✳</span>
      <div class="idea-card-main">
        <h4 class="idea-card-title">${escapeHtml(idea.title)}</h4>
        ${idea.details ? `<p class="idea-card-details">${escapeHtml(idea.details)}</p>` : ''}
        <div class="idea-meta"><span class="idea-chip">✳ IDEE · NICHT FREIGEGEBEN</span><span class="idea-date">${escapeHtml(idea.date || 'Import')}</span></div>
      </div>
      <div class="idea-actions"><button class="tiny-action promote" type="button" data-id="${escapeHtml(idea.id)}">Entwurf erstellen</button><button class="tiny-action delete" type="button" data-id="${escapeHtml(idea.id)}" aria-label="Idee entfernen">×</button></div>
    </article>`).join('');
  ideaEmptyState.classList.toggle('show', openIdeas.length === 0);
  document.querySelector('#idea-stat').textContent = String(openIdeas.length).padStart(2, '0');
}

function renderTasks() {
  const visibleTasks = tasks.filter((task) => task.status !== 'zurueckgestellt');
  taskList.innerHTML = visibleTasks.map((task) => {
    const approved = task.status === 'freigegeben';
    return `
      <article class="task-card ${approved ? 'approved' : ''}" data-id="${escapeHtml(task.id)}">
        <div class="task-card-top"><span class="task-status ${approved ? 'approved-status' : ''}">${approved ? '✓ AUFGABE · FREIGEGEBEN' : '◷ AUFGABENENTWURF · WARTET AUF DICH'}</span><span class="task-area">${escapeHtml(task.area)}</span></div>
        <h4>${escapeHtml(task.title)}</h4>
        <p>${escapeHtml(task.description)}</p>
        <div class="task-source">Entstanden aus der Idee: <strong>${escapeHtml(task.sourceTitle)}</strong></div>
        ${approved && task.plan ? `<div class="saved-plan-summary"><span class="plan-state ${task.plan.status === 'freigegeben' ? 'plan-approved' : ''}">${task.plan.status === 'freigegeben' ? '✓ PLAN FREIGEGEBEN' : '◷ PLANENTWURF · PRÜFEN'}</span><strong>${escapeHtml(task.plan.files.split('\n').filter(Boolean).length)} betroffene Datei(en)</strong></div>` : ''}
        <div class="task-card-actions">${approved
          ? `<button class="tiny-action undo-task" type="button" data-id="${escapeHtml(task.id)}">Zurück zum Entwurf</button><button class="tiny-action plan-task" type="button" data-id="${escapeHtml(task.id)}">${task.plan ? 'Plan prüfen' : 'Plan entwerfen'}</button>${task.plan?.status === 'freigegeben' ? '<span class="approved-note">Freigegeben, noch nicht ausgeführt</span>' : ''}`
          : `<button class="tiny-action approve-task" type="button" data-id="${escapeHtml(task.id)}">Als Aufgabe übernehmen</button><button class="tiny-action return-idea" type="button" data-id="${escapeHtml(task.id)}">Zur Idee zurück</button>`}</div>
      </article>`;
  }).join('');
  taskEmptyState.classList.toggle('show', visibleTasks.length === 0);
  const approvedCount = visibleTasks.filter((task) => task.status === 'freigegeben').length;
  const draftCount = visibleTasks.length - approvedCount;
  document.querySelector('#active-stat').textContent = String(visibleTasks.length).padStart(2, '0');
  document.querySelector('#task-count').textContent = String(visibleTasks.length);
  document.querySelector('#task-total').textContent = `${visibleTasks.length} ${visibleTasks.length === 1 ? 'Aufgabe' : 'Aufgaben'} · ${draftCount} Entwurf${draftCount === 1 ? '' : 'e'}`;
  document.querySelector('#save-vault').disabled = !vaultDirectory || !visibleTasks.some((task) => task.status === 'freigegeben');
}

function render() {
  renderIdeas();
  renderTasks();
}

function openPlanDialog(task) {
  editingTaskId = task.id;
  const plan = task.plan || {
    goal: `${task.title}. ${task.description}`,
    files: '',
    changes: '',
    protectedRules: 'Server bleibt maßgeblich. Spielerdaten werden nur über PlayerDataService geändert. Bestehende Speicherfelder, Remotes, Konfigurationswerte und Maschinenattribute bleiben erhalten, sofern der freigegebene Umfang sie nicht ausdrücklich betrifft.',
    verification: 'Vorschlag und Dateiunterschiede gemeinsam prüfen. Roblox-Studio-Prüfungen erst nach separater Freigabe planen und durchführen.',
    rollback: 'Änderung über Git/Branch oder eine vorherige Sicherung zurücknehmen.'
  };
  document.querySelector('#plan-task-name').textContent = task.title;
  document.querySelector('#plan-goal').value = plan.goal || '';
  document.querySelector('#plan-files').value = plan.files || '';
  document.querySelector('#plan-changes').value = plan.changes || '';
  document.querySelector('#plan-protected').value = plan.protectedRules || '';
  document.querySelector('#plan-check').value = plan.verification || '';
  document.querySelector('#plan-rollback').value = plan.rollback || '';
  document.querySelector('#approve-plan').textContent = plan.status === 'freigegeben' ? 'Freigabe erneuern' : 'Plan freigeben';
  syncPlanApproval();
  planDialog.showModal();
}

function syncPlanApproval() {
  const required = ['#plan-goal', '#plan-files', '#plan-changes', '#plan-protected', '#plan-check', '#plan-rollback'];
  document.querySelector('#approve-plan').disabled = required.some((selector) => !document.querySelector(selector).value.trim());
}

function importIdeasFromMarkdown(markdown) {
  const imported = markdown.split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*+]\s+(.+?)\s*$/)?.[1])
    .filter(Boolean)
    .map((title) => ({ id: crypto.randomUUID(), title: title.replace(/~~/g, ''), details: '', date: 'Import', status: 'idee' }));
  const known = new Set(ideas.map((idea) => idea.title.toLocaleLowerCase('de')));
  const unique = imported.filter((idea) => !known.has(idea.title.toLocaleLowerCase('de')));
  ideas = [...unique, ...ideas];
  saveAll();
  render();
  return unique.length;
}

function markdownSafe(value) {
  return String(value || '').replace(/<!--/g, '&lt;!--').replace(/-->/g, '--&gt;');
}

function buildVaultManagedSection() {
  const approvedTasks = tasks.filter((task) => task.status === 'freigegeben');
  const entries = approvedTasks.map((task) => {
    const lines = [
      `### ${markdownSafe(task.title)}`,
      `- Status: freigegebene Aufgabe`,
      `- Entstanden aus der Idee: ${markdownSafe(task.sourceTitle)}`,
      `- Bereich: ${markdownSafe(task.area)}`,
      `- Ziel: ${markdownSafe(task.plan?.goal || task.description)}`,
      `- Betroffene Dateien: ${markdownSafe(task.plan?.files || 'Noch offen')}`,
      `- Vorgeschlagene Änderung: ${markdownSafe(task.plan?.changes || 'Noch offen')}`,
      `- Geschützte Regeln: ${markdownSafe(task.plan?.protectedRules || 'Noch nicht eingetragen')}`,
      `- Prüfung: ${markdownSafe(task.plan?.verification || 'Noch nicht eingetragen')}`,
      `- Rückweg: ${markdownSafe(task.plan?.rollback || 'Noch nicht eingetragen')}`,
      `- Planstatus: ${task.plan?.status === 'freigegeben' ? 'für spätere Umsetzung freigegeben (noch nicht ausgeführt)' : 'Plan noch nicht freigegeben'}`
    ];
    return lines.join('\n');
  });
  return [
    VAULT_START_MARKER,
    `## ${window.workflowProject?.name || 'Projekt'} — Werkstatt-Aufgaben`,
    '> Dieser Abschnitt wird von der lokalen Werkstatt verwaltet. Planfreigabe bedeutet nicht, dass Spielcode geändert wurde.',
    '',
    entries.join('\n\n') || 'Noch keine freigegebenen Aufgaben.',
    VAULT_END_MARKER
  ].join('\n');
}

function mergeVaultSection(existing, managedSection) {
  const starts = existing.split(VAULT_START_MARKER).length - 1;
  const ends = existing.split(VAULT_END_MARKER).length - 1;
  if (starts !== ends || starts > 1) throw new Error('Die Werkstatt-Markierungen in der Notiz sind uneindeutig. Es wurde nichts gespeichert.');
  if (starts === 1) {
    const start = existing.indexOf(VAULT_START_MARKER);
    const end = existing.indexOf(VAULT_END_MARKER);
    if (end < start) throw new Error('Die Werkstatt-Markierungen in der Notiz sind beschädigt. Es wurde nichts gespeichert.');
    return `${existing.slice(0, start)}${managedSection}${existing.slice(end + VAULT_END_MARKER.length)}`;
  }
  return `${existing.trimEnd()}${existing.trim() ? '\n\n' : ''}${managedSection}\n`;
}

async function readVaultTarget() {
  try {
    const handle = await vaultDirectory.getFileHandle(VAULT_TARGET_FILE);
    const file = await handle.getFile();
    return { content: await file.text(), exists: true };
  } catch (error) {
    if (error.name === 'NotFoundError') return { content: '', exists: false };
    throw error;
  }
}

async function prepareVaultPreview() {
  if (!vaultDirectory) return;
  try {
    const approvedCount = tasks.filter((task) => task.status === 'freigegeben').length;
    if (!approvedCount) {
      showToast('Gib zuerst mindestens eine Aufgabe frei.');
      return;
    }
    const current = await readVaultTarget();
    vaultSnapshotContent = current.content;
    vaultPreviewContent = mergeVaultSection(current.content, buildVaultManagedSection());
    document.querySelector('#vault-preview-summary').textContent = current.exists
      ? `Vorschau für ${vaultDirectory.name}/${VAULT_TARGET_FILE}. Nur der Werkstatt-Abschnitt wird ersetzt; dein übriger Notizinhalt bleibt erhalten.`
      : `Vorschau für eine neue Notiz: ${vaultDirectory.name}/${VAULT_TARGET_FILE}. Sie wird erst nach deiner Freigabe angelegt.`;
    document.querySelector('#vault-preview-content').textContent = vaultPreviewContent;
    vaultPreviewDialog.showModal();
  } catch (error) {
    showToast(error.message || 'Die Obsidian-Notiz konnte nicht gelesen werden.');
  }
}

function openIdeaDialog() {
  form.reset();
  dialog.showModal();
  window.setTimeout(() => titleInput.focus(), 40);
}

document.querySelectorAll('#new-idea-top, #new-idea-inline, #empty-new-idea').forEach((button) => {
  button.addEventListener('click', openIdeaDialog);
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') {
    dialog.close();
    return;
  }
  const title = titleInput.value.trim();
  if (!title) return;
  ideas.unshift({ id: crypto.randomUUID(), title, details: detailsInput.value.trim(), date: shortDate(), status: 'idee' });
  saveAll();
  render();
  dialog.close();
  showToast('Idee gespeichert — noch nicht freigegeben.');
});

ideaList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-id]');
  if (!button) return;
  const idea = ideas.find((item) => item.id === button.dataset.id);
  if (!idea) return;
  if (button.classList.contains('promote')) {
    const existing = tasks.find((task) => task.sourceIdeaId === idea.id && task.status !== 'zurueckgestellt');
    if (existing) {
      showToast('Zu dieser Idee gibt es schon einen Aufgabenentwurf.');
      document.querySelector('#aufgaben').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const description = idea.details
      ? `${idea.details} Als ersten Schritt klären wir gemeinsam den Umfang und die betroffenen Spielbereiche.`
      : 'Als ersten Schritt klären wir gemeinsam das Ziel, den Umfang und die betroffenen Spielbereiche.';
    tasks.unshift({
      id: crypto.randomUUID(),
      sourceIdeaId: idea.id,
      sourceTitle: idea.title,
      title: `Planen: ${idea.title}`,
      description,
      area: guessArea(idea.title, idea.details || ''),
      status: 'entwurf',
      date: shortDate()
    });
    saveAll();
    render();
    showToast('Aufgabenentwurf erstellt — wartet auf deine Freigabe.');
    document.querySelector('#aufgaben').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  ideas = ideas.filter((item) => item.id !== button.dataset.id);
  saveAll();
  render();
  showToast('Idee aus dieser Werkstatt entfernt.');
});

taskList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-id]');
  if (!button) return;
  const task = tasks.find((item) => item.id === button.dataset.id);
  if (!task) return;
  if (button.classList.contains('approve-task')) {
    task.status = 'freigegeben';
    task.approvedAt = new Date().toISOString();
    saveAll();
    render();
    showToast('Aufgabe freigegeben. Es wurde kein Spielcode geändert.');
  } else if (button.classList.contains('undo-task')) {
    task.status = 'entwurf';
    delete task.approvedAt;
    if (task.plan) task.plan.status = 'entwurf';
    saveAll();
    render();
    showToast('Aufgabe wieder zum Entwurf gemacht.');
  } else if (button.classList.contains('return-idea')) {
    tasks = tasks.filter((item) => item.id !== task.id);
    saveAll();
    render();
    showToast('Der Aufgabenentwurf wurde entfernt; die Idee bleibt erhalten.');
  } else if (button.classList.contains('plan-task')) {
    openPlanDialog(task);
  }
});

planForm.querySelectorAll('textarea').forEach((field) => field.addEventListener('input', syncPlanApproval));
planForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') {
    planDialog.close();
    return;
  }
  const task = tasks.find((item) => item.id === editingTaskId);
  if (!task) return;
  const submitter = event.submitter;
  const releasing = submitter?.value === 'approve';
  const plan = {
    goal: document.querySelector('#plan-goal').value.trim(),
    files: document.querySelector('#plan-files').value.trim(),
    changes: document.querySelector('#plan-changes').value.trim(),
    protectedRules: document.querySelector('#plan-protected').value.trim(),
    verification: document.querySelector('#plan-check').value.trim(),
    rollback: document.querySelector('#plan-rollback').value.trim(),
    status: releasing ? 'freigegeben' : 'entwurf',
    updatedAt: new Date().toISOString()
  };
  if (releasing && Object.entries(plan).some(([key, value]) => key !== 'status' && key !== 'updatedAt' && !value)) return;
  task.plan = plan;
  saveAll();
  render();
  planDialog.close();
  showToast(releasing
    ? 'Planfreigabe gespeichert. Es wurde nichts am Roblox-Projekt geändert.'
    : 'Planentwurf gespeichert. Er wartet auf deine Prüfung.');
});

document.querySelector('#connect-vault').addEventListener('click', async () => {
  if (!window.isSecureContext || typeof window.showDirectoryPicker !== 'function') {
    document.querySelector('#vault-note').textContent = 'Dein Browser unterstützt die direkte Tresor-Auswahl nicht. Nutze „Notiz importieren“ und „Markdown exportieren“.';
    showToast('Direkter Zugriff ist in diesem Browser nicht verfügbar.');
    return;
  }
  try {
    vaultDirectory = await window.showDirectoryPicker({ id: 'industrial-empire-vault', mode: 'read' });
    await window.IEVaultContext?.storeHandle(vaultDirectory);
    document.querySelector('#vault-note').textContent = `„${vaultDirectory.name}“ verbunden. Passende Markdown-Notizen werden beim Senden lokal durchsucht; nur relevante Auszüge gehen an die gewählte KI. Schreibzugriff wird erst beim Speichern angefragt.`;
    const ideasHandle = await vaultDirectory.getFileHandle('Ideen.md');
    const ideasFile = await ideasHandle.getFile();
    const importedCount = importIdeasFromMarkdown(await ideasFile.text());
    showToast(`${importedCount} neue Idee(n) aus Ideen.md eingelesen.`);
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (error.name === 'NotFoundError' && vaultDirectory) {
      showToast('Tresor gewählt. Darin wurde keine Ideen.md gefunden.');
      document.querySelector('#vault-note').textContent = `„${vaultDirectory.name}“ ausgewählt. Keine Ideen.md gefunden; du kannst trotzdem freigegebene Aufgaben speichern.`;
      renderTasks();
      return;
    }
    vaultDirectory = null;
    document.querySelector('#vault-note').textContent = 'Tresorzugriff konnte nicht hergestellt werden. Manueller Import/Export bleibt verfügbar.';
    showToast('Der Tresor konnte nicht geöffnet werden.');
  }
});

document.querySelector('#save-vault').addEventListener('click', prepareVaultPreview);
document.querySelector('#check-vault').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const handle = vaultDirectory || await window.IEVaultContext?.restoreHandle();
    if (!handle) {
      document.querySelector('#vault-note').textContent = 'Noch kein Tresor ausgewählt. Klicke zuerst auf „Tresor lokal wählen“.';
      return;
    }
    let permission = await handle.queryPermission({ mode: 'read' }).catch(() => 'prompt');
    if (permission === 'prompt') permission = await handle.requestPermission({ mode: 'read' });
    if (permission !== 'granted') {
      document.querySelector('#vault-note').textContent = 'Der Browser hat den Lesezugriff nicht erteilt. Wähle den Tresor erneut, um die Berechtigung anzufragen.';
      return;
    }
    document.querySelector('#vault-note').textContent = `Prüfe „${handle.name}“ lokal. Es werden keine Notizinhalte an eine KI gesendet …`;
    const result = await window.IEVaultContext.relevantNotes('Werkstatt Fehlerbehebung');
    if (result.reason === 'permission') {
      document.querySelector('#vault-note').textContent = 'Der Browser hat den Lesezugriff nicht erteilt. Wähle den Tresor erneut.';
      return;
    }
    if (result.reason === 'read-failed' || result.reason === 'storage-unavailable') {
      document.querySelector('#vault-note').textContent = 'Der Tresor konnte nicht lokal gelesen werden. Prüfe die Browserfreigabe und versuche es erneut.';
      return;
    }
    const limitText = result.reason === 'file-limit' ? ' (Suchgrenze von 600 Markdown-Dateien erreicht)' : '';
    const matches = result.notes.map((note) => note.name).join(', ');
    let statusSynced = false;
    try {
      const response = await fetch('/api/vault/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vaultName: result.vaultName, noteCount: result.noteCount, matchCount: result.notes.length, limited: result.reason === 'file-limit' })
      });
      statusSynced = response.ok;
    } catch { /* Die lokale Prüfung bleibt gültig, auch wenn der Status nicht gemeldet werden kann. */ }
    const serverStatus = statusSynced ? ' Die Werkstatt hat nur Tresorname und Zähler lokal vermerkt.' : '';
    document.querySelector('#vault-note').textContent = `${result.vaultName}: ${result.noteCount} Markdown-Notizen lokal lesbar, ${result.notes.length} passende Treffer${limitText}. Nichts wurde an eine KI gesendet.${serverStatus}${matches ? ` Treffer: ${matches}` : ''}`;
  } catch {
    document.querySelector('#vault-note').textContent = 'Die lokale Tresorprüfung ist fehlgeschlagen. Wähle den Tresor erneut und erteile Lesefreigabe.';
  } finally {
    button.disabled = false;
  }
});

if (window.IEVaultContext) {
  window.IEVaultContext.restoreHandle().then(async (handle) => {
    if (!handle) return;
    vaultDirectory = handle;
    const permission = await handle.queryPermission({ mode: 'read' }).catch(() => 'prompt');
    document.querySelector('#vault-note').textContent = permission === 'granted'
      ? `„${handle.name}“ verbunden. Passende Markdown-Notizen werden beim Senden lokal durchsucht.`
      : `„${handle.name}“ ist gespeichert. Wähle den Tresor erneut, um den Lesezugriff zu erneuern.`;
    renderTasks();
  }).catch(() => {
    document.querySelector('#vault-note').textContent = 'Die gespeicherte Tresor-Auswahl konnte nicht wiederhergestellt werden. Wähle den Tresor erneut.';
  });
}

document.querySelector('#markdown-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const importedCount = importIdeasFromMarkdown(await file.text());
  document.querySelector('#vault-note').textContent = `${importedCount} Listenpunkt(e) als Ideen importiert. Die Obsidian-Datei blieb unverändert.`;
  showToast(`${importedCount} Idee(n) eingelesen.`);
  event.target.value = '';
});

vaultPreviewForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') {
    vaultPreviewDialog.close();
    return;
  }
  if (!vaultDirectory) return;
  try {
    const permission = await vaultDirectory.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      showToast('Schreibzugriff nicht erteilt. Die Obsidian-Notiz blieb unverändert.');
      return;
    }
    const current = await readVaultTarget();
    if (current.content !== vaultSnapshotContent) {
      vaultSnapshotContent = current.content;
      vaultPreviewContent = mergeVaultSection(current.content, buildVaultManagedSection());
      document.querySelector('#vault-preview-content').textContent = vaultPreviewContent;
      document.querySelector('#vault-preview-summary').textContent = `Die Notiz hat sich seit der Vorschau geändert. Prüfe die aktualisierte Vorschau für ${vaultDirectory.name}/${VAULT_TARGET_FILE} und bestätige erneut.`;
      showToast('Die Notiz wurde neu eingelesen. Bitte prüfe die aktualisierte Vorschau.');
      return;
    }
    const target = await vaultDirectory.getFileHandle(VAULT_TARGET_FILE, { create: true });
    const writable = await target.createWritable();
    await writable.write(vaultPreviewContent);
    await writable.close();
    vaultSnapshotContent = vaultPreviewContent;
    vaultPreviewDialog.close();
    document.querySelector('#vault-note').textContent = `Aufgaben in „${vaultDirectory.name}/${VAULT_TARGET_FILE}“ gespeichert.`;
    showToast('Obsidian-Notiz aktualisiert.');
  } catch (error) {
    showToast(error.message || 'Speichern fehlgeschlagen. Die Notiz konnte nicht geändert werden.');
  }
});

document.querySelector('#import-markdown').addEventListener('click', () => document.querySelector('#markdown-file').click());

document.querySelector('#export-markdown').addEventListener('click', () => {
  const date = new Intl.DateTimeFormat('sv-SE').format(new Date());
  const ideaLines = ideas.map((idea) => `- ${idea.title}${idea.details ? `\n  - ${idea.details.replace(/\n/g, '\n  - ')}` : ''} #idee`);
  const taskLines = tasks.map((task) => {
    const taskText = `- [${task.status === 'freigegeben' ? 'x' : ' '}] ${task.title} #${task.status === 'freigegeben' ? 'freigegeben' : 'aufgabenentwurf'}\n  - Aus Idee: ${task.sourceTitle}\n  - Bereich: ${task.area}\n  - ${task.description}`;
    if (!task.plan) return taskText;
    return `${taskText}\n  - Planstatus: ${task.plan.status === 'freigegeben' ? 'für Umsetzung freigegeben (noch nicht ausgeführt)' : 'Entwurf'}\n  - Ziel: ${task.plan.goal}\n  - Betroffene Dateien: ${task.plan.files || 'noch offen'}\n  - Änderung: ${task.plan.changes || 'noch offen'}\n  - Geschützte Regeln: ${task.plan.protectedRules}\n  - Prüfung: ${task.plan.verification}\n  - Rückweg: ${task.plan.rollback}`;
  });
  const markdown = `# Werkstatt-Stand — ${date}\n\n> Export aus dem lokalen Werkstatt-Prototyp. Entwürfe sind keine freigegebenen Änderungen am Spiel.\n\n## Ideen\n\n${ideaLines.join('\n') || '- Noch keine Ideen.'}\n\n## Aufgaben\n\n${taskLines.join('\n') || '- Noch keine Aufgabenentwürfe.'}\n`;
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `Werkstatt-Stand-${date}.md`;
  link.click();
  URL.revokeObjectURL(url);
  document.querySelector('#vault-note').textContent = 'Markdown-Datei heruntergeladen. Du kannst sie selbst in deinen Obsidian-Tresor legen.';
});

render();
