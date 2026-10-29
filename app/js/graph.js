// Termite graph editor: sketch the structure, mark what you found, and place the bait stations.
// Works with a finger on a phone or tablet in the crawlspace, or a mouse in the office.
// Opened as /nuvolve/app/graph.html?id=<graph> or /nuvolve/app/graph.html?property=<address> (lists or starts that address's graphs).
const app = document.getElementById('app');
const qs = new URLSearchParams(location.search);
const back = () => (history.length > 1 ? 'javascript:history.back()' : '/nuvolve/app/');

const TOOLS = [
  ['select', '👆 Move'], ['wall', '▭ Wall'], ['treat', '┅ Trenched'], ['drill', '⋯ Drilled'], ['station', '◉ Station'], ['text', 'Aa Label'], ['erase', '⌫ Erase'],
];

let G = null; // the graph from the server, with .data being edited
let tool = 'wall';
let mark = null; // a finding letter when the mark tool is on
let drawing = null; // the line being drawn: { t, pts }
let selected = null;
let drag = null;
let hover = null;
const undo = [];
let saveTimer = null;

async function start() {
  try {
    if (qs.get('id')) return await openGraph(qs.get('id'));
    if (qs.get('property')) return await listGraphs(qs.get('property'));
    app.innerHTML = '<div class="alert err" style="margin:20px">No graph picked.</div>';
  } catch (e) {
    app.innerHTML = `<div class="gwrap"><div class="alert err">${esc(e.message)}</div><a class="btn" href="${back()}">Back</a></div>`;
  }
}

async function listGraphs(propertyId) {
  const r = await api(`/nuvolve/app/api/properties/${propertyId}/termite-graphs`);
  if (!r.graphs.length && qs.get('new') !== '0') return newGraph(propertyId, 'Main structure');
  app.innerHTML = `<div class="gtop"><a href="${back()}">← Back</a><b>Termite graphs</b><span class="sub">${esc(r.property.address)}</span></div>
    <div class="gwrap"><div class="glist">${r.graphs.map((g) => `<a href="/nuvolve/app/graph.html?id=${g.id}"><b>📐 ${esc(g.name)}</b><span class="small muted">updated ${fmtDate(g.updated_at)}</span></a>`).join('')}</div>
    <button class="btn primary" id="new">+ New graph</button> <span class="small muted">Use one per building: house, detached garage, shed.</span></div>`;
  $('#new').onclick = () => {
    const name = prompt('What is this graph of?', r.graphs.length ? 'Detached garage' : 'Main structure');
    if (name) newGraph(propertyId, name);
  };
}

async function newGraph(propertyId, name) {
  const r = await api(`/nuvolve/app/api/properties/${propertyId}/termite-graphs`, { body: { name, data: { w: 80, h: 60, items: [] } } });
  location.replace(`/nuvolve/app/graph.html?id=${r.id}`);
}

async function openGraph(id) {
  G = await api(`/nuvolve/app/api/termite-graphs/${id}`);
  G.data = cleanGraph(G.data);
  document.title = `${G.name} - termite graph`;
  app.innerHTML = `
    <div class="gtop"><a href="${back()}">← Back</a><input id="gname" value="${esc(G.name)}" aria-label="Graph name">
      <span class="sub">${esc(G.customer_name)} · ${esc(G.property.address)}</span><span class="saved" id="saved">Saved</span></div>
    <div class="gwrap">
      <div class="tools" id="tools"></div>
      <div class="tools" id="marks"></div>
      <div class="hint-bar" id="hint"></div>
      <div id="canvas"></div>
      <div class="tools" style="margin-top:8px">
        <button id="undo">↶ Undo</button><button id="del">🗑 Delete selected</button>
        <span class="sep"></span>
        <label class="small">Size <input id="gw" type="number" min="10" max="400" value="${G.data.w}" style="width:64px"> × <input id="gh" type="number" min="10" max="400" value="${G.data.h}" style="width:64px"> ft</label>
        <span class="sep"></span>
        <a class="btn sm" href="/nuvolve/app/api/termite-graphs/${G.id}/print" target="_blank" rel="noopener">🖨 Print</a>
      </div>
      <div class="legend" id="legend"></div>
      <p class="small muted">Each square is 5 ft. Tap to add corners of a wall or treatment line, then tap <b>Done</b> (or double-tap). Station colors show the last check: green no activity, red termites, orange needs attention.</p>
    </div>`;
  $('#gname').onchange = () => { G.name = $('#gname').value.trim() || G.name; save(); };
  $('#undo').onclick = () => { if (undo.length) { G.data = undo.pop(); selected = null; drawing = null; draw(); save(); } };
  $('#del').onclick = removeSelected;
  for (const k of ['gw', 'gh']) $('#' + k).onchange = () => { snapshot(); G.data[k === 'gw' ? 'w' : 'h'] = Math.min(400, Math.max(10, Number($('#' + k).value) || 10)); draw(); save(); };
  const host = $('#canvas');
  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerup', () => { if (drag) { drag = null; save(); } });
  host.addEventListener('dblclick', () => finishLine());
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Enter') finishLine();
    if (e.key === 'Escape') { drawing = null; selected = null; draw(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected != null) { e.preventDefault(); removeSelected(); }
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) $('#undo').click();
  });
  window.addEventListener('beforeunload', (e) => { if (saveTimer) { e.preventDefault(); e.returnValue = ''; } });
  drawTools();
  draw();
}

