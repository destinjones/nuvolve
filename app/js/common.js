// Helpers shared by the office app, the tech app, and the pay portal.

// The branch picked in the top bar rides along on every request.
const currentBranch = () => { try { return localStorage.getItem('nv_loc') || ''; } catch { return ''; } };

async function api(path, opts = {}) {
  const headers = { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...opts.headers };
  if (currentBranch()) headers['X-Location'] = currentBranch();
  const res = await fetch(path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  // The tech app's service worker answered from the phone because there's no signal.
  const savedAt = res.headers.get('x-nv-saved-at');
  if (savedAt && data && typeof data === 'object') Object.defineProperty(data, 'savedAt', { value: savedAt });
  if (!res.ok) {
    // A company rule blocked this. Show what is missing; owners and admins can override.
    if (res.status === 422 && data?.rules && !opts.noRuleModal) return ruleBlocked(path, opts, data);
    // The company requires two-factor login and this person hasn't set it up yet.
    if (res.status === 403 && data?.setup2fa && typeof pageAccount === 'function' && location.hash !== '#/account') location.hash = '#/account';
    const err = new Error(data?.error || 'Something went wrong');
    err.status = res.status;
    err.offline = Boolean(data?.offline);
    throw err;
  }
  return data;
}

// A save that must not be lost in a dead zone. The tech app keeps it on the phone until there's signal
// and resolves with { queued: true }; everywhere else it's a normal request.
const saveOrQueue = (path, body, meta) => (typeof Outbox !== 'undefined' ? Outbox.send(path, body, meta) : api(path, { body }));

function ruleBlocked(path, opts, data) {
  return new Promise((resolve, reject) => {
    const quiet = Object.assign(new Error(''), { status: 422, rules: data.rules });
    const m = modal('Not yet: a company rule needs this first', `<ul class="rule-list">${data.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      <p class="small muted">${data.canOverride ? 'You can override this once as an owner or admin. Overrides are saved in the activity log.' : 'Your owner or admin sets these rules in Settings → Rules.'}</p>`,
    [{ label: 'OK, fix it', onClick: () => { reject(quiet); } },
      ...(data.canOverride ? [{ label: 'Override and save', cls: 'primary', onClick: async () => {
        try { resolve(await api(path, { ...opts, body: { ...opts.body, override_rules: true }, noRuleModal: true })); } catch (e) { reject(e); }
      } }] : [])]);
    $('.x', m.el).addEventListener('click', () => reject(quiet));
    m.el.addEventListener('mousedown', (e) => { if (e.target === m.el) reject(quiet); });
  });
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function ymd(d) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
const todayStr = () => ymd(new Date());
function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
function fmtDate(s, opts) {
  if (!s) return '';
  return parseYmd(s.slice(0, 10)).toLocaleDateString('en-US', opts || { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDay(s) {
  if (!s) return '';
  const t = todayStr();
  if (s === t) return 'Today';
  if (s === addDays(t, 1)) return 'Tomorrow';
  if (s === addDays(t, -1)) return 'Yesterday';
  return parseYmd(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
const FREQ = { one_time: 'One time', monthly: 'Monthly', bimonthly: 'Every 2 months', quarterly: 'Quarterly', yearly: 'Yearly' };

function toast(msg, isErr) {
  if (!msg) return;
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), isErr ? 5000 : 2800);
}

// Opens a modal. `body` is HTML. Returns { el, close }.
function modal(title, body, buttons = []) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
    <div class="mh"><h2>${esc(title)}</h2><button class="x" aria-label="Close">&times;</button></div>
    <div class="mb">${body}</div>
    ${buttons.length ? '<div class="mf"></div>' : ''}
  </div>`;
  // Escape, a click outside, or leaving the page closes it.
  const onKey = (e) => { if (e.key === 'Escape' && back === $$('.modal-back').pop()) close(); };
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); window.removeEventListener('hashchange', close); };
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', close);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  $('.x', back).onclick = close;
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (b.cls || '');
    btn.textContent = b.label;
    btn.onclick = async () => {
      if (!b.onClick) return close();
      btn.disabled = true;
      try {
        if ((await b.onClick(back)) !== false) close();
      } catch (e) {
        toast(e.message, true);
      } finally {
        btn.disabled = false;
      }
    };
    $('.mf', back).appendChild(btn);
  }
  document.body.appendChild(back);
  const first = $('input, select, textarea', back);
  if (first) setTimeout(() => first.focus(), 30);
  return { el: back, close };
}

// Reads every named input inside a container into an object.
function formData(root) {
  const out = {};
  for (const el of $$('[name]', root)) {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else out[el.name] = el.value.trim();
  }
  return out;
}

// Finger/mouse signature pad on a canvas.
function signaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let dirty = false;
  const size = () => {
    const r = canvas.getBoundingClientRect();
    canvas.width = r.width * devicePixelRatio;
    canvas.height = r.height * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1a202c';
  };
  size();
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  canvas.addEventListener('pointerdown', (e) => {
    drawing = true; dirty = true;
    canvas.setPointerCapture(e.pointerId);
    ctx.beginPath(); ctx.moveTo(...pos(e));
  });
  canvas.addEventListener('pointermove', (e) => { if (drawing) { ctx.lineTo(...pos(e)); ctx.stroke(); } });
  canvas.addEventListener('pointerup', () => { drawing = false; });
  return {
    clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; },
    value() { return dirty ? canvas.toDataURL('image/png') : null; },
  };
}

// Logs in, asking for the authenticator code when the account has two-factor on.
async function logIn(body) {
  const r = await api('/nuvolve/app/api/login', { body });
  if (!r.twoFactor) return r;
  return new Promise((resolve, reject) => {
    const m = modal('Enter your code', `<p>Open your authenticator app and type the 6-digit code for Nuvolve.</p>
      <div class="field"><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="9" placeholder="123 456" style="font-size:22px;letter-spacing:4px;text-align:center"></div>
      <p class="small muted">Lost your phone? Type one of your backup codes instead, or ask your owner to reset two-factor for you.</p>`,
    [{ label: 'Cancel', onClick: () => reject(Object.assign(new Error(''), { quiet: true })) },
      { label: 'Log in', cls: 'primary', onClick: async (el) => { resolve(await api('/nuvolve/app/api/login', { body: { ...body, code: $('[name=code]', el).value } })); } }]);
    $('[name=code]', m.el).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.mf .primary', m.el).click(); });
  });
}

// Shrinks a phone photo before upload: max 1600px on the long side, JPEG. Keeps uploads small on a cell signal.
async function shrinkImage(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That file isn't a picture")); i.src = url; });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } finally { URL.revokeObjectURL(url); }
}

const PHOTO_KIND = { before: 'Before', after: 'After', issue: 'Problem found', property: 'House photo' };
// Photo strip for a stop: thumbnails, plus buttons to add Before / After / Problem photos when `canAdd`.
// `src(id)` builds the picture URL (the office and techs use their login; the pay page uses its link).
function photoStrip(root, visitId, photos, { canAdd = false, canDelete = () => false, src = (id) => `/nuvolve/app/api/photos/${id}` } = {}) {
  const draw = () => {
    root.innerHTML = `<div class="photos">${photos.map((p) => `<figure class="ph">${p.local ? `<img src="${esc(p.local)}" alt="${esc(PHOTO_KIND[p.kind] || 'Photo')}">`
      : `<a href="${src(p.id)}" target="_blank" rel="noopener"><img src="${src(p.id)}" alt="${esc(PHOTO_KIND[p.kind] || 'Photo')}" loading="lazy"></a>`}
      <figcaption><span class="pill ${p.kind === 'issue' ? 'yellow' : ''}">${esc(PHOTO_KIND[p.kind] || 'Photo')}</span> ${p.local ? '⏳ ' : ''}${esc(p.caption || '')}</figcaption>
      ${canDelete(p) ? `<button type="button" class="ph-x" data-del="${p.id}" aria-label="Remove photo">✕</button>` : ''}</figure>`).join('')}</div>
      ${canAdd ? `<div class="actions ph-add">${Object.entries(PHOTO_KIND).map(([k, l]) => `<label class="btn sm">📷 ${l}<input type="file" accept="image/*" capture="environment" data-kind="${k}" hidden multiple></label>`).join('')}</div>
      <div class="hint">Problem photos (standing water, wood rot, gaps, harborage) show up on the customer's pay page with your note.</div>` : ''}`;
    $$('input[type=file]', root).forEach((inp) => (inp.onchange = async () => {
      const kind = inp.dataset.kind;
      for (const f of [...inp.files]) {
        try {
          const caption = kind === 'issue' ? (prompt('What did you find? (the customer sees this)', '') || '') : '';
          const data = await shrinkImage(f);
          const r = await saveOrQueue(`/nuvolve/app/api/visits/${visitId}/photos`, { data, kind, caption }, { kind: 'photo', visitId: Number(visitId) });
          // No signal: show it now from the phone. It uploads with the rest of the saved work.
          photos = r.queued ? [...photos, { id: `q${r.outboxId}`, queued: r.outboxId, kind, caption, local: data, user_id: typeof ME !== 'undefined' && ME ? ME.id : null }] : r.photos;
          draw();
        } catch (e) { toast(e.message, true); }
      }
    }));
    $$('[data-del]', root).forEach((b) => (b.onclick = async () => {
      if (!confirm('Remove this photo?')) return;
      const queued = photos.find((p) => String(p.id) === b.dataset.del)?.queued;
      try {
        if (queued) { await Outbox.remove(queued); photos = photos.filter((p) => p.queued !== queued); } else photos = (await api(`/nuvolve/app/api/photos/${b.dataset.del}`, { method: 'DELETE' })).photos;
        draw();
      } catch (e) { toast(e.message, true); }
    }));
  };
  draw();
}

const COMMON_PESTS = ['Ants', 'Roaches', 'Spiders', 'Scorpions', 'Mosquitoes', 'Wasps', 'Rodents', 'Fleas', 'Silverfish', 'Termites', 'Bed bugs', 'Crickets'];

// The service ticket form used by techs (and the office) to complete a stop.
// Calls onDone(result) after the stop is saved.
const UNITS = ['oz', 'fl oz', 'lb', 'g', 'gal', 'qt', 'ml', 'L', 'tsp', 'tbsp', 'blocks', 'stations', 'packs', 'tubes', 'bait points', 'sq ft', 'linear ft'];

function ticketForm(root, visit, products, onDone) {
  const productOptions = products.map((p) => `<option value="${p.id}" data-unit="${esc(p.unit)}" data-rate="${esc(p.default_rate || '')}">${esc(p.name)}${p.epa_reg ? ` (EPA ${esc(p.epa_reg)})` : ''}</option>`).join('');
  const last = visit.last_ticket;
  root.innerHTML = `
    ${last ? `<div class="alert info last-time"><div><b>Same as last time?</b><div class="small">${fmtDate(last.date)} · ${esc(last.service_name || '')}${last.products.length ? ` · ${last.products.length} product${last.products.length > 1 ? 's' : ''}` : ''}</div></div>
      <button type="button" class="btn primary" id="use-last">Fill in from last visit</button></div>` : ''}
    <div class="field">
      <label>What pests did you treat for?</label>
      <div class="chips" id="pests">${COMMON_PESTS.map((p) => `<span class="chip" data-v="${p}">${p}</span>`).join('')}</div>
    </div>
    <div class="field">
      <label>Products used</label>
      <div id="prod-rows"></div>
      <button type="button" class="btn sm" id="add-prod">+ Add product</button>
      <div class="hint">Saved to your chemical use log for state records.</div>
    </div>
    ${visit.devices?.length || visit.customer_type === 'commercial' ? '<div class="field" id="devices"></div>' : ''}
    ${visit.customer_type === 'commercial' ? '<div class="field" id="sightings"></div>' : ''}
    <div class="field">
      <label for="areas">Areas treated</label>
      <input id="areas" placeholder="Exterior perimeter, eaves, garage..." value="${esc(visit.areas_serviced || '')}">
    </div>
    <div class="field">
      <label for="weather">Weather at the time (outdoor treatments)</label>
      <input id="weather" placeholder="e.g. 78°F, wind 4 mph NW, clear" value="${esc(visit.weather || '')}">
    </div>
    <div class="field">
      <label for="tnotes">Notes for the customer</label>
      <textarea id="tnotes" placeholder="What you did and what you saw. Goes on their service report and email.">${esc(visit.tech_notes || '')}</textarea>
    </div>
    <div class="field office-note">
      <label for="inotes">🔒 Office-only notes</label>
      <textarea id="inotes" placeholder="Only your team sees this. Upsell ideas, access problems, dog was aggressive...">${esc(visit.internal_notes || '')}</textarea>
      <div class="hint">Never shown to the customer. The next tech sees it on this address.</div>
    </div>
    <div class="field">
      <label for="price">Price for this visit</label>
      <input id="price" type="number" step="0.01" inputmode="decimal" value="${visit.price ?? ''}">
    </div>
    <div class="field">
      <label class="check"><input type="checkbox" id="present"> Customer was home</label>
    </div>
    <div class="field">
      <label>Photos</label>
      <div id="t-photos"></div>
    </div>
    <div class="field" id="sig-wrap">
      <label>Customer signature (optional)</label>
      <canvas class="sig" id="sig"></canvas>
      <button type="button" class="link-btn small" id="sig-clear">Clear signature</button>
    </div>
    <button class="btn primary big block" id="complete">Complete stop</button>
  `;
  if ($('#sightings', root)) sightingsBlock($('#sightings', root), visit);
  const chosen = new Set((visit.target_pests || '').split(',').map((s) => s.trim()).filter(Boolean));
  $$('#pests .chip', root).forEach((c) => {
    if (chosen.has(c.dataset.v)) c.classList.add('on');
    c.onclick = () => c.classList.toggle('on');
  });
  const rows = $('#prod-rows', root);
  const addRow = (pre = {}) => {
    const div = document.createElement('div');
    div.className = 'prod-row';
    div.innerHTML = `<div class="prod-top"><select class="p-id" aria-label="Product"><option value="">Pick product</option>${productOptions}</select>
      <button type="button" class="btn sm" title="Remove">✕</button></div>
      <div class="prod-bottom"><div class="amt-unit"><input class="p-amt" type="number" step="0.01" min="0" inputmode="decimal" placeholder="Amount" aria-label="Amount used">
      <select class="p-unit" aria-label="Unit">${UNITS.map((u) => `<option>${u}</option>`).join('')}</select></div>
      <input class="p-rate" placeholder="Rate / mix" aria-label="Rate or mix">
      <input class="p-area" placeholder="Where" aria-label="Where applied"></div>`;
    $('button', div).onclick = () => div.remove();
    $('.p-id', div).onchange = (e) => {
      const o = e.target.selectedOptions[0];
      $('.p-amt', div).placeholder = o?.dataset.unit ? `Amount (${o.dataset.unit})` : 'Amount';
      if (o?.dataset.rate && !$('.p-rate', div).value) $('.p-rate', div).value = o.dataset.rate;
      if (o?.dataset.unit) setUnit($('.p-unit', div), o.dataset.unit);
    };
    if (pre.product_id) {
      $('.p-id', div).value = pre.product_id;
      $('.p-id', div).onchange({ target: $('.p-id', div) });
      if (pre.unit) setUnit($('.p-unit', div), pre.unit);
      $('.p-amt', div).value = pre.amount ?? '';
      $('.p-rate', div).value = pre.rate || $('.p-rate', div).value;
      $('.p-area', div).value = pre.area || '';
    }
    rows.appendChild(div);
  };
  // A product measured in a unit that isn't in the list still gets its own option.
  const setUnit = (sel, unit) => {
    if (![...sel.options].some((o) => o.value === unit)) sel.add(new Option(unit, unit));
    sel.value = unit;
  };
  addRow();
  $('#add-prod', root).onclick = () => addRow();
  if ($('#use-last', root)) $('#use-last', root).onclick = () => {
    const pests = new Set((last.target_pests || '').split(',').map((x) => x.trim()));
    $$('#pests .chip', root).forEach((c) => c.classList.toggle('on', pests.has(c.dataset.v)));
    rows.innerHTML = '';
    last.products.forEach((p) => addRow(p));
    if (!last.products.length) addRow();
    if (!$('#areas', root).value) $('#areas', root).value = last.areas_serviced || '';
    $('.last-time', root).innerHTML = '<div><b>Filled in from last visit.</b> <span class="small">Check the amounts match what you used today.</span></div>';
  };
  photoStrip($('#t-photos', root), visit.id, visit.photos || [], { canAdd: true, canDelete: (p) => typeof ME === 'undefined' || !ME || p.user_id === ME.id });
  const sig = signaturePad($('#sig', root));
  $('#sig-clear', root).onclick = () => sig.clear();

  // Stations, traps and monitors: everything starts as "no activity" so the tech only taps the exceptions.
  let devices = (visit.devices || []).map((d) => ({ ...d, status: d.status || 'ok', count: d.count || '' }));
  const DEV_STATUS = [['ok', 'No activity'], ['activity', 'Activity'], ['captured', 'Capture'], ['bait_replaced', 'Bait replaced'], ['damaged', 'Damaged'], ['missing', 'Missing'], ['inaccessible', "Couldn't reach"]];
  const DEV_TYPE = { bait: 'Bait station', snap: 'Snap trap', multi_catch: 'Multi-catch', glue: 'Glue board', ilt: 'Light trap', monitor: 'Monitor', termite: 'Termite station', termite_ag: 'Termite station (above ground)', other: 'Device' };
  const drawDevices = () => {
    const box = $('#devices', root);
    if (!box) return;
    const hits = devices.filter((d) => !['ok', 'bait_replaced'].includes(d.status)).length;
    box.innerHTML = `<label>Stations and traps ${devices.length ? `<span class="muted small">(${devices.length}${hits ? `, ${hits} flagged` : ''})</span>` : ''}</label>
      ${devices.length ? `<div class="dev-list">${devices.map((d, i) => `<div class="dev-row ${['ok', 'bait_replaced'].includes(d.status) ? '' : 'hit'}">
        <div class="dev-name"><b>#${esc(d.number)}</b> <span class="small muted">${esc(DEV_TYPE[d.type] || d.type)}${d.location ? ` · ${esc(d.location)}` : ''}${d.last_status && d.last_status !== 'ok' ? ` · last time: ${esc(DEV_STATUS.find((x) => x[0] === d.last_status)?.[1] || '')}` : ''}</span></div>
        <div class="dev-ctl"><select data-dev="${i}" aria-label="Station ${esc(d.number)}">${DEV_STATUS.map(([k, l]) => `<option value="${k}" ${k === d.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${['activity', 'captured'].includes(d.status) ? `<input data-devcount="${i}" type="number" min="1" inputmode="numeric" placeholder="How many" value="${esc(d.count)}">` : ''}</div></div>`).join('')}</div>` : '<p class="small muted">No stations set up at this address yet.</p>'}
      <button type="button" class="btn sm" id="add-dev">+ Add stations</button>`;
    $$('[data-dev]', box).forEach((sel) => (sel.onchange = () => { devices[Number(sel.dataset.dev)].status = sel.value; drawDevices(); saveDraft(); }));
    $$('[data-devcount]', box).forEach((inp) => (inp.oninput = () => { devices[Number(inp.dataset.devcount)].count = inp.value; }));
    $('#add-dev', box).onclick = () => modal('Add stations', `
      <div class="row"><div class="field"><label>First number</label><input name="number" inputmode="numeric" value="${devices.length ? Math.max(0, ...devices.map((d) => parseInt(d.number, 10) || 0)) + 1 : 1}"></div>
      <div class="field"><label>How many</label><input name="count" type="number" min="1" max="200" value="1"></div></div>
      <div class="field"><label>Type</label><select name="type">${Object.entries(DEV_TYPE).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <div class="field"><label>Where</label><input name="location" placeholder="East fence line, dock door 3..."></div>`,
    [{ label: 'Cancel' }, { label: 'Add', cls: 'primary', onClick: async (m) => {
      const r = await api(`/nuvolve/app/api/properties/${visit.property_id}/devices`, { body: formData(m) });
      const known = new Map(devices.map((d) => [d.id, d]));
      devices = r.devices.map((d) => known.get(d.id) || { ...d, status: 'ok', count: '' });
      drawDevices();
      toast(`${r.added} added`);
    } }]);
  };
  drawDevices();

  const collect = () => ({
    device_checks: devices.map((d) => ({ device_id: d.id, status: d.status, count: d.count || null })),
    target_pests: $$('#pests .chip.on', root).map((c) => c.dataset.v).join(', '),
    products: $$('#prod-rows .prod-row', root).map((r) => {
      const sel = $('.p-id', r);
      return { product_id: Number(sel.value) || null, amount: $('.p-amt', r).value || null, unit: $('.p-unit', r).value, area: $('.p-area', r).value, rate: $('.p-rate', r).value };
    }).filter((p) => p.product_id),
    areas_serviced: $('#areas', root).value,
    weather: $('#weather', root).value,
    tech_notes: $('#tnotes', root).value,
    internal_notes: $('#inotes', root).value,
    price: $('#price', root).value,
    customer_present: $('#present', root).checked,
  });

  // What the tech types is kept on the phone until the stop is saved, so a dead zone or a closed tab loses nothing.
  const draftKey = `nv_ticket_${visit.id}`;
  const store = { get: () => { try { return JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch { return null; } },
    set: (v) => { try { localStorage.setItem(draftKey, JSON.stringify(v)); } catch { /* storage full or private mode */ } },
    clear: () => { try { localStorage.removeItem(draftKey); } catch { /* private mode */ } } };
  const draft = store.get();
  if (draft) {
    const pests = new Set((draft.target_pests || '').split(',').map((x) => x.trim()));
    $$('#pests .chip', root).forEach((c) => c.classList.toggle('on', pests.has(c.dataset.v)));
    if (draft.products.length) { rows.innerHTML = ''; draft.products.forEach((p) => addRow(p)); }
    for (const [id, k] of [['#areas', 'areas_serviced'], ['#weather', 'weather'], ['#tnotes', 'tech_notes'], ['#inotes', 'internal_notes'], ['#price', 'price']]) $(id, root).value = draft[k] ?? '';
    $('#present', root).checked = Boolean(draft.customer_present);
    for (const ck of draft.device_checks || []) { const d = devices.find((x) => x.id === ck.device_id); if (d) Object.assign(d, { status: ck.status, count: ck.count || '' }); }
    drawDevices();
    root.insertAdjacentHTML('afterbegin', '<div class="alert ok small">Picked up where you left off. Nothing you typed was lost.</div>');
  }
  let saveTimer;
  const saveDraft = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set(collect()), 300); };
  root.addEventListener('input', saveDraft);
  root.addEventListener('change', saveDraft);
  root.addEventListener('click', saveDraft);

  $('#complete', root).onclick = async (e) => {
    const btn = e.currentTarget;
    const body = collect();
    // Pesticide records need the amount used, so a product without one can't be saved.
    const missing = body.products.find((p) => !(Number(p.amount) > 0));
    if (missing) return toast(`Enter how much ${products.find((x) => x.id === missing.product_id)?.name || 'product'} you used`, true);
    btn.disabled = true;
    btn.textContent = 'Saving...';
    store.set(body);
    try {
      const result = await saveOrQueue(`/nuvolve/app/api/visits/${visit.id}/complete`, { ...body, signature: sig.value(), completed_at: new Date().toISOString() }, { kind: 'complete', visitId: visit.id });
      clearTimeout(saveTimer);
      store.clear();
      onDone(result);
    } catch (err) {
      // fetch throws a TypeError (no status) when there's no signal.
      toast(err.status ? err.message : "No signal right now. Your ticket is saved on this phone. Tap Complete again when you're back online.", true);
      btn.disabled = false;
      btn.textContent = 'Complete stop';
    }
  };
}

function statusPill(status) {
  const map = { scheduled: ['Scheduled', 'blue'], completed: ['Done', 'green'], skipped: ['Skipped', 'yellow'], cancelled: ['Cancelled', ''],
    open: ['Open', 'yellow'], paid: ['Paid', 'green'], void: ['Void', ''], new: ['New', 'red'], closed: ['Closed', ''] };
  const [label, cls] = map[status] || [status, ''];
  return `<span class="pill ${cls}">${esc(label)}</span>`;
}

function mapsLink(s) {
  const a = [s.address, s.city, s.state, s.zip].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a)}`;
}

// Turn-by-turn in the tech's own app. They pick once and it's remembered on this phone.
const NAV_APPS = {
  google: { label: 'Google Maps', url: (s) => (s.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=driving` : mapsLink(s)) },
  apple: { label: 'Apple Maps', url: (s) => `https://maps.apple.com/?daddr=${encodeURIComponent(s.lat != null ? `${s.lat},${s.lng}` : [s.address, s.city, s.state, s.zip].filter(Boolean).join(', '))}&dirflg=d` },
  waze: { label: 'Waze', url: (s) => (s.lat != null ? `https://waze.com/ul?ll=${s.lat},${s.lng}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent([s.address, s.city, s.state, s.zip].filter(Boolean).join(', '))}&navigate=yes`) },
};
const navPref = () => { try { return localStorage.getItem('nv_nav') || ''; } catch { return ''; } };
function navigateTo(stop, { choose = false } = {}) {
  const pick = navPref();
  if (pick && NAV_APPS[pick] && !choose) return (location.href = NAV_APPS[pick].url(stop));
  const isApple = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  const order = isApple ? ['apple', 'google', 'waze'] : ['google', 'waze', 'apple'];
  const m = modal('Navigate with', `<div class="nav-pick">${order.map((k) => `<button type="button" class="btn big block" data-nav="${k}">${NAV_APPS[k].label}</button>`).join('')}</div>
    <label class="check" style="margin-top:10px"><input type="checkbox" id="nav-remember" checked> Always use this app on this phone</label>`, [{ label: 'Cancel' }]);
  $$('[data-nav]', m.el).forEach((b) => (b.onclick = () => {
    if ($('#nav-remember', m.el).checked) { try { localStorage.setItem('nv_nav', b.dataset.nav); } catch { /* private mode */ } }
    m.close();
    location.href = NAV_APPS[b.dataset.nav].url(stop);
  }));
}

