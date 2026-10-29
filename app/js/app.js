// Office app: dashboard, customers, schedule, routes, billing, reports, settings.
let BOOT = null; // { me, settings, techs, serviceTypes, products, stripeEnabled }
const root = document.getElementById('root');

const techOptions = (selected, blank = 'Unassigned') =>
  `<option value="">${blank}</option>` + BOOT.techs.map((t) => `<option value="${t.id}" ${Number(selected) === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
// Services offered at the current branch, with that branch's price. The company default comes first.
const serviceList = () => (BOOT.catalog?.length ? BOOT.catalog : BOOT.serviceTypes.map((s) => ({ ...s, price: s.default_price })));
const defaultService = () => serviceList().find((s) => s.is_default) || serviceList()[0];
const serviceOptions = (selected) =>
  serviceList().map((s) => `<option value="${s.id}" data-price="${s.price}" data-freq="${esc(s.default_frequency || '')}" ${Number(selected) === s.id ? 'selected' : ''}>${esc(s.name)}${s.is_default ? ' ★' : ''}</option>`).join('');
const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', manager: 'Branch manager', office: 'Office rep', tech: 'Technician', sales: 'Sales rep' };
const multiBranch = () => (BOOT.locations || []).length > 1;
const branchName = (id) => BOOT.locations?.find((l) => l.id === Number(id))?.name || '';
const LOGO = '<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#2f855a"/><path d="M9 23V9l14 14V9" stroke="#fff" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const freqOptions = (selected = 'quarterly') =>
  Object.entries(FREQ).map(([k, v]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${v}</option>`).join('');
const custName = (c) => c.name || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.customer_name || c.company || 'Customer';
// Recurring plans usually start with a heavier initial service at its own price (e.g. $199, then $125 a quarter).
const initialService = (svcId) => {
  const svc = serviceList().find((s) => s.id === Number(svcId));
  const words = (svc?.name || '').split(/[\s-]+/)[0].toLowerCase();
  return serviceList().find((s) => /initial/i.test(s.name) && s.name.toLowerCase().startsWith(words)) || serviceList().find((s) => /initial/i.test(s.name));
};
const initialFields = () => `<div class="field initial-wrap"><label class="check"><input type="checkbox" name="has_initial" class="has-initial"> Start with an initial service</label>
  <div class="row initial-row hidden"><div class="field"><label>Initial service price</label><input name="initial_price" class="initial-price" type="number" step="0.01"></div>
  <div class="field"><label>Then each visit</label><div class="hint" style="padding-top:10px">The regular price above</div></div></div></div>`;
function wireInitial(root, svcSelect, freqSelect) {
  const box = $('.has-initial', root), row = $('.initial-row', root), price = $('.initial-price', root), wrap = $('.initial-wrap', root);
  const refresh = () => {
    const recurring = freqSelect ? freqSelect.value && freqSelect.value !== 'one_time' : true;
    wrap.classList.toggle('hidden', !recurring);
    const init = initialService(svcSelect.value);
    if (!price.value && init) price.value = init.price;
    row.classList.toggle('hidden', !box.checked);
  };
  box.onchange = refresh; svcSelect.addEventListener('change', () => { price.value = ''; refresh(); });
  if (freqSelect) freqSelect.addEventListener('change', refresh);
  refresh();
}
const initialBody = (f) => (f.has_initial && f.initial_price !== '' ? { initial_price: f.initial_price, initial_service_type_id: initialService(f.service_type_id)?.id } : {});
const portalUrl = (token) => `${location.origin}/nuvolve/app/portal/${token}`;

// ---------- startup ----------
async function boot() {
  const reset = location.hash.match(/^#reset=(.+)$/);
  if (reset) return renderReset(reset[1]);
  try {
    BOOT = await api('/nuvolve/app/api/bootstrap');
  } catch (e) {
    if (e.status === 401) {
      const s = await api('/nuvolve/app/api/setup-status');
      return s.needsSetup || location.hash === '#signup' ? renderSetup() : renderLogin();
    }
    root.innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
    return;
  }
  if (BOOT.me.role === 'tech') return (location.href = '/nuvolve/app/tech');
  if (BOOT.me.role === 'sales') return (location.href = '/nuvolve/app/sell');
  if (currentBranch() && (BOOT.me.location_id || !BOOT.locations.some((l) => String(l.id) === currentBranch()))) {
    try { localStorage.removeItem('nv_loc'); } catch { /* private mode */ }
    BOOT = await api('/nuvolve/app/api/bootstrap');
  }
  if (BOOT.company.locked) return renderLocked();
  renderShell();
  window.addEventListener('hashchange', route);
  route();
}

function renderLogin(company) {
  root.innerHTML = `<div class="login-wrap"><div class="login">
    <div class="card">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:6px">${LOGO}<h1 style="margin:0">${esc(company || 'Nuvolve CRM')}</h1></div>
      <p class="muted">Log in to run your day.</p>
      <form id="f">
        <div class="field"><label>Email</label><input name="email" type="email" autocomplete="username" required></div>
        <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn primary big block">Log in</button>
      </form>
      <p class="small" style="text-align:center;margin-top:12px"><button class="link-btn" id="forgot">Forgot password?</button></p>
      <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
      <p style="text-align:center">New here? <a href="#signup" id="to-signup"><b>Start your free 14-day trial</b></a><br><span class="small muted">No credit card needed.</span></p>
    </div></div></div>`;
  $('#to-signup').onclick = (e) => { e.preventDefault(); location.hash = '#signup'; renderSetup(); };
  $('#forgot').onclick = () => modal('Reset your password', '<div class="field"><label>Your login email</label><input name="email" type="email"></div>', [
    { label: 'Cancel' },
    { label: 'Email me a reset link', cls: 'primary', onClick: async (m) => { await api('/nuvolve/app/api/forgot-password', { body: formData(m) }); toast('If that email is on the team, a reset link is on its way'); } },
  ]);
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await logIn(formData(e.target));
      if (r.role === 'tech') location.href = '/nuvolve/app/tech';
      else if (r.role === 'sales') location.href = '/nuvolve/app/sell';
      else location.reload();
    } catch (err) { toast(err.message, true); }
  };
}

// Trial over or plan canceled: only the subscribe screen.
function renderLocked() {
  const c = BOOT.company;
  root.innerHTML = `<div class="login-wrap"><div class="login" style="max-width:480px"><div class="card">
    <h1>${c.status === 'canceled' ? 'Your plan is canceled' : 'Your free trial has ended'}</h1>
    <p>Your customers, schedules and history are safe. Subscribe to pick up right where you left off.</p>
    <p><b>${money(c.pricePerRoute)}/month per route</b> · you have ${c.routes} route${c.routes === 1 ? '' : 's'} = <b>${money(c.pricePerRoute * Math.max(1, c.routes))}/month</b>. Unlimited office users. Cancel anytime.</p>
    ${BOOT.me.isAdmin ? '<button class="btn primary big block" id="sub">Subscribe</button>' : '<div class="alert info">Ask the account owner to subscribe.</div>'}
    <p class="small" style="text-align:center;margin-top:12px"><button class="link-btn" id="out">Log out</button></p>
  </div></div></div>`;
  if ($('#sub')) $('#sub').onclick = subscribe;
  $('#out').onclick = async () => { await api('/nuvolve/app/api/logout', { method: 'POST' }); location.href = '/nuvolve/app/'; };
}

async function subscribe() {
  try {
    const r = await api('/nuvolve/app/api/billing/checkout', { method: 'POST' });
    if (r.url) location.href = r.url;
    else { toast('Subscribed (demo mode, no card charged)'); setTimeout(() => location.reload(), 800); }
  } catch (e) { toast(e.message, true); }
}

function renderReset(token) {
  root.innerHTML = `<div class="login-wrap"><div class="login"><div class="card">
    <h1>Pick a new password</h1>
    <form id="f"><div class="field"><label>New password</label><input name="password" type="password" minlength="8" required autocomplete="new-password"></div>
    <button class="btn primary big block">Save and log in</button></form></div></div></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/nuvolve/app/api/reset-password', { body: { token, password: e.target.password.value } });
      if (r.twoFactor) { toast('Password changed. Log in with it and your authenticator code.'); history.replaceState(null, '', '/nuvolve/app/'); return renderLogin(); }
      location.href = r.role === 'tech' ? '/nuvolve/app/tech' : r.role === 'sales' ? '/nuvolve/app/sell' : '/nuvolve/app/';
    } catch (err) { toast(err.message, true); }
  };
}

function renderSetup() {
  root.innerHTML = `<div class="login-wrap"><div class="login" style="max-width:520px">
    <div class="card">
      <h1>Start your free trial</h1>
      <p class="muted">14 days free, no credit card. Takes about a minute and you can change all of this later.</p>
      <form id="f">
        <div class="field"><label>Company name</label><input name="company_name" required placeholder="Lone Star Pest Pros"></div>
        <div class="field"><label>Company phone</label><input name="company_phone" placeholder="(555) 555-0100"></div>
        <div class="field"><label>Shop or home base address</label><input name="shop_address" id="su-addr" placeholder="123 Main St, Dallas, TX 75201">
          <div class="hint">Routes start and end here.</div></div>
        <div class="row">
          <div class="field"><label>Your name</label><input name="name" required></div>
          <div class="field"><label>Your email (login)</label><input name="email" type="email" required></div>
        </div>
        <div class="field"><label>Pick a password</label><input name="password" type="password" minlength="8" required autocomplete="new-password"><div class="hint">At least 8 characters.</div></div>
        <button class="btn primary big block">Start my free trial</button>
      </form>
      <p class="small" style="text-align:center;margin-top:12px">Already have an account? <a href="/nuvolve/app/">Log in</a></p>
    </div></div></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/nuvolve/app/api/signup', { body: formData(e.target) });
      location.href = '/nuvolve/app/';
    } catch (err) { toast(err.message, true); }
  };
}

// Sidebar, in sections. A section heading only shows when something under it does.
const NAV = [
  ['#/', '🏠', 'Today'],
  ['#/inbox', '💬', 'Inbox'],
  ['§', 'Field work'],
  ['#/schedule', '📅', 'Schedule'],
  ['#/routes', '🗺️', 'Routes'],
  ['#/dispatch', '📡', 'Dispatch'],
  ['#/inventory', '🧪', 'Inventory'],
  ['§', 'Customers'],
  ['#/customers', '👥', 'Customers'],
  ['#/commercial', '🏭', 'Commercial'],
  ['#/termite', '🐜', 'Termite'],
  ['#/sales', '✍️', 'Sales'],
  ['#/retention', '🛟', 'Retention'],
  ['#/reviews', '⭐', 'Reviews'],
  ['§', 'Money'],
  ['#/billing', '💵', 'Billing'],
  ['#/accounting', '📒', 'Accounting', 'admin'],
  ['§', 'Growth & reports'],
  ['#/marketing', '📣', 'Marketing', 'manager'],
  ['#/reports', '📊', 'Reports'],
  ['#/documents', '📄', 'Documents'],
  ['#/insights', '📈', 'Insights', 'manager'],
  ['#/ask', '✨', 'Ask Nuvolve', 'manager'],
  ['§', 'Company'],
  ['#/acquisitions', '🤝', 'Acquisitions', 'admin'],
  ['#/settings', '⚙️', 'Settings', 'admin'],
  ['#/platform', '🛰️', 'Companies', 'platform'],
];
function navHtml() {
  const can = (n) => (n[3] !== 'admin' || BOOT.me.isAdmin) && (n[3] !== 'manager' || BOOT.me.isManager) && (n[3] !== 'platform' || BOOT.me.isPlatformAdmin);
  const items = NAV.filter((n) => n[0] === '§' || can(n));
  return items.filter((n, i) => n[0] !== '§' || (items[i + 1] && items[i + 1][0] !== '§')).map((n) => (n[0] === '§'
    ? `<div class="nav-section">${n[1]}</div>`
    : `<a href="${n[0]}" data-href="${n[0]}"><span class="ico">${n[1]}</span>${n[2]}${n[0] === '#/reviews' && BOOT.unread ? `<span class="badge">${BOOT.unread}</span>` : ''}</a>`)).join('');
}

function renderShell() {
  root.innerHTML = `<div class="shell">
    <aside class="sidebar">
      <div class="brand">${LOGO}<span>${esc(BOOT.settings.company_name || 'Nuvolve CRM')}<span class="sub">Nuvolve CRM</span></span></div>
      <nav class="nav">${navHtml()}</nav>
      <div class="me">${esc(BOOT.me.name)} <span class="small">(${ROLE_LABEL[BOOT.me.role] || ''}${BOOT.me.location_id ? ' · ' + esc(branchName(BOOT.me.location_id)) : ''})</span><br><a href="#/account" style="color:#cfe0d6">My account${BOOT.me.totp_enabled ? ' 🔒' : ''}</a> · <button id="logout">Log out</button> · <a href="/nuvolve/app/tech" style="color:#cfe0d6">Tech view</a></div>
    </aside>
    <main class="main">
      <div class="search-bar no-print">
        <input id="gsearch" placeholder="🔍  Find a customer: name, phone, address, or zip   (press / )" autocomplete="off">
        ${multiBranch() && !BOOT.me.location_id ? `<select id="branch" title="Which branch you're looking at"><option value="">🏢 All branches</option>${BOOT.locations.map((l) => `<option value="${l.id}" ${String(l.id) === currentBranch() ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>` : ''}
        <div id="gresults" class="search-results hidden"></div>
      </div>
      ${BOOT.company.status === 'trialing' ? `<div class="alert info no-print"><span>🎁 <b>${Math.max(0, BOOT.company.daysLeft)} day${BOOT.company.daysLeft === 1 ? '' : 's'} left</b> in your free trial.</span>${BOOT.me.isAdmin ? '<button class="btn sm primary" id="trial-sub">Subscribe now</button>' : ''}</div>` : ''}
      ${BOOT.company.status === 'past_due' ? `<div class="alert err no-print"><span>Your last subscription payment didn't go through. Update your card to avoid interruption.</span>${BOOT.me.isAdmin ? '<a class="btn sm" href="#/settings">Fix it</a>' : ''}</div>` : ''}
      <div id="view"></div>
    </main>
  </div>`;
  globalSearch();
  if ($('#branch')) $('#branch').onchange = async (e) => {
    try { e.target.value ? localStorage.setItem('nv_loc', e.target.value) : localStorage.removeItem('nv_loc'); } catch { /* private mode */ }
    await refreshBoot();
    route();
  };
  if ($('#trial-sub')) $('#trial-sub').onclick = subscribe;
  $('#logout').onclick = async () => { await api('/nuvolve/app/api/logout', { method: 'POST' }); location.href = '/nuvolve/app/'; };
}

async function refreshBoot() {
  BOOT = await api('/nuvolve/app/api/bootstrap');
}

// Office rep picks up the phone: type any part of a name, number, or address and the account pops up.
function globalSearch() {
  const input = $('#gsearch');
  const box = $('#gresults');
  let t;
  let rows = [];
  const close = () => box.classList.add('hidden');
  input.oninput = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) return close();
      rows = (await api(`/nuvolve/app/api/customers?status=all&q=${encodeURIComponent(q)}`)).slice(0, 8);
      const digits = q.replace(/\D/g, '');
      box.innerHTML = rows.map((r, i) => `<a href="#/customers/${r.id}" class="${i === 0 ? 'on' : ''}">
          <b>${esc(custName(r))}</b> ${r.status !== 'active' ? `<span class="pill">${esc(r.status)}</span>` : ''}
          <span class="small muted">${esc(r.address || '')} · ${esc(r.phone || '')}</span>
          <span class="small" style="margin-left:auto">${r.balance > 0 ? `<b style="color:var(--warn)">${money(r.balance)} due</b>` : ''} ${r.next_visit ? `next ${fmtDay(r.next_visit)}` : ''}</span></a>`).join('')
        + `<a href="#/customers/new?${digits.length >= 7 ? 'phone=' + encodeURIComponent(q) : 'name=' + encodeURIComponent(q)}" class="new">+ New customer${rows.length ? '' : ` "${esc(q)}"`}</a>`;
      box.classList.remove('hidden');
      $$('a', box).forEach((a) => (a.onclick = () => { input.value = ''; close(); }));
    }, 150);
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && rows[0]) { location.hash = `#/customers/${rows[0].id}`; input.value = ''; close(); }
    if (e.key === 'Escape') { input.value = ''; close(); input.blur(); }
  };
  input.onblur = () => setTimeout(close, 200);
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); input.focus(); }
  });
}

