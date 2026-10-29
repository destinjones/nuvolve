// Documents: the library of designs (templates and one-off documents), the send window, and the helpers other
// pages use to make a document for a customer, invoice or visit. The editor itself is in builder-editor.js.
// Pages are drawn by DocRender (docrender.js), the same code the server uses for PDFs, emails and links.

let DOCMETA = null;
async function docMeta(fresh) {
  if (!DOCMETA || fresh) DOCMETA = await api('/nuvolve/app/api/docs/meta');
  return DOCMETA;
}
const DOC_RECORD = { customer: 'customer_id', invoice: 'invoice_id', visit: 'visit_id', estimate: 'estimate_id' };
const DOC_DEFAULT_SOURCE = { invoice: 'invoice', service_report: 'visit', pesticide_report: 'applications', contract: 'estimate' };
const DOC_COLORS = ['#2f855a', '#276749', '#0f766e', '#2b6cb0', '#1a365d', '#6b46c1', '#c53030', '#c05621', '#b7791f', '#2d3748'];

// The shared document styles, added to the office app once.
function docBaseCss() {
  if ($('#nv-base-css')) return;
  const s = document.createElement('style');
  s.id = 'nv-base-css';
  s.textContent = DocRender.BASE_CSS;
  document.head.appendChild(s);
}

// QR codes in the browser use the same library the server uses, loaded the first time a page needs it.
let qrLoading = null;
function loadQr() {
  if (window.QRCode) return Promise.resolve();
  qrLoading = qrLoading || new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = '/nuvolve/app/vendor/qrcode/qrcode.min.js';
    s.onload = resolve;
    s.onerror = resolve;
    document.head.appendChild(s);
  });
  return qrLoading;
}
const qrCache = new Map();
function docQr(text) {
  if (!window.QRCode || !text) return '';
  if (!qrCache.has(text)) {
    try {
      const svg = new window.QRCode({ content: text, padding: 2, join: true, container: 'svg-viewbox', ecl: 'M' }).svg();
      qrCache.set(text, `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`);
    } catch { qrCache.set(text, ''); }
    if (qrCache.size > 200) qrCache.delete(qrCache.keys().next().value);
  }
  return qrCache.get(text);
}
const docAsset = (id) => `/nuvolve/app/api/docs/assets/${Number(id)}`;
const docRenderOpts = (source, extra = {}) => {
  const cat = DOCMETA.sources[source] || DOCMETA.sources.none;
  return { types: cat.types, labels: cat.labels, asset: docAsset, qr: docQr, ...extra };
};
const docSample = (source, title = '') => ({ ...(DOCMETA.samples[source] || DOCMETA.samples.none), doc: { title } });
const docPaperSize = (design) => {
  const s = DocRender.PAGE_SIZES[design.page.size] || DocRender.PAGE_SIZES.letter;
  return design.page.orientation === 'landscape' ? { w: s.h * 96, h: s.w * 96 } : { w: s.w * 96, h: s.h * 96 };
};

// A small picture of the first page, drawn with sample data.
function docThumb(designIn, source) {
  const d = DocRender.normalize(designIn || {});
  const { w, h } = docPaperSize(d);
  const m = d.page.margin;
  let inner = '';
  try { inner = DocRender.render(d, docSample(source), docRenderOpts(source, { normalized: true })); } catch { inner = ''; }
  return `<div class="paper" data-pw="${w}" style="width:${w}px;height:${h}px;margin-left:${-w / 2}px;padding:${m.t * 96}px ${m.r * 96}px ${m.b * 96}px ${m.l * 96}px">${inner}</div>`;
}
function fitThumbs(root) {
  $$('.thumb .paper', root).forEach((p) => { p.style.transform = `scale(${Math.max(0.05, (p.parentElement.clientWidth - 28) / Number(p.dataset.pw))})`; });
}

function docAgo(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'));
  const min = Math.round((Date.now() - d) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.round(hr / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

// Resolves when a modal is closed any way (button, Escape, click outside, leaving the page).
function onModalGone(m, fn) {
  const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); fn(); } });
  obs.observe(document.body, { childList: true });
}

// Pictures for documents: keeps PNG transparency for logos, shrinks big photos.
async function docImageData(file, max = 1600) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Use a PNG, JPEG or WebP picture');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That file isn't a picture")); i.src = url; });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return file.type === 'image/jpeg' ? c.toDataURL('image/jpeg', 0.86) : c.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}
async function uploadDocImage(file, max) {
  const data = await docImageData(file, max);
  return api('/nuvolve/app/api/docs/assets', { body: { data, name: file.name.slice(0, 100) } });
}

