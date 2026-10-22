// Hell/Nacht-Umschalter der Werkstatt. Merkt sich die Wahl im Browser (localStorage);
// ohne gespeicherte Wahl startet sie hell. Reine Darstellung.
(() => {
  const KEY = 'ie-werkstatt-theme';
  const root = document.documentElement;
  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const store = (value) => { try { localStorage.setItem(KEY, value); } catch { /* privates Fenster: nur für diese Sitzung */ } };
  const apply = (theme) => {
    root.dataset.theme = theme;
    const button = document.querySelector('#theme-toggle');
    if (button) {
      const dark = theme === 'dark';
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', dark ? 'Hellen Modus einschalten' : 'Nachtmodus einschalten');
      button.title = dark ? 'Hellen Modus einschalten' : 'Nachtmodus einschalten';
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f1117' : '#f5f6fa');
  };

  apply(read() === 'dark' ? 'dark' : 'light');

  document.addEventListener('DOMContentLoaded', () => {
    apply(root.dataset.theme);
    document.querySelector('#theme-toggle')?.addEventListener('click', () => {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.classList.add('theme-switching');
      apply(next);
      store(next);
      window.setTimeout(() => root.classList.remove('theme-switching'), 350);
    });
  });

})();
