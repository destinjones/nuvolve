// Runs first on every demo page: makes sure the demo's stand-in server (demo-sw.js) is answering,
// keeps the calendar on the day the demo company was recorded, and adds the small demo menu and save bar.
(function () {
  var APP = '/nuvolve/app', SITE = '/nuvolve', TODAY = '2026-11-02', SIGNUP = '/nuvolve/#waitlist';
  // This copy of the app has no server, so it can't open an account. Its sign-up form would take six fields and
  // go nowhere; send people to the real sign-up (built with --live) or the waitlist instead.
  function noFakeSignup() { if (location.hash === '#signup') location.replace(SIGNUP); }
  noFakeSignup();
  window.addEventListener('hashchange', noFakeSignup);
  if (!('serviceWorker' in navigator)) return;
  if (!navigator.serviceWorker.controller) {
    location.replace(APP + '/start.html?next=' + encodeURIComponent(location.pathname + location.search + location.hash));
    return;
  }

  // There's no server behind the demo, so its sign-up form can't open an account. Send visitors to the
  // early-access page instead of letting them fill in a form that goes nowhere.
  var BETA = (SITE === '/' ? '' : SITE) + '/beta.html?from=demo-signup';
  if (location.hash === '#signup') { location.replace(BETA); return; }
  window.addEventListener('hashchange', function () { if (location.hash === '#signup') location.replace(BETA); });

  // The demo company's "today" is the day it was recorded, so routes, the schedule and past-due all line up.
  var Real = Date;
  var mid = function (d) { return new Real(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  var parts = TODAY.split('-').map(Number);
  var OFF = new Real(parts[0], parts[1] - 1, parts[2]).getTime() - mid(new Real());
  function DemoDate() {
    var a = Array.prototype.slice.call(arguments);
    if (!(this instanceof DemoDate)) return new Real(Real.now() + OFF).toString();
    return a.length ? new (Function.prototype.bind.apply(Real, [null].concat(a)))() : new Real(Real.now() + OFF);
  }
  DemoDate.prototype = Real.prototype;
  DemoDate.now = function () { return Real.now() + OFF; };
  DemoDate.parse = Real.parse;
  DemoDate.UTC = Real.UTC;
  window.Date = DemoDate;

  var ROLES = [['owner', 'Owner'], ['office', 'Office rep'], ['manager', 'Branch manager'], ['tech', 'Technician'], ['sales', 'Sales rep']];
  function as(role) { location.href = APP + '/start.html?as=' + role; }
  // What visitors add or change is kept in this browser by demo-sw.js; the bar says so and starts it over.
  function reset() {
    if (!confirm('Reset the demo? Everything you added or changed in this browser goes back to how it started.')) return;
    try { Object.keys(localStorage).forEach(function (k) { if (/^nv_ticket_/.test(k)) localStorage.removeItem(k); }); } catch (e) { /* private mode */ }
    try { indexedDB.deleteDatabase('nuvolve-tech'); } catch (e) { /* no tech app outbox here */ }
    navigator.serviceWorker.controller.postMessage({ type: 'demo-reset' });
    setTimeout(function () { location.reload(); }, 3000);
  }
  var noteTimer;
  function note(text) {
    var el = document.querySelector('#nv-demo .nvd-msg');
    if (!el) return;
    el.classList.add('note');
    el.textContent = text;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { el.classList.remove('note'); el.innerHTML = BAR; }, 7000);
  }
  var BAR = '<span class="nvd-long">Demo: your changes are saved in this browser only.</span><span class="nvd-short">Saved in this browser only</span>';
  navigator.serviceWorker.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'demo-note') note(d.text);
    // A reset in any tab starts every open tab over.
    if (d.type === 'demo-state' && d.reset) location.reload();
  });
  function menu() {
    if (document.getElementById('nv-demo')) return;
    var css = document.createElement('style');
    css.textContent = '#nv-demo{position:fixed;right:12px;bottom:12px;z-index:9999;font:600 12px/1.2 system-ui,sans-serif;display:flex;align-items:center;gap:6px;max-width:calc(100vw - 24px)}' +
      '#nv-demo>button{background:#0b1210;color:#7ee2a8;border:1px solid #2f855a;border-radius:999px;padding:7px 12px;cursor:pointer;letter-spacing:.06em;box-shadow:0 4px 14px rgba(0,0,0,.25);flex:none}' +
      '#nv-demo .nvd-bar{display:flex;align-items:center;gap:8px;min-width:0;background:rgba(11,18,16,.94);color:#cfe3d7;border:1px solid #24352d;border-radius:999px;padding:4px 4px 4px 12px;font-weight:500;box-shadow:0 4px 14px rgba(0,0,0,.2)}' +
      '#nv-demo .nvd-msg{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#nv-demo .nvd-msg.note{color:#fbd38d;white-space:normal}' +
      '#nv-demo .nvd-bar button{background:#17241e;color:#7ee2a8;border:1px solid #2f855a;border-radius:999px;padding:4px 10px;cursor:pointer;font:inherit;font-weight:600;flex:none}' +
      '#nv-demo .m{display:none;position:absolute;right:0;bottom:38px;background:#0b1210;color:#e6efe9;border:1px solid #24352d;border-radius:10px;padding:10px;width:230px;box-shadow:0 10px 30px rgba(0,0,0,.35)}' +
      '#nv-demo.open .m{display:block}#nv-demo .m p{margin:0 0 8px;font-weight:400;color:#9fb5a8;line-height:1.4}' +
      '#nv-demo .m button,#nv-demo .m a{display:block;width:100%;text-align:left;background:none;border:0;color:#e6efe9;padding:7px 6px;border-radius:6px;cursor:pointer;font:inherit;text-decoration:none}' +
      '#nv-demo .m button:hover,#nv-demo .m a:hover{background:#17241e}' +
      '#nv-demo .nvd-short{display:none}@media (max-width:640px){#nv-demo .nvd-long{display:none}#nv-demo .nvd-short{display:inline}}' +
      '@media (max-width:860px){#nv-demo{bottom:76px}}';
    document.head.appendChild(css);
    var el = document.createElement('div');
    el.id = 'nv-demo';
    el.innerHTML = '<div class="nvd-bar" role="status"><span class="nvd-msg">' + BAR + '</span><button type="button" class="nvd-reset">Reset demo</button></div>' +
      '<button type="button" class="nvd-toggle" aria-expanded="false">DEMO ▾</button><div class="m"><p>Lone Star Pest Pros is a made-up company. Try anything: what you add or change is saved in this browser only.</p>' +
      ROLES.map(function (r) { return '<button type="button" data-as="' + r[0] + '">View as ' + r[1] + '</button>'; }).join('') +
      '<button type="button" data-as="portal">Customer pay page</button><a href="' + SITE + '">← Back to the Nuvolve site</a></div>';
    document.body.appendChild(el);
    var open = el.querySelector('.nvd-toggle');
    open.onclick = function () { el.classList.toggle('open'); open.setAttribute('aria-expanded', el.classList.contains('open')); };
    el.querySelector('.nvd-reset').onclick = reset;
    el.querySelectorAll('[data-as]').forEach(function (b) { b.onclick = function () { as(b.getAttribute('data-as')); }; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', menu); else menu();
})();
