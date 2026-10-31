// Sales: estimates the customer signs online, website bookings, and each person's own account security.

const EST_STATUS = { draft: ['Draft', ''], sent: ['Sent', 'blue'], viewed: ['Opened', 'blue'], accepted: ['Signed', 'green'], declined: ['Declined', 'red'], expired: ['Expired', 'yellow'] };
const estPill = (s) => { const [l, c] = EST_STATUS[s] || [s, '']; return `<span class="pill ${c}">${esc(l)}</span>`; };
const estLink = (e) => `${location.origin}/nuvolve/app/sign/${e.token}`;
const perYear = { one_time: 1, monthly: 12, bimonthly: 6, quarterly: 4, yearly: 1 };

// ---------- estimate builder ----------
function estimateModal(c, onSaved) {
  const svc = serviceList();
  const lineHtml = (l = {}) => `<div class="row est-line" style="grid-template-columns:2fr 1.2fr 1fr auto;margin-bottom:8px">
    <select class="l-svc">${svc.map((s) => `<option value="${s.id}" data-price="${s.price}" data-freq="${s.default_frequency}" ${Number(l.service_type_id) === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    <select class="l-freq">${Object.entries(FREQ).map(([k, v]) => `<option value="${k}" ${k === (l.frequency || svc[0]?.default_frequency) ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <input class="l-price" type="number" step="0.01" inputmode="decimal" value="${l.price ?? svc[0]?.price ?? ''}" placeholder="Price">
    <button type="button" class="btn sm l-x" title="Remove line">✕</button></div>`;
  const m = modal(`Estimate for ${custName(c)}`, `
    <div class="field"><label>Title (optional)</label><input name="title" placeholder="Home protection plan"></div>
    ${c.properties.length > 1 ? `<div class="field"><label>Service address</label><select name="property_id">${c.properties.map((p) => `<option value="${p.id}">${esc(p.address)}</option>`).join('')}</select></div>`
      : c.properties.length ? '' : '<div class="alert warn">Add a service address first if you want visits to start on their own when they sign.</div>'}
    <label>Services</label>
    <div id="lines">${lineHtml({ service_type_id: defaultService()?.id, frequency: defaultService()?.default_frequency, price: defaultService()?.price })}</div>
    <button type="button" class="btn sm" id="add-line">+ Add a service</button>
    <div class="est-total" id="est-total"></div>
    <div class="row"><div class="field"><label>First visit on or after</label><input name="start_date" type="date" value="${todayStr()}"></div>
    <div class="field"><label>Good until</label><input name="valid_until" type="date" value="${addDays(todayStr(), Number(BOOT.settings.estimate_valid_days || 30))}"></div></div>
    <div class="field"><label>Note to the customer (optional)</label><textarea name="notes" placeholder="Thanks for having us out today. Here's what we recommend..."></textarea></div>
    <p class="small muted">They get a link by ${c.email ? 'email' : c.phone ? 'text (if texting is on)' : 'nothing yet: add an email or phone, or copy the link'}. When they sign, their plan and visits are set up automatically.</p>`,
  [{ label: 'Cancel' },
    { label: 'Save draft', onClick: (el) => save(el, false) },
    { label: c.email || c.phone ? 'Send to customer' : 'Create link', cls: 'primary', onClick: (el) => save(el, true) }]);
  const lines = $('#lines', m.el);
  const total = () => {
    const ls = $$('.est-line', lines).map((r) => ({ price: Number($('.l-price', r).value) || 0, frequency: $('.l-freq', r).value }));
    const visit = ls.reduce((t, l) => t + l.price, 0);
    const year = ls.reduce((t, l) => t + l.price * (perYear[l.frequency] || 1), 0);
    $('#est-total', m.el).innerHTML = `<span>Per visit <b>${money(visit)}</b></span><span>First year <b>${money(year)}</b></span>`;
  };
  const wire = (row) => {
    $('.l-svc', row).onchange = (e) => { const o = e.target.selectedOptions[0]; $('.l-price', row).value = o.dataset.price; $('.l-freq', row).value = o.dataset.freq; total(); };
    $('.l-freq', row).onchange = total;
    $('.l-price', row).oninput = total;
    $('.l-x', row).onclick = () => { if ($$('.est-line', lines).length > 1) row.remove(); total(); };
  };
  $$('.est-line', lines).forEach(wire);
  $('#add-line', m.el).onclick = () => { lines.insertAdjacentHTML('beforeend', lineHtml()); wire(lines.lastElementChild); total(); };
  total();
  async function save(el, send) {
    const f = formData(el);
    const body = {
      customer_id: c.id, property_id: f.property_id || null, title: f.title, notes: f.notes, start_date: f.start_date, valid_until: f.valid_until, send,
      items: $$('.est-line', lines).map((r) => ({ service_type_id: Number($('.l-svc', r).value), frequency: $('.l-freq', r).value, price: $('.l-price', r).value })),
    };
    const r = await api('/nuvolve/app/api/estimates', { body });
    if (send) {
      const emailed = (r.sent || []).length;
      modal('Estimate ready', `<p>${emailed ? `Sent to ${esc(custName(c))}${(r.sent || []).includes('logged') ? ' (saved in the Outbox until email is connected)' : ''}.` : 'Share this link with the customer:'}</p>
        <div class="copy-row"><input readonly value="${esc(r.link)}"><button class="btn sm" data-copy>Copy</button></div>`, [{ label: 'Done', cls: 'primary' }]);
      $('[data-copy]').onclick = () => copyText(r.link, 'Link copied');
    } else toast('Draft saved');
    onSaved ? onSaved() : route();
  }
}

// The list on the customer page.
function estimatesCard(box, c) {
  const list = c.estimates || [];
  box.innerHTML = `<div class="card-head"><h2>Estimates and agreements</h2><button class="btn sm" id="a-est">+ New estimate</button></div>
    ${list.length ? list.map((e) => `<div class="est-row">
      <div><b>${esc(e.title || `Estimate #${e.id}`)}</b> ${estPill(e.status)}
        <div class="small muted">${money(e.perVisit)}/visit · ${money(e.firstYear)} first year · ${e.status === 'accepted' ? `signed by ${esc(e.signer_name)} ${fmtDate(e.accepted_at)}` : e.status === 'declined' ? `declined ${fmtDate(e.declined_at)}${e.decline_reason ? `: "${esc(e.decline_reason)}"` : ''}` : e.sent_at ? `sent ${fmtDate(e.sent_at)}` : `made ${fmtDate(e.created_at)}`}</div></div>
      <div class="actions">
        ${e.status !== 'draft' ? `<a class="btn sm" href="${estLink(e)}" target="_blank" rel="noopener">${e.status === 'accepted' ? 'Signed copy' : 'View'}</a><button class="btn sm" data-copy="${e.id}">Copy link</button>` : ''}
        ${['draft', 'sent', 'viewed'].includes(e.status) ? `<button class="btn sm" data-contract="${e.id}" title="Send your contract for this estimate. When they sign it, the estimate is accepted and the plan starts.">✍ Contract</button>` : ''}
        ${e.status !== 'accepted' ? `<button class="btn sm" data-send="${e.id}">${e.status === 'draft' ? 'Send' : 'Resend'}</button><button class="btn sm" data-delest="${e.id}" title="Delete">✕</button>` : ''}
      </div></div>`).join('')
    : `<p class="muted">${c.status === 'lead' ? 'This is a lead. Send an estimate: when they sign online, their plan starts and visits land on the schedule.' : 'Quote new work and get it signed online.'}</p>`}`;
  $('#a-est', box).onclick = () => estimateModal(c);
  $$('[data-contract]', box).forEach((b) => (b.onclick = () => {
    const e = list.find((x) => x.id === Number(b.dataset.contract));
    contractForRecord({ customerId: c.id, estimateId: e.id, title: e.title || `Estimate #${e.id}`, onSent: () => route() });
  }));
  $$('[data-copy]', box).forEach((b) => (b.onclick = () => copyText(estLink(list.find((e) => e.id === Number(b.dataset.copy))), 'Link copied')));
  $$('[data-send]', box).forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { const r = await api(`/nuvolve/app/api/estimates/${b.dataset.send}/send`, { method: 'POST' }); toast(r.sent?.length ? 'Sent' : 'Link ready. Copy it to share.'); route(); } catch (e) { toast(e.message, true); b.disabled = false; }
  }));
  $$('[data-delest]', box).forEach((b) => (b.onclick = async () => {
    if (!confirm('Delete this estimate? The link stops working.')) return;
    await api(`/nuvolve/app/api/estimates/${b.dataset.delest}`, { method: 'DELETE' }); route();
  }));
}

