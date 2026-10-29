// Technician phone view: today's route, one stop at a time, complete with a ticket.
const app = document.getElementById('app');
let ME = null;
let PRODUCTS = [];
let day = todayStr();

// Installable app that keeps working with no signal. See tech-sw.js and outbox.js.
/* offline mode is off in the demo */
const DATA_CACHE = 'nv-tech-data';
const forgetSaved = () => (window.caches ? caches.delete(DATA_CACHE) : Promise.resolve()).catch(() => {});

async function start() {
  try {
    const b = await api('/nuvolve/app/api/bootstrap');
    ME = b.me;
    PRODUCTS = b.products;
    if (b.company.locked) {
      app.innerHTML = '<div class="wrap"><div class="card" style="margin-top:40px"><h2>Account paused</h2><p>Your company\'s subscription needs attention. Ask the office or owner to log in and subscribe.</p></div></div>';
      return;
    }
  } catch (e) {
    if (e.status === 401 || e.status === 403) return login();
    // First time on this phone and no signal: nothing is saved yet.
    app.innerHTML = `<div class="wrap"><div class="card" style="margin-top:40px"><h2>📴 No signal</h2>
      <p>Open the app once with signal and your route is saved on this phone for next time.</p><button class="btn primary big block" id="again">Try again</button></div></div>`;
    $('#again').onclick = () => location.reload();
    return;
  }
  window.addEventListener('hashchange', show);
  Outbox.onChange((msg) => { drawSync(); if (msg === 'login') { toast('Log in again to send your saved tickets', true); login(); } });
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
  const label = { on: '📍 Sharing location with the office', starting: '📍 Finding you...', off: '📍 Location paused. Tap to share',
    denied: '📍 Location blocked. Allow it in your phone settings', error: "📍 Can't get a GPS fix", unavailable: '📍 Location needs the https app' }[GPS.state];
  el.textContent = label;
  el.classList.toggle('on', GPS.state === 'on');
}

// The bar at the bottom: no signal, saves waiting to go, or a save the office has to look at.
async function drawSync() {
  const bar = $('#syncbar');
  const { pending, failed } = await Outbox.counts().catch(() => ({ pending: 0, failed: 0 }));
  const n = (k) => `${k} ${k === 1 ? 'save' : 'saves'}`;
  const online = navigator.onLine;
  bar.classList.toggle('bad', failed > 0);
  bar.hidden = online && !pending && !failed;
  bar.innerHTML = failed ? `<span>⚠️ ${n(failed)} couldn't go through.</span><button class="btn sm" id="sync-why">See why</button>`
    : pending && online ? `<span>⏳ Sending ${n(pending)} from this phone...</span><button class="btn sm" id="sync-now">Send now</button>`
      : pending ? `<span>📴 No signal. ${n(pending)} on this phone. They send by themselves when you're back online.</span>`
        : '<span>📴 No signal. Keep working. Tickets save on this phone and send later.</span>';
  if ($('#sync-now')) $('#sync-now').onclick = async () => { await Outbox.flush().catch(() => {}); drawSync(); };
  if ($('#sync-why')) $('#sync-why').onclick = showFailed;
}