function drawTools() {
  const unplaced = G.stations.filter((s) => !G.data.items.some((it) => it.t === 'station' && it.n === s.number));
  $('#tools').innerHTML = TOOLS.map(([k, l]) => `<button data-tool="${k}" class="${tool === k && !mark ? 'on' : ''}">${l}</button>`).join('')
    + (tool === 'station' ? `<select id="stn">${unplaced.map((s) => `<option value="${esc(s.number)}">#${esc(s.number)}${s.location ? ` · ${esc(s.location)}` : ''}</option>`).join('')}<option value="+">＋ New station</option></select>` : '')
    + (drawing ? '<button id="done" class="on">✓ Done</button>' + (drawing.t === 'wall' && drawing.pts.length >= 3 ? '<button id="close">Close shape</button>' : '') : '');
  $('#marks').innerHTML = '<span class="small muted" style="align-self:center">Findings:</span>' + Object.entries(GRAPH_MARKS).map(([k, [label, color]]) =>
    `<button class="mk ${mark === k ? 'on' : ''}" data-mark="${k}" title="${esc(label)}" style="${mark === k ? '' : `color:${color}`}">${k}</button>`).join('');
  $$('[data-tool]').forEach((b) => (b.onclick = () => { finishLine(); tool = b.dataset.tool; mark = null; selected = null; drawTools(); draw(); }));
  $$('[data-mark]').forEach((b) => (b.onclick = () => { finishLine(); tool = 'mark'; mark = b.dataset.mark; selected = null; drawTools(); draw(); }));
  if ($('#done')) $('#done').onclick = () => finishLine();
  if ($('#close')) $('#close').onclick = () => finishLine(true);
  if ($('#stn')) $('#stn').onchange = async (e) => { if (e.target.value === '+') await addStation(); };
  const hints = {
    select: 'Tap something to pick it, then drag to move it.',
    wall: drawing ? 'Keep tapping corners. Done when finished, or Close shape to join the last corner to the first.' : 'Tap the first corner of the wall.',
    treat: 'Tap along the line that was trenched and treated.',
    drill: 'Tap along the slab or porch that was drilled and treated.',
    station: unplaced.length ? 'Tap where the station is. The list shows stations not on the graph yet.' : 'All stations are placed. Pick ＋ New station to add one.',
    text: 'Tap where the label goes.',
    erase: 'Tap something to remove it.',
    mark: mark ? `Tap to mark: ${GRAPH_MARKS[mark][0]}.` : '',
  };
  $('#hint').textContent = hints[tool] || '';
}

// A new in-ground termite station at this address, numbered after the highest one.
async function addStation() {
  const next = Math.max(0, ...G.stations.map((s) => parseInt(s.number, 10) || 0)) + 1;
  const number = prompt('Station number', String(next));
  if (!number) return drawTools();
  try {
    await api(`/nuvolve/app/api/properties/${G.property_id}/devices`, { body: { number, type: 'termite' } });
    G.stations = (await api(`/nuvolve/app/api/termite-graphs/${G.id}`)).stations;
    drawTools();
    $('#stn').value = number;
    toast(`Station ${number} added`);
  } catch (e) { toast(e.message, true); drawTools(); }
}

function draw() {
  const status = Object.fromEntries(G.stations.filter((s) => s.last_status).map((s) => [s.number, s.last_status]));
  let svg = graphSvg(G.data, { selected, stationStatus: status, maxHeight: '70vh' });
  // The line being drawn, with a rubber band to the pointer.
  if (drawing) {
    const [, color, dash] = GRAPH_LINES[drawing.t];
    const pts = [...drawing.pts, ...(hover ? [hover] : [])].map((p) => `${p[0] * GRAPH_SCALE},${p[1] * GRAPH_SCALE}`).join(' ');
    svg = svg.replace('</svg>', `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="3" stroke-dasharray="${dash || '6 4'}" opacity=".7"/>`
      + drawing.pts.map((p) => `<circle cx="${p[0] * GRAPH_SCALE}" cy="${p[1] * GRAPH_SCALE}" r="5" fill="${color}"/>`).join('') + '</svg>');
  }
  $('#canvas').innerHTML = svg;
  $('#legend').innerHTML = graphLegend(G.data);
}

// Pointer position in feet, snapped to half a foot.
function feet(e) {
  const svg = $('#canvas svg');
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  const snap = (v, max) => Math.min(max, Math.max(0, Math.round((v / GRAPH_SCALE) * 2) / 2));
  return [snap(p.x, G.data.w), snap(p.y, G.data.h)];
}
const hitIndex = (e) => { const el = e.target.closest('[data-i]'); return el ? Number(el.dataset.i) : null; };
const snapshot = () => { undo.push(JSON.parse(JSON.stringify(G.data))); if (undo.length > 60) undo.shift(); };

function onDown(e) {
  if (!$('#canvas svg')) return;
  const [x, y] = feet(e);
  const hit = hitIndex(e);
  if (tool === 'select') {
    selected = hit;
    if (hit != null) { snapshot(); drag = { from: [x, y] }; $('#canvas').setPointerCapture(e.pointerId); }
    return draw();
  }
  if (tool === 'erase') {
    if (hit != null) { snapshot(); G.data.items.splice(hit, 1); draw(); save(); drawTools(); }
    return;
  }
  if (GRAPH_LINES[tool]) {
    if (!drawing) { drawing = { t: tool, pts: [] }; }
    const last = drawing.pts[drawing.pts.length - 1];
    if (!last || last[0] !== x || last[1] !== y) drawing.pts.push([x, y]);
    drawTools();
    return draw();
  }
  snapshot();
  if (tool === 'mark') G.data.items.push({ t: 'mark', k: mark, x, y });
  else if (tool === 'text') {
    const s = prompt('Label (e.g. Garage, Porch, Bath)');
    if (!s) { undo.pop(); return; }
    G.data.items.push({ t: 'text', s: s.slice(0, 60), x, y });
  } else if (tool === 'station') {
    const n = $('#stn')?.value;
    if (!n || n === '+') { undo.pop(); return toast('Pick a station, or ＋ New station', true); }
    G.data.items.push({ t: 'station', n, x, y });
    drawTools();
  }
  draw();
  save();
}

function onMove(e) {
  if (!$('#canvas svg')) return;
  const [x, y] = feet(e);
  if (drawing) { hover = [x, y]; return draw(); }
  if (!drag || selected == null) return;
  const dx = x - drag.from[0], dy = y - drag.from[1];
  if (!dx && !dy) return;
  const it = G.data.items[selected];
  if (it.pts) it.pts = it.pts.map((p) => [p[0] + dx, p[1] + dy]);
  else { it.x += dx; it.y += dy; }
  drag.from = [x, y];
  draw();
}

function finishLine(close = false) {
  if (!drawing) return;
  if (drawing.pts.length >= 2) {
    snapshot();
    G.data.items.push({ t: drawing.t, pts: drawing.pts, ...(close && drawing.pts.length >= 3 ? { closed: true } : {}) });
    save();
  }
  drawing = null;
  hover = null;
  drawTools();
  draw();
}

function removeSelected() {
  if (selected == null) return toast('Pick something with 👆 Move first', true);
  snapshot();
  G.data.items.splice(selected, 1);
  selected = null;
  draw();
  drawTools();
  save();
}

// Saves a moment after the last change, so a tech with a weak signal isn't sending every tap.
function save() {
  clearTimeout(saveTimer);
  $('#saved').textContent = 'Saving...';
  saveTimer = setTimeout(async () => {
    try {
      await api(`/nuvolve/app/api/termite-graphs/${G.id}`, { method: 'PUT', body: { name: G.name, data: G.data } });
      saveTimer = null;
      $('#saved').textContent = 'Saved';
    } catch (e) {
      saveTimer = null;
      $('#saved').textContent = 'Not saved';
      toast(`${e.message}. Your drawing is still here; try again in a moment.`, true);
    }
  }, 900);
}

start();