// ---------- Sales page: pipeline board, door map, team, estimates ----------
const DEAL_STAGES = [['new', 'New lead'], ['contacted', 'Talking'], ['quoted', 'Quoted'], ['won', 'Won'], ['lost', 'Lost']];
const DEAL_SOURCE = { door: '🚪 Door', website: '🌐 Website', call: '📞 Call', referral: '🤝 Referral', event: '🎪 Event', office: '🏢 Office', other: 'Other' };
const DOOR_COLOR = { not_home: '#a0aec0', not_interested: '#e53e3e', come_back: '#dd6b20', interested: '#3182ce', sold: '#2f855a', do_not_knock: '#1a202c' };
const DOOR_LABEL = { not_home: 'Not home', not_interested: 'Not interested', come_back: 'Come back', interested: 'Interested', sold: 'Sold', do_not_knock: 'Do not knock' };
const dueClass = (at) => (!at ? '' : at.slice(0, 10) < todayStr() ? 'red' : at.slice(0, 10) === todayStr() ? 'yellow' : '');

function salesHead(tab, actions = '') {
  return `<div class="page-head"><div><h1>Sales</h1><div class="muted">Every lead from the first knock or website booking to a signed agreement. Signed quotes start their plan on their own.</div></div>
      <div class="actions"><a class="btn" href="/nuvolve/app/sell" title="The door-to-door app for phones and tablets">🚪 Door-to-door mode</a>${actions}</div></div>
    <div class="tabs">${[['pipeline', 'Pipeline'], ['doors', 'Door map'], ['team', 'Team'], ['estimates', 'Estimates and bookings']].map(([k, l]) => `<a href="#/sales?tab=${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>`;
}

async function pageSales(view, _id, params) {
  const tab = params.tab || 'pipeline';
  if (tab === 'estimates') return salesEstimates(view, params);
  if (tab === 'doors') return salesDoors(view);
  if (tab === 'team') return salesTeam(view, params);
  return salesPipeline(view, params);
}

