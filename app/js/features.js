// Nuvolve feature modules (built from public/js/features/).
/* ---- features/billing-price.js ---- */
try { (function () {
// Yearly price increases (the server side is src/features/billing-price.js). #/price-increases takes over the
// Billing page's "Raise prices" button (NV.override('prices.raise')): who goes up, who keeps their price, a preview
// with the totals, the notice letter with merge fields, the start date, the history, printing and undo.
// The plan form gets a "keep this price until" date (a price lock), and the customer page shows a change on the way.

const FREQS = [['monthly', 'Monthly'], ['bimonthly', 'Every 2 months'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']];
const STATUS = { scheduled: ['Scheduled', 'blue'], applied: ['Started', 'green'], undone: ['Undone', ''] };
const FIELD_HELP = { first_name: 'first name', name: 'full name', company: 'your company', company_phone: 'your phone', effective_date: 'start date',
  changes: 'each plan, old and new price', service: 'service', old_price: 'old price', new_price: 'new price', difference: 'how much more', address: 'service address' };
const LETTER = ['subject', 'body', 'subject_es', 'body_es'];
const statusPill = (s) => { const [label, cls] = STATUS[s] || [s, '']; return `<span class="pill ${cls}">${esc(label)}</span>`; };
const ruleText = (x) => [x.percent ? `+${x.percent}%` : '', x.amount ? `+${money(x.amount)} a visit` : ''].filter(Boolean).join(' and ')
  + (x.round_to ? `, rounded to ${x.round_to === 5 ? '$5' : 'whole dollars'}` : '');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const letterBox = (l) => (l ? `<div class="small muted">Subject: <b style="color:var(--ink)">${esc(l.subject)}</b></div>
  <div style="white-space:pre-wrap;border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin-top:6px;background:#fff;font-size:14px">${esc(l.text)}</div>` : '');

NV.override('prices.raise', () => { location.hash = '#/price-increases?new=1'; });

// A price lock on the plan: price increases skip it through that day.
NV.slot('plan.form', ({ p, editing }) => `<div class="field"><label>Keep this price until (optional)</label>
  <input type="date" name="price_locked_until" value="${esc(editing ? p?.price_locked_until || '' : '')}">
  <div class="hint">A price lock: yearly price increases skip this plan through that day.</div></div>`);

NV.slot('customer.alerts', ({ c }) => (c.price_increases || []).filter((x) => x.status === 'pending').map((x) => {
  const letter = x.notice === 'sent' ? 'They got the letter.' : x.notice === 'no_contact' ? 'No email or phone on file: print the letter and mail it.'
    : x.notice === 'failed' ? "The letter didn't go out." : x.notify ? 'The letter has not gone out yet.' : 'No letter for this one.';
  return `<div class="alert info"><span>📈 Price going up ${esc(fmtDate(x.effective_date))}: ${money(x.old_price)} → <b>${money(x.new_price)}</b> a visit. ${esc(letter)}</span>
    ${BOOT.me.isAdmin ? `<a class="btn sm" href="#/price-increases/${x.increase_id}">Open</a>` : ''}</div>`;
}).join(''));

// ---------- #/price-increases ----------
NV.page('price-increases', async (view, id, params) => {
  if (!BOOT.me.isAdmin) { view.innerHTML = '<div class="alert warn"><span>Only owners and admins can raise prices.</span></div>'; return; }
  if (id) return detailPage(view, Number(id));
  const d = await api('/nuvolve/app/api/price-increases');
  const open = params.new === '1' || !d.increases.length;
  view.innerHTML = `
    <div class="small" style="margin-bottom:8px"><a href="#/billing">← Billing</a></div>
    <div class="page-head"><div><h1>Price increases</h1><div class="muted">Raise prices on recurring plans with notice: the letters go out before the start date, and the new price starts that day.</div></div>
      <div class="actions">${open ? '' : '<button class="btn primary" id="pi-start">+ New price increase</button>'}</div></div>
    <div id="pi-new"></div>
    ${d.increases.length ? `<div class="card flush"><div class="card-head" style="padding:14px 16px 0"><h2>History</h2></div><div class="table-wrap"><table class="list">
      <thead><tr><th>Increase</th><th>Starts</th><th class="right">Plans</th><th class="right">More a year</th><th>Letters</th><th>Status</th><th></th></tr></thead><tbody>
      ${d.increases.map((x) => `<tr class="click" data-open="${x.id}"><td><b>${esc(x.name || ruleText(x))}</b><div class="small muted">${x.name ? `${esc(ruleText(x))} · ` : ''}made ${esc(fmtDate(String(x.created_at || '').slice(0, 10)))}${x.created_by_name ? ` by ${esc(x.created_by_name)}` : ''}</div></td>
        <td class="nowrap">${esc(fmtDate(x.effective_date))}</td><td class="right">${x.plans}<div class="small muted">${plural(x.customers, 'customer')}</div></td>
        <td class="right">${money(x.extra_per_year)}</td>
        <td class="small">${!x.notify ? 'No letter' : x.notices_sent_at ? `${x.notices.sent || 0} sent${x.notices.no_contact ? `, ${x.notices.no_contact} to mail` : ''}` : x.status === 'undone' ? '—' : `Go out ${esc(fmtDate(x.notice_on))}`}</td>
        <td>${statusPill(x.status)}</td><td class="right"><a class="btn sm" href="#/price-increases/${x.id}">Open</a></td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
  $$('[data-open]', view).forEach((tr) => (tr.onclick = (e) => { if (!e.target.closest('a')) location.hash = `#/price-increases/${tr.dataset.open}`; }));
  if (open) newForm($('#pi-new', view), d);
  else $('#pi-start', view).onclick = (e) => { e.target.remove(); newForm($('#pi-new', view), d); };
});

function newForm(box, d) {
  const letter = d.defaults.last || d.defaults;
  const excluded = new Set();
  const chips = (kind, list) => list.map(([v, label]) => `<button type="button" class="chip" data-${kind}="${esc(String(v))}">${esc(label)}</button>`).join('');
  const services = (BOOT.serviceTypes || []).map((s) => [s.id, s.name]);
  const branches = (BOOT.locations || []).length > 1 ? BOOT.locations.map((l) => [l.id, l.name]) : [];
  const days = Number(d.defaults.notice_days ?? 30);
  box.innerHTML = `<div class="card">
    <form id="pi-form" autocomplete="off">
      <h2>New price increase</h2>
      <h3>1. How much</h3>
      <div class="row">
        <div class="field"><label>Percent</label><input name="percent" type="number" step="0.1" min="0" max="50" value="4"></div>
        <div class="field"><label>Or a flat amount per visit ($)</label><input name="amount" type="number" step="0.01" min="0" max="500" placeholder="0"></div>
        <div class="field"><label>Round new prices to</label><select name="round"><option value="0">Cents</option><option value="1" selected>Whole dollar</option><option value="5">$5</option></select></div>
      </div>
      <h3>2. Who goes up</h3>
      <p class="hint" style="margin-top:-6px">Pick nothing to raise every active recurring plan.</p>
      ${services.length ? `<div class="field"><label>Services</label><div class="chips">${chips('svc', services)}</div></div>` : ''}
      <div class="field"><label>How often</label><div class="chips">${chips('freq', FREQS)}</div></div>
      ${branches.length ? `<div class="field"><label>Branches</label><div class="chips">${chips('loc', branches)}</div></div>` : ''}
      <div class="row">
        <div class="field"><label>Zip codes</label><input name="zips" placeholder="78701, 78704, 787"><div class="hint">A short one like 787 matches every zip that starts with it.</div></div>
        <div class="field"><label>Price per visit from ($)</label><input name="min_price" type="number" step="0.01" min="0" placeholder="any"></div>
        <div class="field"><label>Up to ($)</label><input name="max_price" type="number" step="0.01" min="0" placeholder="any"></div>
      </div>
      <div class="row">
        <div class="field"><label>Customer since before</label><input name="customer_since_before" type="date"></div>
        <div class="field"><label>Customer since on or after</label><input name="customer_since_after" type="date"></div>
        <div class="field"><label>Last raised before</label><input name="last_increase_before" type="date"><div class="hint">Leaves out plans raised since that day.</div></div>
      </div>
      <h3>3. Who keeps their price</h3>
      <div class="row" style="max-width:420px">
        <div class="field"><label>Plans that started in the last (months)</label><input name="new_months" type="number" min="0" max="60" step="1" value="6">
          <div class="hint">New customers keep the price they signed up at. 0 raises them too.</div></div>
      </div>
      <p class="hint">Plans with a price lock ("Keep this price until" on the plan) keep their price through that day. To leave someone out by hand, untick them in the preview.</p>
      <h3>4. When, and the letter</h3>
      <div class="row">
        <div class="field"><label>New price starts</label><input name="effective_date" type="date" min="${esc(d.today)}" value="${esc(addDays(d.today, days + 14))}"></div>
        <div class="field"><label>Send the letter (days before)</label><input name="notice_days" type="number" min="0" max="120" step="1" value="${days}"></div>
        <div class="field"><label>Name for your list (optional)</label><input name="name" maxlength="100" placeholder="${esc(String(Number(d.today.slice(0, 4)) + 1))} price increase"></div>
      </div>
      <label class="check"><input type="checkbox" name="notify" checked> Send each customer a notice letter (email, or a text when there's no email), in Spanish for Spanish speakers</label>
      <div id="pi-letter" style="margin-top:10px">
        <div class="field"><label>Subject</label><input name="subject" maxlength="200" value="${esc(letter.subject)}"></div>
        <div class="field"><label>Letter</label><textarea name="body" rows="12" maxlength="6000">${esc(letter.body)}</textarea></div>
        <div class="hint" style="margin:-4px 0 6px">Merge fields (tap to add where the cursor is):</div>
        <div class="chips" style="margin-bottom:10px">${d.defaults.fields.map((f) => `<button type="button" class="chip" data-field="${esc(f)}" title="${esc(FIELD_HELP[f] || f)}">{${esc(f)}}</button>`).join('')}</div>
        <details><summary class="small" style="cursor:pointer;font-weight:600">Spanish letter, for customers who speak Spanish</summary>
          <div class="field" style="margin-top:8px"><label>Subject (Spanish)</label><input name="subject_es" maxlength="200" value="${esc(letter.subject_es)}"></div>
          <div class="field"><label>Letter (Spanish)</label><textarea name="body_es" rows="12" maxlength="6000">${esc(letter.body_es)}</textarea></div></details>
        <p class="small"><button type="button" class="link-btn" id="pi-reset">Use the standard letter</button> · Customers with no email or phone get a printed letter (from the history, after you schedule).</p>
      </div>
      <div class="actions"><button class="btn primary">Preview</button></div>
    </form>
    <div id="pi-preview" style="margin-top:14px"></div></div>`;
  const form = $('#pi-form', box), out = $('#pi-preview', box);
  let lastText = $('[name=body]', form), stale = true, last = null;
  const picked = (kind) => $$(`[data-${kind}].on`, form).map((b) => b.dataset[kind]);
  const bodyOf = () => ({ ...formData(form), service_type_ids: picked('svc').map(Number), frequencies: picked('freq'), location_ids: picked('loc').map(Number),
    exclude_customer_ids: [...excluded] });
  const showLetter = () => { $('#pi-letter', box).style.display = $('[name=notify]', form).checked ? '' : 'none'; };

  $$('.chip[data-svc], .chip[data-freq], .chip[data-loc]', form).forEach((b) => (b.onclick = () => { b.classList.toggle('on'); changed(); }));
  $$('[data-field]', form).forEach((b) => (b.onclick = () => {
    const el = lastText, tag = `{${b.dataset.field}}`;
    const at = el.selectionStart ?? el.value.length;
    el.value = el.value.slice(0, at) + tag + el.value.slice(el.selectionEnd ?? at);
    el.focus();
    el.selectionStart = el.selectionEnd = at + tag.length;
  }));
  for (const k of LETTER) $(`[name=${k}]`, form).addEventListener('focus', (e) => { lastText = e.target; });
  $('#pi-reset', form).onclick = () => { for (const k of LETTER) $(`[name=${k}]`, form).value = d.defaults[k]; toast('Standard letter back in'); };
  // Who goes up changed: the preview no longer matches. The letter can change without a new preview.
  function changed(e) {
    if (e && LETTER.includes(e.target.name)) return;
    if (e?.target?.name === 'notify') showLetter();
    if (!last) return;
    stale = true;
    const go = $('#pi-go', out);
    if (go) { go.disabled = true; go.textContent = 'Preview again first'; }
    $('#pi-stale', out)?.classList.remove('hidden');
  }
  form.addEventListener('input', changed);
  form.addEventListener('change', changed);
  showLetter();

  async function preview() {
    const keep = $('#pi-rows', out)?.scrollTop || 0;
    const p = await api('/nuvolve/app/api/price-increases/preview', { body: bodyOf() });
    last = p; stale = false;
    const t = p.totals;
    const skippedN = p.skipped.length;
    const reasons = Object.entries(t.skipped).map(([k, n]) => `${n} ${{ locked: 'price locked', new: 'started recently', excluded: 'left out', pending: 'in another increase', no_change: 'no change after rounding' }[k] || k}`).join(', ');
    const growth = t.book_annual ? Math.round(((t.book_after - t.book_annual) / t.book_annual) * 1000) / 10 : 0;
    out.innerHTML = `<h2>Preview</h2>
      <div id="pi-stale" class="alert warn hidden"><span>You changed who goes up. Preview again before you schedule it.</span></div>
      <div class="stats">
        <div class="stat"><div class="label">Plans going up</div><div class="value">${t.plans}</div><div class="sub">${plural(t.customers, 'customer')}</div></div>
        <div class="stat"><div class="label">More a year</div><div class="value">${money(t.extra_per_year)}</div><div class="sub">${money(t.before_annual)} → ${money(t.after_annual)} on these plans</div></div>
        <div class="stat"><div class="label">Recurring revenue a year</div><div class="value">${money(t.book_after)}</div><div class="sub">up from ${money(t.book_annual)}${growth ? ` (+${growth}%)` : ''}</div></div>
        <div class="stat"><div class="label">Keep their price</div><div class="value">${skippedN}</div><div class="sub">${esc(reasons || 'nobody')}</div></div>
      </div>
      ${p.notice.notify ? `<div class="alert ${p.notice.short ? 'warn' : 'info'}"><span>✉️ Letters go out <b>${esc(fmtDate(p.notice.on))}</b>, and the new price starts <b>${esc(fmtDate(p.effective))}</b>.
        ${p.notice.short ? `That's less than the ${plural(p.notice.days, 'day')} you asked for, so they go out as soon as you schedule it.` : ''}</span></div>`
        : `<div class="alert info"><span>No letter. The new price starts <b>${esc(fmtDate(p.effective))}</b>.</span></div>`}
      ${p.example ? `<div class="grid cols-2" style="margin-bottom:12px"><div><h3>The letter, for ${esc(p.example.customer_name)}</h3>${letterBox(p.example)}</div>
        <div><h3>In Spanish</h3>${letterBox(p.example.es)}</div></div>` : ''}
      ${p.changes.length ? `<h3>Going up <span class="small muted">(untick anyone to leave them out)</span></h3>
        <div class="table-wrap" id="pi-rows" style="max-height:380px;overflow:auto;border:1px solid var(--line);border-radius:8px"><table class="list small"><thead><tr><th></th><th>Customer</th><th>Service</th><th>How often</th><th class="right">Now</th><th class="right">New</th><th class="right">More a year</th></tr></thead><tbody>
        ${p.changes.map((c) => `<tr><td><input type="checkbox" checked data-keep="${c.customer_id}" aria-label="Raise ${esc(c.customer_name)}"></td>
          <td><a href="#/customers/${c.customer_id}" target="_blank" rel="noopener">${esc(c.customer_name)}</a>${c.lang === 'es' ? ' <span class="pill">ES</span>' : ''}${c.has_email ? '' : ' <span class="pill yellow" title="No email: a text, or a printed letter">no email</span>'}
            <div class="muted">${esc(c.address || '')}</div></td>
          <td>${esc(c.service || '')}</td><td>${esc((FREQS.find((f) => f[0] === c.frequency) || [0, c.frequency])[1])}</td>
          <td class="right">${money(c.old_price)}</td><td class="right"><b>${money(c.new_price)}</b></td><td class="right">${money((c.new_price - c.old_price) * c.per_year)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="alert warn"><span>No plans match. Change who goes up and preview again.</span></div>'}
      ${skippedN ? `<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:600">Keeping their price (${skippedN})</summary>
        <div class="table-wrap" style="max-height:300px;overflow:auto"><table class="list small"><thead><tr><th>Customer</th><th>Service</th><th class="right">Price</th><th>Why</th><th></th></tr></thead><tbody>
        ${p.skipped.map((s) => `<tr><td>${esc(s.customer_name)}</td><td>${esc(s.service || '')}</td><td class="right">${money(s.old_price)}</td>
          <td>${esc(s.reason_label || s.reason)}${s.reason === 'locked' && s.locked_until ? ` through ${esc(fmtDate(s.locked_until))}` : ''}</td>
          <td class="right">${s.reason === 'excluded' && excluded.has(s.customer_id) ? `<button type="button" class="btn sm" data-back="${s.customer_id}">Put back</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div></details>` : ''}
      ${p.changes.length ? `<div class="actions" style="margin-top:14px"><button type="button" class="btn primary" id="pi-go">Schedule it: ${plural(t.plans, 'plan')} go up ${esc(fmtDate(p.effective))}</button></div>
        <p class="small muted">Until the start date you can undo it from the history, and customers who already got the letter can be told it's off.</p>` : ''}`;
    if ($('#pi-rows', out)) $('#pi-rows', out).scrollTop = keep;
    $$('[data-keep]', out).forEach((cb) => (cb.onchange = () => { excluded.add(Number(cb.dataset.keep)); run(); }));
    $$('[data-back]', out).forEach((b) => (b.onclick = () => { excluded.delete(Number(b.dataset.back)); run(); }));
    if ($('#pi-go', out)) $('#pi-go', out).onclick = schedule;
  }
  const run = async () => { try { await preview(); } catch (e) { toast(e.message, true); } };
  form.onsubmit = (e) => { e.preventDefault(); run(); };

  async function schedule(e) {
    if (stale) return toast('Preview again first', true);
    const body = bodyOf();
    const go = async () => {
      e.target.disabled = true;
      try {
        const r = await api('/nuvolve/app/api/price-increases', { body });
        toast(r.applied ? `Done: ${plural(r.applied.applied, 'plan')} raised today` : `Scheduled: ${plural(r.increase.plans, 'plan')} go up ${fmtDate(r.increase.effective_date)}${r.notified ? `, ${r.notified} letters sent` : ''}`);
        location.hash = `#/price-increases/${r.id}`;
      } catch (err) { toast(err.message, true); e.target.disabled = false; }
    };
    if (last.effective <= d.today) {
      return modal('Raise prices today?', "<p>The start date is today, so the plans and their visits from today on change now. It can't be undone; you'd change prices plan by plan.</p>",
        [{ label: 'Cancel' }, { label: 'Raise them now', cls: 'primary', onClick: go }]);
    }
    return go();
  }
}

// ---------- one price increase ----------
async function detailPage(view, id) {
  const x = await api(`/nuvolve/app/api/price-increases/${id}`);
  const toMail = new Set(x.items.filter((i) => !i.has_email && i.status !== 'undone').map((i) => i.customer_id)).size;
  const n = x.notices || {};
  const f = x.cohort || {};
  const names = (ids, list) => (ids || []).map((v) => list.find((y) => y.id === Number(v))?.name || `#${v}`).join(', ');
  const who = [
    f.service_type_ids?.length ? names(f.service_type_ids, BOOT.serviceTypes || []) : 'every recurring service',
    f.frequencies?.length ? f.frequencies.map((k) => (FREQS.find((y) => y[0] === k) || [0, k])[1].toLowerCase()).join(', ') : '',
    f.location_ids?.length ? names(f.location_ids, BOOT.locations || []) : '',
    f.zips?.length ? `zips ${f.zips.join(', ')}` : '',
    f.min_price != null || f.max_price != null ? `${f.min_price != null ? money(f.min_price) : '$0'} to ${f.max_price != null ? money(f.max_price) : 'any'} a visit` : '',
    f.customer_since_before ? `customers since before ${fmtDate(f.customer_since_before)}` : '',
    f.customer_since_after ? `customers since ${fmtDate(f.customer_since_after)}` : '',
    f.last_increase_before ? `last raised before ${fmtDate(f.last_increase_before)}` : '',
    f.new_months ? `skipping plans started in the last ${plural(f.new_months, 'month')}` : '',
    f.exclude_customer_ids?.length ? `${plural(f.exclude_customer_ids.length, 'customer')} left out by hand` : '',
  ].filter(Boolean).join(' · ');
  const planStatus = (i) => ({ pending: '<span class="pill blue">Waiting</span>', applied: `<span class="pill green">Raised</span>${i.visits_changed ? ` <span class="small muted">${plural(i.visits_changed, 'visit')}</span>` : ''}`,
    skipped: `<span class="pill yellow">Skipped</span><div class="small muted">${esc(i.skip_reason || '')}</div>`, undone: '<span class="pill">Undone</span>' }[i.status] || esc(i.status));
  const letter = (i) => (!x.notify ? '<span class="muted">—</span>' : { sent: `<span class="pill green">Sent</span> <span class="small muted">${esc(fmtDate(String(i.notice_at || '').slice(0, 10)))}</span>`,
    no_contact: '<span class="pill yellow">Mail it</span>', failed: '<span class="pill red">Failed</span>', sending: '<span class="pill">Sending</span>' }[i.notice] || '<span class="muted">Not yet</span>');
  view.innerHTML = `
    <div class="small" style="margin-bottom:8px"><a href="#/price-increases">← Price increases</a></div>
    <div class="page-head"><div><h1>${esc(x.name || 'Price increase')} ${statusPill(x.status)}</h1>
      <div class="muted">${esc(ruleText(x))} · starts ${esc(fmtDate(x.effective_date))} · made ${esc(fmtDate(String(x.created_at || '').slice(0, 10)))}${x.created_by_name ? ` by ${esc(x.created_by_name)}` : ''}${x.undone_at ? ` · undone ${esc(fmtDate(String(x.undone_at).slice(0, 10)))}${x.undone_by_name ? ` by ${esc(x.undone_by_name)}` : ''}` : ''}</div></div>
      <div class="actions">${x.notify && x.status !== 'undone' ? `<a class="btn" href="/nuvolve/app/api/price-increases/${x.id}/letters" target="_blank" rel="noopener">🖨 Print the letters</a>` : ''}
        ${x.notify && toMail && x.status !== 'undone' ? `<a class="btn" href="/nuvolve/app/api/price-increases/${x.id}/letters?only=mail" target="_blank" rel="noopener">✉️ Letters to mail (${toMail})</a>` : ''}
        ${x.can_undo ? '<button class="btn danger" id="pi-undo">Undo</button>' : ''}</div></div>
    <div class="stats">
      <div class="stat"><div class="label">Plans</div><div class="value">${x.plans}</div><div class="sub">${plural(x.customers, 'customer')}</div></div>
      <div class="stat"><div class="label">More a year</div><div class="value">${money(x.extra_per_year)}</div><div class="sub">${money(x.before_annual)} → ${money(x.after_annual)}</div></div>
      <div class="stat"><div class="label">Letters</div><div class="value">${x.notify ? n.sent || 0 : '—'}</div><div class="sub">${x.notify ? (x.notices_sent_at ? `sent${n.no_contact ? `, ${n.no_contact} to mail` : ''}${n.failed ? `, ${n.failed} failed` : ''}` : `go out ${esc(fmtDate(x.notice_on))}`) : 'no letter'}</div></div>
      <div class="stat"><div class="label">Raised</div><div class="value">${x.counts.applied || 0}</div><div class="sub">${x.counts.skipped ? `${x.counts.skipped} skipped` : x.status === 'scheduled' ? `on ${esc(fmtDate(x.effective_date))}` : ''}</div></div>
    </div>
    <p class="small muted">Who: ${esc(who)}.</p>
    <div class="card flush"><div class="table-wrap"><table class="list"><thead><tr><th>Customer</th><th>Service</th><th class="right">Price</th><th>Plan</th><th>Letter</th><th></th></tr></thead><tbody>
      ${x.items.map((i) => `<tr><td><a href="#/customers/${i.customer_id}"><b>${esc(i.customer_name)}</b></a>${i.lang === 'es' ? ' <span class="pill">ES</span>' : ''}<div class="small muted">${esc(i.address || '')}</div></td>
        <td>${esc(i.service || '')}</td><td class="right nowrap">${money(i.old_price)} → <b>${money(i.new_price)}</b></td><td>${planStatus(i)}</td><td>${letter(i)}</td>
        <td class="right">${x.notify && i.status !== 'undone' ? `<a class="btn sm" href="/nuvolve/app/api/price-increases/${x.id}/letters?customer_id=${i.customer_id}" target="_blank" rel="noopener">Letter</a>` : ''}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  if ($('#pi-undo', view)) $('#pi-undo', view).onclick = () => modal('Undo this price increase?', `<p>Nothing has changed yet, so every plan keeps its price.</p>
    ${n.sent ? `<label class="check"><input type="checkbox" name="notify" checked> Tell the ${plural(n.sent, 'customer')} who got the letter that their price is staying the same</label>` : ''}`,
  [{ label: 'Keep it' }, { label: 'Undo it', cls: 'primary', onClick: async (m) => {
    const r = await api(`/nuvolve/app/api/price-increases/${x.id}/undo`, { body: { notify: Boolean($('[name=notify]', m)?.checked) } });
    toast(r.told ? `Undone, and ${plural(r.told, 'customer')} told` : 'Undone');
    route();
  } }]);
}

})(); } catch (e) { console.error('feature billing-price.js failed to load', e); }

/* ---- features/billing.js ---- */
try { (function () {
// Getting paid, the screens (the server side is src/features/billing*.js):
//   #/collections          failed card and bank payments with their retries, expiring cards, bank payments that
//                          are still clearing, disputes, and what was recovered this month
//   Settings → Payments     the Stripe webhook address and secret, retries, payment holds, expiring-card notices, ACH
//   customer, visit, Today  what's failing, what's on hold, a "send the update-card link" button
//   schedule and tech app   visits on payment hold (a flag for the office: nothing is ever cancelled)
//   pay page                update the card or add a bank account, pay by bank (demo mode), what failed and why
// What customers and techs read goes through NV.t (Spanish in src/lang/es/billing.js). Office screens are English.

const T = (text, vars) => NV.t(text, vars);
const redraw = () => (typeof route === 'function' ? route() : location.reload());
// SQLite's datetime('now') is UTC with no zone on it.
const stamp = (s) => {
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d/.test(s) ? `${String(s).replace(' ', 'T')}Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
};
const when = (s) => stamp(s)?.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '';
const localDay = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : stamp(s) ? ymd(stamp(s)) : '');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const SOURCE = { card: 'Card declined', autopay: 'Autopay failed', bank: 'Bank payment returned' };
const STAGE = { open: ['Retrying', 'yellow'], past_due: ['Past due', 'red'], recovered: ['Recovered', 'green'], closed: ['Closed', ''] };
const stagePill = (k) => { const [label, cls] = STAGE[k.status] || [k.status, '']; return `<span class="pill ${cls}">${esc(label)}</span>`; };
const EVENT = { opened: '🔴 Payment failed', declined: '❌ Declined', retry: '✅ Charged', message: '✉️ Message sent', past_due: '⏰ Past due',
  hold: '⏸ Visits put on hold', released: '▶️ Holds taken off', recovered: '🎉 Paid', closed: '✔️ Closed', method: '💳 New card or account' };
// "first: sent, sent" → "First notice: sent, sent" (the steps and statuses billing-dunning.js writes).
const STEP = { first: 'First notice', retry: 'Reminder after a retry', final: 'Past due notice', thanks: 'Thank-you', manual: 'Update link from the office' };
const SENT = { sent: 'sent', logged: 'logged in the outbox', failed: 'failed', blocked: 'blocked', queued: 'queued' };
const eventDetail = (ev) => {
  const m = ev.kind === 'message' && /^(\w+): (.*)$/.exec(ev.detail || '');
  if (!m) return ev.detail;
  return `${STEP[m[1]] || m[1]}: ${m[2].split(', ').map((x) => SENT[x] || x).join(', ')}`;
};
const clause = (s) => String(s || '').replace(/[.\s]+$/, ''); // a reason inside a sentence, without its own full stop
const empty = (icon, title, text) => `<div class="empty"><div class="big">${icon}</div><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;

// ---------- office actions ----------
async function retryNow(id, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await api(`/nuvolve/app/api/collections/${id}/retry`, { method: 'POST' });
    if (r.charged && r.case?.status === 'recovered') toast(`Charged ${money(r.charged)}. They're paid up.`);
    else if (r.charged) toast(`Charged ${money(r.charged)}. Some is still owed.`);
    else if (r.recovered || r.closed) toast('Nothing is owed any more, so the case is closed.');
    else toast(`Declined again${r.reason ? `: ${r.reason}` : ''}`, true);
    redraw();
  } catch (e) { toast(e.message, true); if (btn) btn.disabled = false; }
}
async function remind(id, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await api(`/nuvolve/app/api/collections/${id}/remind`, { method: 'POST' });
    toast(r.sent?.length ? 'Update-card link sent' : 'Nothing sent: no email, and texting is off', !r.sent?.length);
  } catch (e) { toast(e.message, true); }
  if (btn) btn.disabled = false;
}
async function sendLink(customerId, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await api(`/nuvolve/app/api/customers/${customerId}/update-link`, { method: 'POST' });
    toast(r.sent?.length ? 'Update-card link sent' : 'Nothing sent: no email, and texting is off', !r.sent?.length);
  } catch (e) { toast(e.message, true); }
  if (btn) btn.disabled = false;
}
async function settleBank(id, outcome, btn) {
  if (btn) btn.disabled = true;
  try {
    await api(`/nuvolve/app/api/billing/bank-payments/${id}/demo-settle`, { body: { outcome } });
    toast(outcome === 'failed' ? 'Bounced: the invoice is open again and collections has started' : 'Cleared');
    redraw();
  } catch (e) { toast(e.message, true); if (btn) btn.disabled = false; }
}

async function caseModal(id) {
  let k;
  try { k = await api(`/nuvolve/app/api/collections/${id}`); } catch (e) { return toast(e.message, true); }
  const open = ['open', 'past_due'].includes(k.status);
  const buttons = open ? [
    { label: 'Close case', onClick: async (el) => {
      await api(`/nuvolve/app/api/collections/${k.id}/close`, { body: { reason: $('[name=reason]', el).value } });
      toast('Case closed'); redraw();
    } },
    { label: k.holds ? 'Take holds off' : 'Hold upcoming visits', onClick: async () => {
      const r = await api(`/nuvolve/app/api/collections/${k.id}/holds`, { body: { on: !k.holds } });
      toast(k.holds ? `${plural(r.visits, 'visit')} taken off hold` : `${plural(r.visits, 'upcoming visit')} on payment hold`); redraw();
    } },
    ...(k.email || k.phone ? [{ label: 'Send update link', onClick: async () => { await remind(k.id); return false; } }] : []),
    ...(k.can_charge ? [{ label: 'Retry now', cls: 'primary', onClick: () => retryNow(k.id) }] : []),
  ] : [{ label: 'Close' }];
  modal(`Collections: ${k.customer_name}`, `
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">${stagePill(k)}
      <span class="small muted">${esc(SOURCE[k.source] || 'Payment failed')}${k.reason ? `: ${esc(k.reason)}` : ''}</span></div>
    <p><b>${money(open ? k.owed : k.recovered ?? k.amount)}</b> ${open ? 'owed' : k.status === 'recovered' ? 'recovered' : 'when it closed'} ·
      ${k.attempts} of ${k.tries} retries done${open && k.next_retry_at ? ` · next try ${esc(when(k.next_retry_at))}` : ''}</p>
    <p class="small">${k.method ? `On file: ${esc(k.method)}` : 'No card or bank account on file.'}${k.hard_decline ? ' <b style="color:var(--danger)">The bank said not to try this card again:</b> they need a new one.' : ''}
      ${k.lang === 'es' ? ' Messages go in Spanish.' : ''}</p>
    ${k.invoices.length ? `<div class="small" style="margin-bottom:10px">${k.invoices.map((i) => `<a href="/nuvolve/app/api/invoices/${i.id}/view" target="_blank" rel="noopener">Invoice #${i.id}</a> ${money(i.due)} ${statusPill(i.status)}`).join('<br>')}</div>` : ''}
    <h3>What happened</h3>
    <div style="max-height:240px;overflow:auto">${k.events.map((ev) => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)">
      <b>${esc(EVENT[ev.kind] || ev.kind)}</b> <span class="muted">${esc(when(ev.at))}</span>${ev.detail ? `<div>${esc(eventDetail(ev))}</div>` : ''}</div>`).join('')}</div>
    ${k.visits.length ? `<h3 style="margin-top:12px">Visits on payment hold</h3><div class="small">${k.visits.slice(0, 6).map((v) => `<a href="#/visits/${v.id}">${esc(fmtDay(v.date))}</a>`).join(' · ')}${k.visits.length > 6 ? ` and ${k.visits.length - 6} more` : ''}</div>
      <p class="small muted">A hold is a flag for the office and the tech. Nothing is cancelled.</p>` : ''}
    ${open ? `<div class="field" style="margin-top:12px"><label>Closing it without a payment? Say why (optional)</label>
      <input name="reason" maxlength="200" placeholder="Paid by check, written off, sent to a collection agency..."></div>` : ''}`, buttons);
}

// ---------- #/collections ----------
const TABS = [['cases', 'Open cases'], ['expiring', 'Expiring cards'], ['bank', 'Bank payments'], ['disputes', 'Disputes'], ['recovered', 'Recovered'], ['closed', 'Closed']];
const stat = (tab, label, value, sub, cls = '') => `<a class="stat ${cls}" href="#/collections?tab=${tab}"><div class="label">${esc(label)}</div>
  <div class="value">${esc(String(value))}</div><div class="sub">${esc(sub)}</div></a>`;
const who = (x) => `<a href="#/customers/${x.customer_id}"><b>${esc(x.customer_name || 'Customer')}</b></a>${x.autopay ? ' <span class="pill green">Autopay</span>' : ''}${x.lang === 'es' ? ' <span class="pill" title="Messages go in Spanish">ES</span>' : ''}`;

function openCases(list) {
  if (!list.length) return empty('🎉', 'Nobody is in collections', 'When a card or bank payment fails, it shows up here with its retries and messages.');
  return `<table class="list"><thead><tr><th>Customer</th><th>Stage</th><th class="right">Owed</th><th>Card or account</th><th>Next try</th><th></th></tr></thead><tbody>
    ${list.map((k) => `<tr><td>${who(k)}<div class="small muted">${esc(k.phone || k.email || 'No email or phone')}</div></td>
      <td>${stagePill(k)} <span class="small muted">${k.attempts} of ${k.tries} retries</span><div class="small muted">${esc(SOURCE[k.source] || 'Payment failed')}${k.reason ? `: ${esc(k.reason)}` : ''}</div></td>
      <td class="right"><b>${money(k.owed)}</b></td>
      <td>${k.method ? esc(k.method) : '<span class="muted">None on file</span>'}${k.hard_decline ? '<div class="small" style="color:var(--danger)">Bank said not to retry it</div>' : ''}</td>
      <td class="nowrap">${k.next_retry_at ? esc(when(k.next_retry_at)) : k.status === 'past_due' ? `<span class="small muted">Retries used up ${esc(fmtDate(localDay(k.past_due_at)))}</span>` : '<span class="muted">—</span>'}
        ${k.holds ? `<div class="small" style="color:var(--warn)">⏸ ${plural(k.holds, 'visit')} on hold</div>` : ''}${k.last_message_at ? `<div class="small muted">Last message ${esc(when(k.last_message_at))}</div>` : ''}</td>
      <td class="right"><div class="actions" style="justify-content:flex-end">
        ${k.can_charge ? `<button class="btn sm primary" data-bl-retry="${k.id}">Retry now</button>` : ''}
        ${k.email || k.phone ? `<button class="btn sm" data-bl-remind="${k.id}">Send link</button>` : ''}
        <button class="btn sm" data-bl-case="${k.id}">Details</button></div></td></tr>`).join('')}</tbody></table>`;
}

function closedCases(list, recovered) {
  if (!list.length) return recovered ? empty('💵', 'Nothing recovered yet this month', 'Customers who pay after a failed payment show up here.') : empty('📁', 'No closed cases', 'Cases the office closed without a payment in the last 60 days.');
  return `<table class="list"><thead><tr><th>Customer</th><th class="right">${recovered ? 'Recovered' : 'Owed'}</th><th>${recovered ? 'How' : 'Why'}</th><th>Failed</th><th>Closed</th><th></th></tr></thead><tbody>
    ${list.map((k) => `<tr><td>${who(k)}</td><td class="right"><b>${money(recovered ? k.recovered : k.owed)}</b></td><td class="small">${esc(k.close_reason || '')}</td>
      <td class="nowrap">${esc(fmtDate(localDay(k.opened_at)))}</td><td class="nowrap">${esc(fmtDate(localDay(k.closed_at)))}</td>
      <td class="right"><button class="btn sm" data-bl-case="${k.id}">Details</button></td></tr>`).join('')}</tbody></table>`;
}

const NOTICE = { soon: 'expiring', expired: 'expired', link: 'update link' };
function expiringCards(list) {
  if (!list.length) return empty('💳', 'No cards running out', 'Saved cards that expire in the next 60 days show up here. Customers get an update-card link before and after.');
  return `<table class="list"><thead><tr><th>Customer</th><th>Card</th><th>Expires</th><th>Told them</th><th></th></tr></thead><tbody>
    ${list.map((x) => `<tr><td>${who(x)}<div class="small muted">${esc(x.phone || x.email || 'No email or phone')}</div></td>
      <td>${esc(x.card)}</td>
      <td class="nowrap">${esc(x.exp || '')} ${x.stage === 'expired' ? '<span class="pill red">Expired</span>' : x.stage === 'soon' ? '<span class="pill yellow">Soon</span>' : '<span class="pill blue">Later</span>'}
        <div class="small muted">ends ${esc(fmtDate(x.ends))}</div></td>
      <td class="small">${x.notices.length ? x.notices.map((n) => `${esc(NOTICE[n.kind] || n.kind)} ${esc(fmtDate(localDay(n.sent_at)))}`).join('<br>') : '<span class="muted">Not yet</span>'}</td>
      <td class="right">${x.email || x.phone ? `<button class="btn sm" data-bl-link="${x.customer_id}">Send update link</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
}

function bankPayments(b, demo) {
  if (!b.processing.length && !b.returned.length) return empty('🏦', 'No bank payments right now', 'Payments from a bank account (ACH) take 3-5 business days to clear. They show here until they do.');
  const rows = (list, done) => list.map((p) => `<tr><td>${who(p)}</td><td class="right"><b>${money(p.amount + (p.tip || 0))}</b></td>
    <td class="nowrap">${esc(when(p.created_at))}</td>
    <td>${done ? `<span class="pill red">Returned</span> <span class="small">${esc(p.failure || '')}</span><div class="small muted">${esc(when(p.settled_at))}. The invoice is open again.</div>` : '<span class="pill blue">Clearing</span>'}</td>
    <td class="right">${!done && demo && p.demo ? `<div class="actions" style="justify-content:flex-end"><button class="btn sm" data-bl-settle="${p.id}" data-outcome="succeeded">Clear now</button>
      <button class="btn sm danger" data-bl-settle="${p.id}" data-outcome="failed">Bounce it</button></div>` : ''}</td></tr>`).join('');
  return `<table class="list"><thead><tr><th>Customer</th><th class="right">Amount</th><th>Started</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows(b.processing, false)}${rows(b.returned, true)}</tbody></table>
    <p class="small muted" style="padding:0 14px">A clearing payment already counts toward the invoice. If the bank sends it back, it's taken off again and collections starts.</p>`;
}

function disputes(list) {
  if (!list.length) return empty('🛡️', 'No disputes', 'When a customer disputes a card charge with their bank, it shows up here and the office is told.');
  return `<table class="list"><thead><tr><th>Customer</th><th class="right">Amount</th><th>Reason</th><th>Status</th><th>Answer by</th><th></th></tr></thead><tbody>
    ${list.map((x) => `<tr><td>${x.customer_id ? who(x) : '<span class="muted">Not matched to a customer</span>'}${x.invoice_id ? `<div class="small"><a href="/nuvolve/app/api/invoices/${x.invoice_id}/view" target="_blank" rel="noopener">Invoice #${x.invoice_id}</a></div>` : ''}</td>
      <td class="right"><b>${money(x.amount)}</b></td><td class="small">${esc(x.reason || '')}</td>
      <td><span class="pill ${x.open ? 'red' : x.status === 'won' ? 'green' : ''}">${esc(String(x.status || '').replace(/_/g, ' '))}</span></td>
      <td class="nowrap">${x.open && x.due_by ? esc(fmtDate(x.due_by)) : '<span class="muted">—</span>'}</td>
      <td class="right">${x.open ? '<a class="btn sm" href="https://dashboard.stripe.com/disputes" target="_blank" rel="noopener">Answer in Stripe</a>' : ''}</td></tr>`).join('')}</tbody></table>`;
}

function wireCollections(root) {
  $$('[data-bl-retry]', root).forEach((b) => (b.onclick = () => retryNow(b.dataset.blRetry, b)));
  $$('[data-bl-remind]', root).forEach((b) => (b.onclick = () => remind(b.dataset.blRemind, b)));
  $$('[data-bl-case]', root).forEach((b) => (b.onclick = () => caseModal(b.dataset.blCase)));
  $$('[data-bl-link]', root).forEach((b) => (b.onclick = () => sendLink(b.dataset.blLink, b)));
  $$('[data-bl-settle]', root).forEach((b) => (b.onclick = () => settleBank(b.dataset.blSettle, b.dataset.outcome, b)));
}

NV.nav({ href: '#/collections', icon: '💳', label: 'Collections', after: '#/billing' });
NV.page('collections', async (view, _id, params) => {
  const d = await api('/nuvolve/app/api/collections');
  const st = d.stats;
  const counts = { cases: d.cases.length, expiring: st.expiring, bank: d.bank.processing.length + d.bank.returned.length,
    disputes: st.disputes, recovered: d.recovered.length, closed: d.closed.length };
  const tab = TABS.some(([k]) => k === params.tab) ? params.tab : 'cases';
  const body = { cases: () => openCases(d.cases), expiring: () => expiringCards(d.expiring), bank: () => bankPayments(d.bank, d.demo),
    disputes: () => disputes(d.disputes), recovered: () => closedCases(d.recovered, true), closed: () => closedCases(d.closed, false) }[tab];
  view.innerHTML = `
    <div class="page-head"><div><h1>Collections</h1><div class="muted">Card and bank payments that didn't go through, and the retries working on them</div></div>
      <div class="actions"><a class="btn" href="#/billing?tab=pastdue">Past due invoices</a>${BOOT.me.isAdmin ? '<a class="btn" href="#/settings?tab=payments">⚙️ Retry settings</a>' : ''}</div></div>
    ${d.settings.enabled ? '' : '<div class="alert warn"><span>Collections is off, so failed payments are not retried and customers get one notice. Turn it on in Settings → Payments &amp; plan.</span></div>'}
    ${d.demo ? '<div class="alert info"><span>💳 <b>Demo mode</b>, no money moves. To see collections work, save a customer one of Stripe\'s declining test cards (4000 0000 0000 0002, or ending 9995) or an expired one, and complete a stop. Pretend bank payments clear after 5 minutes (accounts ending 2227 bounce).</span></div>' : ''}
    <div class="stats">
      ${stat('cases', 'Open cases', st.open, `${money(st.owed)} owed`)}
      ${stat('cases', 'Past due', st.pastDue, 'retries used up', st.pastDue ? 'danger' : '')}
      ${stat('cases', 'Cards failing', st.failingCards, st.holds ? `${plural(st.holds, 'visit')} on payment hold` : 'on open cases')}
      ${stat('recovered', 'Recovered this month', money(st.recoveredMonth), plural(st.recoveredCount, 'customer'))}
      ${stat('expiring', 'Cards expiring', st.expiring, 'soon or already expired', st.expiring ? 'warn' : '')}
      ${d.achEnabled || d.bank.processing.length ? stat('bank', 'Bank payments clearing', money(st.processing), plural(d.bank.processing.length, 'payment')) : ''}
      ${st.disputes ? stat('disputes', 'Open disputes', st.disputes, 'answer them in Stripe', 'danger') : ''}
    </div>
    <div class="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${esc(l)}${counts[k] ? ` (${counts[k]})` : ''}</button>`).join('')}</div>
    <div class="card flush"><div class="table-wrap">${body()}</div></div>`;
  $$('.tabs button', view).forEach((b) => (b.onclick = () => (location.hash = `#/collections?tab=${b.dataset.tab}`)));
  wireCollections(view);
  if (params.case && /^\d+$/.test(params.case)) {
    history.replaceState(null, '', `#/collections${params.tab ? `?tab=${encodeURIComponent(params.tab)}` : ''}`); // a redraw doesn't open it again
    caseModal(params.case);
  }
});

// ---------- Today, the customer page, the visit, the schedule ----------
NV.slot('today.alerts', ({ d }) => {
  const k = d.collections;
  if (!k?.open) return '';
  return `<div class="alert warn"><span>💳 <b>${plural(k.open, 'customer')} in collections</b>${k.pastDue ? `, ${k.pastDue} past due` : ''}. Retries and reminders run on their own.</span>
    <a class="btn sm" href="#/collections">Open collections</a></div>`;
});

const monthOf = (ends) => (ends ? parseYmd(ends).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '');
NV.slot('customer.tags', ({ c }) => [
  c.collections ? `<span class="pill red">${c.collections.status === 'past_due' ? 'Past due' : 'Card failing'}</span>` : '',
  c.card_stage === 'expired' ? `<span class="pill red">Card expired ${esc(c.card_exp || '')}</span>` : c.card_stage === 'soon' ? `<span class="pill yellow">Card expires ${esc(c.card_exp || '')}</span>` : '',
  (c.disputes || []).some((x) => x.open) ? '<span class="pill red">Disputed payment</span>' : '',
  (c.bank_payments || []).some((x) => x.status === 'processing') ? '<span class="pill blue">Bank payment clearing</span>' : '',
].join(''));

NV.slot('customer.actions', ({ c }) => (c.email || c.phone
  ? `<button class="btn" data-bl-link="${c.id}" title="Email or text them a secure link to put in a new card or bank account">💳 Card update link</button>` : ''));

NV.slot('customer.alerts', ({ c }) => {
  const out = [];
  const k = c.collections;
  if (k) {
    out.push(`<div class="alert ${k.status === 'past_due' ? 'err' : 'warn'}"><span>💳 <b>${k.status === 'past_due' ? 'Past due.' : 'In collections.'}</b>
      ${esc(SOURCE[k.source] || 'Payment failed')}${k.reason ? `: ${esc(clause(k.reason))}` : ''}. ${money(k.owed)} owed, ${k.attempts} of ${k.tries} retries done${k.next_retry_at ? `, next try ${esc(when(k.next_retry_at))}` : ''}${k.holds ? `. ${plural(k.holds, 'upcoming visit')} on payment hold` : ''}.</span>
      <span class="actions">${k.can_charge ? `<button class="btn sm primary" data-bl-retry="${k.id}">Retry now</button>` : ''}<button class="btn sm" data-bl-case="${k.id}">Details</button></span></div>`);
  }
  for (const x of (c.disputes || []).filter((y) => y.open)) {
    out.push(`<div class="alert err"><span>⚠️ <b>Disputed payment:</b> ${money(x.amount)}${x.reason ? ` (${esc(x.reason)})` : ''}${x.invoice_id ? ` on invoice #${x.invoice_id}` : ''}.
      ${x.due_by ? `Send your evidence in Stripe by ${esc(fmtDate(x.due_by))}.` : 'Answer it in your Stripe dashboard.'}</span>
      <a class="btn sm" href="https://dashboard.stripe.com/disputes" target="_blank" rel="noopener">Open Stripe</a></div>`);
  }
  for (const b of (c.bank_payments || []).filter((y) => y.status === 'processing')) {
    out.push(`<div class="alert info"><span>🏦 A bank payment of <b>${money(b.amount)}</b> is clearing (started ${esc(fmtDate(localDay(b.created_at)))}). It counts now and is taken back if the bank returns it.</span></div>`);
  }
  for (const b of (c.bank_payments || []).filter((y) => y.status === 'failed')) {
    out.push(`<div class="alert warn"><span>🏦 A bank payment of ${money(b.amount)} was returned ${esc(fmtDate(localDay(b.settled_at)))}${b.failure ? ` (${esc(b.failure)})` : ''}, so the invoice is open again.</span></div>`);
  }
  if (c.card_stage && !k) {
    out.push(`<div class="alert ${c.card_stage === 'expired' ? 'warn' : 'info'}"><span>💳 ${esc(c.card_brand || 'Card')} ••${esc(c.card_last4 || '')}
      ${c.card_stage === 'expired' ? 'has expired' : `expires at the end of ${esc(monthOf(c.card_ends))}`}.${c.autopay ? ' Autopay will fail until they add a new one.' : ''}</span>
      ${c.email || c.phone ? `<button class="btn sm" data-bl-link="${c.id}">Send update link</button>` : ''}</div>`);
  }
  return out.join('');
});
NV.on('customer.rendered', ({ view }) => wireCollections(view));

NV.slot('visit.left', ({ v }) => {
  if (!v.payment_hold || v.status !== 'scheduled') return '';
  const k = v.payment_hold_case;
  return `<div class="card"><div class="alert warn" style="margin-bottom:10px"><span>⏸ <b>Payment hold.</b>
    ${k ? `This customer owes ${money(k.owed)}${k.status === 'past_due' ? ' and is past due' : ''}.` : ''} Nothing is cancelled: decide whether to go, or call them first.</span></div>
    <div class="actions"><button class="btn sm" data-bl-release="${v.id}">Take this visit off hold</button>${k ? `<a class="btn sm" href="#/collections?case=${k.id}">Open the case</a>` : ''}</div></div>`;
});
NV.on('visit.rendered', ({ view }) => {
  const b = $('[data-bl-release]', view);
  if (b) b.onclick = async () => {
    b.disabled = true;
    try { await api(`/nuvolve/app/api/visits/${b.dataset.blRelease}/payment-hold`, { body: { on: false } }); toast('Taken off hold'); redraw(); } catch (e) { toast(e.message, true); b.disabled = false; }
  };
});

// The schedule board: a mark on visits that are on payment hold.
NV.on('page', async ({ name, view }) => {
  if (name !== 'schedule') return;
  const dates = $$('.cell[data-date]', view).map((x) => x.dataset.date).sort();
  if (!dates.length) return;
  let held;
  try { held = new Set(await api(`/nuvolve/app/api/collections/holds?from=${dates[0]}&to=${dates[dates.length - 1]}`)); } catch { return; }
  for (const ch of $$('.vchip[data-id]', view)) {
    if (held.has(Number(ch.dataset.id)) && !$('.bl-hold', ch)) {
      ch.insertAdjacentHTML('beforeend', '<div class="bl-hold" style="color:var(--warn);font-weight:600" title="The customer owes money. Nothing is cancelled: the office decides.">⏸ Payment hold</div>');
    }
  }
});

// ---------- Settings → Payments ----------
NV.slot('settings.payments', () => `<div class="grid cols-2" id="bl-pay" style="grid-column:1/-1;margin-top:16px">
  <div class="card" id="bl-hook"><p class="muted">Loading...</p></div><form class="card" id="bl-collect"><p class="muted">Loading...</p></form></div>`);
NV.on('settings.payments.rendered', async ({ box }) => {
  // A row of its own under the core's two cards (not a third column beside them), so they keep their width.
  const row = $('#bl-pay', box);
  if (row?.parentElement?.classList.contains('grid')) row.parentElement.after(row);
  const hook = $('#bl-hook', box), form = $('#bl-collect', box);
  if (!hook || !form) return;
  let s;
  try { s = await api('/nuvolve/app/api/billing/payments-setup'); } catch (e) { hook.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; form.remove(); return; }
  const refresh = async () => { s = await api('/nuvolve/app/api/billing/payments-setup'); draw(); };
  const draw = () => {
    hook.innerHTML = `<h2>Stripe webhook</h2>
      <p class="small muted">Stripe tells Nuvolve when a payment clears or fails, when a bank payment bounces, when a bank sends a customer a new card, and when someone disputes a charge.
        In Stripe go to <b>Developers → Webhooks → Add endpoint</b>, paste this address, and pick these events:</p>
      <div class="small" style="margin-bottom:10px;line-height:1.9">${s.events.map((e) => `<code>${esc(e)}</code>`).join(' ')}</div>
      <div class="field"><label>Webhook address</label><div style="display:flex;gap:6px"><input id="bl-url" readonly value="${esc(s.webhookUrl)}"><button type="button" class="btn" id="bl-copy">Copy</button></div>
        <div class="hint">Keep it private. <button type="button" class="link-btn" id="bl-rotate">Make a new address</button> if it got out, then paste the new one into Stripe.</div></div>
      <form id="bl-secret"><div class="field"><label>Signing secret</label>
        <input name="stripe_webhook_secret" type="password" autocomplete="off" placeholder="${s.webhookSecretSet ? '•••••••• saved (type a new one to replace it, or remove)' : 'whsec_...'}">
        <div class="hint">On the endpoint's page in Stripe, under "Signing secret". Every event is checked against it, and it's never shown again.</div></div>
        <button class="btn primary">Save secret</button></form>
      <p class="small" style="margin:10px 0 0">${s.lastEvent ? `✅ Last event: <code>${esc(s.lastEvent.type)}</code>, ${esc(when(s.lastEvent.received_at))}`
        : s.webhookSecretSet ? '⏳ Waiting for the first event from Stripe.' : 'Until the secret is saved, bank payments are checked with Stripe every few hours instead.'}
        ${s.stripeEnabled ? '' : ' Connect your Stripe key first.'}</p>`;
    $('#bl-copy', hook).onclick = () => copyText(s.webhookUrl, 'Webhook address copied');
    $('#bl-rotate', hook).onclick = () => modal('Make a new webhook address?', '<p>The old address stops working right away. Paste the new one into your Stripe webhook endpoint.</p>',
      [{ label: 'Cancel' }, { label: 'Make a new one', cls: 'primary', onClick: async () => { s = await api('/nuvolve/app/api/billing/webhook-url', { method: 'POST' }); draw(); toast('New address made. Paste it into Stripe.'); } }]);
    $('#bl-secret', hook).onsubmit = async (e) => {
      e.preventDefault();
      const v = e.target.stripe_webhook_secret.value.trim();
      if (!v) return toast('Paste the signing secret first', true);
      try { await api('/nuvolve/app/api/settings', { method: 'PUT', body: { stripe_webhook_secret: v } }); toast(v === 'remove' ? 'Secret removed' : 'Secret saved'); await refresh(); } catch (err) { toast(err.message, true); }
    };
    form.innerHTML = `<h2>Collections, bank payments, expiring cards</h2>
      <label class="check"><input type="checkbox" name="dunning_enabled" ${s.dunning.enabled ? 'checked' : ''}> Retry failed card and bank payments, with a message each time</label>
      <div class="row" style="margin-top:8px">
        <div class="field"><label>Retry after (days)</label><input name="dunning_days" value="${esc(s.dunning.days.join(', '))}">
          <div class="hint">Counted from the day it failed. Each message carries the update-card link, in Spanish for Spanish speakers.</div></div>
        <div class="field"><label>Send between (hours)</label><input name="dunning_hours" value="${esc(s.dunning.hours.join('-'))}">
          <div class="hint">Company time, 24-hour clock: 9-20 is 9am to 8pm.</div></div></div>
      <label class="check"><input type="checkbox" name="dunning_hold_visits" ${s.dunning.hold ? 'checked' : ''}> After the last retry, put their upcoming visits on payment hold</label>
      <div class="hint" style="margin:0 0 12px 26px">A flag on the schedule, the visit and the tech's stop. Nothing is ever cancelled: the office decides.</div>
      <label class="check"><input type="checkbox" name="card_expiry_notices" ${s.expiry.enabled ? 'checked' : ''}> Remind customers before their saved card expires</label>
      <div class="row" style="margin-top:8px"><div class="field"><label>Days before it expires</label><input name="card_expiry_days" type="number" min="1" max="90" value="${esc(String(s.expiry.days))}">
        <div class="hint">And again once it has expired. Each reminder has the update-card link.</div></div></div>
      <label class="check"><input type="checkbox" name="ach_enabled" ${s.achEnabled ? 'checked' : ''}> Let customers pay from a bank account (ACH)</label>
      <div class="hint" style="margin:0 0 12px 26px">Turn on ACH Direct Debit in Stripe first (Settings → Payment methods). Bank payments take 3-5 business days to clear and show as clearing until then.
        One that bounces opens the invoice again and starts collections.</div>
      <button class="btn primary">Save</button>`;
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/nuvolve/app/api/settings', { method: 'PUT', body: formData(form) }); toast('Saved'); await refresh(); } catch (err) { toast(err.message, true); }
  };
  draw();
});

// ---------- the tech app ----------
NV.slot('tech.stop', ({ v }) => (v.payment_hold && v.status === 'scheduled'
  ? `<div class="alert warn">⏸ ${esc(T('Payment hold: call the office before you start this stop.'))}</div>` : ''));
NV.on('tech.route.rendered', ({ r, root }) => {
  for (const s of r.stops || []) {
    if (!s.payment_hold || s.status !== 'scheduled') continue;
    const info = $(`a.tstop[href="#/stop/${Number(s.id)}"] .info`, root);
    if (info && !$('.bl-hold', info)) info.insertAdjacentHTML('beforeend', `<div class="small bl-hold" style="color:var(--warn);font-weight:600">⏸ ${esc(T('Payment hold'))}</div>`);
  }
});

// ---------- the pay page ----------
const longDay = (s) => (s ? parseYmd(String(s).slice(0, 10)).toLocaleDateString(NV.lang === 'es' ? 'es-US' : 'en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');
const expMonth = (exp) => {
  const m = /^(\d{2})\/(\d{2})$/.exec(exp || '');
  return m ? new Date(2000 + Number(m[2]), Number(m[1]) - 1, 15).toLocaleDateString(NV.lang === 'es' ? 'es-US' : 'en-US', { month: 'long', year: 'numeric' }) : exp || '';
};
// A live server with no Stripe key can't take a card or bank account yet (data.payOnline is false): say to call.
const callOffice = (D) => `<p class="small" style="margin-top:10px">${esc(D.company?.phone ? T('To pay or update your card, call or text the office at {phone}.', { phone: D.company.phone }) : T('To pay or update your card, call or text the office.'))}</p>`;
const methodButtons = (D, primary) => (D.payOnline === false ? callOffice(D) : `<div class="row" style="margin-top:10px">
  <button type="button" class="btn ${primary ? 'primary big' : ''} block" data-bl-update="card">${esc(D.payMethod?.type === 'card' ? T('Update card') : T('Add a card'))}</button>
  ${D.achEnabled ? `<button type="button" class="btn ${primary ? 'big' : ''} block" data-bl-update="bank">${esc(D.payMethod?.type === 'bank' ? T('Change bank account') : T('Use a bank account'))}</button>` : ''}</div>`);

NV.slot('portal.top', ({ data: D }) => {
  const out = [];
  const k = D.collections, pm = D.payMethod;
  if (k && k.owed > 0) {
    const title = k.source === 'bank' ? T("Your bank payment didn't go through") : pm ? T("Your card didn't go through") : T('Your autopay needs a card');
    out.push(`<div class="card" id="bl-fix" style="border:2px solid var(--danger)"><h2>${esc(title)}</h2>
      <p>${esc(pm ? T('{amount} is still due. Update your card and we will try it again right away.', { amount: money(k.owed) })
        : T('{amount} is due. Add a card and we will charge it right away.', { amount: money(k.owed) }))}</p>
      ${pm ? `<p class="small muted">${esc(pm.label)}${pm.exp ? ` · ${esc(T('expires {exp}', { exp: pm.exp }))}` : ''}</p>` : ''}${methodButtons(D, true)}</div>`);
  } else if (pm?.type === 'card' && pm.stage) {
    out.push(`<div class="card" id="bl-fix" style="border:2px solid var(--warn)"><h2>${esc(pm.stage === 'expired' ? T('Your card on file has expired') : T('Your card on file expires soon'))}</h2>
      <p>${esc(pm.stage === 'expired' ? T('Your {card} has expired.', { card: pm.label }) : T('Your {card} expires at the end of {month}.', { card: pm.label, month: expMonth(pm.exp) }))}
        ${esc(T('Add your new card so your next service is paid automatically.'))}</p>${methodButtons(D, true)}</div>`);
  }
  const clearing = (D.processing || []).reduce((t, p) => t + p.amount + (p.tip || 0), 0);
  if (clearing > 0) out.push(`<div class="alert info">🏦 ${esc(T('Your bank payment of {amount} is processing. Bank payments take 3 to 5 business days to clear.', { amount: money(clearing) }))}</div>`);
  for (const p of D.priceChanges || []) {
    out.push(`<div class="alert info">📈 ${esc(T('Starting {date}, your {service} goes from {old_price} to {new_price} per visit.',
      { date: longDay(p.effective_date), service: p.service_name || T('pest control service'), old_price: money(p.old_price), new_price: money(p.new_price) }))}</div>`);
  }
  if (D.balance > 0 && D.achEnabled && !D.stripeEnabled && D.payOnline !== false && !(k && k.owed > 0)) {
    out.push(`<div class="card" style="text-align:center"><p style="margin:0 0 8px">${esc(T('Prefer to pay from your bank account?'))}</p>
      <button type="button" class="btn block" data-bl-paybank>🏦 ${esc(T('Pay by bank'))}</button></div>`);
  }
  return out.join('');
});

NV.slot('portal.cards', ({ data: D }) => {
  const pm = D.payMethod;
  if ((D.collections && D.collections.owed > 0) || (pm?.type === 'card' && pm.stage)) return ''; // the card at the top has the buttons
  return `<div class="card" id="bl-method"><h2>${esc(T('Payment method'))}</h2>
    ${pm ? `<p style="margin:0">${esc(pm.label)}${pm.exp ? ` · ${esc(T('expires {exp}', { exp: pm.exp }))}` : ''}</p>` : `<p class="muted" style="margin:0">${esc(T('No card or bank account on file yet.'))}</p>`}
    ${methodButtons(D, false)}</div>`;
});

// A new card or bank account. Live: Stripe's own page (nothing is charged there). Demo: a pretend one.
async function updateMethod(type, ctx) {
  const { data: D, token, reload } = ctx;
  if (D.stripeEnabled) {
    try { const r = await api(`/nuvolve/app/api/portal/${token}/update-card`, { body: { type } }); if (r.url) location.href = r.url; } catch (e) { toast(e.message, true); }
    return;
  }
  const owed = D.collections?.owed > 0 ? D.collections.owed : 0;
  const bank = type === 'bank';
  modal(bank ? T('Add a bank account') : T('Update your card'), `
    <div class="alert info">${esc(bank ? T('Demo mode: any 9-digit routing number works. No real money moves.') : T('Demo mode: use any test number. No real money moves.'))}</div>
    ${bank ? `<div class="field"><label>${esc(T('Routing number'))}</label><input name="routing" value="110000000" inputmode="numeric" autocomplete="off"></div>
      <div class="field"><label>${esc(T('Account number'))}</label><input name="account" value="000123456789" inputmode="numeric" autocomplete="off"></div>
      <p class="small muted">${esc(T('Bank payments take 3 to 5 business days to clear.'))}</p>`
    : `<div class="field"><label>${esc(T('Card number'))}</label><input name="card_number" value="4242 4242 4242 4242" inputmode="numeric" autocomplete="cc-number"></div>
      <div class="row"><div class="field"><label>${esc(T('Expires (MM/YY)'))}</label><input name="exp" value="12/30" inputmode="numeric" autocomplete="cc-exp"></div>
        <div class="field"><label>${esc(T('Security code'))}</label><input value="123" inputmode="numeric" autocomplete="off"></div></div>`}
    ${owed ? `<p class="small">${esc(T('We will try it on the {amount} that is due.', { amount: money(owed) }))}</p>` : ''}`,
  [{ label: T('Cancel') }, { label: bank ? T('Save account') : T('Save card'), cls: 'primary', onClick: async (m) => {
    const r = await api(`/nuvolve/app/api/portal/${token}/update-card/demo`, { body: { type, ...formData(m) } });
    if (r.declined) toast(T('Your new card was saved, but the payment was declined. Please try another card or give us a call.'), true);
    else if (r.charged && bank) toast(T('Saved. Your payment of {amount} has started and takes 3 to 5 business days to clear.', { amount: money(r.charged) }));
    else if (r.charged) toast(T('Saved, and your payment of {amount} went through. Thank you!', { amount: money(r.charged) }));
    else toast(T('Saved. Thank you!'));
    await reload();
  } }]);
}

function payByBank(ctx) {
  const { data: D, token, reload } = ctx;
  modal(T('Pay from your bank account'), `
    <div class="alert info">${esc(T('Demo mode: any 9-digit routing number works. No real money moves.'))}</div>
    <div class="field"><label>${esc(T('Routing number'))}</label><input name="routing" value="110000000" inputmode="numeric" autocomplete="off"></div>
    <div class="field"><label>${esc(T('Account number'))}</label><input name="account" value="000123456789" inputmode="numeric" autocomplete="off"></div>
    <label class="check"><input type="checkbox" name="save" ${D.customer.autopay ? 'checked' : ''}> ${esc(T('Save this account and pay automatically after each service'))}</label>
    <p class="small muted">${esc(T('Bank payments take 3 to 5 business days to clear.'))}</p>
    <p><b>${esc(T('Total: {amount}', { amount: money(D.balance) }))}</b></p>`,
  [{ label: T('Cancel') }, { label: T('Pay {amount}', { amount: money(D.balance) }), cls: 'primary', onClick: async (m) => {
    await api(`/nuvolve/app/api/portal/${token}/demo-bank`, { body: formData(m) });
    toast(T('Payment started. Bank payments take 3 to 5 business days to clear.'));
    await reload();
  } }]);
}

let arrived = false;
NV.on('portal.rendered', (ctx) => {
  const { root, data: D } = ctx;
  $$('[data-bl-update]', root).forEach((b) => (b.onclick = () => updateMethod(b.dataset.blUpdate, ctx)));
  $$('[data-bl-paybank]', root).forEach((b) => (b.onclick = () => payByBank(ctx)));
  if (arrived) return;
  arrived = true;
  // Back from Stripe, or here from an update-card link.
  const q = new URLSearchParams(location.search);
  const card = q.get('card'), bank = q.get('bank'), update = q.get('update');
  if (!card && !bank && !update) return;
  history.replaceState(null, '', location.pathname);
  const verify = T('Almost done: your bank account still needs to be confirmed. Stripe will email you.');
  const said = { charged: T('Your card is saved and your payment went through. Thank you!'), saved: T('Your card is saved. Thank you!'), verify,
    declined: T('Your new card was saved, but the payment was declined. Please try another card or give us a call.') }[card]
    || { processing: T('Payment started. Bank payments take 3 to 5 business days to clear.'), verify }[bank];
  if (said) setTimeout(() => toast(said, card === 'declined'), 60);
  if (update) {
    const box = $('#bl-fix', root) || $('#bl-method', root);
    if (box) setTimeout(() => box.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    if (!D.stripeEnabled && D.payOnline !== false) setTimeout(() => updateMethod(update === 'bank' && D.achEnabled ? 'bank' : 'card', ctx), 120);
  }
});

})(); } catch (e) { console.error('feature billing.js failed to load', e); }

/* ---- features/callbacks.js ---- */
try { (function () {
// Callbacks (re-services) in the browser: book the trip back from Today, the customer and the visit, the
// Callbacks page and its settings tab, the callback flag and "last time" card in the tech app, and the free
// re-treat window on the customer's pay page. Server side: src/features/callbacks.js.
//
// Office screens are in English like the rest of the office app. Anything a tech or a customer reads goes
// through NV.t (Spanish in src/lang/es/callbacks.js).

const t = (text, vars) => NV.t(text, vars);
const SOURCES = [['portal', 'Customer portal'], ['phone', 'Phone or office'], ['tech', 'Tech found it']];
const sourceLabel = (k) => (SOURCES.find((x) => x[0] === k) || [k, k || ''])[1];
// Dates for techs and customers, in their language.
const inLang = (s, opts) => (s ? parseYmd(String(s).slice(0, 10)).toLocaleDateString(NV.lang === 'es' ? 'es-US' : 'en-US', opts) : '');
const shortDay = (s) => inLang(s, { month: 'short', day: 'numeric' });
const longDay = (s) => inLang(s, { weekday: 'long', month: 'long', day: 'numeric' });
const tidy = (s) => String(s || '').trim().replace(/[\s.!]+$/, '');
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const svcName = (o) => o?.service_name || 'service';

// ---------- what the tech (and the office) read about a callback ----------
// "🔁 Callback: ants still in the kitchen. Follows the Oct 12 service."
const flagText = (reason, date) => `🔁 ${t('Callback: {reason}', { reason: tidy(reason) || t('pests still active') })}.${date ? ` ${t('Follows the {date} service.', { date: shortDay(date) })}` : ''}`;
function askedText(n) {
  if (n == null) return '';
  if (n === 0) return t('Asked the same day as the service');
  return n === 1 ? t('Asked 1 day after the service') : t('Asked {n} days after the service', { n });
}
// What was done at the service this callback follows up on: pests, areas, products and notes.
function lastTime(o) {
  const lines = [[t('Pests'), o.target_pests], [t('Areas'), o.areas_serviced]].filter(([, val]) => val);
  return `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">
    <b>${esc(t('What was done last time ({date})', { date: shortDay(o.date) }))}</b>${o.tech_name ? ` <span class="small muted">· ${esc(o.tech_name)}</span>` : ''}
    ${lines.map(([k, val]) => `<div class="small"><b>${esc(k)}:</b> ${esc(val)}</div>`).join('')}
    ${o.products?.length ? `<div class="small"><b>${esc(t('Products'))}:</b></div><ul class="small" style="margin:2px 0 0;padding-left:18px">${o.products.map((p) => `<li>${esc(p.name)}${p.epa_reg ? ` <span class="muted">(EPA ${esc(p.epa_reg)})</span>` : ''}${p.amount != null ? ` · ${esc(p.amount)} ${esc(p.unit || '')}` : ''}${p.rate ? ` · ${esc(p.rate)}` : ''}${p.area ? ` · ${esc(p.area)}` : ''}</li>`).join('')}</ul>`
    : `<div class="small muted">${esc(t('No products recorded.'))}</div>`}
    ${o.tech_notes ? `<div class="small" style="margin-top:4px">📝 ${esc(o.tech_notes)}</div>` : ''}
    ${o.internal_notes ? `<div class="office-note-view">🔒 ${esc(o.internal_notes)}</div>` : ''}
  </div>`;
}

// ---------- office: the free window, in words ----------
function windowText(q) {
  if (!q.original) return '<div class="alert warn"><span>There\'s no finished service at this address to follow up on yet. Schedule a regular visit instead.</span></div>';
  const from = q.window_from === 'plan' ? "this plan's window" : q.window_from === 'service' ? `the ${esc(svcName(q.original))} window` : 'your company window';
  const service = `the ${fmtDate(q.original.date)} ${esc(svcName(q.original))}`;
  if (!q.window_days) return `<div class="alert warn"><span>⚠️ <b>No free window</b> on ${service}. A callback is charged at the re-service price, ${money(q.value)}.</span></div>`;
  const when = q.days_after === 0 ? 'the same day as' : `${plural(q.days_after, 'day', 'days')} after`;
  return q.inside
    ? `<div class="alert ok"><span>✅ <b>Free re-treat.</b> They asked ${when} ${service}, inside ${from} of ${q.window_days} days (free until ${fmtDate(q.free_until)}).</span></div>`
    : `<div class="alert warn"><span>⚠️ <b>Outside the free window.</b> They asked ${when} ${service}. ${from[0].toUpperCase()}${from.slice(1)} is ${q.window_days} days and ended ${fmtDate(q.free_until)}, so it's charged at the re-service price, ${money(q.value)}.</span></div>`;
}
const originalOption = (o, selected) => `<option value="${o.id}" ${o.id === selected ? 'selected' : ''}>${fmtDate(o.date)} · ${esc(svcName(o))} · ${esc(o.tech_name || 'No tech')}</option>`;

// Book a callback, change one, or turn a scheduled visit into one. Opens with the last finished regular
// service at the address picked, and the free window worked out by the server as the office changes things.
function callbackModal(opts = {}) {
  const visit = opts.visit || null;
  const m = modal(visit?.callback_of ? 'Change this callback' : visit ? 'Make this visit a callback' : 'Schedule a callback', '<div id="cbm"><p class="muted">Loading...</p></div>', []);
  const box = $('#cbm', m.el);
  const base = visit ? { visit_id: visit.id } : opts.requestId ? { request_id: opts.requestId } : { customer_id: opts.customerId, original_id: opts.originalId, property_id: opts.propertyId };
  const quote = (extra = {}) => api(`/nuvolve/app/api/callbacks/quote?${qs({ ...base, ...extra })}`);

  const draw = (q) => {
    const fresh = !q.current;
    const done = Boolean(q.current && q.current.status !== 'scheduled');
    let touchedFree = false;
    let touchedPrice = false;
    const free = q.current?.callback ? q.current.free : q.free;
    const price = q.current?.callback && !q.current.free ? q.current.price : q.value;
    box.innerHTML = `
      <p><b>${esc(q.customer_name)}</b>${base.request_id ? ' <span class="pill blue">From their request</span>' : ''}</p>
      ${fresh && q.properties.length > 1 ? `<div class="field"><label>Address</label><select name="property_id" id="cb-prop">${q.properties.map((p) => `<option value="${p.id}" ${p.id === q.property_id ? 'selected' : ''}>${esc(p.address)}${p.city ? `, ${esc(p.city)}` : ''}</option>`).join('')}</select></div>`
        : `<input type="hidden" name="property_id" value="${q.property_id}">`}
      <div class="field"><label>Follows up on</label><select name="original_id" id="cb-orig">${q.candidates.length ? q.candidates.map((o) => originalOption(o, q.original?.id)).join('') : '<option value="">No finished service here yet</option>'}</select>
        <div class="hint">The last finished service at this address is picked for you. Change it if they mean an earlier one.</div></div>
      <div class="row">
        <div class="field"><label>Day they asked</label><input type="date" name="asked_on" id="cb-asked" max="${todayStr()}" value="${esc(q.asked_on)}"></div>
        <div class="field"><label>Who asked</label><select name="source">${SOURCES.map(([k, l]) => `<option value="${k}" ${k === q.source ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div id="cb-win">${windowText(q)}</div>
      <div id="cb-earlier">${earlierText(q)}</div>
      <div class="field"><label>What's still active, and where</label><textarea name="reason" maxlength="300" placeholder="Ants still in the kitchen by the sink">${esc(q.reason)}</textarea></div>
      ${fresh ? `<div class="row">
        <div class="field"><label>Date</label><input type="date" name="date" value="${esc(q.date)}"></div>
        <div class="field"><label>Time window (optional)</label><input name="time_window" maxlength="40" placeholder="8-10am"></div></div>
        <div class="field"><label>Tech</label><select name="tech_id">${techOptions(q.tech_id)}</select><div class="hint">The tech who did the service goes back, when they still run a route.</div></div>` : ''}
      <div class="row">
        <div class="field"><label>Service</label><select name="service_type_id" id="cb-svc">${serviceOptions(q.service_type_id)}</select></div>
        <div class="field" id="cb-price-wrap"><label>Price</label><input type="number" name="price" id="cb-price" step="0.01" min="0" value="${price ?? ''}" ${done ? 'disabled' : ''}></div>
      </div>
      <label class="check"><input type="checkbox" name="free" id="cb-free" ${free ? 'checked' : ''} ${done ? 'disabled' : ''}> Free re-treat: no charge and no invoice</label>
      ${done ? '<div class="hint">This stop is finished, so it keeps the price and invoice it had.</div>' : ''}
      ${fresh ? '<div class="field" style="margin-top:10px"><label>Note for the tech</label><textarea name="office_notes" maxlength="2000" placeholder="Gate code, where the activity is..."></textarea></div>' : ''}
      <button class="btn primary block" id="cb-save" style="margin-top:12px" ${q.original ? '' : 'disabled'}>${fresh ? 'Book callback' : 'Save callback'}</button>`;

    const syncFree = () => $('#cb-price-wrap', box).classList.toggle('hidden', $('#cb-free', box).checked);
    syncFree();
    $('#cb-free', box).onchange = () => { touchedFree = true; syncFree(); };
    $('#cb-price', box).oninput = () => { touchedPrice = true; };
    // Ask the server again whenever the address, the service, or the day they asked changes.
    const again = async (newAddress) => {
      const f = formData(box);
      try {
        const n = await quote({ property_id: f.property_id, original_id: newAddress ? '' : f.original_id, asked_on: f.asked_on, service_type_id: f.service_type_id });
        if (newAddress) $('#cb-orig', box).innerHTML = n.candidates.length ? n.candidates.map((o) => originalOption(o, n.original?.id)).join('') : '<option value="">No finished service here yet</option>';
        $('#cb-win', box).innerHTML = windowText(n);
        $('#cb-earlier', box).innerHTML = earlierText(n);
        $('#cb-save', box).disabled = !n.original;
        if (!done && !touchedFree) { $('#cb-free', box).checked = n.free; syncFree(); }
        if (!done && !touchedPrice) $('#cb-price', box).value = n.value;
      } catch (e) { toast(e.message, true); }
    };
    if ($('#cb-prop', box)) $('#cb-prop', box).onchange = () => again(true);
    $('#cb-orig', box).onchange = () => again(false);
    $('#cb-asked', box).onchange = () => again(false);
    $('#cb-svc', box).onchange = () => again(false);
    $('#cb-save', box).onclick = async (e) => {
      const f = formData(box);
      if (!f.reason) return toast("Say what's still active, and where", true);
      e.target.disabled = true;
      try {
        const body = { ...f, request_id: base.request_id };
        if (q.current) {
          const r = await api(`/nuvolve/app/api/callbacks/${q.current.id}`, { method: 'PUT', body });
          toast(r.free ? 'Saved. Free re-treat.' : `Saved. Price ${money(r.price)}.`);
        } else {
          const r = await api('/nuvolve/app/api/callbacks', { body });
          toast(`Callback booked for ${fmtDay(r.date)}${r.tech_name ? ` with ${r.tech_name}` : ''}. ${r.free ? 'Free re-treat.' : `Price ${money(r.price)}.`}`);
        }
        m.close();
        route();
      } catch (err) { toast(err.message, true); } finally { e.target.disabled = false; }
    };
  };

  const start = (extra) => quote(extra).then(draw).catch((e) => { box.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; });
  if (visit || opts.requestId || opts.customerId) start();
  else customerPicker(box, (c) => { base.customer_id = c.id; start(); });
}
const earlierText = (q) => (q.earlier?.length ? `<div class="alert info"><span>🔁 This would be trip ${q.earlier.length + 1} back for this service. Earlier: ${q.earlier.map((e) => `${fmtDate(e.date)} (${esc(e.status)})`).join(', ')}.</span></div>` : '');

// One click on Today: book the plan the server worked out (the day, the tech, free or not).
async function bookFromRequest(b) {
  b.disabled = true;
  try {
    const r = await api('/nuvolve/app/api/callbacks', { body: { request_id: Number(b.dataset.cbBook), original_id: Number(b.dataset.orig), date: b.dataset.date, tech_id: b.dataset.tech || null } });
    toast(`Callback booked for ${fmtDay(r.date)}${r.tech_name ? ` with ${r.tech_name}` : ''}. ${r.free ? 'Free re-treat.' : `Price ${money(r.price)}.`}`);
    route();
  } catch (e) { toast(e.message, true); b.disabled = false; }
}
function wireRequests(root) {
  $$('[data-cb-book]', root).forEach((b) => (b.onclick = () => bookFromRequest(b)));
  $$('[data-cb-open]', root).forEach((b) => (b.onclick = () => callbackModal({ requestId: Number(b.dataset.cbOpen) })));
}
// "Day 6 of 30 free days after the Oct 25 General Pest" for a request's plan.
function planLine(p) {
  const after = `the ${fmtDate(p.original.date)} ${esc(svcName(p.original))}`;
  const where = !p.window_days ? `${plural(p.days_after, 'day', 'days')} after ${after} (no free window)`
    : p.inside ? `Day ${p.days_after} of ${p.window_days} free days after ${after}` : `${plural(p.days_after, 'day', 'days')} after ${after}, past the ${p.window_days}-day free window`;
  return `${where}${p.repeat ? ` · already ${plural(p.repeat, 'callback', 'callbacks')} on it` : ''}`;
}
const bookButton = (r, p, label) => `<button class="btn sm primary" data-cb-book="${r.id}" data-orig="${p.original.id}" data-date="${esc(p.date)}" data-tech="${p.tech_id || ''}">🔁 ${label}: ${esc(fmtDay(p.date))} · ${esc(p.tech_name || 'Unassigned')}</button>`;
const bookLabel = (p) => (p.free ? 'Book free re-treat' : `Book callback (${money(p.price)})`);

NV.slot('today.request', ({ r }) => {
  const p = r.callback;
  if (!p || r.visit_id) return '';
  if (!p.marked) return `<button class="btn sm" data-cb-open="${r.id}">🔁 Book as a callback</button>`;
  return `<span class="small" style="flex-basis:100%;order:-1">🔁 <b>Callback request.</b> ${planLine(p)}.</span>${bookButton(r, p, bookLabel(p))}<button class="btn sm" data-cb-open="${r.id}">Change details</button>`;
});
NV.on('page', ({ view }) => { if (view) wireRequests(view); });

// ---------- customer page ----------
NV.slot('customer.actions', () => '<button class="btn" id="cb-cust">🔁 Callback</button>');
NV.slot('customer.left', ({ c }) => {
  const list = (c.visits || []).filter((v) => v.callback_of);
  const waiting = (c.requests || []).filter((r) => r.callback_of && r.status === 'new' && !r.visit_id);
  const w = c.callback_window;
  if (!list.length && !waiting.length && !w?.open) return '';
  return `<div class="card" id="cb-card">
    <div class="card-head"><h2>🔁 Callbacks</h2><button class="btn sm" data-cb-new>Schedule a callback</button></div>
    ${w ? `<div class="small" style="margin-bottom:8px">${w.open ? `✅ Free re-treat window open until <b>${fmtDate(w.free_until)}</b>` : `Free re-treat window ${w.free_until ? `ended ${fmtDate(w.free_until)}` : 'not set for this service'}`} (after the ${fmtDate(w.service_date)} ${esc(svcName(w))}).</div>` : ''}
    ${waiting.map((r) => `<div class="alert info"><span>⏳ <b>Waiting to be booked:</b> ${esc(r.message)} <span class="small">(${esc(sourceLabel(r.source))}, ${fmtDate(r.created_at)})</span></span><button class="btn sm primary" data-cb-open="${r.id}">Book it</button></div>`).join('')}
    ${list.slice(0, 8).map((v) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--line)">
      <div><b>${fmtDate(v.date)}</b> ${statusPill(v.status)} ${v.callback_free ? '<span class="pill green">Free</span>' : `<span class="pill yellow">${money(v.price)}</span>`}
        <div class="small">${esc(v.callback_reason || '')}</div><div class="small muted">${esc(v.tech_name || 'Unassigned')} · ${esc(sourceLabel(v.callback_source))}</div></div>
      <a class="btn sm" href="#/visits/${v.id}">Open</a></div>`).join('')}
  </div>`;
});
NV.on('customer.rendered', ({ c, view }) => {
  const open = () => callbackModal({ customerId: c.id });
  if ($('#cb-cust', view)) $('#cb-cust', view).onclick = open;
  $$('[data-cb-new]', view).forEach((b) => (b.onclick = open));
});

// ---------- visit page ----------
NV.slot('visit.left', ({ v }) => {
  const cb = v.callback;
  if (cb) {
    const o = cb.original;
    return `<div class="card" style="border-left:4px solid #dd6b20">
      <div class="card-head"><h2>🔁 Callback</h2><button class="btn sm" id="cb-edit">Change</button></div>
      <p style="margin:0 0 6px"><b>${esc(cb.reason || '')}</b></p>
      ${o ? `<div class="small">Follows the <a href="#/visits/${o.id}">${fmtDate(o.date)} ${esc(svcName(o))}</a>${o.tech_name ? ` by ${esc(o.tech_name)}` : ''}. ${esc(askedText(cb.days_after))}${cb.asked_on ? ` (${fmtDate(cb.asked_on)})` : ''} · ${esc(sourceLabel(cb.source))}.</div>` : ''}
      <div style="margin-top:6px">${cb.free ? '<span class="pill green">Free re-treat</span>' : `<span class="pill yellow">Charged ${money(v.price)}</span>`}
        ${cb.free && cb.inside === false ? '<span class="pill">Given free outside the window</span>' : ''}${!cb.free && cb.inside ? '<span class="pill">Charged inside the free window</span>' : ''}
        ${cb.free && cb.value ? `<span class="small muted">Worth ${money(cb.value)}</span>` : ''}</div>
      ${cb.earlier.length ? `<div class="small" style="margin-top:6px">⚠️ Trip ${cb.earlier.length + 1} back for this service.</div>` : ''}
      ${o ? lastTime(o) : ''}
    </div>`;
  }
  if (v.status === 'completed' && v.callback_window) {
    const w = v.callback_window;
    return `<div class="card">
      <div class="card-head"><h2>🔁 Callbacks</h2><button class="btn sm" id="cb-from">Schedule a callback</button></div>
      <div class="small">${w.days ? `${w.open ? '✅ Free re-treats until' : 'Free re-treat window ended'} <b>${fmtDate(w.free_until)}</b> (${w.days} days${w.from === 'plan' ? ', set on the plan' : ''}).` : 'No free re-treat window on this service.'}</div>
      ${w.callbacks.map((x) => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)"><a href="#/visits/${x.id}">${fmtDate(x.date)}</a> ${statusPill(x.status)} ${esc(x.reason || '')}</div>`).join('')}
    </div>`;
  }
  if (v.status === 'scheduled' && !v.plan_id) {
    return `<div class="card"><div class="card-head"><h2>🔁 A trip back?</h2><button class="btn sm" id="cb-convert">Mark as a callback</button></div>
      <div class="small muted">If pests are still active after a service, link this visit to it. Inside the free window it's free and makes no invoice.</div></div>`;
  }
  return '';
});
NV.on('visit.rendered', ({ v, view }) => {
  if ($('#cb-edit', view)) $('#cb-edit', view).onclick = () => callbackModal({ visit: v });
  if ($('#cb-convert', view)) $('#cb-convert', view).onclick = () => callbackModal({ visit: v });
  if ($('#cb-from', view)) $('#cb-from', view).onclick = () => callbackModal({ customerId: v.customer_id, originalId: v.id });
});

// A plan can have its own free window (a mosquito plan with 14 days, a termite plan with 365).
NV.slot('plan.form', ({ p }) => {
  const boot = typeof BOOT !== 'undefined' && BOOT ? BOOT : {};
  const st = (boot.serviceTypes || []).find((s) => s.id === Number(p.service_type_id));
  const fallback = st?.retreat_days ?? boot.settings?.callback_free_days ?? 30;
  return `<div class="field"><label>Free re-treat window (days)</label><input name="retreat_days" type="number" min="0" max="365" step="1" value="${p.retreat_days ?? ''}" placeholder="Service default (${esc(fallback)})">
    <div class="hint">Callbacks asked for within this many days of a service on this plan are free. Leave blank to use the service's window.</div></div>`;
});

// A free callback's ticket can't be charged.
NV.on('ticket.rendered', ({ root, visit }) => {
  const free = visit?.callback ? visit.callback.free : visit?.callback_free;
  const price = $('#price', root);
  if (!visit?.callback_of || !free || !price) return;
  price.value = '0';
  price.disabled = true;
  price.insertAdjacentHTML('afterend', `<div class="hint">🔁 ${esc(t('Free re-treat: no charge and no invoice.'))}</div>`);
});

// ---------- the Callbacks page ----------
const PERIODS = [['30', 'Last 30 days'], ['90', 'Last 90 days'], ['month', 'This month'], ['last_month', 'Last month'], ['year', 'This year'], ['12m', 'Last 12 months']];
const rateBar = (pct) => `<div style="height:6px;background:#edf2f7;border-radius:3px;min-width:70px;margin-top:4px"><div style="height:6px;width:${Math.min(100, Math.max(0, Number(pct) || 0))}%;background:#dd6b20;border-radius:3px"></div></div>`;
const rateTable = (rows, first) => (rows.length ? `<table class="list"><thead><tr><th>${first}</th><th class="right">Services</th><th class="right">Called back</th><th>Rate</th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td>${r.color ? `<span class="dot" style="background:${esc(r.color)}"></span>` : ''}${esc(r.label)}</td><td class="right">${r.services}</td><td class="right">${r.called_back}</td><td><b>${r.rate}%</b>${rateBar(r.rate)}</td></tr>`).join('')}
  </tbody></table>` : '<p class="muted" style="padding:0 16px">No finished services in this period.</p>');

NV.nav({ href: '#/callbacks', icon: '🔁', label: 'Callbacks', after: '#/retention' });
NV.page('callbacks', async (view, _id, params) => {
  const period = PERIODS.some((p) => p[0] === params.period) ? params.period : '90';
  const d = await api(`/nuvolve/app/api/callbacks?period=${period}`);
  const sm = d.summary, cost = d.cost, cfg = d.config;
  const exportUrl = `/nuvolve/app/api/callbacks/export?${qs({ period, loc: currentBranch() })}`;
  view.innerHTML = `
    <div class="page-head"><div><h1>Callbacks</h1><div class="muted">Trips back when pests are still active. Free inside the re-treat window${cfg.unpaid ? `, and no production pay within ${cfg.unpaidDays} days of the service` : ''}.</div></div>
      <div class="actions"><select id="cb-period" aria-label="Period" style="width:auto">${PERIODS.map(([k, l]) => `<option value="${k}" ${k === period ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn primary" id="cb-new">+ Schedule a callback</button>
        <a class="btn" href="${esc(exportUrl)}">⬇️ Export CSV</a>
        ${BOOT.me.isAdmin ? '<a class="btn" href="#/settings?tab=callbacks">⚙️ Settings</a>' : ''}</div></div>
    <div class="stats">
      <div class="stat ${sm.rate >= 10 ? 'warn' : ''}"><div class="label">Callback rate</div><div class="value">${sm.rate}%</div><div class="sub">${sm.called_back} of ${plural(sm.services, 'service', 'services')} called back within ${cfg.rateDays} days</div></div>
      <div class="stat"><div class="label">Open callbacks</div><div class="value">${sm.open}</div><div class="sub">${sm.waiting ? `${plural(sm.waiting, 'request', 'requests')} waiting to be booked` : 'on the schedule'}</div></div>
      <div class="stat"><div class="label">Given away</div><div class="value">${money(cost.given_away)}</div><div class="sub">${plural(cost.free, 'free re-treat', 'free re-treats')} · ${cost.free_hours} hrs of tech time${cost.estimated ? '*' : ''}</div></div>
      <div class="stat ${sm.repeat_addresses ? 'warn' : ''}"><div class="label">Repeat addresses</div><div class="value">${sm.repeat_addresses}</div><div class="sub">2 or more callbacks in this period</div></div>
    </div>
    ${d.waiting.length ? `<div class="card"><div class="card-head"><h2>⏳ Callback requests waiting</h2></div>
      ${d.waiting.map((r) => `<div style="padding:10px 0;border-bottom:1px solid var(--line)">
        <div style="display:flex;justify-content:space-between;gap:8px"><a href="#/customers/${r.customer_id}"><b>${esc(r.customer_name)}</b></a><span class="small muted">${esc(sourceLabel(r.source))} · ${fmtDate(r.created_at)}</span></div>
        <div>${esc(r.message)}</div>
        <div class="actions" style="margin-top:6px">${r.plan ? `<span class="small muted" style="flex-basis:100%">${planLine(r.plan)}.</span>${bookButton(r, r.plan, bookLabel(r.plan))}` : ''}<button class="btn sm" data-cb-open="${r.id}">${r.plan ? 'Change details' : 'Book it'}</button></div>
      </div>`).join('')}</div>` : ''}
    <div class="card flush"><div class="card-head" style="padding:14px 16px 0"><h2>Open callbacks</h2></div><div class="table-wrap">
      ${d.open.length ? `<table class="list"><thead><tr><th>Booked for</th><th>Customer</th><th>What's still active</th><th>Follows</th><th>Tech</th><th class="right">Price</th></tr></thead><tbody>
        ${d.open.map((r) => `<tr class="click" data-visit="${r.id}"><td class="nowrap"><b>${fmtDay(r.date)}</b>${r.date < todayStr() ? ' <span class="pill red">Overdue</span>' : ''}${r.time_window ? `<div class="small muted">${esc(r.time_window)}</div>` : ''}</td>
          <td>${esc(r.customer_name)}<div class="small muted">${esc(r.address)}</div></td><td class="small">${esc(r.reason || '')}</td>
          <td class="small nowrap">${r.original_date ? fmtDate(r.original_date) : '—'}</td><td class="small">${esc(r.tech_name || 'Unassigned')}</td>
          <td class="right">${r.free ? '<span class="pill green">Free</span>' : money(r.price)}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty"><div class="big">🎉</div><h3>No callbacks on the schedule</h3><p>Callbacks you book from Today, a customer or a visit show up here until they\'re done.</p></div>'}
    </div></div>
    <div class="grid cols-2">
      <div class="card flush"><div class="card-head" style="padding:14px 16px 0"><h2>By tech</h2></div><div class="table-wrap">${rateTable(d.byTech, 'Tech who did the service')}</div>
        <p class="small muted" style="padding:0 16px 12px">Share of each tech's finished regular services that got a callback within ${cfg.rateDays} days. Recent services may still get one.</p></div>
      <div class="card flush"><div class="card-head" style="padding:14px 16px 0"><h2>By service</h2></div><div class="table-wrap">${rateTable(d.byService, 'Service')}</div></div>
    </div>
    <div class="card flush"><div class="card-head" style="padding:14px 16px 0"><h2>By month</h2></div><div class="table-wrap">
      <table class="list"><thead><tr><th>Month</th><th class="right">Services</th><th class="right">Called back</th><th>Rate</th><th class="right">Callbacks asked</th><th class="right">Given away</th></tr></thead><tbody>
      ${d.byMonth.map((r) => `<tr><td>${fmtDate(`${r.month}-01`, { month: 'long', year: 'numeric' })}</td><td class="right">${r.services}</td><td class="right">${r.called_back}</td><td><b>${r.rate}%</b>${rateBar(r.rate)}</td><td class="right">${r.callbacks}</td><td class="right">${money(r.given_away)}</td></tr>`).join('')}
      </tbody></table></div></div>
    <div class="grid cols-2">
      <div class="card"><div class="card-head"><h2>Repeat addresses</h2></div>
        ${d.repeats.length ? d.repeats.map((r) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)"><div style="display:flex;justify-content:space-between;gap:8px"><a href="#/customers/${r.customer_id}"><b>${esc(r.customer_name)}</b></a><span class="pill red">${r.callbacks} callbacks</span></div>
          <div class="small">${esc(r.address)}${r.city ? `, ${esc(r.city)}` : ''}</div><div class="small muted">Last: ${esc(r.last_reason || '')} (${fmtDate(r.last_asked)})${r.techs.length ? ` · services by ${esc(r.techs.join(', '))}` : ''}</div></div>`).join('')
          : '<p class="muted">No address needed more than one callback in this period.</p>'}</div>
      <div class="card"><div class="card-head"><h2>What callbacks cost</h2></div>
        <table class="list"><tbody>
          <tr><td>Free re-treats finished</td><td class="right"><b>${cost.free}</b></td></tr>
          <tr><td>Revenue given away (at the re-service price)</td><td class="right"><b>${money(cost.given_away)}</b></td></tr>
          <tr><td>Tech time on free re-treats</td><td class="right"><b>${cost.free_hours} hrs</b></td></tr>
          <tr><td>Charged callbacks finished</td><td class="right">${cost.charged} · ${money(cost.billed)} billed</td></tr>
          <tr><td>Tech time on all callbacks</td><td class="right">${cost.hours} hrs</td></tr>
        </tbody></table>
        ${cost.estimated ? '<p class="small muted">* Stops without Start service and Complete times count the service\'s usual length.</p>' : ''}</div>
    </div>
    <div class="card flush"><div class="card-head" style="padding:14px 16px 0"><h2>All callbacks in this period</h2><span class="small muted">${d.recent.length < sm.callbacks ? `Latest ${d.recent.length} of ${sm.callbacks}. The CSV has them all.` : ''}</span></div><div class="table-wrap">
      ${d.recent.length ? `<table class="list"><thead><tr><th>Asked</th><th>Customer</th><th>What's still active</th><th>Who asked</th><th>Follows</th><th>Status</th><th class="right">Price</th></tr></thead><tbody>
        ${d.recent.map((r) => `<tr class="click" data-visit="${r.id}"><td class="nowrap">${fmtDate(r.asked_on)}</td><td>${esc(r.customer_name)}<div class="small muted">${esc(r.address)}</div></td>
          <td class="small">${esc(r.reason || '')}</td><td class="small">${esc(sourceLabel(r.source))}</td>
          <td class="small nowrap">${r.original_date ? `${fmtDate(r.original_date)}<div class="muted">${plural(r.days_after, 'day', 'days')} before · ${esc(r.original_tech || 'No tech')}</div>` : '—'}</td>
          <td>${statusPill(r.status)}</td><td class="right">${r.free ? '<span class="pill green">Free</span>' : money(r.price)}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted" style="padding:0 16px 12px">No callbacks asked for in this period.</p>'}
    </div></div>`;
  $('#cb-period', view).onchange = (e) => { location.hash = `#/callbacks?period=${e.target.value}`; };
  $('#cb-new', view).onclick = () => callbackModal();
  $$('tr[data-visit]', view).forEach((tr) => (tr.onclick = () => { location.hash = `#/visits/${tr.dataset.visit}`; }));
  wireRequests(view);
});

// ---------- settings ----------
NV.settingsTab({
  key: 'callbacks',
  label: 'Callbacks',
  async render(box) {
    const s = await api('/nuvolve/app/api/callbacks/settings');
    box.innerHTML = `<form class="card" id="cb-set" style="max-width:860px">
      <h2>Callbacks and free re-treats</h2>
      <p class="small muted">A callback is a trip back when pests are still active after a regular service. Inside the free window it costs the customer nothing and makes no invoice. Outside it, the office sees that and the price starts at the service's re-service price.</p>
      <div class="row">
        <div class="field"><label>Free re-treat window (days)</label><input name="free_days" type="number" min="0" max="365" step="1" value="${s.freeDays}"><div class="hint">For services that don't set their own below. 0 means callbacks are always charged.</div></div>
        <div class="field"><label>Callback rate counts callbacks within (days)</label><input name="rate_days" type="number" min="1" max="365" step="1" value="${s.rateDays}"><div class="hint">For the rate by tech, service and month on the Callbacks page.</div></div>
      </div>
      <h3>Production pay</h3>
      <label class="check"><input type="checkbox" name="unpaid" ${s.unpaid ? 'checked' : ''}> A callback finished soon after the service pays no production to whoever does it</label>
      <div class="row" style="margin-top:8px">
        <div class="field"><label>Within (days of the service)</label><input name="unpaid_days" type="number" min="1" max="365" step="1" value="${s.unpaidDays}"></div>
        <div class="field"><label>After that, free callbacks pay production on</label><select name="production"><option value="reservice" ${s.production === 'reservice' ? 'selected' : ''}>The service's re-service price</option><option value="price" ${s.production === 'price' ? 'selected' : ''}>Only what the customer paid</option></select></div>
      </div>
      <div class="hint">Only production pay changes. Hourly and salary pay stay the same. Each pay line says which callbacks paid nothing and why.</div>
      <h3 style="margin-top:18px">By service</h3>
      <div class="table-wrap"><table class="list"><thead><tr><th>Service</th><th class="right">Price</th><th>Free window (days)</th><th>Re-service price</th></tr></thead><tbody>
        ${s.services.map((x) => `<tr><td>${esc(x.name)}</td><td class="right">${money(x.default_price)}</td>
          <td><input data-win="${x.id}" type="number" min="0" max="365" step="1" value="${x.retreat_days ?? ''}" placeholder="${s.freeDays} (company)" style="max-width:130px" aria-label="Free window for ${esc(x.name)}"></td>
          <td><input data-rs="${x.id}" type="number" min="0" step="0.01" value="${x.reservice_price ?? ''}" placeholder="${esc(money(x.default_price))}" style="max-width:130px" aria-label="Re-service price for ${esc(x.name)}"></td></tr>`).join('')}
      </tbody></table></div>
      <div class="hint">Leave a box blank to use the company window or the service's regular price. A plan can also set its own window on the plan form.</div>
      <button class="btn primary" style="margin-top:14px">Save callback settings</button>
    </form>`;
    $('#cb-set', box).onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const services = s.services.map((x) => ({ id: x.id, retreat_days: $(`[data-win="${x.id}"]`, box).value.trim(), reservice_price: $(`[data-rs="${x.id}"]`, box).value.trim() }));
      try {
        await api('/nuvolve/app/api/callbacks/settings', { method: 'PUT', body: { free_days: f.free_days, rate_days: f.rate_days, unpaid: f.unpaid, unpaid_days: f.unpaid_days, production: f.production, services } });
        await refreshBoot();
        toast('Saved');
      } catch (err) { toast(err.message, true); }
    };
  },
});

// ---------- tech app ----------
NV.slot('tech.routeStop', ({ s }) => (s.callback_of ? `<div class="small" style="color:#c05621;font-weight:600">${esc(flagText(s.callback_reason, s.callback_original_date))}</div>` : ''));
NV.slot('tech.stop', ({ v }) => {
  const cb = v.callback;
  if (!cb) return '';
  return `<div class="card" style="border-left:4px solid #dd6b20">
    <h3 style="margin:0 0 6px">${esc(flagText(cb.reason, cb.original?.date))}</h3>
    <div class="small">${cb.free ? `✅ ${esc(t('Free re-treat: no charge'))}` : `💲 ${esc(t('Re-service price: {price}', { price: money(v.price) }))}`}</div>
    <div class="small muted">${esc(askedText(cb.days_after))} · ${esc(t(sourceLabel(cb.source)))}</div>
    ${cb.earlier.length ? `<div class="small" style="margin-top:4px">⚠️ ${esc(t('This is trip {n} back for this service.', { n: cb.earlier.length + 1 }))}</div>` : ''}
    ${cb.original ? lastTime(cb.original) : ''}
  </div>`;
});
// A finished stop where pests are still active: the tech tells the office, which books the callback.
NV.slot('tech.stopActions', ({ v }) => (v.status === 'completed' && !v.waiting ? `<button type="button" class="btn big" id="cb-need">🔁 ${esc(t('Needs a callback'))}</button>` : ''));
NV.on('tech.stop.rendered', ({ v, root }) => {
  const b = $('#cb-need', root);
  if (!b) return;
  b.onclick = () => modal(t('Needs a callback'), `<p class="small">${esc(t("The office books it. Say what's still active, and where."))}</p>
    <div class="field"><textarea name="reason" maxlength="300" placeholder="${esc(t('Ants still in the kitchen by the sink'))}"></textarea></div>
    <div class="field"><label>${esc(t('Best day (optional)'))}</label><input type="date" name="preferred_date" min="${todayStr()}"></div>`,
  [{ label: t('Cancel') }, { label: t('Send to the office'), cls: 'primary', onClick: async (el) => {
    const f = formData(el);
    if (!f.reason) { toast(t("Say what's still active, and where"), true); return false; }
    try {
      const r = await saveOrQueue(`/nuvolve/app/api/visits/${v.id}/callback-request`, f, { kind: 'callback', visitId: v.id });
      toast(r.queued ? t('Saved on this phone. It goes to the office when you have signal.') : r.already ? t('The office already has a callback request for this service.') : t('Sent. The office will book the callback.'));
      return true;
    } catch (e) { if (e.message) toast(t(e.message), true); return false; }
  } }]);
});

// ---------- the customer's pay page ----------
NV.slot('portal.top', ({ data }) => {
  const up = data.callbacks?.upcoming || [];
  if (!up.length) return '';
  return `<div class="card"><h2>🔁 ${esc(t(up.length > 1 ? 'Re-treats booked' : 'Re-treat booked'))}</h2>
    ${up.map((u) => `<div class="line"><span><b>${esc(longDay(u.date))}</b>${u.time_window ? ` · ${esc(u.time_window)}` : ''}</span><span class="small">${esc(u.free ? t('No charge') : t('Price: {price}', { price: money(u.price) }))}</span></div>`).join('')}
  </div>`;
});
// Inside the free window, the "Need us sooner?" card says so, with the date it ends.
NV.on('portal.rendered', ({ data, root }) => {
  const w = data.callbacks?.window;
  const req = $('#req', root);
  if (!w || !req) return;
  const card = req.closest('.card');
  const anchor = $('p', card) || req;
  anchor.insertAdjacentHTML(anchor === req ? 'beforebegin' : 'afterend', `<div class="alert ok small" id="cb-free-note">🔁 ${esc(t("Still seeing pests? We'll come back for free until {date}.", { date: longDay(w.free_until) }))}</div>`);
});

})(); } catch (e) { console.error('feature callbacks.js failed to load', e); }

/* ---- features/fieldsync.js ---- */
try { (function () {
// Offline conflicts and arrival texts (server side: src/features/fieldsync.js and fieldsync-eta.js).
//   Office: the Sync conflicts page (#/sync), a Today alert, a card on the visit page, the Arrival texts settings tab,
//           and who got an on-my-way or late text on the dispatch board.
//   Tech app: a card for a ticket someone else already completed (send mine anyway / drop mine / call the office),
//           and short notes when the office had changed a stop the phone saved later.
const T = (s, vars) => esc(NV.t(s, vars));
const utcDate = (s) => new Date(String(s).replace(' ', 'T') + (/Z$/.test(String(s)) ? '' : 'Z'));
const clockOf = (s) => (s ? utcDate(s).toLocaleTimeString(NV.lang === 'es' ? 'es-US' : 'en-US', { hour: 'numeric', minute: '2-digit' }) : '');
const whenOf = (s) => (s ? utcDate(s).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const dayOf = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(NV.lang === 'es' ? 'es-US' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '');

// ================= office =================
const KIND = { start: 'Start', complete: 'Completed ticket', skip: 'Skip', photo: 'Photo' };
const STATUS = { scheduled: 'Scheduled', completed: 'Completed', skipped: 'Skipped', cancelled: 'Cancelled', removed: 'Removed' };

function ticketBlock(t) {
  if (!t) return '<p class="small muted">Nothing typed.</p>';
  return `<div class="small">
    ${t.target_pests ? `<div><b>Pests:</b> ${esc(t.target_pests)}</div>` : ''}
    ${t.areas_serviced ? `<div><b>Areas:</b> ${esc(t.areas_serviced)}</div>` : ''}
    ${t.products?.length ? `<div><b>Products:</b> ${t.products.map((p) => `${esc(p.name)}${p.amount != null ? ` ${esc(p.amount)} ${esc(p.unit || '')}` : ''}`).join(', ')}</div>` : ''}
    ${t.price != null ? `<div><b>Price:</b> ${money(t.price)}</div>` : ''}
    ${t.reason ? `<div><b>Why:</b> ${esc(t.reason)}</div>` : ''}
    ${t.tech_notes ? `<div><b>Notes:</b> ${esc(t.tech_notes)}</div>` : ''}
    ${t.internal_notes ? `<div class="office-note-view">🔒 ${esc(t.internal_notes)}</div>` : ''}
    ${t.signed ? '<div>✍️ Customer signed</div>' : ''}
  </div>`;
}
function officeBlock(o) {
  if (!o || o.status === 'removed') return '<p class="small">Not on the schedule anymore (removed).</p>';
  return `<div class="small">
    <div><b>${esc(STATUS[o.status] || o.status)}</b>${o.date ? ` · ${fmtDate(o.date)}` : ''}${o.tech_name ? ` · ${esc(o.tech_name)}` : ''}</div>
    ${o.status === 'completed' ? `<div>By ${esc(o.completed_by_name || 'someone')}${o.completed_at ? ` at ${esc(whenOf(o.completed_at))}` : ''}</div>` : ''}
    ${o.price != null ? `<div><b>Price:</b> ${money(o.price)}</div>` : ''}
    ${o.products?.length ? `<div><b>Products:</b> ${o.products.map((p) => `${esc(p.name)}${p.amount != null ? ` ${esc(p.amount)} ${esc(p.unit || '')}` : ''}`).join(', ')}</div>` : ''}
    ${o.tech_notes ? `<div><b>Notes:</b> ${esc(o.tech_notes)}</div>` : ''}
  </div>`;
}

function conflictRow(c) {
  const tech = (c.tech_name || 'The tech').split(' ')[0];
  const choice = c.tech_choice === 'mine' ? `<div class="alert info small">📱 ${esc(tech)} asked to use their ticket${c.tech_choice_at ? ` (${esc(whenOf(c.tech_choice_at))})` : ''}.</div>`
    : c.tech_choice === 'drop' ? `<div class="small muted">📱 ${esc(tech)} dropped their ticket.</div>` : '';
  return `<div class="card" data-conflict="${c.id}">
    <div class="card-head"><h3 style="margin:0">🔄 ${esc(c.title)}</h3><span class="small muted">${esc(whenOf(c.done_at || c.created_at))}</span></div>
    <div class="small" style="margin-bottom:6px">${c.visit_id ? `<a href="#/visits/${c.visit_id}">${esc(c.customer_name || 'Visit')}</a>` : esc(c.customer_name || 'Customer removed')}${c.address ? ` · ${esc(c.address)}${c.city ? `, ${esc(c.city)}` : ''}` : ''}
      · ${esc(KIND[c.kind] || c.kind)} from ${esc(c.tech_name || 'a tech')}'s phone</div>
    <p style="margin:6px 0">${esc(c.detail)}</p>
    ${choice}
    <div class="grid cols-2" style="gap:10px">
      <div style="background:var(--bg);border-radius:8px;padding:8px 10px"><b class="small">The office had</b>${officeBlock(c.office)}</div>
      <div style="background:var(--brand-soft);border-radius:8px;padding:8px 10px"><b class="small">${esc(tech)}'s ticket</b>${ticketBlock(c.mine)}</div>
    </div>
    ${c.replaced ? `<details class="small" style="margin-top:6px"><summary>The ticket it replaced</summary>${ticketBlock(c.replaced)}</details>` : ''}
    ${c.status === 'open' ? `<div class="actions" style="margin-top:10px">
      ${c.can.use_mine ? `<button class="btn primary sm" data-act="use_mine">Use ${esc(tech)}'s ticket</button>` : ''}
      ${c.can.keep ? '<button class="btn sm" data-act="keep">Keep the one on file</button>' : ''}
      ${c.can.ack ? '<button class="btn primary sm" data-act="ack">Mark handled</button>' : ''}</div>`
    : `<div class="small muted" style="margin-top:8px">✓ ${esc(c.resolution_text || 'Handled')}${c.resolved_by_name ? ` by ${esc(c.resolved_by_name)}` : ''}${c.resolved_at ? `, ${esc(whenOf(c.resolved_at))}` : ''}</div>`}
  </div>`;
}

async function pageSync(view, _id, params) {
  const tab = params.tab === 'resolved' ? 'resolved' : 'open';
  const d = await api(`/nuvolve/app/api/sync/conflicts?status=${tab}`);
  view.innerHTML = `
    <div class="page-head"><div><h1>Sync conflicts</h1>
      <div class="muted">Saves from techs' phones that came in after the office changed the same stop. The work is never thrown away: decide what stays.</div></div></div>
    <div class="tabs"><a href="#/sync" class="${tab === 'open' ? 'on' : ''}">Needs a look (${d.counts.open})</a><a href="#/sync?tab=resolved" class="${tab === 'resolved' ? 'on' : ''}">Handled (${d.counts.resolved})</a></div>
    ${d.conflicts.map(conflictRow).join('') || `<div class="card empty"><div class="big">✅</div><h3>${tab === 'open' ? 'Nothing needs a look' : 'Nothing handled yet'}</h3>
      <p>When a tech's phone saves a stop the office changed while they had no signal, it shows up here.</p></div>`}`;
  $$('[data-act]', view).forEach((b) => (b.onclick = async () => {
    const id = b.closest('[data-conflict]').dataset.conflict;
    const c = d.conflicts.find((x) => String(x.id) === id);
    if (b.dataset.act === 'use_mine' && !confirm(`Use ${(c.tech_name || 'the tech').split(' ')[0]}'s ticket for this stop? The ticket on file is kept here in case you need it.`)) return;
    b.disabled = true;
    try {
      await api(`/nuvolve/app/api/sync/conflicts/${id}/resolve`, { body: { action: b.dataset.act } });
      toast(b.dataset.act === 'use_mine' ? 'Ticket replaced' : 'Handled');
      route();
    } catch (e) { toast(e.message, true); b.disabled = false; }
  }));
}
NV.page('sync', pageSync);
NV.nav({ href: '#/sync', icon: '🔄', label: 'Sync conflicts', after: '#/dispatch' });

NV.slot('today.alerts', ({ d }) => (d?.sync_conflicts ? `<div class="alert warn"><span>🔄 <b>${d.sync_conflicts} save${d.sync_conflicts > 1 ? 's' : ''} from techs' phones
  need${d.sync_conflicts > 1 ? '' : 's'} a look.</b> The office changed ${d.sync_conflicts > 1 ? 'those stops' : 'that stop'} while the tech had no signal.</span><a class="btn sm" href="#/sync">Review</a></div>` : ''));

NV.slot('visit.right', ({ v }) => (v?.sync_conflicts?.length ? `<div class="alert ${v.sync_conflicts.some((c) => c.status === 'open') ? 'warn' : 'info'}" style="margin-top:12px;display:block">
  <b>🔄 From a tech's phone</b>${v.sync_conflicts.map((c) => `<div class="small">${esc(c.title)} · ${c.status === 'open' ? 'needs a look' : 'handled'}</div>`).join('')}
  <a class="btn sm" href="#/sync${v.sync_conflicts.some((c) => c.status === 'open') ? '' : '?tab=resolved'}" style="margin-top:6px">Open Sync conflicts</a></div>` : ''));

// ---------- Settings → Arrival texts ----------
NV.settingsTab({
  key: 'arrival', label: 'Arrival texts',
  render(box, d) {
    const s = d.settings;
    box.innerHTML = `<form class="card" id="arrival" style="max-width:720px">
      <h2>Arrival texts</h2>
      <p class="small muted">Automatic texts when the tech is close and when they'll miss the customer's time window. They go only to customers with a phone,
        in Spanish for Spanish speakers, and never twice: a tech who already tapped On my way doesn't send another.</p>
      ${s.sms_enabled === '1' ? '' : '<div class="alert warn">Texting is off, so these won\'t go out. Turn on "Also send texts" in <a href="#/settings?tab=followup">Follow-up</a>.</div>'}
      <label class="check"><input type="checkbox" name="auto_omw" ${s.auto_omw === '1' ? 'checked' : ''}> Text the next customer when the tech is on the way</label>
      <div class="field" style="margin-top:8px"><label>Send it when the tech is this many minutes away</label>
        <input name="auto_omw_minutes" type="number" min="5" max="60" step="1" value="${esc(s.auto_omw_minutes || '20')}" style="max-width:120px">
        <div class="hint">"Your technician Mike is about 20 minutes away", with the live tracking link. Checked when the tech finishes a stop or starts driving, from the dispatch arrival time.</div></div>
      <label class="check"><input type="checkbox" name="late_text" ${s.late_text === '1' ? 'checked' : ''}> Text the customer when the tech is running late</label>
      <div class="field" style="margin-top:8px"><label>When the arrival time is this many minutes past their time window</label>
        <input name="late_text_minutes" type="number" min="5" max="120" step="1" value="${esc(s.late_text_minutes || '15')}" style="max-width:120px">
        <div class="hint">Only for visits with a time window (like 8-10am), once per visit, with the new arrival time.</div></div>
      <button class="btn primary" style="margin-top:12px">Save arrival texts</button>
    </form>`;
    $('#arrival').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = { auto_omw: f.auto_omw.checked ? '1' : '0', late_text: f.late_text.checked ? '1' : '0', auto_omw_minutes: f.auto_omw_minutes.value, late_text_minutes: f.late_text_minutes.value };
      try { await api('/nuvolve/app/api/settings', { method: 'PUT', body }); await refreshBoot(); toast('Saved'); } catch (err) { toast(err.message, true); }
    };
  },
});

// ---------- the dispatch board: who got a text, and when ----------
const SENT = { logged: 'demo mode, not sent', blocked: 'not sent (texting not allowed)', queued: 'waiting for quiet hours', failed: "didn't go through", sending: 'sending' };
NV.slot('dispatch.side', ({ d }) => {
  if (!d?.techs) return '';
  const list = d.arrival_texts || [];
  const s = d.arrival_settings || {};
  const auto = [s.omw && `on my way at ${s.omw_minutes} min out`, s.late && `late texts at ${s.late_minutes} min past the window`].filter(Boolean);
  return `<div class="card" style="padding:12px" id="arrival-texts"><div class="card-head"><h3 style="margin:0">✉️ Arrival texts${list.length ? ` (${list.length})` : ''}</h3></div>
    <div class="small muted" style="margin-bottom:6px">${auto.length ? `Automatic: ${auto.join(' · ')}${s.texting ? '' : '. Texting is off in Settings, so nothing goes out.'}`
      : `Automatic texts are off.${BOOT.me.isAdmin ? ' <a href="#/settings?tab=arrival">Turn them on</a>' : ''}`}</div>
    ${list.slice(0, 15).map((t) => `<div class="small" style="padding:5px 0;border-bottom:1px solid var(--line)">
      <b>${esc(t.at_text || '')}</b> · <a href="#/visits/${t.visit_id}">${esc(t.name)}</a>
      · ${t.kind === 'late' ? '⏰ Running late' : '🚚 On my way'}${t.how === 'auto' ? ' (automatic)' : ''}${t.minutes ? ` · ${t.minutes} min out` : ''}${t.eta_text ? ` · ETA ${esc(t.eta_text)}` : ''}
      ${t.tech_name ? `<span class="muted">· ${esc(t.tech_name.split(' ')[0])}</span>` : ''}${SENT[t.status] ? ` <span style="color:var(--warn)">· ${SENT[t.status]}</span>` : ''}</div>`).join('')
      || '<div class="small muted">No on-my-way or late texts yet for this day.</div>'}
    ${list.length > 15 ? `<div class="small muted">and ${list.length - 15} more</div>` : ''}</div>`;
});

// ================= tech app =================
const names = new Map();
let companyPhone = '';
let toastedUpTo = Date.now();
const stopName = (id) => names.get(Number(id)) || NV.t('This stop');

function remember(stops) {
  for (const s of stops || []) names.set(Number(s.id), s.company || [s.first_name, s.last_name].filter(Boolean).join(' ') || s.customer_name || s.address || '');
}

// What the server said about a save the phone sent (the office had moved it, a price changed, it was done already).
function noteText(n) {
  const vars = { name: n.name || NV.t('another tech'), date: dayOf(n.date), price: n.price != null ? money(n.price) : '' };
  return NV.t({
    already: 'This was already saved.',
    cancelled: 'The office had cancelled this stop. Your work is saved and the office will take a look.',
    office_skipped: 'The office had marked this stop skipped. Your work is saved and the office will take a look.',
    gone: 'The office had taken this stop off the schedule. Your work is saved as a new visit.',
    moved: 'The office had moved this stop to {date}. Your work is saved for the day you did it.',
    reassigned: 'The office had given this stop to {name}. Your work is saved and you get the credit.',
    price_office: 'The office changed the price to {price}. That price was used.',
    price_mine: 'The office changed the price too. Your price was used and the office will check it.',
    skip_done: '{name} already completed this stop, so your skip wasn\'t needed.',
    skip_cancelled: 'The office had already taken this stop off the schedule.',
    skip_kept_given: 'The office gave this stop to {name}. It stays on their route.',
    skip_kept_moved: 'The office moved this stop to {date}. It stays on that day.',
    start_done: '{name} already completed this stop.',
  }[n.rule] || 'The office had changed this stop. Your save went through.', vars);
}

function conflictTitle(it) {
  const c = it.conflict || {};
  if ((c.rules || []).includes('gone')) return NV.t('The office removed this customer');
  if (c.same_person) return NV.t('You already completed this stop on another phone');
  return NV.t('{name} already completed this stop', { name: (c.office?.completed_by_name || NV.t('Someone')).split(' ')[0] });
}

function conflictCard(it) {
  const o = it.conflict?.office || {};
  const t = it.body || {};
  const products = (t.products || []).filter((p) => p.product_id).length;
  const mine = [t.tech_notes && `“${String(t.tech_notes).slice(0, 140)}”`, products && NV.t(products === 1 ? '1 product' : '{n} products', { n: products }),
    t.price !== '' && t.price != null && money(t.price)].filter(Boolean).map(esc).join(' · ');
  const office = o.status === 'completed'
    ? NV.t('Completed by {name} at {time}', { name: (o.completed_by_name || NV.t('someone')).split(' ')[0], time: clockOf(o.completed_at) })
    : o.status === 'removed' || !o.status ? NV.t('Not on the schedule anymore') : NV.t(STATUS[o.status] || o.status);
  return `<div class="card" data-sync-item="${it.id}" style="border:2px solid var(--danger)">
    <h3 style="margin:0 0 6px">⚠️ ${esc(conflictTitle(it))}</h3>
    <div class="small"><b>${esc(stopName(it.visitId))}</b></div>
    <p class="small" style="margin:6px 0">${T('Your ticket is saved on this phone, so nothing is lost.')}</p>
    <div class="small"><b>${T('The office has:')}</b> ${esc(office)}${o.tech_notes ? ` · “${esc(String(o.tech_notes).slice(0, 100))}”` : ''}</div>
    <div class="small"><b>${T('Your ticket:')}</b> ${mine || T('No notes')}${it.at ? ` · ${esc(new Date(it.at).toLocaleTimeString(NV.lang === 'es' ? 'es-US' : 'en-US', { hour: 'numeric', minute: '2-digit' }))}` : ''}</div>
    ${it.choice === 'mine' ? `<div class="alert info small" style="margin-top:8px">${T('Sent to the office. They pick which ticket to keep.')}</div>` : ''}
    <div class="bigbtns" style="margin-top:10px">
      ${it.choice === 'mine' ? '' : `<button type="button" class="btn primary" data-sync="mine">${T('Send mine anyway')}</button>`}
      <button type="button" class="btn" data-sync="drop">${T('Drop mine')}</button>
      ${companyPhone ? `<a class="btn" href="tel:${esc(companyPhone)}">📞 ${T('Call the office')}</a>` : ''}
    </div>
  </div>`;
}

function notesCard(notes) {
  if (!notes.length) return '';
  return `<div class="card" data-sync-notes style="border-left:4px solid var(--brand)">
    ${notes.slice(-5).map((n) => n.notes.map((x) => `<div class="small" style="padding:4px 0">ℹ️ <b>${esc(stopName(n.visitId))}:</b> ${esc(noteText(x))}</div>`).join('')).join('')}
    <button type="button" class="btn sm" data-sync="seen" style="margin-top:6px">${T('Got it')}</button></div>`;
}

function wire(root, after) {
  $$('[data-sync]', root).forEach((b) => (b.onclick = async () => {
    const card = b.closest('[data-sync-item]');
    const id = card ? Number(card.dataset.syncItem) : null;
    try {
      if (b.dataset.sync === 'seen') { await Outbox.clearNotes(); return after(); }
      const it = (await Outbox.list()).find((x) => x.id === id);
      if (b.dataset.sync === 'drop') {
        if (!confirm(NV.t("Drop your ticket? It comes off this phone and won't be used."))) return;
        await Outbox.choose(id, 'drop').catch(() => null);
        try { if (it?.visitId) localStorage.removeItem(`nv_ticket_${it.visitId}`); } catch { /* private mode */ }
        toast(NV.t('Dropped'));
      } else {
        b.disabled = true;
        const r = await Outbox.choose(id, 'mine');
        toast(NV.t(r?.queued ? "Saved on this phone. It sends when you're back online." : 'Sent to the office'));
      }
    } catch (e) { toast(e.message, true); }
    after();
  }));
}

async function fill(box, visitId) {
  if (!box || typeof Outbox === 'undefined') return;
  const items = (await Outbox.list().catch(() => [])).filter((i) => i.status === 'conflict' && (!visitId || i.visitId === Number(visitId)));
  const notes = (await Outbox.notes().catch(() => [])).filter((n) => !visitId || n.visitId === Number(visitId));
  box.innerHTML = items.map(conflictCard).join('') + notesCard(notes);
  wire(box, () => fill(box, visitId));
}

function openSheet() {
  Outbox.list().then((all) => {
    const items = all.filter((i) => i.status === 'conflict');
    const m = modal(NV.t('Tickets that need you'), items.length ? items.map(conflictCard).join('') : `<p>${T('Nothing needs you right now.')}</p>`, [{ label: NV.t('Close') }]);
    // After an answer: close, and open again while tickets still need the tech.
    wire(m.el, async () => {
      m.close();
      fill($('#nv-sync-cards'));
      if ((await Outbox.counts()).conflicts) openSheet();
    });
  });
}

NV.slot('tech.top', ({ r }) => { remember(r?.stops); return '<div id="nv-sync-cards"></div>'; });
NV.slot('tech.stop', ({ v }) => { remember([v]); return `<div id="nv-sync-stop" data-visit="${Number(v.id)}"></div>`; });
NV.on('tech.route.rendered', () => {
  fill($('#nv-sync-cards'));
  if (navigator.onLine && typeof Outbox !== 'undefined') Outbox.reconcile().then(() => fill($('#nv-sync-cards'))).catch(() => {});
});
NV.on('tech.stop.rendered', () => { const box = $('#nv-sync-stop'); if (box) fill(box, box.dataset.visit); });
NV.on('tech.conflicts', () => { if (typeof Outbox !== 'undefined') openSheet(); });

NV.on('boot', ({ boot }) => {
  if (typeof Outbox === 'undefined') return;   // the office app has no outbox
  companyPhone = boot?.settings?.company_phone || '';
  Outbox.onChange(async (msg) => {
    if (msg === 'notes') {
      const fresh = (await Outbox.notes().catch(() => [])).filter((n) => n.at > toastedUpTo);
      if (fresh.length) { toastedUpTo = Math.max(...fresh.map((n) => n.at)); toast(noteText(fresh[fresh.length - 1].notes[0])); }
    }
    if (!['conflict', 'notes', 'changed'].includes(msg)) return;
    fill($('#nv-sync-cards'));
    const box = $('#nv-sync-stop');
    if (box) fill(box, box.dataset.visit);
  });
});

})(); } catch (e) { console.error('feature fieldsync.js failed to load', e); }

/* ---- features/profit.js ---- */
try { (function () {
// Profit (#/profit, owners and managers): what stops, routes, zips and lead sources really make after chemicals,
// labor and driving; what a new customer is worth and costs to win; retention by start month. Also a "Profit on
// this stop" card on finished visits, Settings → Profit & costs, and a "What you paid" box when an order comes in.
// The math lives in src/features/profit.js; this file only draws it.

const PF_TABS = [['routes', 'Routes'], ['zips', 'Zip codes'], ['sources', 'Lead sources'], ['cohorts', 'Cohorts']];
const PF_PERIODS = [['month', 'This month'], ['last_month', 'Last month'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['year', 'This year'], ['12m', 'Last 12 months'], ['custom', 'Pick dates…']];
const PF_GROUPS = [['tech', 'tech'], ['day', 'route day'], ['service', 'service'], ['branch', 'branch']];
// Where each dollar goes. Checked for color-blind separation; the yellow carries dark text.
const PF_PARTS = [['labor', 'Labor', '#2a78d6'], ['drive', 'Driving', '#eb6834'], ['chemicals', 'Chemicals', '#6250d6'], ['overhead', 'Overhead', '#eda100'], ['profit', 'Gross profit', '#2f855a']];
const PF_VALUE = '#2a78d6';
const PF_CAC = '#eb6834';

(function addStyles() {
  const css = `
  .pf-filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .pf-filters input[type=date] { max-width: 160px; }
  .pf-filters select { width: auto; min-width: 140px; }
  table.list.pf-table th, table.list.pf-table td { padding: 9px 8px; }
  table.list.pf-table td { font-size: 14px; }
  table.list.pf-table th { vertical-align: bottom; }
  table.list.pf-table .pf-sort { white-space: normal; }
  table.list.pf-table td:first-child { white-space: nowrap; }
  .pf-range { margin: -6px 0 12px; }
  .pf-callout { display: flex; gap: 10px; align-items: flex-start; width: 100%; text-align: left; background: var(--warn-soft); color: #7b4f0b; border: 0; border-radius: 8px;
    padding: 10px 12px; margin: 0 0 8px; font: inherit; cursor: pointer; }
  .pf-callout:hover, .pf-callout:focus-visible { outline: 2px solid var(--warn); }
  .pf-warn ul { margin: 6px 0 0; padding-left: 18px; }
  .pf-warn li { margin: 2px 0; }
  .pf-chart { display: block; width: 100%; overflow: visible; }
  .pf-chart text { font-size: 12px; fill: var(--muted); }
  .pf-chart .ink { fill: var(--ink); font-weight: 600; }
  .pf-chart .halo { paint-order: stroke; stroke: #fff; stroke-width: 4px; stroke-linejoin: round; }
  .pf-chart .hit { fill: transparent; cursor: pointer; outline: none; }
  .pf-chart .hit:hover, .pf-chart .hit:focus { fill: rgba(26, 32, 44, .05); }
  .pf-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; list-style: none; margin: 10px 0 0; padding: 0; font-size: 13px; }
  .pf-legend li { display: flex; align-items: center; gap: 6px; }
  .pf-key { width: 12px; height: 12px; border-radius: 3px; flex: none; }
  .pf-tip { position: fixed; z-index: 200; pointer-events: none; background: #1a202c; color: #fff; font-size: 12px; line-height: 1.45; padding: 7px 10px;
    border-radius: 6px; max-width: 300px; white-space: pre-line; box-shadow: 0 2px 10px rgba(0, 0, 0, .2); }
  .pf-sort { cursor: pointer; user-select: none; white-space: nowrap; }
  .pf-sort::after { content: '\\00a0↕'; color: #cbd5e0; }
  .pf-sort.asc::after { content: '\\00a0↑'; color: inherit; }
  .pf-sort.desc::after { content: '\\00a0↓'; color: inherit; }
  table.pf-table td.num, table.pf-table th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pf-loss { color: var(--danger); }
  .pf-how td { vertical-align: top; padding: 7px 10px; }
  .pf-how td:first-child { font-weight: 600; white-space: nowrap; }
  .pf-how td.amt { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .pf-how .lines div + div { margin-top: 2px; }
  .pf-stop { border-bottom: 1px solid var(--line); }
  .pf-stop summary { display: flex; gap: 10px; justify-content: space-between; padding: 9px 2px; cursor: pointer; flex-wrap: wrap; }
  .pf-heat { border-collapse: separate; border-spacing: 2px; width: 100%; }
  .pf-heat th { font-size: 12px; color: var(--muted); font-weight: 600; padding: 4px; text-align: center; white-space: nowrap; }
  .pf-heat th:first-child, .pf-heat td:first-child { text-align: left; }
  .pf-heat td { text-align: center; font-size: 12px; font-variant-numeric: tabular-nums; padding: 6px 4px; border-radius: 4px; min-width: 40px; }
  .pf-scale { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); margin-top: 10px; }
  .pf-scale span.bar { width: 140px; height: 10px; border-radius: 3px; background: linear-gradient(to right, rgba(47, 133, 90, .08), rgba(47, 133, 90, .93)); }
  .pf-method li { margin: 4px 0; }`;
  const el = document.createElement('style');
  el.id = 'nv-profit-css';
  el.textContent = css;
  document.head.appendChild(el);
})();

// ---------- small helpers ----------
const pfQuery = (o) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v != null && v !== '') q.set(k, v);
  return q.toString();
};
const pfRange = (params, fallback) => (params.from && params.to ? { from: params.from, to: params.to } : { period: params.period || fallback });
const pfBranch = (loc) => (loc ? esc(branchName(loc)) : typeof multiBranch === 'function' && multiBranch() ? 'All branches' : '');
const pfMoney = (n) => (n == null ? '—' : money(n));
const pfWhole = (n) => (n == null ? '—' : `${n < 0 ? '−' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`);
const pfNum = (n, suffix = '') => (n == null ? '—' : `${n}${suffix}`);
const pfCsv = (o) => `/nuvolve/app/api/profit/export?${pfQuery({ ...o, loc: currentBranch() })}`;

// One tooltip for every chart, filled with textContent so names from the records are never read as HTML.
const pfTip = {
  el: null,
  show(text, x, y) {
    if (!this.el) { this.el = document.createElement('div'); this.el.className = 'pf-tip'; this.el.setAttribute('role', 'tooltip'); }
    if (!this.el.isConnected) document.body.appendChild(this.el);
    this.el.textContent = text;
    this.el.style.display = 'block';
    this.move(x, y);
  },
  move(x, y) {
    if (!this.el) return;
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    this.el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x + 12))}px`;
    this.el.style.top = `${Math.max(8, y - h - 12)}px`;
  },
  hide() { if (pfTip.el) pfTip.el.style.display = 'none'; },
};
function pfWire(root, onPick) {
  for (const n of $$('[data-tip]', root)) {
    n.addEventListener('mouseenter', (e) => pfTip.show(n.dataset.tip, e.clientX, e.clientY));
    n.addEventListener('mousemove', (e) => pfTip.move(e.clientX, e.clientY));
    n.addEventListener('mouseleave', () => pfTip.hide());
    n.addEventListener('focus', () => { const r = n.getBoundingClientRect(); pfTip.show(n.dataset.tip, r.left + r.width / 2, r.top); });
    n.addEventListener('blur', () => pfTip.hide());
    if (onPick && n.dataset.key != null) {
      n.addEventListener('click', () => { pfTip.hide(); onPick(n.dataset.key); });
      n.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pfTip.hide(); onPick(n.dataset.key); } });
    }
  }
}
window.addEventListener('hashchange', () => pfTip.hide());
// Charts are drawn at the width they have, and again when the window changes size.
let pfRedraw = null;
let pfResizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(pfResizeTimer);
  pfResizeTimer = setTimeout(() => { if (pfRedraw && $('#pf-body')) pfRedraw(); }, 150);
});

// An axis that fits the data, with round-number ticks inside it.
function pfScale(lo, hi, count = 5) {
  if (hi - lo < 1e-9) hi = lo + 1;
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const ticks = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return { lo, hi, ticks };
}
// A bar anchored square at the baseline with a rounded end where the value is.
function pfBar(base, end, y, h, color, r = 4) {
  const w = Math.abs(end - base);
  if (w < 0.5) return '';
  const rr = Math.min(r, w, h / 2), s = end >= base ? 1 : -1, e = end - s * rr;
  return `<path d="M${base},${y} H${e} A${rr},${rr} 0 0 ${s > 0 ? 1 : 0} ${end},${y + rr} V${y + h - rr} A${rr},${rr} 0 0 ${s > 0 ? 1 : 0} ${e},${y + h} H${base} Z" fill="${color}"/>`;
}
const pfCut = (s, n) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);
const pfLegend = (items) => `<ul class="pf-legend">${items.map(([label, color]) => `<li><span class="pf-key" style="background:${color}"></span>${label}</li>`).join('')}</ul>`;

// ---------- charts ----------
// One tall bar: what a dollar of revenue pays for. When costs are more than revenue, the bar is the costs.
function pfDollarChart(el, d) {
  const t = d.totals;
  const loss = t.profit <= 0;
  const whole = loss ? t.cost : t.revenue;
  const parts = PF_PARTS.filter(([k]) => (d.dollar[k] || 0) > 0 && !(loss && k === 'profit')).map(([k, label, color]) => ({ k, label, color, v: d.dollar[k] }));
  if (!(whole > 0) || !parts.length) { el.innerHTML = '<p class="muted small">Nothing to split yet.</p>'; return; }
  const W = Math.max(260, el.clientWidth || 600), H = 40, gap = 2;
  const usable = W - gap * (parts.length - 1);
  let x = 0;
  const segs = parts.map((p) => {
    const w = Math.max(1, (p.v / whole) * usable);
    const share = Math.round((p.v / whole) * 100);
    const label = `${p.label} ${share}%`;
    const fits = w > label.length * 6.6 + 12;
    const s = `<g><rect x="${x}" y="0" width="${w}" height="${H}" fill="${p.color}"/>
      ${fits ? `<text x="${x + 8}" y="${H / 2 + 4}" style="fill:${p.k === 'overhead' ? '#1a202c' : '#fff'};font-weight:600">${esc(label)}</text>` : ''}
      <rect class="hit" x="${x}" y="0" width="${w}" height="${H}" tabindex="0" role="img" aria-label="${esc(`${p.label}: ${money(p.v)}, ${share}%`)}"
        data-tip="${esc(`${p.label}\n${money(p.v)} · ${share}% of ${loss ? 'costs' : 'revenue'}\n${money(p.v / t.stops)} a stop`)}"/></g>`;
    x += w + gap;
    return s;
  }).join('');
  el.innerHTML = `<svg class="pf-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="Where each dollar of revenue goes">
      <defs><clipPath id="pf-dollar-clip"><rect x="0" y="0" width="${W}" height="${H}" rx="4"/></clipPath></defs>
      <g clip-path="url(#pf-dollar-clip)">${segs}</g></svg>
    ${pfLegend(parts.map((p) => [`${p.label} <b>${money(p.v)}</b> <span class="muted">${Math.round((p.v / whole) * 100)}%</span>`, p.color]))}
    ${loss ? `<p class="small pf-loss" style="margin:8px 0 0">Costs are more than revenue: you lose ${money(-t.profit)} on these stops.</p>` : ''}`;
  pfWire(el);
}

// Profit per stop, one bar per group, best at the top, with the average marked.
function pfRankChart(el, rows, avg, onPick) {
  let list = rows.filter((r) => r.stops > 0);
  if (list.length > 25) list = [...list].sort((a, b) => b.stops - a.stops).slice(0, 25);
  list = [...list].sort((a, b) => b.per_stop - a.per_stop);
  if (!list.length) { el.innerHTML = ''; return; }
  const W = Math.max(300, el.clientWidth || 600), rowH = 26, barH = 16, top = 18, axis = 22;
  const labelW = Math.min(170, Math.round(W * 0.3)), valW = 70;
  const x0 = labelW + 10, x1 = W - valW;
  const { lo, hi, ticks } = pfScale(Math.min(0, avg, ...list.map((r) => r.per_stop)), Math.max(0, avg, ...list.map((r) => r.per_stop)));
  const sx = (v) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0);
  const H = top + list.length * rowH + axis;
  const negative = list.some((r) => r.per_stop < 0);
  const grid = ticks.map((v) => `<line x1="${sx(v)}" x2="${sx(v)}" y1="${top - 4}" y2="${H - axis}" stroke="${v === 0 ? '#cbd5e0' : '#edf2f7'}" stroke-width="1"/>
    <text x="${sx(v)}" y="${H - 6}" text-anchor="middle">${pfWhole(v)}</text>`).join('');
  const bars = list.map((r, i) => {
    const y = top + i * rowH, by = y + (rowH - barH) / 2;
    const end = sx(r.per_stop), base = sx(0);
    const tip = `${r.label}\n${money(r.per_stop)} a stop after costs · ${r.stops} stop${r.stops === 1 ? '' : 's'}\n${money(r.revenue)} revenue · ${money(r.profit)} gross profit${r.margin != null ? ` (${r.margin}%)` : ''}`;
    return `<g><text x="${labelW}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(pfCut(r.label, Math.floor(labelW / 7)))}</text>
      ${pfBar(base, end, by, barH, r.per_stop < 0 ? 'var(--danger)' : 'var(--brand)')}
      <text class="ink halo" x="${r.per_stop < 0 ? Math.min(base, end) - 6 : Math.max(base, end) + 6}" y="${y + rowH / 2 + 4}" text-anchor="${r.per_stop < 0 ? 'end' : 'start'}">${money(r.per_stop)}</text>
      <rect class="hit" x="0" y="${y}" width="${W}" height="${rowH}" tabindex="0" role="button" aria-label="${esc(`${r.label}: ${money(r.per_stop)} a stop. Show its stops.`)}" data-key="${esc(r.key)}" data-tip="${esc(tip)}"/></g>`;
  }).join('');
  const ax = sx(avg);
  el.innerHTML = `<svg class="pf-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="Profit per stop for each group, best first">
      ${grid}
      <line x1="${ax}" x2="${ax}" y1="${top - 6}" y2="${H - axis}" stroke="#1a202c" stroke-width="1.5" stroke-dasharray="4 3"/>
      <text class="ink halo" x="${ax}" y="${top - 8}" text-anchor="middle">Average ${money(avg)}</text>${bars}</svg>
    ${negative ? pfLegend([['Makes money', 'var(--brand)'], ['Loses money', 'var(--danger)']]) : ''}`;
  pfWire(el, onPick);
}

// What a new customer from each source is worth, next to what one costs to win.
function pfValueChart(el, rows, withCac, onPick) {
  const list = rows.filter((r) => r.value_new != null || (withCac && r.cac != null))
    .sort((a, b) => (b.value_new ?? -Infinity) - (a.value_new ?? -Infinity)).slice(0, 10);
  if (!list.length) { el.innerHTML = '<p class="muted small">Not enough history yet to put a value on a customer.</p>'; return; }
  const W = Math.max(300, el.clientWidth || 600), barH = withCac ? 11 : 16, rowH = withCac ? 36 : 28, top = 4, axis = 22;
  const labelW = Math.min(150, Math.round(W * 0.28)), valW = 72;
  const x0 = labelW + 10, x1 = W - valW;
  const vals = list.flatMap((r) => [r.value_new ?? 0, withCac ? r.cac ?? 0 : 0]);
  const { lo, hi, ticks } = pfScale(Math.min(0, ...vals), Math.max(0, ...vals));
  const sx = (v) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0);
  const H = top + list.length * rowH + axis;
  const grid = ticks.map((v) => `<line x1="${sx(v)}" x2="${sx(v)}" y1="${top}" y2="${H - axis}" stroke="${v === 0 ? '#cbd5e0' : '#edf2f7'}"/>
    <text x="${sx(v)}" y="${H - 6}" text-anchor="middle">${pfWhole(v)}</text>`).join('');
  const one = (v, y, color, none) => (v == null ? `<text x="${sx(0) + 4}" y="${y + barH - 1}">${none}</text>`
    : `${pfBar(sx(0), sx(v), y, barH, color)}<text class="ink halo" x="${v < 0 ? sx(v) - 6 : sx(v) + 6}" y="${y + barH - 1}" text-anchor="${v < 0 ? 'end' : 'start'}">${pfWhole(v)}</text>`);
  const bars = list.map((r, i) => {
    const y = top + i * rowH;
    const first = y + (withCac ? 6 : (rowH - barH) / 2);
    const tip = [r.source, `A new customer is worth ${pfMoney(r.value_new)}`,
      ...(withCac ? [r.cac != null ? `Costs ${money(r.cac)} to win${r.payback_months != null ? ` · pays back in ${r.payback_months} months` : ''}` : 'No marketing spend entered'] : []),
      `${r.customers} customers · ${pfNum(r.plan_share, '%')} on a plan`].join('\n');
    return `<g><text x="${labelW}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(pfCut(r.source, Math.floor(labelW / 7)))}</text>
      ${one(r.value_new, first, PF_VALUE, 'not enough history')}${withCac ? one(r.cac, first + barH + 2, PF_CAC, 'no spend entered') : ''}
      <rect class="hit" x="0" y="${y}" width="${W}" height="${rowH}" tabindex="0" role="button" aria-label="${esc(tip.replace(/\n/g, '. '))}" data-key="${esc(r.key)}" data-tip="${esc(tip)}"/></g>`;
  }).join('');
  el.innerHTML = `${withCac ? pfLegend([['A new customer is worth', PF_VALUE], ['Cost to win one', PF_CAC]]) : ''}
    <svg class="pf-chart" style="margin-top:8px" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="Value of a new customer by lead source">${grid}${bars}</svg>`;
  pfWire(el, onPick);
}

// ---------- how one stop was worked out ----------
function pfHowTable(s) {
  const row = (label, how, amount, neg = true) => `<tr><td>${label}</td><td class="lines">${how}</td><td class="amt">${amount == null ? '' : neg && amount ? `−${money(amount)}` : money(amount)}</td></tr>`;
  return `<table class="list small pf-how"><tbody>
    ${row('Revenue', esc(s.how.revenue), s.revenue, false)}
    ${row('Time', esc(s.how.time), null)}
    ${row('Chemicals', s.how.chemicals.map((c) => `<div>${esc(c)}</div>`).join(''), s.chemicals)}
    ${row('Labor', esc(s.how.labor), s.labor)}
    ${row('Driving', esc(s.how.drive), s.drive)}
    ${s.how.overhead ? row('Overhead', esc(s.how.overhead), s.overhead) : ''}
    <tr><td><b>Gross profit</b></td><td class="lines">${esc(s.how.profit)}${s.margin != null ? ` · ${s.margin}% of revenue` : ''}</td><td class="amt"><b class="${s.profit < 0 ? 'pf-loss' : ''}">${money(s.profit)}</b></td></tr>
  </tbody></table>`;
}

// Every stop behind one row, worst first, each opening to show how it was worked out.
async function pfStops(group, key, label, range) {
  const m = modal(label, '<p class="muted">Working it out...</p>', [{ label: 'Close' }]);
  try {
    const d = await api(`/nuvolve/app/api/profit/stops?${pfQuery({ ...range, group, key })}`);
    const t = d.totals;
    $('.mb', m.el).innerHTML = `
      <p>${t.stops} stop${t.stops === 1 ? '' : 's'} · ${money(t.revenue)} revenue · ${money(t.cost)} costs · <b class="${t.profit < 0 ? 'pf-loss' : ''}">${money(t.profit)} gross profit</b>${t.margin != null ? ` (${t.margin}%)` : ''} · ${money(t.per_stop)} a stop</p>
      ${d.stops.map((s) => `<details class="pf-stop"><summary><span><b>${fmtDate(s.date)}</b> · ${esc(s.customer)} <span class="muted small">${esc(s.service)} · ${esc(s.tech)}</span></span>
          <span class="nowrap">${money(s.revenue)} → <b class="${s.profit < 0 ? 'pf-loss' : ''}">${money(s.profit)}</b></span></summary>
        ${pfHowTable(s)}<p class="small"><a href="#/visits/${s.id}">Open this visit</a></p></details>`).join('') || '<p class="muted">No stops.</p>'}
      ${d.more ? `<p class="small muted">And ${d.more} more. Download every stop as a spreadsheet for the rest.</p>` : ''}`;
  } catch (e) {
    $('.mb', m.el).innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
  }
}

function pfWarnings(ws) {
  if (!ws.length) return '';
  const fix = (w) => {
    if (!BOOT.me.isAdmin) return '';
    if (w.fix === 'costs') return ' <a href="#/settings?tab=profit">Set costs</a>';
    if (w.fix === 'pay') return ' <a href="#/accounting?tab=plans">Set pay</a>';
    if (w.fix === 'shop') return ' <a href="#/settings">Open Settings</a>';
    return '';
  };
  return `<div class="alert info pf-warn"><div><b>Some numbers are less complete than they look</b><ul>${ws.map((w) => `<li>${esc(w.text)}${fix(w)}</li>`).join('')}</ul></div></div>`;
}

// A table you can sort by clicking a column. With no sort it keeps the order the rows came in.
function pfTable(el, cols, rows, { sort, onPick, empty }) {
  let key = sort, dir = -1;
  const draw = () => {
    const list = key == null ? rows : [...rows].sort((a, b) => {
      const x = a[key], y = b[key];
      if (typeof x === 'string' || typeof y === 'string') return dir * String(x ?? '').localeCompare(String(y ?? ''));
      return dir * ((x ?? -Infinity) - (y ?? -Infinity));
    });
    el.innerHTML = `<thead><tr>${cols.map((c) => `<th class="pf-sort ${c.num ? 'num' : ''} ${c.key === key ? (dir > 0 ? 'asc' : 'desc') : ''}" data-col="${c.key}" tabindex="0" title="${esc(c.title || 'Sort')}">${c.label}</th>`).join('')}</tr></thead>
      <tbody>${list.map((r) => `<tr class="click" data-key="${esc(r.key)}" tabindex="0">${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.cell(r)}</td>`).join('')}</tr>`).join('')
        || `<tr><td colspan="${cols.length}" class="muted">${empty}</td></tr>`}</tbody>`;
    for (const th of $$('th[data-col]', el)) {
      const pick = () => { if (key === th.dataset.col) dir = -dir; else { key = th.dataset.col; dir = typeof rows[0]?.[key] === 'string' ? 1 : -1; } draw(); };
      th.onclick = pick;
      th.onkeydown = (e) => { if (e.key === 'Enter') pick(); };
    }
    for (const tr of $$('tr[data-key]', el)) {
      tr.onclick = () => onPick(tr.dataset.key);
      tr.onkeydown = (e) => { if (e.key === 'Enter') onPick(tr.dataset.key); };
    }
  };
  draw();
}

// ---------- the page ----------
NV.nav({ href: '#/profit', icon: '💹', label: 'Profit', role: 'manager', after: '#/insights' });

NV.page('profit', async (view, _id, params = {}) => {
  if (!BOOT.me.isManager) { view.innerHTML = '<div class="alert err">Only owners and managers can see this page.</div>'; return; }
  const tab = PF_TABS.some(([k]) => k === params.tab) ? params.tab : 'routes';
  const custom = Boolean(params.from && params.to) || params.period === 'custom';
  const fallback = tab === 'sources' ? '12m' : '90';
  const period = custom ? 'custom' : PF_PERIODS.some(([k]) => k === params.period) ? params.period : fallback;
  const go = (extra) => {
    const next = { tab, period: params.period, from: params.from, to: params.to, group: params.group, months: params.months, source: params.source, ...extra };
    location.hash = `#/profit?${pfQuery(next)}`;
  };
  pfRedraw = null;
  view.innerHTML = `
    <div class="page-head"><div><h1>Profit</h1><div class="muted">What your stops, routes and customers really make after chemicals, labor and driving.</div></div>
      <div class="actions pf-filters">
        ${tab !== 'cohorts' ? `<select id="pf-period" aria-label="Dates">${PF_PERIODS.map(([v, l]) => `<option value="${v}" ${v === period ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <span id="pf-dates" class="${custom ? '' : 'hidden'}"><input type="date" id="pf-from" value="${esc(params.from || '')}" aria-label="From"> <input type="date" id="pf-to" value="${esc(params.to || todayStr())}" aria-label="To">
          <button class="btn sm" id="pf-go">Show</button></span>` : ''}
        <a class="btn sm" id="pf-csv" href="#">⬇ Download</a></div></div>
    <div class="tabs">${PF_TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="pf-body"><p class="muted">Working it out...</p></div>`;
  $$('.tabs button', view).forEach((b) => (b.onclick = () => (location.hash = `#/profit?${pfQuery({ tab: b.dataset.tab, period: params.period, from: params.from, to: params.to })}`)));
  if ($('#pf-period', view)) {
    $('#pf-period', view).onchange = (e) => {
      if (e.target.value === 'custom') { $('#pf-dates', view).classList.remove('hidden'); $('#pf-from', view).focus(); return; }
      go({ period: e.target.value, from: null, to: null });
    };
    $('#pf-go', view).onclick = () => {
      const from = $('#pf-from', view).value, to = $('#pf-to', view).value;
      if (!from || !to) return toast('Pick both dates', true);
      go({ period: null, from, to });
    };
  }
  const box = $('#pf-body', view);
  const range = custom && params.from && params.to ? { from: params.from, to: params.to } : { period: period === 'custom' ? fallback : period };
  if (tab === 'sources') return pfSources(box, view, range);
  if (tab === 'cohorts') return pfCohorts(box, view, params, go);
  return pfRoutes(box, view, range, tab === 'zips' ? 'zip' : PF_GROUPS.some(([k]) => k === params.group) ? params.group : 'tech', go);
});

async function pfRoutes(box, view, range, group, go) {
  const d = await api(`/nuvolve/app/api/profit/routes?${pfQuery({ ...range, group })}`);
  const t = d.totals;
  const zips = group === 'zip';
  const what = zips ? 'zip code' : PF_GROUPS.find(([k]) => k === group)[1];
  const r = d.range;
  $('#pf-csv', view).href = pfCsv({ tab: zips ? 'zips' : 'routes', group, from: r.from, to: r.to });
  const pick = (key) => {
    const row = d.rows.find((x) => x.key === key);
    pfStops(group, key, row ? (zips && key !== 'unknown' ? `Stops in ${row.label}` : row.label) : 'Stops', { from: r.from, to: r.to });
  };
  const ov = t.overhead > 0;
  box.innerHTML = `
    <div class="small muted pf-range">${fmtDate(r.from)} to ${fmtDate(r.to)}${pfBranch(d.location) ? ` · ${pfBranch(d.location)}` : ''}</div>
    <div class="stats">
      <div class="stat"><div class="label">Revenue</div><div class="value">${money(t.revenue)}</div><div class="sub">${t.stops} completed stop${t.stops === 1 ? '' : 's'}</div></div>
      <div class="stat"><div class="label">Costs</div><div class="value">${money(t.cost)}</div><div class="sub">${money(t.chemicals)} chemicals · ${money(t.labor)} labor · ${money(t.drive)} driving${ov ? ` · ${money(t.overhead)} overhead` : ''}</div></div>
      <div class="stat ${t.profit < 0 ? 'danger' : ''}"><div class="label">Gross profit</div><div class="value">${money(t.profit)}</div><div class="sub">${t.margin != null ? `${t.margin}% of revenue` : 'No revenue yet'}</div></div>
      <div class="stat ${t.per_stop < 0 ? 'danger' : ''}"><div class="label">Per stop</div><div class="value">${money(t.per_stop)}</div><div class="sub">${t.per_hour != null ? `${money(t.per_hour)} an hour of work · ` : ''}${t.miles_per_stop} mi a stop</div></div>
    </div>
    ${t.stops ? `<div class="alert ok"><span>${esc(d.summary)}</span></div>` : `<div class="empty"><div class="big">💹</div><h3>No completed stops in these dates</h3><p>Pick other dates, or finish a few stops and come back.</p></div>`}
    ${d.callouts.length ? `<div class="card"><h2>Where the money leaks</h2>${d.callouts.map((c) => `<button class="pf-callout" data-key="${esc(c.key)}"><span aria-hidden="true">⚠️</span><span>${esc(c.text)}</span></button>`).join('')}</div>` : ''}
    ${pfWarnings(d.warnings)}
    ${t.stops ? `<div class="card"><div class="card-head"><h2>Where each dollar goes</h2><span class="small muted">${money(t.revenue)} of revenue</span></div><div id="pf-dollar"></div></div>
      <div class="card"><div class="card-head"><div><h2>Profit per stop, by ${what}</h2><div class="small muted">After chemicals, labor and driving${ov ? ' and overhead' : ''}. Click a bar to see its stops.</div></div></div><div id="pf-rank"></div></div>` : ''}
    <div class="card flush"><div class="card-head" style="padding:16px 16px 0"><div><h2>By ${what}</h2><div class="small muted">Click a row to see every stop and how it was worked out.${d.more ? ` Showing the first 500; the download has all ${d.rows.length + d.more}.` : ''}</div></div>
      <div class="actions pf-filters">${zips ? '' : `<select id="pf-group" aria-label="Group by">${PF_GROUPS.filter(([k]) => k !== 'branch' || (typeof multiBranch === 'function' && multiBranch())).map(([k, l]) => `<option value="${k}" ${k === group ? 'selected' : ''}>By ${l}</option>`).join('')}</select>`}
        <a class="btn sm" href="${pfCsv({ tab: 'stops', from: r.from, to: r.to })}">⬇ Every stop</a></div></div>
      <div class="table-wrap"><table class="list pf-table" id="pf-table"></table></div></div>
    ${pfMethod(d.config)}`;
  const cols = [
    { key: 'label', label: zips ? 'Zip' : what[0].toUpperCase() + what.slice(1), cell: (x) => `<b>${esc(x.label)}</b>` },
    { key: 'stops', label: 'Stops', num: true, cell: (x) => x.stops },
    { key: 'revenue', label: 'Revenue', num: true, cell: (x) => money(x.revenue) },
    { key: 'chemicals', label: 'Chemicals', num: true, cell: (x) => money(x.chemicals) },
    { key: 'labor', label: 'Labor', num: true, cell: (x) => money(x.labor) },
    { key: 'drive', label: 'Driving', num: true, cell: (x) => money(x.drive) },
    ...(ov ? [{ key: 'overhead', label: 'Overhead', num: true, cell: (x) => money(x.overhead) }] : []),
    { key: 'profit', label: 'Gross profit', num: true, cell: (x) => `<b class="${x.profit < 0 ? 'pf-loss' : ''}">${money(x.profit)}</b>` },
    { key: 'margin', label: 'Margin', num: true, cell: (x) => pfNum(x.margin, '%') },
    { key: 'per_stop', label: 'Per stop', num: true, cell: (x) => `<span class="${x.per_stop < 0 ? 'pf-loss' : ''}">${money(x.per_stop)}</span>` },
    { key: 'per_hour', label: 'Per hour', num: true, title: 'Gross profit for each hour on site plus driving', cell: (x) => pfMoney(x.per_hour) },
    { key: 'miles_per_stop', label: 'Miles / stop', num: true, cell: (x) => x.miles_per_stop },
  ];
  // Route days come newest first from the server; everything else starts with the most profit.
  pfTable($('#pf-table', box), cols, d.rows, { sort: group === 'day' ? null : 'profit', onPick: pick, empty: 'No completed stops in these dates.' });
  for (const b of $$('.pf-callout', box)) b.onclick = () => pick(b.dataset.key);
  if ($('#pf-group', box)) $('#pf-group', box).onchange = (e) => go({ group: e.target.value });
  pfRedraw = () => {
    if (!t.stops) return;
    pfDollarChart($('#pf-dollar', box), d);
    pfRankChart($('#pf-rank', box), d.rows, t.per_stop, pick);
  };
  pfRedraw();
}

function pfMethod(cfg) {
  return `<details class="card pf-method"><summary><b>How these numbers are worked out</b></summary>
    <ul class="small">
      <li><b>Revenue</b> is the price of each completed stop, before tax. Skipped and unfinished stops don't count.</li>
      <li><b>Chemicals</b>: what went on the ticket, turned into the product's own unit, times what a unit costs. Costs come from Settings → Profit & costs, or from what you paid on the last order (Inventory → Received an order).</li>
      <li><b>Labor</b> comes from each person's pay (Accounting → Pay): hourly pay × time on site plus driving; a production percent of the stop's price; or a salary for the day (yearly ÷ 52 weeks ÷ work days a week) split over that day's stops.${cfg.labor_hourly ? ` Anyone with no pay set up counts at ${money(cfg.labor_hourly)} an hour.` : ''}</li>
      <li><b>Driving</b>: each day runs from the shop (or the tech's branch) to the first stop, stop to stop in the order they were finished, and back to the shop. Miles are estimated from the map (a straight line plus 30% for roads) × ${money(cfg.cost_per_mile)} a mile.</li>
      ${cfg.overhead_per_stop ? `<li><b>Overhead</b>: ${money(cfg.overhead_per_stop)} a stop.</li>` : ''}
      <li><b>Time on site</b> runs from Start to Complete in the app. A stop that was never started uses the service's usual length. Profit per hour counts time on site plus driving.</li>
      ${BOOT.me.isAdmin ? '<li>Change the cost per mile, overhead and product costs in <a href="#/settings?tab=profit">Settings → Profit & costs</a>.</li>' : ''}
    </ul></details>`;
}

async function pfSources(box, view, range) {
  const d = await api(`/nuvolve/app/api/profit/sources?${pfQuery(range)}`);
  const t = d.total;
  const cac = d.cac_available;
  $('#pf-csv', view).href = pfCsv({ tab: 'sources', from: d.range.from, to: d.range.to });
  const pick = (key) => {
    const s = key === 'all' ? t : d.sources.find((x) => x.key === key);
    if (s) modal(s.source, `<ul class="pf-method">${s.how.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`, [{ label: 'Close' }]);
  };
  box.innerHTML = `
    <div class="small muted pf-range">New customers and spend: ${fmtDate(d.range.from)} to ${fmtDate(d.range.to)}${d.window ? ` · value and cancellations: ${d.window.from === d.history_start ? `since ${fmtDate(d.window.from)}, when your first plan went into Nuvolve` : 'the last 12 months'}` : ''}${pfBranch(d.location) ? ` · ${pfBranch(d.location)}` : ''}</div>
    ${d.note ? `<div class="alert info"><span>${esc(d.note)}</span></div>` : ''}
    ${!cac ? '<div class="alert info"><span>Marketing spend is entered for the whole company, so the cost to win a customer shows when you look at all branches.</span></div>' : ''}
    <div class="stats">
      <div class="stat"><div class="label">A new customer is worth</div><div class="value">${pfMoney(t.value_new)}</div><div class="sub">after chemicals, labor and driving, over their first 5 years</div></div>
      ${cac ? `<div class="stat"><div class="label">Cost to win one</div><div class="value">${pfMoney(t.cac)}</div><div class="sub">${t.cac != null ? `${money(t.spend + t.commission)} ÷ ${t.new_customers} new customers` : t.new_customers ? 'No marketing spend entered for these dates' : 'No new customers in these dates'}</div></div>
      <div class="stat"><div class="label">Pays back in</div><div class="value">${t.payback_months != null ? `${t.payback_months} mo` : '—'}</div><div class="sub">${t.ltv_cac != null ? `Worth ${t.ltv_cac}× what it costs to win` : 'Months of profit to cover what they cost to win'}</div></div>` : ''}
      <div class="stat"><div class="label">Cancel each month</div><div class="value">${pfNum(t.churn_first_year, '%')}</div><div class="sub">${t.churn_after != null ? `in their first year · ${t.churn_after}% after · ${t.retention_12m}% stay a year` : 'Not enough history yet'}</div></div>
    </div>
    ${cac ? `<div class="alert info"><span>Spend comes from <a href="#/marketing?tab=sources">Marketing → Lead sources</a>, plus referral credits and sales commission on new customers.</span>${BOOT.me.location_id ? '' : '<a class="btn sm" href="#/marketing?tab=sources">+ Add spend</a>'}</div>` : ''}
    <div class="card"><div class="card-head"><div><h2>${cac ? 'Worth vs. cost to win, by lead source' : 'What a new customer is worth, by lead source'}</h2><div class="small muted">Click a source to see how it was worked out.</div></div></div><div id="pf-value"></div></div>
    <div class="card flush"><div class="card-head" style="padding:16px 16px 0"><div><h2>By lead source</h2><div class="small muted">From "How did they find you?" on each customer. Click a row for the math.</div></div></div>
      <div class="table-wrap"><table class="list pf-table" id="pf-table"></table></div>
      <div style="padding:0 16px 14px"><button class="btn sm" id="pf-all">How the totals were worked out</button></div></div>
    <details class="card pf-method"><summary><b>How these numbers are worked out</b></summary><ul class="small">
      <li><b>Profit / mo</b>: over the last 12 months, what plan customers from the source brought in after chemicals, labor and driving (plus anything billed without a stop), divided by the months they were on the books.</li>
      <li><b>Cancel / mo</b>: customers who cancelled ÷ months on the books, in their first year and after. Sources with fewer than 3 cancellations or under 24 customer-months use your company-wide rates (marked *).</li>
      <li><b>Months of service</b>: how long a plan customer stays in their first 5 years at those rates. <b>Worth</b> is profit a month × months of service, mixed with one-time customers by how many sign up for a plan.</li>
      ${cac ? '<li><b>Cost to win one</b>: marketing spend for the months in these dates, referral credits and sales commission on new customers, divided by new customers. <b>Pays back in</b>: cost to win ÷ profit a month.</li>' : ''}
    </ul></details>`;
  const cols = [
    { key: 'source', label: 'Source', cell: (x) => `<b>${esc(x.source)}</b>${x.own_rates || x.l1 == null ? '' : ' <span class="small muted" title="Too few cancellations to tell apart, so it uses your company-wide rates">*</span>'}` },
    { key: 'customers', label: 'Customers', num: true, cell: (x) => x.customers },
    { key: 'plan_share', label: 'On a plan', num: true, cell: (x) => pfNum(x.plan_share, '%') },
    { key: 'revenue_to_date', label: 'Billed to date', num: true, cell: (x) => money(x.revenue_to_date) },
    { key: 'monthly_gp', label: 'Profit / mo', num: true, title: 'Gross profit a month from a plan customer', cell: (x) => pfMoney(x.monthly_gp) },
    // Retention and months of service are in each source's "how it was worked out" and in the download.
    { key: 'churn_first_year', label: 'Cancel / mo', num: true, title: 'Share who cancel each month in their first year',
      cell: (x) => (x.retention_12m != null ? `<span title="${esc(`${x.retention_12m}% stay a year · ${x.life_months} months of service in their first 5 years`)}">${pfNum(x.churn_first_year, '%')}</span>` : pfNum(x.churn_first_year, '%')) },
    { key: 'value_new', label: 'Worth', num: true, title: 'What a new customer is worth over their first 5 years', cell: (x) => `<b>${pfMoney(x.value_new)}</b>` },
    ...(cac ? [
      { key: 'new_customers', label: 'New', num: true, title: 'New customers in these dates', cell: (x) => x.new_customers },
      { key: 'spend', label: 'Spend', num: true, title: 'Marketing spend and referral credits, plus sales commission', cell: (x) => (x.spend || x.commission ? money(x.spend + x.commission) : '—') },
      { key: 'cac', label: 'Cost to win', num: true, cell: (x) => pfMoney(x.cac) },
      { key: 'payback_months', label: 'Pays back', num: true, cell: (x) => (x.payback_months != null ? `${x.payback_months} mo` : '—') },
      { key: 'ltv_cac', label: 'Worth ÷ cost', num: true, cell: (x) => (x.ltv_cac != null ? `${x.ltv_cac}×` : '—') },
    ] : []),
  ];
  pfTable($('#pf-table', box), cols, d.sources, { sort: 'customers', onPick: pick, empty: 'No customers yet.' });
  $('#pf-all', box).onclick = () => pick('all');
  pfRedraw = () => pfValueChart($('#pf-value', box), d.sources, cac, pick);
  pfRedraw();
}

async function pfCohorts(box, view, params, go) {
  const months = params.months === '24' ? 24 : 12;
  const d = await api(`/nuvolve/app/api/profit/cohorts?${pfQuery({ months, source: params.source })}`);
  $('#pf-csv', view).href = pfCsv({ tab: 'cohorts', months, source: params.source });
  const shade = (v) => {
    if (v == null) return '';
    const a = 0.08 + (v / 100) * 0.85;
    return `background:rgba(47,133,90,${a.toFixed(2)});color:${a > 0.55 ? '#fff' : 'var(--ink)'}`;
  };
  const cols = Array.from({ length: months }, (_, k) => k + 1);
  box.innerHTML = `
    <div class="card"><div class="card-head"><div><h2>Retention by start month</h2>
      <div class="small muted">Each row is the plan customers who started that month. Each cell is the share still with you after that many months. A month shows once it's over.${pfBranch(d.location) ? ` · ${pfBranch(d.location)}` : ''}</div></div>
      <div class="actions pf-filters"><select id="pf-src" aria-label="Lead source"><option value="">All lead sources</option>${d.sources.map((s) => `<option value="${esc(s.key)}" ${s.key === d.source ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        <select id="pf-months" aria-label="How far back"><option value="12" ${months === 12 ? 'selected' : ''}>Last 12 months</option><option value="24" ${months === 24 ? 'selected' : ''}>Last 24 months</option></select></div></div>
      ${d.rows.length ? `<div class="table-wrap"><table class="pf-heat"><thead><tr><th>Started</th><th>Customers</th>${cols.map((k) => `<th>${k}</th>`).join('')}<th>Still with you</th></tr></thead><tbody>
        ${d.rows.map((r) => `<tr><td class="nowrap"><b>${new Date(`${r.month}-15T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</b></td><td>${r.customers || '—'}</td>
          ${cols.map((k) => { const v = r.customers ? r.cells[k - 1] : null; return `<td style="${shade(v)}" ${v != null ? `tabindex="0" data-tip="${esc(`Started ${r.month}: ${v}% still with you after ${k} month${k === 1 ? '' : 's'}`)}"` : ''}>${v != null ? `${Math.round(v)}%` : ''}</td>`; }).join('')}
          <td style="${shade(r.customers ? r.active_now : null)}">${r.customers && r.active_now != null ? `${Math.round(r.active_now)}%` : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="pf-scale"><span>0%</span><span class="bar"></span><span>100% still with you</span><span>· Months since they started across the top</span></div>`
        : `<div class="empty"><div class="big">📅</div><h3>No history yet</h3><p>${d.history_start ? 'No plan customers started in these months.' : 'Once customers are on plans, you\'ll see how many stay month by month.'}</p></div>`}
      ${d.history_start ? `<p class="small muted" style="margin:10px 0 0">Cancellations can be seen from ${fmtDate(d.history_start)}, when your first plan went into Nuvolve, so earlier months aren't shown.</p>` : ''}
    </div>`;
  $('#pf-src', box).onchange = (e) => go({ source: e.target.value || null });
  $('#pf-months', box).onchange = (e) => go({ months: e.target.value });
  pfWire(box);
}

// ---------- profit on one finished stop (visit page) ----------
NV.slot('visit.left', ({ v }) => (v.status === 'completed' && BOOT.me?.isManager
  ? '<div class="card" id="pf-visit"><div class="card-head"><h2>💹 Profit on this stop</h2><a class="small" href="#/profit">All stops</a></div><p class="muted small">Working it out...</p></div>' : ''));
NV.on('visit.rendered', async ({ v, view }) => {
  const el = $('#pf-visit', view);
  if (!el) return;
  try {
    const d = await api(`/nuvolve/app/api/profit/visits/${v.id}`);
    if (!d.stop) { el.remove(); return; }
    el.innerHTML = `<div class="card-head"><h2>💹 Profit on this stop</h2><a class="small" href="#/profit">All stops</a></div>
      ${pfHowTable(d.stop)}
      ${d.warnings.length ? `<div class="small muted" style="margin-top:8px">${d.warnings.map((w) => esc(w)).join('<br>')}</div>` : ''}`;
  } catch (e) {
    el.innerHTML = `<h2>💹 Profit on this stop</h2><p class="small muted">${esc(e.message)}</p>`;
  }
});

// ---------- Settings → Profit & costs ----------
NV.settingsTab({
  key: 'profit',
  label: 'Profit & costs',
  async render(box) {
    const d = await api('/nuvolve/app/api/profit/settings');
    const unitCost = (n) => (n == null ? '' : String(n));
    box.innerHTML = `
      <form class="card" id="pf-costs" style="max-width:820px">
        <h2>Driving, overhead and labor</h2>
        <p class="small muted">These turn your stops into profit on the <a href="#/profit">Profit</a> page and in Ask Nuvolve.</p>
        <div class="row">
          <div class="field"><label>Cost per mile</label><input name="cost_per_mile" type="number" step="0.001" min="0" max="10" inputmode="decimal" value="${esc(d.cost_per_mile)}">
            <div class="hint">Fuel, wear, insurance and the truck payment. The IRS mileage rate is a fair start ($${d.defaults.cost_per_mile} if you're not sure).</div></div>
          <div class="field"><label>Overhead per stop (optional)</label><input name="overhead_per_stop" type="number" step="0.01" min="0" max="1000" inputmode="decimal" value="${esc(d.overhead_per_stop)}">
            <div class="hint">Office, software and insurance spread over each stop. Leave 0 to see gross profit only.</div></div>
          <div class="field"><label>Default hourly labor</label><input name="labor_hourly" type="number" step="0.01" min="0" max="500" inputmode="decimal" value="${esc(d.labor_hourly)}">
            <div class="hint">For anyone with no pay set up in <a href="#/accounting?tab=plans">Accounting → Pay</a>. 0 counts their labor as $0, and the Profit page says so.</div></div>
        </div>
        <h2 style="margin-top:8px">Product costs</h2>
        <p class="small muted">What one unit costs you. Logging what you paid when an order comes in (Inventory → Received an order) sets it for you.</p>
        <div class="table-wrap"><table class="list"><thead><tr><th>Product</th><th>Unit</th><th>Cost per unit</th><th>Last order</th></tr></thead><tbody>
          ${d.products.map((p) => `<tr class="${p.active ? '' : 'muted'}"><td><b>${esc(p.name)}</b>${p.active ? '' : ' <span class="small">(off)</span>'}</td><td>${esc(p.unit)}</td>
            <td><input data-product="${p.id}" type="number" step="0.0001" min="0" inputmode="decimal" value="${esc(unitCost(p.unit_cost))}" placeholder="Not set" style="max-width:130px" aria-label="Cost per ${esc(p.unit)} of ${esc(p.name)}"></td>
            <td class="small muted">${p.last_order ? `${fmtDate(p.last_order.date)}: ${p.last_order.qty} ${esc(p.unit)} for ${money(p.last_order.cost)}${p.last_order.unit_cost != null ? ` (${money(p.last_order.unit_cost)} a ${esc(p.unit)})` : ''}` : '—'}</td></tr>`).join('')
            || '<tr><td colspan="4" class="muted">No products yet. Add them under Products.</td></tr>'}
        </tbody></table></div>
        <button class="btn primary" style="margin-top:14px">Save costs</button>
      </form>`;
    $('#pf-costs', box).onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const products = $$('[data-product]', f).map((i) => ({ id: Number(i.dataset.product), unit_cost: i.value.trim() }));
      try {
        await api('/nuvolve/app/api/profit/settings', { method: 'PUT', body: { cost_per_mile: f.cost_per_mile.value, overhead_per_stop: f.overhead_per_stop.value, labor_hourly: f.labor_hourly.value, products } });
        toast('Saved');
      } catch (err) { toast(err.message, true); }
    };
  },
});

// ---------- what you paid, when an order comes in (Inventory) ----------
NV.slot('inventory.receive', () => `<div class="field"><label>What you paid (optional)</label><input name="cost" type="number" step="0.01" min="0" inputmode="decimal" placeholder="Before tax">
  <div class="hint">Sets this product's cost per unit for the Profit page.</div></div>`);

})(); } catch (e) { console.error('feature profit.js failed to load', e); }

/* ---- features/proof-access.js ---- */
try { (function () {
// Structured access notes (src/features/proof-access.js): gate and lockbox codes, the dog, knock hard or don't
// knock, call ahead, parking, hazards. Big color-coded chips at the top of the tech's stop screen and small icons
// on the route list, pills on the office's customer page and a card on the visit page, and fields on the address
// forms. The old free-text access note stays where it was.
const AX_TEMPER = { friendly: ['Friendly', 'ok'], nervous: ['Nervous', 'warn'], keep_away: ['Keep away', 'bad'] };

document.head.insertAdjacentHTML('beforeend', `<style>
  .ax-chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .ax-chip { display: inline-flex; align-items: center; gap: 7px; border: 2px solid transparent; border-radius: 12px; padding: 10px 14px; font-size: 16px; font-weight: 700; line-height: 1.25; text-decoration: none; color: inherit; overflow-wrap: anywhere; }
  .ax-sm .ax-chip, .hero-tags .ax-chip { border-width: 1px; border-radius: 999px; padding: 2px 9px; font-size: 12px; font-weight: 600; gap: 4px; }
  .ax-md .ax-chip { padding: 6px 11px; font-size: 14px; border-radius: 10px; }
  .ax-code { background: #ebf4ff; color: #1e4e8c; border-color: #bee3f8; font-variant-numeric: tabular-nums; letter-spacing: .02em; }
  .ax-ok { background: #e6f4ec; color: #276749; border-color: #9ae6b4; }
  .ax-warn { background: #fef5e7; color: #7b4f0b; border-color: #f6d58e; }
  .ax-bad { background: #fdecec; color: #9b2c2c; border-color: #feb2b2; }
  .ax-info { background: #f3e8ff; color: #553c9a; border-color: #d6bcfa; }
  .ax-plain { background: #edf2f7; color: #2d3748; border-color: #cbd5e0; }
  a.ax-chip::after { content: '›'; font-weight: 800; margin-left: 2px; }
  .ax-top { background: #fff; border-radius: 12px; padding: 12px; margin-bottom: 12px; box-shadow: var(--shadow); }
  .ax-top .ax-head { font-size: 13px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 8px; }
  .ax-icons { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
  .ax-ico { display: inline-grid; place-items: center; min-width: 30px; height: 28px; padding: 0 5px; border-radius: 8px; font-size: 15px; border: 1px solid transparent; }
  .ax-addr { margin-top: 4px; }
  details.ax-form { border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; }
  details.ax-form summary { cursor: pointer; font-weight: 600; }
  details.ax-form .check { margin: 6px 0; }
  .ax-sub { padding-left: 26px; }
  .ax-sub[hidden] { display: none; }
</style>`);

// [tone, icon, text, link] for each note. Links call or text the customer when that is what the note asks for.
function axChips(a, { phone = '' } = {}) {
  if (!a) return [];
  const out = [];
  if (a.gate_code) out.push(['code', '🔢', NV.t('Gate {code}', { code: a.gate_code })]);
  if (a.lockbox_code) out.push(['code', '🔐', NV.t('Lockbox {code}', { code: a.lockbox_code })]);
  if (a.dog) {
    const [label, tone] = AX_TEMPER[a.dog_temper] || AX_TEMPER.friendly;
    out.push([tone, '🐕', `${a.dog_name || NV.t('Dog')} · ${NV.t(label)}`]);
  }
  if (a.dog_inside) out.push(['warn', '🏠', NV.t('Ask them to put the dog inside first')]);
  if (a.knock_hard) out.push(['info', '📢', NV.t('Knock hard. Hard of hearing')]);
  if (a.no_knock) {
    const call = a.no_knock_how === 'call';
    out.push(['warn', '🤫', call ? NV.t("Don't knock. Call when you arrive") : NV.t("Don't knock. Text when you arrive"), phone ? `${call ? 'tel' : 'sms'}:${phone}` : '']);
  }
  if (a.call_ahead) out.push(['warn', '📞', NV.t('Call before you come'), phone ? `tel:${phone}` : '']);
  if (a.hazards) out.push(['bad', '⚠️', NV.t('Hazard: {text}', { text: a.hazards })]);
  if (a.parking) out.push(['plain', '🅿️', NV.t('Parking: {text}', { text: a.parking })]);
  if (a.other) out.push(['plain', '📝', a.other]);
  return out;
}
const axChip = ([tone, icon, text, link]) => (link
  ? `<a class="ax-chip ax-${tone}" href="${esc(link)}">${icon} ${esc(text)}</a>`
  : `<span class="ax-chip ax-${tone}">${icon} ${esc(text)}</span>`);
const axRow = (list, size = 'big') => (list.length ? `<div class="ax-chips ax-${size}">${list.map(axChip).join('')}</div>` : '');
const axIcons = (list) => (list.length ? `<div class="ax-icons">${list.map(([tone, icon, text]) => `<span class="ax-ico ax-${tone}" title="${esc(text)}" aria-label="${esc(text)}">${icon}</span>`).join('')}</div>` : '');

// ---------- tech app ----------
NV.slot('tech.stop', ({ v }) => {
  const list = axChips(v.access, { phone: v.phone });
  return list.length ? `<div class="ax-top" id="ax-top"><div class="ax-head">🔑 ${esc(NV.t('Before you get out of the truck'))}</div>${axRow(list)}</div>` : '';
});
// The slot sits under the stop's buttons; the notes belong first, above the house photo.
NV.on('tech.stop.rendered', ({ root }) => {
  const el = $('#ax-top', root), wrap = $('.wrap', root);
  if (el && wrap) wrap.prepend(el);
});
NV.on('tech.route.rendered', ({ r, root }) => {
  for (const s of r.stops || []) {
    if (s.status !== 'scheduled') continue;
    const info = $(`a.tstop[href="#/stop/${Number(s.id)}"] .info`, root);
    if (info) info.insertAdjacentHTML('beforeend', axIcons(axChips(s.access)));
  }
});

// ---------- office ----------
NV.slot('customer.tags', ({ home }) => axChips(home?.access).map(axChip).join(''));
NV.on('customer.rendered', ({ c, view }) => {
  // Every address in the Service addresses card gets its own notes (the hero shows the first one).
  for (const p of c.properties || []) {
    const row = $(`[data-editprop="${Number(p.id)}"]`, view)?.parentNode;
    const list = axChips(p.access);
    if (row?.firstElementChild && list.length) row.firstElementChild.insertAdjacentHTML('beforeend', `<div class="ax-addr">${axRow(list, 'sm')}</div>`);
  }
});
NV.slot('visit.left', ({ v }) => {
  const list = axChips(v.access, { phone: v.phone });
  return list.length ? `<div class="card"><h2>🔑 Access</h2>${axRow(list, 'md')}<p class="small muted" style="margin-bottom:0">Edit these on the customer's address.</p></div>` : '';
});

// ---------- the address forms ----------
function axFields(a) {
  a = a || {};
  const on = (k) => (a[k] ? 'checked' : '');
  const val = (k) => esc(a[k] || '');
  const any = Object.entries(a).some(([k, v]) => k !== 'updated_at' && v);
  return `<details class="ax-form" ${any ? 'open' : ''}><summary>🔑 Access and safety for techs</summary>
    <div class="row" style="margin-top:8px"><div class="field"><label>Gate code</label><input name="ax_gate_code" maxlength="40" autocomplete="off" value="${val('gate_code')}"></div>
    <div class="field"><label>Lockbox code</label><input name="ax_lockbox_code" maxlength="40" autocomplete="off" value="${val('lockbox_code')}"></div></div>
    <label class="check"><input type="checkbox" name="ax_dog" ${on('dog')}> Dog on the property</label>
    <div class="ax-sub" data-ax="dog" ${a.dog ? '' : 'hidden'}>
      <div class="row"><div class="field"><label>Dog's name</label><input name="ax_dog_name" maxlength="60" value="${val('dog_name')}"></div>
      <div class="field"><label>How is the dog?</label><select name="ax_dog_temper">${Object.entries(AX_TEMPER).map(([k, [l]]) => `<option value="${k}" ${a.dog_temper === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <label class="check"><input type="checkbox" name="ax_dog_inside" ${on('dog_inside')}> Ask them to put the dog inside before service</label>
    </div>
    <label class="check"><input type="checkbox" name="ax_knock_hard" ${on('knock_hard')}> Knock hard (hard of hearing)</label>
    <label class="check"><input type="checkbox" name="ax_no_knock" ${on('no_knock')}> Do not knock</label>
    <div class="ax-sub" data-ax="no_knock" ${a.no_knock ? '' : 'hidden'}><div class="field"><label>Let them know you're there by</label><select name="ax_no_knock_how">
      <option value="text" ${a.no_knock_how !== 'call' ? 'selected' : ''}>A text when you arrive</option><option value="call" ${a.no_knock_how === 'call' ? 'selected' : ''}>A call when you arrive</option></select></div></div>
    <label class="check"><input type="checkbox" name="ax_call_ahead" ${on('call_ahead')}> Call before you come</label>
    <div class="field"><label>Parking</label><input name="ax_parking" maxlength="300" placeholder="Park on the street, not the driveway" value="${val('parking')}"></div>
    <div class="field"><label>Hazards</label><input name="ax_hazards" maxlength="300" placeholder="Wasp nest by the meter, loose step, pool" value="${val('hazards')}"></div>
    <div class="field"><label>Other</label><input name="ax_other" maxlength="300" value="${val('other')}"></div>
    <div class="hint">Techs see these at the top of the stop. Codes never show on anything the customer sees.</div>
  </details>`;
}
function axWire(root) {
  for (const k of ['dog', 'no_knock']) {
    const box = $(`[name=ax_${k}]`, root), sub = $(`[data-ax=${k}]`, root);
    if (box && sub) box.addEventListener('change', () => { sub.hidden = !box.checked; });
  }
}
function axRead(root) {
  const v = (n) => $(`[name=ax_${n}]`, root);
  if (!v('gate_code')) return null;
  const out = {};
  for (const k of ['gate_code', 'lockbox_code', 'dog_name', 'dog_temper', 'no_knock_how', 'parking', 'hazards', 'other']) out[k] = v(k).value.trim();
  for (const k of ['dog', 'dog_inside', 'knock_hard', 'no_knock', 'call_ahead']) out[k] = v(k).checked;
  return out;
}
// The gate code and the dog have their own boxes now; the old free-text note stays for anything else.
function axRelabel(root) {
  const input = $('[name=access_notes]', root);
  const label = input?.closest('.field')?.querySelector('label');
  if (!input || !label) return;
  label.textContent = 'Other access notes';
  input.placeholder = 'Anything else the tech should know';
}
// The address modal sends every named input, so the ax_* fields go with its save (saved by after:PUT/POST hooks).
NV.slot('property.form', ({ p }) => axFields(p?.access));
NV.on('property.form.rendered', ({ el }) => { axWire(el); axRelabel(el); });
// The new-customer page builds its own body, so the notes ride along as property_access.
NV.slot('customer.new.property', () => axFields(null));
NV.on('customer.new.rendered', ({ form }) => { axWire(form); axRelabel(form); });
NV.collector('customer.new', (form) => {
  const a = axRead(form);
  return a ? { property_access: a } : {};
});

})(); } catch (e) { console.error('feature proof-access.js failed to load', e); }

/* ---- features/proof.js ---- */
try { (function () {
// Proof of service (src/features/proof.js): photos and a customer signature on every stop, each stamped with the
// time on the phone and, in the tech app, where the phone was.
// - Ticket: what this stop still needs, a summary to show the customer before they sign, the signer's printed
//   name, or why no one could sign. The same check the server makes runs before saving.
// - Office: the stamps on the visit page, and Settings → Proof of service for the rules.
// - Pay page: who signed and when, and when each photo was taken.
const PF_KINDS = ['before', 'after', 'issue'];
const PF_REASONS = ['Not home', "Couldn't come to the door", 'Refused to sign', 'No one on site to sign', 'Other'];
const PF_TECH = location.pathname.startsWith('/nuvolve/app/tech');
let pfUser = null;
NV.on('boot', ({ boot }) => {
  pfUser = boot?.me || null;
  // The summary can be shown in the customer's language, even with no signal later in the day.
  if (PF_TECH) pfSpanish();
});
const pfAdmin = () => ['owner', 'admin'].includes(pfUser?.role);

document.head.insertAdjacentHTML('beforeend', `<style>
  .pf-need { border: 1px solid #f6d58e; background: var(--warn-soft); color: #7b4f0b; border-radius: var(--radius); padding: 10px 12px; margin-bottom: 14px; font-size: 14px; }
  .pf-need.ok { border-color: #9ae6b4; background: var(--brand-soft); color: var(--brand-dark); }
  .pf-need ul { list-style: none; margin: 4px 0 0; padding: 0; }
  .pf-need li { padding: 2px 0; }
  .pf-sign-ui[hidden], .pf-nosign-box[hidden] { display: none; }
  .pf-show { margin-bottom: 8px; }
  .pf-when { font-size: 12px; color: var(--muted); min-height: 1em; }
  .pf-signer { margin: 8px 0 10px; }
  .pf-nosign-box { padding-left: 26px; margin-top: 8px; }
  .pf-warn { font-size: 13px; color: var(--danger); margin: 0 0 8px; }
  .pf-sum .pf-langs { display: flex; gap: 6px; justify-content: flex-end; margin-bottom: 6px; }
  .pf-sum .pf-langs .on { background: var(--brand); border-color: var(--brand); color: #fff; }
  .pf-sum h3 { margin: 14px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .pf-sum .pf-li { padding: 5px 0; border-bottom: 1px solid var(--line); }
  .pf-sum .pf-thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 6px; }
  .pf-sum .pf-thumbs figure { margin: 0; font-size: 11px; color: var(--muted); }
  .pf-sum .pf-thumbs img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; display: block; background: #edf2f7; }
  .pf-sum .pf-price { display: flex; justify-content: space-between; font-weight: 700; font-size: 16px; padding: 10px 0 0; }
  .pf-sum .pf-padbox { margin-top: 16px; padding-top: 12px; border-top: 2px solid var(--line); }
  .pf-sum .pf-padfoot { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; margin-top: 4px; }
  .pf-card { border-top: 1px solid var(--line); margin-top: 14px; padding-top: 12px; }
  .pf-card .pf-row { padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
  .pf-card .pf-row:last-child { border-bottom: 0; }
  .pf-portal { margin-top: 6px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .pf-sig-img { max-height: 46px; max-width: 170px; background: #fff; border: 1px solid var(--line); border-radius: 6px; padding: 2px 4px; }
  .pf-rules td { vertical-align: middle; }
  .pf-rules input[type=number] { width: 76px; }
  .pf-rules select { min-width: 210px; }
</style>`);

// ---------- times and places ----------
// The server keeps UTC as "YYYY-MM-DD HH:MM:SS"; phones send ISO times.
function pfDate(s) {
  if (!s) return null;
  const d = new Date(/T/.test(s) ? s : `${String(s).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function pfTime(s, { date = true, lang = NV.lang } = {}) {
  const d = pfDate(s);
  if (!d) return '';
  return d.toLocaleString(lang === 'es' ? 'es-US' : 'en-US', date ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { hour: 'numeric', minute: '2-digit' });
}
// For the office: how far from the service address the phone was.
const pfAway = (m, acc) => (m == null ? '' : m <= Math.max(150, acc || 0) ? 'at the service address'
  : m * 3.28084 < 1000 ? `${Math.round((m * 3.28084) / 10) * 10} ft from the service address` : `${(m / 1609.34).toFixed(1)} mi from the service address`);

// Where the phone is, while a tech has an open stop on screen. Paused when they paused location sharing.
const pfFix = { watch: null, last: null };
function pfWatch(on) {
  if (!on) {
    if (pfFix.watch != null) navigator.geolocation.clearWatch(pfFix.watch);
    pfFix.watch = null;
    return;
  }
  if (!PF_TECH || pfFix.watch != null || !navigator.geolocation || !window.isSecureContext) return;
  try { if (localStorage.getItem('nv_gps_off') === '1') return; } catch { /* private mode */ }
  pfFix.watch = navigator.geolocation.watchPosition((p) => {
    pfFix.last = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy || 0), at: Date.now() };
  }, () => {}, { enableHighAccuracy: true, maximumAge: 30000, timeout: 60000 });
}
const pfHere = () => (pfFix.last && Date.now() - pfFix.last.at < 5 * 60000 ? { lat: pfFix.last.lat, lng: pfFix.last.lng, accuracy: pfFix.last.accuracy } : null);
NV.on('tech.stop.rendered', ({ v }) => pfWatch(v.status === 'scheduled'));
window.addEventListener('hashchange', () => { if (!/^#\/stop\//.test(location.hash)) pfWatch(false); });

// Every photo goes up with when it was taken, and where when it was taken just now.
NV.collector('photo', (_root, { file }) => {
  const at = Math.min(Number(file?.lastModified) || Date.now(), Date.now());
  const out = { taken_at: new Date(at).toISOString() };
  const here = pfHere();
  if (here && Date.now() - at < 10 * 60000) Object.assign(out, here);
  return out;
});

// Spanish for the customer summary when the tech's phone is in English.
let pfEs = null;
function pfSpanish() {
  if (NV.lang === 'es' && Object.keys(NV.strings).length) return Promise.resolve(NV.strings);
  if (!pfEs) {
    pfEs = (async () => {
      try {
        const r = await fetch('/nuvolve/app/api/i18n/es', { credentials: 'same-origin' });
        if (r.ok) return (await r.json()).strings || {};
      } catch { /* no signal: the copy on the phone, if there is one */ }
      try {
        const s = JSON.parse(localStorage.getItem('nv_i18n_es') || 'null');
        if (s && Object.keys(s).length) return s;
      } catch { /* private mode */ }
      pfEs = null;
      return {};
    })();
  }
  return pfEs;
}

// ---------- the ticket ----------
const pfForms = new WeakMap(); // ticket root → what this module knows about its signature

function pfCounts(root) {
  const n = { before: 0, after: 0, issue: 0 };
  // Includes photos still waiting on the phone to upload: they go before the ticket.
  for (const f of $$('#t-photos figure.ph[data-kind]', root)) if (n[f.dataset.kind] != null) n[f.dataset.kind] += 1;
  return n;
}
const pfVal = (root, sel) => ($(sel, root)?.value || '').trim();
const pfNoSignOn = (root) => Boolean($('#pf-nosign', root)?.checked);
const pfSigned = (root, st) => !pfNoSignOn(root) && Boolean(st.drawn || st.image);

// The same messages the server gives (src/features/proof.js), in the tech's language.
function pfMissing(rule, root, body) {
  const n = pfCounts(root);
  const out = [];
  if (rule.before && !n.before) out.push(NV.t('This stop needs a before photo.'));
  if (n.after < rule.after) out.push(rule.after === 1 ? NV.t('This stop needs an after photo.') : NV.t('This stop needs {n} after photos. It has {have}.', { n: rule.after, have: n.after }));
  const signed = Boolean(body.signature);
  const reason = String(body.no_sign_reason || '').trim();
  if (rule.signature === 'required' && !signed) out.push(NV.t("This stop needs the customer's signature."));
  if (rule.signature === 'or_reason' && !signed) {
    if (!reason) out.push(NV.t('Get the customer to sign, or check "Customer not home or couldn\'t sign" and pick why.'));
    else if (reason === 'Other' && !String(body.no_sign_note || '').trim()) out.push(NV.t("Write a short note on why they couldn't sign."));
  }
  if (signed && rule.signature !== 'none' && !String(body.signer_name || '').trim()) out.push(NV.t('Have the person who signed print their name.'));
  return out;
}

function pfRefresh(root) {
  const st = pfForms.get(root);
  if (!st) return;
  const signed = pfSigned(root, st);
  const when = $('#pf-when', root);
  if (when) when.textContent = signed && st.signedAt ? NV.t('Signed at {time}', { time: pfTime(st.signedAt, { date: false }) }) : '';
  const box = $('#pf-need', root);
  if (!box || !st.rule) return;
  const rule = st.rule;
  const n = pfCounts(root);
  const why = pfNoSignOn(root) && pfVal(root, '#pf-why');
  const items = [];
  if (rule.before) items.push([n.before > 0, NV.t('A before photo')]);
  if (rule.after) items.push([n.after >= rule.after, rule.after === 1 ? NV.t('An after photo') : NV.t('{n} after photos ({have} so far)', { n: rule.after, have: n.after })]);
  if (rule.signature === 'required') items.push([signed, NV.t("The customer's signature")]);
  if (rule.signature === 'or_reason') items.push([signed || Boolean(why && (why !== 'Other' || pfVal(root, '#pf-note'))), NV.t("A signature, or why they couldn't sign")]);
  if (rule.signature !== 'none' && signed) items.push([Boolean(pfVal(root, '#pf-signer')), NV.t('The name of the person who signed')]);
  const ok = items.every(([done]) => done);
  box.classList.toggle('ok', ok);
  box.innerHTML = `<b>${ok ? `✅ ${esc(NV.t('Proof of service is ready'))}` : `📋 ${esc(NV.t('This stop needs'))}`}</b>
    <ul>${items.map(([done, label]) => `<li>${done ? '✅' : '⬜'} ${esc(label)}</li>`).join('')}</ul>`;
}

// Draws a signature picture into the ticket's signature box.
function pfPaint(canvas, dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !img.width) return resolve(false);
      const s = Math.min(r.width / img.width, r.height / img.height);
      const w = img.width * s, h = img.height * s;
      canvas.getContext('2d').drawImage(img, (r.width - w) / 2, (r.height - h) / 2, w, h);
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

function pfToggleNoSign(root, st) {
  const on = pfNoSignOn(root);
  $('.pf-sign-ui', root).hidden = on;
  $('#pf-nosign-box', root).hidden = !on;
  if (on) {
    st.clear();
    if (pfVal(root, '#pf-why') === 'Not home' && $('#present', root)) $('#present', root).checked = false;
  }
  pfRefresh(root);
}

function pfSetWhy(sel, reason) {
  if (!reason) return;
  if (![...sel.options].some((o) => o.value === reason)) sel.add(new Option(reason, reason));
  sel.value = reason;
}

NV.on('ticket.rendered', ({ root, visit, signature: sig }) => {
  const canvas = $('#sig', root), wrap = $('#sig-wrap', root), clearBtn = $('#sig-clear', root);
  if (!canvas || !wrap || !clearBtn || !sig) return;
  const rule = visit.proof?.rule || null;
  const baseValue = sig.value, baseClear = sig.clear;
  const st = { rule, visit, drawn: false, image: null, signedAt: null, at: null };
  st.clear = () => { baseClear(); Object.assign(st, { drawn: false, image: null, signedAt: null, at: null }); pfRefresh(root); };
  pfForms.set(root, st);
  // The core reads the signature through these, so a "not home" ticket sends none and a summary signature counts.
  sig.value = () => (pfNoSignOn(root) ? null : baseValue() || (st.image ? canvas.toDataURL('image/png') : null));
  sig.clear = st.clear;

  const label = $('label', wrap);
  if (label) {
    label.textContent = rule?.signature === 'required' ? NV.t('Customer signature (required)')
      : rule?.signature === 'or_reason' ? NV.t("Customer signature, or check why they couldn't sign") : NV.t('Customer signature (optional)');
  }
  clearBtn.textContent = NV.t('Clear signature');
  const ui = document.createElement('div');
  ui.className = 'pf-sign-ui';
  canvas.before(ui);
  ui.append(canvas, clearBtn);
  if (PF_TECH) ui.insertAdjacentHTML('afterbegin', `<button type="button" class="btn block pf-show" id="pf-show">📋 ${esc(NV.t('Show the customer what we did'))}</button>`);
  ui.insertAdjacentHTML('beforeend', `<div class="pf-when" id="pf-when"></div>
    <div class="field pf-signer"><label for="pf-signer">${esc(NV.t('Name of the person who signed'))}</label><input id="pf-signer" maxlength="80" autocomplete="off"></div>`);
  wrap.insertAdjacentHTML('beforeend', `<label class="check"><input type="checkbox" id="pf-nosign"> ${esc(NV.t("Customer not home or couldn't sign"))}</label>
    <div class="pf-nosign-box" id="pf-nosign-box" hidden>
      ${rule?.signature === 'required' ? `<p class="pf-warn">${esc(NV.t('This stop needs a signature to finish. If no one can sign, skip the stop for today or call the office.'))}</p>` : ''}
      <div class="row"><div class="field"><label for="pf-why">${esc(NV.t('Why?'))}</label><select id="pf-why"><option value="">${esc(NV.t('Pick one'))}</option>
        ${PF_REASONS.map((r) => `<option value="${esc(r)}">${esc(NV.t(r))}</option>`).join('')}</select></div>
      <div class="field"><label for="pf-note">${esc(NV.t('Note (the customer sees this)'))}</label><input id="pf-note" maxlength="300"></div></div>
    </div>`);
  if (rule) $('#t-photos', root)?.closest('.field')?.insertAdjacentHTML('beforebegin', '<div class="pf-need" id="pf-need" aria-live="polite"></div>');

  canvas.addEventListener('pointerdown', () => { st.drawn = true; });
  canvas.addEventListener('pointerup', () => {
    st.signedAt = new Date().toISOString();
    st.at = pfHere();
    // Signing on the tech's phone means they were there.
    if ($('#present', root)) $('#present', root).checked = true;
    pfRefresh(root);
  });
  $('#pf-nosign', root).addEventListener('change', (e) => {
    if (e.target.checked && pfSigned(root, st) && !confirm(NV.t('Remove the signature?'))) { e.target.checked = false; return; }
    pfToggleNoSign(root, st);
  });
  $('#pf-why', root).addEventListener('change', (e) => { if (e.target.value === 'Not home' && $('#present', root)) $('#present', root).checked = false; });
  if ($('#pf-show', root)) $('#pf-show', root).onclick = () => pfSummary(root, st).catch((e) => toast(e.message, true));
  root.addEventListener('input', () => pfRefresh(root));
  root.addEventListener('change', () => pfRefresh(root));
  // Photos come and go in the strip (and wait there for signal), so watch it.
  if ($('#t-photos', root)) new MutationObserver(() => pfRefresh(root)).observe($('#t-photos', root), { childList: true, subtree: true });
  pfRefresh(root);
});

// A ticket put back from the phone: the printed name or the reason, and a signature the server turned down with it.
NV.on('ticket.draft', ({ root, draft }) => {
  const st = pfForms.get(root);
  if (!st || !draft) return;
  $('#pf-signer', root).value = draft.signer_name || '';
  $('#pf-note', root).value = draft.no_sign_note || '';
  if (draft.no_sign_reason) {
    $('#pf-nosign', root).checked = true;
    pfSetWhy($('#pf-why', root), draft.no_sign_reason);
    pfToggleNoSign(root, st);
  } else if (typeof draft.signature === 'string' && /^data:image\/png;base64,/.test(draft.signature)) {
    pfPaint($('#sig', root), draft.signature).then((ok) => {
      if (!ok) return;
      Object.assign(st, { image: draft.signature, signedAt: draft.signed_at || null, at: draft.sign_lat != null ? { lat: draft.sign_lat, lng: draft.sign_lng, accuracy: draft.sign_accuracy } : null });
      pfRefresh(root);
    });
  }
  pfRefresh(root);
});

NV.collector('ticket', (root) => {
  const st = pfForms.get(root);
  if (!st) return {};
  if (pfNoSignOn(root)) return { signer_name: '', signed_at: null, no_sign_reason: pfVal(root, '#pf-why'), no_sign_note: pfVal(root, '#pf-note') };
  const at = st.at || {};
  return { signer_name: pfVal(root, '#pf-signer'), signed_at: st.signedAt, sign_lat: at.lat ?? null, sign_lng: at.lng ?? null, sign_accuracy: at.accuracy ?? null, no_sign_reason: '', no_sign_note: '' };
});

NV.check('ticket', (body, { visit, root }) => {
  const rule = visit?.proof?.rule;
  if (!rule || !root) return null;
  // With signal, owners and admins hear it from the server, which offers them the override.
  if (pfAdmin() && navigator.onLine) return null;
  const miss = pfMissing(rule, root, body);
  return miss.length ? miss.join(' ') : null;
});

// What the tech did, on the tech's phone, for the customer to read before signing. In the customer's language.
async function pfSummary(root, st) {
  const v = st.visit;
  let lang = v.customer_lang ? (v.customer_lang === 'es' ? 'es' : 'en') : NV.lang;
  const es = await pfSpanish();
  const tc = (s, vars) => String((lang === 'es' && es[s]) || s).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
  const pests = $$('#pests .chip.on', root).map((c) => c.dataset.v);
  const prods = $$('#prod-rows .prod-row', root).map((r) => {
    const sel = $('.p-id', r);
    return sel?.value ? { name: sel.selectedOptions[0]?.textContent || '', amount: $('.p-amt', r)?.value || '', unit: $('.p-unit', r)?.value || '', area: $('.p-area', r)?.value || '' } : null;
  }).filter(Boolean);
  const areas = pfVal(root, '#areas');
  const notes = pfVal(root, '#tnotes');
  const price = Number($('#price', root)?.value);
  const devs = $$('#devices select[data-dev]', root);
  const flagged = devs.filter((s) => !['ok', 'bait_replaced'].includes(s.value)).length;
  const shots = $$('#t-photos figure.ph', root).filter((f) => PF_KINDS.includes(f.dataset.kind))
    .map((f) => ({ kind: f.dataset.kind, src: $('img', f)?.getAttribute('src') || '' })).filter((p) => p.src);
  const KIND = { before: 'Before', after: 'After', issue: 'Problem found' };
  const day = () => new Date().toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const body = () => `
    <div class="pf-langs"><button type="button" class="btn sm ${lang === 'es' ? '' : 'on'}" data-pflang="en">English</button><button type="button" class="btn sm ${lang === 'es' ? 'on' : ''}" data-pflang="es">Español</button></div>
    <div class="muted">${esc(v.service_name || '')}${v.service_name ? ' · ' : ''}${esc(day())}</div>
    ${pests.length ? `<h3>${esc(tc('Pests treated'))}</h3><div>${esc(pests.map((p) => tc(p)).join(', '))}</div>` : ''}
    ${prods.length ? `<h3>${esc(tc('Products applied'))}</h3>${prods.map((p) => `<div class="pf-li"><b>${esc(p.name)}</b>${p.amount ? ` · ${esc(p.amount)} ${esc(p.unit)}` : ''}${p.area ? `<div class="small muted">${esc(p.area)}</div>` : ''}</div>`).join('')}` : ''}
    ${areas ? `<h3>${esc(tc('Areas treated'))}</h3><div>${esc(areas)}</div>` : ''}
    ${devs.length ? `<h3>${esc(tc('Stations and traps'))}</h3><div>${esc(tc('{n} checked', { n: devs.length }))}${flagged ? ` · <b>${esc(tc('{n} need attention', { n: flagged }))}</b>` : ''}</div>` : ''}
    ${notes ? `<h3>${esc(tc('Notes from your technician'))}</h3><div style="white-space:pre-wrap">${esc(notes)}</div>` : ''}
    ${shots.length ? `<h3>${esc(tc('Photos'))}</h3><div class="pf-thumbs">${shots.map((p) => `<figure><img src="${esc(p.src)}" alt="${esc(tc(KIND[p.kind]))}">${esc(tc(KIND[p.kind]))}</figure>`).join('')}</div>` : ''}
    ${!pests.length && !prods.length && !areas && !notes && !shots.length ? `<p class="muted">${esc(tc('Nothing filled in yet.'))}</p>` : ''}
    ${price > 0 ? `<div class="pf-price"><span>${esc(tc("Today's service"))}</span><span>${esc(money(price))}</span></div>` : ''}`;
  let drawn = false, signedAt = null;
  const m = modal(tc('What we did today'), `<div class="pf-sum"><div id="pf-sum-body">${body()}</div><div id="pf-sum-sign"></div></div>`, [
    { label: tc('Back') },
    { label: tc('Done'), cls: 'primary', onClick: async () => {
      const name = $('#pf-pad-name', m.el).value.trim();
      if (!drawn) { toast(tc('Please sign in the box.'), true); return false; }
      if (st.rule && st.rule.signature !== 'none' && !name) { toast(tc('Please print your name.'), true); return false; }
      if (pfNoSignOn(root)) { $('#pf-nosign', root).checked = false; pfToggleNoSign(root, st); }
      st.clear();
      if (!(await pfPaint($('#sig', root), pad.value()))) { toast(tc('Please sign in the box.'), true); return false; }
      Object.assign(st, { image: $('#sig', root).toDataURL('image/png'), signedAt: signedAt || new Date().toISOString(), at: pfHere() });
      $('#pf-signer', root).value = name;
      if ($('#present', root)) $('#present', root).checked = true;
      pfRefresh(root);
      // Keep it in the draft on the phone like everything else on the ticket.
      root.dispatchEvent(new Event('change'));
      toast(NV.t('Signature added to the ticket'));
    } },
  ]);
  // Added after the modal opens so the name box doesn't take the focus and pop up the keyboard over the summary.
  $('#pf-sum-sign', m.el).innerHTML = `<div class="pf-padbox"><label id="pf-pad-l">${esc(tc('Sign here'))}</label><canvas class="sig" id="pf-pad"></canvas>
    <div class="pf-padfoot"><span class="small muted" id="pf-pad-ok">${esc(tc('By signing, you confirm this service was done today.'))}</span><button type="button" class="link-btn small" id="pf-pad-clear">${esc(tc('Clear'))}</button></div>
    <div class="field" style="margin-top:10px"><label for="pf-pad-name" id="pf-pad-nl">${esc(tc('Print your name'))}</label><input id="pf-pad-name" maxlength="80" autocomplete="off" value="${esc(pfVal(root, '#pf-signer'))}"></div></div>`;
  const pad = signaturePad($('#pf-pad', m.el));
  $('#pf-pad', m.el).addEventListener('pointerdown', () => { drawn = true; });
  $('#pf-pad', m.el).addEventListener('pointerup', () => { signedAt = new Date().toISOString(); });
  $('#pf-pad-clear', m.el).onclick = () => { pad.clear(); drawn = false; signedAt = null; };
  const wireLang = () => $$('[data-pflang]', m.el).forEach((b) => (b.onclick = () => {
    lang = b.dataset.pflang;
    $('.mh h2', m.el).textContent = tc('What we did today');
    $('#pf-sum-body', m.el).innerHTML = body();
    $('#pf-pad-l', m.el).textContent = tc('Sign here');
    $('#pf-pad-ok', m.el).textContent = tc('By signing, you confirm this service was done today.');
    $('#pf-pad-clear', m.el).textContent = tc('Clear');
    $('#pf-pad-nl', m.el).textContent = tc('Print your name');
    const [back, done] = $$('.mf .btn', m.el);
    back.textContent = tc('Back');
    done.textContent = tc('Done');
    wireLang();
  }));
  wireLang();
}

// ---------- office: the visit page ----------
const pfRuleText = (r) => [r.after ? `${r.after} after photo${r.after > 1 ? 's' : ''}` : '', r.before ? 'a before photo' : '',
  r.signature === 'required' ? 'a signature' : r.signature === 'or_reason' ? "a signature or why they couldn't sign" : ''].filter(Boolean).join(', ');

NV.slot('visit.right', ({ v }) => {
  const pr = v.proof;
  if (!pr || v.status !== 'completed') return '';
  const shots = (v.photos || []).filter((p) => PF_KINDS.includes(p.kind));
  const n = { before: 0, after: 0 };
  for (const p of shots) if (n[p.kind] != null) n[p.kind] += 1;
  const rule = pr.rule;
  const short = [];
  if (rule) {
    if (rule.before && !n.before) short.push('a before photo');
    if (n.after < rule.after) short.push(`${rule.after - n.after} after photo${rule.after - n.after > 1 ? 's' : ''}`);
    if (rule.signature === 'required' && !pr.signed) short.push('the signature');
    if (rule.signature === 'or_reason' && !pr.signed && !pr.no_sign_reason) short.push('a signature or a reason');
  }
  const sig = pr.signed
    ? `Signed by <b>${esc(pr.signer_name || 'no name given')}</b>${pr.signed_at ? ` · ${esc(pfTime(pr.signed_at))} by the phone's clock` : ''}
      <div class="small muted">${[pr.sign_received_at ? `Reached the office ${pfTime(pr.sign_received_at)}` : '', pfAway(pr.sign_distance_m, pr.sign_accuracy)].filter(Boolean).map(esc).join(' · ')}</div>`
    : pr.no_sign_reason ? `<b>Not signed:</b> ${esc(pr.no_sign_reason)}${pr.no_sign_note ? `. ${esc(pr.no_sign_note)}` : ''}` : '<span class="muted">Not signed</span>';
  return `<div class="pf-card"><h3>📸 Proof of service</h3>
    ${rule ? `<p class="small">${short.length ? `⚠️ Short of this stop's rule: missing ${esc(short.join(', '))}.` : `✅ Meets this stop's rule: ${esc(pfRuleText(rule))}.`}</p>` : ''}
    <div class="pf-row"><b>Signature</b><div>${sig}</div></div>
    ${shots.map((p) => `<div class="pf-row"><b>${esc(PHOTO_KIND[p.kind] || 'Photo')}</b> <span class="small">${p.taken_at ? `taken ${esc(pfTime(p.taken_at))}` : 'time taken not known'}</span>
      <div class="small muted">${[p.received_at ? `reached the office ${pfTime(p.received_at)}` : '', pfAway(p.distance_m, p.accuracy)].filter(Boolean).map(esc).join(' · ')}</div></div>`).join('')
      || '<div class="pf-row small muted">No photos.</div>'}</div>`;
});

// ---------- office: Settings → Proof of service ----------
const PF_SIG = [['none', 'Not needed'], ['or_reason', "Signature, or why they couldn't sign"], ['required', 'Signature required']];
NV.settingsTab({
  key: 'proof',
  label: 'Proof of service',
  async render(box, d) {
    box.innerHTML = '<div class="card"><p class="muted">Loading...</p></div>';
    let r;
    try { r = await api('/nuvolve/app/api/proof/rules'); } catch (e) { box.innerHTML = `<div class="card"><p>${esc(e.message)}</p></div>`; return; }
    const off = { after: 0, before: false, signature: 'none' };
    const services = (d.serviceTypes || []).filter((s) => s.active || r.rules.services[s.id]);
    const row = (key, name, sub, rule) => {
      const x = rule || off;
      return `<tr data-pfrow="${esc(key)}"><td><b>${esc(name)}</b>${sub ? `<div class="small muted">${esc(sub)}</div>` : ''}</td>
        <td><input type="number" min="0" max="10" step="1" inputmode="numeric" data-f="after" value="${Number(x.after) || 0}" aria-label="After photos for ${esc(name)}"></td>
        <td><label class="check"><input type="checkbox" data-f="before" ${x.before ? 'checked' : ''}> Needed</label></td>
        <td><select data-f="signature" aria-label="Signature for ${esc(name)}">${PF_SIG.map(([k, l]) => `<option value="${k}" ${x.signature === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></td></tr>`;
    };
    const older = { complete_photo: 'at least one photo', complete_signature: 'a customer signature' };
    box.innerHTML = `<div class="card" style="max-width:980px"><h2>Proof of service</h2>
      <p class="small muted">Commercial accounts and HOAs want to see the work was done. Pick what a tech needs before a stop can be finished.
        Each photo and signature is stamped with the time on the phone, the time it reached the office and where the phone was, and shows on the
        service report, the customer's pay page and the commercial audit binder.</p>
      <div class="table-wrap"><table class="list pf-rules"><thead><tr><th>Stops</th><th>After photos</th><th>Before photo</th><th>Signature</th></tr></thead><tbody>
        ${row('all', 'Every stop', '', r.rules.all)}
        ${row('commercial', 'Commercial accounts', 'Customers marked commercial', r.rules.commercial)}
        ${services.map((s) => row(`s${s.id}`, s.name, s.active ? '' : 'No longer offered', r.rules.services[s.id])).join('')}
      </tbody></table></div>
      <p class="small muted">When more than one row fits a stop, the stricter answer wins for each column. The tech sees what's still needed on the ticket,
        and the server checks it too, so no one gets around it from another screen. Owners and admins can override once; it goes in the activity log.
        "Why they couldn't sign" lets the tech pick a reason, like not home, instead of a signature.</p>
      ${r.businessRules.length ? `<div class="alert info small"><span>Settings → Rules also asks for ${esc(r.businessRules.map((t) => older[t]).filter(Boolean).join(' and '))} on every stop it covers. Both apply.</span></div>` : ''}
      <button class="btn primary" id="pf-save">Save</button></div>`;
    $('#pf-save', box).onclick = async (e) => {
      const read = (tr) => ({ after: Number($('[data-f=after]', tr).value || 0), before: $('[data-f=before]', tr).checked, signature: $('[data-f=signature]', tr).value });
      const body = { services: {} };
      for (const tr of $$('[data-pfrow]', box)) {
        const k = tr.dataset.pfrow;
        if (k === 'all' || k === 'commercial') body[k] = read(tr);
        else body.services[k.slice(1)] = read(tr);
      }
      e.target.disabled = true;
      try { await api('/nuvolve/app/api/proof/rules', { method: 'PUT', body }); toast('Saved'); } catch (err) { toast(err.message, true); } finally { e.target.disabled = false; }
    };
  },
});

// ---------- the customer's pay page ----------
NV.on('portal.rendered', ({ data, token, root }) => {
  const links = $$('a', root);
  const find = (href) => links.find((a) => a.getAttribute('href') === href);
  for (const h of data?.history || []) {
    const report = find(`/nuvolve/app/api/portal/${token}/report?visit=${h.id}`);
    const line = report?.closest('.line');
    if (!line) continue;
    for (const p of h.photos || []) {
      const t = p.taken_at || p.received_at;
      const cap = find(`/nuvolve/app/api/portal/${token}/photos/${p.id}`)?.closest('figure')?.querySelector('figcaption');
      if (cap && t) cap.insertAdjacentHTML('beforeend', ` <span class="muted">${esc(pfTime(t, { date: false }))}</span>`);
    }
    const pr = h.proof;
    let html = '';
    if (pr?.signed) {
      html = `<div class="pf-portal"><img class="pf-sig-img" src="/nuvolve/app/api/portal/${encodeURIComponent(token)}/visits/${Number(h.id)}/signature" alt="${esc(NV.t('Signature'))}" loading="lazy">
        <span class="small">${esc(pr.signer_name ? NV.t('Signed by {name}', { name: pr.signer_name }) : NV.t('Signed'))}${pr.signed_at ? ` · ${esc(pfTime(pr.signed_at))}` : ''}</span></div>`;
    } else if (pr?.no_sign_reason) {
      html = `<div class="pf-portal small muted">${esc(NV.t('Not signed'))}: ${esc(NV.t(pr.no_sign_reason))}${pr.no_sign_note ? `. ${esc(pr.no_sign_note)}` : ''}</div>`;
    }
    if (html) report.parentNode.insertAdjacentHTML('beforebegin', html);
  }
});

})(); } catch (e) { console.error('feature proof.js failed to load', e); }

/* ---- features/records-mix.js ---- */
try { (function () {
// Dilution math for pesticide mixes: the ticket's mix calculator (window.NVMix in the browser) and the server's
// records (require('public/js/features/records-mix.js')) use the same numbers.
//
// Liquids work in fluid ounces. "oz" counts as a fluid ounce, the way the trade talks about concentrates.
// A dry product weighed in grams or pounds is treated like the same weight of water (1 g = 1 ml) when we
// work out how strong a mix is, which is how labels state percent mixes.
const VOLUME = { 'fl oz': 1, oz: 1, gal: 128, qt: 32, pt: 16, L: 33.814, ml: 0.033814, tsp: 1 / 6, tbsp: 0.5 };
const WEIGHT_AS_WATER = { g: 0.033814, kg: 33.814, lb: 453.592 * 0.033814 };
const TANK_UNITS = ['gal', 'qt', 'L', 'ml', 'fl oz'];
const RATE_UNITS = ['fl oz', 'oz', 'ml', 'tsp', 'tbsp', 'qt', 'pt', 'gal', 'L', 'g', 'lb'];

const round = (n, d = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);
const isNum = (n) => n !== '' && n != null && Number.isFinite(Number(n));

// How many fluid ounces a quantity is, or null for units like stations or blocks.
function fluid(qty, unit) {
  if (!isNum(qty)) return null;
  const u = String(unit || '').trim();
  if (u in VOLUME) return Number(qty) * VOLUME[u];
  if (u in WEIGHT_AS_WATER) return Number(qty) * WEIGHT_AS_WATER[u];
  return null;
}
// The other way: fluid ounces back into a unit.
function fromFluid(flOz, unit) {
  const per = fluid(1, unit);
  return per && Number.isFinite(flOz) ? flOz / per : null;
}

// The active ingredient percent on a label line like "Bifenthrin 7.9%" (the first one listed).
function parseAi(text) {
  const m = String(text || '').match(/(\d+(?:\.\d+)?)\s*%/);
  const n = m ? Number(m[1]) : null;
  return n > 0 && n <= 100 ? n : null;
}

// Reads a rate someone typed, like "0.5 fl oz / gal", "1-2 oz per gallon" or "0.06%".
function parseRate(text) {
  const s = String(text || '').toLowerCase().replace(/gallons?/g, 'gal').replace(/ounces?/g, 'oz').replace(/,/g, '');
  const pct = s.match(/(\d*\.?\d+)\s*%/);
  const unitRe = '(fl\\.?\\s*oz|oz|ml|tsp|tbsp|qt|pt|gal|l|g|lb)';
  const m = s.match(new RegExp(`(\\d*\\.?\\d+)(?:\\s*(?:-|to)\\s*(\\d*\\.?\\d+))?\\s*${unitRe}\\s*(?:/|per|in|to)\\s*(?:1\\s*)?(gal|qt|l|1000 sq ft)`));
  const out = {};
  if (pct) out.pct = Number(pct[1]);
  if (m) {
    const unit = m[3].replace(/\./g, '').replace(/\s+/g, ' ');
    Object.assign(out, { low: Number(m[1]), high: m[2] ? Number(m[2]) : null, unit: unit === 'l' ? 'L' : unit, per: m[4] === 'l' ? 'L' : m[4] });
  }
  return Object.keys(out).length ? out : null;
}

// Label rate: so much product per gallon (or quart, or liter) of finished spray, times the tank.
// A rate per 1,000 sq ft is times the area treated instead.
function fromRate({ rate, rateUnit = 'fl oz', per = 'gal', tank, tankUnit = 'gal', area }) {
  if (per === '1000 sq ft') return Number(rate) > 0 && Number(area) > 0 ? { amount: round((Number(rate) * Number(area)) / 1000, 2), unit: rateUnit } : null;
  const t = fluid(tank, tankUnit), p = fluid(1, per);
  if (!(Number(rate) > 0) || !(t > 0) || !p) return null;
  return { amount: round((Number(rate) * t) / p, 2), unit: rateUnit };
}

// Target percent: the finished mix should be `target`% active ingredient (or % product when the label's
// active ingredient percent isn't known). Concentrate = tank x target / product strength.
function fromPercent({ target, ai, tank, tankUnit = 'gal', outUnit = 'fl oz' }) {
  const t = fluid(tank, tankUnit);
  const strength = Number(ai) > 0 ? Number(ai) : 100;
  if (!(Number(target) > 0) || !(t > 0) || Number(target) > strength) return null;
  const flOz = (t * Number(target)) / strength;
  const out = fromFluid(flOz, outUnit);
  return out == null ? null : { amount: round(out, 2), unit: outUnit };
}

// How strong a recorded mix is: product as a percent of the finished volume, and active ingredient percent.
function strength({ amount, unit, volume, volumeUnit, ai }) {
  const c = fluid(amount, unit), v = fluid(volume, volumeUnit);
  if (!(c > 0) || !(v > 0) || c > v) return { mixPct: null, aiPct: null };
  const mixPct = (c / v) * 100;
  return { mixPct: round(mixPct, 3), aiPct: Number(ai) > 0 ? round((mixPct * Number(ai)) / 100, 4) : null };
}

// A short line for the record, like "1 fl oz in 1 gal (0.78% mix, 0.062% a.i.)".
function describe({ amount, unit, volume, volumeUnit, ai }) {
  if (!(Number(amount) > 0) || !(Number(volume) > 0)) return '';
  const s = strength({ amount, unit, volume, volumeUnit, ai });
  const parts = [s.mixPct != null ? `${s.mixPct}% mix` : null, s.aiPct != null ? `${s.aiPct}% a.i.` : null].filter(Boolean);
  return `${round(Number(amount), 2)} ${unit} in ${round(Number(volume), 2)} ${volumeUnit}${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

const NVMix = { VOLUME, TANK_UNITS, RATE_UNITS, round, fluid, fromFluid, parseAi, parseRate, fromRate, fromPercent, strength, describe };
if (typeof module !== 'undefined' && module.exports) module.exports = NVMix;
else if (typeof window !== 'undefined') window.NVMix = NVMix;

})(); } catch (e) { console.error('feature records-mix.js failed to load', e); }

/* ---- features/records.js ---- */
try { (function () {
// Pesticide records in the browser: what each product line on the ticket records (lot and expiration, method,
// inside or outside, target pest, size treated, the mix with its calculator, tank mixes), structured weather, the
// applicator and supervisor, the restricted-use checks before a stop is finished, the finished visit's record and its
// corrections, History cards on the customer and visit pages, the state exports page, the full activity log, and the
// Spanish for the core ticket a tech reads.
const T = (s, v) => NV.t(s, v);
const MIX = window.NVMix;
let BOOTD = null;
NV.on('boot', ({ boot }) => { BOOTD = boot; });
// The office reloads its BOOT after a save (a new product), so read the live one when there is one.
const B = () => (typeof BOOT !== 'undefined' && BOOT) || BOOTD || {};
const RECS = () => B().records || { me: null, people: [], methods: [], wind_dirs: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'Variable'] };
const prodOf = (id) => (B().products || []).find((p) => p.id === Number(id)) || null;
const isTech = () => B().me?.role === 'tech';
const TANKS = ['A', 'B', 'C', 'D', 'E', 'F'];
const SITES = [['inside', 'Inside'], ['outside', 'Outside'], ['both', 'Inside and outside']];
const numOf = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const val = (root, sel) => ($(sel, root)?.value || '').trim();
const dayFor = (visit) => (visit?.date && visit.date < todayStr() ? visit.date : todayStr());
const fmtD = (s) => (s ? parseYmd(s.slice(0, 10)).toLocaleDateString(NV.lang === 'es' ? 'es-US' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const stamp = (s) => new Date(String(s).replace(' ', 'T') + 'Z').toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const weatherLine = (w) => [w?.temp_f != null ? `${w.temp_f}°F` : null,
  w?.wind_mph != null ? (w.wind_mph === 0 ? 'wind calm' : `wind ${w.wind_mph} mph${w.wind_dir ? ` ${w.wind_dir}` : ''}`) : null].filter(Boolean).join(', ');

const style = document.createElement('style');
style.textContent = `
.rec-line{margin-top:8px;border-top:1px dashed var(--line);padding-top:8px}
.rec-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.rec-grid .wide{grid-column:1/-1}
.rec-pair{display:grid;grid-template-columns:1fr 104px;gap:6px}
.rec-mix{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.rec-more{margin-top:6px}.rec-more>summary{cursor:pointer;color:var(--brand-dark);font-size:14px;padding:6px 0}
.rec-badges{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}.rec-badges:empty{display:none}
.rec-strength{margin-top:4px}.rec-strength:empty{display:none}.rec-strength .warn{color:var(--warn);font-weight:600}
.prod-row.rec-rup{border-color:#feb2b2}
.rec-box{border:1px solid var(--line);border-radius:10px;padding:10px;margin-top:10px;background:#fafbfb}
.rec-tank{display:grid;grid-template-columns:70px 1fr 90px 40px;gap:6px;align-items:center;margin:6px 0}
.rec-w{display:grid;grid-template-columns:minmax(64px,.7fr) 1fr 1fr;gap:8px;margin-top:8px}
.rec-hist .hi{padding:8px 0;border-bottom:1px solid var(--line)}.rec-hist .hi:last-child{border-bottom:0}
.rec-hist ul{margin:4px 0 0;padding-left:18px}.rec-hist li{margin:3px 0;font-size:13px;overflow-wrap:anywhere}
.rec-hist s{color:var(--danger)}.rec-hist details summary{cursor:pointer;color:var(--brand-dark)}
.rec-checks{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 12px}
.rec-line{padding:8px 0;border-bottom:1px solid var(--line)}.rec-line .small{margin-top:2px;overflow-wrap:anywhere}
.rec-calc-out{font-size:20px;font-weight:700;margin:8px 0}
@media (max-width:420px){.rec-grid,.rec-mix{grid-template-columns:1fr}.rec-tank{grid-template-columns:56px 1fr 80px 36px}}`;
document.head.appendChild(style);

// ---------- the ticket ----------
let seq = 0;
const state = new WeakMap();   // ticket root -> { visit, lots }
const lotLabel = (l) => [l.expires ? T('expires {date}', { date: fmtD(l.expires) }) : null,
  { truck: T('on your truck'), shop: T('at the shop'), recent: T('used lately') }[l.source]].filter(Boolean).join(' · ');

function tanksOf(root) {
  const out = {};
  for (const t of $$('.rec-tank', root)) {
    const v = numOf($('.t-vol', t).value);
    out[t.dataset.t] = { volume: v, unit: $('.t-unit', t).value };
  }
  return out;
}
function tankOptions(root, current) {
  const tanks = tanksOf(root);
  return `<option value="">${esc(T('Own mix'))}</option>${Object.entries(tanks).map(([k, t]) => `<option value="${k}" ${k === current ? 'selected' : ''}>${esc(T('Tank {name}', { name: k }))}${t.volume ? ` (${t.volume} ${esc(t.unit)})` : ''}</option>`).join('')}`;
}
function refreshTankSelects(root) {
  for (const row of $$('#prod-rows .prod-row', root)) {
    const sel = $('.r-tank', row);
    if (!sel) continue;
    const cur = sel.value;
    sel.innerHTML = tankOptions(root, cur);
    if (!tanksOf(root)[cur]) sel.value = '';
    syncMix(row, root);
  }
}
function addTank(root, t = {}) {
  const used = Object.keys(tanksOf(root));
  const name = t.name || TANKS.find((x) => !used.includes(x));
  if (!name) return toast(T('Six tanks is the most one ticket can hold.'), true);
  $('.rec-tank-list', root).insertAdjacentHTML('beforeend', `<div class="rec-tank" data-t="${name}"><b>${esc(T('Tank {name}', { name }))}</b>
    <input class="t-vol" type="number" min="0" step="0.1" inputmode="decimal" placeholder="${esc(T('Finished volume'))}" aria-label="${esc(T('Finished volume of tank {name}', { name }))}" value="${esc(t.volume ?? '')}">
    <select class="t-unit" aria-label="${esc(T('Unit'))}">${MIX.TANK_UNITS.map((u) => `<option ${u === (t.unit || 'gal') ? 'selected' : ''}>${u}</option>`).join('')}</select>
    <button type="button" class="btn sm t-x" aria-label="${esc(T('Remove tank {name}', { name }))}">✕</button></div>`);
  refreshTankSelects(root);
}

// The finished mix a line's product went into: its tank, or its own.
function mixOf(row, root) {
  const tank = $('.r-tank', row)?.value;
  if (tank) { const t = tanksOf(root)[tank]; return t?.volume ? { volume: t.volume, unit: t.unit } : null; }
  const v = numOf($('.r-vol', row)?.value);
  return v ? { volume: v, unit: $('.r-vol-unit', row).value } : null;
}
function syncMix(row, root) {
  const own = $('.r-own', row);
  if (own) own.hidden = Boolean($('.r-tank', row).value);
  strengthOf(row, root);
}
function strengthOf(row, root) {
  const el = $('.rec-strength', row);
  if (!el) return;
  const p = prodOf($('.p-id', row).value);
  if (!p) { el.innerHTML = ''; return; }
  if (p.rtu) { el.textContent = T('Ready to use: no mixing.'); return; }
  const mix = mixOf(row, root);
  const amount = numOf($('.p-amt', row).value), unit = $('.p-unit', row).value;
  if (!mix || !(amount > 0)) { el.innerHTML = ''; return; }
  const ai = p.ai_percent ?? MIX.parseAi(p.active_ingredient);
  const s = MIX.strength({ amount, unit, volume: mix.volume, volumeUnit: mix.unit, ai });
  if (s.mixPct == null) { el.innerHTML = ''; return; }
  let note = '';
  const rate = p.rate_per && p.rate_per !== '1000 sq ft' ? MIX.fluid(amount, unit) / MIX.fluid(mix.volume, mix.unit) * MIX.fluid(1, p.rate_per) / (MIX.fluid(1, p.rate_unit || 'fl oz') || 1) : null;
  // A mix inside the label's rate range is right. The percent check counts the product as weighing the same as
  // water, so it can be a few percent off for a heavier product; it only speaks up when the mix is clearly off.
  const inRate = rate != null && p.rate_low != null && rate >= p.rate_low * 0.99 && (p.rate_high == null || rate <= p.rate_high * 1.01);
  if (!inRate && s.aiPct != null && p.pct_high != null && s.aiPct > p.pct_high * 1.1) note = T("That's stronger than the label's {pct}%.", { pct: p.pct_high });
  else if (!inRate && s.aiPct != null && p.pct_low != null && s.aiPct < p.pct_low * 0.9) note = T("That's weaker than the label's {pct}%.", { pct: p.pct_low });
  if (!note && rate != null && p.rate_high != null && rate > p.rate_high * 1.01) note = T('Above the label rate of {rate} {unit} per {per}.', { rate: p.rate_high, unit: p.rate_unit || 'fl oz', per: p.rate_per });
  el.innerHTML = `${esc(T('{amount} {unit} in {volume} {vunit}: {pct}% mix', { amount, unit, volume: mix.volume, vunit: mix.unit, pct: s.mixPct }))}${s.aiPct != null ? esc(T(', {ai}% active ingredient', { ai: s.aiPct })) : ''}${note ? ` <span class="warn">${esc(note)}</span>` : ''}`;
}
function badgesOf(row, st) {
  const p = prodOf($('.p-id', row).value);
  const exp = val(row, '.r-exp');
  row.classList.toggle('rec-rup', Boolean(p?.restricted_use));
  const out = [];
  if (p?.restricted_use) out.push(`<span class="pill red">${esc(T('Restricted use'))}</span>`);
  if (exp && exp < dayFor(st?.visit)) out.push(`<span class="pill yellow">⚠ ${esc(T('Lot expired {date}', { date: fmtD(exp) }))}</span>`);
  if (p?.rtu) out.push(`<span class="pill">${esc(T('Ready to use'))}</span>`);
  $('.rec-badges', row).innerHTML = out.join('');
}
// A new product on the line: its lots, whether it needs mixing, and its badges.
function productChanged(row, root) {
  const st = state.get(root) || {};
  const p = prodOf($('.p-id', row).value);
  const lots = (p && st.lots && st.lots[p.id]) || [];
  $('datalist', row).innerHTML = lots.map((l) => `<option value="${esc(l.lot)}">${esc(lotLabel(l))}</option>`).join('');
  const lot = $('.r-lot', row);
  if (lot.dataset.auto) { lot.value = ''; $('.r-exp', row).value = ''; delete lot.dataset.auto; }
  const held = lots.filter((l) => l.source !== 'recent');
  if (p && !lot.value && held.length === 1) { lot.value = held[0].lot; lot.dataset.auto = '1'; $('.r-exp', row).value = held[0].expires || ''; }
  $('.rec-mix', row).hidden = Boolean(p?.rtu);
  $('.r-calc', row).hidden = Boolean(p?.rtu);
  badgesOf(row, st);
  strengthOf(row, root);
  if (NV.lang !== 'en') translateTree(row);
}
function enhanceRow(row, root) {
  if (row.dataset.rec) return;
  row.dataset.rec = String(++seq);
  const n = seq;
  row.insertAdjacentHTML('beforeend', `<div class="rec-line">
    <div class="rec-badges"></div>
    <div class="rec-grid">
      <div><input class="r-lot" list="rec-lots-${n}" maxlength="40" autocomplete="off" placeholder="${esc(T('Lot #'))}" aria-label="${esc(T('Lot number'))}"><datalist id="rec-lots-${n}"></datalist></div>
      <input class="r-exp" type="date" aria-label="${esc(T('Lot expires'))}" title="${esc(T('Lot expires'))}">
      <select class="r-method" aria-label="${esc(T('Method'))}"><option value="">${esc(T('Method'))}</option>${RECS().methods.map((m) => `<option value="${esc(m)}">${esc(T(m))}</option>`).join('')}</select>
      <select class="r-site" aria-label="${esc(T('Inside or outside'))}"><option value="">${esc(T('Inside or outside?'))}</option>${SITES.map(([k, l]) => `<option value="${k}">${esc(T(l))}</option>`).join('')}</select>
    </div>
    <details class="rec-more"><summary>${esc(T('Mix, target pest and size treated'))}</summary>
      <div class="rec-grid">
        <input class="r-target wide" list="rec-pests" maxlength="120" placeholder="${esc(T('Target pest, if not every pest above'))}" aria-label="${esc(T('Target pest'))}">
        <div class="rec-pair wide"><input class="r-size" type="number" min="0" step="1" inputmode="decimal" placeholder="${esc(T('Size treated'))}" aria-label="${esc(T('Size treated'))}">
          <select class="r-size-unit" aria-label="${esc(T('Size unit'))}"><option value="sq ft">${esc(T('sq ft'))}</option><option value="linear ft">${esc(T('linear ft'))}</option></select></div>
        <div class="rec-mix wide"><select class="r-tank" aria-label="${esc(T('Mixed in'))}">${tankOptions(root)}</select>
          <div class="rec-pair r-own"><input class="r-vol" type="number" min="0" step="0.01" inputmode="decimal" placeholder="${esc(T('Finished mix'))}" aria-label="${esc(T('Finished mix made'))}">
            <select class="r-vol-unit" aria-label="${esc(T('Finished mix unit'))}">${MIX.TANK_UNITS.map((u) => `<option>${u}</option>`).join('')}</select></div></div>
        <button type="button" class="btn sm r-calc wide">🧮 ${esc(T('Mix calculator'))}</button>
      </div>
    </details>
    <div class="rec-strength small muted"></div>
  </div>`);
  const st = () => state.get(root) || {};
  $('.p-id', row).addEventListener('change', () => productChanged(row, root));
  $('.r-lot', row).addEventListener('input', (e) => {
    delete e.target.dataset.auto;
    const p = prodOf($('.p-id', row).value);
    const known = ((p && st().lots?.[p.id]) || []).find((l) => l.lot === e.target.value.trim());
    const exp = $('.r-exp', row);
    if (known?.expires && (!exp.value || exp.dataset.auto)) { exp.value = known.expires; exp.dataset.auto = '1'; }
    badgesOf(row, st());
  });
  $('.r-exp', row).addEventListener('change', (e) => { delete e.target.dataset.auto; badgesOf(row, st()); });
  for (const sel of ['.p-amt', '.p-unit', '.r-vol', '.r-vol-unit']) $(sel, row).addEventListener('input', () => strengthOf(row, root));
  $('.p-unit', row).addEventListener('change', () => strengthOf(row, root));
  $('.r-tank', row).addEventListener('change', () => syncMix(row, root));
  $('.r-calc', row).onclick = () => mixCalculator(row, root);
  productChanged(row, root);
  syncMix(row, root);
}
const enhanceAll = (root) => $$('#prod-rows .prod-row', root).forEach((r) => enhanceRow(r, root));

// The dilution calculator: the label rate or a target percent, and the tank, give the concentrate to add.
function mixCalculator(row, root) {
  const p = prodOf($('.p-id', row).value);
  if (!p) return toast(T('Pick the product first'), true);
  const parsed = MIX.parseRate(p.default_rate) || {};
  const rate = p.rate_low ?? parsed.low ?? '', rateUnit = p.rate_unit || parsed.unit || 'fl oz', per = p.rate_per || parsed.per || 'gal';
  const target = p.pct_low ?? parsed.pct ?? '';
  const ai = p.ai_percent ?? MIX.parseAi(p.active_ingredient) ?? '';
  const mix = mixOf(row, root) || { volume: '', unit: 'gal' };
  const m = modal(T('Mix calculator: {product}', { product: p.name }), `
    <div class="seg" id="mc-mode"><button type="button" class="on" data-m="rate">${esc(T('Label rate'))}</button><button type="button" data-m="pct">${esc(T('Target percent'))}</button></div>
    <div class="mc-rate"><div class="rec-mix"><div class="field"><label>${esc(T('Rate'))}</label><input name="rate" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(rate)}"></div>
      <div class="field"><label>${esc(T('Unit'))}</label><select name="rate_unit">${MIX.RATE_UNITS.map((u) => `<option ${u === rateUnit ? 'selected' : ''}>${u}</option>`).join('')}</select></div></div>
      <div class="field"><label>${esc(T('Per'))}</label><select name="per">${[['gal', T('gallon of finished mix')], ['qt', T('quart of finished mix')], ['L', T('liter of finished mix')], ['1000 sq ft', T('1,000 sq ft treated')]].map(([k, l]) => `<option value="${k}" ${k === per ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div></div>
    <div class="mc-pct" hidden><div class="rec-mix"><div class="field"><label>${esc(T('Target % in the finished mix'))}</label><input name="target" type="number" min="0" step="0.001" inputmode="decimal" value="${esc(target)}"></div>
      <div class="field"><label>${esc(T('Active ingredient % in the product'))}</label><input name="ai" type="number" min="0" max="100" step="0.01" inputmode="decimal" value="${esc(ai)}"></div></div>
      <div class="hint">${esc(T('Leave the active ingredient blank when the target is a percent of product, not of active ingredient.'))}</div></div>
    <div class="rec-mix"><div class="field mc-tank"><label>${esc(T('Tank size (finished mix)'))}</label><input name="tank" type="number" min="0" step="0.1" inputmode="decimal" value="${esc(mix.volume)}"></div>
      <div class="field mc-tank"><label>${esc(T('Unit'))}</label><select name="tank_unit">${MIX.TANK_UNITS.map((u) => `<option ${u === mix.unit ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
      <div class="field mc-area" hidden><label>${esc(T('Area to treat (sq ft)'))}</label><input name="area" type="number" min="0" step="1" inputmode="decimal" value="${esc(val(row, '.r-size'))}"></div></div>
    <div class="rec-calc-out" id="mc-out" aria-live="polite"></div>
    ${p.default_rate ? `<div class="hint">${esc(T('Usual rate: {rate}', { rate: p.default_rate }))}</div>` : ''}`,
  [{ label: T('Cancel') }, { label: T('Use this'), cls: 'primary', onClick: (el) => {
    const r = calc(el);
    if (!r) throw new Error(T('Fill in the rate and the tank size'));
    const amt = $('.p-amt', row), unitSel = $('.p-unit', row);
    amt.value = r.amount;
    if (![...unitSel.options].some((o) => o.value === r.unit)) unitSel.add(new Option(r.unit, r.unit));
    unitSel.value = r.unit;
    const f = formData(el);
    if (f.per !== '1000 sq ft' && !$('.r-tank', row).value && numOf(f.tank)) { $('.r-vol', row).value = f.tank; $('.r-vol-unit', row).value = f.tank_unit; }
    if (f.per === '1000 sq ft' && numOf(f.area)) { $('.r-size', row).value = f.area; $('.r-size-unit', row).value = 'sq ft'; }
    if (!$('.p-rate', row).value) $('.p-rate', row).value = mode === 'pct' ? `${f.target}%` : `${f.rate} ${f.rate_unit}/${f.per}`;
    $('.rec-more', row).open = true;
    strengthOf(row, root);
    amt.dispatchEvent(new Event('input', { bubbles: true }));
  } }]);
  let mode = rate === '' && target !== '' ? 'pct' : 'rate';
  const calc = (el) => {
    const f = formData(el);
    if (mode === 'pct') return MIX.fromPercent({ target: f.target, ai: f.ai, tank: f.tank, tankUnit: f.tank_unit, outUnit: p.unit && MIX.fluid(1, p.unit) != null ? p.unit : 'fl oz' });
    return MIX.fromRate({ rate: f.rate, rateUnit: f.rate_unit, per: f.per, tank: f.tank, tankUnit: f.tank_unit, area: f.area });
  };
  const draw = () => {
    $$('#mc-mode button', m.el).forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
    $('.mc-rate', m.el).hidden = mode !== 'rate';
    $('.mc-pct', m.el).hidden = mode !== 'pct';
    const perArea = mode === 'rate' && $('[name=per]', m.el).value === '1000 sq ft';
    $$('.mc-tank', m.el).forEach((x) => (x.hidden = perArea));
    $('.mc-area', m.el).hidden = !perArea;
    const r = calc(m.el);
    $('#mc-out', m.el).textContent = r ? T('Add {amount} {unit} of {product}', { amount: r.amount, unit: r.unit, product: p.name }) : '';
  };
  $$('#mc-mode button', m.el).forEach((b) => (b.onclick = () => { mode = b.dataset.m; draw(); }));
  m.el.addEventListener('input', draw);
  m.el.addEventListener('change', draw);
  draw();
  if (NV.lang !== 'en') translateTree(m.el);
}

function peopleHtml(visit) {
  const R = RECS();
  const me0 = B().me;
  if (!me0) return '';
  const certified = R.people.filter((u) => u.certified);
  const supOptions = (pick, not) => `<option value="">${esc(T('Pick who supervised'))}</option>${certified.filter((u) => u.id !== not).map((u) => `<option value="${u.id}" ${u.id === pick ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}`;
  if (isTech()) {
    const me = R.me || { name: me0.name };
    return `<div class="field" id="rec-people"><label>${esc(T('Applicator'))}</label>
      <div class="small">${esc(me.name)} · ${me.license_no ? esc(T('License {no}', { no: me.license_no })) : `<span style="color:var(--warn)">${esc(T('No license number on file'))}</span>`}</div>
      ${me.certified ? '' : `<label for="rec-sup" style="margin-top:8px">${esc(T('Certified applicator supervising you'))}</label><select id="rec-sup">${supOptions(me.supervisor_id, me.id)}</select>
        <div class="hint">${esc(T('Required when you apply a restricted-use product.'))}</div>`}</div>`;
  }
  const pick = visit.tech_id || me0.id;
  const people = R.people.some((u) => u.id === pick) ? R.people : [...R.people, { id: pick, name: visit.tech_name || me0.name, certified: false }];
  return `<div class="row" id="rec-people"><div class="field"><label for="rec-app">${esc(T('Applied by'))}</label>
      <select id="rec-app">${people.map((u) => `<option value="${u.id}" ${u.id === pick ? 'selected' : ''}>${esc(u.name)}${u.certified ? ' ✓' : ''}</option>`).join('')}</select>
      <div class="hint">✓ ${esc(T('certified applicator with a current license'))}</div></div>
    <div class="field" id="rec-sup-wrap"><label for="rec-sup">${esc(T('Certified applicator supervising'))}</label><select id="rec-sup">${supOptions(null, pick)}</select></div></div>`;
}
function syncPeople(root) {
  const app = $('#rec-app', root);
  if (!app) return;
  const who = RECS().people.find((u) => u.id === Number(app.value));
  $('#rec-sup-wrap', root).hidden = Boolean(who?.certified);
}
NV.slot('ticket.fields', ({ visit }) => peopleHtml(visit));

NV.on('ticket.rendered', ({ root, visit }) => {
  if (!MIX || $('#rec-tanks', root)) return;
  state.set(root, { visit, lots: visit.record?.lots || {} });
  $('#add-prod', root).insertAdjacentHTML('afterend', `<div class="rec-box" id="rec-tanks">
    <div class="small"><b>${esc(T('Tank mixes'))}</b> · <span class="muted">${esc(T('Mixed more than one product in the same tank? Add the tank here, then pick it on each product.'))}</span></div>
    <div class="rec-tank-list"></div><button type="button" class="btn sm" id="rec-add-tank">+ ${esc(T('Add a tank'))}</button></div>
    <datalist id="rec-pests">${COMMON_PESTS.map((p) => `<option value="${esc(p)}">${esc(T(p))}</option>`).join('')}</datalist>`);
  const weather = $('#weather', root);
  weather.placeholder = T('Sky and anything else (optional)');
  weather.insertAdjacentHTML('afterend', `<div class="rec-w"><input id="rec-temp" type="number" min="-40" max="140" step="1" inputmode="decimal" placeholder="°F" aria-label="${esc(T('Temperature (°F)'))}">
    <input id="rec-wind" type="number" min="0" max="150" step="1" inputmode="decimal" placeholder="${esc(T('Wind mph'))}" aria-label="${esc(T('Wind speed (mph)'))}">
    <select id="rec-dir" aria-label="${esc(T('Wind direction'))}"><option value="">${esc(T('Wind from'))}</option>${RECS().wind_dirs.map((d) => `<option value="${d}">${esc(T(d))}</option>`).join('')}</select></div>
    <div class="hint">${esc(T('Temperature and wind go on the record. A restricted-use product applied outside needs the wind.'))}</div>`);
  $('#rec-add-tank', root).onclick = () => addTank(root);
  $('#rec-tanks', root).addEventListener('input', (e) => { if (e.target.matches('.t-vol, .t-unit')) refreshTankSelects(root); });
  $('#rec-tanks', root).addEventListener('change', (e) => { if (e.target.matches('.t-unit')) refreshTankSelects(root); });
  $('#rec-tanks', root).addEventListener('click', (e) => { if (e.target.matches('.t-x')) { e.target.closest('.rec-tank').remove(); refreshTankSelects(root); } });
  if ($('#rec-app', root)) { $('#rec-app', root).onchange = () => syncPeople(root); syncPeople(root); }
  enhanceAll(root);
  new MutationObserver(() => enhanceAll(root)).observe($('#prod-rows', root), { childList: true });
  // "Fill in from last visit" brings back the record fields too (not the lot: today's jug may be a new one).
  const useLast = $('#use-last', root);
  if (useLast && visit.last_ticket) {
    const core = useLast.onclick;
    useLast.onclick = (e) => {
      core(e);
      enhanceAll(root);
      $('.rec-tank-list', root).innerHTML = '';
      for (const [name, t] of Object.entries(visit.last_ticket.tanks || {})) addTank(root, { name, ...t });
      const rows = $$('#prod-rows .prod-row', root);
      (visit.last_ticket.products || []).forEach((p, i) => rows[i] && fillLine(rows[i], root, { ...p, lot: undefined, lot_expires: undefined }));
    };
  }
  if (NV.lang !== 'en') translateTicket(root);
});

function fillLine(row, root, l) {
  enhanceRow(row, root);
  const set = (sel, v) => { if (v != null && v !== '' && $(sel, row)) $(sel, row).value = v; };
  if (l.lot !== undefined) { set('.r-lot', l.lot); delete $('.r-lot', row).dataset.auto; }
  if (l.lot_expires !== undefined) set('.r-exp', l.lot_expires);
  set('.r-method', l.method); set('.r-site', l.site_type); set('.r-target', l.target); set('.r-size', l.size); set('.r-size-unit', l.size_unit);
  if (l.tank && tanksOf(root)[l.tank]) $('.r-tank', row).value = l.tank;
  else { set('.r-vol', l.mix_volume); set('.r-vol-unit', l.mix_unit); }
  if (l.target || l.size || l.tank || l.mix_volume) $('.rec-more', row).open = true;
  badgesOf(row, state.get(root));
  syncMix(row, root);
}

// A ticket kept on the phone (no signal, a closed tab, or one the server turned down) comes back whole.
NV.on('ticket.draft', ({ root, draft }) => {
  const r = draft?.record;
  if (!r || !$('#rec-tanks', root)) return;
  enhanceAll(root);
  $('.rec-tank-list', root).innerHTML = '';
  for (const [name, t] of Object.entries(r.tanks || {})) addTank(root, { name, ...t });
  const w = r.weather || {};
  $('#rec-temp', root).value = w.temp_f ?? '';
  $('#rec-wind', root).value = w.wind_mph ?? '';
  $('#rec-dir', root).value = w.wind_dir || '';
  if (r.applicator_id && $('#rec-app', root)) { $('#rec-app', root).value = r.applicator_id; syncPeople(root); }
  if (r.supervisor_id && $('#rec-sup', root)) $('#rec-sup', root).value = r.supervisor_id;
  const rows = $$('#prod-rows .prod-row', root).filter((x) => Number($('.p-id', x).value));
  (r.lines || []).forEach((l, i) => rows[i] && fillLine(rows[i], root, l));
});

NV.collector('ticket', (root) => {
  if (!$('#rec-tanks', root)) return {};
  const lines = $$('#prod-rows .prod-row', root).filter((r) => Number($('.p-id', r).value)).map((r) => ({
    product_id: Number($('.p-id', r).value), lot: val(r, '.r-lot'), lot_expires: val(r, '.r-exp'), method: val(r, '.r-method'), site_type: val(r, '.r-site'),
    target: val(r, '.r-target'), size: numOf(val(r, '.r-size')), size_unit: val(r, '.r-size-unit'), tank: val(r, '.r-tank'),
    mix_volume: val(r, '.r-tank') ? null : numOf(val(r, '.r-vol')), mix_unit: val(r, '.r-vol-unit'),
  }));
  const tanks = Object.fromEntries(Object.entries(tanksOf(root)).filter(([, t]) => t.volume > 0));
  return { record: {
    lines, tanks, lang: NV.lang,
    weather: { temp_f: numOf(val(root, '#rec-temp')), wind_mph: numOf(val(root, '#rec-wind')), wind_dir: val(root, '#rec-dir') || null },
    supervisor_id: numOf(val(root, '#rec-sup')), applicator_id: numOf(val(root, '#rec-app')),
  } };
});

// The same checks the server makes, so the tech hears about a missing lot before tapping Complete in a dead zone.
NV.check('ticket', (body, { visit, root }) => {
  const r = body.record;
  if (!r || !root || !$('#rec-tanks', root)) return null;
  const R = RECS();
  const day = dayFor(visit);
  for (const [name, t] of Object.entries(tanksOf(root))) {
    if (!(t.volume > 0) && r.lines.some((l) => l.tank === name)) return T('Enter how much finished mix Tank {name} made.', { name });
  }
  let people = false;
  for (const [i, l] of r.lines.entries()) {
    const p = prodOf(l.product_id);
    const line = body.products[i] || {};
    if (!p) continue;
    const rup = Boolean(p.restricted_use), product = p.name;
    if (rup && !people) {
      people = true;
      const a = isTech() ? R.me : R.people.find((u) => u.id === r.applicator_id);
      const sup = R.people.find((u) => u.id === r.supervisor_id);
      if (a && !a.certified && !(sup && sup.certified)) {
        if (isTech() && !a.license_no && a.applicator_type === 'certified') return T('{name} has no applicator license number on file. Ask the office to add it before applying {product}.', { name: a.name, product });
        return T('{product} is a restricted-use pesticide. Pick the certified applicator who supervised this application.', { product });
      }
    }
    if ((rup || R.require_lot) && !l.lot) return T('Enter the lot number for {product}.', { product });
    if (rup && !(Number(line.amount) > 0 && line.unit)) return T('Enter how much {product} you used, with the unit.', { product });
    if (rup && !String(line.area || '').trim()) return T('Enter where you applied {product}.', { product });
    if (rup && !(l.target || body.target_pests)) return T('Pick the target pest for {product}.', { product });
    if (rup && !l.site_type) return T('Say whether {product} went inside or outside.', { product });
    const w = r.weather;
    if ((rup || R.require_wind) && ['outside', 'both'].includes(l.site_type) && !(w.wind_mph != null && (w.wind_mph === 0 || w.wind_dir))) {
      return T('Enter the wind speed and direction for the outdoor application of {product}.', { product });
    }
  }
  const old = r.lines.find((l) => l.lot && l.lot_expires && l.lot_expires < day);
  if (old && !confirm(T('Lot {lot} of {product} expired on {date}. Use it anyway? The office will see it on the record.', { lot: old.lot, product: prodOf(old.product_id)?.name || '', date: fmtD(old.lot_expires) }))) {
    return T('Check the lot number, or pick a lot that has not expired.');
  }
  return null;
});

NV.on('ticket.saved', ({ result }) => {
  const w = result?.record_warnings;
  if (w?.length) setTimeout(() => toast(T('Saved. Heads up: {product} lot {lot} expired on {date}.', { product: w[0].product, lot: w[0].lot, date: fmtD(w[0].expires) }), true), 2900);
});

// ---------- Spanish for the core ticket ----------
// The core ticket's words are English in its own code; for a Spanish-speaking tech they are swapped on screen
// (the values that get saved, like pest names, stay English for the records).
const PATTERNS = [
  [/^Enter how much (.+) you used$/, 'Enter how much {x} you used'],
  [/^Amount \((.+)\)$/, 'Amount ({x})'],
  [/^Done! Card charged (.+)$/, 'Done! Card charged {x}'],
  [/^(\d+) added$/, '{x} added'],
  [/^Using (.+)\. Change$/, 'Using {x}. Change'],
  [/^Texted the customer: arriving about (.+)$/, 'Texted the customer: arriving about {x}'],
  [/^Emailed the customer: arriving about (.+)$/, 'Emailed the customer: arriving about {x}'],
  [/^(\d+) open$/, '{x} open'],
];
function translateText(s) {
  const t = s.trim();
  if (!t) return null;
  if (NV.strings[t]) return s.replace(t, NV.strings[t]);
  const lead = t.match(/^([^\p{L}\d(]+)(.+)$/u);
  if (lead && NV.strings[lead[2].trim()]) return s.replace(lead[2].trim(), NV.strings[lead[2].trim()]);
  for (const [re, key] of PATTERNS) { const m = t.match(re); if (m && NV.strings[key]) return s.replace(t, T(key, { x: m[1] })); }
  return null;
}
function translateTree(el) {
  if (NV.lang === 'en' || !el) return;
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walk.nextNode()) nodes.push(walk.currentNode);
  for (const n of nodes) {
    if (n.parentElement?.closest('script,style,textarea')) continue;
    const t = translateText(n.nodeValue);
    if (t != null) n.nodeValue = t;
  }
  for (const x of [el, ...el.querySelectorAll('[placeholder],[title],[aria-label]')]) {
    for (const a of ['placeholder', 'title', 'aria-label']) {
      const v = x.getAttribute?.(a);
      const t = v && translateText(v);
      if (t != null) x.setAttribute(a, t);
    }
  }
}
function translateTicket(root) {
  const card = root.parentElement || root;
  translateTree(card);
  const watch = new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) {
      if (n.nodeType === 3) { const t = translateText(n.nodeValue); if (t != null) n.nodeValue = t; } else if (n.nodeType === 1) translateTree(n);
    }
  });
  watch.observe(card, { childList: true, subtree: true });
  // Toasts and pop-ups the ticket opens (adding stations, skipping the stop) while it's on screen.
  const pops = new MutationObserver((list) => {
    if (!document.contains(root)) { pops.disconnect(); watch.disconnect(); return; }
    for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && n.matches('.toast, .modal-back')) translateTree(n);
  });
  pops.observe(document.body, { childList: true });
  root.addEventListener('change', (e) => { if (e.target.matches('.p-id')) translateTree(e.target.closest('.prod-row')); });
}
// The rest of the stop page in the tech app (directions, call, on my way, last visits, start).
NV.on('tech.stop.rendered', ({ root }) => {
  if (NV.lang === 'en' || !root) return;
  translateTree(root);
  const btns = $('.bigbtns', root);
  if (btns) new MutationObserver(() => translateTree(btns)).observe(btns, { childList: true, subtree: true });
});

// ---------- the finished visit: its record, and corrections ----------
const SITE_LABEL = { inside: 'Inside', outside: 'Outside', both: 'Inside and outside' };
function lineMix(p) {
  if (p.mix_volume) return `${p.amount ?? ''} ${p.unit || ''} in ${p.mix_volume} ${p.mix_unit || 'gal'}${p.mix_pct != null ? ` (${p.mix_pct}%${p.ai_pct != null ? `, ${p.ai_pct}% a.i.` : ''})` : ''}`;
  return p.ai_pct != null ? `${p.ai_pct}% a.i.` : '';
}
NV.slot('visit.right', ({ v }) => {
  if (v.status !== 'completed' || !v.record) return '';
  const r = v.record;
  const w = weatherLine(r.weather);
  return `<div id="rec-view" style="margin-top:14px"><h3>${esc(T('Application record'))}</h3>
    ${v.products.map((p) => `<div class="rec-line"><b>${esc(p.name)}</b>${p.tank ? ` <span class="pill">${esc(T('Tank {name}', { name: p.tank }))}</span>` : ''}
      <div class="small">${[p.lot ? esc(`${T('Lot #')} ${p.lot}`) : `<span class="muted">${esc(T('No lot #'))}</span>`,
        p.lot_expires ? `<span ${p.expired ? 'style="color:var(--danger)"' : 'class="muted"'}>${p.expired ? '⚠ ' : ''}${esc(T('expires {date}', { date: fmtD(p.lot_expires) }))}</span>` : '',
        esc(lineMix(p)), esc(p.method || ''), esc(p.target || v.target_pests || ''), esc(T(SITE_LABEL[p.site_type] || '') || ''),
        p.size != null ? esc(`${p.size} ${p.size_unit || 'sq ft'}`) : ''].filter(Boolean).join(' · ')}</div></div>`).join('')}
    <p class="small">${esc(T('Applicator'))}: <b>${esc(r.applicator || v.tech_name || '')}</b>${r.applicator_license ? ` · ${esc(T('License {no}', { no: r.applicator_license }))}` : ''}
      ${r.supervisor ? `<br>${esc(T('Supervised by'))}: <b>${esc(r.supervisor)}</b>${r.supervisor_license ? ` · ${esc(T('License {no}', { no: r.supervisor_license }))}` : ''}` : ''}
      ${w ? `<br>${esc(T('Weather'))}: ${esc(w)}` : ''}</p>
    ${r.can_correct ? `<button class="btn sm" id="rec-correct">✏️ ${esc(T('Correct the record'))}</button>` : ''}</div>`;
});
function correctModal(v) {
  const r = v.record;
  const R = RECS();
  const opt = (list, cur, blank = '') => `${blank !== null ? `<option value="">${esc(blank)}</option>` : ''}${list.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(cur ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}`;
  const tanks = Object.entries(r.tanks || {});
  const m = modal(T('Correct the record'), `
    <p class="small muted">${esc(T('Every change is saved to the history with your name and the reason.'))}</p>
    ${v.products.map((p) => `<div class="rec-box" data-line="${p.id}"><b>${esc(p.name)}</b>
      <div class="rec-grid" style="margin-top:6px">
        <div class="field"><label>${esc(T('Lot #'))}</label><input name="lot" maxlength="40" value="${esc(p.lot || '')}"></div>
        <div class="field"><label>${esc(T('Lot expires'))}</label><input name="lot_expires" type="date" value="${esc(p.lot_expires || '')}"></div>
        <div class="field"><label>${esc(T('Amount used'))}</label><input name="amount" type="number" min="0" step="0.01" value="${esc(p.amount ?? '')}"></div>
        <div class="field"><label>${esc(T('Unit'))}</label><input name="unit" maxlength="20" value="${esc(p.unit || '')}"></div>
        <div class="field wide"><label>${esc(T('Where applied'))}</label><input name="area" maxlength="200" value="${esc(p.area || '')}"></div>
        <div class="field"><label>${esc(T('Method'))}</label><select name="method">${opt([...new Set([...R.methods, ...(p.method ? [p.method] : [])])].map((x) => [x, x]), p.method, '')}</select></div>
        <div class="field"><label>${esc(T('Inside or outside'))}</label><select name="site_type">${opt(SITES.map(([k, l]) => [k, l]), p.site_type, '')}</select></div>
        <div class="field"><label>${esc(T('Target pest'))}</label><input name="target" maxlength="120" value="${esc(p.target || '')}"></div>
        <div class="field"><label>${esc(T('Size treated'))}</label><div class="rec-pair"><input name="size" type="number" min="0" value="${esc(p.size ?? '')}"><select name="size_unit">${opt([['sq ft', 'sq ft'], ['linear ft', 'linear ft']], p.size_unit || 'sq ft', null)}</select></div></div>
        <div class="field"><label>${esc(T('Mixed in'))}</label><select name="tank">${opt(tanks.map(([k]) => [k, `Tank ${k}`]), p.tank, T('Own mix'))}</select></div>
        <div class="field"><label>${esc(T('Finished mix'))}</label><div class="rec-pair"><input name="mix_volume" type="number" min="0" step="0.01" value="${esc(p.tank ? '' : p.mix_volume ?? '')}"><select name="mix_unit">${opt(MIX.TANK_UNITS.map((u) => [u, u]), p.mix_unit || 'gal', null)}</select></div></div>
      </div></div>`).join('')}
    ${tanks.length ? `<div class="rec-box"><b>${esc(T('Tank mixes'))}</b>${tanks.map(([k, t]) => `<div class="rec-tank" data-tank="${k}" style="grid-template-columns:70px 1fr 90px"><b>Tank ${k}</b><input name="volume" type="number" min="0" step="0.1" value="${esc(t.volume)}"><select name="unit">${opt(MIX.TANK_UNITS.map((u) => [u, u]), t.unit, null)}</select></div>`).join('')}</div>` : ''}
    <div class="rec-box"><b>${esc(T('Weather'))}</b><div class="rec-w" data-weather>
      <input name="temp_f" type="number" placeholder="°F" value="${esc(r.weather?.temp_f ?? '')}"><input name="wind_mph" type="number" placeholder="${esc(T('Wind mph'))}" value="${esc(r.weather?.wind_mph ?? '')}">
      <select name="wind_dir">${opt(R.wind_dirs.map((d) => [d, d]), r.weather?.wind_dir, T('Wind from'))}</select></div></div>
    <div class="row" style="margin-top:10px"><div class="field"><label>${esc(T('Applied by'))}</label><select name="applicator_id">${opt(R.people.map((u) => [u.id, u.name]), r.applicator_id, '')}</select></div>
      <div class="field"><label>${esc(T('Supervised by'))}</label><select name="supervisor_id">${opt(R.people.filter((u) => u.certified || u.id === r.supervisor_id).map((u) => [u.id, u.name]), r.supervisor_id, T('Nobody'))}</select></div></div>
    <div class="field"><label>${esc(T('Why are you correcting it?'))}</label><input name="reason" maxlength="300" placeholder="${esc(T('Typo in the lot number, wrong amount...'))}"></div>`,
  [{ label: T('Cancel') }, { label: T('Save correction'), cls: 'primary', onClick: async (el) => {
    const reason = $('[name=reason]', el).value.trim();
    if (reason.length < 3) throw new Error(T('Say why you are correcting the record'));
    const body = { reason, lines: [] };
    for (const box of $$('[data-line]', el)) {
      const p = v.products.find((x) => x.id === Number(box.dataset.line));
      const f = formData(box);
      const was = { lot: p.lot || '', lot_expires: p.lot_expires || '', amount: String(p.amount ?? ''), unit: p.unit || '', area: p.area || '', method: p.method || '', site_type: p.site_type || '',
        target: p.target || '', size: String(p.size ?? ''), size_unit: p.size != null ? p.size_unit || 'sq ft' : f.size_unit, tank: p.tank || '', mix_volume: p.tank ? '' : String(p.mix_volume ?? ''), mix_unit: p.mix_unit || 'gal' };
      const changed = Object.fromEntries(Object.entries(f).filter(([k, x]) => String(x) !== String(was[k] ?? '')));
      if ('lot' in changed && !('lot_expires' in changed)) changed.lot_expires = f.lot_expires;
      if (Object.keys(changed).length) body.lines.push({ id: p.id, ...changed });
    }
    const tankBoxes = $$('[data-tank]', el);
    if (tankBoxes.some((t) => { const was = r.tanks[t.dataset.tank]; return String(was.volume) !== $('[name=volume]', t).value || was.unit !== $('[name=unit]', t).value; })) {
      body.tanks = Object.fromEntries(tankBoxes.map((t) => [t.dataset.tank, { volume: $('[name=volume]', t).value, unit: $('[name=unit]', t).value }]));
    }
    const w = formData($('[data-weather]', el));
    if (String(r.weather?.temp_f ?? '') !== w.temp_f || String(r.weather?.wind_mph ?? '') !== w.wind_mph || (r.weather?.wind_dir || '') !== w.wind_dir) body.weather = w;
    const ap = $('[name=applicator_id]', el).value, sp = $('[name=supervisor_id]', el).value;
    if (ap && Number(ap) !== r.applicator_id) body.applicator_id = Number(ap);
    if (String(sp) !== String(r.supervisor_id ?? '')) body.supervisor_id = sp ? Number(sp) : null;
    if (!body.lines.length && !body.tanks && !body.weather && !('applicator_id' in body) && !('supervisor_id' in body)) throw new Error(T('Nothing changed yet'));
    await api(`/nuvolve/app/api/records/visits/${v.id}/correct`, { body });
    toast(T('Record corrected'));
    route();
  } }]);
  return m;
}

// ---------- edit history ----------
const ENTITY = { customer: 'Customer', property: 'Address', plan: 'Plan', visit: 'Visit', product_line: 'Product used', invoice: 'Invoice', payment: 'Payment', product: 'Product', setting: 'Setting' };
const VIA = { office: 'office', tech: 'tech app', sales: 'sales app', api: 'API', webhook: 'webhook', portal: 'customer portal', booking: 'online booking', customer: 'customer link', system: 'automatic' };
const humanize = (s) => { const x = String(s || '').replace(/_/g, ' '); return x.charAt(0).toUpperCase() + x.slice(1); };
const blank = (s) => (s === '' || s == null ? `<i class="muted">${esc(T('blank'))}</i>` : esc(s));
// One save writes several rows (a record added, then filled in); show it the way it ended up.
function mergeGroup(rows) {
  const out = [], seen = new Map();
  for (const r of [...rows].reverse()) {
    const key = r.kind === 'change' ? `${r.entity}:${r.entity_id}` : null;
    const prev = key && seen.get(key);
    if (prev && r.action === 'changed' && ['added', 'changed'].includes(prev.action)) {
      for (const f of r.fields) {
        const x = prev.fields.find((y) => y.field === f.field);
        if (prev.action === 'added') { if (x) x.value = f.after; else if (f.after !== '') prev.fields.push({ field: f.field, label: f.label, value: f.after }); } else if (x) x.after = f.after; else prev.fields.push({ ...f });
      }
      continue;
    }
    const copy = { ...r, fields: r.fields.map((f) => ({ ...f })) };
    if (key) seen.set(key, copy);
    out.push(copy);
  }
  return out;
}
function entryHtml(r) {
  if (r.kind !== 'change') return `<li><b>${esc(humanize(r.action))}</b>${r.entity ? ` ${esc((ENTITY[r.entity] || humanize(r.entity)).toLowerCase())}` : ''}${r.detail ? `: ${esc(r.detail)}` : ''}</li>`;
  const what = `<b>${esc(ENTITY[r.entity] || humanize(r.entity))}${r.name ? ` ${esc(r.name)}` : ''}</b>`;
  if (r.action === 'changed') {
    return `<li>${what}: ${r.fields.map((f) => `${esc(f.label)} <s>${blank(f.before)}</s> → <b>${blank(f.after)}</b>`).join('; ')}</li>`;
  }
  const facts = [...r.fields.map((f) => `${esc(f.label)}: ${esc(f.value)}`), ...r.lines.map((l) => esc(l))];
  const word = r.action === 'added' ? T('added') : T('removed');
  return `<li>${what} ${esc(word)}${facts.length ? (facts.length <= 4 ? `: ${facts.join('; ')}` : `<details><summary>${esc(T('{n} details', { n: facts.length }))}</summary>${facts.join('<br>')}</details>`) : ''}</li>`;
}
function historyHtml(rows) {
  const groups = [];
  for (const r of rows) {
    const g = groups[groups.length - 1];
    if (g && r.batch && g.batch === r.batch) g.rows.push(r); else groups.push({ batch: r.batch, rows: [r] });
  }
  return groups.map((g) => {
    const head = g.rows[0];
    return `<div class="hi"><div><b>${esc(head.who || T('Someone'))}</b> <span class="small muted">${esc(T(VIA[head.via] || head.via || ''))} · ${esc(stamp(head.at))}</span></div>
      <ul>${mergeGroup(g.rows).map(entryHtml).join('')}</ul></div>`;
  }).join('');
}
function historyCard(id) {
  return `<div class="card rec-hist" id="${id}"><div class="card-head"><h2>${esc(T('History'))}</h2><span class="small muted">${esc(T('Who changed what, and when'))}</span></div>
    <div class="rec-hist-body"><p class="small muted">${esc(T('Loading...'))}</p></div></div>`;
}
async function loadHistory(card, query) {
  if (!card) return;
  const body = $('.rec-hist-body', card);
  let rows = [];
  const more = async (before) => {
    try {
      const d = await api(`/nuvolve/app/api/audit/history?${query}${before ? `&before=${before}` : ''}`);
      rows = [...rows, ...d.rows];
      body.innerHTML = rows.length ? `${historyHtml(rows)}${d.next ? `<button class="btn sm" data-more="${d.next}" style="margin-top:8px">${esc(T('Show older'))}</button>` : ''}` : `<p class="small muted">${esc(T('No changes recorded yet.'))}</p>`;
      const b = $('[data-more]', body);
      if (b) b.onclick = () => more(Number(b.dataset.more));
    } catch (e) {
      if (e.status === 403) card.remove(); else body.innerHTML = `<p class="small" style="color:var(--danger)">${esc(e.message)}</p>`;
    }
  };
  await more();
}
NV.slot('visit.left', () => historyCard('rec-visit-history'));
NV.slot('customer.right', () => historyCard('rec-customer-history'));
NV.on('visit.rendered', ({ v, view }) => {
  if ($('#rec-correct', view)) $('#rec-correct', view).onclick = () => correctModal(v);
  loadHistory($('#rec-visit-history', view), `visit_id=${v.id}`);
});
NV.on('customer.rendered', ({ c, view }) => loadHistory($('#rec-customer-history', view), `customer_id=${c.id}`));

// ---------- the whole activity log (Settings), with search, CSV and the tamper check ----------
NV.override('settings.activity', ({ box }) => {
  box.innerHTML = `<div class="card"><div class="card-head"><div><h2>${esc(T('Activity log'))}</h2>
      <div class="small muted">${esc(T('Every change with the values before and after, and who made it: the office, the tech app, the API, imports and automatic jobs.'))}</div></div>
      <div class="actions"><a class="btn sm" id="al-csv" href="/nuvolve/app/api/audit/export.csv">${esc(T('Download CSV'))}</a><button class="btn sm" id="al-verify">🔒 ${esc(T('Check for tampering'))}</button></div></div>
    <div id="al-check"></div>
    <div class="row" id="al-f">
      <div class="field"><label>${esc(T('Search'))}</label><input name="q" placeholder="${esc(T('Name, field, value...'))}"></div>
      <div class="field"><label>${esc(T('Who'))}</label><select name="who"><option value="">${esc(T('Anyone'))}</option></select></div>
      <div class="field"><label>${esc(T('Record'))}</label><select name="entity"><option value="">${esc(T('Any record'))}</option>${Object.entries(ENTITY).map(([k, l]) => `<option value="${k}">${esc(T(l))}</option>`).join('')}</select></div>
      <div class="field"><label>${esc(T('Show'))}</label><select name="kind"><option value="">${esc(T('Everything'))}</option><option value="edits">${esc(T('Field changes'))}</option><option value="events">${esc(T('Actions'))}</option></select></div>
      <div class="field"><label>${esc(T('From'))}</label><input name="from" type="date"></div>
      <div class="field"><label>${esc(T('To'))}</label><input name="to" type="date"></div>
    </div><div id="al-list"><p class="muted">${esc(T('Loading...'))}</p></div></div>`;
  const f = $('#al-f', box);
  let rows = [], filled = false;
  const query = () => new URLSearchParams(Object.entries(formData(f)).filter(([, x]) => x !== '')).toString();
  const drawCheck = (c) => {
    if (!c) { $('#al-check', box).innerHTML = ''; return; }
    $('#al-check', box).innerHTML = c.ok
      ? `<div class="alert ok small">✓ ${esc(T('{n} entries checked {when}. None were changed or removed.', { n: c.checked, when: stamp(c.at.replace('T', ' ').slice(0, 19)) }))}</div>`
      : `<div class="alert err small"><div><b>${esc(T('{n} problems found in the log.', { n: c.break_count }))}</b>${(c.breaks || (c.first ? [c.first] : [])).slice(0, 10).map((b) => `<div>#${esc(b.id)} · ${esc(b.at ? stamp(b.at) : '')} · ${esc(b.problem)}</div>`).join('')}
          <div class="small">${esc(T('Someone changed the database outside the app. Keep a copy of the CSV and a backup from before that date.'))}</div></div></div>`;
  };
  const load = async (before) => {
    const d = await api(`/nuvolve/app/api/audit/search?${query()}${before ? `&before=${before}` : ''}`);
    rows = before ? [...rows, ...d.rows] : d.rows;
    if (d.facets && !filled) {
      filled = true;
      $('[name=who]', f).insertAdjacentHTML('beforeend', d.facets.who.map((w) => `<option>${esc(w)}</option>`).join(''));
      drawCheck(d.facets.last_check);
    }
    $('#al-csv', box).href = `/nuvolve/app/api/audit/export.csv?${query()}`;
    $('#al-list', box).innerHTML = rows.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>#</th><th>${esc(T('When'))}</th><th>${esc(T('Who'))}</th><th>${esc(T('What'))}</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="small muted">${r.id}</td><td class="nowrap small">${esc(stamp(r.at))}</td><td class="small">${esc(r.who)}<div class="muted">${esc(T(VIA[r.via] || r.via || ''))}</div></td>
        <td class="small rec-hist"><ul style="padding-left:0;list-style:none;margin:0">${entryHtml(r)}</ul>${r.customer_id ? `<a href="#/customers/${r.customer_id}">${esc(T('Customer #{id}', { id: r.customer_id }))}</a>` : ''}${r.visit_id ? ` · <a href="#/visits/${r.visit_id}">${esc(T('Visit #{id}', { id: r.visit_id }))}</a>` : ''}</td></tr>`).join('')}
      </tbody></table></div>${d.next ? `<button class="btn sm" id="al-more" style="margin-top:8px">${esc(T('Show older'))}</button>` : ''}` : `<p class="muted">${esc(T('Nothing matches.'))}</p>`;
    if ($('#al-more', box)) $('#al-more', box).onclick = () => load(d.next).catch((e) => toast(e.message, true));
  };
  let t;
  f.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => load().catch((e) => toast(e.message, true)), 300); });
  f.addEventListener('change', () => { clearTimeout(t); load().catch((e) => toast(e.message, true)); });
  $('#al-verify', box).onclick = async (e) => {
    e.target.disabled = true;
    try { drawCheck(await api('/nuvolve/app/api/audit/verify')); } catch (err) { toast(err.message, true); } finally { e.target.disabled = false; }
  };
  return load().catch((e) => { $('#al-list', box).innerHTML = `<div class="alert err">${esc(e.message)}</div>`; });
});

// ---------- settings: rules, applicators and branches ----------
NV.settingsTab({ key: 'records', label: 'Pesticide records', render: async (box) => {
  const d = await api('/nuvolve/app/api/records/setup');
  const s = d.settings;
  const typeName = { certified: 'Certified applicator', technician: 'Technician (works under a certified applicator)', apprentice: 'Apprentice' };
  box.innerHTML = `<form class="card" id="rec-rules" style="max-width:820px"><h2>Pesticide records</h2>
      <p class="small muted">Restricted-use products always need the certified applicator, the lot number, the amount, where it went, the target pest, and the wind when applied outside. These add more.</p>
      <label class="check"><input type="checkbox" name="records_require_lot" ${s.records_require_lot === '1' ? 'checked' : ''}> Every product needs a lot number</label>
      <label class="check"><input type="checkbox" name="records_require_wind" ${s.records_require_wind === '1' ? 'checked' : ''}> Wind is required for every outdoor application</label>
      <div class="row" style="margin-top:12px"><div class="field"><label>County you work in</label><input name="records_county" value="${esc(s.records_county)}" placeholder="Orange">
          <div class="hint">For the California monthly report. Branches and addresses can have their own.</div></div>
        <div class="field"><label>Operator ID or permit number</label><input name="records_operator_id" value="${esc(s.records_operator_id)}"><div class="hint">California prints it on the monthly report.</div></div></div>
      <button class="btn primary">Save</button></form>
    <div class="card" style="max-width:980px"><div class="card-head"><div><h2>Applicators</h2><div class="small muted">License numbers come from <a href="#/settings?tab=licenses">Licenses &amp; training</a>. Someone not marked counts as certified while they hold a current license.</div></div></div>
      <div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>License #</th><th>Status</th><th>Type</th><th>Works under</th></tr></thead><tbody>
      ${d.people.map((u) => `<tr data-person="${u.id}"><td><b>${esc(u.name)}</b><div class="small muted">${esc(u.role)}</div></td><td>${esc(u.license_no || '')}</td>
        <td class="small">${u.certified ? '<span class="pill green">Can apply restricted use</span>' : `<span class="pill ${u.problem ? 'red' : ''}">${esc(u.problem || 'Needs a certified supervisor')}</span>`}</td>
        <td><select name="applicator_type"><option value="">Not set</option>${d.types.map((t) => `<option value="${t}" ${t === u.applicator_type ? 'selected' : ''}>${esc(typeName[t])}</option>`).join('')}</select></td>
        <td><select name="supervisor_id"><option value="">Nobody</option>${d.people.filter((x) => x.id !== u.id && x.certified).map((x) => `<option value="${x.id}" ${x.id === u.supervisor_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div></div>
    <div class="card" style="max-width:820px"><h2>Branches</h2><div class="small muted" style="margin-bottom:8px">The county and permit printed on each branch's state reports.</div>
      <div class="table-wrap"><table class="list"><thead><tr><th>Branch</th><th>County</th><th>Operator ID or permit</th></tr></thead><tbody>
      ${d.locations.map((l) => `<tr data-loc="${l.id}"><td><b>${esc(l.name)}</b>${l.license_no ? `<div class="small muted">License ${esc(l.license_no)}</div>` : ''}</td>
        <td><input name="county" value="${esc(l.county || '')}"></td><td><input name="operator_id" value="${esc(l.operator_id || '')}"></td></tr>`).join('')}</tbody></table></div></div>`;
  $('#rec-rules', box).onsubmit = async (e) => {
    e.preventDefault();
    const b = formData(e.target);
    try {
      await api('/nuvolve/app/api/settings', { method: 'PUT', body: { ...b, records_require_lot: b.records_require_lot ? '1' : '0', records_require_wind: b.records_require_wind ? '1' : '0' } });
      await refreshBoot(); toast('Saved');
    } catch (err) { toast(err.message, true); }
  };
  $$('[data-person] select', box).forEach((sel) => (sel.onchange = async () => {
    const tr = sel.closest('tr');
    try { await api(`/nuvolve/app/api/records/people/${tr.dataset.person}`, { method: 'PUT', body: { [sel.name]: sel.value || null } }); toast('Saved'); } catch (err) { toast(err.message, true); }
  }));
  $$('[data-loc] input', box).forEach((inp) => (inp.onchange = async () => {
    try { await api(`/nuvolve/app/api/records/locations/${inp.closest('tr').dataset.loc}`, { method: 'PUT', body: { [inp.name]: inp.value } }); toast('Saved'); } catch (err) { toast(err.message, true); }
  }));
} });

// ---------- product mixing fields, lots on received stock, the county on an address ----------
NV.slot('product.form', ({ p }) => `<h3 style="margin-top:14px">Mixing</h3>
  <label class="check"><input type="checkbox" name="rtu" ${p.rtu ? 'checked' : ''}> Ready to use (techs apply it as it comes)</label>
  <div class="row"><div class="field"><label>Active ingredient %</label><input name="ai_percent" type="number" step="0.001" min="0" max="100" value="${esc(p.ai_percent ?? '')}" placeholder="${esc(MIX?.parseAi(p.active_ingredient) ?? '')}">
      <div class="hint">Blank uses the first % in the ingredient line.</div></div>
    <div class="field"><label>Label rate, low to high</label><div class="rec-mix"><input name="rate_low" type="number" step="0.01" min="0" value="${esc(p.rate_low ?? '')}"><input name="rate_high" type="number" step="0.01" min="0" value="${esc(p.rate_high ?? '')}"></div></div>
    <div class="field"><label>Rate unit</label><select name="rate_unit"><option value=""></option>${(MIX?.RATE_UNITS || []).map((u) => `<option ${u === p.rate_unit ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
    <div class="field"><label>Per</label><select name="rate_per"><option value=""></option>${[['gal', 'gallon of mix'], ['qt', 'quart of mix'], ['L', 'liter of mix'], ['1000 sq ft', '1,000 sq ft']].map(([k, l]) => `<option value="${k}" ${k === p.rate_per ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
  <div class="row"><div class="field"><label>Label mix, % active ingredient (low to high)</label><div class="rec-mix"><input name="pct_low" type="number" step="0.001" min="0" max="100" value="${esc(p.pct_low ?? '')}"><input name="pct_high" type="number" step="0.001" min="0" max="100" value="${esc(p.pct_high ?? '')}"></div>
    <div class="hint">The ticket's mix calculator starts from these, and warns a tech whose mix is off the label.</div></div></div>`);
NV.slot('stock.receive', () => `<div class="row"><div class="field"><label>Lot # (from the container)</label><input name="lot" maxlength="40"></div>
  <div class="field"><label>Lot expires</label><input name="lot_expires" type="date"></div></div>`);
NV.slot('property.form', ({ p }) => `<div class="field"><label>County</label><input name="county" maxlength="60" value="${esc(p.county || '')}" placeholder="For state pesticide reports"></div>`);

// ---------- state exports ----------
const STATES = [['tx', 'Texas (TDA)'], ['fl', 'Florida (FDACS)'], ['ca', 'California (DPR monthly report)'], ['all', 'Every field (any state)']];
NV.nav({ href: '#/records', icon: '🏛️', label: 'State records', after: '#/reports' });
NV.page('records', async (view, _id, params) => {
  const st = B().settings?.state;
  const state = STATES.some((s) => s[0] === params.state) ? params.state : ({ TX: 'tx', FL: 'fl', CA: 'ca' }[String(st || '').toUpperCase()] || 'all');
  const lastMonth = addDays(todayStr().slice(0, 8) + '01', -1).slice(0, 7);
  const p = { state, from: params.from || todayStr().slice(0, 8) + '01', to: params.to || todayStr(), month: params.month || lastMonth,
    location_id: params.location_id || '', applicator_id: params.applicator_id || '', county: params.county || '' };
  const q = new URLSearchParams(Object.entries(p).filter(([, x]) => x !== '')).toString();
  const d = await api(`/nuvolve/app/api/records/export?${q}`);
  const branches = B().me?.location_id ? [] : B().locations || [];
  const c = d.checks;
  const pill = (n, label, bad) => `<span class="pill ${n && bad ? 'red' : n ? 'green' : ''}">${n} ${esc(label)}</span>`;
  view.innerHTML = `<div class="page-head"><div><h1>State pesticide records</h1><div class="muted">${esc(d.format.title)}</div></div>
      <div class="actions"><a class="btn" href="/nuvolve/app/api/records/export?${q}&format=print" target="_blank" rel="noopener">🖨️ Print</a><a class="btn primary" href="/nuvolve/app/api/records/export?${q}&format=csv">Download CSV</a></div></div>
    <div class="card"><div class="row" id="rx-f">
      <div class="field"><label>Format</label><select name="state">${STATES.map(([k, l]) => `<option value="${k}" ${k === state ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      ${state === 'ca' ? `<div class="field"><label>Month</label><input type="month" name="month" value="${esc(p.month)}"></div>
        <div class="field"><label>County</label><input name="county" value="${esc(p.county)}" placeholder="Every county"></div>`
        : `<div class="field"><label>From</label><input type="date" name="from" value="${esc(p.from)}"></div><div class="field"><label>To</label><input type="date" name="to" value="${esc(p.to)}"></div>`}
      ${branches.length > 1 ? `<div class="field"><label>Branch</label><select name="location_id"><option value="">Every branch</option>${branches.map((l) => `<option value="${l.id}" ${String(l.id) === p.location_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>` : ''}
      <div class="field"><label>Applicator</label><select name="applicator_id"><option value="">Everyone</option>${RECS().people.map((u) => `<option value="${u.id}" ${String(u.id) === p.applicator_id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>
    </div>
    <div class="rec-checks">${pill(c.applications, 'applications')}${pill(c.restricted, 'restricted use')}${pill(c.missing_lot, 'restricted without a lot', true)}${pill(c.expired_lot, 'expired lots', true)}${pill(c.missing_license, 'without a license number', true)}${pill(c.missing_wind, 'outdoor restricted without wind', true)}</div>
    ${state === 'ca' ? d.reports.map((r) => `<h3>${esc(r.county || 'County not set')}${r.county_no ? ` (${esc(r.county_no)})` : ''} · ${r.negative ? 'No pesticides used (negative report)' : `${r.total} applications`}</h3>
        ${r.lines.length ? `<div class="table-wrap"><table class="list small"><thead><tr>${d.format.columns.map((x) => `<th>${esc(x[0])}</th>`).join('')}</tr></thead><tbody>${r.lines.map((x) => `<tr>${d.format.columns.map((col) => `<td>${esc(x[col[1]])}</td>`).join('')}</tr>${x.warning ? `<tr><td colspan="${d.format.columns.length}" class="small" style="color:var(--warn)">⚠ ${esc(x.warning)}</td></tr>` : ''}`).join('')}</tbody></table></div>` : ''}`).join('')
      : d.rows.length ? `<div class="table-wrap"><table class="list small"><thead><tr>${d.columns.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${d.rows.slice(0, 200).map((r) => `<tr>${r.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        ${d.count > 200 ? `<p class="small muted">Showing 200 of ${d.count}. The CSV and the printout have them all.</p>` : ''}` : '<p class="muted">No applications in this period.</p>'}
    <p class="small muted">${esc(d.format.cite)} This layout follows the state rule as we read it; check the current rule with your state before you rely on it.</p></div>`;
  const f = $('#rx-f', view);
  f.addEventListener('change', () => {
    const next = { ...p, ...formData(f) };
    location.hash = `#/records?${new URLSearchParams(Object.entries(next).filter(([, x]) => x !== '')).toString()}`;
  });
});
// The reports page points to the state formats.
NV.on('page', ({ name, view }) => {
  if (name !== 'reports') return;
  const actions = $('.card .actions', view);
  if (actions && !$('#rec-state-link', actions)) actions.insertAdjacentHTML('afterbegin', '<a class="btn sm" id="rec-state-link" href="#/records">🏛️ State formats (TX, FL, CA)</a>');
});

})(); } catch (e) { console.error('feature records.js failed to load', e); }

/* ---- features/secops-onboard.js ---- */
try { (function () {
// First-run setup for a new owner, at #/welcome: company and work days, services and prices, techs, connections,
// the first customers, then the first route. It opens by itself after sign-up until it is finished or put away,
// and the step reached is kept on the server (src/features/secops-onboard.js), so it picks up on any computer.
// Every step saves through the normal APIs, so anything set here can be changed later in Settings.
let me = null;
let progress = null; // { step, done, total } while setup is still to do
NV.on('boot', ({ boot }) => {
  me = boot?.me || null;
  progress = me?.onboarding || null;
  // Only the office app, and only when it was opened without a page in mind.
  if (progress && location.pathname === '/' && (location.hash === '' || location.hash === '#')) history.replaceState(null, '', '#/welcome');
});

NV.slot('today.alerts', () => (progress ? `<div class="alert info"><span>🚀 <b>Finish setting up:</b> ${Number(progress.done)} of ${Number(progress.total)} steps done. About ten minutes to your first route.</span>
  <a class="btn sm primary" href="#/welcome">Continue setup</a></div>` : ''));

const STEPS = [
  ['company', 'Your company', 'Name, shop and the days you work'],
  ['services', 'Services and prices', 'What you sell and what it costs'],
  ['team', 'Your techs', 'Who runs routes'],
  ['connect', 'Email, texts, payments', 'Connect now or skip'],
  ['customers', 'Your customers', 'Bring them over or add one'],
  ['route', 'Your first route', 'See the day it planned'],
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ZONES = ['', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];
const zoneName = (z) => (z ? z.replace('America/', '').replace('Pacific/', '').replace('_', ' ') : 'Server time');
const freqOptions = (cur) => Object.entries(FREQ).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('');

function addStyles() {
  if (document.getElementById('ob-css')) return;
  const css = document.createElement('style');
  css.id = 'ob-css';
  css.textContent = `
    .ob { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 16px; align-items: start; }
    .ob-steps { list-style: none; margin: 0; padding: 0; }
    .ob-steps button { display: flex; gap: 10px; align-items: flex-start; width: 100%; text-align: left; background: none; border: 0; padding: 10px; border-radius: 10px; font: inherit; color: inherit; cursor: pointer; }
    .ob-steps li.on button { background: var(--panel); box-shadow: var(--shadow); }
    .ob-steps .tick { width: 24px; height: 24px; border-radius: 50%; border: 2px solid #cbd5e0; display: grid; place-items: center; font-size: 12px; font-weight: 700; flex-shrink: 0; }
    .ob-steps li.done .tick { background: var(--brand); border-color: var(--brand); color: #fff; }
    .ob-steps .sub { display: block; font-size: 12px; color: var(--muted); }
    .ob-days { display: flex; flex-wrap: wrap; gap: 6px; }
    .ob-days label { display: flex; gap: 6px; align-items: center; border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; cursor: pointer; font-weight: 500; }
    .ob-days input { width: auto; }
    .ob-foot { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); }
    .ob-route li { padding: 6px 0; }
    .ob-choice { border: 1px solid var(--line); border-radius: 10px; padding: 14px; }
    @media (max-width: 860px) {
      .ob { grid-template-columns: minmax(0, 1fr); }
      .ob-steps { display: flex; gap: 4px; overflow-x: auto; }
      .ob-steps li { flex: 0 0 auto; }
      .ob-steps button { padding: 8px; }
      .ob-steps b, .ob-steps .sub { display: none; }
      .ob-steps li.on b { display: inline; }
    }`;
  document.head.appendChild(css);
}

NV.page('welcome', async (view) => {
  addStyles();
  let d = await api('/nuvolve/app/api/onboarding');
  const draw = async () => {
    const st = d.state;
    const cur = STEPS.some(([k]) => k === st.step) ? st.step : 'company';
    const i = STEPS.findIndex(([k]) => k === cur);
    const doneN = STEPS.filter(([k]) => st.done?.[k]).length;
    view.innerHTML = `
      <div class="page-head"><div><h1>Let's get your first route ready</h1>
        <div class="muted">${doneN} of ${STEPS.length} done · about ten minutes. Everything here can be changed later in Settings.</div></div>
        <div class="actions"><a class="btn" href="#/">Finish later</a><button class="btn" id="ob-hide">Don't show this again</button></div></div>
      <div class="ob">
        <ol class="ob-steps">${STEPS.map(([k, title, sub], n) => `<li class="${st.done?.[k] ? 'done' : ''} ${k === cur ? 'on' : ''}">
          <button type="button" data-step="${k}"><span class="tick">${st.done?.[k] ? '✓' : n + 1}</span><span><b>${title}</b><span class="sub">${sub}</span></span></button></li>`).join('')}</ol>
        <form class="card" id="ob-body" novalidate><p class="muted">Loading...</p></form>
      </div>`;
    const box = $('#ob-body', view);
    // On a phone the steps are one row that scrolls sideways: keep this one in sight.
    if (window.innerWidth <= 860) { const on = $('.ob-steps li.on', view); if (on) on.parentNode.scrollLeft = on.offsetLeft - 16; }
    const move = async (step, doneKey, extra = {}) => {
      d = { ...d, ...(await api('/nuvolve/app/api/onboarding', { method: 'PUT', body: { step, ...(doneKey ? { done: { [doneKey]: true } } : {}), ...extra } })) };
      progress = d.active ? { step: d.state.step, done: STEPS.filter(([k]) => d.state.done?.[k]).length, total: STEPS.length } : null;
      return d;
    };
    $$('[data-step]', view).forEach((b) => (b.onclick = async () => { await move(b.dataset.step); draw(); }));
    $('#ob-hide', view).onclick = async () => {
      await move(cur, null, { dismissed: true });
      toast('Setup put away. Open it again from Settings → Connections.');
      location.hash = '#/';
    };
    let save = null;
    try { save = await RENDER[cur](box, d, () => draw()); } catch (e) { box.innerHTML = `<div class="alert err"><span>${esc(e.message)}</span></div>`; }
    const last = i === STEPS.length - 1;
    box.insertAdjacentHTML('beforeend', `<div class="actions ob-foot">
      <button class="btn primary" id="ob-next">${last ? 'Finish setup' : 'Save and continue'}</button>
      ${last ? '' : '<button type="button" class="btn" id="ob-skip">Skip for now</button>'}
      ${i > 0 ? '<button type="button" class="btn" id="ob-back">Back</button>' : ''}</div>`);
    box.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('#ob-next', box);
      btn.disabled = true;
      try {
        if (save) await save();
        if (last) {
          await move(cur, cur, { finished: true });
          toast("You're set up. Welcome to Nuvolve!");
          if (typeof refreshBoot === 'function') await refreshBoot();
          location.hash = '#/';
          return;
        }
        await move(STEPS[i + 1][0], cur);
        draw();
      } catch (err) { toast(err.message, true); btn.disabled = false; }
    };
    if ($('#ob-skip', box)) $('#ob-skip', box).onclick = async () => { await move(STEPS[i + 1][0]); draw(); };
    if ($('#ob-back', box)) $('#ob-back', box).onclick = async () => { await move(STEPS[i - 1][0]); draw(); };
  };
  await draw();
});

// Each step draws its form into box and returns what "Save and continue" does (or null).
const RENDER = {
  async company(box) {
    const s = (await api('/nuvolve/app/api/settings')).settings;
    const work = String(s.work_days || '1,2,3,4,5').split(',');
    const zone = s.timezone || (ZONES.includes(Intl.DateTimeFormat().resolvedOptions().timeZone) ? Intl.DateTimeFormat().resolvedOptions().timeZone : '');
    box.innerHTML = `<h2>Your company</h2>
      <div class="field"><label>Company name</label><input name="company_name" value="${esc(s.company_name || '')}" autocomplete="organization"></div>
      <div class="row"><div class="field"><label>Phone</label><input name="company_phone" inputmode="tel" value="${esc(s.company_phone || '')}" placeholder="(555) 555-0100"></div>
        <div class="field"><label>Email customers can reply to</label><input name="company_email" type="email" value="${esc(s.company_email || '')}" placeholder="office@yourcompany.com"></div></div>
      <div class="field"><label>Shop or home base address</label><input name="shop_address" value="${esc(s.shop_address || '')}" placeholder="123 Main St, Dallas, TX 75201">
        <div class="hint">Routes start and end here.${s.shop_lat ? ' 📍 Found on the map.' : ''}</div></div>
      <div class="field"><label>Time zone</label><select name="timezone">${[...new Set([...ZONES, zone])].map((z) => `<option value="${z}" ${z === zone ? 'selected' : ''}>${zoneName(z)}</option>`).join('')}</select></div>
      <div class="field"><label>Days you run routes</label><div class="ob-days">${DAYS.map((n, i) => `<label><input type="checkbox" data-day="${i}" ${work.includes(String(i)) ? 'checked' : ''}> ${n}</label>`).join('')}</div>
        <div class="hint">Visits from service plans land on these days.</div></div>`;
    const addr = $('[name=shop_address]', box);
    addressAutocomplete(addr, (a) => { addr.value = a.label || a.address || addr.value; });
    return async () => {
      const f = formData(box);
      const days = $$('[data-day]', box).filter((x) => x.checked).map((x) => x.dataset.day);
      if (!f.company_name) throw new Error('Add your company name');
      if (!days.length) throw new Error('Pick at least one day you run routes');
      await api('/nuvolve/app/api/settings', { method: 'PUT', body: { ...f, work_days: days.join(',') } });
    };
  },

  async services(box, _d, redraw) {
    const types = (await api('/nuvolve/app/api/settings')).serviceTypes;
    box.innerHTML = `<h2>Services and prices</h2>
      <p class="muted">You start with the usual services. Set your prices, turn off what you don't sell and add what's missing. You can still change the price for one customer.</p>
      <div class="table-wrap"><table class="list"><thead><tr><th>Service</th><th>Price</th><th>How often</th><th>Offer it</th></tr></thead><tbody>
      ${types.map((t) => `<tr data-st="${Number(t.id)}"><td><b>${esc(t.name)}</b>${t.category ? `<div class="small muted">${esc(t.category)}</div>` : ''}</td>
        <td><input name="price" type="number" min="0" step="1" inputmode="decimal" value="${esc(t.default_price ?? '')}" style="max-width:110px" aria-label="Price for ${esc(t.name)}"></td>
        <td><select name="freq" aria-label="How often for ${esc(t.name)}">${freqOptions(t.default_frequency)}</select></td>
        <td><input type="checkbox" name="active" ${t.active ? 'checked' : ''} aria-label="Offer ${esc(t.name)}"></td></tr>`).join('')}</tbody></table></div>
      <h3 style="margin-top:16px">Add a service</h3>
      <div class="row" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) auto">
        <input id="ob-st-name" placeholder="Mosquito treatment"><input id="ob-st-price" type="number" min="0" inputmode="decimal" placeholder="Price">
        <select id="ob-st-freq">${freqOptions('monthly')}</select><button type="button" class="btn" id="ob-st-add">+ Add</button></div>`;
    const saveRows = async () => {
      for (const tr of $$('[data-st]', box)) {
        const t = types.find((x) => x.id === Number(tr.dataset.st));
        const price = $('[name=price]', tr).value;
        const body = {};
        if (price !== '' && Number(price) !== Number(t.default_price)) body.default_price = price;
        if ($('[name=freq]', tr).value !== t.default_frequency) body.default_frequency = $('[name=freq]', tr).value;
        if ($('[name=active]', tr).checked !== Boolean(t.active)) body.active = $('[name=active]', tr).checked;
        if (Object.keys(body).length) await api(`/nuvolve/app/api/service-types/${t.id}`, { method: 'PUT', body });
      }
    };
    const addOne = async () => {
      const name = $('#ob-st-name', box).value.trim();
      if (!name) return false;
      await api('/nuvolve/app/api/service-types', { body: { name, default_price: $('#ob-st-price', box).value || 0, default_frequency: $('#ob-st-freq', box).value } });
      return true;
    };
    $('#ob-st-add', box).onclick = async () => {
      try { await saveRows(); if (await addOne()) { toast('Service added'); redraw(); } else toast('Type the service name first', true); } catch (e) { toast(e.message, true); }
    };
    return async () => {
      await saveRows();
      await addOne();
      if (!$$('[data-st] [name=active]', box).some((x) => x.checked) && !$('#ob-st-name', box).value.trim()) throw new Error('Offer at least one service');
    };
  },

  async team(box, _d, redraw) {
    const s = await api('/nuvolve/app/api/settings');
    const mine = s.users.find((u) => u.id === me?.id);
    const techs = s.users.filter((u) => u.active && u.role === 'tech');
    box.innerHTML = `<h2>Your techs</h2>
      <label class="check"><input type="checkbox" id="ob-me-runs" ${mine?.runs_routes ? 'checked' : ''}> I run a route myself</label>
      <div class="hint">Leave this on if you're out on routes too. Your stops show in the tech app at <b>${esc(location.origin)}/tech</b>.</div>
      ${techs.length ? `<div class="table-wrap" style="margin-top:12px"><table class="list"><tbody>${techs.map((u) => `<tr>
        <td><span class="dot" style="background:${esc(u.color)}"></span><b>${esc(u.name)}</b><div class="small muted">${esc(u.email || 'No email yet, so no app login')}</div></td>
        <td class="right">${u.email ? `<button type="button" class="btn sm" data-invite="${Number(u.id)}">Email a login link</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <h3 style="margin-top:16px">Add a tech</h3>
      <div class="row"><div class="field"><label>Name</label><input id="ob-t-name" autocomplete="off"></div>
        <div class="field"><label>Mobile</label><input id="ob-t-phone" inputmode="tel" autocomplete="off"></div></div>
      <div class="field"><label>Email (their login)</label><input id="ob-t-email" type="email" autocomplete="off">
        <div class="hint">They get an email to pick their own password. No email? They still show on the schedule, and you can add one later.</div></div>
      <button type="button" class="btn" id="ob-t-add">+ Add tech</button>`;
    const invite = async (id) => {
      const r = await api('/nuvolve/app/api/onboarding/invite', { body: { user_id: id } });
      toast(r.status === 'sent' ? `Login link sent to ${r.to}` : r.status === 'logged' ? `Email isn't connected yet, so the link can't reach ${r.to}. Set their password in Settings → Team and give it to them.` : `The email didn't go: ${r.status}`, r.status === 'failed');
    };
    const addTech = async () => {
      const name = $('#ob-t-name', box).value.trim();
      if (!name) return false;
      const email = $('#ob-t-email', box).value.trim();
      const r = await api('/nuvolve/app/api/users', { body: { name, phone: $('#ob-t-phone', box).value.trim(), email, role: 'tech', runs_routes: true } });
      if (email) await invite(r.id);
      else toast(`${name} added`);
      return true;
    };
    const saveMe = async () => {
      if (mine && $('#ob-me-runs', box).checked !== Boolean(mine.runs_routes)) await api(`/nuvolve/app/api/users/${mine.id}`, { method: 'PUT', body: { runs_routes: $('#ob-me-runs', box).checked } });
    };
    $('#ob-t-add', box).onclick = async () => {
      try { await saveMe(); if (await addTech()) redraw(); else toast("Type the tech's name first", true); } catch (e) { toast(e.message, true); }
    };
    $$('[data-invite]', box).forEach((b) => (b.onclick = async () => { b.disabled = true; try { await invite(Number(b.dataset.invite)); } catch (e) { toast(e.message, true); } b.disabled = false; }));
    return async () => {
      await saveMe();
      await addTech();
      if (typeof refreshBoot === 'function') await refreshBoot(); // the schedule's list of techs
    };
  },

  async connect(box) {
    const [c, s] = await Promise.all([api('/nuvolve/app/api/connections'), api('/nuvolve/app/api/settings').then((x) => x.settings)]);
    const status = (live, on = 'Connected', off = 'Demo mode') => `<span class="pill ${live ? 'green' : 'yellow'}">${live ? on : off}</span>`;
    box.innerHTML = `<h2>Email, texts and payments</h2>
      <p class="muted">Skip any of these: in demo mode emails and texts are saved in the Outbox instead of sent, and payments are recorded without charging a card.</p>
      <div class="ob-choice"><div class="card-head"><h3 style="margin:0">Email</h3>${status(c.email.live)}</div>
        <p class="small">${c.email.live ? `Service summaries, reminders and pay links go out from ${esc(c.email.from || 'the server')}.` : 'Emails to customers wait in the Outbox until the server has an email account.'}</p>
        <button type="button" class="btn sm" id="ob-test-email" ${c.me.email ? '' : 'disabled'}>Send me a test email</button></div>
      <div class="ob-choice" style="margin-top:10px"><div class="card-head"><h3 style="margin:0">Texting</h3>${status(c.texting.live)}</div>
        <label class="check"><input type="checkbox" id="ob-sms" ${c.texting.on ? 'checked' : ''}> Text customers too (reminders, on-my-way, receipts)</label>
        ${c.texting.live ? '' : '<p class="small muted">Texts wait in the Outbox until the server has a texting number.</p>'}</div>
      <div class="ob-choice" style="margin-top:10px"><div class="card-head"><h3 style="margin:0">Card payments</h3>${c.payments.mode === 'live' ? status(true, 'Live') : c.payments.mode === 'test' ? '<span class="pill blue">Test mode</span>' : status(false)}</div>
        <div class="field"><label>Your Stripe secret key</label><input id="ob-stripe" autocomplete="off" spellcheck="false" placeholder="${s.stripe_key_set ? 'Saved. Paste a new one to replace it' : 'sk_live_...'}">
          <div class="hint">From your Stripe dashboard → Developers → API keys. It's kept on the server and never shown again.</div></div></div>
      <div class="ob-choice" style="margin-top:10px"><h3 style="margin:0 0 6px">Google reviews</h3>
        <div class="field"><label>Your Google review link</label><input id="ob-review" value="${esc(s.google_review_url || '')}" placeholder="https://g.page/r/.../review">
          <div class="hint">Customers who rate a visit 5 stars are asked to leave a review here.</div></div></div>`;
    $('#ob-test-email', box).onclick = async (e) => {
      e.target.disabled = true;
      try { const r = await api('/nuvolve/app/api/connections/test-email', { body: {} }); toast(r.status === 'sent' ? `Sent to ${r.to}` : `Saved in the Outbox (demo mode), to ${r.to}`); } catch (err) { toast(err.message, true); }
      e.target.disabled = false;
    };
    return async () => {
      const body = { sms_enabled: $('#ob-sms', box).checked ? '1' : '0' };
      const key = $('#ob-stripe', box).value.trim();
      if (key) body.stripe_secret_key = key;
      const review = $('#ob-review', box).value.trim();
      if (review && !/^https:\/\//.test(review)) throw new Error('The review link should start with https://');
      if (review !== (s.google_review_url || '')) body.google_review_url = review;
      await api('/nuvolve/app/api/settings', { method: 'PUT', body });
    };
  },

  async customers(box, d) {
    const [types, techs] = await Promise.all([api('/nuvolve/app/api/settings').then((x) => x.serviceTypes.filter((t) => t.active)), api('/nuvolve/app/api/bootstrap').then((b) => b.techs || [])]);
    const def = types.find((t) => t.is_default) || types[0];
    const f = d.facts;
    box.innerHTML = `<h2>Your customers</h2>
      ${f.customers ? `<div class="alert ok"><span>✓ You have <b>${Number(f.customers)} customer${f.customers === 1 ? '' : 's'}</b>, ${Number(f.plans)} on a service plan.</span></div>` : ''}
      <div class="grid cols-2">
        <div class="ob-choice"><h3 style="margin-top:0">Bring them all over</h3>
          <p class="small">From your old software or a spreadsheet: customers, addresses, plans, history and balances. You check everything before it goes in.</p>
          <a class="btn" href="#/switch">Import customers</a></div>
        <div class="ob-choice"><h3 style="margin-top:0">Or add one now</h3>
          <div class="row"><div class="field"><label>First name</label><input id="ob-c-first" autocomplete="off"></div><div class="field"><label>Last name</label><input id="ob-c-last" autocomplete="off"></div></div>
          <div class="row"><div class="field"><label>Mobile</label><input id="ob-c-phone" inputmode="tel" autocomplete="off"></div><div class="field"><label>Email</label><input id="ob-c-email" type="email" autocomplete="off"></div></div>
          <div class="field" id="ob-c-place"><label>Service address</label><input id="ob-c-addr" autocomplete="off" placeholder="12 Elm St"><input type="hidden" name="city"><input type="hidden" name="state"><input type="hidden" name="zip"></div>
          ${types.length ? `<div class="row"><div class="field"><label>Service</label><select id="ob-c-type">${types.map((t) => `<option value="${Number(t.id)}" ${t === def ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
            <div class="field"><label>Price</label><input id="ob-c-price" type="number" min="0" inputmode="decimal" value="${esc(def?.default_price ?? '')}"></div></div>
          <div class="row"><div class="field"><label>How often</label><select id="ob-c-freq">${freqOptions(def?.default_frequency || 'quarterly')}</select></div>
            <div class="field"><label>First visit</label><input id="ob-c-date" type="date" value="${todayStr()}"></div></div>
          ${techs.length > 1 ? `<div class="field"><label>Tech</label><select id="ob-c-tech">${techs.map((t) => `<option value="${Number(t.id)}">${esc(t.name)}</option>`).join('')}</select></div>` : ''}` : ''}
        </div>
      </div>`;
    const place = $('#ob-c-place', box);
    addressAutocomplete($('#ob-c-addr', box), (a) => { fillAddress(place, a); });
    if ($('#ob-c-type', box)) $('#ob-c-type', box).onchange = (e) => {
      const t = types.find((x) => x.id === Number(e.target.value));
      if (t) { $('#ob-c-price', box).value = t.default_price ?? ''; $('#ob-c-freq', box).value = t.default_frequency || 'quarterly'; }
    };
    return async () => {
      const v = (id) => ($(id, box)?.value || '').trim();
      if (!v('#ob-c-first') && !v('#ob-c-last')) {
        if (!f.customers) throw new Error('Add a customer, import them, or skip this step for now');
        return;
      }
      if (!v('#ob-c-addr')) throw new Error('Add their service address');
      const loc = formData(place);
      const body = { first_name: v('#ob-c-first'), last_name: v('#ob-c-last'), phone: v('#ob-c-phone'), email: v('#ob-c-email'),
        property: { address: v('#ob-c-addr'), city: loc.city, state: loc.state, zip: loc.zip, ...(loc.lat ? { lat: loc.lat, lng: loc.lng } : {}) } };
      if ($('#ob-c-type', box)) {
        body.plan = { service_type_id: v('#ob-c-type'), price: v('#ob-c-price') || 0, frequency: v('#ob-c-freq'), start_date: v('#ob-c-date') || todayStr(),
          tech_id: $('#ob-c-tech', box) ? v('#ob-c-tech') : techs[0]?.id };
      }
      await api('/nuvolve/app/api/customers', { body });
      toast(`${body.first_name || body.last_name} added`);
    };
  },

  async route(box, d) {
    const fr = d.facts.firstRoute;
    if (!fr) {
      box.innerHTML = `<h2>Your first route</h2><div class="empty"><div class="big">🗺️</div><h3>No visits scheduled yet</h3>
        <p>Put a customer on a service plan and their visits land on your route days by themselves.</p><button type="button" class="btn" id="ob-to-cust">Add a customer</button></div>`;
      $('#ob-to-cust', box).onclick = () => $$('[data-step="customers"]')[0]?.click();
      return null;
    }
    const r = await api(`/nuvolve/app/api/routes?date=${encodeURIComponent(fr.date)}&tech_id=${fr.tech_id ?? ''}`);
    const name = (s) => s.company || [s.first_name, s.last_name].filter(Boolean).join(' ') || 'Customer';
    box.innerHTML = `<h2>Your first route</h2>
      <p><b>${esc(fmtDate(fr.date, { weekday: 'long', month: 'long', day: 'numeric' }))}</b>: ${Number(fr.stops)} stop${fr.stops === 1 ? '' : 's'}${r.summary?.miles ? `, about ${Number(r.summary.miles)} miles` : ''}${r.plan?.finish_text ? `, done around ${esc(r.plan.finish_text)}` : ''}.</p>
      <ol class="ob-route">${r.stops.slice(0, 12).map((s) => `<li><b>${esc(name(s))}</b> · ${esc(s.address || '')}${s.city ? `, ${esc(s.city)}` : ''} <span class="small muted">${esc(s.service_name || '')}</span></li>`).join('')}</ol>
      ${r.stops.length > 12 ? `<p class="small muted">and ${r.stops.length - 12} more</p>` : ''}
      <div class="actions"><a class="btn" href="#/routes?date=${encodeURIComponent(fr.date)}&tech=${fr.tech_id ?? ''}">Open it on the map</a></div>
      <div class="alert info" style="margin-top:14px"><span>📱 Techs run the day from their phone at <b>${esc(location.origin)}/tech</b>. Adding it to the home screen makes it work like an app, even without signal.</span></div>`;
    return null;
  },
};

})(); } catch (e) { console.error('feature secops-onboard.js failed to load', e); }

/* ---- features/secops.js ---- */
try { (function () {
// Login security in the browser: where you're logged in (My account), a nudge to replace an easy password (office
// Today page, My account, the tech app), who is locked out (Settings → Team), sign-out times (Settings → Company →
// Login security) and Settings → Connections (which outside services are live, with test buttons). See
// src/features/secops.js and secops-host.js for the server side.
let me = null;
NV.on('boot', ({ boot }) => { me = boot?.me || null; });

// SQLite times are UTC without a zone.
const whenMs = (s) => (s ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${String(s).replace(' ', 'T')}Z`) : 0);
function ago(s) {
  const t = whenMs(s);
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 2) return 'Just now';
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'Yesterday' : `${d} days ago`;
}
const APP = { office: 'Office app', tech: 'Tech app', sell: 'Sales app', portal: 'Customer page' };

// ---------- My account: where you're logged in ----------
NV.slot('account.cards', () => '<div class="card" id="sec-sessions"><h2>Where you\'re logged in</h2><p class="muted small">Loading...</p></div>');

NV.on('account.rendered', ({ view, sec }) => {
  if (sec?.passwordWeak && $('#pw h2', view)) {
    $('#pw h2', view).insertAdjacentHTML('afterend', '<div class="alert warn" id="sec-weak"><span>🔑 <b>Your password is easy to guess.</b> Pick a new one: at least 10 characters, and not a common word or your name. A few words together work well.</span></div>');
    // The core form clears itself when the change works.
    $('#pw', view).addEventListener('reset', () => { $('#sec-weak', view)?.remove(); if (me) me.passwordNudge = false; });
  }
  drawSessions($('#sec-sessions', view));
});

async function drawSessions(box) {
  if (!box) return;
  let rows;
  try { rows = await api('/nuvolve/app/api/me/sessions'); } catch (e) { box.innerHTML = `<h2>Where you're logged in</h2><div class="alert err"><span>${esc(e.message)}</span></div>`; return; }
  const others = rows.filter((r) => !r.current).length;
  box.innerHTML = `<div class="card-head"><h2>Where you're logged in</h2>${others ? `<button class="btn sm" id="sec-end-others">Log out ${others === 1 ? 'the other device' : `the other ${others}`}</button>` : ''}</div>
    <p class="small muted">Phones stay logged in longer than office computers. Don't recognize one? Log it out, then change your password.</p>
    <div class="table-wrap"><table class="list"><tbody>${rows.map((r) => `<tr>
      <td>${r.kind === 'phone' ? '📱' : '💻'} <b>${esc(r.device)}</b>${r.current ? ' <span class="pill green">This device</span>' : ''}
        <div class="small muted">${esc(APP[r.app] || APP.office)}${r.place ? ` · ${esc(r.place)}` : ''}${r.ip ? ` · ${esc(r.ip)}` : ''}</div></td>
      <td class="small nowrap">${r.current ? 'Now' : esc(ago(r.last_seen))}<div class="muted">since ${esc(fmtDate(r.created_at))}</div></td>
      <td class="right"><button class="btn sm" data-sec-end="${Number(r.id)}">Log out</button></td></tr>`).join('')}</tbody></table></div>
    <div class="actions" style="margin-top:10px"><button class="btn sm danger" id="sec-end-all">Log out everywhere</button></div>`;
  const done = (r) => { if (r.loggedOut) location.href = '/nuvolve/app/'; else drawSessions(box); };
  $$('[data-sec-end]', box).forEach((b) => (b.onclick = async () => {
    try { done(await api(`/nuvolve/app/api/me/sessions/${b.dataset.secEnd}/end`, { method: 'POST' })); toast('Logged out'); } catch (e) { toast(e.message, true); }
  }));
  if ($('#sec-end-others', box)) $('#sec-end-others', box).onclick = async () => {
    try { const r = await api('/nuvolve/app/api/me/sessions/end-all', { body: { keep_this: true } }); toast(`Logged out of ${r.ended} other device${r.ended === 1 ? '' : 's'}`); done(r); } catch (e) { toast(e.message, true); }
  };
  $('#sec-end-all', box).onclick = () => modal('Log out everywhere?', '<p>Every phone and computer logged in as you is logged out, this one too. You log back in with your password.</p>', [
    { label: 'Cancel' }, { label: 'Log out everywhere', cls: 'danger', onClick: async () => done(await api('/nuvolve/app/api/me/sessions/end-all', { body: {} })) }]);
}

// ---------- an easy password: office Today page ----------
NV.slot('today.alerts', () => (me?.passwordNudge ? `<div class="alert warn" id="sec-nudge"><span>🔑 <b>Your password is easy to guess.</b> Pick a new one to keep your account safe.</span>
  <a class="btn sm" href="#/account">Change password</a></div>` : ''));
// Changed since the app opened: drop the reminder.
NV.on('page', ({ name, view }) => {
  if (name !== '' || !me?.passwordNudge || !$('#sec-nudge', view)) return;
  api('/nuvolve/app/api/me/security').then((s) => { if (!s.passwordWeak) { me.passwordNudge = false; $('#sec-nudge', view)?.remove(); } }).catch(() => {});
});

// ---------- an easy password: tech app ----------
const later = () => { try { return sessionStorage.getItem('nv_pw_later') === '1'; } catch { return false; } };
NV.slot('tech.top', () => (me?.passwordNudge && !later() ? `<div class="alert warn" id="sec-nudge"><span>🔑 ${esc(NV.t('Your password is easy to guess. Pick a new one to keep your account safe.'))}</span>
  <span><button class="btn sm primary" id="sec-pw">${esc(NV.t('Change password'))}</button> <button class="btn sm" id="sec-later">${esc(NV.t('Later'))}</button></span></div>` : ''));
NV.on('tech.route.rendered', ({ root }) => {
  const box = $('#sec-nudge', root || document);
  if (!box || !$('#sec-pw', box)) return;
  $('#sec-later', box).onclick = () => { try { sessionStorage.setItem('nv_pw_later', '1'); } catch { /* private mode */ } box.remove(); };
  $('#sec-pw', box).onclick = () => modal(NV.t('Change password'), `
    <div class="field"><label>${esc(NV.t('Current password'))}</label><input name="current" type="password" autocomplete="current-password"></div>
    <div class="field"><label>${esc(NV.t('New password'))}</label><input name="password" type="password" minlength="10" autocomplete="new-password">
      <div class="hint">${esc(NV.t('At least 10 characters. A few words together are easy to remember and hard to guess.'))}</div></div>`, [
    { label: NV.t('Later') },
    { label: NV.t('Change password'), cls: 'primary', onClick: async (el) => {
      await api('/nuvolve/app/api/me/password', { body: formData(el) });
      me.passwordNudge = false;
      box.remove();
      toast(NV.t('Password changed. Your other devices were signed out.'));
    } }]);
});

// ---------- customer pay page: no way to take a card yet ----------
NV.on('portal.rendered', ({ data, root }) => {
  if (data?.payOnline !== false) return;
  // With no card saved there's nothing to switch on, and no way to save one yet.
  if (!data.customer?.card) $$('.card', root).filter((el) => $('h2', el)?.textContent.trim() === 'Autopay' && !$('#autopay', el)).forEach((el) => el.remove());
  const pay = $('#pay', root);
  if (!pay) return;
  const box = pay.closest('.card');
  $$('.tips, #tip-custom, #save', box).forEach((el) => (el.closest('div[style], label') || el).remove());
  const phone = data.company?.phone;
  // In the customer's language, in the same words as the Payment method card (billing.js), with the number to tap.
  const call = phone ? `<a href="tel:${esc(String(phone).replace(/[^\d+]/g, ''))}" style="white-space:nowrap"><b>${esc(phone)}</b></a>` : '';
  pay.outerHTML = `<p style="margin-top:12px">${phone ? esc(NV.t('To pay, call or text the office at {phone}.')).replace('{phone}', call) : esc(NV.t('To pay, call or text the office.'))}</p>`;
  $$('.small.muted', box).filter((el) => /Secure card payment/.test(el.textContent)).forEach((el) => el.remove());
});

// ---------- Settings → Team ----------
NV.slot('team.badges', ({ u }) => (u?.locked_minutes > 0 ? ' <span class="pill red" title="Too many wrong passwords">Locked</span>' : ''));
NV.slot('team.member', ({ u }) => {
  if (!u?.id || !u.email) return '';
  const canEnd = u.devices > 0 && u.id !== me?.id && (u.role !== 'owner' || me?.role === 'owner');
  return `<div class="card" id="sec-member" style="margin:12px 0 0;padding:10px 12px;box-shadow:none">
    <div class="small"><b>Login</b> · ${u.devices ? `Logged in on ${Number(u.devices)} device${u.devices === 1 ? '' : 's'}${u.last_seen ? `, last used ${esc(ago(u.last_seen).toLowerCase())}` : ''}` : 'Not logged in anywhere right now'}</div>
    ${u.locked_minutes > 0 ? `<div class="alert warn" style="margin:8px 0 0"><span>Locked for ${Number(u.locked_minutes)} more minute${u.locked_minutes === 1 ? '' : 's'} after too many wrong passwords. They got an email with a reset link.</span>
      <button type="button" class="btn sm" id="sec-unlock">Unlock</button></div>` : ''}
    ${canEnd ? '<button type="button" class="btn sm" id="sec-end-user" style="margin-top:8px">Log out of every device</button>' : ''}
  </div>`;
});
NV.on('team.member.rendered', ({ u, el }) => {
  const unlock = $('#sec-unlock', el);
  if (unlock) unlock.onclick = async () => {
    try { await api(`/nuvolve/app/api/users/${u.id}/unlock`, { method: 'POST' }); unlock.closest('.alert').remove(); toast(`${u.name} can log in again`); } catch (e) { toast(e.message, true); }
  };
  const end = $('#sec-end-user', el);
  if (end) end.onclick = async () => {
    if (!confirm(`Log ${u.name} out of every phone and computer? They log back in with their password.`)) return;
    try { const r = await api(`/nuvolve/app/api/users/${u.id}/sessions/end`, { method: 'POST' }); end.remove(); toast(`Logged out of ${r.ended} device${r.ended === 1 ? '' : 's'}`); } catch (e) { toast(e.message, true); }
  };
});

// ---------- Settings → Company → Login security: sign-out times ----------
const hours = (n) => (n < 24 ? `${n} hour${n === 1 ? '' : 's'}` : n === 168 ? '1 week' : `${n / 24} day${n === 24 ? '' : 's'}`);
const days = (n) => `${n} day${n === 1 ? '' : 's'}`;
const TIMES = [
  ['session_idle_office', 'Office computers: log out after', 'without use', [1, 2, 4, 8, 12, 24, 72, 168], hours, 12],
  ['session_max_office', '…and always after', 'even in use', [1, 7, 14, 30, 60, 90], days, 30],
  ['session_idle_phone', 'Phones (tech and sales apps): log out after', 'without use', [1, 7, 14, 30, 60, 90], days, 30],
  ['session_max_phone', '…and always after', 'even in use', [30, 60, 90, 180], days, 90],
];
NV.slot('settings.security', ({ s }) => {
  const pick = ([key, label, hint, list, fmt, def]) => {
    const cur = Number(s?.[key]) || def;
    const opts = list.includes(cur) ? list : [...list, cur].sort((a, b) => a - b);
    return `<div class="field"><label>${label}</label><select name="${key}">${opts.map((n) => `<option value="${n}" ${n === cur ? 'selected' : ''}>${fmt(n)}</option>`).join('')}</select><div class="hint">${hint}</div></div>`;
  };
  return `<h3 style="margin:16px 0 4px">When people are logged out</h3>
    <p class="small muted" style="margin-top:0">Techs keep their phones, so they stay logged in longer. Office computers are often shared.</p>
    <div class="row">${pick(TIMES[0])}${pick(TIMES[1])}</div><div class="row">${pick(TIMES[2])}${pick(TIMES[3])}</div>`;
});

// ---------- Settings → Connections ----------
const pill = (on, onText = 'Live', offText = 'Demo mode') => `<span class="pill ${on ? 'green' : 'yellow'}">${on ? onText : offText}</span>`;
const forHost = (text) => `<p class="small muted">For whoever runs your server: ${text} See HOSTING.md.</p>`;
NV.settingsTab({
  key: 'connections',
  label: 'Connections',
  async render(box, d) {
    box.innerHTML = '<p class="muted">Loading...</p>';
    let c;
    try { c = await api('/nuvolve/app/api/connections'); } catch (e) { box.innerHTML = `<div class="alert err"><span>${esc(e.message)}</span></div>`; return; }
    const s = d?.settings || {};
    const b = c.backups;
    box.innerHTML = `
      <p class="muted" style="max-width:760px">What Nuvolve is connected to. Anything in demo mode still works: emails and texts are saved in the Outbox (Messages) instead of sent, and card payments are recorded without charging anyone. Keys are never shown here.</p>
      ${!c.address.url ? '<div class="alert warn"><span>The server has no web address set (BASE_URL), so links in emails and texts use the address you opened this page with.</span></div>'
        : !c.address.https ? `<div class="alert err"><span><b>${esc(c.address.url)}</b> isn't on HTTPS. Logins and card payments need a secure (https) address.</span></div>` : ''}
      <div class="grid cols-2">
        <div class="card"><div class="card-head"><h2>Email</h2>${pill(c.email.live)}</div>
          ${c.email.live ? `<p>Emails to customers and your team go out from <b>${esc(c.email.from || 'the server\'s address')}</b>. Replies go to ${c.email.replyTo ? `<b>${esc(c.email.replyTo)}</b>` : 'nobody yet: add your company email under <a href="#/settings?tab=company">Company</a>'}.</p>`
            : `<p>Emails are saved in the Outbox, not sent.</p>${forHost('set RESEND_API_KEY and EMAIL_FROM (an address on your own domain).')}`}
          <button class="btn sm" id="sec-test-email" ${c.me.email ? '' : 'disabled'}>Send me a test email</button> <span class="small muted">${esc(c.me.email || 'Add an email to your login first')}</span>
        </div>
        <div class="card"><div class="card-head"><h2>Texting</h2>${pill(c.texting.live)}</div>
          ${c.texting.live ? `<p>Texts come from <b>${esc(c.texting.from)}</b>.</p>` : `<p>Texts are saved in the Outbox, not sent.</p>${forHost('set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM. Business texting in the US also needs a 10DLC registration, which takes a few days.')}`}
          <label class="check"><input type="checkbox" id="sec-sms-on" ${c.texting.on ? 'checked' : ''}> Text customers (reminders, on-my-way, receipts)</label>
          <div class="field" style="margin:10px 0 6px"><label for="sec-test-phone">Your mobile number, for a test</label><input id="sec-test-phone" inputmode="tel" placeholder="(555) 555-0100" value="${esc(c.me.phone || '')}"></div>
          <button class="btn sm" id="sec-test-text">Send me a test text</button>
        </div>
        <div class="card"><div class="card-head"><h2>Card payments</h2>${c.payments.mode === 'live' ? pill(true) : c.payments.mode === 'test' ? '<span class="pill blue">Test mode</span>' : pill(false)}</div>
          <p>${c.payments.mode === 'live' ? 'Customers pay by card and cards on file are charged for real.'
            : c.payments.mode === 'test' ? 'Stripe test mode: use test cards like 4242 4242 4242 4242. Nobody is charged.'
              : 'Payments are recorded, but no card is charged. Add your Stripe secret key to take real cards.'}</p>
          <a class="btn sm" href="#/settings?tab=payments">Payments settings</a>
        </div>
        <div class="card"><div class="card-head"><h2>Google</h2>${pill(c.google.live, 'Live', 'Not set up')}</div>
          <p>${c.google.live ? 'Address lookup, maps and house photos use Google.' : 'Addresses are looked up with a free map service, without house photos.'}
          ${c.google.reviewLink ? ' Happy customers get your Google review link.' : ' Add your Google review link under <a href="#/settings?tab=followup">Follow-up</a> so happy customers can review you.'}</p>
          ${c.google.live ? '' : forHost('set GOOGLE_MAPS_API_KEY.')}
        </div>
        <div class="card"><div class="card-head"><h2>Drive times</h2>${pill(c.driveTimes.live, 'Live', 'Estimated')}</div>
          <p>${c.driveTimes.live ? 'Routes use real drive times.' : 'Routes use straight-line distance, which is close enough for most days.'}</p>
          ${c.driveTimes.live ? '' : forHost('set MAPBOX_TOKEN for real drive times.')}
        </div>
        <div class="card"><div class="card-head"><h2>AI helpers</h2>${pill(c.ai.live, 'Live', 'Off')}</div>
          <p>${c.ai.live ? 'Ask Nuvolve, the answering assistant and message drafts are on.' : 'Ask Nuvolve, the answering assistant and message drafts use simple built-in answers.'}</p>
          ${c.ai.live ? '' : forHost('set ANTHROPIC_API_KEY.')}
        </div>
        <div class="card"><div class="card-head"><h2>PDFs</h2>${pill(c.pdf.live, 'Live', 'Print only')}</div>
          <p>${c.pdf.live ? 'Service reports, invoices and agreements download as PDFs.' : 'Reports open as pages you can print or save as PDF from the browser.'}</p>
          ${c.pdf.live ? '' : forHost('install Chrome or Chromium on the server, or set CHROME_PATH.')}
        </div>
        <div class="card"><div class="card-head"><h2>Backups</h2>${b.last ? (b.ageHours > 36 ? '<span class="pill red">Behind</span>' : pill(true, 'Daily')) : '<span class="pill yellow">None yet</span>'}</div>
          <p>${b.last ? `Last backup ${esc(fmtDate(b.last))}${b.ageHours != null ? ` (${b.ageHours < 1 ? 'under an hour' : `${Number(b.ageHours)} hour${b.ageHours === 1 ? '' : 's'}`} ago)` : ''}. ${Number(b.kept)} day${b.kept === 1 ? '' : 's'} kept, up to ${Number(b.keepDays)}.`
            : 'The server makes a backup of everything once a day. The first one runs a few minutes after it starts.'}</p>
          ${forHost('keep the backups folder on a separate disk or copy it off the server, and run npm run restore:drill now and then to prove a backup opens.')}
        </div>
      </div>
      <p class="small"><a href="#/welcome">Open the setup guide</a></p>`;
    const test = (btn, path, body) => async () => {
      btn.disabled = true;
      try {
        const r = await api(path, { body: body ? body() : {} });
        toast(r.status === 'sent' ? `Sent to ${r.to}` : r.status === 'logged' ? `Saved in the Outbox (demo mode), to ${r.to}` : `Didn't go: ${r.error || r.status}`, r.status === 'failed' || r.status === 'blocked');
      } catch (e) { toast(e.message, true); } finally { btn.disabled = false; }
    };
    $('#sec-test-email', box).onclick = test($('#sec-test-email', box), '/nuvolve/app/api/connections/test-email');
    $('#sec-test-text', box).onclick = test($('#sec-test-text', box), '/nuvolve/app/api/connections/test-text', () => ({ phone: $('#sec-test-phone', box).value }));
    $('#sec-sms-on', box).onchange = async (e) => {
      try { await api('/nuvolve/app/api/settings', { method: 'PUT', body: { sms_enabled: e.target.checked ? '1' : '0' } }); s.sms_enabled = e.target.checked ? '1' : '0'; toast(e.target.checked ? 'Customers get texts' : 'No more texts to customers'); } catch (err) { e.target.checked = !e.target.checked; toast(err.message, true); }
    };
  },
});

})(); } catch (e) { console.error('feature secops.js failed to load', e); }

/* ---- features/selfserve-cancel.js ---- */
try { (function () {
// Cancel reasons and save offers: the office's Stop plan asks why and suggests the offer that fits; customers can
// pause or cancel in their portal when the owner turns it on; Cancels & saves shows what worked.
(function () {
  const t = (text, vars) => NV.t(text, vars);
  const ymd = (d) => parseYmd(d).toLocaleDateString(NV.lang === 'es' ? 'es-US' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const sel = (name, list, cur) => `<select name="${name}">${list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const months = (max, word) => Array.from({ length: max }, (_, i) => [i + 1, word(i + 1)]);

  // The details each offer needs, filled with the company's defaults. portal: the customer's words and choices only.
  function offerFields(key, o, portal) {
    const d = o.defaults;
    if (key === 'discount') {
      if (portal) return `<div class="small muted">${esc(d.visits === 1 ? t('{percent}% off your next visit', d) : t('{percent}% off your next {visits} visits', d))}</div>`;
      return `<div class="row"><div class="field"><label>Percent off</label><input name="percent" type="number" min="1" max="50" value="${d.percent}"></div>
        <div class="field"><label>For the next</label><input name="visits" type="number" min="1" max="12" value="${d.visits}"> <span class="small muted">visits</span></div></div>`;
    }
    if (key === 'less_frequent') return `<div class="field"><label>${esc(portal ? t('How often') : 'How often')}</label>${sel('frequency', o.frequencies.map((f) => [f.value, portal ? t(f.label) : f.label]), d.frequency)}</div>`;
    if (key === 'pause') return `<div class="field"><label>${esc(portal ? t('Pause for') : 'Pause for')}</label>${sel('months', months(o.pauseMax, (n) => (portal ? t(n === 1 ? '{n} month' : '{n} months', { n }) : `${n} month${n === 1 ? '' : 's'}`)), d.months)}</div>`;
    if (key === 'skip_next' && o.plan.next_visit) return `<div class="small muted">${esc(portal ? t('Your next visit is {date}.', { date: ymd(o.plan.next_visit) }) : `Next visit: ${fmtDate(o.plan.next_visit)}`)}</div>`;
    if (key === 'different_tech' && !portal) return `<div class="field"><label>Who takes over</label>${sel('tech_id', o.techs.map((x) => [x.id, x.name]), d.tech_id)}</div>`;
    if (key === 'move_address') {
      return `<div class="field"><label>${esc(portal ? t('New address') : 'New address')}</label><input name="address" autocomplete="street-address"></div>
        <div class="row"><div class="field"><label>${esc(portal ? t('City') : 'City')}</label><input name="city"></div><div class="field"><label>${esc(portal ? t('Zip') : 'Zip')}</label><input name="zip" inputmode="numeric"></div></div>`;
    }
    if (key === 'free_reservice') return `<div class="small muted">${esc(portal ? t('We book it at the soonest open time.') : 'Booked at the soonest open time on the schedule. No charge.')}</div>`;
    return '';
  }
  const paramsOf = (root) => {
    const f = formData(root);
    const p = {};
    for (const k of ['percent', 'visits', 'months', 'tech_id']) if (f[k] !== undefined && f[k] !== '') p[k] = Number(f[k]);
    for (const k of ['frequency', 'address', 'city', 'zip']) if (f[k]) p[k] = f[k];
    return p;
  };
  function offerList(box, reason, o, portal) {
    const r = o.reasons.find((x) => x.code === reason);
    const offers = r ? r.offers : [];
    box.innerHTML = offers.length ? `<div class="small muted" style="margin:10px 0 6px">${esc(portal ? t('Before you go, we can:') : 'Offer one of these first (best fit first):')}</div>
      ${offers.map((k, i) => `<label class="cx-offer" style="display:block;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer">
        <span style="display:flex;gap:8px;align-items:center"><input type="radio" name="cx_offer" value="${k}" ${i === 0 ? 'checked' : ''} style="width:auto"> <b>${esc(portal ? t(o.offers[k]) : o.offers[k])}</b></span>
        <div class="cx-detail" data-for="${k}" style="margin-top:6px" ${i === 0 ? '' : 'hidden'}>${offerFields(k, o, portal)}</div></label>`).join('')}`
      : `<p class="small muted" style="margin-top:10px">${esc(portal ? t('There is nothing we can offer for that, but thank you for telling us.') : 'No save offer fits this reason.')}</p>`;
    box.querySelectorAll('[name=cx_offer]').forEach((x) => (x.onchange = () => box.querySelectorAll('.cx-detail').forEach((dv) => (dv.hidden = dv.dataset.for !== x.value))));
    return offers.length;
  }
  const chosen = (box) => {
    const k = box.querySelector('[name=cx_offer]:checked')?.value || '';
    return { offer: k, params: k ? paramsOf(box.querySelector(`.cx-detail[data-for="${k}"]`)) : {} };
  };

  // ---------- the office: Stop plan ----------
  NV.override('plan.stop', (data, fallback) => {
    const { c, plan, done } = data;
    if (!plan || plan.frequency === 'one_time') return fallback(data);
    api(`/nuvolve/app/api/selfserve/cancel/options?plan_id=${plan.id}`).then((o) => stopModal(c, plan, o, done)).catch(() => fallback(data));
  });

  function stopModal(c, plan, o, done) {
    const m = modal('Stop this service plan?', `<p>Future visits on this plan are removed. Past visits and invoices stay. ${o.plan.yearly ? `It's worth <b>${money(o.plan.yearly)}</b> a year.` : ''}</p>
      <div class="field"><label>Why do they want to stop?</label>${sel('cx_reason', [['', 'Pick one'], ...o.reasons.map((r) => [r.code, r.label])], '')}</div>
      <div class="field" id="cx-comp" hidden><label>Which company are they switching to?</label><input name="competitor" maxlength="120"></div>
      <div class="field"><label>Notes (optional)</label><input name="note" maxlength="1000" placeholder="What they said, in their words"></div>
      <div id="cx-offers"></div>
      <label class="check small" style="margin-top:8px"><input type="checkbox" name="tell_customer" checked> Send the customer a note about the change</label>`, [
      { label: 'Keep it' },
      { label: 'Stop plan', cls: 'danger', onClick: async (el) => {
        const f = formData(el);
        if (!f.cx_reason) { toast('Pick why they want to stop', true); return false; }
        const r = o.reasons.find((x) => x.code === f.cx_reason);
        const offered = r.offers.length ? chosen(el.querySelector('#cx-offers')).offer : null;
        await api(`/nuvolve/app/api/plans/${plan.id}`, { method: 'DELETE', body: { reason: r.label, reason_code: r.code, competitor: f.competitor, note: f.note, offered } });
        toast('Plan stopped');
        done();
      } },
      { label: 'Keep them with this offer', cls: 'primary', onClick: async (el) => {
        const f = formData(el);
        if (!f.cx_reason) { toast('Pick why they want to stop', true); return false; }
        const pick = chosen(el.querySelector('#cx-offers'));
        if (!pick.offer) { toast('No save offer fits this reason. Stop the plan or keep it.', true); return false; }
        const r = await api(`/nuvolve/app/api/selfserve/plans/${plan.id}/save`, { body: { reason: f.cx_reason, competitor: f.competitor, note: f.note, offer: pick.offer, params: pick.params, tell_customer: f.tell_customer } });
        toast(`Saved: ${r.summary}`);
        done();
      } },
    ]);
    const box = m.el.querySelector('#cx-offers');
    const keep = [...m.el.querySelectorAll('.mf .btn')].find((b) => b.classList.contains('primary'));
    m.el.querySelector('[name=cx_reason]').onchange = (e) => {
      m.el.querySelector('#cx-comp').hidden = e.target.value !== 'competitor';
      const n = e.target.value ? offerList(box, e.target.value, o, false) : (box.innerHTML = '', 0);
      if (keep) keep.hidden = !n;
    };
    if (keep) keep.hidden = true;
  }

  // ---------- the office: who asked to cancel in the portal ----------
  NV.slot('today.alerts', ({ d }) => {
    const rows = d?.selfserveCancels || [];
    if (!rows.length) return '';
    return `<div class="alert warn" style="display:block"><b>⚠️ ${rows.length} customer${rows.length === 1 ? '' : 's'} asked to cancel in the portal. Give them a call:</b>
      ${rows.map((r) => `<div style="margin-top:6px"><a href="#/customers/${r.customer_id}">${esc(r.customer_name || 'Customer')}</a>${r.phone ? ` · <a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : ''}
        <span class="small muted">· ${esc(r.reason_label)}${r.note ? ` · "${esc(r.note)}"` : ''} · ${money(r.yearly_value)}/yr · ${esc(fmtDate(r.created_at))}</span></div>`).join('')}
      <div class="small muted" style="margin-top:6px">Open their plan and use Stop plan: picking an offer or stopping it closes the request.</div></div>`;
  });

  // ---------- the customer page: earlier cancels and saves ----------
  NV.slot('customer.right', ({ c }) => `<div id="cx-history" data-customer="${c.id}"></div>`);
  NV.on('customer.rendered', async ({ c, view }) => {
    const box = view.querySelector('#cx-history');
    if (!box) return;
    const rows = await api(`/nuvolve/app/api/selfserve/cancellations?customer_id=${c.id}`).catch(() => []);
    if (!rows.length) return;
    const pill = { saved: '<span class="pill green">Saved</span>', cancelled: '<span class="pill red">Cancelled</span>', requested: '<span class="pill yellow">Asked to cancel</span>' };
    box.innerHTML = `<div class="card"><h2>🛟 Cancels and saves</h2>${rows.map((r) => `<div style="padding:6px 0;border-bottom:1px solid var(--line)">
      ${pill[r.outcome] || ''} <b>${esc(r.reason_label)}</b>${r.competitor ? ` (${esc(r.competitor)})` : ''} <span class="small muted">· ${esc(fmtDate(r.created_at))}${r.channel === 'portal' ? ' · in the portal' : r.user_name ? ` · ${esc(r.user_name)}` : ''}</span>
      ${r.offer_label ? `<div class="small">${r.outcome === 'saved' ? 'Kept with' : 'Turned down'}: ${esc(r.offer_label)}</div>` : ''}${r.note ? `<div class="small muted">${esc(r.note)}</div>` : ''}</div>`).join('')}</div>`;
  });

  // ---------- Cancels & saves report ----------
  NV.nav({ href: '#/saves', icon: '🧲', label: 'Cancels & saves', role: 'manager', after: '#/retention' });
  NV.page('saves', async (view, _id, params) => {
    const q = new URLSearchParams();
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    const r = await api(`/nuvolve/app/api/selfserve/cancellations/report?${q}`);
    const tt = r.totals;
    const rate = (x) => (x == null ? '—' : `${x}%`);
    view.innerHTML = `<div class="page-head"><div><h1>Cancels and saves</h1><div class="muted">Why customers wanted to stop, which offers kept them, and the yearly revenue kept. ${esc(fmtDate(r.from))} to ${esc(fmtDate(r.to))}.</div></div>
      <form class="actions" id="cx-range"><input type="date" name="from" value="${esc(r.from)}"><input type="date" name="to" value="${esc(r.to)}"><button class="btn sm">Show</button></form></div>
      <div class="stats">
        <div class="stat"><div class="label">Save rate</div><div class="value">${rate(tt.saveRate)}</div><div class="sub">${tt.saved} saved, ${tt.cancelled} cancelled${tt.open ? `, ${tt.open} waiting for a call` : ''}</div></div>
        <div class="stat"><div class="label">Revenue saved (yearly)</div><div class="value">${money(tt.revenueSaved)}</div></div>
        <div class="stat danger"><div class="label">Revenue lost (yearly)</div><div class="value">${money(tt.revenueLost)}</div><div class="sub">${r.noOffer} cancelled without an offer</div></div>
      </div>
      <div class="grid cols-2">
        <div class="card flush"><div class="card-head" style="padding:16px 16px 0"><h2>By reason</h2></div><div class="table-wrap"><table class="list"><thead><tr><th>Reason</th><th class="right">Asked</th><th class="right">Saved</th><th class="right">Save rate</th><th class="right">Saved $/yr</th></tr></thead><tbody>
          ${r.byReason.map((x) => `<tr><td>${esc(x.label)}</td><td class="right">${x.attempts}</td><td class="right">${x.saved}</td><td class="right">${rate(x.saveRate)}</td><td class="right">${money(x.revenueSaved)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nothing in this range.</td></tr>'}</tbody></table></div></div>
        <div class="card flush"><div class="card-head" style="padding:16px 16px 0"><h2>By offer</h2></div><div class="table-wrap"><table class="list"><thead><tr><th>Offer</th><th class="right">Offered</th><th class="right">Taken</th><th class="right">Take rate</th><th class="right">Saved $/yr</th></tr></thead><tbody>
          ${r.byOffer.map((x) => `<tr><td>${esc(x.label)}</td><td class="right">${x.offered}</td><td class="right">${x.accepted}</td><td class="right">${rate(x.acceptRate)}</td><td class="right">${money(x.revenueSaved)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No offers made in this range.</td></tr>'}</tbody></table></div></div>
      </div>
      ${r.competitors.length ? `<div class="card"><h2>Where they went</h2>${r.competitors.map((x) => `<span class="pill" style="margin:0 6px 6px 0">${esc(x.name)} · ${x.count}</span>`).join('')}</div>` : ''}
      <div class="card flush"><div class="card-head" style="padding:16px 16px 0"><h2>Latest</h2></div><div class="table-wrap"><table class="list"><thead><tr><th>When</th><th>Customer</th><th>Reason</th><th>Offer</th><th>Outcome</th><th class="right">$/yr</th></tr></thead><tbody>
        ${r.recent.map((x) => `<tr><td class="nowrap small">${esc(fmtDate(x.created_at))}</td><td><a href="#/customers/${x.customer_id}">${esc(x.customer_name || '')}</a><div class="small muted">${esc(x.channel === 'portal' ? 'In the portal' : x.channel === 'earlier' ? 'Before reasons were kept' : x.user_name || '')}</div></td>
          <td>${esc(x.reason_label)}${x.competitor ? ` <span class="small muted">(${esc(x.competitor)})</span>` : ''}${x.note ? `<div class="small muted">${esc(x.note)}</div>` : ''}</td><td class="small">${esc(x.offer_label || '—')}</td>
          <td>${x.outcome === 'saved' ? '<span class="pill green">Saved</span>' : x.outcome === 'requested' ? '<span class="pill yellow">Waiting</span>' : '<span class="pill red">Cancelled</span>'}</td>
          <td class="right">${money(x.outcome === 'saved' ? x.saved_value : x.yearly_value)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nothing in this range.</td></tr>'}</tbody></table></div></div>`;
    view.querySelector('#cx-range').onsubmit = (e) => { e.preventDefault(); const f = formData(e.target); location.hash = `#/saves?from=${encodeURIComponent(f.from)}&to=${encodeURIComponent(f.to)}`; };
  });

  // ---------- Settings > Cancel & save offers ----------
  NV.settingsTab({
    key: 'saves',
    label: 'Cancel & save offers',
    render(box, d) {
      const s = d.settings;
      box.innerHTML = `<form class="card" style="max-width:720px"><h2>Cancel and save offers</h2>
        <p class="small muted">When someone wants to stop, Stop plan asks why and suggests the offer that fits: money off, skipping a visit, coming less often, a pause, a free re-service, a different technician, or moving service to their new home.</p>
        <div class="row"><div class="field"><label>Money-off offer (%)</label><input name="save_discount_percent" type="number" min="1" max="50" value="${esc(s.save_discount_percent || '20')}"></div>
        <div class="field"><label>For how many visits</label><input name="save_discount_visits" type="number" min="1" max="12" value="${esc(s.save_discount_visits || '2')}"></div>
        <div class="field"><label>Pause length (months)</label><input name="save_pause_months" type="number" min="1" max="6" value="${esc(s.save_pause_months || '2')}"></div></div>
        <div class="field"><label>Customers in their portal</label>${sel('selfserve_cancel_mode', [['off', 'Call us to cancel (no button in the portal)'], ['request', 'They can ask to cancel; the office calls them'], ['instant', 'They can cancel themselves, after seeing the offer that fits']], s.selfserve_cancel_mode || 'off')}
          <div class="hint">Either way they see a save offer first. In the portal the money-off offer is always the amount above and pauses are 3 months at most.</div></div>
        <button class="btn primary">Save</button></form>`;
      box.querySelector('form').onsubmit = async (e) => {
        e.preventDefault();
        try { await api('/nuvolve/app/api/settings', { method: 'PUT', body: formData(e.target) }); toast('Saved'); } catch (err) { toast(err.message, true); }
      };
    },
  });

  // ---------- the portal ----------
  NV.slot('portal.cards', ({ data }) => {
    const x = data.selfserveCancel;
    if (!x || !x.plans?.length) return '';
    return `<div class="card"><h2>${esc(t('Your service plan'))}</h2>
      ${x.plans.map((p) => `<div class="line"><span><b>${esc(p.service_name || t('Pest control'))}</b> <span class="small muted">· ${esc(t({ monthly: 'every month', bimonthly: 'every 2 months', quarterly: 'every 3 months', yearly: 'once a year' }[p.frequency] || ''))}</span>
        ${p.paused_until && p.paused_until > todayStr() ? `<br><span class="small">${esc(t('Paused until {date}', { date: ymd(p.paused_until) }))}</span>` : p.next_visit ? `<br><span class="small muted">${esc(t('Next visit: {date}', { date: ymd(p.next_visit) }))}</span>` : ''}</span>
        ${x.requested ? '' : `<button class="btn sm" data-cx-plan="${p.id}">${esc(t('Pause or cancel'))}</button>`}</div>`).join('')}
      ${x.requested ? `<p class="small">${esc(t('We got your request to cancel. Someone from our team will call you shortly.'))}</p>` : ''}</div>`;
  });
  NV.on('portal.rendered', ({ data, token, root, reload }) => {
    root.querySelectorAll('[data-cx-plan]').forEach((b) => (b.onclick = () => portalFlow(data, token, Number(b.dataset.cxPlan), reload)));
  });

  async function portalFlow(data, token, planId, reload) {
    let o;
    try { o = await api(`/nuvolve/app/api/portal/${token}/cancel/options?plan_id=${planId}`); } catch (e) { return toast(t(e.message), true); }
    const m = modal(t('Pause or cancel your service'), '<div id="cx-step"></div>', []);
    const step = m.el.querySelector('#cx-step');
    const done = (text) => {
      step.innerHTML = `<div style="text-align:center"><div style="font-size:40px">✅</div><p>${esc(text)}</p><button class="btn primary block" id="cx-close">${esc(t('Close'))}</button></div>`;
      step.querySelector('#cx-close').onclick = () => { m.close(); reload(); };
    };
    const first = () => {
      step.innerHTML = `<p>${esc(t("We're sorry to hear that. What's the main reason?"))}</p>
        ${o.reasons.map((r) => `<label class="check" style="margin:6px 0"><input type="radio" name="cx_reason" value="${esc(r.code)}"> ${esc(t(r.label))}</label>`).join('')}
        <div class="field" id="cx-comp" hidden><label>${esc(t('Which company? (optional)'))}</label><input name="competitor" maxlength="120"></div>
        <div class="field"><label>${esc(t('Anything else you want us to know? (optional)'))}</label><textarea name="note" maxlength="1000"></textarea></div>
        <button class="btn primary block" id="cx-next" disabled>${esc(t('Next'))}</button>`;
      step.querySelectorAll('[name=cx_reason]').forEach((x) => (x.onchange = () => { step.querySelector('#cx-next').disabled = false; step.querySelector('#cx-comp').hidden = x.value !== 'competitor'; }));
      step.querySelector('#cx-next').onclick = () => second(formData(step), step.querySelector('[name=cx_reason]:checked').value);
    };
    const second = (f, reason) => {
      step.innerHTML = '<div id="cx-offers"></div><div id="cx-actions" style="margin-top:12px"></div>';
      const box = step.querySelector('#cx-offers');
      const n = offerList(box, reason, o, true);
      const instant = o.mode === 'instant';
      step.querySelector('#cx-actions').innerHTML = `${n ? `<button class="btn primary big block" id="cx-yes">${esc(t('Yes, do this'))}</button>` : ''}
        <button class="btn block" id="cx-no" style="margin-top:8px">${esc(t(n ? (instant ? 'No thanks, cancel my plan' : 'No thanks, I still want to cancel') : (instant ? 'Cancel my plan' : 'Ask to cancel')))}</button>
        <p class="small muted" style="text-align:center;margin-top:8px">${esc(t(instant ? 'Cancelling removes your future visits.' : 'Someone from our team will call you to finish cancelling.'))}</p>`;
      const base = { plan_id: planId, reason, competitor: f.competitor, note: f.note };
      if (n) step.querySelector('#cx-yes').onclick = async (e) => {
        const pick = chosen(box);
        e.target.disabled = true;
        try { const r = await api(`/nuvolve/app/api/portal/${token}/save`, { body: { ...base, offer: pick.offer, params: pick.params } }); done(`${r.message} ${t('Thanks for staying with us!')}`); } catch (err) { e.target.disabled = false; toast(t(err.message), true); }
      };
      step.querySelector('#cx-no').onclick = async (e) => {
        e.target.disabled = true;
        try {
          const r = await api(`/nuvolve/app/api/portal/${token}/cancel`, { body: { ...base, offered: n ? chosen(box).offer : null } });
          done(r.cancelled ? t("Your plan is cancelled and no more visits are scheduled. We're sorry to see you go.") : t('We got your request to cancel. Someone from our team will call you shortly.'));
        } catch (err) { e.target.disabled = false; toast(t(err.message), true); }
      };
    };
    first();
  }
})();

})(); } catch (e) { console.error('feature selfserve-cancel.js failed to load', e); }

/* ---- features/selfserve-lang.js ---- */
try { (function () {
// Spanish on the customer pages: the portal and the booking form. Their screens are written in English in
// portal.js and book.js; rather than wrap every line there, this swaps each piece of text for its Spanish (the
// same catalogs as NV.t, src/lang/es/*.js) as soon as it's drawn, and again whenever something new appears (a
// toast, a modal, a card that loads late), before the browser paints it. Dates follow the language too.
// Text that shouldn't be touched can sit inside [data-nv-raw]. Also adds the English / Español switch.
(function () {
  const page = /^\/nuvolve\/app\/portal(\/|$)/.test(location.pathname) ? 'portal' : /^\/nuvolve\/app\/book(\/|$)/.test(location.pathname) ? 'book' : null;
  if (!page) return;

  // Lines with a changing part. Each is a catalog key; {name} catches whatever is there. `where` limits a loose
  // pattern to the place it's used, so it can't catch a customer's own words somewhere else.
  const TEMPLATES = [
    ['Hi {name}!'], ['due {date}'], ['Pay {amount}'], ['{card} is saved.'], ['{service} at {address}', 'span.small.muted'], ['signed {date}'],
    ['signed {date}. You can cancel until {until}'], ['includes {tip} tip'], ['(includes {tip} tip)'], ['Total: {amount}'],
    ['🎁 Give {friend}, get {reward}'], ['Know someone with bugs? They get {friend} off and you get a {reward} credit after their first service.'],
    ['Know someone with bugs? Send them our way and you get a {reward} credit after their first service.'],
    ["You've referred {n} person. Thank you!"], ["You've referred {n} people. Thank you!"],
    ["You've referred {n} person and earned {amount}. Thank you!"], ["You've referred {n} people and earned {amount}. Thank you!"],
    ['Book with {company}'], ['Please call us to schedule. {error}'], ["🎁 {name} sent you. You'll get {amount} off after your first service."], ['🎁 {name} sent you.'],
    ['from {price}'], ['Thanks, {name}!'], ['Too many tries. Wait {minutes} minutes and try again.'],
  ].map(([key, where]) => {
    const names = [];
    const src = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{(\w+)\\\}/g, (_m, n) => { names.push(n); return '(.+?)'; });
    return { key, where, names, re: new RegExp(`^${src}$`) };
  });

  const one = (text, el) => {
    if (NV.strings[text]) return NV.strings[text];
    for (const tp of TEMPLATES) {
      if (tp.where && !(el && el.closest(tp.where))) continue;
      const m = text.match(tp.re);
      if (!m) continue;
      const vars = {};
      tp.names.forEach((n, i) => { vars[n] = NV.strings[m[i + 1]] || m[i + 1]; });
      if (!NV.strings[tp.key]) return null;
      return NV.t(tp.key, vars);
    }
    return null;
  };
  // One piece of text: the whole thing, else each part between the " · " the portal puts between details (a piece
  // can start with one too: "· due Nov 10").
  function tr(raw, el) {
    const s = String(raw).trim().replace(/\s+/g, ' ').replace(/\s+([.,!?])/g, '$1');
    if (!s) return raw;
    const whole = one(s, el);
    const out = whole != null ? whole : s.split(/(\s*·\s*)/).map((x, i) => (i % 2 || !x ? x : one(x, el) ?? x)).join('');
    if (out === s) return raw;
    return raw.match(/^\s*/)[0] + out + raw.match(/\s*$/)[0];
  }
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE']);
  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  function pass(root) {
    if (NV.lang !== 'es' || !root) return;
    if (root.nodeType === 3) {
      const el = root.parentElement;
      if (el && !SKIP.has(el.tagName) && !el.closest('[data-nv-raw]')) { const v = tr(root.nodeValue, el); if (v !== root.nodeValue) root.nodeValue = v; }
      return;
    }
    if (root.nodeType !== 1 || root.closest('[data-nv-raw]')) return;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && !SKIP.has(n.parentElement.tagName) && !n.parentElement.closest('[data-nv-raw]') && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const nodes = [];
    while (walk.nextNode()) nodes.push(walk.currentNode);
    for (const n of nodes) { const v = tr(n.nodeValue, n.parentElement); if (v !== n.nodeValue) n.nodeValue = v; }
    for (const el of [root, ...root.querySelectorAll('[placeholder],[aria-label],[title],[alt]')]) {
      if (el.closest('[data-nv-raw]')) continue;
      for (const a of ATTRS) { const v = el.getAttribute(a); if (v) { const x = tr(v, el); if (x !== v) el.setAttribute(a, x); } }
    }
  }
  // childList only: changing a text node here doesn't wake this up again.
  new MutationObserver((list) => {
    if (NV.lang !== 'es') return;
    for (const m of list) m.addedNodes.forEach((n) => pass(n));
  }).observe(document.body, { childList: true, subtree: true });
  const retitle = () => { if (NV.lang === 'es') document.title = tr(document.title); };

  // Dates in the page's language (common.js writes them in English).
  const en = { fmtDate: window.fmtDate, fmtDay: window.fmtDay };
  window.fmtDate = function (s, opts) {
    if (NV.lang !== 'es' || !s) return en.fmtDate(s, opts);
    return parseYmd(String(s).slice(0, 10)).toLocaleDateString('es-US', opts || { month: 'short', day: 'numeric', year: 'numeric' });
  };
  window.fmtDay = function (s) {
    if (NV.lang !== 'es' || !s) return en.fmtDay(s);
    const tday = todayStr();
    if (s === tday) return NV.t('Today');
    if (s === addDays(tday, 1)) return NV.t('Tomorrow');
    return parseYmd(s).toLocaleDateString('es-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const switcher = () => `<p class="small" style="text-align:center;margin:8px 0" data-nv-raw>${NV.lang === 'es'
    ? '<a href="#" data-nv-lang="en">View in English</a>' : '<a href="#" data-nv-lang="es">Ver en español</a>'}</p>`;
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-nv-lang]');
    if (!a) return;
    e.preventDefault();
    const lang = a.dataset.nvLang;
    await NV.useLang(lang, { remember: true });
    // In the portal it's their account's language too, so texts and emails come in it.
    const token = location.pathname.replace(/\/$/, '').split('/').pop();
    if (page === 'portal' && token && token !== 'portal') await api(`/nuvolve/app/api/portal/${token}/lang`, { body: { lang } }).catch(() => {});
    location.reload();
  });

  if (page === 'portal') {
    NV.slot('portal.cards', () => switcher());
    NV.on('portal.rendered', ({ root }) => { document.title = NV.lang === 'es' ? NV.t('Your account') : document.title; pass(root); });
  } else {
    // A Spanish phone gets the booking form in Spanish (or whatever they picked here before).
    const want = String(NV.preferredLang(navigator.language) || '').toLowerCase();
    if (want.startsWith('es')) NV.useLang('es').then(() => { pass(document.body); retitle(); });
    NV.on('book.rendered', ({ form }) => { form.insertAdjacentHTML('beforebegin', switcher()); retitle(); pass(document.getElementById('app')); });
  }
})();

})(); } catch (e) { console.error('feature selfserve-lang.js failed to load', e); }

/* ---- features/selfserve-reviews.js ---- */
try { (function () {
// Google reviews on the Reviews page: requests and taps per tech, the Google Business Profile connection, and the
// Google reviews themselves (who wrote them, and a reply box). Settings > Google reviews holds the asking rules.
(function () {
  const stars = (n) => '⭐'.repeat(Math.max(0, Math.min(5, Number(n) || 0)));
  const MATCH = { clicked: 'tapped our Google button', name: 'name and a recent visit', office: 'matched by the office' };
  const BACK = {
    connected: ['Google is connected. Reviews sync every hour.', false], expired: ['That Google sign-in link expired. Try Connect again.', true],
    cancelled: ['Google connection was cancelled.', true], failed: ['Google did not let us in. Try again, or check the account has access to the business.', true],
    no_locations: ['That Google account has no business profile to manage.', true], not_set_up: ['Google is not set up on this server yet.', true],
  };

  NV.on('page', ({ name, view, params }) => {
    if (name !== 'reviews' || !view.querySelector('.page-head')) return;
    const s = BOOT.settings || {};
    const min = Number(s.review_google_min || 1);
    const sub = view.querySelector('.page-head .muted');
    if (sub) sub.textContent = `Every completed stop sends a 1-tap rating. ${min >= 5 ? '5-stars get' : min <= 1 ? 'Everyone who rates gets' : `${min} stars and up get`} asked to post on Google, at most once every ${s.review_google_cooldown_days || 90} days.`;
    if (params.google && BACK[params.google]) toast(...BACK[params.google]);
    view.insertAdjacentHTML('beforeend', '<div id="gr-techs"></div><div id="gr-google"></div>');
    drawTechs(view.querySelector('#gr-techs'), params.period || 'month');
    drawGoogle(view.querySelector('#gr-google'));
  });

  async function drawTechs(box, period) {
    const r = await api(`/nuvolve/app/api/selfserve/reviews/techs?period=${encodeURIComponent(period)}`).catch(() => null);
    if (!r) return;
    const pct = (x) => (x == null ? '—' : `${x}%`);
    box.innerHTML = `<div class="card flush"><div class="card-head" style="padding:16px 16px 0"><h2>📣 Google review requests by tech</h2>
      <span class="small muted">${r.totals.asked} asked · ${r.totals.followedUp} reminded by text or email · ${r.totals.clicked} tapped through · ${r.totals.reviews} Google reviews matched</span></div>
      <div class="table-wrap"><table class="list"><thead><tr><th>Tech</th><th class="right">Rated</th><th class="right">${r.min}★ and up</th><th class="right">Asked</th><th class="right">Reminded</th><th class="right">Tapped</th><th class="right">Google reviews</th><th class="right">Review rate</th><th class="right">Not asked (asked recently)</th></tr></thead><tbody>
      ${r.rows.map((x) => `<tr><td><span class="dot" style="background:${esc(x.color || '#999')}"></span><b>${esc(x.name)}</b></td><td class="right">${x.rated}${x.avg ? ` <span class="small muted">(${x.avg})</span>` : ''}</td>
        <td class="right">${x.happy}</td><td class="right">${x.asked}</td><td class="right">${x.followedUp}</td><td class="right">${x.clicked} <span class="small muted">${pct(x.clickRate)}</span></td>
        <td class="right">${x.reviews}${x.googleAvg ? ` <span class="small muted">(${x.googleAvg})</span>` : ''}</td><td class="right">${pct(x.reviewRate)}</td><td class="right">${x.skippedRecent}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No ratings in this period yet.</td></tr>'}
      </tbody></table></div></div>`;
  }

  async function drawGoogle(box) {
    const d = await api('/nuvolve/app/api/gbp/reviews').catch(() => null);
    if (!d) return;
    const st = d.status;
    const admin = BOOT.me.isAdmin;
    const manager = BOOT.me.isManager || admin;
    const head = st.connected
      ? `<p>Connected to <b>${esc(st.title || 'your Google profile')}</b>${st.total != null ? ` · ${st.total} reviews${st.average ? `, ${st.average} ⭐ on Google` : ''}` : ''}. ${st.lastSync ? `Last synced ${esc(fmtDate(st.lastSync))}.` : ''}</p>
         ${st.lastError ? `<div class="alert warn">Google sync had a problem: ${esc(st.lastError)}</div>` : ''}
         <div class="actions">${manager ? '<button class="btn sm" id="gr-sync">Sync now</button>' : ''}${admin && st.locations.length > 1 ? `<select id="gr-loc">${st.locations.map((l) => `<option value="${esc(l.location)}" ${l.location === st.location ? 'selected' : ''}>${esc(l.title)}</option>`).join('')}</select>` : ''}${admin ? '<button class="btn sm" id="gr-off">Disconnect</button>' : ''}</div>`
      : st.configured
        ? `<p>Bring your Google reviews in here: see who wrote each one, which tech earned it, and reply without leaving Nuvolve.</p>${admin ? '<button class="btn primary" id="gr-connect">Connect Google Business Profile</button>' : '<p class="small muted">An owner or admin can connect it.</p>'}`
        : `<div class="alert info" style="display:block"><b>Practice mode.</b> Google isn't set up on this server yet, so nothing is read from or posted to Google. To go live, add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>
           to the server settings (a Google Cloud OAuth client with the Business Profile API, redirect URL <code>${esc(location.origin)}/api/gbp/callback</code>), then connect here.</div>
           ${manager ? `<button class="btn" id="gr-sync">${st.samples ? 'Reload sample reviews' : 'Try it with sample reviews'}</button>` : ''}${admin && st.samples ? ' <button class="btn" id="gr-off">Clear samples</button>' : ''}`;
    box.innerHTML = `<div class="card"><div class="card-head"><h2>🔎 Google reviews</h2></div>${head}
      <div id="gr-list" style="margin-top:10px">${d.reviews.map((g) => `<div style="padding:10px 0;border-bottom:1px solid var(--line)" data-gr="${g.id}">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>${stars(g.rating)} <b>${esc(g.reviewer || 'A Google user')}</b>${g.demo ? ' <span class="pill">Sample</span>' : ''}</span><span class="small muted">${esc(fmtDate(g.posted_at))}</span></div>
        ${g.comment ? `<div>${esc(g.comment)}</div>` : ''}
        <div class="small muted" style="margin-top:4px">${g.customer_name ? `Customer: <a href="#/customers/${g.customer_id}">${esc(g.customer_name)}</a>${g.tech_name ? ` · tech ${esc(g.tech_name)}` : ''} · ${esc(MATCH[g.matched_by] || '')}` : 'Not matched to a customer'}
          · <a href="#" data-gr-match="${g.id}">${g.customer_name ? 'Change' : 'Match'}</a></div>
        ${g.reply ? `<div class="office-note-view" style="margin-top:6px"><b>Your reply</b>${g.reply_by_name ? ` (${esc(g.reply_by_name)})` : ''}: ${esc(g.reply)}</div>` : ''}
        <button class="btn sm" style="margin-top:6px" data-gr-reply="${g.id}">${g.reply ? 'Edit reply' : 'Reply'}</button></div>`).join('') || '<p class="muted">No Google reviews here yet.</p>'}</div></div>`;
    const redraw = () => drawGoogle(box);
    const on = (sel, fn) => { const el = box.querySelector(sel); if (el) el.onclick = fn; };
    on('#gr-connect', async () => { try { location.href = (await api('/nuvolve/app/api/gbp/connect', { method: 'POST' })).url; } catch (e) { toast(e.message, true); } });
    on('#gr-sync', async (e) => {
      e.target.disabled = true;
      try { const r = await api('/nuvolve/app/api/gbp/sync', { method: 'POST' }); toast(r.demo ? 'Sample reviews loaded. Nothing was sent to Google.' : `Synced ${r.synced} reviews, matched ${r.matched} new ones.`); } catch (err) { toast(err.message, true); }
      redraw();
    });
    on('#gr-off', () => modal(st.connected ? 'Disconnect Google?' : 'Clear the sample reviews?', st.connected ? '<p>Reviews stop syncing. The ones already here stay.</p>' : '<p>The sample reviews are removed.</p>',
      [{ label: 'Keep' }, { label: st.connected ? 'Disconnect' : 'Clear', cls: 'danger', onClick: async () => { await api('/nuvolve/app/api/gbp/disconnect', { method: 'POST' }); redraw(); } }]));
    const loc = box.querySelector('#gr-loc');
    if (loc) loc.onchange = async () => { try { await api('/nuvolve/app/api/gbp/location', { method: 'PUT', body: { location: loc.value } }); toast('Switched'); } catch (e) { toast(e.message, true); } redraw(); };
    box.querySelectorAll('[data-gr-reply]').forEach((b) => (b.onclick = () => {
      const g = d.reviews.find((x) => x.id === Number(b.dataset.grReply));
      modal(`Reply to ${g.reviewer || 'this review'}`, `<p class="small muted">${stars(g.rating)} ${esc(g.comment || '')}</p>
        <div class="field"><label>Your reply ${g.demo ? '(sample: saved here only)' : '(posted on Google under your business name)'}</label><textarea name="comment" maxlength="4000" style="min-height:120px">${esc(g.reply || '')}</textarea></div>
        <p class="small muted">Thank them by first name, keep it short, and never share details about their home or account in public.</p>`,
      [{ label: 'Cancel' }, { label: g.demo ? 'Save reply' : 'Post reply', cls: 'primary', onClick: async (m) => {
        const r = await api(`/nuvolve/app/api/gbp/reviews/${g.id}/reply`, { body: formData(m) });
        toast(r.demo ? 'Saved here. Sample reviews are not posted to Google.' : 'Reply posted on Google');
        redraw();
      } }]);
    }));
    box.querySelectorAll('[data-gr-match]').forEach((a) => (a.onclick = (e) => {
      e.preventDefault();
      const g = d.reviews.find((x) => x.id === Number(a.dataset.grMatch));
      const m = modal(`Who wrote "${g.reviewer || 'this review'}"?`, `<div class="field"><input id="gr-q" placeholder="Search customers by name or phone"></div><div id="gr-found"></div>
        <p class="small"><a href="#" id="gr-none">It's nobody we know</a></p>`, [{ label: 'Close' }]);
      const q = m.el.querySelector('#gr-q');
      q.value = g.reviewer || '';
      const pick = async (id) => { await api(`/nuvolve/app/api/gbp/reviews/${g.id}/match`, { method: 'PUT', body: { customer_id: id } }); m.close(); redraw(); };
      const find = async () => {
        const rows = await api(`/nuvolve/app/api/customers?q=${encodeURIComponent(q.value.trim().split(' ')[0])}`).catch(() => []);
        m.el.querySelector('#gr-found').innerHTML = (Array.isArray(rows) ? rows : rows.customers || []).slice(0, 8).map((c) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)">
          <span>${esc(c.name || '')} <span class="small muted">${esc(c.address || '')}</span></span><button class="btn sm" data-id="${c.id}">This one</button></div>`).join('') || '<p class="muted small">Nobody found.</p>';
        m.el.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => pick(Number(b.dataset.id)).catch((err) => toast(err.message, true))));
      };
      q.oninput = () => { clearTimeout(q.t); q.t = setTimeout(find, 250); };
      m.el.querySelector('#gr-none').onclick = (ev) => { ev.preventDefault(); pick(null).catch((err) => toast(err.message, true)); };
      find();
    }));
  }

  // ---------- Settings > Google reviews ----------
  NV.settingsTab({
    key: 'google',
    label: 'Google reviews',
    render(box, d) {
      const s = d.settings;
      const min = s.review_google_min || '1';
      box.innerHTML = `<form class="card" style="max-width:720px"><h2>Asking for Google reviews</h2>
        <p class="small muted">After every stop the customer gets a 1-tap rating. Then they're asked to post on Google, on the thank-you page and with one text or email a little later if they don't tap it. Low ratings also get a private feedback box, so you hear about a problem first.</p>
        <div class="field"><label>Who gets asked</label><select name="review_google_min">${[['1', 'Everyone who rates (recommended)'], ['3', '3 stars and up'], ['4', '4 and 5 stars'], ['5', '5 stars only']].map(([v, l]) => `<option value="${v}" ${v === min ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <div class="hint">Google's rules don't allow asking only happy customers ("review gating"), and Google can remove reviews or flag the listing for it. "Everyone who rates" follows the rules.</div></div>
        <label class="check"><input type="checkbox" name="review_google_on_page" ${s.review_google_on_page !== '0' ? 'checked' : ''}> Show the Google button on the thank-you page right away</label>
        <div class="row" style="margin-top:8px"><div class="field"><label>Reminder text or email after (minutes)</label><input name="review_google_delay_min" type="number" min="0" max="10080" value="${esc(s.review_google_delay_min ?? '60')}"><div class="hint">0: no reminder. Nobody who already tapped gets one.</div></div>
        <div class="field"><label>Don't ask the same customer again for (days)</label><input name="review_google_cooldown_days" type="number" min="0" max="365" value="${esc(s.review_google_cooldown_days ?? '90')}"><div class="hint">Monthly customers would otherwise be asked every month.</div></div></div>
        <p class="small">${s.google_review_url ? `Customers go to <a href="${esc(s.google_review_url)}" target="_blank" rel="noopener">${esc(s.google_review_url)}</a>.` : '<b>No Google review link yet.</b> Connect Google on the Reviews page, or paste the link in Follow-up.'} The link itself is in <a href="#/settings?tab=followup">Follow-up</a>.</p>
        <button class="btn primary">Save</button></form>`;
      box.querySelector('form').onsubmit = async (e) => {
        e.preventDefault();
        const body = formData(e.target);
        body.review_google_on_page = body.review_google_on_page ? '1' : '0';
        try { await api('/nuvolve/app/api/settings', { method: 'PUT', body }); if (typeof refreshBoot === 'function') await refreshBoot(); toast('Saved'); } catch (err) { toast(err.message, true); }
      };
    },
  });
})();

})(); } catch (e) { console.error('feature selfserve-reviews.js failed to load', e); }

/* ---- features/selfserve.js ---- */
try { (function () {
// Self-scheduling: customers pick a real open time on the booking form and move their own visits in the portal;
// the office confirms what's waiting on the Today page and sets it all up in Settings > Online booking.
(function () {
  const t = (text, vars) => NV.t(text, vars);
  const dayLabel = (d, long) => parseYmd(d).toLocaleDateString(NV.lang === 'es' ? 'es-US' : 'en-US', long ? { weekday: 'long', month: 'long', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
  const slotLabel = (s) => s.label || t('Any time that day');
  const slotKey = (date, s) => `${date}|${s.start}|${s.end}`;

  // The day chips and time buttons, shared by the booking form and the portal. onPick(slotKey, text) or (null).
  function picker(box, days, onPick) {
    let day = days[0]?.date || null;
    const draw = () => {
      const d = days.find((x) => x.date === day);
      box.innerHTML = `<div class="chips" style="margin-bottom:8px">${days.map((x) => `<button type="button" class="chip ${x.date === day ? 'on' : ''}" data-ss-day="${esc(x.date)}">${esc(dayLabel(x.date))}</button>`).join('')}</div>
        <div class="chips">${(d?.slots || []).map((s) => `<button type="button" class="chip" data-ss-slot="${esc(slotKey(d.date, s))}">${esc(slotLabel(s))}</button>`).join('')}</div>`;
      box.querySelectorAll('[data-ss-day]').forEach((b) => (b.onclick = () => { day = b.dataset.ssDay; draw(); onPick(null); }));
      box.querySelectorAll('[data-ss-slot]').forEach((b) => (b.onclick = () => {
        box.querySelectorAll('[data-ss-slot]').forEach((x) => x.classList.toggle('on', x === b));
        onPick(b.dataset.ssSlot, `${dayLabel(d.date, true)}, ${b.textContent}`);
      }));
    };
    draw();
  }

  // ---------- the booking form ----------
  NV.slot('book.form', ({ d }) => `<input type="hidden" name="lang" value="${esc(NV.lang)}">
    ${d.selfserve && d.selfserve.mode !== 'off' ? `<div class="field" id="ss-pick" hidden><label>${esc(t('Pick a time'))}</label>
      <div id="ss-times"></div><div class="small muted" id="ss-note" style="margin-top:6px"></div><input type="hidden" name="slot" value=""></div>` : ''}`);

  NV.on('book.rendered', ({ d, form }) => {
    const box = form.querySelector('#ss-pick');
    if (!box) return;
    const key = location.pathname.replace(/\/$/, '').split('/').pop();
    const slot = form.querySelector('[name=slot]');
    const btn = form.querySelector('button.primary');
    const btnText = btn.textContent;
    const pref = form.querySelector('[name=preferred_date]')?.closest('.field');
    const note = box.querySelector('#ss-note');
    let seq = 0;
    let timer = null;
    const pick = (v) => { slot.value = v || ''; btn.textContent = v ? t('Book this time') : btnText; };
    const say = (text) => { box.hidden = false; box.querySelector('#ss-times').innerHTML = ''; note.textContent = text; pick(null); if (pref) pref.hidden = false; };
    const load = async () => {
      const b = formData(form);
      b.service_type_id = form.querySelector('input[name=service_type_id]:checked')?.value || '';
      if (!b.address || !b.zip) { box.hidden = true; pick(null); return; }
      const mine = ++seq;
      let o;
      try { o = await api(`/nuvolve/app/api/book/${key}/openings`, { body: { address: b.address, city: b.city, zip: b.zip, service_type_id: b.service_type_id } }); } catch { return; }
      if (mine !== seq) return;
      if (o?.outOfArea) return say(t("That address is outside the area we book online. Send your request and we'll call you."));
      if (o?.requestOnly || o?.mode === 'off') return say(t("Send your request and we'll call you to pick a time."));
      if (!o?.days?.length) return say(t("No open times online right now. Send your request and we'll call you."));
      box.hidden = false;
      if (pref) pref.hidden = true;
      note.textContent = o.mode === 'confirm' ? t("We'll confirm your time by text or email.") : '';
      pick(null);
      picker(box.querySelector('#ss-times'), o.days, (v) => pick(v));
    };
    form.addEventListener('change', (e) => {
      if (!['address', 'city', 'zip', 'service_type_id'].includes(e.target.name)) return;
      clearTimeout(timer);
      timer = setTimeout(load, 250);
    });
    // Someone else took the time while they were typing: show what's still open.
    NV.on('book.failed', ({ err }) => { if (err.status === 409) load(); });
  });

  NV.on('book.done', ({ body, result, root }) => {
    const b = result && result.booking;
    if (!b || !b.visit_id) return;
    root.innerHTML = `<div style="text-align:center;padding:20px 0"><div style="font-size:44px">✅</div>
      <h2>${esc(t(b.pending ? "We're holding your time, {name}!" : "You're booked, {name}!", { name: body.first_name || '' }))}</h2>
      <p style="font-size:18px"><b>${esc(b.day)}${b.label ? `, ${esc(b.label)}` : ''}</b></p>
      <p>${esc(t(b.pending ? "We'll confirm it shortly by text or email." : 'We sent the details by text or email. See you then!'))}</p></div>`;
  });

  // ---------- the portal: change the day to a real open time ----------
  NV.override('portal.move', (data, fallback) => {
    const { visit, token, reload } = data;
    if (!visit || !data.data?.selfserve || data.data.selfserve.moveMode === 'off') return fallback(data);
    openMove(visit, token, reload, () => fallback(data));
  });

  async function openMove(visit, token, reload, fallback) {
    let o;
    try { o = await api(`/nuvolve/app/api/portal/${token}/openings?visit_id=${visit.id}`); } catch { return fallback(); }
    if (!o || o.mode === 'off') return fallback();
    if (o.waiting) return toast(t('We are still confirming your last change. We will be in touch soon.'));
    // Nothing open online (or moved a few times already): the old way, tell us a better day.
    if (!o.days?.length) return fallback();
    let chosen = null;
    const m = modal(t('Change your service day'), `<p>${esc(t('Your visit is on {date}.', { date: `${dayLabel(visit.date, true)}${visit.time_window ? `, ${visit.time_window}` : ''}` }))}
      ${esc(t('Pick a new time:'))}</p><div id="ss-move"></div>
      ${o.mode === 'approval' ? `<p class="small muted">${esc(t("We'll hold the new time and confirm it shortly."))}</p>` : ''}
      <button class="btn primary block" id="ss-go" disabled style="margin-top:12px">${esc(t('Move my visit'))}</button>
      <p class="small" style="text-align:center;margin-top:10px"><a href="#" id="ss-other">${esc(t('None of these work? Ask for another day'))}</a></p>`, [{ label: t('Cancel') }]);
    const go = m.el.querySelector('#ss-go');
    const draw = (days) => picker(m.el.querySelector('#ss-move'), days, (v, text) => { chosen = v; go.disabled = !v; go.textContent = v ? t('Move it to {when}', { when: text }) : t('Move my visit'); });
    draw(o.days);
    m.el.querySelector('#ss-other').onclick = (e) => { e.preventDefault(); m.close(); fallback(); };
    go.onclick = async () => {
      go.disabled = true;
      try {
        const r = await api(`/nuvolve/app/api/portal/${token}/move`, { body: { visit_id: visit.id, slot: chosen } });
        m.close();
        toast(r.pending ? t("Got it. We're holding that time and will confirm it shortly.") : t('Done! Your visit is moved.'));
        reload();
      } catch (err) {
        toast(t(err.message), true);
        if (err.status === 409) {
          const again = await api(`/nuvolve/app/api/portal/${token}/openings?visit_id=${visit.id}`).catch(() => null);
          if (again?.days?.length) { chosen = null; draw(again.days); go.textContent = t('Move my visit'); } else { m.close(); fallback(); }
        } else go.disabled = false;
      }
    };
  }

  NV.on('portal.rendered', ({ data, root }) => {
    for (const id of data.selfserve?.pending || []) {
      const b = root.querySelector(`[data-move="${Number(id)}"]`);
      if (b) b.insertAdjacentHTML('beforebegin', `<span class="pill yellow" style="margin-right:6px">${esc(t('Waiting for confirmation'))}</span>`);
    }
  });

  // ---------- the office: what customers picked, waiting for a yes ----------
  const pendingLine = (v) => `${esc(v.customer_name || '')} · <b>${esc(fmtDay(v.date))}${v.time_window ? `, ${esc(v.time_window)}` : ''}</b>
    <span class="small muted">${esc(v.service_name || '')}${v.tech_name ? ` · ${esc(v.tech_name)}` : ''} · ${v.kind === 'move_requested' ? `moved from ${esc(fmtDay(v.from_date))}${v.from_window ? `, ${esc(v.from_window)}` : ''}` : 'new online booking'}</span>`;
  NV.slot('today.alerts', ({ d }) => {
    const rows = d?.selfserve?.pending || [];
    if (!rows.length) return '';
    return `<div class="card" id="ss-pending"><div class="card-head"><h2>📅 Picked online: confirm or decline</h2><span class="small muted">The time is held until you answer. The customer hears back either way.</span></div>
      ${rows.map((v) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);flex-wrap:wrap">
        <span><a href="#/visits/${v.id}">${pendingLine(v)}</a></span>
        <span class="row" style="gap:6px;flex:0 0 auto"><button class="btn sm primary" data-ss-confirm="${v.id}">Confirm</button><button class="btn sm" data-ss-decline="${v.id}">Decline</button></span></div>`).join('')}</div>`;
  });
  NV.slot('visit.right', ({ v }) => {
    const s = v.selfserve;
    if (!s) return '';
    if (s.pending) {
      return `<div class="alert warn" style="margin-top:12px"><span>📅 ${s.kind === 'move_requested' ? `The customer asked online to move this visit here${s.from_date ? ` from ${esc(fmtDay(s.from_date))}${s.from_window ? `, ${esc(s.from_window)}` : ''}` : ''}.` : 'Booked online by the customer.'} The time is held until you confirm it.</span>
        <span class="row" style="gap:6px"><button class="btn sm primary" data-ss-confirm="${v.id}">Confirm</button><button class="btn sm" data-ss-decline="${v.id}">Decline</button></span></div>`;
    }
    if (s.kind === 'moved' && s.from_date) return `<p class="small muted" style="margin-top:12px">📅 The customer moved this visit online from ${esc(fmtDay(s.from_date))}${s.from_window ? `, ${esc(s.from_window)}` : ''}.</p>`;
    if (s.kind === 'booked') return '<p class="small muted" style="margin-top:12px">📅 Booked online by the customer.</p>';
    return '';
  });
  document.addEventListener('click', (e) => {
    const yes = e.target.closest('[data-ss-confirm]');
    const no = e.target.closest('[data-ss-decline]');
    if (!yes && !no) return;
    const id = (yes || no).dataset[yes ? 'ssConfirm' : 'ssDecline'];
    const send = async () => {
      try {
        await api(`/nuvolve/app/api/selfserve/visits/${id}/${yes ? 'confirm' : 'decline'}`, { method: 'POST' });
        toast(yes ? 'Confirmed. The customer got a note.' : 'Declined. The customer got a note.');
        if (typeof route === 'function') route();
      } catch (err) { toast(err.message, true); }
    };
    if (yes) return send();
    modal('Decline this time?', '<p>A moved visit goes back to its old day; a new booking is taken off the schedule and stays as a request to call them about. The customer gets a note either way.</p>',
      [{ label: 'Keep it' }, { label: 'Decline', cls: 'danger', onClick: send }]);
  });

  // ---------- Settings > Online booking ----------
  const BOOK = [['off', 'Off: the form sends a request and you call them'], ['confirm', 'Customers pick a time, you confirm it'], ['instant', 'Customers pick a time and are booked right away']];
  const MOVE = [['off', 'Off: customers ask for a new day and you call them'], ['approval', 'Customers pick a new time, you confirm it'], ['instant', 'Customers pick a new time and the visit moves right away']];
  const WIN = [['day', 'The whole day (no arrival window)'], ['ampm', 'Morning or afternoon'], ['120', '2-hour windows'], ['180', '3-hour windows'], ['240', '4-hour windows']];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const options = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${String(cur) === v ? 'selected' : ''}>${esc(l)}</option>`).join('');

  NV.settingsTab({
    key: 'selfserve',
    label: 'Online booking',
    async render(box) {
      let d;
      try { d = await api('/nuvolve/app/api/selfserve/setup'); } catch (e) { box.innerHTML = `<div class="alert warn">${esc(e.message)}</div>`; return; }
      const s = d.settings;
      box.innerHTML = `<form class="card" id="ss-form" style="max-width:760px">
        <h2>Online booking and changes</h2>
        <p class="small muted">Customers see real open times from your techs' days: their work days and hours, how long each service takes, the drive between stops, the stops already booked, and each tech's branch and area.
          ${d.bookingLink ? `Your booking form: <a href="${esc(d.bookingLink)}" target="_blank" rel="noopener">${esc(d.bookingLink)}</a>` : 'Turn on the booking form in Sales & booking to get a link for your website.'}</p>
        <div class="row"><div class="field"><label>Booking form</label><select name="selfserve_book_mode">${options(BOOK, s.selfserve_book_mode)}</select></div>
        <div class="field"><label>"Change day" in the customer portal</label><select name="selfserve_move_mode">${options(MOVE, s.selfserve_move_mode)}</select></div></div>
        <div class="row"><div class="field"><label>Arrival windows customers pick from</label><select name="selfserve_window">${options(WIN, s.selfserve_window)}</select></div>
        <div class="field"><label>Notice needed (hours)</label><input name="selfserve_lead_hours" type="number" min="0" max="168" value="${esc(s.selfserve_lead_hours)}"></div></div>
        <div class="row"><div class="field"><label>Days ahead to show</label><input name="selfserve_horizon_days" type="number" min="3" max="60" value="${esc(s.selfserve_horizon_days)}"></div>
        <div class="field"><label>No same-day bookings after (optional)</label><input name="selfserve_same_day_cutoff" placeholder="11:00" value="${esc(s.selfserve_same_day_cutoff)}"></div></div>
        <div class="field"><label>Closed days</label><textarea name="selfserve_closed_days" placeholder="2026-11-26, 12-25, 01-01">${esc(s.selfserve_closed_days)}</textarea>
          <div class="hint">One date (2026-11-26) or every year (12-25), separated by commas. Nobody can book or move a visit to these days.</div></div>
        <button class="btn primary">Save online booking</button>
      </form>
      <div class="card" style="max-width:760px"><h2>Who can be booked online</h2>
        <p class="small muted">Leave a field empty to use the company hours (${esc(d.day.start)} to ${esc(d.day.end)}) and work days.</p>
        <div class="table-wrap"><table class="list"><thead><tr><th>Tech</th><th>Work days</th><th>Start</th><th>End</th><th>Most stops</th><th>Online</th><th></th></tr></thead><tbody>
        ${d.techs.map((x) => `<tr data-ss-tech="${x.id}"><td><b>${esc(x.name)}</b></td>
          <td class="nowrap">${DAYS.map((n, i) => `<label class="small" style="display:inline-flex;gap:2px;margin-right:4px"><input type="checkbox" value="${i}" ${(x.work_days ? x.work_days.split(',') : d.workDays.split(',')).includes(String(i)) ? 'checked' : ''}>${n}</label>`).join('')}</td>
          <td><input name="day_start" placeholder="${esc(d.day.start)}" value="${esc(x.day_start)}" style="width:80px"></td><td><input name="day_end" placeholder="${esc(d.day.end)}" value="${esc(x.day_end)}" style="width:80px"></td>
          <td><input name="max_stops" type="number" min="1" max="60" value="${x.max_stops ?? ''}" style="width:70px"></td>
          <td><input type="checkbox" name="online_booking" ${x.online_booking ? 'checked' : ''}></td><td><button class="btn sm" data-ss-save="${x.id}">Save</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No techs yet.</td></tr>'}
        </tbody></table></div></div>
      <div class="card" style="max-width:760px"><h2>What customers see this week</h2>
        ${d.preview.length ? d.preview.map((x) => `<div style="padding:6px 0;border-bottom:1px solid var(--line)"><b>${esc(fmtDay(x.date))}</b> <span class="small muted">${x.slots.map((sl) => esc(sl.label || 'Any time')).join(' · ')}</span></div>`).join('')
          : '<p class="muted">No open times in the next 7 days. Check the techs\' days and hours above.</p>'}
        ${d.pending ? `<p class="small" style="margin-top:8px">${d.pending} online pick${d.pending === 1 ? ' is' : 's are'} waiting on the Today page.</p>` : ''}</div>`;
      box.querySelector('#ss-form').onsubmit = async (e) => {
        e.preventDefault();
        try { await api('/nuvolve/app/api/settings', { method: 'PUT', body: formData(e.target) }); toast('Saved'); this.render(box); } catch (err) { toast(err.message, true); }
      };
      box.querySelectorAll('[data-ss-save]').forEach((b) => (b.onclick = async () => {
        const tr = b.closest('tr');
        const body = {
          work_days: [...tr.querySelectorAll('input[type=checkbox][value]')].filter((c) => c.checked).map((c) => c.value).join(','),
          day_start: tr.querySelector('[name=day_start]').value.trim(), day_end: tr.querySelector('[name=day_end]').value.trim(),
          max_stops: tr.querySelector('[name=max_stops]').value.trim(), online_booking: tr.querySelector('[name=online_booking]').checked,
        };
        try { await api(`/nuvolve/app/api/selfserve/techs/${b.dataset.ssSave}`, { method: 'PUT', body }); toast('Saved'); } catch (err) { toast(err.message, true); }
      }));
    },
  });
})();

})(); } catch (e) { console.error('feature selfserve.js failed to load', e); }

/* ---- features/tcpa.js ---- */
try { (function () {
// Texting compliance (TCPA and A2P 10DLC) in the browser: consent on the customer page, the new customer and edit
// customer forms, the tech app, the customer portal and the booking form, and Settings > Texting compliance.
const CH = ['sms_service', 'sms_marketing', 'email_marketing'];
const NAMES = { sms_service: 'Service texts', sms_marketing: 'Marketing texts', email_marketing: 'Marketing email' };
const SOURCES = { booking: 'Booking form', portal: 'Customer portal', office: 'Office (by phone)', tech: 'Tech app', import: 'Import', keyword: 'Text message', api: 'API', earlier: 'Before tracking' };
const STATUS = { not_started: ['Not started', ''], pending: ['Pending', 'yellow'], approved: ['Approved', 'green'], rejected: ['Rejected', 'red'] };
let FORMS = null; // checkbox labels and consent wording in English and Spanish, from the server

const style = document.createElement('style');
style.textContent = `
.tc-box { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin: 8px 0; background: #fff; text-align: left; }
.tc-box .check { align-items: flex-start; margin: 8px 0; }
.tc-box .check input { margin-top: 3px; flex: 0 0 auto; }
.tc-w { display: block; font-weight: 400; font-size: 12px; color: var(--muted); margin-top: 2px; }
.tc-big .check { font-size: 16px; }
.tc-big .check input { width: 24px; height: 24px; }
.tc-big .tc-w { font-size: 14px; }
.tc-row { display: flex; justify-content: space-between; gap: 8px; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.tc-row:last-child { border-bottom: 0; }
.tc-hist { list-style: none; padding: 0; margin: 8px 0 0; font-size: 13px; }
.tc-hist li { padding: 6px 0; border-top: 1px solid var(--line); }
.tc-hist q { color: var(--muted); }`;
document.head.appendChild(style);

const when = (s) => (s ? new Date(`${String(s).replace(' ', 'T')}Z`).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const shownChecked = (channels) => ({ sms_service: channels.sms_service.value === 1, sms_marketing: channels.sms_marketing.value === 1, email_marketing: channels.email_marketing.value !== 0 });
const choicesIn = (root) => Object.fromEntries(CH.filter((ch) => $(`[name=tcpa_${ch}]`, root)).map((ch) => [ch, $(`[name=tcpa_${ch}]`, root).checked]));

// Checkboxes with the exact consent wording under each, in English or Spanish (inputs named tcpa_<channel>).
function consentBox(forms, lang, { checked = {}, only = CH, disabled = {}, big = false } = {}) {
  const l = forms[lang] ? lang : 'en';
  const f = forms[l];
  return `<div class="tc-box ${big ? 'tc-big' : ''}" data-tc-box>
    <div class="tc-row" style="border:0;padding:0"><b data-tc-title>${esc(f.title)}</b>
      <button type="button" class="link-btn small" data-tc-lang="${l === 'es' ? 'en' : 'es'}">${l === 'es' ? 'English' : 'Español'}</button></div>
    ${only.map((ch) => `<label class="check"><input type="checkbox" name="tcpa_${ch}" ${checked[ch] ? 'checked' : ''} ${disabled[ch] ? 'disabled' : ''}>
      <span><span data-tc-label="${ch}">${esc(f[ch].label)}</span><span class="tc-w" data-tc-wording="${ch}">${esc(f[ch].wording)}</span></span></label>`).join('')}
    <input type="hidden" name="tcpa_lang" value="${l}">
  </div>`;
}
// The English / Español switch on any consent box: the checked boxes stay as they are.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-tc-lang]');
  const box = b && b.closest('[data-tc-box]');
  if (!box || !FORMS) return;
  const lang = b.dataset.tcLang;
  const f = FORMS[lang];
  $('[data-tc-title]', box).textContent = f.title;
  $$('[data-tc-label]', box).forEach((el) => { el.textContent = f[el.dataset.tcLabel].label; });
  $$('[data-tc-wording]', box).forEach((el) => { el.textContent = f[el.dataset.tcWording].wording; });
  $('[name=tcpa_lang]', box).value = lang;
  b.dataset.tcLang = lang === 'es' ? 'en' : 'es';
  b.textContent = lang === 'es' ? 'English' : 'Español';
});

// ---------- office: the customer's page ----------
NV.on('boot', ({ boot }) => { if (boot && boot.tcpa) FORMS = boot.tcpa.forms; });

function stateText(ch, s, t) {
  if (ch !== 'email_marketing' && !t.phone) return ['No phone', ''];
  if (ch === 'email_marketing' && !t.email) return ['No email', ''];
  if (ch !== 'email_marketing' && t.optedOut) return ['Off (texted STOP)', 'red'];
  if (s.value === 1) return ['Yes', 'green'];
  if (s.value === 0) return [ch === 'email_marketing' ? 'Unsubscribed' : 'No', 'red'];
  if (ch === 'sms_service') return s.ok ? ['OK: existing customer', 'blue'] : ['Not asked', 'yellow'];
  if (ch === 'email_marketing') return ['OK: never unsubscribed', 'blue'];
  return ['Not asked', ''];
}
const historyItem = (e) => `<li><b>${esc(NAMES[e.channel] || e.channel)}: ${e.granted ? 'yes' : 'no'}</b> <span class="muted">· ${esc(SOURCES[e.source] || e.source)} · ${esc(when(e.at))}${e.by ? ` · ${esc(e.by)}` : ''}</span>
  <details><summary class="small muted">Evidence</summary><div class="small">${e.wording ? `<q>${esc(e.wording)}</q><br>` : ''}${e.phone ? `Number ${esc(e.phone)} · ` : ''}${e.ip ? `IP ${esc(e.ip)} · ` : ''}${e.user_agent ? esc(e.user_agent.slice(0, 120)) : ''}${e.note ? `<br>${esc(e.note)}` : ''}${e.recorded_at !== e.at ? `<br>Recorded ${esc(when(e.recorded_at))}` : ''}</div></details></li>`;

NV.slot('customer.right', ({ c }) => {
  const t = c.tcpa;
  if (!t) return '';
  return `<div class="card" id="tc-card">
    <div class="card-head"><h2>Texts &amp; email consent</h2><button class="btn sm" id="tc-edit">Change</button></div>
    ${t.optedOut ? `<div class="alert warn"><div>📵 ${t.optedOut.source === 'office' ? 'The office turned off all texts to this number' : `This number texted ${esc(t.optedOut.keyword || 'STOP')}`}${t.optedOut.at ? ` on ${esc(fmtDate(t.optedOut.at))}` : ''}. Nothing is texted to it until they text START.</div>
      <button class="btn sm" id="tc-allow">They asked for texts again</button></div>` : ''}
    ${CH.map((ch) => {
      const s = t.channels[ch];
      const [label, cls] = stateText(ch, s, t);
      return `<div class="tc-row"><span>${NAMES[ch]}</span><span><span class="pill ${cls}">${esc(label)}</span>${s.source ? ` <span class="small muted">${esc(SOURCES[s.source] || s.source)}${s.at ? ` · ${esc(fmtDate(s.at))}` : ''}</span>` : ''}</span></div>`;
    }).join('')}
    <div class="small" style="margin-top:8px;display:flex;gap:14px;flex-wrap:wrap">
      ${t.events.length ? `<button class="link-btn" id="tc-hist-btn">History (${t.events.length})</button>` : '<span class="muted">Nothing recorded yet.</span>'}
      ${t.phone && !t.optedOut ? '<button class="link-btn" id="tc-stop">Stop all texts to this number</button>' : ''}
    </div>
    <ul class="tc-hist hidden" id="tc-hist">${t.events.map(historyItem).join('')}</ul>
  </div>`;
});

NV.on('customer.rendered', ({ c, view }) => {
  const t = c.tcpa;
  if (!t || !$('#tc-card', view)) return;
  const reload = () => (typeof route === 'function' ? route() : location.reload());
  if ($('#tc-hist-btn', view)) $('#tc-hist-btn', view).onclick = () => $('#tc-hist', view).classList.toggle('hidden');
  $('#tc-edit', view).onclick = () => {
    if (!FORMS) return toast('Reload the page and try again', true);
    const off = t.optedOut || !t.phone ? { sms_service: true, sms_marketing: true } : {};
    modal('Texts & email consent', `<p class="small">Read the words to the customer and check a box only if they say yes. Unchecking a box records that they said no.</p>
      ${consentBox(FORMS, c.lang === 'es' ? 'es' : 'en', { checked: shownChecked(t.channels), disabled: { ...off, email_marketing: !t.email } })}
      ${t.optedOut ? '<div class="hint">This number texted STOP, so text choices are locked until they text START or you use "They asked for texts again".</div>' : ''}
      <div class="field"><label>Note (optional)</label><input name="note" maxlength="300" placeholder="Said yes on the phone today"></div>`,
    [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => {
      await api(`/nuvolve/app/api/tcpa/customers/${c.id}/consent`, { body: { ...choicesIn(m), lang: $('[name=tcpa_lang]', m).value, note: $('[name=note]', m).value } });
      toast('Saved'); reload();
    } }]);
  };
  if ($('#tc-stop', view)) $('#tc-stop', view).onclick = () => modal('Stop all texts to this number?', `<p>Nothing will be texted to ${esc(c.phone)}: no reminders, no on-my-way texts, no offers, from anyone. It stays off until they text START or you turn it back on.</p>
    <div class="field"><label>How did they ask? (optional)</label><input name="note" maxlength="300" placeholder="Called and asked us to stop texting"></div>`,
  [{ label: 'Cancel' }, { label: 'Stop texts', cls: 'danger', onClick: async (m) => {
    await api(`/nuvolve/app/api/tcpa/customers/${c.id}/stop-texts`, { body: { note: $('[name=note]', m).value } });
    toast('Texts to this number are off'); reload();
  } }]);
  if ($('#tc-allow', view)) $('#tc-allow', view).onclick = () => modal('Turn texts back on?', `<p>Only do this if the customer asked you to text them again. Write down how they asked: it goes in the consent log.</p>
    <div class="field"><label>How did they ask?</label><input name="note" maxlength="300" placeholder="Called on 3/4 and asked to get texts again"></div>`,
  [{ label: 'Cancel' }, { label: 'Turn texts on', cls: 'primary', onClick: async (m) => {
    await api(`/nuvolve/app/api/tcpa/customers/${c.id}/allow-texts`, { body: { note: $('[name=note]', m).value } });
    toast('Texts are back on'); reload();
  } }]);
});

// ---------- office: the new customer and edit customer forms ----------
NV.slot('customer.new', () => (FORMS ? `<div class="field"><label>Texts and email</label>
  ${consentBox(FORMS, 'en')}
  <div class="hint">Read the words to the customer. Check a box only if they say yes. Service texts can still go to customers you already work for (Settings > Texting compliance).</div></div>` : ''));
NV.collector('customer.new', (root) => ($('[data-tc-box]', root) ? { consent: { ...choicesIn(root), lang: $('[name=tcpa_lang]', root).value } } : {}));

NV.slot('customer.form', ({ c }) => {
  const t = c.tcpa;
  if (!t || !FORMS) return '';
  const shown = shownChecked(t.channels);
  const off = t.optedOut || !t.phone ? { sms_service: true, sms_marketing: true } : {};
  return `<div class="field"><label>Texts and email</label>
    ${consentBox(FORMS, c.lang === 'es' ? 'es' : 'en', { checked: shown, disabled: { ...off, email_marketing: !t.email } })}
    <input type="hidden" name="tcpa_was" value="${CH.map((ch) => `${ch}:${shown[ch] ? 1 : 0}`).join(',')}">
    <div class="hint" data-tc-hint>${t.optedOut ? 'This number texted STOP. Texts stay off until they text START (or use "They asked for texts again" on their page).' : 'Check a box only if they said yes. Unchecking one records that they said no.'}</div></div>`;
});

// A new number starts over: its text boxes clear, and checking one records a yes for the new number.
NV.on('customer.form.rendered', ({ c, el }) => {
  const phone = $('[name=phone]', el), was = $('[name=tcpa_was]', el), hint = $('[data-tc-hint]', el);
  if (!phone || !was || !c.tcpa) return;
  const first = { was: was.value, hint: hint.textContent, boxes: ['sms_service', 'sms_marketing'].map((ch) => $(`[name=tcpa_${ch}]`, el)).filter(Boolean) };
  const keep = first.boxes.map((b) => [b.checked, b.disabled]);
  phone.addEventListener('change', () => {
    const d = phone.value.replace(/\D/g, '').slice(-10);
    const same = d === (c.tcpa.phone || '');
    first.boxes.forEach((b, i) => {
      b.checked = same ? keep[i][0] : false;
      b.disabled = same ? keep[i][1] : d.length !== 10;
    });
    was.value = same ? first.was : first.was.replace(/sms_(service|marketing):1/g, 'sms_$1:0');
    hint.textContent = same ? first.hint : d.length === 10 ? 'New number: ask the customer again before checking the text boxes.' : 'Add a phone number to record text consent.';
  });
});

// ---------- tech app: the customer says yes on the tech's phone ----------
NV.slot('tech.stopActions', ({ v }) => (v.phone && v.status !== 'completed' ? `<button type="button" class="btn big" id="tc-ask">📱 ${esc(NV.t('Texts OK?'))}</button>` : ''));
NV.on('tech.stop.rendered', ({ v, root }) => {
  const btn = $('#tc-ask', root);
  if (!btn) return;
  btn.onclick = async () => {
    let d;
    try { d = await api(`/nuvolve/app/api/tcpa/visits/${v.id}/consent`); } catch (e) { return toast(e.offline ? NV.t('No signal. Try again when you have one.') : e.message, true); }
    FORMS = d.forms;
    const only = [...(d.hasPhone ? ['sms_service', 'sms_marketing'] : []), ...(d.hasEmail ? ['email_marketing'] : [])];
    modal(NV.t('Can we text you?'), `<p>${esc(NV.t('Hand your phone to the customer. They check what they want and tap Save.'))}</p>
      ${d.optedOut ? `<div class="alert warn">${esc(NV.t('This number texted STOP. To get texts again, the customer texts START to the office number.'))}</div>` : ''}
      ${consentBox(d.forms, d.lang, { checked: shownChecked(d.channels), only, big: true, disabled: d.optedOut ? { sms_service: true, sms_marketing: true } : {} })}`,
    [{ label: NV.t('Cancel') }, { label: NV.t('Save'), cls: 'primary big', onClick: async (m) => {
      await api(`/nuvolve/app/api/tcpa/visits/${v.id}/consent`, { body: { ...choicesIn(m), lang: $('[name=tcpa_lang]', m).value } });
      toast(NV.t('Saved. Thank you!'));
    } }]);
  };
});

// ---------- customer portal: their own choices ----------
NV.slot('portal.cards', ({ data }) => {
  const t = data.tcpa;
  if (!t || (!t.hasPhone && !t.hasEmail)) return '';
  FORMS = t.forms;
  const only = [...(t.hasPhone ? ['sms_service', 'sms_marketing'] : []), ...(t.hasEmail ? ['email_marketing'] : [])];
  return `<div class="card" id="tc-portal"><h2>${esc(NV.t('How we contact you'))}</h2>
    ${t.optedOut ? `<div class="alert warn">${esc(data.company.phone ? NV.t('You texted STOP, so we don\'t text you. To get texts again, text START to {phone}.', { phone: data.company.phone }) : NV.t('You texted STOP, so we don\'t text you. To get texts again, text START to our number.'))}</div>` : ''}
    ${consentBox(t.forms, NV.lang, { checked: shownChecked(t.channels), only, disabled: t.optedOut ? { sms_service: true, sms_marketing: true } : {} })}
    <button class="btn primary block" id="tc-save">${esc(NV.t('Save my choices'))}</button></div>`;
});
NV.on('portal.rendered', ({ data, token, root }) => {
  const card = $('#tc-portal', root);
  if (!card) return;
  // This card covers offer emails, so the plain "Send me seasonal offers" switch below would say it twice.
  const core = $('#offers', root);
  if (core && data.tcpa.hasEmail) core.closest('label').remove();
  $('#tc-save', card).onclick = async (e) => {
    e.target.disabled = true;
    try {
      const r = await api(`/nuvolve/app/api/portal/${token}/consent`, { body: { ...choicesIn(card), lang: $('[name=tcpa_lang]', card).value } });
      data.tcpa.channels = r.channels;
      toast(NV.t('Saved. Thank you!'));
    } catch (err) { toast(err.message, true); } finally { e.target.disabled = false; }
  };
});

// ---------- booking form ----------
NV.slot('book.form', ({ d }) => {
  if (!d || !d.tcpa) return '';
  FORMS = d.tcpa.forms;
  // The page's language: the phone's, or what they picked with the English / Español link (selfserve-lang.js).
  return consentBox(FORMS, NV.lang === 'es' ? 'es' : 'en');
});

// ---------- Settings > Texting compliance ----------
NV.settingsTab({ key: 'texting', label: 'Texting compliance', render: async (box, d) => {
  const s = d.settings;
  box.innerHTML = '<div class="card"><p class="muted">Loading...</p></div>';
  const [sum, reg] = await Promise.all([api('/nuvolve/app/api/tcpa/summary'), api('/nuvolve/app/api/tcpa/a2p')]);
  const on = (k, dflt) => (s[k] === '1' || s[k] === '0' ? s[k] === '1' : dflt);
  const pill = (st) => `<span class="pill ${STATUS[st]?.[1] || ''}">${STATUS[st]?.[0] || esc(st)}</span>`;
  const wordingField = (ch, lang) => {
    const key = `tcpa_wording_${ch}${lang === 'es' ? '_es' : ''}`;
    return `<div class="field"><label>${NAMES[ch]} (${lang === 'es' ? 'Spanish' : 'English'})</label><textarea name="${key}" rows="3" maxlength="600" placeholder="${esc(FORMS?.[lang]?.[ch]?.wording || '')}">${esc(s[key] || '')}</textarea></div>`;
  };
  box.innerHTML = `
    <div class="card" style="max-width:860px">
      <h2>Texting compliance</h2>
      <p>Businesses that text customers get sued under the TCPA, and carriers block numbers that aren't registered. Nuvolve checks every text before it goes out:</p>
      <ul class="small">
        <li><b>Consent:</b> service texts need a yes on file or an existing customer. Marketing texts need a written yes, captured with the exact words on the booking form, the portal, the tech app or by the office.</li>
        <li><b>STOP:</b> anyone who texts STOP (or BAJA, ALTO, CANCEL...) gets one confirmation and nothing else, from any account, until they text START.</li>
        <li><b>Quiet hours:</b> texts that would land at night where the customer lives wait for morning. On-my-way and same-day texts that would be out of date are dropped instead.</li>
        <li><b>Registration:</b> marketing texts wait until the branch's 10DLC campaign is approved.</li>
      </ul>
      <div class="stats" style="margin-top:12px">
        <div class="stat"><div class="label">Texts sent, 30 days</div><div class="value">${sum.sent}</div></div>
        <div class="stat ${sum.blocked ? 'warn' : ''}"><div class="label">Stopped by the checks</div><div class="value">${sum.blocked}</div></div>
        <div class="stat"><div class="label">Waiting for morning</div><div class="value">${sum.waiting}</div><div class="sub">${sum.dropped} dropped as out of date</div></div>
        <div class="stat"><div class="label">Numbers that texted STOP</div><div class="value">${sum.optedOut}</div></div>
        <div class="stat"><div class="label">Said yes to offer texts</div><div class="value">${sum.marketingYes}</div></div>
      </div>
      ${sum.recentBlocked.length ? `<details style="margin-top:10px"><summary class="small">Recently stopped texts</summary><ul class="small">${sum.recentBlocked.map((m) => `<li>${esc(fmtDate(m.created_at))} · <a href="#/customers/${m.customer_id}">${esc(m.customer_name || 'Customer')}</a> · ${esc(m.kind || '')}: ${esc(m.error || '')}</li>`).join('')}</ul></details>` : ''}
    </div>

    <form class="card" id="tc-rules" style="max-width:860px">
      <h2>Rules</h2>
      <label class="check"><input type="checkbox" name="tcpa_quiet_on" ${on('tcpa_quiet_on', true) ? 'checked' : ''}> Hold texts during quiet hours</label>
      <div class="row" style="max-width:420px;margin-top:8px">
        <div class="field"><label>Texts can go from</label><input type="time" name="tcpa_quiet_start" min="08:00" max="12:00" value="${esc(s.tcpa_quiet_start || '08:00')}"></div>
        <div class="field"><label>Until</label><input type="time" name="tcpa_quiet_end" min="17:00" max="21:00" value="${esc(s.tcpa_quiet_end || '21:00')}"></div>
      </div>
      <div class="hint">In the customer's own time zone (from their state when it differs from yours). Marketing texts always keep to 8 AM to 9 PM, and to 8 PM in Florida, Maryland, Oklahoma and Washington; 9 AM in Texas (noon on Sunday).</div>
      <label class="check" style="margin-top:12px"><input type="checkbox" name="tcpa_existing_ok" ${on('tcpa_existing_ok', true) ? 'checked' : ''}> Existing customers count as consent for service texts</label>
      <div class="hint">People who gave you their number to do business (customers, and leads with a visit, estimate or request) get reminders, on-my-way texts and receipts unless they say no or text STOP. Turn off to need a recorded yes from everyone.</div>
      <label class="check" style="margin-top:12px"><input type="checkbox" name="tcpa_block_unapproved" ${on('tcpa_block_unapproved', true) ? 'checked' : ''}> Hold marketing texts until the branch's texting campaign is approved</label>
      <label class="check" style="margin-top:12px"><input type="checkbox" name="tcpa_twilio_replies" ${on('tcpa_twilio_replies', false) ? 'checked' : ''}> Twilio already answers STOP, START and HELP in English on our number</label>
      <div class="hint">Leave off unless your Twilio number sends its own replies, so customers don't get two answers. Spanish words (BAJA, ALTO, AYUDA) are always answered by Nuvolve.</div>
      <button class="btn primary" style="margin-top:12px">Save rules</button>
    </form>

    <form class="card" id="tc-wording" style="max-width:860px">
      <h2>Consent wording</h2>
      <p class="small muted">What customers see next to each checkbox on the booking form, the portal and the tech app, and what the office reads out. Leave a box empty to use the standard wording shown in gray. {company} becomes your company name. Text wording must say they can reply STOP. If you change the English, change the Spanish too.</p>
      ${CH.map((ch) => `<div class="row">${wordingField(ch, 'en')}${wordingField(ch, 'es')}</div>`).join('')}
      <button class="btn primary">Save wording</button>
    </form>

    <div class="card" style="max-width:860px">
      <div class="card-head"><h2>10DLC registration</h2>${reg.live ? '<span class="pill green">Twilio connected</span>' : '<span class="pill">Demo mode: set it by hand</span>'}</div>
      <p class="small">Carriers only deliver business texts from numbers registered under a <b>brand</b> (your legal business name and EIN) and a <b>campaign</b> (what the texts are for). In Twilio: Messaging > Regulatory compliance > A2P 10DLC. Register the brand, then a campaign (use "Mixed" for reminders and offers), and add your number to the campaign's messaging service. Approval takes a few days to a few weeks. Branches you don't set up use the main branch's registration.</p>
      <div class="table-wrap"><table class="list"><thead><tr><th>Branch</th><th>Brand</th><th>Campaign</th><th>Sends from</th><th></th></tr></thead><tbody>
        ${reg.branches.map((b) => `<tr><td><b>${esc(b.name)}</b>${b.uses_main ? '<div class="small muted">Uses the main branch</div>' : ''}</td>
          <td>${pill(b.brand_status)}</td><td>${pill(b.campaign_status)}${b.campaign_id ? `<div class="small mono">${esc(b.campaign_id)}</div>` : ''}</td>
          <td class="small">${esc(b.messaging_service_sid || b.from_number || (b.uses_main ? '' : 'Company number'))}</td>
          <td class="nowrap"><button class="btn sm" data-a2p="${b.location_id}">Edit</button>${reg.live && b.own && (b.brand_sid || b.messaging_service_sid) ? ` <button class="btn sm" data-a2p-check="${b.location_id}">Check status</button>` : ''}</td></tr>
          ${b.note ? `<tr><td colspan="5" class="small muted">${esc(b.note)}</td></tr>` : ''}`).join('')}
      </tbody></table></div>
    </div>

    <div class="card" style="max-width:860px">
      <h2>Consent log</h2>
      <p class="small">Every yes and no with where it came from, the exact words, who recorded it, the IP and browser, and when. Keep it for at least four years.</p>
      <div class="actions" style="justify-content:flex-start"><a class="btn" href="/nuvolve/app/api/tcpa/consent.csv">⬇️ Download the consent log (CSV)</a>
        <label class="btn" style="margin:0">⬆️ Import from another system<input type="file" id="tc-import" accept=".csv,text/csv" hidden></label></div>
      <div class="hint">The import matches customers by phone or email. Columns: phone, email, service_texts, marketing_texts, marketing_email (yes or no), stopped (yes for numbers that texted STOP), date, wording, note.</div>
    </div>`;

  const save = async (body) => {
    await api('/nuvolve/app/api/settings', { method: 'PUT', body });
    if (typeof refreshBoot === 'function') await refreshBoot();
    if (typeof BOOT !== 'undefined' && BOOT.tcpa) FORMS = BOOT.tcpa.forms; // the new wording, for the forms on this page
    toast('Saved');
  };
  $('#tc-rules').onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    try { await save({ ...f, tcpa_quiet_on: f.tcpa_quiet_on ? '1' : '0', tcpa_existing_ok: f.tcpa_existing_ok ? '1' : '0', tcpa_block_unapproved: f.tcpa_block_unapproved ? '1' : '0', tcpa_twilio_replies: f.tcpa_twilio_replies ? '1' : '0' }); } catch (err) { toast(err.message, true); }
  };
  $('#tc-wording').onsubmit = async (e) => {
    e.preventDefault();
    try { await save(formData(e.target)); } catch (err) { toast(err.message, true); }
  };
  $('#tc-import').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const r = await api('/nuvolve/app/api/tcpa/import', { body: { csv: await file.text(), filename: file.name } });
      toast(`Imported: ${r.matched} customers matched, ${r.events} changes, ${r.optouts} stopped numbers${r.skipped ? `, ${r.skipped} rows skipped` : ''}`);
    } catch (err) { toast(err.message, true); }
    e.target.value = '';
  };
  $$('[data-a2p-check]', box).forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { const r = await api(`/nuvolve/app/api/tcpa/a2p/${b.dataset.a2pCheck}/check`, { method: 'POST' }); toast(`Brand ${STATUS[r.brand_status][0].toLowerCase()}, campaign ${STATUS[r.campaign_status][0].toLowerCase()}`); route(); } catch (err) { toast(err.message, true); b.disabled = false; }
  }));
  $$('[data-a2p]', box).forEach((b) => (b.onclick = () => {
    const r = reg.branches.find((x) => x.location_id === Number(b.dataset.a2p));
    const opts = (cur) => Object.entries(STATUS).map(([k, [label]]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${label}</option>`).join('');
    modal(`10DLC: ${r.name}`, `
      <div class="row"><div class="field"><label>Brand status</label><select name="brand_status">${opts(r.own ? r.brand_status : 'not_started')}</select></div>
      <div class="field"><label>Brand registration id</label><input name="brand_sid" placeholder="BN..." value="${esc(r.brand_sid || '')}"></div></div>
      <div class="row"><div class="field"><label>Campaign status</label><select name="campaign_status">${opts(r.own ? r.campaign_status : 'not_started')}</select></div>
      <div class="field"><label>Campaign id</label><input name="campaign_id" placeholder="CABC123" value="${esc(r.campaign_id || '')}"></div></div>
      <div class="field"><label>Messaging service id</label><input name="messaging_service_sid" placeholder="MG..." value="${esc(r.messaging_service_sid || '')}"><div class="hint">This branch's texts go through it. Or leave it empty and enter the number below.</div></div>
      <div class="field"><label>Sending number</label><input name="from_number" type="tel" placeholder="(214) 555-0100" value="${esc(r.from_number || '')}"></div>
      <div class="field"><label>Notes</label><input name="note" maxlength="500" value="${esc(r.note || '')}" placeholder="What the carrier asked us to fix"></div>
      ${r.uses_main ? '<div class="hint">Saving gives this branch its own registration instead of the main branch\'s.</div>' : ''}`,
    [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (m) => {
      await api(`/nuvolve/app/api/tcpa/a2p/${r.location_id}`, { method: 'PUT', body: formData(m) });
      toast('Saved'); route();
    } }]);
  }));
} });

})(); } catch (e) { console.error('feature tcpa.js failed to load', e); }

/* ---- features/trust.js ---- */
try { (function () {
// Your data is yours: "Download everything" in Settings → Import & export (with photos or without, the monthly
// email, the last download and the last backup check), and a download on the paused-account screen.
// The server side is src/features/trust-export.js; the guarantee in words is the public /data page.

// Fetched, then saved, so a refusal (two-factor needed, a download already running) shows as a message.
async function downloadEverything(btn, photos) {
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Making your file...';
  try {
    const res = await fetch(`/nuvolve/app/api/export/everything${photos ? '?photos=1' : ''}`, { credentials: 'same-origin' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "The download didn't work. Try again.");
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'nuvolve-data.zip';
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast(`Saved ${name}`);
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  } finally {
    btn.disabled = false;
    btn.textContent = was;
  }
}

// Any "download everything" button, wherever it is drawn (the locked screen has no rendered event).
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('[data-export-all]');
  if (!btn || btn.disabled) return;
  e.preventDefault();
  downloadEverything(btn, Boolean(document.getElementById('xa-photos')?.checked)).then((ok) => { if (ok) NV.emit('export.downloaded', {}); });
});

NV.slot('settings.data', () => `<p>Download everything your company keeps in Nuvolve, any time, free: customers, plans, service history,
  chemical records, invoices, payments, estimates and contracts, documents, messages and the activity log. You get spreadsheets
  that open in Excel, plus one JSON file with all of it.</p>
  <p class="small muted">It works after a trial ends or a plan is canceled too. Passwords and keys are left out. <a href="/nuvolve/data.html" target="_blank" rel="noopener">How it works</a></p>
  <div id="xa-body"><p class="small muted">Loading...</p></div>`);

const when = (t) => (t ? new Date(`${String(t).replace(' ', 'T')}Z`).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

function backupLine(b) {
  if (!b) return 'Backups are made every night and checked the next day: opened on their own, the way a restore would, and compared with your live data.';
  const n = b.tables?.customers?.backup;
  return b.ok
    ? `✓ Last night's backup (${fmtDate(b.day)}) opened on its own and checked out${n != null ? `: ${n} customers, ${b.tables.visits?.backup ?? 0} visits, ${b.tables.invoices?.backup ?? 0} invoices` : ''}.`
    : `⚠️ The check of the ${fmtDate(b.day)} backup didn't pass. We've been told; your live data isn't affected.`;
}

async function drawExport(box) {
  const body = box.querySelector('#xa-body');
  if (!body) return;
  let st;
  try { st = await api('/nuvolve/app/api/export/status'); } catch (e) { body.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; return; }
  const last = st.last ? `<p class="small">Last downloaded ${esc(when(st.last.at))}${st.last.by ? ` by ${esc(st.last.by)}` : ''}.</p>` : '';
  body.innerHTML = `${st.owner
    ? `<div class="actions"><button class="btn primary" data-export-all>Download everything</button><label class="check"><input type="checkbox" id="xa-photos"> Include photos</label></div>
      <p class="small muted">A big account can take a minute. Photos make the file much bigger.</p>`
    : `<div class="alert info">Only the account owner${st.ownerName ? ` (${esc(st.ownerName)})` : ''} can download everything.</div>`}
    ${last}
    <label class="check"><input type="checkbox" id="xa-monthly" ${st.monthly ? 'checked' : ''} ${st.owner ? '' : 'disabled'}> Email the owner a copy every month</label>
    <div class="small muted">The first one comes within a few hours, then one early on the 1st of each month. Photos aren't in it, and over 10 MB you get a link instead.${st.monthlySent ? ` Last sent for ${esc(st.monthlySent)}.` : ''}</div>
    <p class="small muted" style="margin-top:12px">${esc(backupLine(st.backup))}</p>`;
  const monthly = body.querySelector('#xa-monthly');
  if (st.owner) {
    monthly.onchange = async () => {
      try {
        await api('/nuvolve/app/api/export/settings', { method: 'PUT', body: { monthly: monthly.checked } });
        toast(monthly.checked ? "You'll get a copy every month" : 'Monthly copy turned off');
      } catch (e) { monthly.checked = !monthly.checked; toast(e.message, true); }
    };
  }
}

NV.on('settings.data.rendered', ({ box }) => drawExport(box));
NV.on('export.downloaded', () => { const box = document.getElementById('tab'); if (box && box.querySelector('#xa-body')) drawExport(box); });

// The paused screen: the owner can still take everything with them.
NV.slot('locked.actions', ({ me }) => (me?.role === 'owner'
  ? '<p class="small" style="text-align:center;margin-top:14px">Your data is yours either way. <button class="link-btn" data-export-all>Download everything</button>, free.</p>'
  : ''));

})(); } catch (e) { console.error('feature trust.js failed to load', e); }
