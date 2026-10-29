// Accounting: tech pay runs, the time clock, each person's pay plan, and the QuickBooks Online connection.

const ACCT_TABS = [['payroll', 'Payroll'], ['clock', 'Time clock'], ['plans', 'Pay plans'], ['quickbooks', 'QuickBooks']];
const PAY_TYPE = { hourly: 'Hourly', production: 'Production %', salary: 'Salary', none: 'No base pay (commission only, or paid elsewhere)' };
const PAY_PERIOD = { weekly: 'Every week', biweekly: 'Every two weeks', semimonthly: 'Twice a month (1st and 16th)', monthly: 'Once a month' };
const HOURS_FROM = { clock: ['Time clock', 'green'], edited: ['Typed in', 'blue'], on_site: ['On-site only', 'yellow'], none: ['No hours', ''] };
const hrs = (n) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const range = (a, b) => `${fmtDate(a)} – ${fmtDate(b)}`;
// <input type="datetime-local"> wants local time without a zone.
const localInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
// Server timestamps like "2026-01-05 14:00:00" are UTC.
const acctWhen = (s) => (s ? new Date(s.replace(' ', 'T') + (s.length === 19 ? 'Z' : '')).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');

async function pageAccounting(view, _id, params = {}) {
  const tab = ACCT_TABS.some((t) => t[0] === params.tab) ? params.tab : 'payroll';
  view.innerHTML = `
    <div class="page-head"><div><h1>Accounting</h1><div class="muted">Tech pay and your books. Only owners and admins see this page.</div></div></div>
    <div class="tabs">${ACCT_TABS.map(([k, label]) => `<a href="#/accounting?tab=${k}" class="${k === tab ? 'on' : ''}">${label}</a>`).join('')}</div>
    <div id="tab"><p class="muted">Loading...</p></div>`;
  const box = $('#tab');
  if (tab === 'payroll') return params.run ? acctRun(box, params.run) : acctPayroll(box);
  return ({ clock: acctClock, plans: acctPlans, quickbooks: acctQuickbooks })[tab](box, params);
}

// ---------- payroll ----------
function payLineCells(l) {
  const [src, col] = HOURS_FROM[l.hours_source] || ['', ''];
  const extra = l.min_top_up ? `<div class="small muted">+ ${money(l.min_top_up)} to reach ${money(l.min_hourly)}/hr</div>` : l.salary ? `<div class="small muted">Salary</div>` : '';
  return `<td><span class="dot" style="background:${esc(l.color || '#999')}"></span><b>${esc(l.name)}</b><div class="small muted">${PAY_TYPE[l.pay_type] || ''}${l.pay_type === 'hourly' ? ` · ${money(l.hourly_rate)}/hr` : l.pay_type === 'production' ? ` · ${l.production_pct}%` : ''}</div></td>
    <td class="right">${hrs(l.hours)}${l.ot ? `<div class="small muted">${hrs(l.ot)} OT</div>` : ''}<div style="white-space:nowrap"><span class="pill ${col}" style="font-size:11px">${src}</span>${l.open_punches ? ' <span class="pill red" style="font-size:11px">still clocked in</span>' : ''}</div></td>
    <td class="right">${money(l.production)}<div class="small muted">${l.stops} stops</div></td>
    <td class="right">${money(l.base + l.min_top_up + l.salary)}${extra}</td>
    <td class="right">${money(l.commission)}${l.sales ? `<div class="small muted">${l.sales} sold</div>` : ''}</td>
    <td class="right">${money(l.ot_premium)}</td>
    <td class="right">${money(l.tips)}</td>
    <td class="right">${l.adjustments_total ? money(l.adjustments_total) : '—'}${l.adjustments.map((a) => `<div class="small muted">${esc(a.label)} ${money(a.amount)}</div>`).join('')}</td>
    <td class="right"><b>${money(l.gross)}</b>${l.per_hour != null ? `<div class="small muted">${money(l.per_hour)}/hr</div>` : ''}</td>`;
}
const PAY_HEAD = '<th>Person</th><th class="right">Hours</th><th class="right">Produced</th><th class="right">Base pay</th><th class="right">Commission</th><th class="right">OT premium</th><th class="right">Tips</th><th class="right">Bonus / deduct</th><th class="right">Gross</th>';

async function acctPayroll(box) {
  const [cfg, runs] = await Promise.all([api('/nuvolve/app/api/payroll/settings'), api('/nuvolve/app/api/payroll/runs')]);
  const cur = cfg.current, prev = cfg.previous;
  const preview = await api(`/nuvolve/app/api/payroll/preview?from=${cur.start}&to=${todayStr() < cur.end ? todayStr() : cur.end}`);
  const hasRun = (p) => runs.some((r) => r.period_start <= p.end && r.period_end >= p.start);
  box.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>This pay period so far</h2><span class="small muted">${range(cur.start, cur.end)} · ${PAY_PERIOD[cfg.period]}</span></div>
      ${preview.lines.length ? `<div class="table-wrap"><table class="list"><thead><tr>${PAY_HEAD}</tr></thead><tbody>
        ${preview.lines.map((l) => `<tr>${payLineCells(l)}</tr>`).join('')}
        <tr><td><b>Total</b></td><td class="right">${hrs(preview.totals.hours)}</td><td class="right">${money(preview.totals.production)}</td><td></td><td class="right">${money(preview.totals.commission)}</td><td class="right">${money(preview.totals.ot_premium)}</td><td class="right">${money(preview.totals.tips)}</td><td></td><td class="right"><b>${money(preview.totals.gross)}</b></td></tr>
      </tbody></table></div>`
    : '<div class="empty"><div class="big">💸</div><h3>Nobody is set up for pay yet</h3><p>Open <a href="#/accounting?tab=plans">Pay plans</a> and pick how each person is paid: hourly, a percent of the work they finish, or salary, plus sales commission.</p></div>'}
      <div class="actions" style="margin-top:12px">
        ${!hasRun(prev) ? `<button class="btn primary" data-start="${prev.start}|${prev.end}">Run payroll for last period (${range(prev.start, prev.end)})</button>` : ''}
        ${!hasRun(cur) ? `<button class="btn ${hasRun(prev) ? 'primary' : ''}" data-start="${cur.start}|${cur.end}">Start this period's run</button>` : ''}
        <button class="btn" id="custom-run">Other dates...</button>
      </div>
    </div>
    <div class="card">
      <h2>Pay runs</h2>
      ${runs.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Period</th><th class="right">People</th><th class="right">Gross</th><th>Status</th><th>QuickBooks</th></tr></thead><tbody>
        ${runs.map((r) => `<tr class="click" data-run="${r.id}"><td><b>${range(r.period_start, r.period_end)}</b></td><td class="right">${r.people}</td><td class="right">${money(r.gross)}</td>
          <td>${r.status === 'approved' ? `<span class="pill green">Approved</span> <span class="small muted">${esc(r.approved_by_name || '')} ${fmtDate(r.approved_at)}</span>` : '<span class="pill yellow">Draft</span>'}</td>
          <td>${r.qbo ? '<span class="pill green">Posted</span>' : '<span class="small muted">—</span>'}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">No pay runs yet. Start one above when the period ends.</p>'}
    </div>`;
  const start = async (from, to) => {
    const r = await api('/nuvolve/app/api/payroll/runs', { body: { period_start: from, period_end: to } });
    location.hash = `#/accounting?tab=payroll&run=${r.id}`;
  };
  $$('[data-start]', box).forEach((b) => (b.onclick = async () => { b.disabled = true; try { const [f, t] = b.dataset.start.split('|'); await start(f, t); } catch (e) { toast(e.message, true); b.disabled = false; } }));
  $$('[data-run]', box).forEach((tr) => (tr.onclick = () => (location.hash = `#/accounting?tab=payroll&run=${tr.dataset.run}`)));
  $('#custom-run', box).onclick = () => modal('Start a pay run', `
    <div class="row"><div class="field"><label>First day</label><input name="from" type="date" value="${prev.start}"></div>
    <div class="field"><label>Last day</label><input name="to" type="date" value="${prev.end}"></div></div>`,
  [{ label: 'Cancel' }, { label: 'Start run', cls: 'primary', onClick: async (m) => { const f = formData(m); await start(f.from, f.to); } }]);
}

async function acctRun(box, id) {
  const [r, qb] = await Promise.all([api(`/nuvolve/app/api/payroll/runs/${id}`), api('/nuvolve/app/api/qbo')]);
  const draft = r.status === 'draft';
  const onSite = r.lines.filter((l) => l.hours_source === 'on_site' && l.pay_type !== 'salary');
  box.innerHTML = `
    <p><a href="#/accounting?tab=payroll">← All pay runs</a></p>
    <div class="card">
      <div class="card-head"><div><h2>Pay run ${range(r.period_start, r.period_end)}</h2>
        <div class="small muted">${draft ? 'Draft: check hours, add bonuses, then approve.' : `Approved by ${esc(r.approved_by_name || '')} ${fmtDate(r.approved_at)}. Locked.`}</div></div>
        <div class="actions">
          ${draft ? '<button class="btn" id="recalc" title="Pull in the latest stops, sales, tips and punches">↻ Refresh numbers</button><button class="btn" id="del">Delete draft</button><button class="btn primary" id="approve">Approve</button>' : ''}
          <a class="btn" href="/nuvolve/app/api/payroll/runs/${r.id}?format=csv">⬇ Spreadsheet for Gusto, ADP or QuickBooks Payroll</a>
          ${!draft && qb.connected ? `<button class="btn ${r.qbo ? '' : 'primary'}" id="to-qb">${r.qbo ? '↻ Update in QuickBooks' : 'Send to QuickBooks'}</button>` : ''}
        </div></div>
      ${onSite.length ? `<div class="alert warn">${onSite.map((l) => esc(l.name)).join(', ')} ${onSite.length === 1 ? 'has' : 'have'} no time clock punches, so hours are only time on site (no drive time). Type their real hours with Edit, or have them clock in on their phone.</div>` : ''}
      ${r.qbo ? `<div class="alert ok">Posted to QuickBooks as journal entry PAY-${r.id} ${fmtDate(r.qbo.synced_at)}.</div>` : ''}
      <div class="table-wrap"><table class="list"><thead><tr>${PAY_HEAD}${draft ? '<th></th>' : ''}</tr></thead><tbody>
        ${r.lines.map((l) => `<tr>${payLineCells(l)}${draft ? `<td><button class="btn sm" data-edit="${l.user_id}">Edit</button></td>` : ''}</tr>`).join('')}
        <tr><td><b>Total</b></td><td class="right">${hrs(r.totals.hours)}</td><td class="right">${money(r.totals.production)}</td><td></td><td class="right">${money(r.totals.commission)}</td><td class="right">${money(r.totals.ot_premium)}</td><td class="right">${money(r.totals.tips)}</td><td class="right">${money(r.totals.adjustments)}</td><td class="right"><b>${money(r.totals.gross)}</b></td>${draft ? '<td></td>' : ''}</tr>
      </tbody></table></div>
      <p class="small muted">Overtime premium is half the regular rate for each hour over the weekly limit. The regular rate includes production pay and commission, as federal rules require. Tips pass through 100% to the tech. Taxes and withholding are worked out by your payroll company.</p>
    </div>`;
  const reload = () => acctRun(box, id);
  if (draft) {
    $('#recalc').onclick = async () => { await api(`/nuvolve/app/api/payroll/runs/${id}/recalculate`, { method: 'POST' }); toast('Numbers refreshed'); reload(); };
    $('#del').onclick = () => modal('Delete this draft?', '<p>You can start it again any time.</p>', [{ label: 'Keep it' },
      { label: 'Delete', cls: 'primary', onClick: async () => { await api(`/nuvolve/app/api/payroll/runs/${id}`, { method: 'DELETE' }); location.hash = '#/accounting?tab=payroll'; } }]);
    $('#approve').onclick = () => modal('Approve pay run?', `<p>Gross pay of <b>${money(r.totals.gross)}</b> for ${r.lines.length} ${r.lines.length === 1 ? 'person' : 'people'}. Once approved it is locked.</p>`,
      [{ label: 'Not yet' }, { label: 'Approve', cls: 'primary', onClick: async () => { await api(`/nuvolve/app/api/payroll/runs/${id}/approve`, { method: 'POST' }); toast('Pay run approved'); reload(); } }]);
    $$('[data-edit]', box).forEach((b) => (b.onclick = () => editPayLine(r, r.lines.find((l) => l.user_id === Number(b.dataset.edit)), reload)));
  }
  if ($('#to-qb')) $('#to-qb').onclick = async (e) => {
    e.target.disabled = true;
    try { await api(`/nuvolve/app/api/payroll/runs/${id}/quickbooks`, { method: 'POST' }); toast('Sent to QuickBooks'); reload(); } catch (err) { toast(err.message, true); e.target.disabled = false; }
  };
}

function editPayLine(r, l, done) {
  const adjRow = (a = {}) => `<div class="row adj" style="grid-template-columns:2fr 1fr auto;margin-bottom:6px">
    <input class="a-label" placeholder="Bonus, spiff, uniform, advance..." value="${esc(a.label || '')}"><input class="a-amt" type="number" step="0.01" inputmode="decimal" placeholder="+50 or -20" value="${a.amount ?? ''}">
    <button type="button" class="btn sm a-x" title="Remove">✕</button></div>`;
  const m = modal(`${l.name}: ${range(r.period_start, r.period_end)}`, `
    ${l.pay_type !== 'salary' ? `<div class="row"><div class="field"><label>Total hours</label><input name="hours" type="number" step="0.01" inputmode="decimal" value="${l.hours_override ?? ''}" placeholder="${hrs(l.hours)} from ${(HOURS_FROM[l.hours_source] || [''])[0].toLowerCase()}"></div>
      <div class="field"><label>Of those, overtime hours</label><input name="ot_hours" type="number" step="0.01" inputmode="decimal" value="${l.ot_override ?? ''}" placeholder="${hrs(l.ot)}"></div></div>
      <p class="small muted">Leave hours blank to use the time clock.</p>` : ''}
    <label>Bonuses and deductions</label><div id="adjs">${l.adjustments.map(adjRow).join('')}</div>
    <button type="button" class="btn sm" id="add-adj">+ Add a line</button>`,
  [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (el) => {
    const f = formData(el);
    const body = { adjustments: $$('.adj', el).map((row) => ({ label: $('.a-label', row).value, amount: $('.a-amt', row).value })) };
    if ('hours' in f) { body.hours = f.hours; body.ot_hours = f.ot_hours; }
    await api(`/nuvolve/app/api/payroll/runs/${r.id}/lines/${l.user_id}`, { method: 'PUT', body });
    toast('Saved'); done();
  } }]);
  const wire = (row) => ($('.a-x', row).onclick = () => row.remove());
  $$('.adj', m.el).forEach(wire);
  $('#add-adj', m.el).onclick = () => { $('#adjs', m.el).insertAdjacentHTML('beforeend', adjRow()); wire($('#adjs', m.el).lastElementChild); };
}

// ---------- time clock ----------
async function acctClock(box, params) {
  const [cfg, plans] = await Promise.all([api('/nuvolve/app/api/payroll/settings'), api('/nuvolve/app/api/payroll/plans')]);
  const from = params.from || cfg.current.start, to = params.to || cfg.current.end;
  const d = await api(`/nuvolve/app/api/payroll/punches?from=${from}&to=${to}${params.user ? `&user_id=${params.user}` : ''}`);
  const total = {};
  for (const p of d.rows) if (p.hours) total[p.user_id] = (total[p.user_id] || 0) + p.hours;
  box.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Time clock</h2><div class="actions" style="flex-wrap:wrap;align-items:center;gap:6px">
        <input type="date" id="c-from" value="${from}" style="width:auto"> to <input type="date" id="c-to" value="${to}" style="width:auto">
        <select id="c-user" style="width:auto"><option value="">Everyone</option>${plans.map((u) => `<option value="${u.id}" ${String(u.id) === params.user ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
        <button class="btn primary" id="add-punch">+ Add hours</button></div></div>
      <p class="small muted">Techs clock in and out on their phone (My route). Fix a forgotten punch here; every change is in the activity log.</p>
      ${Object.keys(total).length ? `<div class="stats">${Object.entries(total).map(([uid, h]) => `<div class="stat"><div class="label">${esc(plans.find((u) => u.id === Number(uid))?.name || '')}</div><div class="value">${hrs(h)} h</div></div>`).join('')}</div>` : ''}
      ${d.rows.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Day</th><th>Who</th><th>In</th><th>Out</th><th class="right">Hours</th><th>Note</th><th></th></tr></thead><tbody>
        ${d.rows.map((p) => `<tr><td>${fmtDay(p.day)}</td><td><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}</td><td>${timeOf(p.clock_in)}</td>
          <td>${p.clock_out ? timeOf(p.clock_out) : '<span class="pill yellow">Still in</span>'}</td><td class="right">${p.hours != null ? hrs(p.hours) : '—'}</td><td class="small">${esc(p.note || '')}${p.edited_by ? ' <span class="muted">(edited)</span>' : ''}</td>
          <td class="right"><button class="btn sm" data-punch="${p.id}">Edit</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">No punches in these dates.</p>'}
    </div>`;
  const go = () => (location.hash = `#/accounting?tab=clock&from=${$('#c-from').value}&to=${$('#c-to').value}${$('#c-user').value ? `&user=${$('#c-user').value}` : ''}`);
  ['#c-from', '#c-to', '#c-user'].forEach((s) => ($(s, box).onchange = go));
  const form = (p = {}) => `
    ${p.id ? '' : `<div class="field"><label>Who</label><select name="user_id">${plans.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div>`}
    <div class="row"><div class="field"><label>Clocked in</label><input name="clock_in" type="datetime-local" value="${localInput(p.clock_in)}"></div>
    <div class="field"><label>Clocked out</label><input name="clock_out" type="datetime-local" value="${localInput(p.clock_out)}"></div></div>
    <div class="field"><label>Note</label><input name="note" value="${esc(p.note || '')}" placeholder="Forgot to clock out, training day..."></div>`;
  const body = (f) => ({ ...f, clock_in: f.clock_in ? new Date(f.clock_in).toISOString() : '', clock_out: f.clock_out ? new Date(f.clock_out).toISOString() : null });
  $('#add-punch', box).onclick = () => modal('Add hours', form(), [{ label: 'Cancel' },
    { label: 'Save', cls: 'primary', onClick: async (m) => { await api('/nuvolve/app/api/payroll/punches', { body: body(formData(m)) }); toast('Saved'); acctClock(box, params); } }]);
  $$('[data-punch]', box).forEach((b) => (b.onclick = () => {
    const p = d.rows.find((x) => x.id === Number(b.dataset.punch));
    modal(`${p.name}: ${fmtDay(p.day)}`, form(p), [
      { label: 'Delete', onClick: async () => { await api(`/nuvolve/app/api/payroll/punches/${p.id}`, { method: 'DELETE' }); toast('Deleted'); acctClock(box, params); } },
      { label: 'Save', cls: 'primary', onClick: async (m) => { await api(`/nuvolve/app/api/payroll/punches/${p.id}`, { method: 'PUT', body: body(formData(m)) }); toast('Saved'); acctClock(box, params); } }]);
  }));
}

// ---------- pay plans ----------
async function acctPlans(box) {
  const [cfg, people] = await Promise.all([api('/nuvolve/app/api/payroll/settings'), api('/nuvolve/app/api/payroll/plans')]);
  const desc = (p) => [
    p.pay_type === 'hourly' && `${money(p.hourly_rate)}/hr`,
    p.pay_type === 'production' && `${p.production_pct}% of work finished${p.min_hourly ? `, at least ${money(p.min_hourly)}/hr` : ''}`,
    p.pay_type === 'salary' && `${money(p.salary_yearly)}/yr`,
    p.sales_pct && `${p.sales_pct}% of first-year sales`,
    p.sales_flat && `${money(p.sales_flat)} per sale`,
  ].filter(Boolean).join(' · ');
  box.innerHTML = `
    <div class="card">
      <h2>How each person is paid</h2>
      <div class="table-wrap"><table class="list"><thead><tr><th>Person</th><th>Pay</th><th>Details</th><th></th></tr></thead><tbody>
        ${people.map((u) => `<tr><td><span class="dot" style="background:${esc(u.color || '#999')}"></span><b>${esc(u.name)}</b> <span class="small muted">${esc(ROLE_LABEL[u.role] || u.role)}</span></td>
          <td>${u.plan.pay_type !== 'none' ? `<span class="pill">${PAY_TYPE[u.plan.pay_type]}</span>` : u.plan.sales_pct > 0 || u.plan.sales_flat > 0 ? '<span class="pill">Commission only</span>' : '<span class="muted">Not set</span>'}</td><td class="small">${esc(desc(u.plan))}</td>
          <td class="right"><button class="btn sm" data-plan="${u.id}">Set pay</button></td></tr>`).join('')}
      </tbody></table></div>
    </div>
    <form class="card" id="pay-cfg" style="max-width:720px">
      <h2>Pay period and overtime</h2>
      <div class="row"><div class="field"><label>How often you pay</label><select name="pay_period">${Object.entries(PAY_PERIOD).map(([k, v]) => `<option value="${k}" ${k === cfg.period ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>First day of any pay period (weekly and every two weeks)</label><input name="pay_period_anchor" type="date" value="${cfg.anchor}"></div></div>
      <div class="row"><div class="field"><label>Overtime after this many hours a week</label><input name="overtime_after_hours" type="number" min="1" max="80" value="${cfg.otAfter}"></div>
      <div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" name="techs_see_pay" ${cfg.techsSeePay ? 'checked' : ''}> Techs see their own pay so far on their phone</label></div></div>
      <p class="small muted">Current period: ${range(cfg.current.start, cfg.current.end)}. Some states (like California) also count overtime per day; type those hours on the pay run.</p>
      <button class="btn primary">Save</button>
    </form>`;
  $('#pay-cfg').onsubmit = async (e) => { e.preventDefault(); await api('/nuvolve/app/api/payroll/settings', { method: 'PUT', body: formData(e.target) }); toast('Saved'); acctPlans(box); };
  $$('[data-plan]', box).forEach((b) => (b.onclick = () => {
    const u = people.find((x) => x.id === Number(b.dataset.plan));
    const p = u.plan;
    const m = modal(`Pay for ${u.name}`, `
      <div class="field"><label>Paid by</label><select name="pay_type">${Object.entries(PAY_TYPE).map(([k, v]) => `<option value="${k}" ${k === p.pay_type ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field" data-for="hourly"><label>Hourly rate ($)</label><input name="hourly_rate" type="number" step="0.01" inputmode="decimal" value="${p.hourly_rate || ''}"></div>
      <div class="row" data-for="production"><div class="field"><label>Percent of the price of each stop they finish</label><input name="production_pct" type="number" step="0.1" inputmode="decimal" value="${p.production_pct || ''}" placeholder="e.g. 25"></div>
        <div class="field"><label>But never less than ($/hour worked)</label><input name="min_hourly" type="number" step="0.01" inputmode="decimal" value="${p.min_hourly || ''}" placeholder="your state minimum wage"></div></div>
      <div class="field" data-for="salary"><label>Yearly salary ($)</label><input name="salary_yearly" type="number" step="1" inputmode="decimal" value="${p.salary_yearly || ''}"></div>
      <h3 style="margin-top:14px">Sales commission</h3>
      <div class="row"><div class="field"><label>Percent of first-year value they sell</label><input name="sales_pct" type="number" step="0.1" inputmode="decimal" value="${p.sales_pct || ''}" placeholder="0"></div>
        <div class="field"><label>Plus per signed estimate ($)</label><input name="sales_flat" type="number" step="0.01" inputmode="decimal" value="${p.sales_flat || ''}" placeholder="0"></div></div>
      <p class="small muted">Sales count when the customer signs an estimate this person sent. Tips always go 100% to the tech.</p>`,
    [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (el) => { await api(`/nuvolve/app/api/payroll/plans/${u.id}`, { method: 'PUT', body: formData(el) }); toast('Pay saved'); acctPlans(box); } }]);
    const sel = $('[name=pay_type]', m.el);
    const sync = () => $$('[data-for]', m.el).forEach((f) => f.classList.toggle('hidden', f.dataset.for !== sel.value));
    sel.onchange = sync; sync();
  }));
}

// ---------- QuickBooks ----------
async function acctQuickbooks(box, params) {
  if (params.qbo_error) toast(params.qbo_error, true);
  if (params.connected) toast('QuickBooks connected');
  const s = await api('/nuvolve/app/api/qbo');
  if (!s.connected) {
    box.innerHTML = `<div class="grid cols-2">
      <div class="card"><h2>Connect QuickBooks Online</h2>
        <p>Invoices, payments and customers go to QuickBooks every night (or when you press Sync), so your bookkeeper never retypes them. Approved payroll goes over as a journal entry.</p>
        ${s.oauthReady ? `<button class="btn primary" id="live">Connect to QuickBooks${s.liveEnv === 'sandbox' ? ' (sandbox)' : ''}</button>`
    : `<div class="alert info">Live QuickBooks isn't switched on for this server yet. Whoever runs your server adds an Intuit app key (INTUIT_CLIENT_ID and INTUIT_CLIENT_SECRET) with the redirect address <code>${esc(s.redirectUri)}</code>. Until then, try practice mode.</div>`}
      </div>
      <div class="card"><h2>Practice mode</h2>
        <p>Runs the real sync against a pretend QuickBooks kept inside Nuvolve. Nothing leaves the app. See exactly what would be sent, then connect for real.</p>
        <button class="btn ${s.oauthReady ? '' : 'primary'}" id="mock">Try practice mode</button></div></div>`;
    if ($('#live')) $('#live').onclick = async () => { const r = await api('/nuvolve/app/api/qbo/connect', { body: { mode: 'live' } }); location.href = r.url; };
    $('#mock').onclick = async () => { await api('/nuvolve/app/api/qbo/connect', { body: { mode: 'mock' } }); toast('Practice mode on'); acctQuickbooks(box, {}); };
    return;
  }
  const [accounts, logRows] = await Promise.all([api('/nuvolve/app/api/qbo/accounts').catch(() => []), api('/nuvolve/app/api/qbo/log')]);
  const last = s.lastSync;
  const acctSelect = (key, types, label) => `<div class="field"><label>${label}</label><select name="${key}"><option value="">Pick an account</option>
    ${accounts.filter((a) => types.includes(a.type)).map((a) => `<option value="${esc(a.id)}" ${s.accounts?.[key]?.id === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>`;
  box.innerHTML = `
    ${s.mode === 'mock' ? '<div class="alert info">Practice mode: the sync runs for real, into a pretend QuickBooks. Nothing leaves Nuvolve.</div>' : ''}
    <div class="stats">
      <div class="stat"><div class="label">Connected to</div><div class="value" style="font-size:18px">${esc(s.companyName || s.realmId)}</div><div class="sub">${s.mode === 'mock' ? 'Practice' : s.mode === 'sandbox' ? 'Intuit sandbox' : 'Live books'} · since ${fmtDate(s.connectedAt)}</div></div>
      <div class="stat"><div class="label">Last sync</div><div class="value" style="font-size:18px">${s.lastSyncAt ? acctWhen(s.lastSyncAt) : 'Never'}</div><div class="sub">${s.autoSync ? 'Runs every night' : 'Only when you press Sync'}</div></div>
      <div class="stat ${s.pendingInvoices ? 'warn' : ''}"><div class="label">Invoices waiting</div><div class="value">${s.pendingInvoices}</div><div class="sub">from ${fmtDate(s.startDate)} on</div></div>
      <div class="stat"><div class="label">In QuickBooks</div><div class="value">${s.linked.invoice || 0}</div><div class="sub">${s.linked.customer || 0} customers · ${s.linked.payment || 0} payments</div></div>
    </div>
    ${last ? `<div class="alert ${last.errors ? 'warn' : 'ok'}">Last sync: ${last.customers} customers, ${last.items} services, ${last.invoices} invoices and ${last.payments} payments sent${last.voided ? `, ${last.voided} voided` : ''}${last.unchanged ? `, ${last.unchanged} already up to date` : ''}.${last.errors ? ` ${last.errors} problem${last.errors === 1 ? '' : 's'}: ${esc(last.messages.join(' · '))}` : ''}</div>` : ''}
    <div class="actions" style="margin-bottom:14px"><button class="btn primary" id="sync">⇅ Sync now</button>${s.mode === 'mock' ? '<button class="btn" id="peek">See practice QuickBooks</button>' : ''}<button class="btn" id="disc">Disconnect</button></div>
    <div class="grid cols-2">
      <form class="card" id="qb-cfg"><h2>Where things go</h2>
        ${acctSelect('income', ['Income'], 'Service sales go to (income)')}
        ${acctSelect('deposit', ['Other Current Asset', 'Bank'], 'Payments are deposited to')}
        ${acctSelect('wages', ['Expense', 'Cost of Goods Sold'], 'Payroll: wages expense')}
        ${acctSelect('clearing', ['Other Current Liability'], 'Payroll: owed to the team (liability)')}
        <div class="row"><div class="field"><label>Send invoices and payments from</label><input name="start_date" type="date" value="${s.startDate}"></div>
        <div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" name="auto_sync" ${s.autoSync ? 'checked' : ''}> Sync every night</label></div></div>
        <p class="small muted">Older invoices stay out so your past books aren't doubled. Sales tax is sent as already worked out here. Tips are noted on the payment and paid to techs through payroll.</p>
        <button class="btn primary">Save</button></form>
      <div class="card"><h2>Sync history</h2>
        ${logRows.length ? `<div class="table-wrap" style="max-height:420px;overflow:auto"><table class="list small"><tbody>
          ${logRows.map((l) => `<tr><td>${acctWhen(l.created_at)}</td><td>${l.ok ? '' : '⚠️ '}${esc(l.action)}${l.entity ? ` ${esc(l.entity)} #${l.local_id}` : ''}</td><td>${esc(l.message || '')}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">Nothing synced yet.</p>'}</div>
    </div>`;
  $('#sync').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = 'Syncing...';
    try { const r = await api('/nuvolve/app/api/qbo/sync', { method: 'POST' }); toast(r.result.errors ? `Done with ${r.result.errors} problem(s)` : 'QuickBooks is up to date', Boolean(r.result.errors)); } catch (err) { toast(err.message, true); }
    acctQuickbooks(box, {});
  };
  $('#qb-cfg').onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    await api('/nuvolve/app/api/qbo/settings', { method: 'PUT', body: { start_date: f.start_date, auto_sync: f.auto_sync, accounts: { income: f.income, deposit: f.deposit, wages: f.wages, clearing: f.clearing } } });
    toast('Saved'); acctQuickbooks(box, {});
  };
  $('#disc').onclick = () => modal('Disconnect QuickBooks?', `<p>${s.mode === 'mock' ? 'This clears the practice data.' : 'Nothing in QuickBooks is deleted. Reconnect the same company later and the sync picks up where it left off.'}</p>`,
    [{ label: 'Stay connected' }, { label: 'Disconnect', cls: 'primary', onClick: async () => { await api('/nuvolve/app/api/qbo/disconnect', { method: 'POST' }); acctQuickbooks(box, {}); } }]);
  if ($('#peek')) $('#peek').onclick = async () => {
    const rows = await api('/nuvolve/app/api/qbo/mock');
    const label = (r) => r.DisplayName || r.Name || r.DocNumber || r.PaymentRefNum || '';
    const amount = (r) => (r.TotalAmt != null ? r.TotalAmt : r.Line ? r.Line.filter((l) => l.JournalEntryLineDetail?.PostingType !== 'Credit').reduce((t, l) => t + (l.Amount || 0), 0) + (r.TxnTaxDetail?.TotalTax || 0) : null);
    modal('Practice QuickBooks', rows.length ? `<div class="table-wrap" style="max-height:60vh;overflow:auto"><table class="list small"><thead><tr><th>Type</th><th>Id</th><th>Name / number</th><th class="right">Amount</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.entity)}</td><td>${esc(r.id)}</td><td>${esc(label(r))}</td><td class="right">${amount(r) != null ? money(amount(r)) : ''}</td><td>${r.Voided ? '<span class="pill red">Void</span>' : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">Empty. Press Sync now.</p>', [{ label: 'Close', cls: 'primary' }]);
  };
}