async function salesPipeline(view, params) {
  const q = new URLSearchParams({ days: 30, ...(params.owner ? { owner_id: params.owner } : {}), ...(params.source ? { source: params.source } : {}) });
  const d = await api(`/nuvolve/app/api/sales/pipeline?${q}`);
  const won = d.totals.won, lost = d.totals.lost;
  const rate = won.count + lost.count ? Math.round((won.count / (won.count + lost.count)) * 100) : null;
  const due = [...d.stages.new, ...d.stages.contacted, ...d.stages.quoted].filter((c) => c.next_step_at && c.next_step_at.slice(0, 10) <= todayStr()).length;
  view.innerHTML = `${salesHead('pipeline', '<button class="btn primary" id="new-deal">+ New lead</button>')}
    <div class="stats">
      <div class="stat"><div class="label">Open pipeline</div><div class="value">${money(d.openValue)}</div><div class="sub">${d.totals.new.count + d.totals.contacted.count + d.totals.quoted.count} open deals, first-year value</div></div>
      <div class="stat"><div class="label">Quoted</div><div class="value">${d.totals.quoted.count}</div><div class="sub">${money(d.totals.quoted.value)} waiting on a signature</div></div>
      <div class="stat"><div class="label">Won, last 30 days</div><div class="value">${won.count}</div><div class="sub">${money(won.value)} first-year value</div></div>
      <div class="stat ${due ? 'warn' : ''}"><div class="label">Follow-ups due</div><div class="value">${due}</div><div class="sub">Close rate ${rate == null ? '—' : rate + '%'} (30 days)</div></div>
    </div>
    <div class="search-bar" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <select id="f-owner" style="width:auto"><option value="">Everyone</option>${d.reps.map((r) => `<option value="${r.id}" ${String(r.id) === params.owner ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
      <select id="f-source" style="width:auto"><option value="">Every source</option>${Object.entries(DEAL_SOURCE).map(([k, v]) => `<option value="${k}" ${k === params.source ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <span class="small muted" style="align-self:center">Drag a card to move it. Won and lost show the last 30 days.</span>
    </div>
    <div class="pipe">${DEAL_STAGES.map(([k, label]) => `<div class="pipe-col" data-stage="${k}">
      <div class="pipe-head"><b>${label}</b> <span class="pill">${d.totals[k].count}</span><div class="small muted">${money(d.totals[k].value)}</div></div>
      <div class="pipe-cards">${d.stages[k].map(dealCardHtml).join('') || '<div class="small muted pipe-empty">Nothing here</div>'}</div></div>`).join('')}</div>`;
  const reload = () => route(true);
  const filt = () => { const p = new URLSearchParams({ tab: 'pipeline' }); if ($('#f-owner').value) p.set('owner', $('#f-owner').value); if ($('#f-source').value) p.set('source', $('#f-source').value); location.hash = `#/sales?${p}`; };
  $('#f-owner').onchange = filt;
  $('#f-source').onchange = filt;
  $('#new-deal').onclick = () => newDealModal(d.reps, reload);
  $$('.deal-card', view).forEach((el) => {
    el.onclick = () => dealModal(Number(el.dataset.id), d.reps, reload);
    el.ondragstart = (e) => { e.dataTransfer.setData('text/plain', el.dataset.id); el.classList.add('dragging'); };
    el.ondragend = () => el.classList.remove('dragging');
  });
  $$('.pipe-col', view).forEach((col) => {
    col.ondragover = (e) => { e.preventDefault(); col.classList.add('over'); };
    col.ondragleave = () => col.classList.remove('over');
    col.ondrop = async (e) => {
      e.preventDefault();
      col.classList.remove('over');
      const id = Number(e.dataTransfer.getData('text/plain'));
      const card = Object.values(d.stages).flat().find((c) => c.id === id);
      if (card && card.stage !== col.dataset.stage) moveDeal(card, col.dataset.stage, reload);
    };
  });
}

function dealCardHtml(c) {
  const e = c.estimate;
  return `<div class="deal-card" draggable="true" data-id="${c.id}">
    <div class="dc-top"><b>${esc(c.customer_name)}</b><b>${money(c.value)}</b></div>
    ${c.address ? `<div class="small muted">${esc(c.address)}</div>` : ''}
    <div class="dc-tags">${c.source ? `<span class="small">${DEAL_SOURCE[c.source] || esc(c.source)}</span>` : ''}
      ${e ? `<span class="pill ${e.status === 'viewed' ? 'blue' : e.status === 'expired' ? 'red' : ''}">${{ draft: 'Quote not sent', sent: 'Quote sent', viewed: 'Quote opened', accepted: 'Signed', declined: 'Declined', expired: 'Quote expired' }[e.status] || e.status}</span>` : ''}
      ${c.next_step_at && !['won', 'lost'].includes(c.stage) ? `<span class="pill ${dueClass(c.next_step_at)}">${esc(c.next_step || 'Follow up')} ${fmtDate(c.next_step_at, { month: 'short', day: 'numeric' })}</span>` : ''}</div>
    ${c.owner_name ? `<div class="small muted">👤 ${esc(c.owner_name)}</div>` : ''}
    ${c.stage === 'lost' && c.lost_reason ? `<div class="small muted">${esc(c.lost_reason)}</div>` : ''}
  </div>`;
}

function moveDeal(card, stage, done) {
  const put = (body) => api(`/nuvolve/app/api/sales/deals/${card.id}`, { method: 'PUT', body: { stage, ...body } }).then(done, (e) => toast(e.message, true));
  if (stage === 'lost') {
    return modal('Why was it lost?', '<div class="field"><input name="lost_reason" placeholder="Price, went with someone else, renter, no answer..."></div>',
      [{ label: 'Cancel' }, { label: 'Mark lost', cls: 'danger', onClick: (m) => put(formData(m)) }]);
  }
  if (stage === 'won' && card.estimate?.status !== 'accepted') {
    return modal('Mark won without a signature?', `<p>${card.estimate ? 'Their quote isn\'t signed yet. ' : ''}Marking it won counts the sale, but it <b>doesn't start a plan</b>. To put visits on the schedule, have them sign a quote or add the plan on the customer page.</p>`,
      [{ label: 'Cancel' }, { label: 'Mark won', cls: 'primary', onClick: () => put({}) }]);
  }
  return put({});
}

function newDealModal(reps, done) {
  const m = modal('New lead', `
    <div class="seg" style="margin-bottom:10px"><label><input type="radio" name="kind" value="new" checked> New person</label> <label><input type="radio" name="kind" value="existing"> Existing customer (add-on sale)</label></div>
    <div id="nd-new">
      <div class="row"><div class="field"><label>First name</label><input name="first_name"></div><div class="field"><label>Last name</label><input name="last_name"></div></div>
      <div class="row"><div class="field"><label>Phone</label><input name="phone" type="tel"></div><div class="field"><label>Email</label><input name="email" type="email"></div></div>
      <div class="field"><label>Address</label><input name="address" id="nd-addr" autocomplete="off"></div>
      <input type="hidden" name="city"><input type="hidden" name="state"><input type="hidden" name="zip"><input type="hidden" name="lat"><input type="hidden" name="lng">
    </div>
    <div id="nd-old" class="hidden"></div>
    <div class="row"><div class="field"><label>Source</label><select name="source">${Object.entries(DEAL_SOURCE).map(([k, v]) => `<option value="${k}" ${k === 'call' ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>Owner</label><select name="owner_id"><option value="${BOOT.me.id}">Me</option>${reps.filter((r) => r.id !== BOOT.me.id).map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Est. first-year value</label><input name="value" type="number" step="1" min="0" inputmode="decimal"></div></div>
    <div class="row"><div class="field"><label>Next step</label><input name="next_step" placeholder="Call back, send quote..."></div><div class="field"><label>When</label><input name="next_step_at" type="datetime-local"></div></div>`,
  [{ label: 'Cancel' }, { label: 'Add lead', cls: 'primary', onClick: async (el) => {
    const f = formData(el);
    const existing = $('[name=kind]:checked', el).value === 'existing';
    if (existing && !picked) throw new Error('Pick the customer');
    const body = { source: f.source, owner_id: f.owner_id, value: f.value, next_step: f.next_step, next_step_at: f.next_step_at,
      ...(existing ? { customer_id: picked.id } : { lead: { first_name: f.first_name, last_name: f.last_name, phone: f.phone, email: f.email, address: f.address, city: f.city, state: f.state, zip: f.zip, lat: f.lat, lng: f.lng } }) };
    await api('/nuvolve/app/api/sales/deals', { body });
    toast('Lead added');
    done();
  } }]);
  let picked = null;
  addressAutocomplete($('#nd-addr', m.el), (a) => { for (const k of ['city', 'state', 'zip', 'lat', 'lng']) $(`[name=${k}]`, m.el).value = a[k] ?? ''; });
  $$('[name=kind]', m.el).forEach((r) => (r.onchange = () => {
    const ex = $('[name=kind]:checked', m.el).value === 'existing';
    $('#nd-new', m.el).classList.toggle('hidden', ex);
    $('#nd-old', m.el).classList.toggle('hidden', !ex);
    if (ex && !$('#nd-old', m.el).innerHTML) customerPicker($('#nd-old', m.el), (c) => { picked = c; $('#nd-old', m.el).innerHTML = `<p>✓ <b>${esc(custName(c))}</b></p>`; });
  }));
}

async function dealModal(id, reps, done) {
  const d = await api(`/nuvolve/app/api/sales/deals/${id}`);
  const e = d.estimate;
  const open = ['new', 'contacted', 'quoted'].includes(d.stage);
  const m = modal(d.customer_name, `
    ${homePhoto(d.door || d, 640, 260)}
    <div class="small muted">${esc(d.address || '')}${d.phone ? ` · <a href="tel:${esc(d.phone)}">${esc(d.phone)}</a>` : ''}${d.email ? ` · ${esc(d.email)}` : ''} · ${DEAL_SOURCE[d.source] || ''} · added ${fmtDate(d.created_at)}</div>
    <div class="row" style="margin-top:10px">
      <div class="field"><label>Stage</label><select name="stage">${DEAL_STAGES.map(([k, l]) => `<option value="${k}" ${k === d.stage ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Owner</label><select name="owner_id"><option value="">Nobody</option>${reps.map((r) => `<option value="${r.id}" ${r.id === d.owner_id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}${d.owner_id && !reps.some((r) => r.id === d.owner_id) ? `<option value="${d.owner_id}" selected>${esc(d.owner_name || 'Current owner')}</option>` : ''}</select></div>
      <div class="field"><label>First-year value</label><input name="value" type="number" step="1" min="0" value="${d.value || ''}" ${e && e.status !== 'draft' ? 'title="Set by the quote"' : ''}></div></div>
    ${open ? `<div class="row"><div class="field"><label>Next step</label><input name="next_step" value="${esc(d.next_step || '')}"></div>
      <div class="field"><label>When</label><input name="next_step_at" type="datetime-local" value="${esc((d.next_step_at || '').replace(' ', 'T'))}"></div></div>` : ''}
    ${d.stage === 'lost' ? `<p class="small">Lost: ${esc(d.lost_reason || '')}</p>` : ''}
    <div class="card" style="margin:6px 0;padding:10px 12px">
      ${e ? `<b>Quote #${e.id}</b> · ${money(e.perVisit)}/visit · ${money(e.firstYear)} first year · ${estPill(e.status)}
        <div class="actions" style="margin-top:6px">${d.link ? `<a class="btn sm" href="${esc(d.link)}" target="_blank" rel="noopener">${e.status === 'accepted' ? 'Signed copy' : 'Open quote'}</a><button class="btn sm" id="dm-copy">Copy link</button>` : ''}
          ${e.status !== 'accepted' ? '<button class="btn sm" id="dm-quote">New quote</button>' : ''}</div>`
    : `<span class="muted">No quote yet.</span> <button class="btn sm primary" id="dm-quote">Build a quote</button>`}
    </div>
    <div class="field"><label>Add a note</label><textarea id="dm-note" rows="2"></textarea></div>
    <ul class="small muted" style="padding-left:18px;max-height:180px;overflow:auto">${d.events.map((ev) => `<li>${fmtDate(ev.created_at)} · ${esc(ev.text || ev.kind)}${ev.user_name ? ` · ${esc(ev.user_name)}` : ''}</li>`).join('')}</ul>`,
  [{ label: 'Open customer', onClick: () => { location.hash = `#/customers/${d.customer_id}`; } },
    ...(BOOT.me.isManager ? [{ label: 'Delete', cls: 'danger', onClick: async () => { if (!confirm('Remove this deal from the board? The customer and their quotes stay.')) return false; await api(`/nuvolve/app/api/sales/deals/${d.id}`, { method: 'DELETE' }); done(); } }] : []),
    { label: 'Save', cls: 'primary', onClick: async (el) => {
      const f = formData(el);
      const note = $('#dm-note', el).value.trim();
      if (note) await api(`/nuvolve/app/api/sales/deals/${d.id}/notes`, { body: { text: note } });
      const { stage, ...rest } = f;
      await api(`/nuvolve/app/api/sales/deals/${d.id}`, { method: 'PUT', body: { ...rest, owner_id: f.owner_id || null } });
      if (stage !== d.stage) { moveDeal(d, stage, done); return; }
      done();
    } }]);
  wireHomePhotos(m.el);
  if ($('#dm-copy', m.el)) $('#dm-copy', m.el).onclick = () => copyText(d.link, 'Link copied');
  if ($('#dm-quote', m.el)) $('#dm-quote', m.el).onclick = async () => { m.close(); estimateModal(await api(`/nuvolve/app/api/customers/${d.customer_id}`), done); };
}

// The office's view of the door map: every knock, and the territories reps are assigned to.
let doorMap = null;
async function salesDoors(view) {
  const [terrs, lb] = await Promise.all([api('/nuvolve/app/api/sales/territories'), api('/nuvolve/app/api/sales/pipeline?days=1')]);
  view.innerHTML = `${salesHead('doors', BOOT.me.isManager ? '<button class="btn primary" id="draw">+ Draw a territory</button>' : '')}
    <div class="grid" style="grid-template-columns:minmax(0,3fr) minmax(220px,1fr);align-items:start">
      <div class="card flush" style="position:relative"><div id="door-map" style="height:620px;border-radius:var(--radius)"></div><div id="draw-bar" class="alert info hidden" style="position:absolute;left:10px;right:10px;top:10px;z-index:500;margin:0"></div></div>
      <div><div class="card"><h2>Doors</h2>${Object.entries(DOOR_LABEL).map(([k, l]) => `<div class="small"><span class="dot" style="background:${DOOR_COLOR[k]}"></span>${l}</div>`).join('')}<div class="small">🏠 Current customer</div>
        <p class="small muted" style="margin-top:8px">Zoom in to load doors. Click a door to see who knocked and what happened.</p></div>
        <div class="card"><h2>Territories</h2>${terrs.length ? terrs.map((t) => `<div class="est-row"><div><span class="dot" style="background:${esc(t.color)}"></span><b>${esc(t.name)}</b><div class="small muted">${esc(t.rep_name || 'Unassigned')}</div></div>
          <div class="actions"><button class="btn sm" data-go="${t.id}">Show</button>${BOOT.me.isManager ? `<button class="btn sm" data-edit="${t.id}">Edit</button>` : ''}</div></div>`).join('') : '<p class="muted small">None yet. Draw one to give a rep their own turf.</p>'}</div></div>
    </div>`;
  if (doorMap) { doorMap.remove(); doorMap = null; }
  const home = BOOT.locations.find((l) => l.lat) || { lat: 39.5, lng: -98.35 };
  doorMap = L.map('door-map').setView([home.lat, home.lng], home.lat === 39.5 ? 4 : 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap' }).addTo(doorMap);
  let drawing = null;
  const tLayer = L.layerGroup().addTo(doorMap), cLayer = L.layerGroup().addTo(doorMap), dLayer = L.layerGroup().addTo(doorMap);
  for (const t of terrs) L.polygon(t.points, { color: t.color, weight: 2, fillOpacity: 0.07 }).addTo(tLayer).bindTooltip(`${t.name}${t.rep_name ? ` · ${t.rep_name}` : ''}`);
  if (terrs[0]) doorMap.fitBounds(L.polygon(terrs[0].points).getBounds());
  const load = async () => {
    if (!doorMap || drawing) return;
    const b = doorMap.getBounds();
    cLayer.clearLayers(); dLayer.clearLayers();
    if (doorMap.getZoom() < 13) return;
    const d = await api(`/nuvolve/app/api/sales/map?s=${b.getSouth()}&w=${b.getWest()}&n=${b.getNorth()}&e=${b.getEast()}`).catch(() => null);
    if (!d || !doorMap) return;
    for (const c of d.customers) L.marker([c.lat, c.lng], { icon: L.divIcon({ className: '', html: '<div style="font-size:15px">🏠</div>', iconSize: [16, 16] }) }).addTo(cLayer).bindPopup(`<a href="#/customers/${c.customer_id}">${esc(c.name || '')}</a><br>${esc(c.address || '')}`);
    for (const door of d.doors) {
      L.circleMarker([door.lat, door.lng], { radius: 7, color: '#fff', weight: 1.5, fillColor: DOOR_COLOR[door.status] || '#a0aec0', fillOpacity: 0.95 }).addTo(dLayer)
        .bindPopup(`<b>${esc(door.address || 'Door')}</b><br>${DOOR_LABEL[door.status]} · ${door.knocks} knock${door.knocks === 1 ? '' : 's'}${door.last_rep ? `<br>Last: ${esc(door.last_rep)} ${fmtDate(door.last_knock_at)}` : ''}${door.notes ? `<br>📝 ${esc(door.notes)}` : ''}
          ${door.status === 'do_not_knock' ? `<br><button class="btn sm" data-clear="${door.id}">Clear do-not-knock</button>` : ''}`);
    }
  };
  doorMap.on('moveend', load);
  doorMap.on('popupopen', (ev) => {
    const b = ev.popup.getElement().querySelector('[data-clear]');
    if (b) b.onclick = async () => { await api(`/nuvolve/app/api/sales/doors/${b.dataset.clear}`, { method: 'PUT', body: { status: 'not_home' } }); toast('Cleared'); load(); };
  });
  load();
  $$('[data-go]', view).forEach((b) => (b.onclick = () => doorMap.fitBounds(L.polygon(terrs.find((t) => t.id === Number(b.dataset.go)).points).getBounds())));
  $$('[data-edit]', view).forEach((b) => (b.onclick = () => territoryModal(terrs.find((t) => t.id === Number(b.dataset.edit)), null, lb.reps)));
  // Drawing: click the corners, then Finish.
  if ($('#draw')) $('#draw').onclick = () => {
    if (drawing) return;
    drawing = { pts: [], line: L.polyline([], { color: '#e53e3e', dashArray: '4 4' }).addTo(doorMap) };
    const bar = $('#draw-bar');
    bar.classList.remove('hidden');
    bar.innerHTML = '<span>Click each corner of the territory on the map.</span><div class="actions"><button class="btn sm" id="d-undo">Undo</button><button class="btn sm" id="d-cancel">Cancel</button><button class="btn sm primary" id="d-done">Finish</button></div>';
    const stop = () => { doorMap.off('click', add); drawing.line.remove(); drawing = null; bar.classList.add('hidden'); };
    const add = (e) => { drawing.pts.push([e.latlng.lat, e.latlng.lng]); drawing.line.setLatLngs([...drawing.pts, drawing.pts[0]]); };
    doorMap.on('click', add);
    $('#d-undo').onclick = () => { drawing.pts.pop(); drawing.line.setLatLngs(drawing.pts.length ? [...drawing.pts, drawing.pts[0]] : []); };
    $('#d-cancel').onclick = stop;
    $('#d-done').onclick = () => {
      if (drawing.pts.length < 3) return toast('Click at least 3 corners', true);
      const pts = drawing.pts;
      stop();
      territoryModal(null, pts, lb.reps);
    };
  };
}

function territoryModal(t, points, reps) {
  const colors = ['#3182ce', '#d53f8c', '#dd6b20', '#38a169', '#805ad5', '#319795', '#e53e3e', '#b7791f'];
  modal(t ? `Territory: ${t.name}` : 'New territory', `
    <div class="field"><label>Name</label><input name="name" value="${esc(t?.name || '')}" placeholder="Brookstone, north of Main..."></div>
    <div class="row"><div class="field"><label>Rep</label><select name="rep_id"><option value="">Unassigned</option>${reps.map((r) => `<option value="${r.id}" ${r.id === t?.rep_id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Color</label><select name="color">${colors.map((c) => `<option value="${c}" ${c === (t?.color || colors[0]) ? 'selected' : ''} style="color:${c}">■ ${c}</option>`).join('')}</select></div></div>`,
  [...(t ? [{ label: 'Delete', cls: 'danger', onClick: async () => { if (!confirm('Delete this territory?')) return false; await api(`/nuvolve/app/api/sales/territories/${t.id}`, { method: 'DELETE' }); route(); } }] : []),
    { label: 'Cancel' },
    { label: 'Save', cls: 'primary', onClick: async (el) => {
      const f = formData(el);
      const body = { ...f, rep_id: f.rep_id || null, ...(points ? { points } : {}) };
      await api(t ? `/nuvolve/app/api/sales/territories/${t.id}` : '/nuvolve/app/api/sales/territories', { method: t ? 'PUT' : 'POST', body });
      toast('Territory saved');
      route();
    } }]);
}

async function salesTeam(view, params) {
  const period = ['today', 'week', 'month', 'year'].includes(params.period) ? params.period : 'week';
  const lb = await api(`/nuvolve/app/api/sales/leaderboard?period=${period}`);
  const t = lb.total;
  view.innerHTML = `${salesHead('team')}
    <div class="tabs">${[['today', 'Today'], ['week', 'Last 7 days'], ['month', 'This month'], ['year', 'This year']].map(([k, l]) => `<a href="#/sales?tab=team&period=${k}" class="${k === period ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div class="stats">
      <div class="stat"><div class="label">Doors knocked</div><div class="value">${t.knocks}</div><div class="sub">${t.talks} conversations</div></div>
      <div class="stat"><div class="label">Quotes</div><div class="value">${t.quotes}</div><div class="sub">${t.leads} leads from the door</div></div>
      <div class="stat"><div class="label">Sales</div><div class="value">${t.sales}</div><div class="sub">${t.talks ? Math.round((t.sales / t.talks) * 1000) / 10 + '% of conversations' : '—'}</div></div>
      <div class="stat"><div class="label">Revenue sold</div><div class="value">${money(t.revenue)}</div><div class="sub">first-year value</div></div>
    </div>
    <div class="card"><div class="card-head"><h2>Leaderboard</h2>${BOOT.me.isAdmin ? '<a class="btn sm" href="#/settings?tab=team">+ Add a sales rep</a>' : ''}</div>
      ${lb.rows.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>#</th><th>Rep</th><th class="right">Doors</th><th class="right">Talks</th><th class="right">Leads</th><th class="right">Quotes</th><th class="right">Sales</th><th class="right">Close rate</th><th class="right">Revenue</th><th class="right">Per door</th></tr></thead><tbody>
        ${lb.rows.map((r) => `<tr><td>${r.rank}</td><td><span class="dot" style="background:${esc(r.color || '#2f855a')}"></span><b>${esc(r.name)}</b></td><td class="right">${r.knocks}</td><td class="right">${r.talks}</td><td class="right">${r.leads}</td><td class="right">${r.quotes}</td>
          <td class="right"><b>${r.sales}</b></td><td class="right">${r.closeRate == null ? '—' : r.closeRate + '%'}</td><td class="right">${money(r.revenue)}</td><td class="right">${r.perDoor == null ? '—' : money(r.perDoor)}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="empty"><div class="big">🚪</div><h3>No door knocking yet</h3><p>Add a team member with the <b>Sales rep</b> role. They log in at <b>${location.origin}/nuvolve/app/sell</b> on a phone or tablet.</p></div>`}
      <p class="small muted">Close rate is sales divided by conversations (any door where someone answered). Revenue is the first-year value of signed deals.</p></div>`;
}

// The estimates list: website bookings to quote, open estimates, signed and lost.
async function salesEstimates(view, params) {
  const tab = ['open', 'signed', 'lost'].includes(params.est) ? params.est : 'open';
  const [ests, reqs] = await Promise.all([api('/nuvolve/app/api/estimates'), api('/nuvolve/app/api/requests')]);
  const since = (days) => addDays(todayStr(), -days);
  const open = ests.filter((e) => ['draft', 'sent', 'viewed'].includes(e.status));
  const signed30 = ests.filter((e) => e.status === 'accepted' && (e.accepted_at || '') >= since(30));
  const decided90 = ests.filter((e) => ['accepted', 'declined', 'expired'].includes(e.status) && (e.accepted_at || e.declined_at || e.valid_until || '') >= since(90));
  const won90 = decided90.filter((e) => e.status === 'accepted').length;
  const bookings = reqs.filter((r) => r.source === 'website' || r.source === 'api'); // the booking form, or leads sent in through the API
  const newBookings = bookings.filter((r) => r.status === 'new');
  const shown = { open, signed: ests.filter((e) => e.status === 'accepted'), lost: ests.filter((e) => ['declined', 'expired'].includes(e.status)) }[tab];
  view.innerHTML = `
    ${salesHead('estimates', '<button class="btn primary" id="new-est">+ New estimate</button>')}
    <div class="stats">
      <div class="stat"><div class="label">Open estimates</div><div class="value">${open.length}</div><div class="sub">${money(open.reduce((t, e) => t + e.firstYear, 0))} first-year value</div></div>
      <div class="stat"><div class="label">Signed, last 30 days</div><div class="value">${signed30.length}</div><div class="sub">${money(signed30.reduce((t, e) => t + e.firstYear, 0))} first-year value</div></div>
      <div class="stat"><div class="label">Close rate, 90 days</div><div class="value">${decided90.length ? Math.round((won90 / decided90.length) * 100) + '%' : '—'}</div><div class="sub">${won90} of ${decided90.length} decided</div></div>
      <div class="stat ${newBookings.length ? 'warn' : ''}"><div class="label">New website bookings</div><div class="value">${newBookings.length}</div><div class="sub">${BOOT.settings.booking_enabled === '1' ? 'Booking form is on' : BOOT.me.isAdmin ? '<a href="#/settings?tab=sales">Turn on online booking</a>' : 'Online booking is off'}</div></div>
    </div>
    ${newBookings.length ? `<div class="card"><div class="card-head"><h2>🌐 New website bookings</h2></div>
      ${newBookings.map((r) => `<div class="est-row"><div><a href="#/customers/${r.customer_id}"><b>${esc(r.customer_name || r.company)}</b></a> <span class="small muted">${esc(r.phone || '')} · ${fmtDate(r.created_at)}${r.preferred_date ? ` · wants ${fmtDate(r.preferred_date)}` : ''}</span>
        <div class="small">${esc(r.message)}</div></div>
        <div class="actions"><a class="btn sm primary" href="#/customers/${r.customer_id}">Open and quote</a><button class="btn sm" data-close="${r.id}">Done</button></div></div>`).join('')}</div>` : ''}
    <div class="card">
      <div class="tabs">${[['open', `Open (${open.length})`], ['signed', 'Signed'], ['lost', 'Declined or expired']].map(([k, l]) => `<a href="#/sales?tab=estimates&est=${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>
      ${shown.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Customer</th><th>Estimate</th><th class="right">Per visit</th><th class="right">First year</th><th>Status</th><th>Date</th></tr></thead><tbody>
        ${shown.map((e) => `<tr class="click" data-cust="${e.customer_id}"><td><b>${esc(e.customer_name)}</b><div class="small muted">${esc(e.phone || '')}</div></td>
          <td>${esc(e.title || `#${e.id}`)}<div class="small muted">${esc(e.items.map((i) => i.name).join(', '))}</div></td>
          <td class="right">${money(e.perVisit)}</td><td class="right">${money(e.firstYear)}</td><td>${estPill(e.status)}</td>
          <td class="small">${fmtDate(e.accepted_at || e.declined_at || e.sent_at || e.created_at)}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="empty"><div class="big">✍️</div><h3>Nothing here yet</h3><p>Open a customer or lead and tap <b>+ New estimate</b>.</p></div>`}
    </div>`;
  $$('tr.click', view).forEach((tr) => (tr.onclick = () => (location.hash = `#/customers/${tr.dataset.cust}`)));
  $$('[data-close]', view).forEach((b) => (b.onclick = async () => { await api(`/nuvolve/app/api/requests/${b.dataset.close}`, { method: 'PUT', body: { status: 'closed' } }); route(); }));
  $('#new-est').onclick = () => {
    const m = modal('New estimate', '<p class="muted">Who is it for?</p><div id="picker"></div>');
    customerPicker($('#picker', m.el), (cust) => { m.close(); estimateModal(cust); });
  };
}

// ---------- My account: password and two-factor ----------
async function pageAccount(view) {
  const sec = await api('/nuvolve/app/api/me/security');
  const must = BOOT.me.mustSetup2fa;
  view.innerHTML = `
    <div class="page-head"><div><h1>My account</h1><div class="muted">${esc(BOOT.me.name)} · ${esc(BOOT.me.email || '')} · ${ROLE_LABEL[BOOT.me.role] || ''}</div></div></div>
    ${must ? '<div class="alert warn"><span>🔒 <b>Your company requires two-factor login</b> for owners, admins and branch managers. Set it up below to keep using Nuvolve. It takes about a minute.</span></div>' : ''}
    <div class="grid cols-2">
      <div class="card" id="tfa"></div>
      <form class="card" id="pw"><h2>Change password</h2>
        <div class="field"><label>Current password</label><input name="current" type="password" autocomplete="current-password" required></div>
        <div class="field"><label>New password</label><input name="password" type="password" minlength="8" autocomplete="new-password" required><div class="hint">At least 8 characters. Your other phones and browsers are logged out.</div></div>
        <div class="field"><label>New password again</label><input name="again" type="password" autocomplete="new-password" required></div>
        <button class="btn primary">Change password</button></form>
    </div>`;
  $('#pw').onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    if (f.password !== f.again) return toast("The new passwords don't match", true);
    try { await api('/nuvolve/app/api/me/password', { body: f }); e.target.reset(); toast('Password changed'); } catch (err) { toast(err.message, true); }
  };
  const box = $('#tfa');
  const showCodes = (codes) => modal('Save your backup codes', `<p>Each code works <b>once</b> if you lose your phone. Keep them somewhere safe, like a password manager or printed in the office safe.</p>
    <div class="codes">${codes.map((c) => `<code>${esc(c)}</code>`).join('')}</div>`,
  [{ label: 'Copy', onClick: () => { copyText(codes.join('\n')); return false; } }, { label: 'Print', onClick: () => { window.print(); return false; } }, { label: "I've saved them", cls: 'primary' }]);
  if (!sec.enabled) {
    box.innerHTML = `<h2>Two-factor login <span class="pill">Off</span></h2>
      <p>Protects your account even if someone learns your password. After you type your password, you also type a 6-digit code from an app on your phone.</p>
      <p class="small muted">Works with Google Authenticator, Microsoft Authenticator, Authy, 1Password and others.</p>
      <button class="btn primary" id="tfa-on">Turn on two-factor</button>`;
    $('#tfa-on').onclick = async () => {
      const s = await api('/nuvolve/app/api/me/2fa/setup', { method: 'POST' });
      box.innerHTML = `<h2>Set up two-factor</h2>
        <p class="small">1. Open your authenticator app and tap <b>+</b> to add an account.<br>2. Scan this code with it:</p>
        <img class="qr" src="${s.qr}" alt="QR code to scan with your authenticator app">
        <details class="small"><summary>Can't scan? Type this key instead</summary><code class="key">${esc(s.secret.match(/.{1,4}/g).join(' '))}</code></details>
        <div class="field" style="margin-top:12px"><label>3. Type the 6-digit code the app shows</label><input id="tfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123456" style="font-size:20px;letter-spacing:3px;max-width:200px"></div>
        <button class="btn primary" id="tfa-confirm">Turn on</button>`;
      $('#tfa-code').focus();
      $('#tfa-confirm').onclick = async () => {
        try {
          const r = await api('/nuvolve/app/api/me/2fa/enable', { body: { code: $('#tfa-code').value } });
          await refreshBoot();
          renderShell();
          if (must) location.hash = '#/';
          route();
          showCodes(r.backupCodes);
          toast('Two-factor login is on');
        } catch (e) { toast(e.message, true); }
      };
    };
  } else {
    box.innerHTML = `<h2>Two-factor login <span class="pill green">On</span></h2>
      <p>You'll type a code from your authenticator app each time you log in on a new device.</p>
      <p class="small">${sec.backupLeft} backup code${sec.backupLeft === 1 ? '' : 's'} left.${sec.backupLeft < 4 ? ' <b>Make new ones soon.</b>' : ''}</p>
      <div class="actions"><button class="btn" id="tfa-codes">New backup codes</button>${sec.required ? '' : '<button class="btn danger" id="tfa-off">Turn off</button>'}</div>
      ${sec.required ? '<p class="small muted">Your company requires this for your role, so it stays on. If you lose your phone, use a backup code or ask your owner to reset it.</p>' : ''}`;
    $('#tfa-codes').onclick = () => modal('New backup codes', '<p>Your old backup codes stop working.</p><div class="field"><label>Your password</label><input name="password" type="password"></div>', [
      { label: 'Cancel' }, { label: 'Make new codes', cls: 'primary', onClick: async (el) => { const r = await api('/nuvolve/app/api/me/2fa/backup-codes', { body: formData(el) }); setTimeout(() => showCodes(r.backupCodes), 50); } }]);
    if ($('#tfa-off')) $('#tfa-off').onclick = () => modal('Turn off two-factor?', `<div class="field"><label>Your password</label><input name="password" type="password"></div>
      <div class="field"><label>Code from your app</label><input name="code" inputmode="numeric" autocomplete="one-time-code"></div>`, [
      { label: 'Keep it on' }, { label: 'Turn off', cls: 'danger', onClick: async (el) => { await api('/nuvolve/app/api/me/2fa/disable', { body: formData(el) }); await refreshBoot(); renderShell(); toast('Two-factor is off'); route(); } }]);
  }
}