// Address type-ahead: fills street, city, state, zip, and map pin from one box.
function addressAutocomplete(input, onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'search-results hidden';
  input.parentNode.style.position = 'relative';
  input.parentNode.appendChild(wrap);
  input.setAttribute('autocomplete', 'off');
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 5) return wrap.classList.add('hidden');
      const list = await api(`/nuvolve/app/api/address-suggest?q=${encodeURIComponent(q)}`).catch(() => []);
      if (!list.length) return wrap.classList.add('hidden');
      wrap.innerHTML = list.map((a, i) => `<a href="javascript:void 0" data-i="${i}">📍 ${esc(a.label)}</a>`).join('');
      wrap.classList.remove('hidden');
      $$('a', wrap).forEach((a) => (a.onmousedown = (e) => {
        e.preventDefault();
        const pick = list[Number(a.dataset.i)];
        input.value = pick.address;
        wrap.classList.add('hidden');
        onPick(pick);
      }));
    }, 300);
  });
  input.addEventListener('blur', () => setTimeout(() => wrap.classList.add('hidden'), 200));
}

// Fills a form's address fields from a suggestion. Hidden lat/lng inputs carry the map pin.
function fillAddress(root, a) {
  for (const k of ['city', 'state', 'zip']) if ($(`[name=${k}]`, root)) $(`[name=${k}]`, root).value = a[k] || '';
  for (const k of ['lat', 'lng']) {
    let el = $(`[name=${k}]`, root);
    if (!el) { el = document.createElement('input'); el.type = 'hidden'; el.name = k; root.appendChild(el); }
    el.value = a[k];
  }
}

// Live boards: Today, Schedule and Routes refresh every minute so the office sees techs finish stops.
let refreshTimer = null;
function scheduleRefresh() {
  clearInterval(refreshTimer);
  const h = location.hash;
  if (!(h === '' || h === '#/' || h.startsWith('#/schedule') || h.startsWith('#/routes'))) return; // Dispatch runs its own 30-second refresh
  refreshTimer = setInterval(() => {
    if (location.hash !== h || $('.modal-back') || document.hidden || document.activeElement?.id === 'gsearch') return;
    const y = window.scrollY;
    route(true);
    setTimeout(() => window.scrollTo(0, y), 300);
  }, 60000);
}

function route(silent) {
  scheduleRefresh();
  const hash = location.hash || '#/';
  const [pathPart, query] = hash.slice(1).split('?');
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  const parts = pathPart.split('/').filter(Boolean);
  $$('.nav a').forEach((a) => {
    const href = a.dataset.href.slice(1);
    a.classList.toggle('active', href === '/' ? parts.length === 0 : pathPart.startsWith(href));
  });
  const view = $('#view');
  if (silent !== true) {
    view.innerHTML = '<p class="muted">Loading...</p>';
    window.scrollTo(0, 0);
  }
  const pages = {
    '': pageToday, customers: parts[1] === 'new' ? pageNewCustomer : parts[1] ? pageCustomer : pageCustomers,
    schedule: pageSchedule, routes: pageRoutes, visits: pageVisit, billing: pageBilling, reports: pageReports, settings: pageSettings,
    reviews: pageReviews, messages: pageMessages, platform: pagePlatform, insights: pageInsights, acquisitions: pageAcquisitions,
    account: pageAccount, sales: pageSales, documents: pageDocuments, ask: pageAssistant, retention: pageRetention, inbox: pageInbox, switch: pageSwitch, inventory: pageInventory, marketing: pageMarketing, dispatch: pageDispatch, commercial: pageCommercial, termite: pageTermite, accounting: pageAccounting,
  };
  // Required two-factor not set up yet: only the account page opens.
  const fn = BOOT.me.mustSetup2fa ? pageAccount : pages[parts[0] || ''] || pageToday;
  Promise.resolve(fn(view, parts[1], params)).catch((e) => {
    view.innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
  });
}

// ---------- Today ----------
async function pageToday(view) {
  const [d, notes] = await Promise.all([api('/nuvolve/app/api/dashboard'), api('/nuvolve/app/api/notifications')]);
  const gs = d.gettingStarted;
  const steps = [
    [gs.company, 'Add your shop address so routes start from home', '#/settings'],
    [gs.team, 'Add your techs (they get their own phone view)', '#/settings'],
    [gs.customer, BOOT.me.isAdmin ? 'Add your first customer, or bring them all over from your old system' : 'Add your first customer', BOOT.me.isAdmin ? '#/switch' : '#/customers/new'],
    [gs.plan, 'Put a customer on a service plan (quarterly, monthly...)', '#/customers/new'],
    [gs.completed, 'Complete a stop from the route', '#/routes'],
    [gs.paid, 'Collect your first payment', '#/billing'],
  ];
  const doneCount = steps.filter((s) => s[0]).length;
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const totalStops = d.todays.reduce((t, r) => t + r.stops, 0);
  const doneStops = d.todays.reduce((t, r) => t + (r.done || 0), 0);

  view.innerHTML = `
    <div class="page-head">
      <div><h1>${hello}, ${esc(BOOT.me.name.split(' ')[0])}</h1>
      <div class="muted">${fmtDate(d.date, { weekday: 'long', month: 'long', day: 'numeric' })} · ${totalStops} stops today, ${doneStops} done</div></div>
      <div class="actions">
        <a class="btn primary" href="#/customers/new">+ New customer</a>
        <button class="btn" id="q-visit">+ Schedule visit</button>
        <button class="btn" id="q-pay">💵 Take payment</button>
      </div>
    </div>

    ${d.missed ? `<div class="alert warn"><span>⚠️ <b>${d.missed} past stop${d.missed > 1 ? 's were' : ' was'} never completed.</b> Reschedule or mark them done so customers don't fall through the cracks.</span><a class="btn sm" href="#/schedule?missed=1">Review</a></div>` : ''}
    ${d.unassigned ? `<div class="alert info"><span>📌 ${d.unassigned} visit${d.unassigned > 1 ? 's' : ''} in the next 7 days ${d.unassigned > 1 ? 'have' : 'has'} no tech.</span><a class="btn sm" href="#/schedule">Assign</a></div>` : ''}

    <div class="stats">
      <a class="stat" href="#/billing?tab=paid"><div class="label">Collected this month</div><div class="value">${money(d.revenueMonth)}</div><div class="sub">${money(d.billedMonth)} billed</div></a>
      <a class="stat ${d.pastDue.t > 0 ? 'danger' : ''}" href="#/billing?tab=pastdue"><div class="label">Past due</div><div class="value">${money(d.pastDue.t)}</div><div class="sub">${d.pastDue.n} invoice${d.pastDue.n === 1 ? '' : 's'}</div></a>
      <a class="stat" href="#/billing"><div class="label">Open balance</div><div class="value">${money(d.openTotal)}</div><div class="sub">all unpaid invoices</div></a>
      <a class="stat" href="#/customers"><div class="label">Active customers</div><div class="value">${d.activeCustomers}</div><div class="sub">${d.activePlans} on service plans</div></a>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <div class="card-head"><h2>Today's routes</h2><a class="btn sm" href="#/routes">Open routes</a></div>
        ${d.todays.length ? d.todays.map((r) => {
          const pct = r.stops ? Math.round(((r.done || 0) / r.stops) * 100) : 0;
          return `<a href="#/routes?tech=${r.tech_id || ''}" style="display:block;text-decoration:none;color:inherit;padding:10px 0;border-bottom:1px solid var(--line)">
            <div style="display:flex;justify-content:space-between"><b><span class="dot" style="background:${esc(r.color || '#a0aec0')}"></span>${esc(r.tech_name || 'Unassigned')}</b>
            <span class="muted small">${r.done || 0} of ${r.stops} done · ${money(r.value)}</span></div>
            <div style="height:8px;background:#edf2f7;border-radius:4px;margin-top:6px"><div style="height:8px;width:${pct}%;background:var(--brand);border-radius:4px"></div></div></a>`;
        }).join('') : `<div class="empty"><div class="big">☀️</div><h3>No stops today</h3><p>Visits show up here automatically from your service plans.</p></div>`}
      </div>

      <div>
        ${doneCount < steps.length ? `<div class="card">
          <div class="card-head"><h2>Getting started</h2><span class="muted small">${doneCount} of ${steps.length}</span></div>
          <ul class="steps">${steps.map(([done, text, href]) => `<li class="${done ? 'done' : ''}"><span class="tick">${done ? '✓' : ''}</span><span class="t">${text}</span>${done ? '' : `<a class="btn sm" href="${href}">Go</a>`}</li>`).join('')}</ul>
        </div>` : ''}
        ${notes.length ? `<div class="card">
          <div class="card-head"><h2>Shout-outs and alerts</h2><a class="btn sm" href="#/reviews">Leaderboard</a></div>
          ${notes.slice(0, 5).map((n) => `<div style="padding:7px 0;border-bottom:1px solid var(--line);${n.read ? 'opacity:.65' : ''}">${n.kind === 'low_rating' ? '⚠️' : n.kind === 'google' ? '📣' : '⭐'} ${esc(n.text)} <span class="small muted">${fmtDate(n.created_at)}</span></div>`).join('')}
        </div>` : ''}
        <div class="card">
          <div class="card-head"><h2>Service requests</h2><span class="pill ${d.newRequests.length ? 'red' : ''}">${d.newRequests.length} new</span></div>
          ${d.newRequests.length ? d.newRequests.map((r) => `<div style="padding:10px 0;border-bottom:1px solid var(--line)">
            <div style="display:flex;justify-content:space-between;gap:8px"><a href="#/customers/${r.customer_id}"><b>${esc(custName(r))}</b></a><span class="muted small">${fmtDate(r.created_at)}</span></div>
            <div>${esc(r.message)}</div>
            ${r.preferred_date ? `<div class="small muted">Prefers ${fmtDay(r.preferred_date)}</div>` : ''}
            <div class="actions" style="margin-top:6px">${r.visit_id ? `<a class="btn sm primary" href="#/visits/${r.visit_id}">Move the visit</a>` : `<button class="btn sm primary" data-sched="${r.id}" data-cust="${r.customer_id}">Schedule it</button>`}<button class="btn sm" data-close="${r.id}">Mark handled</button></div>
          </div>`).join('') : '<p class="muted">Requests customers send from their pay link land here.</p>'}
        </div>
      </div>
    </div>`;

  $('#q-visit').onclick = () => scheduleVisitModal();
  $('#q-pay').onclick = () => takePaymentModal();
  $$('[data-close]', view).forEach((b) => (b.onclick = async () => { await api(`/nuvolve/app/api/requests/${b.dataset.close}`, { method: 'PUT', body: { status: 'closed' } }); route(); }));
  $$('[data-sched]', view).forEach((b) => (b.onclick = async () => {
    const c = await api(`/nuvolve/app/api/customers/${b.dataset.cust}`);
    const req = d.newRequests.find((r) => r.id === Number(b.dataset.sched));
    scheduleVisitModal(c, { request_id: req.id, date: req.preferred_date, office_notes: req.message });
  }));
}

// ---------- Customers ----------
async function pageCustomers(view, _id, params) {
  view.innerHTML = `
    <div class="page-head"><div><h1>Customers</h1><div class="muted" id="count"></div></div>
      <div class="actions"><a class="btn primary" href="#/customers/new">+ New customer</a></div></div>
    <div class="card" style="padding:12px">
      <div class="row" style="grid-template-columns:1fr 180px">
        <input id="q" placeholder="Search name, phone, email, address, or zip..." value="${esc(params.q || '')}">
        <select id="st"><option value="active">Active</option><option value="lead">Leads</option><option value="inactive">Inactive</option><option value="all">Everyone</option></select>
      </div>
    </div>
    <div class="card flush"><div class="table-wrap" id="list"></div></div>`;
  $('#st').value = params.status || 'active';
  const load = async () => {
    const rows = await api(`/nuvolve/app/api/customers?q=${encodeURIComponent($('#q').value)}&status=${$('#st').value}`);
    $('#count').textContent = `${rows.length} shown`;
    $('#list').innerHTML = rows.length ? `<table class="list"><thead><tr><th>Name</th><th>Service address</th><th>Phone</th>${multiBranch() ? '<th>Branch</th>' : ''}<th>Next visit</th><th class="right">Balance</th></tr></thead><tbody>
      ${rows.map((c) => `<tr class="click" data-id="${c.id}">
        <td><b>${esc(custName(c))}</b>${c.company && (c.first_name || c.last_name) ? `<div class="small muted">${esc(c.company)}</div>` : ''}
          ${c.autopay ? ' <span class="pill green">Autopay</span>' : ''}${c.type === 'commercial' ? ' <span class="pill blue">🏢 Commercial</span>' : ''}</td>
        <td>${esc(c.address || '')}</td><td class="nowrap">${esc(c.phone || '')}</td>${multiBranch() ? `<td class="small">${esc(c.location || '')}</td>` : ''}
        <td class="nowrap">${c.next_visit ? fmtDay(c.next_visit) : '<span class="muted">None</span>'}</td>
        <td class="right ${c.balance > 0 ? '' : 'muted'}">${money(c.balance)}</td></tr>`).join('')}
      </tbody></table>` : `<div class="empty"><div class="big">👥</div><h3>No customers found</h3><p>Add one, or bring everyone over from FieldRoutes, GorillaDesk, PestPac or a spreadsheet.</p><div class="actions" style="justify-content:center"><a class="btn primary" href="#/customers/new">+ New customer</a>${BOOT.me.isAdmin ? '<a class="btn" href="#/switch">Switch from another CRM</a>' : ''}</div></div>`;
    $$('tr.click', view).forEach((tr) => (tr.onclick = () => (location.hash = `#/customers/${tr.dataset.id}`)));
  };
  let t;
  $('#q').oninput = () => { clearTimeout(t); t = setTimeout(load, 200); };
  $('#st').onchange = load;
  await load();
}

