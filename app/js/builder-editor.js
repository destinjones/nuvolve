// The document editor: a full-screen page builder. Drag blocks onto the page, type right on it, drop in fields
// from the record, choose what shows when, and preview, download or send without leaving.
// The page is drawn by DocRender, so what you see here is what prints, emails and opens from a link.

const BLOCK_HELP = {
  heading: 'A title or section heading', text: 'Paragraphs with bold, lists and fields', letterhead: 'Logo, company details and a title',
  fields: 'Label and value pairs, like Date: Oct 1', table: 'Rows from a list, or a grid you type in', columns: 'Put blocks side by side',
  section: 'A titled box around other blocks', repeat: 'Prints its blocks once for each item in a list', image: 'Your logo, a picture, or a photo field',
  signature: 'Lines to sign, or a saved signature', qr: 'A code people scan with their phone', photos: 'Visit photos in a grid',
  checklist: 'Tick boxes, set by hand or by a field', stamp: 'A big PAID or PAST DUE stamp', divider: 'A line across the page',
  spacer: 'Empty space', pagebreak: 'Start a new page',
  sign: 'Where the customer or your company signs or initials', input: 'A blank the customer fills in when they sign',
  logo: 'Your logo, any size, anywhere on the page', shape: 'A box, circle or line, with text inside if you like',
};
// How the Add panel groups the basic blocks.
const BLOCK_GROUPS = [
  ['Text and layout', ['heading', 'text', 'letterhead', 'fields', 'table', 'columns', 'section', 'repeat']],
  ['Contracts and signing', ['sign', 'input', 'signature']],
  ['Pictures and design', ['logo', 'image', 'shape', 'stamp', 'qr', 'divider', 'spacer']],
  ['From the visit', ['photos', 'checklist']],
  ['Pages', ['pagebreak']],
];
const PT = 0.75; // CSS pixels to points
const ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5];
const FORMATS = {
  money: [['', 'Money ($1,234.50)'], ['number', 'Plain number'], ['int', 'Whole number']],
  number: [['', 'As is'], ['int', 'Whole number'], ['money', 'Money']],
  percent: [['', 'Percent'], ['number', 'Plain number']],
  date: [['', 'Document date style'], ['date:long', 'October 29, 2026'], ['date:medium', 'Oct 29, 2026'], ['date:short', '10/29/2026'], ['date:dmy', '29/10/2026'], ['date:iso', '2026-10-29'], ['date:month', 'October 2026'], ['date:weekday', 'Thursday, October 29, 2026']],
  datetime: [['', 'Date and time'], ['date', 'Date only'], ['time', 'Time only'], ['date:long', 'Long date only']],
  time: [['', 'Time (2:30 PM)']],
  boolean: [['', 'Yes or No']],
  text: [['', 'As typed'], ['upper', 'UPPERCASE'], ['lower', 'lowercase'], ['title', 'Title Case'], ['first', 'First word only']],
};
const COL_FORMATS = [['', 'Automatic'], ['money', 'Money'], ['number', 'Number'], ['int', 'Whole number'], ['date:short', 'Date 10/29/2026'], ['date:long', 'Date October 29, 2026'], ['time', 'Time'], ['yesno', 'Yes / No'], ['upper', 'UPPERCASE'], ['title', 'Title Case']];
const TONES = [['green', 'Green'], ['red', 'Red'], ['amber', 'Amber'], ['gray', 'Gray'], ['accent', 'Brand']];