const SAVE_KIND = { start: 'Start service', complete: 'Completed ticket', skip: 'Skipped stop', photo: 'Photo' };
async function showFailed() {
  const items = (await Outbox.list()).filter((i) => i.status === 'failed');
  const m = modal("Saves that didn't go through", `<p class="small muted">The server turned these down. Open the stop to fix it and save again, or remove it.</p>
    ${items.map((i) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)"><b>${esc(SAVE_KIND[i.kind] || 'Save')}</b> <span class="small muted">${fmtTime(i.at)}</span>
      <div class="small" style="color:var(--danger)">${esc(i.error)}</div>
      <div class="actions" style="margin-top:6px">${i.visitId ? `<a class="btn sm" href="#/stop/${i.visitId}">Open stop</a>` : ''}<button class="btn sm" data-rm="${i.id}">Remove</button></div></div>`).join('')}`, [{ label: 'Close' }]);
  $$('a', m.el).forEach((a) => a.addEventListener('click', () => m.close()));
  $$('[data-rm]', m.el).forEach((b) => (b.onclick = async () => {
    if (!confirm('Remove this save from the phone? It will not reach the office.')) return;
    await Outbox.remove(Number(b.dataset.rm));
    b.closest('div[style]').remove();
  }));
}
const fmtTime = (t) => new Date(t).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const savedNote = (r) => (r.savedAt ? `<div class="saved-copy">📴 Saved copy from ${fmtTime(r.savedAt)}</div>` : '');

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
  return `<div class="card" id="install" style="display:flex;gap:10px;align-items:center"><div style="flex:1"><b>📲 Put My Route on your home screen</b>
    <div class="small muted">${installEvent ? 'Opens like an app and works with no signal.' : 'Tap the Share button, then <b>Add to Home Screen</b>. It works with no signal.'}</div></div>
    ${installEvent ? '<button class="btn primary sm" id="install-go">Install</button>' : ''}<button class="btn sm" id="install-x" aria-label="Hide">✕</button></div>`;
}
function wireInstall() {
  if ($('#install-go')) $('#install-go').onclick = async () => { installEvent.prompt(); await installEvent.userChoice; installEvent = null; $('#install')?.remove(); };
  if ($('#install-x')) $('#install-x').onclick = () => { try { localStorage.setItem('nv_install_hide', '1'); } catch { /* private mode */ } $('#install').remove(); };
}

function login() {
  app.innerHTML = `<div class="login-wrap"><div class="login"><div class="card">
    <h1>My Route</h1><p class="muted">Log in with the email and password your office gave you.</p>
    <form id="f"><div class="field"><label>Email</label><input name="email" type="email" autocomplete="username"></div>
    <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password"></div>
    <button class="btn primary big block">Log in</button></form>
    <p class="small" style="text-align:center;margin-top:12px"><a href="/nuvolve/app/">Forgot password?</a></p></div></div></div>`;
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

const tabbar = (on) => `<div class="tabbar"><a href="#/" class="${on === 'route' ? 'on' : ''}">🗺️<br>My route</a><a href="#/truck" class="${on === 'truck' ? 'on' : ''}">🚚<br>My truck</a><a href="#/stats" class="${on === 'stats' ? 'on' : ''}">🏆<br>My stats</a></div>`;

// What's on the truck, and the label and SDS for every product, for the customer who asks or the inspector who checks.
async function showTruck() {
  const d = await api('/nuvolve/app/api/my-truck');
  const low = d.products.filter((p) => p.par != null && p.on_hand < p.par);
  app.innerHTML = `
    <div class="top"><h1>🚚 ${d.truck ? esc(d.truck.name) : 'Labels & SDS'}</h1><div class="sub">${d.truck ? (low.length ? `${low.length} product${low.length > 1 ? 's' : ''} under your truck level` : 'Stocked up') : 'The office hasn\'t assigned you a truck yet'}</div></div>
    <div class="wrap"><div class="card flush">
      ${d.products.map((p) => `<div class="stop" style="display:block">
        <div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(p.name)}${p.restricted_use ? ' <span class="pill red">RUP</span>' : ''}</b>
          ${d.truck && (p.on_hand || p.par != null) ? `<b style="${p.par != null && p.on_hand < p.par ? 'color:var(--danger)' : ''}">${p.on_hand} ${esc(p.unit)}</b>` : ''}</div>
        <div class="small muted">${p.epa_reg ? `EPA ${esc(p.epa_reg)}` : ''}${p.signal_word ? ` · ${esc(p.signal_word)}` : ''}${p.par != null ? ` · level ${p.par} ${esc(p.unit)}` : ''}</div>
        <div class="small" style="margin-top:4px">${p.label_url ? `<a href="${esc(p.label_url)}" target="_blank" rel="noopener">📄 Label</a>` : '<span class="muted">No label linked</span>'}
          · ${p.sds_url ? `<a href="${esc(p.sds_url)}" target="_blank" rel="noopener">⚠️ SDS</a>` : p.sds_search_url ? `<a href="${esc(p.sds_search_url)}" target="_blank" rel="noopener">Find SDS</a>` : ''}</div>
      </div>`).join('') || '<p class="muted" style="padding:12px">No products yet.</p>'}
    </div></div>${tabbar('truck')}`;
}

// Leaderboard and the tech's own numbers. 5-stars and Google reviews earn the most points.
async function showStats() {
  let lb, notes, lic, pay;
  try {
    [lb, notes, lic, pay] = await Promise.all([api('/nuvolve/app/api/leaderboard?period=month'), api('/nuvolve/app/api/notifications').catch(() => []), api('/nuvolve/app/api/my-licenses').catch(() => null), api('/nuvolve/app/api/my-pay').catch(() => null)]);
  } catch {
    app.innerHTML = `<div class="top"><h1>🏆 This month</h1></div><div class="wrap"><div class="empty"><div class="big">📴</div><h3>No signal</h3><p>Your stats show up when you're back online.</p></div></div>${tabbar('stats')}`;
    return;
  }
  api('/nuvolve/app/api/notifications/read', { method: 'POST' }).catch(() => {});
  const p = pay?.show ? pay.line : null;
  const me = lb.rows.find((r) => r.id === ME.id);
  app.innerHTML = `
    <div class="top"><h1>🏆 This month</h1><div class="sub">${me ? `You're #${me.rank} of ${lb.rows.length} with ${me.points} points` : 'Leaderboard'}</div></div>
    <div class="wrap">
      ${me ? `<div class="stats" style="grid-template-columns:1fr 1fr">
        <div class="stat"><div class="label">5-star ratings</div><div class="value">${me.five}</div></div>
        <div class="stat"><div class="label">Sent to Google</div><div class="value">${me.google}</div></div>
        <div class="stat"><div class="label">Avg rating</div><div class="value">${me.avg ?? '—'}</div></div>
        <div class="stat"><div class="label">Tips</div><div class="value">${money(me.tips)}</div></div>
      </div>${me.badges.length ? `<div class="card">${me.badges.map((b) => `<span class="pill green" style="margin:2px">${esc(b)}</span>`).join('')}</div>` : ''}` : ''}
      ${p ? `<div class="card"><h3>💵 My pay so far</h3><div class="small muted">${fmtDate(pay.from)} to ${fmtDate(pay.to)}</div>
        <div style="font-size:30px;font-weight:700;margin:6px 0">${money(p.gross)}</div>
        <div class="small">${[p.pay_type === 'production' && `${money(p.production)} of work on ${p.stops} stops`, p.pay_type !== 'salary' && `${p.hours} hours${p.ot ? ` (${p.ot} overtime)` : ''}`,
          p.commission && `${money(p.commission)} commission on ${p.sales} sale${p.sales === 1 ? '' : 's'}`, p.tips && `${money(p.tips)} tips`].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="small muted" style="margin-top:4px">Before taxes. Final pay is set when the office approves payroll.</div></div>` : ''}
      <div class="card flush">
        ${lb.rows.map((r) => `<div class="stop" style="${r.id === ME.id ? 'background:var(--brand-soft)' : ''}">
          <div class="n" style="background:${esc(r.color)}">${r.rank}</div>
          <div class="info"><b>${esc(r.name)}${r.id === ME.id ? ' (you)' : ''}</b><div class="small muted">${r.five} five-stars · ${r.google} Google · ${r.stops} stops</div></div>
          <b>${r.points}</b></div>`).join('')}
      </div>
      ${lic ? licenseCard(lic) : ''}
      <div class="card" style="display:flex;gap:14px;align-items:center">
        <img id="myface" class="face-sm" src="/nuvolve/app/api/users/${ME.id}/photo?${Date.now()}" alt="">
        <div style="flex:1"><b>Your photo</b><div class="small muted">Customers see it in your on-my-way text, so they know who's at the door.</div>
        <label class="btn sm" style="margin-top:6px">📷 Take or pick a photo<input type="file" accept="image/*" capture="user" id="face-in" hidden></label></div>
      </div>
      <p class="small muted" style="text-align:center">${lb.points.five} pts per 5-star · ${lb.points.google} pts when they post on Google · ${lb.points.stop} pt per stop</p>
      ${notes.length ? `<div class="card"><h3>Recent</h3>${notes.slice(0, 8).map((n) => `<div class="small" style="padding:5px 0;border-bottom:1px solid var(--line)">${esc(n.text)} <span class="muted">${fmtDate(n.created_at)}</span></div>`).join('')}</div>` : ''}
    </div>${tabbar('stats')}`;
  $('#log-ceu').onclick = () => modal('Log a class', `
    <div class="field"><label>Course or class</label><input name="course" placeholder="Termite and WDO update"></div>
    <div class="row"><div class="field"><label>Credits</label><input name="credits" type="number" step="0.5" min="0.5" value="1"></div>
    <div class="field"><label>Finished on</label><input name="completed_on" type="date" value="${todayStr()}"></div></div>
    <div class="field"><label>Provider</label><input name="provider" placeholder="State extension, association, online"></div>`,
  [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (el) => { await api('/nuvolve/app/api/my-ceus', { body: formData(el) }); toast('Class logged'); showStats(); } }]);
}

// The tech's own licenses: when each renews and how many CEUs are still needed.
function licenseCard({ licenses, ceus }) {
  const pill = { current: 'green', expiring: 'yellow', expired: 'red' };
  return `<div class="card"><h3>My licenses</h3>
    ${licenses.length ? licenses.map((l) => `<div style="padding:6px 0;border-bottom:1px solid var(--line)">
      <b>${esc(l.category)}</b>${l.license_no ? ` <span class="small muted">#${esc(l.license_no)}</span>` : ''}
      <span class="pill ${pill[l.status]}" style="float:right">${l.status === 'expired' ? 'Expired' : l.status === 'expiring' ? 'Renew soon' : 'Current'}</span>
      <div class="small muted">${l.expires_on ? `${l.days_left < 0 ? 'Expired' : 'Expires'} ${fmtDate(l.expires_on)}` : 'No expiration on file'}${l.ceu_required ? ` · ${l.ceu_earned} of ${l.ceu_required} CEUs` : ''}</div></div>`).join('')
    : '<p class="small muted">None on file. Ask the office to add your license.</p>'}
    ${ceus.length ? `<div class="small muted" style="margin-top:8px">Last class: ${esc(ceus[0].course)}, ${fmtDate(ceus[0].completed_on)}</div>` : ''}
    <button class="btn block" id="log-ceu" style="margin-top:10px">+ Log a class (CEUs)</button></div>`;
  $('#myface').onerror = (e) => { e.target.style.visibility = 'hidden'; };
  $('#face-in').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      await api('/nuvolve/app/api/me/photo', { method: 'PUT', body: { data: await shrinkImage(f, 480) } });
      $('#myface').style.visibility = '';
      $('#myface').src = `/nuvolve/app/api/users/${ME.id}/photo?${Date.now()}`;
      toast('Photo saved');
    } catch (err) { toast(err.message, true); }
  };
}

