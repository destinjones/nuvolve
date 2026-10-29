// Marketing hub: referral rewards, seasonal upsell campaigns, and lead source ROI.

const MK_TABS = [['referrals', '🎁 Referrals'], ['campaigns', '📣 Campaigns'], ['sources', '📊 Lead sources']];
const REF_STATUS = { pending: ['Waiting on first service', 'yellow'], qualified: ['Ready to reward', 'blue'], rewarded: ['Rewarded', 'green'], void: ['Cancelled', ''] };
const CAMP_STATUS = { draft: ['Draft', ''], scheduled: ['Scheduled', 'blue'], sending: ['Sending', 'yellow'], sent: ['Sent', 'green'] };
const mkPill = (map, s) => { const [l, c] = map[s] || [s, '']; return `<span class="pill ${c}">${esc(l)}</span>`; };
const personName = (n, co) => esc((n || '').trim() || co || 'Customer');

async function pageMarketing(view, _id, params = {}) {
  const tab = MK_TABS.some(([k]) => k === params.tab) ? params.tab : 'referrals';
  const d = await api('/nuvolve/app/api/marketing');
  view.innerHTML = `
    <div class="page-head"><div><h1>Marketing</h1><div class="muted">Turn happy customers into new ones, sell the next service at the right time of year, and see which ads pay for themselves.</div></div></div>
    <div class="tabs">${MK_TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="mk"></div>`;
  $$('.tabs button', view).forEach((b) => (b.onclick = () => (location.hash = `#/marketing?tab=${b.dataset.tab}`)));
  const box = $('#mk', view);
  if (tab === 'referrals') return mkReferrals(box, d);
  if (tab === 'campaigns') return mkCampaigns(box, d);
  return mkSources(box, d, params);
}

// ---------- referrals ----------
function mkReferrals(box, d) {
  const s = d.referrals.summary;
  const st = d.settings;
  box.innerHTML = `
    ${!d.bookingOn ? `<div class="alert warn">Referral links send friends to your online booking page, which is off. ${BOOT.me.isAdmin ? 'Turn it on in <a href="#/settings">Settings</a>.' : 'Ask an admin to turn it on.'} Codes still work when the office enters them.</div>` : ''}
    <div class="stats">
      <div class="stat"><div class="label">Referrals</div><div class="value">${s.total}</div><div class="sub">${s.pending} waiting on a first service</div></div>
      <div class="stat"><div class="label">New customers from referrals</div><div class="value">${s.won}</div><div class="sub">${s.total ? Math.round((s.won / s.total) * 100) : 0}% became customers</div></div>
      <div class="stat"><div class="label">Rewards given</div><div class="value">${money(s.paid)}</div><div class="sub">as account credit</div></div>
      <div class="stat"><div class="label">Reward</div><div class="value" style="font-size:20px">${money(st.reward)} + ${money(st.friendReward)}</div><div class="sub">to them + to their friend${st.enabled ? '' : ' · <b>off</b>'}</div></div>
    </div>
    <div class="grid cols-2">
      <div class="card">
        <div class="card-head"><h2>How it works</h2>${BOOT.me.isAdmin ? '<button class="btn sm" id="ref-settings">Change rewards</button>' : ''}</div>
        <ol class="steps">
          <li>Every customer gets a personal code and link. It's in their portal and on their customer page.</li>
          <li>A friend books through the link (or the office types the code on the new customer). They're marked as a Referral lead.</li>
          <li>After the friend's first completed service, ${st.auto ? `both get their credit automatically and the referrer gets a thank-you` : 'the referral shows "Ready to reward" here for you to approve'}.</li>
        </ol>
      </div>
      <div class="card"><h2>Top referrers</h2>
        <table class="list"><thead><tr><th>Customer</th><th class="right">Referred</th><th class="right">Became customers</th></tr></thead><tbody>
        ${s.top.map((t) => `<tr class="click" data-cust="${t.id}"><td>${personName(t.name, t.company)}</td><td class="right">${t.referrals}</td><td class="right">${t.won}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No referrals yet.</td></tr>'}
        </tbody></table></div>
    </div>
    <div class="card"><h2>All referrals</h2>
      <div class="table-wrap"><table class="list"><thead><tr><th>Date</th><th>Referred by</th><th>New customer</th><th>Status</th><th class="right">Reward</th><th></th></tr></thead><tbody>
      ${d.referrals.list.map((r) => `<tr><td>${fmtDate(r.created_at)}</td>
        <td><a href="#/customers/${r.referrer_id}">${personName(r.referrer_name, r.referrer_company)}</a></td>
        <td><a href="#/customers/${r.referred_id}">${personName(r.referred_name, r.referred_company)}</a></td>
        <td>${mkPill(REF_STATUS, r.status)}</td>
        <td class="right">${r.status === 'rewarded' ? money((r.reward || 0) + (r.friend_reward || 0)) : '—'}</td>
        <td class="right">${['pending', 'qualified'].includes(r.status) ? `<button class="btn sm ${r.status === 'qualified' ? 'primary' : ''}" data-reward="${r.id}">Reward now</button> <button class="btn sm" data-void="${r.id}">Cancel</button>` : ''}</td></tr>`).join('')
        || '<tr><td colspan="6" class="muted">No referrals yet. Share links from a customer\'s page, or turn on online booking so customers can share their own.</td></tr>'}
      </tbody></table></div></div>`;
  $$('[data-cust]', box).forEach((tr) => (tr.onclick = () => (location.hash = `#/customers/${tr.dataset.cust}`)));
  $$('[data-reward]', box).forEach((b) => (b.onclick = () => modal('Give the referral reward?', `<p>This adds ${money(st.reward)} credit to the referrer${st.friendReward ? ` and ${money(st.friendReward)} to the new customer` : ''}, and sends a thank-you.</p>`,
    [{ label: 'Not yet' }, { label: 'Give reward', cls: 'primary', onClick: async () => { await api(`/nuvolve/app/api/referrals/${b.dataset.reward}/reward`, { method: 'POST' }); toast('Reward given'); route(); } }])));
  $$('[data-void]', box).forEach((b) => (b.onclick = async () => { await api(`/nuvolve/app/api/referrals/${b.dataset.void}/void`, { method: 'POST' }); toast('Referral cancelled'); route(); }));
  if ($('#ref-settings', box)) $('#ref-settings', box).onclick = () => modal('Referral rewards', `
    <label class="check"><input type="checkbox" name="enabled" ${st.enabled ? 'checked' : ''}> Referral program is on</label>
    <div class="row"><div class="field"><label>Credit to the customer who referred</label><input name="reward" type="number" step="1" min="0" value="${st.reward}"></div>
    <div class="field"><label>Welcome credit to their friend</label><input name="friendReward" type="number" step="1" min="0" value="${st.friendReward}"></div></div>
    <label class="check"><input type="checkbox" name="auto" ${st.auto ? 'checked' : ''}> Give rewards automatically after the friend's first service</label>
    <p class="small muted">Credits come off their next bill. Set a credit to 0 to skip it.</p>`,
  [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => { await api('/nuvolve/app/api/marketing/referral-settings', { method: 'PUT', body: formData(m) }); toast('Saved'); route(); } }]);
}

