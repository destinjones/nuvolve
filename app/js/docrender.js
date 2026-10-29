// Document renderer. Turns a design (page settings + blocks) and the data for one record into HTML.
// The same file runs in the builder (browser) and on the server (PDFs, emails, share links),
// so what the office sees while designing is exactly what gets printed and sent.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DocRender = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  // ---------- small helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, lo, hi, d) => { const x = Number(v); return v === '' || v == null || !Number.isFinite(x) ? d : Math.min(hi, Math.max(lo, x)); };
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const str = (v, max = 2000) => (v == null ? '' : String(v)).slice(0, max);
  const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';
  const pad = (n) => String(n).padStart(2, '0');
  function color(v, d = '') {
    if (v === 'accent' || v === 'accent-soft') return v;
    if (typeof v !== 'string') return d;
    const s = v.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(s)) return s;
    if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
    const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
    return m ? `#${[m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('')}` : d;
  }
  const cssColor = (c) => (c === 'accent' ? 'var(--nv-accent)' : c === 'accent-soft' ? 'var(--nv-accent-soft)' : c);
  // A lighter tint of the accent for shaded rows and section bars.
  function tint(hex, amount = 0.88) {
    const h = color(hex, '#2f855a');
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    return `#${[r, g, b].map((c) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0')).join('')}`;
  }
  let seq = 0;
  const newId = () => `b${Date.now().toString(36).slice(-4)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const clone = (x) => JSON.parse(JSON.stringify(x));

  // ---------- page settings ----------
  const PAGE_SIZES = { letter: { w: 8.5, h: 11, label: 'Letter (8.5 × 11 in)' }, legal: { w: 8.5, h: 14, label: 'Legal (8.5 × 14 in)' }, a4: { w: 8.27, h: 11.69, label: 'A4' } };
  const FONTS = {
    sans: { label: 'Arial (clean)', css: 'Arial, "Helvetica Neue", Helvetica, "Liberation Sans", sans-serif' },
    helvetica: { label: 'Helvetica', css: '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif' },
    system: { label: 'Modern (system)', css: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Liberation Sans", Arial, sans-serif' },
    narrow: { label: 'Narrow (fits wide tables)', css: '"Arial Narrow", "Roboto Condensed", "Liberation Sans Narrow", "DejaVu Sans Condensed", Arial, sans-serif' },
    serif: { label: 'Georgia (classic)', css: 'Georgia, "Times New Roman", "Liberation Serif", "DejaVu Serif", serif' },
    times: { label: 'Times New Roman', css: '"Times New Roman", Times, "Liberation Serif", serif' },
    mono: { label: 'Typewriter (mono)', css: '"Courier New", Courier, "Liberation Mono", "DejaVu Sans Mono", monospace' },
  };
  // A border around every page: [weight in pt, line style].
  const FRAMES = { thin: [0.75, 'solid'], medium: [1.5, 'solid'], thick: [3, 'solid'], double: [3.5, 'double'], dashed: [1, 'dashed'] };
  const FRAME_GAP = 10; // pt between the border and the writing
  const DATE_FORMATS = { medium: 'Oct 29, 2026', long: 'October 29, 2026', short: '10/29/2026', iso: '2026-10-29', dmy: '29/10/2026' };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // ---------- formatting values ----------
  const DT = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/;
  function fmtDate(v, style) {
    const m = DT.exec(String(v ?? ''));
    if (!m) return String(v ?? '');
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!mo || mo > 12) return String(v);
    switch (style) {
      case 'long': return `${MONTHS[mo - 1]} ${d}, ${y}`;
      case 'short': return `${pad(mo)}/${pad(d)}/${y}`;
      case 'dmy': return `${pad(d)}/${pad(mo)}/${y}`;
      case 'iso': return `${m[1]}-${m[2]}-${m[3]}`;
      case 'month': return `${MONTHS[mo - 1]} ${y}`;
      case 'weekday': return `${new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}, ${MONTHS[mo - 1]} ${d}, ${y}`;
      default: return `${MONTHS[mo - 1].slice(0, 3)} ${d}, ${y}`;
    }
  }
  function fmtTime(v) {
    const m = /(?:^|[ T])(\d{1,2}):(\d{2})/.exec(String(v ?? ''));
    if (!m) return '';
    const h = Number(m[1]);
    return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
  }
  const isNum = (v) => v !== '' && v != null && typeof v !== 'boolean' && Number.isFinite(Number(v));
  const fmtMoney = (v) => (isNum(v) ? Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : String(v ?? ''));
  const fmtNumber = (v, dec) => (isNum(v) ? Number(v).toLocaleString('en-US', { maximumFractionDigits: dec == null || dec === '' ? 2 : Number(dec), minimumFractionDigits: dec == null || dec === '' ? 0 : Number(dec) }) : String(v ?? ''));
  const titleCase = (s) => String(s).toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
  const isEmpty = (v) => v == null || v === '' || v === false || (Array.isArray(v) && v.length === 0);

  // Every field has a type (from the data source catalog) so it prints the right way without extra work:
  // money as $125.00, dates in the design's date style, yes/no for checkboxes.
  const TYPE_FILTERS = ['money', 'number', 'int', 'percent', 'date', 'time', 'datetime', 'yesno', 'raw'];
  function formatValue(v, type, filters, ctx) {
    let out = v;
    const typed = filters.some(([f]) => TYPE_FILTERS.includes(f));
    if (!typed && !isEmpty(v)) {
      switch (type) {
        case 'money': out = fmtMoney(v); break;
        case 'number': out = fmtNumber(v); break;
        case 'percent': out = isNum(v) ? `${fmtNumber(v)}%` : v; break;
        case 'date': out = fmtDate(v, ctx.dateFormat); break;
        case 'datetime': out = fmtTime(v) ? `${fmtDate(v, ctx.dateFormat)}, ${fmtTime(v)}` : fmtDate(v, ctx.dateFormat); break;
        case 'time': out = fmtTime(v) || v; break;
        case 'boolean': out = bool(v) ? 'Yes' : 'No'; break;
        default: break;
      }
    }
    if (type === 'boolean' && !typed && (v === false || v === 0 || v === '0')) out = 'No';
    for (const [f, arg] of filters) {
      switch (f) {
        case 'money': out = fmtMoney(out); break;
        case 'number': out = fmtNumber(out, arg); break;
        case 'int': out = isNum(out) ? fmtNumber(Math.round(Number(out)), 0) : out; break;
        case 'percent': out = isNum(out) ? `${fmtNumber(out)}%` : out; break;
        case 'date': out = fmtDate(out, arg || ctx.dateFormat); break;
        case 'time': out = fmtTime(out); break;
        case 'datetime': out = `${fmtDate(out, arg || ctx.dateFormat)}${fmtTime(out) ? `, ${fmtTime(out)}` : ''}`; break;
        case 'yesno': out = bool(out) ? 'Yes' : 'No'; break;
        case 'upper': out = String(out ?? '').toUpperCase(); break;
        case 'lower': out = String(out ?? '').toLowerCase(); break;
        case 'title': out = titleCase(out ?? ''); break;
        case 'first': out = String(out ?? '').trim().split(/\s+/)[0] || ''; break;
        case 'default': if (isEmpty(out)) out = arg; break;
        case 'truncate': { const n = num(arg, 1, 2000, 80); const s = String(out ?? ''); out = s.length > n ? `${s.slice(0, n - 1)}…` : s; break; }
        default: break;
      }
    }
    return out == null || out === false ? '' : out;
  }

  // ---------- reading fields ----------
  // Paths look like customer.name, invoice.total, or item.product inside a table or repeat.
  function lookup(path, ctx) {
    const parts = String(path).split('.');
    let cur;
    if (parts[0] === 'item') cur = ctx.item;
    else if (parts[0] === 'group') cur = ctx.group;
    else cur = ctx.data ? ctx.data[parts[0]] : undefined;
    for (let i = 1; i < parts.length && cur != null; i++) cur = typeof cur === 'object' ? cur[parts[i]] : undefined;
    return cur;
  }
  function typeOf(path, ctx) {
    if (path.startsWith('item.')) return path === 'item._n' ? 'number' : ctx.types[`${ctx.list}[].${path.slice(5)}`] || 'text';
    if (path === 'group.count') return 'number';
    if (path === 'group.value') return ctx.groupType || 'text';
    return ctx.types[path] || 'text';
  }
  function labelOf(path, ctx) {
    if (path.startsWith('item.')) return path === 'item._n' ? 'Row #' : ctx.labels[`${ctx.list}[].${path.slice(5)}`] || path.slice(5);
    if (path.startsWith('group.')) return path === 'group.count' ? 'Group count' : 'Group';
    return ctx.labels[path] || path;
  }

  const TOKEN = /\{\{\s*([A-Za-z_][\w.]*)((?:\s*\|\s*[a-z_]+(?::[^|}]*)?)*)\s*\}\}/g;
  const parseFilters = (s) => String(s || '').split('|').map((x) => x.trim()).filter(Boolean)
    .map((f) => { const i = f.indexOf(':'); return i < 0 ? [f, ''] : [f.slice(0, i).trim(), f.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; });

  // The text a field prints as, plus whether it is empty (so empty address lines can be dropped).
  function fieldOut(path, filterStr, ctx) {
    const raw = lookup(path, ctx);
    const type = typeOf(path, ctx);
    const v = formatValue(raw, type, parseFilters(filterStr), ctx);
    return { type, raw, text: typeof v === 'object' ? '' : String(v) };
  }
  const valueHtml = (o) => {
    if (o.type === 'image') return '';
    if (o.type === 'url' && /^https?:\/\//i.test(o.text)) return `<a href="${esc(o.text)}">${esc(o.text)}</a>`;
    if (o.type === 'email' && /^[^@\s]+@[^@\s]+$/.test(o.text)) return `<a href="mailto:${esc(o.text)}">${esc(o.text)}</a>`;
    return esc(o.text).replace(/\n/g, '<br>');
  };
  // In the builder, fields show as chips holding the sample value, so people see real-looking text and can still tell what is a field.
  function chip(token, path, o, ctx) {
    const label = labelOf(path, ctx);
    const inner = ctx.fieldNames || !o.text ? `<span class="nv-chip-l">${esc(label)}</span>` : (o.type === 'image' ? '🖼' : valueHtml(o));
    return `<span class="nv-chip${!o.text ? ' nv-chip-empty' : ''}" contenteditable="false" data-f="${esc(token)}" title="${esc(label)}">${inner}</span>`;
  }

  // Plain text with fields: headings, labels, table cells, letterhead lines. Newlines become line breaks.
  // Outside the builder, a line made only of fields that are all empty is dropped (no blank "Company:" lines).
  function textHtml(tpl, ctx, { chips = ctx.edit, multiline = true } = {}) {
    const lines = String(tpl ?? '').split('\n');
    const out = [];
    for (const line of lines) {
      let fields = 0, filled = 0;
      const html = esc(line).replace(/\{\{([^}]*)\}\}/g, (whole, inner) => {
        const m = /^\s*([A-Za-z_][\w.]*)((?:\s*\|\s*[a-z_]+(?::[^|}]*)?)*)\s*$/.exec(inner.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
        if (!m) return whole;
        fields++;
        const o = fieldOut(m[1], m[2], ctx);
        if (o.text) filled++;
        return chips ? chip(`${m[1]}${m[2] ? m[2].replace(/\s+/g, '') : ''}`, m[1], o, ctx) : valueHtml(o);
      });
      if (!chips && fields && !filled) continue;
      out.push(!chips && filled < fields ? tidy(html) : html);
    }
    return out.join(multiline ? '<br>' : ' ');
  }
  // "Jane · · 555-0100" becomes "Jane · 555-0100" when a field in the middle is empty.
  const SEP = '[·•|–—]';
  const tidy = (s) => s.replace(new RegExp(`(\\s${SEP}\\s)(?:\\s*${SEP}\\s*)+`, 'g'), '$1').replace(new RegExp(`^\\s*(?:${SEP}|,)\\s*`), '')
    .replace(new RegExp(`\\s*(?:${SEP}|,)\\s*$`), '').replace(/,\s*,/g, ',').replace(/\(\s*\)/g, '').trim();
  const plain = (tpl, ctx) => {
    const parts = [];
    for (const line of String(tpl ?? '').split('\n')) {
      let fields = 0, filled = 0;
      const t = line.replace(TOKEN, (_, path, f) => { fields++; const o = fieldOut(path, f, ctx); if (o.text) filled++; return o.text; });
      if (fields && !filled) continue;
      parts.push(filled < fields ? tidy(t) : t);
    }
    return parts.join('\n');
  };

  // Rich text from the text editor. Already sanitized; fields are swapped for values (or chips in the builder).
  function richHtml(html, ctx) {
    const swap = (s) => s.replace(TOKEN, (whole, path, f) => {
      const o = fieldOut(path, f, ctx);
      return ctx.edit ? chip(`${path}${f ? f.replace(/\s+/g, '') : ''}`, path, o, ctx) : valueHtml(o);
    });
    if (ctx.edit) return swap(html);
    // Drop paragraphs and lines that are nothing but empty fields.
    const drop = (seg) => {
      let fields = 0, filled = 0;
      seg.replace(TOKEN, (_, path, f) => { fields++; if (fieldOut(path, f, ctx).text) filled++; return ''; });
      return fields > 0 && !filled;
    };
    const cleaned = html.replace(/<(p|li|div)(\s[^>]*)?>([\s\S]*?)<\/\1>/g, (whole, tag, attrs, inner) => {
      if (drop(inner)) return '';
      const lines = inner.split(/<br\s*\/?>/i);
      return lines.length > 1 ? `<${tag}${attrs || ''}>${lines.filter((l) => !drop(l)).join('<br>')}</${tag}>` : whole;
    });
    return swap(cleaned);
  }

  // ---------- rich text sanitizer ----------
  // Only simple formatting survives: no scripts, no outside images, no event handlers, no odd styles.
  const RICH_TAGS = new Set(['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'ul', 'ol', 'li', 'span', 'a', 'sub', 'sup', 'small', 'blockquote', 'h4']);
  const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'title', 'head', 'svg', 'math', 'noscript', 'textarea', 'select', 'button']);
  const VOID = new Set(['br']);
  function cleanStyle(s) {
    const out = [];
    for (const decl of String(s || '').split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const k = decl.slice(0, i).trim().toLowerCase();
      const v = decl.slice(i + 1).trim().toLowerCase();
      if (k === 'text-align' && ['left', 'center', 'right', 'justify'].includes(v)) out.push(`text-align:${v}`);
      else if ((k === 'color' || k === 'background-color') && color(v)) out.push(`${k}:${color(v)}`);
      else if (k === 'font-weight' && ['bold', '700', '600', 'normal', '400'].includes(v)) out.push(`font-weight:${v === 'bold' || Number(v) >= 600 ? 700 : 400}`);
      else if (k === 'font-style' && ['italic', 'normal'].includes(v)) out.push(`font-style:${v}`);
      else if (k === 'text-decoration' && /^(underline|line-through|none)$/.test(v.split(' ')[0])) out.push(`text-decoration:${v.split(' ')[0]}`);
      else if (k === 'font-size' && /^\d{1,2}(\.\d)?pt$/.test(v) && parseFloat(v) >= 6 && parseFloat(v) <= 48) out.push(`font-size:${v}`);
    }
    return out.join(';');
  }
  const decode = (s) => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp|#39);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'quot') return '"'; if (k === 'apos' || k === '#39') return "'"; if (k === 'nbsp') return ' ';
    const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return code > 0 && code < 0x10ffff && code !== 0x3c && code !== 0x3e ? String.fromCodePoint(code) : '';
  });
  const escText = (s) => decode(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function sanitizeRich(input, max = 60000) {
    const html = String(input ?? '').slice(0, max * 2).replace(/<!--[\s\S]*?-->/g, '');
    const out = [];
    const stack = [];
    let dropping = null;
    const re = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
    let last = 0, m;
    while ((m = re.exec(html))) {
      if (!dropping) out.push(escText(html.slice(last, m.index).replace(/[<>]/g, '')));
      last = re.lastIndex;
      const closing = Boolean(m[1]);
      const tag = m[2].toLowerCase();
      if (dropping) { if (closing && tag === dropping) dropping = null; continue; }
      if (DROP_WITH_CONTENT.has(tag)) { if (!closing && !/\/\s*$/.test(m[3])) dropping = tag; continue; }
      const t = tag === 'strong' ? 'b' : tag === 'em' ? 'i' : tag === 'strike' ? 's' : tag;
      if (!RICH_TAGS.has(tag)) continue;
      if (closing) {
        const i = stack.lastIndexOf(t);
        if (i < 0) continue;
        while (stack.length > i) out.push(`</${stack.pop()}>`);
        continue;
      }
      let attrs = '';
      const st = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(m[3]);
      const style = st ? cleanStyle(decode(st[2] ?? st[3] ?? '')) : '';
      if (style && t !== 'br') attrs += ` style="${esc(style)}"`;
      if (t === 'a') {
        const hr = /\shref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(m[3]);
        const href = hr ? decode(hr[2] ?? hr[3] ?? '').trim() : '';
        if (/^(https?:\/\/|mailto:|tel:)/i.test(href) || /^\{\{\s*[\w.]+\s*\}\}$/.test(href)) attrs += ` href="${esc(href)}"`;
      }
      out.push(`<${t}${attrs}>`);
      if (!VOID.has(t)) stack.push(t);
    }
    if (!dropping) out.push(escText(html.slice(last).replace(/[<>]/g, '')));
    while (stack.length) out.push(`</${stack.pop()}>`);
    return out.join('').slice(0, max);
  }

  // ---------- conditions ("show this block only when...") ----------
  const OPS = {
    set: 'has a value', empty: 'is empty or zero', eq: 'is', neq: 'is not', gt: 'is more than', lt: 'is less than', contains: 'contains', yes: 'is yes', no: 'is no',
  };
  function normRules(c) {
    if (!c || typeof c !== 'object') return null;
    const rules = (Array.isArray(c.rules) ? c.rules : c.field ? [c] : []).slice(0, 5)
      .map((r) => ({ field: str(r.field, 120).replace(/[^\w.]/g, ''), op: pick(r.op, Object.keys(OPS), 'set'), value: str(r.value, 200) }))
      .filter((r) => r.field);
    return rules.length ? { match: pick(c.match, ['all', 'any'], 'all'), rules } : null;
  }
  function testRule(r, ctx) {
    const v = lookup(r.field, ctx);
    const empty = isEmpty(v) || (isNum(v) && Number(v) === 0);
    const cmp = (a, b) => (isNum(a) && isNum(b) ? Number(a) - Number(b) : String(a ?? '').toLowerCase().localeCompare(String(b ?? '').toLowerCase()));
    switch (r.op) {
      case 'set': return !empty;
      case 'empty': return empty;
      case 'eq': return cmp(v, r.value) === 0;
      case 'neq': return cmp(v, r.value) !== 0;
      case 'gt': return isNum(v) && isNum(r.value) ? Number(v) > Number(r.value) : cmp(v, r.value) > 0;
      case 'lt': return isNum(v) && isNum(r.value) ? Number(v) < Number(r.value) : cmp(v, r.value) < 0;
      case 'contains': return String(v ?? '').toLowerCase().includes(String(r.value).toLowerCase());
      case 'yes': return bool(v) || v === 'Yes';
      case 'no': return !(bool(v) || v === 'Yes');
      default: return true;
    }
  }
  function test(cond, ctx) {
    if (!cond || !cond.rules?.length) return true;
    return cond.match === 'any' ? cond.rules.some((r) => testRule(r, ctx)) : cond.rules.every((r) => testRule(r, ctx));
  }

  // ---------- block styles ----------
  const BORDERS = { thin: '0.75pt', medium: '1.5pt', thick: '3pt' };
  function normStyle(s) {
    s = s && typeof s === 'object' ? s : {};
    const o = {};
    if (['left', 'center', 'right', 'justify'].includes(s.align)) o.align = s.align;
    if (s.size !== '' && s.size != null) o.size = num(s.size, 6, 48, undefined);
    if (bool(s.bold)) o.bold = true;
    if (bool(s.italic)) o.italic = true;
    if (bool(s.upper)) o.upper = true;
    if (color(s.color)) o.color = color(s.color);
    if (color(s.bg)) o.bg = color(s.bg);
    if (BORDERS[s.border]) o.border = s.border;
    if (color(s.borderColor)) o.borderColor = color(s.borderColor);
    if (s.radius) o.radius = num(s.radius, 0, 24, 0);
    if (s.pad) o.pad = num(s.pad, 0, 48, 0);
    if (s.mt !== '' && s.mt != null) o.mt = num(s.mt, -24, 144, undefined);
    if (s.mb !== '' && s.mb != null) o.mb = num(s.mb, -24, 144, undefined);
    if (bool(s.keep)) o.keep = true;
    if (s.width) o.width = num(s.width, 10, 100, 100);
    if (['left', 'center', 'right'].includes(s.place)) o.place = s.place;
    if (FONTS[s.font]) o.font = s.font;
    if (s.lh) o.lh = num(s.lh, 0.8, 3, undefined);
    if (s.ls) o.ls = num(s.ls, -3, 30, undefined);
    if (s.opacity !== '' && s.opacity != null && Number(s.opacity) < 100) o.opacity = num(s.opacity, 5, 100, 100);
    if (bool(s.shadow)) o.shadow = true;
    if (bool(s.phoneHide)) o.phoneHide = true;
    // Free position: the block sits wherever it was dragged, measured in points from the top left of the page's content area.
    if (bool(s.free)) {
      o.free = true;
      o.x = num(s.x, -400, 1600, 0);
      o.y = num(s.y, -400, 30000, 0);
      if (s.w) o.w = num(s.w, 8, 1600, undefined);
      if (Number(s.z)) o.z = Math.round(num(s.z, -9, 99, 1));
      if (Number(s.rot)) o.rot = num(s.rot, -180, 180, 0);
    }
    for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
    return o;
  }
  function styleCss(st) {
    const c = [];
    if (st.align) c.push(`text-align:${st.align}`);
    if (st.size) c.push(`font-size:${st.size}pt`);
    if (st.bold) c.push('font-weight:700');
    if (st.italic) c.push('font-style:italic');
    if (st.upper) c.push('text-transform:uppercase;letter-spacing:.04em');
    if (st.color) c.push(`color:${cssColor(st.color)}`);
    if (st.bg) c.push(`background:${cssColor(st.bg)}`);
    if (st.bg === 'accent') c.push('color:#fff');
    if (st.border) c.push(`border:${BORDERS[st.border]} solid ${cssColor(st.borderColor || '#b8c2cc')}`);
    if (st.radius) c.push(`border-radius:${st.radius}pt`);
    if (st.pad) c.push(`padding:${st.pad}pt`);
    else if (st.bg || st.border) c.push('padding:6pt 8pt');
    if (st.mt != null) c.push(`margin-top:${st.mt}pt`);
    if (st.mb != null) c.push(`margin-bottom:${st.mb}pt`);
    if (st.keep) c.push('break-inside:avoid');
    if (st.font) c.push(`font-family:${FONTS[st.font].css}`);
    if (st.lh) c.push(`line-height:${st.lh}`);
    if (st.ls) c.push(`letter-spacing:${st.ls}pt`);
    if (st.opacity) c.push(`opacity:${st.opacity / 100}`);
    if (st.shadow) c.push('box-shadow:0 2pt 9pt rgba(16,24,40,.2)');
    if (st.free) {
      c.push(`position:absolute;left:${st.x}pt;top:${st.y}pt;margin:0;z-index:${st.z || 1}`);
      if (st.w) c.push(`width:${st.w}pt`);
      if (st.rot) c.push(`transform:rotate(${st.rot}deg)`);
      return c.join(';');
    }
    if (st.width && st.width < 100) {
      c.push(`width:${st.width}%`);
      if (st.place === 'right') c.push('margin-left:auto');
      else if (st.place === 'center') c.push('margin-left:auto;margin-right:auto');
    }
    return c.join(';');
  }

  // ---------- lists (tables and repeats) ----------
  function listItems(b, ctx) {
    let items = lookup(b.list, ctx);
    if (!Array.isArray(items)) items = [];
    const sub = { ...ctx, list: b.list };
    if (b.where) items = items.filter((it) => test({ match: b.where.match, rules: b.where.rules.map((r) => ({ ...r, field: `item.${r.field}` })) }, { ...sub, item: it }));
    if (b.sortBy) {
      const t = ctx.types[`${b.list}[].${b.sortBy}`];
      const dir = b.sortDir === 'desc' ? -1 : 1;
      items = items.slice().sort((x, y) => {
        const a = x?.[b.sortBy], c = y?.[b.sortBy];
        if (t === 'money' || t === 'number' || (isNum(a) && isNum(c))) return (Number(a || 0) - Number(c || 0)) * dir;
        return String(a ?? '').localeCompare(String(c ?? ''), 'en', { numeric: true }) * dir;
      });
    }
    if (b.limit) items = items.slice(0, b.limit);
    return items;
  }

  // ---------- the blocks ----------
  const slot = (ctx, b, i, html, cls = '') => (ctx.edit ? `<div class="nv-slot ${cls}" data-slot="${esc(b.id)}:${i}">${html || '<div class="nv-drop-here">Drop blocks here</div>'}</div>` : `<div class="${cls}">${html}</div>`);
  const tableClass = (b) => ['nv-table', `nv-t-${b.border}`, `nv-th-${b.head}`, b.striped ? 'nv-t-striped' : '', b.compact ? 'nv-t-compact' : ''].join(' ');
  const cellAlign = (c) => (c.align && c.align !== 'left' ? ` style="text-align:${c.align}"` : '');

  function cellHtml(col, ctx) {
    if (col.template) return textHtml(col.template, ctx, { chips: false });
    if (!col.field) return '';
    const o = fieldOut(`item.${col.field}`, col.format, ctx);
    if (o.type === 'image') return o.raw ? `<img class="nv-cell-img" src="${esc(o.raw)}" alt="">` : '';
    return valueHtml(o);
  }

  function listTable(b, ctx) {
    const items = listItems(b, ctx);
    const cols = b.columns.length ? b.columns : [{ label: 'Pick columns in the panel', field: '' }];
    const sub = { ...ctx, list: b.list };
    const head = b.head !== 'none' ? `<thead><tr>${cols.map((c) => `<th${cellAlign(c)}${c.width ? ` style="width:${c.width}%${c.align && c.align !== 'left' ? `;text-align:${c.align}` : ''}"` : ''}>${esc(c.label)}</th>`).join('')}</tr></thead>` : '';
    if (ctx.fieldNames) {
      return `<table class="${tableClass(b)}">${head}<tbody><tr>${cols.map((c) => `<td${cellAlign(c)}><span class="nv-chip"><span class="nv-chip-l">${esc(c.template ? 'Custom text' : labelOf(`item.${c.field}`, sub))}</span></span></td>`).join('')}</tr></tbody></table>`;
    }
    if (!items.length) {
      if (!b.empty && !ctx.edit) return '';
      return `<table class="${tableClass(b)}">${head}<tbody><tr><td colspan="${cols.length}" class="nv-empty-row">${esc(b.empty || 'Nothing to list for this record.')}</td></tr></tbody></table>`;
    }
    const sums = (rows) => cols.map((c) => {
      if (!c.total || !c.field) return null;
      if (c.total === 'count') return rows.length;
      return Math.round(rows.reduce((t, it) => t + (Number(it?.[c.field]) || 0), 0) * 1000) / 1000;
    });
    const totalRow = (vals, label, cls) => `<tr class="${cls}">${cols.map((c, i) => {
      const v = vals[i];
      if (v == null) return `<td${cellAlign(c)}>${i === 0 ? esc(label) : ''}</td>`;
      const t = c.total === 'count' ? 'number' : ctx.types[`${b.list}[].${c.field}`];
      return `<td${cellAlign(c)}>${esc(formatValue(v, t, parseFilters(c.format), ctx))}</td>`;
    }).join('')}</tr>`;
    const hasTotals = cols.some((c) => c.total && c.field);
    const cap = ctx.edit && !ctx.fullPreview ? 12 : Infinity;
    const rowHtml = (it, n) => `<tr>${cols.map((c) => `<td${cellAlign(c)}>${cellHtml(c, { ...sub, item: { ...it, _n: n } })}</td>`).join('')}</tr>`;
    let body = '';
    let shown = 0;
    if (b.groupBy) {
      const groups = new Map();
      for (const it of items) {
        const k = String(it?.[b.groupBy] ?? '');
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(it);
      }
      const gType = ctx.types[`${b.list}[].${b.groupBy}`];
      for (const [k, rows] of groups) {
        if (shown >= cap) break;
        const gctx = { ...sub, item: rows[0], group: { value: rows[0]?.[b.groupBy], count: rows.length }, groupType: gType };
        body += `<tr class="nv-group"><td colspan="${cols.length}">${textHtml(b.groupLabel || '{{group.value}}', gctx, { chips: false }) || esc(k || '—')}</td></tr>`;
        rows.forEach((it) => { if (shown++ < cap) body += rowHtml(it, shown); });
        if (b.groupTotals && hasTotals) body += totalRow(sums(rows), `Subtotal`, 'nv-subtotal');
      }
    } else {
      items.forEach((it, i) => { if (i < cap) body += rowHtml(it, i + 1); });
      shown = Math.min(items.length, cap);
    }
    const more = items.length > shown ? `<tr><td colspan="${cols.length}" class="nv-more">+ ${items.length - shown} more row${items.length - shown === 1 ? '' : 's'} (all of them print)</td></tr>` : '';
    const foot = hasTotals ? `<tfoot>${totalRow(sums(items), b.totalLabel || 'Total', 'nv-total')}</tfoot>` : '';
    return `<table class="${tableClass(b)}">${head}<tbody>${body}${more}</tbody>${foot}</table>`;
  }

  function staticTable(b, ctx) {
    const cols = b.columns;
    const head = b.head !== 'none' ? `<thead><tr>${cols.map((c) => `<th${c.width ? ` style="width:${c.width}%${c.align && c.align !== 'left' ? `;text-align:${c.align}` : ''}"` : cellAlign(c)}>${textHtml(c.label, ctx, { chips: false })}</th>`).join('')}</tr></thead>` : '';
    return `<table class="${tableClass(b)}">${head}<tbody>${b.rows.map((r) => `<tr>${cols.map((c, i) => `<td${cellAlign(c)}>${textHtml(r[i] ?? '', ctx, { chips: false })}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  const imgSrc = (b, ctx) => {
    if (b.asset) return ctx.asset ? ctx.asset(b.asset) : '';
    if (b.field) { const v = lookup(b.field, ctx); return typeof v === 'string' && /^(data:image\/|https?:\/\/|\/)/.test(v) ? v : ''; }
    return '';
  };

  const BLOCKS = {
    heading: {
      label: 'Heading', icon: 'H',
      norm: (b) => ({ text: str(b.text, 500), level: pick(Number(b.level), [1, 2, 3], 2) }),
      make: () => ({ text: 'Heading', level: 2 }),
      render: (b, ctx) => `<div class="nv-h nv-h${b.level}" data-edit="text">${textHtml(b.text, ctx) || (ctx.edit ? '<span class="nv-ph">Heading</span>' : '')}</div>`,
    },
    text: {
      label: 'Text', icon: '¶',
      norm: (b) => ({ html: sanitizeRich(b.html) }),
      make: () => ({ html: '<p>Write something here. Use <b>Insert field</b> to add the customer\'s name, a date, or any other detail.</p>' }),
      render: (b, ctx) => `<div class="nv-rich" data-edit="rich">${richHtml(b.html, ctx) || (ctx.edit ? '<p><span class="nv-ph">Type here…</span></p>' : '')}</div>`,
    },
    letterhead: {
      label: 'Letterhead', icon: '🏢',
      norm: (b) => ({
        layout: pick(b.layout, ['split', 'left', 'center', 'band'], 'split'), logo: b.logo !== false && b.logo !== 0, logoH: num(b.logoH, 16, 160, 54),
        name: str(b.name, 300), details: str(b.details, 1500), title: str(b.title, 200), sub: str(b.sub, 1500), rule: b.rule !== false && b.rule !== 0,
      }),
      make: () => ({ layout: 'split', logo: true, logoH: 54, name: '{{company.name}}', details: '{{branch.address}}\n{{company.phone}} · {{company.email}}\nLicense {{company.license_no}}', title: 'Document', sub: '{{today}}', rule: true }),
      render: (b, ctx) => {
        const logo = b.logo && ctx.data?.company?.logo ? `<img class="nv-logo" src="${esc(ctx.data.company.logo)}" alt="" style="height:${b.logoH}pt">`
          : b.logo && ctx.edit ? `<div class="nv-logo nv-logo-ph" style="height:${b.logoH}pt;width:${b.logoH * 1.6}pt">Your logo</div>` : '';
        const ed = (k) => (ctx.edit ? ` data-edit="${k}"` : '');
        const co = `<div class="nv-lh-co">${logo}<div>${b.name ? `<div class="nv-lh-name"${ed('name')}>${textHtml(b.name, ctx)}</div>` : ''}${b.details ? `<div class="nv-lh-det"${ed('details')}>${textHtml(b.details, ctx)}</div>` : ''}</div></div>`;
        const title = b.title || b.sub ? `<div class="nv-lh-title">${b.title ? `<div class="nv-lh-t"${ed('title')}>${textHtml(b.title, ctx)}</div>` : ''}${b.sub ? `<div class="nv-lh-sub"${ed('sub')}>${textHtml(b.sub, ctx)}</div>` : ''}</div>` : '';
        return `<div class="nv-lh nv-lh-${b.layout}${b.rule ? ' nv-lh-rule' : ''}">${co}${title}</div>`;
      },
    },
    fields: {
      label: 'Field list', icon: '☰',
      norm: (b) => ({
        rows: (Array.isArray(b.rows) ? b.rows : []).slice(0, 60).map((r) => ({ label: str(r?.label, 200), value: str(r?.value, 1000), bold: bool(r?.bold), showIf: normRules(r?.showIf) })),
        layout: pick(b.layout, ['rows', 'stacked', 'inline', 'totals'], 'rows'), cols: num(b.cols, 1, 4, 2), labelW: num(b.labelW, 10, 80, 35), hideEmpty: b.hideEmpty !== false && b.hideEmpty !== 0,
      }),
      make: () => ({ layout: 'rows', cols: 2, labelW: 35, hideEmpty: true, rows: [{ label: 'Date', value: '{{today}}' }, { label: 'Prepared by', value: '{{user.name}}' }] }),
      render: (b, ctx) => {
        const rows = b.rows.filter((r) => ctx.edit || test(r.showIf, ctx)).map((r) => ({ ...r, html: textHtml(r.value, ctx), lab: textHtml(r.label, ctx, { chips: false }) }))
          .filter((r) => ctx.edit || !b.hideEmpty || r.html.replace(/<[^>]*>/g, '').trim());
        if (!rows.length) return ctx.edit ? '<div class="nv-ph">Add rows in the panel</div>' : '';
        if (b.layout === 'stacked') return `<div class="nv-kv-grid" style="grid-template-columns:repeat(${b.cols},1fr)">${rows.map((r) => `<div><div class="nv-kv-l">${r.lab}</div><div class="nv-kv-v${r.bold ? ' nv-bold' : ''}">${r.html || '&nbsp;'}</div></div>`).join('')}</div>`;
        if (b.layout === 'inline') return `<div class="nv-kv-inline">${rows.map((r) => `<span><span class="nv-kv-l">${r.lab}${r.lab ? ':' : ''}</span> <span class="${r.bold ? 'nv-bold' : ''}">${r.html}</span></span>`).join('')}</div>`;
        return `<table class="nv-kv${b.layout === 'totals' ? ' nv-kv-totals' : ''}">${rows.map((r) => `<tr class="${r.bold ? 'nv-bold' : ''}"><th style="width:${b.layout === 'totals' ? 'auto' : b.labelW + '%'}">${r.lab}</th><td>${r.html}</td></tr>`).join('')}</table>`;
      },
    },
    table: {
      label: 'Table', icon: '▦',
      norm: (b) => {
        const cols = (Array.isArray(b.columns) ? b.columns : []).slice(0, 16).map((c) => ({
          label: str(c?.label, 120), field: str(c?.field, 80).replace(/[^\w]/g, ''), template: str(c?.template, 500), align: pick(c?.align, ['left', 'center', 'right'], 'left'),
          width: num(c?.width, 0, 100, 0) || undefined, format: str(c?.format, 60).replace(/[^\w:|. -]/g, ''), total: pick(c?.total, ['', 'sum', 'count'], ''),
        }));
        const where = normRules(b.where);
        return {
          list: str(b.list, 80).replace(/[^\w]/g, ''), columns: cols,
          rows: (Array.isArray(b.rows) ? b.rows : []).slice(0, 200).map((r) => (Array.isArray(r) ? r : []).slice(0, 16).map((x) => str(x, 1000))),
          head: pick(b.head, ['line', 'shaded', 'accent', 'none'], 'line'), border: pick(b.border, ['rows', 'grid', 'none', 'outer'], 'rows'),
          striped: bool(b.striped), compact: bool(b.compact), groupBy: str(b.groupBy, 80).replace(/[^\w]/g, ''), groupLabel: str(b.groupLabel, 300), groupTotals: bool(b.groupTotals),
          sortBy: str(b.sortBy, 80).replace(/[^\w]/g, ''), sortDir: pick(b.sortDir, ['asc', 'desc'], 'asc'), limit: num(b.limit, 0, 5000, 0), empty: str(b.empty, 300), totalLabel: str(b.totalLabel, 60),
          where: where ? { match: where.match, rules: where.rules.map((r) => ({ ...r, field: r.field.replace(/^item\./, '') })) } : null,
        };
      },
      make: () => ({ list: '', columns: [{ label: 'Item', template: '' }, { label: 'Details', template: '' }], rows: [['', ''], ['', '']], head: 'line', border: 'grid' }),
      render: (b, ctx) => (b.list ? listTable(b, ctx) : staticTable(b, ctx)),
    },
    columns: {
      label: 'Columns', icon: '▥', container: true,
      norm: (b, kids) => {
        const cols = (Array.isArray(b.cols) && b.cols.length ? b.cols : [{}, {}]).slice(0, 4);
        return { gap: num(b.gap, 0, 72, 18), valign: pick(b.valign, ['start', 'center', 'end'], 'start'), cols: cols.map((c) => ({ w: num(c?.w, 5, 95, Math.round(100 / cols.length)), blocks: kids(c?.blocks) })) };
      },
      make: () => ({ gap: 18, valign: 'start', cols: [{ w: 50, blocks: [] }, { w: 50, blocks: [] }] }),
      slots: (b) => b.cols.map((c) => c.blocks),
      render: (b, ctx) => `<div class="nv-cols" style="grid-template-columns:${b.cols.map((c) => `${c.w}fr`).join(' ')};column-gap:${b.gap}pt;align-items:${b.valign}">${b.cols.map((c, i) => slot(ctx, b, i, renderList(c.blocks, ctx), 'nv-col')).join('')}</div>`,
    },
    section: {
      label: 'Section box', icon: '▢', container: true,
      norm: (b, kids) => ({ title: str(b.title, 300), bar: pick(b.bar, ['bar', 'line', 'plain', 'none'], 'bar'), boxed: b.boxed !== false && b.boxed !== 0, blocks: kids(b.blocks) }),
      make: () => ({ title: 'Section title', bar: 'bar', boxed: true, blocks: [] }),
      slots: (b) => [b.blocks],
      render: (b, ctx) => `<div class="nv-sec${b.boxed ? ' nv-sec-boxed' : ''}">${b.title && b.bar !== 'none' ? `<div class="nv-sec-t nv-sec-${b.bar}"${ctx.edit ? ' data-edit="title"' : ''}>${textHtml(b.title, ctx)}</div>` : ''}${slot(ctx, b, 0, renderList(b.blocks, ctx), 'nv-sec-body')}</div>`,
    },
    repeat: {
      label: 'Repeat for each', icon: '↻', container: true,
      norm: (b, kids) => {
        const where = normRules(b.where);
        return {
          list: str(b.list, 80).replace(/[^\w]/g, ''), between: pick(b.between, ['space', 'line', 'page'], 'line'), sortBy: str(b.sortBy, 80).replace(/[^\w]/g, ''), sortDir: pick(b.sortDir, ['asc', 'desc'], 'asc'),
          limit: num(b.limit, 0, 5000, 0), empty: str(b.empty, 300), blocks: kids(b.blocks),
          where: where ? { match: where.match, rules: where.rules.map((r) => ({ ...r, field: r.field.replace(/^item\./, '') })) } : null,
        };
      },
      make: () => ({ list: '', between: 'line', blocks: [] }),
      slots: (b) => [b.blocks],
      render: (b, ctx) => {
        if (!b.list) return ctx.edit ? `<div class="nv-rep-note">Pick a list in the panel: these blocks print once for each item.</div>${slot(ctx, b, 0, renderList(b.blocks, ctx))}` : '';
        const items = listItems(b, ctx);
        const sub = { ...ctx, list: b.list };
        if (ctx.edit && !ctx.fullPreview) {
          const label = ctx.labels[b.list] || b.list;
          return `<div class="nv-rep-note">↻ Prints once for each <b>${esc(label)}</b> item${items.length ? ` (${items.length} for this record). Showing the first.` : '. This record has none.'}</div>${slot(ctx, b, 0, renderList(b.blocks, { ...sub, item: { ...(items[0] || {}), _n: 1 } }))}`;
        }
        if (!items.length) return b.empty ? `<div class="nv-muted">${esc(b.empty)}</div>` : '';
        return items.map((it, i) => `<div class="nv-rep nv-rep-${b.between}${i ? '' : ' nv-rep-first'}">${renderList(b.blocks, { ...sub, item: { ...it, _n: i + 1 } })}</div>`).join('');
      },
    },
    image: {
      label: 'Image', icon: '🖼',
      norm: (b) => ({ asset: num(b.asset, 1, 1e9, null), field: str(b.field, 120).replace(/[^\w.]/g, ''), w: num(b.w, 5, 100, 40), align: pick(b.align, ['left', 'center', 'right'], 'left'), caption: str(b.caption, 300) }),
      make: () => ({ asset: null, field: 'company.logo', w: 30, align: 'left', caption: '' }),
      render: (b, ctx) => {
        const src = imgSrc(b, ctx);
        if (!src) return ctx.edit ? `<div class="nv-img" style="text-align:${b.align}"><div class="nv-img-ph" style="width:${b.w}%">Image: upload one or pick a field in the panel</div></div>` : '';
        return `<div class="nv-img" style="text-align:${b.align}"><img src="${esc(src)}" alt="" style="width:${b.w}%">${b.caption ? `<div class="nv-cap">${textHtml(b.caption, ctx, { chips: false })}</div>` : ''}</div>`;
      },
    },
    signature: {
      label: 'Signature', icon: '✍',
      norm: (b) => ({
        sigs: (Array.isArray(b.sigs) && b.sigs.length ? b.sigs : [{}]).slice(0, 3).map((s) => ({ label: str(s?.label, 200), image: str(s?.image, 120).replace(/[^\w.]/g, ''), name: str(s?.name, 300), date: str(s?.date, 300) })),
        h: num(b.h, 20, 120, 46),
      }),
      make: () => ({ h: 46, sigs: [{ label: 'Customer signature', image: '', name: '{{customer.name}}', date: '' }] }),
      render: (b, ctx) => `<div class="nv-sigs" style="grid-template-columns:repeat(${b.sigs.length},1fr)">${b.sigs.map((s) => {
        const src = s.image ? lookup(s.image, ctx) : '';
        const img = typeof src === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(src) ? `<img src="${esc(src)}" alt="Signature" style="max-height:${b.h}pt">` : ctx.edit && s.image ? '<span class="nv-ph">Signature appears here</span>' : '';
        const meta = [s.name ? textHtml(s.name, ctx, { chips: false }) : '', s.date ? textHtml(s.date, ctx, { chips: false }) : ''].filter(Boolean).join(' · ');
        return `<div class="nv-sig"><div class="nv-sig-img" style="height:${b.h}pt">${img}</div><div class="nv-sig-line"></div><div class="nv-sig-l">${textHtml(s.label, ctx, { chips: false, multiline: false })}${meta ? ` <span class="nv-sig-m">${meta}</span>` : ''}</div></div>`;
      }).join('')}</div>`,
    },
    qr: {
      label: 'QR code', icon: '▣',
      norm: (b) => ({ value: str(b.value, 500), size: num(b.size, 36, 220, 84), caption: str(b.caption, 300), align: pick(b.align, ['left', 'center', 'right'], 'left') }),
      make: () => ({ value: '{{customer.portal_url}}', size: 84, caption: 'Scan to pay or see your account', align: 'left' }),
      render: (b, ctx) => {
        const text = plain(b.value, ctx).trim();
        const src = text && ctx.qr ? ctx.qr(text) : '';
        if (!src) return ctx.edit ? `<div class="nv-qr" style="text-align:${b.align}"><div class="nv-qr-ph" style="width:${b.size}pt;height:${b.size}pt">QR</div></div>` : '';
        return `<div class="nv-qr" style="text-align:${b.align}"><img src="${esc(src)}" alt="QR code" style="width:${b.size}pt;height:${b.size}pt">${b.caption ? `<div class="nv-cap">${textHtml(b.caption, ctx, { chips: false })}</div>` : ''}</div>`;
      },
    },
    photos: {
      label: 'Photos', icon: '📷',
      norm: (b) => ({ list: str(b.list || 'photos', 80).replace(/[^\w]/g, ''), kinds: (Array.isArray(b.kinds) ? b.kinds : ['before', 'after', 'issue']).filter((k) => ['before', 'after', 'issue'].includes(k)), perRow: num(b.perRow, 1, 6, 3), captions: b.captions !== false && b.captions !== 0, max: num(b.max, 1, 60, 12), empty: str(b.empty, 300) }),
      make: () => ({ list: 'photos', kinds: ['before', 'after', 'issue'], perRow: 3, captions: true, max: 12 }),
      render: (b, ctx) => {
        const all = lookup(b.list, ctx);
        const items = (Array.isArray(all) ? all : []).filter((p) => !p.kind || b.kinds.includes(p.kind)).slice(0, b.max);
        if (!items.length) return b.empty ? `<div class="nv-muted">${esc(b.empty)}</div>` : ctx.edit ? '<div class="nv-ph">Photos from the visit print here</div>' : '';
        return `<div class="nv-photos" style="grid-template-columns:repeat(${b.perRow},1fr)">${items.map((p) => `<figure><img src="${esc(p.src || '')}" alt="">${b.captions && (p.kind_label || p.caption) ? `<figcaption>${p.kind_label ? `<b>${esc(p.kind_label)}</b> ` : ''}${esc(p.caption || '')}</figcaption>` : ''}</figure>`).join('')}</div>`;
      },
    },
    checklist: {
      label: 'Checklist', icon: '☑',
      norm: (b) => ({ items: (Array.isArray(b.items) ? b.items : []).slice(0, 80).map((i) => ({ text: str(i?.text, 300), on: bool(i?.on), field: str(i?.field, 120).replace(/[^\w.]/g, '') })), cols: num(b.cols, 1, 4, 1) }),
      make: () => ({ cols: 2, items: [{ text: 'Standing water' }, { text: 'Wood-to-soil contact' }, { text: 'Gaps around pipes or doors' }, { text: 'Mulch against the foundation' }] }),
      render: (b, ctx) => `<ul class="nv-check" style="columns:${b.cols}">${b.items.map((i) => {
        const on = i.field ? !isEmpty(lookup(i.field, ctx)) && lookup(i.field, ctx) !== 0 && lookup(i.field, ctx) !== '0' : i.on;
        return `<li><span class="nv-cb${on ? ' on' : ''}"></span>${textHtml(i.text, ctx, { chips: false })}</li>`;
      }).join('')}</ul>`,
    },
    stamp: {
      label: 'Stamp', icon: '⬭',
      norm: (b) => ({ text: str(b.text, 60), tone: pick(b.tone, ['green', 'red', 'amber', 'gray', 'accent'], 'green'), place: pick(b.place, ['corner', 'inline'], 'corner') }),
      make: () => ({ text: 'PAID', tone: 'green', place: 'corner' }),
      render: (b, ctx) => `<div class="nv-stamp nv-stamp-${b.tone} nv-stamp-${b.place}"${ctx.edit ? ' data-edit="text"' : ''}>${textHtml(b.text, ctx)}</div>`,
    },
    divider: {
      label: 'Divider', icon: '—',
      norm: (b) => ({ line: pick(b.line, ['solid', 'dashed', 'dotted', 'double'], 'solid'), weight: num(b.weight, 0.5, 6, 1), color: color(b.color, '') }),
      make: () => ({ line: 'solid', weight: 1, color: '' }),
      render: (b) => `<hr class="nv-hr" style="border-top:${b.line === 'double' ? Math.max(3, b.weight * 3) : b.weight}pt ${b.line} ${b.color ? cssColor(b.color) : 'var(--nv-line)'}">`,
    },
    spacer: {
      label: 'Space', icon: '↕',
      norm: (b) => ({ h: num(b.h, 2, 400, 16) }),
      make: () => ({ h: 16 }),
      render: (b, ctx) => `<div class="nv-space${ctx.edit ? ' nv-space-edit' : ''}" style="height:${b.h}pt"></div>`,
    },
    pagebreak: {
      label: 'Page break', icon: '⤓',
      norm: () => ({}),
      make: () => ({}),
      render: (_b, ctx) => (ctx.edit ? '<div class="nv-pb-edit">Page break: what follows starts on a new page</div>' : '<div class="nv-pb"></div>'),
    },
    // ---------- contracts ----------
    // A place for someone to sign or initial. Sent for signing, the customer's spots become "Sign here" flags on the
    // link; once signed they hold the signature. Printed on paper, they are blank lines to sign by hand.
    sign: {
      label: 'Signature spot', icon: '✍',
      norm: (b) => ({
        who: pick(b.who, ['customer', 'company'], 'customer'), mark: pick(b.mark, ['signature', 'initials'], 'signature'), label: str(b.label, 200),
        required: b.required !== false && b.required !== 0, name: b.name !== false && b.name !== 0, date: b.date !== false && b.date !== 0, h: num(b.h, 16, 140, 40),
      }),
      make: () => ({ who: 'customer', mark: 'signature', label: 'Customer signature', required: true, name: true, date: true, h: 40 }),
      render: (b, ctx) => signHtml(b, ctx),
    },
    // Something the customer fills in while signing: a line of text, a date, a box to tick, or one choice from a few.
    input: {
      label: 'Fill-in field', icon: '✎',
      norm: (b) => ({
        kind: pick(b.kind, ['text', 'date', 'check', 'choice'], 'text'), label: str(b.label, 2000), required: bool(b.required), ph: str(b.ph, 120),
        lines: num(b.lines, 1, 8, 1), options: (Array.isArray(b.options) ? b.options : []).slice(0, 12).map((o) => str(o, 120).trim()).filter(Boolean),
      }),
      make: () => ({ kind: 'text', label: 'Gate code or how to get in', required: false, ph: '', lines: 1, options: [] }),
      render: (b, ctx) => inputHtml(b, ctx),
    },
    logo: {
      label: 'Logo', icon: '◎',
      norm: (b) => ({ asset: num(b.asset, 1, 1e9, null), h: num(b.h, 10, 500, 54) }),
      make: () => ({ asset: null, h: 54 }),
      render: (b, ctx) => {
        const src = b.asset ? (ctx.asset ? ctx.asset(b.asset) : '') : ctx.data?.company?.logo;
        if (!src) return ctx.edit ? `<div class="nv-logo-ph" style="height:${b.h}pt;width:${Math.round(b.h * 1.8)}pt">Your logo</div>` : '';
        return `<img class="nv-logo-img" src="${esc(src)}" alt="${esc(ctx.data?.company?.name || 'Logo')}" style="height:${b.h}pt">`;
      },
    },
    shape: {
      label: 'Shape', icon: '◼',
      norm: (b) => ({
        kind: pick(b.kind, ['rect', 'ellipse', 'line'], 'rect'), fill: color(b.fill, ''), stroke: color(b.stroke, ''), sw: num(b.sw, 0, 16, 0), radius: num(b.radius, 0, 300, 0),
        h: num(b.h, 1, 2000, 60), text: str(b.text, 1000), tcolor: color(b.tcolor, ''), tsize: num(b.tsize, 0, 96, 0),
        align: pick(b.align, ['left', 'center', 'right'], 'center'), valign: pick(b.valign, ['start', 'center', 'end'], 'center'),
      }),
      make: () => ({ kind: 'rect', fill: 'accent-soft', stroke: '', sw: 0, radius: 6, h: 60, text: '' }),
      render: (b, ctx) => {
        if (b.kind === 'line') return `<div class="nv-shape-line" style="border-top:${Math.max(0.5, b.sw || 1.5)}pt solid ${b.stroke ? cssColor(b.stroke) : 'var(--nv-accent)'}"></div>`;
        const css = [`height:${b.h}pt`, `background:${b.fill ? cssColor(b.fill) : 'transparent'}`, `border-radius:${b.kind === 'ellipse' ? '50%' : `${b.radius}pt`}`,
          b.sw ? `border:${b.sw}pt solid ${b.stroke ? cssColor(b.stroke) : 'var(--nv-accent)'}` : '', `align-items:${b.valign === 'start' ? 'flex-start' : b.valign === 'end' ? 'flex-end' : 'center'}`,
          `justify-content:${b.align === 'left' ? 'flex-start' : b.align === 'right' ? 'flex-end' : 'center'}`, `text-align:${b.align}`,
          b.tcolor ? `color:${cssColor(b.tcolor)}` : b.fill === 'accent' ? 'color:#fff' : '', b.tsize ? `font-size:${b.tsize}pt` : ''].filter(Boolean).join(';');
        const text = b.text || ctx.edit ? `<div class="nv-shape-t"${ctx.edit ? ' data-edit="text"' : ''}>${textHtml(b.text, ctx)}</div>` : '';
        return `<div class="nv-shape" style="${css}">${text}</div>`;
      },
    },
  };

  // ---------- signing ----------
  // ctx.sign is null on paper (blank lines to sign by hand). Sent for signing it is
  // { state: 'open' | 'signed', customer: { name, signature, initials, date }, company: {...}, values: { blockId: value } }.
  const WHO = { customer: 'Customer', company: 'Company' };
  const openFor = (ctx) => !ctx.edit && !ctx.item && ctx.sign?.state === 'open';
  function signHtml(b, ctx) {
    const ini = b.mark === 'initials';
    const skipped = ctx.sign?.values?.[b.id] === false;
    const s = !ctx.item && ctx.sign && !skipped ? ctx.sign[b.who] : null;
    const img = s ? (ini ? s.initials : s.signature) : '';
    const signed = typeof img === 'string' && /^data:image\/png;base64,/.test(img);
    const open = !signed && openFor(ctx) && b.who === 'customer';
    let box = '';
    if (ctx.edit) box = `<span class="nv-sg-tag nv-sg-${b.who}">✍ ${WHO[b.who]} ${ini ? 'initials' : 'signs'} here${b.required ? '' : ' (optional)'}</span>`;
    else if (signed) box = `<img src="${esc(img)}" alt="${ini ? 'Initials' : 'Signature'} of ${esc(s.name || '')}">`;
    else if (open) box = `<span class="nv-sg-flag">${ini ? 'Initial' : 'Sign'} here${b.required ? '' : ' (optional)'}</span>`;
    const label = textHtml(b.label, ctx, { chips: false, multiline: false });
    const blank = '<span class="nv-blank"></span>';
    const date = !b.date ? '' : signed ? `<span class="nv-sg-d">${esc(s.date || '')}</span>` : ctx.edit ? '<span class="nv-sg-d">Date signed</span>' : `<span class="nv-sg-d">Date ${blank}</span>`;
    const name = ini || !b.name ? '' : signed ? `<div class="nv-sg-n">${esc(s.name || '')}<span class="nv-sg-e"> · signed electronically</span></div>`
      : ctx.edit ? '<div class="nv-sg-n nv-muted">Printed name</div>' : `<div class="nv-sg-n">Printed name ${blank}</div>`;
    const spot = open ? ` data-spot="${esc(b.id)}" data-mark="${b.mark}"${b.required ? ' data-req="1"' : ''}` : '';
    return `<div class="nv-sg nv-sg-${ini ? 'ini' : 'sig'}${open ? ' nv-sg-open' : ''}${signed ? ' nv-sg-done' : ''}"${spot}><div class="nv-sg-box" style="height:${b.h}pt">${box}</div>`
      + `<div class="nv-sg-line"></div><div class="nv-sg-l"><span>${label}</span>${date}</div>${name}</div>`;
  }
  function inputHtml(b, ctx) {
    const v = ctx.sign?.values ? ctx.sign.values[b.id] : undefined;
    const open = openFor(ctx);
    const spot = open ? ` data-spot="${esc(b.id)}" data-kind="${b.kind}"${b.required ? ' data-req="1"' : ''}${b.ph ? ` data-ph="${esc(b.ph)}"` : ''} data-lines="${b.lines}"` : '';
    const lab = textHtml(b.label, ctx);
    const ed = ctx.edit ? ' data-edit="label"' : '';
    const cls = `nv-in nv-in-${b.kind}${open ? ' nv-in-open' : ''}`;
    if (b.kind === 'check') {
      const on = v === true || v === 'true' || v === 1;
      return `<div class="${cls}"${spot}><span class="nv-cb${on ? ' on' : ''}"></span><div class="nv-in-ct"${ed}>${lab || (ctx.edit ? '<span class="nv-ph">I agree to…</span>' : '')}</div></div>`;
    }
    const head = lab || ctx.edit ? `<div class="nv-in-l"${ed}>${lab || '<span class="nv-ph">Label</span>'}</div>` : '';
    if (b.kind === 'choice') {
      const opts = b.options.length ? b.options : ctx.edit ? ['Option 1', 'Option 2'] : [];
      return `<div class="${cls}"${spot}>${head}<div class="nv-in-opts">${opts.map((o) => `<span class="nv-in-opt${v === o ? ' on' : ''}" data-opt="${esc(o)}"><span class="nv-rb"></span>${esc(o)}</span>`).join('')}</div></div>`;
    }
    const val = v != null && v !== '' ? (b.kind === 'date' ? fmtDate(v, ctx.dateFormat) : String(v)) : '';
    const tag = ctx.edit ? `<span class="nv-in-tag">✎ Customer fills in${b.kind === 'date' ? ' a date' : ''}${b.ph ? `: ${esc(b.ph)}` : ''}${b.required ? '' : ' (optional)'}</span>` : '';
    return `<div class="${cls}"${spot}>${head}<div class="nv-in-v" style="min-height:${(b.lines * 1.45).toFixed(2)}em">${val ? esc(val).replace(/\n/g, '<br>') : tag}</div></div>`;
  }
  const TYPES = Object.keys(BLOCKS);

  // ---------- normalizing a design (runs on every save, server side too) ----------
  const MAX_BLOCKS = 800;
  function normBlocks(list, depth, seen, count) {
    if (!Array.isArray(list) || depth > 5) return [];
    const out = [];
    for (const raw of list) {
      if (!raw || typeof raw !== 'object' || !BLOCKS[raw.type]) continue;
      if (++count.n > MAX_BLOCKS) break;
      let id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(raw.id) ? raw.id : newId();
      if (seen.has(id)) id = newId();
      seen.add(id);
      const def = BLOCKS[raw.type];
      const kids = (l) => normBlocks(l, depth + 1, seen, count);
      const b = { id, type: raw.type, ...def.norm(raw, kids) };
      const st = normStyle(raw.style);
      // Only top-level blocks can sit freely on the page; inside columns and boxes they stay in line.
      if (depth > 0 && st.free) for (const k of ['free', 'x', 'y', 'w', 'z', 'rot']) delete st[k];
      if (Object.keys(st).length) b.style = st;
      const cond = normRules(raw.showIf);
      if (cond) b.showIf = cond;
      if (raw.note) b.note = str(raw.note, 200);
      out.push(b);
    }
    return out;
  }
  const normSlots = (s) => ({ left: str(s?.left, 300), center: str(s?.center, 300), right: str(s?.right, 300) });
  function normalize(input) {
    let d = input;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = {}; } }
    d = d && typeof d === 'object' ? d : {};
    const p = d.page || {};
    const m = p.margin || {};
    const wm = d.watermark || {};
    return {
      v: 1,
      page: {
        size: pick(p.size, Object.keys(PAGE_SIZES), 'letter'), orientation: pick(p.orientation, ['portrait', 'landscape'], 'portrait'),
        margin: { t: num(m.t, 0, 2, 0.6), r: num(m.r, 0, 2, 0.6), b: num(m.b, 0, 2, 0.7), l: num(m.l, 0, 2, 0.6) },
        font: pick(p.font, Object.keys(FONTS), 'sans'), fontSize: num(p.fontSize, 6, 16, 10), lineHeight: num(p.lineHeight, 1, 2.2, 1.4),
        color: color(p.color, '#1a202c'), accent: color(p.accent, '') || '', dateFormat: pick(p.dateFormat, Object.keys(DATE_FORMATS), 'medium'),
        bg: color(p.bg, ''), bgImg: num(p.bgImg, 1, 1e9, null), bgFade: num(p.bgFade, 0, 95, 0),
        frame: pick(p.frame, ['', ...Object.keys(FRAMES)], ''), frameColor: color(p.frameColor, ''),
      },
      header: normSlots(d.header), footer: normSlots(d.footer),
      watermark: { text: str(wm.text, 40), showIf: normRules(wm.showIf), color: color(wm.color, '#c53030') },
      email: {
        subject: str(d.email?.subject, 300), message: str(d.email?.message, 5000), button: str(d.email?.button, 60),
        color: color(d.email?.color, ''), logo: d.email?.logo !== false && d.email?.logo !== 0, footer: str(d.email?.footer, 300),
      },
      // How a contract is signed: days the customer has to cancel (0 = none), e-sign consent, the signing certificate, link life.
      sign: {
        cancelDays: num(d.sign?.cancelDays, 0, 30, 0), consent: d.sign?.consent !== false && d.sign?.consent !== 0,
        certificate: d.sign?.certificate !== false && d.sign?.certificate !== 0, expires: num(d.sign?.expires, 0, 365, 30),
      },
      blocks: normBlocks(d.blocks, 0, new Set(), { n: 0 }),
    };
  }

  // Walks every block, including those inside columns, sections and repeats.
  function walk(blocks, fn, parent = null, slotIndex = 0) {
    (blocks || []).forEach((b, i) => {
      fn(b, { parent, list: blocks, index: i, slot: slotIndex });
      const def = BLOCKS[b.type];
      if (def?.slots) def.slots(b).forEach((kids, si) => walk(kids, fn, b, si));
    });
  }
  function find(blocks, id) {
    let hit = null;
    walk(blocks, (b, where) => { if (!hit && b.id === id) hit = { block: b, ...where }; });
    return hit;
  }

  // ---------- rendering ----------
  function renderBlock(b, ctx) {
    const def = BLOCKS[b.type];
    if (!def) return '';
    const shown = test(b.showIf, ctx);
    if (!shown && !ctx.edit) return '';
    let inner;
    try { inner = def.render(b, ctx); } catch (e) { inner = ctx.edit ? `<div class="nv-ph">This block could not be drawn: ${esc(e.message)}</div>` : ''; }
    if (!inner && !ctx.edit) return '';
    const st = b.style ? styleCss(b.style) : '';
    const st0 = b.style || {};
    const cls = `nv-b nv-b-${b.type}${!shown ? ' nv-cond-off' : ''}${st0.keep ? ' nv-keep' : ''}${st0.free ? ' nv-free' : ''}${st0.free && st0.z < 0 ? ' nv-behind' : ''}${st0.phoneHide ? ' nv-phone-hide' : ''}`;
    return `<div class="${cls}"${ctx.edit ? ` data-bid="${esc(b.id)}" data-type="${b.type}"` : ''}${st ? ` style="${esc(st)}"` : ''}>${inner}</div>`;
  }
  function renderList(blocks, ctx) { return (blocks || []).map((b) => renderBlock(b, ctx)).join(''); }

  function makeCtx(design, data, opts = {}) {
    return {
      data: data || {}, types: opts.types || {}, labels: opts.labels || {}, dateFormat: design.page.dateFormat,
      edit: Boolean(opts.edit), fieldNames: Boolean(opts.fieldNames), fullPreview: Boolean(opts.fullPreview),
      asset: opts.asset || null, qr: opts.qr || null, item: null, list: null, group: null, sign: opts.sign || null,
    };
  }
  const accentOf = (design, data) => design.page.accent || color(data?.company?.brand_color, '') || '#2f855a';
  function rootStyle(design, data) {
    const p = design.page;
    const acc = accentOf(design, data);
    return `--nv-accent:${acc};--nv-accent-soft:${tint(acc)};--nv-accent-mid:${tint(acc, 0.7)};font-family:${FONTS[p.font].css};font-size:${p.fontSize}pt;line-height:${p.lineHeight};color:${p.color}`;
  }

  // The document body. In the builder (opts.edit) blocks carry ids for clicking and dragging.
  function render(designIn, data, opts = {}) {
    const design = opts.normalized ? designIn : normalize(designIn);
    const ctx = makeCtx(design, data, opts);
    const wm = design.watermark.text && (ctx.edit || test(design.watermark.showIf, ctx)) ? `<div class="nv-wm" style="color:${design.watermark.color}">${esc(plain(design.watermark.text, ctx))}</div>` : '';
    return `<div class="nvdoc" style="${esc(rootStyle(design, data))}">${wm}${renderList(design.blocks, ctx)}</div>`;
  }

  // Running header and footer on every printed page, with page numbers. Uses CSS page margin boxes.
  const cssString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\A ').replace(/</g, '\\3c ').replace(/>/g, '\\3e ').replace(/[\u0000-\u001f]/g, '')}"`;
  function marginContent(tpl, ctx) {
    const parts = [];
    String(plain(tpl, { ...ctx, edit: false })).split(/(\{\{\s*pages?\s*\}\})/).forEach((seg) => {
      if (/^\{\{\s*page\s*\}\}$/.test(seg)) parts.push('counter(page)');
      else if (/^\{\{\s*pages\s*\}\}$/.test(seg)) parts.push('counter(pages)');
      else if (seg) parts.push(cssString(seg));
    });
    return parts.length ? parts.join(' ') : null;
  }
  // Fields work in headers and footers too, but {{page}} and {{pages}} must survive until the browser numbers the pages.
  const keepPageTokens = (data) => ({ ...data, page: '{{page}}', pages: '{{pages}}' });
  // The page's own look: a background color or picture, and a border on every page.
  // Brand colors are spelled out because @page can't read the document's CSS variables.
  function pageLook(design, data, opts = {}) {
    const p = design.page;
    const acc = accentOf(design, data);
    const real = (c) => (c === 'accent' ? acc : c === 'accent-soft' ? tint(acc) : c);
    const src = p.bgImg && opts.asset ? String(opts.asset(p.bgImg) || '') : '';
    const fade = p.bgFade ? `linear-gradient(rgba(255,255,255,${p.bgFade / 100}),rgba(255,255,255,${p.bgFade / 100})),` : '';
    const img = /^(data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+|\/nuvolve\/app\/api\/docs\/assets\/\d+|https?:\/\/[^\s"'()\\]+)$/.test(src) ? `${fade}url("${src}") center/cover no-repeat` : '';
    const bg = img ? `${img}${p.bg ? ` ${real(p.bg)}` : ''}` : p.bg ? real(p.bg) : '';
    const f = FRAMES[p.frame];
    return { bg, frame: f ? `${f[0]}pt ${f[1]} ${real(p.frameColor || 'accent')}` : '', frameW: f ? f[0] : 0 };
  }
  // Space from the paper's edge to the writing, in CSS pixels: the margins, plus the gap inside a page border.
  function insets(designIn) {
    const p = (designIn.page ? designIn : normalize(designIn)).page;
    const f = FRAMES[p.frame];
    const extra = f ? ((FRAME_GAP + f[0]) * 96) / 72 : 0;
    return { t: p.margin.t * 96 + extra, r: p.margin.r * 96 + extra, b: p.margin.b * 96 + extra, l: p.margin.l * 96 + extra };
  }
  function pageCss(designIn, data, opts = {}) {
    const design = opts.normalized ? designIn : normalize(designIn);
    const p = design.page;
    const size = PAGE_SIZES[p.size];
    const [w, h] = p.orientation === 'landscape' ? [size.h, size.w] : [size.w, size.h];
    const ctx = makeCtx(design, keepPageTokens(data), opts);
    const box = (name, tpl, align) => {
      const c = tpl ? marginContent(tpl, ctx) : null;
      return c ? `@${name}{content:${c};font-family:${FONTS[p.font].css};font-size:${Math.max(6.5, p.fontSize - 2)}pt;color:#5f6b7a;text-align:${align};white-space:pre-wrap;vertical-align:${name.startsWith('top') ? 'bottom' : 'top'};padding:${name.startsWith('top') ? '0 0 6pt' : '6pt 0 0'}}` : '';
    };
    const look = pageLook(design, data, opts);
    return `@page{size:${w}in ${h}in;margin:${p.margin.t}in ${p.margin.r}in ${p.margin.b}in ${p.margin.l}in;`
      + (look.bg ? `background:${look.bg};` : '') + (look.frame ? `border:${look.frame};padding:${FRAME_GAP}pt;` : '')
      + box('top-left', design.header.left, 'left') + box('top-center', design.header.center, 'center') + box('top-right', design.header.right, 'right')
      + box('bottom-left', design.footer.left, 'left') + box('bottom-center', design.footer.center, 'center') + box('bottom-right', design.footer.right, 'right') + '}';
  }
  // Header and footer text for the builder canvas, which can't use page margin boxes.
  function marginPreview(designIn, data, opts = {}) {
    const design = opts.normalized ? designIn : normalize(designIn);
    const ctx = makeCtx(design, { ...data, page: '1', pages: '2' }, { ...opts, edit: false });
    const row = (s) => ['left', 'center', 'right'].map((k) => esc(plain(s[k], ctx)).replace(/\n/g, '<br>'));
    return { header: row(design.header), footer: row(design.footer) };
  }

  // A whole standalone HTML page: for PDFs, share links and emails. Everything is inline so it never changes later.
  function page(designIn, data, opts = {}) {
    const design = normalize(designIn);
    const o = { ...opts, edit: false, normalized: true };
    const body = render(design, data, o);
    const p = design.page;
    const size = PAGE_SIZES[p.size];
    const [w] = p.orientation === 'landscape' ? [size.h] : [size.w];
    const csp = opts.locked ? '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; font-src data:">' : '';
    const look = pageLook(design, data, o);
    const ins = insets(design);
    // On a screen narrower than the paper (a phone), the page reflows: columns stack and blocks placed freely fall into line.
    const screen = `@media screen{html{background:#e9edf0}body{margin:0;padding:24px 12px 48px}.nv-sheet{position:relative;box-sizing:border-box;background:${look.bg || '#fff'};width:${w}in;max-width:100%;margin:0 auto;padding:${ins.t}px ${ins.r}px ${ins.b}px ${ins.l}px;box-shadow:0 2px 12px rgba(16,24,40,.12);border-radius:4px}`
      + (look.frame ? `.nv-sheet::before{content:"";position:absolute;inset:${p.margin.t}in ${p.margin.r}in ${p.margin.b}in ${p.margin.l}in;border:${look.frame};pointer-events:none}` : '')
      + `@media (max-width:${w}in){body{padding:0}.nv-bar{margin:0 0 12px!important}.nv-sheet{padding:20px 16px;border-radius:0;box-shadow:none;overflow-wrap:break-word}.nv-sheet img{max-width:100%}.nv-lh{flex-wrap:wrap}.nv-lh>*{min-width:0}.nv-sheet::before{display:none}.nv-cols{display:block!important}.nv-col+.nv-col{margin-top:10pt}`
      + '.nv-free{position:static!important;transform:none!important;width:auto!important;max-width:100%;margin:0 0 9pt!important}.nv-behind,.nv-phone-hide{display:none!important}}}'
      + '@media print{body{margin:0}.nv-sheet{padding:0;width:auto;background:none}.nv-sheet::before{display:none}.nv-noprint{display:none!important}}';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">${csp}<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">`
      + `<title>${esc(opts.title || 'Document')}</title><style>${BASE_CSS}${pageCss(design, data, o)}${screen}</style>${opts.head || ''}</head>`
      + `<body${opts.bodyAttrs || ''}>${opts.toolbar || ''}<div class="nv-sheet">${body}${opts.after || ''}</div>${opts.foot || ''}</body></html>`;
  }

  // The customer's spots on a contract sent for signing, in page order. Hidden blocks and repeats are skipped.
  function signSpots(designIn, data, opts = {}) {
    const design = opts.normalized ? designIn : normalize(designIn);
    const ctx = makeCtx(design, data, opts);
    const out = [];
    const visit = (blocks) => (blocks || []).forEach((b) => {
      if (!test(b.showIf, ctx) || b.type === 'repeat') return;
      if (b.type === 'sign') out.push({ id: b.id, type: 'sign', who: b.who, mark: b.mark, required: b.required, label: plain(b.label, ctx).slice(0, 200) });
      else if (b.type === 'input') {
        out.push({ id: b.id, type: 'input', who: 'customer', kind: b.kind, required: b.required, label: plain(b.label, ctx).slice(0, 600), options: b.options, lines: b.lines, ph: b.ph });
      }
      const def = BLOCKS[b.type];
      if (def.slots) def.slots(b).forEach(visit);
    });
    visit(design.blocks);
    return out;
  }
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'];
  const numberWord = (n) => WORDS[n] || String(n);
  const NTH = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth'];
  const ordinalWord = (n) => NTH[n] || `${n}th`;

  // ---------- business days (shared with src/esign.js) ----------
  // The FTC Cooling-Off Rule (16 CFR 429) counts business days as every day except Sundays and federal holidays.
  // Both the holiday itself and its observed weekday are skipped, so a customer never gets fewer days than the law allows.
  const ymdUtc = (d) => d.toISOString().slice(0, 10);
  const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
  const nthWeekday = (y, m, wd, n) => { const f = utc(y, m, 1); return utc(y, m, 1 + ((wd - f.getUTCDay() + 7) % 7) + (n - 1) * 7); };
  const lastWeekday = (y, m, wd) => { const l = utc(y, m + 1, 0); return utc(y, m, l.getUTCDate() - ((l.getUTCDay() - wd + 7) % 7)); };
  const holidayCache = new Map();
  function federalHolidays(y) {
    if (holidayCache.has(y)) return holidayCache.get(y);
    const fixed = [utc(y, 1, 1), utc(y, 6, 19), utc(y, 7, 4), utc(y, 11, 11), utc(y, 12, 25)];
    const days = [
      ...fixed,
      nthWeekday(y, 1, 1, 3), // Martin Luther King Jr. Day
      nthWeekday(y, 2, 1, 3), // Washington's Birthday
      lastWeekday(y, 5, 1), // Memorial Day
      nthWeekday(y, 9, 1, 1), // Labor Day
      nthWeekday(y, 10, 1, 2), // Columbus Day
      nthWeekday(y, 11, 4, 4), // Thanksgiving
    ];
    // Observed days: a Saturday holiday is observed Friday, a Sunday holiday on Monday.
    for (const d of fixed) {
      if (d.getUTCDay() === 6) days.push(new Date(d.getTime() - 86400000));
      if (d.getUTCDay() === 0) days.push(new Date(d.getTime() + 86400000));
    }
    // New Year's Day on a Saturday is observed on Dec 31 of the year before.
    if (utc(y + 1, 1, 1).getUTCDay() === 6) days.push(utc(y, 12, 31));
    const set = new Set(days.map(ymdUtc));
    holidayCache.set(y, set);
    return set;
  }
  const isBusinessDay = (d) => d.getUTCDay() !== 0 && !federalHolidays(d.getUTCFullYear()).has(ymdUtc(d));
  // The last day to cancel: `n` business days after the day of the sale, counting from the next day.
  function addBusinessDays(dateStr, n) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
    if (!m || !(n > 0)) return null;
    const d = utc(Number(m[1]), Number(m[2]), Number(m[3]));
    let left = n;
    while (left > 0) {
      d.setUTCDate(d.getUTCDate() + 1);
      if (isBusinessDay(d)) left--;
    }
    return ymdUtc(d);
  }

  // The email that carries a document. The builder previews this exact layout, so what you see is what they get.
  function email(o = {}) {
    const co = o.company || {};
    const col = color(o.color, '') || '#2f855a';
    const head = o.logo ? `<img src="${esc(o.logo)}" alt="${esc(co.name || '')}" style="max-height:52px;max-width:220px;display:block;margin:0 0 16px">`
      : `<div style="font-weight:700;font-size:17px;margin-bottom:14px">${esc(co.name || '')}</div>`;
    const foot = o.footer || [co.name, co.phone, co.email].filter(Boolean).join(' · ');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.subject || o.title || '')}</title></head>`
      + '<body style="margin:0;background:#f3f5f4;padding:24px 12px;font:15px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#1a202c">'
      + `<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;padding:24px 26px;border:1px solid #e2e8f0">${head}`
      + `<div>${esc(o.message || '').replace(/\n/g, '<br>')}</div>`
      + (o.link ? `<p style="margin:22px 0"><a href="${esc(o.link)}" style="display:inline-block;background:${col};color:#fff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:8px">${esc(o.button || `View ${o.title || 'document'}`)}</a></p>` : '')
      + (o.pdf ? '<p style="color:#5f6b7a;font-size:13px">A PDF copy is attached.</p>' : '')
      + `</div><p style="text-align:center;color:#8a96a3;font-size:12px;margin-top:14px">${esc(foot)}</p></body></html>`;
  }

  // Plain text with fields filled in, for email subjects and messages.
  function fill(designIn, text, data, opts = {}) {
    const design = opts.normalized ? designIn : normalize(designIn);
    // A dropped line leaves its blank neighbours behind, so squeeze runs of blank lines.
    return plain(text, makeCtx(design, data, { ...opts, edit: false })).replace(/\n[ \t]*(?:\n[ \t]*){2,}/g, '\n\n').trim();
  }

  // Columns a table or a repeat can list from, flattened for a CSV download.
  function tableRows(designIn, data, opts = {}) {
    const design = normalize(designIn);
    const ctx = makeCtx(design, data, opts);
    let t = null;
    walk(design.blocks, (b) => { if (!t && b.type === 'table' && b.list && (!opts.blockId || b.id === opts.blockId)) t = b; });
    if (!t) return null;
    const items = listItems(t, ctx);
    const sub = { ...ctx, list: t.list };
    const header = t.columns.map((c) => c.label || c.field);
    const rows = items.map((it, i) => t.columns.map((c) => {
      const ictx = { ...sub, item: { ...it, _n: i + 1 } };
      if (c.template) return plain(c.template, ictx);
      if (!c.field) return '';
      const o = fieldOut(`item.${c.field}`, c.format, ictx);
      return o.type === 'image' ? '' : o.text;
    }));
    return { list: t.list, header, rows };
  }

  // ---------- shared styles ----------
  const BASE_CSS = `
.nvdoc{position:relative;isolation:isolate;-webkit-print-color-adjust:exact;print-color-adjust:exact;overflow-wrap:break-word;--nv-line:#d5dce3;--nv-muted:#5f6b7a;text-align:left}
.nvdoc *{box-sizing:border-box}
.nvdoc p{margin:0 0 .5em}.nvdoc p:last-child{margin-bottom:0}
.nvdoc ul,.nvdoc ol{margin:0 0 .5em;padding-left:1.4em}.nvdoc li{margin:0 0 .15em}
.nvdoc blockquote{margin:0 0 .5em;padding:2pt 0 2pt 10pt;border-left:2.5pt solid var(--nv-accent);color:var(--nv-muted)}
.nvdoc h4{font-size:1.05em;margin:.6em 0 .25em}
.nvdoc a{color:var(--nv-accent);text-decoration:none}
.nvdoc img{max-width:100%}
.nvdoc table{border-collapse:collapse}
.nv-b{margin:0 0 9pt}
.nv-b:last-child{margin-bottom:0}
.nv-keep{break-inside:avoid}
.nv-bold{font-weight:700}
.nv-muted{color:var(--nv-muted)}
.nv-h{font-weight:700;line-height:1.2}
.nv-h1{font-size:2.1em;letter-spacing:-.01em}
.nv-h2{font-size:1.45em;color:var(--nv-accent)}
.nv-h3{font-size:.92em;text-transform:uppercase;letter-spacing:.06em;color:var(--nv-muted)}
.nv-lh{display:flex;justify-content:space-between;align-items:flex-start;gap:18pt}
.nv-lh-rule{border-bottom:2.5pt solid var(--nv-accent);padding-bottom:10pt}
.nv-lh-co{display:flex;gap:12pt;align-items:flex-start}
.nv-logo{display:block;max-width:220pt;object-fit:contain}
.nv-lh-name{font-size:1.55em;font-weight:700;line-height:1.15;margin-bottom:2pt}
.nv-lh-det{font-size:.9em;color:var(--nv-muted);line-height:1.4}
.nv-lh-title{text-align:right}
.nv-lh-t{font-size:2em;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--nv-accent);line-height:1.1}
.nv-lh-sub{font-size:.95em;margin-top:3pt;line-height:1.45}
.nv-lh-left{flex-direction:column;gap:8pt}.nv-lh-left .nv-lh-title{text-align:left}
.nv-lh-center{flex-direction:column;align-items:center;text-align:center;gap:6pt}.nv-lh-center .nv-lh-co{flex-direction:column;align-items:center}.nv-lh-center .nv-lh-title{text-align:center}
.nv-lh-band{background:var(--nv-accent);color:#fff;padding:14pt 16pt;border-radius:3pt;border-bottom:0}
.nv-lh-band .nv-lh-det,.nv-lh-band .nv-lh-t{color:#fff}.nv-lh-band .nv-lh-det{opacity:.88}
.nv-kv{width:100%;border-collapse:collapse}
.nv-kv th{font-weight:600;color:var(--nv-muted);text-align:left;padding:2pt 10pt 2pt 0;vertical-align:top}
.nv-kv td{padding:2pt 0;vertical-align:top}
.nv-kv tr.nv-bold th,.nv-kv tr.nv-bold td{color:inherit;font-weight:700}
.nv-kv-totals{width:auto;min-width:46%;margin-left:auto}
.nv-kv-totals th{text-align:left;font-weight:500;color:inherit;padding:3pt 18pt 3pt 0}
.nv-kv-totals td{text-align:right;padding:3pt 0;white-space:nowrap}
.nv-kv-totals tr:last-child th,.nv-kv-totals tr:last-child td{border-top:1.5pt solid currentColor;padding-top:5pt;font-weight:800;font-size:1.12em}
.nv-kv-grid{display:grid;gap:7pt 14pt}
.nv-kv-l{font-size:.78em;text-transform:uppercase;letter-spacing:.05em;color:var(--nv-muted);font-weight:600}
.nv-kv-v{margin-top:1pt}
.nv-kv-inline{display:flex;flex-wrap:wrap;gap:3pt 16pt}
.nv-kv-inline .nv-kv-l{font-size:inherit;text-transform:none;letter-spacing:0}
.nv-table{width:100%;border-collapse:collapse;font-size:.95em}
.nv-table th{text-align:left;font-weight:700;font-size:.82em;text-transform:uppercase;letter-spacing:.04em;padding:5pt 6pt;vertical-align:bottom}
.nv-table td{padding:5pt 6pt;vertical-align:top}
.nv-table thead{display:table-header-group}
.nv-table tr{break-inside:avoid}
.nv-th-line th{border-bottom:1.5pt solid var(--nv-accent);color:var(--nv-muted)}
.nv-th-shaded th{background:var(--nv-accent-soft);color:inherit}
.nv-th-accent th{background:var(--nv-accent);color:#fff}
.nv-t-rows td{border-bottom:.75pt solid var(--nv-line)}
.nv-t-grid th,.nv-t-grid td{border:.75pt solid #9aa6b2}
.nv-t-outer{border:.75pt solid #9aa6b2}
.nv-t-striped tbody tr:nth-child(even) td{background:#f5f7f9}
.nv-t-compact th,.nv-t-compact td{padding:2.5pt 4pt}
.nv-table tfoot td,.nv-subtotal td{font-weight:700;border-top:1.25pt solid currentColor}
.nv-subtotal td{background:#fafbfc}
.nv-group td{background:var(--nv-accent-soft);font-weight:700;padding-top:4pt;padding-bottom:4pt}
.nv-empty-row{color:var(--nv-muted);font-style:italic;text-align:center}
.nv-more{color:var(--nv-muted);font-style:italic;text-align:center;font-size:.9em}
.nv-cell-img{max-height:36pt;max-width:120pt;display:block}
.nv-cols{display:grid}
.nv-col{min-width:0}
.nv-sec-t{break-after:avoid}
.nv-sec-boxed{border:.75pt solid #b8c2cc;border-radius:3pt}
.nv-sec-boxed>.nv-sec-body,.nv-sec-boxed>div:last-child{padding:7pt 9pt}
.nv-sec-t{font-weight:700;font-size:.85em;text-transform:uppercase;letter-spacing:.05em}
.nv-sec-bar{background:var(--nv-accent-soft);padding:4pt 9pt;border-bottom:.75pt solid var(--nv-accent-mid)}
.nv-sec:not(.nv-sec-boxed)>.nv-sec-bar{border-radius:2pt;margin-bottom:6pt}
.nv-sec-line{border-bottom:1.5pt solid var(--nv-accent);padding:0 0 3pt;margin:0 0 6pt}
.nv-sec-boxed>.nv-sec-line{margin:7pt 9pt 0}
.nv-sec-plain{padding:0 0 4pt;color:var(--nv-muted)}
.nv-sec-boxed>.nv-sec-plain{padding:7pt 9pt 0}
.nv-rep{break-inside:avoid}
.nv-rep-line:not(.nv-rep-first){border-top:.75pt solid var(--nv-line);padding-top:9pt;margin-top:9pt}
.nv-rep-space:not(.nv-rep-first){margin-top:14pt}
.nv-rep-page:not(.nv-rep-first){break-before:page}
.nv-img img{display:inline-block;height:auto}
.nv-cap{font-size:.85em;color:var(--nv-muted);margin-top:3pt}
.nv-qr img{display:inline-block}
.nv-sigs{display:grid;gap:22pt;break-inside:avoid}
.nv-sig-img{display:flex;align-items:flex-end}
.nv-sig-img img{display:block;max-width:100%}
.nv-sig-line{border-bottom:1pt solid currentColor;margin-top:2pt}
.nv-sig-l{font-size:.85em;color:var(--nv-muted);margin-top:3pt}
.nv-sig-m{color:var(--nv-ink,inherit)}
.nv-photos{display:grid;gap:8pt}
.nv-photos figure{margin:0;break-inside:avoid}
.nv-photos img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:2pt;display:block;background:#eef1f4}
.nv-photos figcaption{font-size:.82em;margin-top:2pt;color:var(--nv-muted)}
.nv-check{list-style:none;padding:0;margin:0;column-gap:18pt}
.nv-check li{display:flex;gap:6pt;align-items:flex-start;break-inside:avoid;margin-bottom:3pt}
.nv-cb{flex:0 0 auto;width:9pt;height:9pt;border:1pt solid currentColor;border-radius:1.5pt;margin-top:.2em;position:relative}
.nv-cb.on::after{content:"";position:absolute;left:2.4pt;top:.3pt;width:2.6pt;height:5.4pt;border:solid currentColor;border-width:0 1.4pt 1.4pt 0;transform:rotate(45deg)}
.nv-stamp{display:inline-block;padding:3pt 12pt;border:2.5pt solid;border-radius:5pt;font-weight:900;letter-spacing:.12em;text-transform:uppercase;font-size:1.25em;line-height:1.3}
.nv-stamp-corner{position:absolute;top:2pt;right:0;transform:rotate(-8deg);z-index:2;opacity:.85}.nv-stamp-inline{transform:rotate(-6deg);margin:4pt 0;opacity:.9}
.nv-stamp-green{color:#276749}.nv-stamp-red{color:#c53030}.nv-stamp-amber{color:#b7791f}.nv-stamp-gray{color:#718096}.nv-stamp-accent{color:var(--nv-accent)}
.nv-hr{border:0;margin:0}
.nv-pb{break-after:page;height:0}
.nv-wm{position:fixed;left:0;right:0;top:42%;text-align:center;font-size:76pt;font-weight:900;letter-spacing:.08em;opacity:.09;transform:rotate(-24deg);pointer-events:none;z-index:0;text-transform:uppercase}
.nv-free{margin:0}
.nv-logo-img{display:block;max-width:100%;object-fit:contain}
.nv-free>.nv-logo-img{height:auto!important;width:100%}
.nv-shape{display:flex;overflow:hidden;padding:4pt 8pt}
.nv-shape-t{min-width:1em;max-width:100%}
.nv-shape-line{height:0}
.nv-sg{break-inside:avoid;min-width:0}
.nv-sg-ini{display:inline-block;width:92pt;vertical-align:bottom}
.nv-sg-box{display:flex;align-items:flex-end}
.nv-sg-box img{display:block;max-height:100%;max-width:100%}
.nv-sg-line{border-bottom:1pt solid currentColor}
.nv-sg-l{display:flex;justify-content:space-between;gap:8pt;font-size:.85em;color:var(--nv-muted);margin-top:3pt}
.nv-sg-n{font-size:.85em;margin-top:2pt}
.nv-sg-e{color:var(--nv-muted);font-size:.9em}
.nv-blank{display:inline-block;min-width:80pt;border-bottom:.75pt solid currentColor;vertical-align:baseline}
.nv-sg-flag{display:inline-flex;align-items:center;gap:4pt;background:#fde047;color:#5b3a06;border-radius:3pt;padding:2pt 9pt 2pt 7pt;margin:0 0 3pt;font:700 9pt/1.4 Arial,Helvetica,sans-serif;letter-spacing:.02em}
.nv-sg-flag::before{content:"\\270D"}
.nv-in-l{font-size:.85em;color:var(--nv-muted);margin-bottom:2pt}
.nv-in-v{border-bottom:.75pt solid currentColor;padding:1pt 2pt}
.nv-in-check{display:flex;gap:7pt;align-items:flex-start}
.nv-in-check .nv-cb{margin-top:.22em}
.nv-in-ct{flex:1;min-width:0}
.nv-in-opts{display:flex;flex-wrap:wrap;gap:4pt 16pt}
.nv-in-opt{display:inline-flex;gap:5pt;align-items:center}
.nv-rb{width:9pt;height:9pt;border:1pt solid currentColor;border-radius:50%;display:inline-block;position:relative;flex:0 0 auto}
.nv-in-opt.on .nv-rb::after{content:"";position:absolute;inset:1.6pt;border-radius:50%;background:currentColor}
.nv-in-open .nv-in-v{background:#fefce8}
.nv-in-open.nv-in-check .nv-cb,.nv-in-open .nv-rb{background:#fefce8;box-shadow:0 0 0 2pt #fde047}
.nv-cert{break-before:page;font:9pt/1.45 Arial,Helvetica,sans-serif;color:#1a202c}
.nv-cert h2{font-size:14pt;margin:0 0 4pt}
.nv-cert table{width:100%;border-collapse:collapse;margin:8pt 0}
.nv-cert th,.nv-cert td{text-align:left;vertical-align:top;padding:4pt 6pt;border-bottom:.75pt solid #d5dce3}
.nv-cert th{width:30%;color:#5f6b7a;font-weight:600}
.nv-cert .mono{font-family:"Courier New",monospace;font-size:8pt;word-break:break-all}
.nv-cert img{max-height:36pt;max-width:180pt;display:block}
@media print{.nv-sg-flag{visibility:hidden}.nv-in-open .nv-in-v,.nv-in-open.nv-in-check .nv-cb,.nv-in-open .nv-rb{background:none;box-shadow:none}}
`;

  return {
    render, page, pageCss, marginPreview, normalize, fill, sanitizeRich, tableRows, test, normRules, walk, find, newId, clone, plain, textHtml,
    formatValue, fmtDate, fmtMoney, lookup, color, tint, accentOf, rootStyle, pageLook, insets, signSpots, numberWord, ordinalWord, email,
    addBusinessDays, federalHolidays, isBusinessDay,
    BLOCKS, TYPES, PAGE_SIZES, FONTS, FRAMES, DATE_FORMATS, OPS, BASE_CSS, TOKEN,
  };
}));
