// Dispatch board: every tech on one live map, who's running late, and the same-day reshuffle
// when someone calls out. Refreshes every 30 seconds while open.
let dispatchMap = null;
let dispatchLayer = null;
let dispatchTimer = null;
let dispatchFitted = '';

const DSTATUS = {
  driving: ['blue', 'Driving'], on_site: ['green', 'On site'], idle: ['yellow', 'Stopped'], offline: ['', 'No GPS'],
  done: ['green', 'Done for the day'], no_route: ['', 'No stops'],
};

function techFace(t, size = 40) {
  const initial = esc((t.name || '?').trim()[0] || '?');
  return t.has_photo
    ? `<img src="/nuvolve/app/api/users/${t.id}/photo" alt="" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;border:3px solid ${esc(t.color)}">`
    : `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${esc(t.color)};color:#fff;display:grid;place-items:center;font-weight:700">${initial}</div>`;
}

async function pageDispatch(view, _id, params) {
  const date = params.date || todayStr();
  const d = await api(`/nuvolve/app/api/dispatch?date=${date}`);
  const go = (p) => { location.hash = `#/dispatch?${new URLSearchParams({ date, ...p })}`; };
  const open = d.techs.reduce((n, t) => n + (t.total - t.done), 0);
  const late = d.techs.reduce((n, t) => n + t.late, 0);
  const live = d.techs.filter((t) => t.ping?.fresh).length;

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Dispatch ${d.today ? '<span class="pill green" style="vertical-align:middle">Live</span>' : ''}</h1>
        <div class="muted">${fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric' })} · day runs ${esc(d.day.start)} to ${esc(d.day.end)}
        ${BOOT.me.isAdmin ? '<button class="link-btn" id="hours">Change</button>' : ''}</div></div>
      <div class="actions">
        <button class="btn" id="prev">←</button><input type="date" id="date" value="${date}" style="width:auto"><button class="btn" id="next">→</button>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="label">Techs on GPS</div><div class="value">${live} of ${d.techs.filter((t) => t.total).length}</div></div>
      <div class="stat"><div class="label">Stops left</div><div class="value">${open}</div></div>
      <div class="stat"><div class="label">Running late</div><div class="value" style="${late ? 'color:var(--danger)' : ''}">${late}</div><div class="sub">past the promised window</div></div>
      <div class="stat"><div class="label">Unassigned</div><div class="value">${d.unassigned.length}</div></div>
    </div>
    <div class="route-layout">
      <div>
        ${d.techs.map((t) => {
    const [cls, label] = DSTATUS[t.status] || ['', t.status];
    return `<div class="card" style="margin-bottom:10px;padding:12px">
          <div style="display:flex;gap:10px;align-items:center">
            <button type="button" class="link-btn" style="text-decoration:none" data-face="${t.id}" title="${BOOT.me.isAdmin ? 'Change photo' : ''}">${techFace(t)}</button>
            <div style="flex:1;min-width:0"><b>${esc(t.name)}</b> <span class="pill ${cls}">${label}</span>
              <div class="small muted">${t.done} of ${t.total} stops done${t.plan.finish_text ? ` · done around ${esc(t.plan.finish_text)}` : ''}${t.plan.overtime_min ? ` <span style="color:var(--danger)">(+${t.plan.overtime_min} min over)</span>` : ''}</div>
              ${t.ping && !t.ping.fresh ? `<div class="small muted">Last seen ${Math.round(t.ping.age_min)} min ago</div>` : ''}
            </div>
          </div>
          ${t.on_site ? `<div class="small" style="margin-top:8px">🧰 Working at <a href="#/visits/${t.on_site.id}">${esc(t.on_site.name)}</a></div>` : ''}
          ${t.next ? `<div class="small" style="margin-top:6px">➡️ Next: <a href="#/visits/${t.next.id}">${esc(t.next.name)}</a> · ETA ${esc(t.next.eta_text || '—')}
            ${t.next.late_min > 0 ? `<span style="color:var(--danger);font-weight:600"> · ${t.next.late_min} min late</span>` : ''}</div>` : ''}
          ${t.late > 1 ? `<div class="small" style="color:var(--danger)">${t.late} stops will miss their window</div>` : ''}
          <div class="actions" style="margin-top:8px">
            <a class="btn sm" href="#/routes?${new URLSearchParams({ date, tech: t.id })}">Route</a>
            ${t.total - t.done > 1 ? `<button class="btn sm" data-opt="${t.id}">⚡ Re-optimize</button>` : ''}
            ${t.total - t.done > 0 ? `<button class="btn sm" data-out="${t.id}">🤒 Called out</button>` : ''}
          </div>
        </div>`;
  }).join('') || '<div class="card empty"><h3>No techs run routes</h3><p>Turn on "runs routes" for your techs in Settings → Team.</p></div>'}
        ${d.unassigned.length ? `<div class="card" style="padding:12px"><div class="card-head"><h3 style="margin:0">Unassigned (${d.unassigned.length})</h3>
            <button class="btn primary sm" id="auto">Auto-assign</button></div>
          ${d.unassigned.slice(0, 8).map((s) => `<div class="small" style="padding:4px 0">${esc(s.name)} · ${esc(s.address)}${s.time_window ? ` · ⏰ ${esc(s.time_window)}` : ''}</div>`).join('')}
          ${d.unassigned.length > 8 ? `<div class="small muted">and ${d.unassigned.length - 8} more</div>` : ''}</div>` : ''}
        <p class="small muted">${d.provider === 'mapbox' ? 'Drive times from Mapbox road data.' : 'Drive times are estimates from distance. Add a MAPBOX_TOKEN to use real road drive times.'}
          Techs show up on the map while the tech app is open on their phone.</p>
      </div>
      <div id="map" class="no-print"></div>
    </div>`;

  $('#date').onchange = (e) => go({ date: e.target.value });
  $('#prev').onclick = () => go({ date: addDays(date, -1) });
  $('#next').onclick = () => go({ date: addDays(date, 1) });
  if ($('#hours')) $('#hours').onclick = () => modal('Route day', `
    <p class="small muted">Arrival times are planned from the start time. Stops that run past the end time count as overtime.</p>
    <div class="row"><div class="field"><label>Day starts</label><input type="time" name="route_start_time" value="${esc(d.day.start)}"></div>
    <div class="field"><label>Day ends</label><input type="time" name="route_end_time" value="${esc(d.day.end)}"></div></div>`, [
    { label: 'Cancel' },
    { label: 'Save', cls: 'primary', onClick: async (m) => { await api('/nuvolve/app/api/settings', { method: 'PUT', body: formData(m) }); route(); } },
  ]);
  $$('[data-opt]', view).forEach((b) => (b.onclick = async () => {
    await api('/nuvolve/app/api/routes/optimize', { body: { date, tech_id: Number(b.dataset.opt) } });
    toast('Route re-optimized');
    route();
  }));
  $$('[data-out]', view).forEach((b) => (b.onclick = () => reshuffleModal(d, Number(b.dataset.out))));
  if ($('#auto')) $('#auto').onclick = () => reshuffleModal(d, null);
  if (BOOT.me.isAdmin) {
    $$('[data-face]', view).forEach((b) => (b.onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.onchange = async () => {
        if (!inp.files[0]) return;
        try {
          await api(`/nuvolve/app/api/users/${b.dataset.face}/photo`, { method: 'PUT', body: { data: await shrinkImage(inp.files[0], 480) } });
          toast('Photo saved. Customers see it in on-my-way texts.');
          route();
        } catch (e) { toast(e.message, true); }
      };
      inp.click();
    }));
  }

  drawDispatchMap(d);
  clearInterval(dispatchTimer);
  if (d.today) {
    const h = location.hash;
    dispatchTimer = setInterval(() => {
      if (location.hash !== h) return clearInterval(dispatchTimer);
      if ($('.modal-back') || document.hidden) return;
      route(true);
    }, 30000);
  }
}

function drawDispatchMap(d) {
  const el = $('#map');
  if (!window.L) { setTimeout(() => $('#map') && drawDispatchMap(d), 800); return; }
  // The page re-renders on refresh, so the map is rebuilt on the new element but keeps its view.
  const view = dispatchMap && dispatchFitted === d.date ? { c: dispatchMap.getCenter(), z: dispatchMap.getZoom() } : null;
  if (dispatchMap) dispatchMap.remove();
  dispatchMap = L.map(el);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(dispatchMap);
  dispatchLayer = L.layerGroup().addTo(dispatchMap);
  const all = [];
  const dot = (color, text, ring) => L.divIcon({ className: '', iconSize: [22, 22],
    html: `<div style="background:${color};color:#fff;border-radius:50%;width:22px;height:22px;display:grid;place-items:center;font-weight:700;font-size:11px;border:2px solid ${ring || '#fff'};box-shadow:0 1px 3px rgba(0,0,0,.4)">${text}</div>` });
  for (const t of d.techs) {
    const line = [];
    if (t.ping?.fresh) line.push([t.ping.lat, t.ping.lng]);
    t.stops.forEach((s, i) => {
      if (s.lat == null) return;
      const done = s.status !== 'scheduled';
      L.marker([s.lat, s.lng], { icon: dot(done ? '#a0aec0' : t.color, done ? '✓' : i + 1, s.late_min > 0 ? '#e53e3e' : null) }).addTo(dispatchLayer)
        .bindPopup(`<b>${esc(s.name)}</b><br>${esc(s.address)}<br>${esc(t.name)}${s.eta_text && !done ? ` · ETA ${esc(s.eta_text)}` : ''}${s.late_min > 0 ? ` <b style="color:#e53e3e">${s.late_min} min late</b>` : ''}`);
      all.push([s.lat, s.lng]);
      if (!done) line.push([s.lat, s.lng]);
    });
    if (line.length > 1) L.polyline(line, { color: t.color, weight: 3, opacity: 0.7, dashArray: '6 6' }).addTo(dispatchLayer);
    if (t.ping?.fresh) {
      const face = t.has_photo ? `<img src="/nuvolve/app/api/users/${t.id}/photo" style="width:34px;height:34px;border-radius:50%;object-fit:cover;border:3px solid ${esc(t.color)};box-shadow:0 1px 5px rgba(0,0,0,.5)">`
        : `<div style="width:34px;height:34px;border-radius:50%;background:${esc(t.color)};color:#fff;display:grid;place-items:center;font-weight:800;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.5)">🚚</div>`;
      L.marker([t.ping.lat, t.ping.lng], { zIndexOffset: 1000, icon: L.divIcon({ className: '', html: face, iconSize: [34, 34] }) }).addTo(dispatchLayer)
        .bindPopup(`<b>${esc(t.name)}</b><br>${(DSTATUS[t.status] || [])[1] || ''} · updated ${t.ping.age_min < 1 ? 'just now' : `${Math.round(t.ping.age_min)} min ago`}`);
      all.push([t.ping.lat, t.ping.lng]);
    }
  }
  for (const s of d.unassigned) {
    if (s.lat == null) continue;
    L.marker([s.lat, s.lng], { icon: dot('#718096', '?') }).addTo(dispatchLayer).bindPopup(`<b>${esc(s.name)}</b><br>${esc(s.address)}<br>Unassigned`);
    all.push([s.lat, s.lng]);
  }
  if (view) dispatchMap.setView(view.c, view.z);
  else if (all.length) dispatchMap.fitBounds(all, { padding: [30, 30], maxZoom: 14 });
  else dispatchMap.setView([39.5, -98.35], 4);
  dispatchFitted = d.date;
}

// Preview who'd take each stop, let the office drop techs who can't help, then apply.
async function reshuffleModal(d, fromTech) {
  const from = d.techs.find((t) => t.id === fromTech);
  // Techs already running a route today are picked by default; if nobody is, everyone is.
  const pool = d.techs.filter((t) => t.id !== fromTech);
  const others = pool.some((t) => t.total) ? pool.filter((t) => t.total) : pool;
  const m = modal(from ? `${from.name} called out` : 'Assign unassigned stops', `
    <p class="small muted">${from ? `${from.name.split(' ')[0]}'s open stops` : 'These stops'} go to whoever can fit each one in with the least extra driving, without missing promised windows.</p>
    <div class="field"><label>Who can take stops</label>${pool.map((t) => `<label class="check"><input type="checkbox" name="t${t.id}" data-to="${t.id}" ${others.includes(t) ? 'checked' : ''}> ${esc(t.name)}</label>`).join('')}</div>
    <div id="rs-preview"><p class="muted">Working it out...</p></div>
    <label class="check"><input type="checkbox" id="rs-notify" checked> Text each customer the name of their new tech</label>`, [
    { label: 'Cancel' },
    { label: 'Move stops', cls: 'primary', onClick: async () => {
      const r = await api('/nuvolve/app/api/routes/reshuffle', { body: { date: d.date, from_tech_id: fromTech, to_tech_ids: picked(), apply: true, notify_customers: $('#rs-notify').checked } });
      toast(`Moved ${r.moved} stop${r.moved === 1 ? '' : 's'}${r.texted ? ` and told ${r.texted} customer${r.texted === 1 ? '' : 's'}` : ''}${r.stuck?.length ? `. ${r.stuck.length} need${r.stuck.length === 1 ? 's' : ''} a licensed tech.` : ''}`);
      route();
    } },
  ]);
  const picked = () => $$('[data-to]', m.el).filter((x) => x.checked).map((x) => Number(x.dataset.to));
  const preview = async () => {
    const box = $('#rs-preview', m.el);
    if (!picked().length) { box.innerHTML = '<div class="alert warn">Pick at least one tech.</div>'; return; }
    box.innerHTML = '<p class="muted">Working it out...</p>';
    try {
      const r = await api('/nuvolve/app/api/routes/reshuffle', { body: { date: d.date, from_tech_id: fromTech, to_tech_ids: picked() } });
      box.innerHTML = r.moved ? r.crews.filter((c) => c.added).map((c) => `<div style="margin:10px 0">
          <b style="color:${esc(c.color)}">${esc(c.tech_name)}</b> takes ${c.added} · done around ${esc(c.finish_text || '—')}
          ${c.overtime_min ? `<span class="pill red">${c.overtime_min} min overtime</span>` : ''}${c.late_stops ? `<span class="pill red">${c.late_stops} late</span>` : ''}
          ${c.stops.map((s) => `<div class="small">· ${esc(s.name)}, ${esc(s.address)} · ETA ${esc(s.eta_text || '—')}${s.late_min ? ` <b style="color:var(--danger)">${s.late_min} min late</b>` : ''}</div>`).join('')}
        </div>`).join('') : r.stuck?.length ? '' : '<p>No open stops to move.</p>';
      if (r.stuck?.length) box.innerHTML += `<div class="alert warn" style="display:block"><b>${r.stuck.length} stop${r.stuck.length === 1 ? '' : 's'} can't move</b>${r.stuck.map((s) => `<div class="small">· ${esc(s.name)}, ${esc(s.address)}: ${esc(s.reason)}</div>`).join('')}</div>`;
    } catch (e) { box.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
  };
  $$('[data-to]', m.el).forEach((x) => (x.onchange = preview));
  preview();
}
