// Termite graph drawing: turns a graph's JSON into an SVG picture.
// Shared by the graph editor in the browser and the printed WDI report on the server, so both look the same.
//
// Graph JSON, in feet: { w, h, items: [...] } where each item is one of
//   { t: 'wall' | 'treat' | 'drill', pts: [[x, y], ...], closed }   walls, trenched-and-treated lines, drilled lines
//   { t: 'mark', k: 'A', x, y }                                     a finding letter (see GRAPH_MARKS)
//   { t: 'station', n: '12', x, y }                                 a termite bait station by its tag number
//   { t: 'text', s: 'Garage', x, y }                                a label
(function (root) {
  const SCALE = 10; // pixels per foot
  const MARKS = {
    A: ['Active termites', '#c53030'],
    D: ['Damage', '#c05621'],
    E: ['Evidence (mud tubes, wings, frass)', '#b7791f'],
    P: ['Previous treatment', '#6b46c1'],
    M: ['Moisture or leak', '#2b6cb0'],
    W: ['Wood touching soil', '#744210'],
    C: ['Wood debris (cellulose)', '#975a16'],
    F: ['Soil too high on foundation', '#4a5568'],
    X: ['Could not inspect', '#1a202c'],
  };
  const LINES = {
    wall: ['Structure', '#1a202c', '', 3],
    treat: ['Trenched and treated', '#2f855a', '10 6', 3],
    drill: ['Drilled and treated', '#2f855a', '2 6', 4],
  };
  // How a station looks for its latest check: green no activity, red termites, orange needs attention.
  const STATION_FILL = { ok: '#c6f6d5', bait_replaced: '#c6f6d5', activity: '#feb2b2', captured: '#feb2b2', damaged: '#fbd38d', missing: '#fbd38d', inaccessible: '#e2e8f0' };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = (v) => Math.round((Number(v) || 0) * SCALE * 10) / 10;

  function graphSvg(data, opts) {
    opts = opts || {};
    const g = data || {};
    const w = Math.max(10, Number(g.w) || 80), h = Math.max(10, Number(g.h) || 60);
    const items = Array.isArray(g.items) ? g.items : [];
    const status = opts.stationStatus || {};
    const out = [];
    if (opts.grid !== false) {
      out.push('<g stroke="#e6ece8" stroke-width="1">');
      for (let x = 0; x <= w; x += 5) out.push(`<line x1="${n(x)}" y1="0" x2="${n(x)}" y2="${n(h)}"${x % 25 === 0 ? ' stroke="#cfd8d3"' : ''}/>`);
      for (let y = 0; y <= h; y += 5) out.push(`<line x1="0" y1="${n(y)}" x2="${n(w)}" y2="${n(y)}"${y % 25 === 0 ? ' stroke="#cfd8d3"' : ''}/>`);
      out.push('</g>');
    }
    items.forEach((it, i) => {
      const sel = opts.selected === i ? ' data-sel="1"' : '';
      const tag = ` data-i="${i}"${sel}`;
      if (LINES[it.t] && Array.isArray(it.pts) && it.pts.length) {
        const [, color, dash, width] = LINES[it.t];
        const pts = it.pts.map((p) => `${n(p[0])},${n(p[1])}`).join(' ');
        out.push(`<${it.closed ? 'polygon' : 'polyline'}${tag} points="${pts}" fill="none" stroke="${opts.selected === i ? '#3182ce' : color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linejoin="round" stroke-linecap="round"/>`);
      } else if (it.t === 'mark' && MARKS[it.k]) {
        const color = MARKS[it.k][1];
        out.push(`<g${tag}><rect x="${n(it.x) - 11}" y="${n(it.y) - 11}" width="22" height="22" rx="4" fill="#fff" stroke="${opts.selected === i ? '#3182ce' : color}" stroke-width="2"/>`
          + `<text x="${n(it.x)}" y="${n(it.y) + 5}" text-anchor="middle" font-size="15" font-weight="700" font-family="Arial, sans-serif" fill="${color}">${it.k}</text></g>`);
      } else if (it.t === 'station') {
        const fill = STATION_FILL[status[it.n]] || '#fff';
        out.push(`<g${tag}><circle cx="${n(it.x)}" cy="${n(it.y)}" r="11" fill="${fill}" stroke="${opts.selected === i ? '#3182ce' : '#2f855a'}" stroke-width="2.5"/>`
          + `<text x="${n(it.x)}" y="${n(it.y) + 4}" text-anchor="middle" font-size="${String(it.n).length > 2 ? 9 : 11}" font-weight="700" font-family="Arial, sans-serif" fill="#1a202c">${esc(it.n)}</text></g>`);
      } else if (it.t === 'text') {
        out.push(`<text${tag} x="${n(it.x)}" y="${n(it.y)}" font-size="14" font-family="Arial, sans-serif" fill="${opts.selected === i ? '#3182ce' : '#2d3748'}">${esc(it.s)}</text>`);
      }
    });
    // North arrow and scale, so a printed graph reads on its own.
    out.push(`<g font-family="Arial, sans-serif" font-size="11" fill="#4a5568"><path d="M${n(w) - 18} 30 l8 -18 l8 18 l-8 -5 z" fill="#4a5568"/><text x="${n(w) - 10}" y="44" text-anchor="middle">N</text>`
      + `<line x1="10" y1="${n(h) - 12}" x2="${10 + 10 * SCALE}" y2="${n(h) - 12}" stroke="#4a5568" stroke-width="2"/><text x="10" y="${n(h) - 17}">10 ft</text></g>`);
    const attrs = opts.attrs || '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(w)} ${n(h)}" width="100%" style="background:#fff;max-height:${opts.maxHeight || 'none'}"${attrs}>${out.join('')}</svg>`;
  }

  // Which symbols a graph uses, for the legend under it.
  function graphLegend(data) {
    const items = (data && Array.isArray(data.items)) ? data.items : [];
    const used = new Set(items.map((it) => (it.t === 'mark' ? it.k : it.t)));
    const rows = [];
    for (const [k, [label, color, dash]] of Object.entries(LINES)) if (k !== 'wall' && used.has(k)) rows.push(`<span><svg width="34" height="10"><line x1="2" y1="5" x2="32" y2="5" stroke="${color}" stroke-width="3"${dash ? ` stroke-dasharray="${dash}"` : ''}/></svg> ${label}</span>`);
    if (used.has('station')) rows.push('<span><svg width="16" height="16"><circle cx="8" cy="8" r="6.5" fill="#fff" stroke="#2f855a" stroke-width="2"/></svg> Bait station (number)</span>');
    for (const [k, [label, color]] of Object.entries(MARKS)) if (used.has(k)) rows.push(`<span><b style="color:${color}">${k}</b> ${label}</span>`);
    return rows.join(' ');
  }

  // Cleans graph JSON sent from a browser: numbers in range, known item types, short labels.
  function cleanGraph(raw) {
    const g = raw && typeof raw === 'object' ? raw : {};
    const w = Math.min(Math.max(Math.round(Number(g.w) || 80), 10), 400);
    const h = Math.min(Math.max(Math.round(Number(g.h) || 60), 10), 400);
    const c = (v, max) => Math.min(Math.max(Math.round((Number(v) || 0) * 2) / 2, 0), max);
    const items = [];
    for (const it of (Array.isArray(g.items) ? g.items : []).slice(0, 2000)) {
      if (!it || typeof it !== 'object') continue;
      if (LINES[it.t] && Array.isArray(it.pts)) {
        const pts = it.pts.slice(0, 200).filter((p) => Array.isArray(p)).map((p) => [c(p[0], w), c(p[1], h)]);
        if (pts.length >= 2) items.push({ t: it.t, pts, ...(it.closed && pts.length >= 3 ? { closed: true } : {}) });
      } else if (it.t === 'mark' && MARKS[it.k]) items.push({ t: 'mark', k: it.k, x: c(it.x, w), y: c(it.y, h) });
      else if (it.t === 'station' && String(it.n || '').trim()) items.push({ t: 'station', n: String(it.n).trim().slice(0, 12), x: c(it.x, w), y: c(it.y, h) });
      else if (it.t === 'text' && String(it.s || '').trim()) items.push({ t: 'text', s: String(it.s).trim().slice(0, 60), x: c(it.x, w), y: c(it.y, h) });
    }
    return { w, h, items };
  }

  const api = { graphSvg, graphLegend, cleanGraph, GRAPH_MARKS: MARKS, GRAPH_LINES: LINES, GRAPH_SCALE: SCALE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
}(this));