// ---------- the library ----------
async function pageDocuments(view, id, params = {}) {
  if (id) return pageBuilder(view, id, params);
  docBaseCss();
  const [meta] = await Promise.all([docMeta(true), loadQr()]);
  const tab = ['templates', 'documents', 'contracts', 'sent', 'archived'].includes(params.tab) ? params.tab : 'templates';
  view.innerHTML = `
    <div class="page-head"><div><h1>Documents</h1>
      <p class="muted" style="margin:0;max-width:720px">Design your own invoices, service reports, state pesticide records, contracts, letters and anything else.
      Templates fill in from your records. One-off documents are made once and sent from right here. Contracts are signed online or in person.</p></div>
      <div class="actions">${meta.isAdmin ? '<button class="btn" id="d-brand">🎨 Brand kit</button>' : ''}<button class="btn" id="d-import">Import</button><button class="btn primary" id="d-new">+ New</button></div></div>
    <div class="tabs">${[['templates', 'Templates'], ['documents', 'One-off documents'], ['contracts', 'Contracts'], ['sent', 'Sent'], ['archived', 'Archived']]
    .map(([k, l]) => `<a href="#/documents?tab=${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div id="d-body"><p class="muted">Loading...</p></div>`;
  $('#d-new').onclick = () => newDocModal({ purpose: tab === 'documents' ? 'document' : undefined });
  $('#d-import').onclick = importDocModal;
  if ($('#d-brand')) $('#d-brand').onclick = () => brandKitModal(() => route());
  const body = $('#d-body');
  if (tab === 'sent') return sentList(body);
  if (tab === 'contracts') return contractList(body);

  const purpose = tab === 'documents' ? 'document' : tab === 'templates' ? 'template' : '';
  const rows = await api(`/nuvolve/app/api/docs/designs?full=1${purpose ? `&purpose=${purpose}` : ''}${tab === 'archived' ? '&archived=1' : ''}`);
  const kinds = Object.entries(meta.kinds);
  const defaults = tab === 'templates' ? `<div class="doc-defaults">${kinds.filter(([, k]) => k.defaultable).map(([k, kd]) => {
    const opts = rows.filter((r) => r.kind === k && r.version && r.source === DOC_DEFAULT_SOURCE[k]);
    const cur = meta.defaults[k];
    return `<div class="doc-default"><div class="k">${esc(kd.label)} everyone gets</div>
      ${meta.isAdmin ? `<select data-default="${k}"><option value="">Built-in Nuvolve design</option>${opts.map((o) => `<option value="${o.id}" ${o.id === cur ? 'selected' : ''}>${esc(o.name)} (v${o.version})</option>`).join('')}</select>`
    : `<div style="margin-top:6px;font-weight:600">${esc(rows.find((r) => r.id === cur)?.name || 'Built-in Nuvolve design')}</div>`}
      <div class="hint">${esc(kd.defaultHelp)}${!opts.length && meta.canDesign ? ` Publish a ${esc(kd.label.toLowerCase())} template to pick it here.` : ''}</div></div>`;
  }).join('')}</div>` : '';
  body.innerHTML = `${defaults}
    <div class="doc-tools"><input id="d-q" placeholder="🔍 Find by name${tab === 'documents' ? ' or customer' : ''}" autocomplete="off">
      <select id="d-kind"><option value="">Every kind</option>${kinds.map(([k, kd]) => `<option value="${k}" ${params.kind === k ? 'selected' : ''}>${esc(kd.label)}</option>`).join('')}</select>
      <span class="small muted" id="d-count"></span></div>
    <div class="doc-grid" id="d-grid"></div>`;
  $$('[data-default]', body).forEach((sel) => (sel.onchange = async () => {
    try {
      const r = await api('/nuvolve/app/api/docs/defaults', { method: 'PUT', body: { kind: sel.dataset.default, design_id: Number(sel.value) || null } });
      meta.defaults = r.defaults;
      toast(sel.value ? 'Done. That template is used everywhere now.' : 'Back to the built-in design');
    } catch (e) { toast(e.message, true); sel.value = meta.defaults[sel.dataset.default] || ''; }
  }));

  const statusPills = (r) => {
    const st = r.purpose === 'document' ? (r.status === 'sent' ? '<span class="pill green">Sent</span>' : '<span class="pill">Draft</span>')
      : r.version ? (r.dirty ? `<span class="pill yellow">v${r.version} · unpublished changes</span>` : `<span class="pill green">Published v${r.version}</span>`) : '<span class="pill">Draft</span>';
    return st + r.defaultFor.map((k) => `<span class="pill blue">Default ${esc((meta.kinds[k]?.label || k).toLowerCase())}</span>`).join('')
      + (r.sends ? `<span class="pill">${r.sends} sent</span>` : '');
  };
  const card = (r) => `<div class="doc-card" role="button" tabindex="0" data-id="${r.id}">
    <div class="thumb">${docThumb(r.draft, r.source)}</div>
    <div class="meta"><b>${esc(r.name)}</b>
      <span class="small">${esc(meta.kinds[r.kind]?.label || 'Other')} · from ${esc((meta.sources[r.source]?.short || '').toLowerCase())}${r.record_title ? ` · ${esc(r.record_title)}` : ''}</span>
      <div class="tags">${statusPills(r)}</div>
      <span class="small">Edited ${esc(docAgo(r.updated_at))}${r.updated_by_name ? ` by ${esc(r.updated_by_name)}` : ''}</span>
      ${tab === 'archived' && r.canEdit ? `<button class="btn sm" data-restore="${r.id}" style="margin-top:6px;align-self:flex-start">Restore</button>` : ''}</div></div>`;
  const newCard = tab === 'archived' ? '' : `<div class="doc-card new-card" role="button" tabindex="0" id="d-newcard"><span class="plus">+</span>${tab === 'documents' ? 'New one-off document' : 'New template'}</div>`;
  const grid = $('#d-grid');
  const draw = () => {
    const q = $('#d-q').value.trim().toLowerCase();
    const k = $('#d-kind').value;
    const list = rows.filter((r) => (!q || r.name.toLowerCase().includes(q) || (r.record_title || '').toLowerCase().includes(q)) && (!k || r.kind === k));
    $('#d-count').textContent = rows.length ? `${list.length} of ${rows.length}` : '';
    grid.innerHTML = (q || k ? '' : newCard) + list.map(card).join('');
    if (!list.length && (q || k || tab === 'archived')) grid.insertAdjacentHTML('beforeend', `<p class="muted">${tab === 'archived' && !q && !k ? 'Nothing archived.' : 'Nothing matches.'}</p>`);
    fitThumbs(grid);
    $$('.doc-card[data-id]', grid).forEach((c) => {
      const open = () => { location.hash = `#/documents/${c.dataset.id}`; };
      c.onclick = (e) => { if (!e.target.closest('[data-restore]')) open(); };
      c.onkeydown = (e) => { if (e.key === 'Enter') open(); };
    });
    $$('[data-restore]', grid).forEach((b) => (b.onclick = async () => {
      try { await api(`/nuvolve/app/api/docs/designs/${b.dataset.restore}/unarchive`, { method: 'POST' }); toast('Restored'); route(); } catch (e) { toast(e.message, true); }
    }));
    if ($('#d-newcard')) {
      $('#d-newcard').onclick = () => newDocModal({ purpose: tab === 'documents' ? 'document' : undefined });
      $('#d-newcard').onkeydown = (e) => { if (e.key === 'Enter') $('#d-newcard').click(); };
    }
  };
  $('#d-q').oninput = draw;
  $('#d-kind').onchange = draw;
  draw();
  if (!rows.length && tab === 'templates' && meta.canDesign) newDocModal({ purpose: 'template', welcome: true });
}

// Everything sent or shared, newest first.
async function sentList(body, { designId, customerId, compact = false } = {}) {
  const meta = await docMeta();
  const q = new URLSearchParams({ ...(designId ? { design_id: designId } : {}), ...(customerId ? { customer_id: customerId } : {}), limit: compact ? 20 : 200 });
  const rows = await api(`/nuvolve/app/api/docs/sends?${q}`);
  const SIGN_LABEL = { awaiting: 'Waiting for signature', signed: 'Signed', cancelled: 'Cancelled', declined: 'Declined', void: 'Voided', expired: 'Link expired' };
  const pill = (s) => {
    if (s.sign_status) return signPill(s.sign_status, SIGN_LABEL[s.sign_status]);
    if (s.revoked_at) return '<span class="pill">Link turned off</span>';
    if (s.channel === 'link') return '<span class="pill blue">Link made</span>';
    if (s.status === 'sent') return '<span class="pill green">Sent</span>';
    if (s.status === 'failed') return `<span class="pill red" title="${esc(s.error || '')}">Didn't send</span>`;
    return '<span class="pill yellow" title="Email is not set up yet, so it was saved to the Outbox">In Outbox</span>';
  };
  if (!rows.length) {
    body.innerHTML = compact ? '<p class="muted small">Nothing sent yet.</p>' : `<div class="empty"><div class="big">📭</div><h3>Nothing sent yet</h3><p>Open any document and press <b>Send</b> to email it, text it, or make a link.</p></div>`;
    return;
  }
  body.innerHTML = `<div class="${compact ? '' : 'card flush'}"><div class="table-wrap"><table class="list sent-table"><thead><tr><th>When</th><th>Document</th>${compact ? '' : '<th>By</th>'}<th>To</th><th>Status</th>${compact ? '' : '<th class="right">Opened</th>'}<th></th></tr></thead><tbody>
    ${rows.map((s) => `<tr>
      <td class="nowrap">${esc(docAgo(s.created_at))}</td>
      <td><b>${esc(s.title)}</b>${s.version ? ` <span class="small muted">v${s.version}</span>` : ''}</td>
      ${compact ? '' : `<td class="small">${esc(s.created_by_name || '')}</td>`}
      <td class="small">${s.channel === 'link' ? '<span class="muted">Anyone with the link</span>' : esc(s.to_addr || '')}${s.cc ? `<br><span class="muted">cc ${esc(s.cc)}</span>` : ''}</td>
      <td>${pill(s)}${compact && s.views ? `<div class="small muted">Opened ${s.views}×</div>` : ''}</td>
      ${compact ? '' : `<td class="right small">${s.views ? `${s.views}×<br><span class="muted">${esc(docAgo(s.viewed_at))}</span>` : '<span class="muted">Not yet</span>'}</td>`}
      <td class="right nowrap"><a class="btn sm" href="/nuvolve/app/api/docs/sends/${s.id}/view" target="_blank" rel="noopener">View</a>
        ${meta.pdf ? `<a class="btn sm" href="/nuvolve/app/api/docs/sends/${s.id}/pdf">PDF</a>` : ''}
        ${s.url && !s.revoked_at ? `<button class="btn sm" data-copy="${esc(s.url)}">Copy link</button>${compact ? '' : `<button class="btn sm danger" data-revoke="${s.id}" title="The link stops working">Turn off</button>`}` : ''}</td></tr>`).join('')}
  </tbody></table></div></div>`;
  $$('[data-copy]', body).forEach((b) => (b.onclick = () => copyText(b.dataset.copy)));
  $$('[data-revoke]', body).forEach((b) => (b.onclick = () => {
    modal('Turn off this link?', '<p>Anyone who opens it will see "This link is no longer available". The copy stays in your Sent list.</p>', [
      { label: 'Cancel' },
      { label: 'Turn off link', cls: 'danger', onClick: async () => { await api(`/nuvolve/app/api/docs/sends/${b.dataset.revoke}/revoke`, { method: 'POST' }); toast('Link turned off'); sentList(body, { designId, customerId, compact }); } },
    ]);
  }));
}