async function pageNewCustomer(view, _id, params = {}) {
  const svc = defaultService();
  view.innerHTML = `
    <div class="page-head"><div><h1>New customer</h1><div class="muted">Three quick steps. Their visits get scheduled automatically.</div></div></div>
    <form id="f" class="card" style="max-width:760px">
      <div class="form-step"><div class="num">1</div><div class="body">
        <h2>Who is it?</h2>
        <div class="seg" id="ctype">
          <button type="button" data-v="residential" class="on">🏠 Residential</button>
          <button type="button" data-v="commercial">🏢 Commercial</button>
        </div>
        <input type="hidden" name="type" value="residential">
        <div class="field hidden" id="bizname"><label>Business name</label><input name="company" placeholder="Joe's Diner"></div>
        <div class="row">
          <div class="field"><label id="fn-label">First name</label><input name="first_name" autofocus value="${esc((params.name || '').split(' ')[0])}"></div>
          <div class="field"><label>Last name</label><input name="last_name" value="${esc((params.name || '').split(' ').slice(1).join(' '))}"></div>
        </div>
        <div class="row">
          <div class="field"><label>Phone</label><input name="phone" type="tel" value="${esc(params.phone || '')}"></div>
          <div class="field"><label>Email</label><input name="email" type="email"><div class="hint">Needed to email their pay link.</div></div>
        </div>
        <div id="dups"></div>
        <div class="row">
          <div class="field"><label>Status</label><select name="status"><option value="active">Customer</option><option value="lead">Lead (quote, not sold yet)</option></select></div>
          <div class="field"><label>How did they find you?</label><select name="source" id="nc-source"><option value="">Pick one</option>${['Google', 'Referral', 'Door knock', 'Yard sign', 'Facebook', 'Nextdoor', 'Repeat customer', 'Other'].map((x) => `<option>${x}</option>`).join('')}</select></div>
        </div>
        <div class="field hidden" id="nc-ref"><label>Referral code (optional)</label><input name="referral_code" placeholder="RITA-7K2F" style="text-transform:uppercase"><div class="hint">From the customer who sent them. They both get their reward after the first service.</div></div>
      </div></div>

      <div class="form-step"><div class="num">2</div><div class="body">
        <h2>Where do we service?</h2>
        <div class="field"><label>Street address</label><input name="address" id="nc-addr" required placeholder="Start typing and pick from the list"></div>
        <div class="row" style="grid-template-columns:2fr 1fr 1fr">
          <div class="field"><label>City</label><input name="city"></div>
          <div class="field"><label>State</label><input name="state" maxlength="2"></div>
          <div class="field"><label>Zip</label><input name="zip"></div>
        </div>
        <div class="field"><label>Gate code, pets, special instructions</label><input name="access_notes" placeholder="Gate code 1234, friendly dog in back"></div>
        ${multiBranch() && !BOOT.me.location_id ? `<div class="field"><label>Branch</label><select name="location_id"><option value="">Pick automatically from the service areas</option>${BOOT.locations.map((l) => `<option value="${l.id}" ${String(l.id) === currentBranch() ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>` : ''}
      </div></div>

      <div class="form-step"><div class="num">3</div><div class="body">
        <h2>What service?</h2>
        <div class="row">
          <div class="field"><label>Service</label><select name="service_type_id" id="svc">${serviceOptions(svc?.id)}</select></div>
          <div class="field"><label>How often</label><select name="frequency" id="freq">${freqOptions(svc?.default_frequency || 'quarterly')}<option value="">No plan yet (just save the customer)</option></select></div>
        </div>
        <div class="row">
          <div class="field"><label>Price per visit</label><input name="price" id="price" type="number" step="0.01" value="${svc?.price ?? ''}"></div>
          <div class="field"><label>First visit</label><input name="start_date" type="date" value="${todayStr()}"></div>
          <div class="field"><label>Tech</label><select name="tech_id">${techOptions(BOOT.techs[0]?.id)}</select></div>
        </div>
        ${initialFields()}
        <div class="field"><label>Notes</label><textarea name="notes" placeholder="Anything the office or tech should know"></textarea></div>
      </div></div>

      <div class="actions" style="justify-content:flex-end"><a class="btn" href="#/customers">Cancel</a><button class="btn primary big">Save customer</button></div>
    </form>`;
  const form = $('#f');
  $$('#ctype button').forEach((b) => (b.onclick = () => {
    $$('#ctype button').forEach((x) => x.classList.toggle('on', x === b));
    form.type.value = b.dataset.v;
    $('#bizname').classList.toggle('hidden', b.dataset.v !== 'commercial');
    $('#fn-label').textContent = b.dataset.v === 'commercial' ? 'Contact first name' : 'First name';
  }));
  $('#nc-source').onchange = (e) => $('#nc-ref').classList.toggle('hidden', e.target.value !== 'Referral');
  if (params.type === 'commercial') $('#ctype [data-v=commercial]').click();
  $('#svc').onchange = (e) => {
    const o = e.target.selectedOptions[0];
    $('#price').value = o.dataset.price;
    if (o.dataset.freq) $('#freq').value = o.dataset.freq;
  };
  // Warn the office before they create a second account for someone who is already a customer.
  let dt;
  const checkDups = () => {
    clearTimeout(dt);
    dt = setTimeout(async () => {
      const q = new URLSearchParams({ phone: form.phone.value, email: form.email.value, address: form.address.value });
      const rows = await api(`/nuvolve/app/api/customers/duplicates?${q}`).catch(() => []);
      $('#dups').innerHTML = rows.length ? `<div class="alert warn"><div><b>Already a customer?</b> ${rows.map((r) => `<div><a href="#/customers/${r.id}">${esc(r.name || r.company)}</a> <span class="small muted">${esc(r.address || '')} · ${esc(r.phone || '')} · ${esc(r.status)}</span></div>`).join('')}</div></div>` : '';
    }, 400);
  };
  for (const n of ['phone', 'email', 'address']) form[n].addEventListener('change', checkDups);
  if (params.phone) checkDups();
  addressAutocomplete($('#nc-addr'), (a) => { fillAddress(form, a); checkDups(); });
  wireInitial(form, $('#svc'), $('#freq'));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const btn = $('button.primary', e.target);
    btn.disabled = true;
    try {
      const r = await api('/nuvolve/app/api/customers', {
        body: {
          first_name: f.first_name, last_name: f.last_name, company: f.company, phone: f.phone, email: f.email, type: f.type, source: f.source, notes: f.notes, status: f.status,
          referral_code: f.source === 'Referral' ? f.referral_code || undefined : undefined,
          location_id: f.location_id || undefined,
          property: { address: f.address, city: f.city, state: f.state.toUpperCase(), zip: f.zip, access_notes: f.access_notes, lat: f.lat, lng: f.lng },
          plan: f.frequency ? { service_type_id: f.service_type_id, frequency: f.frequency, price: f.price, start_date: f.start_date, tech_id: f.tech_id, ...initialBody(f) } : null,
        },
      });
      toast(f.frequency ? `Customer saved and visits scheduled${multiBranch() ? ` (${branchName(r.location_id)})` : ''}` : 'Customer saved');
      if (r.referral === false) toast("Customer saved, but that referral code didn't match anyone", true);
      location.hash = `#/customers/${r.id}`;
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  };
}

