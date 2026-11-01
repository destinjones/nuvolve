// Switch to Nuvolve: bring everything over from FieldRoutes, GorillaDesk, PestPac or a spreadsheet, in five steps.
//   1 Files       drop in the exports; we say what each one is and why, and which ones to double-check
//   2 Columns     every column with a few of its values, and where it goes (or "Don't import")
//   3 Duplicates  customers already in Nuvolve, side by side: merge, create new or skip, one by one or all at once
//   4 Check       a dry run: what would be added, merged, skipped and scheduled, and anything worth knowing
//   5 Done        what came in, and the undo
// Saved column setups, the dry run and the undo check are in src/features/trust.js; the engine is src/migrate.js.
const SWITCH_HELP = {
  fieldroutes: {
    name: 'FieldRoutes', logo: '🛣️',
    steps: ['Customers (with balances)', 'Subscriptions', 'Appointments (completed and upcoming, as far back as you want history)', 'Chemical use', 'Tickets (invoices) and payments, if you want paid history'],
    tip: 'Run each report in FieldRoutes and use its export button. CSV or Excel both work.',
  },
  gorilladesk: {
    name: 'GorillaDesk', logo: '🦍',
    steps: ['Customers', 'Recurring jobs', 'Jobs (history)', 'Material usage', 'Invoices and payments'],
    tip: 'Most lists in GorillaDesk have an Export button at the top right. CSV or Excel both work.',
  },
  pestpac: {
    name: 'PestPac', logo: '📋',
    steps: ['Locations (with bill-to and balance due)', 'Service setups', 'Service orders (history)', 'Materials used', 'Invoices and payments'],
    tip: 'Run the reports in PestPac and export to Excel or CSV. Location codes link the files together.',
  },
  spreadsheet: {
    name: 'Spreadsheet or anything else', logo: '📄',
    steps: ['One row per customer is enough', 'Add service, frequency, price and next service columns to bring plans over', 'Add a balance column to bring what they owe'],
    tip: 'QuickBooks, Briostack, ServSuite, Excel, Google Sheets: export to CSV or Excel.',
  },
};
const WIZ_STEPS = ['Files', 'Columns', 'Duplicates', 'Check', 'Done'];
const DUP_CHOICES = [['merge', 'Merge into existing'], ['separate', 'Create new'], ['skip', 'Skip']];

