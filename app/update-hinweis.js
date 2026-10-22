// Update-Hinweis (Ausbau 2026-10-22): Liegt auf GitHub eine neuere Workflow-Version (z. B. nach deinem Merge),
// zeigt Workflow oben einen Streifen mit „Jetzt aktualisieren“. Das holt den neuen Stand (git pull) und
// Workflow startet von selbst neu. So läuft nie aus Versehen eine alte Version.
(() => {
  const HIDE_KEY = 'workflow-update-spaeter';
  let bar = null;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  async function waitForRestart() {
    // Der Server startet nach dem Pull neu (node --watch): kurz warten, bis er wieder antwortet
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try { const response = await fetch('/api/workflow/version', { signal: AbortSignal.timeout(2000) }); if (response.ok && attempt > 1) return true; } catch { /* startet noch */ }
    }
    return false;
  }

  function render(info) {
    bar?.remove();
    bar = el('div', 'wf-update');
    bar.setAttribute('role', 'status');
    const text = el('span', 'wf-update-text');
    const first = info.latest?.[0] ? ` (zuletzt: „${info.latest[0]}“)` : '';
    text.textContent = info.branch && info.branch !== 'main'
      ? `Neue Workflow-Version auf GitHub, aber dein Workflow-Ordner ist auf dem Zweig „${info.branch}“. Wechsel in GitHub Desktop auf main und klick „Pull origin“.`
      : `Neue Workflow-Version da: ${info.behind} ${info.behind === 1 ? 'Änderung' : 'Änderungen'}${first}.`;
    bar.append(text);
    if (!info.branch || info.branch === 'main') {
      const update = el('button', 'wf-update-go', 'Jetzt aktualisieren');
      update.type = 'button';
      update.addEventListener('click', async () => {
        update.disabled = true;
        update.textContent = 'Holt den neuen Stand …';
        try {
          const response = await fetch('/api/testkopie/aktualisieren', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || 'Aktualisieren ging nicht.');
          text.textContent = 'Neuer Stand geholt. Workflow startet neu …';
          update.remove();
          await waitForRestart();
          location.reload();
        } catch (error) {
          text.textContent = error.message;
          update.disabled = false;
          update.textContent = 'Nochmal versuchen';
        }
      });
      bar.append(update);
    }
    const later = el('button', 'wf-update-later', 'Später');
    later.type = 'button';
    later.addEventListener('click', () => { try { sessionStorage.setItem(HIDE_KEY, String(info.behind)); } catch { /* egal */ } bar.remove(); });
    bar.append(later);
    document.body.append(bar);
  }

  async function check() {
    let info;
    try { info = await (await fetch('/api/workflow/version')).json(); } catch { return; }
    if (!info?.available || !info.behind) { bar?.remove(); return; }
    let hidden = null;
    try { hidden = sessionStorage.getItem(HIDE_KEY); } catch { /* egal */ }
    if (hidden === String(info.behind)) return;
    render(info);
  }

  setTimeout(check, 6000);
  setInterval(check, 30 * 60_000);
})();