async function showRoute() {
  let r, notes, clk;
  try {
    [r, notes, clk] = await Promise.all([api(`/nuvolve/app/api/my-route?date=${day}`), api('/nuvolve/app/api/notifications').catch(() => []), api('/nuvolve/app/api/clock').catch(() => null)]);
  } catch (e) {
    app.innerHTML = `<div class="top"><h1>${fmtDate(day, { weekday: 'long', month: 'short', day: 'numeric' })}</h1></div><div class="wrap">
      <div class="empty"><div class="big">📴</div><h3>Not saved on this phone</h3><p>${esc(e.offline || !e.status ? 'Open this day once with signal to keep it for later.' : e.message)}</p>
      <button class="btn" id="today">Back to today</button></div></div>${tabbar('route')}`;
    $('#today').onclick = () => { day = todayStr(); showRoute(); };
    return;
  }
  const local = await localState();
  r.stops = r.stops.map((s) => applyLocal(s, local.get(s.id)));
  const fresh = notes.filter((n) => !n.read);
  const done = r.stops.filter((s) => s.status !== 'scheduled').length;
  const next = r.stops.find((s) => s.status === 'scheduled');
  app.innerHTML = `
    <div class="top">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><h1>Hi ${esc(ME.name.split(' ')[0])}</h1><div class="sub">${fmtDate(day, { weekday: 'long', month: 'short', day: 'numeric' })} · ${done} of ${r.stops.length} stops done</div>${savedNote(r)}</div>
        <button class="btn sm" id="out">Log out</button>
      </div>
      <div class="progress"><div style="width:${r.stops.length ? (done / r.stops.length) * 100 : 0}%"></div></div>
      <button type="button" id="gps" class="gps-badge"></button>
      <div class="daybar">${[-1, 0, 1].map((o) => { const d = addDays(todayStr(), o); return `<button data-d="${d}" class="${d === day ? 'on' : ''}">${fmtDay(d)}</button>`; }).join('')}</div>
    </div>
    <div class="wrap">
      ${installCard()}
      ${clk ? `<div class="card" style="display:flex;align-items:center;gap:10px;padding:10px 14px">
        <div style="flex:1">${clk.clockedIn ? `⏱ <b>On the clock</b> since ${new Date(clk.since).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : '⏱ <b>Off the clock</b>'}
          <div class="small muted">${clk.weekHours} hours this week</div></div>
        <button class="btn ${clk.clockedIn ? '' : 'primary'}" id="clock">${clk.clockedIn ? 'Clock out' : 'Clock in'}</button></div>` : ''}
      ${fresh.length ? `<a href="#/stats" class="alert ok" style="text-decoration:none">🎉 ${esc(fresh[0].text)}${fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ''}</a>` : ''}
      ${next ? `<a class="btn primary big block" href="#/stop/${next.id}" style="margin-bottom:12px">▶ Next stop: ${esc([next.first_name, next.last_name].filter(Boolean).join(' ') || next.company)}</a>` : ''}
      ${r.plan?.finish_text ? `<div class="small muted" style="text-align:center;margin:-4px 0 10px">About ${r.plan.drive_min} min of driving left · done around ${esc(r.plan.finish_text)}</div>` : ''}
      ${r.summary.mapsUrl ? `<a class="btn block" href="${esc(r.summary.mapsUrl)}" target="_blank" style="margin-bottom:12px">🗺️ Whole route in Google Maps${r.summary.miles ? ` (~${r.summary.miles} mi)` : ''}</a>` : ''}
      ${r.stops.length ? r.stops.map((s, i) => `<div class="tstop-wrap"><a class="tstop ${s.status}" href="#/stop/${s.id}">
        <div class="n">${s.status === 'completed' ? '✓' : i + 1}</div>
        ${s.photo_id || s.lat != null ? `<img class="tthumb" src="${s.photo_id ? `/nuvolve/app/api/photos/${s.photo_id}` : housePhoto(s, 160, 160)}" alt="" loading="lazy">` : ''}
        <div class="info"><b>${esc(s.company || [s.first_name, s.last_name].filter(Boolean).join(' '))}</b>
          <div class="small">${esc(s.address)}, ${esc(s.city || '')}</div>
          <div class="small muted">${esc(s.service_name || '')}${s.time_window ? ` · ⏰ ${esc(s.time_window)}` : ''}${s.status === 'skipped' ? ' · Skipped' : ''}</div>
          ${s.on_site ? '<div class="small"><b>On site now</b></div>' : s.eta_text ? `<div class="small ${s.late_min > 0 ? 'late' : ''}">ETA ${esc(s.eta_text)}${s.late_min > 0 ? ` · ${s.late_min} min past the window` : ''}${s.omw_at ? ' · ✉️ Told on my way' : ''}</div>` : ''}
          ${s.waiting ? '<div class="small waiting">⏳ Saved on this phone, sends when there\'s signal</div>' : ''}${s.needsFix ? '<div class="small fix">⚠️ Didn\'t go through. Tap to fix.</div>' : ''}</div></a>
        ${s.status === 'scheduled' ? `<button type="button" class="tnav" data-go="${i}" aria-label="Navigate to ${esc(s.address)}">🧭<span>Go</span></button>` : ''}</div>`).join('')
        : '<div class="empty"><div class="big">☀️</div><h3>No stops</h3><p>Nothing on your route for this day.</p></div>'}
    </div>${tabbar('route')}`;
  $$('.daybar button').forEach((b) => (b.onclick = () => { day = b.dataset.d; showRoute(); }));
  $$('[data-go]').forEach((b) => (b.onclick = () => navigateTo(r.stops[Number(b.dataset.go)])));
  $('#out').onclick = async () => {
    const { pending, failed } = await Outbox.counts();
    if (pending + failed && !confirm(`${pending + failed} save${pending + failed > 1 ? 's' : ''} on this phone haven't reached the office yet. Logging out deletes them. Log out anyway?`)) return;
    try { await api('/nuvolve/app/api/logout', { method: 'POST' }); } catch (e) { return toast(e.status ? e.message : 'You need signal to log out', true); }
    await Outbox.clear();
    await forgetSaved();
    location.reload();
  };
  wireInstall();
  saveDayForLater(r);
  $('#gps').onclick = () => {
    try { localStorage.setItem('nv_gps_off', gpsPaused() || GPS.state !== 'on' ? '' : '1'); } catch { /* private mode */ }
    shareLocation();
  };
  gpsBadge();
  if ($('#clock')) $('#clock').onclick = async (e) => {
    e.target.disabled = true;
    try { await api('/nuvolve/app/api/clock', { body: { action: clk.clockedIn ? 'out' : 'in' } }); toast(clk.clockedIn ? 'Clocked out. Nice work!' : 'Clocked in'); } catch (err) { toast(err.message, true); }
    showRoute();
  };
}

