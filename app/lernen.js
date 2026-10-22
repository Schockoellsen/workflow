// Worky lernt (Workflow Paket 4): Daumen an Worky-Antworten, Lern-Runde nach Aufträgen und die Seite „Worky lernt“.
// Vorschläge landen erst nach Timos Klick auf „Übernehmen“ im Tresor (Server: /api/lernen…).
(() => {
  const project = window.workflowProject || null;
  const badge = document.querySelector('#learn-count');

  async function api(url, body) {
    const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Worky lernt gerade nicht.');
    return data;
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function setBadge(count) {
    if (!badge) return;
    badge.textContent = String(count);
    badge.hidden = !count;
  }
  async function refreshBadge() {
    if (!project) return;
    try { setBadge((await api('/api/lernen')).proposals.length); } catch { /* Server kurz weg: Zähler bleibt */ }
  }

  // Kleine Zeile unter der Antwort, die sagt, was die Lern-Runde gefunden hat
  function noteUnder(bubble, text) {
    let line = bubble.item.querySelector('.wl-note');
    if (!line) { line = el('div', 'wl-note'); bubble.item.append(line); }
    line.textContent = text;
    if (text.includes('Vorschlag')) {
      const open = el('button', 'wl-link', 'Ansehen');
      open.type = 'button';
      open.addEventListener('click', () => void showPage());
      line.append(' ', open);
    }
  }
  function reportRound(bubble, result) {
    if (typeof result.open === 'number') setBadge(result.open);
    if (result.added) noteUnder(bubble, `🧠 Worky hat ${result.added === 1 ? 'einen Lern-Vorschlag' : `${result.added} Lern-Vorschläge`} für dich.`);
  }

  // 👍 / 👎 unter einer Worky-Antwort. 👎 fragt kurz, was falsch war, und startet die Lern-Runde.
  function addThumbs(bubble, info) {
    const row = el('div', 'wl-thumbs');
    const label = el('span', 'wl-thumbs-label', 'War das hilfreich?');
    const up = el('button', 'wl-thumb', '👍');
    const down = el('button', 'wl-thumb', '👎');
    up.type = down.type = 'button';
    up.setAttribute('aria-label', 'Gute Antwort');
    down.setAttribute('aria-label', 'Schlechte Antwort');
    row.append(label, up, down);
    bubble.item.append(row);
    const done = (text) => { row.replaceChildren(el('span', 'wl-thumbs-label', text)); };
    up.addEventListener('click', async () => {
      done('Danke! 👍');
      try { await api('/api/lernen/daumen', { rating: 'up', question: info.question, answer: info.answer }); } catch { done('Konnte die Bewertung nicht speichern.'); }
    });
    down.addEventListener('click', () => {
      const form = el('form', 'wl-why-form');
      const input = el('input');
      input.placeholder = 'Was war falsch? (optional)';
      input.maxLength = 600;
      input.setAttribute('aria-label', 'Was war falsch?');
      const send = el('button', 'wl-send', 'Senden');
      send.type = 'submit';
      form.append(input, send);
      row.replaceChildren(form);
      input.focus();
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        done('Danke. Worky denkt darüber nach, was er daraus lernt …');
        try {
          const result = await api('/api/lernen/daumen', { rating: 'down', question: info.question, answer: info.answer, activity: info.activity, note: input.value });
          done(result.added ? 'Danke für dein 👎.' : 'Danke für dein 👎. Diesmal hat Worky nichts Neues zum Merken gefunden.');
          reportRound(bubble, result);
        } catch (error) { done(`Bewertung gespeichert, aber die Lern-Runde ging nicht: ${error.message}`); }
      });
    });
  }

  window.workflowLearn = {
    afterAnswer(bubble, info) {
      addThumbs(bubble, info);
      if (!info.autoRound) return;
      void api('/api/lernen/runde', { source: 'auftrag', question: info.question, answer: info.answer, activity: info.activity })
        .then((result) => reportRound(bubble, result)).catch(() => { /* Lern-Runde ist ein Extra, Fehler nicht stören */ });
    },
    afterError(bubble, question, message) {
      void api('/api/lernen/runde', { source: 'fehler', question, answer: '', error: message })
        .then((result) => reportRound(bubble, result)).catch(() => {});
    }
  };

  // ---------- Seite „Worky lernt“ ----------
  const TAGS = { stolperstein: 'wl-tag-err', regel: 'wl-tag-rule', allgemein: 'wl-tag-all', skill: 'wl-tag-skill', app: 'wl-tag-app' };
  const SOURCES = { auftrag: 'nach einem Auftrag', daumen: 'nach deinem 👎', fehler: 'nach einem Fehler', verbesserung: 'aus der Verbesserungs-Runde', timo: 'deine Idee', tag: 'aus der Tages-Runde' };
  let pollTimer = null;
  const when = (iso) => { try { return new Date(iso).toLocaleString('de-DE', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  function button(text, className, onClick) {
    const node = el('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  // ---------- Testkopie (Paket 5): Worky baut App-Verbesserungen getrennt, Timo probiert aus und entscheidet ----------
  const COPY_TITLES = {
    baut: '🔧 Worky baut in der Testkopie',
    pruefen: '🔍 Der Prüfer schaut sich die Änderung an',
    fertig: '🧪 Fertig zum Ausprobieren',
    gesperrt: '⛔ Gestoppt',
    fehler: '⚠️ Das hat nicht geklappt',
    pr: '✅ Als Pull Request auf GitHub'
  };
  function renderCopy(box, copy) {
    clearTimeout(pollTimer);
    box.replaceChildren();
    box.hidden = !copy || copy.status === 'leer';
    if (box.hidden) return;
    box.dataset.state = copy.status;
    box.append(el('span', 'wl-copy-kicker', 'Testkopie von Workflow'), el('h3', '', COPY_TITLES[copy.status] || copy.status), el('p', 'wl-copy-title', `„${copy.titel}“`));
    const say = el('p', 'wl-saved');
    const act = (path, confirmText) => async (event) => {
      if (confirmText && !confirm(confirmText)) return;
      const knob = event.currentTarget;
      knob.disabled = true;
      say.textContent = 'Einen Moment …';
      try {
        const next = await api(`/api/testkopie/${path}`, {});
        if (path === 'starten') window.open(next.url, '_blank', 'noopener');
        if (path === 'aktualisieren') {
          say.textContent = next.changed ? 'Neuer Stand geholt. Workflow startet neu, die Seite lädt gleich neu …' : 'Workflow ist schon auf dem neuesten Stand.';
          if (next.changed) setTimeout(() => location.reload(), 5000);
          knob.disabled = false;
          return;
        }
        if (path === 'verwerfen' || path === 'uebernehmen') { void showPage(); return; }
        renderCopy(box, next);
      } catch (error) { say.textContent = error.message; knob.disabled = false; }
    };
    if (copy.status === 'baut' || copy.status === 'pruefen') {
      box.append(el('div', 'wl-copy-run'), el('p', '', `Gestartet ${when(copy.startedAt)}. Das dauert meist 5 bis 30 Minuten. Du kannst solange weiterarbeiten.`));
      pollTimer = setTimeout(async () => {
        if (!box.isConnected) return;
        try { renderCopy(box, await api('/api/testkopie')); } catch { renderCopy(box, copy); }
      }, 5000);
      return;
    }
    if (copy.status === 'fertig') {
      if (copy.summary) box.append(el('p', 'wl-copy-summary', copy.summary));
      if (copy.files?.length) box.append(el('p', 'wl-reason', `Geändert: ${copy.files.join(', ')}`));
      if (copy.review) box.append(el('p', copy.reviewWarn ? 'wl-copy-warn' : 'wl-reason', `Prüfer: ${copy.review}`));
      const actions = el('div', 'wl-actions');
      actions.append(
        button(copy.server ? 'Testkopie öffnen' : 'Testkopie starten', 'wl-take', act('starten')),
        button('Übernehmen', 'wl-skip', act('uebernehmen', 'Übernehmen lädt die Änderung als Pull Request zu GitHub hoch. Mergen machst du danach selbst. Weiter?')),
        button('Verwerfen', 'wl-skip', act('verwerfen', 'Testkopie mit allen Änderungen löschen?'))
      );
      box.append(el('p', 'wl-reason', 'Die Testkopie läuft auf Port 4181 neben deinem echten Workflow und arbeitet in denselben Projekten. Probier die Änderung dort aus.'), actions, say);
      return;
    }
    if (copy.status === 'pr') {
      const line = el('p', '');
      if (copy.prUrl) {
        const link = el('a', '', 'Pull Request öffnen');
        link.href = copy.prUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        line.append(link, ' · Merge ihn auf GitHub, dann klick „Workflow aktualisieren“.');
      } else line.textContent = `Der Zweig ${copy.branch} ist auf GitHub. Leg den Pull Request in GitHub Desktop an („Create Pull Request“), merge ihn, dann klick „Workflow aktualisieren“.`;
      const actions = el('div', 'wl-actions');
      actions.append(button('Workflow aktualisieren', 'wl-take', act('aktualisieren')));
      box.append(line, actions, say);
      return;
    }
    // gesperrt oder fehler
    box.append(el('p', 'wl-copy-warn', copy.reason || 'Unbekannter Fehler.'));
    const actions = el('div', 'wl-actions');
    actions.append(button('Testkopie verwerfen', 'wl-take', act('verwerfen', 'Testkopie mit allen Änderungen löschen? Die Idee bleibt als Vorschlag stehen.')));
    box.append(actions, say);
  }

  function stat(label, value, hint) {
    const card = el('div', 'wl-stat');
    card.append(el('span', 'wl-stat-label', label), el('strong', '', String(value)), el('span', 'wl-stat-hint', hint));
    return card;
  }

  function toggle(text, hint, checked, onChange) {
    const label = el('label', 'wl-toggle');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = checked;
    box.addEventListener('change', () => onChange(box.checked, box));
    const copy = el('span');
    copy.append(el('strong', '', text), el('small', '', hint));
    label.append(box, copy);
    return label;
  }

  async function showPage() {
    if (!project) return;
    let data;
    let copy = null;
    try { [data, copy] = await Promise.all([api('/api/lernen'), api('/api/testkopie').catch(() => null)]); } catch (error) { alert(error.message); return; }
    document.querySelector('.wl-page')?.remove();
    const layer = el('div', 'ws-layer ws-projects wl-page');
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-label', 'Worky lernt');
    const close = () => { clearTimeout(pollTimer); layer.classList.add('ws-leaving'); setTimeout(() => layer.remove(), 400); };

    const head = el('header', 'ws-head');
    const back = el('button', 'wl-back', '← Zurück zu Worky');
    back.type = 'button';
    back.addEventListener('click', close);
    head.append(back, el('span', 'wl-crumb', data.project.name));

    const main = el('main', 'ws-main');
    const intro = el('div', 'wl-intro');
    intro.append(el('h1', '', 'Worky lernt'), el('p', '', 'Nach Aufträgen und nach jedem 👎 schaut Worky, was er daraus lernen kann. Was er sich merken will, schlägt er dir hier vor. Erst wenn du „Übernehmen“ klickst, schreibt er es in den Tresor und liest es vor jeder Arbeit.'));

    const stats = el('div', 'wl-stats');
    stats.append(
      stat('Fehler gemerkt', data.stats.fehler, 'in Stolpersteine.md'),
      stat('Regeln', data.stats.regeln, 'in Wissensdatenbank.md'),
      stat('Fähigkeiten', data.stats.faehigkeiten, 'feste Abläufe (Skills)'),
      stat('Bewertungen', `${data.stats.daumenHoch} 👍 · ${data.stats.daumenRunter} 👎`, 'in diesem Projekt')
    );

    const columns = el('div', 'wl-columns');
    const left = el('section', 'wl-left');
    left.setAttribute('aria-label', 'Vorschläge');
    const copyBox = el('section', 'wl-copy');
    copyBox.setAttribute('aria-live', 'polite');
    renderCopy(copyBox, copy);
    left.append(copyBox, el('h2', '', 'Worky schlägt vor'));
    if (!data.proposals.length) left.append(el('p', 'wl-empty', 'Gerade keine Vorschläge. Nach dem nächsten Auftrag oder einem 👎 denkt Worky wieder nach.'));
    for (const item of data.proposals) {
      const card = el('article', 'wl-card');
      const top = el('div', 'wl-card-top');
      top.append(el('span', `wl-tag ${TAGS[item.art] || ''}`, data.kinds[item.art] || item.art), el('span', 'wl-why', `${SOURCES[item.source] || ''}${item.projectName && item.projectName !== data.project.name ? ` · aus ${item.projectName}` : ''}`));
      card.append(top, el('h3', '', item.titel));
      if (item.art === 'skill') {
        card.append(el('p', '', item.beschreibung || ''));
        const details = el('details', 'wl-skill');
        details.append(el('summary', '', `Anleitung ansehen (.claude/skills/${item.name})`), el('pre', '', item.text));
        card.append(details);
      } else card.append(el('p', 'wl-text', item.text));
      if (item.warum) card.append(el('p', 'wl-reason', `Warum: ${item.warum}`));
      const actions = el('div', 'wl-actions');
      const take = el('button', 'wl-take', item.art === 'app' ? 'In Testkopie bauen' : 'Übernehmen');
      const skip = el('button', 'wl-skip', 'Nein danke');
      take.type = skip.type = 'button';
      const decide = async (yes) => {
        take.disabled = skip.disabled = true;
        try {
          if (yes && item.art === 'app') {
            renderCopy(copyBox, await api('/api/testkopie/bauen', { id: item.id }));
            void refreshBadge();
            card.remove();
            copyBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
          }
          const result = await api('/api/lernen/entscheiden', { id: item.id, take: yes });
          setBadge(result.open);
          actions.replaceChildren(el('span', yes ? 'wl-done' : 'wl-done wl-no', !yes ? 'Abgelehnt. Worky schlägt das nicht nochmal vor.' : item.art === 'skill' ? `Übernommen. Die Fähigkeit liegt jetzt in .claude/skills/${item.name}.` : 'Übernommen. Gilt ab dem nächsten Auftrag.'));
        } catch (error) {
          take.disabled = skip.disabled = false;
          actions.append(el('span', 'wl-done wl-no', error.message));
        }
      };
      take.addEventListener('click', () => void decide(true));
      skip.addEventListener('click', () => void decide(false));
      actions.append(take, skip);
      card.append(actions);
      left.append(card);
    }

    const right = el('section', 'wl-right');
    right.setAttribute('aria-label', 'Zuletzt gelernt');
    right.append(el('h2', '', 'Zuletzt gelernt'));
    const list = el('div', 'wl-list');
    if (!data.learned.length) list.append(el('p', 'wl-empty', 'Noch nichts übernommen.'));
    for (const item of data.learned) {
      const row = el('div', 'wl-row');
      row.append(el('strong', '', item.titel), el('span', '', item.text));
      list.append(row);
    }
    right.append(list);
    const say = el('p', 'wl-saved');
    const saveSetting = async (key, value, box) => {
      try { await api('/api/lernen/einstellungen', { [key]: value }); say.textContent = 'Gespeichert.'; } catch (error) { box.checked = !value; say.textContent = error.message; }
    };
    // Tages-Runde von Hand: den heutigen Chatverlauf ansehen
    const daily = el('div', 'wl-daily');
    const dailySay = el('span', 'wl-saved');
    const dailyButton = button('Heutigen Tag jetzt durchsehen', 'wl-skip', async () => {
      dailyButton.disabled = true;
      dailySay.textContent = 'Worky liest den heutigen Chatverlauf …';
      try {
        const result = await api('/api/lernen/tagesrunde', {});
        setBadge(result.open);
        if (result.added) { void showPage(); return; }
        dailySay.textContent = 'Heute gab es nichts Neues zum Merken.';
      } catch (error) { dailySay.textContent = error.message; }
      dailyButton.disabled = false;
    });
    daily.append(dailyButton, dailySay);
    // Verbesserungs-Runde und eigene Ideen für Workflow
    const improve = el('div', 'wl-improve');
    const improveSay = el('p', 'wl-saved', data.lastImprove ? `Zuletzt nachgedacht: ${when(data.lastImprove)}` : 'Noch nie nachgedacht.');
    const think = button(data.improving ? 'Worky denkt nach …' : 'Jetzt nachdenken', 'wl-take', async () => {
      think.disabled = true;
      think.textContent = 'Worky denkt nach …';
      improveSay.textContent = 'Das dauert meist eine Minute.';
      try {
        const result = await api('/api/lernen/verbessern', {});
        setBadge(result.open);
        if (result.added) { void showPage(); return; }
        improveSay.textContent = 'Worky hat gerade nichts gefunden, was er besser machen sollte.';
      } catch (error) { improveSay.textContent = error.message; }
      think.disabled = false;
      think.textContent = 'Jetzt nachdenken';
    });
    think.disabled = Boolean(data.improving);
    improve.append(el('h3', '', 'Worky verbessert sich selbst'), el('p', '', 'Worky schaut sich deine 👎 und abgebrochene Aufträge an und schlägt Regeln, neue Fähigkeiten oder Verbesserungen an Workflow vor. Workflow selbst ändert er nur in einer Testkopie.'), think, improveSay);
    const idea = el('form', 'wl-idea');
    const ideaText = el('textarea');
    ideaText.rows = 3;
    ideaText.maxLength = 1500;
    ideaText.placeholder = 'Deine Idee für Workflow, z. B. „Zeig beim Projektwechsel, welches Projekt gerade offen ist.“';
    ideaText.setAttribute('aria-label', 'Deine Idee für Workflow');
    const ideaSend = el('button', 'wl-skip', 'In Testkopie bauen');
    ideaSend.type = 'submit';
    const ideaSay = el('p', 'wl-saved');
    idea.append(el('strong', '', 'Eigene Idee für Workflow'), ideaText, ideaSend, ideaSay);
    if (copy && !copy.available) { ideaSend.disabled = true; ideaSay.textContent = copy.why; }
    idea.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (ideaText.value.trim().length < 8) { ideaText.focus(); return; }
      ideaSend.disabled = true;
      try {
        renderCopy(copyBox, await api('/api/testkopie/bauen', { idee: ideaText.value }));
        ideaText.value = '';
        ideaSay.textContent = 'Worky baut, oben siehst du den Stand.';
        copyBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (error) { ideaSay.textContent = error.message; }
      ideaSend.disabled = false;
    });
    right.append(
      improve,
      idea,
      toggle('Von selbst nachdenken', 'Nach 3 schlechten Läufen (👎 oder Abbruch) eine Verbesserungs-Runde, höchstens einmal am Tag.', data.settings.autoImprove !== false, (value, box) => void saveSetting('autoImprove', value, box)),
      toggle('In alle Projekte mitnehmen', 'Allgemeines Wissen (Luau, Blender, Git) hilft auch beim nächsten Spiel.', data.settings.shareGeneral, (value, box) => void saveSetting('shareGeneral', value, box)),
      toggle('Lern-Runde nach Aufträgen', 'Nach jedem Gründlich-Auftrag, der Dateien ändert, eine kurze Claude-Anfrage. Ein 👎 startet sie immer.', data.settings.autoRound, (value, box) => void saveSetting('autoRound', value, box)),
      toggle('Tages-Runde', `Einmal am Tag liest Worky den Chatverlauf vom Vortag und schlägt vor, was er sich merken sollte.${data.lastDaily ? ` Zuletzt: ${data.lastDaily}.` : ''}`, data.settings.autoDaily !== false, (value, box) => void saveSetting('autoDaily', value, box)),
      daily,
      say
    );
    if (data.shared.length) {
      right.append(el('h2', '', 'Wissen für alle Projekte'));
      const shared = el('div', 'wl-list');
      for (const line of data.shared) {
        const match = /^- \*\*(.+?)\*\*\s*–?\s*(.*)$/.exec(line);
        const row = el('div', 'wl-row');
        row.append(el('strong', '', match ? match[1] : line.slice(2)), el('span', '', match ? match[2].replace(/\*/g, '') : ''));
        shared.append(row);
      }
      right.append(shared);
    }

    columns.append(left, right);
    main.append(intro, stats, columns);
    layer.append(head, main);
    document.body.append(layer);
    layer.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
    back.focus();
  }

  window.workflowShowLearning = showPage;
  document.querySelector('[data-worky-lernt]')?.addEventListener('click', () => void showPage());
  void refreshBadge();
})();