// ---------- making something new ----------
async function newDocModal({ purpose, source, record, recordTitle, welcome = false, kind } = {}) {
  const meta = await docMeta();
  await loadQr();
  let want = meta.canDesign ? (purpose || 'template') : 'document';
  const mine = await api('/nuvolve/app/api/docs/designs?purpose=template&full=1').catch(() => []);
  const m = modal(welcome ? 'Make your first template' : record ? `New document for ${recordTitle || 'this record'}` : 'New document', `
    ${welcome ? '<p class="muted" style="margin-top:0">Pick a starting point. Everything on it can be changed: move blocks around, add your own fields, colors and wording.</p>' : ''}
    ${meta.canDesign && !record ? `<div class="choice-cards" style="margin-bottom:16px">
      <label><input type="radio" name="nd-p" value="template" ${want === 'template' ? 'checked' : ''}><span><b>A template</b><br><span class="small muted">Design it once and use it for every customer, invoice or visit, like your invoice layout or your state pesticide record.</span></span></label>
      <label><input type="radio" name="nd-p" value="document" ${want === 'document' ? 'checked' : ''}><span><b>A one-off document</b><br><span class="small muted">Make it for one customer or one job and send it, like a custom letter, a notice or a special report.</span></span></label>
    </div>` : ''}
    <div id="nd-body"></div>`);
  $('.modal', m.el).classList.add('wide');
  const create = async (body) => {
    try {
      const r = await api('/nuvolve/app/api/docs/designs', { body: { purpose: want, ...(record ? { record } : {}), ...body } });
      m.close();
      location.hash = `#/documents/${r.id}`;
    } catch (e) { toast(e.message, true); }
  };
  const draw = () => {
    const fits = (s) => !source || s === source || s === 'none';
    const starters = meta.starters.filter((s) => fits(s.source) && (!kind || s.kind === kind));
    const own = want === 'document' ? mine.filter((t) => fits(t.source) && (!kind || t.kind === kind)) : [];
    const tile = (attrs, design, src, name, sub, tags = []) => `<div class="doc-card" role="button" tabindex="0" ${attrs}>
      <div class="thumb">${docThumb(design, src)}</div><div class="meta"><b>${esc(name)}</b><span class="small">${esc(sub)}</span>
      ${tags.length ? `<div class="tags">${tags.map((t) => `<span class="pill ${t === 'Compliance' ? 'blue' : 'green'}">${esc(t)}</span>`).join('')}</div>` : ''}</div></div>`;
    $('#nd-body', m.el).innerHTML = `
      ${own.length ? `<h3>Start from one of your templates</h3><div class="starter-grid" style="margin-bottom:18px">${own.map((t) => tile(`data-from="${t.id}"`, t.draft, t.source, t.name, `${meta.kinds[t.kind]?.label || ''}${t.version ? ` · v${t.version}` : ' · draft'}`)).join('')}</div>` : ''}
      <h3>${own.length ? 'Or start from a ready-made design' : 'Start from a ready-made design'}</h3>
      <div class="starter-grid">${starters.map((s) => tile(`data-starter="${s.key}"`, s.design, s.source, s.name, s.description, s.tags)).join('')}</div>`;
    fitThumbs($('#nd-body', m.el));
    $$('[data-starter]', m.el).forEach((c) => { c.onclick = () => create({ starter: c.dataset.starter }); c.onkeydown = (e) => { if (e.key === 'Enter') c.click(); }; });
    $$('[data-from]', m.el).forEach((c) => { c.onclick = () => create({ from_design: Number(c.dataset.from) }); c.onkeydown = (e) => { if (e.key === 'Enter') c.click(); }; });
  };
  $$('[name=nd-p]', m.el).forEach((r) => (r.onchange = () => { want = r.value; draw(); }));
  draw();
}

function importDocModal() {
  docMeta().then((meta) => {
    const m = modal('Import a design', `
      <p class="muted" style="margin-top:0">Bring in a design exported from another Nuvolve company or branch (a <b>.nuvolve.json</b> file). Use <b>More → Export</b> in the builder to make one.</p>
      <div class="field"><input type="file" accept=".json,application/json" id="im-file"></div>
      ${meta.canDesign ? '<label class="check"><input type="checkbox" id="im-tpl" checked> Add it as a template</label>' : ''}`,
    [{ label: 'Cancel' }, { label: 'Import', cls: 'primary', onClick: async (el) => {
      const f = $('#im-file', el).files[0];
      if (!f) throw new Error('Choose the file first');
      if (f.size > 2 * 1048576) throw new Error('That file is too big to be a design');
      let file;
      try { file = JSON.parse(await f.text()); } catch { throw new Error("That file isn't a Nuvolve design"); }
      const r = await api('/nuvolve/app/api/docs/designs/import', { body: { file, purpose: $('#im-tpl', el)?.checked ? 'template' : 'document' } });
      location.hash = `#/documents/${r.id}`;
    } }]);
    return m;
  });
}

