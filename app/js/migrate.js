// Switch to Nuvolve: bring everything over from FieldRoutes, GorillaDesk, PestPac or a spreadsheet.
// Drop in the exports, check which column is which, preview, import. One click undoes it.
const SWITCH_HELP = {
  fieldroutes: {
    name: 'FieldRoutes', logo: '🛣️',
    steps: ['Customers (with balances)', 'Subscriptions', 'Appointments (completed and upcoming, as far back as you want history)', 'Chemical use', 'Invoices and payments, if you want paid history'],
    tip: 'Run each report in FieldRoutes and use its export button. CSV or Excel both work.',
  },
  gorilladesk: {
    name: 'GorillaDesk', logo: '🦍',
    steps: ['Customers', 'Recurring jobs', 'Job history', 'Material usage', 'Invoices and payments'],
    tip: 'Most lists in GorillaDesk have an Export button at the top right. CSV or Excel both work.',
  },
  pestpac: {
    name: 'PestPac', logo: '📋',
    steps: ['Locations (with bill-to and balance due)', 'Service setups', 'Service history / service orders', 'Materials used', 'Open invoices (A/R)'],
    tip: 'Run the reports in PestPac and export to Excel or CSV. Location codes link the files together.',
  },
  spreadsheet: {
    name: 'Spreadsheet or anything else', logo: '📄',
    steps: ['One row per customer is enough', 'Add service, frequency, price and next service columns to bring plans over', 'Add a balance column to bring what they owe'],
    tip: 'QuickBooks, Briostack, ServSuite, Excel, Google Sheets: export to CSV or Excel.',
  },
};

