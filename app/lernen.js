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
  const TAGS = { stolperstein: 'wl-tag-err', regel: 'wl-tag-rule', allgemein: 'wl-tag-all' };
  const SOURCES = { auftrag: 'nach einem Auftrag', daumen: 'nach deinem 👎', fehler: 'nach einem Fehler' };

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
    try { data = await api('/api/lernen'); } catch (error) { alert(error.message); return; }
    document.querySelector('.wl-page')?.remove();
    const layer = el('div', 'ws-layer ws-projects wl-page');
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-label', 'Worky lernt');
    const close = () => { layer.classList.add('ws-leaving'); setTimeout(() => layer.remove(), 400); };

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
    left.append(el('h2', '', 'Worky schlägt vor'));
    if (!data.proposals.length) left.append(el('p', 'wl-empty', 'Gerade keine Vorschläge. Nach dem nächsten Auftrag oder einem 👎 denkt Worky wieder nach.'));
    for (const item of data.proposals) {
      const card = el('article', 'wl-card');
      const top = el('div', 'wl-card-top');
      top.append(el('span', `wl-tag ${TAGS[item.art] || ''}`, data.kinds[item.art] || item.art), el('span', 'wl-why', `${SOURCES[item.source] || ''}${item.projectName && item.projectName !== data.project.name ? ` · aus ${item.projectName}` : ''}`));
      card.append(top, el('h3', '', item.titel), el('p', '', item.text));
      if (item.warum) card.append(el('p', 'wl-reason', `Warum: ${item.warum}`));
      const actions = el('div', 'wl-actions');
      const take = el('button', 'wl-take', 'Übernehmen');
      const skip = el('button', 'wl-skip', 'Nein danke');
      take.type = skip.type = 'button';
      const decide = async (yes) => {
        take.disabled = skip.disabled = true;
        try {
          const result = await api('/api/lernen/entscheiden', { id: item.id, take: yes });
          setBadge(result.open);
          actions.replaceChildren(el('span', yes ? 'wl-done' : 'wl-done wl-no', yes ? 'Übernommen. Gilt ab dem nächsten Auftrag.' : 'Abgelehnt. Worky schlägt das nicht nochmal vor.'));
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
    right.append(
      toggle('In alle Projekte mitnehmen', 'Allgemeines Wissen (Luau, Blender, Git) hilft auch beim nächsten Spiel.', data.settings.shareGeneral, (value, box) => void saveSetting('shareGeneral', value, box)),
      toggle('Lern-Runde nach Aufträgen', 'Nach jedem Gründlich-Auftrag, der Dateien ändert, eine kurze Claude-Anfrage. Ein 👎 startet sie immer.', data.settings.autoRound, (value, box) => void saveSetting('autoRound', value, box)),
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