// Logo, brand color, website, and who may design templates.
async function brandKitModal(onDone) {
  const meta = await docMeta();
  const b = { ...meta.brand };
  const m = modal('Brand kit', `
    <p class="muted" style="margin-top:0">Your logo and color are used by every document that is set to your brand. Change them here and every template updates.</p>
    <div class="field"><label>Logo</label>
      <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
        <div id="bk-logo" style="width:170px;height:76px;border:1px dashed #cbd5e0;border-radius:8px;display:grid;place-items:center;background:#fafbfb;overflow:hidden;padding:6px"></div>
        <div><label class="btn sm" style="display:inline-block;margin:0">Upload logo<input type="file" accept="image/png,image/jpeg,image/webp" id="bk-file" hidden></label>
          <button class="btn sm danger" id="bk-rm">Remove</button>
          <div class="hint">A PNG with a see-through background looks best. Up to 3 MB.</div></div>
      </div></div>
    <div class="field"><label>Brand color</label><div class="swatches" id="bk-sw"></div><div class="hint">Used for headings, lines and table headers.</div></div>
    <div class="field"><label>Website</label><input id="bk-web" value="${esc(b.website)}" placeholder="https://yourcompany.com"></div>
    <label class="check"><input type="checkbox" id="bk-office" ${b.officeCanDesign ? 'checked' : ''}> Office staff and managers can create and change templates</label>
    <div class="hint">Owners and admins always can. Everyone in the office can make and send one-off documents.</div>`,
  [{ label: 'Cancel' }, { label: 'Save brand kit', cls: 'primary', onClick: async (el) => {
    await api('/nuvolve/app/api/docs/brand', { method: 'PUT', body: { logo: b.logo || null, color: b.color, website: $('#bk-web', el).value.trim(), officeCanDesign: $('#bk-office', el).checked } });
    await docMeta(true);
    toast('Brand kit saved');
    if (onDone) onDone();
  } }]);
  const drawLogo = () => {
    $('#bk-logo', m.el).innerHTML = b.logo ? `<img src="${docAsset(b.logo)}" alt="Logo" style="max-width:100%;max-height:100%;object-fit:contain">` : '<span class="small muted">No logo yet</span>';
    $('#bk-rm', m.el).hidden = !b.logo;
  };
  const drawSw = () => {
    $('#bk-sw', m.el).innerHTML = DOC_COLORS.map((c) => `<button type="button" data-c="${c}" class="${b.color === c ? 'on' : ''}" style="background:${c}" title="${c}"></button>`).join('')
      + `<input type="color" value="${esc(b.color || '#2f855a')}" title="Any color"><span class="small muted">${esc(b.color || 'Default green')}</span>`;
    $$('#bk-sw button', m.el).forEach((x) => (x.onclick = () => { b.color = x.dataset.c; drawSw(); }));
    $('#bk-sw input', m.el).oninput = (e) => { b.color = e.target.value; $('#bk-sw .small', m.el).textContent = b.color; $$('#bk-sw button', m.el).forEach((x) => x.classList.remove('on')); };
  };
  $('#bk-file', m.el).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { b.logo = (await uploadDocImage(f, 1200)).id; drawLogo(); } catch (err) { toast(err.message, true); }
  };
  $('#bk-rm', m.el).onclick = () => { b.logo = null; drawLogo(); };
  drawLogo();
  drawSw();
}

// ---------- picking a record ----------
const RECORD_WORD = { customer: 'customer', invoice: 'invoice', visit: 'visit', estimate: 'estimate' };
function pickRecord(type, { title } = {}) {
  return new Promise((resolve) => {
    let picked = null;
    const m = modal(title || `Pick the ${RECORD_WORD[type] || 'record'}`, `
      <input id="pr-q" placeholder="Search by customer name${type === 'customer' ? '' : ' or number'}" autocomplete="off">
      <div class="pick-list" id="pr-list" style="margin-top:8px"><p class="muted small" style="padding:10px;margin:0">Loading...</p></div>
      ${type === 'visit' ? '<p class="hint">Only finished visits are listed.</p>' : ''}`, [{ label: 'Cancel' }]);
    let t;
    const load = async () => {
      try {
        const rows = await api(`/nuvolve/app/api/docs/records?type=${type}&q=${encodeURIComponent($('#pr-q', m.el).value.trim())}`);
        $('#pr-list', m.el).innerHTML = rows.map((r, i) => `<button type="button" data-i="${i}"><b>${esc(r.title)}</b><span class="small">${esc(r.sub || '')}</span></button>`).join('')
          || '<p class="muted small" style="padding:10px;margin:0">Nothing found.</p>';
        $$('#pr-list button', m.el).forEach((b) => (b.onclick = () => { picked = rows[Number(b.dataset.i)]; m.close(); }));
      } catch (e) { $('#pr-list', m.el).innerHTML = `<p class="small" style="padding:10px;margin:0;color:var(--danger)">${esc(e.message)}</p>`; }
    };
    $('#pr-q', m.el).oninput = () => { clearTimeout(t); t = setTimeout(load, 200); };
    $('#pr-q', m.el).onkeydown = (e) => { if (e.key === 'Enter') $('#pr-list button', m.el)?.click(); };
    onModalGone(m, () => resolve(picked));
    load();
  });
}

