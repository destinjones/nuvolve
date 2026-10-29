// Termite work in the office app: renewals that pay every year, bait station monitoring,
// WDI inspection reports for real estate, and the termite card on each customer.

const T_KIND = { bait: 'Baiting system', liquid: 'Liquid barrier', pretreat: 'Pre-construction', other: 'Other treatment' };
const T_COVER = { retreat: 'Retreatment', repair: 'Retreat and repair', monitor: 'Monitoring only' };
const T_STATUS = { ok: 'No activity', bait_replaced: 'Bait replaced', activity: 'Termites', captured: 'Termites', damaged: 'Damaged', missing: 'Missing', inaccessible: "Couldn't reach" };
const wdiPill = (s) => ({ draft: '<span class="pill yellow">Draft</span>', final: '<span class="pill green">Signed</span>', void: '<span class="pill red">Void</span>' }[s] || '');
const daysUntil = (d) => Math.round((parseYmd(d) - parseYmd(todayStr())) / 864e5);
const renewPill = (k) => {
  if (k.status === 'lapsed') return '<span class="pill red">Lapsed</span>';
  if (k.status === 'cancelled') return '<span class="pill">Cancelled</span>';
  const n = daysUntil(k.renewal_date);
  return n < 0 ? `<span class="pill red">${-n} days late</span>` : n <= 30 ? `<span class="pill yellow">Due in ${n} days</span>` : '<span class="pill green">Active</span>';
};