async function pageBuilder(view, id) {
  docBaseCss();
  view.innerHTML = '<p class="muted">Opening the builder...</p>';
  const [meta, row] = await Promise.all([docMeta(), api(`/nuvolve/app/api/docs/designs/${Number(id) || 0}`), loadQr()]);
  const R = DocRender;
  const PX = 96;
  let fd = null; // a free block being dragged or resized
  let draft = row.draft;
  // People who can't change a published template see (and send) the published version.
  if (!row.canEdit && row.version) draft = (await api(`/nuvolve/app/api/docs/designs/${row.id}/versions/${row.version}`)).design;
  const S = {
    row, design: R.normalize(draft), source: row.source, params: { ...(row.record || {}) }, data: null, real: false, dataError: '',
    sel: null, left: 'add', right: 'block', zoom: 'fit', names: false, preview: false, openSecs: new Set(['style']),
    undo: [], redo: [], lastKey: '', lastAt: 0,
    rev: row.rev, save: 'saved', saveMsg: '', timer: null, inflight: null, again: false, failures: 0, pending: {},
    readOnly: !row.canEdit || row.archived, editing: null, range: null,
  };
  try { S.zoom = localStorage.getItem('nv_bld_zoom') || 'fit'; } catch { /* private mode */ }
  const cat = () => meta.sources[S.source] || meta.sources.none;
  const ro = (extra) => docRenderOpts(S.source, extra);
  const isTpl = () => S.row.purpose === 'template';
  const recKey = () => DOC_RECORD[S.source];

  // ---------- shell ----------
  view.innerHTML = `<div class="bld" tabindex="-1">
    <div class="bld-top">
      <a class="back" href="#/documents?tab=${isTpl() ? 'templates' : 'documents'}" title="Back to Documents">←<span class="lbl lbl-3"> Documents</span></a>
      <button class="btn icon bld-mobile" data-act="show-left" title="Blocks and fields">☰</button>
      <input class="bld-name" value="${esc(S.row.name)}" maxlength="120" aria-label="Name" ${S.readOnly ? 'readonly' : ''}>
      <span id="b-purpose"></span>
      <span class="bld-status" id="b-status"></span>
      <span class="grow"></span>
      <button class="btn icon" data-act="undo" title="Undo (Ctrl+Z)">↶</button>
      <button class="btn icon" data-act="redo" title="Redo (Ctrl+Shift+Z)">↷</button>
      <span class="bld-zoom"><button class="btn icon" data-act="zoom-out" title="Zoom out">−</button><span id="b-zoom" role="button" title="Fit to screen" style="cursor:pointer">100%</span><button class="btn icon" data-act="zoom-in" title="Zoom in">+</button></span>
      <button class="btn" data-act="names" title="Show field names instead of sample values">{x}<span class="lbl lbl-1"> Field names</span></button>
      <button class="btn" data-act="preview" id="b-preview" title="See it on paper, a computer, a phone, or as the email">👁<span class="lbl lbl-2"> Preview</span></button>
      <button class="btn" data-act="output" title="Download or print">⬇<span class="lbl lbl-2"> Download</span> ▾</button>
      <button class="btn" data-act="more" title="More">⋯</button>
      <button class="btn" data-act="publish" id="b-publish">Publish</button>
      <button class="btn primary" data-act="send">✉ Send</button>
      <button class="btn icon bld-mobile" data-act="show-right" title="Settings">⚙</button>
    </div>
    <div id="b-banner"></div>
    <div class="bld-body">
      <aside class="bld-left"><div class="bld-tabs" id="b-ltabs"></div><div class="bld-pane" id="b-left"></div></aside>
      <div class="bld-canvas" id="b-canvas">
        <div class="small muted" id="b-note" style="text-align:center;margin:-14px 0 10px"></div>
        <div class="bld-paper-wrap" id="b-wrap"><div class="bld-paper" id="b-paper">
          <div class="bld-margin" id="b-mtop"></div><div class="bld-doc" id="b-doc"></div><div class="bld-margin" id="b-mbot"></div>
        </div></div>
        <div class="bld-bar" id="b-bar" hidden></div>
        <div class="bld-rsz" id="b-rsz" hidden title="Drag to resize"></div>
        <div class="bld-rt" id="b-rt" hidden></div>
        <div class="bld-drop-line" id="b-drop" hidden></div>
      </div>
      <aside class="bld-right"><div class="bld-tabs" id="b-rtabs"></div><div class="bld-pane insp" id="b-right"></div></aside>
      <div class="bld-pv" id="b-pv" hidden></div>
    </div>
  </div>`;
  const root = $('.bld', view);
  const cv = $('#b-canvas', root);
  const wrap = $('#b-wrap', root);
  const paper = $('#b-paper', root);
  const doc = $('#b-doc', root);
  const bar = $('#b-bar', root);
  const rt = $('#b-rt', root);
  const dropLine = $('#b-drop', root);
  const rsz = $('#b-rsz', root);
  const pv = $('#b-pv', root);
  const left = $('#b-left', root);
  const right = $('#b-right', root);

  // ---------- model helpers ----------
  const findB = (bid) => (bid ? R.find(S.design.blocks, bid) : null);
  const selBlock = () => findB(S.sel)?.block || null;
  const getPath = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
  function setPath(o, path, v) {
    const parts = path.split('.');
    let cur = o;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      cur = cur[parts[i]];
    }
    const k = parts[parts.length - 1];
    if ((parts[0] === 'style' || parts[0] === 'showIf') && (v === '' || v === false || v == null)) delete cur[k];
    else cur[k] = v;
  }
  function listAt(key) {
    if (!key || key === 'root') return S.design.blocks;
    const [bid, i] = key.split(':');
    const hit = findB(bid);
    const def = hit && R.BLOCKS[hit.block.type];
    return def?.slots ? def.slots(hit.block)[Number(i)] || null : null;
  }
  const keyOf = (hit) => (hit.parent ? `${hit.parent.id}:${hit.slot}` : 'root');
  function parents(bid) {
    const out = [];
    let hit = findB(bid);
    while (hit?.parent) { out.unshift(hit.parent); hit = findB(hit.parent.id); }
    return out;
  }
  // The list whose items fill `item.` fields here: the nearest Repeat around the block.
  const itemList = (bid) => [...parents(bid)].reverse().find((p) => p.type === 'repeat' && p.list)?.list || '';
  function freshIds(b) { R.walk([b], (x) => { x.id = R.newId(); }); return b; }
  function makeBlock(type) {
    const b = { id: R.newId(), type, ...R.clone(R.BLOCKS[type].make()) };
    const lists = cat().lists;
    if (type === 'table' && lists.length) {
      b.list = lists[0].key;
      b.columns = lists[0].fields.slice(0, 4).map((f) => ({ label: f.label, field: f.key, align: ['money', 'number'].includes(f.type) ? 'right' : 'left' }));
      b.rows = [];
    }
    if (type === 'repeat' && lists.length) b.list = lists[0].key;
    if (type === 'letterhead') b.title = meta.kinds[S.row.kind]?.label && S.row.kind !== 'custom' ? meta.kinds[S.row.kind].label : S.row.name;
    return b;
  }
  const fieldLabel = (path, list) => {
    if (path.startsWith('item.')) return cat().labels[`${list}[].${path.slice(5)}`] || path.slice(5);
    return cat().labels[path] || path;
  };
  const fieldType = (path, list) => (path.startsWith('item.') ? cat().types[`${list}[].${path.slice(5)}`] : cat().types[path]) || 'text';
  const sampleOf = (path) => { try { return R.fill(S.design, `{{${path}}}`, S.data, ro()); } catch { return ''; } };

  // ---------- history and saving ----------
  function change(fn, { key = '', redraw = true, inspector = false, outline = inspector } = {}) {
    if (S.readOnly) return;
    const now = Date.now();
    if (!(key && key === S.lastKey && now - S.lastAt < 1200)) {
      S.undo.push(JSON.stringify(S.design));
      if (S.undo.length > 150) S.undo.shift();
      S.redo = [];
    }
    S.lastKey = key;
    S.lastAt = now;
    fn();
    dirty();
    if (redraw === 'soon') drawSoon();
    else if (redraw) draw();
    if (inspector) drawRight();
    if (outline && S.left === 'outline') drawLeft();
    tools();
  }
  function restore(json) {
    S.design = R.normalize(JSON.parse(json));
    if (S.sel && !findB(S.sel)) S.sel = null;
    dirty();
    draw();
    drawRight();
    drawLeft();
    tools();
  }
  const undo = () => { if (!S.undo.length || S.readOnly) return; S.redo.push(JSON.stringify(S.design)); S.lastKey = ''; restore(S.undo.pop()); };
  const redo = () => { if (!S.redo.length || S.readOnly) return; S.undo.push(JSON.stringify(S.design)); S.lastKey = ''; restore(S.redo.pop()); };

  function dirty() {
    S.save = 'unsaved';
    status();
    clearTimeout(S.timer);
    S.timer = setTimeout(save, 1100);
  }
  function saveMeta(fields) {
    if (S.readOnly) return Promise.resolve();
    Object.assign(S.pending, fields);
    S.save = 'unsaved';
    status();
    return save();
  }
  function save(extra = {}) {
    clearTimeout(S.timer);
    if (S.readOnly) return Promise.resolve();
    if (S.inflight) { S.again = true; return S.inflight; }
    if (S.save === 'saved' && !Object.keys(S.pending).length && !Object.keys(extra).length) return Promise.resolve();
    const fields = { ...S.pending };
    S.pending = {};
    const body = { draft: S.design, rev: S.rev, ...fields, ...extra };
    S.save = 'saving';
    status();
    S.inflight = api(`/nuvolve/app/api/docs/designs/${S.row.id}`, { method: 'PUT', body }).then((r) => {
      S.rev = r.rev;
      Object.assign(S.row, r);
      S.failures = 0;
      if (!S.again) S.save = 'saved';
      status();
      tools();
    }).catch((e) => {
      Object.assign(S.pending, fields, S.pending);
      if (e.status === 409) return conflict();
      if (e.status === 400 || e.status === 403 || e.status === 404) { S.save = 'error'; S.saveMsg = e.message; status(); toast(e.message, true); return; }
      S.failures++;
      S.save = 'error';
      S.saveMsg = "Couldn't save. Trying again...";
      status();
      S.timer = setTimeout(save, Math.min(30000, 1500 * 2 ** S.failures));
    }).finally(() => {
      S.inflight = null;
      if (S.again) { S.again = false; save(); }
    });
    return S.inflight;
  }
  async function flush() {
    if (S.readOnly) return;
    if (S.save !== 'saved' || Object.keys(S.pending).length) await save();
    if (S.inflight) await S.inflight;
    if (S.save === 'error') throw new Error(S.saveMsg || 'Save your changes first');
  }
  async function conflict() {
    S.save = 'error';
    S.saveMsg = 'Someone else changed this';
    status();
    const fresh = await api(`/nuvolve/app/api/docs/designs/${S.row.id}`).catch(() => null);
    modal('Someone else changed this design', `<p><b>${esc(fresh?.updated_by_name || 'Someone')}</b> saved changes to "${esc(S.row.name)}" ${fresh ? esc(docAgo(fresh.updated_at)) : ''} while you were working on it.</p>
      <p>Load their version to see what changed, or keep yours and replace theirs.</p>`, [
      { label: 'Load their version', onClick: () => { S.save = 'saved'; route(); } },
      { label: 'Keep my version', cls: 'primary', onClick: async () => { S.rev = fresh?.rev ?? S.rev; S.save = 'unsaved'; await save({ force: true }); } },
    ]);
  }
  function status() {
    const el = $('#b-status', root);
    const r = S.row;
    const ver = isTpl() ? (r.version ? `Published v${r.version}${r.dirty ? ' · changes not published' : ''}` : 'Draft · not published') : (r.status === 'sent' ? 'Sent' : 'Draft');
    const st = S.readOnly ? (r.archived ? 'Archived' : 'View only') : S.save === 'saving' ? 'Saving...' : S.save === 'unsaved' ? 'Unsaved changes' : S.save === 'error' ? S.saveMsg : 'All changes saved';
    el.textContent = `${st} · ${ver}`;
    el.classList.toggle('err', S.save === 'error');
    $('#b-purpose', root).innerHTML = `<span class="pill ${isTpl() ? 'blue' : ''}" title="${isTpl() ? 'Used for many records' : 'Made once, for one person or job'}">${isTpl() ? 'Template' : 'One-off'}</span>`;
  }
  function tools() {
    $('[data-act=undo]', root).disabled = !S.undo.length || S.readOnly;
    $('[data-act=redo]', root).disabled = !S.redo.length || S.readOnly;
    const pub = $('#b-publish', root);
    pub.hidden = !isTpl() || S.readOnly;
    pub.disabled = Boolean(S.row.version && !S.row.dirty && S.save === 'saved');
    pub.textContent = S.row.version ? (S.row.dirty || S.save !== 'saved' ? 'Publish changes' : 'Published ✓') : 'Publish';
    pub.classList.toggle('primary', Boolean(!S.row.version || S.row.dirty));
    $('[data-act=names]', root).classList.toggle('primary', S.names);
    $('#b-preview', root).innerHTML = S.preview ? '✏️<span class="lbl lbl-2"> Back to editing</span>' : '👁<span class="lbl lbl-2"> Preview</span> ▾';
    $('#b-preview', root).classList.toggle('primary', S.preview);
  }
  function banner() {
    const b = $('#b-banner', root);
    const key = recKey();
    if (S.row.archived) {
      b.innerHTML = `<div class="bld-banner warn">This design is archived, so it can't be changed or used. ${S.row.canEdit ? '<button class="btn" data-act="unarchive">Restore it</button>' : ''}</div>`;
    } else if (S.readOnly) {
      b.innerHTML = '<div class="bld-banner">Only the owner or an admin can change templates. You can preview, download and send it, or make a one-off copy to change.<button class="btn" data-act="oneoff">Make a one-off copy</button></div>';
    } else if (!isTpl() && key && !S.params[key]) {
      b.innerHTML = `<div class="bld-banner">Who is this ${S.source === 'customer' ? 'for' : 'about'}? Pick the ${RECORD_WORD[S.source]} so the fields fill in with real details.<button class="btn" data-act="pick">Pick ${RECORD_WORD[S.source]}</button></div>`;
    } else b.innerHTML = '';
  }

  // ---------- data for the page ----------
  async function loadData() {
    const key = recKey();
    S.dataError = '';
    const real = key ? Boolean(S.params[key]) : S.source === 'applications' ? Boolean(S.params.from || S.params.to) : S.source === 'none';
    if (real) {
      try { S.data = (await api(`/nuvolve/app/api/docs/data?${new URLSearchParams({ source: S.source, ...S.params })}`)).data; S.real = true; }
      catch (e) { S.dataError = e.message; S.data = docSample(S.source); S.real = false; }
    } else { S.data = docSample(S.source); S.real = false; }
    S.data.doc = { title: S.row.name };
    if (!S.data.contract) S.data.contract = { ...(docSample(S.source).contract || {}) };
    note();
  }
  // The contract fields follow the signing settings, so "three business days" changes as you change it.
  function syncContract() {
    const c = S.data?.contract;
    if (!c) return;
    const n = S.design.sign.cancelDays;
    Object.assign(c, { cancel_days: n || '', cancel_days_words: n ? R.numberWord(n) : '', cancel_day_nth: n ? R.ordinalWord(n) : '' });
    if (!n) c.cancel_by = '';
    else if (S.real || !c.cancel_by || c._days !== n) { c.cancel_by = R.addBusinessDays(todayStr(), n); c._days = n; }
  }
  function recordLabel() {
    if (S.source === 'applications') {
      const p = S.params;
      return S.real ? `applications ${DocRender.fmtDate(p.from, 'medium')} to ${DocRender.fmtDate(p.to, 'medium')}` : '';
    }
    return S.row.record_title || S.recordTitle || '';
  }
  function note() {
    const n = $('#b-note', root);
    if (S.preview) { n.innerHTML = 'Preview: this is how it prints. Rows that are hidden by a rule are left out.'; return; }
    if (S.source === 'none') { n.innerHTML = ''; return; }
    if (S.dataError) { n.innerHTML = `<span style="color:var(--danger)">${esc(S.dataError)}.</span> Showing sample data. <button class="link-btn" data-act="data-tab">Change</button>`; return; }
    n.innerHTML = S.real ? `Showing real data: <b>${esc(recordLabel() || 'the chosen record')}</b> · <button class="link-btn" data-act="data-tab">Change</button>`
      : `Showing sample data · <button class="link-btn" data-act="data-tab">Preview with a real ${esc(S.source === 'applications' ? 'date range' : RECORD_WORD[S.source] || 'record')}</button>`;
  }

  // ---------- drawing the page ----------
  const zoomVal = () => {
    if (S.zoom !== 'fit') return Number(S.zoom) || 1;
    const { w } = docPaperSize(S.design);
    return Math.max(0.3, Math.min(1.15, (cv.clientWidth - 56) / w));
  };
  function applyZoom() {
    const z = zoomVal();
    wrap.style.zoom = z;
    $('#b-zoom', root).textContent = `${Math.round(z * 100)}%`;
  }
  let drawTimer = null;
  const drawSoon = () => { clearTimeout(drawTimer); drawTimer = setTimeout(draw, 80); };
  function draw() {
    clearTimeout(drawTimer);
    const d = S.design;
    const { w } = docPaperSize(d);
    const m = d.page.margin;
    const edit = !S.preview;
    const ins = R.insets(d);
    paper.style.width = `${w}px`;
    paper.style.padding = `${ins.t}px ${ins.r}px ${ins.b}px ${ins.l}px`;
    syncContract();
    // The page's own background and border, drawn the way they print.
    const look = R.pageLook(d, S.data, ro());
    paper.style.background = look.bg || '#fff';
    let frame = $('#b-frame', paper);
    if (look.frame) {
      if (!frame) { frame = document.createElement('div'); frame.id = 'b-frame'; frame.className = 'bld-frame'; paper.prepend(frame); }
      frame.style.cssText = `top:${m.t * PX}px;right:${m.r * PX}px;bottom:${m.b * PX}px;left:${m.l * PX}px;border:${look.frame}`;
    } else if (frame) frame.remove();
    let html;
    try { html = R.render(d, S.data, ro({ edit, fieldNames: edit && S.names })); }
    catch (e) { html = `<div class="nvdoc"><div class="nv-ph">The page could not be drawn: ${esc(e.message)}</div></div>`; }
    doc.className = `bld-doc${S.preview ? ' bld-preview' : ''}`;
    doc.innerHTML = html;
    const nv = doc.firstElementChild;
    if (edit && nv && !d.blocks.length) nv.insertAdjacentHTML('beforeend', `<div class="bld-empty"><b>This page is empty</b>${S.readOnly ? '' : 'Drag blocks here from the left, or click one to add it.'}</div>`);
    if (edit && !S.readOnly) $$('[data-edit]', doc).forEach((el) => { el.contentEditable = 'true'; el.spellcheck = true; });
    // Running header and footer, shown in the page margins.
    const mp = R.marginPreview(d, S.data, ro());
    const font = `font-family:${R.FONTS[d.page.font].css};font-size:${Math.max(6.5, d.page.fontSize - 2)}pt`;
    const empty = (arr) => arr.every((x) => !x);
    const mtop = $('#b-mtop', root);
    const mbot = $('#b-mbot', root);
    mtop.style.cssText = `top:${Math.max(6, m.t * PX - 30)}px;left:${m.l * PX}px;right:${m.r * PX}px;${font};pointer-events:${S.readOnly ? 'none' : 'auto'};cursor:pointer;align-items:end`;
    mbot.style.cssText = `bottom:${Math.max(6, m.b * PX - 34)}px;left:${m.l * PX}px;right:${m.r * PX}px;${font};pointer-events:${S.readOnly ? 'none' : 'auto'};cursor:pointer`;
    const hint = (what) => (edit && !S.readOnly ? `<span style="grid-column:1/-1;text-align:center;color:#c3ccd5">Click to add a ${what} (page numbers, license #...)</span>` : '');
    mtop.innerHTML = empty(mp.header) ? hint('header') : mp.header.map((x) => `<span>${x}</span>`).join('');
    mbot.innerHTML = empty(mp.footer) ? hint('footer') : mp.footer.map((x) => `<span>${x}</span>`).join('');
    applyZoom();
    guides();
    markSel();
    note();
  }

  // Dashed lines where pages will break (close to, but not exactly, where the printer breaks them).
  function guides() {
    $$('.bld-pagebreak', paper).forEach((x) => x.remove());
    const d = S.design;
    const { h } = docPaperSize(d);
    const ins = R.insets(d);
    const contentH = h - ins.t - ins.b;
    const nv = doc.firstElementChild;
    if (!nv || contentH < 50) return;
    const z = zoomVal();
    const top0 = paper.getBoundingClientRect().top;
    const y = (v) => (v - top0) / z;
    let start = ins.t;
    const cuts = [];
    let lowest = 0;
    for (const el of nv.children) {
      if (!el.classList.contains('nv-b')) continue;
      if (el.classList.contains('nv-free')) { lowest = Math.max(lowest, y(el.getBoundingClientRect().bottom)); continue; }
      const r = el.getBoundingClientRect();
      const t = y(r.top), b = y(r.bottom);
      if (el.dataset.type === 'pagebreak') { cuts.push(b); start = b; continue; }
      let n = 0;
      while (b - start > contentH + 1 && n++ < 60) {
        const whole = el.classList.contains('nv-keep') || b - t < Math.min(150, contentH / 3);
        const cut = whole && t > start + 1 ? t : start + contentH;
        cuts.push(cut);
        start = cut;
      }
    }
    // Blocks placed low down carry on to more pages.
    for (let n = 0; lowest - start > contentH + 1 && n < 60; n++) { start += contentH; cuts.push(start); }
    cuts.forEach((c, i) => paper.insertAdjacentHTML('beforeend', `<div class="bld-pagebreak" style="top:${c}px"><span>Page ${i + 2}</span></div>`));
    paper.style.minHeight = `${Math.max(h, start + contentH + ins.b)}px`;
  }

  // ---------- selection ----------
  const selEl = () => (S.sel ? doc.querySelector(`[data-bid="${CSS.escape(S.sel)}"]`) : null);
  function select(bid, { scroll = false } = {}) {
    if (bid && !findB(bid)) bid = null;
    const changed = bid !== S.sel;
    S.sel = bid;
    markSel();
    if (bid) S.right = 'block';
    if (changed || bid) drawRight();
    if (S.left === 'outline') drawLeft();
    if (scroll && selEl()) selEl().scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (bid && innerWidth <= 900) root.classList.remove('show-left');
  }
  function markSel() {
    $$('.bld-sel', doc).forEach((x) => x.classList.remove('bld-sel'));
    const el = selEl();
    if (S.sel && !el && !findB(S.sel)) S.sel = null;
    if (el) el.classList.add('bld-sel');
    placeBar();
  }
  const relRect = (el) => {
    const c = cv.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { top: r.top - c.top + cv.scrollTop, left: r.left - c.left + cv.scrollLeft, width: r.width, height: r.height, vtop: r.top - c.top };
  };
  function placeBar() {
    const el = selEl();
    const b = selBlock();
    placeRsz();
    if (!el || !b || S.preview || S.readOnly || S.editing || fd?.moved) { bar.hidden = true; return; }
    const ps = parents(b.id);
    const free = Boolean(b.style?.free);
    bar.innerHTML = `<span class="lbl" draggable="${!free}" title="${free ? 'Drag the block itself to move it' : 'Drag to move'}">${free ? '✥' : '⠿'} ${esc(R.BLOCKS[b.type].label)}</span>
      ${free ? '<button data-b="inline" title="Put it back in line with the text">⇲ In line</button><button data-b="front" title="Bring to front">⬆</button><button data-b="back" title="Send behind the text">⬇</button>'
    : `<button data-b="up" title="Move up (Alt+↑)">↑</button><button data-b="down" title="Move down (Alt+↓)">↓</button><button data-b="free" title="Place freely: drag it anywhere">✥</button>`}
      ${ps.length ? `<button data-b="parent" title="Select the ${esc(R.BLOCKS[ps[ps.length - 1].type].label.toLowerCase())} around it">⬑</button>` : ''}
      <button data-b="dup" title="Duplicate (Ctrl+D)">⧉</button><button data-b="del" title="Delete (Del)">🗑</button>
      <button data-b="settings" class="bld-mobile" title="Change this block">⚙</button>`;
    bar.hidden = false;
    const r = relRect(el);
    const h = bar.offsetHeight || 28;
    bar.style.top = `${r.vtop < h + 8 ? r.top + 4 : r.top - h - 6}px`;
    bar.style.left = `${Math.max(4, r.left - 2)}px`;
  }
  // The corner handle that resizes a block placed freely.
  function placeRsz() {
    const el = selEl();
    const b = selBlock();
    if (!el || !b?.style?.free || S.preview || S.readOnly) { rsz.hidden = true; return; }
    const r = relRect(el);
    rsz.hidden = false;
    rsz.style.top = `${r.top + r.height - 7}px`;
    rsz.style.left = `${r.left + r.width - 7}px`;
  }
  function placeRt() {
    const ed = S.editing;
    if (!ed || !document.body.contains(ed)) { rt.hidden = true; return; }
    const rich = ed.dataset.edit === 'rich';
    rt.innerHTML = rich ? `<button data-rt="bold" title="Bold (Ctrl+B)"><b>B</b></button><button data-rt="italic" title="Italic (Ctrl+I)"><i>I</i></button>
      <button data-rt="underline" title="Underline (Ctrl+U)"><u>U</u></button><button data-rt="strikeThrough" title="Strike through"><s>S</s></button><span class="sep"></span>
      <button data-rt="h4" title="Small heading">H</button><button data-rt="insertUnorderedList" title="Bullet list">•</button><button data-rt="insertOrderedList" title="Numbered list">1.</button><span class="sep"></span>
      <button data-rt="justifyLeft" title="Align left">⇤</button><button data-rt="justifyCenter" title="Center">≡</button><button data-rt="justifyRight" title="Align right">⇥</button><span class="sep"></span>
      <button data-rt="color" title="Text color">A</button><button data-rt="link" title="Link">🔗</button><button data-rt="removeFormat" title="Clear formatting">⌫</button><span class="sep"></span>
      <button data-rt="field" class="fx" title="Insert a field (customer name, date, total...)">{x} Field</button>`
      : '<button data-rt="field" class="fx" title="Insert a field">{x} Insert field</button><span class="sep"></span><button data-rt="done" title="Done (Esc)">Done</button>';
    rt.hidden = false;
    const r = relRect(ed.closest('[data-bid]') || ed);
    const h = rt.offsetHeight || 34;
    rt.style.top = `${r.vtop < h + 8 ? r.top + r.height + 6 : r.top - h - 6}px`;
    rt.style.left = `${Math.max(4, r.left)}px`;
  }

  // ---------- adding, moving and removing blocks ----------
  function addBlock(b, { where } = {}) {
    if (S.readOnly) return;
    let key = 'root', index = S.design.blocks.length;
    const hit = findB(S.sel);
    if (b.style?.free) {
      // Placed freely: always on the page itself, near what you are looking at.
      const sel = selEl();
      const at = sel ? blockBox(sel).y : visibleY();
      b.style = { ...b.style, y: Math.max(0, Math.round(at)) };
      if (where?.y != null) Object.assign(b.style, { x: Math.round(where.x), y: Math.round(where.y) });
      change(() => { S.design.blocks.push(b); }, { outline: true });
      select(b.id, { scroll: true });
      return;
    }
    if (where) ({ key, index } = where);
    else if (hit) {
      const def = R.BLOCKS[hit.block.type];
      if (def.container) {
        const slots = def.slots(hit.block);
        const si = Math.max(0, slots.findIndex((s) => !s.length));
        key = `${hit.block.id}:${si}`;
        index = slots[si].length;
      } else { key = keyOf(hit); index = hit.index + 1; }
    }
    change(() => { (listAt(key) || S.design.blocks).splice(index, 0, b); }, { inspector: false, outline: true });
    select(b.id, { scroll: true });
  }
  function moveTo(bid, key, index) {
    const hit = findB(bid);
    if (!hit) return;
    if (key !== 'root') {
      const owner = key.split(':')[0];
      if (owner === bid || R.find([hit.block], owner)) { toast("A block can't go inside itself", true); return; }
    }
    change(() => {
      const h2 = findB(bid);
      const dest = listAt(key);
      if (!dest) return;
      h2.list.splice(h2.index, 1);
      let i = index;
      if (dest === h2.list && h2.index < index) i--;
      dest.splice(Math.max(0, Math.min(i, dest.length)), 0, h2.block);
    }, { outline: true });
    select(bid);
  }
  function nudge(bid, dir) {
    const hit = findB(bid);
    if (!hit) return;
    const to = hit.index + dir;
    if (to < 0 || to >= hit.list.length) return;
    change(() => { const h2 = findB(bid); h2.list.splice(h2.index, 1); h2.list.splice(to, 0, h2.block); }, { outline: true, key: `nudge:${bid}` });
    markSel();
  }
  function duplicate(bid) {
    const hit = findB(bid);
    if (!hit) return;
    const copy = freshIds(R.clone(hit.block));
    change(() => { const h2 = findB(bid); h2.list.splice(h2.index + 1, 0, copy); }, { outline: true });
    select(copy.id);
  }
  function remove(bid) {
    const hit = findB(bid);
    if (!hit) return;
    const next = hit.list[hit.index + 1]?.id || hit.list[hit.index - 1]?.id || hit.parent?.id || null;
    change(() => { const h2 = findB(bid); h2.list.splice(h2.index, 1); }, { outline: true });
    select(next);
    toast(`${R.BLOCKS[hit.block.type].label} deleted. Ctrl+Z brings it back.`);
  }

  // ---------- placing blocks freely ----------
  // Positions are in points from the top left of the writing area, the same numbers the page prints with.
  const nvRect = () => doc.firstElementChild?.getBoundingClientRect();
  function blockBox(el) {
    const z = zoomVal();
    const n = nvRect();
    const r = el.getBoundingClientRect();
    return { x: ((r.left - n.left) / z) * PT, y: ((r.top - n.top) / z) * PT, w: (r.width / z) * PT, h: (r.height / z) * PT };
  }
  function visibleY() {
    const n = nvRect();
    if (!n) return 0;
    return Math.max(0, ((cv.getBoundingClientRect().top + 80 - n.top) / zoomVal()) * PT);
  }
  const contentW = () => ((nvRect()?.width || 0) / zoomVal()) * PT;
  function toggleFree(on, bid = S.sel) {
    const b = findB(bid)?.block;
    const el = doc.querySelector(`[data-bid="${CSS.escape(bid || '')}"]`);
    if (!b || !el || S.readOnly) return;
    if (!on) {
      change(() => { const st = findB(bid).block.style || {}; ['free', 'x', 'y', 'w', 'z', 'rot'].forEach((k) => delete st[k]); }, { inspector: true, outline: true });
      return;
    }
    const box = blockBox(el);
    const inner = ['logo', 'qr', 'stamp', 'image'].includes(b.type) ? el.querySelector('img, .nv-logo-ph, .nv-qr-ph, .nv-stamp, .nv-img-ph') : null;
    const w = inner ? blockBox(inner).w : box.w;
    change(() => {
      const hit = findB(bid);
      if (hit.parent) {
        // Out of its column or box, onto the page just before it.
        const top = parents(bid)[0];
        hit.list.splice(hit.index, 1);
        S.design.blocks.splice(Math.max(0, S.design.blocks.findIndex((x) => x.id === top.id)), 0, hit.block);
      }
      const blk = findB(bid).block;
      blk.style = { ...(blk.style || {}), free: true, x: Math.round(box.x), y: Math.round(box.y), w: Math.max(8, Math.round(w)) };
      delete blk.style.width;
      delete blk.style.place;
      delete blk.style.keep;
    }, { inspector: true, outline: true });
    select(bid);
  }
  function layer(where) {
    const b = selBlock();
    if (!b?.style?.free) return;
    let top = 1;
    R.walk(S.design.blocks, (x) => { if (x.style?.free && x.id !== b.id) top = Math.max(top, x.style.z || 1); });
    change(() => { selBlock().style.z = where === 'back' ? -1 : Math.min(99, top + 1); }, { inspector: true });
    toast(where === 'back' ? 'Behind the text now. Click it on the page or in Outline to pick it again.' : 'In front now');
  }
  function alignFree(a) {
    const b = selBlock();
    const el = selEl();
    if (!b?.style?.free || !el) return;
    const w = blockBox(el).w;
    const cw = contentW();
    change(() => {
      const st = selBlock().style;
      if (a === 'left') st.x = 0;
      else if (a === 'center') st.x = Math.round((cw - w) / 2);
      else if (a === 'right') st.x = Math.round(cw - w);
      else if (a === 'top') st.y = 0;
    }, { inspector: true });
  }

  // Dragging and resizing with the mouse, a pen or a finger. Snaps to the page edges, its middle and other free blocks.
  let liveRaf = 0;
  const liveDraw = () => { cancelAnimationFrame(liveRaf); liveRaf = requestAnimationFrame(() => draw()); };
  function showSnap(xLine, yLine) {
    $$('.bld-snap', paper).forEach((x) => x.remove());
    const ins = R.insets(S.design);
    if (xLine != null) paper.insertAdjacentHTML('beforeend', `<div class="bld-snap v" style="left:${ins.l + xLine / PT}px"></div>`);
    if (yLine != null) paper.insertAdjacentHTML('beforeend', `<div class="bld-snap h" style="top:${ins.t + yLine / PT}px"></div>`);
  }
  function snapFree(f, x, y) {
    const cw = contentW();
    const others = $$('.nv-free[data-bid]', doc).filter((o) => o.dataset.bid !== f.bid).map(blockBox);
    const T = 5;
    let bx = null, by = null;
    const gx = [0, cw / 2, cw, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
    for (const g of gx) for (const c of [g, g - f.w / 2, g - f.w]) { const dd = Math.abs(x - c); if (dd < T && (!bx || dd < bx.d)) bx = { d: dd, v: c, line: g }; }
    const gy = [0, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
    for (const g of gy) for (const c of [g, g - f.h / 2, g - f.h]) { const dd = Math.abs(y - c); if (dd < T && (!by || dd < by.d)) by = { d: dd, v: c, line: g }; }
    showSnap(bx?.line, by?.line);
    return { x: bx ? bx.v : x, y: by ? by.v : y };
  }
  const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  doc.addEventListener('pointerdown', (e) => {
    if (S.preview || S.readOnly || e.button !== 0) return;
    const el = e.target.closest('.nv-free[data-bid]');
    if (!el || !doc.contains(el)) return;
    const ed = e.target.closest('[contenteditable="true"]');
    if (ed && document.activeElement === ed) return; // typing in it: select text as usual
    const b = findB(el.dataset.bid)?.block;
    if (!b?.style?.free) return;
    // Hold off focusing the text until we know it was a click, not a drag.
    if (ed) e.preventDefault();
    const box = blockBox(el);
    fd = { el, bid: b.id, mode: 'move', pid: e.pointerId, sx: e.clientX, sy: e.clientY, x0: b.style.x || 0, y0: b.style.y || 0, w: box.w, h: box.h, moved: false, ed };
  });
  rsz.addEventListener('pointerdown', (e) => {
    const b = selBlock();
    const el = selEl();
    if (!b?.style?.free || !el) return;
    e.preventDefault();
    e.stopPropagation();
    const box = blockBox(el);
    fd = { el, bid: b.id, mode: 'size', pid: e.pointerId, sx: e.clientX, sy: e.clientY, w0: b.style.w || box.w, bh0: b.h ?? box.h, moved: false };
    rsz.setPointerCapture(e.pointerId);
  });
  function onFreeMove(e) {
    if (!fd || e.pointerId !== fd.pid) return;
    if (!fd.moved && Math.hypot(e.clientX - fd.sx, e.clientY - fd.sy) < 4) return;
    const z = zoomVal();
    const dx = ((e.clientX - fd.sx) / z) * PT;
    const dy = ((e.clientY - fd.sy) / z) * PT;
    if (!fd.moved) {
      fd.moved = true;
      doc.classList.add('bld-dragging');
      getSelection().removeAllRanges();
      if (S.sel !== fd.bid) { S.sel = fd.bid; markSel(); drawRight(); }
      bar.hidden = true;
      if (fd.mode === 'size') { S.undo.push(JSON.stringify(S.design)); if (S.undo.length > 150) S.undo.shift(); S.redo = []; S.lastKey = ''; }
    }
    e.preventDefault();
    if (fd.mode === 'move') {
      let x = fd.x0 + dx, y = fd.y0 + dy;
      if (!e.altKey) ({ x, y } = snapFree(fd, x, y)); else showSnap();
      fd.x = Math.round(x);
      fd.y = Math.round(y);
      fd.el.style.left = `${fd.x}pt`;
      fd.el.style.top = `${fd.y}pt`;
      placeRsz();
      return;
    }
    const blk = findB(fd.bid)?.block;
    if (!blk) return;
    const w = Math.max(8, Math.round(fd.w0 + dx));
    blk.style.w = w;
    if (blk.type === 'logo') blk.h = clampN(Math.round((fd.bh0 * w) / fd.w0), 10, 500);
    else if (blk.type === 'qr') { blk.size = clampN(w, 36, 220); blk.style.w = blk.size; }
    else if (blk.type === 'sign') blk.h = clampN(Math.round(fd.bh0 + dy), 16, 140);
    else if (blk.type === 'spacer') blk.h = clampN(Math.round(fd.bh0 + dy), 2, 400);
    else if (blk.type === 'shape' && blk.kind !== 'line') blk.h = clampN(Math.round(fd.bh0 + dy), 1, 2000);
    liveDraw();
  }
  function onFreeUp(e) {
    if (!fd || e.pointerId !== fd.pid) return;
    const f = fd;
    fd = null;
    doc.classList.remove('bld-dragging');
    showSnap();
    if (!f.moved) {
      // A click on text in a free block: start typing where it was clicked.
      if (f.ed && document.body.contains(f.ed)) {
        f.ed.focus();
        const r = document.caretRangeFromPoint?.(e.clientX, e.clientY);
        if (r && f.ed.contains(r.startContainer)) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); S.range = r.cloneRange(); }
      }
      return;
    }
    S.dragEnd = Date.now();
    if (f.mode === 'move') change(() => { const st = findB(f.bid).block.style; st.x = f.x; st.y = f.y; }, { inspector: true });
    else { cancelAnimationFrame(liveRaf); dirty(); draw(); drawRight(); tools(); }
  }
  window.addEventListener('pointermove', onFreeMove, { passive: false });
  window.addEventListener('pointerup', onFreeUp);
  window.addEventListener('pointercancel', onFreeUp);

  // ---------- typing on the page ----------
  function plainOf(node) {
    let out = '';
    const walkN = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.nodeName === 'BR') out += '\n';
        else if (/^(DIV|P|LI)$/.test(c.nodeName)) { if (out && !out.endsWith('\n')) out += '\n'; walkN(c); }
        else walkN(c);
      }
    };
    walkN(node);
    return out.replace(/ /g, ' ').replace(/​/g, '').replace(/\n+$/, '');
  }
  function readEditable(el) {
    const copy = el.cloneNode(true);
    $$('.nv-chip', copy).forEach((c) => c.replaceWith(document.createTextNode(`{{${c.dataset.f}}}`)));
    $$('.nv-ph', copy).forEach((c) => c.remove());
    if (el.dataset.edit !== 'rich') return plainOf(copy);
    const html = R.sanitizeRich(copy.innerHTML);
    return html.replace(/<[^>]*>/g, '').trim() ? html : '';
  }
  function commitEditable(el) {
    const bEl = el.closest('[data-bid]');
    const hit = bEl && findB(bEl.dataset.bid);
    if (!hit) return;
    const prop = el.dataset.edit === 'rich' ? 'html' : el.dataset.edit;
    const v = readEditable(el);
    if (hit.block[prop] === v) return;
    change(() => { findB(hit.block.id).block[prop] = v; }, { key: `type:${hit.block.id}:${prop}`, redraw: false });
    const inp = right.querySelector(`[data-bind="${prop}"]:not([data-scope])`);
    if (inp && document.activeElement !== inp && S.sel === hit.block.id) inp.value = v;
    if (S.left === 'outline') drawLeft();
  }
  function caretAfter(node) {
    const r = document.createRange();
    r.setStartAfter(node);
    r.collapse(true);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    S.range = r.cloneRange();
  }
  function makeChip(token, list) {
    const path = token.split('|')[0];
    const span = document.createElement('span');
    span.className = 'nv-chip';
    span.contentEditable = 'false';
    span.dataset.f = token;
    const v = path.startsWith('item.') ? '' : sampleOf(token);
    if (!v || S.names) { span.classList.toggle('nv-chip-empty', !v); span.innerHTML = `<span class="nv-chip-l">${esc(fieldLabel(path, list))}</span>`; }
    else span.textContent = v;
    span.title = fieldLabel(path, list);
    return span;
  }
  // Puts a field where the cursor is. Without a cursor in text, it adds the field to the selected block, or a new line of text.
  function insertField(path) {
    if (S.readOnly) return;
    const ed = S.editing;
    const list = S.sel ? itemList(S.sel) : '';
    if (path.startsWith('item.') && !ed) {
      const b = selBlock();
      if (b?.type === 'table' && b.list) {
        const key = path.slice(5);
        change(() => { selBlock().columns.push({ label: fieldLabel(path, b.list), field: key, align: ['money', 'number'].includes(fieldType(path, b.list)) ? 'right' : 'left' }); }, { inspector: true });
        return;
      }
    }
    if (ed && document.body.contains(ed) && S.range) {
      ed.focus();
      const inChip = (S.range.startContainer.nodeType === 1 ? S.range.startContainer : S.range.startContainer.parentElement)?.closest('.nv-chip');
      if (inChip && ed.contains(inChip)) caretAfter(inChip);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(S.range);
      const chip = makeChip(path, list);
      const r = S.range;
      r.deleteContents();
      r.insertNode(chip);
      const after = document.createRange();
      after.setStartAfter(chip);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
      S.range = after;
      commitEditable(ed);
      return;
    }
    const b = selBlock();
    if (b?.type === 'fields') {
      change(() => { selBlock().rows.push({ label: fieldLabel(path, list), value: `{{${path}}}` }); }, { inspector: true });
      return;
    }
    if (b && ['heading', 'text'].includes(b.type)) {
      change(() => { const x = selBlock(); if (x.type === 'heading') x.text = `${x.text ? `${x.text} ` : ''}{{${path}}}`; else x.html = `${x.html || ''}<p>{{${path}}}</p>`; }, { inspector: true });
      return;
    }
    addBlock({ id: R.newId(), type: 'text', html: `<p>${esc(fieldLabel(path, list))}: {{${path}}}</p>` });
  }

  // ---------- the field picker (for inputs in the panel and the text toolbar) ----------
  let pop = null;
  // Leaving a text block: save what was typed and redraw, so fields show their values again.
  function finishEditing(el = S.editing) {
    if (!el) return;
    if (S.editing === el) { S.editing = null; S.range = null; }
    rt.hidden = true;
    if (document.body.contains(el)) commitEditable(el);
    draw();
  }
  const closePop = () => {
    if (pop) { pop.remove(); pop = null; }
    setTimeout(() => { if (!pop && S.editing && !S.editing.contains(document.activeElement)) finishEditing(); }, 30);
  };
  function fieldPicker(anchor, onPick, { list = '', only = null, itemsOnly = false } = {}) {
    closePop();
    pop = document.createElement('div');
    pop.className = 'fx-pop';
    const groups = itemsOnly ? [] : cat().groups;
    const lists = list ? cat().lists.filter((l) => l.key === list) : [];
    const ok = (t) => !only || only.includes(t);
    pop.innerHTML = `<input placeholder="Search fields" aria-label="Search fields"><div class="body">
      ${lists.map((l) => `<div class="fld-group" data-g><b>Each ${esc(l.label.toLowerCase())} row</b>${l.fields.filter((f) => ok(f.type)).map((f) => `<button class="fld" data-p="item.${f.key}" data-s="${esc(`${f.label} ${l.label}`.toLowerCase())}"><span>${esc(f.label)}</span></button>`).join('')}</div>`).join('')}
      ${groups.map((g) => `<div class="fld-group" data-g><b>${esc(g.group)}</b>${g.fields.filter((f) => ok(f.type)).map((f) => `<button class="fld" data-p="${f.path}" data-s="${esc(`${f.label} ${g.group}`.toLowerCase())}"><span>${esc(f.label)}</span><span class="v">${esc(sampleOf(f.path).split('\n')[0])}</span></button>`).join('')}</div>`).join('')}
      ${!itemsOnly ? '<div class="fld-group" data-g><b>Page numbers</b><button class="fld" data-p="page" data-s="page number"><span>Page number</span></button><button class="fld" data-p="pages" data-s="pages total count"><span>Total pages</span></button></div>' : ''}
    </div>`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const top = r.bottom + 6 + 380 > innerHeight ? Math.max(8, r.top - 386) : r.bottom + 6;
    pop.style.top = `${top}px`;
    pop.style.left = `${Math.max(8, Math.min(innerWidth - 310, r.left))}px`;
    const input = $('input', pop);
    input.oninput = () => {
      const q = input.value.trim().toLowerCase();
      $$('.fld', pop).forEach((b) => { b.hidden = q && !b.dataset.s.includes(q); });
      $$('[data-g]', pop).forEach((g) => { g.hidden = !$$('.fld', g).some((b) => !b.hidden); });
    };
    input.onkeydown = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closePop(); }
      if (e.key === 'Enter') { const b = $$('.fld', pop).find((x) => !x.hidden); if (b) b.click(); }
    };
    $$('.fld', pop).forEach((b) => {
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = () => { const p = b.dataset.p; onPick(p); closePop(); };
    });
    setTimeout(() => input.focus({ preventScroll: true }), 10);
  }
  // Puts {{field}} at the cursor of a panel input and saves it.
  function insertIntoInput(input, path) {
    const tok = `{{${path}}}`;
    const s = input.selectionStart ?? input.value.length;
    const e = input.selectionEnd ?? s;
    input.value = input.value.slice(0, s) + tok + input.value.slice(e);
    input.focus();
    input.setSelectionRange(s + tok.length, s + tok.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ---------- chip settings (format and "if empty") ----------
  function chipPop(chip) {
    closePop();
    const ed = chip.closest('[data-edit]');
    const [path, ...filters] = chip.dataset.f.split('|');
    const list = itemList(S.sel);
    const type = fieldType(path, list);
    const fmts = FORMATS[type] || FORMATS.text;
    const def = filters.find((f) => f.startsWith('default:'));
    const fmt = filters.filter((f) => !f.startsWith('default:')).join('|');
    $$('.bld-chip-sel', doc).forEach((x) => x.classList.remove('bld-chip-sel'));
    chip.classList.add('bld-chip-sel');
    pop = document.createElement('div');
    pop.className = 'chip-pop';
    pop.innerHTML = `<div class="t">${esc(fieldLabel(path, list))}</div>
      <div class="field"><label>Show it as</label><select data-c="fmt">${fmts.map(([v, l]) => `<option value="${v}" ${v === fmt ? 'selected' : ''}>${esc(l)}</option>`).join('')}${fmt && !fmts.some(([v]) => v === fmt) ? `<option value="${esc(fmt)}" selected>${esc(fmt)}</option>` : ''}</select></div>
      <div class="field"><label>If it's empty, show</label><input data-c="def" value="${esc(def ? def.slice(8) : '')}" placeholder="Nothing (the line is left out)"></div>
      <div style="display:flex;gap:6px;justify-content:space-between"><button class="btn sm danger" data-c="rm">Remove field</button><button class="btn sm primary" data-c="ok">Done</button></div>`;
    document.body.appendChild(pop);
    const r = chip.getBoundingClientRect();
    pop.style.top = `${r.bottom + 8 + 220 > innerHeight ? Math.max(8, r.top - 228) : r.bottom + 8}px`;
    pop.style.left = `${Math.max(8, Math.min(innerWidth - 280, r.left))}px`;
    const apply = () => {
      const f = $('[data-c=fmt]', pop).value;
      const d = $('[data-c=def]', pop).value.replace(/[|}]/g, '').trim();
      chip.dataset.f = [path, ...(f ? f.split('|') : []), ...(d ? [`default:${d}`] : [])].join('|');
      commitEditable(ed);
    };
    $('[data-c=fmt]', pop).onchange = apply;
    $('[data-c=def]', pop).oninput = apply;
    $('[data-c=rm]', pop).onclick = () => { chip.remove(); commitEditable(ed); closePop(); draw(); };
    $('[data-c=ok]', pop).onclick = () => { closePop(); draw(); };
  }

  // ---------- menus ----------
  function menu(anchor, items) {
    closePop();
    pop = document.createElement('div');
    pop.className = 'bld-menu';
    pop.innerHTML = items.map((it, i) => (it === '-' ? '<hr>' : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}><span class="i">${it.icon || ''}</span><span>${esc(it.label)}${it.sub ? `<span class="small">${esc(it.sub)}</span>` : ''}</span></button>`)).join('');
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = `${r.bottom + 6}px`;
    pop.style.left = `${Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth))}px`;
    $$('button', pop).forEach((b) => (b.onmousedown = (e) => e.preventDefault()));
    $$('button', pop).forEach((b) => (b.onclick = async () => {
      const it = items[Number(b.dataset.i)];
      closePop();
      try { await it.run(); } catch (e) { toast(e.message, true); }
    }));
  }
  const qsFor = (extra = {}) => {
    const p = { ...S.params };
    if (!S.real && S.source !== 'none') return new URLSearchParams({ sample: '1', ...extra }).toString();
    return new URLSearchParams({ ...p, ...extra }).toString();
  };
  const hasListTable = () => { let t = false; R.walk(S.design.blocks, (b) => { if (b.type === 'table' && b.list) t = true; }); return t; };
  async function openView() { await flush(); window.open(`/nuvolve/app/api/docs/designs/${S.row.id}/view?${qsFor()}`, '_blank', 'noopener'); }
  function outputMenu(anchor) {
    menu(anchor, [
      { icon: '📄', label: 'Download PDF', sub: meta.pdf ? (S.real ? 'Filled in with the chosen record' : 'With sample data. Pick a record in Data to fill it in.') : 'Not set up on this server yet. Use Print instead.', disabled: !meta.pdf,
        run: async () => { await flush(); location.href = `/nuvolve/app/api/docs/designs/${S.row.id}/pdf?${qsFor()}`; } },
      { icon: '🖨️', label: 'Print or save as PDF', sub: 'Opens the finished page with a Print button', run: openView },
      { icon: '📊', label: 'Download table as CSV', sub: hasListTable() ? 'The rows of the first list table, for a spreadsheet' : 'Add a table filled from a list first', disabled: !hasListTable(),
        run: async () => { await flush(); location.href = `/nuvolve/app/api/docs/designs/${S.row.id}/csv?${qsFor()}`; } },
    ]);
  }
  function moreMenu(anchor) {
    const items = [
      { icon: '🕘', label: 'Version history', sub: S.row.versions?.length ? `${S.row.versions.length} published version${S.row.versions.length === 1 ? '' : 's'}` : 'Nothing published yet', run: versions },
      { icon: '📤', label: 'Sent and shared copies', run: sentModal },
      '-',
      { icon: '⧉', label: 'Duplicate', sub: `Make a copy of this ${isTpl() ? 'template' : 'document'}`, disabled: isTpl() && !meta.canDesign,
        run: async () => { await flush(); const r = await api(`/nuvolve/app/api/docs/designs/${S.row.id}/duplicate`, { body: {} }); location.hash = `#/documents/${r.id}`; } },
      ...(isTpl() ? [{ icon: '✏️', label: 'Make a one-off copy', sub: 'Change it for one customer without touching the template', run: oneOff }]
        : [{ icon: '⭐', label: 'Turn into a template', sub: 'Reuse it for other records', disabled: !meta.canDesign || S.readOnly,
          run: async () => { await saveMeta({ purpose: 'template' }); status(); tools(); toast('This is a template now. Publish it to use it.'); } }]),
      { icon: '⬇', label: 'Export design file', sub: 'Share it with another company or branch', run: async () => { await flush(); location.href = `/nuvolve/app/api/docs/designs/${S.row.id}/export`; } },
      '-',
      { icon: '🗄', label: 'Archive', danger: true, disabled: S.readOnly, run: archive },
    ];
    menu(anchor, items);
  }
  async function oneOff() {
    await flush();
    const r = await api('/nuvolve/app/api/docs/designs', { body: { purpose: 'document', from_design: S.row.id, use: S.readOnly ? 'published' : 'draft', record: S.params } });
    location.hash = `#/documents/${r.id}`;
  }
  function archive() {
    modal(`Archive "${S.row.name}"?`, `<p>It moves to the Archived tab and can't be used until you restore it.${S.row.defaultFor?.length ? ' <b>It is a default right now</b>, so the built-in design is used instead.' : ''} Copies already sent keep working.</p>`, [
      { label: 'Cancel' },
      { label: 'Archive', cls: 'danger', onClick: async () => { await flush().catch(() => {}); await api(`/nuvolve/app/api/docs/designs/${S.row.id}`, { method: 'DELETE' }); S.save = 'saved'; location.hash = '#/documents?tab=archived'; } },
    ]);
  }
  async function versions() {
    const r = await api(`/nuvolve/app/api/docs/designs/${S.row.id}`);
    S.row.versions = r.versions;
    const m = modal('Version history', r.versions.length ? `<p class="muted" style="margin-top:0">Each time you publish, a version is saved. Customers always get the latest published version. Restoring copies a version into your draft so you can check it before publishing again.</p>
      <div class="pick-list" style="max-height:none">${r.versions.map((v) => `<div style="display:flex;gap:8px;align-items:center;padding:9px 12px;border-bottom:1px solid var(--line)">
        <div style="flex:1"><b>Version ${v.version}</b>${v.version === r.version ? ' <span class="pill green">Live</span>' : ''}<span class="small muted" style="display:block">${esc(docAgo(v.created_at))}${v.created_by_name ? ` by ${esc(v.created_by_name)}` : ''}${v.note ? ` · ${esc(v.note)}` : ''}</span></div>
        <button class="btn sm" data-look="${v.version}">Look</button>${S.readOnly ? '' : `<button class="btn sm" data-restore="${v.version}">Restore</button>`}</div>`).join('')}</div>`
      : '<p>Nothing is published yet. Press <b>Publish</b> when the design is ready, and a version is saved each time.</p>', [{ label: 'Close' }]);
    $('.modal', m.el).classList.add('mid');
    $$('[data-look]', m.el).forEach((b) => (b.onclick = async () => {
      const v = await api(`/nuvolve/app/api/docs/designs/${S.row.id}/versions/${b.dataset.look}`);
      const { w } = docPaperSize(v.design);
      const lm = modal(`Version ${v.version}`, `<div style="background:#e4e8ec;padding:14px;border-radius:8px;overflow:auto;max-height:70vh"><div style="background:#fff;margin:0 auto;width:${w}px;zoom:${Math.min(1, 620 / w)};padding:${v.design.page.margin.t * PX}px ${v.design.page.margin.r * PX}px ${v.design.page.margin.b * PX}px ${v.design.page.margin.l * PX}px">${R.render(v.design, S.data, ro())}</div></div>`, [{ label: 'Close' }]);
      $('.modal', lm.el).classList.add('wide');
    }));
    $$('[data-restore]', m.el).forEach((b) => (b.onclick = async () => {
      await flush();
      const out = await api(`/nuvolve/app/api/docs/designs/${S.row.id}/restore`, { body: { version: Number(b.dataset.restore) } });
      S.undo.push(JSON.stringify(S.design));
      S.design = R.normalize(out.draft);
      S.rev = out.rev;
      Object.assign(S.row, out);
      S.save = 'saved';
      m.close();
      select(null);
      draw();
      drawLeft();
      status();
      tools();
      toast(`Version ${b.dataset.restore} copied into your draft. Publish to make it live.`);
    }));
  }
  async function sentModal() {
    const m = modal(`Sent copies of "${S.row.name}"`, '<div id="b-sent"><p class="muted">Loading...</p></div>', [{ label: 'Close' }]);
    $('.modal', m.el).classList.add('wide');
    await sentList($('#b-sent', m.el), { designId: S.row.id, compact: true });
  }
  async function publish() {
    if (S.readOnly) return;
    const kind = S.row.kind;
    const canDefault = meta.isAdmin && meta.kinds[kind]?.defaultable && DOC_DEFAULT_SOURCE[kind] === S.source && !S.row.defaultFor?.includes(kind);
    const isDefault = S.row.defaultFor?.includes(kind);
    modal(S.row.version ? 'Publish your changes' : 'Publish this template', `
      <p style="margin-top:0">${isDefault ? `This is the ${esc(meta.kinds[kind].label.toLowerCase())} everyone gets, so the change shows up everywhere right away.` : 'Publishing saves a version. Anything made from this template from now on uses it. Copies already sent stay as they were.'}</p>
      <div class="field"><label>What changed? (optional)</label><input id="pb-note" maxlength="300" placeholder="New logo, added the license number..."></div>
      ${canDefault ? `<label class="check"><input type="checkbox" id="pb-def"> Make this the ${esc(meta.kinds[kind].label.toLowerCase())} everyone gets</label><div class="hint" style="margin-left:26px">${esc(meta.kinds[kind].defaultHelp)}</div>` : ''}`,
    [{ label: 'Cancel' }, { label: S.row.version ? 'Publish changes' : 'Publish', cls: 'primary', onClick: async (el) => {
      await flush();
      const r = await api(`/nuvolve/app/api/docs/designs/${S.row.id}/publish`, { body: { note: $('#pb-note', el).value } });
      Object.assign(S.row, r);
      S.rev = r.rev;
      if ($('#pb-def', el)?.checked) {
        const d = await api('/nuvolve/app/api/docs/defaults', { method: 'PUT', body: { kind, design_id: S.row.id } });
        meta.defaults = d.defaults;
        S.row.defaultFor = [...(S.row.defaultFor || []), kind];
      }
      S.row.versions = [{ version: r.version }, ...(S.row.versions || [])];
      status();
      tools();
      toast(`Published version ${r.version}`);
    } }]);
  }
  async function pickRecordForDoc() {
    const rec = await pickRecord(S.source);
    if (!rec) return;
    S.params = { ...S.params, [recKey()]: rec.id };
    S.recordTitle = rec.title;
    S.row.record_title = rec.title;
    await saveMeta({ record: S.params });
    await loadData();
    banner();
    draw();
    if (S.right === 'data') drawRight();
  }
  async function send() {
    try { await flush(); } catch (e) { return toast(e.message, true); }
    const key = recKey();
    if (key && !S.params[key]) {
      const rec = await pickRecord(S.source, { title: `Who is this going to? Pick the ${RECORD_WORD[S.source]}` });
      if (!rec) return;
      S.params = { ...S.params, [key]: rec.id };
      S.row.record_title = rec.title;
      if (!isTpl()) await saveMeta({ record: S.params });
      await loadData();
      banner();
      draw();
    }
    openSendModal({
      designId: S.row.id, source: S.source, params: S.params, title: S.row.name, design: S.design, data: S.data,
      use: S.readOnly && S.row.version ? 'published' : undefined, beforeSend: flush,
      onSent: () => { if (!isTpl()) { S.row.status = 'sent'; status(); } },
    });
  }

  // ---------- left panel: blocks, fields, outline ----------
  function drawLeft() {
    $('#b-ltabs', root).innerHTML = [['add', 'Add'], ['fields', 'Fields'], ['outline', 'Outline']].map(([k, l]) => `<button data-lt="${k}" class="${S.left === k ? 'on' : ''}">${l}</button>`).join('');
    if (S.left === 'add') leftAdd();
    else if (S.left === 'fields') leftFields();
    else leftOutline();
  }
  function leftAdd() {
    if (S.readOnly) { left.innerHTML = '<p class="muted small">This design is view only.</p>'; return; }
    const smart = meta.smart.filter((s) => s.sources.includes(S.source));
    const smartPal = (list) => `<div class="pal smart">${list.map((s) => `<button draggable="true" data-smart="${s.key}" data-s="${esc(`${s.label} ${s.desc}`.toLowerCase())}" title="${esc(s.desc)}"><span class="i">${s.icon}</span><span>${esc(s.label)}<span class="d">${esc(s.desc)}</span></span></button>`).join('')}</div>`;
    const ready = smart.filter((s) => !s.group);
    const contract = smart.filter((s) => s.group === 'contract');
    const design = smart.filter((s) => s.group === 'design');
    const grouped = new Set(BLOCK_GROUPS.flatMap(([, ts]) => ts));
    const groups = [...BLOCK_GROUPS, ['More', R.TYPES.filter((x) => !grouped.has(x))]].filter(([, ts]) => ts.length);
    const basic = groups.map(([g, ts]) => `<h4>${esc(g)}</h4><div class="pal">${ts.filter((x) => R.BLOCKS[x]).map((x) => `<button draggable="true" data-add="${x}" data-s="${esc(`${R.BLOCKS[x].label} ${BLOCK_HELP[x] || ''} ${g}`.toLowerCase())}" title="${esc(BLOCK_HELP[x] || '')}"><span class="i">${R.BLOCKS[x].icon}</span>${esc(R.BLOCKS[x].label)}</button>`).join('')}</div>`).join('');
    const contractFirst = S.row.kind === 'contract';
    const sections = [
      contract.length ? `<h4>Contract pieces</h4>${smartPal(contract)}` : '',
      ready.length ? `<h4>Ready-made for ${esc(cat().short.toLowerCase())}</h4>${smartPal(ready)}` : '',
    ];
    left.innerHTML = `<input class="bld-search" placeholder="Search blocks" id="b-bq" aria-label="Search blocks">
      ${(contractFirst ? sections : sections.reverse()).join('')}
      ${design.length ? `<h4>Design pieces</h4>${smartPal(design)}` : ''}
      ${basic}
      <p class="hint" style="margin-top:12px">Click a block to add it under the one you picked, or drag it to the exact spot on the page. Turn on <b>Place freely</b> to drag any block anywhere.</p>`;
    $('#b-bq', left).oninput = (e) => {
      const q = e.target.value.trim().toLowerCase();
      $$('.pal button', left).forEach((b) => { b.hidden = q && !b.dataset.s.includes(q); });
      $$('h4', left).forEach((h) => { const p = h.nextElementSibling; h.hidden = p && !$$('button', p).some((b) => !b.hidden); });
    };
  }
  function leftFields() {
    const c = cat();
    const list = S.sel ? itemList(S.sel) : '';
    left.innerHTML = `<input class="bld-search" placeholder="Search fields" id="b-fq" aria-label="Search fields">
      <p class="hint" style="margin:0 0 8px">Click to put a field where your cursor is, or drag it onto the page. Fields fill in from the ${esc(c.short.toLowerCase())} when the document is made.</p>
      ${c.groups.map((g) => `<div class="fld-group" data-g><b>${esc(g.group)}</b>${g.fields.map((f) => `<button class="fld" draggable="true" data-p="${f.path}" data-s="${esc(`${f.label} ${g.group}`.toLowerCase())}" title="{{${f.path}}}"><span>${esc(f.label)}</span><span class="v">${esc(sampleOf(f.path).split('\n')[0])}</span></button>`).join('')}</div>`).join('')}
      ${c.lists.length ? '<h4>Lists</h4>' : ''}
      ${c.lists.map((l) => `<div class="fld-list" data-g><div class="top"><span>${esc(l.label)} <span class="small muted">(${(S.data?.[l.key] || []).length})</span></span><button class="mini" data-table="${l.key}" title="Add a table of ${esc(l.label.toLowerCase())}">+ Table</button></div>
        <div class="small muted" style="margin:2px 0 4px">${list === l.key ? 'You are inside a repeat of this list, so these fill in for each row.' : 'Use these in a table column, or inside a Repeat block.'}</div>
        ${l.fields.map((f) => `<button class="fld" draggable="true" data-p="item.${f.key}" data-l="${l.key}" data-s="${esc(`${f.label} ${l.label}`.toLowerCase())}"><span>${esc(f.label)}</span></button>`).join('')}</div>`).join('')}`;
    $('#b-fq', left).oninput = (e) => {
      const q = e.target.value.trim().toLowerCase();
      $$('.fld', left).forEach((b) => { b.hidden = q && !b.dataset.s.includes(q); });
      $$('[data-g]', left).forEach((g) => { g.hidden = !$$('.fld', g).some((b) => !b.hidden); });
    };
  }
  const summary = (b) => {
    const strip = (s) => String(s || '').replace(/\{\{\s*([\w.]+)[^}]*\}\}/g, (_, p) => `[${fieldLabel(p, '')}]`).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const lbl = (k) => cat().labels[k] || k;
    switch (b.type) {
      case 'heading': return strip(b.text) || 'Heading';
      case 'text': return strip(b.html) || 'Empty text';
      case 'letterhead': return `Letterhead${b.title ? `: ${strip(b.title)}` : ''}`;
      case 'fields': return b.rows.map((r) => strip(r.label)).filter(Boolean).join(', ') || 'Field list';
      case 'table': return b.list ? `Table of ${lbl(b.list).toLowerCase()}` : 'Typed-in table';
      case 'columns': return `${b.cols.length} columns`;
      case 'section': return strip(b.title) || 'Section';
      case 'repeat': return b.list ? `For each ${lbl(b.list).toLowerCase()}` : 'Repeat (pick a list)';
      case 'signature': return b.sigs.map((s) => strip(s.label)).join(', ') || 'Signature';
      case 'stamp': return `Stamp: ${strip(b.text)}`;
      case 'spacer': return `Space (${b.h} pt)`;
      case 'sign': return `${b.who === 'company' ? 'Company' : 'Customer'} ${b.mark === 'initials' ? 'initials' : 'signature'}${b.label ? `: ${strip(b.label)}` : ''}`;
      case 'input': return `Fill-in: ${strip(b.label) || ({ text: 'text', date: 'a date', check: 'tick box', choice: 'pick one' })[b.kind]}`;
      case 'shape': return `${({ rect: 'Box', ellipse: 'Circle', line: 'Line' })[b.kind]}${b.text ? `: ${strip(b.text)}` : ''}`;
      default: return R.BLOCKS[b.type].label;
    }
  };
  function leftOutline() {
    const rows = [];
    R.walk(S.design.blocks, (b) => { rows.push({ b, depth: parents(b.id).length }); });
    left.innerHTML = rows.length ? `<p class="hint" style="margin:0 0 8px">Everything on the page, in order. Click to select, drag to move.</p>${rows.map(({ b, depth }) => `<button class="outline-row ${b.id === S.sel ? 'on' : ''}" data-o="${b.id}" draggable="${!S.readOnly}" style="padding-left:${6 + depth * 14}px">
      <span class="i">${R.BLOCKS[b.type].icon}</span><span class="t">${esc(summary(b))}</span>${b.style?.free ? '<span class="off" title="Placed freely">✥</span>' : ''}${b.showIf ? '<span class="off" title="Only shows when a rule matches">if…</span>' : ''}</button>`).join('')}`
      : '<p class="muted small">Nothing on the page yet.</p>';
  }

  // ---------- right panel: block, page, data ----------
  // Controls are plain HTML bound by data-bind (a path inside the block, or the design when data-scope="design").
  const attr = (path, scope, kind, rr) => `data-bind="${esc(path)}"${scope ? ` data-scope="${scope}"` : ''}${kind ? ` data-kind="${kind}"` : ''}${rr ? ' data-rr' : ''}`;
  const val = (scope, path) => getPath(scope === 'design' ? S.design : selBlock() || {}, path);
  const UI = {
    text(label, path, o = {}) {
      const v = val(o.scope, path) ?? '';
      const input = o.area ? `<textarea ${attr(path, o.scope)} rows="${o.rows || 3}" placeholder="${esc(o.ph || '')}">${esc(v)}</textarea>`
        : `<input ${attr(path, o.scope)} value="${esc(v)}" placeholder="${esc(o.ph || '')}"${o.max ? ` maxlength="${o.max}"` : ''}>`;
      return `<div class="field">${label ? `<label>${esc(label)}</label>` : ''}${o.fx ? `<div class="withfx">${input}<button type="button" class="fxbtn" data-fx="${esc(path)}"${o.scope ? ` data-fxscope="${o.scope}"` : ''}${o.list ? ` data-fxlist="${o.list}"` : ''}${o.itemsOnly ? ' data-fxitems' : ''} title="Insert a field">{x}</button></div>` : input}${o.hint ? `<div class="hint">${o.hint}</div>` : ''}</div>`;
    },
    num(label, path, o = {}) {
      const v = val(o.scope, path);
      return `<div class="field">${label ? `<label>${esc(label)}</label>` : ''}<input type="number" ${attr(path, o.scope, 'num', o.rr)} value="${v ?? ''}" min="${o.min ?? ''}" max="${o.max ?? ''}" step="${o.step ?? 1}" placeholder="${esc(o.ph || '')}">${o.hint ? `<div class="hint">${o.hint}</div>` : ''}</div>`;
    },
    range(label, path, o = {}) {
      const v = val(o.scope, path) ?? o.dflt ?? o.min;
      return `<div class="field"><label>${esc(label)} <span class="muted" data-out="${esc(path)}">${v}${o.unit || ''}</span></label><input type="range" ${attr(path, o.scope, 'num')} data-unit="${o.unit || ''}" value="${v}" min="${o.min}" max="${o.max}" step="${o.step || 1}" style="padding:0"></div>`;
    },
    select(label, path, opts, o = {}) {
      const v = String(val(o.scope, path) ?? '');
      return `<div class="field">${label ? `<label>${esc(label)}</label>` : ''}<select ${attr(path, o.scope, o.kind, o.rr)}>${typeof opts === 'string' ? opts : opts.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${o.hint ? `<div class="hint">${o.hint}</div>` : ''}</div>`;
    },
    check(label, path, o = {}) {
      return `<label class="check"><input type="checkbox" ${attr(path, o.scope, 'bool', o.rr)} ${val(o.scope, path) ? 'checked' : ''}> ${esc(label)}</label>${o.hint ? `<div class="hint" style="margin:-6px 0 8px 26px">${o.hint}</div>` : ''}`;
    },
    seg(label, path, opts, o = {}) {
      const v = 'current' in o ? o.current : val(o.scope, path);
      return `<div class="field">${label ? `<label>${esc(label)}</label>` : ''}<div class="bseg" style="display:flex">${opts.map(([k, l, t]) => `<button type="button" data-seg="${esc(path)}"${o.scope ? ` data-scope="${o.scope}"` : ''} data-v="${esc(JSON.stringify(k))}"${o.toggle ? ' data-toggle' : ''} class="${JSON.stringify(v ?? (o.dflt ?? null)) === JSON.stringify(k) ? 'on' : ''}" title="${esc(t || '')}">${l}</button>`).join('')}</div></div>`;
    },
    swatches(label, path, o = {}) {
      const v = val(o.scope, path) || '';
      const opts = [['', o.noneLabel || 'None'], ...(o.accent !== false ? [['accent', 'Brand color'], ['accent-soft', 'Light brand color']] : []), ...DOC_COLORS.slice(0, 6).map((c) => [c, c]), ...(o.extra || [])];
      return `<div class="field"><label>${esc(label)}</label><div class="swatches">${opts.map(([k, t]) => `<button type="button" data-sw="${esc(path)}"${o.scope ? ` data-scope="${o.scope}"` : ''} data-v="${esc(k)}" title="${esc(t)}" class="${k === v ? 'on' : ''} ${k ? '' : 'none'}" style="${k === 'accent' ? 'background:var(--brand)' : k === 'accent-soft' ? 'background:var(--brand-soft)' : k ? `background:${k}` : ''}">${k ? '' : '✕'}</button>`).join('')}
        <input type="color" ${attr(path, o.scope)} value="${/^#/.test(v) ? v : '#2f855a'}" title="Any color"></div></div>`;
    },
    fieldOptions(selected, { list = '', blank = 'Pick a field', only = null, itemsOnly = false, prefix = 'item.', lists = false } = {}) {
      const ok = (t) => !only || only.includes(t);
      const l = list ? cat().lists.find((x) => x.key === list) : null;
      return `<option value="">${esc(blank)}</option>${l ? `<optgroup label="Each ${esc(l.label.toLowerCase())} row">${l.fields.filter((f) => ok(f.type)).map((f) => `<option value="${prefix}${f.key}" ${selected === `${prefix}${f.key}` ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</optgroup>` : ''}
        ${itemsOnly ? '' : cat().groups.map((g) => { const fs = g.fields.filter((f) => ok(f.type)); return fs.length ? `<optgroup label="${esc(g.group)}">${fs.map((f) => `<option value="${f.path}" ${selected === f.path ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</optgroup>` : ''; }).join('')}
        ${itemsOnly || !lists ? '' : `<optgroup label="Lists">${cat().lists.map((x) => `<option value="${x.key}" ${selected === x.key ? 'selected' : ''}>${esc(x.label)} (has any)</option>`).join('')}</optgroup>`}`;
    },
    listOptions(selected, blank = 'Pick a list') {
      return `<option value="">${esc(blank)}</option>${cat().lists.map((l) => `<option value="${l.key}" ${l.key === selected ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}`;
    },
    itemFieldOptions(list, selected, blank = 'Nothing') {
      const l = cat().lists.find((x) => x.key === list);
      return `<option value="">${esc(blank)}</option>${(l?.fields || []).map((f) => `<option value="${f.key}" ${f.key === selected ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}`;
    },
    // "Show only when" rules. `path` is where the rule set lives; list = item fields; itemKeys = fields without "item.".
    rules(path, { scope, list = '', itemKeys = false, title = 'Show only when' } = {}) {
      const c = val(scope, path);
      const rs = c?.rules || [];
      const opt = (sel) => (itemKeys ? UI.itemFieldOptions(list, sel, 'Pick a field') : UI.fieldOptions(sel, { list, lists: true }));
      return `<div data-rules="${esc(path)}"${scope ? ` data-scope="${scope}"` : ''}>
        ${rs.length > 1 ? UI.select('', `${path}.match`, [['all', 'All of these are true'], ['any', 'Any of these is true']], { scope }) : ''}
        ${rs.map((r, i) => `<div class="cond-rule">
          <select ${attr(`${path}.rules.${i}.field`, scope)}>${opt(r.field)}</select>
          <div style="display:flex;gap:4px"><select ${attr(`${path}.rules.${i}.op`, scope, '', true)} style="flex:1">${Object.entries(R.OPS).map(([k, l]) => `<option value="${k}" ${k === r.op ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
          <button type="button" class="mini danger" data-rule-del="${i}" title="Remove this rule">✕</button></div>
          ${['set', 'empty', 'yes', 'no'].includes(r.op) ? '' : `<input ${attr(`${path}.rules.${i}.value`, scope)} value="${esc(r.value)}" placeholder="Value">`}
        </div>`).join('')}
        <button type="button" class="mini" data-rule-add>+ ${rs.length ? 'Add another rule' : esc(title)}</button></div>`;
    },
    section(key, title, body, { badge = '' } = {}) {
      return `<details data-sec="${key}" ${S.openSecs.has(key) ? 'open' : ''}><summary>${esc(title)}${badge ? ` <span class="pill green">${esc(badge)}</span>` : ''}</summary><div style="padding-top:8px">${body}</div></details>`;
    },
    listEd(path, items, render, { add = '+ Add', max = 60, move = true } = {}) {
      return `<div class="list-ed">${items.map((it, i) => `<div class="it"><div class="top"><b>${i + 1}</b>
        ${move ? `<button type="button" class="mini" data-lop="up" data-lpath="${esc(path)}" data-i="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button><button type="button" class="mini" data-lop="down" data-lpath="${esc(path)}" data-i="${i}" ${i === items.length - 1 ? 'disabled' : ''} title="Move down">↓</button>` : ''}
        <button type="button" class="mini danger" data-lop="del" data-lpath="${esc(path)}" data-i="${i}" title="Remove">✕</button></div>${render(it, i)}</div>`).join('')}
        ${items.length < max ? `<button type="button" class="mini" data-lop="add" data-lpath="${esc(path)}">${esc(add)}</button>` : ''}</div>`;
    },
  };
  const ALIGN = [['left', '⇤', 'Left'], ['center', '≡', 'Center'], ['right', '⇥', 'Right']];

  const INSPECT = {
    heading: (b) => `${UI.text('Text', 'text', { fx: true, hint: 'You can also type right on the page.' })}${UI.seg('Size', 'level', [[1, 'Big title'], [2, 'Heading'], [3, 'Small label']])}`,
    text: () => `<p class="hint" style="margin-top:0">Click the text on the page to type. Select words to make them bold, a list or a link. Press <b>{x} Field</b> on the toolbar to drop in the customer's name, a date, a total or anything else.</p>
      <button type="button" class="btn sm" data-act="text-field">{x} Insert a field</button>`,
    letterhead: (b) => `${UI.seg('Layout', 'layout', [['split', 'Split'], ['left', 'Stacked'], ['center', 'Centered'], ['band', 'Color band']])}
      ${UI.check('Show the logo', 'logo', { rr: true })}${b.logo ? UI.range('Logo height', 'logoH', { min: 16, max: 160, unit: ' pt' }) : ''}
      ${meta.isAdmin ? `<p class="hint" style="margin:-4px 0 10px">${meta.brand.logo ? 'Your logo comes from the Brand kit.' : 'No logo yet.'} <button type="button" class="link-btn" data-act="brand">${meta.brand.logo ? 'Change it' : 'Add your logo'}</button></p>` : ''}
      ${UI.text('Company name', 'name', { fx: true })}${UI.text('Details under the name', 'details', { fx: true, area: true, rows: 3 })}
      ${UI.text('Title', 'title', { fx: true, ph: 'Invoice' })}${UI.text('Under the title', 'sub', { fx: true, area: true, rows: 3, hint: 'Lines whose fields are all empty are left out when it prints.' })}
      ${UI.check('Line under the letterhead', 'rule')}`,
    fields: (b) => `${UI.seg('Layout', 'layout', [['rows', 'Rows'], ['stacked', 'Grid'], ['inline', 'One line'], ['totals', 'Totals']], {})}
      ${b.layout === 'stacked' ? UI.seg('Columns', 'cols', [[1, '1'], [2, '2'], [3, '3'], [4, '4']]) : ''}
      ${b.layout === 'rows' ? UI.range('Label width', 'labelW', { min: 10, max: 80, unit: '%' }) : ''}
      ${UI.check('Leave out rows with nothing to show', 'hideEmpty')}
      <label style="margin-top:6px">Rows</label>
      ${UI.listEd('rows', b.rows, (r, i) => `<div class="row2"><input ${attr(`rows.${i}.label`)} value="${esc(r.label)}" placeholder="Label">
        <div class="withfx"><input ${attr(`rows.${i}.value`)} value="${esc(r.value)}" placeholder="Value"><button type="button" class="fxbtn" data-fx="rows.${i}.value" ${itemList(b.id) ? `data-fxlist="${itemList(b.id)}"` : ''}>{x}</button></div></div>
        <label class="check" style="margin:6px 0 0"><input type="checkbox" ${attr(`rows.${i}.bold`, '', 'bool')} ${r.bold ? 'checked' : ''}> Bold</label>
        <details data-sec="row${i}" ${S.openSecs.has(`row${i}`) || r.showIf ? 'open' : ''} style="border:0;margin:0;padding:4px 0 0"><summary style="font-size:11px">Only show when…</summary>${UI.rules(`rows.${i}.showIf`, { list: itemList(b.id) })}</details>`, { add: '+ Add a row' })}
      <button type="button" class="mini" data-act="row-field">{x} Add a row from a field</button>`,
    table: (b) => {
      const listed = Boolean(b.list);
      const l = cat().lists.find((x) => x.key === b.list);
      const fields = l?.fields || [];
      const head = UI.seg('Rows come from', '_mode', [['list', 'A list'], ['typed', 'Typed in']], { current: listed ? 'list' : 'typed' });
      if (!listed) {
        return `${head}<label>Cells</label><div class="grid-ed"><table><tr>${b.columns.map((c, i) => `<td><input ${attr(`columns.${i}.label`)} value="${esc(c.label)}" placeholder="Header" style="font-weight:700"></td>`).join('')}<td><button type="button" class="mini" data-act="col-add" title="Add a column">+</button></td></tr>
          ${b.rows.map((r, ri) => `<tr>${b.columns.map((_, ci) => `<td><input ${attr(`rows.${ri}.${ci}`)} value="${esc(r[ci] ?? '')}"></td>`).join('')}<td><button type="button" class="mini danger" data-act="row-del" data-i="${ri}" title="Remove row">✕</button></td></tr>`).join('')}
          <tr>${b.columns.map((_, ci) => `<td style="text-align:center"><button type="button" class="mini danger" data-act="col-del" data-i="${ci}" title="Remove column">✕</button></td>`).join('')}<td></td></tr></table></div>
          <button type="button" class="mini" data-act="row-add">+ Add a row</button>
          <p class="hint">Cells can hold fields too, like {{customer.name}}.</p>
          ${UI.seg('Header', 'head', [['line', 'Line'], ['shaded', 'Shaded'], ['accent', 'Color'], ['none', 'None']])}${UI.seg('Borders', 'border', [['rows', 'Rows'], ['grid', 'Grid'], ['outer', 'Box'], ['none', 'None']])}`;
      }
      const numeric = (k) => ['money', 'number'].includes(fields.find((f) => f.key === k)?.type);
      return `${head}${UI.select('List', 'list', UI.listOptions(b.list), { rr: true })}
        <label>Columns</label>
        ${UI.listEd('columns', b.columns, (c, i) => `<input ${attr(`columns.${i}.label`)} value="${esc(c.label)}" placeholder="Column header" style="margin-bottom:5px">
          <select ${attr(`columns.${i}.field`, '', '', true)}>${UI.itemFieldOptions(b.list, c.template ? '__t' : c.field, 'Custom text with fields…')}</select>
          ${c.template || !c.field ? `<div class="withfx" style="margin-top:5px"><textarea ${attr(`columns.${i}.template`)} rows="2" style="min-height:0" placeholder="e.g. {{item.product}} ({{item.epa_reg}})">${esc(c.template)}</textarea><button type="button" class="fxbtn" data-fx="columns.${i}.template" data-fxlist="${b.list}" data-fxitems>{x}</button></div>` : ''}
          <details data-sec="col${i}" ${S.openSecs.has(`col${i}`) ? 'open' : ''} style="border:0;margin:0;padding:4px 0 0"><summary style="font-size:11px">Alignment, width, format, total</summary>
            ${UI.seg('', `columns.${i}.align`, ALIGN, { dflt: 'left' })}
            <div class="row2"><div><label>Width %</label><input type="number" ${attr(`columns.${i}.width`, '', 'num')} value="${c.width || ''}" min="0" max="100" placeholder="Auto"></div>
            <div><label>Total</label><select ${attr(`columns.${i}.total`)}><option value="">None</option><option value="sum" ${c.total === 'sum' ? 'selected' : ''} ${numeric(c.field) ? '' : 'disabled'}>Sum</option><option value="count" ${c.total === 'count' ? 'selected' : ''}>Count</option></select></div></div>
            <label>Format</label><select ${attr(`columns.${i}.format`)}>${COL_FORMATS.map(([k, lb]) => `<option value="${k}" ${k === c.format ? 'selected' : ''}>${esc(lb)}</option>`).join('')}</select>
          </details>`, { add: '+ Add a column', max: 16 })}
        ${UI.seg('Header', 'head', [['line', 'Line'], ['shaded', 'Shaded'], ['accent', 'Color'], ['none', 'None']])}
        ${UI.seg('Borders', 'border', [['rows', 'Rows'], ['grid', 'Grid'], ['outer', 'Box'], ['none', 'None']])}
        <div class="row2">${UI.check('Striped rows', 'striped')}${UI.check('Compact', 'compact')}</div>
        ${UI.section('tsort', 'Sort, group and limit', `<div class="row2">${UI.select('Sort by', 'sortBy', UI.itemFieldOptions(b.list, b.sortBy, 'As listed'))}${UI.select('Order', 'sortDir', [['asc', 'A→Z, low→high'], ['desc', 'Z→A, high→low']])}</div>
          ${UI.select('Group rows by', 'groupBy', UI.itemFieldOptions(b.list, b.groupBy, 'No groups'), { rr: true })}
          ${b.groupBy ? `${UI.text('Group heading', 'groupLabel', { fx: true, list: b.list, ph: '{{group.value}} ({{group.count}})', hint: 'Use {{group.value}} and {{group.count}}.' })}${UI.check('Subtotal under each group', 'groupTotals')}` : ''}
          <div class="row2">${UI.num('Show at most', 'limit', { min: 0, max: 5000, ph: 'All rows' })}${UI.text('Total row label', 'totalLabel', { ph: 'Total' })}</div>
          ${UI.text('When the list is empty, show', 'empty', { ph: 'Nothing to list for this record.' })}`)}
        ${UI.section('twhere', 'Only rows where…', UI.rules('where', { list: b.list, itemKeys: true, title: 'Only include some rows' }), { badge: b.where ? 'On' : '' })}
        <p class="hint">All rows print. While designing, the page shows the first 12.</p>`;
    },
    columns: (b) => {
      const n = b.cols.length;
      const presets = n === 2 ? [[[50, 50], '½ ½'], [[33, 67], '⅓ ⅔'], [[67, 33], '⅔ ⅓'], [[25, 75], '¼ ¾']] : n === 3 ? [[[33, 34, 33], 'Even'], [[25, 50, 25], 'Wide middle'], [[50, 25, 25], 'Wide left']] : [[[25, 25, 25, 25], 'Even']];
      return `<div class="field"><label>How many columns</label><div class="bseg" style="display:flex">${[1, 2, 3, 4].map((k) => `<button type="button" data-act="ncols" data-n="${k}" class="${k === n ? 'on' : ''}">${k}</button>`).join('')}</div></div>
        <div class="field"><label>Widths</label><div class="bseg" style="display:flex">${presets.map(([w, l]) => `<button type="button" data-act="widths" data-w="${w.join(',')}" class="${b.cols.map((c) => c.w).join(',') === w.join(',') ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="row4" style="margin-top:6px">${b.cols.map((c, i) => `<input type="number" ${attr(`cols.${i}.w`, '', 'num')} value="${c.w}" min="5" max="95" title="Column ${i + 1} width">`).join('')}</div></div>
        ${UI.range('Space between', 'gap', { min: 0, max: 72, unit: ' pt' })}${UI.seg('Line up', 'valign', [['start', 'Top'], ['center', 'Middle'], ['end', 'Bottom']])}
        <p class="hint">Drag blocks into a column, or select a column's box and click a block to add it there. On a phone screen, columns stack.</p>`;
    },
    section: () => `${UI.text('Title', 'title', { fx: true })}${UI.seg('Title style', 'bar', [['bar', 'Bar'], ['line', 'Line'], ['plain', 'Plain'], ['none', 'None']])}${UI.check('Box around it', 'boxed')}`,
    repeat: (b) => `${UI.select('Repeat for each', 'list', UI.listOptions(b.list), { rr: true, hint: 'Everything inside prints once per item. Use the fields under "Each … row" inside it.' })}
      ${UI.seg('Between each one', 'between', [['line', 'A line'], ['space', 'Space'], ['page', 'New page']])}
      <div class="row2">${UI.select('Sort by', 'sortBy', UI.itemFieldOptions(b.list, b.sortBy, 'As listed'))}${UI.select('Order', 'sortDir', [['asc', 'Low→high'], ['desc', 'High→low']])}</div>
      ${UI.num('At most', 'limit', { min: 0, max: 5000, ph: 'All' })}${UI.text('When there are none, show', 'empty')}
      ${UI.section('rwhere', 'Only items where…', UI.rules('where', { list: b.list, itemKeys: true, title: 'Only include some items' }), { badge: b.where ? 'On' : '' })}`,
    image: (b) => `${UI.seg('Picture', '_src', [['asset', 'Uploaded'], ['field', 'From a field']], { current: b.field && !b.asset ? 'field' : 'asset' })}
      ${b.field && !b.asset ? UI.select('Field', 'field', UI.fieldOptions(b.field, { only: ['image'], list: itemList(b.id) }))
        : `<div class="field"><label class="btn sm" style="display:inline-block">Upload a picture<input type="file" accept="image/png,image/jpeg,image/webp" data-act="img-up" hidden></label>
          <div id="b-assets" class="swatches" style="margin-top:8px;gap:6px"></div></div>`}
      ${UI.range('Width', 'w', { min: 5, max: 100, unit: '%' })}${UI.seg('Position', 'align', ALIGN)}${UI.text('Caption', 'caption', { fx: true })}`,
    signature: (b) => `${UI.listEd('sigs', b.sigs, (s, i) => `${UI.text('Label', `sigs.${i}.label`, { fx: true })}
      ${UI.select('Signature picture', `sigs.${i}.image`, UI.fieldOptions(s.image, { only: ['image'], blank: 'None: a blank line to sign by hand' }))}
      <div class="row2">${UI.text('Name under it', `sigs.${i}.name`, { fx: true })}${UI.text('Date or note', `sigs.${i}.date`, { fx: true })}</div>`, { add: '+ Add a signature', max: 3, move: true })}
      ${UI.range('Signing space', 'h', { min: 20, max: 120, unit: ' pt' })}`,
    qr: (b) => {
      const urls = cat().groups.flatMap((g) => g.fields).filter((f) => f.type === 'url');
      return `${UI.text('What it opens', 'value', { fx: true, ph: 'A link, like {{invoice.pay_url}}' })}
        ${urls.length ? `<div class="suggest" style="margin:-6px 0 10px">${urls.map((f) => `<button type="button" data-act="qr-pick" data-p="${f.path}">${esc(f.label)}</button>`).join('')}</div>` : ''}
        ${UI.range('Size', 'size', { min: 36, max: 220, unit: ' pt' })}${UI.text('Caption', 'caption', { fx: true })}${UI.seg('Position', 'align', ALIGN)}`;
    },
    photos: (b) => `<div class="field"><label>Which photos</label>${[['before', 'Before'], ['after', 'After'], ['issue', 'Problems found']].map(([k, l]) => `<label class="check"><input type="checkbox" data-act="pkind" value="${k}" ${b.kinds.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      ${UI.seg('Per row', 'perRow', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [6, '6']])}${UI.num('At most', 'max', { min: 1, max: 60 })}${UI.check('Show captions', 'captions')}${UI.text('When there are no photos, show', 'empty', { ph: 'Nothing (left out)' })}`,
    checklist: (b) => `${UI.seg('Columns', 'cols', [[1, '1'], [2, '2'], [3, '3'], [4, '4']])}
      ${UI.listEd('items', b.items, (it, i) => `<div class="withfx"><input ${attr(`items.${i}.text`)} value="${esc(it.text)}" placeholder="Item"></div>
        <div class="row2" style="margin-top:5px;align-items:center"><label class="check" style="margin:0"><input type="checkbox" ${attr(`items.${i}.on`, '', 'bool')} ${it.on ? 'checked' : ''} ${it.field ? 'disabled' : ''}> Ticked</label>
        <select ${attr(`items.${i}.field`, '', '', true)} title="Tick it when this field has a value">${UI.fieldOptions(it.field, { blank: 'Ticked by hand', list: itemList(b.id) })}</select></div>`, { add: '+ Add an item', max: 80 })}`,
    stamp: (b) => `${UI.text('Text', 'text', { fx: true })}${UI.seg('Color', 'tone', TONES)}${UI.seg('Where', 'place', [['corner', 'Top corner'], ['inline', 'In line']])}
      ${S.source === 'invoice' ? `<div class="suggest"><button type="button" data-act="stamp-when" data-w="paid">Only when paid</button><button type="button" data-act="stamp-when" data-w="late">Only when past due</button></div>` : ''}`,
    divider: () => `${UI.seg('Line', 'line', [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['double', 'Double']])}${UI.range('Thickness', 'weight', { min: 0.5, max: 6, step: 0.5, unit: ' pt' })}${UI.swatches('Color', 'color', { noneLabel: 'Light gray', accent: false, extra: [['#1a202c', 'Black']] })}`,
    spacer: () => UI.range('Height', 'h', { min: 2, max: 400, unit: ' pt' }),
    pagebreak: () => '<p class="hint" style="margin-top:0">Everything after this starts on a new page. Tables and repeats also flow onto new pages by themselves.</p>',
    sign: (b) => `${UI.seg('Who signs', 'who', [['customer', 'Customer'], ['company', 'Your company']])}
      ${UI.seg('Kind', 'mark', [['signature', 'Signature'], ['initials', 'Initials']])}
      ${UI.text('Label under the line', 'label', { fx: true, ph: b.who === 'customer' ? 'Customer signature' : 'For {{company.name}}' })}
      ${UI.check(b.who === 'customer' ? 'They must sign here to finish' : 'Required', 'required')}
      <div class="row2">${b.mark === 'signature' ? UI.check('Printed name', 'name') : '<div></div>'}${UI.check('Date signed', 'date')}</div>
      ${UI.range('Signing space', 'h', { min: 16, max: 140, unit: ' pt' })}
      <p class="hint">${b.who === 'customer' ? 'Sent for signing, this becomes a yellow <b>Sign here</b> flag they tap. Printed on paper, it is a blank line.' : 'Sign for your company when you send it, or later from Documents → Contracts.'}</p>`,
    input: (b) => `${UI.seg('They fill in', 'kind', [['text', 'Text'], ['date', 'Date'], ['check', 'Tick box'], ['choice', 'Pick one']])}
      ${UI.text(b.kind === 'check' ? 'What they agree to' : 'Label', 'label', { fx: true, area: b.kind === 'check', rows: 3 })}
      ${UI.check('Required to sign', 'required')}
      ${b.kind === 'text' ? `${UI.text('Hint inside the box', 'ph', { ph: 'Optional', max: 120 })}${UI.seg('Lines', 'lines', [[1, '1'], [2, '2'], [3, '3'], [5, '5']])}` : ''}
      ${b.kind === 'choice' ? `<div class="field"><label>Choices, one per line</label><textarea data-act="opts" rows="4" placeholder="Monthly&#10;Quarterly">${esc(b.options.join('\n'))}</textarea></div>` : ''}
      <p class="hint">What they enter shows on the signed copy. Printed on paper, it is a blank to fill in by hand.</p>`,
    logo: (b) => `<div class="field"><label>Picture</label>
        <div class="small muted" style="margin-bottom:6px">${b.asset ? 'A picture you uploaded.' : meta.brand.logo ? 'Your Brand kit logo. Change it there and every document updates.' : 'Your Brand kit logo. None is added yet.'}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${b.asset ? '<button type="button" class="btn sm" data-act="logo-brand">Use the Brand kit logo</button>' : meta.isAdmin ? `<button type="button" class="btn sm" data-act="brand">${meta.brand.logo ? 'Change the logo' : 'Add your logo'}</button>` : ''}
        <label class="btn sm" style="display:inline-block;margin:0">Upload a different picture<input type="file" accept="image/png,image/jpeg,image/webp" data-act="img-up" hidden></label></div>
        <div id="b-assets" class="swatches" style="margin-top:8px;gap:6px"></div></div>
      ${UI.range('Height', 'h', { min: 10, max: 300, unit: ' pt' })}
      ${UI.seg('Sits', 'style.align', ALIGN, { dflt: 'left' })}
      ${!parents(b.id).length && !b.style?.free ? '<button type="button" class="btn sm" data-act="make-free" style="margin-bottom:8px">✥ Drag it anywhere</button>' : ''}`,
    shape: (b) => `${UI.seg('Shape', 'kind', [['rect', '▭ Box'], ['ellipse', '◯ Circle'], ['line', '― Line']])}
      ${b.kind === 'line' ? `${UI.range('Thickness', 'sw', { min: 0.5, max: 16, step: 0.5, unit: ' pt', dflt: 1.5 })}${UI.swatches('Color', 'stroke', { noneLabel: 'Brand color', accent: false, extra: [['#1a202c', 'Black']] })}`
    : `${UI.swatches('Fill', 'fill', { noneLabel: 'None', extra: [['#ffffff', 'White'], ['#1a202c', 'Black'], ['#fef5e7', 'Cream']] })}
      <div class="row2">${UI.num('Border (pt)', 'sw', { min: 0, max: 16, step: 0.5, ph: '0' })}${b.kind === 'rect' ? UI.num('Rounded corners', 'radius', { min: 0, max: 300, ph: '0' }) : '<div></div>'}</div>
      ${b.sw ? UI.swatches('Border color', 'stroke', { noneLabel: 'Brand color', accent: false, extra: [['#1a202c', 'Black'], ['#ffffff', 'White']] }) : ''}
      ${UI.range('Height', 'h', { min: 4, max: 800, unit: ' pt' })}
      ${UI.text('Text inside', 'text', { fx: true, area: true, rows: 2, hint: 'You can also type right on the shape.' })}
      ${b.text ? `${UI.swatches('Text color', 'tcolor', { noneLabel: 'Automatic', extra: [['#ffffff', 'White'], ['#1a202c', 'Black']] })}
        <div class="row2">${UI.num('Text size (pt)', 'tsize', { min: 0, max: 96, step: 0.5, ph: 'Normal' })}<div></div></div>
        ${UI.seg('Across', 'align', ALIGN)}${UI.seg('Up and down', 'valign', [['start', 'Top'], ['center', 'Middle'], ['end', 'Bottom']])}` : ''}`}`,
  };
  // Where a block sits: in line with the text, or placed freely anywhere on the page.
  const posSection = (b) => {
    const st = b.style || {};
    if (parents(b.id).length) {
      return UI.section('pos', 'Position', '<p class="hint" style="margin-top:0">Blocks inside columns or boxes stay in line. <button type="button" class="link-btn" data-act="make-free">Take it out and drag it anywhere</button></p>');
    }
    return UI.section('pos', 'Position', `<label class="check"><input type="checkbox" data-act="free" ${st.free ? 'checked' : ''}> Place freely: drag it anywhere</label>
      <div class="hint" style="margin:-6px 0 8px 26px">The text around it flows as if it isn't there. Pull the corner to resize. Arrow keys nudge it (Shift for bigger steps), Alt turns off snapping.</div>
      ${st.free ? `<div class="row3">${UI.num('Across (pt)', 'style.x', { min: -400, max: 1600 })}${UI.num('Down (pt)', 'style.y', { min: -400, max: 30000 })}${UI.num('Width (pt)', 'style.w', { min: 8, max: 1600, ph: 'Auto' })}</div>
        ${UI.range('Turn', 'style.rot', { min: -180, max: 180, unit: '°', dflt: 0 })}
        <div class="field"><label>Layer</label><div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center"><button type="button" class="mini" data-act="z" data-z="front">Bring to front</button><button type="button" class="mini" data-act="z" data-z="back">Send behind the text</button>
          <span class="small muted">${st.z < 0 ? 'Behind the text' : 'In front'}</span></div></div>
        <div class="suggest"><button type="button" data-act="align-free" data-a="left">To the left edge</button><button type="button" data-act="align-free" data-a="center">Center it</button><button type="button" data-act="align-free" data-a="right">To the right edge</button><button type="button" data-act="align-free" data-a="top">To the top</button></div>` : ''}`, { badge: st.free ? 'Free' : '' });
  };
  const styleSection = (b) => {
    const st = b.style || {};
    const n = Object.keys(st).length;
    return UI.section('style', 'Style', `${UI.seg('Align text', 'style.align', [...ALIGN, ['justify', '☰', 'Justify']], { toggle: true })}
      <div class="row2">${UI.num('Text size (pt)', 'style.size', { min: 6, max: 48, step: 0.5, ph: 'Normal' })}
        <div class="field"><label>Text</label><div style="display:flex;gap:4px">${[['bold', '<b>B</b>'], ['italic', '<i>I</i>'], ['upper', 'AA']].map(([k, l]) => `<button type="button" class="mini ${st[k] ? 'on' : ''}" data-seg="style.${k}" data-v="true" data-toggle title="${k === 'upper' ? 'Capitals' : k}">${l}</button>`).join('')}</div></div></div>
      ${UI.swatches('Text color', 'style.color', { noneLabel: 'Normal', extra: [['#1a202c', 'Black'], ['#5f6b7a', 'Gray']] })}
      ${UI.swatches('Background', 'style.bg', { extra: [['#f5f7f9', 'Light gray'], ['#fef5e7', 'Light yellow']] })}
      <div class="row2">${UI.select('Border', 'style.border', [['', 'None'], ['thin', 'Thin'], ['medium', 'Medium'], ['thick', 'Thick']], { rr: true })}${UI.num('Rounded corners', 'style.radius', { min: 0, max: 24, ph: '0' })}</div>
      ${st.border ? UI.swatches('Border color', 'style.borderColor', { noneLabel: 'Gray' }) : ''}
      <div class="row3">${UI.num('Inside space', 'style.pad', { min: 0, max: 48, ph: 'Auto' })}${UI.num('Space above', 'style.mt', { min: -24, max: 144, ph: 'Auto' })}${UI.num('Space below', 'style.mb', { min: -24, max: 144, ph: 'Auto' })}</div>
      ${st.free ? '' : `<div class="row2">${UI.num('Width %', 'style.width', { min: 10, max: 100, ph: '100', rr: true })}${st.width && st.width < 100 ? UI.seg('Sits', 'style.place', ALIGN, { dflt: 'left' }) : '<div></div>'}</div>`}
      <div class="row2">${UI.select('Font', 'style.font', [['', 'Page font'], ...Object.entries(R.FONTS).map(([k, v]) => [k, v.label])])}${UI.num('Line spacing', 'style.lh', { min: 0.8, max: 3, step: 0.05, ph: 'Page' })}</div>
      <div class="row2">${UI.num('Letter spacing (pt)', 'style.ls', { min: -3, max: 30, step: 0.1, ph: '0' })}<div></div></div>
      ${UI.range('Opacity', 'style.opacity', { min: 5, max: 100, unit: '%', dflt: 100 })}
      <div class="row2">${UI.check('Soft shadow', 'style.shadow')}${UI.check('Hide on phones', 'style.phoneHide')}</div>
      ${st.free ? '' : UI.check("Don't split across pages", 'style.keep')}`, { badge: n ? `${n} set` : '' });
  };
  function drawRight() {
    const sc = right.scrollTop;
    $('#b-rtabs', root).innerHTML = [['block', 'Block'], ['page', 'Page'], ['data', 'Data']].map(([k, l]) => `<button data-rtab="${k}" class="${S.right === k ? 'on' : ''}">${l}</button>`).join('');
    let html;
    if (S.right === 'page') html = pagePanel();
    else if (S.right === 'data') html = dataPanel();
    else {
      const b = selBlock();
      if (!b) {
        html = S.readOnly ? `<div class="insp-head"><span class="i">👁</span><b>View only</b></div>
          <p class="muted small" style="margin-top:0">${S.row.archived ? 'This design is archived. Restore it to change it.' : 'You can look through it, pick a record on the Data tab to preview it, then download or send it.'}</p>
          ${!S.row.archived && S.row.purpose === 'template' ? '<p class="muted small">To change the wording or layout for one customer, use <b>Make a one-off copy</b> at the top.</p>' : ''}`
          : `<div class="insp-head"><span class="i">✦</span><b>Nothing selected</b></div>
          <p class="muted small" style="margin-top:0">Click anything on the page to change it.</p>
          <ul class="small" style="padding-left:18px;color:var(--muted);line-height:1.6">
            <li><b>Type right on the page.</b> Headings, text and the letterhead are editable.</li>
            <li><b>Green chips are fields.</b> They fill in from the record. Click one to change how it shows.</li>
            <li><b>Drag blocks</b> from the left, or by the ⠿ handle to move them.</li>
            <li><b>Show only when…</b> hides a block unless a rule matches, like a PAID stamp.</li>
            <li><b>Page</b> sets paper, margins, fonts, header and footer. <b>Data</b> picks what fills it in.</li>
          </ul>`;
      } else {
        const ps = parents(b.id);
        const where = ps.length ? `<div class="small muted" style="margin:-6px 0 10px">Inside ${ps.map((p) => `<button class="link-btn" data-selp="${p.id}">${esc(R.BLOCKS[p.type].label.toLowerCase())}</button>`).join(' › ')}</div>` : '';
        html = `<div class="insp-head"><span class="i">${R.BLOCKS[b.type].icon}</span><b>${esc(R.BLOCKS[b.type].label)}</b>${S.readOnly ? '' : '<button class="mini danger" data-b="del" title="Delete">Delete</button>'}</div>${where}
          ${INSPECT[b.type] ? INSPECT[b.type](b) : ''}
          ${b.type === 'pagebreak' ? '' : posSection(b)}
          ${b.type === 'pagebreak' ? '' : styleSection(b)}
          ${UI.section('cond', 'Show only when…', `<p class="hint" style="margin-top:0">Hide this ${esc(R.BLOCKS[b.type].label.toLowerCase())} unless a rule matches, like "Balance due has a value".</p>${UI.rules('showIf', { list: itemList(b.id) })}`, { badge: b.showIf ? 'On' : '' })}
          ${UI.section('note', 'Note for your team', UI.text('', 'note', { ph: "Doesn't print. Explain why it's here.", max: 200 }), { badge: b.note ? '✓' : '' })}`;
      }
    }
    right.innerHTML = S.readOnly ? `<fieldset disabled style="border:0;padding:0;margin:0">${html}</fieldset>` : html;
    right.scrollTop = sc;
    if ($('#b-assets', right)) drawAssets();
  }
  const pageHint = 'Use {x} for fields. {{page}} and {{pages}} number the pages.';
  function pagePanel() {
    const d = S.design;
    const s = 'design';
    return `<div class="insp-head"><span class="i">📄</span><b>Page</b></div>
      <div class="row2">${UI.select('Paper', 'page.size', Object.entries(R.PAGE_SIZES).map(([k, v]) => [k, v.label]), { scope: s })}${UI.select('Turn', 'page.orientation', [['portrait', 'Portrait (tall)'], ['landscape', 'Landscape (wide)']], { scope: s })}</div>
      <label>Margins (inches)</label><div class="row4" style="margin-bottom:4px">${['t', 'r', 'b', 'l'].map((k) => `<input type="number" ${attr(`page.margin.${k}`, s, 'num')} value="${d.page.margin[k]}" min="0" max="2" step="0.05" title="${{ t: 'Top', r: 'Right', b: 'Bottom', l: 'Left' }[k]}">`).join('')}</div>
      <div class="hint" style="margin-bottom:10px">Top, right, bottom, left. Most printers can't print closer than 0.25 in to the edge.</div>
      <div class="row2">${UI.select('Font', 'page.font', Object.entries(R.FONTS).map(([k, v]) => [k, v.label]), { scope: s })}${UI.num('Text size (pt)', 'page.fontSize', { scope: s, min: 6, max: 16, step: 0.5 })}</div>
      <div class="row2">${UI.num('Line spacing', 'page.lineHeight', { scope: s, min: 1, max: 2.2, step: 0.05 })}${UI.select('Dates look like', 'page.dateFormat', Object.entries(R.DATE_FORMATS).map(([k, v]) => [k, v]), { scope: s })}</div>
      ${UI.swatches('Accent color', 'page.accent', { scope: s, accent: false, noneLabel: 'Brand kit color' })}
      ${UI.swatches('Text color', 'page.color', { scope: s, accent: false, noneLabel: 'Near black', extra: [['#000000', 'Black']] })}
      ${UI.section('look', 'Background and border', `${UI.swatches('Page color', 'page.bg', { scope: s, noneLabel: 'White', extra: [['#fbf8ef', 'Cream'], ['#f5f7f9', 'Light gray'], ['#f0fff4', 'Mint'], ['#ebf8ff', 'Sky'], ['#1a202c', 'Dark']] })}
        <div class="field"><label>Picture behind the page</label>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${d.page.bgImg ? `<span style="width:44px;height:34px;border-radius:5px;border:1px solid var(--line);background:#fff url('${docAsset(d.page.bgImg)}') center/cover"></span>` : ''}
          <label class="btn sm" style="display:inline-block;margin:0">${d.page.bgImg ? 'Change' : 'Upload a picture'}<input type="file" accept="image/png,image/jpeg,image/webp" data-act="bg-up" hidden></label>
          ${d.page.bgImg ? '<button type="button" class="btn sm danger" data-act="bg-remove">Remove</button>' : ''}</div>
          <div class="hint">Fills every page, edge to edge. A letterhead design, a texture or a faint photo.</div></div>
        ${d.page.bgImg ? UI.range('Fade the picture', 'page.bgFade', { scope: s, min: 0, max: 95, unit: '%', dflt: 0 }) : ''}
        ${UI.select('Border around every page', 'page.frame', [['', 'None'], ['thin', 'Thin line'], ['medium', 'Medium line'], ['thick', 'Thick line'], ['double', 'Double line'], ['dashed', 'Dashed']], { scope: s, rr: true })}
        ${d.page.frame ? UI.swatches('Border color', 'page.frameColor', { scope: s, noneLabel: 'Brand color', accent: false, extra: [['#1a202c', 'Black'], ['#b7791f', 'Gold']] }) : ''}`, { badge: d.page.bg || d.page.bgImg || d.page.frame ? 'On' : '' })}
      ${UI.section('signing', 'Signing', `<p class="hint" style="margin-top:0">${signsHere() ? 'Customers sign this online from the link you send, on a phone or a computer.' : 'Add a <b>Signature spot</b> for the customer (Add → Contracts and signing) and you can send this to be signed online.'}</p>
        ${UI.num('Days they have to cancel', 'sign.cancelDays', { scope: s, min: 0, max: 30, ph: '0', hint: 'Business days after they sign, not counting Sundays and federal holidays. Use 3 for door-to-door and in-home sales (the FTC Cooling-Off Rule); some states require more. 0 = no right to cancel.' })}
        ${d.sign.cancelDays ? `<div class="suggest" style="margin:-4px 0 10px"><button type="button" data-act="add-rtc">Add the cancel statement by the signature</button><button type="button" data-act="add-notice">Add the Notice of Cancellation</button></div>` : ''}
        ${UI.check('Ask them to agree to sign electronically first', 'sign.consent', { scope: s, hint: 'The E-SIGN Act consent: paper copies, what it covers, how to withdraw. Recommended for consumers.' })}
        ${UI.check('Add a signing certificate to the signed copy', 'sign.certificate', { scope: s, hint: 'Who signed, when, from where, the tamper check and the full history.' })}
        ${UI.num('The signing link works for (days)', 'sign.expires', { scope: s, min: 0, max: 365, ph: '30', hint: '0 = it never runs out.' })}`, { badge: d.sign.cancelDays ? `${d.sign.cancelDays}-day cancel` : signsHere() ? 'On' : '' })}
      ${UI.section('hdr', 'Header on every page', `${UI.text('Left', 'header.left', { scope: s, fx: true })}${UI.text('Middle', 'header.center', { scope: s, fx: true })}${UI.text('Right', 'header.right', { scope: s, fx: true, hint: pageHint })}`, { badge: Object.values(d.header).some(Boolean) ? 'On' : '' })}
      ${UI.section('ftr', 'Footer on every page', `${UI.text('Left', 'footer.left', { scope: s, fx: true })}${UI.text('Middle', 'footer.center', { scope: s, fx: true })}${UI.text('Right', 'footer.right', { scope: s, fx: true, hint: pageHint })}
        <div class="suggest"><button type="button" data-act="pgnum">Page 1 of 2 on the right</button></div>`, { badge: Object.values(d.footer).some(Boolean) ? 'On' : '' })}
      ${UI.section('wm', 'Watermark', `${UI.text('Big faint text across the page', 'watermark.text', { scope: s, fx: true, ph: 'DRAFT, PAST DUE, COPY...', max: 40 })}
        ${UI.swatches('Color', 'watermark.color', { scope: s, accent: false, noneLabel: 'Red' })}
        <label>Show it only when</label>${UI.rules('watermark.showIf', { scope: s, title: 'Only sometimes' })}`, { badge: d.watermark.text ? 'On' : '' })}
      ${UI.section('mail', 'Email that goes with it', `${UI.text('Subject', 'email.subject', { scope: s, fx: true, ph: `${S.row.name} from {{company.name}}` })}
        ${UI.text('Message', 'email.message', { scope: s, fx: true, area: true, rows: 6, ph: 'Hi {{customer.first_name}},\n\nPlease see the attached...' })}
        <div class="row2">${UI.text('Button', 'email.button', { scope: s, ph: signsHere() ? 'Review and sign' : `View ${S.row.name}`, max: 60 })}<div></div></div>
        ${UI.swatches('Button color', 'email.color', { scope: s, accent: false, noneLabel: 'Brand color' })}
        ${UI.check('Your logo at the top', 'email.logo', { scope: s })}
        ${UI.text('Small print at the bottom', 'email.footer', { scope: s, ph: 'Company name · phone · email', max: 300 })}
        <p class="hint">Filled in when you press Send. You can still change it before it goes.</p>
        <div class="suggest"><button type="button" data-act="pv" data-pv="email-desktop">👁 See the email on a computer</button><button type="button" data-act="pv" data-pv="email-phone">📱 On a phone</button></div>`, { badge: d.email.subject || d.email.message ? 'Set' : '' })}`;
  }
  function dataPanel() {
    const c = cat();
    const key = recKey();
    const p = S.params;
    const canRetype = !S.readOnly;
    const rec = key ? `<div class="field"><label>${isTpl() ? 'Preview with' : 'This document is for'}</label>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span style="flex:1;min-width:120px">${p[key] ? `<b>${esc(S.row.record_title || S.recordTitle || `#${p[key]}`)}</b>` : '<span class="muted">Sample data</span>'}</span>
        <button type="button" class="btn sm" data-act="pick">${p[key] ? 'Change' : `Pick ${RECORD_WORD[S.source]}`}</button>${p[key] && isTpl() ? '<button type="button" class="btn sm" data-act="sample">Use sample</button>' : ''}</div>
        ${isTpl() ? '<div class="hint">Only for previewing. Each invoice, visit or customer fills in its own when the document is made.</div>' : ''}</div>`
      : S.source === 'applications' ? `<label>${isTpl() ? 'Preview with' : 'Applications in'}</label>
        <div class="row2"><div class="field"><label>From</label><input type="date" data-app="from" value="${esc(p.from || '')}"></div><div class="field"><label>To</label><input type="date" data-app="to" value="${esc(p.to || '')}"></div></div>
        <div class="field"><label>Applicator</label><select data-app="tech_id"><option value="">Everyone</option>${(BOOT.techs || []).map((t) => `<option value="${t.id}" ${Number(p.tech_id) === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Product</label><select data-app="product_id"><option value="">All products</option>${(BOOT.products || []).map((x) => `<option value="${x.id}" ${Number(p.product_id) === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
        ${(BOOT.locations || []).length > 1 && !BOOT.me.location_id ? `<div class="field"><label>Branch</label><select data-app="location_id"><option value="">All branches</option>${BOOT.locations.map((l) => `<option value="${l.id}" ${Number(p.location_id) === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>` : ''}
        <div style="display:flex;gap:6px;margin-bottom:10px"><button type="button" class="btn sm" data-act="month">This month</button><button type="button" class="btn sm" data-act="lastmonth">Last month</button>${S.real ? '<button type="button" class="btn sm" data-act="sample">Use sample</button>' : ''}</div>
        <div class="hint" style="margin:-4px 0 14px">${S.real ? `${(S.data?.applications || []).length} applications found.` : 'Showing sample applications. Pick dates to see your real records.'}</div>` : '';
    return `<div class="insp-head"><span class="i">🗂</span><b>Data</b></div>
      <div class="field"><label>Filled in from</label><select data-act="source" ${canRetype ? '' : 'disabled'}>${Object.entries(meta.sources).map(([k, v]) => `<option value="${k}" ${k === S.source ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select><div class="hint">${esc(c.help || '')}</div></div>
      ${rec}
      <div class="field"><label>Kind of document</label><select data-act="kind" ${canRetype ? '' : 'disabled'}>${Object.entries(meta.kinds).map(([k, v]) => `<option value="${k}" ${k === S.row.kind ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
        <div class="hint">Sorts it in the library. Invoices, service reports and pesticide records can be made the one everyone gets.</div></div>
      <div class="field"><label>Type</label><div class="small">${isTpl() ? '<b>Template</b>: used for many records.' : '<b>One-off</b>: made once for one person or job.'}</div></div>
      ${S.row.defaultFor?.length ? `<div class="alert info small">This is the ${S.row.defaultFor.map((k) => esc((meta.kinds[k]?.label || k).toLowerCase())).join(' and ')} everyone gets. Publish to update it everywhere.</div>` : ''}`;
  }

  // ---------- pictures for the image block ----------
  let assets = null;
  async function drawAssets() {
    const box = $('#b-assets', right);
    if (!box) return;
    if (!assets) assets = await api('/nuvolve/app/api/docs/assets').catch(() => []);
    const b = selBlock();
    box.innerHTML = assets.length ? assets.slice(0, 40).map((a) => `<button type="button" data-asset="${a.id}" class="${b?.asset === a.id ? 'on' : ''}" title="${esc(a.name || '')}" style="width:52px;height:40px;border-radius:6px;background:#fff url('${a.url}') center/contain no-repeat"></button>`).join('')
      : '<span class="small muted">Pictures you upload show here, ready to reuse.</span>';
  }

  // ---------- previews: the link on a computer or a phone, and the email that carries it ----------
  // Drawn by the same code as the real thing, in a frame with no scripts, so what you see is what they get.
  const PV = [['print', '🖨 On paper'], ['desktop', '🖥 Computer'], ['phone', '📱 Phone'], ['email-desktop', '✉ Email · computer'], ['email-phone', '✉ Email · phone']];
  const linkBar = '<div style="position:sticky;top:0;z-index:5;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;padding:10px;margin:-24px -12px 18px;background:rgba(233,237,240,.94);font:600 14px -apple-system,Segoe UI,Arial,sans-serif">'
    + '<span style="padding:8px 14px;border-radius:8px;border:1px solid #2f855a;background:#2f855a;color:#fff">Print</span><span style="padding:8px 14px;border-radius:8px;border:1px solid #cbd5e0;background:#fff;color:#1a202c">Download PDF</span></div>';
  function linkPage() {
    const signs = signsHere();
    let html = R.page(S.design, { ...S.data, doc: { title: S.row.name } }, ro({ title: S.row.name, sign: signs ? { state: 'open' } : null }));
    html = html.replace('<body>', `<body${signs ? ' data-sign="awaiting"' : ''}>${linkBar}`);
    if (signs) {
      let steps = 0;
      R.walk(S.design.blocks, (b) => { if (((b.type === 'sign' && b.who === 'customer') || b.type === 'input') && b.required !== false) steps++; });
      html = html.replace('</head>', '<link rel="stylesheet" href="/nuvolve/app/css/docsign.css"></head>')
        .replace('</body>', `<div class="ds-ui ds-bar"><div class="ds-bar-in"><div class="ds-msg"><b>${steps} ${steps === 1 ? 'step' : 'steps'} left</b><small>${esc(S.row.name)}</small><div class="ds-prog"><i></i></div></div><span class="ds-btn link">Decline</span><span class="ds-btn warn">Start ↓</span></div></div></body>`);
    }
    return html;
  }
  function emailParts() {
    const signs = signsHere();
    const data = { ...S.data, doc: { title: S.row.name } };
    const fill = (x) => R.fill(S.design, x, data, ro());
    const first = data.customer?.first_name;
    const hi = `Hi${first ? ` ${first}` : ''},`;
    const subject = fill(S.design.email.subject) || (signs ? `Please sign: ${S.row.name}` : S.row.name);
    const message = fill(S.design.email.message) || (signs ? `${hi}\n\nPlease review and sign your ${S.row.name.toLowerCase()}. It only takes a minute on your phone or computer.\n\nThank you!`
      : `${hi}\n\nPlease see the attached ${S.row.name.toLowerCase()}.\n\nThank you,\n${BOOT.me.name}\n${data.company?.name || ''}`);
    const company = { name: data.company?.name || '', phone: data.company?.phone || '', email: data.company?.email || '' };
    const html = R.email({
      company, subject, title: S.row.name, message, link: `${location.origin}/nuvolve/app/d/…`, pdf: !signs && meta.pdf, footer: S.design.email.footer,
      logo: S.design.email.logo && meta.brand.logo ? docAsset(meta.brand.logo) : '',
      button: S.design.email.button || (signs ? 'Review and sign' : `View ${S.row.name}`),
      color: S.design.email.color || meta.brand.color || R.accentOf(S.design, data),
    });
    return { html, subject, company, to: data.customer?.email || 'customer@example.com' };
  }
  function openPreview(mode) {
    if (mode === 'print') { closePreview(); S.preview = true; S.editing = null; rt.hidden = true; draw(); tools(); return; }
    finishEditing();
    S.pv = mode;
    S.preview = false;
    pv.hidden = false;
    drawPreview();
    tools();
  }
  function closePreview() {
    if (!S.pv) return;
    S.pv = null;
    pv.hidden = true;
    pv.innerHTML = '';
    tools();
    draw();
  }
  function frameHtml(w, h, s) { return `<iframe sandbox="allow-same-origin" title="Preview" style="width:${w}px;height:${h}px;transform:scale(${s})"></iframe>`; }
  function drawPreview() {
    const mode = S.pv;
    if (!mode) return;
    const signs = signsHere();
    const notes = {
      desktop: signs ? 'The signing link on a computer. They tap each yellow flag, then Finish.' : 'The link they get, on a computer.',
      phone: signs ? 'The signing link on a phone. Columns stack and free-placed pieces fall into line, so it reads well on a small screen.' : 'The link on a phone. Columns stack and free-placed pieces fall into line.',
      'email-desktop': 'The email, as it lands in their inbox on a computer.',
      'email-phone': 'The email on a phone.',
    };
    pv.innerHTML = `<div class="bld-pv-top"><div class="bseg">${PV.map(([k, l]) => `<button type="button" data-pvm="${k}" class="${k === mode ? 'on' : ''}">${l}</button>`).join('')}</div>
      <span class="small muted bld-pv-note">${esc(notes[mode] || '')}</span><span class="grow"></span>
      <button type="button" class="btn primary" data-pvm="close">✏️ Back to editing</button></div><div class="bld-pv-stage"></div>`;
    const stage = $('.bld-pv-stage', pv);
    const sw = stage.clientWidth - 40;
    const sh = stage.clientHeight - 40;
    const email = mode.startsWith('email') ? emailParts() : null;
    const html = email ? email.html : linkPage();
    const head = (phone) => `<div class="pv-mail${phone ? ' phone' : ''}">${phone ? '<div class="back">‹ Inbox</div>' : ''}<div class="s">${esc(email.subject)}</div><div class="f"><span class="av">${esc((email.company.name || '?').slice(0, 1))}</span><span><b>${esc(email.company.name || 'Your company')}</b> <span class="muted">&lt;${esc(email.company.email || 'office@yourcompany.com')}&gt;</span><br><span class="muted">to ${esc(email.to)}</span></span></div></div>`;
    // The email's header (subject, sender) is drawn at full size, measured, then scaled with the rest.
    const fit = (W, H, top, s) => {
      const hd = $('.pv-head', stage);
      const mh = hd ? hd.firstElementChild.offsetHeight : 0;
      if (hd) hd.style.height = `${mh * s}px`;
      const vh = H - top - mh;
      const v = $('.pv-view', stage);
      v.style.height = `${vh * s}px`;
      $('iframe', v).style.height = `${vh}px`;
    };
    if (mode === 'desktop' || mode === 'email-desktop') {
      const W = 1280, H = 820, bar = 38;
      const s = Math.min(1, sw / W, sh / H);
      stage.innerHTML = `<div class="pv-browser" style="width:${W * s}px"><div class="pv-bar"><span class="dots"><i></i><i></i><i></i></span><span class="url">${email ? 'Inbox' : `🔒 ${esc(location.host)}/d/…`}</span></div>
        ${email ? `<div class="pv-head" style="overflow:hidden"><div style="width:${W}px;transform:scale(${s});transform-origin:0 0">${head(false)}</div></div>` : ''}
        <div class="pv-view" style="width:${W * s}px">${frameHtml(W, H - bar, s)}</div></div>`;
      fit(W, H, bar, s);
    } else {
      const W = 390, H = 800;
      const s = Math.min(1, (sh - 28) / (H + 24), sw / (W + 24));
      stage.innerHTML = `<div class="pv-phone" style="padding:${12 * s}px;border-radius:${46 * s}px"><div class="pv-screen" style="width:${W * s}px;height:${H * s}px;border-radius:${36 * s}px">
        <div class="pv-status" style="height:${30 * s}px;font-size:${12 * s}px"><span>9:41</span><span>●●● ▮</span></div>
        ${email ? `<div class="pv-head" style="overflow:hidden"><div style="width:${W}px;transform:scale(${s});transform-origin:0 0">${head(true)}</div></div>` : ''}
        <div class="pv-view" style="width:${W * s}px">${frameHtml(W, H - 30, s)}</div></div></div>`;
      fit(W, H, 30, s);
    }
    $('iframe', stage).srcdoc = html;
  }
  pv.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pvm]');
    if (!b) return;
    if (b.dataset.pvm === 'close') closePreview(); else openPreview(b.dataset.pvm);
  });
  function previewMenu(anchor) {
    menu(anchor, [
      { icon: '🖨', label: 'On paper', sub: 'As it prints, right here on the page', run: () => openPreview('print') },
      { icon: '🖥', label: 'On a computer', sub: signsHere() ? 'The signing link, as the customer sees it' : 'The link, as they see it', run: () => openPreview('desktop') },
      { icon: '📱', label: 'On a phone', sub: 'How it reflows on a small screen', run: () => openPreview('phone') },
      '-',
      { icon: '✉', label: 'The email on a computer', run: () => openPreview('email-desktop') },
      { icon: '✉', label: 'The email on a phone', run: () => openPreview('email-phone') },
    ]);
  }

  // ---------- events: top bar ----------
  const act = {
    undo, redo, send, publish,
    'show-left': () => { root.classList.toggle('show-left'); root.classList.remove('show-right'); },
    'show-right': () => { root.classList.toggle('show-right'); root.classList.remove('show-left'); },
    'zoom-in': () => setZoom(ZOOMS.find((z) => z > zoomVal() + 0.01) || ZOOMS[ZOOMS.length - 1]),
    'zoom-out': () => setZoom([...ZOOMS].reverse().find((z) => z < zoomVal() - 0.01) || ZOOMS[0]),
    names: () => { S.names = !S.names; draw(); tools(); },
    preview: (el) => { if (S.preview) { S.preview = false; draw(); tools(); } else previewMenu(el); },
    output: (el) => outputMenu(el),
    more: (el) => moreMenu(el),
    pick: pickRecordForDoc,
    'data-tab': () => { S.right = 'data'; drawRight(); root.classList.add('show-right'); },
    oneoff: oneOff,
    unarchive: async () => { await api(`/nuvolve/app/api/docs/designs/${S.row.id}/unarchive`, { method: 'POST' }); route(); },
    brand: () => brandKitModal(async () => { await docMeta(true).then((m) => Object.assign(meta, m)); await loadData(); draw(); drawRight(); }),
  };
  function setZoom(z) {
    S.zoom = z;
    try { localStorage.setItem('nv_bld_zoom', String(z)); } catch { /* private mode */ }
    applyZoom();
    guides();
    placeBar();
    placeRt();
  }
  $('.bld-top', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b && act[b.dataset.act]) { e.preventDefault(); act[b.dataset.act](b); }
  });
  $('#b-zoom', root).onclick = () => setZoom('fit');
  $('#b-banner', root).addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && act[b.dataset.act]) act[b.dataset.act](b); });
  $('#b-note', root).addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && act[b.dataset.act]) act[b.dataset.act](b); });
  const nameInput = $('.bld-name', root);
  nameInput.oninput = () => { nameInput.style.width = `${Math.min(320, Math.max(140, nameInput.value.length * 9 + 24))}px`; };
  nameInput.onchange = () => {
    const n = nameInput.value.trim();
    if (!n) { nameInput.value = S.row.name; return; }
    S.row.name = n;
    if (S.data) S.data.doc = { title: n };
    saveMeta({ name: n });
  };
  nameInput.onkeydown = (e) => { if (e.key === 'Enter') nameInput.blur(); };
  nameInput.oninput();

  // ---------- events: selection bar and text toolbar ----------
  const barAct = {
    up: () => nudge(S.sel, -1), down: () => nudge(S.sel, 1), dup: () => duplicate(S.sel), del: () => remove(S.sel),
    parent: () => { const ps = parents(S.sel); if (ps.length) select(ps[ps.length - 1].id); },
    settings: () => { S.right = 'block'; drawRight(); root.classList.add('show-right'); root.classList.remove('show-left'); },
    free: () => toggleFree(true), inline: () => toggleFree(false), front: () => layer('front'), back: () => layer('back'),
  };
  // On a phone the side panels slide over the page, so a tap on the page closes them first.
  cv.addEventListener('pointerdown', (e) => {
    if (innerWidth > 900 || !(root.classList.contains('show-left') || root.classList.contains('show-right'))) return;
    root.classList.remove('show-left', 'show-right');
    e.preventDefault();
    e.stopPropagation();
  }, true);
  bar.addEventListener('click', (e) => { const b = e.target.closest('[data-b]'); if (b && barAct[b.dataset.b]) barAct[b.dataset.b](); });
  rt.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  rt.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rt]');
    const ed = S.editing;
    if (!b || !ed) return;
    const cmd = b.dataset.rt;
    if (cmd === 'field') { fieldPicker(b, (p) => insertField(p), { list: S.sel ? itemList(S.sel) : '' }); return; }
    if (cmd === 'done') { ed.blur(); return; }
    ed.focus();
    if (S.range) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(S.range); }
    if (cmd === 'h4') document.execCommand('formatBlock', false, document.queryCommandValue('formatBlock') === 'h4' ? 'p' : 'h4');
    else if (cmd === 'link') {
      const url = window.prompt('Link to (https://, mailto: or tel:)', 'https://');
      if (url && /^(https?:\/\/|mailto:|tel:)/i.test(url.trim())) document.execCommand('createLink', false, url.trim());
      else if (url) toast('Links start with https://, mailto: or tel:', true);
    } else if (cmd === 'color') {
      menu(b, [['Brand color', 'accent'], ['Black', '#1a202c'], ['Gray', '#5f6b7a'], ['Red', '#c53030'], ['Green', '#276749'], ['Blue', '#2b6cb0'], ['Amber', '#b7791f']].map(([l, c]) => ({
        icon: `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${c === 'accent' ? R.accentOf(S.design, S.data) : c}"></span>`, label: l,
        run: () => { ed.focus(); if (S.range) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(S.range); } document.execCommand('styleWithCSS', false, true); document.execCommand('foreColor', false, c === 'accent' ? R.accentOf(S.design, S.data) : c); commitEditable(ed); },
      })));
      return;
    } else {
      document.execCommand('styleWithCSS', false, false);
      document.execCommand(cmd, false, null);
    }
    commitEditable(ed);
  });

  // ---------- events: the page ----------
  doc.addEventListener('mouseover', (e) => {
    if (S.preview) return;
    const el = e.target.closest('[data-bid]');
    $$('.bld-hover', doc).forEach((x) => { if (x !== el) x.classList.remove('bld-hover'); });
    if (el) el.classList.add('bld-hover');
  });
  doc.addEventListener('mouseleave', () => $$('.bld-hover', doc).forEach((x) => x.classList.remove('bld-hover')));
  doc.addEventListener('click', (e) => {
    if (S.preview) { if (e.target.closest('a')) e.preventDefault(); return; }
    if (e.target.closest('a')) e.preventDefault();
    const el = e.target.closest('[data-bid]');
    if (!el) { select(null); return; }
    if (el.dataset.bid !== S.sel) select(el.dataset.bid);
    const chip = e.target.closest('.nv-chip');
    if (chip && chip.closest('[contenteditable="true"]') && !S.readOnly) {
      // Keep typing after the field rather than inside it.
      caretAfter(chip);
      chipPop(chip);
    }
  });
  cv.addEventListener('click', (e) => { if ((e.target === cv || e.target === wrap) && !S.preview) select(null); });
  $('#b-mtop', root).onclick = () => { S.right = 'page'; S.openSecs.add('hdr'); drawRight(); root.classList.add('show-right'); };
  $('#b-mbot', root).onclick = () => { S.right = 'page'; S.openSecs.add('ftr'); drawRight(); root.classList.add('show-right'); };
  doc.addEventListener('input', (e) => { const el = e.target.closest?.('[data-edit]'); if (el) commitEditable(el); });
  doc.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('[data-edit]');
    if (!el) return;
    S.editing = el;
    document.execCommand('defaultParagraphSeparator', false, 'p');
    const bEl = el.closest('[data-bid]');
    if (bEl && bEl.dataset.bid !== S.sel) { S.sel = bEl.dataset.bid; markSel(); drawRight(); }
    bar.hidden = true;
    placeRt();
  });
  doc.addEventListener('focusout', (e) => {
    const el = e.target.closest?.('[data-edit]');
    if (!el) return;
    setTimeout(() => {
      if (pop) return;
      const a = document.activeElement;
      if (a && (el.contains(a) || rt.contains(a))) return;
      // Moved straight into another text block: save this one without redrawing under the cursor.
      if (S.editing && S.editing !== el && S.editing.contains(a)) { if (document.body.contains(el)) commitEditable(el); return; }
      finishEditing(el);
    }, 120);
  });
  const onSel = () => {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const n = sel.anchorNode;
    const ed = (n?.nodeType === 1 ? n : n?.parentElement)?.closest?.('[data-edit]');
    if (ed && doc.contains(ed)) { S.editing = ed; S.range = sel.getRangeAt(0).cloneRange(); }
  };
  document.addEventListener('selectionchange', onSel);
  doc.addEventListener('keydown', (e) => {
    const ed = e.target.closest?.('[data-edit]');
    if (!ed) return;
    if (e.key === 'Escape') { e.preventDefault(); ed.blur(); return; }
    if (e.key === 'Enter' && ed.dataset.edit !== 'rich') {
      e.preventDefault();
      if (ed.dataset.edit === 'text' && !e.shiftKey && R.find(S.design.blocks, S.sel)?.block.type === 'heading') { ed.blur(); return; }
      document.execCommand('insertLineBreak');
    }
  });
  doc.addEventListener('paste', (e) => {
    const ed = e.target.closest?.('[data-edit]');
    if (!ed) return;
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (ed.dataset.edit === 'rich' && html) document.execCommand('insertHTML', false, R.sanitizeRich(html));
    else document.execCommand('insertText', false, text);
  });
  doc.addEventListener('load', () => { clearTimeout(S.gT); S.gT = setTimeout(() => { guides(); placeBar(); }, 60); }, true);

  // ---------- drag and drop ----------
  let drag = null;
  root.addEventListener('dragstart', (e) => {
    if (S.readOnly || (doc.contains(e.target) && !e.target.closest?.('.fld'))) { e.preventDefault(); return; }
    const t = e.target.closest?.('[data-add],[data-smart],.bld-bar .lbl,[data-o],.fld[data-p]');
    if (!t) return;
    if (t.dataset.add) drag = { add: t.dataset.add };
    else if (t.dataset.smart) drag = { smart: t.dataset.smart };
    else if (t.dataset.o) drag = { move: t.dataset.o };
    else if (t.dataset.p) drag = { field: t.dataset.p };
    else drag = { move: S.sel };
    e.dataTransfer.effectAllowed = drag.move ? 'move' : 'copy';
    if (drag.field) e.dataTransfer.setData('text/plain', `{{${drag.field}}}`);
    else e.dataTransfer.setData('application/x-nuvolve-block', '1');
  });
  root.addEventListener('dragend', () => { drag = null; hideDrop(); });
  function hideDrop() { dropLine.hidden = true; $$('.bld-slot-on', doc).forEach((x) => x.classList.remove('bld-slot-on')); }
  function dropTarget(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const nv = doc.firstElementChild;
    if (!nv) return null;
    let container = el?.closest?.('.nv-slot');
    if (!container || !doc.contains(container)) container = nv;
    let key = container === nv ? 'root' : container.dataset.slot;
    if (drag?.move && key !== 'root') {
      const owner = key.split(':')[0];
      const hit = findB(drag.move);
      if (owner === drag.move || (hit && R.find([hit.block], owner))) { container = nv; key = 'root'; }
    }
    const kids = [...container.children].filter((c) => c.classList.contains('nv-b'));
    let index = kids.length;
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { index = i; break; }
    }
    return { key, index, container, kids };
  }
  function showDrop(t) {
    hideDrop();
    if (!t) return;
    const c = cv.getBoundingClientRect();
    const cr = t.container.getBoundingClientRect();
    let y;
    if (!t.kids.length) y = cr.top + Math.min(cr.height / 2, 20);
    else if (t.index < t.kids.length) y = t.kids[t.index].getBoundingClientRect().top - 4;
    else y = t.kids[t.kids.length - 1].getBoundingClientRect().bottom + 4;
    dropLine.hidden = false;
    dropLine.style.top = `${y - c.top + cv.scrollTop - 1}px`;
    dropLine.style.left = `${cr.left - c.left + cv.scrollLeft}px`;
    dropLine.style.width = `${cr.width}px`;
    if (t.container !== doc.firstElementChild) t.container.classList.add('bld-slot-on');
  }
  cv.addEventListener('dragover', (e) => {
    if (!drag) return;
    if (drag.field && e.target.closest?.('[contenteditable="true"]')) { hideDrop(); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = drag.move ? 'move' : 'copy';
    S.dropAt = dropTarget(e);
    showDrop(S.dropAt);
  });
  cv.addEventListener('dragleave', (e) => { if (!cv.contains(e.relatedTarget)) hideDrop(); });
  cv.addEventListener('drop', (e) => {
    if (!drag) return;
    const d = drag;
    if (d.field && e.target.closest?.('[contenteditable="true"]')) { setTimeout(() => { const ed = e.target.closest('[data-edit]'); if (ed) commitEditable(ed); draw(); }, 30); return; }
    e.preventDefault();
    const t = dropTarget(e);
    hideDrop();
    drag = null;
    if (!t) return;
    const n = nvRect();
    const where = { key: t.key, index: t.index, ...(n ? { x: ((e.clientX - n.left) / zoomVal()) * PT, y: ((e.clientY - n.top) / zoomVal()) * PT } : {}) };
    if (d.add) addBlock(makeBlock(d.add), { where });
    else if (d.smart) { const s = meta.smart.find((x) => x.key === d.smart); if (s) addBlock(freshIds(R.clone(s.block)), { where }); }
    else if (d.move) moveTo(d.move, t.key, t.index);
    else if (d.field) {
      const list = t.key !== 'root' ? itemList(t.key.split(':')[0]) || (findB(t.key.split(':')[0])?.block.type === 'repeat' ? findB(t.key.split(':')[0]).block.list : '') : '';
      addBlock({ id: R.newId(), type: 'text', html: `<p>${esc(fieldLabel(d.field, list))}: {{${d.field}}}</p>` }, { where });
    }
  });

  // ---------- events: left panel ----------
  $('#b-ltabs', root).addEventListener('click', (e) => { const b = e.target.closest('[data-lt]'); if (b) { S.left = b.dataset.lt; drawLeft(); } });
  left.addEventListener('mousedown', (e) => { if (e.target.closest('.fld')) e.preventDefault(); });
  left.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    const smart = e.target.closest('[data-smart]');
    const fld = e.target.closest('.fld[data-p]');
    const o = e.target.closest('[data-o]');
    const tbl = e.target.closest('[data-table]');
    if (add) addBlock(makeBlock(add.dataset.add));
    else if (smart) { const s = meta.smart.find((x) => x.key === smart.dataset.smart); if (s) addBlock(freshIds(R.clone(s.block))); }
    else if (tbl) {
      const l = cat().lists.find((x) => x.key === tbl.dataset.table);
      addBlock({ id: R.newId(), type: 'table', list: l.key, head: 'line', border: 'rows', rows: [], columns: l.fields.slice(0, 5).map((f) => ({ label: f.label, field: f.key, align: ['money', 'number'].includes(f.type) ? 'right' : 'left' })) });
    } else if (fld) {
      const p = fld.dataset.p;
      if (p.startsWith('item.')) {
        const inList = S.sel && (itemList(S.sel) === fld.dataset.l || (selBlock()?.type === 'table' && selBlock().list === fld.dataset.l) || (selBlock()?.type === 'repeat' && selBlock().list === fld.dataset.l));
        if (!inList) { toast(`That field is for each row of ${cat().labels[fld.dataset.l] || 'a list'}. Select a table of that list, or click inside a Repeat block for it.`, true); return; }
      }
      insertField(p);
    } else if (o) { select(o.dataset.o, { scroll: true }); }
  });

  // ---------- events: right panel ----------
  $('#b-rtabs', root).addEventListener('click', (e) => { const b = e.target.closest('[data-rtab]'); if (b) { S.right = b.dataset.rtab; drawRight(); } });
  right.addEventListener('toggle', (e) => {
    const d = e.target.closest?.('details[data-sec]');
    if (d) { if (d.open) S.openSecs.add(d.dataset.sec); else S.openSecs.delete(d.dataset.sec); }
  }, true);
  const parseVal = (el) => {
    if (el.dataset.kind === 'bool') return el.checked;
    if (el.dataset.kind === 'num') return el.value === '' ? '' : Number(el.value);
    return el.value;
  };
  function bind(scope, path, v, { rr = false, key } = {}) {
    if (S.readOnly) return;
    const target = () => (scope === 'design' ? S.design : selBlock());
    if (!target()) return;
    change(() => setPath(target(), path, v), { key: key || `${scope || S.sel}:${path}`, redraw: 'soon', inspector: rr, outline: true });
  }
  right.addEventListener('input', (e) => {
    if (e.target.dataset.act === 'opts') {
      const opts = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 12);
      return change(() => { selBlock().options = opts; }, { key: `opts:${S.sel}`, redraw: 'soon' });
    }
    const el = e.target.closest('[data-bind]');
    if (!el || el.tagName === 'SELECT' || el.type === 'checkbox') return;
    const out = el.type === 'range' && right.querySelector(`[data-out="${CSS.escape(el.dataset.bind)}"]`);
    if (out) out.textContent = `${el.value}${el.dataset.unit || ''}`;
    bind(el.dataset.scope, el.dataset.bind, parseVal(el), { rr: 'rr' in el.dataset });
  });
  right.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.act === 'source') return changeSource(el.value, el);
    if (el.dataset.act === 'kind') { S.row.kind = el.value; saveMeta({ kind: el.value }); return; }
    if (el.dataset.act === 'img-up') return uploadImage(el);
    if (el.dataset.act === 'free') return toggleFree(el.checked);
    if (el.dataset.act === 'bg-up') return uploadBg(el);
    if (el.dataset.act === 'pkind') {
      const kinds = $$('[data-act=pkind]', right).filter((x) => x.checked).map((x) => x.value);
      return bind('', 'kinds', kinds, { key: 'kinds' });
    }
    if (el.dataset.app) return changeApps(el.dataset.app, el.value);
    const b = el.closest('[data-bind]');
    if (!b || !(b.tagName === 'SELECT' || b.type === 'checkbox')) return;
    const path = b.dataset.bind;
    const blk = selBlock();
    // Table columns: picking "custom text" switches to a template; picking a field fills the label.
    const m = /^columns\.(\d+)\.field$/.exec(path);
    if (m && blk?.type === 'table') {
      const i = Number(m[1]);
      return change(() => {
        const c = selBlock().columns[i];
        const f = cat().lists.find((x) => x.key === selBlock().list)?.fields.find((x) => x.key === b.value);
        if (!b.value) { c.field = ''; c.template = c.template || `{{item.${cat().lists.find((x) => x.key === selBlock().list)?.fields[0]?.key || ''}}}`; }
        else { c.field = b.value; c.template = ''; if (f && (!c.label || cat().lists.some((l) => l.fields.some((x) => x.label === c.label)))) c.label = f.label; if (f && ['money', 'number'].includes(f.type)) c.align = 'right'; }
      }, { inspector: true });
    }
    if (path === 'list' && blk?.type === 'table') {
      return change(() => {
        const t = selBlock();
        const l = cat().lists.find((x) => x.key === b.value);
        t.list = b.value;
        t.sortBy = '';
        t.groupBy = '';
        t.where = null;
        if (l) t.columns = l.fields.slice(0, 5).map((f) => ({ label: f.label, field: f.key, align: ['money', 'number'].includes(f.type) ? 'right' : 'left' }));
      }, { inspector: true });
    }
    bind(b.dataset.scope, path, parseVal(b), { rr: 'rr' in b.dataset || /\.op$|\.field$/.test(path) });
  });
  right.addEventListener('click', async (e) => {
    const t = e.target;
    const seg = t.closest('[data-seg]');
    const sw = t.closest('[data-sw]');
    const fx = t.closest('[data-fx]');
    const lop = t.closest('[data-lop]');
    const ra = t.closest('[data-rule-add]');
    const rd = t.closest('[data-rule-del]');
    const a = t.closest('[data-act]');
    const asset = t.closest('[data-asset]');
    const selp = t.closest('[data-selp]');
    const bdel = t.closest('[data-b=del]');
    if (selp) return select(selp.dataset.selp, { scroll: true });
    if (bdel) return remove(S.sel);
    if (seg) {
      const path = seg.dataset.seg;
      let v = JSON.parse(seg.dataset.v);
      if (path === '_mode') return tableMode(v);
      if (path === '_src') return imageSrc(v);
      if ('toggle' in seg.dataset && val(seg.dataset.scope, path) === v) v = path.startsWith('style.') ? '' : false;
      return bind(seg.dataset.scope, path, v, { rr: true });
    }
    if (sw) return bind(sw.dataset.scope, sw.dataset.sw, sw.dataset.v, { rr: true });
    if (fx) {
      const input = fx.parentElement.querySelector('input,textarea');
      return fieldPicker(fx, (p) => insertIntoInput(input, p), { list: fx.dataset.fxlist || (S.sel ? itemList(S.sel) : ''), itemsOnly: 'fxitems' in fx.dataset });
    }
    if (lop) return listOp(lop.dataset.lpath, lop.dataset.lop, Number(lop.dataset.i));
    if (ra || rd) {
      const box = t.closest('[data-rules]');
      const path = box.dataset.rules;
      const scope = box.dataset.scope;
      const target = () => (scope === 'design' ? S.design : selBlock());
      const itemKeys = path === 'where';
      return change(() => {
        const cur = getPath(target(), path);
        if (ra) {
          const first = itemKeys ? (cat().lists.find((x) => x.key === target().list)?.fields[0]?.key || '') : (cat().groups[0]?.fields[0]?.path || '');
          if (!cur) setPath(target(), path, { match: 'all', rules: [{ field: first, op: 'set', value: '' }] });
          else cur.rules.push({ field: first, op: 'set', value: '' });
        } else {
          cur.rules.splice(Number(rd.dataset.ruleDel), 1);
          if (!cur.rules.length) {
            const parts = path.split('.');
            const parent = parts.length > 1 ? getPath(target(), parts.slice(0, -1).join('.')) : target();
            if (parts[parts.length - 1] === 'where') parent.where = null;
            else delete parent[parts[parts.length - 1]];
          }
        }
      }, { inspector: true });
    }
    if (asset) return change(() => { const b = selBlock(); b.asset = Number(asset.dataset.asset); b.field = ''; }, { inspector: true });
    if (!a) return;
    const b = selBlock();
    switch (a.dataset.act) {
      case 'text-field': {
        const ed = selEl()?.querySelector('[data-edit]');
        if (ed) {
          ed.focus();
          const r = document.createRange();
          r.selectNodeContents(ed.querySelector('p:last-child') || ed);
          r.collapse(false);
          getSelection().removeAllRanges();
          getSelection().addRange(r);
          S.range = r.cloneRange();
          S.editing = ed;
        }
        return fieldPicker(a, (p) => insertField(p), { list: itemList(S.sel) });
      }
      case 'row-field': return fieldPicker(a, (p) => change(() => { selBlock().rows.push({ label: fieldLabel(p, itemList(S.sel)), value: `{{${p}}}` }); }, { inspector: true }), { list: itemList(S.sel) });
      case 'ncols': return setCols(Number(a.dataset.n));
      case 'widths': return change(() => { const w = a.dataset.w.split(',').map(Number); selBlock().cols.forEach((c, i) => { c.w = w[i] ?? c.w; }); }, { inspector: true });
      case 'col-add': return change(() => { const x = selBlock(); x.columns.push({ label: `Column ${x.columns.length + 1}`, template: '' }); x.rows.forEach((r) => r.push('')); }, { inspector: true });
      case 'col-del': return change(() => { const x = selBlock(); const i = Number(a.dataset.i); if (x.columns.length > 1) { x.columns.splice(i, 1); x.rows.forEach((r) => r.splice(i, 1)); } }, { inspector: true });
      case 'row-add': return change(() => { const x = selBlock(); x.rows.push(x.columns.map(() => '')); }, { inspector: true });
      case 'row-del': return change(() => { selBlock().rows.splice(Number(a.dataset.i), 1); }, { inspector: true });
      case 'qr-pick': return bind('', 'value', `{{${a.dataset.p}}}`, { rr: true });
      case 'stamp-when': return change(() => {
        const x = selBlock();
        x.showIf = { match: 'all', rules: [{ field: a.dataset.w === 'paid' ? 'invoice.is_paid' : 'invoice.is_past_due', op: 'yes', value: '' }] };
        x.text = a.dataset.w === 'paid' ? 'Paid' : 'Past due';
        x.tone = a.dataset.w === 'paid' ? 'green' : 'red';
        S.openSecs.add('cond');
      }, { inspector: true });
      case 'pgnum': return change(() => { S.design.footer.right = 'Page {{page}} of {{pages}}'; }, { inspector: true });
      case 'pick': return pickRecordForDoc();
      case 'sample': S.params = {}; S.row.record_title = ''; await saveMeta({ record: null }); await loadData(); banner(); draw(); return drawRight();
      case 'month': case 'lastmonth': {
        const d = new Date();
        if (a.dataset.act === 'lastmonth') d.setMonth(d.getMonth() - 1, 1);
        const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        const to = a.dataset.act === 'month' ? todayStr() : ymd(end);
        S.params = { ...S.params, from, to };
        await saveMeta({ record: S.params });
        await loadData();
        draw();
        return drawRight();
      }
      case 'brand': return act.brand();
      case 'make-free': return toggleFree(true);
      case 'logo-brand': return change(() => { selBlock().asset = null; }, { inspector: true });
      case 'z': return layer(a.dataset.z);
      case 'align-free': return alignFree(a.dataset.a);
      case 'bg-remove': return change(() => { S.design.page.bgImg = null; }, { inspector: true });
      case 'add-notice': return addNotice();
      case 'add-rtc': return addRightToCancel();
      case 'pv': return openPreview(a.dataset.pv);
      default: return undefined;
    }
  });
  function listOp(path, op, i) {
    const b = selBlock();
    if (!b) return;
    change(() => {
      const arr = getPath(selBlock(), path);
      if (!Array.isArray(arr)) return;
      if (op === 'del') arr.splice(i, 1);
      else if (op === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
      else if (op === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
      else if (op === 'add') {
        if (path === 'rows') arr.push({ label: 'Label', value: '' });
        else if (path === 'columns') {
          const l = cat().lists.find((x) => x.key === b.list);
          const used = new Set(b.columns.map((c) => c.field));
          const f = l?.fields.find((x) => !used.has(x.key)) || l?.fields[0];
          arr.push(f ? { label: f.label, field: f.key, align: ['money', 'number'].includes(f.type) ? 'right' : 'left' } : { label: 'Column', template: '' });
        } else if (path === 'sigs') arr.push({ label: 'Signature', image: '', name: '', date: '' });
        else if (path === 'items') arr.push({ text: 'New item', on: false, field: '' });
      }
      if (path === 'sigs' && !arr.length) arr.push({ label: 'Signature', image: '', name: '', date: '' });
    }, { inspector: true });
  }
  function setCols(n) {
    change(() => {
      const b = selBlock();
      const cols = b.cols;
      while (cols.length < n) cols.push({ w: 0, blocks: [] });
      while (cols.length > n) { const gone = cols.pop(); cols[cols.length - 1].blocks.push(...gone.blocks); }
      cols.forEach((c) => { c.w = Math.round(100 / n); });
    }, { inspector: true });
  }
  function tableMode(mode) {
    const b = selBlock();
    if ((mode === 'list') === Boolean(b.list)) return;
    change(() => {
      const t = selBlock();
      if (mode === 'typed') {
        t.columns = (t.columns.length ? t.columns : [{ label: 'Item' }, { label: 'Details' }]).slice(0, 6).map((c) => ({ label: c.label, template: '', align: c.align }));
        t.rows = [t.columns.map(() => ''), t.columns.map(() => '')];
        t.list = '';
      } else {
        const l = cat().lists[0];
        if (!l) { toast(`${cat().short} documents have no lists. Change "Filled in from" on the Data tab to list invoices, products or applications.`, true); return; }
        t.list = l.key;
        t.rows = [];
        t.columns = l.fields.slice(0, 4).map((f) => ({ label: f.label, field: f.key, align: ['money', 'number'].includes(f.type) ? 'right' : 'left' }));
      }
    }, { inspector: true });
  }
  function imageSrc(src) {
    change(() => {
      const b = selBlock();
      if (src === 'field') { b.asset = null; b.field = b.field || 'company.logo'; }
      else { b.field = ''; }
    }, { inspector: true });
  }
  // Does the customer sign or fill in anything on this design?
  function signsHere() {
    let yes = false;
    R.walk(S.design.blocks, (b) => { if ((b.type === 'sign' && b.who === 'customer') || b.type === 'input') yes = true; });
    return yes;
  }
  const smartBlock = (key) => { const s = meta.smart.find((x) => x.key === key); return s ? freshIds(R.clone(s.block)) : null; };
  // The Notice of Cancellation in duplicate, each copy on its own page at the end.
  function addNotice() {
    const one = smartBlock('cancel_notice');
    const two = smartBlock('cancel_notice');
    if (!one) return;
    change(() => { S.design.blocks.push({ id: R.newId(), type: 'pagebreak' }, one, { id: R.newId(), type: 'pagebreak' }, two); }, { inspector: true, outline: true });
    select(one.id, { scroll: true });
    toast('Two copies added at the end, as the FTC rule asks. They fill in the dates once signed.');
  }
  // The bold "You, the buyer, may cancel..." statement goes right above the customer's signature.
  function addRightToCancel() {
    const b = smartBlock('right_to_cancel');
    if (!b) return;
    let at = null;
    R.walk(S.design.blocks, (x) => { if (!at && x.type === 'sign' && x.who === 'customer') at = x.id; });
    const top = at ? (parents(at)[0] || findB(at).block) : null;
    const index = top ? S.design.blocks.findIndex((x) => x.id === top.id) : S.design.blocks.length;
    addBlock(b, { where: { key: 'root', index: Math.max(0, index) } });
  }
  async function uploadBg(input) {
    const f = input.files[0];
    if (!f) return;
    try {
      const a = await uploadDocImage(f, 2400);
      assets = null;
      change(() => { S.design.page.bgImg = a.id; if (!S.design.page.bgFade) S.design.page.bgFade = 0; }, { inspector: true });
      toast('Picture added behind the page');
    } catch (e) { toast(e.message, true); }
  }
  async function uploadImage(input) {
    const f = input.files[0];
    if (!f) return;
    try {
      const a = await uploadDocImage(f, 1800);
      assets = null;
      change(() => { const b = selBlock(); b.asset = a.id; b.field = ''; }, { inspector: true });
      toast('Picture added');
    } catch (e) { toast(e.message, true); }
  }
  async function changeSource(src, el) {
    if (src === S.source) return;
    const used = S.design.blocks.length > 0;
    const go = async () => {
      S.source = src;
      S.params = {};
      S.row.record_title = '';
      S.row.source = src;
      await saveMeta({ source: src, record: null });
      await loadData();
      banner();
      draw();
      drawLeft();
      drawRight();
    };
    if (!used) return go();
    modal('Change what fills this in?', `<p>Fields that ${esc(meta.sources[src].label.toLowerCase())} doesn't have will print empty. You can undo this by switching back.</p>`, [
      { label: 'Cancel', onClick: () => { el.value = S.source; } },
      { label: 'Change it', cls: 'primary', onClick: go },
    ]);
  }
  let appT = null;
  function changeApps(k, v) {
    S.params = { ...S.params, [k]: v || undefined };
    Object.keys(S.params).forEach((x) => { if (S.params[x] === undefined || S.params[x] === '') delete S.params[x]; });
    clearTimeout(appT);
    appT = setTimeout(async () => { await saveMeta({ record: S.params }); await loadData(); draw(); drawRight(); }, 250);
  }

  // ---------- keyboard ----------
  root.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (S.pv) { if (e.key === 'Escape') { e.preventDefault(); closePreview(); } return; }
    const tag = e.target.tagName;
    const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target.isContentEditable;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save().then(() => toast('Saved')); return; }
    if (inField) return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); openView(); return; }
    if (!S.sel || S.readOnly) { if (e.key === 'Escape') closePop(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(S.sel); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(S.sel); }
    else if (!e.altKey && /^Arrow/.test(e.key) && selBlock()?.style?.free) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      change(() => { const st = selBlock().style; st.x = (st.x || 0) + dx; st.y = (st.y || 0) + dy; }, { key: `nudge-free:${S.sel}`, inspector: true });
    } else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); nudge(S.sel, -1); }
    else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); nudge(S.sel, 1); }
    else if (e.key === 'Escape') { if (pop) closePop(); else { const ps = parents(S.sel); select(ps.length ? ps[ps.length - 1].id : null); } }
    else if (e.key === 'Enter') { const ed = selEl()?.querySelector('[contenteditable="true"]'); if (ed) { e.preventDefault(); ed.focus(); } }
  });
  // Clicks outside a popover close it.
  const onDocDown = (e) => { if (pop && !pop.contains(e.target) && !e.target.closest('[data-fx],[data-rt=field],[data-act=output],[data-act=more],[data-act=preview],[data-rt=color]')) closePop(); };
  document.addEventListener('mousedown', onDocDown, true);

  // ---------- leaving ----------
  const onResize = () => { if (S.pv) { clearTimeout(S.pvT); S.pvT = setTimeout(drawPreview, 120); } if (S.zoom === 'fit') applyZoom(); guides(); placeBar(); placeRt(); };
  const onUnload = (e) => { if (S.save !== 'saved' && !S.readOnly) { save(); e.preventDefault(); e.returnValue = ''; } };
  const onLeave = () => {
    if (location.hash.startsWith(`#/documents/${S.row.id}`)) return;
    if (S.save !== 'saved' || Object.keys(S.pending).length) save();
    closePop();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('beforeunload', onUnload);
    window.removeEventListener('hashchange', onLeave);
    document.removeEventListener('selectionchange', onSel);
    document.removeEventListener('mousedown', onDocDown, true);
    window.removeEventListener('pointermove', onFreeMove);
    window.removeEventListener('pointerup', onFreeUp);
    window.removeEventListener('pointercancel', onFreeUp);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('beforeunload', onUnload);
  window.addEventListener('hashchange', onLeave);

  // ---------- start ----------
  if (S.params[recKey()] && !S.row.record_title) S.row.record_title = '';
  await loadData();
  status();
  tools();
  banner();
  drawLeft();
  drawRight();
  draw();
  root.focus({ preventScroll: true });
  setTimeout(() => { draw(); }, 400);
}