// ---------- sending ----------
// o: { designId, params, source, title, design, data, use, beforeSend, onSent, sign, inPerson }
// `design` and `data` fill in the subject and message; without them they are loaded.
// A design with a spot for the customer's signature goes out as a contract to sign, unless `sign: false` or they untick it.
async function openSendModal(o) {
  const meta = await docMeta();
  const key = DOC_RECORD[o.source];
  if (key && !o.params?.[key]) {
    const rec = await pickRecord(o.source, { title: `Who is this ${o.source === 'customer' ? 'for' : 'about'}? Pick the ${RECORD_WORD[o.source]}` });
    if (!rec) return;
    o = { ...o, params: { ...(o.params || {}), [key]: rec.id }, data: null };
  }
  let design = o.design;
  let data = o.data;
  try {
    if (!design) {
      const row = await api(`/nuvolve/app/api/docs/designs/${o.designId}`);
      design = row.version && o.use === 'published' ? (await api(`/nuvolve/app/api/docs/designs/${o.designId}/versions/${row.version}`)).design : row.draft;
    }
    if (!data) data = (await api(`/nuvolve/app/api/docs/data?${new URLSearchParams({ source: o.source, ...(o.params || {}) })}`)).data;
  } catch (e) { return toast(e.message, true); }
  design = DocRender.normalize(design);
  const ro = docRenderOpts(o.source);
  const fill = (t) => DocRender.fill(design, t, { ...data, doc: { title: o.title || '' } }, ro);
  const spots = DocRender.signSpots(design, data, { ...ro, normalized: true });
  const canSign = spots.some((x) => x.type === 'sign' && x.who === 'customer');
  const companySpot = spots.some((x) => x.type === 'sign' && x.who === 'company');
  let sign = canSign && o.sign !== false;
  let inPerson = Boolean(o.inPerson);
  const first = data?.customer?.first_name ? ` ${data.customer.first_name}` : '';
  const sig = `Thank you,\n${BOOT.me.name}\n${data?.company?.name || ''}`;
  const defaults = {
    doc: { subject: fill(design.email.subject) || o.title || 'Document', message: fill(design.email.message) || `Hi${first},\n\nPlease see the attached ${String(o.title || 'document').toLowerCase()}.\n\n${sig}` },
    sign: {
      subject: fill(design.email.subject) || `Please sign: ${o.title || 'your agreement'}`,
      message: fill(design.email.message) || `Hi${first},\n\nHere is your ${String(o.title || 'agreement').toLowerCase()}. Please look it over and sign it online. It only takes a minute on your phone or computer.\n\n${sig}`,
    },
  };
  const custEmail = data?.customer?.email || '';
  const custPhone = data?.customer?.phone || '';
  const to = custEmail ? [custEmail.toLowerCase()] : [];
  const cc = [];
  let channel = inPerson ? 'link' : 'email';
  const cancelDays = design.sign.cancelDays;

  const m = modal(`Send "${o.title || 'document'}"`, `
    ${canSign ? `<div class="sd-sign">
      <label class="check" style="margin:0"><input type="checkbox" id="sd-sign" ${sign ? 'checked' : ''}><span><b>Ask them to sign it</b>
        <span class="small muted" style="display:block">They agree to sign electronically, then sign on their phone or computer. You get the signed copy with a signing certificate${cancelDays ? `, and they have ${cancelDays} business days to cancel` : ''}.</span></span></label>
      ${companySpot ? `<details id="sd-co" style="margin-top:10px"><summary class="link-btn small">✍ Sign for the company now (optional)</summary>
        <div style="margin-top:8px"><canvas class="sig" id="sd-sig" style="height:120px" aria-label="Sign for the company"></canvas>
        <div class="small muted" style="display:flex;justify-content:space-between;gap:8px;margin-top:4px"><span>Signing as ${esc(BOOT.me.name)}. Your signature is on their copy when they open it. You can also sign later from Contracts.</span><button type="button" class="link-btn small" id="sd-sig-clr">Clear</button></div></div></details>` : ''}
    </div>` : ''}
    <div class="tabs" id="sd-tabs" style="margin-top:-6px"><button type="button" data-ch="email" class="${channel === 'email' ? 'on' : ''}">✉️ Email</button>${meta.sms ? '<button type="button" data-ch="sms">💬 Text</button>' : ''}<button type="button" data-ch="link" class="${channel === 'link' ? 'on' : ''}">🔗 ${canSign ? 'Link or in person' : 'Share a link'}</button></div>
    <div data-pane="email" ${channel === 'email' ? '' : 'hidden'}>
      ${!meta.email ? '<div class="alert info small" style="margin-bottom:12px">Email isn’t connected yet, so this is saved to the Outbox instead of being delivered. Connect an email provider to send for real.</div>' : ''}
      <div class="field"><label>To</label><div class="email-chips" id="sd-to"><input type="email" placeholder="name@example.com" aria-label="Add an email address"></div>
        ${data?.customer?.name && !custEmail ? `<div class="hint">${esc(data.customer.name)} has no email on file.</div>` : ''}</div>
      <details style="margin:-6px 0 12px"><summary class="link-btn small">CC someone</summary><div class="field" style="margin:8px 0 0"><div class="email-chips" id="sd-cc"><input type="email" placeholder="name@example.com" aria-label="Add a copy to"></div></div></details>
      <div class="field"><label>Subject</label><input id="sd-subject" maxlength="200"></div>
      <div class="field"><label>Message</label><textarea id="sd-message" rows="7"></textarea></div>
      <div id="sd-doc-opts">
        <label class="check"><input type="checkbox" id="sd-pdf" ${meta.pdf ? 'checked' : 'disabled'}> Attach a PDF copy</label>
        ${!meta.pdf ? '<div class="hint" style="margin:-4px 0 6px 26px">PDF attachments turn on once the server’s PDF engine is installed. The link below still lets them view and print it.</div>' : ''}
        <label class="check" style="margin-top:6px"><input type="checkbox" id="sd-link" checked> Include a link to view it online</label>
      </div>
      <p class="hint" id="sd-sign-note" hidden>The email has a <b>${esc(design.email.button || 'Review and sign')}</b> button. Once they sign, they get the signed PDF by email and you get a notification.</p>
    </div>
    <div data-pane="sms" hidden>
      <div class="field"><label>Mobile number</label><input id="sd-phone" type="tel" value="${esc(custPhone)}" placeholder="(555) 555-0100"></div>
      <p class="hint" id="sd-sms-note"></p>
    </div>
    <div data-pane="link" ${channel === 'link' ? '' : 'hidden'}>
      <div id="sd-ip" ${sign ? '' : 'hidden'}><div class="choice-cards" style="grid-template-columns:1fr;margin-bottom:12px">
        <label><input type="radio" name="sd-ip" value="0" ${inPerson ? '' : 'checked'}><span><b>Make a link to send yourself</b><br><span class="small muted">Paste it into a text from your own phone or a chat. They sign from their own device.</span></span></label>
        <label><input type="radio" name="sd-ip" value="1" ${inPerson ? 'checked' : ''}><span><b>They sign in person, right now</b><br><span class="small muted">Opens the contract on this device so you can hand it to them. The signing certificate notes it was signed in person with you.</span></span></label>
      </div></div>
      <div id="sd-link-note"></div>
    </div>`, [{ label: 'Cancel' }, { label: 'Send', cls: 'primary', onClick: () => go() }]);
  $('.modal', m.el).classList.add('mid');
  const sendBtn = $$('.mf .btn', m.el).pop();
  const subj = $('#sd-subject', m.el);
  const msg = $('#sd-message', m.el);
  let touched = false;
  subj.oninput = msg.oninput = () => { touched = true; };
  let pad = null;
  if ($('#sd-co', m.el)) {
    $('#sd-co', m.el).ontoggle = (e) => { if (e.target.open && !pad) pad = signaturePad($('#sd-sig', m.el)); };
    $('#sd-sig-clr', m.el).onclick = () => pad?.clear();
  }
  const sync = () => {
    if (!touched) { subj.value = defaults[sign ? 'sign' : 'doc'].subject; msg.value = defaults[sign ? 'sign' : 'doc'].message; }
    $('#sd-doc-opts', m.el).hidden = sign;
    $('#sd-sign-note', m.el).hidden = !sign;
    if ($('#sd-co', m.el)) $('#sd-co', m.el).hidden = !sign;
    $('#sd-ip', m.el).hidden = !sign;
    $('#sd-sms-note', m.el).textContent = `They get a short text from ${data?.company?.name || 'your company'} with a private link to ${sign ? 'review and sign' : 'view, print or save'} the document.`;
    $('#sd-link-note', m.el).innerHTML = sign
      ? (inPerson ? '<p class="small muted" style="margin:0">They read it, agree to sign electronically, and sign with a finger or mouse. When they finish, the signed copy is saved and emailed to them if they have an email on file.</p>'
        : '<p class="small muted" style="margin:0">Anyone with the link can sign as the customer, so only send it to them. You can turn it off any time from Documents → Contracts.</p>')
      : '<p style="margin-top:0">Make a private link to a copy of this document as it looks right now. Paste it anywhere: a text from your own phone, a chat, a portal.</p><p class="small muted">Anyone with the link can view and print it, so only share it with the right person. You can turn it off any time from Documents → Sent.</p>';
    sendBtn.textContent = channel === 'link' ? (sign ? (inPerson ? '✍ Open it to sign now' : 'Make the signing link') : 'Make the link')
      : channel === 'sms' ? (sign ? 'Text it to sign' : 'Send text') : (sign ? 'Send to sign' : 'Send');
  };

  const chips = (box, list) => {
    const input = $('input', box);
    const drawChips = () => {
      $$('.ec', box).forEach((x) => x.remove());
      list.forEach((addr, i) => input.insertAdjacentHTML('beforebegin', `<span class="ec">${esc(addr)}<button type="button" data-i="${i}" aria-label="Remove ${esc(addr)}">×</button></span>`));
      $$('.ec button', box).forEach((b) => (b.onclick = () => { list.splice(Number(b.dataset.i), 1); drawChips(); }));
    };
    const add = () => {
      const parts = input.value.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
      for (const p of parts) if (!list.includes(p)) list.push(p);
      input.value = '';
      drawChips();
    };
    input.onkeydown = (e) => {
      if (['Enter', ',', ';', ' ', 'Tab'].includes(e.key) && input.value.trim()) { e.preventDefault(); add(); }
      if (e.key === 'Backspace' && !input.value && list.length) { list.pop(); drawChips(); }
    };
    input.onblur = () => { if (input.value.trim()) add(); };
    box.onclick = (e) => { if (e.target === box) input.focus(); };
    drawChips();
    return add;
  };
  const addTo = chips($('#sd-to', m.el), to);
  const addCc = chips($('#sd-cc', m.el), cc);
  $$('#sd-tabs button', m.el).forEach((b) => (b.onclick = () => {
    channel = b.dataset.ch;
    $$('#sd-tabs button', m.el).forEach((x) => x.classList.toggle('on', x === b));
    $$('[data-pane]', m.el).forEach((p) => { p.hidden = p.dataset.pane !== channel; });
    sync();
  }));
  if ($('#sd-sign', m.el)) $('#sd-sign', m.el).onchange = (e) => { sign = e.target.checked; sync(); };
  $$('[name=sd-ip]', m.el).forEach((r) => (r.onchange = () => { inPerson = r.value === '1' && r.checked; sync(); }));
  sync();

  async function go() {
    addTo();
    addCc();
    if (o.beforeSend) await o.beforeSend();
    const base = { design_id: o.designId, params: o.params || {}, ...(o.use ? { use: o.use } : {}) };
    if (sign) {
      base.sign = true;
      const mark = pad?.value();
      if (mark) base.company_signature = mark;
    }
    let body;
    if (channel === 'link') body = { ...base, channel: 'link', ...(sign && inPerson ? { in_person: true } : {}) };
    else if (channel === 'sms') body = { ...base, channel: 'email', to: [], sms_to: $('#sd-phone', m.el).value.trim(), subject: subj.value, message: msg.value, attach_pdf: false };
    else {
      if (!to.length) throw new Error('Add who it goes to');
      body = { ...base, channel: 'email', to, cc, subject: subj.value, message: msg.value, attach_pdf: !sign && $('#sd-pdf', m.el).checked, include_link: sign || $('#sd-link', m.el).checked };
    }
    const r = await api('/nuvolve/app/api/docs/send', { body });
    if (sign) return signDone(r, { channel, inPerson, to, name: data?.customer?.name || '' }, o);
    const head = channel === 'link' ? ['🔗', 'Your link is ready']
      : r.status === 'sent' ? ['✅', channel === 'sms' ? 'Text sent' : `Sent to ${to.join(', ')}`]
        : r.status === 'failed' ? ['⚠️', 'It didn’t go through'] : ['📥', 'Saved to the Outbox'];
    const done = modal(head[1], `<div class="send-done"><div class="big">${head[0]}</div>
      ${r.status === 'logged' ? '<p>Email isn’t connected yet, so nothing was delivered. You can see exactly what would have gone out in Messages.</p>' : ''}
      ${r.status === 'failed' ? `<p>${esc(r.error || 'The email service turned it down.')} You can still share the link yourself.</p>` : ''}
      ${r.pdfError ? `<p class="small muted">The PDF couldn’t be attached (${esc(r.pdfError)}). The link still works.</p>` : ''}
      <div class="copy-row" style="margin-top:10px"><input readonly value="${esc(r.url)}" aria-label="Link"><button class="btn" id="sd-copy">Copy</button><a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">Open</a></div>
      <p class="hint" style="text-align:left">This link always shows the copy that was sent, even if the template changes later.</p></div>`, [{ label: 'Done', cls: 'primary' }]);
    $('#sd-copy', done.el).onclick = () => copyText(r.url);
    if (o.onSent) o.onSent(r);
  }
}