async function pageCustomer(view, id) {
  const c = await api(`/nuvolve/app/api/customers/${id}`);
  const upcoming = c.visits.filter((v) => v.status === 'scheduled' && v.date >= todayStr()).reverse();
  const past = c.visits.filter((v) => !(v.status === 'scheduled' && v.date >= todayStr()));
  const openInv = c.invoices.filter((i) => i.status === 'open');
  const home = c.properties[0];
  const commercial = c.type === 'commercial';

  view.innerHTML = `
    <div class="small" style="margin-bottom:8px"><a href="#/customers">← Customers</a></div>
    <div class="hero">
      <div class="hero-photo">${home?.lat != null ? `<img src="${housePhoto(home)}" alt="Satellite view of ${esc(home.address)}" loading="eager"><span class="pin"></span>`
        : `<div class="nophoto">${commercial ? '🏢' : '🏠'}<div class="small">${home ? 'Address not on the map yet' : 'No service address yet'}</div></div>`}
        <span class="hero-type ${commercial ? 'comm' : 'res'}">${commercial ? '🏢 Commercial' : '🏠 Residential'}</span>
      </div>
      <div class="hero-body">
        <h1>${esc(custName(c))} ${c.status !== 'active' ? statusPill(c.status === 'lead' ? 'new' : 'cancelled').replace('New', 'Lead').replace('Cancelled', 'Inactive') : ''}</h1>
        ${c.company && (c.first_name || c.last_name) ? `<div><b>${esc(c.company)}</b></div>` : ''}
        ${home ? `<div>${esc(home.address)}${home.city ? ', ' + esc(home.city) : ''} ${esc(home.state || '')} ${esc(home.zip || '')}</div>` : ''}
        <div class="muted">${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : 'No phone'} · ${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : 'No email'}</div>
        <div class="hero-tags">${c.location && multiBranch() ? `<span class="pill">📍 ${esc(c.location)}</span>` : ''}${c.autopay ? '<span class="pill green">Autopay</span>' : ''}${c.balance > 0 ? `<span class="pill yellow">${money(c.balance)} due</span>` : '<span class="pill green">Paid up</span>'}${home?.access_notes ? `<span class="pill">🔑 ${esc(home.access_notes)}</span>` : ''}<span id="risk-tag"></span></div>
        ${home?.lat != null ? `<div class="actions small" style="margin-top:8px">
          <a class="btn sm" target="_blank" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${home.lat},${home.lng}">🏠 Street view</a>
          <a class="btn sm" target="_blank" href="${mapsLink(home)}">🧭 Directions</a></div>` : ''}
      </div>
      <div class="actions hero-actions">
        <button class="btn primary" id="a-visit">+ Schedule visit</button>
        <button class="btn" id="a-pay">💵 Take payment</button>
        <button class="btn" id="a-link">🔗 Pay link</button>
        ${c.balance > 0 ? '<button class="btn" id="a-remind">🔔 Send reminder</button>' : ''}
        <a class="btn" href="/nuvolve/app/api/customers/${c.id}/pesticide-report" target="_blank" rel="noopener">🧪 Pesticide report</a>
        ${c.device_count ? `<a class="btn" href="/nuvolve/app/api/customers/${c.id}/device-report" target="_blank" rel="noopener">📋 Station report (${c.device_count})</a>` : ''}
        <button class="btn" id="a-docs" title="Letters, statements and your own documents for this customer">📄 Documents</button>
        <button class="btn" id="a-contracts" title="Send a contract to sign, and see the ones already sent">✍ Contracts</button>
        ${commercial ? '<button class="btn" id="a-binder">📁 Audit binder</button>' : ''}
        <button class="btn" id="a-edit">Edit</button>
      </div>
    </div>

    <div class="stats">
      <div class="stat ${c.balance > 0 ? 'warn' : ''}"><div class="label">Balance</div><div class="value">${money(c.balance)}</div><div class="sub">${openInv.length} open invoice${openInv.length === 1 ? '' : 's'}</div></div>
      <div class="stat"><div class="label">Next visit</div><div class="value" style="font-size:20px">${upcoming[0] ? fmtDay(upcoming[0].date) : 'None'}</div><div class="sub">${upcoming[0] ? esc(upcoming[0].service_name || '') : 'Add a plan or visit'}</div></div>
      <div class="stat"><div class="label">Card on file</div><div class="value" style="font-size:20px">${c.card_last4 ? `${esc(c.card_brand || 'Card')} ••${esc(c.card_last4)}` : 'None'}</div>
        <div class="sub"><label class="check" style="font-weight:500"><input type="checkbox" id="autopay" ${c.autopay ? 'checked' : ''}> Autopay after each visit</label></div></div>
      <div class="stat"><div class="label">Customer since</div><div class="value" style="font-size:20px">${fmtDate(c.created_at, { month: 'short', year: 'numeric' })}</div><div class="sub">${esc(c.source || '')}</div></div>
    </div>
    ${c.notes ? `<div class="alert info">📝 ${esc(c.notes)}</div>` : ''}

    <div class="grid cols-2">
      <div>
        ${commercial ? '<div class="card" id="comm-card"><p class="muted small">Loading sites and pest activity...</p></div>' : ''}
        <div class="card">
          <div class="card-head"><h2>Service plans</h2><button class="btn sm" id="a-plan">+ Add plan</button></div>
          ${c.plans.length ? c.plans.map((p) => `<div style="padding:10px 0;border-bottom:1px solid var(--line)">
            <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
              <div><b>${esc(p.service_name || 'Service')}</b> · ${FREQ[p.frequency]} · ${money(p.price)}/visit ${p.active ? '' : '<span class="pill">Stopped</span>'}
              <div class="small muted">${esc(p.address)} · ${esc(p.tech_name || 'No tech')} ${p.active && p.next_visit ? `· next ${fmtDay(p.next_visit)}` : ''}</div></div>
              ${p.active ? `<div class="actions"><button class="btn sm" data-editplan="${p.id}">Change</button><button class="btn sm danger" data-stopplan="${p.id}">Stop</button></div>` : ''}
            </div></div>`).join('') : '<p class="muted">No service plan. Add one and visits are scheduled for the next 12 months.</p>'}
        </div>

        <div class="card" id="est-card"></div>
        <div id="ref-card"></div>

        <div class="card" id="termite-card"></div>

        <div class="card">
          <div class="card-head"><h2>Upcoming visits</h2></div>
          ${upcoming.length ? upcoming.slice(0, 6).map((v) => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line);gap:8px">
            <div><b>${fmtDay(v.date)}</b> ${v.time_window ? `<span class="muted small">${esc(v.time_window)}</span>` : ''}<div class="small muted">${esc(v.service_name || '')} · ${esc(v.tech_name || 'Unassigned')}</div></div>
            <a class="btn sm" href="#/visits/${v.id}">Open</a></div>`).join('') : '<p class="muted">Nothing scheduled.</p>'}
        </div>

        <div class="card">
          <div class="card-head"><h2>Service addresses</h2><button class="btn sm" id="a-prop">+ Add address</button></div>
          ${c.properties.map((p, i) => `${p.lat != null && i > 0 ? `<div class="house" data-lat="${p.lat}" data-lng="${p.lng}"></div>
            <div class="actions small" style="margin:6px 0">
              <a class="btn sm" target="_blank" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lng}">🏠 Street view</a>
              <a class="btn sm" target="_blank" href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}">🛰️ Google Maps</a>
              <a class="btn sm" target="_blank" href="${mapsLink(p)}">🧭 Directions</a></div>` : ''}
            <div style="padding:8px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:8px">
            <div>${p.site_name ? `<b>${esc(p.site_name)}</b><br>` : ''}${esc(p.address)}${p.city ? ', ' + esc(p.city) : ''} ${esc(p.state || '')} ${esc(p.zip || '')}
              ${p.site_contact || p.site_phone ? `<div class="small muted">👤 ${esc(p.site_contact || '')}${p.site_phone ? ` · <a href="tel:${esc(p.site_phone)}">${esc(p.site_phone)}</a>` : ''}</div>` : ''}
              ${p.access_notes ? `<div class="small muted">🔑 ${esc(p.access_notes)}</div>` : ''}
              ${p.lat == null ? '<div class="small" style="color:var(--warn)">Not on map yet. Check the address.</div>' : ''}</div>
            <button class="btn sm" data-editprop="${p.id}">Edit</button></div>`).join('') || '<p class="muted">No address yet.</p>'}
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-head"><h2>Invoices</h2><button class="btn sm" id="a-inv">+ New invoice</button></div>
          ${c.invoices.length ? `<table class="list"><tbody>${c.invoices.slice(0, 12).map((i) => `<tr>
            <td><a href="/nuvolve/app/api/invoices/${i.id}/view" target="_blank" rel="noopener"><b>#${i.id}</b></a> <span class="small muted">${fmtDate(i.date)}</span><div class="small muted">${esc(i.description || '')}</div></td>
            <td class="right nowrap">${money(i.amount)}${i.status === 'open' && i.amount_paid > 0 ? `<div class="small muted">${money(i.amount - i.amount_paid)} left</div>` : ''}</td>
            <td class="right">${i.status === 'open' && i.due_date < todayStr() ? '<span class="pill red">Past due</span>' : statusPill(i.status)}</td>
            <td class="right">${i.status === 'open' ? `<button class="btn sm" data-payinv="${i.id}">Pay</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Invoices are created automatically when a stop is completed.</p>'}
        </div>

        <div class="card">
          <div class="card-head"><h2>Payments</h2></div>
          ${c.payments.length ? c.payments.slice(0, 10).map((p) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)">
            <span>${fmtDate(p.date)} · ${esc(p.method)}${p.reference ? ` <span class="small muted">${esc(p.reference)}</span>` : ''}</span><b>${money(p.amount)}</b></div>`).join('') : '<p class="muted">No payments yet.</p>'}
        </div>

        <div class="card">
          <div class="card-head"><h2>Service history</h2></div>
          ${past.length ? past.slice(0, 10).map((v) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)">
            <div style="display:flex;justify-content:space-between"><b>${fmtDate(v.date)}</b> ${statusPill(v.status)}</div>
            <div class="small muted">${esc(v.service_name || '')} · ${esc(v.tech_name || '')}${v.target_pests ? ' · ' + esc(v.target_pests) : ''}</div>
            ${v.tech_notes ? `<div class="small">${esc(v.tech_notes)}</div>` : ''}
            ${v.internal_notes ? `<div class="office-note-view">🔒 ${esc(v.internal_notes)}</div>` : ''}
            <a class="small" href="#/visits/${v.id}">View ticket${v.photo_count ? ` · 📷 ${v.photo_count} photo${v.photo_count === 1 ? '' : 's'}` : ''}</a>${v.status === 'completed' ? ` · <a class="small" href="/nuvolve/app/api/visits/${v.id}/report" target="_blank" rel="noopener">Service report</a>` : ''}</div>`).join('') : '<p class="muted">No visits yet.</p>'}
        </div>

        <div class="card">
          <div class="card-head"><h2>Emails and texts</h2></div>
          <div id="msgs"><p class="muted small">Loading...</p></div>
        </div>

        ${BOOT.me.isAdmin ? `<div class="card">
          <div class="card-head"><h2>Danger zone</h2></div>
          <button class="btn sm danger" id="a-del">Delete customer and all their records</button>
        </div>` : ''}
      </div>
    </div>`;

  $('#a-visit').onclick = () => scheduleVisitModal(c);
  estimatesCard($('#est-card'), c);
  riskBadge($('#risk-tag'), c.id);
  referralCard($('#ref-card'), c);
  if (commercial) {
    commercialCard($('#comm-card'), c);
    $('#a-binder').onclick = () => binderModal(c);
  }
  termiteCard($('#termite-card'), c).catch((e) => { $('#termite-card').innerHTML = `<div class="alert err">${esc(e.message)}</div>`; });
  if ($('#a-remind')) $('#a-remind').onclick = async (e) => {
    e.target.disabled = true;
    try { const r = await api(`/nuvolve/app/api/customers/${c.id}/remind`, { method: 'POST' }); toast(r.status.includes('logged') ? 'Reminder written to the outbox (email not connected yet)' : 'Reminder sent'); route(); }
    catch (err) { toast(err.message, true); e.target.disabled = false; }
  };
  houseMaps(view);
  api(`/nuvolve/app/api/messages?customer_id=${c.id}`).then((m) => {
    $('#msgs').innerHTML = m.length ? m.slice(0, 8).map((x) => `<details style="padding:6px 0;border-bottom:1px solid var(--line)"><summary>${x.channel === 'sms' ? '💬' : '✉️'} ${esc(x.subject || x.kind)} <span class="small muted">${fmtDate(x.created_at)} · ${esc(x.status)}</span></summary><pre style="white-space:pre-wrap;font:inherit;font-size:13px">${esc(x.body)}</pre></details>`).join('')
      : '<p class="muted small">Service summaries, reminders and review requests sent to this customer show up here.</p>';
  });
  $('#a-pay').onclick = () => takePaymentModal(c);
  $('#a-link').onclick = () => payLinkModal(c);
  $('#a-edit').onclick = () => editCustomerModal(c);
  $('#a-docs').onclick = () => docsForRecord({ source: 'customer', params: { customer_id: c.id }, title: custName(c) });
  $('#a-contracts').onclick = () => contractsModal({ customerId: c.id, title: custName(c) });
  $('#a-plan').onclick = () => planModal(c);
  $('#a-prop').onclick = () => propertyModal(c);
  $('#a-inv').onclick = () => invoiceModal(c);
  $('#autopay').onchange = async (e) => {
    try {
      if (e.target.checked && !c.card_last4) {
        e.target.checked = false;
        return cardModal(c);
      }
      await api(`/nuvolve/app/api/customers/${c.id}`, { method: 'PUT', body: { autopay: e.target.checked } });
      toast(e.target.checked ? 'Autopay on. Their card is charged when each stop is completed.' : 'Autopay off');
    } catch (err) { e.target.checked = !e.target.checked; toast(err.message, true); }
  };
  $$('[data-payinv]', view).forEach((b) => (b.onclick = () => takePaymentModal(c, c.invoices.find((i) => i.id === Number(b.dataset.payinv)))));
  $$('[data-editplan]', view).forEach((b) => (b.onclick = () => planModal(c, c.plans.find((p) => p.id === Number(b.dataset.editplan)))));
  $$('[data-editprop]', view).forEach((b) => (b.onclick = () => propertyModal(c, c.properties.find((p) => p.id === Number(b.dataset.editprop)))));
  $$('[data-stopplan]', view).forEach((b) => (b.onclick = () => modal('Stop this service plan?', `<p>Future visits on this plan are removed. Past visits and invoices stay.</p>
    <div class="field"><label>Why are they stopping? (helps you win them back)</label><select name="reason"><option value="">Pick one</option>${['Price', 'Moving', 'Still seeing pests', 'Switched companies', 'Doing it themselves', 'Bad experience', 'Seasonal pause', 'Other'].map((x) => `<option>${x}</option>`).join('')}</select></div>`, [
    { label: 'Keep it' },
    { label: 'Stop plan', cls: 'primary', onClick: async (m) => { await api(`/nuvolve/app/api/plans/${b.dataset.stopplan}`, { method: 'DELETE', body: formData(m) }); toast('Plan stopped'); route(); } },
  ])));
  if ($('#a-del')) $('#a-del').onclick = () => modal('Delete this customer?', `<p>This permanently removes <b>${esc(custName(c))}</b> with every visit, invoice, and payment. Usually it's better to mark them <b>Inactive</b> under Edit.</p>`, [
    { label: 'Cancel' },
    { label: 'Delete forever', cls: 'primary', onClick: async () => { await api(`/nuvolve/app/api/customers/${c.id}`, { method: 'DELETE' }); location.hash = '#/customers'; } },
  ]);
}

// Satellite photo of the house, loaded the moment the account opens (one image, no map library needed).
// Interactive satellite map for extra addresses.
function houseMaps(root) {
  $$('.house', root).forEach((el) => {
    if (!window.L) return setTimeout(() => houseMaps(root), 600);
    const lat = Number(el.dataset.lat), lng = Number(el.dataset.lng);
    const m = L.map(el, { zoomControl: false, attributionControl: false, dragging: true, scrollWheelZoom: false }).setView([lat, lng], 19);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 19 }).addTo(m);
    L.circleMarker([lat, lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#e53e3e', fillOpacity: 1 }).addTo(m);
  });
}

