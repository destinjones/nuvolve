// Route merge screens: who runs each stop after an acquisition, and handing one tech's route to the team.
// The server plans it (territory zips, nearest tech, fair share, licenses, branch by address); this file
// shows the plan on a map and a table, and lets the office move any stop by hand before saving.
const RouteMerge = (() => {
  let map = null;
  const first = (n) => String(n || '').split(' ')[0];

  function crewCards(plan) {
    const shown = plan.crews.filter((c) => c.added || c.kind === 'seller');
    if (!shown.length) return '<p class="muted small">No stops are moving.</p>';
    return `<div class="rm-crews">${shown.map((c) => `
      <div class="rm-crew ${c.over_limit ? 'over' : ''}">
        <div class="rm-crew-head"><span class="dot" style="background:${esc(c.color)}"></span><b>${esc(c.name)}</b>
          ${c.kind === 'seller' ? '<span class="pill blue">Joining</span>' : c.location ? `<span class="small muted">${esc(c.location)}</span>` : ''}</div>
        <div class="rm-crew-num">${c.before} <span class="muted">→</span> <b>${c.after}</b> <span class="small muted">accounts</span></div>
        <div class="small">+${c.added} accounts · <b>${money(c.added_yearly)}</b>/yr</div>
        ${c.zips.length ? `<div class="small muted">Mostly ${c.zips.map(esc).join(', ')}</div>` : ''}
        ${c.busiest ? `<div class="small ${c.over_limit ? 'rm-bad' : 'muted'}">Busiest day next 30: ${c.busiest.n} stops (${fmtDate(c.busiest.date, { weekday: 'short', month: 'short', day: 'numeric' })})</div>` : ''}
      </div>`).join('')}</div>`;
  }

  function drawMap(el, plan) {
    if (!el) return;
    if (!window.L) { el.innerHTML = '<div class="empty">Map is loading...</div>'; setTimeout(() => window.L && drawMap(el, plan), 800); return; }
    if (map) { try { map.remove(); } catch { /* already gone */ } map = null; }
    const pts = plan.stops.filter((s) => s.lat != null && s.lng != null);
    if (!pts.length) { el.innerHTML = '<div class="empty">None of these addresses have a map pin.</div>'; return; }
    map = L.map(el, { scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    for (const s of pts) {
      L.circleMarker([s.lat, s.lng], { radius: s.override ? 8 : 6, color: s.warning ? '#c53030' : '#fff', weight: s.warning ? 3 : 1.5, fillColor: s.to_color || '#a0aec0', fillOpacity: 0.9 })
        .addTo(map).bindPopup(`<b>${esc(s.name)}</b><br>${esc(s.address)} ${esc(s.zip)}<br>→ <b>${esc(s.to_name || 'No one yet')}</b><br><span style="color:#5f6b7a">${esc(s.reason)}</span>`);
    }
    map.fitBounds(L.latLngBounds(pts.map((s) => [s.lat, s.lng])), { padding: [20, 20] });
  }

  // box: where to draw; plan: from the server; state: { overrides, filter, view } kept by the caller across re-plans.
  function render(box, plan, state, onChange) {
    state.overrides = state.overrides || {};
    const opts = (sel) => `<option value="">No one</option>${plan.choices.map((c) => `<option value="${esc(c.key)}" ${sel === c.key ? 'selected' : ''}>${esc(c.name)}${c.kind === 'seller' ? ' (joining)' : ''}</option>`).join('')}`;
    const moved = Object.keys(state.overrides).length;
    box.innerHTML = `
      ${plan.warnings.map((w) => `<div class="alert warn">⚠️ ${esc(w)}</div>`).join('')}
      ${crewCards(plan)}
      <div class="rm-map" id="rm-map"></div>
      <div class="rm-tools">
        <input id="rm-q" placeholder="Find an account, street or zip" value="${esc(state.filter || '')}">
        <select id="rm-view"><option value="">All ${plan.stops.length} accounts</option><option value="warn" ${state.view === 'warn' ? 'selected' : ''}>Needs a look</option>
          <option value="hand" ${state.view === 'hand' ? 'selected' : ''}>Moved by hand (${moved})</option>
          ${plan.choices.map((c) => `<option value="${esc(c.key)}" ${state.view === c.key ? 'selected' : ''}>Going to ${esc(c.name)}</option>`).join('')}</select>
        <span class="rm-bulk"><select id="rm-bulk-to">${opts('')}</select><button class="btn sm" id="rm-bulk">Move checked</button></span>
        ${moved ? '<button class="btn sm" id="rm-reset">Undo hand moves</button>' : ''}
      </div>
      <div class="table-wrap rm-table"><table class="list small"><thead><tr><th><input type="checkbox" id="rm-all"></th><th>Account</th><th>Zip</th><th>Service</th><th>Runs it from now on</th><th>Why</th></tr></thead><tbody id="rm-rows"></tbody></table></div>`;

    const rows = () => {
      const q = (state.filter || '').toLowerCase().trim();
      const list = plan.stops.filter((s) => {
        if (q && !`${s.name} ${s.address} ${s.zip}`.toLowerCase().includes(q)) return false;
        if (state.view === 'warn') return Boolean(s.warning) || !s.to;
        if (state.view === 'hand') return s.override;
        if (state.view) return s.to === state.view;
        return true;
      });
      const cap = 400;
      $('#rm-rows', box).innerHTML = list.slice(0, cap).map((s) => `<tr class="${s.warning || !s.to ? 'rm-warn' : ''}">
        <td><input type="checkbox" data-pick="${esc(s.key)}"></td>
        <td><b>${esc(s.name)}</b><div class="muted">${esc(s.address)}</div></td>
        <td>${esc(s.zip)}${s.location_name ? `<div class="muted">${esc(s.location_name)}</div>` : ''}</td>
        <td>${esc((s.services || []).join(', '))}${s.license ? ` <span class="pill yellow">${esc(s.license)}</span>` : ''}<div class="muted">${money(s.yearly)}/yr${s.next ? ` · next ${fmtDate(s.next, { month: 'short', day: 'numeric' })}` : ''}</div></td>
        <td><span class="dot" style="background:${esc(s.to_color || '#cbd5e0')}"></span><select data-stop="${esc(s.key)}">${opts(s.to || '')}</select></td>
        <td>${esc(s.reason)}${s.warning ? `<div class="rm-bad">${esc(s.warning)}</div>` : ''}</td></tr>`).join('')
        + (list.length > cap ? `<tr><td colspan="6" class="muted">Showing ${cap} of ${list.length}. Search to narrow it down.</td></tr>` : '')
        + (list.length ? '' : '<tr><td colspan="6" class="muted">Nothing matches.</td></tr>');
      $$('[data-stop]', box).forEach((sel) => (sel.onchange = () => {
        if (sel.value) state.overrides[sel.dataset.stop] = sel.value;
        else delete state.overrides[sel.dataset.stop];
        onChange();
      }));
    };
    rows();
    drawMap($('#rm-map', box), plan);
    let t = null;
    $('#rm-q', box).oninput = (e) => { state.filter = e.target.value; clearTimeout(t); t = setTimeout(rows, 150); };
    $('#rm-view', box).onchange = (e) => { state.view = e.target.value; rows(); };
    $('#rm-all', box).onchange = (e) => $$('[data-pick]', box).forEach((c) => (c.checked = e.target.checked));
    $('#rm-bulk', box).onclick = () => {
      const to = $('#rm-bulk-to', box).value;
      const picked = $$('[data-pick]:checked', box).map((c) => c.dataset.pick);
      if (!picked.length) return toast('Check the accounts to move first', true);
      if (!to) return toast('Pick who gets them', true);
      for (const k of picked) state.overrides[k] = to;
      onChange();
    };
    if ($('#rm-reset', box)) $('#rm-reset', box).onclick = () => { state.overrides = {}; onChange(); };
  }

  // The seller-tech choices on the acquisition preview.
  function techChoices(plan, buyerTechs) {
    return `<table class="list small rm-techs"><thead><tr><th>Seller's route</th><th>Accounts</th><th>What happens</th></tr></thead><tbody>
      ${plan.techs.map((t) => `<tr><td><b>${esc(t.name)}</b><div class="muted">${t.zips.length ? `Works ${t.zips.map(esc).join(', ')}` : ''}${t.licenses.length ? ` · Licensed: ${t.licenses.map(esc).join(', ')}` : ''}</div></td>
        <td>${t.stops}<div class="muted">${money(t.yearly)}/yr</div></td>
        <td><select data-tech="${esc(t.key)}">
          ${t.key === 'none' ? '' : `<option value="keep" ${t.choice === 'keep' ? 'selected' : ''}>Keep ${esc(first(t.name))} on this route (joins your team)</option>`}
          <option value="territory" ${t.choice === 'territory' ? 'selected' : ''}>Hand out to my techs by territory</option>
          ${buyerTechs.map((u) => `<option value="b:${u.id}" ${t.choice === `b:${u.id}` ? 'selected' : ''}>Give all to ${esc(u.name)}</option>`).join('')}
        </select></td></tr>`).join('')}</tbody></table>`;
  }

  return { render, techChoices };
})();