// What happens after a contract goes out: in person, the rep opens it right away and hands the device over.
function signDone(r, { channel, inPerson, to, name }, o) {
  const head = channel === 'link' ? (inPerson ? ['✍️', 'Ready for their signature'] : ['🔗', 'Your signing link is ready'])
    : r.status === 'sent' ? ['✅', channel === 'sms' ? 'Texted for signature' : `Sent to ${to.join(', ')} to sign`]
      : r.status === 'failed' ? ['⚠️', 'It didn’t go through'] : ['📥', 'Saved to the Outbox'];
  const done = modal(head[1], `<div class="send-done"><div class="big">${head[0]}</div>
    ${inPerson ? `<p>Open it, then hand your device to ${esc(name || 'the customer')}. They read it, agree to sign electronically, and sign with a finger.</p>
      <p><a class="btn primary" style="font-size:16px;padding:11px 20px" href="${esc(r.url)}" target="_blank" rel="noopener">✍ Open the contract to sign</a></p>` : ''}
    ${r.status === 'logged' ? '<p>Email isn’t connected yet, so nothing was delivered. Copy the link below and send it yourself, or see what would have gone out in Messages.</p>' : ''}
    ${r.status === 'failed' ? `<p>${esc(r.error || 'The email service turned it down.')} You can still share the link yourself.</p>` : ''}
    ${!inPerson && channel !== 'link' && r.status === 'sent' ? '<p>You get a notification when they sign.</p>' : ''}
    <div class="copy-row" style="margin-top:10px"><input readonly value="${esc(r.url)}" aria-label="Signing link"><button class="btn" id="sd-copy">Copy</button>${inPerson ? '' : `<a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">Open</a>`}</div>
    <p class="hint" style="text-align:left">Follow it in <a href="#/documents?tab=contracts">Documents → Contracts</a>: who opened it, when they signed, and the signed PDF with its certificate.</p></div>`, [{ label: 'Done', cls: 'primary' }]);
  $('#sd-copy', done.el).onclick = () => copyText(r.url);
  if (o.onSent) o.onSent(r);
}

// ---------- documents for a record (used from the customer, invoice and visit pages) ----------
// Lists the templates that fit, so the office can view, send, or tweak a copy for this one record.
async function docsForRecord({ source, params, title }) {
  const meta = await docMeta();
  const [tpls, docs] = await Promise.all([
    api(`/nuvolve/app/api/docs/designs?purpose=template&source=${source}`),
    api(`/nuvolve/app/api/docs/designs?purpose=document&source=${source}`),
  ]);
  const key = DOC_RECORD[source];
  const mine = docs.filter((d) => d.record && Number(d.record[key]) === Number(params[key]));
  const usable = tpls.filter((t) => t.version || t.canEdit);
  const qs = (t) => new URLSearchParams({ ...params, ...(t.version ? { use: 'published' } : {}) }).toString();
  const m = modal(`Documents for ${title}`, `
    ${usable.length ? `<div class="pick-list" style="max-height:none">${usable.map((t) => `<div style="display:flex;gap:8px;align-items:center;padding:9px 12px;border-bottom:1px solid var(--line);flex-wrap:wrap">
      <div style="flex:1;min-width:160px"><b>${esc(t.name)}</b><span class="small muted" style="display:block">${esc(meta.kinds[t.kind]?.label || '')}${t.version ? '' : ' · draft, not published'}</span></div>
      <a class="btn sm" href="/nuvolve/app/api/docs/designs/${t.id}/view?${qs(t)}" target="_blank" rel="noopener">View</a>
      <button class="btn sm" data-send="${t.id}">${t.kind === 'contract' ? '✍ Send to sign' : 'Send'}</button>
      <button class="btn sm" data-copy="${t.id}" title="Make a one-off copy for this ${RECORD_WORD[source]} and change anything on it">Customize</button></div>`).join('')}</div>`
    : `<p class="muted">No ${esc(meta.sources[source].short.toLowerCase())} templates yet.${meta.canDesign ? ' Make one in Documents.' : ''}</p>`}
    ${mine.length ? `<h3 style="margin-top:16px">Made for this ${RECORD_WORD[source]}</h3><div class="pick-list">${mine.map((d) => `<button type="button" data-open="${d.id}"><b>${esc(d.name)}</b><span class="small">${d.status === 'sent' ? 'Sent' : 'Draft'} · edited ${esc(docAgo(d.updated_at))}</span></button>`).join('')}</div>` : ''}
    ${source === 'customer' && params.customer_id ? '<h3 style="margin-top:16px">Sent to this customer</h3><div id="dr-sent"><p class="muted small">Loading...</p></div>' : ''}`,
  [{ label: 'Close' }, { label: '+ New one-off document', cls: 'primary', onClick: () => { newDocModal({ purpose: 'document', source, record: params, recordTitle: title }); } }]);
  $('.modal', m.el).classList.add('mid');
  $$('[data-send]', m.el).forEach((b) => (b.onclick = () => {
    const t = usable.find((x) => x.id === Number(b.dataset.send));
    openSendModal({ designId: t.id, source, params, title: `${t.name}`, use: t.version ? 'published' : undefined });
  }));
  $$('[data-copy]', m.el).forEach((b) => (b.onclick = async () => {
    try {
      const r = await api('/nuvolve/app/api/docs/designs', { body: { purpose: 'document', from_design: Number(b.dataset.copy), record: params } });
      m.close();
      location.hash = `#/documents/${r.id}`;
    } catch (e) { toast(e.message, true); }
  }));
  $$('[data-open]', m.el).forEach((b) => (b.onclick = () => { m.close(); location.hash = `#/documents/${b.dataset.open}`; }));
  if ($('#dr-sent', m.el)) sentList($('#dr-sent', m.el), { customerId: params.customer_id, compact: true }).catch(() => {});
}

