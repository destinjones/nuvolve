// What a visitor adds or changes in the static demo, kept in their own browser. demo/sw.js keeps this state
// in IndexedDB, sends each save through write(), and lays the changes over the recorded answers on the way
// out with patch(), so the real screens show them without a server. The rules mirror src/services.js
// (plan visits, completing a stop, invoices, payments) closely enough for a demo. No browser APIs in here,
// so test/demosave.test.js runs the same code in Node.
(function (root) {
  'use strict';
  const FORMAT = 1; // bump when the saved state changes shape; old state is then dropped
  const TYPES = ['customers', 'properties', 'plans', 'visits', 'invoices', 'payments', 'requests', 'photos'];

  // ---------- helpers ----------
  const round2 = (n) => Math.round(n * 100) / 100;
  const num = (v, d = null) => (v === '' || v == null || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? d : Number(v));
  const clip = (v, n = 200) => (v == null || v === '' ? null : String(v).slice(0, n));
  const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const day = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const addDays = (s, n) => { const d = day(s); d.setDate(d.getDate() + n); return ymd(d); };
  function addMonths(s, n) {
    const d = day(s);
    const dd = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(dd, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return ymd(d);
  }
  const FREQ = { monthly: 1, bimonthly: 2, quarterly: 3, yearly: 12, one_time: 0 };
  const fail = (error, status = 400) => Object.assign(new Error(error), { status });
  // SQLite puts NULL first and compares text byte by byte; merged lists keep the server's order.
  const cmp = (a, b) => (a === b ? 0 : a == null ? -1 : b == null ? 1 : a < b ? -1 : 1);
  const by = (...keys) => (a, b) => {
    for (const k of keys) {
      const desc = k[0] === '-';
      const r = cmp(a[desc ? k.slice(1) : k], b[desc ? k.slice(1) : k]);
      if (r) return desc ? -r : r;
    }
    return 0;
  };
  const nameOf = (c) => (c.type === 'commercial' && c.company) || `${c.first_name || ''} ${c.last_name || ''}`.trim();
  const scalars = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v === null || typeof v !== 'object'));
  // "YYYY-MM-DD HH:MM:SS" in UTC, the way SQLite stamps rows.
  const stamp = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  // A time the phone sent, kept only when it's close to now (same rule as the server's phoneTime).
  function phoneTime(ctx, at) {
    const t = Date.parse(at || '');
    return stamp(Number.isFinite(t) && Math.abs(t - ctx.now) < 3 * 86400000 ? t : ctx.now);
  }
  const shortDate = (s) => day(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const longDate = (s) => (isDay(String(s).slice(0, 10)) ? day(String(s).slice(0, 10)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');
  const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // An empty copy of a recorded row or answer: the same keys with nothing filled in, so screens that read
  // fields other features added still find them. Answers get zeros and falses; rows get nulls.
  function blank(like, answer = false) {
    if (Array.isArray(like)) return [];
    const o = {};
    for (const [k, v] of Object.entries(like || {})) {
      if (Array.isArray(v)) o[k] = [];
      else if (v && typeof v === 'object') o[k] = blank(v, answer);
      else if (answer && typeof v === 'number' && !/(^id|_id|lat|lng)$/.test(k)) o[k] = 0;
      else if (answer && typeof v === 'boolean') o[k] = false;
      else o[k] = null;
    }
    return o;
  }

  // ---------- state ----------
  const version = (data) => `${FORMAT}|${data}`;
  function fresh(v) {
    const rows = {};
    for (const t of TYPES) rows[t] = {};
    return { v, n: 0, seq: {}, rows, gone: [], keys: {} };
  }
  // Each record is { row, set, loc }: row is the recorded row (null for something added here), set holds
  // what changed, loc is the customer's branch for branch-filtered screens.
  const cur = (rec) => (rec && !rec.del ? { ...rec.row, ...rec.set } : null);
  function nextId(st, ctx, t) {
    st.seq[t] = Math.max(st.seq[t] || 0, ((ctx.index || {}).max || {})[t] || 0) + 1;
    return st.seq[t];
  }
  function add(st, ctx, t, row, loc) {
    ctx.memo.clear();
    st.rows[t][row.id] = { row: null, set: row, loc: loc ?? null };
    return row;
  }
  const NOT_FOUND = { customers: 'Customer not found', properties: 'Address not found', plans: 'Plan not found', visits: 'Visit not found',
    invoices: 'Invoice not found', requests: 'Request not found', photos: 'Photo not found' };
  // The overlay record for something that may only exist in the recording; made on first change.
  function touch(st, ctx, t, id) {
    id = Number(id);
    ctx.memo.clear();
    const have = st.rows[t][id];
    if (have) { if (have.del) throw fail(NOT_FOUND[t], 404); return have; }
    const found = recorded(ctx, t, id);
    if (!found) throw fail(NOT_FOUND[t], 404);
    return (st.rows[t][id] = { row: found.row, set: {}, loc: found.loc ?? null });
  }
  const detail = (ctx, cid) => (cid ? ctx.find(`GET /api/customers/${cid}`) : null);
  const owner = (ctx, kind, id) => (((ctx.index || {}).of || {})[kind] || {})[id];
  // The recorded row for an id, found through its customer's page.
  function recorded(ctx, t, id) {
    if (t === 'customers') {
      const d = detail(ctx, id);
      return d && d.id ? { row: scalars(d), loc: d.location_id } : null;
    }
    if (t === 'photos') {
      const vid = owner(ctx, 'photos', id);
      const v = vid && ctx.find(`GET /api/visits/${vid}`);
      const p = v && (v.photos || []).find((x) => x.id === id);
      return p ? { row: { ...p, visit_id: vid, customer_id: v.customer_id }, loc: v.location_id } : null;
    }
    const cid = owner(ctx, t, id);
    const d = detail(ctx, cid);
    const row = d && (d[t] || []).find((x) => x.id === id);
    if (row) return { row: scalars(row), loc: d.location_id };
    if (t === 'visits') {
      const v = ctx.find(`GET /api/visits/${id}`);
      if (v && v.id) return { row: scalars(v), loc: v.location_id };
    }
    return null;
  }
  // Current rows, with this browser's changes laid over the recording.
  function customerNow(st, ctx, cid) {
    cid = Number(cid);
    const k = `c${cid}`;
    if (ctx.memo.has(k)) return ctx.memo.get(k);
    const rec = st.rows.customers[cid];
    let c = null;
    if (rec) c = cur(rec);
    else { const d = detail(ctx, cid); if (d && d.id) c = scalars(d); }
    ctx.memo.set(k, c);
    return c;
  }
  function rowNow(st, ctx, t, id) {
    id = Number(id);
    const rec = st.rows[t][id];
    if (rec) return rec.del ? null : { ...rec.row, ...rec.set, id };
    const found = recorded(ctx, t, id);
    return found ? found.row : null;
  }
  // Everything one customer has, recorded rows merged with the ones changed or added here.
  function merged(st, ctx, cid, d) {
    cid = Number(cid);
    const k = `m${cid}`;
    if (!d && ctx.memo.has(k)) return ctx.memo.get(k);
    const base = d || detail(ctx, cid) || {};
    const out = {};
    for (const t of ['properties', 'plans', 'visits', 'invoices', 'payments', 'requests']) {
      out[t] = mergeRows(st, ctx, t, base[t] || [], (x) => x.customer_id === cid);
    }
    if (!d) ctx.memo.set(k, out);
    return out;
  }
  // Recorded rows with changes applied (dropped when they no longer belong, per keep), plus rows changed or
  // added here that now belong. fill shapes an added row like the list's own rows.
  function mergeRows(st, ctx, t, rows, keep, fill) {
    const recs = st.rows[t];
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      seen.add(String(r.id));
      const rec = recs[r.id];
      if (!rec) { out.push(r); continue; }
      if (rec.del) continue;
      const x = derive(ctx, { ...r, ...rec.set }, r);
      if (keep(x, rec)) out.push(x);
    }
    for (const id of Object.keys(recs)) {
      const rec = recs[id];
      if (seen.has(id) || rec.del) continue;
      const x = { ...rec.row, ...rec.set, id: Number(id) };
      if (keep(x, rec)) out.push(fill ? fill(x) : x);
    }
    return out;
  }
  const techOf = (ctx, id) => {
    if (id == null) return null;
    const t = ((ctx.index || {}).techs || {})[id];
    if (t) return { id: Number(id), name: t[0], color: t[1], location_id: t[2], license_no: t[3] };
    return ((ctx.boot || {}).techs || []).find((x) => x.id === Number(id)) || (ctx.me && ctx.me.id === Number(id) ? ctx.me : null);
  };
  const serviceName = (ctx, id) => {
    if (id == null) return null;
    const s = ((ctx.boot || {}).serviceTypes || []).find((x) => x.id === Number(id));
    return s ? s.name : (((ctx.index || {}).services || {})[id] || null);
  };
  const locations = (ctx) => ((ctx.boot || {}).locations && ctx.boot.locations.length ? ctx.boot.locations : ((ctx.index || {}).locations || []));
  const locName = (ctx, id) => (locations(ctx).find((l) => l.id === Number(id)) || {}).name || null;
  const settings = (ctx) => ({ ...((ctx.index || {}).settings || {}), ...((ctx.boot || {}).settings || {}) });
  // A row's names follow its ids when a change moved it to another tech or service.
  function derive(ctx, x, like) {
    if ('tech_name' in like) x.tech_name = (techOf(ctx, x.tech_id) || {}).name || null;
    if ('tech_color' in like) x.tech_color = (techOf(ctx, x.tech_id) || {}).color || null;
    if ('service_name' in like && 'service_type_id' in x) x.service_name = serviceName(ctx, x.service_type_id);
    return x;
  }
  // Branch-filtered screens (the branch picker, or a manager's own branch) only count that branch.
  const scopeOf = (ctx) => num(ctx.loc) || num((ctx.me || {}).location_id);
  const inScope = (ctx, rec) => { const s = scopeOf(ctx); return !s || rec == null || rec.loc == null || Number(rec.loc) === s; };
  const balanceOf = (mm) => round2(mm.invoices.filter((i) => i.status !== 'void').reduce((t, i) => t + Number(i.amount || 0), 0)
    - mm.payments.reduce((t, p) => t + Number(p.amount || 0), 0));
  const nextVisit = (ctx, visits, plan) => visits.filter((v) => v.status === 'scheduled' && v.date >= ctx.today && (plan == null || v.plan_id === plan))
    .reduce((m, v) => (m == null || v.date < m ? v.date : m), null);
  const changedVisitsOf = (st, cid) => Object.values(st.rows.visits).some((r) => cur(r) ? cur(r).customer_id === cid : (r.row || {}).customer_id === cid);
  // The columns the server joins onto a visit (customer, address, service, tech), for rows added here.
  function joined(st, ctx, v) {
    const c = customerNow(st, ctx, v.customer_id) || {};
    const p = rowNow(st, ctx, 'properties', v.property_id) || {};
    const t = techOf(ctx, v.tech_id);
    return {
      customer_name: nameOf(c), first_name: c.first_name ?? null, last_name: c.last_name ?? null, company: c.company ?? null, phone: c.phone ?? null,
      email: c.email ?? null, customer_type: c.type ?? null, location_id: c.location_id ?? null, customer_notes: c.notes ?? null,
      address: p.address ?? null, city: p.city ?? null, state: p.state ?? null, zip: p.zip ?? null, lat: p.lat ?? null, lng: p.lng ?? null,
      access_notes: p.access_notes ?? null, photo_id: p.photo_id ?? null,
      service_name: serviceName(ctx, v.service_type_id), tech_name: t ? t.name : null, tech_color: t ? t.color : null,
    };
  }
  function shaped(like, x, extra) {
    if (!like) return { ...x, ...extra };
    const out = { ...blank(like), ...x };
    for (const k of Object.keys(extra)) if (k in like) out[k] = extra[k];
    return out;
  }
  const visitRow = (st, ctx, v, like) => shaped(like, v, joined(st, ctx, v));
  const routeOrder = (a, b) => (a.route_order ?? 9999) - (b.route_order ?? 9999) || cmp(a.zip, b.zip) || a.id - b.id;

  // ---------- the rules, as the server runs them ----------
  const VISIT = ['customer_id', 'property_id', 'plan_id', 'service_type_id', 'tech_id', 'date', 'time_window', 'route_order', 'status', 'price', 'office_notes',
    'tech_notes', 'target_pests', 'areas_serviced', 'signature', 'customer_present', 'completed_at', 'completed_by', 'created_at', 'started_at', 'track_token',
    'omw_at', 'omw_eta', 'weather', 'reminded_at', 'internal_notes', 'merge_id'];
  function newVisitRow(st, ctx, fields, loc) {
    const v = Object.fromEntries(VISIT.map((k) => [k, null]));
    Object.assign(v, { id: nextId(st, ctx, 'visits'), status: 'scheduled', created_at: stamp(ctx.now) }, fields);
    return add(st, ctx, 'visits', v, loc);
  }
  // Plan visits land on work days (Monday to Friday unless Settings say otherwise), never in the past.
  function workDay(ctx, s) {
    const days = new Set(String(settings(ctx).work_days || '1,2,3,4,5').split(',').map((x) => Number(x.trim())).filter((n) => n >= 0 && n <= 6));
    if (!days.size) [1, 2, 3, 4, 5].forEach((n) => days.add(n));
    if (days.has(day(s).getDay())) return s;
    for (let k = 1; k <= 6; k++) {
      const back = addDays(s, -k);
      if (days.has(day(back).getDay()) && back >= ctx.today) return back;
      const ahead = addDays(s, k);
      if (days.has(day(ahead).getDay())) return ahead;
    }
    return s;
  }
  function addPlan(st, ctx, b, loc) {
    const pl = add(st, ctx, 'plans', {
      id: nextId(st, ctx, 'plans'), customer_id: Number(b.customer_id), property_id: Number(b.property_id), service_type_id: num(b.service_type_id),
      frequency: b.frequency in FREQ ? b.frequency : 'quarterly', price: num(b.price, 0), tech_id: num(b.tech_id), start_date: isDay(b.start_date) ? b.start_date : ctx.today,
      active: 1, notes: clip(b.notes, 2000), created_at: stamp(ctx.now), cancelled_at: null,
      initial_price: b.initial_price === '' || b.initial_price == null ? null : num(b.initial_price), initial_service_type_id: num(b.initial_service_type_id), merge_id: null,
    }, loc);
    const visit = (date, first) => {
      const initial = first && pl.initial_price != null;
      newVisitRow(st, ctx, { customer_id: pl.customer_id, property_id: pl.property_id, plan_id: pl.id, tech_id: pl.tech_id, date,
        service_type_id: initial ? pl.initial_service_type_id || pl.service_type_id : pl.service_type_id, price: initial ? pl.initial_price : pl.price }, loc);
    };
    const step = FREQ[pl.frequency];
    if (step === 0) visit(pl.start_date, true);
    else {
      const horizon = addMonths(ctx.today, 12);
      for (let i = 0, date = pl.start_date; date <= horizon && i < 60; date = addMonths(pl.start_date, ++i * step)) visit(workDay(ctx, date), i === 0);
    }
    return pl;
  }
  function customerLoc(st, ctx, cid) { const c = customerNow(st, ctx, cid); return c ? c.location_id ?? null : null; }
  // Which branch a new customer belongs to: the user's own, the one picked, the branch filter, the address's
  // service area, then the main branch.
  function branchFor(ctx, b) {
    const own = num((ctx.me || {}).location_id) || num(b.location_id) || num(ctx.loc);
    if (own) return own;
    const locs = locations(ctx);
    const zip = String((b.property || {}).zip || '').trim().slice(0, 5);
    const byZip = zip && locs.find((l) => String(l.service_zips || '').split(/[\s,]+/).includes(zip));
    return (byZip || locs.find((l) => l.is_default) || locs[0] || {}).id ?? null;
  }
  function createInvoice(st, ctx, { customerId, visitId, description, amount, date, taxable = true }) {
    const s = settings(ctx);
    const d = date || ctx.today;
    const subtotal = round2(Number(amount));
    const c = customerNow(st, ctx, customerId) || {};
    const rate = taxable && !c.tax_exempt ? Math.max(0, parseFloat(s.tax_rate) || 0) : 0;
    const tax = round2(subtotal * rate / 100);
    return add(st, ctx, 'invoices', {
      id: nextId(st, ctx, 'invoices'), customer_id: Number(customerId), visit_id: visitId || null, description: clip(description, 300) || 'Pest control service',
      date: d, due_date: addDays(d, parseInt(s.payment_terms_days || '0', 10) || 0), amount: round2(subtotal + tax), amount_paid: 0, status: 'open',
      created_at: stamp(ctx.now), reminders_sent: 0, last_reminder_at: null, subtotal, tax, tax_rate: rate, merge_id: null,
    }, customerLoc(st, ctx, customerId)).id;
  }
  // With an invoice it goes there first; the rest pays the oldest open invoices.
  function recordPayment(st, ctx, { customerId, amount, method, reference, invoiceId, date, tip = 0 }) {
    amount = round2(Number(amount));
    if (!(amount > 0)) throw fail('Payment amount must be more than $0');
    const cid = Number(customerId);
    const open = merged(st, ctx, cid).invoices.filter((i) => i.status === 'open').sort(by('date', 'id'));
    const targets = [...(invoiceId ? open.filter((i) => i.id === Number(invoiceId)) : []), ...open];
    const seen = new Set();
    let left = amount, first = null;
    for (const inv of targets) {
      if (seen.has(inv.id) || left <= 0) continue;
      seen.add(inv.id);
      const apply = Math.min(round2(inv.amount - inv.amount_paid), left);
      if (apply <= 0) continue;
      const rec = st.rows.invoices[inv.id] || touch(st, ctx, 'invoices', inv.id);
      const paid = round2((cur(rec).amount_paid || 0) + apply);
      Object.assign(rec.set, { amount_paid: paid, status: paid + 0.005 >= cur(rec).amount ? 'paid' : 'open' });
      first = first || inv.id;
      left = round2(left - apply);
    }
    return add(st, ctx, 'payments', {
      id: nextId(st, ctx, 'payments'), customer_id: cid, invoice_id: num(invoiceId) || first, amount, method: clip(method, 40) || 'cash',
      reference: clip(reference, 120), date: isDay(date) ? date : ctx.today, created_at: stamp(ctx.now), tip: round2(Number(tip) || 0), tip_tech_id: null, merge_id: null,
    }, customerLoc(st, ctx, cid)).id;
  }
  function chargeCard(st, ctx, cid, invoiceId) {
    const c = customerNow(st, ctx, cid);
    const inv = rowNow(st, ctx, 'invoices', invoiceId);
    if (!c || !inv || inv.status !== 'open' || !c.card_last4) return { charged: false, reason: 'No card on file' };
    const amount = round2(inv.amount - inv.amount_paid);
    if (amount <= 0) return { charged: false, reason: 'Nothing due' };
    recordPayment(st, ctx, { customerId: cid, amount, method: 'autopay', reference: `demo ${c.card_brand || 'card'} ••${c.card_last4}`, invoiceId: inv.id });
    return { charged: true, amount, demo: true };
  }
  const visitNow = (st, ctx, id) => { const v = rowNow(st, ctx, 'visits', id); if (!v) throw fail('Visit not found', 404); return v; };
  function ownStop(ctx, v) {
    if (ctx.role === 'tech' && v.tech_id !== (ctx.me || {}).id && v.completed_by !== (ctx.me || {}).id) throw fail('Not your stop', 403);
  }
  function planVisits(st, ctx, pl) {
    return merged(st, ctx, pl.customer_id).visits.filter((v) => v.plan_id === pl.id && v.status === 'scheduled' && v.date >= ctx.today);
  }
  function photoList(st, ctx, vid) {
    const rec = (ctx.find(`GET /api/visits/${vid}`) || {}).photos || [];
    const mine = Object.values(st.rows.photos).map(cur).filter((p) => p && p.visit_id === Number(vid));
    const seen = new Set(mine.map((p) => p.id));
    return [...rec.filter((p) => !st.gone.includes(p.id) && !seen.has(p.id)), ...mine]
      .map((p) => ({ id: p.id, kind: p.kind, caption: p.caption ?? null, bytes: p.bytes ?? null, user_id: p.user_id ?? null, created_at: p.created_at ?? null }))
      .sort(by('id'));
  }
  function portalCustomer(st, ctx, token) {
    const cid = ((ctx.index || {}).tokens || {})[token] || Object.values(st.rows.customers).map(cur).filter(Boolean).find((c) => c.portal_token === token)?.id;
    const c = cid && customerNow(st, ctx, cid);
    if (!c) throw fail('This link has expired. Ask us for a new one.', 404);
    return c;
  }
  // Keys the screens may send that only this file sets.
  const LOCKED = new Set(['id', 'portal_token', 'stripe_customer_id', 'stripe_payment_method', 'created_at', 'merge_id', 'card_brand', 'card_last4', 'card_failed_at',
    'balance', 'name', 'location', 'device_count', 'customer_id', 'property_id', 'plan_id', 'tech_id', 'date', 'status', 'route_order', 'track_token', 'completed_by',
    'completed_at', 'price', 'signature', 'started_at', 'omw_at']);
  // Extra plain fields that feature modules put on the form (NV.collect) ride along, so their screens show them.
  function extras(b, skip) {
    const out = {};
    for (const [k, v] of Object.entries(b || {})) {
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(k) || LOCKED.has(k) || skip.includes(k) || (v !== null && typeof v === 'object')) continue;
      out[k] = typeof v === 'string' ? v.slice(0, 2000) : v;
    }
    return out;
  }

  // ---------- writes ----------
  const CUSTOMER_EDIT = ['first_name', 'last_name', 'company', 'email', 'phone', 'billing_address', 'type', 'source', 'notes', 'status', 'autopay', 'cancel_reason',
    'tax_exempt', 'lang', 'location_id'];
  const PHOTO_KINDS = ['before', 'after', 'issue', 'property'];
  const DEVICE_STATUSES = ['ok', 'activity', 'captured', 'bait_replaced', 'damaged', 'missing', 'inaccessible'];
  const WRITES = [
    ['POST', /^\/api\/customers$/, (st, ctx, m, b) => {
      if (!b.first_name && !b.last_name && !b.company) throw fail('Add a name or company');
      const loc = branchFor(ctx, b);
      const id = nextId(st, ctx, 'customers');
      const c = {
        id, first_name: clip(b.first_name, 80), last_name: clip(b.last_name, 80), company: clip(b.company, 120), email: clip(b.email, 160), phone: clip(b.phone, 40),
        billing_address: clip(b.billing_address, 300), type: b.type === 'commercial' ? 'commercial' : 'residential', source: clip(b.source, 80), notes: clip(b.notes, 4000),
        status: ['active', 'lead', 'inactive'].includes(b.status) ? b.status : 'active', autopay: 0, card_brand: null, card_last4: null, stripe_customer_id: null,
        stripe_payment_method: null, portal_token: `demo.${id}`, created_at: stamp(ctx.now), lang: b.lang === 'es' ? 'es' : null, location_id: loc, cancel_reason: null,
        tax_exempt: 0, card_failed_at: null, merge_id: null, referral_code: clip(b.referral_code, 40), marketing_opt_out: 0,
      };
      add(st, ctx, 'customers', { ...extras(b, ['property', 'plan', 'referral_code', ...Object.keys(c)]), ...c }, loc);
      const p = b.property || {};
      if (p.address) {
        const pid = add(st, ctx, 'properties', { id: nextId(st, ctx, 'properties'), customer_id: id, address: clip(p.address, 200), city: clip(p.city, 80), state: clip(p.state, 20),
          zip: clip(p.zip, 10), lat: num(p.lat), lng: num(p.lng), access_notes: clip(p.access_notes, 2000), created_at: stamp(ctx.now), photo_id: null,
          site_name: clip(p.site_name, 120), site_contact: clip(p.site_contact, 120), site_phone: clip(p.site_phone, 120), merge_id: null }, loc).id;
        if (b.plan && b.plan.frequency) addPlan(st, ctx, { ...b.plan, customer_id: id, property_id: pid }, loc);
      }
      return { id, location_id: loc };
    }],
    ['PUT', /^\/api\/customers\/(\d+)$/, (st, ctx, m, b) => {
      const rec = touch(st, ctx, 'customers', m[1]);
      const set = extras(b, []);
      for (const k of CUSTOMER_EDIT) if (k in b && !(k in set)) set[k] = b[k];
      for (const k of Object.keys(set)) if (set[k] === '') set[k] = null;
      if ('autopay' in set) set.autopay = b.autopay ? 1 : 0;
      if ('tax_exempt' in set) set.tax_exempt = b.tax_exempt ? 1 : 0;
      if ('lang' in set) set.lang = set.lang === 'es' ? 'es' : null;
      if ('type' in set && !['residential', 'commercial'].includes(set.type)) delete set.type;
      if ('location_id' in set) {
        if ((ctx.me || {}).location_id) delete set.location_id;
        else if (!locName(ctx, set.location_id)) throw fail('Pick a branch');
        else { set.location_id = Number(set.location_id); rec.loc = set.location_id; }
      }
      if (set.autopay && !cur(rec).card_last4) throw fail('Save a card first. Send the customer their pay link, or add a card from this page.');
      Object.assign(rec.set, set);
      return { ok: true };
    }],
    ['DELETE', /^\/api\/customers\/(\d+)$/, (st, ctx, m) => { touch(st, ctx, 'customers', m[1]).del = true; return { ok: true }; }],
    ['POST', /^\/api\/customers\/(\d+)\/demo-card$/, (st, ctx, m, b) => {
      Object.assign(touch(st, ctx, 'customers', m[1]).set, { card_brand: 'Visa', card_last4: String(b.number || '4242').replace(/\D/g, '').slice(-4) || '4242' });
      return { ok: true };
    }],
    ['POST', /^\/api\/customers\/(\d+)\/remove-card$/, (st, ctx, m) => {
      Object.assign(touch(st, ctx, 'customers', m[1]).set, { card_brand: null, card_last4: null, stripe_payment_method: null, autopay: 0 });
      return { ok: true };
    }],
    ['POST', /^\/api\/customers\/(\d+)\/properties$/, (st, ctx, m, b) => {
      if (!b.address) throw fail('Address is required');
      const cid = Number(m[1]);
      if (!customerNow(st, ctx, cid)) throw fail('Customer not found', 404);
      return { id: add(st, ctx, 'properties', { id: nextId(st, ctx, 'properties'), customer_id: cid, address: clip(b.address, 200), city: clip(b.city, 80),
        state: clip(b.state, 20), zip: clip(b.zip, 10), lat: num(b.lat), lng: num(b.lng), access_notes: clip(b.access_notes, 2000), created_at: stamp(ctx.now),
        photo_id: null, site_name: clip(b.site_name, 120), site_contact: clip(b.site_contact, 120), site_phone: clip(b.site_phone, 120), merge_id: null }, customerLoc(st, ctx, cid)).id };
    }],
    ['PUT', /^\/api\/properties\/(\d+)$/, (st, ctx, m, b) => {
      const rec = touch(st, ctx, 'properties', m[1]);
      const p = cur(rec);
      const set = {};
      for (const k of ['address', 'city', 'state', 'zip', 'access_notes']) if (k in b) set[k] = clip(b[k], k === 'access_notes' ? 2000 : 200);
      for (const k of ['site_name', 'site_contact', 'site_phone']) if (k in b) set[k] = clip(b[k], 120);
      if (['address', 'city', 'state', 'zip'].some((k) => k in set && set[k] !== p[k])) Object.assign(set, { lat: num(b.lat), lng: num(b.lng) });
      Object.assign(rec.set, set);
      return { ok: true };
    }],
    ['POST', /^\/api\/plans$/, (st, ctx, m, b) => {
      if (!b.customer_id || !b.property_id) throw fail('Pick a customer and property');
      if (!customerNow(st, ctx, b.customer_id)) throw fail('Customer not found', 404);
      return { id: addPlan(st, ctx, b, customerLoc(st, ctx, b.customer_id)).id };
    }],
    ['PUT', /^\/api\/plans\/(\d+)$/, (st, ctx, m, b) => {
      const rec = touch(st, ctx, 'plans', m[1]);
      const pl = { ...cur(rec), id: Number(m[1]) };
      const set = { price: num(b.price, pl.price), tech_id: 'tech_id' in b ? num(b.tech_id) : pl.tech_id,
        service_type_id: num(b.service_type_id, pl.service_type_id), notes: b.notes ?? pl.notes };
      const visits = planVisits(st, ctx, pl);
      Object.assign(rec.set, set);
      for (const v of visits) Object.assign(touch(st, ctx, 'visits', v.id).set, { price: set.price, tech_id: set.tech_id, service_type_id: set.service_type_id });
      return { ok: true };
    }],
    ['DELETE', /^\/api\/plans\/(\d+)$/, (st, ctx, m, b) => {
      const rec = touch(st, ctx, 'plans', m[1]);
      const pl = { ...cur(rec), id: Number(m[1]) };
      const visits = planVisits(st, ctx, pl);
      Object.assign(rec.set, { active: 0, cancelled_at: stamp(ctx.now) });
      for (const v of visits) {
        const vr = touch(st, ctx, 'visits', v.id);
        if (vr.row) vr.set.status = 'cancelled';
        else delete st.rows.visits[v.id];
      }
      if (b.reason) touch(st, ctx, 'customers', pl.customer_id).set.cancel_reason = clip(b.reason, 200);
      return { ok: true };
    }],
    ['POST', /^\/api\/visits$/, (st, ctx, m, b) => {
      if (!b.property_id || !isDay(b.date)) throw fail('Pick an address and a date');
      const p = rowNow(st, ctx, 'properties', b.property_id);
      if (!p) throw fail('Address not found', 404);
      const v = newVisitRow(st, ctx, { customer_id: p.customer_id, property_id: Number(b.property_id), service_type_id: num(b.service_type_id), tech_id: num(b.tech_id),
        date: b.date, time_window: clip(b.time_window, 40), price: num(b.price, 0), office_notes: clip(b.office_notes, 4000) }, customerLoc(st, ctx, p.customer_id));
      if (b.request_id) { try { touch(st, ctx, 'requests', b.request_id).set.status = 'scheduled'; } catch { /* the visit still counts */ } }
      return { id: v.id };
    }],
    ['PUT', /^\/api\/visits\/(\d+)$/, (st, ctx, m, b) => {
      const id = Number(m[1]);
      const rec = touch(st, ctx, 'visits', id);
      const v = cur(rec);
      const set = {};
      if (isDay(b.date)) set.date = b.date;
      if ('tech_id' in b) set.tech_id = num(b.tech_id);
      if (['scheduled', 'completed', 'skipped', 'cancelled'].includes(b.status)) set.status = b.status;
      if ('price' in b) set.price = num(b.price);
      if ('service_type_id' in b) set.service_type_id = num(b.service_type_id);
      for (const k of ['office_notes', 'time_window']) if (k in b) set[k] = clip(b[k], k === 'office_notes' ? 4000 : 40);
      const moved = ('date' in set && set.date !== v.date) || ('tech_id' in set && set.tech_id !== v.tech_id);
      if (moved) set.route_order = null;
      if ('date' in set && set.date !== v.date) {
        set.reminded_at = null;
        for (const r of merged(st, ctx, v.customer_id).requests) if (r.visit_id === id && r.status === 'new') touch(st, ctx, 'requests', r.id).set.status = 'scheduled';
      }
      Object.assign(rec.set, set);
      return { ok: true };
    }],
    ['DELETE', /^\/api\/visits\/(\d+)$/, (st, ctx, m) => {
      const rec = touch(st, ctx, 'visits', m[1]);
      if (!['completed', 'cancelled'].includes(cur(rec).status)) rec.set.status = 'cancelled';
      return { ok: true };
    }],
    ['POST', /^\/api\/visits\/(\d+)\/start$/, (st, ctx, m, b) => {
      const rec = touch(st, ctx, 'visits', m[1]);
      const v = cur(rec);
      ownStop(ctx, v);
      if (v.status !== 'scheduled') throw fail('This stop is already finished');
      rec.set.started_at = v.started_at || phoneTime(ctx, b.at);
      return { started_at: rec.set.started_at };
    }],
    ['POST', /^\/api\/visits\/(\d+)\/complete$/, (st, ctx, m, b) => {
      const id = Number(m[1]);
      const rec = touch(st, ctx, 'visits', id);
      const v = cur(rec);
      ownStop(ctx, v);
      if (v.status === 'completed') throw fail('This stop is already completed');
      const price = b.price != null && b.price !== '' && Number.isFinite(Number(b.price)) ? Number(b.price) : v.price;
      const set = { ...extras(b, ['products', 'device_checks', 'weather', 'internal_notes', 'tech_notes', 'target_pests', 'areas_serviced', 'customer_present']),
        status: 'completed', completed_at: phoneTime(ctx, b.completed_at), completed_by: (ctx.me || {}).id ?? null, tech_notes: clip(b.tech_notes, 4000),
        target_pests: clip(b.target_pests, 400), areas_serviced: clip(b.areas_serviced, 400), customer_present: b.customer_present ? 1 : 0, price,
        signature: /^data:image\/png;base64,/.test(String(b.signature || '')) && String(b.signature).length < 400000 ? b.signature : null,
        weather: clip(b.weather, 120), internal_notes: clip(b.internal_notes, 4000) };
      // Done ahead of schedule: the record carries the day the work happened.
      if (v.date > ctx.today) Object.assign(set, { date: ctx.today, route_order: null });
      Object.assign(rec.set, set);
      rec.x = {
        products: (Array.isArray(b.products) ? b.products : []).filter((p) => p && p.product_id).slice(0, 40)
          .map((p) => ({ product_id: num(p.product_id), amount: num(p.amount), unit: clip(p.unit, 20), area: clip(p.area, 200), rate: clip(p.rate, 80), method: clip(p.method, 80) })),
        checks: (Array.isArray(b.device_checks) ? b.device_checks : []).filter((d) => d && DEVICE_STATUSES.includes(d.status)).slice(0, 1000)
          .map((d) => ({ device_id: num(d.device_id), status: d.status, count: Number.isInteger(Number(d.count)) && Number(d.count) > 0 ? Number(d.count) : null })),
      };
      const done = { ...v, ...set };
      const invoiceId = price > 0 ? createInvoice(st, ctx, { customerId: v.customer_id, visitId: id, amount: price,
        description: `${serviceName(ctx, done.service_type_id) || 'Pest control service'} on ${shortDate(done.date)}` }) : null;
      const c = customerNow(st, ctx, v.customer_id) || {};
      const autopay = invoiceId && c.autopay ? chargeCard(st, ctx, v.customer_id, invoiceId) : null;
      return { invoiceId, autopay };
    }],
    ['POST', /^\/api\/visits\/(\d+)\/skip$/, (st, ctx, m, b) => {
      const rec = touch(st, ctx, 'visits', m[1]);
      ownStop(ctx, cur(rec));
      if (cur(rec).status === 'completed') throw fail('This stop is already completed');
      Object.assign(rec.set, { status: 'skipped', tech_notes: clip(b.reason, 2000) });
      return { ok: true };
    }],
    ['POST', /^\/api\/visits\/(\d+)\/on-my-way$/, (st, ctx, m) => {
      const rec = touch(st, ctx, 'visits', m[1]);
      ownStop(ctx, cur(rec));
      if (cur(rec).status !== 'scheduled') throw fail('This stop is already finished');
      rec.set.omw_at = stamp(ctx.now);
      const eta = new Date(ctx.now + 20 * 60000);
      return { sent: ['text'], eta_text: eta.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) };
    }],
    ['POST', /^\/api\/visits\/(\d+)\/photos$/, (st, ctx, m, b) => {
      const v = visitNow(st, ctx, m[1]);
      ownStop(ctx, v);
      const hit = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data || ''));
      if (!hit) throw fail('Send a JPEG, PNG or WebP picture');
      const bytes = Math.floor(hit[2].length * 3 / 4);
      if (bytes > 4 * 1048576) throw fail('Pictures can be up to 4 MB');
      if (photoList(st, ctx, v.id).length >= 30) throw fail('This stop already has 30 photos');
      if (Object.keys(st.rows.photos).length >= 60) throw fail('The demo keeps up to 60 new photos. Reset the demo to add more.');
      const kind = PHOTO_KINDS.includes(b.kind) ? b.kind : 'after';
      const ph = add(st, ctx, 'photos', { id: nextId(st, ctx, 'photos'), visit_id: v.id, customer_id: v.customer_id, kind, caption: clip(b.caption, 200),
        mime: hit[1], bytes, user_id: (ctx.me || {}).id ?? null, created_at: stamp(ctx.now) }, customerLoc(st, ctx, v.customer_id));
      if (kind === 'property') { try { touch(st, ctx, 'properties', v.property_id).set.photo_id = ph.id; } catch { /* the photo still counts */ } }
      return { id: ph.id, photos: photoList(st, ctx, v.id), __blob: { id: ph.id, data: b.data } };
    }],
    ['PUT', /^\/api\/photos\/(\d+)$/, (st, ctx, m, b) => {
      const rec = st.rows.photos[m[1]];
      if (rec && !rec.del) {
        if ('caption' in b) rec.set.caption = clip(b.caption, 200);
        if (PHOTO_KINDS.includes(b.kind)) rec.set.kind = b.kind;
      }
      return { ok: true };
    }],
    ['DELETE', /^\/api\/photos\/(\d+)$/, (st, ctx, m) => {
      const id = Number(m[1]);
      const rec = st.rows.photos[id];
      const p = rec ? cur(rec) : (recorded(ctx, 'photos', id) || {}).row;
      if (!p) throw fail('Photo not found', 404);
      const v = visitNow(st, ctx, p.visit_id);
      ownStop(ctx, v);
      if (ctx.role === 'tech' && (p.user_id !== (ctx.me || {}).id || v.status === 'completed')) throw fail('Ask the office to remove this photo', 403);
      if (rec) delete st.rows.photos[id];
      else st.gone.push(id);
      ctx.memo.clear();
      return { ok: true, photos: photoList(st, ctx, v.id), __drop: rec ? id : null };
    }],
    ['POST', /^\/api\/routes\/reorder$/, (st, ctx, m, b) => {
      (Array.isArray(b.ids) ? b.ids : []).slice(0, 200).forEach((id, i) => { try { touch(st, ctx, 'visits', id).set.route_order = i + 1; } catch { /* gone */ } });
      return { ok: true };
    }],
    ['POST', /^\/api\/payments$/, (st, ctx, m, b) => {
      if (!b.customer_id) throw fail('Pick a customer');
      if (!customerNow(st, ctx, b.customer_id)) throw fail('Customer not found', 404);
      if (b.invoice_id && (rowNow(st, ctx, 'invoices', b.invoice_id) || {}).customer_id !== Number(b.customer_id)) throw fail('That invoice belongs to someone else');
      return { id: recordPayment(st, ctx, { customerId: b.customer_id, amount: b.amount, method: b.method || 'cash', reference: b.reference, invoiceId: num(b.invoice_id), date: b.date }) };
    }],
    ['POST', /^\/api\/invoices$/, (st, ctx, m, b) => {
      if (!b.customer_id || !(Number(b.amount) > 0)) throw fail('Pick a customer and an amount');
      if (!customerNow(st, ctx, b.customer_id)) throw fail('Customer not found', 404);
      return { id: createInvoice(st, ctx, { customerId: b.customer_id, amount: b.amount, description: b.description, taxable: b.taxable !== false }) };
    }],
    ['POST', /^\/api\/invoices\/(\d+)\/charge$/, (st, ctx, m) => {
      const inv = rowNow(st, ctx, 'invoices', m[1]);
      if (!inv) throw fail('Invoice not found', 404);
      const r = chargeCard(st, ctx, inv.customer_id, inv.id);
      if (!r.charged) throw fail(r.reason || 'Card was not charged');
      return r;
    }],
    ['POST', /^\/api\/invoices\/(\d+)\/void$/, (st, ctx, m) => {
      const rec = touch(st, ctx, 'invoices', m[1]);
      if (cur(rec).amount_paid > 0) throw fail('This invoice has payments on it. Refund those first.');
      rec.set.status = 'void';
      return { ok: true };
    }],
    ['PUT', /^\/api\/requests\/(\d+)$/, (st, ctx, m, b) => {
      touch(st, ctx, 'requests', m[1]).set.status = ['new', 'scheduled', 'closed'].includes(b.status) ? b.status : 'closed';
      return { ok: true };
    }],
    // The customer's pay page.
    ['POST', /^\/api\/portal\/([^/]+)\/pay$/, (st, ctx, m, b) => {
      const c = portalCustomer(st, ctx, m[1]);
      const mm = merged(st, ctx, c.id);
      const inv = b.invoice_id && mm.invoices.find((i) => i.id === Number(b.invoice_id) && i.status === 'open');
      const amount = inv ? round2(inv.amount - inv.amount_paid) : balanceOf(mm);
      if (!(amount > 0)) throw fail('Nothing is due right now. Thank you!');
      return { demo: true, amount, tip: round2(Math.max(0, Math.min(Number(b.tip) || 0, 1000))), __read: true };
    }],
    ['POST', /^\/api\/portal\/([^/]+)\/demo-pay$/, (st, ctx, m, b) => {
      const c = portalCustomer(st, ctx, m[1]);
      const digits = String(b.card_number || '').replace(/\D/g, '');
      if (digits.length < 12) throw fail('Enter a card number (any test number works, like 4242 4242 4242 4242)');
      const mm = merged(st, ctx, c.id);
      const inv = b.invoice_id && mm.invoices.find((i) => i.id === Number(b.invoice_id) && i.status === 'open');
      const amount = inv ? round2(inv.amount - inv.amount_paid) : balanceOf(mm);
      if (!(amount > 0)) throw fail('Nothing is due right now');
      recordPayment(st, ctx, { customerId: c.id, amount, method: 'card', reference: `demo ••${digits.slice(-4)}`, invoiceId: inv ? inv.id : null,
        tip: round2(Math.max(0, Math.min(Number(b.tip) || 0, 1000))) });
      if (b.save_card) Object.assign(touch(st, ctx, 'customers', c.id).set, { card_brand: 'Visa', card_last4: digits.slice(-4), autopay: 1 });
      return { ok: true, amount };
    }],
    ['POST', /^\/api\/portal\/([^/]+)\/autopay$/, (st, ctx, m, b) => {
      const c = portalCustomer(st, ctx, m[1]);
      if (b.on && !c.card_last4) throw fail('Pay with a card and tick "Save card for autopay" to turn on autopay');
      touch(st, ctx, 'customers', c.id).set.autopay = b.on ? 1 : 0;
      return { ok: true };
    }],
    ['POST', /^\/api\/portal\/([^/]+)\/request$/, (st, ctx, m, b) => {
      const c = portalCustomer(st, ctx, m[1]);
      const msg = String(b.message || '').trim();
      if (!msg) throw fail('Tell us what you need');
      add(st, ctx, 'requests', { id: nextId(st, ctx, 'requests'), customer_id: c.id, message: msg.slice(0, 2000), preferred_date: isDay(b.preferred_date) ? b.preferred_date : null,
        status: 'new', created_at: stamp(ctx.now), source: 'portal', service_type_id: null, visit_id: null }, c.location_id);
      return { ok: true };
    }],
    ['POST', /^\/api\/portal\/([^/]+)\/reschedule$/, (st, ctx, m, b) => {
      const c = portalCustomer(st, ctx, m[1]);
      const mm = merged(st, ctx, c.id);
      const v = mm.visits.find((x) => x.id === Number(b.visit_id) && x.status === 'scheduled' && x.date >= ctx.today);
      if (!v) throw fail('That visit is not on the schedule anymore. Call us and we will sort it out.', 404);
      const preferred = isDay(b.preferred_date) ? b.preferred_date : null;
      if (preferred && preferred < ctx.today) throw fail('Pick a day from today on');
      if (mm.requests.some((r) => r.visit_id === v.id && r.status === 'new')) throw fail('We already have your request for this visit. We will be in touch soon.');
      const when = day(v.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const note = String(b.note || '').trim().slice(0, 1000);
      add(st, ctx, 'requests', { id: nextId(st, ctx, 'requests'), customer_id: c.id, message: `Please move my ${when} visit.${note ? ` ${note}` : ''}`,
        preferred_date: preferred, status: 'new', created_at: stamp(ctx.now), source: 'reschedule', service_type_id: null, visit_id: v.id }, c.location_id);
      return { ok: true };
    }],
  ];
  // Runs one save against the state. Returns { s, b } (plus a photo to store or drop), or null when the demo
  // doesn't keep this kind of change. The caller passes a copy and keeps it only when s is 200.
  function write(st, ctx, method, p, body) {
    ctx.memo = ctx.memo || new Map();
    for (const [m, re, fn] of WRITES) {
      const hit = m === method && re.exec(p);
      if (!hit) continue;
      try {
        const b = fn(st, ctx, hit, body && typeof body === 'object' ? body : {});
        const out = { s: 200, b };
        for (const k of ['__blob', '__drop']) if (k in b) { out[k.slice(2)] = b[k]; delete b[k]; }
        if (b.__read) delete b.__read;
        else st.n++;
        return out;
      } catch (e) {
        if (e.status) return { s: e.status, b: { error: e.message } };
        throw e;
      }
    }
    return null;
  }

  // ---------- reads: lay the changes over recorded answers ----------
  function dashboard(st, ctx, m, q, d) {
    if (!d || !Array.isArray(d.todays)) return d;
    const out = { ...d, todays: d.todays.map((r) => ({ ...r })), pastDue: { ...(d.pastDue || { t: 0, n: 0 }) } };
    const today = out.date || ctx.today, month = today.slice(0, 8) + '01', week = addDays(today, 7);
    const each = (t, fn) => { for (const rec of Object.values(st.rows[t])) if (inScope(ctx, rec)) { if (rec.row) fn(rec.row, -1); if (!rec.del) fn(cur(rec), 1); } };
    each('visits', (v, k) => {
      if (v.date === today && v.status !== 'cancelled') {
        let r = out.todays.find((x) => (x.tech_id ?? null) === (v.tech_id ?? null));
        if (!r) {
          const t = techOf(ctx, v.tech_id);
          out.todays.push((r = { tech_id: v.tech_id ?? null, tech_name: t ? t.name : null, color: t ? t.color : null, stops: 0, done: 0, value: 0 }));
        }
        r.stops += k;
        r.done = (r.done || 0) + (v.status === 'completed' ? k : 0);
        r.value = round2((r.value || 0) + k * (v.price || 0));
      }
      if (v.status === 'scheduled' && v.date < today) out.missed += k;
      if (v.status === 'scheduled' && v.tech_id == null && v.date >= today && v.date <= week) out.unassigned += k;
    });
    each('invoices', (i, k) => {
      if (i.status !== 'void' && i.date >= month && i.date <= today) out.billedMonth = round2(out.billedMonth + k * i.amount);
      if (i.status !== 'open') return;
      const due = round2(i.amount - i.amount_paid);
      out.openTotal = round2(out.openTotal + k * due);
      if (i.due_date < today) { out.pastDue.t = round2(out.pastDue.t + k * due); out.pastDue.n += k; }
    });
    each('payments', (p, k) => { if (p.date >= month && p.date <= today) out.revenueMonth = round2(out.revenueMonth + k * p.amount); });
    each('customers', (c, k) => { if (c.status === 'active') out.activeCustomers += k; });
    each('plans', (pl, k) => { if (pl.active) out.activePlans += k; });
    out.todays = out.todays.filter((r) => r.stops > 0).sort(by('tech_name'));
    if (Array.isArray(d.newRequests)) {
      out.newRequests = mergeRows(st, ctx, 'requests', d.newRequests, (r, rec) => r.status === 'new' && inScope(ctx, rec), (r) => {
        const c = customerNow(st, ctx, r.customer_id) || {};
        return { ...r, first_name: c.first_name ?? null, last_name: c.last_name ?? null, company: c.company ?? null };
      }).sort(by('-created_at'));
    }
    if (out.gettingStarted) {
      const any = (t, f) => Object.values(st.rows[t]).some((r) => f(cur(r) || {}));
      out.gettingStarted = { ...out.gettingStarted, customer: out.gettingStarted.customer || any('customers', (c) => c.id),
        completed: out.gettingStarted.completed || any('visits', (v) => v.status === 'completed'), paid: out.gettingStarted.paid || any('payments', (p) => p.id) };
    }
    return out;
  }

  // Customers whose list row may show something new: their own changes, or a visit, invoice or payment.
  function touchedCustomers(st) {
    const ids = new Set(Object.keys(st.rows.customers).map(Number));
    for (const t of ['visits', 'invoices', 'payments', 'properties']) {
      for (const rec of Object.values(st.rows[t])) { const x = cur(rec) || rec.row || {}; if (x.customer_id) ids.add(Number(x.customer_id)); }
    }
    return ids;
  }
  const searchable = (r, q) => {
    if (!q) return true;
    const s = JSON.stringify(r).toLowerCase();
    const digits = q.replace(/\D/g, '');
    return s.includes(q) || (digits.length >= 3 && s.replace(/\D/g, '').includes(digits));
  };
  function listRow(st, ctx, cid, base, like) {
    const c = customerNow(st, ctx, cid);
    const mm = merged(st, ctx, cid);
    const first = mm.properties.slice().sort(by('id'))[0];
    const out = { ...(base || blank(like)), ...c, name: nameOf(c), location: locName(ctx, c.location_id) ?? (base || {}).location ?? null,
      address: first ? first.address + (first.city ? `, ${first.city}` : '') : null, balance: balanceOf(mm) };
    out.next_visit = !base || changedVisitsOf(st, cid) ? nextVisit(ctx, mm.visits) : base.next_visit;
    return out;
  }
  function customerList(st, ctx, m, q, rows) {
    if (!Array.isArray(rows)) return rows;
    const status = q.get('status') || 'active';
    const text = (q.get('q') || '').trim().toLowerCase();
    const scope = scopeOf(ctx);
    const out = rows.slice();
    const at = new Map(out.map((r, i) => [r.id, i]));
    let added = false;
    for (const cid of touchedCustomers(st)) {
      const i = at.get(cid);
      const c = customerNow(st, ctx, cid);
      const own = st.rows.customers[cid];
      if (i == null && !(own && (!own.row || 'status' in own.set))) continue; // not on this list, and nothing here would put it there
      const ok = c && (status === 'all' || c.status === status) && (!scope || Number(c.location_id) === scope);
      const row = ok && listRow(st, ctx, cid, i == null ? null : out[i], rows[0]);
      if (row && i == null && !searchable(row, text)) continue;
      if (i == null) { if (row) { out.push(row); added = true; } } else out[i] = row || null;
    }
    const kept = out.filter(Boolean);
    return added ? kept.sort(by('last_name', 'first_name')) : kept;
  }
  // "Is this already a customer?" while the office types: new customers count too.
  function duplicates(st, ctx, list, q) {
    ctx.memo = ctx.memo || new Map();
    q = q instanceof URLSearchParams ? q : new URLSearchParams(q || '');
    const digits = String(q.get('phone') || '').replace(/\D/g, '').slice(-10);
    const email = String(q.get('email') || '').trim().toLowerCase();
    const addr = String(q.get('address') || '').trim().toLowerCase();
    if (digits.length < 10 && !email && addr.length < 6) return [];
    const rows = customerList(st, ctx, null, new URLSearchParams('status=all'), list || []);
    return rows.filter((c) => (digits.length === 10 && String(c.phone || '').replace(/\D/g, '').endsWith(digits)) || (email && String(c.email || '').toLowerCase() === email)
      || (addr.length >= 6 && String(c.address || '').toLowerCase().split(',')[0] === addr))
      .slice(0, 5).map((c) => ({ id: c.id, name: c.name, company: c.company, phone: c.phone, email: c.email, status: c.status, address: String(c.address || '').split(',')[0] || null }));
  }

  function customerPage(st, ctx, m, q, body) {
    const cid = Number(m[1]);
    const rec = st.rows.customers[cid];
    if (rec && rec.del) throw fail('Customer not found', 404);
    let d = body;
    if (!d) {
      if (!rec || rec.row) return null;
      d = { ...blank(ctx.similar(/^GET \/api\/customers\/\d+$/) || {}, true), device_count: 0 };
    } else if (!rec && !touchedCustomers(st).has(cid)) return body;
    const c = customerNow(st, ctx, cid);
    const mm = merged(st, ctx, cid, d.id ? d : null);
    const limit = addMonths(ctx.today, 6);
    const visits = mm.visits.filter((v) => v.status !== 'cancelled' && v.date <= limit).map((v) => ('photo_count' in v || !v.created_at ? v : visitRow(st, ctx, v, (d.visits || [])[0])))
      .sort(by('-date', '-id')).slice(0, 100);
    for (const v of visits) {
      if (!('address' in v)) Object.assign(v, { service_name: serviceName(ctx, v.service_type_id), tech_name: (techOf(ctx, v.tech_id) || {}).name || null,
        address: (rowNow(st, ctx, 'properties', v.property_id) || {}).address || null });
      if (v.photo_count == null) v.photo_count = photoList(st, ctx, v.id).length;
    }
    const plans = mm.plans.map((pl) => {
      if ('service_name' in pl && !st.rows.plans[pl.id] && !changedVisitsOf(st, cid)) return pl;
      return { ...pl, service_name: serviceName(ctx, pl.service_type_id), tech_name: (techOf(ctx, pl.tech_id) || {}).name || null,
        address: (rowNow(st, ctx, 'properties', pl.property_id) || {}).address || null,
        next_visit: nextVisit(ctx, mm.visits, pl.id) ?? (st.rows.plans[pl.id] && !st.rows.plans[pl.id].row ? null : pl.next_visit ?? null) };
    }).sort((a, b) => (b.active || 0) - (a.active || 0) || a.id - b.id);
    return { ...d, ...c, name: nameOf(c), location: locName(ctx, c.location_id) ?? d.location ?? null, balance: balanceOf(mm),
      properties: mm.properties.sort(by('id')), plans, visits, invoices: mm.invoices.sort(by('-date', '-id')), payments: mm.payments.sort(by('-date', '-id')),
      requests: mm.requests.sort(by('-created_at')) };
  }

  function visitList(st, ctx, m, q, rows) {
    if (!Array.isArray(rows)) return rows;
    const from = q.get('from') || ctx.today, to = q.get('to') || addDays(from, 6);
    const keep = (v, rec) => v.date >= from && v.date <= to && v.status !== 'cancelled' && inScope(ctx, rec);
    return mergeRows(st, ctx, 'visits', rows, keep, (v) => visitRow(st, ctx, v, rows[0]))
      .sort((a, b) => cmp(a.date, b.date) || (a.route_order ?? 9999) - (b.route_order ?? 9999) || cmp(a.zip, b.zip));
  }
  function missedList(st, ctx, m, q, rows) {
    if (!Array.isArray(rows)) return rows;
    return mergeRows(st, ctx, 'visits', rows, (v, rec) => v.status === 'scheduled' && v.date < ctx.today && inScope(ctx, rec), (v) => visitRow(st, ctx, v, rows[0])).sort(by('date'));
  }
  function visitPage(st, ctx, m, q, body) {
    const id = Number(m[1]);
    const rec = st.rows.visits[id];
    const photos = Object.values(st.rows.photos).some((r) => (cur(r) || {}).visit_id === id) || st.gone.length;
    if (!rec && !photos) return body;
    if (rec && rec.del) throw fail('Visit not found', 404);
    let d = body || ctx.find(`GET /api/visits/${id}`);
    const v = rec ? { ...rec.row, ...rec.set, id } : d;
    if (!v) return null;
    if (!d) {
      if (rec.row) return null;
      ownStop(ctx, v);
      const p = rowNow(st, ctx, 'properties', v.property_id) || {};
      const c = customerNow(st, ctx, v.customer_id) || {};
      d = { ...blank(ctx.similar(/^GET \/api\/visits\/\d+$/) || {}, true), ...joined(st, ctx, v), access_notes: p.access_notes ?? null, customer_notes: c.notes ?? null,
        email: c.email ?? null, products: [], history: [], last_ticket: null, devices: [], property_photo_id: p.photo_id ?? null };
    }
    const out = derive(ctx, { ...d, ...(rec ? rec.set : {}) }, d);
    if (rec && rec.x) {
      const products = (ctx.boot || {}).products || [];
      out.products = rec.x.products.map((x, i) => { const pr = products.find((y) => y.id === x.product_id) || {}; return { id: i + 1, visit_id: id, ...x, name: pr.name || null, epa_reg: pr.epa_reg || null }; });
      if (Array.isArray(out.devices) && rec.x.checks.length) {
        out.devices = out.devices.map((dv) => { const ck = rec.x.checks.find((x) => x.device_id === dv.id); return ck ? { ...dv, status: ck.status, count: ck.count } : dv; });
      }
    }
    const inv = Object.values(st.rows.invoices).map(cur).find((i) => i && i.visit_id === id);
    if (inv) out.invoice = { ...(out.invoice || {}), ...inv };
    out.photos = photoList(st, ctx, id);
    return out;
  }
  function routePage(st, ctx, m, q, body) {
    if (!body || !Array.isArray(body.stops)) return body;
    const date = q.get('date') || ctx.today;
    const tech = m[0] === '/api/my-route' ? (ctx.me || {}).id ?? null : num(q.get('tech_id'));
    // A day or tech the recording doesn't have was answered with another one: none of its stops belong here.
    const other = (body.date && body.date !== date) || ('tech_id' in body && (body.tech_id ?? null) !== (tech ?? null));
    const rows = other ? [] : body.stops;
    const keep = (v) => v.date === date && (v.tech_id ?? null) === (tech ?? null) && v.status !== 'cancelled';
    const like = rows[0] || null;
    const stops = mergeRows(st, ctx, 'visits', rows, keep, (v) => ({ ...visitRow(st, ctx, v, like), eta: null, eta_text: null, drive_min: null, late_min: 0 }));
    if (stops.some((s) => st.rows.visits[s.id] && 'route_order' in st.rows.visits[s.id].set)) stops.sort(routeOrder);
    if (!rows.length && stops.length) stops.sort(routeOrder);
    if (!stops.length && !body.stops.length) return body;
    return { ...body, date, tech_id: tech, stops, summary: { ...(body.summary || {}), stops: stops.length, revenue: round2(stops.reduce((t, s) => t + (s.price || 0), 0)) } };
  }
  function dispatchPage(st, ctx, m, q, body) {
    if (!body || !Array.isArray(body.techs)) return body;
    const date = q.get('date') || ctx.today;
    if (body.date && body.date !== date) return body;
    const stopOf = (v) => { const j = joined(st, ctx, v); return { id: v.id, status: v.status, on_site: false, lat: j.lat, lng: j.lng, address: j.address, name: j.customer_name,
      time_window: v.time_window ?? null, eta_text: null, late_min: 0, omw: Boolean(v.omw_at) }; };
    const live = (s) => { const rec = st.rows.visits[s.id]; if (!rec || rec.del) return s; const v = cur(rec); return { ...s, status: v.status, on_site: Boolean(v.started_at && v.status === 'scheduled'), omw: Boolean(v.omw_at) || s.omw }; };
    const techs = body.techs.map((t) => {
      const stops = mergeRows(st, ctx, 'visits', t.stops || [], (v) => v.date === date && v.tech_id === t.id && v.status !== 'cancelled', stopOf).map(live);
      if (!Object.values(st.rows.visits).length) return t;
      const done = stops.filter((s) => s.status === 'completed').length;
      const nx = stops.find((s) => s.status === 'scheduled');
      return { ...t, stops, done, total: stops.length,
        next: nx ? { id: nx.id, name: nx.name, address: nx.address, eta_text: nx.eta_text ?? null, late_min: nx.late_min ?? 0 } : null,
        status: stops.length && done === stops.length ? 'done' : stops.length ? t.status : 'no_route' };
    });
    const unassigned = Array.isArray(body.unassigned) ? mergeRows(st, ctx, 'visits', body.unassigned, (v) => v.date === date && v.tech_id == null && v.status === 'scheduled',
      (v) => { const s = stopOf(v); return { id: s.id, name: s.name, address: s.address, lat: s.lat, lng: s.lng, time_window: s.time_window }; }) : body.unassigned;
    return { ...body, techs, unassigned };
  }
  function invoiceRow(st, ctx, i, base) {
    const c = customerNow(st, ctx, i.customer_id) || {};
    return { ...(base || {}), ...i, customer_name: nameOf(c), company: c.company ?? null, phone: c.phone ?? null, email: c.email ?? null,
      card_last4: c.card_last4 ?? null, autopay: c.autopay ?? 0 };
  }
  function invoiceList(st, ctx, m, q, rows) {
    if (!Array.isArray(rows)) return rows;
    const f = q.get('filter') || 'open';
    const ok = { pastdue: (i) => i.status === 'open' && i.due_date < ctx.today, paid: (i) => i.status === 'paid', all: () => true }[f] || ((i) => i.status === 'open');
    const people = new Set(Object.keys(st.rows.customers).map(Number));
    return mergeRows(st, ctx, 'invoices', rows, (i, rec) => ok(i) && inScope(ctx, rec), (i) => invoiceRow(st, ctx, i, blank(rows[0])))
      .map((i) => (people.has(i.customer_id) ? invoiceRow(st, ctx, i, i) : i)).sort(by('due_date', 'id'));
  }
  function paymentList(st, ctx, m, q, base) {
    if (!Array.isArray(base)) return base;
    const from = q.get('from') || addDays(ctx.today, -30), to = q.get('to') || ctx.today;
    return mergeRows(st, ctx, 'payments', base, (p, rec) => p.date >= from && p.date <= to && inScope(ctx, rec), (p) => {
      const c = customerNow(st, ctx, p.customer_id) || {};
      return { ...blank(base[0]), ...p, customer_name: nameOf(c), company: c.company ?? null };
    }).sort(by('-date', '-id'));
  }
  function aging(st, ctx, m, q, body) {
    if (!body || !Array.isArray(body.rows)) return body;
    const d = ctx.today, d30 = addDays(d, -30), d60 = addDays(d, -60), d90 = addDays(d, -90);
    const who = new Set();
    for (const t of ['invoices', 'payments']) for (const rec of Object.values(st.rows[t])) if (inScope(ctx, rec)) who.add((cur(rec) || rec.row).customer_id);
    let rows = body.rows.filter((r) => !who.has(r.customer_id));
    for (const cid of who) {
      const open = merged(st, ctx, cid).invoices.filter((i) => i.status === 'open');
      const sum = (f) => round2(open.filter(f).reduce((t, i) => t + i.amount - i.amount_paid, 0));
      const r = { current: sum((i) => i.due_date >= d), d1_30: sum((i) => i.due_date < d && i.due_date >= d30), d31_60: sum((i) => i.due_date < d30 && i.due_date >= d60),
        d61_90: sum((i) => i.due_date < d60 && i.due_date >= d90), d90_plus: sum((i) => i.due_date < d90), total: sum(() => true) };
      if (!(r.total > 0.004)) continue;
      const c = customerNow(st, ctx, cid) || {};
      const was = body.rows.find((x) => x.customer_id === cid) || {};
      rows.push({ ...was, customer_id: cid, customer_name: nameOf(c), phone: c.phone ?? null, email: c.email ?? null, autopay: c.autopay ?? 0, ...r,
        oldest_due: open.reduce((mn, i) => (mn == null || i.due_date < mn ? i.due_date : mn), null), last_reminder: was.last_reminder ?? null });
    }
    rows = rows.sort(by('-d90_plus', '-d61_90', '-d31_60', '-d1_30', '-total'));
    const tot = (k) => round2(rows.reduce((t, r) => t + (r[k] || 0), 0));
    return { ...body, rows, totals: { current: tot('current'), d1_30: tot('d1_30'), d31_60: tot('d31_60'), d61_90: tot('d61_90'), d90_plus: tot('d90_plus'), total: tot('total') } };
  }
  function requestList(st, ctx, m, q, rows) {
    if (!Array.isArray(rows)) return rows;
    return mergeRows(st, ctx, 'requests', rows, (r, rec) => inScope(ctx, rec), (r) => {
      const c = customerNow(st, ctx, r.customer_id) || {};
      return { ...r, customer_name: nameOf(c), company: c.company ?? null, phone: c.phone ?? null };
    }).sort((a, b) => (b.status === 'new') - (a.status === 'new') || -cmp(a.created_at, b.created_at));
  }
  function portalPage(st, ctx, m, q, body) {
    let c;
    try { c = portalCustomer(st, ctx, m[1]); } catch { return body; }
    const own = st.rows.customers[c.id];
    if (!body) {
      if (!own || own.row) return null;
      const like = ctx.similar(/^GET \/api\/portal\/[^/]+$/) || {};
      body = { ...blank(like, true), company: like.company || null, stripeEnabled: false, tipsEnabled: like.tipsEnabled ?? true, hasDevices: false };
    } else if (!touchedCustomers(st).has(c.id)) return body;
    const mm = merged(st, ctx, c.id);
    const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k] ?? null]));
    const done = mm.visits.filter((v) => v.status === 'completed');
    const mineDone = new Set(done.filter((v) => st.rows.visits[v.id]).map((v) => v.id));
    const history = [...done.filter((v) => mineDone.has(v.id)).map((v) => ({ id: v.id, date: v.date, service_name: serviceName(ctx, v.service_type_id),
      target_pests: v.target_pests ?? null, tech_notes: v.tech_notes ?? null, tech_name: (techOf(ctx, v.completed_by) || {}).name || null,
      photos: photoList(st, ctx, v.id).map((p) => pick(p, ['id', 'kind', 'caption'])), products: [] })),
    ...(body.history || []).filter((h) => !mineDone.has(h.id))].sort(by('-date')).slice(0, 12);
    const visitsChanged = changedVisitsOf(st, c.id);
    return { ...body,
      customer: { ...(body.customer || {}), name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company, lang: c.lang || 'en', autopay: Boolean(c.autopay),
        card: c.card_last4 ? `${c.card_brand || 'Card'} ending ${c.card_last4}` : null },
      balance: balanceOf(mm),
      openInvoices: mm.invoices.filter((i) => i.status === 'open').sort(by('date')).map((i) => pick(i, ['id', 'description', 'date', 'due_date', 'amount', 'amount_paid'])),
      invoices: mm.invoices.filter((i) => i.status !== 'void').sort(by('-date', '-id')).slice(0, 12).map((i) => pick(i, ['id', 'description', 'date', 'due_date', 'amount', 'amount_paid', 'status'])),
      payments: mm.payments.sort(by('-date', '-id')).slice(0, 10).map((p) => ({ date: p.date, amount: p.amount, tip: p.tip || 0, method: p.method })),
      history,
      upcoming: visitsChanged || !body.upcoming ? mm.visits.filter((v) => v.status === 'scheduled' && v.date >= ctx.today).sort(by('date')).slice(0, 4).map((v) => ({
        id: v.id, date: v.date, time_window: v.time_window ?? null, service_name: serviceName(ctx, v.service_type_id),
        address: (rowNow(st, ctx, 'properties', v.property_id) || {}).address || null,
        move_requested: mm.requests.some((r) => r.visit_id === v.id && r.status === 'new') ? 1 : 0 })) : body.upcoming };
  }
  // A new customer's or visit's other cards (referrals, termite, messages...): the emptiest recorded answer
  // for the same kind of page, so feature cards show their empty state.
  function similarTo(st, ctx, p, q) {
    const qs = q.toString();
    const ids = [...(p.match(/\d+/g) || []), ...(qs.match(/\d+/g) || [])].map(Number);
    const isNew = ids.some((id) => ['customers', 'visits', 'properties', 'plans', 'invoices'].some((t) => st.rows[t][id] && !st.rows[t][id].row));
    if (!isNew) return null;
    const re = new RegExp(`^GET ${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\d+/g, '\\d+')}${qs ? `\\?${qs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\d+/g, '\\d+')}` : ''}$`);
    const like = ctx.similar(re);
    if (like == null) return null;
    // Keep its settings, drop its rows: those belong to someone else.
    const emptied = (x) => (Array.isArray(x) ? [] : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, emptied(v)])) : x);
    const out = emptied(like);
    // A referral link carries the customer's own code.
    if (out && typeof out.code === 'string' && typeof out.link === 'string') {
      const c = customerNow(st, ctx, ids[0]) || {};
      const code = `${String(c.first_name || c.company || 'FRIEND').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8)}${ids[0]}`;
      Object.assign(out, { link: out.link.split(out.code).join(code), code, referredBy: null, sent: [] });
    }
    return out;
  }
  const PATCH = [
    [/^\/api\/dashboard$/, dashboard],
    [/^\/api\/customers$/, customerList],
    [/^\/api\/customers\/(\d+)$/, customerPage],
    [/^\/api\/visits$/, visitList],
    [/^\/api\/visits\/missed$/, missedList],
    [/^\/api\/visits\/(\d+)$/, visitPage],
    [/^\/api\/(routes|my-route)$/, routePage],
    [/^\/api\/dispatch$/, dispatchPage],
    [/^\/api\/invoices$/, invoiceList],
    [/^\/api\/payments$/, paymentList],
    [/^\/api\/reports\/aging$/, aging],
    [/^\/api\/requests$/, requestList],
    [/^\/api\/portal\/([^/]+)$/, portalPage],
  ];
  // body is the recorded answer (parsed), or null when the recording has none. Returns the answer to send,
  // or null for "nothing here either". Throws { status } for things deleted here.
  function patch(st, ctx, p, q, body) {
    if (!st.n) return body;
    ctx.memo = ctx.memo || new Map();
    q = q instanceof URLSearchParams ? q : new URLSearchParams(q || '');
    for (const [re, fn] of PATCH) {
      const m = re.exec(p);
      if (!m) continue;
      try {
        const out = fn(st, ctx, m, q, body);
        return out === undefined ? body : out;
      } catch (e) {
        if (e.status) throw e;
        if (ctx.debug) throw e;
        return body; // an answer shaped in a way this file doesn't know: show it as recorded
      }
    }
    return body == null ? similarTo(st, ctx, p, q) : body;
  }

  // ---------- documents ----------
  function letterhead(s, title, right) {
    return `<header class="lh"><div><div class="co">${esc(s.company_name || 'Pest control')}</div>
      <div class="small">${[s.shop_address, s.company_phone, s.company_email].filter(Boolean).map(esc).join('<br>')}</div>
      ${s.license_no ? `<div class="small">License: ${esc(s.license_no)}</div>` : ''}</div><div class="right"><div class="title">${esc(title)}</div>${right}</div></header>`;
  }
  function serviceBlock(st, ctx, v) {
    const rec = st.rows.visits[v.id];
    const products = rec && rec.x ? rec.x.products : [];
    const list = (ctx.boot || {}).products || [];
    const t = techOf(ctx, v.completed_by || v.tech_id) || {};
    const clock = v.completed_at ? new Date(v.completed_at.replace(' ', 'T') + 'Z').toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
    return `<section class="svc"><h2>Service record</h2><div class="facts">
      <div><span class="k">Date</span>${longDate(v.date)}${clock ? `, ${esc(clock)}` : ''}</div>
      <div><span class="k">Service</span>${esc(serviceName(ctx, v.service_type_id) || 'Pest control')}</div>
      <div><span class="k">Technician</span>${esc(t.name || '')}${t.license_no ? ` (Lic. ${esc(t.license_no)})` : ''}</div>
      ${v.target_pests ? `<div><span class="k">Target pests</span>${esc(v.target_pests)}</div>` : ''}
      ${v.areas_serviced ? `<div><span class="k">Areas treated</span>${esc(v.areas_serviced)}</div>` : ''}
      ${v.weather ? `<div><span class="k">Conditions</span>${esc(v.weather)}</div>` : ''}</div>
      ${products.length ? `<table class="grid"><thead><tr><th>Product</th><th>EPA Reg. No.</th><th class="num">Amount</th><th>Where applied</th></tr></thead><tbody>${products.map((x) => {
        const pr = list.find((y) => y.id === x.product_id) || {};
        return `<tr><td><b>${esc(pr.name || 'Product')}</b></td><td class="nowrap">${esc(pr.epa_reg || '')}</td><td class="num nowrap">${x.amount != null ? `${esc(x.amount)} ${esc(x.unit || pr.unit || '')}` : ''}</td><td>${esc(x.area || v.areas_serviced || '')}</td></tr>`;
      }).join('')}</tbody></table>` : '<p class="muted">No pesticide products were applied.</p>'}
      ${v.tech_notes ? `<h3>Technician notes</h3><p>${esc(v.tech_notes)}</p>` : ''}
      ${v.signature && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v.signature) ? `<div class="sig"><img src="${v.signature}" alt="Customer signature"><div class="small muted">Customer signature${v.customer_present ? ' (customer was present)' : ''}</div></div>` : ''}
      ${products.length ? '<p class="small safety">Stay off treated surfaces until they are dry, and keep children and pets away until then. Product labels and Safety Data Sheets are available on request. Questions about a product? Call us, or the National Pesticide Information Center at 1-800-858-7378.</p>' : ''}</section>`;
  }
  function page(ctx, title, body) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="stylesheet" href="${ctx.app || ''}/css/doc.css"></head>