async function showStop(id) {
  let v;
  try {
    v = await api(`/nuvolve/app/api/visits/${id}`);
  } catch (e) {
    app.innerHTML = `<div class="top"><a href="#/" style="color:#a8c3b4;text-decoration:none">← Route</a></div><div class="wrap"><div class="empty"><div class="big">📴</div>
      <h3>This stop isn't saved on this phone</h3><p>${esc(e.offline || !e.status ? 'Open it once with signal and it stays on the phone for later.' : e.message)}</p></div></div>`;
    return;
  }
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
      <h1 style="margin-top:6px">${esc(name)}</h1><div class="sub">${esc(v.service_name || 'Service')} · ${money(v.price)}</div>${savedNote(v)}</div>
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
        </div>
        <div class="small" style="text-align:right;margin-top:-4px"><button type="button" class="link-btn" id="nav-app">${navPref() ? `Using ${NAV_APPS[navPref()]?.label}. Change` : 'Pick map app'}</button></div>
        ${v.access_notes ? `<div class="alert warn">🔑 ${esc(v.access_notes)}</div>` : ''}
        ${v.office_notes ? `<div class="alert info">📝 ${esc(v.office_notes)}</div>` : ''}
        ${v.customer_notes ? `<p class="small muted">${esc(v.customer_notes)}</p>` : ''}
      </div>
      ${/termite|wdi|wood.destroying/i.test(v.service_name || '') || v.devices.some((d) => ['termite', 'termite_ag'].includes(d.type)) ? `<div class="card"><h3>🐜 Termite</h3>
        <div class="bigbtns"><a class="btn" href="/nuvolve/app/graph.html?property=${v.property_id}">📐 Graph</a><button type="button" class="btn" id="wdi">📝 WDI report</button></div></div>` : ''}
      ${v.history.length ? `<div class="card"><h3>Last visits</h3>${v.history.slice(0, 3).map((h) => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)"><b>${fmtDate(h.date)}</b> ${esc(h.target_pests || '')}<br>${esc(h.tech_notes || '')}
        ${h.internal_notes ? `<div class="office-note-view">🔒 ${esc(h.internal_notes)}</div>` : ''}</div>`).join('')}</div>` : ''}
      ${done ? '' : v.started_at
    ? `<div class="alert ok" style="justify-content:space-between">⏱️ On site <span class="timer" id="timer"></span></div>`
    : '<button class="btn primary big block" id="start" style="margin-bottom:12px">▶ Start service (I\'m here)</button>'}
      <div class="card">
        ${v.needsFix ? `<div class="alert warn">⚠️ This was saved with no signal, but the office's system turned it down: ${esc(v.needsFix)} Fix it below and save again.</div>` : ''}
        ${v.waiting ? `<div class="alert info">⏳ Saved on this phone. It sends by itself when you have signal${v.status === 'completed' ? ', and the customer gets their report then' : ''}.</div>` : ''}
        ${done ? `<h2>${v.status === 'completed' ? '✅ Completed' : 'Skipped'}</h2><p>${esc(v.tech_notes || '')}</p>
          ${v.internal_notes ? `<div class="office-note-view">🔒 ${esc(v.internal_notes)}</div>` : ''}
          ${v.status === 'completed' && !v.waiting ? `<a class="btn block" href="/nuvolve/app/api/visits/${v.id}/report" target="_blank" rel="noopener">🧪 Show the customer their service report</a>` : ''}`
          : `<h2>Service ticket</h2><div id="ticket"></div><button class="btn block" id="skip" style="margin-top:10px">Can't do it today (skip)</button>`}
      </div>
    </div>`;
  $('#nav').onclick = () => navigateTo(v);
  // Texts the customer the arrival time, the tech's photo and a live tracking link.
  if ($('#omw')) $('#omw').onclick = async (e) => {
    e.target.disabled = true;
    try {
      const r = await api(`/nuvolve/app/api/visits/${v.id}/on-my-way`, { body: { resend: Boolean(v.omw_at) } });
      toast(`${r.sent.includes('text') ? 'Texted' : 'Emailed'} the customer: arriving about ${r.eta_text}`);
      e.target.textContent = '✉️ Sent. Send again';
      v.omw_at = new Date().toISOString();
    } catch (err) {
      // Texting is off and there's no email: fall back to a text from the tech's own phone.
      if (v.phone && /Texting is off/.test(err.message)) location.href = `sms:${v.phone}?&body=${encodeURIComponent(`Hi, this is ${ME.name.split(' ')[0]} with your pest control service. I'm on my way!`)}`;
      else toast(err.message, true);
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
        const r = await saveOrQueue(`/nuvolve/app/api/visits/${v.id}/skip`, formData(m), { kind: 'skip', visitId: v.id });
        if (r.queued) toast("Saved on this phone. It sends when you're back online.");
        location.hash = '#/';
      } },
    ]);
  }
}

start();
