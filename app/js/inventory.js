// Inventory: what's in the warehouse and on each truck, what to reorder, and what each truck needs loaded.

const qtyFmt = (n) => (n == null ? '' : String(Math.round(Number(n) * 100) / 100));

async function pageInventory(view) {
  const d = await api('/nuvolve/app/api/inventory');
  const trucks = d.places.filter((p) => p.kind === 'truck');
  const tracked = d.products.filter((p) => p.tracked);
  view.innerHTML = `
    <div class="page-head"><div><h1>Inventory</h1><div class="muted">Chemical in the warehouse and on every truck. Product on a ticket comes off the tech's truck automatically.</div></div>
      <div class="actions"><button class="btn" id="inv-move">⇄ Move stock</button><button class="btn" id="inv-receive">+ Received an order</button>
        ${BOOT.me.isManager ? '<button class="btn" id="inv-truck">+ Add truck</button>' : ''}</div></div>

    <div class="stats">
      <div class="stat ${d.reorder.length ? 'warn' : ''}"><div class="label">To reorder</div><div class="value">${d.reorder.length}</div><div class="sub">${d.order_total ? `About ${money(d.order_total)}` : 'Below their reorder point'}</div></div>
      <div class="stat ${d.restock.length ? 'warn' : ''}"><div class="label">Trucks to restock</div><div class="value">${d.restock.length}</div><div class="sub">of ${trucks.length} truck${trucks.length === 1 ? '' : 's'}</div></div>
      <div class="stat"><div class="label">Products tracked</div><div class="value">${tracked.length}</div><div class="sub">of ${d.products.length} active</div></div>
      <div class="stat"><div class="label">Stock value</div><div class="value">${d.value ? money(d.value) : '—'}</div><div class="sub">${d.value ? 'At your cost' : 'Add unit costs to see this'}</div></div>
    </div>

    ${d.reorder.length ? `<div class="card flush" id="reorder"><div class="card-head" style="padding:16px 16px 0"><div><h2>Reorder list</h2><div class="small muted">Everything below its reorder point, with how much to buy.</div></div>
      <button class="btn sm" id="inv-print">🖨️ Print order</button></div>
      <div class="table-wrap"><table class="list"><thead><tr><th>Product</th><th>Vendor</th><th class="right">On hand</th><th class="right">Reorder at</th><th class="right">Order</th><th class="right">Est. cost</th><th class="right">Lasts</th></tr></thead><tbody>
      ${d.reorder.map((p) => { const lv = d.products.find((x) => x.id === p.id); return `<tr><td><b>${esc(p.name)}</b>${p.epa_reg ? `<div class="small muted">EPA ${esc(p.epa_reg)}</div>` : ''}</td><td>${esc(p.vendor || '')}</td>
        <td class="right" style="color:var(--danger)"><b>${qtyFmt(p.on_hand)} ${esc(p.unit)}</b></td><td class="right">${qtyFmt(p.low_stock)}</td>
        <td class="right"><b>${qtyFmt(p.order_qty)} ${esc(p.unit)}</b></td><td class="right">${p.est_cost != null ? money(p.est_cost) : '—'}</td>
        <td class="right small">${lv?.weeks_left != null ? `${lv.weeks_left} wk` : '—'}</td></tr>`; }).join('')}</tbody></table></div></div>` : ''}

    ${d.restock.length ? `<div class="card"><h2>Load the trucks</h2><div class="small muted" style="margin-bottom:8px">Trucks under their truck levels. Loading moves it out of the warehouse.</div>
      ${d.restock.map((t) => `<div style="padding:10px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
        <div><b>🚚 ${esc(t.name)}</b>${t.tech_name ? ` <span class="small muted">· ${esc(t.tech_name)}</span>` : ''}
          <div class="small">${t.items.map((i) => `${esc(i.name)}: <b>${qtyFmt(i.need)} ${esc(i.unit)}</b>`).join(' · ')}</div></div>
        <button class="btn sm primary" data-load="${t.id}">Loaded it</button></div>`).join('')}</div>` : ''}

    <div class="card flush"><div class="card-head" style="padding:16px 16px 0"><div><h2>Stock by location</h2><div class="small muted">Click a number to count it, set a truck level, or see its history.</div></div></div>
      <div class="table-wrap"><table class="list"><thead><tr><th>Product</th>${d.places.map((pl) => `<th class="right nowrap">${pl.kind === 'truck' ? '🚚' : '🏭'} <a href="#" data-place="${pl.id}">${esc(pl.name)}</a>${pl.tech_name ? `<div class="small muted">${esc(pl.tech_name)}</div>` : ''}</th>`).join('')}<th class="right">Total</th><th class="right">Use / week</th></tr></thead><tbody>
      ${d.products.map((p) => `<tr><td><b>${esc(p.name)}</b>${p.restricted_use ? ' <span class="pill red" title="Restricted use pesticide">RUP</span>' : ''}
          <div class="small">${p.label_url ? `<a href="${esc(p.label_url)}" target="_blank" rel="noopener">Label</a>` : ''}${p.label_url && p.sds_url ? ' · ' : ''}${p.sds_url ? `<a href="${esc(p.sds_url)}" target="_blank" rel="noopener">SDS</a>` : ''}</div></td>
        ${d.places.map((pl) => { const q = p.at[pl.id]; const par = p.par[pl.id]; const low = par != null && (q || 0) < par;
          return `<td class="right nowrap"><a href="#" class="${low ? 'danger-text' : ''}" style="${low ? 'color:var(--danger);font-weight:700' : ''}" data-cell="${p.id}:${pl.id}">${q != null || par != null ? qtyFmt(q || 0) : '<span class="muted">—</span>'}</a>${par != null ? `<div class="small muted">level ${qtyFmt(par)}</div>` : ''}</td>`; }).join('')}
        <td class="right nowrap">${p.tracked ? `<b style="${p.low ? 'color:var(--danger)' : ''}">${qtyFmt(p.total)} ${esc(p.unit)}</b>` : '<span class="small muted">Not tracked</span>'}</td>
        <td class="right small">${p.per_week ? `${qtyFmt(p.per_week)} ${esc(p.unit)}` : '—'}</td></tr>`).join('') || `<tr><td colspan="${d.places.length + 3}" class="muted">No products yet. Add them in Settings → Products.</td></tr>`}
      </tbody></table></div></div>
    ${!trucks.length ? '<div class="alert info">Add a truck for each tech and what they use comes off their truck instead of the warehouse. Set truck levels and the restock list tells you what to load each morning.</div>' : ''}`;

  const product = (id) => d.products.find((p) => p.id === Number(id));
  const place = (id) => d.places.find((p) => p.id === Number(id));
  const placeOptions = (sel) => d.places.map((pl) => `<option value="${pl.id}" ${pl.id === sel ? 'selected' : ''}>${esc(pl.name)}</option>`).join('');
  const productOptions = (sel) => d.products.map((p) => `<option value="${p.id}" data-unit="${esc(p.unit)}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const unitSelect = (unit) => `<select name="unit">${UNITS.map((u) => `<option ${u === unit ? 'selected' : ''}>${u}</option>`).join('')}</select>`;
  const syncUnit = (m) => { const s = $('[name=product_id]', m); if (s) s.onchange = () => { $('[name=unit]', m).value = s.selectedOptions[0]?.dataset.unit || 'oz'; }; };
  const warehouse = d.places.find((p) => p.kind === 'warehouse');

  const move = (pre = {}) => {
    const first = product(pre.product_id) || d.products[0];
    const m = modal('Move stock', `
      <div class="field"><label>Product</label><select name="product_id">${productOptions(first?.id)}</select></div>
      <div class="row"><div class="field"><label>From</label><select name="from_id">${placeOptions(pre.from_id ?? warehouse?.id)}</select></div>
        <div class="field"><label>To</label><select name="to_id">${placeOptions(pre.to_id ?? trucks[0]?.id)}</select></div></div>
      <div class="row"><div class="field"><label>Amount</label><input name="qty" type="number" step="0.01" min="0"></div><div class="field"><label>Unit</label>${unitSelect(first?.unit)}</div></div>
      <div class="field"><label>Note (optional)</label><input name="note" placeholder="Monday load-out"></div>`,
    [{ label: 'Cancel' }, { label: 'Move it', cls: 'primary', onClick: async (el) => {
      const r = await api('/nuvolve/app/api/stock-transfers', { body: formData(el) });
      toast(`Moved. ${r.to} left at the destination.`); route();
    } }]);
    syncUnit(m.el);
  };

  const receive = () => {
    const m = modal('Received an order', `
      <div class="field"><label>Product</label><select name="product_id">${productOptions(d.products[0]?.id)}</select></div>
      <div class="row"><div class="field"><label>Amount</label><input name="qty" type="number" step="0.01" min="0"></div><div class="field"><label>Unit</label>${unitSelect(d.products[0]?.unit)}</div>
        <div class="field"><label>Put it in</label><select name="place_id">${placeOptions(warehouse?.id)}</select></div></div>
      <div class="field"><label>Note</label><input name="note" placeholder="Supplier invoice #"></div>`,
    [{ label: 'Cancel' }, { label: 'Add to stock', cls: 'primary', onClick: async (el) => {
      const b = formData(el);
      await api(`/nuvolve/app/api/products/${b.product_id}/stock`, { body: { ...b, reason: 'purchase' } });
      toast('Added to stock'); route();
    } }]);
    syncUnit(m.el);
  };

  // One product at one place: count it, set its truck level, see what happened to it.
  const cell = async (productId, placeId) => {
    const p = product(productId), pl = place(placeId);
    const h = await api(`/nuvolve/app/api/products/${p.id}/stock`);
    const moves = h.moves.filter((x) => x.place_id === pl.id);
    modal(`${p.name} · ${pl.name}`, `
      <p>On hand here: <b>${qtyFmt(p.at[pl.id] || 0)} ${esc(p.unit)}</b> · company total ${qtyFmt(p.total)} ${esc(p.unit)}</p>
      <div class="row"><div class="field"><label>Shelf count (what's really here)</label><input name="count" type="number" step="0.01" min="0" placeholder="${qtyFmt(p.at[pl.id] || 0)}"></div>
        <div class="field"><label>Unit</label>${unitSelect(p.unit)}</div></div>
      ${pl.kind === 'truck' ? `<div class="field"><label>Truck level (${esc(p.unit)})</label><input name="par" type="number" step="0.01" min="0" value="${p.par[pl.id] ?? ''}">
        <div class="hint">How much this truck should leave the shop with. Under it, the truck shows up on the restock list.</div></div>` : ''}
      ${moves.length ? `<div class="table-wrap" style="max-height:220px;overflow:auto"><table class="list small"><tbody>${moves.map((x) => `<tr><td>${fmtDate(x.created_at)}</td>
        <td>${({ use: `Used${x.visit_date ? ` on ${fmtDate(x.visit_date)}` : ''}`, count: 'Shelf count', purchase: 'Bought', transfer: 'Moved' })[x.reason] || x.reason}${x.user_name ? ` · ${esc(x.user_name)}` : ''}${x.note ? ` · ${esc(x.note)}` : ''}</td>
        <td class="right">${x.qty > 0 ? '+' : ''}${qtyFmt(x.qty)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">Nothing recorded here yet.</p>'}`,
    [{ label: 'Close' }, { label: 'Move…', onClick: () => { move({ product_id: p.id, from_id: pl.id, to_id: pl.kind === 'truck' ? warehouse?.id : trucks[0]?.id }); } },
      { label: 'Save', cls: 'primary', onClick: async (el) => {
        const b = formData(el);
        if (b.count !== '') await api(`/nuvolve/app/api/products/${p.id}/stock`, { body: { reason: 'count', qty: b.count, unit: b.unit, place_id: pl.id } });
        if (pl.kind === 'truck' && b.par !== String(p.par[pl.id] ?? '')) await api(`/nuvolve/app/api/stock-places/${pl.id}/par`, { method: 'PUT', body: { product_id: p.id, par: b.par } });
        toast('Saved'); route();
      } }]);
  };

  const editPlace = (pl = { kind: 'truck', active: 1 }) => modal(pl.id ? `Edit ${pl.name}` : 'Add a truck', `
    <div class="field"><label>Name</label><input name="name" value="${esc(pl.name || '')}" placeholder="Truck 3"></div>
    ${pl.kind === 'truck' ? `<div class="field"><label>Driven by</label><select name="user_id"><option value="">Nobody yet</option>${d.techs.map((t) => `<option value="${t.id}" ${t.id === pl.user_id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      <div class="hint">What this tech logs on tickets comes off this truck.</div></div>` : ''}
    ${pl.id ? `<label class="check"><input type="checkbox" name="active" ${pl.active ? 'checked' : ''}> In use</label>` : ''}`,
  [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (el) => {
    const b = formData(el);
    if (pl.id) await api(`/nuvolve/app/api/stock-places/${pl.id}`, { method: 'PUT', body: b });
    else await api('/nuvolve/app/api/stock-places', { body: { ...b, kind: pl.kind } });
    toast('Saved'); route();
  } }]);

  $('#inv-move').onclick = () => move();
  $('#inv-receive').onclick = receive;
  if ($('#inv-truck')) $('#inv-truck').onclick = () => editPlace();
  if ($('#inv-print')) $('#inv-print').onclick = () => printOrder(d.reorder);
  $$('[data-load]', view).forEach((b) => (b.onclick = async () => {
    try {
      const r = await api(`/nuvolve/app/api/stock-places/${b.dataset.load}/load`, { method: 'POST' });
      toast(r.short.length ? `Loaded. ${r.from} was short on ${r.short.map((s) => s.name).join(', ')}.` : 'Truck loaded', Boolean(r.short.length));
      route();
    } catch (e) { toast(e.message, true); }
  }));
  $$('[data-cell]', view).forEach((a) => (a.onclick = (e) => { e.preventDefault(); const [p, pl] = a.dataset.cell.split(':'); cell(p, pl).catch((err) => toast(err.message, true)); }));
  $$('[data-place]', view).forEach((a) => (a.onclick = (e) => {
    e.preventDefault();
    if (!BOOT.me.isManager) return;
    editPlace(place(a.dataset.place));
  }));
}

// A clean purchase order to hand the supplier rep or email.
function printOrder(rows) {
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to print the order', true);
  const byVendor = {};
  for (const r of rows) (byVendor[r.vendor || 'Any supplier'] ||= []).push(r);
  w.document.write(`<!doctype html><title>Chemical order</title><style>body{font:14px system-ui,sans-serif;margin:32px}table{border-collapse:collapse;width:100%;margin-bottom:24px}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left}.r{text-align:right}</style>
    <h1>Chemical order · ${esc(BOOT.company?.name || '')}</h1><p>${fmtDate(todayStr())}</p>
    ${Object.entries(byVendor).map(([v, list]) => `<h2>${esc(v)}</h2><table><tr><th>Product</th><th>EPA Reg. No.</th><th class="r">Quantity</th><th class="r">Est. cost</th></tr>
      ${list.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.epa_reg || '')}</td><td class="r">${qtyFmt(r.order_qty)} ${esc(r.unit)}</td><td class="r">${r.est_cost != null ? money(r.est_cost) : ''}</td></tr>`).join('')}</table>`).join('')}`);
  w.document.close();
  w.focus();
  w.print();
}

// Search the EPA label database from the product form and fill in what it finds.
async function epaLookupInto(form) {
  const q = ($('[name=epa_reg]', form).value || $('[name=name]', form).value || '').trim();
  const out = $('#epa-results', form);
  out.innerHTML = '<p class="small muted">Searching the EPA label database…</p>';
  let results;
  try { results = (await api(`/nuvolve/app/api/epa/lookup?q=${encodeURIComponent(q)}`)).results; } catch (e) { out.innerHTML = `<div class="alert err small">${esc(e.message)}</div>`; return; }
  if (!results.length) { out.innerHTML = '<p class="small muted">No EPA product matched. Check the Reg. No. on the label.</p>'; return; }
  out.innerHTML = `<div class="table-wrap" style="max-height:220px;overflow:auto"><table class="list small"><tbody>${results.map((r, i) => `<tr>
    <td><b>${esc(r.name || '')}</b> <span class="muted">EPA ${esc(r.epa_reg)}</span>${r.restricted_use ? ' <span class="pill red">RUP</span>' : ''}${r.status && String(r.status).toLowerCase() !== 'active' ? ` <span class="pill">${esc(r.status)}</span>` : ''}
      <div class="muted">${esc(r.registrant || '')}${r.active_ingredient ? ` · ${esc(r.active_ingredient)}` : ''}</div></td>
    <td class="right"><button type="button" class="btn sm" data-use="${i}">Use</button></td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-use]', out).forEach((b) => (b.onclick = () => {
    const r = results[Number(b.dataset.use)];
    const set = (name, v) => { const el = $(`[name=${name}]`, form); if (el && v != null && v !== '') { if (el.type === 'checkbox') el.checked = Boolean(v); else el.value = v; } };
    if (!$('[name=name]', form).value) set('name', r.name);
    set('epa_reg', r.epa_reg); set('active_ingredient', r.active_ingredient); set('label_url', r.label_url);
    set('signal_word', r.signal_word); set('registrant', r.registrant); set('epa_status', r.status);
    const rup = $('[name=restricted_use]', form); if (rup) rup.checked = r.restricted_use;
    out.innerHTML = `<div class="alert info small">Filled in from EPA. ${r.ppls_url ? `<a href="${esc(r.ppls_url)}" target="_blank" rel="noopener">EPA record</a> · ` : ''}${r.label_url ? `<a href="${esc(r.label_url)}" target="_blank" rel="noopener">Label PDF</a> · ` : ''}<a href="${esc(r.sds_search_url)}" target="_blank" rel="noopener">Find the SDS</a> and paste its link below.</div>`;
  }));
}
