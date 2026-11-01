// Technician phone view: today's route, one stop at a time, complete with a ticket.
const app = document.getElementById('app');
let ME = null;
let PRODUCTS = [];
let day = todayStr();
// The tech's language (src/lang/es/tech.js): their account setting, or what they picked on this phone.
const t = (text, vars) => NV.t(text, vars);

// Installable app that keeps working with no signal. See tech-sw.js and outbox.js.
/* offline mode is off in the demo */
const DATA_CACHE = 'nv-tech-data';
const forgetSaved = () => (window.caches ? caches.delete(DATA_CACHE) : Promise.resolve()).catch(() => {});

async function start() {
  try {
    const b = await api('/nuvolve/app/api/bootstrap');
    ME = b.me;
    PRODUCTS = b.products;
    // Spanish-speaking techs get the app in Spanish (their account setting, or what they picked on this phone).
    await NV.useLang(NV.preferredLang(ME.lang));
    document.title = t('My Route');
    NV.emit('boot', { boot: b });
    if (b.company.locked) {
      app.innerHTML = `<div class="wrap"><div class="card" style="margin-top:40px"><h2>${esc(t('Account paused'))}</h2><p>${esc(t("Your company's subscription needs attention. Ask the office or owner to log in and subscribe."))}</p></div></div>`;
      return;
    }
  } catch (e) {
    if (e.status === 401 || e.status === 403) return login();
    // First time on this phone and no signal: nothing is saved yet.
    app.innerHTML = `<div class="wrap"><div class="card" style="margin-top:40px"><h2>📴 ${esc(t('No signal'))}</h2>
      <p>${esc(t('Open the app once with signal and your route is saved on this phone for next time.'))}</p><button class="btn primary big block" id="again">${esc(t('Try again'))}</button></div></div>`;
    $('#again').onclick = () => location.reload();
    return;
  }
  window.addEventListener('hashchange', show);
  Outbox.onChange((msg) => { drawSync(); if (msg === 'login') { toast(t('Log in again to send your saved tickets'), true); login(); } });
  window.addEventListener('online', drawSync);
  window.addEventListener('offline', drawSync);
  Outbox.autoSync();
  show();
  shareLocation();
}

