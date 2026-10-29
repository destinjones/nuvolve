// Commercial accounts: every account at a glance, sites on one account, pest sightings, activity trends and the audit binder.

async function pageCommercial(view) {
  const r = await api('/nuvolve/app/api/commercial');
  const attention = r.accounts.filter((a) => a.open_sightings || a.activity_90 > r.threshold);
  // Accounts that need a look come first, then the ones with stations, then by name.
  const needs = (a) => (a.open_sightings || a.activity_90 > r.threshold ? 1 : 0);
  r.accounts.sort((x, y) => needs(y) - needs(x) || y.devices - x.devices || String(x.name).localeCompare(String(y.name)));
  view.innerHTML = `
    <div class="page-head"><h1>Commercial accounts</h1>
      <div class="actions">${BOOT.me.isAdmin ? '<button class="btn" id="binder-settings">Audit binder settings</button>' : ''}<a class="btn primary" href="#/customers/new?type=commercial">+ New commercial account</a></div></div>
    <div class="stats">
      <div class="stat"><div class="label">Accounts</div><div class="value">${r.accounts.length}</div><div class="sub">${r.accounts.reduce((n, a) => n + a.sites, 0)} sites</div></div>
      <div class="stat"><div class="label">Stations and traps</div><div class="value">${r.accounts.reduce((n, a) => n + a.devices, 0)}</div></div>
      <div class="stat ${r.accounts.some((a) => a.open_sightings) ? 'warn' : ''}"><div class="label">Open sightings</div><div class="value">${r.accounts.reduce((n, a) => n + a.open_sightings, 0)}</div></div>
      <div class="stat ${attention.length ? 'warn' : ''}"><div class="label">Need attention</div><div class="value">${attention.length}</div><div class="sub">Open sightings or over ${r.threshold}% activity</div></div>
    </div>
    <div class="card">
      ${r.accounts.length ? `<table class="list"><thead><tr><th>Account</th><th class="right">Sites</th><th class="right">Stations</th><th class="right">Activity (90 days)</th><th class="right">Open sightings</th><th>Last service</th><th></th></tr></thead><tbody>
        ${r.accounts.map((a) => `<tr><td><a href="#/customers/${a.id}"><b>${esc(a.name || 'Customer')}</b></a></td><td class="right">${a.sites}</td><td class="right">${a.devices}</td>
          <td class="right ${a.activity_90 > r.threshold ? 'hot' : ''}">${a.checks_90 ? `${a.activity_90}%` : '<span class="muted">·</span>'}</td>
          <td class="right">${a.open_sightings ? `<span class="pill red">${a.open_sightings}</span>` : '0'}</td><td>${a.last_service ? fmtDate(a.last_service) : '<span class="muted">Never</span>'}</td>
          <td class="right"><a class="btn sm" href="/nuvolve/app/api/customers/${a.id}/audit-binder" target="_blank" rel="noopener">📁 Binder</a></td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">No commercial accounts yet. Mark a customer as Commercial (Edit on their account) and they show up here with their sites, stations and audit binder.</p>'}
    </div>`;
  if ($('#binder-settings')) $('#binder-settings').onclick = binderSettingsModal;
}

async function binderSettingsModal() {
  const s = await api('/nuvolve/app/api/commercial/settings');
  modal('Audit binder settings', `
    <p class="small muted">These print in every customer's audit binder. Auditors ask for proof of insurance and your IPM program first.</p>
    <div class="row"><div class="field"><label>Insurance carrier</label><input name="insurance_carrier" value="${esc(s.insurance_carrier)}"></div>
    <div class="field"><label>Policy number</label><input name="insurance_policy" value="${esc(s.insurance_policy)}"></div></div>
    <div class="row"><div class="field"><label>Insurance expires</label><input name="insurance_expires" type="date" value="${esc(s.insurance_expires)}"></div>
    <div class="field"><label>Action threshold (% of device checks with activity)</label><input name="activity_threshold" type="number" min="1" max="100" value="${esc(s.activity_threshold)}"></div></div>
    <div class="field"><label>IPM program statement</label><textarea name="ipm_statement" rows="5" placeholder="Leave blank for the standard statement">${esc(s.ipm_statement)}</textarea></div>`,
  [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => { await api('/nuvolve/app/api/commercial/settings', { method: 'PUT', body: formData(m) }); toast('Saved'); } }]);
}

function binderModal(c) {
  const sites = c.properties.filter((p) => p.address);
  const year = addDays(todayStr(), -364);
  const m = modal('Audit binder', `
    <p class="small muted">Everything an AIB, SQF or health inspector asks for: certificates, IPM program, approved products with labels, device list, trend analysis, the sighting log, service reports and pesticide records.</p>
    ${sites.length > 1 ? `<div class="field"><label>Site</label><select name="property_id"><option value="">All ${sites.length} sites</option>${sites.map((p) => `<option value="${p.id}">${esc(p.site_name || p.address)}</option>`).join('')}</select></div>` : ''}
    <div class="row"><div class="field"><label>From</label><input name="from" type="date" value="${year}"></div>
    <div class="field"><label>To</label><input name="to" type="date" value="${todayStr()}"></div></div>`,
  [{ label: 'Cancel' }, { label: 'Open binder', cls: 'primary', onClick: (el) => {
    const f = formData(el);
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
    window.open(`/nuvolve/app/api/customers/${c.id}/audit-binder?${q}`, '_blank', 'noopener');
  } }]);
  return m;
}

// Sites, activity trend and the sighting log on a commercial customer's page.
async function commercialCard(box, c, propertyId = '') {
  const r = await api(`/nuvolve/app/api/customers/${c.id}/commercial${propertyId ? `?property_id=${propertyId}` : ''}`);
  const t = r.trends;
  const open = r.sightings.filter((x) => x.status === 'open');
  const multi = r.sites.length > 1;
  box.innerHTML = `
    <div class="card-head"><h2>${multi ? `${r.sites.length} sites` : 'Site'} and pest activity</h2><button class="btn sm" id="c-sight">+ Log sighting</button></div>
    ${r.sites.map((s) => `<div class="site-row"><div><b>${esc(s.site_name || s.address)}</b>${s.site_name ? `<span class="small muted"> · ${esc(s.address)}${s.city ? `, ${esc(s.city)}` : ''}</span>` : ''}
        ${s.site_contact || s.site_phone ? `<div class="small muted">👤 ${esc(s.site_contact || '')}${s.site_phone ? ` · <a href="tel:${esc(s.site_phone)}">${esc(s.site_phone)}</a>` : ''}</div>` : ''}
        <div class="site-stats small"><span class="pill">${s.devices} station${s.devices === 1 ? '' : 's'}</span>
          ${s.checks_90 ? `<span class="pill ${s.activity_90 > t.threshold ? 'red' : 'green'}">${s.activity_90}% activity, 90 days</span>` : ''}
          ${s.open_sightings ? `<span class="pill red">${s.open_sightings} open sighting${s.open_sightings === 1 ? '' : 's'}</span>` : ''}
          <span class="muted">Last ${s.last_service ? fmtDate(s.last_service) : 'never'}${s.next_service ? ` · next ${fmtDay(s.next_service)}` : ''}</span></div></div>
      <div>${multi ? `<button class="btn sm" data-site="${s.id}">${String(s.id) === String(propertyId) ? 'All sites' : 'Trend'}</button>` : ''}</div></div>`).join('')}
    <h3 style="margin-top:16px">Device activity by month${propertyId ? `: ${esc(r.sites.find((s) => String(s.id) === String(propertyId))?.site_name || 'this site')}` : ''}</h3>
    ${t.totals.checks ? `<div class="small muted">${t.totals.checks} checks in the last 12 months, ${t.totals.rate}% with activity. Bars over the dashed line are above your ${t.threshold}% action threshold.</div>
      <div class="trend-wrap">${t.svg}</div>` : '<p class="small muted">No station checks yet. Add stations on the tech\'s ticket and the trend fills in after each service.</p>'}
    ${t.hotspots.length ? `<h3>Hot spots</h3>${t.hotspots.map((h) => `<div class="small"><span class="hot">#${esc(h.number)}</span> ${esc(h.location || '')}${multi ? ` · ${esc(h.site_name || h.address)}` : ''} · activity at ${h.flagged} of ${h.checks} checks${h.caught ? `, ${h.caught} caught` : ''} · last ${fmtDate(h.last_flagged)}</div>`).join('')}` : ''}
    ${t.totals.sightings ? `<h3>Sightings by month</h3><div class="trend-wrap">${t.sightingsSvg}</div>` : ''}
    <h3>Sighting log ${open.length ? `<span class="pill red">${open.length} open</span>` : ''}</h3>
    ${r.sightings.length ? r.sightings.slice(0, 12).map((x) => `<div class="sighting ${x.status === 'open' ? '' : 'done'}"><div><b>${esc(x.pest)}</b>${x.count ? ` (${x.count})` : ''}${x.location ? ` · ${esc(x.location)}` : ''}
        <div class="small muted">${fmtDate(x.seen_at)}${multi ? ` · ${esc(x.site_name || x.address)}` : ''}${x.reported_by ? ` · ${esc(x.reported_by)}` : ''}${x.source === 'customer' ? ' (site staff)' : ''}</div>
        ${x.action_taken ? `<div class="small">✓ ${esc(x.action_taken)}${x.resolved_by ? ` <span class="muted">· ${esc(x.resolved_by)}</span>` : ''}</div>` : ''}</div>
      <div class="actions">${x.status === 'open' ? `<button class="btn sm" data-resolve="${x.id}">Mark handled</button>` : ''}<button class="btn sm" data-delsight="${x.id}" title="Delete">✕</button></div></div>`).join('')
      : '<p class="small muted">No sightings yet. The customer\'s staff can log them from their pay link, and techs see open ones on the stop.</p>'}`;

  const redraw = () => commercialCard(box, c, propertyId);
  $$('[data-site]', box).forEach((b) => (b.onclick = () => commercialCard(box, c, String(b.dataset.site) === String(propertyId) ? '' : b.dataset.site)));
  $('#c-sight', box).onclick = () => sightingModal(r.pests, async (body) => {
    const pid = body.property_id || r.sites[0]?.id;
    if (!pid) throw new Error('Add a service address first');
    await api(`/nuvolve/app/api/properties/${pid}/sightings`, { body });
    toast('Sighting logged');
    redraw();
  }, multi ? `<div class="field"><label>Site</label><select name="property_id">${r.sites.map((s) => `<option value="${s.id}" ${String(s.id) === String(propertyId) ? 'selected' : ''}>${esc(s.site_name || s.address)}</option>`).join('')}</select></div>` : '');
  $$('[data-resolve]', box).forEach((b) => (b.onclick = () => modal('What was done about it?', `
    <div class="field"><label>Corrective action</label><textarea name="action_taken" placeholder="Inspected, baited, sealed entry point, sanitation note to manager"></textarea></div>`,
  [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => { await api(`/nuvolve/app/api/sightings/${b.dataset.resolve}/resolve`, { body: formData(m) }); redraw(); } }])));
  $$('[data-delsight]', box).forEach((b) => (b.onclick = () => modal('Delete this sighting?', '<p>Only delete entries logged by mistake. Auditors expect the log to be complete.</p>',
    [{ label: 'Keep it' }, { label: 'Delete', cls: 'primary', onClick: async () => { await api(`/nuvolve/app/api/sightings/${b.dataset.delsight}`, { method: 'DELETE' }); redraw(); } }])));
}