// ---------- Termite page ----------
async function pageTermite(view, _id, params) {
  const tab = ['renewals', 'stations', 'wdi'].includes(params.tab) ? params.tab : 'renewals';
  const sum = await api('/nuvolve/app/api/termite/summary');
  view.innerHTML = `
    <div class="page-head"><div><h1>Termite</h1><div class="muted">Renewals, bait stations and WDI reports in one place. Renewal notices go out ${esc(BOOT.settings.termite_notice_days || 30)} days ahead on their own.</div></div>
      <div class="actions">${BOOT.me.isAdmin ? '<button class="btn" id="t-set">⚙️ Settings</button>' : ''}<button class="btn primary" id="t-wdi">+ WDI inspection</button></div></div>
    <div class="stats">
      <a class="stat" href="#/termite?tab=renewals&view=active"><div class="label">Active termite contracts</div><div class="value">${sum.active.n}</div><div class="sub">${money(sum.active.amount)} a year in renewals</div></a>
      <a class="stat ${sum.due30.n ? 'warn' : ''}" href="#/termite?tab=renewals&view=due"><div class="label">Renewing in 30 days</div><div class="value">${sum.due30.n}</div><div class="sub">${money(sum.due30.amount)} to collect</div></a>
      <a class="stat ${sum.overdue.n + sum.lapsed.n ? 'danger' : ''}" href="#/termite?tab=renewals&view=overdue"><div class="label">Past due or lapsed</div><div class="value">${sum.overdue.n + sum.lapsed.n}</div><div class="sub">${money(sum.overdue.amount + sum.lapsed.amount)} at risk</div></a>
      <a class="stat ${sum.stationActivity ? 'danger' : ''}" href="#/termite?tab=stations"><div class="label">Homes with termite hits</div><div class="value">${sum.stationActivity}</div><div class="sub">${sum.stations.stations} stations at ${sum.stations.properties} homes${sum.stationOverdue ? ` · ${sum.stationOverdue} overdue for a check` : ''}</div></a>
      <a class="stat" href="#/termite?tab=wdi"><div class="label">WDI reports this month</div><div class="value">${sum.wdiMonth}</div><div class="sub">${sum.wdiDrafts} draft${sum.wdiDrafts === 1 ? '' : 's'} not signed yet</div></a>
    </div>
    <div class="card">
      <div class="tabs">${[['renewals', 'Renewals'], ['stations', 'Bait stations'], ['wdi', 'WDI reports']].map(([k, l]) => `<a href="#/termite?tab=${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>
      <div id="t-body"><p class="muted">Loading...</p></div>
    </div>`;
  $('#t-wdi').onclick = () => newWdiModal();
  if ($('#t-set')) $('#t-set').onclick = termiteSettingsModal;
  const body = $('#t-body');
  if (tab === 'renewals') return renewalsTab(body, params.view || 'due');
  if (tab === 'stations') return stationsTab(body);
  return wdiTab(body, params.status || '');
}

async function renewalsTab(box, view) {
  const rows = await api(`/nuvolve/app/api/termite/contracts?view=${encodeURIComponent(view)}`);
  const views = [['due', 'Next 60 days'], ['overdue', 'Past due'], ['lapsed', 'Lapsed'], ['active', 'All active'], ['all', 'Everything']];
  box.innerHTML = `<div class="actions" style="margin-bottom:10px">${views.map(([k, l]) => `<a class="btn sm ${k === view ? 'primary' : ''}" href="#/termite?tab=renewals&view=${k}">${l}</a>`).join('')}</div>
    ${rows.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Customer</th><th>Plan</th><th>Renews</th><th class="right">Yearly</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((k) => `<tr><td><a href="#/customers/${k.customer_id}"><b>${esc(k.customer_name)}</b></a><div class="small muted">${esc(k.address)}${k.phone ? ` · ${esc(k.phone)}` : ''}</div></td>
        <td>${esc(k.kind_label)}<div class="small muted">${esc(k.coverage_label)}${k.auto_renew ? ' · autopay' : ''}</div></td>
        <td class="nowrap">${fmtDate(k.renewal_date)}${k.notice_sent_for === k.renewal_date ? '<div class="small muted">notice sent</div>' : ''}</td>
        <td class="right">${money(k.renewal_price)}</td><td>${renewPill(k)}</td>
        <td class="right nowrap">${k.status !== 'cancelled' ? `<button class="btn sm primary" data-renew="${k.id}">Renew</button> <button class="btn sm" data-notice="${k.id}" title="Email or text a renewal reminder now">🔔</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : `<p class="muted">${view === 'due' ? 'No termite renewals in the next 60 days.' : 'Nothing here.'} Add a termite contract from a customer's account.</p>`}`;
  wireRenewals(box, rows);
}

function wireRenewals(box, rows) {
  $$('[data-renew]', box).forEach((b) => (b.onclick = () => renewModal(rows.find((k) => k.id === Number(b.dataset.renew)))));
  $$('[data-notice]', box).forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { const r = await api(`/nuvolve/app/api/termite/contracts/${b.dataset.notice}/notice`, { method: 'POST' }); toast(r.status.includes('logged') ? 'Reminder written to the outbox (email not connected yet)' : 'Reminder sent'); }
    catch (e) { toast(e.message, true); } finally { b.disabled = false; }
  }));
}

function renewModal(k) {
  modal(`Renew ${k.customer_name}`, `
    <p>${esc(k.kind_label)}, ${esc(k.coverage_label.toLowerCase())} at ${esc(k.address)}. Renews ${fmtDate(k.renewal_date)}.</p>
    <div class="field"><label>Renewal price</label><input name="amount" type="number" step="0.01" value="${k.renewal_price}"></div>
    <label class="check"><input type="checkbox" name="schedule_inspection" id="r-insp" checked> Schedule the annual inspection</label>
    <div class="row" id="r-when"><div class="field"><label>Inspection date</label><input name="inspection_date" type="date" value="${addDays(todayStr(), 7)}"></div>
      <div class="field"><label>Technician</label><select name="tech_id">${techOptions('')}</select></div></div>
    ${k.card_last4 ? `<label class="check"><input type="checkbox" name="charge" checked> Charge the card on file (••${esc(k.card_last4)})</label>` : '<p class="small muted">No card on file. The invoice goes on their account to pay.</p>'}
    <p class="small muted">An invoice is created and the next renewal moves out a year.</p>`,
  [{ label: 'Cancel' }, { label: 'Renew', cls: 'primary', onClick: async (m) => {
    const r = await api(`/nuvolve/app/api/termite/contracts/${k.id}/renew`, { body: formData(m) });
    toast(`Renewed through ${fmtDate(r.renewal_date)}${r.payment?.charged ? `, charged ${money(r.payment.amount)}` : r.payment ? `. Card didn't go through: ${r.payment.reason}` : ''}`, r.payment && !r.payment.charged);
    route();
  } }]);
  const box = $('#r-insp');
  box.onchange = () => $('#r-when').classList.toggle('hidden', !box.checked);
}

async function stationsTab(box) {
  const b = await api('/nuvolve/app/api/termite/stations');
  const row = (p, what) => `<tr><td><a href="#/customers/${p.customer_id}"><b>${esc(p.customer_name)}</b></a><div class="small muted">${esc(p.address)}${p.city ? `, ${esc(p.city)}` : ''}</div></td>
    <td>${what}</td><td class="nowrap">${p.last_date ? fmtDate(p.last_date) : '<span class="muted">Never</span>'}</td>
    <td class="right nowrap"><a class="btn sm" href="/nuvolve/app/graph.html?property=${p.property_id}&new=0" target="_blank" rel="noopener">📐 Graph</a> <a class="btn sm" href="/nuvolve/app/api/customers/${p.customer_id}/device-report" target="_blank" rel="noopener">📋 History</a></td></tr>`;
  const table = (title, list, what, empty) => `<h3 style="margin-top:14px">${title}</h3>${list.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Customer</th><th>Stations</th><th>Last checked</th><th></th></tr></thead><tbody>
    ${list.map((p) => row(p, what(p))).join('')}</tbody></table></div>` : `<p class="muted small">${empty}</p>`}`;
  box.innerHTML = b.totals.stations ? `
    ${table('🐜 Termites found at the last check', b.activity, (p) => `<b style="color:var(--danger)">#${p.active.map(esc).join(', #')}</b> of ${p.stations}`, 'No termite hits right now.')}
    ${table('Stations damaged, missing or not reached', b.attention, (p) => `#${p.attention.map(esc).join(', #')} of ${p.stations}`, 'None.')}
    ${table(`Not checked in ${b.overdueDays} days`, b.overdue, (p) => `${p.overdue} of ${p.stations}`, 'Every station is up to date.')}`
    : '<p class="muted">No termite stations yet. Techs add them on the ticket (type "Termite station"), or place them on a graph.</p>';
}

async function wdiTab(box, status) {
  const rows = await api(`/nuvolve/app/api/termite/wdi${status ? `?status=${status}` : ''}`);
  box.innerHTML = `<div class="actions" style="margin-bottom:10px">${[['', 'All'], ['draft', 'Drafts'], ['final', 'Signed']].map(([k, l]) => `<a class="btn sm ${k === status ? 'primary' : ''}" href="#/termite?tab=wdi&status=${k}">${l}</a>`).join('')}</div>
    ${rows.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Date</th><th>Property</th><th>Inspector</th><th class="right">Fee</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((w) => `<tr><td class="nowrap">${fmtDate(w.date)}</td><td><b>${esc(w.address)}</b><div class="small muted"><a href="#/customers/${w.customer_id}">${esc(w.customer_name)}</a>${w.amends_id ? ` · amends #${w.amends_id}` : ''}</div></td>
        <td>${esc(w.inspector || '')}</td><td class="right">${w.fee != null ? money(w.fee) : ''}</td><td>${wdiPill(w.status)}</td>
        <td class="right nowrap"><a class="btn sm" href="/nuvolve/app/wdi.html?id=${w.id}">${w.status === 'draft' ? 'Continue' : 'Open'}</a> <a class="btn sm" href="/nuvolve/app/api/termite/wdi/${w.id}/view" target="_blank" rel="noopener">📄</a></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">No WDI reports yet. Real estate termite letters start here: + WDI inspection.</p>'}`;
}

function termiteSettingsModal() {
  const s = BOOT.settings;
  modal('Termite settings', `
    <div class="row"><div class="field"><label>Send renewal reminders (days before)</label><input name="termite_notice_days" type="number" min="0" max="120" value="${esc(s.termite_notice_days || '30')}"></div>
      <div class="field"><label>Mark lapsed after (days past due)</label><input name="termite_grace_days" type="number" min="0" max="180" value="${esc(s.termite_grace_days || '30')}"></div></div>
    <div class="row"><div class="field"><label>Stations overdue after (days)</label><input name="termite_monitor_days" type="number" min="7" max="400" value="${esc(s.termite_monitor_days || '100')}"></div>
      <div class="field"><label>Usual WDI inspection fee</label><input name="wdi_fee" type="number" step="0.01" value="${esc(s.wdi_fee || '')}" placeholder="e.g. 95"></div></div>
    <p class="small muted">Inspectors need a license number (Settings, Team) before they can sign a WDI report.</p>`,
  [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => { await api('/nuvolve/app/api/termite/settings', { method: 'PUT', body: formData(m) }); await refreshBoot(); toast('Saved'); route(); } }]);
}

function newWdiModal(c) {
  const m = modal('New WDI inspection', `<div id="w-pick"></div><div id="w-rest"></div>`, [{ label: 'Cancel' }]);
  const rest = (cust) => {
    if (!cust.properties.length) return ($('#w-rest', m.el).innerHTML = '<div class="alert warn">Add the property address to this customer first.</div>');
    $('#w-pick', m.el).innerHTML = `<p><b>${esc(custName(cust))}</b></p>`;
    $('#w-rest', m.el).innerHTML = `
      ${cust.properties.length > 1 ? `<div class="field"><label>Property</label><select name="property_id">${cust.properties.map((p) => `<option value="${p.id}">${esc(p.address)}</option>`).join('')}</select></div>` : `<input type="hidden" name="property_id" value="${cust.properties[0].id}"><p>${esc(cust.properties[0].address)}</p>`}
      <div class="row"><div class="field"><label>Inspection date</label><input name="date" type="date" value="${todayStr()}"></div>
        <div class="field"><label>Inspector</label><select name="inspector_id">${BOOT.techs.map((t) => `<option value="${t.id}">${esc(t.name)}${t.license_no ? '' : ' (no license # yet)'}</option>`).join('')}</select></div></div>
      <div class="field"><label>Fee</label><input name="fee" type="number" step="0.01" value="${esc(BOOT.settings.wdi_fee || '')}" placeholder="Billed when the report is signed"></div>
      <button class="btn primary" id="w-go">Start the report</button>
      <p class="small muted">For a home sale, the buyer or their agent is usually the customer. You can add the seller, agent and lender on the form.</p>`;
    $('#w-go', m.el).onclick = async () => {
      try {
        const r = await api('/nuvolve/app/api/termite/wdi', { body: formData($('#w-rest', m.el)) });
        location.href = `/nuvolve/app/wdi.html?id=${r.id}`;
      } catch (e) { toast(e.message, true); }
    };
  };
  if (c) rest(c);
  else customerPicker($('#w-pick', m.el), rest);
}

function contractModal(c, k = null) {
  modal(k ? 'Change termite contract' : 'New termite contract', `
    ${!k && c.properties.length > 1 ? `<div class="field"><label>Property</label><select name="property_id">${c.properties.map((p) => `<option value="${p.id}">${esc(p.address)}</option>`).join('')}</select></div>` : ''}
    <div class="row"><div class="field"><label>Treatment</label><select name="kind">${Object.entries(T_KIND).map(([v, l]) => `<option value="${v}" ${k?.kind === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Warranty</label><select name="coverage">${Object.entries(T_COVER).map(([v, l]) => `<option value="${v}" ${k?.coverage === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="row"><div class="field"><label>Start date</label><input name="start_date" type="date" value="${k?.start_date || todayStr()}"></div>
      <div class="field"><label>Next renewal</label><input name="renewal_date" type="date" value="${k?.renewal_date || ''}" placeholder="A year after start"></div></div>
    <div class="row"><div class="field"><label>Yearly renewal price</label><input name="renewal_price" type="number" step="0.01" value="${k?.renewal_price ?? ''}" placeholder="e.g. 325"></div>
      <div class="field"><label>Linear feet</label><input name="linear_feet" type="number" value="${k?.linear_feet ?? ''}"></div></div>
    <label class="check"><input type="checkbox" name="auto_renew" ${k?.auto_renew ? 'checked' : ''}> Renew automatically and charge the card on file</label>
    <div class="field"><label>Notes</label><textarea name="notes">${esc(k?.notes || '')}</textarea></div>
    <p class="small muted">The customer gets a renewal reminder ${esc(BOOT.settings.termite_notice_days || 30)} days before the renewal date.</p>`,
  [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => {
    const f = formData(m);
    if (!f.renewal_date) delete f.renewal_date;
    await api(k ? `/nuvolve/app/api/termite/contracts/${k.id}` : '/nuvolve/app/api/termite/contracts', { method: k ? 'PUT' : 'POST', body: { ...f, customer_id: c.id } });
    toast('Saved'); route();
  } }]);
}

// ---------- Termite card on the customer page ----------
async function termiteCard(box, c) {
  const t = await api(`/nuvolve/app/api/customers/${c.id}/termite`);
  const hits = t.stations.filter((s) => ['activity', 'captured'].includes(s.last_status));
  const prop = c.properties[0];
  const live = t.contracts.filter((k) => k.status !== 'cancelled');
  box.innerHTML = `<div class="card-head"><h2>🐜 Termite</h2><div class="actions"><button class="btn sm" id="tc-new">+ Contract</button><button class="btn sm" id="tc-wdi">+ WDI</button></div></div>
    ${live.map((k) => `<div class="est-row"><div><b>${esc(k.kind_label)}</b> ${renewPill(k)}
        <div class="small muted">${esc(k.coverage_label)} · ${money(k.renewal_price)}/year · ${k.status === 'lapsed' ? 'was due' : 'renews'} ${fmtDate(k.renewal_date)}${k.auto_renew ? ' · autopay' : ''}${t.contracts.length > 1 ? ` · ${esc(k.address)}` : ''}</div></div>
      <div class="actions"><button class="btn sm primary" data-renew="${k.id}">Renew</button><button class="btn sm" data-editk="${k.id}">Change</button><button class="btn sm" data-cancelk="${k.id}" title="Cancel contract">✕</button></div></div>`).join('')}
    ${!live.length ? '<p class="muted small">No termite contract. Add one to bill the yearly renewal and send reminders on their own.</p>' : ''}
    ${t.stations.length ? `<div class="est-row"><div><b>${t.stations.length} bait station${t.stations.length === 1 ? '' : 's'}</b> ${hits.length ? `<span class="pill red">Termites at #${hits.map((s) => esc(s.number)).join(', #')}</span>` : '<span class="pill green">No activity</span>'}
      <div class="small muted">Last checked ${t.stations.some((s) => s.last_date) ? fmtDate(t.stations.map((s) => s.last_date).filter(Boolean).sort().pop()) : 'never'}</div></div>
      <div class="actions"><a class="btn sm" href="/nuvolve/app/api/customers/${c.id}/device-report" target="_blank" rel="noopener">📋 History</a></div></div>` : ''}
    <div class="est-row"><div><b>Graphs</b><div class="small muted">${t.graphs.length ? t.graphs.map((g) => `<a href="/nuvolve/app/graph.html?id=${g.id}">${esc(g.name)}</a> (<a href="/nuvolve/app/api/termite-graphs/${g.id}/print" target="_blank" rel="noopener">print</a>)`).join(' · ') : 'None yet'}</div></div>
      ${prop ? `<div class="actions"><a class="btn sm" href="/nuvolve/app/graph.html?property=${prop.id}${t.graphs.length ? '&new=0' : ''}">📐 ${t.graphs.length ? 'Open' : 'Draw'}</a></div>` : ''}</div>
    ${t.inspections.length ? t.inspections.slice(0, 5).map((w) => `<div class="est-row"><div><b>WDI #${w.id}</b> ${wdiPill(w.status)}<div class="small muted">${fmtDate(w.date)} · ${esc(w.inspector || '')}${w.amends_id ? ` · amends #${w.amends_id}` : ''}</div></div>
      <div class="actions"><a class="btn sm" href="/nuvolve/app/wdi.html?id=${w.id}">${w.status === 'draft' ? 'Continue' : 'Open'}</a><a class="btn sm" href="/nuvolve/app/api/termite/wdi/${w.id}/view" target="_blank" rel="noopener">📄</a></div></div>`).join('') : ''}`;
  $('#tc-new', box).onclick = () => (c.properties.length ? contractModal(c) : toast('Add a service address first', true));
  $('#tc-wdi', box).onclick = () => newWdiModal(c);
  wireRenewals(box, t.contracts);
  $$('[data-editk]', box).forEach((b) => (b.onclick = () => contractModal(c, t.contracts.find((k) => k.id === Number(b.dataset.editk)))));
  $$('[data-cancelk]', box).forEach((b) => (b.onclick = () => modal('Cancel this termite contract?', `<p>No more renewal notices or bills. Past renewals and invoices stay.</p>
    <div class="field"><label>Why?</label><select name="reason"><option value="">Pick one</option>${['Sold the house', 'Price', 'Switched companies', 'No longer wants coverage', 'Other'].map((x) => `<option>${x}</option>`).join('')}</select></div>`,
  [{ label: 'Keep it' }, { label: 'Cancel contract', cls: 'primary', onClick: async (m) => { await api(`/nuvolve/app/api/termite/contracts/${b.dataset.cancelk}/cancel`, { body: formData(m) }); toast('Contract cancelled'); route(); } }])));
}