// ---------- live location ----------
// While the app is open the phone's position goes to the office every 30 seconds or so (sooner after
// a big move), so dispatch sees the truck and customers get live arrival times. Phones pause this when
// the app is in the background, so it's best left open on the dash.
const GPS = { watch: null, last: null, sentAt: 0, state: 'off' };
const gpsPaused = () => { try { return localStorage.getItem('nv_gps_off') === '1'; } catch { return false; } };
function shareLocation() {
  if (GPS.watch != null) navigator.geolocation.clearWatch(GPS.watch);
  GPS.watch = null;
  if (!navigator.geolocation || !window.isSecureContext) { GPS.state = 'unavailable'; return gpsBadge(); }
  if (gpsPaused()) { GPS.state = 'off'; return gpsBadge(); }
  GPS.state = 'starting';
  GPS.watch = navigator.geolocation.watchPosition((p) => {
    const c = p.coords;
    const moved = GPS.last ? distM(GPS.last, c) : Infinity;
    GPS.state = 'on';
    if (Date.now() - GPS.sentAt < 30000 && moved < 150) return gpsBadge();
    GPS.last = { latitude: c.latitude, longitude: c.longitude };
    GPS.sentAt = Date.now();
    api('/nuvolve/app/api/me/location', { body: { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, speed: c.speed, heading: c.heading } }).catch(() => {});
    gpsBadge();
  }, (err) => { GPS.state = err.code === 1 ? 'denied' : 'error'; gpsBadge(); }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
  gpsBadge();
}
function distM(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const x = Math.sin(r(b.latitude - a.latitude) / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(r(b.longitude - a.longitude) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(x));
}
function gpsBadge() {
  const el = $('#gps');
  if (!el) return;
  const label = { on: t('📍 Sharing location with the office'), starting: t('📍 Finding you...'), off: t('📍 Location paused. Tap to share'),
    denied: t('📍 Location blocked. Allow it in your phone settings'), error: t("📍 Can't get a GPS fix"), unavailable: t('📍 Location needs the https app') }[GPS.state];
  el.textContent = label;
  el.classList.toggle('on', GPS.state === 'on');
}

// The bar at the bottom: no signal, saves waiting to go (with the last time the office got through, and Send now),
// a ticket that needs the tech (src/features/fieldsync.js), or a save the office has to look at.
async function drawSync() {
  const bar = $('#syncbar');
  const { pending, failed, conflicts = 0 } = await Outbox.counts().catch(() => ({ pending: 0, failed: 0 }));
  const last = await Outbox.lastSync().catch(() => null);
  const n = (k) => NV.t(k === 1 ? '{n} save' : '{n} saves', { n: k });
  const t = (s, vars) => esc(NV.t(s, vars));
  const online = navigator.onLine;
  const since = last ? `<br><small style="opacity:.8">${t('Last sync {time}', { time: fmtTime(last) })}</small>` : '';
  const now = `<button class="btn sm" id="sync-now">${t('Send now')}</button>`;
  bar.classList.toggle('bad', failed + conflicts > 0);
  bar.hidden = online && !pending && !failed && !conflicts;
  const waiting = pending ? `<br><small style="opacity:.8">${t('{saves} waiting on this phone', { saves: n(pending) })}${last ? ` · ${t('Last sync {time}', { time: fmtTime(last) })}` : ''}</small>` : '';
  bar.innerHTML = conflicts ? `<span>⚠️ ${conflicts === 1 ? t('A ticket needs you.') : t('{n} tickets need you.', { n: conflicts })}${waiting}</span><button class="btn sm" id="sync-see">${t('See it')}</button>`
    : failed ? `<span>⚠️ ${t("{saves} couldn't go through.", { saves: n(failed) })}</span><button class="btn sm" id="sync-why">${t('See why')}</button>`
      : pending && online ? `<span>⏳ ${t('Sending {saves} from this phone...', { saves: n(pending) })}${since}</span>${now}`
        : pending ? `<span>📴 ${t("No signal. {saves} waiting on this phone. They send by themselves when you're back online.", { saves: n(pending) })}${since}</span>${now}`
          : `<span>📴 ${t('No signal. Keep working. Tickets save on this phone and send later.')}${since}</span>`;
  if ($('#sync-now')) $('#sync-now').onclick = async (e) => {
    e.target.disabled = true;
    const r = await Outbox.flush().catch(() => null);
    toast(NV.t(r && !r.left ? 'Everything is sent' : "Couldn't reach the office yet. Your saves stay on this phone and go by themselves."), !r || r.left > 0);
    drawSync();
  };
  if ($('#sync-why')) $('#sync-why').onclick = showFailed;
  if ($('#sync-see')) $('#sync-see').onclick = () => NV.emit('tech.conflicts', {});
}

const SAVE_KIND = { start: 'Start service', complete: 'Completed ticket', skip: 'Skipped stop', photo: 'Photo', choice: 'Your answer on a ticket' };
async function showFailed() {
  const items = (await Outbox.list()).filter((i) => i.status === 'failed');
  const m = modal(t("Saves that didn't go through"), `<p class="small muted">${esc(t('The server turned these down. Open the stop to fix it and save again, or remove it.'))}</p>
    ${items.map((i) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)"><b>${esc(t(SAVE_KIND[i.kind] || 'Save'))}</b> <span class="small muted">${fmtTime(i.at)}</span>
      <div class="small" style="color:var(--danger)">${esc(t(i.error))}</div>
      <div class="actions" style="margin-top:6px">${i.visitId ? `<a class="btn sm" href="#/stop/${i.visitId}">${esc(t('Open stop'))}</a>` : ''}<button class="btn sm" data-rm="${i.id}">${esc(t('Remove'))}</button></div></div>`).join('')}`, [{ label: t('Close') }]);
  $$('a', m.el).forEach((a) => a.addEventListener('click', () => m.close()));
  $$('[data-rm]', m.el).forEach((b) => (b.onclick = async () => {
    if (!confirm(t('Remove this save from the phone? It will not reach the office.'))) return;
    await Outbox.remove(Number(b.dataset.rm));
    b.closest('div[style]').remove();
  }));
}
const fmtTime = (at) => new Date(at).toLocaleString(dateLocale(), { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const savedNote = (r) => (r.savedAt ? `<div class="saved-copy">${esc(t('📴 Saved copy from {time}', { time: fmtTime(r.savedAt) }))}</div>` : '');

// What this phone has done to each stop that the server hasn't heard about yet.
async function localState(visitId) {
  const items = await (visitId ? Outbox.forVisit(visitId) : Outbox.list()).catch(() => []);
  const by = new Map();
  for (const i of items) {
    if (!by.has(i.visitId)) by.set(i.visitId, { photos: [] });
    const s = by.get(i.visitId);
    if (i.kind === 'photo') { if (i.status === 'pending') s.photos.push(i); } else s[i.kind] = i;
  }
  return visitId ? by.get(Number(visitId)) || { photos: [] } : by;
}
const sqlTime = (t) => new Date(t).toISOString().slice(0, 19).replace('T', ' ');
function applyLocal(stop, s) {
  // Someone else already completed it: the tech's ticket waits on the phone for their answer.
  if (s && (s.complete?.status === 'conflict' || s.skip?.status === 'conflict')) stop = { ...stop, conflict: true };
  if (!s || stop.status !== 'scheduled') return stop;
  if (s.complete?.status === 'pending') return { ...stop, status: 'completed', waiting: true, tech_notes: s.complete.body.tech_notes, internal_notes: s.complete.body.internal_notes };
  if (s.skip?.status === 'pending') return { ...stop, status: 'skipped', waiting: true, tech_notes: s.skip.body.reason };
  if (s.complete?.status === 'failed' || s.skip?.status === 'failed') stop = { ...stop, needsFix: (s.complete || s.skip).error };
  if (s.start?.status === 'pending' && !stop.started_at) stop = { ...stop, started_at: sqlTime(s.start.body.at) };
  return stop;
}

// With signal, keep every stop on today's route (and its house photo) on the phone for the dead zones ahead.
let savedFor = '';
async function saveDayForLater(r) {
  if (r.savedAt || !navigator.serviceWorker?.controller || savedFor === `${r.date}|${Math.floor(Date.now() / 600000)}`) return;
  savedFor = `${r.date}|${Math.floor(Date.now() / 600000)}`;
  for (const s of r.stops.filter((x) => x.status === 'scheduled')) {
    try {
      const v = await (await fetch(`/nuvolve/app/api/visits/${s.id}`, { credentials: 'same-origin' })).json();
      if (v.property_photo_id) await fetch(`/nuvolve/app/api/photos/${v.property_photo_id}`, { credentials: 'same-origin' });
    } catch { return; }
  }
}

// Android shows an install button; iPhone needs Share, then Add to Home Screen.
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; if (ME && !$('#install') && (location.hash === '' || location.hash === '#/')) showRoute(); });
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function installCard() {
  try { if (localStorage.getItem('nv_install_hide') || isInstalled()) return ''; } catch { return ''; }
  const iphone = /iPhone|iPad/.test(navigator.userAgent);
  if (!installEvent && !iphone) return '';
  return `<div class="card" id="install" style="display:flex;gap:10px;align-items:center"><div style="flex:1"><b>${esc(t('📲 Put My Route on your home screen'))}</b>
    <div class="small muted">${installEvent ? esc(t('Opens like an app and works with no signal.')) : esc(t('Tap the Share button, then {add}. It works with no signal.')).replace('{add}', `<b>${esc(t('Add to Home Screen'))}</b>`)}</div></div>
    ${installEvent ? `<button class="btn primary sm" id="install-go">${esc(t('Install'))}</button>` : ''}<button class="btn sm" id="install-x" aria-label="${esc(t('Hide'))}">✕</button></div>`;
}
function wireInstall() {
  if ($('#install-go')) $('#install-go').onclick = async () => { installEvent.prompt(); await installEvent.userChoice; installEvent = null; $('#install')?.remove(); };
  if ($('#install-x')) $('#install-x').onclick = () => { try { localStorage.setItem('nv_install_hide', '1'); } catch { /* private mode */ } $('#install').remove(); };
}

function login() {
  app.innerHTML = `<div class="login-wrap"><div class="login"><div class="card">
    <h1>${esc(t('My Route'))}</h1><p class="muted">${esc(t('Log in with the email and password your office gave you.'))}</p>
    <form id="f"><div class="field"><label>${esc(t('Email'))}</label><input name="email" type="email" autocomplete="username"></div>
    <div class="field"><label>${esc(t('Password'))}</label><input name="password" type="password" autocomplete="current-password"></div>
    <button class="btn primary big block">${esc(t('Log in'))}</button></form>
    <p class="small" style="text-align:center;margin-top:12px"><a href="/nuvolve/app/">${esc(t('Forgot password?'))}</a></p></div></div></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try { await logIn(formData(e.target)); await forgetSaved(); location.reload(); } catch (err) { toast(err.message, true); }
  };
}