function editCustomerModal(c) {
  modal('Edit customer', `
    <div class="row"><div class="field"><label>First name</label><input name="first_name" value="${esc(c.first_name || '')}"></div>
    <div class="field"><label>Last name</label><input name="last_name" value="${esc(c.last_name || '')}"></div></div>
    <div class="field"><label>Business name</label><input name="company" value="${esc(c.company || '')}"></div>
    <div class="row"><div class="field"><label>Phone</label><input name="phone" value="${esc(c.phone || '')}"></div>
    <div class="field"><label>Email</label><input name="email" value="${esc(c.email || '')}"></div></div>
    <div class="field"><label>Billing address (if different)</label><input name="billing_address" value="${esc(c.billing_address || '')}"></div>
    <div class="row"><div class="field"><label>Type</label><select name="type"><option value="residential">Residential</option><option value="commercial" ${c.type === 'commercial' ? 'selected' : ''}>Commercial</option></select></div>
    <div class="field"><label>Status</label><select name="status">${['active', 'lead', 'inactive'].map((s) => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></div></div>
    ${multiBranch() && !BOOT.me.location_id ? `<div class="field"><label>Branch</label><select name="location_id">${BOOT.locations.map((l) => `<option value="${l.id}" ${l.id === c.location_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>` : ''}
    <div class="field"><label>Notes</label><textarea name="notes">${esc(c.notes || '')}</textarea></div>
    ${Number(BOOT.settings?.tax_rate) > 0 ? `<label class="check"><input type="checkbox" name="tax_exempt" ${c.tax_exempt ? 'checked' : ''}> Tax exempt (no sales tax on their invoices)</label>` : ''}`,
  [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => {
    await api(`/nuvolve/app/api/customers/${c.id}`, { method: 'PUT', body: formData(m) });
    toast('Saved'); route();
  } }]);
}

function propertyModal(c, p = {}) {
  const pm = modal(p.id ? 'Edit address' : 'Add service address', `
    <div class="field"><label>Street address</label><input name="address" value="${esc(p.address || '')}"></div>
    <div class="row" style="grid-template-columns:2fr 1fr 1fr"><div class="field"><label>City</label><input name="city" value="${esc(p.city || '')}"></div>
    <div class="field"><label>State</label><input name="state" maxlength="2" value="${esc(p.state || '')}"></div>
    <div class="field"><label>Zip</label><input name="zip" value="${esc(p.zip || '')}"></div></div>
    <div class="field"><label>Gate code, pets, instructions</label><input name="access_notes" value="${esc(p.access_notes || '')}"></div>
    ${c.type === 'commercial' ? `<div class="field"><label>Site name</label><input name="site_name" placeholder="Store #14, Plant 2, Downtown kitchen" value="${esc(p.site_name || '')}"></div>
    <div class="row"><div class="field"><label>Site contact</label><input name="site_contact" placeholder="Name and title" value="${esc(p.site_contact || '')}"></div>
    <div class="field"><label>Site phone</label><input name="site_phone" value="${esc(p.site_phone || '')}"></div></div>` : ''}`,
  [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => {
    const body = formData(m);
    if (p.id) await api(`/nuvolve/app/api/properties/${p.id}`, { method: 'PUT', body });
    else await api(`/nuvolve/app/api/customers/${c.id}/properties`, { body });
    toast('Address saved'); route();
  } }]);
  addressAutocomplete($('[name=address]', pm.el), (a) => fillAddress($('.mb', pm.el), a));
}

function planModal(c, p) {
  const editing = Boolean(p);
  const d0 = defaultService();
  p = p || { service_type_id: d0?.id, price: d0?.price, frequency: d0?.default_frequency || 'quarterly', tech_id: BOOT.techs[0]?.id };
  const m = modal(editing ? 'Change service plan' : 'Add service plan', `
    ${editing ? '' : `<div class="field"><label>Address</label><select name="property_id">${c.properties.map((x) => `<option value="${x.id}">${esc(x.address)}</option>`).join('')}</select></div>`}
    <div class="field"><label>Service</label><select name="service_type_id" id="pm-svc">${serviceOptions(p.service_type_id)}</select></div>
    <div class="row">
      ${editing ? '' : `<div class="field"><label>How often</label><select name="frequency">${freqOptions(p.frequency)}</select></div>`}
      <div class="field"><label>Price per visit</label><input name="price" id="pm-price" type="number" step="0.01" value="${p.price ?? ''}"></div>
    </div>
    <div class="row">
      ${editing ? '' : `<div class="field"><label>First visit</label><input name="start_date" type="date" value="${todayStr()}"></div>`}
      <div class="field"><label>Tech</label><select name="tech_id">${techOptions(p.tech_id)}</select></div>
    </div>
    ${editing ? '<div class="hint">Changes apply to every future visit on this plan.</div>' : initialFields()}`,
  [{ label: 'Cancel' }, { label: 'Save plan', cls: 'primary', onClick: async (el) => {
    if (!editing && !c.properties.length) throw new Error('Add a service address first');
    const body = formData(el);
    if (editing) await api(`/nuvolve/app/api/plans/${p.id}`, { method: 'PUT', body });
    else await api('/nuvolve/app/api/plans', { body: { ...body, has_initial: undefined, initial_price: undefined, ...initialBody(body), customer_id: c.id } });
    toast(editing ? 'Plan updated' : 'Plan added and visits scheduled'); route();
  } }]);
  $('#pm-svc', m.el).addEventListener('change', (e) => { $('#pm-price', m.el).value = e.target.selectedOptions[0].dataset.price; });
  if (!editing) wireInitial(m.el, $('#pm-svc', m.el), $('select[name=frequency]', m.el));
}

// Customer search box used inside modals. Calls onPick(customerDetail).
function customerPicker(container, onPick) {
  container.innerHTML = `<div class="field"><label>Customer</label><input id="cp-q" placeholder="Start typing a name, phone or address" autocomplete="off"><div id="cp-res"></div></div>`;
  let t;
  $('#cp-q', container).oninput = (e) => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = e.target.value.trim();
      if (q.length < 2) return ($('#cp-res', container).innerHTML = '');
      const rows = (await api(`/nuvolve/app/api/customers?status=all&q=${encodeURIComponent(q)}`)).slice(0, 6);
      $('#cp-res', container).innerHTML = rows.map((r) => `<div class="stop" style="cursor:pointer" data-id="${r.id}"><div class="info"><b>${esc(custName(r))}</b><span class="small muted">${esc(r.address || '')} · ${money(r.balance)} due</span></div></div>`).join('') || '<div class="muted small">No match</div>';
      $$('[data-id]', container).forEach((d) => (d.onclick = async () => onPick(await api(`/nuvolve/app/api/customers/${d.dataset.id}`))));
    }, 200);
  };
}

function scheduleVisitModal(c, preset = {}) {
  const m = modal('Schedule a visit', '<div id="sv"></div>', []);
  const box = $('#sv', m.el);
  const showForm = (cust) => {
    if (!cust.properties.length) {
      box.innerHTML = `<p>${esc(custName(cust))} has no service address yet.</p><a class="btn primary" href="#/customers/${cust.id}">Open customer</a>`;
      return;
    }
    const st = defaultService();
    box.innerHTML = `
      <p><b>${esc(custName(cust))}</b></p>
      <div class="field"><label>Address</label><select name="property_id">${cust.properties.map((p) => `<option value="${p.id}">${esc(p.address)}</option>`).join('')}</select></div>
      <div class="row"><div class="field"><label>Date</label><input name="date" type="date" value="${preset.date || todayStr()}"></div>
      <div class="field"><label>Time window (optional)</label><input name="time_window" placeholder="8-10am"></div></div>
      <div class="row"><div class="field"><label>Service</label><select name="service_type_id" id="sv-svc">${serviceOptions(st?.id)}</select></div>
      <div class="field"><label>Price</label><input name="price" id="sv-price" type="number" step="0.01" value="${st?.price ?? 0}"><div class="hint">Use 0 for free re-treats.</div></div></div>
      <div class="field"><label>Tech</label><select name="tech_id">${techOptions(BOOT.techs[0]?.id)}</select></div>
      <div class="field"><label>Note for the tech</label><textarea name="office_notes">${esc(preset.office_notes || '')}</textarea></div>
      <button class="btn primary block" id="sv-save">Schedule visit</button>`;
    $('#sv-svc', box).onchange = (e) => { $('#sv-price', box).value = e.target.selectedOptions[0].dataset.price; };
    $('#sv-save', box).onclick = async () => {
      try {
        await api('/nuvolve/app/api/visits', { body: { ...formData(box), request_id: preset.request_id } });
        toast('Visit scheduled');
        m.close();
        route();
      } catch (e) { toast(e.message, true); }
    };
  };
  if (c) showForm(c);
  else customerPicker(box, showForm);
}

function takePaymentModal(c, invoice) {
  const m = modal('Take a payment', '<div id="tp"></div>', []);
  const box = $('#tp', m.el);
  const showForm = (cust) => {
    const open = cust.invoices.filter((i) => i.status === 'open');
    const due = invoice ? invoice.amount - invoice.amount_paid : cust.balance;
    box.innerHTML = `
      <p><b>${esc(custName(cust))}</b> owes <b>${money(cust.balance)}</b></p>
      <div class="field"><label>Apply to</label><select name="invoice_id" id="tp-inv"><option value="">Oldest invoices first</option>${open.map((i) => `<option value="${i.id}" data-due="${(i.amount - i.amount_paid).toFixed(2)}" ${invoice?.id === i.id ? 'selected' : ''}>#${i.id} · ${fmtDate(i.date)} · ${money(i.amount - i.amount_paid)}</option>`).join('')}</select></div>
      <div class="row"><div class="field"><label>Amount</label><input name="amount" id="tp-amt" type="number" step="0.01" value="${due > 0 ? due.toFixed(2) : ''}"></div>
      <div class="field"><label>Method</label><select name="method" id="tp-method">
        ${cust.card_last4 ? `<option value="cof">Charge card on file (••${esc(cust.card_last4)})</option>` : ''}
        <option value="cash">Cash</option><option value="check">Check</option><option value="card">Card (ran elsewhere)</option><option value="ach">Bank transfer</option></select></div></div>
      <div class="field" id="tp-ref-wrap"><label>Check # or note</label><input name="reference"></div>
      <button class="btn primary block big" id="tp-save">Record payment</button>
      ${cust.card_last4 ? '' : `<p class="small muted" style="margin-top:12px">Want them to pay by card? <button class="link-btn" id="tp-link">Send their pay link</button></p>`}`;
    const syncMethod = () => {
      const cof = $('#tp-method', box).value === 'cof';
      $('#tp-ref-wrap', box).classList.toggle('hidden', cof);
      $('#tp-amt', box).disabled = cof;
      $('#tp-save', box).textContent = cof ? 'Charge card' : 'Record payment';
    };
    $('#tp-method', box).onchange = syncMethod;
    syncMethod();
    $('#tp-inv', box).onchange = (e) => { const d = e.target.selectedOptions[0].dataset.due; $('#tp-amt', box).value = d || cust.balance.toFixed(2); };
    if ($('#tp-link', box)) $('#tp-link', box).onclick = () => { m.close(); payLinkModal(cust); };
    $('#tp-save', box).onclick = async (e) => {
      const f = formData(box);
      e.target.disabled = true;
      try {
        if (f.method === 'cof') {
          const target = f.invoice_id || open[0]?.id;
          if (!target) throw new Error('No open invoice to charge');
          const r = await api(`/nuvolve/app/api/invoices/${target}/charge`, { method: 'POST' });
          toast(`Charged ${money(r.amount)}${r.demo ? ' (demo)' : ''}`);
        } else {
          await api('/nuvolve/app/api/payments', { body: { ...f, customer_id: cust.id } });
          toast('Payment recorded');
        }
        m.close();
        route();
      } catch (err) { toast(err.message, true); e.target.disabled = false; }
    };
  };
  if (c) showForm(c);
  else customerPicker(box, showForm);
}

function payLinkModal(c) {
  const url = portalUrl(c.portal_token);
  const subject = encodeURIComponent(`Your account with ${BOOT.settings.company_name || 'us'}`);
  const body = encodeURIComponent(`Hi ${c.first_name || ''},\n\nYou can see your balance, pay online, and request service here:\n${url}\n\nThank you!\n${BOOT.settings.company_name || ''}`);
  const sms = encodeURIComponent(`${BOOT.settings.company_name || ''}: view and pay your bill here ${url}`);
  modal('Customer pay link', `
    <p>Send this private link to <b>${esc(custName(c))}</b>. They can pay, save a card for autopay, see upcoming visits, and request service. No password needed.</p>
    <div class="field"><input id="pl-url" value="${esc(url)}" readonly></div>
    <div class="actions">
      <button class="btn primary" id="pl-copy">Copy link</button>
      ${c.email ? `<a class="btn" href="mailto:${esc(c.email)}?subject=${subject}&body=${body}">Email it</a>` : ''}
      ${c.phone ? `<a class="btn" href="sms:${esc(c.phone)}?&body=${sms}">Text it</a>` : ''}
      <a class="btn" href="${esc(url)}" target="_blank">Preview</a>
    </div>`);
  $('#pl-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { $('#pl-url').select(); }
  };
}

function cardModal(c) {
  if (BOOT.stripeEnabled) {
    return modal('Save a card', `<p>For security, customers enter their own card. Send them their pay link and have them tick <b>Save card for autopay</b> when they pay.</p>`,
      [{ label: 'Close' }, { label: 'Send pay link', cls: 'primary', onClick: () => payLinkModal(c) }]);
  }
  modal('Save a card (demo mode)', `<p class="alert info">Stripe isn't connected yet, so this saves a pretend card for testing autopay. No money moves.</p>
    <div class="field"><label>Card number</label><input name="number" value="4242 4242 4242 4242"></div>`,
  [{ label: 'Cancel' }, { label: 'Save card and turn on autopay', cls: 'primary', onClick: async (m) => {
    await api(`/nuvolve/app/api/customers/${c.id}/demo-card`, { body: formData(m) });
    await api(`/nuvolve/app/api/customers/${c.id}`, { method: 'PUT', body: { autopay: true } });
    toast('Card saved, autopay on'); route();
  } }]);
}

function invoiceModal(c) {
  modal('New invoice', `
    <div class="field"><label>What for</label><input name="description" placeholder="Termite inspection, re-treat, materials..."></div>
    <div class="field"><label>Amount</label><input name="amount" type="number" step="0.01"></div>
    <div class="hint">Most invoices are made for you when a stop is completed. Use this for extras.</div>`,
  [{ label: 'Cancel' }, { label: 'Create invoice', cls: 'primary', onClick: async (m) => {
    await api('/nuvolve/app/api/invoices', { body: { ...formData(m), customer_id: c.id } });
    toast('Invoice created'); route();
  } }]);
}

// ---------- Schedule ----------
async function pageSchedule(view, _id, params) {
  if (params.missed) return pageMissed(view);
  const start = params.week || mondayOf(todayStr());
  const days = [...Array(6)].map((_, i) => addDays(start, i)); // Mon-Sat
  const visits = await api(`/nuvolve/app/api/visits?from=${days[0]}&to=${days[5]}`);
  const rows = [...BOOT.techs.map((t) => ({ id: t.id, name: t.name, color: t.color })), { id: null, name: 'Unassigned', color: '#a0aec0' }];
  const key = (tech, date) => `${tech ?? ''}|${date}`;
  const byCell = {};
  for (const v of visits) (byCell[key(v.tech_id, v.date)] ||= []).push(v);

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Schedule</h1><div class="muted">Week of ${fmtDate(start)} · ${visits.length} visits · drag a visit to move it</div></div>
      <div class="actions">
        <a class="btn" href="#/schedule?week=${addDays(start, -7)}">← Prev</a>
        <a class="btn" href="#/schedule">This week</a>
        <a class="btn" href="#/schedule?week=${addDays(start, 7)}">Next →</a>
        <button class="btn primary" id="add">+ Schedule visit</button>
      </div>
    </div>
    <div class="board" style="grid-template-columns:140px repeat(6, minmax(150px, 1fr))">
      <div class="h"></div>
      ${days.map((d) => `<div class="h ${d === todayStr() ? 'today' : ''}">${fmtDate(d, { weekday: 'short', month: 'numeric', day: 'numeric' })}<div class="small muted">${visits.filter((v) => v.date === d).length} stops</div></div>`).join('')}
      ${rows.map((t) => `<div class="tech"><span class="dot" style="background:${esc(t.color)}"></span>${esc(t.name)}</div>
        ${days.map((d) => {
          const list = byCell[key(t.id, d)] || [];
          return `<div class="cell" data-tech="${t.id ?? ''}" data-date="${d}">
            ${list.length ? `<div class="count">${list.length} · ${money(list.reduce((s, v) => s + v.price, 0))}</div>` : ''}
            ${list.map((v) => `<div class="vchip ${v.status === 'completed' ? 'done' : ''} ${v.status === 'skipped' ? 'skipped' : ''}" draggable="${v.status === 'scheduled'}" data-id="${v.id}" style="border-left-color:${esc(t.color)}">
              <b>${esc(v.customer_name || v.company)}</b>${esc(v.city || v.zip || '')}${v.time_window ? ` · ${esc(v.time_window)}` : ''}</div>`).join('')}
          </div>`;
        }).join('')}`).join('')}
    </div>`;

  $('#add').onclick = () => scheduleVisitModal();
  $$('.vchip', view).forEach((ch) => {
    ch.ondragstart = (e) => e.dataTransfer.setData('text/plain', ch.dataset.id);
    ch.onclick = () => (location.hash = `#/visits/${ch.dataset.id}`);
  });
  $$('.cell', view).forEach((cell) => {
    cell.ondragover = (e) => { e.preventDefault(); cell.classList.add('drop'); };
    cell.ondragleave = () => cell.classList.remove('drop');
    cell.ondrop = async (e) => {
      e.preventDefault();
      cell.classList.remove('drop');
      const id = e.dataTransfer.getData('text/plain');
      try {
        await api(`/nuvolve/app/api/visits/${id}`, { method: 'PUT', body: { date: cell.dataset.date, tech_id: cell.dataset.tech || null } });
        toast('Visit moved');
        route();
      } catch (err) { toast(err.message, true); }
    };
  });
}

function mondayOf(s) {
  const d = parseYmd(s);
  const dow = (d.getDay() + 6) % 7;
  return addDays(s, -dow);
}

async function pageMissed(view) {
  const rows = await api('/nuvolve/app/api/visits/missed');
  view.innerHTML = `
    <div class="page-head"><div><div class="small"><a href="#/schedule">← Schedule</a></div><h1>Missed stops</h1><div class="muted">Past visits that were never completed or skipped.</div></div>
    ${rows.length ? '<div class="actions"><button class="btn primary" id="all-tomorrow">Move all to tomorrow</button></div>' : ''}</div>
    <div class="card flush">${rows.length ? `<table class="list"><thead><tr><th>Date</th><th>Customer</th><th>Tech</th><th></th></tr></thead><tbody>
      ${rows.map((v) => `<tr><td>${fmtDay(v.date)}</td><td><b>${esc(v.customer_name || v.company)}</b><div class="small muted">${esc(v.address)}</div></td><td>${esc(v.tech_name || 'Unassigned')}</td>
      <td class="right"><div class="actions" style="justify-content:flex-end"><a class="btn sm primary" href="#/visits/${v.id}">Complete</a><button class="btn sm" data-tomorrow="${v.id}">Move to tomorrow</button><button class="btn sm" data-skip="${v.id}">Skip</button></div></td></tr>`).join('')}
    </tbody></table>` : '<div class="empty"><div class="big">✅</div><h3>Nothing missed</h3></div>'}</div>`;
  const move = (id) => api(`/nuvolve/app/api/visits/${id}`, { method: 'PUT', body: { date: addDays(todayStr(), 1) } });
  $$('[data-tomorrow]', view).forEach((b) => (b.onclick = async () => { await move(b.dataset.tomorrow); toast('Moved'); route(); }));
  $$('[data-skip]', view).forEach((b) => (b.onclick = async () => { await api(`/nuvolve/app/api/visits/${b.dataset.skip}/skip`, { body: { reason: 'Skipped by office' } }); route(); }));
  if ($('#all-tomorrow')) $('#all-tomorrow').onclick = async () => { for (const v of rows) await move(v.id); toast(`Moved ${rows.length} stops to tomorrow`); route(); };
}

// ---------- Routes ----------
let leafletMap = null;
async function pageRoutes(view, _id, params) {
  const date = params.date || todayStr();
  const techId = params.tech !== undefined ? params.tech : String(BOOT.techs[0]?.id ?? '');
  const r = await api(`/nuvolve/app/api/routes?date=${date}&tech_id=${techId}`);
  const go = (p) => { location.hash = `#/routes?${new URLSearchParams({ date, tech: techId, ...p })}`; };

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Routes</h1><div class="muted">${fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric' })}</div></div>
      <div class="actions">
        <button class="btn" id="prev">←</button><input type="date" id="date" value="${date}" style="width:auto"><button class="btn" id="next">→</button>
      </div>
    </div>
    <div class="tabs">${[...BOOT.techs, { id: '', name: 'Unassigned' }].map((t) => `<button data-tech="${t.id}" class="${String(t.id) === techId ? 'on' : ''}">${esc(t.name)}</button>`).join('')}</div>
    <div class="stats">
      <div class="stat"><div class="label">Stops</div><div class="value">${r.summary.stops}</div></div>
      <div class="stat"><div class="label">${r.plan?.live ? 'Driving left' : 'Driving'}</div><div class="value">${r.plan && r.stops.length ? `${r.plan.drive_min} min` : '—'}</div><div class="sub">${r.plan?.miles ? `${r.plan.miles} mi · ` : ''}${r.plan?.source === 'mapbox' ? 'road drive times' : 'estimate'}</div></div>
      <div class="stat"><div class="label">Done around</div><div class="value">${esc(r.plan?.finish_text || '—')}</div><div class="sub" style="${r.plan?.late_stops ? 'color:var(--danger)' : ''}">${r.plan?.late_stops ? `${r.plan.late_stops} stop${r.plan.late_stops === 1 ? '' : 's'} past the window` : r.plan?.overtime_min ? `${r.plan.overtime_min} min overtime` : 'all windows kept'}</div></div>
      <div class="stat"><div class="label">Route value</div><div class="value">${money(r.summary.revenue)}</div></div>
    </div>
    <div class="route-layout">
      <div class="card flush">
        <div class="card-head" style="padding:12px 12px 0">
          <div class="actions">
            <button class="btn primary sm" id="opt" ${r.stops.length < 2 ? 'disabled' : ''}>⚡ Optimize order</button>
            ${r.summary.mapsUrl ? `<a class="btn sm" href="${esc(r.summary.mapsUrl)}" target="_blank">Google Maps</a>` : ''}
            <button class="btn sm" data-print>Print</button>
          </div>
        </div>
        ${!r.shop ? '<div class="alert warn" style="margin:12px">Add your shop address in Settings so routes start from home.</div>' : ''}
        <div id="stops">${r.stops.length ? r.stops.map((s, i) => `<div class="stop ${s.status}" draggable="${s.status === 'scheduled'}" data-id="${s.id}">
          <div class="n">${i + 1}</div>
          <div class="info"><b>${esc([s.first_name, s.last_name].filter(Boolean).join(' ') || s.company)}</b>
            <div class="small">${esc(s.address)}, ${esc(s.city || '')}</div>
            <div class="small muted">${esc(s.service_name || '')} · ${money(s.price)}${s.time_window ? ` · ⏰ ${esc(s.time_window)}` : ''}</div>
            ${s.on_site ? '<div class="small"><b>🧰 On site now</b></div>' : s.eta_text ? `<div class="small" style="${s.late_min > 0 ? 'color:var(--danger);font-weight:600' : ''}">ETA ${esc(s.eta_text)}${s.drive_min ? ` · ${s.drive_min} min drive` : ''}${s.late_min > 0 ? ` · ${s.late_min} min past the window` : ''}${s.omw_at ? ' · ✉️ on my way sent' : ''}</div>` : ''}
            ${s.access_notes ? `<div class="small">🔑 ${esc(s.access_notes)}</div>` : ''}
          </div>
          <div>${s.status === 'scheduled' ? `<a class="btn sm" href="#/visits/${s.id}">Open</a>` : statusPill(s.status)}</div>
        </div>`).join('') : '<div class="empty"><div class="big">🗺️</div><h3>No stops</h3><p>Nothing scheduled for this tech on this day.</p></div>'}</div>
        ${r.stops.length > 1 ? '<p class="small muted" style="padding:0 12px">Drag stops to change the order by hand.</p>' : ''}
      </div>
      <div id="map" class="no-print"></div>
    </div>`;

  $('#date').onchange = (e) => go({ date: e.target.value });
  $('#prev').onclick = () => go({ date: addDays(date, -1) });
  $('#next').onclick = () => go({ date: addDays(date, 1) });
  $$('.tabs button', view).forEach((b) => (b.onclick = () => go({ tech: b.dataset.tech })));
  $('#opt').onclick = async () => {
    await api('/nuvolve/app/api/routes/optimize', { body: { date, tech_id: techId || null } });
    toast('Route optimized');
    route();
  };

  // Drag to reorder.
  let dragging = null;
  $$('#stops .stop', view).forEach((el) => {
    el.ondragstart = () => { dragging = el; el.style.opacity = '.5'; };
    el.ondragend = async () => {
      el.style.opacity = '';
      const ids = $$('#stops .stop', view).map((x) => Number(x.dataset.id));
      await api('/nuvolve/app/api/routes/reorder', { body: { ids } });
      route();
    };
    el.ondragover = (e) => {
      e.preventDefault();
      if (!dragging || dragging === el) return;
      const after = e.clientY > el.getBoundingClientRect().top + el.offsetHeight / 2;
      el.parentNode.insertBefore(dragging, after ? el.nextSibling : el);
    };
  });

  drawMap(r);
}

function drawMap(r) {
  const el = $('#map');
  if (!window.L) { el.innerHTML = '<div class="empty">Map is loading...</div>'; setTimeout(() => window.L && drawMap(r), 800); return; }
  if (leafletMap) { leafletMap.remove(); leafletMap = null; }
  const pts = r.stops.filter((s) => s.lat != null);
  const center = r.shop || pts[0] || { lat: 39.5, lng: -98.35 };
  leafletMap = L.map(el).setView([center.lat, center.lng], pts.length || r.shop ? 11 : 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(leafletMap);
  const line = [];
  if (r.shop) {
    L.marker([r.shop.lat, r.shop.lng], { icon: L.divIcon({ className: '', html: '<div style="font-size:22px">🏠</div>', iconSize: [24, 24] }) }).addTo(leafletMap).bindPopup('Shop');
    line.push([r.shop.lat, r.shop.lng]);
  }
  r.stops.forEach((s, i) => {
    if (s.lat == null) return;
    const color = s.status === 'completed' ? '#a0aec0' : '#2f855a';
    L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', html: `<div style="background:${color};color:#fff;border-radius:50%;width:26px;height:26px;display:grid;place-items:center;font-weight:700;font-size:13px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${i + 1}</div>`, iconSize: [26, 26] }) })
      .addTo(leafletMap).bindPopup(`<b>${esc([s.first_name, s.last_name].join(' '))}</b><br>${esc(s.address)}`);
    line.push([s.lat, s.lng]);
  });
  if (r.shop && line.length > 1) line.push([r.shop.lat, r.shop.lng]);
  // Where the tech's phone says they are right now.
  if (r.position?.fresh) {
    L.marker([r.position.lat, r.position.lng], { zIndexOffset: 1000, icon: L.divIcon({ className: '', html: '<div style="font-size:26px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">🚚</div>', iconSize: [28, 28] }) })
      .addTo(leafletMap).bindPopup(`Tech is here · ${r.position.age_min < 1 ? 'just now' : `${Math.round(r.position.age_min)} min ago`}`);
  }
  if (line.length > 1) {
    L.polyline(line, { color: '#2f855a', weight: 3, opacity: .7, dashArray: '6 6' }).addTo(leafletMap);
    leafletMap.fitBounds(line, { padding: [30, 30] });
  }
}

// ---------- Visit / service ticket ----------
async function pageVisit(view, id) {
  const v = await api(`/nuvolve/app/api/visits/${id}`);
  const done = v.status === 'completed';
  view.innerHTML = `
    <div class="page-head">
      <div><div class="small"><a href="#/customers/${v.customer_id}">← ${esc(v.customer_name || v.company)}</a></div>
      <h1>${esc(v.service_name || 'Service visit')} ${statusPill(v.status)}</h1>
      <div class="muted">${fmtDate(v.date, { weekday: 'long', month: 'long', day: 'numeric' })} · ${esc(v.tech_name || 'Unassigned')} · ${money(v.price)}</div></div>
      <div class="actions">${done ? `<a class="btn" href="/nuvolve/app/api/visits/${v.id}/report" target="_blank" rel="noopener">🧪 Service report</a>${v.invoice ? `<a class="btn" href="/nuvolve/app/api/invoices/${v.invoice.id}/view" target="_blank" rel="noopener">🧾 Invoice #${v.invoice.id}</a>` : ''}` : ''}
        <button class="btn" id="v-docs" title="Treatment notices, inspection reports and your own documents for this visit">📄 Documents</button></div>
    </div>
    <div class="grid cols-2">
      <div>
        <div class="card">
          <h2>${esc(v.customer_name || v.company)}</h2>
          <p>${esc(v.address)}, ${esc(v.city || '')} ${esc(v.zip || '')}<br>
          ${v.phone ? `<a href="tel:${esc(v.phone)}">${esc(v.phone)}</a>` : ''}</p>
          ${v.access_notes ? `<p>🔑 ${esc(v.access_notes)}</p>` : ''}
          ${v.office_notes ? `<div class="alert info">📝 ${esc(v.office_notes)}</div>` : ''}
          ${v.customer_notes ? `<p class="small muted">Customer notes: ${esc(v.customer_notes)}</p>` : ''}
          <div class="actions"><a class="btn" href="${mapsLink(v)}" target="_blank">Navigate</a></div>
        </div>
        ${!done ? `<div class="card"><h2>Change this visit</h2>
          <div class="row"><div class="field"><label>Date</label><input type="date" id="mv-date" value="${v.date}"></div>
          <div class="field"><label>Tech</label><select id="mv-tech">${techOptions(v.tech_id)}</select></div></div>
          <div class="actions"><button class="btn" id="mv-save">Save changes</button><button class="btn" id="skip">Skip this visit</button><button class="btn danger" id="cancel">Cancel visit</button></div></div>` : ''}
        ${v.history.length ? `<div class="card"><h2>Past visits here</h2>${v.history.map((h) => `<div style="padding:6px 0;border-bottom:1px solid var(--line)"><b>${fmtDate(h.date)}</b> <span class="small muted">${esc(h.target_pests || '')}</span><div class="small">${esc(h.tech_notes || '')}</div>${h.internal_notes ? `<div class="office-note-view">🔒 ${esc(h.internal_notes)}</div>` : ''}</div>`).join('')}</div>` : ''}
      </div>
      <div class="card">
        ${done ? `<h2>Service ticket</h2>
          <p><b>Target pests:</b> ${esc(v.target_pests || '—')}<br><b>Areas:</b> ${esc(v.areas_serviced || '—')}${v.weather ? `<br><b>Conditions:</b> ${esc(v.weather)}` : ''}</p>
          ${v.products.length ? `<table class="list"><thead><tr><th>Product</th><th>EPA reg #</th><th>Rate</th><th>Amount</th><th>Where</th></tr></thead><tbody>${v.products.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.epa_reg || '')}</td><td>${esc(p.rate || '')}</td><td>${p.amount ?? ''} ${esc(p.unit || '')}</td><td>${esc(p.area || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No products recorded.</p>'}
          <p><b>Notes for the customer:</b> ${esc(v.tech_notes || '—')}</p>
          ${v.internal_notes ? `<div class="office-note-view"><b>🔒 Office-only:</b> ${esc(v.internal_notes)}</div>` : ''}
          <div><b>Photos</b><div id="v-photos"></div></div>
          ${v.signature ? `<p><b>Signature</b><br><img src="${v.signature}" style="max-width:100%;border:1px solid var(--line);border-radius:8px"></p>` : ''}
          ${v.invoice ? `<p>Invoice #${v.invoice.id}: ${money(v.invoice.amount)} ${statusPill(v.invoice.status)}</p>` : ''}`
        : `<h2>Complete this stop</h2><div id="ticket"></div>`}
      </div>
    </div>`;
  $('#v-docs').onclick = () => docsForRecord({ source: 'visit', params: { visit_id: v.id }, title: `${v.service_name || 'Visit'} on ${fmtDate(v.date)}` });
  if (done) photoStrip($('#v-photos'), v.id, v.photos, { canAdd: true, canDelete: () => true });
  if (!done) {
    ticketForm($('#ticket'), v, BOOT.products, (r) => {
      toast(r.autopay?.charged ? `Stop completed. Autopay charged ${money(r.autopay.amount)}` : r.invoiceId ? 'Stop completed and invoice created' : 'Stop completed');
      route();
    });
    $('#mv-save').onclick = async () => { await api(`/nuvolve/app/api/visits/${v.id}`, { method: 'PUT', body: { date: $('#mv-date').value, tech_id: $('#mv-tech').value || null } }); toast('Saved'); route(); };
    $('#skip').onclick = () => modal('Skip this visit?', '<div class="field"><label>Reason</label><input name="reason" placeholder="Customer not home, rain..."></div>', [
      { label: 'Back' }, { label: 'Skip', cls: 'primary', onClick: async (m) => { await api(`/nuvolve/app/api/visits/${v.id}/skip`, { body: formData(m) }); route(); } }]);
    $('#cancel').onclick = async () => { await api(`/nuvolve/app/api/visits/${v.id}`, { method: 'DELETE' }); toast('Visit cancelled'); location.hash = `#/customers/${v.customer_id}`; };
  }
}

