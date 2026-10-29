// Door-to-door mode for sales reps on a phone or tablet: the door map, one tap per knock, a quote on the doorstep,
// and the customer signs right on the screen. Office staff can open it too.
const app = document.getElementById('app');
let ME = null;
let BOOT = null;
let map = null;
let layers = null;
let here = null;          // the rep's GPS position
let follow = true;        // keep the map on the rep until they pan away
let satellite = false;
let watchId = null;

const OUTCOME = {
  not_home: { label: 'Not home', e: '🚪', color: '#a0aec0' },
  not_interested: { label: 'Not interested', e: '✋', color: '#e53e3e' },
  come_back: { label: 'Come back', e: '🕒', color: '#dd6b20' },
  interested: { label: 'Interested', e: '👍', color: '#3182ce' },
  sold: { label: 'Sold', e: '✅', color: '#2f855a' },
  do_not_knock: { label: 'Do not knock', e: '⛔', color: '#1a202c' },
};
const STAGE = { new: ['New lead', ''], contacted: ['Talking', 'blue'], quoted: ['Quoted', 'yellow'], won: ['Won', 'green'], lost: ['Lost', 'red'] };
const stagePill = (s) => `<span class="pill ${STAGE[s]?.[1] || ''}">${esc(STAGE[s]?.[0] || s)}</span>`;
const perYear = { one_time: 1, monthly: 12, bimonthly: 6, quarterly: 4, yearly: 1 };
const when = (s) => (s ? new Date(s.replace(' ', 'T') + (s.length <= 16 ? '' : 'Z')).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const ago = (s) => { if (!s) return ''; const d = new Date(s.replace(' ', 'T') + 'Z'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };

async function start() {
  try {
    BOOT = await api('/nuvolve/app/api/bootstrap');
    ME = BOOT.me;
  } catch {
    return login();
  }
  if (BOOT.company.locked) {
    app.innerHTML = '<div class="wrap"><div class="card" style="margin-top:40px"><h2>Account paused</h2><p>Your company\'s subscription needs attention. Ask the owner to log in and subscribe.</p></div></div>';
    return;
  }
  if (ME.role === 'tech') { location.href = '/nuvolve/app/tech'; return; }
  window.addEventListener('hashchange', show);
  show();
}

function login() {
  app.innerHTML = `<div class="login-wrap"><div class="login"><div class="card">
    <h1>Door to Door</h1><p class="muted">Log in with the email and password your manager gave you.</p>
    <form id="f"><div class="field"><label>Email</label><input name="email" type="email" autocomplete="username"></div>
    <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password"></div>
    <button class="btn primary big block">Log in</button></form></div></div></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try { await logIn(formData(e.target)); location.reload(); } catch (err) { if (!err.quiet) toast(err.message, true); }
  };
}

const tabbar = (on, due = 0) => `<div class="tabbar">
  <a href="#/" class="${on === 'map' ? 'on' : ''}">🗺️<br>Doors</a>
  <a href="#/leads" class="${on === 'leads' ? 'on' : ''}">📋<br>My leads${due ? `<span class="count">${due}</span>` : ''}</a>
  <a href="#/stats" class="${on === 'stats' ? 'on' : ''}">🏆<br>Stats</a>
  ${ME.role !== 'sales' ? '<a href="/#/sales">💼<br>Office</a>' : '<a href="#/me">👤<br>Me</a>'}</div>`;

function show() {
  const h = location.hash || '#/';
  if (h !== '#/' && map) { map.remove(); map = null; }
  if (h.startsWith('#/quote')) return showQuote(Object.fromEntries(new URLSearchParams(h.split('?')[1] || '')));
  if (h.startsWith('#/deal/')) return showDeal(h.split('/')[2]);
  if (h === '#/leads') return showLeads();
  if (h === '#/stats') return showStats();
  if (h === '#/me') return showMe();
  return showMap();
}

// ---------- the door map ----------
async function tally() {
  try {
    const lb = await api('/nuvolve/app/api/sales/leaderboard?period=today');
    const me = lb.rows.find((r) => r.id === ME.id) || { knocks: 0, talks: 0, sales: 0 };
    const el = $('#tally');
    if (el) el.innerHTML = `<div><b>${me.knocks}</b>doors</div><div><b>${me.talks}</b>talks</div><div><b>${me.sales}</b>sold</div>`;
  } catch { /* the tally is a nice-to-have */ }
}

async function showMap() {
  app.innerHTML = `<div class="top"><h1>🚪 Doors<div class="sub">${esc(ME.name)}</div></h1><div class="tally" id="tally"></div></div>
    <div id="map"></div><div class="crosshair" id="cross"></div>
    <div class="legend">${['not_home', 'come_back', 'interested', 'sold', 'not_interested', 'do_not_knock'].map((k) => `<div><i style="background:${OUTCOME[k].color}"></i>${OUTCOME[k].label}</div>`).join('')}<div>🏠 Customer</div></div>
    <div class="side-fabs"><button id="me" class="${follow ? 'on' : ''}" title="Follow my location" aria-label="Follow my location">📍</button><button id="sat" title="Satellite view" aria-label="Satellite view">🛰️</button></div>
    <div class="fab-row"><button class="btn primary big" id="knock">🚪 Log this door</button></div>
    ${tabbar('map')}`;
  const last = (() => { try { return JSON.parse(localStorage.getItem('nv_sell_view')); } catch { return null; } })();
  const start = here || last || BOOT.locations.find((l) => l.lat) || { lat: 39.5, lng: -98.35, zoom: 4 };
  map = L.map('map', { zoomControl: false }).setView([start.lat, start.lng], start.zoom || 18);
  const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap' });
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 19 });
  (satellite ? sat : street).addTo(map);
  layers = { territories: L.layerGroup().addTo(map), customers: L.layerGroup().addTo(map), doors: L.layerGroup().addTo(map), me: L.layerGroup().addTo(map) };
  $('#sat').classList.toggle('on', satellite);
  $('#sat').onclick = () => { satellite = !satellite; map.removeLayer(satellite ? street : sat); (satellite ? sat : street).addTo(map); $('#sat').classList.toggle('on', satellite); };
  $('#me').onclick = () => { follow = true; $('#me').classList.add('on'); if (here) map.setView([here.lat, here.lng], Math.max(map.getZoom(), 18)); else locate(); };
  map.on('dragstart', () => { follow = false; $('#me')?.classList.remove('on'); });
  let t = null;
  map.on('moveend', () => {
    clearTimeout(t);
    t = setTimeout(loadDoors, 250);
    const c = map.getCenter();
    try { localStorage.setItem('nv_sell_view', JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() })); } catch { /* private mode */ }
  });
  // Tap a house on the map, or line it up under the crosshair and tap the button.
  map.on('click', (e) => openSpot(e.latlng.lat, e.latlng.lng));
  $('#knock').onclick = () => { const c = map.getCenter(); openSpot(c.lat, c.lng); };
  locate();
  loadDoors();
  tally();
}

function locate() {
  if (!navigator.geolocation || watchId != null) return;
  watchId = navigator.geolocation.watchPosition((p) => {
    here = { lat: p.coords.latitude, lng: p.coords.longitude };
    if (!map) return;
    layers.me.clearLayers();
    L.circleMarker([here.lat, here.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#3182ce', fillOpacity: 1 }).addTo(layers.me);
    if (follow) map.setView([here.lat, here.lng], Math.max(map.getZoom(), 18));
  }, () => { watchId = null; }, { enableHighAccuracy: true, maximumAge: 10000 });
}

async function loadDoors() {
  if (!map) return;
  const b = map.getBounds();
  $('.zoom-note')?.remove();
  if (map.getZoom() < 14) {
    app.insertAdjacentHTML('beforeend', '<div class="zoom-note">Zoom in to see doors</div>');
    layers.doors.clearLayers(); layers.customers.clearLayers();
  }
  const d = await api(`/nuvolve/app/api/sales/map?s=${b.getSouth()}&w=${b.getWest()}&n=${b.getNorth()}&e=${b.getEast()}`).catch(() => null);
  if (!d || !map) return;
  layers.territories.clearLayers();
  for (const t of d.territories) {
    L.polygon(t.points, { color: t.color, weight: t.mine ? 4 : 2, fillOpacity: t.mine ? 0.08 : 0.03, dashArray: t.mine ? null : '6 6', interactive: false })
      .addTo(layers.territories).bindTooltip(`${t.name}${t.rep_name ? ` · ${t.rep_name}` : ''}`, { permanent: false });
  }
  if (map.getZoom() < 14) return;
  layers.doors.clearLayers();
  layers.customers.clearLayers();
  for (const c of d.customers) {
    L.marker([c.lat, c.lng], { icon: L.divIcon({ className: '', html: '<div style="font-size:18px;line-height:18px">🏠</div>', iconSize: [18, 18] }), keyboard: false })
      .addTo(layers.customers).bindPopup(`<b>Current customer</b><br>${esc(c.name || '')}${c.name ? '<br>' : ''}${esc(c.address || '')}`);
  }
  for (const door of d.doors) {
    const o = OUTCOME[door.status] || OUTCOME.not_home;
    const mk = L.circleMarker([door.lat, door.lng], { radius: 10, color: '#fff', weight: 2, fillColor: o.color, fillOpacity: 0.95 }).addTo(layers.doors);
    mk.on('click', (e) => { L.DomEvent.stopPropagation(e); openDoor(door.id); });
  }
}

// ---------- one door ----------
function sheet(html) {
  const back = document.createElement('div');
  back.className = 'sheet-back';
  back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  const close = () => { back.remove(); window.removeEventListener('hashchange', close); };
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  window.addEventListener('hashchange', close);
  document.body.appendChild(back);
  return { el: back, close };
}

async function openSpot(lat, lng) {
  const near = await api(`/nuvolve/app/api/sales/map?s=${lat - 0.00012}&w=${lng - 0.00015}&n=${lat + 0.00012}&e=${lng + 0.00015}`).catch(() => null);
  const door = near?.doors.sort((a, z) => Math.hypot(a.lat - lat, a.lng - lng) - Math.hypot(z.lat - lat, z.lng - lng))[0];
  if (door) return openDoor(door.id);
  doorSheet({ lat, lng, status: null, knocks: 0, knockLog: [] });
  const a = await api(`/nuvolve/app/api/sales/reverse?lat=${lat}&lng=${lng}`).catch(() => null);
  if (a?.address) {
    const f = $('.sheet [name=address]');
    if (f && !f.value) { f.value = a.address; $('.sheet [name=city]').value = a.city; $('.sheet [name=state]').value = a.state; $('.sheet [name=zip]').value = a.zip; }
  }
}

async function openDoor(id) {
  doorSheet(await api(`/nuvolve/app/api/sales/doors/${id}`));
}

function doorSheet(d) {
  const blocked = d.status === 'do_not_knock';
  const dealMine = d.deal && !d.deal.theirs;
  const s = sheet(`
    <h2>${d.id ? esc(d.address || 'This house') : 'New door'} ${d.status ? `<span class="pill" style="background:${OUTCOME[d.status].color};color:#fff">${OUTCOME[d.status].label}</span>` : ''}</h2>
    ${d.id ? `<div class="small muted">Knocked ${d.knocks} time${d.knocks === 1 ? '' : 's'}${d.last_rep ? ` · last by ${esc(d.last_rep)} ${ago(d.last_knock_at)}` : ''}${d.follow_up_at ? ` · come back ${when(d.follow_up_at)}` : ''}</div>` : ''}
    ${blocked ? '<div class="alert err" style="margin-top:10px"><span>⛔ They asked us not to knock. Skip this house.</span></div>' : ''}
    ${d.deal?.theirs ? `<div class="alert warn" style="margin-top:10px"><span>${esc(d.deal.owner_name || 'Another rep')} is working this house (${esc(STAGE[d.deal.stage]?.[0] || '')}).</span></div>` : ''}
    ${dealMine ? `<div class="alert info" style="margin-top:10px"><span>Your deal: ${esc(d.deal.customer_name)} ${stagePill(d.deal.stage)}</span><a class="btn sm" href="#/deal/${d.deal.id}">Open</a></div>` : ''}
    ${d.notes ? `<p class="small" style="margin:8px 0 0">📝 ${esc(d.notes)}</p>` : ''}
    ${d.id ? '' : `<div class="row" style="grid-template-columns:2fr 1fr .6fr .8fr;margin-top:8px">
      <div class="field"><label>Address</label><input name="address" autocomplete="off" placeholder="Finding the address..."></div>
      <div class="field"><label>City</label><input name="city"></div><div class="field"><label>State</label><input name="state"></div><div class="field"><label>Zip</label><input name="zip" inputmode="numeric"></div></div>`}
    <div class="outcomes">
      ${['not_home', 'not_interested', 'come_back'].map((k) => `<button type="button" data-o="${k}" ${blocked ? 'disabled' : ''}><span class="e">${OUTCOME[k].e}</span>${OUTCOME[k].label}</button>`).join('')}
      <button type="button" class="go" data-quote ${blocked || d.deal?.theirs ? 'disabled' : ''}><span class="e">👍</span>Interested: build a quote</button>
      <button type="button" data-o="do_not_knock" style="grid-column:span 3;font-size:13px;padding:8px">⛔ Do not knock</button>
    </div>
    <div id="extra"></div>
    ${d.knockLog?.length ? `<details><summary class="small">History</summary><ul class="knock-log">${d.knockLog.map((k) => `<li>${ago(k.created_at)} · ${esc(OUTCOME[k.outcome]?.label || k.outcome)}${k.rep ? ` · ${esc(k.rep)}` : ''}${k.notes ? ` · ${esc(k.notes)}` : ''}</li>`).join('')}</ul></details>` : ''}
  `);
  const spot = () => (d.id ? { door_id: d.id } : { lat: d.lat, lng: d.lng, ...formData($('.row', s.el) || s.el) });
  const save = async (body) => {
    try {
      await api('/nuvolve/app/api/sales/knocks', { body: { ...spot(), ...body } });
      s.close();
      toast(`${OUTCOME[body.outcome].e} ${OUTCOME[body.outcome].label}`);
      loadDoors(); tally();
    } catch (e) { toast(e.message, true); }
  };
  $$('[data-o]', s.el).forEach((b) => (b.onclick = () => {
    const o = b.dataset.o;
    if (o === 'not_home' || o === 'not_interested') return save({ outcome: o });
    $$('[data-o]', s.el).forEach((x) => x.classList.toggle('on', x === b));
    const tomorrow = `${addDays(todayStr(), 1)}T17:30`;
    $('#extra', s.el).innerHTML = o === 'come_back' ? `
      <div class="row"><div class="field"><label>Come back</label><input type="datetime-local" name="follow_up_at" value="${tomorrow}"></div>
        <div class="field"><label>Their name (optional)</label><input name="first_name" autocomplete="off"></div>
        <div class="field"><label>Phone (optional)</label><input name="phone" type="tel" autocomplete="off"></div></div>
      <div class="field"><label>Note</label><input name="notes" placeholder="Spouse decides, call after 5, has a dog..."></div>
      <button class="btn primary big block" id="ok">Save: come back</button>`
      : `<div class="field"><label>Why? (optional)</label><input name="notes" placeholder="Sign on the door, asked us to leave..."></div>
      <button class="btn danger big block" id="ok">Mark do not knock</button>`;
    $('#ok', s.el).onclick = () => {
      const f = formData($('#extra', s.el));
      save({ outcome: o, notes: f.notes, follow_up_at: f.follow_up_at, lead: { first_name: f.first_name, phone: f.phone } });
    };
  }));
  $('[data-quote]', s.el).onclick = () => {
    const q = d.id ? `door=${d.id}` : new URLSearchParams({ lat: d.lat, lng: d.lng, ...formData($('.row', s.el)) }).toString();
    s.close();
    location.hash = `#/quote?${dealMine ? `deal=${d.deal.id}&` : ''}${q}`;
  };
}

// ---------- quote at the door ----------
async function showQuote(p) {
  const [all, deal, door] = await Promise.all([
    api('/nuvolve/app/api/catalog'),
    p.deal ? api(`/nuvolve/app/api/sales/deals/${p.deal}`).catch(() => null) : null,
    p.door ? api(`/nuvolve/app/api/sales/doors/${p.door}`).catch(() => null) : null,
  ]);
  const addr = door?.address || p.address || '';
  // Door to door is homes, so commercial-only services stay off the list.
  const catalog = all.filter((s) => s.customer_type !== 'commercial');
  const lines = [];
  const known = deal && deal.customer_name !== 'No name yet';
  app.innerHTML = `<div class="top"><button class="btn sm" id="back">← Back</button><h1>Quote${addr ? `<div class="sub">${esc(addr)}</div>` : ''}</h1></div>
    <div class="wrap">
      <div class="card" id="who"><h2>Who are we protecting?</h2>
        ${known ? `<p><b>${esc(deal.customer_name)}</b>${deal.phone ? ` · ${esc(deal.phone)}` : ''}</p>` : `
        <div class="row"><div class="field"><label>First name</label><input name="first_name" autocomplete="off" required></div><div class="field"><label>Last name</label><input name="last_name" autocomplete="off"></div></div>
        <div class="row"><div class="field"><label>Mobile phone</label><input name="phone" type="tel" autocomplete="off"></div><div class="field"><label>Email</label><input name="email" type="email" autocomplete="off" placeholder="For their signed copy"></div></div>`}
      </div>
      <div class="card"><h2>Services</h2>
        <div class="svc-chips">${catalog.map((s) => `<button type="button" data-svc="${s.id}">${esc(s.name)} · ${money(s.price)}</button>`).join('')}</div>
        <div id="lines"></div>
        <div class="qtotal" id="tot"></div>
        <div class="row"><div class="field"><label>First visit on or after</label><input name="start_date" type="date" value="${todayStr()}"></div>
          <div class="field"><label>Title (optional)</label><input name="title" placeholder="Home protection plan"></div></div>
        <div class="field"><label>Note to the customer (optional)</label><textarea name="notes" rows="2" placeholder="Great meeting you today! Here's the plan we talked about."></textarea></div>
      </div>
      <button class="btn primary big block" id="sign">✍️ Sign now on this screen</button>
      <div class="row" style="margin-top:8px"><button class="btn big" id="send">📨 Text or email it</button><button class="btn big" id="later">Save for later</button></div>
      <p class="small muted" style="text-align:center;margin-top:10px">When they sign, their plan and first visit go on the schedule automatically.</p>
    </div>`;
  $('#back').onclick = () => history.back();
  const draw = () => {
    $('#lines').innerHTML = lines.map((l, i) => `<div class="qline"><b>${esc(l.name)}</b>
      <select data-f="${i}">${Object.entries(FREQ).map(([k, v]) => `<option value="${k}" ${k === l.frequency ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <input data-p="${i}" type="number" inputmode="decimal" step="0.01" min="0" value="${l.price}" aria-label="Price">
      <button type="button" class="btn sm" data-x="${i}" aria-label="Remove">✕</button></div>`).join('') || '<p class="muted small">Tap a service above to add it.</p>';
    const visit = lines.reduce((t, l) => t + (Number(l.price) || 0), 0);
    const year = lines.reduce((t, l) => t + (Number(l.price) || 0) * (perYear[l.frequency] || 1), 0);
    $('#tot').innerHTML = `<div><b>${money(visit)}</b>per visit</div><div><b>${money(year / 12)}</b>about per month</div><div><b>${money(year)}</b>first year</div>`;
    $$('.svc-chips [data-svc]').forEach((b) => b.classList.toggle('on', lines.some((l) => l.service_type_id === Number(b.dataset.svc))));
    $$('[data-f]').forEach((el) => (el.onchange = () => { lines[el.dataset.f].frequency = el.value; draw(); }));
    $$('[data-p]').forEach((el) => (el.onchange = () => { lines[el.dataset.p].price = el.value; draw(); }));
    $$('[data-x]').forEach((el) => (el.onclick = () => { lines.splice(Number(el.dataset.x), 1); draw(); }));
  };
  $$('[data-svc]').forEach((b) => (b.onclick = () => {
    const s = catalog.find((x) => x.id === Number(b.dataset.svc));
    const at = lines.findIndex((l) => l.service_type_id === s.id);
    if (at >= 0) lines.splice(at, 1); else lines.push({ service_type_id: s.id, name: s.name, frequency: s.default_frequency || 'quarterly', price: s.price });
    draw();
  }));
  const def = catalog.find((s) => s.is_default);
  if (def) lines.push({ service_type_id: def.id, name: def.name, frequency: def.default_frequency || 'quarterly', price: def.price });
  draw();
  const go = async (deliver, btn) => {
    if (!lines.length) return toast('Add at least one service', true);
    const who = formData($('#who'));
    if (!known && !who.first_name && !who.last_name && !who.phone) return toast('Add their name', true);
    const f = formData($('.wrap'));
    btn.disabled = true;
    try {
      const r = await api('/nuvolve/app/api/sales/quotes', { body: {
        deliver, deal_id: p.deal || null, door_id: p.door || null, lat: p.lat ?? null, lng: p.lng ?? null, address: p.address, city: p.city, state: p.state, zip: p.zip,
        customer: known ? undefined : who, title: f.title, notes: f.notes, start_date: f.start_date,
        items: lines.map((l) => ({ service_type_id: l.service_type_id, frequency: l.frequency, price: l.price })) } });
      if (deliver === 'sign_now') { location.href = r.sign_url; return; }
      toast(deliver === 'send' ? (r.sent?.length ? 'Quote sent' : 'Saved. Add a phone or email to send it.') : 'Saved to your leads');
      location.hash = `#/deal/${r.deal_id}`;
    } catch (e) { if (e.message) toast(e.message, true); btn.disabled = false; }
  };
  $('#sign').onclick = (e) => go('sign_now', e.target);
  $('#send').onclick = (e) => go('send', e.target);
  $('#later').onclick = (e) => go('draft', e.target);
}

// ---------- my leads ----------
async function showLeads() {
  const [f, pipe] = await Promise.all([api('/nuvolve/app/api/sales/follow-ups'), api('/nuvolve/app/api/sales/pipeline?days=30')]);
  const due = f.doors.length + f.deals.length;
  const open = [...pipe.stages.quoted, ...pipe.stages.contacted, ...pipe.stages.new];
  const row = (d) => `<a class="deal-row" href="#/deal/${d.id}"><div class="info"><b>${esc(d.customer_name)}</b> ${stagePill(d.stage)}
      <div class="small muted">${esc(d.address || '')}${d.next_step_at ? ` · ${esc(d.next_step || 'Follow up')} ${when(d.next_step_at)}` : ''}</div></div>
      <b class="nowrap">${money(d.value)}</b></a>`;
  app.innerHTML = `<div class="top"><h1>📋 My leads<div class="sub">${money(pipe.openValue)} open · ${pipe.totals.won.count} won in 30 days</div></h1></div>
    <div class="wrap">
      ${due ? `<div class="card flush"><div class="card-head" style="padding:12px 14px 0"><h2>Go back today</h2></div>
        ${f.doors.map((d) => `<div class="deal-row" data-door="${d.id}" data-lat="${d.lat}" data-lng="${d.lng}"><div class="info"><b>${esc(d.address || 'House on the map')}</b>
          <div class="small muted">🕒 ${when(d.follow_up_at)}${d.notes ? ` · ${esc(d.notes)}` : ''}</div></div><span class="btn sm">Map</span></div>`).join('')}
        ${f.deals.map(row).join('')}</div>` : ''}
      <div class="card flush"><div class="card-head" style="padding:12px 14px 0"><h2>Open deals</h2></div>
        ${open.length ? open.map(row).join('') : '<p class="muted" style="padding:0 14px 14px">No open deals yet. Go knock some doors!</p>'}</div>
      ${pipe.stages.won.length ? `<div class="card flush"><div class="card-head" style="padding:12px 14px 0"><h2>Won, last 30 days</h2></div>${pipe.stages.won.map(row).join('')}</div>` : ''}
    </div>${tabbar('leads', due)}`;
  $$('[data-door]').forEach((el) => (el.onclick = () => {
    follow = false;
    try { localStorage.setItem('nv_sell_view', JSON.stringify({ lat: Number(el.dataset.lat), lng: Number(el.dataset.lng), zoom: 19 })); } catch { /* private mode */ }
    location.hash = '#/';
  }));
}

async function showDeal(id) {
  const d = await api(`/nuvolve/app/api/sales/deals/${id}`);
  const e = d.estimate;
  const canSign = e && ['sent', 'viewed'].includes(e.status);
  app.innerHTML = `<div class="top"><button class="btn sm" id="back">← Back</button><h1>${esc(d.customer_name)}<div class="sub">${esc(d.address || '')}</div></h1></div>
    <div class="wrap">
      <div class="card"><div class="card-head"><h2>${stagePill(d.stage)} ${money(d.value)} <span class="small muted">first year</span></h2></div>
        ${d.phone ? `<p><a class="btn" href="tel:${esc(d.phone)}">📞 Call</a> <a class="btn" href="sms:${esc(d.phone)}">💬 Text</a></p>` : ''}
        ${e ? `<p>Quote #${e.id}: <b>${money(e.perVisit)}</b>/visit · ${esc({ draft: 'Not sent yet', sent: 'Sent', viewed: 'They opened it', accepted: 'Signed', declined: 'Declined', expired: 'Expired' }[e.status] || e.status)}</p>` : '<p class="muted">No quote yet.</p>'}
        <div class="actions">
          ${canSign ? `<a class="btn primary big" href="/nuvolve/app/sign/${esc(e.token)}?from=sell">✍️ Sign now</a>` : ''}
          ${d.stage !== 'won' ? `<a class="btn big" href="#/quote?deal=${d.id}${d.door_id ? `&door=${d.door_id}` : ''}">${e ? 'New quote' : 'Build a quote'}</a>` : ''}
          ${e && e.status === 'accepted' ? `<a class="btn" href="/nuvolve/app/sign/${esc(e.token)}?from=sell">Signed copy</a>` : ''}
        </div>
        ${d.lost_reason ? `<p class="small muted">Lost: ${esc(d.lost_reason)}</p>` : ''}
      </div>
      ${['new', 'contacted', 'quoted'].includes(d.stage) ? `<div class="card" id="next"><h2>Next step</h2>
        <div class="row"><div class="field"><label>What</label><input name="next_step" value="${esc(d.next_step || '')}" placeholder="Come back, call, send pics..."></div>
          <div class="field"><label>When</label><input type="datetime-local" name="next_step_at" value="${esc((d.next_step_at || '').replace(' ', 'T'))}"></div></div>
        <div class="actions"><button class="btn primary" id="save-next">Save</button><button class="btn danger" id="lost">Lost it</button></div></div>` : ''}
      <div class="card"><h2>Notes and history</h2>
        <div class="field"><textarea id="note" rows="2" placeholder="Add a note"></textarea></div><button class="btn sm" id="add-note">Add note</button>
        <ul class="knock-log" style="margin-top:12px">${d.events.map((ev) => `<li>${ago(ev.created_at)} · ${esc(ev.text || ev.kind)}${ev.user_name ? ` · ${esc(ev.user_name)}` : ''}</li>`).join('')}</ul></div>
    </div>`;
  $('#back').onclick = () => (history.length > 1 ? history.back() : (location.hash = '#/leads'));
  $('#add-note').onclick = async () => { try { await api(`/nuvolve/app/api/sales/deals/${d.id}/notes`, { body: { text: $('#note').value } }); showDeal(id); } catch (err) { toast(err.message, true); } };
  if ($('#save-next')) $('#save-next').onclick = async () => { await api(`/nuvolve/app/api/sales/deals/${d.id}`, { method: 'PUT', body: formData($('#next')) }); toast('Saved'); };
  if ($('#lost')) $('#lost').onclick = () => modal('Lost this one?', '<div class="field"><label>Why?</label><input name="lost_reason" placeholder="Price, went with someone else, renter..."></div>', [
    { label: 'Back' }, { label: 'Mark lost', cls: 'danger', onClick: async (m) => { await api(`/nuvolve/app/api/sales/deals/${d.id}`, { method: 'PUT', body: { stage: 'lost', ...formData(m) } }); showDeal(id); } }]);
}

// ---------- stats ----------
async function showStats(period = 'today') {
  const lb = await api(`/nuvolve/app/api/sales/leaderboard?period=${period}`);
  const me = lb.rows.find((r) => r.id === ME.id);
  app.innerHTML = `<div class="top"><h1>🏆 ${{ today: 'Today', week: 'Last 7 days', month: 'This month', year: 'This year' }[period]}<div class="sub">${me ? `You're #${me.rank} of ${lb.rows.length}` : 'Leaderboard'}</div></h1></div>
    <div class="wrap">
      <div class="tabs">${[['today', 'Today'], ['week', '7 days'], ['month', 'Month'], ['year', 'Year']].map(([k, l]) => `<a href="#/stats" data-p="${k}" class="${k === period ? 'on' : ''}">${l}</a>`).join('')}</div>
      ${me ? `<div class="stats" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat"><div class="label">Doors</div><div class="value">${me.knocks}</div></div>
        <div class="stat"><div class="label">Talked to</div><div class="value">${me.talks}</div></div>
        <div class="stat"><div class="label">Sold</div><div class="value">${me.sales}</div></div>
        <div class="stat"><div class="label">Revenue</div><div class="value">${money(me.revenue)}</div></div>
        <div class="stat"><div class="label">Close rate</div><div class="value">${me.closeRate ?? '—'}${me.closeRate != null ? '%' : ''}</div><div class="sub">of people you talked to</div></div>
        <div class="stat"><div class="label">Per door</div><div class="value">${me.perDoor != null ? money(me.perDoor) : '—'}</div></div></div>` : ''}
      <div class="card flush">${lb.rows.map((r) => `<div class="deal-row ${r.id === ME.id ? 'you' : ''}"><div class="rank" style="background:${esc(r.color || '#2f855a')}">${r.rank}</div>
        <div class="info"><b>${esc(r.name)}</b><div class="small muted">${r.knocks} doors · ${r.talks} talks · ${r.sales} sold</div></div><b>${money(r.revenue)}</b></div>`).join('') || '<p class="muted" style="padding:14px">No doors knocked yet.</p>'}</div>
    </div>${tabbar('stats')}`;
  $$('[data-p]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); showStats(a.dataset.p); }));
}

function showMe() {
  app.innerHTML = `<div class="top"><h1>👤 ${esc(ME.name)}<div class="sub">${esc(ME.email || '')}</div></h1></div>
    <div class="wrap"><div class="card"><p>Signed in as a sales rep for <b>${esc(BOOT.settings.company_name || BOOT.company.name || '')}</b>.</p>
      <button class="btn big block" id="out">Log out</button></div></div>${tabbar('me')}`;
  $('#out').onclick = async () => { await api('/nuvolve/app/api/logout', { method: 'POST' }); location.reload(); };
}

start();