function show() {
  drawSync();
  if (location.hash === '#/stats') return showStats();
  if (location.hash === '#/truck') return showTruck();
  const m = location.hash.match(/^#\/stop\/(\d+)/);
  return m ? showStop(m[1]) : showRoute();
}

const tabbar = (on) => `<div class="tabbar"><a href="#/" class="${on === 'route' ? 'on' : ''}">🗺️<br>${esc(t('My route'))}</a><a href="#/truck" class="${on === 'truck' ? 'on' : ''}">🚚<br>${esc(t('My truck'))}</a><a href="#/stats" class="${on === 'stats' ? 'on' : ''}">🏆<br>${esc(t('My stats'))}</a></div>`;

// What's on the truck, and the label and SDS for every product, for the customer who asks or the inspector who checks.
async function showTruck() {
  const d = await api('/nuvolve/app/api/my-truck');
  const low = d.products.filter((p) => p.par != null && p.on_hand < p.par);
  app.innerHTML = `
    <div class="top"><h1>🚚 ${esc(d.truck ? d.truck.name : t('Labels & SDS'))}</h1><div class="sub">${esc(d.truck ? (low.length ? t(low.length > 1 ? '{n} products under your truck level' : '{n} product under your truck level', { n: low.length }) : t('Stocked up')) : t("The office hasn't assigned you a truck yet"))}</div></div>
    <div class="wrap"><div class="card flush">
      ${d.products.map((p) => `<div class="stop" style="display:block">
        <div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(p.name)}${p.restricted_use ? ' <span class="pill red">RUP</span>' : ''}</b>
          ${d.truck && (p.on_hand || p.par != null) ? `<b style="${p.par != null && p.on_hand < p.par ? 'color:var(--danger)' : ''}">${p.on_hand} ${esc(p.unit)}</b>` : ''}</div>
        <div class="small muted">${p.epa_reg ? `EPA ${esc(p.epa_reg)}` : ''}${p.signal_word ? ` · ${esc(p.signal_word)}` : ''}${p.par != null ? ` · ${esc(t('level {n} {unit}', { n: p.par, unit: p.unit }))}` : ''}</div>
        <div class="small" style="margin-top:4px">${p.label_url ? `<a href="${esc(p.label_url)}" target="_blank" rel="noopener">${esc(t('📄 Label'))}</a>` : `<span class="muted">${esc(t('No label linked'))}</span>`}
          · ${p.sds_url ? `<a href="${esc(p.sds_url)}" target="_blank" rel="noopener">⚠️ SDS</a>` : p.sds_search_url ? `<a href="${esc(p.sds_search_url)}" target="_blank" rel="noopener">${esc(t('Find SDS'))}</a>` : ''}</div>
      </div>`).join('') || `<p class="muted" style="padding:12px">${esc(t('No products yet.'))}</p>`}
    </div></div>${tabbar('truck')}`;
}

