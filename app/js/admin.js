// Owner tools: Settings (company, team, services, branches, rules, activity), Insights, and Acquisitions.

const SERVICE_CATEGORIES = ['General pest', 'Termite', 'Rodent', 'Mosquito', 'Bed bugs', 'Wildlife', 'Lawn', 'Commercial', 'Inspection', 'Other'];
const SETTINGS_TABS = [
  ['company', 'Company'], ['team', 'Team'], ['licenses', 'Licenses & training'], ['services', 'Services'], ['products', 'Products'], ['branches', 'Branches'], ['rules', 'Rules'],
  ['sales', 'Sales & booking'], ['followup', 'Follow-up'], ['payments', 'Payments & plan'], ['data', 'Import & export'], ['integrations', 'API & integrations'], ['activity', 'Activity log'],
];
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// ---------- Settings ----------
async function pageSettings(view, _id, params = {}) {
  const tab = SETTINGS_TABS.some((t) => t[0] === params.tab) ? params.tab : 'company';
  const d = await api('/nuvolve/app/api/settings');
  view.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><div class="muted">Only owners and admins see this page.</div></div></div>
    <div class="tabs">${SETTINGS_TABS.map(([k, label]) => `<a href="#/settings?tab=${k}" class="${k === tab ? 'on' : ''}">${label}</a>`).join('')}</div>
    <div id="tab"></div>`;
  const box = $('#tab');
  ({ company: settingsCompany, team: settingsTeam, licenses: settingsLicenses, services: settingsServices, products: settingsProducts, branches: settingsBranches, rules: settingsRules,
    sales: settingsSales, followup: settingsFollowup, payments: settingsPayments, data: settingsData, integrations: settingsIntegrations, activity: settingsActivity })[tab](box, d);
}

function settingsCompany(box, d) {
  const s = d.settings;
  box.innerHTML = `<form class="card" id="company" style="max-width:720px">
    <h2>Company</h2>
    <div class="field"><label>Company name</label><input name="company_name" value="${esc(s.company_name || '')}"></div>
    <div class="row"><div class="field"><label>Phone</label><input name="company_phone" value="${esc(s.company_phone || '')}"></div>
    <div class="field"><label>Email</label><input name="company_email" value="${esc(s.company_email || '')}"></div></div>
    <div class="field"><label>Main shop address (routes start here unless a tech belongs to a branch)</label><input name="shop_address" value="${esc(s.shop_address || '')}">
      <div class="hint">${s.shop_lat ? '📍 Found on the map' : '⚠️ Not on the map yet'}</div></div>
    <div class="row"><div class="field"><label>Business license #</label><input name="license_no" value="${esc(s.license_no || '')}"></div>
    <div class="field"><label>Invoices due in (days)</label><input name="payment_terms_days" type="number" value="${esc(s.payment_terms_days || '0')}"></div></div>
    <div class="row"><div class="field"><label>Sales tax on services (%)</label><input name="tax_rate" type="number" step="0.001" min="0" max="20" value="${esc(s.tax_rate || '0')}">
      <div class="hint">Added to every service invoice. Leave 0 if pest control isn't taxed in your state. Mark tax-exempt customers on their page.</div></div>
    <div class="field"><label>Tax name on invoices</label><input name="tax_label" value="${esc(s.tax_label || 'Sales tax')}"></div></div>
    <div class="field"><label>Time zone</label><select name="timezone">${['', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu']
      .map((z) => `<option value="${z}" ${z === (s.timezone || '') ? 'selected' : ''}>${z ? z.replace('America/', '').replace('Pacific/', '').replace('_', ' ') : 'Server time'}</option>`).join('')}</select>
      <div class="hint">Used for the times printed on service records.</div></div>
    <div class="field"><label>Message on the customer pay page</label><textarea name="portal_message">${esc(s.portal_message || '')}</textarea></div>
    <button class="btn primary">Save company info</button>
  </form>
  <form class="card" id="security" style="max-width:720px">
    <h2>Login security</h2>
    <label class="check"><input type="checkbox" name="require_2fa" ${s.require_2fa === '1' ? 'checked' : ''}> Require two-factor login for owners, admins and branch managers</label>
    <div class="hint">They type a code from an app on their phone after their password. Anyone without it set up is asked to do it the next time they open Nuvolve. ${BOOT.me.totp_enabled ? '' : '<b>Turn it on for your own login first in <a href="#/account">My account</a>.</b>'}</div>
    <button class="btn primary" style="margin-top:12px">Save login security</button>
  </form>`;
  $('#company').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/nuvolve/app/api/settings', { method: 'PUT', body: formData(e.target) }); await refreshBoot(); toast('Saved'); route(); } catch (err) { toast(err.message, true); }
  };
  $('#security').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/nuvolve/app/api/settings', { method: 'PUT', body: { require_2fa: e.target.require_2fa.checked ? '1' : '0' } }); await refreshBoot(); toast('Saved'); } catch (err) { toast(err.message, true); }
  };
  addressAutocomplete($('#company [name=shop_address]'), (a) => { $('#company [name=shop_address]').value = a.label; });
}

function settingsTeam(box, d) {
  const locName = (id) => d.locations.find((l) => l.id === id)?.name;
  box.innerHTML = `<div class="card">
    <div class="card-head"><h2>Team</h2><button class="btn sm primary" id="add-user">+ Add person</button></div>
    <div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Role</th>${d.locations.length > 1 ? '<th>Branch</th>' : ''}<th>License</th></tr></thead><tbody>
    ${d.users.map((u) => `<tr class="click" data-user="${u.id}"><td><span class="dot" style="background:${esc(u.color)}"></span><b>${esc(u.name)}</b>${u.totp_enabled ? ' <span title="Two-factor login on">🔒</span>' : ''}${u.active ? '' : ' <span class="pill">Off</span>'}<div class="small muted">${esc(u.email || 'No login yet')}</div></td>
      <td>${ROLE_LABEL[u.role]}${u.runs_routes ? '<div class="small muted">Runs routes</div>' : ''}</td>
      ${d.locations.length > 1 ? `<td class="small">${esc(locName(u.location_id) || 'All branches')}</td>` : ''}
      <td class="small">${u.license_no ? esc(u.license_no) : '<span class="muted">None</span>'}</td></tr>`).join('')}</tbody></table></div>
    <div class="role-help">
      <div><b>Owner / Admin</b> Everything, every branch. Sets rules, services, prices and branches.</div>
      <div><b>Branch manager</b> Runs one branch: its customers, schedule, billing and the Insights numbers for that branch. Can't change settings.</div>
      <div><b>Office rep</b> Answers calls, books, schedules, takes payments. Can be tied to one branch or see all. No settings.</div>
      <div><b>Technician</b> Only their own route, on their phone at <b>${location.origin}/nuvolve/app/tech</b>.</div>
      <div><b>Sales rep</b> Door-to-door: the door map, their own leads and quotes, on a phone or tablet at <b>${location.origin}/nuvolve/app/sell</b>. No customer list.</div>
    </div></div>`;
  const userModal = (u = { role: 'tech', runs_routes: 1, color: '#3182ce', active: 1 }) => {
    const m = modal(u.id ? 'Edit team member' : 'Add team member', `
    <div class="field"><label>Name</label><input name="name" value="${esc(u.name || '')}"></div>
    <div class="row"><div class="field"><label>Email (their login)</label><input name="email" type="email" value="${esc(u.email || '')}"></div>
    <div class="field"><label>Phone</label><input name="phone" value="${esc(u.phone || '')}"></div></div>
    <div class="row"><div class="field"><label>Role</label><select name="role" ${u.role === 'owner' ? 'disabled' : ''}>
      ${u.role === 'owner' ? '<option selected>Owner</option>' : ['tech', 'sales', 'office', 'manager', 'admin'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select></div>
    ${d.locations.length > 1 || u.location_id ? `<div class="field"><label>Branch</label><select name="location_id" ${u.role === 'owner' ? 'disabled' : ''}><option value="">All branches</option>${d.locations.map((l) => `<option value="${l.id}" ${u.location_id === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>` : ''}</div>
    <div class="row"><div class="field"><label>Applicator license #</label><input name="license_no" value="${esc(u.license_no || '')}"></div>
    <div class="field"><label>Map color</label><input name="color" type="color" value="${esc(u.color)}" style="height:42px"></div></div>
    <div class="field"><label>${u.id ? 'New password (leave blank to keep)' : 'Password'}</label><input name="password" type="text" placeholder="${u.id ? '' : 'At least 8 characters'}"></div>
    <label class="check"><input type="checkbox" name="runs_routes" ${u.runs_routes ? 'checked' : ''}> Runs routes (shows on schedule)</label>
    ${u.id && u.role !== 'owner' ? `<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Active</label>` : ''}
    ${u.totp_enabled && (u.role !== 'owner' || BOOT.me.role === 'owner') ? `<div class="alert info" style="margin-top:10px"><span>🔒 Two-factor login is on. Lost their phone?</span><button type="button" class="btn sm" id="reset2fa">Reset two-factor</button></div>` : ''}`,
    [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (el) => {
      const body = formData(el);
      if (u.role === 'owner') { delete body.role; delete body.location_id; }
      if (u.id) await api(`/nuvolve/app/api/users/${u.id}`, { method: 'PUT', body });
      else await api('/nuvolve/app/api/users', { body });
      await refreshBoot(); toast('Saved'); route();
    } }]);
    if ($('#reset2fa', m.el)) $('#reset2fa', m.el).onclick = async () => {
      if (!confirm(`Reset two-factor for ${u.name}? They are logged out and set it up again next time they log in.`)) return;
      try { await api(`/nuvolve/app/api/users/${u.id}/reset-2fa`, { method: 'POST' }); m.close(); toast('Two-factor reset'); route(); } catch (e) { toast(e.message, true); }
    };
    return m;
  };
  $('#add-user').onclick = () => userModal();
  $$('[data-user]', box).forEach((tr) => (tr.onclick = () => userModal(d.users.find((u) => u.id === Number(tr.dataset.user)))));
}

// Applicator licenses, renewals and CEUs for the whole team.
const LICENSE_PILL = { current: ['green', 'Current'], expiring: ['yellow', 'Renew soon'], expired: ['red', 'Expired'] };
async function settingsLicenses(box) {
  const d = await api('/nuvolve/app/api/licenses');
  const byUser = (id) => d.licenses.filter((l) => l.user_id === id);
  const techs = d.people.filter((u) => u.runs_routes || byUser(u.id).length);
  const due = d.licenses.filter((l) => l.status !== 'current');
  const left = (l) => (l.days_left == null ? 'No expiration' : l.days_left < 0 ? `Expired ${fmtDate(l.expires_on)}` : `Expires ${fmtDate(l.expires_on)} (${l.days_left} days)`);
  const ceu = (l) => (l.ceu_required ? `<div class="small ${l.ceu_short ? '' : 'muted'}">${l.ceu_earned} of ${l.ceu_required} CEUs${l.ceu_short ? ` · <b>${l.ceu_short} to go</b>` : ' ✓'}</div>` : '');
  box.innerHTML = `
    ${d.atRisk.length ? `<div class="alert warn"><span><b>${d.atRisk.length} restricted stop${d.atRisk.length === 1 ? '' : 's'} in the next 90 days</b> are assigned to a tech who won't be licensed that day. Renew the license or move the stop.</span></div>
      <div class="card"><h2>Stops at risk</h2><div class="table-wrap"><table class="list"><thead><tr><th>Date</th><th>Customer</th><th>Service</th><th>Problem</th></tr></thead><tbody>
      ${d.atRisk.map((v) => `<tr><td class="nowrap">${fmtDate(v.date)}</td><td><a href="#/customers/${v.customer_id}">${esc([v.first_name, v.last_name].filter(Boolean).join(' ') || v.company || 'Customer')}</a><div class="small muted">${esc(v.address || '')}</div></td>
        <td class="small">${esc(v.service)}</td><td class="small">${esc(v.problem)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
    ${due.length ? `<div class="alert ${due.some((l) => l.status === 'expired') ? 'err' : 'warn'}"><span>${due.map((l) => `<b>${esc(l.name)}</b>: ${esc(l.category)} ${l.status === 'expired' ? 'expired' : `expires in ${l.days_left} days`}`).join(' · ')}</span></div>` : ''}
    <div class="card">
      <div class="card-head"><div><h2>Licenses</h2><div class="small muted">${d.restricted.length ? `Restricted services: ${d.restricted.map((s) => `${esc(s.name)} (${esc(s.required_license)})`).join(', ')}.` : 'Mark a service as restricted under Services to keep unlicensed techs off it.'} Techs and their managers get a reminder 60, 30 and 7 days before a license expires.</div></div>
        <button class="btn sm primary" id="add-lic">+ Add license</button></div>
      <div class="table-wrap"><table class="list"><thead><tr><th>Person</th><th>License</th><th>Status</th><th>Training</th><th></th></tr></thead><tbody>
      ${techs.map((u) => { const ls = byUser(u.id); return ls.length ? ls.map((l, i) => `<tr>
        ${i === 0 ? `<td rowspan="${ls.length}"><span class="dot" style="background:${esc(u.color)}"></span><b>${esc(u.name)}</b></td>` : ''}
        <td><b>${esc(l.category)}</b><div class="small muted">${[l.state, l.license_no ? '#' + l.license_no : ''].filter(Boolean).map(esc).join(' · ')}</div></td>
        <td><span class="pill ${LICENSE_PILL[l.status][0]}">${LICENSE_PILL[l.status][1]}</span><div class="small muted">${left(l)}</div></td>
        <td>${ceu(l)}</td>
        <td class="right nowrap"><button class="btn sm" data-ceu="${l.id}">+ CEU</button><button class="btn sm" data-lic="${l.id}">Edit</button></td></tr>`).join('')
        : `<tr><td><span class="dot" style="background:${esc(u.color)}"></span><b>${esc(u.name)}</b></td><td colspan="3" class="small muted">${u.license_no ? `License # ${esc(u.license_no)} (no dates tracked)` : 'No license on file'}</td>
          <td class="right"><button class="btn sm" data-new="${u.id}">+ License</button></td></tr>`; }).join('')}
      </tbody></table></div></div>
    <div class="card"><div class="card-head"><div><h2>Training and CEUs</h2><div class="small muted">Credits count toward a license when they are earned after its issue date. Techs can log classes from their phone.</div></div>
      <button class="btn sm" id="add-ceu">+ Log training</button></div>
      ${d.ceus.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Date</th><th>Person</th><th>Course</th><th class="right">Credits</th><th></th></tr></thead><tbody>
      ${d.ceus.map((c) => `<tr><td class="nowrap small">${fmtDate(c.completed_on)}</td><td>${esc(c.name)}</td>
        <td>${esc(c.course)}<div class="small muted">${[c.provider, c.license_category ? `For ${c.license_category}` : 'Counts toward every license'].filter(Boolean).map(esc).join(' · ')}</div></td>
        <td class="right">${c.credits}</td><td class="right"><button class="btn sm" data-delceu="${c.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">No training logged yet.</p>'}
    </div>`;
  const personSelect = (sel) => `<div class="field"><label>Person</label><select name="user_id">${d.people.map((u) => `<option value="${u.id}" ${u.id === sel ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>`;
  const licModal = (l = {}) => {
    const m = modal(l.id ? `Edit ${l.name}'s license` : 'Add a license', `
      ${l.id ? '' : personSelect(l.user_id)}
      <div class="row"><div class="field"><label>Category</label><select name="category">${d.categories.map((c) => `<option ${c === l.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label>State</label><input name="state" maxlength="2" value="${esc(l.state || BOOT.settings.state || '')}" placeholder="TX"></div></div>
      <div class="field"><label>License #</label><input name="license_no" value="${esc(l.license_no || '')}"></div>
      <div class="row"><div class="field"><label>Issued or last renewed</label><input name="issued_on" type="date" value="${esc(l.issued_on || '')}"></div>
      <div class="field"><label>Expires</label><input name="expires_on" type="date" value="${esc(l.expires_on || '')}"></div></div>
      <div class="field"><label>CEUs needed to renew</label><input name="ceu_required" type="number" step="0.5" min="0" value="${l.ceu_required ?? ''}" placeholder="None"></div>
      <div class="field"><label>Notes</label><input name="notes" value="${esc(l.notes || '')}" placeholder="Category numbers, sub-categories, sponsor"></div>
      ${l.id ? '<div class="hint">Renewed? Set the new issue and expiration dates. CEUs start counting again from the new issue date.</div>' : ''}`,
    [...(l.id ? [{ label: 'Delete', onClick: async () => { if (!confirm(`Delete this ${l.category} license?`)) return false; await api(`/nuvolve/app/api/licenses/${l.id}`, { method: 'DELETE' }); toast('Deleted'); route(); } }] : []),
      { label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (el) => {
        const b = formData(el);
        if (l.id) await api(`/nuvolve/app/api/licenses/${l.id}`, { method: 'PUT', body: b });
        else await api('/nuvolve/app/api/licenses', { body: b });
        toast('Saved'); route();
      } }]);
    return m;
  };
  const ceuModal = (lic) => modal('Log training', `
    ${lic ? `<p class="small muted">${esc(lic.name)} · ${esc(lic.category)}</p><input type="hidden" name="user_id" value="${lic.user_id}"><input type="hidden" name="license_id" value="${lic.id}">` : personSelect()}
    <div class="field"><label>Course or class</label><input name="course" placeholder="Termite and WDO update"></div>
    <div class="row"><div class="field"><label>Credits</label><input name="credits" type="number" step="0.5" min="0.5" value="1"></div>
    <div class="field"><label>Finished on</label><input name="completed_on" type="date" value="${todayStr()}"></div></div>
    <div class="field"><label>Provider</label><input name="provider" placeholder="State extension, association, online"></div>`,
  [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (el) => { await api('/nuvolve/app/api/ceus', { body: formData(el) }); toast('Training logged'); route(); } }]);
  $('#add-lic').onclick = () => licModal();
  $('#add-ceu').onclick = () => ceuModal();
  $$('[data-new]', box).forEach((b) => (b.onclick = () => licModal({ user_id: Number(b.dataset.new) })));
  $$('[data-lic]', box).forEach((b) => (b.onclick = () => licModal(d.licenses.find((l) => l.id === Number(b.dataset.lic)))));
  $$('[data-ceu]', box).forEach((b) => (b.onclick = () => ceuModal(d.licenses.find((l) => l.id === Number(b.dataset.ceu)))));
  $$('[data-delceu]', box).forEach((b) => (b.onclick = async () => { if (!confirm('Delete this training record?')) return; await api(`/nuvolve/app/api/ceus/${b.dataset.delceu}`, { method: 'DELETE' }); route(); }));
}

function settingsServices(box, d) {
  const multi = d.locations.filter((l) => l.active).length > 1;
  const ls = (locId, stId) => d.locationServices.find((x) => x.location_id === locId && x.service_type_id === stId);
  box.innerHTML = `<div class="card">
    <div class="card-head"><div><h2>Services and prices</h2><div class="small muted">★ is the default: it's picked first on every new customer. Services with history are archived instead of deleted, so old tickets stay correct.</div></div>
      <button class="btn sm primary" id="add-svc">+ Add service</button></div>
    <div class="table-wrap"><table class="list"><thead><tr><th>Service</th><th>Type</th><th class="right">Price</th><th class="right">Lowest price</th><th>Usually</th><th class="right">Active plans</th><th></th></tr></thead><tbody>
    ${d.serviceTypes.map((t) => `<tr class="${t.active ? '' : 'muted'}">
      <td><b>${t.is_default ? '★ ' : ''}${esc(t.name)}</b>${t.active ? '' : ' <span class="pill">Off</span>'}<div class="small muted">${esc(t.category || '')}${t.description ? ' · ' + esc(t.description) : ''}</div>${t.required_license ? `<div class="small"><span class="pill yellow">🔒 ${esc(t.required_license)} license</span></div>` : ''}</td>
      <td class="small">${{ both: 'Both', residential: 'Residential', commercial: 'Commercial' }[t.customer_type] || 'Both'}</td>
      <td class="right">${money(t.default_price)}</td><td class="right small">${t.min_price != null ? money(t.min_price) : '<span class="muted">Any</span>'}</td>
      <td class="small">${FREQ[t.default_frequency] || ''} · ${t.duration_min} min</td><td class="right">${t.active_plans}</td>
      <td class="right nowrap"><button class="btn sm" data-edit="${t.id}">Edit</button>
        ${t.active && !t.is_default ? `<button class="btn sm" data-default="${t.id}">Make default</button>` : ''}
        ${t.active ? `<button class="btn sm" data-remove="${t.id}">Remove</button>` : `<button class="btn sm" data-on="${t.id}">Turn on</button>`}</td></tr>`).join('')}
    </tbody></table></div></div>
    ${multi ? `<div class="card"><div class="card-head"><div><h2>Branch menus and prices</h2><div class="small muted">Untick a service a branch doesn't sell. Leave a price blank to use the normal price.</div></div><button class="btn sm primary" id="save-tree">Save branch menus</button></div>
      <div class="table-wrap"><table class="list tree"><thead><tr><th>Service</th>${d.locations.filter((l) => l.active).map((l) => `<th>${esc(l.name)}</th>`).join('')}</tr></thead><tbody>
      ${d.serviceTypes.filter((t) => t.active).map((t) => `<tr><td><b>${esc(t.name)}</b><div class="small muted">${money(t.default_price)}</div></td>
        ${d.locations.filter((l) => l.active).map((l) => { const o = ls(l.id, t.id); return `<td><label class="check small"><input type="checkbox" data-loc="${l.id}" data-st="${t.id}" class="offer" ${o && !o.offered ? '' : 'checked'}> Sells</label>
          <input class="tprice" data-loc="${l.id}" data-st="${t.id}" type="number" step="0.01" placeholder="${t.default_price}" value="${o?.price ?? ''}"></td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div></div>` : ''}`;

  const svcModal = (t = { active: 1, duration_min: 30, default_frequency: 'quarterly', customer_type: 'both' }) => {
    const m = modal(t.id ? `Edit ${t.name}` : 'Add a service', `
      <div class="field"><label>Name</label><input name="name" value="${esc(t.name || '')}" placeholder="General Pest - Quarterly"></div>
      <div class="row"><div class="field"><label>Category</label><select name="category">${SERVICE_CATEGORIES.map((c) => `<option ${c === t.category ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label>Sold to</label><select name="customer_type">${[['both', 'Homes and businesses'], ['residential', 'Homes only'], ['commercial', 'Businesses only']].map(([v, l]) => `<option value="${v}" ${t.customer_type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="field"><label>What's included (customers see this)</label><input name="description" value="${esc(t.description || '')}" placeholder="Exterior perimeter spray, eaves sweep, interior on request"></div>
      <div class="row"><div class="field"><label>Normal price</label><input name="default_price" type="number" step="0.01" value="${t.default_price ?? ''}"></div>
      <div class="field"><label>Lowest price allowed</label><input name="min_price" type="number" step="0.01" value="${t.min_price ?? ''}" placeholder="No limit"><div class="hint">Enforced when the "price floor" rule is on.</div></div></div>
      <div class="row"><div class="field"><label>Usually sold</label><select name="default_frequency">${Object.entries(FREQ).map(([k, v]) => `<option value="${k}" ${t.default_frequency === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>Minutes on site</label><input name="duration_min" type="number" value="${t.duration_min}"></div></div>
      <div class="field"><label>Restricted to a license</label><select name="required_license"><option value="">No, any tech can do it</option>${d.licenseCategories.map((c) => `<option ${c === t.required_license ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <div class="hint">Only techs with a current license in this category can be scheduled for it or finish it. Track licenses under Licenses &amp; training.</div></div>
      <label class="check"><input type="checkbox" name="is_default" ${t.is_default ? 'checked' : ''}> Default service for new customers</label>
      ${t.id && t.active_plans ? `<label class="check"><input type="checkbox" name="apply_to_plans"> Also change the price on the ${t.active_plans} active plan${t.active_plans === 1 ? '' : 's'} using it (future visits only)</label>` : ''}`,
    [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (el) => {
      const b = formData(el);
      if (t.id) {
        const r = await api(`/nuvolve/app/api/service-types/${t.id}`, { method: 'PUT', body: b });
        toast(r.repriced ? `Saved. ${r.repriced} plans repriced.` : 'Saved');
      } else { await api('/nuvolve/app/api/service-types', { body: { ...b, active: true } }); toast('Service added'); }
      await refreshBoot(); route();
    } }]);
    return m;
  };
  $('#add-svc').onclick = () => svcModal();
  $$('[data-edit]', box).forEach((b) => (b.onclick = () => svcModal(d.serviceTypes.find((t) => t.id === Number(b.dataset.edit)))));
  $$('[data-default]', box).forEach((b) => (b.onclick = async () => { await api(`/nuvolve/app/api/service-types/${b.dataset.default}`, { method: 'PUT', body: { is_default: true } }); await refreshBoot(); toast('Default service set'); route(); }));
  $$('[data-on]', box).forEach((b) => (b.onclick = async () => { await api(`/nuvolve/app/api/service-types/${b.dataset.on}`, { method: 'PUT', body: { active: true } }); await refreshBoot(); route(); }));
  $$('[data-remove]', box).forEach((b) => (b.onclick = () => {
    const t = d.serviceTypes.find((x) => x.id === Number(b.dataset.remove));
    const others = d.serviceTypes.filter((x) => x.active && x.id !== t.id);
    modal(`Remove ${t.name}?`, t.active_plans
      ? `<p><b>${t.active_plans} active plan${t.active_plans === 1 ? '' : 's'}</b> use this service. Move them to another service first:</p>
         <div class="field"><label>Move them to</label><select name="to">${others.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></div>`
      : '<p>It disappears from every list. If it was ever used, it is archived so old tickets and reports still show it.</p>',
    [{ label: 'Cancel' }, { label: t.active_plans ? 'Move plans and remove' : 'Remove', cls: 'primary', onClick: async (el) => {
      if (t.active_plans) await api(`/nuvolve/app/api/service-types/${t.id}/move-plans`, { body: formData(el) });
      const r = await api(`/nuvolve/app/api/service-types/${t.id}`, { method: 'DELETE' });
      toast(r.archived ? 'Archived (it has history)' : 'Removed'); await refreshBoot(); route();
    } }]);
  }));
  if ($('#save-tree')) $('#save-tree').onclick = async () => {
    for (const l of d.locations.filter((x) => x.active)) {
      const services = d.serviceTypes.filter((t) => t.active).map((t) => ({
        service_type_id: t.id,
        offered: $(`.offer[data-loc="${l.id}"][data-st="${t.id}"]`).checked,
        price: $(`.tprice[data-loc="${l.id}"][data-st="${t.id}"]`).value,
      }));
      await api(`/nuvolve/app/api/locations/${l.id}/services`, { method: 'PUT', body: { services } });
    }
    await refreshBoot(); toast('Branch menus saved');
  };
}

function settingsBranches(box, d) {
  box.innerHTML = `<div class="card">
    <div class="card-head"><div><h2>Branches</h2><div class="small muted">Each branch has its own service area, team, menu and prices. New customers land in the branch whose area covers their address.</div></div>
      <div class="actions"><button class="btn sm" id="reassign">Re-sort customers by area</button><button class="btn sm primary" id="add-loc">+ Add branch</button></div></div>
    <div class="grid cols-2">${d.locations.map((l) => `<div class="branch ${l.active ? '' : 'muted'}">
      <div style="display:flex;justify-content:space-between;gap:8px"><h3>${esc(l.name)} ${l.is_default ? '<span class="pill green">Main</span>' : ''}${l.active ? '' : '<span class="pill">Closed</span>'}</h3>
        <button class="btn sm" data-loc="${l.id}">Edit</button></div>
      <div class="small">${esc([l.address, l.city, l.state, l.zip].filter(Boolean).join(', ') || 'No address yet')} ${l.lat != null ? '📍' : ''}</div>
      <div class="small muted">${l.phone ? esc(l.phone) + ' · ' : ''}${l.license_no ? 'License ' + esc(l.license_no) : ''}</div>
      <div class="small" style="margin-top:6px"><b>Service area:</b> ${l.service_zips ? esc(l.service_zips) : ''}${l.service_zips && l.radius_miles ? ' or ' : ''}${l.radius_miles ? `${l.radius_miles} miles around the branch` : ''}${!l.service_zips && !l.radius_miles ? 'Everywhere' : ''}</div>
      <div class="actions" style="margin-top:8px">${l.is_default ? '' : `<button class="btn sm" data-main="${l.id}">Make main</button>`}<button class="btn sm" data-move="${l.id}">Move customers out</button></div>
    </div>`).join('')}</div></div>`;
  const locModal = (l = { active: 1 }) => {
    const m = modal(l.id ? `Edit ${l.name}` : 'Add a branch', `
      <div class="field"><label>Branch name</label><input name="name" value="${esc(l.name || '')}" placeholder="Fort Worth"></div>
      <div class="field"><label>Address (routes for this branch's techs start here)</label><input name="address" id="lm-addr" value="${esc(l.address || '')}"></div>
      <div class="row" style="grid-template-columns:2fr 1fr 1fr"><div class="field"><label>City</label><input name="city" value="${esc(l.city || '')}"></div>
      <div class="field"><label>State</label><input name="state" maxlength="2" value="${esc(l.state || '')}"></div><div class="field"><label>Zip</label><input name="zip" value="${esc(l.zip || '')}"></div></div>
      <div class="row"><div class="field"><label>Phone</label><input name="phone" value="${esc(l.phone || '')}"></div><div class="field"><label>Business license #</label><input name="license_no" value="${esc(l.license_no || '')}"></div></div>
      <div class="field"><label>Zips this branch serves</label><input name="service_zips" value="${esc(l.service_zips || '')}" placeholder="75080, 75081, 761*"><div class="hint">Separate with commas. A star matches a prefix: 761* is every zip starting 761.</div></div>
      <div class="field"><label>Or everything within (miles)</label><input name="radius_miles" type="number" step="1" value="${l.radius_miles ?? ''}" placeholder="Leave blank to use zips only"></div>
      ${l.id && !l.is_default ? `<label class="check"><input type="checkbox" name="active" ${l.active ? 'checked' : ''}> Open (untick to close the branch)</label>` : ''}`,
    [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (el) => {
      const b = formData(el);
      if (!l.id || l.is_default) delete b.active;
      if (l.id) await api(`/nuvolve/app/api/locations/${l.id}`, { method: 'PUT', body: b }); else await api('/nuvolve/app/api/locations', { body: b });
      await refreshBoot(); toast('Branch saved'); route();
    } }]);
    addressAutocomplete($('#lm-addr', m.el), (a) => fillAddress($('.mb', m.el), a));
  };
  $('#add-loc').onclick = () => locModal();
  $$('[data-loc]', box).forEach((b) => (b.onclick = () => locModal(d.locations.find((l) => l.id === Number(b.dataset.loc)))));
  $$('[data-main]', box).forEach((b) => (b.onclick = async () => { await api(`/nuvolve/app/api/locations/${b.dataset.main}`, { method: 'PUT', body: { is_default: true } }); await refreshBoot(); route(); }));
  $$('[data-move]', box).forEach((b) => (b.onclick = () => modal('Move customers to another branch', `
    <div class="field"><label>Move to</label><select name="to">${d.locations.filter((l) => l.active && l.id !== Number(b.dataset.move)).map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Only these zips (optional)</label><input name="zips" placeholder="Blank = every customer in this branch"></div>`,
  [{ label: 'Cancel' }, { label: 'Move', cls: 'primary', onClick: async (el) => {
    const r = await api(`/nuvolve/app/api/locations/${b.dataset.move}/move-customers`, { body: formData(el) });
    toast(`${r.moved} customers moved`); route();
  } }])));
  $('#reassign').onclick = () => modal('Re-sort customers by service area?', '<p>Every customer is checked against the branch zips and radius and moved to the branch that covers them. Customers outside every area go to the main branch.</p>', [
    { label: 'Cancel' }, { label: 'Re-sort', cls: 'primary', onClick: async () => { const r = await api('/nuvolve/app/api/locations/reassign', { method: 'POST' }); toast(`${r.moved} customers moved`); route(); } }]);
}

function settingsRules(box, d) {
  const scope = (r) => [r.location_id ? d.locations.find((l) => l.id === r.location_id)?.name : 'All branches',
    r.service_type_id ? d.serviceTypes.find((s) => s.id === r.service_type_id)?.name : 'All services'].join(' · ');
  const label = (r) => {
    const t = d.ruleTypes[r.type];
    return t.param ? t.label.replace(/\bN\b/, r.params?.[t.param.key] ?? t.param.default) : t.label;
  };
  const group = (when) => d.rules.filter((r) => d.ruleTypes[r.type]?.when === when);
  const list = (rows) => rows.length ? rows.map((r) => `<div class="rule ${r.active ? '' : 'off'}">
      <label class="switch"><input type="checkbox" data-toggle="${r.id}" ${r.active ? 'checked' : ''}><span></span></label>
      <div style="flex:1"><b>${esc(label(r))}</b><div class="small muted">${esc(scope(r))}</div></div>
      <button class="btn sm" data-del="${r.id}">Delete</button></div>`).join('') : '<p class="muted small">None yet.</p>';
  box.innerHTML = `<div class="grid cols-2">
    <div class="card"><h2>Before a stop can be finished</h2>${list(group('complete'))}</div>
    <div class="card"><h2>Before service can be scheduled or sold</h2>${list(group('schedule'))}</div></div>
    <div class="card" style="max-width:760px"><h2>Add a rule</h2>
      <p class="small muted">Rules are checked by the server, so no one gets around them from a phone or another screen. Owners and admins can override one time; overrides land in the activity log.</p>
      <form id="rf"><div class="field"><label>Rule</label><select name="type" id="rtype">${Object.entries(d.ruleTypes).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('')}</select></div>
      <div class="field hidden" id="rparam"><label id="rplabel"></label><input name="param" type="number"></div>
      <div class="row"><div class="field"><label>Branch</label><select name="location_id"><option value="">All branches</option>${d.locations.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Service</label><select name="service_type_id"><option value="">All services</option>${d.serviceTypes.filter((s) => s.active).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div></div>
      <button class="btn primary">Add rule</button></form></div>`;
  const syncParam = () => {
    const t = d.ruleTypes[$('#rtype').value];
    $('#rparam').classList.toggle('hidden', !t.param);
    if (t.param) { $('#rplabel').textContent = t.param.label; $('#rf').param.value = t.param.default; }
  };
  $('#rtype').onchange = syncParam;
  syncParam();
  $('#rf').onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const t = d.ruleTypes[f.type];
    try {
      await api('/nuvolve/app/api/rules', { body: { type: f.type, location_id: f.location_id, service_type_id: f.service_type_id, params: t.param ? { [t.param.key]: f.param } : null } });
      toast('Rule added'); route();
    } catch (err) { toast(err.message, true); }
  };
  $$('[data-toggle]', box).forEach((c) => (c.onchange = async () => { await api(`/nuvolve/app/api/rules/${c.dataset.toggle}`, { method: 'PUT', body: { active: c.checked } }); toast(c.checked ? 'Rule on' : 'Rule off'); }));
  $$('[data-del]', box).forEach((b) => (b.onclick = async () => { await api(`/nuvolve/app/api/rules/${b.dataset.del}`, { method: 'DELETE' }); route(); }));
}

function settingsSales(box, d) {
  const s = d.settings;
  const link = s.booking_key ? `${location.origin}/nuvolve/app/book/${s.booking_key}` : '';
  const embed = link ? `<iframe src="${link}" title="Book pest control" style="width:100%;max-width:560px;height:900px;border:0"></iframe>` : '';
  box.innerHTML = `<div class="grid cols-2">
    <form class="card" id="booking">
      <h2>Online booking</h2>
      <p class="small muted">A form for your website, Facebook page or Google profile. Each booking becomes a lead with a service request, and the office gets a notification. If the person is already a customer, it's added to their account instead.</p>
      ${link ? `<label class="check"><input type="checkbox" name="booking_enabled" ${s.booking_enabled === '1' ? 'checked' : ''}> Booking form is on</label>
        <div class="field" style="margin-top:8px"><label>Link to share</label><div class="copy-row"><input readonly value="${esc(link)}"><button type="button" class="btn sm" data-copy="link">Copy</button><a class="btn sm" href="${esc(link)}" target="_blank" rel="noopener">Open</a></div></div>
        <div class="field"><label>Put it on your website (paste into your site builder)</label><textarea readonly rows="3" class="mono">${esc(embed)}</textarea><button type="button" class="btn sm" data-copy="embed">Copy code</button></div>
        <div class="field"><label>Message at the top of the form</label><textarea name="booking_message" placeholder="Tell us what's bugging you and we'll call within 1 business hour.">${esc(s.booking_message || '')}</textarea></div>
        <div class="actions"><button class="btn primary">Save</button><button type="button" class="btn" id="new-key">Make a new link</button></div>
        <div class="hint">A new link stops the old one from working (use it if spam starts coming in).</div>`
    : '<button type="button" class="btn primary" id="new-key">Turn on online booking</button>'}
    </form>
    <form class="card" id="agreement">
      <h2>Estimates and service agreements</h2>
      <p class="small muted">Customers read these terms and sign on their phone. The signed copy is saved with their name, signature, time and a tamper check. Have your attorney look over the wording for your state.</p>
      <div class="field"><label>Estimates are good for (days)</label><input name="estimate_valid_days" type="number" min="1" max="365" value="${esc(s.estimate_valid_days || '30')}"></div>
      <div class="field"><label>Agreement terms</label><textarea name="agreement_terms" rows="14">${esc(s.agreement_terms || d.defaultTerms)}</textarea></div>
      <div class="actions"><button class="btn primary">Save</button><button type="button" class="btn" id="reset-terms">Use the standard wording</button></div>
      <div class="hint">Changes apply to estimates sent from now on. Ones already sent keep the wording the customer saw. Turn on the rule "Signed service agreement required" under Rules to make every new recurring customer sign first.</div>
    </form></div>`;
  $$('[data-copy]', box).forEach((b) => (b.onclick = () => copyText(b.dataset.copy === 'link' ? link : embed, 'Copied')));
  $('#new-key').onclick = async () => {
    if (link && !confirm('Make a new booking link? The old link and website code stop working.')) return;
    try { await api('/nuvolve/app/api/settings/booking-key', { method: 'POST' }); await refreshBoot(); toast('Booking link ready'); route(); } catch (e) { toast(e.message, true); }
  };
  if ($('#booking [name=booking_message]')) $('#booking').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/nuvolve/app/api/settings', { method: 'PUT', body: { booking_enabled: e.target.booking_enabled.checked ? '1' : '0', booking_message: e.target.booking_message.value } }); await refreshBoot(); toast('Saved'); } catch (err) { toast(err.message, true); }
  };
  $('#reset-terms').onclick = () => { $('#agreement [name=agreement_terms]').value = d.defaultTerms; };
  $('#agreement').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/nuvolve/app/api/settings', { method: 'PUT', body: formData(e.target) }); await refreshBoot(); toast('Saved'); } catch (err) { toast(err.message, true); }
  };
}

// The chemicals the techs pick from on a ticket. EPA number and active ingredient print on every service record.
function settingsProducts(box, d) {
  box.innerHTML = `<div class="card flush" style="max-width:980px">
    <div class="card-head" style="padding:16px 16px 0"><div><h2>Products</h2><div class="small muted">What your techs apply. Everything here prints on invoices, service reports and state records.</div></div>
      <button class="btn primary sm" id="add-prod">+ Add product</button></div>
    <div class="table-wrap"><table class="list"><thead><tr><th>Product</th><th>EPA Reg. No.</th><th>Active ingredient</th><th>Unit</th><th>Usual rate</th><th class="right">On hand</th><th></th></tr></thead><tbody>
    ${d.products.map((p) => `<tr class="click" data-prod="${p.id}"><td><b>${esc(p.name)}</b>${p.active ? '' : ' <span class="pill">Off</span>'}${p.restricted_use ? ' <span class="pill red">RUP</span>' : ''}${p.label_url ? ' <span class="small muted">· label</span>' : ''}${p.sds_url ? ' <span class="small muted">· SDS</span>' : ''}</td>
      <td>${esc(p.epa_reg || '')}</td><td class="small">${esc(p.active_ingredient || '')}</td><td>${esc(p.unit)}</td><td class="small">${esc(p.default_rate || '')}</td>
      <td class="right nowrap">${p.tracked ? `<b style="${p.low_stock != null && p.on_hand < p.low_stock ? 'color:var(--danger)' : ''}">${Number(p.on_hand)} ${esc(p.unit)}</b>` : '<span class="muted small">Not tracked</span>'}</td>
      <td class="right nowrap"><button class="btn sm" data-stock="${p.id}">Stock</button> <button class="btn sm">Edit</button></td></tr>`).join('')
      || '<tr><td colspan="7" class="muted">No products yet.</td></tr>'}</tbody></table></div></div>`;
  const edit = (p = { unit: 'oz', active: 1 }) => {
    const m = modal(p.id ? 'Edit product' : 'Add product', `
    <div class="field"><label>Product name</label><input name="name" value="${esc(p.name || '')}" placeholder="Talstar P"></div>
    <div class="row"><div class="field"><label>EPA Reg. No.</label><div style="display:flex;gap:6px"><input name="epa_reg" value="${esc(p.epa_reg || '')}" placeholder="279-3206">
        <button type="button" class="btn sm" id="epa-look">Look up</button></div><div class="hint">Fills in the label, ingredient and signal word from the EPA.</div></div>
      <div class="field"><label>Active ingredient</label><input name="active_ingredient" value="${esc(p.active_ingredient || '')}" placeholder="Bifenthrin 7.9%"></div></div>
    <div id="epa-results"></div>
    <div class="row"><div class="field"><label>Unit techs measure in</label><select name="unit">${['oz', 'fl oz', 'gal', 'ml', 'g', 'lb', 'blocks', 'stations', 'tubes', 'bait points'].map((u) => `<option ${u === p.unit ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
      <div class="field"><label>Usual rate or mix</label><input name="default_rate" value="${esc(p.default_rate || '')}" placeholder="0.06% (1 oz per gal)"><div class="hint">Filled in on the ticket for the tech. They can change it.</div></div></div>
    <div class="row"><div class="field"><label>Label link</label><input name="label_url" value="${esc(p.label_url || '')}" placeholder="https://..."><div class="hint">Customers can open it from their service report.</div></div>
      <div class="field"><label>SDS link</label><input name="sds_url" value="${esc(p.sds_url || '')}" placeholder="https://..."><div class="hint">Techs can open it from their phone.</div></div></div>
    <div class="row"><div class="field"><label>Signal word</label><select name="signal_word">${['', 'Caution', 'Warning', 'Danger'].map((w) => `<option ${w === (p.signal_word || '') ? 'selected' : ''}>${w}</option>`).join('')}</select></div>
      <div class="field"><label>Registrant</label><input name="registrant" value="${esc(p.registrant || '')}"></div></div>
    <label class="check"><input type="checkbox" name="restricted_use" ${p.restricted_use ? 'checked' : ''}> Restricted use pesticide (RUP)</label>
    <input type="hidden" name="epa_status" value="${esc(p.epa_status || '')}">
    <h3 style="margin-top:14px">Ordering</h3>
    <div class="row"><div class="field"><label>Vendor</label><input name="vendor" value="${esc(p.vendor || '')}" placeholder="Target Specialty Products"></div>
      <div class="field"><label>Cost per ${esc(p.unit)}</label><input name="unit_cost" type="number" step="0.01" min="0" value="${p.unit_cost ?? ''}"></div>
      <div class="field"><label>Usual order (${esc(p.unit)})</label><input name="reorder_qty" type="number" step="0.01" min="0" value="${p.reorder_qty ?? ''}"><div class="hint">Set the reorder point under Stock.</div></div></div>
    ${p.epa_status && p.epa_status.toLowerCase() !== 'active' ? `<div class="alert err small">EPA lists this product as ${esc(p.epa_status)}. Check that it can still be applied.</div>` : ''}
    ${p.id ? `<label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Techs can pick this product</label>` : ''}`,
    [{ label: 'Cancel' }, { label: 'Save product', cls: 'primary', onClick: async (el) => {
      const body = formData(el);
      if (!body.name) throw new Error('Give the product a name');
      if (p.id) await api(`/nuvolve/app/api/products/${p.id}`, { method: 'PUT', body });
      else await api('/nuvolve/app/api/products', { body });
      await refreshBoot(); toast('Product saved'); route();
    } }]);
    $('#epa-look', m.el).onclick = () => epaLookupInto(m.el);
  };
  $('#add-prod').onclick = () => edit();
  $$('[data-stock]', box).forEach((b) => (b.onclick = async (ev) => {
    ev.stopPropagation();
    const p = d.products.find((x) => x.id === Number(b.dataset.stock));
    const h = await api(`/nuvolve/app/api/products/${p.id}/stock`);
    modal(`${p.name} stock`, `
      <p>On hand: <b>${h.on_hand} ${esc(p.unit)}</b>${p.tracked ? '' : ' <span class="small muted">(start tracking by logging a purchase or a shelf count)</span>'}</p>
      <div class="row"><div class="field"><label>What happened</label><select name="reason"><option value="purchase">Bought more</option><option value="count">Shelf count (set the amount on hand)</option></select></div>
        <div class="field"><label>Amount</label><input name="qty" type="number" step="0.01" min="0"></div>
        <div class="field"><label>Unit</label><select name="unit">${UNITS.map((u) => `<option ${u === p.unit ? 'selected' : ''}>${u}</option>`).join('')}</select></div></div>
      <div class="row"><div class="field"><label>Note</label><input name="note" placeholder="Invoice #, supplier..."></div>
        <div class="field"><label>Warn me below (${esc(p.unit)})</label><input name="low_stock" type="number" step="0.01" min="0" value="${p.low_stock ?? ''}"></div></div>
      <div class="hint">This adds to or counts the warehouse. Every product a tech logs on a ticket comes off their truck automatically, converted to ${esc(p.unit)}. Trucks and transfers are on the <a href="#/inventory">Inventory</a> page.</div>
      ${h.moves.length ? `<div class="table-wrap" style="max-height:220px;overflow:auto;margin-top:10px"><table class="list small"><tbody>${h.moves.map((m) => `<tr><td>${fmtDate(m.created_at)}</td>
        <td>${m.reason === 'use' ? `Used${m.visit_date ? ` on ${fmtDate(m.visit_date)}` : ''}` : m.reason === 'count' ? 'Shelf count' : m.reason === 'transfer' ? 'Moved' : 'Bought'}${m.place_name ? ` · ${esc(m.place_name)}` : ''}${m.user_name ? ` · ${esc(m.user_name)}` : ''}${m.note ? ` · ${esc(m.note)}` : ''}</td>
        <td class="right">${m.qty > 0 ? '+' : ''}${m.qty} ${esc(p.unit)}</td></tr>`).join('')}</tbody></table></div>` : ''}`,
    [{ label: 'Close' }, { label: 'Save', cls: 'primary', onClick: async (m) => {
      const body = formData(m);
      if (body.qty === '' && body.low_stock === String(p.low_stock ?? '')) throw new Error('Enter an amount');
      const r = await api(`/nuvolve/app/api/products/${p.id}/stock`, { body });
      toast(`${r.on_hand} ${p.unit} on hand`);
      route();
    } }]);
  }));
  $$('[data-prod]', box).forEach((tr) => (tr.onclick = () => edit(d.products.find((p) => p.id === Number(tr.dataset.prod)))));
}

function settingsFollowup(box, d) {
  const s = d.settings;
  box.innerHTML = `<form class="card" id="comms" style="max-width:720px">
    <h2>Customer follow-up</h2>
    <label class="check"><input type="checkbox" name="reminders_enabled" ${s.reminders_enabled !== '0' ? 'checked' : ''}> Send payment reminders automatically</label>
    <div class="field" style="margin-top:8px"><label>Remind on these days after the due date</label><input name="reminder_days" value="${esc(s.reminder_days ?? '0,7,14,30')}"><div class="hint">0 = on the due date. Customers on autopay are never reminded.</div></div>
    <label class="check"><input type="checkbox" name="appointment_reminders" ${s.appointment_reminders !== '0' ? 'checked' : ''}> Remind customers the day before their visit</label>
    <label class="check"><input type="checkbox" name="review_requests_enabled" ${s.review_requests_enabled !== '0' ? 'checked' : ''}> Ask for a rating after every stop</label>
    <div class="field" style="margin-top:8px"><label>Your Google review link</label><input name="google_review_url" value="${esc(s.google_review_url || '')}" placeholder="https://g.page/r/.../review">
      <div class="hint">In Google Business Profile, click "Ask for reviews" and paste the link. 5-star customers get sent here.</div></div>
    <label class="check"><input type="checkbox" name="tips_enabled" ${s.tips_enabled !== '0' ? 'checked' : ''}> Let customers add a tip when they pay</label>
    <label class="check"><input type="checkbox" name="sms_enabled" ${s.sms_enabled === '1' ? 'checked' : ''}> Also send texts (needs Twilio)</label>
    <button class="btn primary" style="margin-top:12px">Save follow-up settings</button>
  </form>`;
  $('#comms').onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    for (const k of ['reminders_enabled', 'appointment_reminders', 'review_requests_enabled', 'tips_enabled', 'sms_enabled']) f[k] = f[k] ? '1' : '0';
    try { await api('/nuvolve/app/api/settings', { method: 'PUT', body: f }); await refreshBoot(); toast('Saved'); } catch (err) { toast(err.message, true); }
  };
}

function settingsPayments(box, d) {
  box.innerHTML = `<div class="grid cols-2">
    <div class="card">
      <h2>Your Nuvolve plan</h2>
      <p>${{ trialing: `Free trial · ${Math.max(0, BOOT.company.daysLeft)} days left`, active: '✅ Subscribed', past_due: '⚠️ Payment failed', canceled: 'Canceled' }[BOOT.company.status]}</p>
      <p class="small muted">${money(BOOT.company.pricePerRoute)}/month per route (tech who runs a route). You have ${BOOT.company.routes}. Office users are free and unlimited.</p>
      <div class="actions">${BOOT.company.status === 'active' || BOOT.company.status === 'past_due' ? '<button class="btn" id="manage">Update card or cancel</button>' : '<button class="btn primary" id="sub2">Subscribe</button>'}</div>
    </div>
    <form class="card" id="cards">
      <h2>Card payments from your customers</h2>
      ${d.stripeEnabled ? '<div class="alert ok">✅ Your Stripe account is connected. Customers can pay by card and save cards for autopay.</div>'
        : '<div class="alert info">Demo mode: everything works but no money moves. When you are ready, money goes straight to <b>your own</b> Stripe account: create one free at <a href="https://dashboard.stripe.com/register" target="_blank">stripe.com</a>, then paste your secret key below (Developers → API keys).</div>'}
      <div class="field"><label>Stripe secret key</label><input name="stripe_secret_key" type="password" autocomplete="off" placeholder="${d.settings.stripe_key_set ? '•••••••• saved (type a new one to replace, or remove)' : 'sk_live_...'}"></div>
      <button class="btn primary">Save key</button>
    </form></div>`;
  if ($('#sub2')) $('#sub2').onclick = subscribe;
  if ($('#manage')) $('#manage').onclick = async () => { try { location.href = (await api('/nuvolve/app/api/billing/manage', { method: 'POST' })).url; } catch (e) { toast(e.message, true); } };
  $('#cards').onsubmit = async (e) => {
    e.preventDefault();
    const k = e.target.stripe_secret_key.value.trim();
    if (!k) return toast('Paste your key first', true);
    try { await api('/nuvolve/app/api/settings', { method: 'PUT', body: { stripe_secret_key: k } }); await refreshBoot(); toast(k === 'remove' ? 'Key removed' : 'Stripe connected'); route(); } catch (err) { toast(err.message, true); }
  };
}

function settingsData(box, d) {
  box.innerHTML = `<div class="grid cols-2">
    <div class="card">
      <h2>Move your customers in</h2>
      <p>Coming from FieldRoutes, GorillaDesk, PestPac or a spreadsheet? <a class="btn sm primary" href="#/switch">Switch to Nuvolve</a></p>
      <p class="small muted">It brings plans, service history, chemical records and balances, lets you check every column first, and can be undone. For a quick list of names only, the simple import below still works.</p>
      <p class="small muted">Export customers from GorillaDesk, FieldRoutes, PestPac, QuickBooks, or a spreadsheet as CSV. We match columns like name, phone, email, address, city, state, zip and notes. Add <b>service</b>, <b>frequency</b>, <b>price</b> and <b>next service</b> columns and their plans and schedule come over too.</p>
      ${d.locations.length > 1 ? `<div class="field"><label>Into branch</label><select id="csv-loc">${d.locations.filter((l) => l.active).map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></div>` : ''}
      <div class="actions"><input type="file" id="csv" accept=".csv,text/csv" style="width:auto"><button class="btn primary" id="import">Import</button></div>
      <p class="small muted" style="margin-top:10px">Buying another company's accounts? Use <a href="#/acquisitions">Acquisitions</a> instead. It keeps their full history and catches duplicates.</p>
    </div>
    <div class="card">
      <h2>Take your data with you</h2>
      <p class="small muted">Your data is yours. Download it any time.</p>
      <div class="actions"><a class="btn sm" href="/nuvolve/app/api/export/customers">Customers, plans and next service (CSV)</a><a class="btn sm" href="/nuvolve/app/api/merge/export">Everything, with full history (Nuvolve file)</a></div>
    </div></div>`;
  $('#import').onclick = async () => {
    const file = $('#csv').files[0];
    if (!file) return toast('Pick a CSV file first', true);
    try {
      const r = await api(`/nuvolve/app/api/import/customers?location_id=${$('#csv-loc')?.value || ''}`, { body: { csv: await file.text() } });
      toast(`Imported ${r.created} customers${r.plans ? ` and ${r.plans} service plans` : ''}.`);
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- API & integrations ----------
// Keys for Zapier and other systems, and webhooks that push events out. A key or secret is shown once.
const DELIVERY_PILL = { delivered: 'green', pending: 'yellow', failed: 'red' };
const whenShort = (t) => (t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

function showSecretOnce(title, label, value, note) {
  const m = modal(title, `<p>${note}</p><div class="field"><label>${esc(label)}</label><div class="copy-row"><input readonly class="mono" value="${esc(value)}"><button type="button" class="btn sm primary" id="copy-secret">Copy</button></div></div>
    <div class="alert warn">You won't see this again. Store it somewhere safe, like a password manager.</div>`, [{ label: 'Done', cls: 'primary' }]);
  $('#copy-secret', m.el).onclick = () => copyText(value, 'Copied');
}

async function settingsIntegrations(box, d) {
  const x = await api('/nuvolve/app/api/integrations');
  const branchName = (id) => d.locations.find((l) => l.id === id)?.name || '';
  const liveKeys = x.keys.filter((k) => !k.revoked_at);
  box.innerHTML = `<div class="grid cols-2">
    <div class="card">
      <h2>Connect Zapier</h2>
      <p class="small muted">Send new leads from your website or Facebook ads into Nuvolve, add finished visits to a Google Sheet, post 5-star jobs to Slack, or copy payments into your accounting app. Thousands of apps, no code.</p>
      <ol class="small"><li>Make a key below with <b>Zapier</b> access and copy it.</li><li>In Zapier, search for <b>Nuvolve</b> and paste the key when it asks.</li><li>Pick a trigger (like <i>Visit completed</i>) or an action (like <i>Create lead</i>).</li></ol>
    </div>
    <div class="card">
      <h2>Build your own</h2>
      <p class="small muted">For your developer, a data warehouse, or the company that buys you. Every key belongs to your company only, does only what you allow, and can be held to one branch.</p>
      <div class="field"><label>API address</label><div class="copy-row"><input readonly class="mono" value="${esc(x.base_url)}"><button type="button" class="btn sm" id="copy-base">Copy</button></div></div>
      <div class="actions"><a class="btn sm" href="/nuvolve/app/developers" target="_blank" rel="noopener">API documentation</a><a class="btn sm" href="/nuvolve/app/api/v1/openapi.json" target="_blank" rel="noopener">OpenAPI file</a></div>
    </div></div>

  <div class="card">
    <div class="card-head"><div><h2>API keys</h2><div class="small muted">${liveKeys.length} active. Turn a key off the moment you stop using a tool; it stops working right away.</div></div>
      <button class="btn primary" id="new-key">+ New key</button></div>
    ${x.keys.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Key</th><th>Can</th><th>Branch</th><th>Last used</th><th></th></tr></thead><tbody>
      ${x.keys.map((k) => `<tr class="${k.revoked_at ? 'muted' : ''}"><td><b>${esc(k.name)}</b><div class="small muted">Made ${fmtDate(k.created_at.slice(0, 10))}</div></td>
        <td class="mono small">${esc(k.prefix)}…</td>
        <td class="small">${k.scopes.length === Object.keys(x.scopes).length ? 'Everything' : esc(k.scopes.join(', '))}</td>
        <td class="small">${k.branch_id ? esc(branchName(k.branch_id)) : 'All'}</td>
        <td class="small">${k.revoked_at ? `Turned off ${whenShort(k.revoked_at)}` : k.last_used_at ? whenShort(k.last_used_at) : 'Never'}</td>
        <td class="right">${k.revoked_at ? '' : `<button class="btn sm danger" data-revoke="${k.id}">Turn off</button>`}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">No keys yet.</p>'}
  </div>

  <div class="card">
    <div class="card-head"><div><h2>Webhooks</h2><div class="small muted">We send each event to these addresses the moment it happens, signed so the receiver knows it came from you. Zapier adds its own here when you turn a Zap on.</div></div>
      <button class="btn" id="new-hook">+ Add webhook</button></div>
    ${x.webhooks.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Sends to</th><th>Events</th><th>Status</th><th></th></tr></thead><tbody>
      ${x.webhooks.map((w) => `<tr><td><div class="mono small" style="word-break:break-all">${esc(w.url)}</div><div class="small muted">${esc(w.description || '')}${w.key_name ? `${w.description ? ' · ' : ''}Made by key “${esc(w.key_name)}”` : ''}</div></td>
        <td class="small">${w.events.includes('*') ? 'Every event' : esc(w.events.join(', '))}</td>
        <td class="small">${w.active ? '<span class="pill green">On</span>' : '<span class="pill red">Off</span>'}${w.disabled_reason ? `<div class="small muted">${esc(w.disabled_reason)}</div>` : ''}
          ${w.last_delivered ? `<div class="small muted">Last sent ${whenShort(w.last_delivered)}</div>` : ''}${w.failed ? `<div class="small" style="color:var(--danger)">${w.failed} gave up</div>` : ''}</td>
        <td class="right nowrap"><button class="btn sm" data-log="${w.id}">History</button> <button class="btn sm" data-test="${w.id}">Send test</button>
          <button class="btn sm" data-toggle="${w.id}" data-on="${w.active ? 1 : 0}">${w.active ? 'Pause' : 'Turn on'}</button> <button class="btn sm" data-secret="${w.id}">New secret</button>
          <button class="btn sm danger" data-del="${w.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">No webhooks yet.</p>'}
  </div>`;

  $('#copy-base', box).onclick = () => copyText(x.base_url, 'Copied');
  $('#new-key', box).onclick = () => {
    const m = modal('New API key', `<form id="kf">
      <div class="field"><label>Name</label><input name="name" placeholder="Zapier, Data warehouse, Website form…" required></div>
      <div class="field"><label>Access</label><select name="preset" id="kpreset"><option value="zapier">Zapier (everything Zapier needs)</option><option value="read">Read only (reports, warehouse)</option><option value="">Pick permissions…</option></select></div>
      <div id="kscopes" hidden>${Object.entries(x.scopes).map(([k, label]) => `<label class="check"><input type="checkbox" name="scope" value="${k}"> <b class="mono small">${k}</b> <span class="small muted">${esc(label)}</span></label>`).join('')}</div>
      ${d.locations.filter((l) => l.active).length > 1 ? `<div class="field"><label>Branch</label><select name="branch_id"><option value="">Every branch</option>${d.locations.filter((l) => l.active).map((l) => `<option value="${l.id}">Only ${esc(l.name)}</option>`).join('')}</select></div>` : ''}
    </form>`, [{ label: 'Cancel' }, { label: 'Make key', cls: 'primary', onClick: async (el) => {
      const f = $('#kf', el);
      const body = { name: f.name.value, preset: f.preset.value || undefined, branch_id: f.branch_id?.value || null };
      if (!body.preset) body.scopes = $$('[name=scope]:checked', f).map((c) => c.value);
      const k = await api('/nuvolve/app/api/integrations/keys', { body });
      showSecretOnce('Your new API key', 'API key', k.key, `Paste this into Zapier or give it to your developer. It works for <b>${esc(BOOT.company.name)}</b>${k.branch_id ? ` (${esc(branchName(k.branch_id))} only)` : ''}.`);
      route();
    } }]);
    $('#kpreset', m.el).onchange = (e) => { $('#kscopes', m.el).hidden = Boolean(e.target.value); };
  };
  $$('[data-revoke]', box).forEach((b) => (b.onclick = () => modal('Turn off this key?', '<p>Anything using it stops working right away, and the webhooks it made stop sending. This cannot be undone; you can always make a new key.</p>',
    [{ label: 'Cancel' }, { label: 'Turn off', cls: 'danger', onClick: async () => { await api(`/nuvolve/app/api/integrations/keys/${b.dataset.revoke}`, { method: 'DELETE' }); toast('Key turned off'); route(); } }])));

  $('#new-hook', box).onclick = () => {
    modal('Add a webhook', `<form id="hf">
      <div class="field"><label>Send to (https address)</label><input name="url" placeholder="https://..." required></div>
      <div class="field"><label>Label</label><input name="description" placeholder="Accounting sync"></div>
      <label class="check"><input type="checkbox" name="all" checked id="hall"> Every event</label>
      <div id="hevents" hidden>${Object.entries(x.events).map(([k, e]) => `<label class="check"><input type="checkbox" name="event" value="${k}"> <b class="mono small">${k}</b> <span class="small muted">${esc(e.label)}</span></label>`).join('')}</div>
    </form>`, [{ label: 'Cancel' }, { label: 'Add', cls: 'primary', onClick: async (el) => {
      const f = $('#hf', el);
      const events = f.all.checked ? ['*'] : $$('[name=event]:checked', f).map((c) => c.value);
      const w = await api('/nuvolve/app/api/integrations/webhooks', { body: { url: f.url.value, description: f.description.value, events } });
      showSecretOnce('Webhook added', 'Signing secret', w.secret, 'Every delivery has a <code>Nuvolve-Signature</code> header made with this secret. Your receiver should check it. See the API documentation for how.');
      route();
    } }]);
    $('#hall').onchange = (e) => { $('#hevents').hidden = e.target.checked; };
  };
  $$('[data-test]', box).forEach((b) => (b.onclick = async () => { try { await api(`/nuvolve/app/api/integrations/webhooks/${b.dataset.test}/test`, { method: 'POST' }); toast('Test sent. Check History in a few seconds.'); } catch (e) { toast(e.message, true); } }));
  $$('[data-toggle]', box).forEach((b) => (b.onclick = async () => {
    try { await api(`/nuvolve/app/api/integrations/webhooks/${b.dataset.toggle}`, { method: 'PUT', body: { active: b.dataset.on !== '1' } }); route(); } catch (e) { toast(e.message, true); }
  }));
  $$('[data-secret]', box).forEach((b) => (b.onclick = () => modal('Make a new signing secret?', '<p>The old secret stops working right away. Update your receiver with the new one.</p>',
    [{ label: 'Cancel' }, { label: 'Make new secret', cls: 'primary', onClick: async () => {
      const r = await api(`/nuvolve/app/api/integrations/webhooks/${b.dataset.secret}/secret`, { method: 'POST' });
      showSecretOnce('New signing secret', 'Signing secret', r.secret, 'Put this in your receiver in place of the old one.');
    } }])));
  $$('[data-del]', box).forEach((b) => (b.onclick = () => modal('Delete this webhook?', '<p>Events stop going to this address. If Zapier made it, turn the Zap off in Zapier too.</p>',
    [{ label: 'Cancel' }, { label: 'Delete', cls: 'danger', onClick: async () => { await api(`/nuvolve/app/api/integrations/webhooks/${b.dataset.del}`, { method: 'DELETE' }); toast('Deleted'); route(); } }])));
  $$('[data-log]', box).forEach((b) => (b.onclick = async () => {
    const rows = await api(`/nuvolve/app/api/integrations/webhooks/${b.dataset.log}/deliveries`);
    const m = modal('Delivery history', rows.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>When</th><th>Event</th><th>Result</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="small nowrap">${whenShort(r.created_at)}</td><td class="mono small">${esc(r.event)}</td>
        <td class="small"><span class="pill ${DELIVERY_PILL[r.status]}">${r.status}</span> ${r.attempts > 1 ? `${r.attempts} tries` : ''}
          ${r.error ? `<div class="small muted">${esc(r.error)}${r.status === 'pending' ? ` · next try ${whenShort(r.next_attempt_at)}` : ''}</div>` : ''}</td>
        <td class="right">${r.status === 'failed' ? `<button class="btn sm" data-retry="${r.id}">Retry</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">Nothing sent yet.</p>', [{ label: 'Close' }]);
    $$('[data-retry]', m.el).forEach((r) => (r.onclick = async () => { await api(`/nuvolve/app/api/integrations/deliveries/${r.dataset.retry}/retry`, { method: 'POST' }); toast('Sending again'); m.close(); }));
  }));
}

async function settingsActivity(box) {
  box.innerHTML = `<div class="card"><div class="card-head"><div><h2>Activity log</h2><div class="small muted">Who changed what: prices, plans, payments, rule overrides, team changes, imports and merges.</div></div>
    <input id="aq" placeholder="Search" style="max-width:240px"></div><div id="alist"></div></div>`;
  const load = async () => {
    const rows = await api(`/nuvolve/app/api/audit?q=${encodeURIComponent($('#aq').value)}`);
    $('#alist').innerHTML = rows.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="nowrap small">${esc(new Date(r.created_at.replace(' ', 'T') + 'Z').toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</td>
        <td class="small">${esc(r.user_name || '')}</td>
        <td class="small"><b>${esc(r.action.replace(/_/g, ' '))}</b> ${esc(r.entity || '')}${r.entity === 'customer' && r.entity_id ? ` <a href="#/customers/${r.entity_id}">#${r.entity_id}</a>` : ''}</td>
        <td class="small">${esc(r.detail || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nothing yet.</p>';
  };
  let t;
  $('#aq').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  await load();
}

// ---------- Insights ----------
async function pageInsights(view, _id, params = {}) {
  const period = params.period || 'month';
  const d = await api(`/nuvolve/app/api/insights?period=${period}`);
  const k = d.kpis;
  const maxTrend = Math.max(1, ...d.trend.map((t) => Math.max(t.billed, t.collected)));
  const crownCell = (t) => t.crowns.map((c) => `<span class="pill green" style="margin:1px">${esc(c)}</span>`).join('');
  view.innerHTML = `
    <div class="page-head"><div><h1>Insights</h1><div class="muted">${fmtDate(d.from)} to ${fmtDate(d.to)}${d.location ? ' · ' + esc(branchName(d.location)) : multiBranch() ? ' · All branches' : ''}</div></div>
      <div class="actions"><select id="period">${[['month', 'This month'], ['last_month', 'Last month'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['year', 'This year'], ['12m', 'Last 12 months']].map(([v, l]) => `<option value="${v}" ${v === period ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>

    <div class="stats">
      <div class="stat"><div class="label">Recurring revenue, yearly</div><div class="value">${money(k.recurringValue)}</div><div class="sub">${k.recurringAccounts} accounts on a plan</div></div>
      <div class="stat"><div class="label">Billed</div><div class="value">${money(k.billed)}</div><div class="sub">${k.invoices} invoices · avg ${money(k.avgTicket)}</div></div>
      <div class="stat"><div class="label">Collected</div><div class="value">${money(k.collected)}</div><div class="sub">+ ${money(k.tips)} tips to techs</div></div>
      <div class="stat ${k.pastDue > 0 ? 'warn' : ''}"><div class="label">Owed to you</div><div class="value">${money(k.openAR)}</div><div class="sub">${money(k.pastDue)} past due · ${k.pastDueAccounts} accounts</div></div>
    </div>
    <div class="stats">
      <div class="stat"><div class="label">Active accounts</div><div class="value">${k.activeAccounts}</div><div class="sub">🏠 ${k.residential} residential · 🏢 ${k.commercial} commercial</div></div>
      <div class="stat"><div class="label">Paid up</div><div class="value">${pct(k.paidUp, k.activeAccounts)}%</div><div class="sub">${k.paidUp} paid up · ${k.owing} owe something</div></div>
      <div class="stat"><div class="label">Serviced in period</div><div class="value">${k.accountsServiced}</div><div class="sub">${k.stops} stops completed</div></div>
      <div class="stat"><div class="label">Won / lost</div><div class="value">+${k.added} / −${k.lost}</div><div class="sub">Next 30 days: ${k.next30.stops} stops, ${money(k.next30.value)}</div></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Technicians</h2><span class="small muted">Minutes on site run from "Start service" to "Complete".</span></div>
      <div class="table-wrap"><table class="list"><thead><tr><th>Tech</th><th class="right">Stops</th><th class="right">Stops/day</th><th class="right">Avg minutes</th><th class="right">Produced</th><th class="right">$/hour on site</th><th class="right">Avg rating</th><th class="right">5★</th><th class="right">Google</th><th class="right">Tips</th><th class="right">Done vs skipped</th><th></th></tr></thead><tbody>
      ${d.techs.map((t) => `<tr><td><span class="dot" style="background:${esc(t.color)}"></span><b>${esc(t.name)}</b>${t.location && multiBranch() ? `<div class="small muted">${esc(t.location)}</div>` : ''}</td>
        <td class="right">${t.stops}</td><td class="right">${t.stopsPerDay}</td><td class="right">${t.avgMinutes ?? '—'}</td><td class="right"><b>${money(t.production)}</b></td>
        <td class="right">${t.perHour != null ? money(t.perHour) : '—'}</td><td class="right">${t.avgRating ?? '—'}</td><td class="right">${t.five}</td><td class="right">${t.google}</td>
        <td class="right">${money(t.tips)}</td><td class="right">${t.completion != null ? t.completion + '%' : '—'}</td><td>${crownCell(t)}</td></tr>`).join('') || '<tr><td colspan="12" class="muted">No techs yet.</td></tr>'}
      </tbody></table></div>
    </div>

    ${d.locations ? `<div class="card"><h2>Branches</h2><div class="table-wrap"><table class="list"><thead><tr><th>Branch</th><th class="right">Accounts</th><th class="right">Recurring / yr</th><th class="right">Billed</th><th class="right">Collected</th><th class="right">Owed</th><th class="right">Past due</th><th class="right">Stops</th><th class="right">Won / lost</th></tr></thead><tbody>
      ${d.locations.map((l) => `<tr class="click" data-branch="${l.id}"><td><b>${esc(l.name)}</b></td><td class="right">${l.activeAccounts}</td><td class="right">${money(l.recurringValue)}</td><td class="right">${money(l.billed)}</td>
        <td class="right">${money(l.collected)}</td><td class="right">${money(l.openAR)}</td><td class="right">${money(l.pastDue)}</td><td class="right">${l.stops}</td><td class="right">+${l.added} / −${l.lost}</td></tr>`).join('')}
    </tbody></table></div><p class="small muted">Click a branch to look at just that branch.</p></div>` : ''}

    <div class="grid cols-2">
      <div class="card"><h2>Collected by month</h2>
        <div class="bars" role="img" aria-label="Money collected each month for the last 12 months">${d.trend.map((t) => `<div class="bar" tabindex="0" title="${t.month}: collected ${money(t.collected)}, billed ${money(t.billed)}">
          <div class="fill" style="height:${Math.max(2, (t.collected / maxTrend) * 100)}%"></div><div class="lbl">${new Date(t.month + '-15').toLocaleDateString('en-US', { month: 'short' })}</div></div>`).join('')}</div>
        <details style="margin-top:10px"><summary class="small">Show as a table</summary><table class="list small"><thead><tr><th>Month</th><th class="right">Billed</th><th class="right">Collected</th></tr></thead><tbody>
          ${d.trend.map((t) => `<tr><td>${t.month}</td><td class="right">${money(t.billed)}</td><td class="right">${money(t.collected)}</td></tr>`).join('')}</tbody></table></details>
      </div>
      <div class="card"><h2>What's being serviced</h2>
        <table class="list"><thead><tr><th>Service</th><th class="right">Active plans</th><th class="right">Yearly value</th></tr></thead><tbody>
        ${d.services.map((s) => `<tr><td>${esc(s.name)}</td><td class="right">${s.plans}</td><td class="right">${money(s.yearly)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No plans yet.</td></tr>'}</tbody></table>
      </div>
    </div>`;
  $('#period').onchange = (e) => (location.hash = `#/insights?period=${e.target.value}`);
  $$('[data-branch]', view).forEach((tr) => (tr.onclick = async () => {
    try { localStorage.setItem('nv_loc', tr.dataset.branch); } catch { /* private mode */ }
    await refreshBoot(); renderShell(); route();
  }));
}

// ---------- Acquisitions ----------
async function pageAcquisitions(view) {
  const [merges, codes, d] = await Promise.all([api('/nuvolve/app/api/merges'), api('/nuvolve/app/api/merge/codes'), api('/nuvolve/app/api/settings')]);
  view.innerHTML = `
    <div class="page-head"><div><h1>Acquisitions</h1><div class="muted">Buy a route and bring every account over in minutes, with history, plans, balances and the schedule intact. Or get your own book ready to sell.</div></div></div>
    <div class="grid cols-2">
      <div class="card">
        <h2>🤝 Buying: bring accounts in</h2>
        <ol class="steps"><li>Get the seller's transfer code (if they're on Nuvolve) or their Nuvolve file. On another system? Use <a href="#/switch">Switch to Nuvolve</a>.</li>
          <li>Preview: see accounts, recurring revenue, balances, duplicates and out-of-area addresses before anything changes.</li>
          <li>Import into an existing branch or a new one. One click undoes it.</li></ol>
        <div class="field"><label>Seller's transfer code</label><input id="code" placeholder="NUV-XXXXX-XXXXX"></div>
        <div class="field"><label>Or their Nuvolve file</label><input type="file" id="pkg" accept=".json,application/json"></div>
        <button class="btn primary" id="preview">Preview the deal</button>
      </div>
      <div class="card">
        <h2>💼 Selling: get your book ready</h2>
        <p class="small muted">Give a buyer a one-time code (good for 14 days), or download the full file for their due diligence. Nothing changes in your account.</p>
        ${d.locations.length > 1 ? `<div class="field"><label>What's for sale</label><select id="sell-loc"><option value="">Everything</option>${d.locations.map((l) => `<option value="${l.id}">Only ${esc(l.name)}</option>`).join('')}</select></div>` : ''}
        <div class="actions"><button class="btn primary" id="mkcode">Create transfer code</button><button class="btn" id="dl">Download file</button></div>
        ${codes.length ? `<table class="list small" style="margin-top:12px"><tbody>${codes.map((c) => `<tr><td><code>${esc(c.code)}</code></td><td>${c.used_at ? `Used ${fmtDate(c.used_at)}` : `Expires ${fmtDate(c.expires_at)}`}</td></tr>`).join('')}</tbody></table>` : ''}
      </div>
    </div>
    <div id="pv"></div>
    <div class="card"><h2>Past imports</h2>${merges.length ? `<table class="list"><thead><tr><th>Seller</th><th>Branch</th><th>When</th><th>Brought in</th><th></th></tr></thead><tbody>
      ${merges.map((m) => `<tr class="${m.undone_at ? 'muted' : ''}"><td><b>${esc(m.seller_name)}</b><div class="small muted">by ${esc(m.source)}</div></td><td>${esc(m.location || '')}</td><td class="small">${fmtDate(m.created_at)}</td>
        <td class="small">${m.counts ? `${m.counts.added} new, ${m.counts.merged} merged, ${m.counts.plans} plans, ${m.counts.visits} visits` : ''}</td>
        <td class="right">${m.undone_at ? '<span class="pill">Undone</span>' : `<button class="btn sm" data-undo="${m.id}">Undo</button>`}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No imports yet.</p>'}</div>`;

  let source = null;
  const readSource = async () => {
    const code = $('#code').value.trim();
    if (code) return { code };
    const file = $('#pkg').files[0];
    if (!file) throw new Error('Enter a transfer code or pick the seller file');
    return { package: JSON.parse(await file.text()) };
  };
  $('#preview').onclick = async () => {
    try {
      source = await readSource();
      showPreview(await api('/nuvolve/app/api/merge/preview', { body: source }));
    } catch (e) { toast(e.message, true); }
  };
  const sellLoc = () => $('#sell-loc')?.value || '';
  $('#mkcode').onclick = async () => {
    const r = await api('/nuvolve/app/api/merge/code', { body: { location_id: sellLoc() } });
    modal('Transfer code', `<p>Give this to the buyer. It works once and expires in ${r.expires_in_days} days.</p><p style="font-size:24px;text-align:center"><code>${esc(r.code)}</code></p>`, [{ label: 'Done', cls: 'primary', onClick: () => route() }]);
  };
  $('#dl').onclick = () => { location.href = `/nuvolve/app/api/merge/export?location_id=${sellLoc()}`; };
  $$('[data-undo]', view).forEach((b) => (b.onclick = () => modal('Undo this import?', '<p>Every account, plan, visit, invoice and payment this import created is removed. Customers that were merged into your existing accounts stay, minus the imported history.</p>',
    [{ label: 'Cancel' }, { label: 'Undo import', cls: 'primary', onClick: async () => { await api(`/nuvolve/app/api/merges/${b.dataset.undo}/undo`, { method: 'POST' }); toast('Import undone'); route(); } }])));

  function showPreview(p) {
    const c = p.counts;
    const mapRow = (kind, x, mine) => `<tr><td>${esc(x.name)}${x.epa_reg ? ` <span class="small muted">EPA ${esc(x.epa_reg)}</span>` : ''}${x.email ? ` <span class="small muted">${esc(x.email)}</span>` : ''}</td>
      <td><select data-map="${kind}" data-id="${x.seller_id}"><option value="create">Add as new</option>${mine.map((m) => `<option value="${m.id}" ${x.to === m.id ? 'selected' : ''}>Use my ${esc(m.name)}</option>`).join('')}</select></td></tr>`;
    $('#pv').innerHTML = `<div class="card preview">
      <div class="card-head"><div><h2>Deal preview: ${esc(p.seller?.name || 'Seller')}</h2><div class="small muted">Exported ${fmtDate(p.exported_at)}. Nothing has changed yet.</div></div></div>
      ${p.alreadyImported ? `<div class="alert warn">This exact package was already imported on ${fmtDate(p.alreadyImported.created_at)}. Undo that import first to bring it in again.</div>` : ''}
      <div class="stats">
        <div class="stat"><div class="label">Accounts</div><div class="value">${c.customers}</div><div class="sub">${c.activeCustomers} active · ${c.commercial} commercial</div></div>
        <div class="stat"><div class="label">Recurring revenue, yearly</div><div class="value">${money(c.recurringValue)}</div><div class="sub">${c.activePlans} active plans${c.signedAgreements ? ` · ${c.signedAgreements} signed agreements` : ''}${c.termiteContracts ? ` · ${c.termiteContracts} termite warranties` : ''}${c.stations ? ` · ${c.stations} stations` : ''}</div></div>
        <div class="stat"><div class="label">Schedule coming over</div><div class="value">${c.upcomingVisits}</div><div class="sub">upcoming visits · ${c.pastVisits} past visits of history</div></div>
        <div class="stat ${c.openBalance > 0 ? 'warn' : ''}"><div class="label">Open balances</div><div class="value">${money(c.openBalance)}</div><div class="sub">${c.cardsOnFile} cards on file (customers re-enter for autopay)</div></div>
      </div>
      ${p.duplicates.length ? `<div class="alert warn" style="display:block"><b>${p.duplicates.length} of these are already your customers.</b>
        <details><summary class="small">See them</summary><table class="list small">${p.duplicates.map((x) => `<tr><td>${esc(x.seller_name)}</td><td>→ <a href="#/customers/${x.buyer_id}" target="_blank">${esc(x.buyer_name)}</a></td><td>${esc(x.reason)}</td></tr>`).join('')}</table></details></div>` : '<div class="alert ok">No duplicates with your current customers.</div>'}
      <div class="row">
        <div class="field"><label>Put these accounts in</label><select id="tloc">${d.locations.filter((l) => l.active).map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}<option value="new">A new branch...</option></select></div>
        <div class="field hidden" id="newloc"><label>New branch name</label><input id="newname" value="${esc(p.seller?.name || '')}"></div>
        <div class="field"><label>Duplicates</label><select id="dups"><option value="merge">Merge into my existing account (recommended)</option><option value="skip">Skip them</option><option value="separate">Bring them in as separate accounts</option></select></div>
      </div>
      ${c.outOfArea ? `<p class="small" style="color:var(--warn)">⚠️ ${c.outOfArea} addresses are outside the chosen branch's service area.</p>` : ''}
      <details><summary><b>Match services, products and techs</b> <span class="small muted">(we matched what we could)</span></summary>
        <div class="grid cols-3" style="margin-top:10px">
          <div><h3>Services</h3><table class="list small">${p.maps.services.map((x) => mapRow('services', x, d.serviceTypes)).join('')}</table></div>
          <div><h3>Products</h3><table class="list small">${p.maps.products.map((x) => mapRow('products', x, d.products)).join('')}</table></div>
          <div><h3>Technicians</h3><table class="list small">${p.maps.techs.map((x) => mapRow('techs', x, d.users.filter((u) => u.active && u.runs_routes))).join('') || '<tr><td class="muted">None</td></tr>'}</table>
            <p class="small muted">New techs come over without a login. Give them one in Team if they stay on.</p></div>
        </div></details>
      <div class="actions" style="margin-top:14px;justify-content:flex-end"><button class="btn primary big" id="commit" ${p.alreadyImported ? 'disabled' : ''}>Import ${c.customers} accounts</button></div>
    </div>`;
    $('#tloc').onchange = (e) => $('#newloc').classList.toggle('hidden', e.target.value !== 'new');
    $('#commit').onclick = async (e) => {
      const maps = { services: {}, products: {}, techs: {} };
      $$('[data-map]').forEach((s) => { maps[s.dataset.map][s.dataset.id] = s.value === 'create' ? 'create' : Number(s.value); });
      const isNew = $('#tloc').value === 'new';
      e.target.disabled = true;
      try {
        const r = await api('/nuvolve/app/api/merge/commit', { body: { ...source, location_id: isNew ? null : $('#tloc').value, new_location: isNew ? { name: $('#newname').value } : null, duplicates: $('#dups').value, maps } });
        await refreshBoot();
        modal('Welcome aboard 🎉', `<p><b>${r.counts.added}</b> new accounts and <b>${r.counts.merged}</b> merged into existing ones.</p>
          <p class="small">${r.counts.plans} plans, ${r.counts.visits} visits (${r.counts.futureVisits} upcoming), ${r.counts.invoices} invoices${r.counts.agreements ? `, ${r.counts.agreements} signed agreements` : ''}${r.counts.termiteContracts ? `, ${r.counts.termiteContracts} termite warranties (auto-renew off until a card is on file)` : ''}${r.counts.devices ? `, ${r.counts.devices} stations` : ''}. ${r.counts.new_techs ? `${r.counts.new_techs} techs added.` : ''} ${r.counts.new_services ? `${r.counts.new_services} services added.` : ''}</p>`,
        [{ label: 'See the customers', cls: 'primary', onClick: () => { location.hash = '#/customers'; } }]);
      } catch (err) { toast(err.message, true); e.target.disabled = false; }
    };
    $('#pv').scrollIntoView({ behavior: 'smooth' });
  }
}
