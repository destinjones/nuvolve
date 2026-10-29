// WDI (wood destroying insect) inspection form for real estate closings, laid out like the NPMA-33.
// The inspector fills it in on site, it saves as they go, and signing locks it and makes the share link.
const app = document.getElementById('app');
const id = new URLSearchParams(location.search).get('id');
const back = () => (history.length > 1 ? 'javascript:history.back()' : '/nuvolve/app/');
let W = null;
let ME = null;
let BOOT = null;
let saveTimer = null;

async function start() {
  try {
    [W, BOOT] = await Promise.all([api(`/nuvolve/app/api/termite/wdi/${id}`), api('/nuvolve/app/api/bootstrap')]);
    ME = BOOT.me;
    render();
  } catch (e) {
    app.innerHTML = `<div class="wrap"><div class="alert err">${esc(e.message)}</div><a class="btn" href="${back()}">Back</a></div>`;
  }
}

const isOffice = () => ME.role !== 'tech';
const d = () => W.data;
const txt = (name, label, opts = {}) => `<div class="field"><label>${label}</label>${opts.area
  ? `<textarea name="${name}" rows="${opts.rows || 2}" placeholder="${esc(opts.ph || '')}">${esc(d()[name] || '')}</textarea>`
  : `<input name="${name}" value="${esc(d()[name] || '')}" placeholder="${esc(opts.ph || '')}"${opts.type ? ` type="${opts.type}"` : ''}>`}</div>`;
const flag = (name, label, inner = '') => `<div class="field"><label class="check"><input type="checkbox" name="${name}" ${d()[name] ? 'checked' : ''}> ${label}</label>
  ${inner ? `<div class="sub-q ${d()[name] ? '' : 'hidden'}" data-for="${name}">${inner}</div>` : ''}</div>`;