// Leaderboard and the tech's own numbers. 5-stars and Google reviews earn the most points.
async function showStats() {
  let lb, notes, lic, pay;
  try {
    [lb, notes, lic, pay] = await Promise.all([api('/nuvolve/app/api/leaderboard?period=month'), api('/nuvolve/app/api/notifications').catch(() => []), api('/nuvolve/app/api/my-licenses').catch(() => null), api('/nuvolve/app/api/my-pay').catch(() => null)]);
  } catch {
    app.innerHTML = `<div class="top"><h1>🏆 ${esc(t('This month'))}</h1></div><div class="wrap"><div class="empty"><div class="big">📴</div><h3>${esc(t('No signal'))}</h3><p>${esc(t("Your stats show up when you're back online."))}</p></div></div>${tabbar('stats')}`;
    return;
  }
  api('/nuvolve/app/api/notifications/read', { method: 'POST' }).catch(() => {});
  const p = pay?.show ? pay.line : null;
  const me = lb.rows.find((r) => r.id === ME.id);
  app.innerHTML = `
    <div class="top"><h1>🏆 ${esc(t('This month'))}</h1><div class="sub">${esc(me ? t(me.points === 1 ? "You're #{rank} of {n} with {points} point" : "You're #{rank} of {n} with {points} points", { rank: me.rank, n: lb.rows.length, points: me.points }) : t('Leaderboard'))}</div></div>
    <div class="wrap">
      ${me ? `<div class="stats" style="grid-template-columns:1fr 1fr">
        <div class="stat"><div class="label">${esc(t('5-star ratings'))}</div><div class="value">${me.five}</div></div>
        <div class="stat"><div class="label">${esc(t('Sent to Google'))}</div><div class="value">${me.google}</div></div>
        <div class="stat"><div class="label">${esc(t('Avg rating'))}</div><div class="value">${me.avg ?? '—'}</div></div>
        <div class="stat"><div class="label">${esc(t('Tips'))}</div><div class="value">${money(me.tips)}</div></div>
      </div>${me.badges.length ? `<div class="card">${me.badges.map((b) => `<span class="pill green" style="margin:2px">${esc(b)}</span>`).join('')}</div>` : ''}` : ''}
      ${p ? `<div class="card"><h3>${esc(t('💵 My pay so far'))}</h3><div class="small muted">${esc(t('{from} to {to}', { from: fmtDate(pay.from), to: fmtDate(pay.to) }))}</div>
        <div style="font-size:30px;font-weight:700;margin:6px 0">${money(p.gross)}</div>
        <div class="small">${[p.pay_type === 'production' && NV.tn(p.stops, '{amount} of work on {n} stop', '{amount} of work on {n} stops', { amount: money(p.production) }),
          p.pay_type !== 'salary' && (p.ot ? NV.tn(p.hours, '{n} hour ({ot} overtime)', '{n} hours ({ot} overtime)', { ot: p.ot }) : NV.tn(p.hours, '{n} hour', '{n} hours')),
          p.commission && t(p.sales === 1 ? '{amount} commission on {n} sale' : '{amount} commission on {n} sales', { amount: money(p.commission), n: p.sales }),
          p.tips && t('{amount} tips', { amount: money(p.tips) })].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="small muted" style="margin-top:4px">${esc(t('Before taxes. Final pay is set when the office approves payroll.'))}</div></div>` : ''}
      <div class="card flush">
        ${lb.rows.map((r) => `<div class="stop" style="${r.id === ME.id ? 'background:var(--brand-soft)' : ''}">
          <div class="n" style="background:${esc(r.color)}">${r.rank}</div>
          <div class="info"><b>${esc(r.id === ME.id ? t('{name} (you)', { name: r.name }) : r.name)}</b><div class="small muted">${esc(t(r.five === 1 ? (r.stops === 1 ? '{five} five-star · {google} Google · {stops} stop' : '{five} five-star · {google} Google · {stops} stops')
            : r.stops === 1 ? '{five} five-stars · {google} Google · {stops} stop' : '{five} five-stars · {google} Google · {stops} stops', { five: r.five, google: r.google, stops: r.stops }))}</div></div>
          <b>${r.points}</b></div>`).join('')}
      </div>
      ${lic ? licenseCard(lic) : ''}
      <div class="card" style="display:flex;gap:14px;align-items:center">
        <img id="myface" class="face-sm" src="/nuvolve/app/api/users/${ME.id}/photo?${Date.now()}" alt="">
        <div style="flex:1"><b>${esc(t('Your photo'))}</b><div class="small muted">${esc(t("Customers see it in your on-my-way text, so they know who's at the door."))}</div>
        <label class="btn sm" style="margin-top:6px">${esc(t('📷 Take or pick a photo'))}<input type="file" accept="image/*" capture="user" id="face-in" hidden></label></div>
      </div>
      <p class="small muted" style="text-align:center">${esc(t('{five} pts per 5-star · {google} pts when they post on Google · {stop} pt per stop', lb.points))}</p>
      ${notes.length ? `<div class="card"><h3>${esc(t('Recent'))}</h3>${notes.slice(0, 8).map((n) => `<div class="small" style="padding:5px 0;border-bottom:1px solid var(--line)">${esc(t(n.text))} <span class="muted">${fmtDate(n.created_at)}</span></div>`).join('')}</div>` : ''}
    </div>${tabbar('stats')}`;
  $('#myface').onerror = (e) => { e.target.style.visibility = 'hidden'; };
  $('#face-in').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      await api('/nuvolve/app/api/me/photo', { method: 'PUT', body: { data: await shrinkImage(f, 480) } });
      $('#myface').style.visibility = '';
      $('#myface').src = `/nuvolve/app/api/users/${ME.id}/photo?${Date.now()}`;
      toast(t('Photo saved'));
    } catch (err) { toast(err.message, true); }
  };
  // No license card (the licenses didn't load) means no button to wire up.
  const logCeu = $('#log-ceu');
  if (logCeu) logCeu.onclick = () => modal(t('Log a class'), `
    <div class="field"><label>${esc(t('Course or class'))}</label><input name="course" placeholder="${esc(t('Termite and WDO update'))}"></div>
    <div class="row"><div class="field"><label>${esc(t('Credits'))}</label><input name="credits" type="number" step="0.5" min="0.5" value="1"></div>
    <div class="field"><label>${esc(t('Finished on'))}</label><input name="completed_on" type="date" value="${todayStr()}"></div></div>
    <div class="field"><label>${esc(t('Provider'))}</label><input name="provider" placeholder="${esc(t('State extension, association, online'))}"></div>`,
  [{ label: t('Cancel') }, { label: t('Save'), cls: 'primary', onClick: async (el) => { await api('/nuvolve/app/api/my-ceus', { body: formData(el) }); toast(t('Class logged')); showStats(); } }]);
}

