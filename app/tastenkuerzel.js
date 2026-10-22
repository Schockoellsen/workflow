// Tastenkürzel (Ausbau 2026-10-22). Strg+N, Strg+T und Strg+W gehören dem Browser und lassen sich nicht belegen,
// deshalb Alt+Buchstabe. Die Liste steht auch auf der Werkzeuge-Seite (window.workflowShortcuts).
(() => {
  const SHORTCUTS = [
    ['Strg + K', 'Projekte anzeigen und wechseln'],
    ['Alt + N', 'Neuer Chat mit Worky'],
    ['Esc', 'Worky stoppen (während er arbeitet)'],
    ['Strg + Enter', 'Nachricht senden'],
    ['/', 'In das Eingabefeld springen'],
    ['Alt + W', 'Werkzeuge öffnen'],
    ['Alt + L', 'Worky lernt öffnen'],
    ['Alt + Ä', 'Änderungen ansehen'],
    ['Strg + /', 'Diese Liste anzeigen']
  ];
  window.workflowShortcuts = SHORTCUTS;

  const typing = (target) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  // Liegt gerade eine eigene Seite (Projekte, Worky lernt, Start) oder ein Dialog oben, bleiben die Kürzel aus
  const overlayOpen = () => Boolean(document.querySelector('dialog[open], .ws-layer'));
  const click = (selector) => {
    const node = document.querySelector(selector);
    if (node && !node.hidden && !node.disabled) { node.click(); return true; }
    return false;
  };

  function showHelp() {
    let dialog = document.querySelector('#wf-keys-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'wf-keys-dialog';
      dialog.className = 'idea-dialog wz-keys-dialog';
      const form = document.createElement('form');
      form.method = 'dialog';
      const top = document.createElement('div');
      top.className = 'dialog-top';
      const title = document.createElement('h2');
      title.textContent = 'Tastenkürzel';
      const close = document.createElement('button');
      close.className = 'close-button';
      close.value = 'cancel';
      close.setAttribute('aria-label', 'Schließen');
      close.textContent = '×';
      top.append(title, close);
      const list = document.createElement('dl');
      list.className = 'wz-keys';
      for (const [combo, text] of SHORTCUTS) {
        const dt = document.createElement('dt');
        dt.textContent = combo;
        const dd = document.createElement('dd');
        dd.textContent = text;
        list.append(dt, dd);
      }
      form.append(top, list);
      dialog.append(form);
      document.body.append(dialog);
    }
    if (!dialog.open) dialog.showModal();
  }

  document.addEventListener('keydown', (event) => {
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && !event.altKey && !event.shiftKey && event.code === 'KeyK') {
      event.preventDefault();
      if (document.querySelector('dialog[open]')) return;
      window.workflowShowProjects?.();
      return;
    }
    if (ctrl && !event.altKey && (event.key === '/' || event.code === 'Slash')) { event.preventDefault(); showHelp(); return; }
    if (overlayOpen()) return;
    if (event.key === 'Escape' && !ctrl && !event.altKey) {
      // Erst Worky stoppen; sonst macht Esc, was es vorher gemacht hat (z. B. Schublade schließen)
      if (click('#worky-stop')) event.preventDefault();
      return;
    }
    if (event.altKey && !ctrl) {
      const actions = {
        KeyN: () => click('#worky-new-chat') && document.querySelector('#claude-question')?.focus(),
        KeyW: () => window.workflowShowArea?.('werkzeuge'),
        KeyL: () => window.workflowShowLearning?.(),
        Quote: () => window.workflowShowArea?.('aenderungen')
      };
      // Alt+Ä: auf deutschen Tastaturen liegt Ä auf der Taste „Quote“
      const action = actions[event.code] || (event.key.toLowerCase() === 'ä' ? actions.Quote : null);
      if (action) { event.preventDefault(); action(); }
      return;
    }
    if (event.key === '/' && !ctrl && !typing(event.target)) {
      const input = document.querySelector('#claude-question');
      if (input && !input.disabled) { event.preventDefault(); input.focus(); }
    }
  });
})();