const boxes = (group, list) => `<div class="boxes" data-group="${group}">${Object.entries(list).map(([k, l]) =>
  `<label><input type="checkbox" value="${k}" ${(d()[group] || []).includes(k) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>`;

function render() {
  if (W.status !== 'draft') return renderDone();
  const L = W.lists;
  app.innerHTML = `
    <div class="gtop"><a href="${back()}">← Back</a><b>WDI inspection #${W.id}${W.amends_id ? ` (amends #${W.amends_id})` : ''}</b>
      <span class="sub">${esc(W.property.address)} · ${esc(W.customer_name)}</span><span class="saved" id="saved">Draft saved</span></div>
    <div class="wrap" id="form">
      <div class="card sec">
        <div class="row">
          <div class="field"><label>Inspection date</label><input name="date" type="date" value="${esc(W.date)}" data-top></div>
          ${isOffice() ? `<div class="field"><label>Inspector</label><select name="inspector_id" data-top>${BOOT.techs.concat(BOOT.techs.some((t) => t.id === W.inspector_id) || !W.inspector ? [] : [W.inspector])
            .map((t) => `<option value="${t.id}" ${t.id === W.inspector_id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Inspection fee</label><input name="fee" type="number" step="0.01" inputmode="decimal" value="${W.fee ?? ''}" data-top ${W.invoice_id ? 'disabled title="Already billed"' : ''}></div>` : ''}
        </div>
        <div class="field"><label>Graph</label><div style="display:flex;gap:8px;flex-wrap:wrap">
          <select name="graph_id" data-top><option value="">No graph</option>${W.graphs.map((g) => `<option value="${g.id}" ${g.id === W.graph_id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>
          <a class="btn sm" href="/nuvolve/app/graph.html?property=${W.property_id}&new=0">📐 ${W.graphs.length ? 'Open or add graphs' : 'Draw a graph'}</a></div></div>
      </div>

      <div class="card sec"><h2>Section I. Who and what</h2><p class="lead">The structures you looked at and who gets the report.</p>
        ${txt('structures', 'Structures inspected', { ph: 'House and attached garage' })}
        <div class="row">${txt('buyer', 'Buyer')}${txt('seller', 'Seller')}</div>
        <div class="row">${txt('agent', 'Agent')}${txt('lender', 'Lender or title company')}</div>
        ${txt('send_to', 'Email the report to', { ph: 'agent@realty.com, buyer@email.com' })}
      </div>

      <div class="card sec"><h2>Section II. What you found</h2>
        <div class="found">
          <label><input type="radio" name="found" value="no" ${d().found === 'no' ? 'checked' : ''}> <span>A. No visible evidence of wood-destroying insects</span></label>
          <label><input type="radio" name="found" value="yes" ${d().found === 'yes' ? 'checked' : ''}> <span>B. Visible evidence observed</span></label>
        </div>
        <div id="found-yes" class="${d().found === 'yes' ? '' : 'hidden'}">
          ${flag('live', '1. Live insects', txt('live_desc', 'Where and what', { area: true, ph: 'Live subterranean termites in mud tubes, east garage wall' }))}
          ${flag('dead', '2. Dead insects, wings, frass, mud tubes or exit holes', txt('dead_desc', 'Where and what', { area: true }))}
          ${flag('damage', '3. Visible damage', txt('damage_desc', 'Where', { area: true, ph: 'Sill plate under kitchen window' }))}
          <label>Which insects</label>${boxes('insects', L.insects)}
        </div>
      </div>

      <div class="card sec"><h2>Section III. Treatment</h2>
        ${flag('previous_treatment', 'Signs of a previous treatment', txt('previous_desc', 'What you saw', { area: true, ph: 'Drill holes along front porch slab' }))}
        ${flag('treated_today', 'We treated the structure today', `<div class="row">${txt('treated_insect', 'Insect')}${txt('treated_product', 'Product')}</div>
          <div class="row">${txt('treated_method', 'Whole structure or spot treatment', { ph: 'Spot treatment, garage' })}${txt('notice_location', 'Treatment notice posted at')}</div>`)}
      </div>

      <div class="card sec"><h2>Section IV. Areas you could not inspect</h2><p class="lead">Tick anything that was blocked, and say why.</p>
        ${boxes('inaccessible', L.areas)}
        ${txt('inaccessible_desc', 'What was in the way', { area: true, ph: 'Attic hatch painted shut. Garage walls covered by storage.' })}
      </div>

      <div class="card sec"><h2>Section V. Conditions that attract termites</h2>
        ${boxes('conducive', L.conducive)}
        ${txt('conducive_desc', 'Details', { area: true })}
        ${txt('recommend', 'Recommendations', { area: true, ph: 'Treat the structure for subterranean termites. Correct the wood-to-soil contact at the rear deck.' })}
        ${txt('comments', 'Additional comments', { area: true })}
      </div>

      <div class="card sec"><h2>Sign and finish</h2>
        <div id="problems"></div>
        <div class="field"><label>Inspector signature${W.inspector ? `: ${esc(W.inspector.name)}` : ''}${W.inspector?.license_no ? ` (license ${esc(W.inspector.license_no)})` : ''}</label>
          <canvas class="sig" id="sig"></canvas><button type="button" class="link-btn small" id="sig-clear">Clear signature</button></div>
        ${isOffice() && W.inspector_id !== ME.id ? '<label class="check small"><input type="checkbox" id="behalf"> I am signing for the inspector, with their permission</label>' : ''}
        <p class="small muted">Signing locks the report and creates the link you send to the buyer, agent and lender.${W.fee > 0 && !W.invoice_id ? ` The ${money(W.fee)} fee is billed to ${esc(W.customer_name)}.` : ''}</p>
        <div class="actions"><button class="btn primary big" id="finish">✍️ Sign and finish</button>
          <a class="btn" href="/nuvolve/app/api/termite/wdi/${W.id}/view" target="_blank" rel="noopener">Preview report</a></div>
      </div>
    </div>`;
  const form = $('#form');
  const pad = signaturePad($('#sig'));
  $('#sig-clear').onclick = () => pad.clear();
  form.addEventListener('input', (e) => changed(e));
  form.addEventListener('change', (e) => changed(e));
  showProblems(W.problems);
  $('#finish').onclick = async (e) => {
    e.target.disabled = true;
    try {
      await flush();
      const signature = pad.value();
      if (!signature) throw new Error('Sign in the box first');
      await api(`/nuvolve/app/api/termite/wdi/${W.id}/finalize`, { body: { signature, on_behalf: $('#behalf')?.checked } });
      toast('Signed. The report is locked and ready to send.');
      W = await api(`/nuvolve/app/api/termite/wdi/${W.id}`);
      render();
    } catch (err) {
      toast(err.message, true);
    } finally { e.target.disabled = false; }
  };
}

function showProblems(list) {
  $('#problems').innerHTML = list.length ? `<div class="alert warn" style="display:block"><b>Still needed before signing:</b><ul class="problems">${list.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`
    : '<div class="alert ok">Everything needed is filled in.</div>';
}

function collect() {
  const form = $('#form');
  const data = {};
  for (const el of $$('[name]', form)) {
    if (el.dataset.top !== undefined) continue;
    if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; } else if (el.type === 'checkbox') data[el.name] = el.checked;
    else data[el.name] = el.value.trim();
  }
  for (const g of $$('[data-group]', form)) data[g.dataset.group] = $$('input:checked', g).map((i) => i.value);
  const top = {};
  for (const el of $$('[data-top]', form)) if (!el.disabled) top[el.name] = el.value;
  return { data, ...top };
}

function changed(e) {
  const t = e.target;
  if (t.name === 'found') $('#found-yes').classList.toggle('hidden', t.value !== 'yes');
  if (t.type === 'checkbox' && t.name) $(`[data-for="${t.name}"]`)?.classList.toggle('hidden', !t.checked);
  if (!t.name && !t.closest('[data-group]')) return;
  clearTimeout(saveTimer);
  $('#saved').textContent = 'Saving...';
  saveTimer = setTimeout(flush, 800);
}

async function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    const body = collect();
    const r = await api(`/nuvolve/app/api/termite/wdi/${W.id}`, { method: 'PUT', body });
    Object.assign(W, { graph_id: Number(body.graph_id) || null, inspector_id: Number(body.inspector_id) || W.inspector_id });
    $('#saved').textContent = 'Draft saved';
    showProblems(r.problems);
  } catch (err) {
    $('#saved').textContent = 'Not saved';
    toast(err.message, true);
    throw err;
  }
}
window.addEventListener('beforeunload', (e) => { if (saveTimer) { e.preventDefault(); e.returnValue = ''; } });

// A signed report can be viewed, sent, and amended, but not edited.
function renderDone() {
  const done = W.status === 'final';
  app.innerHTML = `
    <div class="gtop"><a href="${back()}">← Back</a><b>WDI inspection #${W.id}</b><span class="sub">${esc(W.property.address)} · ${esc(W.customer_name)}</span></div>
    <div class="wrap"><div class="card">
      <h2>${done ? '✅ Signed and locked' : 'Voided'}</h2>
      <p>Inspected ${fmtDate(W.date)}${W.inspector ? ` by ${esc(W.inspector.name)}` : ''}. ${W.data.found === 'yes' ? '<b>Evidence of wood-destroying insects was found.</b>' : 'No visible evidence was found.'}</p>
      ${done ? `<div class="field"><label>Share link</label><div style="display:flex;gap:8px"><input readonly value="${esc(W.share_url)}" id="link"><button class="btn" id="copy">Copy</button></div></div>` : ''}
      <div class="actions">
        <a class="btn primary" href="/nuvolve/app/api/termite/wdi/${W.id}/view" target="_blank" rel="noopener">📄 View report</a>
        ${done && isOffice() ? '<button class="btn" id="send">✉️ Email it</button>' : ''}
        ${done ? '<button class="btn" id="amend">Amend</button>' : ''}
      </div>
      <p class="small muted">Need to change something? Amend makes a new draft. When it's signed, the old link says it was replaced.</p>
    </div></div>`;
  if ($('#copy')) $('#copy').onclick = () => { $('#link').select(); (navigator.clipboard?.writeText(W.share_url) || Promise.resolve()).then(() => toast('Copied')); };
  if ($('#send')) $('#send').onclick = () => modal('Email the report', `<div class="field"><label>To</label><input name="to" value="${esc(W.data.send_to || '')}" placeholder="agent@realty.com, buyer@email.com"></div>
      <label class="check"><input type="checkbox" name="include_customer" ${W.customer_email ? 'checked' : 'disabled'}> Also send to ${esc(W.customer_name)}${W.customer_email ? ` (${esc(W.customer_email)})` : ' (no email on file)'}</label>`,
  [{ label: 'Cancel' }, { label: 'Send', cls: 'primary', onClick: async (m) => {
    const r = await api(`/nuvolve/app/api/termite/wdi/${W.id}/send`, { body: formData(m) });
    toast(r.sent.every((s) => s.status === 'logged') ? `Written to the outbox for ${r.sent.length} (email not connected yet)` : `Sent to ${r.sent.length}`);
  } }]);
  if ($('#amend')) $('#amend').onclick = async () => {
    const r = await api(`/nuvolve/app/api/termite/wdi/${W.id}/amend`, { method: 'POST' });
    location.href = `/nuvolve/app/wdi.html?id=${r.id}`;
  };
}

start();