// ---------- Billing ----------
async function pageBilling(view, _id, params) {
  const tab = params.tab || 'open';
  if (tab === 'aging') return pageAging(view);
  const isPayments = tab === 'payments';
  const rows = isPayments ? await api('/nuvolve/app/api/payments') : await api(`/nuvolve/app/api/invoices?filter=${tab}`);
  const total = rows.reduce((t, r) => t + (isPayments ? r.amount : r.amount - (tab === 'paid' ? 0 : r.amount_paid)), 0);
  const chargeable = !isPayments && tab !== 'paid' ? rows.filter((r) => r.card_last4 && r.status === 'open') : [];

  view.innerHTML = `
    <div class="page-head"><div><h1>Billing</h1><div class="muted">${rows.length} ${isPayments ? 'payments in the last 30 days' : 'invoices'} · ${money(total)}</div></div>
      <div class="actions"><button class="btn primary" id="pay">💵 Take payment</button>
      ${tab === 'pastdue' && rows.length ? '<button class="btn" id="remind-all">🔔 Send reminders to everyone past due</button>' : ''}
      <a class="btn" href="#/messages">✉️ Outbox</a>
      ${chargeable.length ? `<button class="btn" id="charge-all">Charge ${chargeable.length} card${chargeable.length > 1 ? 's' : ''} on file</button>` : ''}
      ${billingExtras()}</div></div>
    ${!BOOT.stripeEnabled ? '<div class="alert info"><span>💳 Card payments are in <b>demo mode</b>. Everything works, but no real money moves. See the README to connect Stripe.</span></div>' : ''}
    <div class="tabs">${BILLING_TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="card flush"><div class="table-wrap">
    ${rows.length ? (isPayments
      ? `<table class="list"><thead><tr><th>Date</th><th>Customer</th><th>Method</th><th class="right">Amount</th></tr></thead><tbody>
        ${rows.map((p) => `<tr class="click" data-cust="${p.customer_id}"><td>${fmtDate(p.date)}</td><td>${esc(custName(p))}</td><td>${esc(p.method)} <span class="small muted">${esc(p.reference || '')}</span></td><td class="right">${money(p.amount)}</td></tr>`).join('')}</tbody></table>`
      : `<table class="list"><thead><tr><th>Invoice</th><th>Customer</th><th>Due</th><th class="right">Amount</th><th class="right">Owed</th><th></th></tr></thead><tbody>
        ${rows.map((i) => `<tr><td><a href="/nuvolve/app/api/invoices/${i.id}/view" target="_blank" rel="noopener"><b>#${i.id}</b></a><div class="small muted">${esc(i.description || '')}</div></td>
          <td><a href="#/customers/${i.customer_id}">${esc(custName(i))}</a>${i.autopay ? ' <span class="pill green">Autopay</span>' : ''}<div class="small muted">${esc(i.phone || '')}</div></td>
          <td class="nowrap">${fmtDate(i.due_date)} ${i.status === 'open' && i.due_date < todayStr() ? '<span class="pill red">Past due</span>' : ''}</td>
          <td class="right">${money(i.amount)}</td><td class="right"><b>${money(i.amount - i.amount_paid)}</b></td>
          <td class="right">${i.status === 'open' ? `<div class="actions" style="justify-content:flex-end">
            ${i.card_last4 ? `<button class="btn sm primary" data-charge="${i.id}">Charge ••${esc(i.card_last4)}</button>` : ''}
            <button class="btn sm" data-record="${i.id}" data-cust="${i.customer_id}">Record payment</button>
            <button class="btn sm" data-void="${i.id}" title="Void">Void</button></div>` : statusPill(i.status)}</td></tr>`).join('')}</tbody></table>`)
    : `<div class="empty"><div class="big">🎉</div><h3>${tab === 'pastdue' ? 'Nobody is past due' : 'Nothing here'}</h3></div>`}
    </div></div>`;

  $$('.tabs button', view).forEach((b) => (b.onclick = () => (location.hash = `#/billing?tab=${b.dataset.tab}`)));
  wireBillingExtras(view);
  $('#pay').onclick = () => takePaymentModal();
  $$('tr.click', view).forEach((tr) => (tr.onclick = () => (location.hash = `#/customers/${tr.dataset.cust}`)));
  $$('[data-charge]', view).forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { const r = await api(`/nuvolve/app/api/invoices/${b.dataset.charge}/charge`, { method: 'POST' }); toast(`Charged ${money(r.amount)}`); route(); } catch (e) { toast(e.message, true); b.disabled = false; }
  }));
  $$('[data-record]', view).forEach((b) => (b.onclick = async () => {
    const c = await api(`/nuvolve/app/api/customers/${b.dataset.cust}`);
    takePaymentModal(c, c.invoices.find((i) => i.id === Number(b.dataset.record)));
  }));
  $$('[data-void]', view).forEach((b) => (b.onclick = () => modal('Void this invoice?', '<p>The customer will no longer owe this amount.</p>', [
    { label: 'Keep it' }, { label: 'Void invoice', cls: 'primary', onClick: async () => { await api(`/nuvolve/app/api/invoices/${b.dataset.void}/void`, { method: 'POST' }); route(); } }])));
  if ($('#remind-all')) $('#remind-all').onclick = async (e) => {
    e.target.disabled = true;
    const ids = [...new Set(rows.map((r) => r.customer_id))];
    let ok = 0;
    for (const id of ids) { try { await api(`/nuvolve/app/api/customers/${id}/remind`, { method: 'POST' }); ok++; } catch { /* no contact info */ } }
    toast(`Reminders sent to ${ok} of ${ids.length} customers`);
    e.target.disabled = false;
  };
  if ($('#charge-all')) $('#charge-all').onclick = async (e) => {
    e.target.disabled = true;
    let ok = 0, fail = 0;
    for (const i of chargeable) {
      try { await api(`/nuvolve/app/api/invoices/${i.id}/charge`, { method: 'POST' }); ok++; } catch { fail++; }
    }
    toast(`Charged ${ok} card${ok === 1 ? '' : 's'}${fail ? `, ${fail} failed` : ''}`, fail > 0);
    route();
  };
}

