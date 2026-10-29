// Runs first on every demo page: makes sure the demo's stand-in server (demo-sw.js) is answering,
// keeps the calendar on the day the demo company was recorded, and adds the small demo menu.
(function () {
  var APP = '/nuvolve/app', SITE = '/nuvolve', TODAY = '2026-10-29';
  if (!('serviceWorker' in navigator)) return;
  if (!navigator.serviceWorker.controller) {
    location.replace(APP + '/start.html?next=' + encodeURIComponent(location.pathname + location.search + location.hash));
    return;
  }

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
  function menu() {
    if (document.getElementById('nv-demo')) return;
    var css = document.createElement('style');
    css.textContent = '#nv-demo{position:fixed;right:12px;bottom:12px;z-index:9999;font:600 12px/1.2 system-ui,sans-serif}' +
      '#nv-demo>button{background:#0b1210;color:#7ee2a8;border:1px solid #2f855a;border-radius:999px;padding:7px 12px;cursor:pointer;letter-spacing:.06em;box-shadow:0 4px 14px rgba(0,0,0,.25)}' +
      '#nv-demo .m{display:none;position:absolute;right:0;bottom:38px;background:#0b1210;color:#e6efe9;border:1px solid #24352d;border-radius:10px;padding:10px;width:230px;box-shadow:0 10px 30px rgba(0,0,0,.35)}' +
      '#nv-demo.open .m{display:block}#nv-demo .m p{margin:0 0 8px;font-weight:400;color:#9fb5a8;line-height:1.4}' +
      '#nv-demo .m button,#nv-demo .m a{display:block;width:100%;text-align:left;background:none;border:0;color:#e6efe9;padding:7px 6px;border-radius:6px;cursor:pointer;font:inherit;text-decoration:none}' +
      '#nv-demo .m button:hover,#nv-demo .m a:hover{background:#17241e}' +
      '@media (max-width:860px){#nv-demo{bottom:76px}}';
    document.head.appendChild(css);
    var el = document.createElement('div');
    el.id = 'nv-demo';
    el.innerHTML = '<button type="button" aria-expanded="false">DEMO ▾</button><div class="m"><p>Lone Star Pest Pros is a made-up company. Look at anything; changes aren\'t saved.</p>' +
      ROLES.map(function (r) { return '<button type="button" data-as="' + r[0] + '">View as ' + r[1] + '</button>'; }).join('') +
      '<button type="button" data-as="portal">Customer pay page</button><a href="' + SITE + '">← Back to the Nuvolve site</a></div>';
    document.body.appendChild(el);
    el.firstChild.onclick = function () { el.classList.toggle('open'); el.firstChild.setAttribute('aria-expanded', el.classList.contains('open')); };
    el.querySelectorAll('[data-as]').forEach(function (b) { b.onclick = function () { as(b.getAttribute('data-as')); }; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', menu); else menu();
})();