// ---------- campaigns ----------
function mkCampaigns(box, d) {
  box.innerHTML = `
    <div class="card"><div class="card-head"><h2>Start a seasonal campaign</h2><span class="small muted">Pre-written, with the right send date. Edit anything before it goes out.</span></div>
      <div class="grid cols-2" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
      ${d.templates.map((t) => `<button class="stat" style="text-align:left;cursor:pointer" data-tpl="${t.key}">
        <div class="value" style="font-size:18px">${{ mosquito: '🦟', rodent: '🐭', termite: '🪵', custom: '✏️' }[t.key] || '📣'} ${esc(t.name)}</div>
        <div class="sub">${t.send_on ? `Best sent ${fmtDate(t.send_on, { month: 'long', day: 'numeric' })}` : 'Your own message'}${t.key !== 'custom' && !t.service_type_id ? ' · add the service in Settings first' : ''}</div></button>`).join('')}
      </div></div>
    <div class="card"><h2>Campaigns</h2>
      <div class="table-wrap"><table class="list"><thead><tr><th>Campaign</th><th>Status</th><th class="right">Sent to</th><th class="right">Responded</th><th class="right">New customers / jobs</th><th class="right">First-year value</th><th class="right">Billed</th><th></th></tr></thead><tbody>
      ${d.campaigns.map((c) => `<tr><td><b>${esc(c.name)}</b><div class="small muted">${[esc(c.service_name || ''), c.status === 'scheduled' ? `sends ${fmtDate(c.send_on)}` : c.sent_at ? fmtDate(c.sent_at) : ''].filter(Boolean).join(' · ')}</div></td>
        <td>${mkPill(CAMP_STATUS, c.status)}</td>
        <td class="right">${c.results ? c.results.sent : '—'}</td><td class="right">${c.results ? c.results.responded : '—'}</td>
        <td class="right">${c.results ? `${c.results.converted} <span class="small muted">(${c.results.conversionRate}%)</span>` : '—'}</td>
        <td class="right">${c.results ? money(c.results.firstYearValue) : '—'}</td><td class="right">${c.results ? money(c.results.billed) : '—'}</td>
        <td class="right">${c.status === 'sent' ? '' : `<button class="btn sm" data-edit="${c.id}">Edit</button>`}</td></tr>`).join('')
        || '<tr><td colspan="8" class="muted">No campaigns yet. Pick a season above to start one.</td></tr>'}
      </tbody></table></div>
      <p class="small muted">Results count requests, new plans and one-time jobs in the ${d.campaigns.find((c) => c.results)?.results.windowDays || 60} days after each message. Customers who turn offers off in their portal are skipped.</p></div>`;
  $$('[data-tpl]', box).forEach((b) => (b.onclick = () => campaignModal(d, d.templates.find((t) => t.key === b.dataset.tpl))));
  $$('[data-edit]', box).forEach((b) => (b.onclick = () => campaignModal(d, null, d.campaigns.find((c) => String(c.id) === b.dataset.edit))));
}