async function pageSwitch(view) {
  const [history, d, savedList] = await Promise.all([api('/nuvolve/app/api/migrate/history'), api('/nuvolve/app/api/settings'), api('/nuvolve/app/api/migrate/mappings').catch(() => [])]);
  const firstBranch = d.locations.find((l) => l.active)?.id || '';
  const state = {
    step: 1, system: 'fieldroutes', files: [], analysis: null, plan: {}, remember: true, saved: savedList,
    preview: null, dupChoice: {}, bulk: 'merge', maps: { services: {}, products: {}, techs: {} }, dry: null, result: null,
    moveName: '', location: firstBranch, newLocation: '',
  };

  view.innerHTML = `
    <div class="page-head"><div><h1>Switch to Nuvolve</h1><div class="muted">Bring customers, plans, service history, chemical records and balances over from your old system. You check everything first, nothing changes until you press Import, and one click undoes it.</div></div></div>
    <ol class="wiz-steps" id="wiz-steps" aria-label="Steps"></ol>
    <div id="wiz"></div>
    <div class="card"><h2>Past moves</h2>${history.length ? `<div class="table-wrap"><table class="list wiz-table"><thead><tr><th>From</th><th>Branch</th><th>When</th><th>Brought in</th><th></th></tr></thead><tbody>
      ${history.map((m) => `<tr class="${m.undone_at ? 'muted' : ''}"><td><b>${esc(m.seller_name)}</b></td><td>${esc(m.location || '')}</td><td class="small">${fmtDate(m.created_at)}</td>
        <td class="small">${m.counts ? `${m.counts.added} new, ${m.counts.merged} matched, ${m.counts.plans} plans, ${m.counts.visits} visits, ${m.counts.invoices} invoices` : ''}</td>
        <td class="right">${m.undone_at ? '<span class="pill">Undone</span>' : `<button class="btn sm" data-undo="${m.id}">Undo</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nothing moved in yet.</p>'}</div>`;
  $$('[data-undo]', view).forEach((b) => (b.onclick = () => undoMove(Number(b.dataset.undo)).catch((e) => toast(e.message, true))));

  const wiz = () => $('#wiz', view);
  const A = () => state.analysis;
  const label = () => A()?.systems?.[state.system] || SWITCH_HELP[state.system].name;
  const live = () => A().files.filter((f) => state.plan[f.index].kind !== 'ignore');

  function steps() {
    const dupsDone = state.preview && !state.preview.duplicates.length;
    $('#wiz-steps', view).innerHTML = WIZ_STEPS.map((name, i) => {
      const n = i + 1;
      // Earlier steps can be opened again, until the import is done. A duplicates step with none is passed over.
      const done = n < state.step && state.step < 5;
      const back = done && !(n === 3 && dupsDone);
      return `<li class="${n === state.step ? 'on' : done ? 'done' : ''}" ${back ? `data-go="${n}" role="button" tabindex="0"` : ''} ${n === state.step ? 'aria-current="step"' : ''}>
        ${esc(name)}${n === 3 && dupsDone && state.step > 3 ? ' <span class="small muted">(none)</span>' : ''}</li>`;
    }).join('');
    $$('[data-go]', view).forEach((li) => {
      const go = () => show(Number(li.dataset.go));
      li.onclick = go;
      li.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });
  }
  function show(n) {
    const moved = n !== state.step;
    state.step = n;
    steps();
    ({ 1: stepFiles, 2: stepColumns, 3: stepDuplicates, 4: stepCheck, 5: stepDone })[n]();
    if (moved) $('#wiz-steps', view).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // What gets sent: the files, and the whole answer for each one (full: the columns not listed stay out).
  function request() {
    const mappings = A().files.map((f) => {
      const p = state.plan[f.index];
      if (p.kind === 'ignore') return { index: f.index, kind: 'ignore' };
      return { index: f.index, kind: p.kind, full: true, map: Object.fromEntries([...p.cols].map(([col, field]) => [field, col])) };
    });
    const isNew = state.location === 'new';
    return {
      files: state.files, system: state.system, mappings, seller_name: state.moveName || `${label()} import`,
      location_id: isNew ? null : state.location || null, new_location: isNew ? { name: state.newLocation || state.moveName || `${label()} customers` } : null,
      duplicates: state.bulk, duplicate_choices: state.dupChoice, maps: state.maps,
    };
  }
  // Column setups to keep for next time, by column name.
  const rememberList = () => (state.remember ? A().files.map((f) => {
    const p = state.plan[f.index];
    return { kind: p.kind, headers: f.headers, file_name: f.name, map: Object.fromEntries([...p.cols].map(([col, field]) => [field, f.headers[col]])) };
  }) : []);

  // The starting answer for a file: a saved setup when it fits, otherwise our guesses.
  function startPlan(f, kind) {
    const from = f.saved && f.saved.map && kind === f.kind ? f.saved.map : kind === 'ignore' ? {} : f.auto[kind] || {};
    const cols = new Map();
    for (const [field, col] of Object.entries(from)) if (Number.isInteger(col) && !cols.has(col)) cols.set(col, field);
    return { kind, cols };
  }

  // ---------- 1. files ----------
  function stepFiles() {
    const a = A();
    wiz().innerHTML = `<div class="card">
      <h2>Where are you coming from?</h2>
      <div class="sys-pick">${Object.entries(SWITCH_HELP).map(([k, s]) => `<button class="sys ${k === state.system ? 'on' : ''}" data-sys="${k}" aria-pressed="${k === state.system}"><span class="sys-logo">${s.logo}</span>${esc(s.name)}</button>`).join('')}</div>
      <div id="sys-help"></div>
      <div class="field" style="margin-top:12px"><label for="files">Your export files (CSV or Excel, up to 12)</label>
        <div class="drop" id="drop"><input type="file" id="files" multiple accept=".csv,.txt,.tsv,.xlsx,.xls"><span class="muted">Drop files here or click to pick them</span></div></div>
      <div id="file-list"></div>
      <div class="actions" style="justify-content:flex-end" id="files-actions"></div>
      ${state.saved.length ? `<details class="small" style="margin-top:12px"><summary>Saved column setups (${state.saved.length})</summary>
        <p class="muted">When a file has the same columns as one you imported before, it starts from the columns you picked then.</p>
        <table class="list small"><tbody>${state.saved.map((m) => `<tr><td><b>${esc(m.file_name || 'A file')}</b> <span class="muted">${esc(SWITCH_HELP[m.system]?.name || m.system)} · ${esc(a?.kinds?.[m.kind] || m.kind)} · ${m.columns} columns</span></td>
          <td class="small muted">${fmtDate(m.used_at || m.created_at)}</td><td class="right"><button class="btn sm" data-forget="${m.id}">Delete</button></td></tr>`).join('')}</tbody></table></details>` : ''}
    </div>`;
    const help = () => {
      const s = SWITCH_HELP[state.system];
      $('#sys-help').innerHTML = `<div class="alert info" style="display:block;margin-top:12px"><b>Export these from ${esc(s.name)}:</b>
        <ol class="small" style="margin:6px 0">${s.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
        <div class="small">${esc(s.tip)} Only the customer list is required; everything else adds history.</div></div>`;
    };
    help();
    $$('[data-sys]', wiz()).forEach((b) => (b.onclick = () => {
      state.system = b.dataset.sys;
      $$('[data-sys]', wiz()).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      help();
    }));
    $$('[data-forget]', wiz()).forEach((b) => (b.onclick = async () => {
      try {
        await api(`/nuvolve/app/api/migrate/mappings/${b.dataset.forget}`, { method: 'DELETE' });
        state.saved = state.saved.filter((m) => m.id !== Number(b.dataset.forget));
        toast('Saved setup deleted');
        stepFiles();
      } catch (e) { toast(e.message, true); }
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
        if (state.files.length > 12) toast('Up to 12 files at a time', true);
        state.files = state.files.slice(0, 12);
      } catch (e) { toast(e.message, true); }
      if (list.length) state.analysis = null;
      fileList();
    };
    $('#files').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
    const drop = $('#drop');
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); };
    fileList();
  }

  // Before reading: the files picked. After: what each one is, why we think so, and a way to change it.
  function fileList() {
    const a = A();
    const box = $('#file-list');
    if (!a) {
      box.innerHTML = state.files.length ? `<div class="chips">${state.files.map((f, i) => `<span class="chip">📎 ${esc(f.name)} <button class="link-btn" data-rm="${i}" aria-label="Remove ${esc(f.name)}">✕</button></span>`).join('')}</div>` : '';
      $('#files-actions').innerHTML = `<button class="btn primary" id="read" ${state.files.length ? '' : 'disabled'}>Read my files</button>`;
    } else {
      const kindOptions = (sel) => Object.entries(a.kinds).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
      box.innerHTML = `${a.systemReason ? `<p class="small muted" style="margin:12px 0 4px">${esc(a.systemReason)}.</p>` : ''}
        <div class="table-wrap"><table class="list wiz-table" style="margin-top:8px"><thead><tr><th>File</th><th>What it is</th><th></th></tr></thead><tbody>
        ${a.files.map((f) => {
          const kind = state.plan[f.index].kind;
          const changed = kind !== f.kind;
          return `<tr><td><b>${esc(f.name)}</b><div class="small muted">${plural(f.rowCount, 'row')} · ${plural(f.headers.length, 'column')}</div></td>
            <td><select data-kind="${f.index}" aria-label="What ${esc(f.name)} is" style="width:auto;max-width:100%">${kindOptions(kind)}</select>
              ${!f.kindSure && !changed ? ' <span class="pill yellow">Please check</span>' : ''}
              <div class="small muted" style="margin-top:4px">${changed ? 'You picked this' : esc(f.kindReason)}${f.saved && !changed ? ' <span class="pill green">Saved setup</span>' : ''}</div></td>
            <td class="right wiz-rm"><button class="link-btn" data-rm="${f.index}" aria-label="Remove ${esc(f.name)}">✕</button></td></tr>`;
        }).join('')}</tbody></table></div>
        ${a.files.some((f) => !f.kindSure) ? '<p class="small muted">"Please check" means two kinds of file fit about as well. Pick the right one if we guessed wrong.</p>' : ''}`;
      $('#files-actions').innerHTML = '<button class="btn" id="reread">Read again</button><button class="btn primary" id="next1">Next: check the columns</button>';
      $$('[data-kind]', box).forEach((s) => (s.onchange = () => {
        const f = a.files[Number(s.dataset.kind)];
        state.plan[f.index] = startPlan(f, s.value);
        fileList();
      }));
      $('#reread').onclick = () => { state.analysis = null; read(); };
      $('#next1').onclick = () => {
        if (!live().some((f) => state.plan[f.index].kind === 'customers')) return toast('One file needs to be the customer list. Pick "Customers" for it.', true);
        show(2);
      };
    }
    $$('[data-rm]', box).forEach((b) => (b.onclick = () => {
      state.files.splice(Number(b.dataset.rm), 1);
      state.analysis = null;
      fileList();
    }));
    if ($('#read')) $('#read').onclick = read;
  }

  async function read() {
    if (state.files.reduce((t, f) => t + (f.base64 || f.text || '').length, 0) > 24e6) return toast('Those files are too big to send at once. Add fewer, or export a shorter date range.', true);
    const btn = $('#read') || $('#reread');
    if (btn) { btn.disabled = true; btn.textContent = 'Reading...'; }
    try {
      const a = await api('/nuvolve/app/api/migrate/analyze', { body: { files: state.files, system: state.system } });
      state.analysis = a;
      state.system = a.system;
      state.saved = a.savedMappings || state.saved;
      state.plan = Object.fromEntries(a.files.map((f) => [f.index, startPlan(f, f.kind)]));
      state.preview = null; state.dupChoice = {}; state.maps = { services: {}, products: {}, techs: {} };
      if (!state.moveName) state.moveName = `${a.systems[a.system]} import`;
      stepFiles();
    } catch (e) {
      toast(e.message, true);
      if (btn) { btn.disabled = false; btn.textContent = 'Read my files'; }
    }
  }

  // ---------- 2. columns ----------
  function stepColumns() {
    const a = A();
    const files = live();
    wiz().innerHTML = `${files.map((f) => {
      const p = state.plan[f.index];
      const fields = a.fields[p.kind];
      const options = (sel) => `<option value="">Don't import</option>${fields.map((fl) => `<option value="${fl.key}" ${fl.key === sel ? 'selected' : ''}>${esc(fl.label)}</option>`).join('')}`;
      return `<div class="card" data-file="${f.index}">
        <div class="card-head"><div><h2>${esc(f.name)}</h2><div class="small muted">${esc(a.kinds[p.kind])} · ${plural(f.rowCount, 'row')} · <span data-count="${f.index}">${p.cols.size}</span> of ${plural(f.headers.length, 'column')} going in</div></div></div>
        <div class="table-wrap"><table class="list small map-cols wiz-table"><thead><tr><th>Column in your file</th><th>What's in it</th><th>Goes to</th></tr></thead><tbody>
        ${f.columns.map((c) => `<tr class="${p.cols.has(c.index) ? '' : 'off'}" data-row="${f.index}-${c.index}"><td><b>${esc(c.header || `Column ${c.index + 1}`)}</b></td>
          <td class="eg">${c.samples.length ? c.samples.map((x) => esc(x)).join(' <span class="muted">·</span> ') : '<span class="muted">(empty)</span>'}</td>
          <td><select data-col="${f.index}-${c.index}" aria-label="Where ${esc(c.header || `column ${c.index + 1}`)} goes">${options(p.cols.get(c.index))}</select></td></tr>`).join('')}
        </tbody></table></div></div>`;
    }).join('')}
    <div class="card"><label class="check"><input type="checkbox" id="remember" ${state.remember ? 'checked' : ''}> Remember these columns for next time</label>
      <div class="small muted">A file with the same columns starts from what you picked here.</div>
      <div class="actions" style="justify-content:flex-end"><button class="btn" id="back2">Back</button><button class="btn primary" id="next2">Next</button></div></div>`;
    $$('[data-col]', wiz()).forEach((s) => (s.onchange = () => {
      const [fi, ci] = s.dataset.col.split('-').map(Number);
      const p = state.plan[fi];
      if (s.value) {
        // One column per field: picking it here takes it from the column that had it.
        for (const [col, field] of p.cols) {
          if (field !== s.value || col === ci) continue;
          p.cols.delete(col);
          const other = $(`[data-col="${fi}-${col}"]`);
          other.value = '';
          $(`[data-row="${fi}-${col}"]`).classList.add('off');
          toast(`Moved from "${A().files[fi].headers[col]}"`);
        }
        p.cols.set(ci, s.value);
      } else p.cols.delete(ci);
      $(`[data-row="${fi}-${ci}"]`).classList.toggle('off', !s.value);
      $(`[data-count="${fi}"]`).textContent = p.cols.size;
    }));
    $('#remember').onchange = (e) => { state.remember = e.target.checked; };
    $('#back2').onclick = () => show(1);
    $('#next2').onclick = async (e) => {
      const cust = files.filter((f) => state.plan[f.index].kind === 'customers');
      const named = cust.some((f) => [...state.plan[f.index].cols.values()].some((k) => ['first_name', 'last_name', 'name', 'company'].includes(k)));
      if (!named) return toast('Pick the column with the customer name (or company) in the customer list', true);
      e.target.disabled = true;
      e.target.textContent = 'Looking for duplicates...';
      try {
        state.preview = await api('/nuvolve/app/api/migrate/preview', { body: request() });
        // Answers only for matches that are still there.
        const ids = new Set(state.preview.duplicates.map((x) => String(x.seller_id)));
        state.dupChoice = Object.fromEntries(Object.entries(state.dupChoice).filter(([k]) => ids.has(k)));
        show(state.preview.duplicates.length ? 3 : 4);
      } catch (err) {
        toast(err.message, true);
        e.target.disabled = false;
        e.target.textContent = 'Next';
      }
    };
  }

  // ---------- 3. duplicates ----------
  function stepDuplicates() {
    const dups = state.preview.duplicates;
    const choice = (x) => state.dupChoice[x.seller_id] || state.bulk;
    const side = (who, s, link) => `<div class="dup-side"><h4>${who}</h4>
      <div><b>${link ? `<a href="#/customers/${link}" target="_blank" rel="noopener">${esc(s.name || 'Customer')}</a>` : esc(s.name || 'Customer')}</b>${s.status && s.status !== 'active' ? ' <span class="pill">Inactive</span>' : ''}</div>
      ${s.company ? `<div>${esc(s.company)}</div>` : ''}
      <div class="muted">${esc([s.phone, s.email].filter(Boolean).join(' · ') || 'No phone or email')}</div>
      ${(s.addresses || []).map((x) => `<div>${esc(x)}</div>`).join('') || '<div class="muted">No address</div>'}
      <div class="small" style="margin-top:6px">${s.plan ? `${esc(s.plan.service || 'Plan')}, ${esc(FREQ[s.plan.frequency] || s.plan.frequency)}, ${money(s.plan.price)}${s.plan.active ? '' : ' (off)'}`
        : s.plans?.length ? s.plans.map((pl) => `${esc(pl.service || 'Plan')}, ${esc(FREQ[pl.frequency] || pl.frequency)}, ${money(pl.price)}`).join('<br>') : '<span class="muted">No plan</span>'}</div>
      <div class="small muted">${s.lastService ? `Last service ${fmtDate(s.lastService)}` : 'No service history'}${s.visits ? ` · ${plural(s.visits, 'visit')}` : ''}${s.since ? ` · customer since ${fmtDate(s.since)}` : ''}${s.owed ? ` · owes ${money(s.owed)}` : ''}</div></div>`;
    wiz().innerHTML = `<div class="card">
      <div class="card-head"><div><h2>${plural(dups.length, 'customer is', 'customers are')} already in Nuvolve</h2>
        <div class="small muted">Merging adds their plans and history to the account you have. Create new brings them in as another account. Skip leaves them out.</div></div></div>
      <div class="actions" style="margin-bottom:12px"><span class="small muted">All of them:</span>${DUP_CHOICES.map(([k, l]) => `<button class="btn sm" data-bulk="${k}">${esc(l)}</button>`).join('')}</div>
      ${dups.map((x) => `<div class="dup" data-dup="${x.seller_id}">
        <div class="small">${(x.reasons || [x.reason]).map((r) => `<span class="pill blue">${esc(r)}</span>`).join(' ')}</div>
        <div class="dup-sides">${side('In your file', x.incoming || { name: x.seller_name, phone: x.seller_phone })}${side('Already in Nuvolve', x.existing || { name: x.buyer_name, addresses: [x.address].filter(Boolean) }, x.buyer_id)}</div>
        <div class="seg sm" role="group" aria-label="What to do with ${esc(x.seller_name)}">${DUP_CHOICES.map(([k, l]) => `<button type="button" data-pick="${k}" class="${choice(x) === k ? 'on' : ''}" aria-pressed="${choice(x) === k}">${esc(l)}</button>`).join('')}</div>
      </div>`).join('')}
      <div class="actions" style="justify-content:flex-end"><button class="btn" id="back3">Back</button><button class="btn primary" id="next3">Next: check it all</button></div></div>`;
    const paint = () => $$('[data-dup]', wiz()).forEach((el) => {
      const x = dups.find((y) => String(y.seller_id) === el.dataset.dup);
      $$('[data-pick]', el).forEach((b) => { const on = b.dataset.pick === choice(x); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    });
    $$('[data-pick]', wiz()).forEach((b) => (b.onclick = () => { state.dupChoice[b.closest('[data-dup]').dataset.dup] = b.dataset.pick; paint(); }));
    $$('[data-bulk]', wiz()).forEach((b) => (b.onclick = () => { state.bulk = b.dataset.bulk; state.dupChoice = {}; paint(); }));
    $('#back3').onclick = () => show(2);
    $('#next3').onclick = () => show(4);
  }

  // ---------- 4. check (dry run) ----------
  function stepCheck() {
    const p = state.preview;
    const mapRow = (kind, x, mine) => `<tr><td>${esc(x.name)}${x.epa_reg ? ` <span class="small muted">EPA ${esc(x.epa_reg)}</span>` : ''}</td>
      <td><select data-map="${kind}" data-id="${x.seller_id}" aria-label="${esc(x.name)}"><option value="create">Add as new</option>${mine.map((m) => `<option value="${m.id}" ${(state.maps[kind][x.seller_id] ?? x.to) === m.id ? 'selected' : ''}>Use my ${esc(m.name)}</option>`).join('')}</select></td></tr>`;
    wiz().innerHTML = `<div class="card">
      <div class="card-head"><div><h2>Check it all</h2><div class="small muted">This is a dry run: the whole import, done and then taken back. Nothing has changed yet.</div></div></div>
      ${p.alreadyImported ? `<div class="alert warn">These files were already brought in on ${fmtDate(p.alreadyImported.created_at)}. Undo that move first to bring them in again.</div>` : ''}
      <div class="row">
        <div class="field"><label for="mv-name">Name for this move (shows in Past moves)</label><input id="mv-name" value="${esc(state.moveName)}"></div>
        <div class="field"><label for="tloc">Into branch</label><select id="tloc">${d.locations.filter((l) => l.active).map((l) => `<option value="${l.id}" ${String(state.location) === String(l.id) ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}<option value="new" ${state.location === 'new' ? 'selected' : ''}>A new branch...</option></select></div>
        <div class="field ${state.location === 'new' ? '' : 'hidden'}" id="newloc"><label for="newname">New branch name</label><input id="newname" value="${esc(state.newLocation)}"></div>
      </div>
      <div id="dry"><p class="muted">Checking...</p></div>
      <details style="margin-top:12px"><summary><b>Match services, products and techs</b> <span class="small muted">(we matched what we could)</span></summary>
        <div class="grid cols-3" style="margin-top:10px">
          <div><h3>Services</h3><table class="list small">${p.maps.services.map((x) => mapRow('services', x, d.serviceTypes)).join('') || '<tr><td class="muted">None</td></tr>'}</table></div>
          <div><h3>Products</h3><table class="list small">${p.maps.products.map((x) => mapRow('products', x, d.products)).join('') || '<tr><td class="muted">None</td></tr>'}</table></div>
          <div><h3>Technicians</h3><table class="list small">${p.maps.techs.map((x) => mapRow('techs', x, d.users.filter((u) => u.active && u.runs_routes))).join('') || '<tr><td class="muted">None</td></tr>'}</table>
            <p class="small muted">New techs come over without a login. Give them one in Settings → Team.</p></div>
        </div></details>
      <p class="small muted">Cards on file stay with your old card processor, so customers on autopay need to save a card again from their pay page.</p>
      <div class="actions" style="margin-top:14px;justify-content:flex-end"><button class="btn" id="back4">Back</button><button class="btn primary big" id="commit" disabled>Import</button></div>
    </div>`;
    $('#mv-name').oninput = (e) => { state.moveName = e.target.value; };
    $('#tloc').onchange = (e) => { state.location = e.target.value; $('#newloc').classList.toggle('hidden', e.target.value !== 'new'); dryRun(); };
    $('#newname').oninput = (e) => { state.newLocation = e.target.value; };
    $$('[data-map]', wiz()).forEach((s) => (s.onchange = () => { state.maps[s.dataset.map][s.dataset.id] = s.value === 'create' ? 'create' : Number(s.value); dryRun(); }));
    $('#back4').onclick = () => show(state.preview.duplicates.length ? 3 : 2);
    $('#commit').onclick = commit;
    dryRun();
  }

  let dryTurn = 0;
  async function dryRun() {
    const turn = ++dryTurn;
    const box = $('#dry');
    if (!box) return;
    box.innerHTML = '<p class="muted">Checking...</p>';
    $('#commit').disabled = true;
    try {
      const r = await api('/nuvolve/app/api/migrate/dry-run', { body: request() });
      if (turn !== dryTurn || !$('#dry')) return;
      state.dry = r;
      const c = r.counts, f = r.report.found, pv = r.preview;
      const warnings = [...r.report.warnings];
      if (c.plansWithoutVisits) warnings.unshift({ text: 'Active plans that would get no visits on the schedule (check their frequency and start date)', count: c.plansWithoutVisits });
      if (pv.outOfArea) warnings.push({ text: "Addresses outside the chosen branch's service area", count: pv.outOfArea });
      box.innerHTML = `<div class="stats">
          <div class="stat"><div class="label">Customers</div><div class="value">${c.added + c.merged}</div><div class="sub">${c.added} new · ${c.merged} merged · ${c.skipped} skipped</div></div>
          <div class="stat"><div class="label">Recurring revenue, yearly</div><div class="value">${money(pv.recurringValue)}</div><div class="sub">${plural(pv.activePlans, 'active plan')}</div></div>
          <div class="stat ${c.plansWithoutVisits ? 'warn' : ''}"><div class="label">Visits scheduled</div><div class="value">${c.scheduled}</div><div class="sub">${c.plansWithoutVisits ? `${plural(c.plansWithoutVisits, 'plan')} with none` : 'from their plans'}</div></div>
          <div class="stat"><div class="label">History</div><div class="value">${pv.pastVisits}</div><div class="sub">past visits · ${f.chemicals} chemical records</div></div>
          <div class="stat ${pv.openBalance > 0 ? 'warn' : ''}"><div class="label">Open balances</div><div class="value">${money(pv.openBalance)}</div><div class="sub">${plural(c.invoices, 'invoice')} · ${plural(c.payments, 'payment')}</div></div>
        </div>
        ${warnings.length ? `<div class="alert warn" style="display:block"><b>Worth knowing</b><ul class="small" style="margin:6px 0 0">${warnings.map((w) => `<li>${esc(w.text)}${w.count > 1 ? ` (${w.count})` : ''}</li>`).join('')}</ul></div>` : '<div class="alert ok">Nothing looks off.</div>'}
        <h3>How the first accounts will look</h3>
        <div class="table-wrap"><table class="list small"><thead><tr><th>Customer</th><th>Address</th><th>Plan</th><th>Next visit</th><th>History</th><th class="right">Owes</th></tr></thead><tbody>
          ${r.report.sample.map((s) => `<tr><td><b>${esc(s.name)}</b>${s.company ? `<div class="muted">${esc(s.company)}</div>` : ''}<div class="muted">${esc([s.phone, s.email].filter(Boolean).join(' · '))}</div>
            ${s.status !== 'active' ? '<span class="pill">Inactive</span>' : ''} ${s.type === 'commercial' ? '<span class="pill">Commercial</span>' : ''}</td>
            <td>${s.address ? esc(s.address) : '<span class="pill yellow">No address</span>'}</td>
            <td>${s.plan ? `${esc(s.plan.service || '')}<div class="muted">${esc(FREQ[s.plan.frequency] || s.plan.frequency)} · ${s.plan.price ? money(s.plan.price) : '<b>no price</b>'}${s.plan.active ? '' : ' · off'}</div>` : '<span class="muted">None</span>'}</td>
            <td>${s.plan?.active ? fmtDate(s.plan.next) : ''}</td><td>${plural(s.visits, 'visit')}</td><td class="right">${s.owed ? money(s.owed) : ''}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="small muted">Something in the wrong place? Go back to Columns, change it, and check again.</p>`;
      const btn = $('#commit');
      btn.disabled = Boolean(r.alreadyImported);
      btn.textContent = `Import ${plural(c.added + c.merged, 'customer')}`;
    } catch (e) {
      if (turn !== dryTurn || !$('#dry')) return;
      box.innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
    }
  }

  async function commit(e) {
    e.target.disabled = true;
    e.target.textContent = 'Importing...';
    try {
      state.result = await api('/nuvolve/app/api/migrate/commit', { body: { ...request(), remember: rememberList() } });
      await refreshBoot();
      show(5);
    } catch (err) {
      toast(err.message, true);
      e.target.disabled = false;
      e.target.textContent = 'Import';
    }
  }

  // ---------- 5. done ----------
  function stepDone() {
    const r = state.result, c = r.counts;
    wiz().innerHTML = `<div class="card">
      <h2>Welcome to Nuvolve 🎉</h2>
      <p><b>${plural(c.added, 'customer')}</b> added${c.merged ? `, <b>${c.merged}</b> merged into accounts you had` : ''}${c.skipped ? `, ${c.skipped} skipped` : ''}.</p>
      <div class="stats">
        <div class="stat"><div class="label">Plans</div><div class="value">${c.plans}</div><div class="sub">${plural(c.scheduled, 'visit')} on the schedule</div></div>
        <div class="stat"><div class="label">Past and one-off visits</div><div class="value">${c.visits}</div></div>
        <div class="stat"><div class="label">Invoices</div><div class="value">${c.invoices}</div><div class="sub">${plural(c.payments, 'payment')}</div></div>
        <div class="stat"><div class="label">Added to your lists</div><div class="value">${(c.new_services || 0) + (c.new_products || 0) + (c.new_techs || 0)}</div><div class="sub">${plural(c.new_services || 0, 'service')} · ${plural(c.new_products || 0, 'product')} · ${plural(c.new_techs || 0, 'tech')}</div></div>
      </div>
      ${state.remember ? '<p class="small muted">Your column choices are saved for next time.</p>' : ''}
      <p class="small muted">Changed your mind? Undo it here or from Past moves. It takes out everything this move brought in.</p>
      <div class="actions"><a class="btn primary" href="#/customers">See the customers</a><a class="btn" href="#/schedule">See the schedule</a><button class="btn" id="undo-now">Undo this move</button></div>
    </div>`;
    $('#undo-now').onclick = () => undoMove(r.mergeId).catch((err) => toast(err.message, true));
  }

  // An undo takes everything the move brought in, including work done on those customers since. Say so first.
  async function undoMove(id) {
    const chk = await api(`/nuvolve/app/api/migrate/moves/${id}/check`);
    if (chk.undone_at) { toast('That move was already undone'); return route(); }
    const s = chk.since;
    const since = [s.completedVisits && plural(s.completedVisits, 'visit') + ' finished', s.payments && `${plural(s.payments, 'payment')} (${money(s.paymentsTotal)})`,
      s.invoices && plural(s.invoices, 'invoice')].filter(Boolean);
    modal('Undo this move?', `<p>Everything it brought in is removed: ${chk.counts ? `${plural(chk.counts.added, 'new customer')} and their` : 'the customers,'} plans, visits, invoices and payments, plus any services, products and techs it added that nothing else uses. Customers it merged into accounts you had stay, without the imported history.</p>
      ${since.length ? `<div class="alert warn" style="display:block"><b>Done since the move, and it goes too:</b> ${esc(since.join(', '))} on the customers it brought in.</div>` : ''}`,
    [{ label: 'Cancel' }, { label: 'Undo it', cls: 'primary', onClick: async () => { await api(`/nuvolve/app/api/merges/${id}/undo`, { method: 'POST' }); await refreshBoot(); toast('Move undone'); route(); } }]);
  }

  show(1);
}