<body><div class="toolbar"><button type="button" data-print>Print or save as PDF</button></div><main class="doc">${body}</main><script src="${ctx.app || ''}/js/doc.js"></script></body></html>`;
  }
  function addressOf(p) { return p ? `${esc(p.address)}<br>${esc([p.city, p.state].filter(Boolean).join(', '))} ${esc(p.zip || '')}` : ''; }
  function invoiceDoc(st, ctx, id, portal) {
    const inv = rowNow(st, ctx, 'invoices', id);
    if (!inv) return null;
    const s = settings(ctx);
    const c = customerNow(st, ctx, inv.customer_id) || {};
    const v = inv.visit_id ? rowNow(st, ctx, 'visits', inv.visit_id) : null;
    const mm = merged(st, ctx, inv.customer_id);
    const prop = v ? rowNow(st, ctx, 'properties', v.property_id) : mm.properties.slice().sort(by('id'))[0];
    const pays = mm.payments.filter((p) => p.invoice_id === inv.id).sort(by('date', 'id'));
    const due = round2(inv.amount - inv.amount_paid);
    const late = inv.status === 'open' && inv.due_date < ctx.today;
    const mark = inv.status === 'void' ? ['VOID', 'void'] : inv.status === 'paid' ? ['PAID', 'paid'] : late ? ['PAST DUE', 'late'] : ['DUE', 'due'];
    const subtotal = inv.subtotal ?? round2(inv.amount - (inv.tax || 0));
    const addr = addressOf(prop);
    const body = `${letterhead(s, 'Invoice', `<div class="small">Invoice #${inv.id}<br>Date: ${longDate(inv.date)}<br>Due: ${longDate(inv.due_date)}</div><div class="stamp ${mark[1]}">${mark[0]}</div>`)}
  <section class="two"><div><h3>Bill to</h3><b>${esc(nameOf(c) || 'Customer')}</b><br>${c.billing_address ? esc(c.billing_address).replace(/\n/g, '<br>') : addr}
    ${c.email ? `<br><span class="small">${esc(c.email)}</span>` : ''}${c.phone ? `<br><span class="small">${esc(c.phone)}</span>` : ''}</div>
    <div><h3>Service address</h3>${addr || '<span class="muted">Not on file</span>'}${v ? `<br><span class="small">Serviced ${longDate(v.date)}</span>` : ''}</div></section>
  <table class="grid lines"><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead><tbody>
    <tr><td><b>${esc(inv.description || 'Pest control service')}</b>${v && v.target_pests ? `<div class="small muted">Treated for: ${esc(v.target_pests)}</div>` : ''}</td><td class="num">1</td><td class="num">${money(subtotal)}</td></tr></tbody></table>
  <table class="totals"><tr><td>Subtotal</td><td>${money(subtotal)}</td></tr>${inv.tax ? `<tr><td>Sales tax (${Number(inv.tax_rate)}%)</td><td>${money(inv.tax)}</td></tr>` : ''}
    <tr class="strong"><td>Total</td><td>${money(inv.amount)}</td></tr>${inv.amount_paid ? `<tr><td>Paid</td><td>−${money(inv.amount_paid)}</td></tr>` : ''}
    <tr class="due"><td>Balance due</td><td>${money(inv.status === 'void' ? 0 : due)}</td></tr></table>
  ${pays.length ? `<h3>Payments</h3><table class="grid"><tbody>${pays.map((p) => `<tr><td>${longDate(p.date)}</td><td>${esc(p.method === 'autopay' ? 'Autopay (card on file)' : p.method)}${p.reference ? ` <span class="muted small">${esc(p.reference)}</span>` : ''}</td><td class="num">${money(p.amount)}</td></tr>`).join('')}</tbody></table>` : ''}
  ${v && v.status === 'completed' ? serviceBlock(st, ctx, v) : ''}
  <footer class="small muted">${Number(s.payment_terms_days) > 0 ? `Payment due within ${esc(s.payment_terms_days)} days. ` : ''}Thank you for your business!${portal ? '' : ` · Customer #${c.id}`}</footer>`;
    return page(ctx, `Invoice #${inv.id} - ${s.company_name || ''}`, body);
  }
  function reportDoc(st, ctx, id) {
    const v = rowNow(st, ctx, 'visits', id);
    if (!v || v.status !== 'completed') return null;
    const s = settings(ctx);
    const c = customerNow(st, ctx, v.customer_id) || {};
    const prop = rowNow(st, ctx, 'properties', v.property_id);
    const body = `${letterhead(s, 'Service report', `<div class="small">${longDate(v.date)}</div>`)}
  <section class="two"><div><h3>Customer</h3><b>${esc(nameOf(c) || 'Customer')}</b>${c.phone ? `<br><span class="small">${esc(c.phone)}</span>` : ''}</div>
    <div><h3>Service address</h3>${addressOf(prop) || '<span class="muted">Not on file</span>'}</div></section>
  ${serviceBlock(st, ctx, v)}`;
    return page(ctx, `Service report - ${nameOf(c)}`, body);
  }
  // Printable pages for invoices and visits changed here; recorded ones are shown as recorded.
  function doc(st, ctx, p, q) {
    if (!st.n) return null;
    ctx.memo = ctx.memo || new Map();
    q = q instanceof URLSearchParams ? q : new URLSearchParams(q || '');
    let m = /^\/api\/invoices\/(\d+)\/view$/.exec(p) || /^\/api\/portal\/[^/]+\/invoices\/(\d+)$/.exec(p);
    if (m && st.rows.invoices[m[1]]) return invoiceDoc(st, ctx, Number(m[1]), p.startsWith('/api/portal/'));
    m = /^\/api\/visits\/(\d+)\/report$/.exec(p) || (/^\/api\/portal\/[^/]+\/report$/.test(p) && q.get('visit') ? [null, q.get('visit')] : null);
    if (m && st.rows.visits[m[1]]) return reportDoc(st, ctx, Number(m[1]));
    return null;
  }

  // ---------- writes the demo doesn't keep ----------
  // Answered the way their screens expect, so nothing breaks; the page then says the change isn't kept.
  const SHAPES = [
    [/^\/api\/(notifications\/read|me\/location)$/, () => ({ ok: true }), true],
    // The portal's English / Español switch: the page remembers it in this browser.
    [/^\/api\/portal\/[^/]+\/lang$/, () => ({ ok: true }), true],
    [/^\/api\/customers\/\d+\/remind$/, () => ({ status: 'sent' })],
    [/^\/api\/reminders\/run$/, () => ({ sent: 0 })],
    [/^\/api\/routes\/reshuffle$/, () => ({ moved: 0, crews: [], stuck: [], applied: false, texted: 0 })],
    [/^\/api\/plans\/price-increase$/, () => ({ count: 0, notified: 0, extraPerYear: 0, changes: [] })],
  ];
  // Things that need a real account or outside service: a plain sentence beats a screen that half works.
  const REAL_ONLY = [
    [/^\/api\/(billing|qbo|stripe)(\/|$)/, 'Payment and accounting accounts connect once you have your own Nuvolve account.'],
    [/^\/api\/(me\/2fa|me\/password|reset-password|forgot|signup|users\/\d+\/reset-2fa)/, 'Demo logins stay as they are. Your own account gets its own passwords and two-step login.'],
    [/^\/api\/(import|migrate|merge)(\/|$)/, 'Importing and merging need your own account, so they are off in the demo.'],
    [/^\/api\/integrations\//, 'API keys and webhooks come with your own account.'],
    [/^\/api\/assistant$/, 'The assistant answers from a live account, so it is off in the demo.'],
    [/^\/api\/(docs\/designs|report-templates|estimates|sales\/quotes|termite\/wdi|inbox|campaigns|payroll\/runs)(\/|$)/,
      "This part of the demo doesn't save. Adding customers, completing stops and taking payments do."],
  ];
  // Lists an older recording may not have: start them empty so what was added here still shows.
  const empty = (p) => (/^\/api\/(payments|requests|visits\/missed)$/.test(p) ? [] : null);
  const NOTE = "This change isn't kept in the demo. Customers, stops, visits and payments are.";
  function fallback(method, p) {
    for (const [re, fn, quiet] of SHAPES) if (re.test(p)) return { s: 200, b: fn(), note: quiet ? null : NOTE };
    for (const [re, msg] of REAL_ONLY) if (re.test(p)) return { s: 400, b: { error: msg, demo: true }, note: null };
    return { s: 200, b: { ok: true }, note: NOTE };
  }

  // Whether patch() may change this page's recorded answer (other answers are sent as recorded).
  const touches = (p) => PATCH.some(([re]) => re.test(p));
  const api = { FORMAT, version, fresh, write, patch, touches, doc, fallback, empty, duplicates, blank, addDays, addMonths };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DemoOverlay = api;
})(typeof self !== 'undefined' ? self : this);