// The tech's own licenses: when each renews and how many CEUs are still needed.
function licenseCard({ licenses, ceus }) {
  const pill = { current: 'green', expiring: 'yellow', expired: 'red' };
  return `<div class="card"><h3>${esc(t('My licenses'))}</h3>
    ${licenses.length ? licenses.map((l) => `<div style="padding:6px 0;border-bottom:1px solid var(--line)">
      <b>${esc(l.category)}</b>${l.license_no ? ` <span class="small muted">#${esc(l.license_no)}</span>` : ''}
      <span class="pill ${pill[l.status]}" style="float:right">${esc(l.status === 'expired' ? t('Expired') : l.status === 'expiring' ? t('Renew soon') : t('Current'))}</span>
      <div class="small muted">${esc(l.expires_on ? t(l.days_left < 0 ? 'Expired {date}' : 'Expires {date}', { date: fmtDate(l.expires_on) }) : t('No expiration on file'))}${l.ceu_required ? ` · ${esc(t('{earned} of {required} CEUs', { earned: l.ceu_earned, required: l.ceu_required }))}` : ''}</div></div>`).join('')
    : `<p class="small muted">${esc(t('None on file. Ask the office to add your license.'))}</p>`}
    ${ceus.length ? `<div class="small muted" style="margin-top:8px">${esc(t('Last class: {course}, {date}', { course: ceus[0].course, date: fmtDate(ceus[0].completed_on) }))}</div>` : ''}
    <button class="btn block" id="log-ceu" style="margin-top:10px">${esc(t('+ Log a class (CEUs)'))}</button></div>`;
}