function campaignModal(d, tpl, camp) {
  const c = camp || { kind: tpl.key, name: tpl.name, subject: tpl.subject, body: tpl.body, sms: tpl.sms, offer: tpl.offer, send_on: tpl.send_on,
    service_type_id: tpl.service_type_id, audience: tpl.service_type_id ? 'missing_service' : 'active' };
  let params = {};
  try { params = JSON.parse(c.audience_params || '{}') || {}; } catch { /* ignore */ }
  const m = modal(camp ? `Edit ${c.name}` : `New campaign: ${c.name}`, `
    <div class="row"><div class="field"><label>Name</label><input name="name" value="${esc(c.name)}"></div>
    <div class="field"><label>Service you're promoting</label><select name="service_type_id"><option value="">None</option>${serviceList().map((s) => `<option value="${s.id}" ${Number(c.service_type_id) === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div></div>
    <div class="row"><div class="field"><label>Who gets it</label><select name="audience" id="cm-aud">${d.audiences.map((a) => `<option value="${a.key}" ${a.key === c.audience ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select></div>
    <div class="field ${c.audience === 'zip' ? '' : 'hidden'}" id="cm-zips"><label>Zip codes</label><input name="zips" value="${esc(params.zips || '')}" placeholder="75201, 75205"></div></div>
    <div class="field"><label>Offer (fills in {offer})</label><input name="offer" value="${esc(c.offer || '')}"></div>
    <div class="field"><label>Email subject</label><input name="subject" value="${esc(c.subject)}"></div>
    <div class="field"><label>Email</label><textarea name="body" rows="9">${esc(c.body)}</textarea>
      <div class="hint">Fill-ins: {first_name} {service} {offer} {portal_link} {referral_link} {company_name} {company_phone}. An opt-out link is added at the bottom.</div></div>
    <div class="field"><label>Text message (sent only if texting is on)</label><textarea name="sms" rows="2">${esc(c.sms || '')}</textarea></div>
    <div class="field"><label>Send date (leave empty to send by hand)</label><input name="send_on" type="date" min="${todayStr()}" value="${esc(c.send_on || '')}"></div>
    <div id="cm-preview" class="alert" style="display:block"><span class="muted">Save to see who it goes to.</span></div>`,
  [
    ...(camp ? [{ label: 'Delete', onClick: async () => { await api(`/nuvolve/app/api/campaigns/${camp.id}`, { method: 'DELETE' }); toast('Deleted'); route(); } }] : []),
    { label: 'Save draft', onClick: async (el) => { await save(el, false); toast('Saved'); route(); } },
    { label: 'Preview', onClick: async (el) => { await save(el, null); await showPreview(); return false; } },
    { label: 'Schedule', onClick: async (el) => {
      if (!$('[name=send_on]', el).value) { toast('Pick a send date', true); return false; }
      await save(el, true); toast('Scheduled'); route();
    } },
    { label: 'Send now', cls: 'primary', onClick: async (el) => {
      await save(el, false);
      const p = await api(`/nuvolve/app/api/campaigns/${id}/preview`);
      if (!p.count) { toast('Nobody matches this list', true); return false; }
      if (!confirm(`Send to ${p.count} customer${p.count === 1 ? '' : 's'} now?`)) return false;
      const r = await api(`/nuvolve/app/api/campaigns/${id}/send`, { method: 'POST' });
      toast(`Sent to ${r.sent} customer${r.sent === 1 ? '' : 's'}. Copies are in Messages.`); route();
    } },
  ]);
  let id = camp?.id || null;
  $('#cm-aud', m.el).onchange = (e) => $('#cm-zips', m.el).classList.toggle('hidden', e.target.value !== 'zip');
  async function save(el, schedule) {
    const f = formData(el);
    const body = { name: f.name, service_type_id: f.service_type_id || null, audience: f.audience, audience_params: f.audience === 'zip' ? { zips: f.zips } : {},
      offer: f.offer, subject: f.subject, body: f.body, sms: f.sms, send_on: f.send_on || null, kind: c.kind };
    if (schedule !== null) body.schedule = schedule;
    const r = id ? await api(`/nuvolve/app/api/campaigns/${id}`, { method: 'PUT', body }) : await api('/nuvolve/app/api/campaigns', { body });
    id = r.id;
  }
  async function showPreview() {
    const p = await api(`/nuvolve/app/api/campaigns/${id}/preview`);
    $('#cm-preview', m.el).innerHTML = `<div><b>${p.count} customer${p.count === 1 ? '' : 's'}</b> <span class="small muted">(${p.withEmail} by email, ${p.withPhone} have a phone)</span>
      ${p.names.length ? `<div class="small muted">${p.names.map(esc).join(', ')}${p.count > p.names.length ? '...' : ''}</div>` : ''}
      <pre class="small" style="white-space:pre-wrap;margin:8px 0 0;max-height:220px;overflow:auto"><b>${esc(p.sample.subject)}</b>\n\n${esc(p.sample.body)}</pre></div>`;
  }
  if (id) showPreview().catch(() => {});
}

// ---------- lead sources ----------
async function mkSources(box, d, params) {
  const to = params.to || todayStr();
  const from = params.from || `${to.slice(0, 4)}-01-01`;
  const roi = await api(`/nuvolve/app/api/marketing/roi?from=${from}&to=${to}`);
  const t = roi.totals;
  const roiCell = (v) => (v == null ? '<span class="muted">—</span>' : `<b style="color:${v >= 0 ? 'var(--brand-dark)' : 'var(--danger)'}">${v > 0 ? '+' : ''}${Math.round(v)}%</b>`);
  box.innerHTML = `
    <div class="card"><div class="actions" style="flex-wrap:wrap;gap:8px;align-items:end">
      <div class="field" style="margin:0"><label>From</label><input type="date" id="rf" value="${from}"></div>
      <div class="field" style="margin:0"><label>To</label><input type="date" id="rt" value="${to}"></div>
      <button class="btn" id="rgo">Update</button></div>
      <p class="small muted" style="margin-bottom:0">Leads are customers added in these dates, by "How did they find you?". Revenue is what they've paid since. Spend is what you entered below for those months, plus referral credits.</p></div>
    <div class="stats">
      <div class="stat"><div class="label">Leads</div><div class="value">${t.leads}</div><div class="sub">${t.won} became customers</div></div>
      <div class="stat"><div class="label">Revenue from them</div><div class="value">${money(t.revenue)}</div><div class="sub">+ ${money(t.recurring)}/yr on plans</div></div>
      <div class="stat"><div class="label">Marketing spend</div><div class="value">${money(t.spend)}</div><div class="sub">${t.costPerCustomer != null ? `${money(t.costPerCustomer)} per new customer` : 'Add your spend below'}</div></div>
      <div class="stat"><div class="label">Return</div><div class="value">${t.roi == null ? '—' : `${t.roi > 0 ? '+' : ''}${Math.round(t.roi)}%`}</div><div class="sub">revenue vs. spend</div></div>
    </div>
    <div class="card"><h2>By lead source</h2>
      <div class="table-wrap"><table class="list"><thead><tr><th>Source</th><th class="right">Leads</th><th class="right">Customers</th><th class="right">Close rate</th><th class="right">Spend</th><th class="right">Cost / lead</th><th class="right">Cost / customer</th><th class="right">Revenue</th><th class="right">Plans / yr</th><th class="right">Return</th></tr></thead><tbody>
      ${roi.sources.map((s) => `<tr><td><b>${esc(s.source)}</b></td><td class="right">${s.leads}</td><td class="right">${s.won}</td><td class="right">${s.closeRate}%</td>
        <td class="right">${s.spend ? money(s.spend) : '—'}</td><td class="right">${s.costPerLead != null ? money(s.costPerLead) : '—'}</td><td class="right">${s.costPerCustomer != null ? money(s.costPerCustomer) : '—'}</td>
        <td class="right">${money(s.revenue)}</td><td class="right">${money(s.recurring)}</td><td class="right">${roiCell(s.roi)}</td></tr>`).join('')
        || '<tr><td colspan="10" class="muted">No new customers in these dates.</td></tr>'}
      </tbody></table></div></div>
    <div class="card"><div class="card-head"><h2>Marketing spend</h2><button class="btn sm primary" id="add-spend">+ Add spend</button></div>
      <table class="list"><thead><tr><th>Month</th><th>Source</th><th>Note</th><th class="right">Amount</th><th></th></tr></thead><tbody>
      ${d.spend.map((s) => `<tr><td>${esc(s.month)}</td><td>${esc(s.source)}</td><td class="small muted">${esc(s.note || '')}</td><td class="right">${money(s.amount)}</td><td class="right"><button class="btn sm" data-del="${s.id}" title="Remove">✕</button></td></tr>`).join('')
        || '<tr><td colspan="5" class="muted">Add what you spend on Google Ads, door hangers, yard signs and so on to see your cost per customer.</td></tr>'}
      </tbody></table></div>`;
  $('#rgo', box).onclick = () => (location.hash = `#/marketing?tab=sources&from=${$('#rf', box).value}&to=${$('#rt', box).value}`);
  $$('[data-del]', box).forEach((b) => (b.onclick = async () => { await api(`/nuvolve/app/api/marketing/spend/${b.dataset.del}`, { method: 'DELETE' }); route(); }));
  $('#add-spend', box).onclick = () => modal('Add marketing spend', `
    <div class="row"><div class="field"><label>Source</label><input name="source" list="mk-src" placeholder="Google"><datalist id="mk-src">${d.sources.map((s) => `<option value="${esc(s)}">`).join('')}</datalist></div>
    <div class="field"><label>Month</label><input name="month" type="month" value="${todayStr().slice(0, 7)}"></div></div>
    <div class="row"><div class="field"><label>Amount</label><input name="amount" type="number" step="0.01" min="0" inputmode="decimal"></div>
    <div class="field"><label>Note (optional)</label><input name="note" placeholder="Spring door hangers"></div></div>
    <p class="small muted">Use the same name as "How did they find you?" on the customer so they line up.</p>`,
  [{ label: 'Cancel' }, { label: 'Add', cls: 'primary', onClick: async (m) => { await api('/nuvolve/app/api/marketing/spend', { body: formData(m) }); toast('Added'); route(); } }]);
}

// Card on a customer's page: their code and link, who referred them, and who they've referred.
async function referralCard(el, c) {
  let r;
  try { r = await api(`/nuvolve/app/api/customers/${c.id}/referrals`); } catch { return; }
  el.innerHTML = `<div class="card"><div class="card-head"><h2>🎁 Referrals</h2>${!r.referredBy ? '<button class="btn sm" id="ref-add">Referred by...</button>' : ''}</div>
    <p>Code <b>${esc(r.code)}</b>${r.link ? ` · <button class="btn sm" id="ref-copy">Copy their referral link</button>` : ' <span class="small muted">(turn on online booking to get a shareable link)</span>'}</p>
    ${r.referredBy ? `<p class="small">Referred by <a href="#/customers/${r.referredBy.referrer_id}">${personName(r.referredBy.name, r.referredBy.company)}</a> ${mkPill(REF_STATUS, r.referredBy.status)}</p>` : ''}
    ${r.sent.length ? `<table class="list small"><tbody>${r.sent.map((x) => `<tr><td><a href="#/customers/${x.referred_id}">${personName(x.name, x.company)}</a></td><td>${mkPill(REF_STATUS, x.status)}</td><td class="right">${x.status === 'rewarded' ? money(x.reward) : ''}</td></tr>`).join('')}</tbody></table>`
      : '<p class="small muted">Hasn\'t referred anyone yet.</p>'}</div>`;
  if ($('#ref-copy', el)) $('#ref-copy', el).onclick = () => (navigator.clipboard ? navigator.clipboard.writeText(r.link) : Promise.reject()).then(() => toast('Link copied'), () => prompt('Copy this:', r.link));
  if ($('#ref-add', el)) $('#ref-add', el).onclick = () => modal('Who referred them?', `<div class="field"><label>Their referral code</label><input name="code" placeholder="RITA-7K2F" style="text-transform:uppercase"></div>
    <p class="small muted">The code is on the referring customer's page and in their portal.</p>`,
  [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => { await api('/nuvolve/app/api/referrals', { body: { referred_id: c.id, code: formData(m).code } }); toast('Referral saved'); route(); } }]);
}