const BILLING_TABS = [['open', 'Unpaid'], ['pastdue', 'Past due'], ['aging', 'Aging'], ['paid', 'Paid'], ['payments', 'Payments received']];
const billingExtras = () => `<button class="btn" id="export-acct">⬇️ Export for accounting</button>${BOOT.me.isAdmin ? '<button class="btn" id="raise">📈 Raise prices</button>' : ''}`;
function wireBillingExtras(view) {
  $('#export-acct', view).onclick = () => {
    const first = todayStr().slice(0, 8) + '01';
    modal('Export for accounting', `<p class="small muted">CSV files with the column names QuickBooks Online expects. Most accounting apps can import them.</p>
      <div class="row"><div class="field"><label>From</label><input type="date" name="from" value="${first}"></div><div class="field"><label>To</label><input type="date" name="to" value="${todayStr()}"></div></div>
      <div class="actions"><button type="button" class="btn" data-exp="invoices">Invoices</button><button type="button" class="btn" data-exp="payments">Payments</button>
      <a class="btn" href="/nuvolve/app/api/reports/aging?format=csv">A/R aging (today)</a></div>`, [{ label: 'Done' }]);
    $$('[data-exp]').forEach((b) => (b.onclick = () => {
      const m = b.closest('.modal');
      location.href = `/nuvolve/app/api/export/${b.dataset.exp}?from=${$('[name=from]', m).value}&to=${$('[name=to]', m).value}`;
    }));
  };
  if ($('#raise', view)) $('#raise', view).onclick = () => priceIncreaseModal();
}

async function pageAging(view) {
  const d = await api('/nuvolve/app/api/reports/aging');
  const t = d.totals;
  const cell = (n, warn) => (n > 0 ? `<b style="${warn ? 'color:var(--danger)' : ''}">${money(n)}</b>` : '<span class="muted">—</span>');
  view.innerHTML = `
    <div class="page-head"><div><h1>Billing</h1><div class="muted">${d.rows.length} customer${d.rows.length === 1 ? '' : 's'} owe ${money(t.total)}</div></div>
      <div class="actions"><button class="btn primary" id="pay">💵 Take payment</button>${billingExtras()}</div></div>
    <div class="tabs">${BILLING_TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === 'aging' ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="stats">
      <div class="stat"><div class="label">Not due yet</div><div class="value">${money(t.current)}</div></div>
      <div class="stat"><div class="label">1-30 days late</div><div class="value">${money(t.d1_30)}</div></div>
      <div class="stat ${t.d31_60 > 0 ? 'warn' : ''}"><div class="label">31-60 days</div><div class="value">${money(t.d31_60)}</div></div>
      <div class="stat ${t.d61_90 + t.d90_plus > 0 ? 'warn' : ''}"><div class="label">Over 60 days</div><div class="value">${money(t.d61_90 + t.d90_plus)}</div></div>
    </div>
    <div class="card flush"><div class="table-wrap">${d.rows.length ? `<table class="list"><thead><tr><th>Customer</th><th class="right">Not due</th><th class="right">1-30</th><th class="right">31-60</th><th class="right">61-90</th><th class="right">90+</th><th class="right">Total</th><th></th></tr></thead><tbody>
      ${d.rows.map((r) => `<tr><td><a href="#/customers/${r.customer_id}"><b>${esc(r.customer_name)}</b></a>${r.autopay ? ' <span class="pill green">Autopay</span>' : ''}
        <div class="small muted">${esc(r.phone || r.email || 'No contact info')}${r.last_reminder ? ` · reminded ${fmtDate(r.last_reminder)}` : ''}</div></td>
        <td class="right">${cell(r.current)}</td><td class="right">${cell(r.d1_30)}</td><td class="right">${cell(r.d31_60, true)}</td><td class="right">${cell(r.d61_90, true)}</td><td class="right">${cell(r.d90_plus, true)}</td>
        <td class="right"><b>${money(r.total)}</b></td><td class="right">${r.email || r.phone ? `<button class="btn sm" data-remind="${r.customer_id}">Remind</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty"><div class="big">🎉</div><h3>Nobody owes you money</h3></div>'}</div></div>`;
  $$('.tabs button', view).forEach((b) => (b.onclick = () => (location.hash = `#/billing?tab=${b.dataset.tab}`)));
  $('#pay').onclick = () => takePaymentModal();
  wireBillingExtras(view);
  $$('[data-remind]', view).forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await api(`/nuvolve/app/api/customers/${b.dataset.remind}/remind`, { method: 'POST' }); toast('Reminder sent'); route(); } catch (e) { toast(e.message, true); b.disabled = false; }
  }));
}

function priceIncreaseModal() {
  const m = modal('Raise prices on recurring plans', `
    <p class="small muted">Most pest companies raise prices 3-5% once a year. You'll see every change before anything is saved.</p>
    <div class="row"><div class="field"><label>Percent</label><input name="percent" type="number" step="0.1" min="0" value="4"></div>
      <div class="field"><label>Or a flat amount ($)</label><input name="amount" type="number" step="1" min="0" placeholder="0"></div>
      <div class="field"><label>Round to</label><select name="round"><option value="0">Cents</option><option value="1" selected>Whole dollar</option><option value="5">$5</option></select></div></div>
    <div class="row"><div class="field"><label>Only this service</label><select name="service_type_id"><option value="">Every recurring service</option>${serviceOptions()}</select></div>
      <div class="field"><label>Starting</label><input name="effective_date" type="date" value="${addDays(todayStr(), 30)}"></div></div>
    <label class="check"><input type="checkbox" name="notify" checked> Email customers a friendly notice</label>
    <div id="pi-preview" style="margin-top:12px"></div>`,
  [{ label: 'Cancel' }, { label: 'Preview', cls: 'primary', onClick: async (el) => {
    const body = { ...formData(el), notify: el.querySelector('[name=notify]').checked };
    const box = $('#pi-preview', el);
    if (box.dataset.ready === JSON.stringify(body)) {
      const r = await api('/nuvolve/app/api/plans/price-increase', { body: { ...body, apply: true } });
      toast(`${r.count} plans updated${r.notified ? `, ${r.notified} customers emailed` : ''}`);
      return route();
    }
    const p = await api('/nuvolve/app/api/plans/price-increase', { body });
    box.dataset.ready = JSON.stringify(body);
    box.innerHTML = p.count ? `<div class="alert info"><span><b>${p.count} plans</b> go up, about <b>${money(p.extraPerYear)}</b> more a year. Click <b>Apply</b> to save.</span></div>
      <div class="table-wrap" style="max-height:260px;overflow:auto"><table class="list small"><thead><tr><th>Customer</th><th>Service</th><th class="right">Now</th><th class="right">New</th></tr></thead><tbody>
      ${p.changes.map((c) => `<tr><td>${esc(c.customer_name)}</td><td>${esc(c.service || '')}</td><td class="right">${money(c.old_price)}</td><td class="right"><b>${money(c.new_price)}</b></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">No plans match.</p>';
    if (p.count) $('.mf .btn.primary', el).textContent = 'Apply';
    return false;
  } }]);
  m.el.addEventListener('input', () => {
    const box = $('#pi-preview', m.el);
    delete box.dataset.ready;
    $('.mf .btn.primary', m.el).textContent = 'Preview';
  });
}