async function pageSwitch(view) {
  const [history, d] = await Promise.all([api('/nuvolve/app/api/migrate/history'), api('/nuvolve/app/api/settings')]);
  const state = { system: 'fieldroutes', files: [], analysis: null };

  view.innerHTML = `
    <div class="page-head"><div><h1>Switch to Nuvolve</h1><div class="muted">Bring customers, plans, service history, chemical records and balances over from your old system. You check everything before it goes in, and one click undoes it.</div></div></div>
    <div class="card">
      <h2>1. Where are you coming from?</h2>
      <div class="sys-pick">${Object.entries(SWITCH_HELP).map(([k, s]) => `<button class="sys ${k === state.system ? 'on' : ''}" data-sys="${k}"><span class="sys-logo">${s.logo}</span>${esc(s.name)}</button>`).join('')}</div>
      <div id="sys-help"></div>
      <div class="field" style="margin-top:12px"><label>Your export files (CSV or Excel, up to 12)</label>
        <div class="drop" id="drop"><input type="file" id="files" multiple accept=".csv,.txt,.tsv,.xlsx,.xls"><span class="muted">Drop files here or click to pick them</span></div></div>
      <div id="file-list"></div>
      <div class="actions"><button class="btn primary" id="read" disabled>Read my files</button></div>
    </div>
    <div id="mapping"></div>
    <div id="pv"></div>
    <div class="card"><h2>Past moves</h2>${history.length ? `<table class="list"><thead><tr><th>From</th><th>Branch</th><th>When</th><th>Brought in</th><th></th></tr></thead><tbody>
      ${history.map((m) => `<tr class="${m.undone_at ? 'muted' : ''}"><td><b>${esc(m.seller_name)}</b></td><td>${esc(m.location || '')}</td><td class="small">${fmtDate(m.created_at)}</td>
        <td class="small">${m.counts ? `${m.counts.added} new, ${m.counts.merged} matched, ${m.counts.plans} plans, ${m.counts.visits} visits, ${m.counts.invoices} invoices` : ''}</td>
        <td class="right">${m.undone_at ? '<span class="pill">Undone</span>' : `<button class="btn sm" data-undo="${m.id}">Undo</button>`}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nothing moved in yet.</p>'}</div>`;

  const showHelp = () => {
    const s = SWITCH_HELP[state.system];
    $('#sys-help').innerHTML = `<div class="alert info" style="display:block;margin-top:12px"><b>Export these from ${esc(s.name)}:</b>
      <ol class="small" style="margin:6px 0">${s.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
      <div class="small">${esc(s.tip)} Only the customer list is required; everything else adds history.</div></div>`;
  };
  showHelp();
  $$('[data-sys]', view).forEach((b) => (b.onclick = () => {
    state.system = b.dataset.sys;
    $$('[data-sys]', view).forEach((x) => x.classList.toggle('on', x === b));
    showHelp();
  }));

  const readFile = (file) => new Promise((resolve, reject) => {
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      const r = new FileReader();
      r.onload = () => resolve({ name: file.name, base64: String(r.result).split(',')[1] || '' });
      r.onerror = () => reject(new Error(`Couldn't read ${file.name}`));
      r.readAsDataURL(file);
    } else file.text().then((text) => resolve({ name: file.name, text }), reject);
  });
  const addFiles = async (list) => {
    try {
      for (const f of list) {
        if (f.size > 15 * 1024 * 1024) { toast(`${f.name} is over 15 MB. Export a shorter date range.`, true); continue; }
        state.files = state.files.filter((x) => x.name !== f.name).concat(await readFile(f));
      }
      state.files = state.files.slice(0, 12);
    } catch (e) { toast(e.message, true); }
    $('#file-list').innerHTML = state.files.length ? `<div class="chips">${state.files.map((f, i) => `<span class="chip">📎 ${esc(f.name)} <button class="link-btn" data-rm="${i}" aria-label="Remove">✕</button></span>`).join('')}</div>` : '';
    $$('[data-rm]', view).forEach((b) => (b.onclick = () => { state.files.splice(Number(b.dataset.rm), 1); addFiles([]); }));
    $('#read').disabled = !state.files.length;
    $('#mapping').innerHTML = '';
    $('#pv').innerHTML = '';
  };
  $('#files').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
  const drop = $('#drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); };

  $('#read').onclick = async (e) => {
    if (state.files.reduce((t, f) => t + (f.base64 || f.text || '').length, 0) > 24e6) return toast('Those files are too big to send at once. Add fewer, or export a shorter date range.', true);
    e.target.disabled = true;
    try {
      state.analysis = await api('/nuvolve/app/api/migrate/analyze', { body: { files: state.files, system: state.system } });
      showMapping();
    } catch (err) { toast(err.message, true); }
    e.target.disabled = false;
  };

  $$('[data-undo]', view).forEach((b) => (b.onclick = () => modal('Undo this move?', '<p>Every customer, plan, visit, invoice and payment it brought in is removed, along with any services, products and techs it added that nothing else uses. Customers that were matched to accounts you already had stay, minus the imported history.</p>',
    [{ label: 'Cancel' }, { label: 'Undo it', cls: 'primary', onClick: async () => { await api(`/nuvolve/app/api/merges/${b.dataset.undo}/undo`, { method: 'POST' }); await refreshBoot(); toast('Move undone'); route(); } }])));

  // ---------- 2. which column is which ----------
  function showMapping() {
    const a = state.analysis;
    if (a.system !== state.system) {
      state.system = a.system;
      $$('[data-sys]', view).forEach((x) => x.classList.toggle('on', x.dataset.sys === a.system));
      showHelp();
    }
    const kindOptions = (sel) => Object.entries(a.kinds).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
    const fieldRows = (f, kind) => kind === 'ignore' ? '<p class="small muted">This file will be left out.</p>' : `<table class="list small map-table"><thead><tr><th>Nuvolve field</th><th>Column in your file</th><th>First row</th></tr></thead><tbody>
      ${a.fields[kind].map((fl) => {
        const col = f.auto[kind][fl.key];
        return `<tr><td>${esc(fl.label)}</td><td><select data-file="${f.index}" data-field="${fl.key}"><option value="">(not in this file)</option>
          ${f.headers.map((h, i) => `<option value="${i}" ${col === i ? 'selected' : ''}>${esc(h || `Column ${i + 1}`)}</option>`).join('')}</select></td>
          <td class="muted" data-eg="${f.index}-${fl.key}">${esc(col != null ? f.sample[0]?.[col] ?? '' : '')}</td></tr>`;
      }).join('')}</tbody></table>`;
    $('#mapping').innerHTML = `<div class="card">
      <div class="card-head"><div><h2>2. Check what we found</h2><div class="small muted">We read ${a.files.length} file${a.files.length === 1 ? '' : 's'} from ${esc(a.systems[a.system])} and matched the columns we recognized. Fix anything that landed in the wrong place.</div></div></div>
      ${a.files.map((f) => `<details class="map-file" ${a.files.length <= 2 ? 'open' : ''}><summary><b>${esc(f.name)}</b> <span class="small muted">${f.rowCount} rows</span>
          <select data-kind="${f.index}" style="width:auto;margin-left:8px">${kindOptions(f.kind)}</select></summary>
        <div data-fields="${f.index}">${fieldRows(f, f.kind)}</div></details>`).join('')}
      <div class="row" style="margin-top:12px">
        <div class="field"><label>Name for this move (shows in Past moves)</label><input id="mv-name" value="${esc(a.systems[a.system])} import"></div>
        <div class="field"><label>Into branch</label><select id="tloc">${d.locations.filter((l) => l.active).map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}<option value="new">A new branch...</option></select></div>
        <div class="field hidden" id="newloc"><label>New branch name</label><input id="newname" value=""></div>
      </div>
      <div class="actions" style="justify-content:flex-end"><button class="btn primary" id="go-preview">Preview the move</button></div>
    </div>`;
    const wire = () => $$('[data-field]', view).forEach((s) => (s.onchange = () => {
      const f = a.files[Number(s.dataset.file)];
      $(`[data-eg="${f.index}-${s.dataset.field}"]`).textContent = s.value === '' ? '' : f.sample[0]?.[Number(s.value)] ?? '';
    }));
    wire();
    $$('[data-kind]', view).forEach((s) => (s.onchange = () => {
      const f = a.files[Number(s.dataset.kind)];
      $(`[data-fields="${f.index}"]`).innerHTML = fieldRows(f, s.value);
      wire();
    }));
    $('#tloc').onchange = (e) => $('#newloc').classList.toggle('hidden', e.target.value !== 'new');
    $('#go-preview').onclick = async (e) => {
      e.target.disabled = true;
      try {
        state.request = request();
        showPreview(await api('/nuvolve/app/api/migrate/preview', { body: state.request }));
      } catch (err) { toast(err.message, true); }
      e.target.disabled = false;
    };
    $('#mapping').scrollIntoView({ behavior: 'smooth' });
  }

  function request() {
    const mappings = state.analysis.files.map((f) => {
      const kind = $(`[data-kind="${f.index}"]`).value;
      const map = {};
      $$(`[data-file="${f.index}"]`).forEach((s) => { map[s.dataset.field] = s.value === '' ? null : Number(s.value); });
      return { index: f.index, kind, map };
    });
    const isNew = $('#tloc').value === 'new';
    return { files: state.files, system: state.system, mappings, seller_name: $('#mv-name').value,
      location_id: isNew ? null : $('#tloc').value, new_location: isNew ? { name: $('#newname').value || $('#mv-name').value } : null };
  }

  // ---------- 3. preview and import ----------
  function showPreview(p) {
    const c = p.counts, f = p.report.found;
    const mapRow = (kind, x, mine) => `<tr><td>${esc(x.name)}${x.epa_reg ? ` <span class="small muted">EPA ${esc(x.epa_reg)}</span>` : ''}</td>
      <td><select data-map="${kind}" data-id="${x.seller_id}"><option value="create">Add as new</option>${mine.map((m) => `<option value="${m.id}" ${x.to === m.id ? 'selected' : ''}>Use my ${esc(m.name)}</option>`).join('')}</select></td></tr>`;
    $('#pv').innerHTML = `<div class="card preview">
      <div class="card-head"><div><h2>3. Preview</h2><div class="small muted">Nothing has changed yet.</div></div></div>
      ${p.alreadyImported ? `<div class="alert warn">These files were already brought in on ${fmtDate(p.alreadyImported.created_at)}. Undo that move first to bring them in again.</div>` : ''}
      <div class="stats">
        <div class="stat"><div class="label">Customers</div><div class="value">${c.customers}</div><div class="sub">${c.activeCustomers} active · ${c.commercial} commercial · ${f.properties} addresses</div></div>
        <div class="stat"><div class="label">Recurring revenue, yearly</div><div class="value">${money(c.recurringValue)}</div><div class="sub">${c.activePlans} active plans</div></div>
        <div class="stat"><div class="label">History coming over</div><div class="value">${c.pastVisits}</div><div class="sub">past visits · ${f.chemicals} chemical records · ${c.upcomingVisits} one-off appointments</div></div>
        <div class="stat ${c.openBalance > 0 ? 'warn' : ''}"><div class="label">Open balances</div><div class="value">${money(c.openBalance)}</div><div class="sub">${f.invoices} invoices · ${f.payments} payments</div></div>
      </div>
      ${p.report.warnings.length ? `<div class="alert warn" style="display:block"><b>Worth knowing</b><ul class="small" style="margin:6px 0 0">${p.report.warnings.map((w) => `<li>${esc(w.text)}${w.count > 1 ? ` (${w.count})` : ''}</li>`).join('')}</ul></div>` : ''}
      <h3>How the first accounts will look</h3>
      <div class="table-wrap"><table class="list small"><thead><tr><th>Customer</th><th>Address</th><th>Plan</th><th>Next visit</th><th>History</th><th class="right">Owes</th></tr></thead><tbody>
        ${p.report.sample.map((s) => `<tr><td><b>${esc(s.name)}</b>${s.company ? `<div class="muted">${esc(s.company)}</div>` : ''}<div class="muted">${esc([s.phone, s.email].filter(Boolean).join(' · '))}</div>
          ${s.status !== 'active' ? '<span class="pill">Inactive</span>' : ''} ${s.type === 'commercial' ? '<span class="pill">Commercial</span>' : ''}</td>
          <td>${esc(s.address || '')}</td>
          <td>${s.plan ? `${esc(s.plan.service || '')}<div class="muted">${esc(FREQ[s.plan.frequency] || s.plan.frequency)} · ${money(s.plan.price)}${s.plan.active ? '' : ' · cancelled'}</div>` : '<span class="muted">None</span>'}</td>
          <td>${s.plan?.active ? fmtDate(s.plan.next) : ''}</td><td>${s.visits} visit${s.visits === 1 ? '' : 's'}</td><td class="right">${s.owed ? money(s.owed) : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="small muted">Something in the wrong column? Change it in step 2 and preview again.</p>
      ${p.duplicates.length ? `<div class="alert warn" style="display:block"><b>${p.duplicates.length} of these are already in Nuvolve.</b>
        <details><summary class="small">See them</summary><table class="list small">${p.duplicates.map((x) => `<tr><td>${esc(x.seller_name)}</td><td>→ <a href="#/customers/${x.buyer_id}" target="_blank">${esc(x.buyer_name)}</a></td><td>${esc(x.reason)}</td></tr>`).join('')}</table></details>
        <div class="field" style="margin-top:8px"><label>What to do with them</label><select id="dups"><option value="merge">Add their history to the account I have (recommended)</option><option value="skip">Leave them out</option><option value="separate">Bring them in as separate accounts</option></select></div></div>` : ''}
      ${c.outOfArea ? `<p class="small" style="color:var(--warn)">⚠️ ${c.outOfArea} addresses are outside the chosen branch's service area.</p>` : ''}
      <details><summary><b>Match services, products and techs</b> <span class="small muted">(we matched what we could)</span></summary>
        <div class="grid cols-3" style="margin-top:10px">
          <div><h3>Services</h3><table class="list small">${p.maps.services.map((x) => mapRow('services', x, d.serviceTypes)).join('') || '<tr><td class="muted">None</td></tr>'}</table></div>
          <div><h3>Products</h3><table class="list small">${p.maps.products.map((x) => mapRow('products', x, d.products)).join('') || '<tr><td class="muted">None</td></tr>'}</table></div>
          <div><h3>Technicians</h3><table class="list small">${p.maps.techs.map((x) => mapRow('techs', x, d.users.filter((u) => u.active && u.runs_routes))).join('') || '<tr><td class="muted">None</td></tr>'}</table>
            <p class="small muted">New techs come over without a login. Give them one in Settings → Team.</p></div>
        </div></details>
      <p class="small muted">Cards on file stay with your old card processor, so customers on autopay need to save a card again from their pay page.</p>
      <div class="actions" style="margin-top:14px;justify-content:flex-end"><button class="btn primary big" id="commit" ${p.alreadyImported ? 'disabled' : ''}>Bring in ${c.customers} customers</button></div>
    </div>`;
    $('#commit').onclick = async (e) => {
      const maps = { services: {}, products: {}, techs: {} };
      $$('[data-map]').forEach((s) => { maps[s.dataset.map][s.dataset.id] = s.value === 'create' ? 'create' : Number(s.value); });
      e.target.disabled = true;
      try {
        const r = await api('/nuvolve/app/api/migrate/commit', { body: { ...state.request, duplicates: $('#dups')?.value || 'merge', maps } });
        await refreshBoot();
        modal('Welcome to Nuvolve 🎉', `<p><b>${r.counts.added}</b> customers added${r.counts.merged ? ` and <b>${r.counts.merged}</b> matched to accounts you had` : ''}.</p>
          <p class="small">${r.counts.plans} plans with their visits on the schedule, ${r.counts.visits} past and one-off visits, ${r.counts.invoices} invoices. ${r.counts.new_techs ? `${r.counts.new_techs} techs added.` : ''} ${r.counts.new_services ? `${r.counts.new_services} services added.` : ''}</p>
          <p class="small muted">Changed your mind? Undo it from Past moves on this page.</p>`,
        [{ label: 'Stay here', onClick: () => route() }, { label: 'See the customers', cls: 'primary', onClick: () => { location.hash = '#/customers'; } }]);
      } catch (err) { toast(err.message, true); e.target.disabled = false; }
    };
    $('#pv').scrollIntoView({ behavior: 'smooth' });
  }
}