async function showRoute() {
  let r, notes, clk;
  try {
    [r, notes, clk] = await Promise.all([api(`/nuvolve/app/api/my-route?date=${day}`), api('/nuvolve/app/api/notifications').catch(() => []), api('/nuvolve/app/api/clock').catch(() => null)]);
  } catch (e) {
    app.innerHTML = `<div class="top"><h1>${fmtDate(day, { weekday: 'long', month: 'short', day: 'numeric' })}</h1></div><div class="wrap">
      <div class="empty"><div class="big">📴</div><h3>${esc(t('Not saved on this phone'))}</h3><p>${esc(t(e.offline || !e.status ? 'Open this day once with signal to keep it for later.' : e.message))}</p>
      <button class="btn" id="today">${esc(t('Back to today'))}</button></div></div>${tabbar('route')}`;
    $('#today').onclick = () => { day = todayStr(); showRoute(); };
    return;
  }
  // A fresh answer: the office has everything, and these are the versions of the stops the tech is looking at.
  if (!r.savedAt) { Outbox.saw(r.stops).catch(() => {}); Outbox.synced().catch(() => {}); }
  const local = await localState();
  r.stops = r.stops.map((s) => applyLocal(s, local.get(s.id)));
  const fresh = notes.filter((n) => !n.read);
  const done = r.stops.filter((s) => s.status !== 'scheduled').length;
  const next = r.stops.find((s) => s.status === 'scheduled');
  app.innerHTML = `
    <div class="top">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><h1>${esc(t('Hi {name}', { name: ME.name.split(' ')[0] }))}</h1><div class="sub">${fmtDate(day, { weekday: 'long', month: 'short', day: 'numeric' })} · ${esc(t('{done} of {total} stops done', { done, total: r.stops.length }))}</div>${savedNote(r)}</div>
        <div style="display:flex;gap:6px"><button class="btn sm" data-theme-toggle title="${esc(t('Soft grey or bright white screen'))}" aria-label="${esc(t('Switch screen colour'))}">🌗</button><button class="btn sm" id="out">${esc(t('Log out'))}</button></div>
      </div>
      <div class="progress"><div style="width:${r.stops.length ? (done / r.stops.length) * 100 : 0}%"></div></div>
      <button type="button" id="gps" class="gps-badge"></button>
      <div class="daybar">${[-1, 0, 1].map((o) => { const d = addDays(todayStr(), o); return `<button data-d="${d}" class="${d === day ? 'on' : ''}">${fmtDay(d)}</button>`; }).join('')}</div>
    </div>
    <div class="wrap">
      ${installCard()}
      ${NV.slots('tech.top', { r })}
      ${clk ? `<div class="card" style="display:flex;align-items:center;gap:10px;padding:10px 14px">
        <div style="flex:1">${clk.clockedIn ? `⏱ <b>${esc(t('On the clock'))}</b> ${esc(t('since {time}', { time: new Date(clk.since).toLocaleTimeString(dateLocale(), { hour: 'numeric', minute: '2-digit' }) }))}` : `⏱ <b>${esc(t('Off the clock'))}</b>`}
          <div class="small muted">${esc(NV.tn(clk.weekHours, '{n} hour this week', '{n} hours this week'))}</div></div>
        <button class="btn ${clk.clockedIn ? '' : 'primary'}" id="clock">${esc(clk.clockedIn ? t('Clock out') : t('Clock in'))}</button></div>` : ''}
      ${fresh.length ? `<a href="#/stats" class="alert ok" style="text-decoration:none">🎉 ${esc(t(fresh[0].text))}${fresh.length > 1 ? ` ${esc(t('(+{n} more)', { n: fresh.length - 1 }))}` : ''}</a>` : ''}
      ${next ? `<a class="btn primary big block" href="#/stop/${next.id}" style="margin-bottom:12px">${esc(t('▶ Next stop: {name}', { name: next.company || [next.first_name, next.last_name].filter(Boolean).join(' ') }))}</a>` : ''}
      ${r.plan?.after_hours ? `<div class="small" style="text-align:center;margin:-4px 0 10px;color:var(--warn,#b7791f)">${esc(t('The day ended at {time} with {n} stops still open. Check with the office before you go on.', { time: r.plan.end_text, n: r.plan.open_stops }))}</div>` : ''}
      ${r.plan?.finish_text ? `<div class="small muted" style="text-align:center;margin:-4px 0 10px">${esc(t('About {min} min of driving left · done around {time}', { min: r.plan.drive_min, time: r.plan.finish_text }))}</div>` : ''}
      ${r.summary.mapsUrl ? `<a class="btn block" href="${esc(r.summary.mapsUrl)}" target="_blank" style="margin-bottom:12px">${esc(t('🗺️ Whole route in Google Maps'))}${r.summary.miles ? ` (~${r.summary.miles} mi)` : ''}</a>` : ''}
      ${r.stops.length ? r.stops.map((s, i) => `<div class="tstop-wrap"><a class="tstop ${s.status}" href="#/stop/${s.id}">
        <div class="n">${s.status === 'completed' ? '✓' : i + 1}</div>
        ${s.photo_id || s.lat != null ? `<img class="tthumb" src="${s.photo_id ? `/nuvolve/app/api/photos/${s.photo_id}` : housePhoto(s, 160, 160)}" alt="" loading="lazy">` : ''}
        <div class="info"><b>${esc(s.company || [s.first_name, s.last_name].filter(Boolean).join(' '))}</b>
          <div class="small">${esc(s.address)}, ${esc(s.city || '')}</div>
          <div class="small muted">${esc(s.service_name ? t(s.service_name) : '')}${s.time_window ? ` · ⏰ ${esc(s.time_window)}` : ''}${s.status === 'skipped' ? ` · ${esc(t('Skipped'))}` : ''}</div>
          ${NV.slots('tech.routeStop', { s, i })}
          ${s.on_site ? `<div class="small"><b>${esc(t('On site now'))}</b></div>` : s.eta_text ? `<div class="small ${s.late_min > 0 ? 'late' : ''}">${esc(t('ETA {time}', { time: s.eta_text }))}${s.late_min > 0 ? ` · ${esc(t('{n} min past the window', { n: s.late_min }))}` : ''}${s.omw_at ? ` · ${esc(t('✉️ Told on my way'))}` : ''}</div>` : ''}
          ${s.waiting ? `<div class="small waiting">${esc(t("⏳ Saved on this phone, sends when there's signal"))}</div>` : ''}${s.needsFix ? `<div class="small fix">${esc(t("⚠️ Didn't go through. Tap to fix."))}</div>` : ''}
          ${s.conflict ? `<div class="small fix">⚠️ ${esc(NV.t('Your ticket needs you. Tap to see.'))}</div>` : ''}</div></a>
        ${s.status === 'scheduled' ? `<button type="button" class="tnav" data-go="${i}" aria-label="${esc(t('Navigate to {address}', { address: s.address }))}">🧭<span>${esc(t('Go'))}</span></button>` : ''}</div>`).join('')
        : `<div class="empty"><div class="big">☀️</div><h3>${esc(t('No stops'))}</h3><p>${esc(t('Nothing on your route for this day.'))}</p></div>`}
    </div>${tabbar('route')}`;
  $$('.daybar button').forEach((b) => (b.onclick = () => { day = b.dataset.d; showRoute(); }));
  $$('[data-go]').forEach((b) => (b.onclick = () => navigateTo(r.stops[Number(b.dataset.go)])));
  $('#out').onclick = async () => {
    const { pending, failed, conflicts = 0 } = await Outbox.counts();
    const left = pending + failed + conflicts;
    if (left && !confirm(t(left > 1 ? "{n} saves on this phone haven't reached the office yet. Logging out deletes them. Log out anyway?"
      : "{n} save on this phone hasn't reached the office yet. Logging out deletes it. Log out anyway?", { n: left }))) return;
    try { await api('/nuvolve/app/api/logout', { method: 'POST' }); } catch (e) { return toast(e.status ? e.message : t('You need signal to log out'), true); }
    await Outbox.clear();
    await forgetSaved();
    location.reload();
  };
  wireInstall();
  saveDayForLater(r);
  NV.emit('tech.route.rendered', { r, root: app });
  $('#gps').onclick = () => {
    try { localStorage.setItem('nv_gps_off', gpsPaused() || GPS.state !== 'on' ? '' : '1'); } catch { /* private mode */ }
    shareLocation();
  };
  gpsBadge();
  if ($('#clock')) $('#clock').onclick = async (e) => {
    e.target.disabled = true;
    try { await api('/nuvolve/app/api/clock', { body: { action: clk.clockedIn ? 'out' : 'in' } }); toast(clk.clockedIn ? t('Clocked out. Nice work!') : t('Clocked in')); } catch (err) { toast(err.message, true); }
    showRoute();
  };
}