// Satellite picture of the property, for addresses that are on the map.
function housePhoto(p, w = 720, h = 360) {
  const dLat = 0.00042;
  const dLng = (dLat * (w / h)) / Math.cos((p.lat * Math.PI) / 180);
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${p.lng - dLng},${p.lat - dLat},${p.lng + dLng},${p.lat + dLat}&bboxSR=4326&imageSR=3857&size=${w},${h}&format=jpg&f=image`;
}


// Print buttons (no inline handlers, so the strict content security policy can stay on).
document.addEventListener('click', (e) => { if (e.target.closest?.('[data-print]')) window.print(); });

// Pest sightings at a commercial site: what the customer's staff reported since the last service.
// The tech answers each one with what they did, which goes in the audit binder.
async function sightingsBlock(box, visit) {
  let data;
  try { data = await api(`/nuvolve/app/api/properties/${visit.property_id}/sightings`); } catch { return; }
  const draw = () => {
    box.innerHTML = `<label>Pest sightings ${data.sightings.length ? `<span class="pill red">${data.sightings.length} open</span>` : ''}</label>
      ${data.sightings.length ? data.sightings.map((x) => `<div class="sighting">
        <div><b>${esc(x.pest)}</b>${x.count ? ` (${x.count})` : ''}${x.location ? ` · ${esc(x.location)}` : ''}
          <div class="small muted">${fmtDate(x.seen_at)}${x.reported_by ? ` · ${esc(x.reported_by)}` : ''}${x.notes ? ` · ${esc(x.notes)}` : ''}</div></div>
        <button type="button" class="btn sm" data-resolve="${x.id}">Mark handled</button></div>`).join('') : '<p class="small muted">No open sightings at this site.</p>'}
      <button type="button" class="btn sm" id="log-sighting">+ Log a sighting</button>`;
    $$('[data-resolve]', box).forEach((b) => (b.onclick = () => modal('What did you do about it?', `
      <div class="field"><label>Corrective action</label><textarea name="action_taken" placeholder="e.g. Gel bait under dish machine, sealed gap at wall, told manager about food debris"></textarea></div>`,
    [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => {
      await api(`/nuvolve/app/api/sightings/${b.dataset.resolve}/resolve`, { body: { ...formData(m), visit_id: visit.id } });
      data.sightings = data.sightings.filter((x) => x.id !== Number(b.dataset.resolve));
      draw();
    } }])));
    $('#log-sighting', box).onclick = () => sightingModal(data.pests, async (body) => {
      await api(`/nuvolve/app/api/properties/${visit.property_id}/sightings`, { body });
      data = await api(`/nuvolve/app/api/properties/${visit.property_id}/sightings`);
      draw();
    });
  };
  draw();
}

function sightingModal(pests, onSave, extra = '') {
  modal('Log a pest sighting', `${extra}
    <div class="row"><div class="field"><label>Pest</label><select name="pest">${pests.map((p) => `<option>${esc(p)}</option>`).join('')}</select></div>
    <div class="field"><label>How many (optional)</label><input name="count" type="number" min="1" inputmode="numeric"></div></div>
    <div class="row"><div class="field"><label>Where</label><input name="location" placeholder="Dish station, dry storage, dock door 3"></div>
    <div class="field"><label>Date seen</label><input name="seen_at" type="date" value="${todayStr()}" max="${todayStr()}"></div></div>
    <div class="field"><label>Seen by</label><input name="reported_by"></div>
    <div class="field"><label>Notes</label><textarea name="notes"></textarea></div>`,
  [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => onSave(formData(m)) }]);
}

// Copy to the clipboard, or show the text to copy by hand where the browser blocks it.
function copyText(text, done = 'Copied') {
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(done), () => prompt('Copy this:', text));
}