// ---------- contracts ----------
const SIGN_PILL = { awaiting: 'yellow', signed: 'green', cancelled: 'red', declined: 'red', void: '', expired: '' };
const signPill = (st, label) => `<span class="pill ${SIGN_PILL[st] ?? ''}">${esc(label || st)}</span>`;
const ctDay = (s) => (s ? fmtDate(String(s).slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' }) : '');

// Every contract sent for signing, with what is waiting on whom. `customerId` narrows it to one customer.
async function contractList(body, { customerId, compact = false, onChange } = {}) {
  const meta = await docMeta();
  const rows = await api(`/nuvolve/app/api/docs/contracts${customerId ? `?customer_id=${customerId}` : ''}`);
  const again = () => contractList(body, { customerId, compact, onChange }).then(() => onChange && onChange());
  if (!rows.length) {
    body.innerHTML = compact ? '<p class="muted small" style="margin:0">No contracts yet.</p>'
      : `<div class="empty"><div class="big">✍️</div><h3>No contracts yet</h3><p>Open a contract template and press <b>Send</b> with <b>Ask them to sign</b> ticked. They sign on their phone or computer, or in person on yours, and the signed copy lands here.</p>
        ${meta.canDesign ? '<button class="btn primary" id="ct-new">+ New contract template</button>' : ''}</div>`;
    if ($('#ct-new', body)) $('#ct-new', body).onclick = () => newDocModal({ purpose: 'template', kind: 'contract' });
    return;
  }
  const GROUPS = [
    ['all', 'All', () => true],
    ['awaiting', 'Waiting', (r) => r.status === 'awaiting'],
    ['company', 'Needs your signature', (r) => r.needs_countersign],
    ['open', 'Can still cancel', (r) => r.cancel_open],
    ['signed', 'Signed', (r) => r.status === 'signed'],
    ['ended', 'Cancelled or ended', (r) => ['cancelled', 'declined', 'void', 'expired'].includes(r.status)],
  ];
  let group = 'all';
  const line = (r) => {
    const bits = [];
    if (r.status === 'signed') bits.push(`Signed by ${esc(r.signer_name || 'the customer')} ${esc(ctDay(r.signed_at))}`);
    if (r.cancel_open) bits.push(`<b style="color:var(--warn)">Can cancel until ${esc(ctDay(r.cancel_by))}</b>`);
    else if (r.status === 'signed' && r.cancel_by) bits.push(`Cancel window closed ${esc(ctDay(r.cancel_by))}`);
    if (r.status === 'cancelled') bits.push(`Cancelled ${esc(ctDay(r.cancelled_at))}${r.cancelled_by ? ` by ${esc(r.cancelled_by)}` : ''}${r.cancel_reason ? `: "${esc(r.cancel_reason)}"` : ''}`);
    if (r.status === 'awaiting') bits.push(r.views ? `Opened ${r.views}×, last ${esc(docAgo(r.viewed_at))}` : 'Not opened yet');
    if (r.status === 'awaiting' && r.reminders) bits.push(`${r.reminders} reminder${r.reminders === 1 ? '' : 's'} sent`);
    if (r.needs_countersign) bits.push('<b style="color:var(--info)">Needs your company’s signature</b>');
    return bits.join(' · ');
  };
  const row = (r) => `<div class="ct-row">
    <div class="ct-main"><div><b>${esc(r.title)}</b> ${signPill(r.status, r.status_label)}${r.in_person ? ' <span class="pill">In person</span>' : ''}</div>
      <div class="small muted">${compact ? '' : `${r.customer_id ? `<a href="#/customers/${r.customer_id}">${esc(r.customer_name || 'Customer')}</a> · ` : ''}`}Sent ${esc(docAgo(r.sent_at))}${r.sent_by ? ` by ${esc(r.sent_by)}` : ''}${r.to && !r.in_person ? ` to ${esc(r.to)}` : ''}</div>
      <div class="small">${line(r)}</div></div>
    <div class="actions">
      <a class="btn sm" href="/nuvolve/app/api/docs/sends/${r.send_id}/view" target="_blank" rel="noopener">${r.status === 'signed' || r.status === 'cancelled' ? 'Signed copy' : 'View'}</a>
      ${meta.pdf ? `<a class="btn sm" href="/nuvolve/app/api/docs/sends/${r.send_id}/pdf">PDF</a>` : ''}
      ${r.status === 'awaiting' && r.url ? `<button class="btn sm" data-copy="${esc(r.url)}">Copy link</button>` : ''}
      ${r.status === 'awaiting' && r.url && r.in_person ? `<a class="btn sm primary" href="${esc(r.url)}" target="_blank" rel="noopener">✍ Sign now</a>` : ''}
      ${r.status === 'awaiting' && /@/.test(r.to || '') ? `<button class="btn sm" data-remind="${r.send_id}">Remind</button>` : ''}
      ${r.needs_countersign ? `<button class="btn sm primary" data-cosign="${r.send_id}">✍ Sign for the company</button>` : ''}
      ${r.status === 'signed' ? `<button class="btn sm ${r.cancel_open ? 'danger' : ''}" data-cancel="${r.send_id}" title="Record a cancellation that came by mail, email or phone">Record cancellation</button>` : ''}
      ${['awaiting', 'expired'].includes(r.status) ? `<button class="btn sm danger" data-void="${r.send_id}" title="Stop asking for a signature. The link stops working.">Void</button>` : ''}
    </div></div>`;
  const draw = () => {
    const q = ($('#ct-q', body)?.value || '').trim().toLowerCase();
    const test = GROUPS.find((g) => g[0] === group)[2];
    const list = rows.filter((r) => test(r) && (!q || `${r.title} ${r.customer_name} ${r.to} ${r.signer_name || ''}`.toLowerCase().includes(q)));
    $('#ct-list', body).innerHTML = list.map(row).join('') || '<p class="muted" style="padding:12px 0;margin:0">Nothing here.</p>';
    if (!compact) $$('#ct-groups button', body).forEach((b) => b.classList.toggle('on', b.dataset.g === group));
    wire();
  };
  body.innerHTML = compact ? '<div class="ct-list" id="ct-list"></div>' : `
    <div class="doc-tools"><input id="ct-q" placeholder="🔍 Find by contract or customer" autocomplete="off">
      <div class="bseg" id="ct-groups">${GROUPS.map(([k, l, t]) => { const n = rows.filter(t).length; return `<button type="button" data-g="${k}">${esc(l)}${k === 'all' ? '' : ` (${n})`}</button>`; }).join('')}</div></div>
    <div class="card"><div class="ct-list" id="ct-list"></div></div>
    <p class="hint">The 3-day right to cancel is counted in business days: every day except Sundays and federal holidays. A cancellation that comes in by mail counts from its postmark date, so record it here even if it arrives after the date shown.</p>`;
  if (!compact) {
    $('#ct-q', body).oninput = draw;
    $$('#ct-groups button', body).forEach((b) => (b.onclick = () => { group = b.dataset.g; draw(); }));
  }
  function wire() {
    const byId = (id) => rows.find((r) => r.send_id === Number(id));
    $$('[data-copy]', body).forEach((b) => (b.onclick = () => copyText(b.dataset.copy)));
    $$('[data-remind]', body).forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await api(`/nuvolve/app/api/docs/sends/${b.dataset.remind}/remind`, { method: 'POST' });
        toast(r.status === 'sent' ? 'Reminder sent' : r.status === 'failed' ? `It didn’t go through: ${r.error || ''}` : 'Saved to the Outbox (email isn’t connected yet)', r.status === 'failed');
        again();
      } catch (e) { toast(e.message, true); b.disabled = false; }
    }));
    $$('[data-cosign]', body).forEach((b) => (b.onclick = () => countersignModal(byId(b.dataset.cosign), again)));
    $$('[data-cancel]', body).forEach((b) => (b.onclick = () => cancelContractModal(byId(b.dataset.cancel), again)));
    $$('[data-void]', body).forEach((b) => (b.onclick = () => cancelContractModal(byId(b.dataset.void), again)));
  }
  draw();
}