// ---------- Reports ----------
async function pageReports(view, _id, params) {
  const from = params.from || todayStr().slice(0, 8) + '01';
  const to = params.to || todayStr();
  const q = new URLSearchParams({ from, to, template: params.template || '', tech_id: params.tech || '', product_id: params.product || '' });
  const [sum, chem, tpls] = await Promise.all([api('/nuvolve/app/api/reports/summary'), api(`/nuvolve/app/api/reports/chemicals?${q}`), api('/nuvolve/app/api/report-templates')]);
  const max = Math.max(1, ...sum.months.map((m) => Math.max(m.collected, m.billed)));
  view.innerHTML = `
    <div class="page-head"><div><h1>Reports</h1></div></div>
    <div class="card">
      <div class="card-head"><h2>Chemical use / state application records</h2>
        <div class="actions">
          <a class="btn sm" href="/nuvolve/app/api/reports/chemicals?${q}&format=print" target="_blank">🖨️ Print</a>
          <a class="btn sm primary" href="/nuvolve/app/api/reports/chemicals?${q}&format=csv">Download CSV</a>
          <a class="btn sm" href="#/documents?kind=pesticide_report" title="Design your own pesticide record or chemical summary with your logo, layout and wording">📄 Design your own</a>
        </div></div>
      <div class="row" style="grid-template-columns:2fr 1fr 1fr 1fr 1fr">
        <div class="field"><label>Report format</label><select id="tpl"><option value="">Standard</option>${tpls.templates.map((t) => `<option value="${t.id}" ${String(t.id) === params.template ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
          ${BOOT.me.isAdmin ? '<button class="link-btn small" id="tpl-edit">Customize formats for your state</button>' : ''}</div>
        <div class="field"><label>From</label><input type="date" id="from" value="${from}"></div>
        <div class="field"><label>To</label><input type="date" id="to" value="${to}"></div>
        <div class="field"><label>Applicator</label><select id="tech">${techOptions(params.tech, 'Everyone')}</select></div>
        <div class="field"><label>Product</label><select id="product"><option value="">All products</option>${BOOT.products.map((p) => `<option value="${p.id}" ${String(p.id) === params.product ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      </div>
      ${chem.totals.length ? `<table class="list" style="margin-bottom:14px"><thead><tr><th>Product</th><th>EPA reg #</th><th class="right">Applications</th><th class="right">Total used</th></tr></thead><tbody>
        ${chem.totals.map((t) => `<tr><td>${esc(t.product)}</td><td>${esc(t.epa_reg || '')}</td><td class="right">${t.applications}</td><td class="right">${Math.round(t.total * 10) / 10} ${esc(t.unit)}</td></tr>`).join('')}</tbody></table>
        <details><summary class="link-btn">Preview all ${chem.count} records in this format</summary><div class="table-wrap"><table class="list"><thead><tr>${chem.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
        ${chem.rows.slice(0, 300).map((r) => `<tr>${chem.columns.map((c) => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`
        : '<p class="muted">No applications match.</p>'}
    </div>
    <div class="grid cols-2">
      <div class="card"><h2>Money collected, last 6 months</h2>
        <div class="bars">${sum.months.map((m) => `<div class="bar"><div class="v">${money(m.collected).replace('.00', '')}</div><div class="col" style="height:${(m.collected / max) * 140}px"></div><div>${fmtDate(m.month + '-01', { month: 'short' })}</div></div>`).join('')}</div>
      </div>
      <div class="card"><h2>Who owes what (aging)</h2>
        <table class="list"><tbody>
          <tr><td>Not due yet</td><td class="right">${money(sum.aging.current)}</td></tr>
          <tr><td>1-30 days late</td><td class="right">${money(sum.aging.d30)}</td></tr>
          <tr><td>31-60 days late</td><td class="right">${money(sum.aging.d60)}</td></tr>
          <tr><td>Over 60 days late</td><td class="right"><b style="color:var(--danger)">${money(sum.aging.d90)}</b></td></tr>
        </tbody></table>
        <a class="btn sm" href="#/billing?tab=pastdue" style="margin-top:10px">See past-due list</a>
      </div>
      <div class="card"><h2>Tech production this month</h2>
        ${sum.byTech.length ? `<table class="list"><thead><tr><th>Tech</th><th class="right">Stops</th><th class="right">Production</th></tr></thead><tbody>${sum.byTech.map((t) => `<tr><td>${esc(t.name)}</td><td class="right">${t.completed}</td><td class="right">${money(t.production)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No completed stops yet this month.</p>'}
      </div>
      <div class="card"><h2>Active plans by service</h2>
        <table class="list"><thead><tr><th>Service</th><th class="right">Plans</th><th class="right">Avg price</th></tr></thead><tbody>${sum.byService.map((x) => `<tr><td>${esc(x.name)}</td><td class="right">${x.plans}</td><td class="right">${money(x.per_visit / x.plans)}</td></tr>`).join('')}</tbody></table>
      </div>
    </div>`;
  const go = () => (location.hash = `#/reports?${new URLSearchParams({ from: $('#from').value, to: $('#to').value, template: $('#tpl').value, tech: $('#tech').value, product: $('#product').value })}`);
  ['#from', '#to', '#tpl', '#tech', '#product'].forEach((id) => ($(id).onchange = go));
  if ($('#tpl-edit')) $('#tpl-edit').onclick = () => templateModal(tpls, tpls.templates.find((t) => String(t.id) === params.template));
}

// Pick and order the columns your state asks for, plus a header (license, state rule, etc.).
function templateModal(tpls, t) {
  const chosen = t ? [...t.columns] : ['date', 'customer_name', 'address', 'city', 'product', 'epa_reg', 'amount', 'unit', 'target_pests', 'applicator', 'license_no'];
  const m = modal(t ? `Edit "${t.name}"` : 'New report format', `
    <div class="field"><label>Format name</label><input name="name" value="${esc(t?.name || '')}" placeholder="Texas TDA application record"></div>
    <div class="field"><label>Header lines printed at the top</label><textarea name="header" placeholder="Business license #, state rule reference, certified applicator in charge...">${esc(t?.header || '')}</textarea></div>
    <label>Columns, in order (tick to include, arrows to move)</label>
    <div id="cols"></div>`,
  [
    ...(t ? [{ label: 'Delete', cls: 'danger', onClick: async () => { await api(`/nuvolve/app/api/report-templates/${t.id}`, { method: 'DELETE' }); location.hash = '#/reports'; } }] : []),
    { label: 'Cancel' },
    { label: 'Save format', cls: 'primary', onClick: async (el) => {
      const body = { name: $('[name=name]', el).value.trim(), header: $('[name=header]', el).value, columns: $$('#cols input:checked', el).map((x) => x.value) };
      if (t) await api(`/nuvolve/app/api/report-templates/${t.id}`, { method: 'PUT', body });
      else { const r = await api('/nuvolve/app/api/report-templates', { body }); location.hash = `#/reports?template=${r.id}`; return; }
      route();
    } },
  ]);
  const order = [...chosen, ...Object.keys(tpls.columns).filter((k) => !chosen.includes(k))];
  const draw = () => {
    $('#cols', m.el).innerHTML = order.map((k, i) => `<div style="display:flex;align-items:center;gap:6px;padding:3px 0">
      <label class="check" style="flex:1"><input type="checkbox" value="${k}" ${chosen.includes(k) ? 'checked' : ''}> ${esc(tpls.columns[k])}</label>
      <button class="btn sm" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn sm" data-down="${i}" ${i === order.length - 1 ? 'disabled' : ''}>↓</button></div>`).join('');
    $$('#cols input', m.el).forEach((x) => (x.onchange = () => { if (x.checked) chosen.push(x.value); else chosen.splice(chosen.indexOf(x.value), 1); }));
    $$('[data-up]', m.el).forEach((b) => (b.onclick = () => { const i = Number(b.dataset.up); [order[i - 1], order[i]] = [order[i], order[i - 1]]; draw(); }));
    $$('[data-down]', m.el).forEach((b) => (b.onclick = () => { const i = Number(b.dataset.down); [order[i + 1], order[i]] = [order[i], order[i + 1]]; draw(); }));
  };
  // Keep the checked columns in the on-screen order when saving.
  const save = $$('.mf .btn', m.el).pop();
  const orig = save.onclick;
  save.onclick = () => { chosen.sort((x, y) => order.indexOf(x) - order.indexOf(y)); return orig(); };
  draw();
}

// ---------- Reviews & leaderboard ----------
async function pageReviews(view, _id, params) {
  const period = params.period || 'month';
  const [lb, rv] = await Promise.all([api(`/nuvolve/app/api/leaderboard?period=${period}`), api(`/nuvolve/app/api/reviews?period=${period}`)]);
  if (BOOT.unread) { api('/nuvolve/app/api/notifications/read', { method: 'POST' }); BOOT.unread = 0; $$('.nav .badge').forEach((b) => b.remove()); }
  const sm = rv.summary;
  view.innerHTML = `
    <div class="page-head"><div><h1>Reviews and leaderboard</h1><div class="muted">Every completed stop sends a 1-tap rating. 5-stars get asked to post on Google.</div></div>
      <div class="actions">${[['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['all', 'All time']].map(([k, l]) => `<a class="btn sm ${k === period ? 'primary' : ''}" href="#/reviews?period=${k}">${l}</a>`).join('')}</div></div>
    ${!BOOT.settings.google_review_url ? `<div class="alert warn"><span>Add your Google review link in Settings so happy customers can post a public review in one tap.</span>${BOOT.me.isAdmin ? '<a class="btn sm" href="#/settings">Settings</a>' : ''}</div>` : ''}
    <div class="stats">
      <div class="stat"><div class="label">Average rating</div><div class="value">${sm.avg ? sm.avg.toFixed(2) + ' ⭐' : '—'}</div><div class="sub">${sm.rated || 0} of ${sm.asked || 0} customers rated</div></div>
      <div class="stat"><div class="label">5-star ratings</div><div class="value">${sm.five || 0}</div></div>
      <div class="stat"><div class="label">Clicked through to Google</div><div class="value">${sm.google || 0}</div><div class="sub">${sm.five ? Math.round(((sm.google || 0) / sm.five) * 100) : 0}% of 5-stars</div></div>
    </div>
    <div class="card flush">
      <div class="card-head" style="padding:16px 16px 0"><h2>🏆 Tech leaderboard</h2><span class="small muted">Points: ${lb.points.stop} per stop · ${lb.points.five} per 5-star · ${lb.points.google} per Google review · ${lb.points.low} per 3-star or lower</span></div>
      <div class="table-wrap"><table class="list"><thead><tr><th>#</th><th>Tech</th><th class="right">Points</th><th class="right">Stops</th><th class="right">5-stars</th><th class="right">Google</th><th class="right">Avg</th><th class="right">Tips</th><th>Badges</th></tr></thead><tbody>
      ${lb.rows.map((r) => `<tr><td><b>${r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : r.rank}</b></td><td><span class="dot" style="background:${esc(r.color)}"></span><b>${esc(r.name)}</b></td>
        <td class="right"><b>${r.points}</b></td><td class="right">${r.stops}</td><td class="right">${r.five}</td><td class="right">${r.google}</td>
        <td class="right">${r.avg ?? '—'}</td><td class="right">${money(r.tips)}</td><td class="small">${r.badges.join(' ')}</td></tr>`).join('')}
      </tbody></table></div>
    </div>
    <div class="grid cols-2">
      <div class="card"><h2>Latest ratings</h2>
        ${rv.recent.length ? rv.recent.slice(0, 15).map((r) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)">
          <span>${'⭐'.repeat(r.rating)}${r.google_clicked ? ' <span class="pill green">Google</span>' : ''}<div class="small muted">${esc(r.tech_name || '')} · <a href="#/customers/${r.customer_id}">${esc(r.customer_name)}</a></div></span>
          <span class="small muted">${fmtDate(r.rated_at)}</span></div>`).join('') : '<p class="muted">No ratings yet.</p>'}
      </div>
      ${rv.feedback ? `<div class="card"><h2>How we can improve (anonymous)</h2>
        <p class="small muted">Customers who rated under 5 stars can tell us what to fix. We never show who wrote it, so they're honest.</p>
        ${rv.feedback.length ? rv.feedback.map((f) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)"><div>${'⭐'.repeat(f.rating || 0)} <span class="small muted">${esc(f.tech_name || '')} · ${fmtDate(f.created_at)}</span></div>${esc(f.comment)}</div>`).join('') : '<p class="muted">Nothing yet.</p>'}
      </div>` : ''}
    </div>`;
}

// ---------- Platform owner: every company on the system ----------
async function pagePlatform(view) {
  const d = await api('/nuvolve/app/api/platform/companies');
  const paying = d.companies.filter((c) => c.status === 'active');
  const mrr = paying.reduce((t, c) => t + Math.max(1, c.routes) * d.pricePerRoute, 0);
  view.innerHTML = `
    <div class="page-head"><div><h1>Companies</h1><div class="muted">Everyone who signed up for your CRM.</div></div></div>
    <div class="stats">
      <div class="stat"><div class="label">Companies</div><div class="value">${d.companies.length}</div></div>
      <div class="stat"><div class="label">Paying</div><div class="value">${paying.length}</div></div>
      <div class="stat"><div class="label">Monthly recurring revenue</div><div class="value">${money(mrr)}</div></div>
    </div>
    <div class="card flush"><div class="table-wrap"><table class="list"><thead><tr><th>Company</th><th>Status</th><th>Signed up</th><th class="right">Routes</th><th class="right">Users</th><th class="right">Customers</th><th class="right">Stops (30 days)</th></tr></thead><tbody>
    ${d.companies.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${{ trialing: `<span class="pill blue">Trial to ${fmtDate(c.trial_ends)}</span>`, active: '<span class="pill green">Paying</span>', past_due: '<span class="pill red">Past due</span>', canceled: '<span class="pill">Canceled</span>' }[c.status]}</td>
      <td>${fmtDate(c.created_at)}</td><td class="right">${c.routes}</td><td class="right">${c.users}</td><td class="right">${c.customers}</td><td class="right">${c.stopsLast30}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}

// ---------- Outbox ----------
async function pageMessages(view) {
  const rows = await api('/nuvolve/app/api/messages');
  view.innerHTML = `
    <div class="page-head"><div><h1>Outbox</h1><div class="muted">Every email and text the system sent or tried to send.</div></div>
      <div class="actions"><button class="btn" id="run">🔔 Run payment reminders now</button></div></div>
    ${rows.some((r) => r.status === 'logged') ? '<div class="alert info">Email and texting are not connected yet, so messages are saved here instead of sent. See the README to connect Resend (email) and Twilio (texts).</div>' : ''}
    <div class="card flush"><div class="table-wrap">${rows.length ? `<table class="list"><thead><tr><th>When</th><th>Customer</th><th>Type</th><th>Message</th><th>Status</th></tr></thead><tbody>
      ${rows.map((m) => `<tr><td class="nowrap small">${fmtDate(m.created_at)}</td><td><a href="#/customers/${m.customer_id}">${esc(m.customer_name || m.company || '')}</a><div class="small muted">${esc(m.to_addr || '')}</div></td>
        <td>${m.channel === 'sms' ? '💬 Text' : '✉️ Email'}<div class="small muted">${esc(m.kind)}</div></td>
        <td><details><summary>${esc(m.subject || m.body.slice(0, 60))}</summary><pre style="white-space:pre-wrap;font:inherit;font-size:13px">${esc(m.body)}</pre></details></td>
        <td>${m.status === 'sent' ? '<span class="pill green">Sent</span>' : m.status === 'failed' ? `<span class="pill red" title="${esc(m.error || '')}">Failed</span>` : '<span class="pill">Saved</span>'}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty"><div class="big">✉️</div><h3>No messages yet</h3><p>Service summaries, reminders and review requests appear here.</p></div>'}</div></div>`;
  $('#run').onclick = async () => { const r = await api('/nuvolve/app/api/reminders/run', { method: 'POST' }); toast(`${r.sent} reminder${r.sent === 1 ? '' : 's'} sent`); route(); };
}

// ---------- Settings ----------
boot();