// The demo's stand-in for the Nuvolve server. GitHub Pages only serves files, so this service worker
// answers the app's API calls from answers the real server gave for a seeded demo company
// (see demo/record.js). Logins pick which role's answers to use. What a visitor adds or changes is kept
// in this browser by the overlay (demo/overlay.js, joined in front of this file) and laid over the answers.
const APP = new URL('./', self.location).pathname.replace(/\/$/, ''); // e.g. /nuvolve/app
const VERSION = 'mvywqowq';
const TODAY = '2026-11-02'; // the demo company's "today": the day it was recorded
const DATA = '2026-11-02T06:55:51.535Z'; // when it was recorded; a new recording starts every browser's changes over
const O = self.DemoOverlay;
const SESSION = 'nv-demo-session';
const EMAILS = { 'owner@demo.com': 'owner', 'office@demo.com': 'office', 'manager@demo.com': 'manager', 'mike@demo.com': 'tech', 'sales@demo.com': 'sales' };
const PASSWORD = 'demo1234';
const SHELLS = [[/^\/portal(\/|$)/, 'portal.html'], [/^\/review\//, 'review.html'], [/^\/tech\/?$/, 'tech.html'], [/^\/sell\/?$/, 'sell.html'],
  [/^\/developers\/?$/, 'developers.html'], [/^\/sign\//, 'sign.html'], [/^\/offer\//, 'offer.html'], [/^\/track\//, 'track.html'], [/^\/book\//, 'book.html']];
// Anyone can open these without logging in, the way customers do.
const PUBLIC = /^\/api\/(portal|sign|review|book|offer|track|setup-status|i18n\/|v1\/openapi\.json)/;
// The browser's clock moved to the demo company's day, the same way demo-boot.js moves the pages' clock.
const OFF = (() => {
  const [y, m, d] = TODAY.split('-').map(Number);
  const t = new Date();
  return Number.isFinite(y) ? new Date(y, m - 1, d).getTime() - new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() : 0;
})();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('nv-demo-data-') && k !== `nv-demo-data-${VERSION}`) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('message', (e) => {
  const type = e.data?.type;
  if (type === 'as') e.waitUntil(setRole(e.data.role).then(() => e.source?.postMessage({ type: 'as-done' })));
  if (type === 'demo-state') e.waitUntil(getState().then((st) => e.source?.postMessage({ type: 'demo-state', n: st.n })));
  if (type === 'demo-reset') e.waitUntil(serial(resetState).then(() => tellAll({ type: 'demo-state', n: 0, reset: true })));
});

let role; // undefined: not read yet
const maps = {};
async function getRole() {
  if (role !== undefined) return role;
  const r = await (await caches.open(SESSION)).match('/session');
  role = r ? (await r.json()).role : null;
  return role;
}
async function setRole(r) {
  role = r || null;
  const c = await caches.open(SESSION);
  if (role) await c.put('/session', json({ role }));
  else await c.delete('/session');
}
// The tech app and the door-to-door app open as the demo's technician and sales rep, whoever is logged in
// to the office, so a change made in one tab shows up in the other.
async function roleFor(e) {
  const who = await getRole();
  if (!who) return who;
  const c = e.clientId ? await self.clients.get(e.clientId) : null;
  const page = c ? new URL(c.url).pathname.slice(APP.length) : '';
  if (/^\/tech(\/|\.html|$)/.test(page)) return 'tech';
  if (/^\/sell(\/|\.html|$)/.test(page)) return 'sales';
  return who;
}
async function data(name) {
  if (!maps[name]) {
    maps[name] = (async () => {
      const cache = await caches.open(`nv-demo-data-${VERSION}`);
      const url = `${APP}/demo-data/${name}.json?v=${VERSION}`;
      let res = await cache.match(url);
      if (!res) { res = await fetch(url); if (res.ok) await cache.put(url, res.clone()); }
      return res.ok ? res.json() : {};
    })();
  }
  return maps[name];
}

// ---------- what this browser changed (demo/overlay.js), kept in IndexedDB ----------
let dbp, state = null, chain = Promise.resolve();
function idb(op, key, val) {
  dbp = dbp || new Promise((ok, no) => {
    const r = indexedDB.open('nv-demo-overlay', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
  return dbp.then((db) => new Promise((ok, no) => {
    const tx = db.transaction('kv', op === 'get' ? 'readonly' : 'readwrite');
    const s = tx.objectStore('kv');
    const r = op === 'get' ? s.get(key) : op === 'put' ? s.put(val, key) : op === 'delete' ? s.delete(key) : s.clear();
    tx.oncomplete = () => ok(r.result);
    tx.onerror = tx.onabort = () => no(tx.error);
  }));
}
async function getState() {
  if (state) return state;
  let st = null;
  try { st = await idb('get', 'state'); } catch { /* storage is off (private window): changes last while the worker runs */ }
  if (!st || st.v !== O.version(DATA)) {
    if (st) await idb('clear').catch(() => {});
    st = O.fresh(O.version(DATA));
  }
  return (state = st);
}
async function resetState() {
  state = O.fresh(O.version(DATA));
  await idb('clear').catch(() => {});
}
// One save at a time, so two tabs can't both take the next id.
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}
async function tellAll(msg) {
  for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage(msg);
}
async function tell(clientId, msg) {
  const c = clientId && await self.clients.get(clientId);
  if (c) c.postMessage(msg);
}
function parsed(m, k) {
  const a = m[k];
  if (!a || a.s !== 200 || a.enc) return null;
  try { return JSON.parse(a.b); } catch { return null; }
}
const small = new Map();
// What the overlay may look up: this role's answers first, then the owner's (who sees every customer).
async function context(who, loc) {
  const [index, own, boss, pub] = await Promise.all([data('index'), who ? data(who) : {}, data('owner'), data('public')]);
  const boot = parsed(own, 'GET /api/bootstrap') || parsed(boss, 'GET /api/bootstrap') || {};
  const seen = new Map();
  return {
    today: TODAY, now: Date.now() + OFF, role: who, me: (who && boot.me) || {}, loc: loc || null, boot, index, app: APP, memo: new Map(),
    find(k) {
      if (!seen.has(k)) seen.set(k, parsed(own, k) || parsed(boss, k));
      return seen.get(k);
    },
    // The smallest recorded answer whose key matches: an empty-looking page of the same kind.
    similar(re) {
      const k = `${who}|${re.source}`;
      if (!small.has(k)) {
        let best = null;
        for (const m of [own, pub, boss]) {
          for (const key of Object.keys(m)) {
            const a = m[key];
            if (a.s === 200 && !a.enc && re.test(key) && (!best || a.b.length < best.length)) best = a.b;
          }
          if (best) break;
        }
        small.set(k, best);
      }
      try { return small.get(k) ? JSON.parse(small.get(k)) : null; } catch { return null; }
    },
  };
}
// Addresses typed without picking a suggestion get a map pin the way the server finds one.
async function placeAddress(method, p, b) {
  const target = method === 'POST' && p === '/api/customers' ? b.property
    : (method === 'POST' && /^\/api\/customers\/\d+\/properties$/.test(p)) || (method === 'PUT' && /^\/api\/properties\/\d+$/.test(p)) ? b : null;
  if (!target || !target.address || (target.lat != null && target.lat !== '')) return;
  const q = [target.address, target.city, target.state, target.zip].filter(Boolean).join(', ');
  try {
    const hit = (await getJson(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, 4000))[0];
    if (hit) Object.assign(target, { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) });
  } catch { /* no pin: the stop just isn't on the map */ }
}
async function save(req, p, who, loc, clientId) {
  const body = /json/.test(req.headers.get('Content-Type') || '') ? await req.json().catch(() => ({})) : {};
  const key = req.headers.get('Idempotency-Key');
  const st = await getState();
  // The tech app's outbox may send a save again after a dropped connection: answer it the same way.
  if (key && st.keys[key]) return json(st.keys[key].b, st.keys[key].s);
  await placeAddress(req.method, p, body);
  const next = structuredClone(st);
  const out = O.write(next, await context(who, loc), req.method, p, body);
  if (!out) {
    const f = O.fallback(req.method, p);
    if (f.note) tell(clientId, { type: 'demo-note', text: f.note });
    return json(f.b, f.s);
  }
  if (out.s !== 200) return json(out.b, out.s);
  if (key) {
    next.keys[key] = { s: out.s, b: out.b };
    const ks = Object.keys(next.keys);
    if (ks.length > 300) delete next.keys[ks[0]];
  }
  try {
    if (out.blob) await idb('put', `photo:${out.blob.id}`, out.blob.data);
    if (out.drop) await idb('delete', `photo:${out.drop}`);
    await idb('put', 'state', next);
  } catch { /* storage is off: keep the change while the worker runs */ }
  state = next;
  tellAll({ type: 'demo-state', n: next.n });
  return json(out.b);
}
async function photo(id, mime) {
  const url = await idb('get', `photo:${id}`).catch(() => null);
  if (!url) return json({ error: 'Photo not found' }, 404);
  return new Response(await (await fetch(url)).blob(), { headers: { 'Content-Type': mime || 'image/jpeg', 'Cache-Control': 'no-store' } });
}
// A recorded answer, with this browser's changes laid over it.
async function finish(hit, st, who, loc, p, url) {
  if (!st.n || hit.enc || hit.s !== 200 || !/json/.test(hit.t || '') || !O.touches(p)) return replay(hit);
  let body;
  try { body = JSON.parse(hit.b); } catch { return replay(hit); }
  try { return json(O.patch(st, await context(who, loc), p, url.searchParams, body)); }
  catch (err) { return json({ error: err.message }, err.status || 500); }
}

// Previews that change nothing: the acquisition preview, route plans and route handoffs. The recorder kept
// them for every choice the screen offers; hand moves are laid on top here.
const PLANS = /^\/api\/(merge\/preview|merge\/routes|routes\/handoff)$/;
function planKey(p, b) { // keep in step with planKey in demo/record.js
  if (p === '/api/routes/handoff') return `POST ${p} #${b.tech_id}|${b.to || 'territory'}`;
  const t = (b.routes && b.routes.techs) || {};
  const techs = Object.keys(t).sort().map((k) => `${k}=${t[k]}`).join(',');
  return `POST ${p} #${techs}|${b.location_mode || 'one'}|${b.new_location ? 'new' : b.location_id || ''}|${b.duplicates || 'merge'}`;
}
async function planned(p, b) {
  const who = await getRole();
  if (!who) return null;
  const m = await data(who);
  if (p === '/api/merge/preview') return m[`POST ${p}`] ? replay(m[`POST ${p}`]) : null;
  const key = planKey(p, b);
  const near = Object.keys(m).filter((k) => k.startsWith(`POST ${p} #`));
  const pick = m[key] ? key : near.find((k) => k.split('|')[0] === key.split('|')[0]) || near[0];
  if (!pick) return null;
  const plan = JSON.parse(m[pick].b);
  const over = (b.overrides || (b.routes && b.routes.overrides)) || {};
  for (const s of plan.stops || []) {
    const to = over[s.key];
    const c = to && (plan.choices || []).find((x) => x.key === to);
    if (!c || s.to === c.key) continue;
    for (const cr of plan.crews) {
      if (cr.key === s.to) { cr.added--; cr.after--; }
      if (cr.key === c.key) { cr.added++; cr.after++; }
    }
    Object.assign(s, { to: c.key, to_name: c.name, to_color: c.color, reason: `Moved by hand to ${c.name}`, override: true, warning: null });
  }
  return json(plan, m[pick].s);
}

// The booking form's open times: the recorder kept what the company had open for each service, at an
// address it serves. Every address typed here gets those times; booking one sends a request.
const OPENINGS = /^\/api\/book\/[^/]+\/openings$/;
function openKey(p, b) { return `POST ${p} #${Number(b.service_type_id) || ''}`; } // keep in step with openKey in demo/record.js
async function openTimes(req, p) {
  const b = await req.clone().json().catch(() => ({}));
  if (!String(b.address || '').trim() || !String(b.zip || '').trim()) return json({ error: 'Add the service address and zip first' }, 400);
  const m = await data('public');
  const hit = m[openKey(p, b)] || m[openKey(p, {})];
  return hit ? replay(hit) : json({ mode: 'off', days: [] });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
function replay(a) {
  const body = a.enc === 'base64' ? Uint8Array.from(atob(a.b), (c) => c.charCodeAt(0)) : a.b;
  return new Response(body, { status: a.s, headers: { 'Content-Type': a.t || 'application/json', 'Cache-Control': 'no-store' } });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(APP + '/')) return;
  const p = url.pathname.slice(APP.length);
  if (p.startsWith('/api/')) return e.respondWith(api(e.request, url, p, e));
  if (e.request.mode === 'navigate') {
    const shell = SHELLS.find(([re]) => re.test(p));
    if (shell) return e.respondWith(fetch(`${APP}/${shell[1]}`));
  }
});

async function api(req, url, p, e) {
  const method = req.method;
  if (method === 'POST' && p === '/api/login') {
    const b = await req.json().catch(() => ({}));
    const r = EMAILS[String(b.email || '').trim().toLowerCase()];
    if (!r || b.password !== PASSWORD) return json({ error: 'That email and password don\'t match a demo login. The logins are on the Nuvolve home page.' }, 401);
    await setRole(r);
    const rec = (await data(r))['POST /api/login'];
    return rec ? replay(rec) : json({ ok: true, role: r === 'sales' ? 'sales' : r === 'tech' ? 'tech' : r });
  }
  if (method === 'POST' && p === '/api/logout') { await setRole(null); return json({ ok: true }); }
  const who = await roleFor(e);
  const loc = req.headers.get('X-Location') || '';
  if (method !== 'GET' && method !== 'HEAD') {
    if (PLANS.test(p)) {
      const b = await req.clone().json().catch(() => ({}));
      if (!b.apply) {
        const hit = await planned(p, b);
        if (hit) return hit;
      }
    }
    if (OPENINGS.test(p)) return openTimes(req, p);
    if (!who && !PUBLIC.test(p)) return json({ error: 'Please log in' }, 401);
    // "Optimize" keeps the stops where they are in the demo and shows the route as it stands.
    if (p === '/api/routes/optimize') {
      const b = await req.clone().json().catch(() => ({}));
      if (b.tech_id === 'all') return json({ ok: true, routes: 0 });
      const u = new URL(`${APP}/api/routes?date=${encodeURIComponent(b.date || TODAY)}&tech_id=${encodeURIComponent(b.tech_id || '')}`, location.origin);
      return read(u, '/api/routes', who, loc);
    }
    return serial(() => save(req, p, who, loc, e.clientId));
  }

  // The address under a map pin and address suggestions come live from OpenStreetMap, the way the server
  // does it without a Google key, so the door-to-door app fills in real addresses anywhere.
  if (p === '/api/sales/reverse') return json(await osmReverse(url.searchParams.get('lat'), url.searchParams.get('lng')));
  if (p === '/api/address-suggest') return json(await osmSuggest(url.searchParams.get('q'), url.searchParams.get('lat'), url.searchParams.get('lng')));
  // A visit moved to a picked time isn't kept in the demo, so the portal asks for a better day instead.
  if (/^\/api\/portal\/[^/]+\/openings$/.test(p)) return json({ mode: 'off', days: [] });
  return read(url, p, who, loc);
}

async function read(url, p, who, loc) {
  const st = await getState();
  const key = `GET ${p}${url.search}`;
  const sources = [];
  if (who) sources.push(await data(who));
  if (PUBLIC.test(p) || !who) sources.push(await data('public'));
  if (st.n && (who || PUBLIC.test(p))) {
    // Photos taken and documents changed in this browser.
    const ph = /^\/api\/(?:portal\/[^/]+\/)?photos\/(\d+)$/.exec(p);
    if (ph && st.rows.photos[ph[1]]) return photo(ph[1], st.rows.photos[ph[1]].set.mime);
    const html = O.doc(st, await context(who, loc), p, url.searchParams);
    if (html) return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  const m = sources[0];
  if (p === '/api/customers/duplicates' && who) {
    try { return json(O.duplicates(st, await context(who, loc), (baseList(m, 'all') || {}).list, url.searchParams)); } catch { /* answer as recorded */ }
  }
  for (const src of sources) {
    const hit = (loc && src[`${key} @${loc}`]) || src[key];
    if (hit) return finish(hit, st, who, loc, p, url);
  }
  if (!who && !PUBLIC.test(p)) return json({ error: 'Please log in' }, 401);
  const search = await customerSearch(m, p, url, st, who, loc);
  if (search) return json(search);
  // Pages for things added in this browser (a new customer's page and its cards) before any look-alike.
  if (st.n) {
    try {
      const made = O.patch(st, await context(who, loc), p, url.searchParams, null);
      if (made != null) return json(made);
    } catch (err) { return json({ error: err.message }, err.status || 500); }
  }
  const near = closest(m, p, url, loc);
  if (near) return finish(near, st, who, loc, p, url);
  if (st.n && O.empty(p)) return json(O.patch(st, await context(who, loc), p, url.searchParams, O.empty(p)));
  // Printable documents look the same for every office role.
  if (who !== 'owner' && /\/view$|\/print$/.test(p)) {
    const o = await data('owner');
    if (o[key]) return replay(o[key]);
  }
  return json({ error: "That part isn't in the demo yet. Everything on the main pages is." }, 404);
}

// A recorded customer list (no search words) for a status: the base the search box filters.
function baseList(m, status) {
  const k = ['all', status, 'active'].map((st) => Object.keys(m).find((x) => x.startsWith('GET /api/customers?') && new URLSearchParams(x.split('?')[1].split(' @')[0]).get('q') === '' &&
    (new URLSearchParams(x.split('?')[1].split(' @')[0]).get('status') || 'active') === st)).find(Boolean);
  if (!k) return null;
  try { return { list: JSON.parse(m[k].b), status: new URLSearchParams(k.split('?')[1].split(' @')[0]).get('status') || 'active' }; } catch { return null; }
}
// The customer search box: filter a recorded customer list the way the server would.
async function customerSearch(m, p, url, st, who, loc) {
  if (p !== '/api/customers' || !url.searchParams.get('q')) return null;
  const q = url.searchParams.get('q').trim().toLowerCase();
  const status = url.searchParams.get('status') || 'active';
  const base = baseList(m, status);
  if (!base) return null;
  let list = base.list;
  if (st.n) list = O.patch(st, await context(who, loc), '/api/customers', new URLSearchParams({ q: '', status: base.status }), list);
  const rows = Array.isArray(list) ? list : list.customers || list.rows || [];
  const digits = q.replace(/\D/g, '');
  const hit = rows.filter((r) => {
    if (status !== 'all' && base.status !== status && r.status && r.status !== status) return false;
    const s = JSON.stringify(r).toLowerCase();
    return s.includes(q) || (digits.length >= 3 && s.replace(/\D/g, '').includes(digits));
  });
  return Array.isArray(list) ? hit : { ...list, [list.customers ? 'customers' : 'rows']: hit };
}

// Same page, different filter or date: answer with the recorded one that differs the least.
function closest(m, p, url, loc) {
  const want = new URLSearchParams(url.search);
  let best = null, bestScore = -1;
  for (const k of Object.keys(m)) {
    if (!k.startsWith(`GET ${p}?`) && k !== `GET ${p}` && !k.startsWith(`GET ${p} @`)) continue;
    const [pathq, at] = k.slice(4).split(' @');
    if (pathq.split('?')[0] !== p) continue;
    const have = new URLSearchParams(pathq.split('?')[1] || '');
    let score = (at || '') === loc ? 0.5 : 0;
    for (const [n, v] of want) if (have.get(n) === v) score += 1;
    if (score > bestScore) { best = m[k]; bestScore = score; }
  }
  return best;
}

const STATES = { alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC' };
const stateCode = (s) => STATES[String(s || '').toLowerCase()] || s || '';
const okNum = (v, max) => { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) && Math.abs(n) <= max ? n : null; };
async function getJson(u, ms = 6000) {
  const r = await fetch(u, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
async function osmReverse(lat, lng) {
  lat = okNum(lat, 90); lng = okNum(lng, 180);
  if (lat == null || lng == null) return null;
  try {
    const a = (await getJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lng}`)).address;
    if (a && (a.road || a.house_number)) {
      return { address: [a.house_number, a.road].filter(Boolean).join(' '), city: a.city || a.town || a.village || a.hamlet || a.suburb || a.county || '',
        state: stateCode(a.state), zip: (a.postcode || '').slice(0, 10) };
    }
  } catch { /* try Photon */ }
  try {
    const p = (await getJson(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=1&lang=en`)).features?.[0]?.properties;
    return p ? { address: [p.housenumber, p.street || p.name].filter(Boolean).join(' '), city: p.city || p.town || p.village || p.county || '', state: stateCode(p.state), zip: p.postcode || '' } : null;
  } catch { return null; }
}
async function osmSuggest(q, lat, lng) {
  q = String(q || '').trim().slice(0, 200);
  if (q.length < 4) return [];
  lat = okNum(lat, 90); lng = okNum(lng, 180);
  // Without the rep's spot, look around the demo company in Richardson, TX.
  if (lat == null || lng == null) { lat = 32.9483; lng = -96.7299; }
  try {
    const d = await getJson(`https://photon.komoot.io/api/?limit=6&lang=en&q=${encodeURIComponent(q)}&lat=${lat}&lon=${lng}`);
    return (d.features || []).filter((f) => f.properties.countrycode === 'US' && (f.properties.housenumber || f.properties.street)).map((f) => {
      const p = f.properties;
      const address = [p.housenumber, p.street || p.name].filter(Boolean).join(' ');
      const state = stateCode(p.state);
      return { address, city: p.city || p.town || p.village || p.county || '', state, zip: p.postcode || '',
        lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: [address, p.city || p.town || p.village, state, p.postcode].filter(Boolean).join(', ') };
    });
  } catch { return []; }
}
