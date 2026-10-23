// Arbeitsplatz (Workflow Paket 2): Seitenleiste links, Worky in der Mitte, Bereiche als Schublade rechts.
// Ein Klick auf Ideen, Aufgaben, Änderungen … öffnet die Schublade mit genau diesem Bereich,
// „Worky“ oder × schließt sie wieder. Reine Darstellung, keine Daten.
(() => {
  const app = document.querySelector('#wf-app');
  const drawer = document.querySelector('.wf-drawer');
  if (!app || !drawer) return;
  const title = drawer.querySelector('#wf-drawer-title');
  const navButtons = [...document.querySelectorAll('[data-bereich-knopf]')];
  const areas = [...drawer.querySelectorAll('[data-bereich]')];
  const KEY = window.workflowKey ? window.workflowKey('workflow-bereich') : 'workflow-bereich';
  const TITLES = { ideen: 'Ideen', aufgaben: 'Aufgaben', aenderungen: 'Änderungen', prompt: 'Prompt-Ersteller', team: 'KI-Team', werkbaenke: 'Werkbänke', nacht: 'Nacht-Schicht', material: 'Material', werkzeuge: 'Werkzeuge & Assets', tresor: 'Obsidian-Tresor' };
  // Unter dieser Breite liegt die Schublade über dem Chat statt daneben
  const overlay = window.matchMedia('(max-width: 1100px)');

  function markNav(name) {
    for (const button of navButtons) {
      const active = button.dataset.bereichKnopf === name;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  }

  function remember(name) { try { sessionStorage.setItem(KEY, name); } catch { /* privates Fenster */ } }

  function show(name) {
    if (!TITLES[name]) return close();
    for (const area of areas) {
      const visible = area.dataset.bereich.split(' ').includes(name);
      area.classList.toggle('wf-shown', visible);
      if (visible && area.tagName === 'DETAILS') area.open = true;
    }
    title.textContent = TITLES[name];
    app.classList.add('wf-drawer-open');
    drawer.scrollTop = 0;
    markNav(name);
    remember(name);
  }

  function close() {
    app.classList.remove('wf-drawer-open');
    markNav('worky');
    remember('worky');
  }

  for (const button of navButtons) {
    button.addEventListener('click', () => {
      const name = button.dataset.bereichKnopf;
      if (name === 'worky' || (app.classList.contains('wf-drawer-open') && button.classList.contains('active'))) {
        close();
        document.querySelector('#claude-question')?.focus({ preventScroll: true });
      } else show(name);
    });
  }
  drawer.querySelector('[data-bereich-schliessen]')?.addEventListener('click', close);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay.matches && app.classList.contains('wf-drawer-open') && !document.querySelector('dialog[open]')) close();
  });
  // Knöpfe, die etwas in den Chat schreiben: bei schmalem Fenster die Schublade schließen, damit man den Chat sieht
  drawer.addEventListener('click', (event) => {
    if (overlay.matches && event.target.closest('[data-fill], #prompt-to-worky')) close();
  });

  // Chat-Partner-Auswahl so breit wie der gewählte Name (wie eine Überschrift mit Pfeil)
  const provider = document.querySelector('.wf-chat-who #chat-provider');
  const fitProvider = () => {
    if (!provider || !provider.selectedOptions[0]) return;
    const style = getComputedStyle(provider);
    const context = document.createElement('canvas').getContext('2d');
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const text = context.measureText(provider.selectedOptions[0].textContent).width;
    provider.style.width = Math.ceil(text + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 4) + 'px';
  };
  provider?.addEventListener('change', fitProvider);
  fitProvider();
  document.fonts?.ready.then(fitProvider);

  window.workflowShowArea = show;

  let last = null;
  try { last = sessionStorage.getItem(KEY); } catch { /* privates Fenster */ }
  if (last && TITLES[last] && !overlay.matches) show(last);
})();
