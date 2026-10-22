const loadProjectChanges = document.querySelector('#load-project-changes');
const projectChangeList = document.querySelector('#project-change-list');
const projectDiffView = document.querySelector('#project-diff-view');
const projectDiffFile = document.querySelector('#project-diff-file');
const projectDiffContent = document.querySelector('#project-diff-content');
const projectDiffBack = document.querySelector('#project-diff-back');

function showProjectChangeMessage(message, isError = false) {
  projectChangeList.replaceChildren();
  const row = document.createElement('p');
  row.className = isError ? 'project-change-message error' : 'project-change-message';
  row.textContent = message;
  projectChangeList.append(row);
}

function showProjectChangeFiles(changes) {
  projectChangeList.replaceChildren();
  if (!changes.length) {
    showProjectChangeMessage('Keine uncommitteten Projektänderungen gefunden.');
    return;
  }
  for (const change of changes) {
    const row = document.createElement('div');
    row.className = 'project-change-row';
    const status = document.createElement('code');
    status.textContent = change.status;
    const file = document.createElement('span');
    file.textContent = change.path;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'tiny-action';
    open.textContent = 'Diff';
    open.addEventListener('click', () => void showProjectDiff(change.path));
    row.append(status, file, open);
    projectChangeList.append(row);
  }
}

async function showProjectDiff(file) {
  projectChangeList.hidden = true;
  projectDiffView.hidden = false;
  projectDiffFile.textContent = file;
  projectDiffContent.textContent = 'Lese lokalen Diff …';
  try {
    const response = await fetch(`/api/project/changes?file=${encodeURIComponent(file)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Der Diff konnte nicht gelesen werden.');
    projectDiffContent.textContent = `${result.diff}${result.truncated ? '\n\n… Vorschau auf 80.000 Zeichen begrenzt.' : ''}`;
  } catch (error) {
    projectDiffContent.textContent = error.message || 'Der Diff konnte nicht gelesen werden.';
  }
}

loadProjectChanges.addEventListener('click', async () => {
  loadProjectChanges.disabled = true;
  loadProjectChanges.textContent = 'Lese Git-Status …';
  projectDiffView.hidden = true;
  projectChangeList.hidden = false;
  showProjectChangeMessage('Lese lokale Änderungen im Projektordner …');
  try {
    const response = await fetch('/api/project/changes');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Der Git-Status konnte nicht gelesen werden.');
    showProjectChangeFiles(result.changes || []);
  } catch (error) {
    showProjectChangeMessage(error.message || 'Der Git-Status konnte nicht gelesen werden.', true);
  } finally {
    loadProjectChanges.disabled = false;
    loadProjectChanges.textContent = 'Aktualisieren';
  }
});

projectDiffBack.addEventListener('click', () => {
  projectDiffView.hidden = true;
  projectChangeList.hidden = false;
});
