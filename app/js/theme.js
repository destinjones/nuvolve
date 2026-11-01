// Screen colour: "soft" (light grey, easier on the eyes) or "white" (bright white). Load in <head> so the page
// never flashes white first. The choice is kept on this phone or browser, like the language.
(function () {
  const KEY = 'nv_theme';
  const THEMES = [['soft', 'Soft grey'], ['white', 'Bright white']];
  const read = () => { try { return localStorage.getItem(KEY) === 'white' ? 'white' : 'soft'; } catch { return 'soft'; } };
  const apply = (t) => {
    document.documentElement.dataset.theme = t;
    document.querySelectorAll('.theme-pick button').forEach((b) => { b.classList.toggle('on', b.dataset.themeSet === t); b.setAttribute('aria-pressed', String(b.dataset.themeSet === t)); });
  };
  const NVTheme = {
    get: read,
    set(t) {
      t = t === 'white' ? 'white' : 'soft';
      try { localStorage.setItem(KEY, t); } catch { /* private mode */ }
      apply(t);
    },
    toggle() { NVTheme.set(read() === 'soft' ? 'white' : 'soft'); },
    // A two-button switch; any number on a page stay in step.
    picker() {
      const cur = read();
      return `<span class="theme-pick" role="group" aria-label="Screen colour">${THEMES.map(([k, label]) =>
        `<button type="button" data-theme-set="${k}" class="${k === cur ? 'on' : ''}" aria-pressed="${k === cur}">${label}</button>`).join('')}</span>`;
    },
  };
  apply(read());
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-theme-set], [data-theme-toggle]');
    if (!b) return;
    if (b.dataset.themeSet) NVTheme.set(b.dataset.themeSet); else NVTheme.toggle();
  });
  // Another tab changed it: follow along.
  window.addEventListener('storage', (e) => { if (e.key === KEY) apply(read()); });
  window.NVTheme = NVTheme;
})();
