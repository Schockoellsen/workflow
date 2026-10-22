// Werkzeuge-Seite (Ausbau 2026-10-22): Worky prüft sich selbst (Roblox-Doku, Lune-Rechentests, Browser-Spiel-Test,
// Godot), Sicherung mit einem Klick, eigene Vorlagen und die Tastenkürzel. Steht oben im Bereich „Werkzeuge“.
// Herunterladen oder Einspielen passiert nur nach Timos Klick.
(() => {
  const area = document.querySelector('details[data-bereich="werkzeuge"]');
  const project = window.workflowProject || null;
  if (!area) return;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  async function api(url, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(url, method === 'GET' ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Workflow antwortet gerade nicht.');
    return data;
  }
  const when = (iso) => { try { return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  const button = (label, className, onClick) => {
    const node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  };
  // Knopf während der Arbeit sperren und Text zeigen
  async function busy(node, label, work) {
    const before = node.textContent;
    node.disabled = true;
    node.textContent = label;
    try { return await work(); } finally { node.disabled = false; node.textContent = before; }
  }

  const panel = el('div', 'wz-panel');
  panel.id = 'wz-panel';
  area.querySelector('summary').after(panel);

  // ---------- Worky prüft sich selbst ----------
  const checks = el('section', 'wz-card');
  const checkList = el('div', 'wz-rows');
  checks.append(el('h3', '', 'Worky prüft sich selbst'), el('p', 'wz-hint', 'Damit Fehler auffallen, bevor du testest. Downloads nur nach deinem Klick, alles bleibt auf deinem PC.'), checkList);

  function row(title, text) {
    const item = el('div', 'wz-row');
    const head = el('div', 'wz-row-head');
    const copy = el('div');
    copy.append(el('strong', '', title), el('small', '', text));
    const actions = el('div', 'wz-actions');
    head.append(copy, actions);
    const out = el('div', 'wz-out');
    out.hidden = true;
    item.append(head, out);
    checkList.append(item);
    return { item, actions, out, small: copy.querySelector('small') };
  }
  const show = (out, ...nodes) => { out.replaceChildren(...nodes); out.hidden = !nodes.length; };

  function testResults(result) {
    const box = el('div', 'wz-results');
    if (!result.files) { box.append(el('p', '', result.hint)); return box; }
    box.append(el('strong', result.passed === result.files ? 'wz-ok' : 'wz-bad', `${result.passed} von ${result.files} Tests bestanden`));
    for (const item of result.results) {
      const line = el('details', item.ok ? 'wz-test ok' : 'wz-test bad');
      line.append(el('summary', '', `${item.ok ? '✅' : '❌'} ${item.file}`), el('pre', '', item.output || '(keine Ausgabe)'));
      if (!item.ok) line.open = true;
      box.append(line);
    }
    return box;
  }

  async function renderChecks() {
    checkList.replaceChildren();
    let info;
    try { info = await api('/api/werkzeuge'); } catch (error) { checkList.append(el('p', 'wz-bad', error.message)); return; }
    const kind = info.kind;
    const always = row('Prüfen nach jeder Änderung', 'Immer an: Nach jeder Datei, die Worky schreibt, prüft Workflow Syntax (JavaScript, JSON, Luau) und bei Roblox selene-Fehler. Worky sieht Fehler sofort und repariert sie.');
    always.actions.append(el('span', 'wz-pill ok', 'an'));

    if (kind === 'roblox') {
      const docs = row('Roblox-Doku zum Nachschlagen', info.docs.installed
        ? `Liegt auf deinem PC (Stand ${when(info.docs.updatedAt)}). Worky schlägt dort nach, statt zu raten.`
        : 'Die offizielle Roblox-Doku (Anleitungen + API-Referenz, ca. 30 MB) auf deinen PC holen. Dann schlägt Worky nach, statt zu raten.');
      const get = button(info.docs.installed ? 'Aktualisieren' : 'Doku holen', 'outline-button', () => busy(get, 'Lädt … (1–3 Minuten)', async () => {
        try { const result = await api('/api/werkzeuge/doku', {}); docs.small.textContent = `Liegt auf deinem PC (Stand ${when(result.updatedAt)}). Worky schlägt dort nach, statt zu raten.`; get.textContent = 'Aktualisieren'; show(docs.out, el('p', 'wz-ok', 'Fertig. Ab dem nächsten Auftrag nutzt Worky die Doku.')); }
        catch (error) { show(docs.out, el('p', 'wz-bad', error.message)); }
      }));
      docs.actions.append(get);
      docs.item.append(el('small', 'wz-legal', 'Quelle: github.com/Roblox/creator-docs (Texte CC BY 4.0, Code-Beispiele MIT).'));
    }

    if (kind === 'roblox' || kind === 'andere') {
      const lune = row('Rechen-Tests mit Lune', info.lune.installed
        ? `Lune ${info.lune.version} ist da. Tests liegen im Projekt unter tests/ (Worky schreibt sie für dich, z. B. „Schreib Rechen-Tests für die Preise“).`
        : 'Kleines Gratis-Programm, das Luau ohne Studio ausführt. Damit testet Worky Wirtschaft, Preise und Spielstand selbst (Download ca. 10 MB von GitHub).');
      const install = button(info.lune.installed ? 'Neu holen' : 'Lune holen', 'outline-button', () => busy(install, 'Lädt …', async () => {
        try { const result = await api('/api/werkzeuge/lune', {}); show(lune.out, el('p', 'wz-ok', `Lune ${result.version} ist installiert.`)); void renderChecks(); }
        catch (error) { show(lune.out, el('p', 'wz-bad', error.message)); }
      }));
      lune.actions.append(install);
      if (info.lune.installed) {
        const run = button('Tests starten', 'primary-button', () => busy(run, 'Läuft …', async () => {
          try { show(lune.out, testResults(await api('/api/werkzeuge/lune/testen', {}))); } catch (error) { show(lune.out, el('p', 'wz-bad', error.message)); }
        }));
        lune.actions.append(run);
      }
    }

    if (kind === 'web') {
      const game = row('Spiel selbst testen', info.browser
        ? `Workflow öffnet dein Spiel unsichtbar in ${info.browser}, lässt es 5 Sekunden laufen und zeigt Bild und Konsole. Worky macht das nach jeder Änderung selbst.`
        : 'Dafür braucht Workflow Edge oder Chrome, es wurde aber keiner gefunden.');
      if (info.browser) {
        const run = button('Jetzt testen', 'primary-button', () => busy(run, 'Läuft …', async () => {
          try {
            const result = await api('/api/werkzeuge/spiel/testen', {});
            const img = el('img', 'wz-shot');
            img.src = `data:image/png;base64,${result.image}`;
            img.alt = 'Bildschirmfoto deines Spiels';
            const lines = el('ul', 'wz-console');
            for (const line of result.console) lines.append(el('li', line.error ? 'bad' : '', `${line.text} (${line.source})`));
            if (!result.console.length) lines.append(el('li', '', 'Konsole leer.'));
            const summary = el('strong', result.errors ? 'wz-bad' : 'wz-ok', result.errors ? `${result.errors} Fehler in der Konsole` : 'Keine Fehler in der Konsole');
            show(game.out, summary, ...(result.maybeEmpty ? [el('p', 'wz-bad', 'Das Bild ist fast einfarbig, vielleicht zeigt das Spiel nichts an.')] : []), img, lines);
          } catch (error) { show(game.out, el('p', 'wz-bad', error.message)); }
        }));
        game.actions.append(run);
      }
    }

    if (kind === 'godot') {
      const godot = row('Godot ohne Fenster', info.godot.installed
        ? `Gefunden: ${info.godot.file} (${info.godot.version}). Worky startet dein Spiel unsichtbar und liest die Fehler.`
        : 'Godot wurde nicht gefunden. Trag unten den Pfad zur Godot-Datei ein (am besten die …_console.exe aus dem Godot-Download).');
      const form = el('form', 'wz-inline');
      const input = el('input');
      input.placeholder = 'C:\\Users\\…\\Godot_v4.3-stable_win64_console.exe';
      input.value = info.godot.file || '';
      input.setAttribute('aria-label', 'Pfad zur Godot-Datei');
      const save = el('button', 'outline-button', 'Speichern');
      save.type = 'submit';
      form.append(input, save);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        try { await api('/api/werkzeuge/godot', { path: input.value }); void renderChecks(); } catch (error) { show(godot.out, el('p', 'wz-bad', error.message)); }
      });
      godot.item.append(form);
      if (info.godot.installed) {
        const run = button('Godot-Test starten', 'primary-button', () => busy(run, 'Läuft …', async () => {
          try {
            const result = await api('/api/werkzeuge/godot/testen', {});
            show(godot.out, el('strong', result.errors.length ? 'wz-bad' : 'wz-ok', result.errors.length ? `${result.errors.length} Fehlerzeilen` : 'Keine Fehler gefunden'), el('pre', '', (result.errors.length ? result.errors.join('\n') + '\n\n' : '') + result.output));
          } catch (error) { show(godot.out, el('p', 'wz-bad', error.message)); }
        }));
        godot.actions.append(run);
      }
    }

    if (kind === 'roblox') {
      const photos = row('Vorher/Nachher-Bilder', 'Bei Änderungen an Optik fotografiert Worky feste Punkte in Studio (docs/Fotopunkte.md) vorher und nachher und zeigt beide Bilder im Chat.');
      photos.actions.append(button('Auftrag vorbereiten', 'outline-button', () => {
        const input = document.querySelector('#claude-question');
        if (!input) return;
        input.value = 'Mach Vorher/Nachher-Bilder von den Fotopunkten (docs/Fotopunkte.md) für: ';
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }));
    }
  }

  // ---------- Sicherung ----------
  const backup = el('section', 'wz-card');
  const backupList = el('div', 'wz-rows');
  const backupSay = el('p', 'wz-hint');
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.hidden = true;
  const browserData = () => {
    const data = {};
    try { for (let index = 0; index < localStorage.length; index += 1) { const key = localStorage.key(index); data[key] = localStorage.getItem(key); } } catch { /* gesperrt */ }
    return data;
  };
  function download(name, text) {
    const link = el('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    link.download = name;
    document.body.append(link);
    link.click();
    setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 2000);
  }
  async function restore(body, label) {
    if (!confirm(`${label} einspielen? Dein jetziger Stand wird vorher automatisch gesichert, du kannst also zurück.`)) return;
    try {
      const result = await api('/api/sicherung/einspielen', { ...body, browser: browserData() });
      try { for (const [key, value] of Object.entries(result.browser || {})) localStorage.setItem(key, value); } catch { /* Speicher voll */ }
      backupSay.textContent = `Eingespielt (${result.written} Dateien). Workflow lädt neu …`;
      setTimeout(() => location.reload(), 1200);
    } catch (error) { backupSay.textContent = error.message; }
  }
  const make = button('Jetzt sichern', 'primary-button', () => busy(make, 'Sichert …', async () => {
    try {
      const result = await api('/api/sicherung/erstellen', { browser: browserData() });
      backupSay.textContent = `Gesichert. Die Datei lädt jetzt herunter; eine Kopie bleibt in Workflow (Ordner app/sicherungen).`;
      location.href = `/api/sicherung/datei?name=${encodeURIComponent(result.name)}`;
      void renderBackups();
    } catch (error) { backupSay.textContent = error.message; }
  }));
  const load = button('Sicherung einspielen …', 'outline-button', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch { backupSay.textContent = 'Das ist keine Workflow-Sicherung.'; return; }
    await restore({ backup: parsed }, `Die Sicherung „${file.name}“`);
  });
  const backupActions = el('div', 'wz-actions');
  backupActions.append(make, load, fileInput);
  backup.append(el('h3', '', 'Sicherung'), el('p', 'wz-hint', 'Projektliste, Chats, Ideen, Gelerntes und Einstellungen in einer Datei. Einmal am Tag sichert Workflow von selbst. Deine Spiel-Projekte selbst sichert Git/GitHub.'), backupActions, backupSay, backupList);

  async function renderBackups() {
    let data;
    try { data = await api('/api/sicherung'); } catch { return; }
    backupList.replaceChildren();
    for (const item of data.sicherungen.slice(0, 6)) {
      const line = el('div', 'wz-line');
      const label = { auto: 'automatisch', hand: 'von dir', 'vor-einspielen': 'vor dem Einspielen' }[item.reason] || item.reason;
      line.append(el('span', '', `${when(item.createdAt.replace(/T(\d\d)-(\d\d)-(\d\d)$/, 'T$1:$2:$3Z'))} · ${label} · ${Math.max(1, Math.round(item.size / 1024))} KB`));
      const get = el('a', 'tiny-action', 'Herunterladen');
      get.href = `/api/sicherung/datei?name=${encodeURIComponent(item.name)}`;
      line.append(get, button('Einspielen', 'tiny-action', () => void restore({ name: item.name }, 'Diese Sicherung')));
      backupList.append(line);
    }
    // Automatische Sicherung: einmal am Tag beim Öffnen (mit den Chats aus dem Browser)
    if (data.autoFaellig) {
      try { await api('/api/sicherung/auto', { browser: browserData() }); void renderBackups(); } catch { /* nächstes Mal */ }
    }
  }

  // ---------- Eigene Vorlagen ----------
  const templates = el('section', 'wz-card');
  const templateList = el('div', 'wz-rows');
  const templateSay = el('p', 'wz-hint');
  const nameInput = el('input');
  nameInput.maxLength = 60;
  nameInput.placeholder = project ? `${project.name} (Vorlage)` : 'Name der Vorlage';
  nameInput.setAttribute('aria-label', 'Name der Vorlage');
  const saveTemplate = el('button', 'outline-button', 'Als Vorlage speichern');
  saveTemplate.type = 'submit';
  const templateForm = el('form', 'wz-inline');
  templateForm.append(nameInput, saveTemplate);
  templateForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!project) return;
    void busy(saveTemplate, 'Kopiert …', async () => {
      try {
        const result = await api('/api/projekte/vorlage-speichern', { id: project.id, name: nameInput.value });
        templateSay.textContent = `Gespeichert: „${result.vorlage.name}“ (${result.vorlage.files} Dateien). Beim nächsten „Neues Projekt“ kannst du sie auswählen.`;
        nameInput.value = '';
        renderTemplates(result.vorlagen);
      } catch (error) { templateSay.textContent = error.message; }
    });
  });
  templates.append(el('h3', '', 'Eigene Vorlagen'), el('p', 'wz-hint', 'Mach aus diesem Projekt eine Vorlage: Das nächste Spiel startet dann mit deinem Code, deinen Regeln, Skills und dem Tresor-Wissen (ohne Chatverlauf und ohne Schlüssel).'), templateForm, templateSay, templateList);
  function renderTemplates(list) {
    templateList.replaceChildren();
    for (const item of list) {
      const line = el('div', 'wz-line');
      line.append(el('span', '', `⭐ ${item.name} · ${item.kindLabel} · ${item.files} Dateien`));
      line.append(button('Löschen', 'tiny-action', async () => {
        if (!confirm(`Vorlage „${item.name}“ löschen? Deine Projekte bleiben, wie sie sind.`)) return;
        try { renderTemplates((await api('/api/projekte/vorlage-loeschen', { id: item.id })).vorlagen); } catch (error) { templateSay.textContent = error.message; }
      }));
      templateList.append(line);
    }
  }

  // ---------- Tastenkürzel ----------
  const keys = el('section', 'wz-card');
  const keyList = el('dl', 'wz-keys');
  for (const [combo, text] of window.workflowShortcuts || []) keyList.append(el('dt', '', combo), el('dd', '', text));
  keys.append(el('h3', '', 'Tastenkürzel'), keyList);

  panel.append(checks, backup, templates, keys);
  if (!project) { checks.hidden = true; templates.hidden = true; }
  // Erst laden, wenn der Bereich aufgeht (oder schon offen ist); Sicherung sofort, wegen der automatischen
  let loaded = false;
  const loadAll = () => {
    if (loaded || !project) return;
    loaded = true;
    void renderChecks();
    api('/api/projekte/vorlagen').then((data) => renderTemplates(data.vorlagen)).catch(() => {});
  };
  area.addEventListener('toggle', () => { if (area.open) loadAll(); });
  if (area.open) loadAll();
  setTimeout(() => void renderBackups(), 15_000);
})();