// The company signs a contract, before or after the customer.
function countersignModal(c, onDone) {
  const m = modal('Sign for the company', `
    <p style="margin-top:0">Sign <b>${esc(c.title)}</b>${c.customer_name ? ` for ${esc(c.customer_name)}` : ''} as <b>${esc(BOOT.me.name)}</b>.
    ${c.status === 'signed' ? 'Your signature is added to the signed copy and its certificate.' : 'Your signature shows on their copy when they open it.'}</p>
    <canvas class="sig" id="cs-sig" aria-label="Sign here"></canvas>
    <div style="display:flex;justify-content:space-between;margin-top:4px"><span class="small muted">Sign with your finger, a pen or the mouse.</span><button type="button" class="link-btn small" id="cs-clr">Clear</button></div>`,
  [{ label: 'Cancel' }, { label: 'Sign', cls: 'primary', onClick: async () => {
    const v = pad.value();
    if (!v) throw new Error('Sign in the box first');
    await api(`/nuvolve/app/api/docs/sends/${c.send_id}/countersign`, { body: { signature: v } });
    toast('Signed for the company');
    if (onDone) onDone();
  } }]);
  const pad = signaturePad($('#cs-sig', m.el));
  $('#cs-clr', m.el).onclick = () => pad.clear();
}

// Records a cancellation (signed contracts) or voids one still waiting for a signature.
function cancelContractModal(c, onDone) {
  const signed = c.status === 'signed';
  const late = signed && !c.cancel_open;
  const est = c.source === 'estimate';
  const m = modal(signed ? 'Record a cancellation' : 'Void this contract', `
    ${signed ? `<p style="margin-top:0">Use this when ${esc(c.signer_name || 'the customer')} cancels by mail, email or phone instead of from their link.</p>
      ${late ? `<div class="alert warn small" style="margin-bottom:12px">The ${c.cancel_days || 3}-day window ended ${esc(ctDay(c.cancel_by))}. You can still cancel it as a courtesy, or because the notice was postmarked in time.</div>` : ''}
      <p class="small muted">The contract is stamped Cancelled and the change goes on its signing certificate.${est ? ' The estimate is marked declined and any plan it started is stopped.' : ''} Refund any payment within 10 business days.</p>`
    : '<p style="margin-top:0">The link stops asking for a signature. Nothing they already see changes, and it stays in your list.</p>'}
    <div class="field"><label>${signed ? 'Reason or how it came in' : 'Note (optional)'}</label><input id="cc-reason" maxlength="300" placeholder="${signed ? 'e.g. Mailed notice postmarked Oct 30' : 'e.g. Sent the wrong price'}"></div>`,
  [{ label: 'Back' }, { label: signed ? 'Cancel the contract' : 'Void it', cls: 'danger', onClick: async (el) => {
    await api(`/nuvolve/app/api/docs/sends/${c.send_id}/cancel`, { body: { reason: $('#cc-reason', el).value.trim() } });
    toast(signed ? 'Cancelled' : 'Voided');
    if (onDone) onDone();
  } }]);
  $('#cc-reason', m.el).focus();
}

// Sends a contract for a customer or an estimate: the company's default contract when there is one, otherwise a pick.
// Without any contract template yet, offers to start one from the ready-made service agreement.
async function contractForRecord({ customerId, estimateId, title, inPerson = false, onSent } = {}) {
  const meta = await docMeta();
  const all = await api('/nuvolve/app/api/docs/designs?purpose=template');
  const fits = (t) => t.kind === 'contract' && (t.version || t.canEdit) && (t.source === 'customer' || t.source === 'none' || t.source === 'estimate');
  const def = meta.defaults.contract;
  const tpls = all.filter(fits).sort((a, b) => (b.id === def) - (a.id === def) || (estimateId ? (b.source === 'estimate') - (a.source === 'estimate') : 0) || (b.version > 0) - (a.version > 0));
  const paramsFor = (t) => (t.source === 'estimate' ? (estimateId ? { estimate_id: estimateId } : {}) : t.source === 'customer' && customerId ? { customer_id: customerId } : {});
  const go = (t) => openSendModal({ designId: t.id, source: t.source, params: paramsFor(t), title: t.name, use: t.version ? 'published' : undefined, sign: true, inPerson, onSent });
  if (!tpls.length) {
    modal('Set up your contract first', `<p style="margin-top:0">You don’t have a contract template yet.</p>
      <p>The ready-made <b>service agreement</b> has the customer and company signature spots, the consent to sign electronically, and the 3-day right to cancel with the notice of cancellation already in it. Change the wording, colors and logo, publish it, and send it from here.</p>
      ${meta.canDesign ? '' : '<p class="muted">Ask an owner or admin to set one up in Documents.</p>'}`,
    [{ label: 'Not now' }, ...(meta.canDesign ? [{ label: 'Start from the service agreement', cls: 'primary', onClick: async () => {
      const r = await api('/nuvolve/app/api/docs/designs', { body: { purpose: 'template', starter: 'service_agreement' } });
      location.hash = `#/documents/${r.id}`;
    } }] : [])]);
    return;
  }
  if (tpls.length === 1) return go(tpls[0]);
  const m = modal(`Which contract${title ? ` for ${title}` : ''}?`, `<div class="pick-list" style="max-height:none">${tpls.map((t, i) => `<button type="button" data-i="${i}"><b>${esc(t.name)}${t.id === def ? ' <span class="pill blue">Default</span>' : ''}</b>
    <span class="small">Filled from ${esc((meta.sources[t.source]?.short || '').toLowerCase())}${t.version ? ` · v${t.version}` : ' · draft, not published'}</span></button>`).join('')}</div>`, [{ label: 'Cancel' }]);
  $$('[data-i]', m.el).forEach((b) => (b.onclick = () => { m.close(); go(tpls[Number(b.dataset.i)]); }));
}

// A customer's contracts, with a button to send a new one (customer page).
function contractsModal({ customerId, title }) {
  const m = modal(`Contracts for ${title}`, '<div id="cm-list"><p class="muted small">Loading...</p></div>',
    [{ label: 'Close' }, { label: '✍ Send a contract', cls: 'primary', onClick: () => { contractForRecord({ customerId, title }); } }]);
  $('.modal', m.el).classList.add('mid');
  contractList($('#cm-list', m.el), { customerId, compact: true }).catch((e) => { $('#cm-list', m.el).innerHTML = `<p class="small" style="color:var(--danger)">${esc(e.message)}</p>`; });
}