async function showStop(id) {
  let v;
  try {
    v = await api(`/nuvolve/app/api/visits/${id}`);
  } catch (e) {
    app.innerHTML = `<div class="top"><a href="#/" style="color:#a8c3b4;text-decoration:none">← ${esc(t('Route'))}</a></div><div class="wrap"><div class="empty"><div class="big">📴</div>
      <h3>${esc(t("This stop isn't saved on this phone"))}</h3><p>${esc(t(e.offline || !e.status ? 'Open it once with signal and it stays on the phone for later.' : e.message))}</p></div></div>`;
    return;
  }
  if (!v.savedAt) Outbox.saw([v]).catch(() => {});
  const local = await localState(id);
  v = applyLocal(v, local);
  v.photos = [...(v.photos || []), ...local.photos.map((p) => ({ id: `q${p.id}`, queued: p.id, kind: p.body.kind, caption: p.body.caption, local: p.body.data, user_id: ME.id }))];
  // The server turned down a ticket that was saved offline. Put what they typed back in the form so they can fix it.
  const turnedDown = local.complete?.status === 'failed' ? local.complete : null;
  if (turnedDown) { try { if (!localStorage.getItem(`nv_ticket_${v.id}`)) localStorage.setItem(`nv_ticket_${v.id}`, JSON.stringify(turnedDown.body)); } catch { /* private mode */ } }
  const name = (v.customer_type === 'commercial' && v.company) || v.customer_name || v.company;
  const done = v.status !== 'scheduled';
  app.innerHTML = `
    <div class="top"><a href="#/" style="color:#a8c3b4;text-decoration:none">← Route</a>
      <h1 style="margin-top:6px">${esc(name)}</h1><div class="sub">${esc(v.service_name ? t(v.service_name) : t('Service'))} · ${money(v.price)}</div>${savedNote(v)}</div>
    <div class="wrap">
      <div class="card flush house-card">
        ${v.property_photo_id || v.lat != null ? `<div class="house-pic"><img id="house-img" src="${v.property_photo_id ? `/nuvolve/app/api/photos/${v.property_photo_id}` : housePhoto(v, 780, 420)}" alt="Photo of ${esc(v.address)}">
          <span class="house-tag">${v.property_photo_id ? '📷 House photo' : '🛰️ Satellite'}</span></div>` : ''}
        <div style="padding:14px 16px 4px;font-size:16px">${esc(v.address)}<br>${esc(v.city || '')} ${esc(v.zip || '')}</div>
      </div>
      <div class="card">
        <div class="bigbtns">
          <button type="button" class="btn big primary" id="nav">🧭 Navigate</button>
          ${v.phone ? `<a class="btn big" href="tel:${esc(v.phone)}">📞 Call</a>` : '<span></span>'}
          ${!done && (v.phone || v.email) ? `<button type="button" class="btn big" id="omw">${v.omw_at ? '✉️ Sent. Send again' : '💬 On my way'}</button>` : ''}
          ${NV.slots('tech.stopActions', { v })}
        </div>
        <div class="small" style="text-align:right;margin-top:-4px"><button type="button" class="link-btn" id="nav-app">${navPref() ? `Using ${NAV_APPS[navPref()]?.label}. Change` : 'Pick map app'}</button></div>
        ${v.access_notes ? `<div class="alert warn">🔑 ${esc(v.access_notes)}</div>` : ''}
        ${v.office_notes ? `<div class="alert info">📝 ${esc(v.office_notes)}</div>` : ''}
        ${v.customer_notes ? `<p class="small muted">${esc(v.customer_notes)}</p>` : ''}
      </div>
      ${NV.slots('tech.stop', { v })}
      ${/termite|wdi|wood.destroying/i.test(v.service_name || '') || v.devices.some((d) => ['termite', 'termite_ag'].includes(d.type)) ? `<div class="card"><h3>🐜 Termite</h3>
        <div class="bigbtns"><a class="btn" href="/nuvolve/app/graph.html?property=${v.property_id}">📐 Graph</a><button type="button" class="btn" id="wdi">📝 WDI report</button></div></div>` : ''}
      ${v.history.length ? `<div class="card"><h3>Last visits</h3>${v.history.slice(0, 3).map((h) => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)"><b>${fmtDate(h.date)}</b> ${esc(h.target_pests || '')}<br>${esc(h.tech_notes || '')}
        ${h.internal_notes ? `<div class="office-note-view">🔒 ${esc(h.internal_notes)}</div>` : ''}</div>`).join('')}</div>` : ''}
      ${done ? '' : v.started_at
    ? `<div class="alert ok" style="justify-content:space-between">⏱️ On site <span class="timer" id="timer"></span></div>`
    : '<button class="btn primary big block" id="start" style="margin-bottom:12px">▶ Start service (I\'m here)</button>'}
      <div class="card">
        ${v.needsFix ? `<div class="alert warn">⚠️ ${esc(t("This was saved with no signal, but the office's system turned it down: {error} Fix it below and save again.", { error: t(v.needsFix) }))}</div>` : ''}
        ${v.waiting ? `<div class="alert info">⏳ Saved on this phone. It sends by itself when you have signal${v.status === 'completed' ? ', and the customer gets their report then' : ''}.</div>` : ''}
        ${done ? `<h2>${v.status === 'completed' ? '✅ Completed' : 'Skipped'}</h2><p>${esc(v.tech_notes || '')}</p>
          ${v.internal_notes ? `<div class="office-note-view">🔒 ${esc(v.internal_notes)}</div>` : ''}
          ${v.status === 'completed' && !v.waiting ? `<a class="btn block" href="/nuvolve/app/api/visits/${v.id}/report" target="_blank" rel="noopener">🧪 Show the customer their service report</a>` : ''}`
          : `<h2>Service ticket</h2><div id="ticket"></div><button class="btn block" id="skip" style="margin-top:10px">Can't do it today (skip)</button>`}
      </div>
    </div>`;
  $('#nav').onclick = () => navigateTo(v);
  NV.emit('tech.stop.rendered', { v, root: app });
  // Texts the customer the arrival time, the tech's photo and a live tracking link.
  if ($('#omw')) $('#omw').onclick = async (e) => {
    e.target.disabled = true;
    try {
      const r = await api(`/nuvolve/app/api/visits/${v.id}/on-my-way`, { body: { resend: Boolean(v.omw_at) } });
      toast(r.held ? NV.t('Quiet hours for this customer: the text waits for morning, and is dropped if it would be late.') : `${r.sent.includes('text') ? 'Texted' : 'Emailed'} the customer: arriving about ${r.eta_text}`);
      e.target.textContent = '✉️ Sent. Send again';
      v.omw_at = new Date().toISOString();
    } catch (err) {
      // Texting is off and there's no email: fall back to a text from the tech's own phone.
      if (v.phone && /Texting is off/.test(err.message)) location.href = `sms:${v.phone}?&body=${encodeURIComponent(`Hi, this is ${ME.name.split(' ')[0]} with your pest control service. I'm on my way!`)}`;
      else toast(NV.t(err.message), true);
    } finally { e.target.disabled = false; }
  };
  if ($('#wdi')) $('#wdi').onclick = async () => {
    try { location.href = `/nuvolve/app/wdi.html?id=${(await api('/nuvolve/app/api/termite/wdi', { body: { property_id: v.property_id, date: v.date, reuse: true } })).id}`; } catch (e) { toast(e.message, true); }
  };
  $('#nav-app').onclick = () => navigateTo(v, { choose: true });
  // A deleted house photo falls back to the satellite view.
  if ($('#house-img')) $('#house-img').onerror = (e) => { if (v.lat != null && !e.target.dataset.fell) { e.target.dataset.fell = 1; e.target.src = housePhoto(v, 780, 420); } else e.target.closest('.house-pic').remove(); };
  clearInterval(window.onSiteTimer);
  if ($('#start')) $('#start').onclick = async () => {
    try { await saveOrQueue(`/nuvolve/app/api/visits/${v.id}/start`, { at: new Date().toISOString() }, { kind: 'start', visitId: v.id }); showStop(id); } catch (e) { toast(e.message, true); }
  };
  if ($('#timer')) {
    const t0 = new Date(v.started_at.replace(' ', 'T') + 'Z');
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - t0) / 1000));
      $('#timer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    tick();
    window.onSiteTimer = setInterval(() => ($('#timer') ? tick() : clearInterval(window.onSiteTimer)), 1000);
  }
  if (!done) {
    ticketForm($('#ticket'), v, PRODUCTS, (r) => {
      toast(r.queued ? "Saved on this phone. It sends when you're back online." : r.autopay?.charged ? `Done! Card charged ${money(r.autopay.amount)}` : 'Stop completed');
      location.hash = '#/';
    });
    $('#skip').onclick = () => modal('Skip this stop?', '<div class="field"><label>Why?</label><input name="reason" placeholder="Not home, locked gate, rain..."></div>', [
      { label: 'Back' },
      { label: 'Skip stop', cls: 'primary', onClick: async (m) => {
        const r = await saveOrQueue(`/nuvolve/app/api/visits/${v.id}/skip`, { ...formData(m), at: new Date().toISOString() }, { kind: 'skip', visitId: v.id });
        if (r.queued) toast("Saved on this phone. It sends when you're back online.");
        location.hash = '#/';
      } },
    ]);
  }
}

start();
