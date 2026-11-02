// Customer pay portal. The secret link in the URL is the login.
const app = document.getElementById('app');
const token = location.pathname.replace(/\/$/, '').split('/').pop();
let D = null;
let tipPct = 0;
let tipCustom = null;

// /nuvolve/app/portal with no link: customer enters their email and we send them their link.
function emailLogin() {
  app.innerHTML = `<div class="hero"><h1>See your account and pay your bill</h1></div>
    <div class="wrap"><div class="card">
      <p>Enter the email we have on file and we'll send you a secure link. No password needed.</p>
      <div class="field"><input id="em" type="email" placeholder="you@example.com" autocomplete="email"></div>
      <button class="btn primary big block" id="go">Email me my link</button>
    </div></div>`;
  $('#go').onclick = async () => {
    await api('/nuvolve/app/api/portal-login', { body: { email: $('#em').value } });
    $('.card').innerHTML = '<div style="font-size:40px;text-align:center">📬</div><h2 style="text-align:center">Check your email</h2><p style="text-align:center">If that email is on file, your link is on its way.</p>';
  };
}

// The designer in Settings shows this page in a frame at /nuvolve/app/portal/preview, with a sample customer, and sends
// each change to the design over postMessage so the preview redraws as the owner works.
const PREVIEW = token === 'preview';
if (PREVIEW) {
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.type !== 'nv-portal-design' || !D) return;
    D.design = { ...D.design, ...e.data.design, logoUrl: e.data.design.logo === false ? null : D.logoAsset };
    if ('message' in e.data) D.company.message = e.data.message;
    if ('tips' in e.data) D.tipsEnabled = e.data.tips;
    if ('paid' in e.data) D.balance = e.data.paid ? 0 : 129;
    render();
  });
}

async function load() {
  if (!token || token === 'portal') return emailLogin();
  if (PREVIEW) {
    try { D = await api('/nuvolve/app/api/portal-preview'); } catch (e) { app.innerHTML = `<div class="wrap" style="margin-top:40px"><div class="card"><h2>Preview</h2><p>${esc(e.message)}</p></div></div>`; return; }
    D.logoAsset = D.design.logoUrl;
    render();
    parent.postMessage({ type: 'nv-portal-ready' }, location.origin);
    return;
  }
  try {
    D = await api(`/nuvolve/app/api/portal/${token}`);
  } catch (e) {
    if (e.status === 410) return expiredLink(app, 'portal', token, e.message);
    app.innerHTML = `<div class="wrap" style="margin-top:40px"><div class="card"><h2>Link not found</h2><p>${esc(e.message)}</p></div></div>`;
    return;
  }
  const q = new URLSearchParams(location.search);
  // Opt-out link at the bottom of marketing emails.
  if (q.get('stop') === 'marketing') {
    await api(`/nuvolve/app/api/portal/${token}/marketing`, { body: { optOut: true } }).catch(() => {});
    history.replaceState(null, '', location.pathname);
    setTimeout(() => toast("Done. We won't send you offers anymore. You'll still get service and billing messages."), 50);
  }
  D.referral = await api(`/nuvolve/app/api/portal/${token}/referral`).catch(() => null);
  // Spanish speakers see their page in Spanish (their account setting, or what they picked on this device).
  await NV.useLang(NV.preferredLang(D.customer.lang));
  render();
  if (q.get('paid')) {
    toast('Payment received. Thank you!');
    history.replaceState(null, '', location.pathname);
  }
}

const tipAmount = () => (tipCustom != null ? tipCustom : Math.round(D.balance * tipPct) / 100);

// How a payment was made, in the customer's words rather than the code stored with it.
const PAY_METHODS = { card: 'Card', autopay: 'Autopay', ach: 'Bank transfer', cash: 'Cash', check: 'Check', credit: 'Account credit', returned: 'Returned bank payment', other: 'Other' };
const payMethod = (m) => PAY_METHODS[m] || (m ? String(m).charAt(0).toUpperCase() + String(m).slice(1) : 'Payment');

// One finished visit, one invoice, one payment: the same lines on the page and in the full history.
function visitLine(h) {
  return `<div class="line" style="display:block">
        <div style="display:flex;justify-content:space-between"><b>${fmtDate(h.date)}</b><span class="small muted">${esc(h.tech_name || '')}</span></div>
        <div class="small muted">${esc(h.service_name || '')}${h.target_pests ? ' · ' + esc(h.target_pests) : ''}</div>
        ${h.tech_notes ? `<div class="small">${esc(h.tech_notes)}</div>` : ''}
        ${h.products?.length ? `<div class="small" style="margin-top:4px">🧪 ${h.products.map((p) => `${esc(p.name)}${p.epa_reg ? ` <span class="muted">(EPA ${esc(p.epa_reg)})</span>` : ''}`).join(', ')}</div>` : ''}
        <div class="small" style="margin-top:4px"><a href="/nuvolve/app/api/portal/${token}/report?visit=${h.id}" target="_blank" rel="noopener">Service report</a></div>
        ${h.photos?.length ? `<div class="photos">${h.photos.map((p) => `<figure class="ph"><a href="/nuvolve/app/api/portal/${token}/photos/${p.id}" target="_blank" rel="noopener"><img src="/nuvolve/app/api/portal/${token}/photos/${p.id}" alt="Service photo" loading="lazy"></a>
          <figcaption>${p.kind === 'issue' ? '<span class="pill yellow">Found</span> ' : ''}${esc(p.caption || '')}</figcaption></figure>`).join('')}</div>` : ''}</div>`;
}
const invoiceLine = (i) => `<div class="line small"><span>${esc(i.number || `#${i.id}`)} · ${fmtDate(i.date)}<br><span class="muted">${esc(i.description || 'Service')}</span></span>
        <span style="text-align:right">${money(i.amount)}<br><a href="/nuvolve/app/api/portal/${token}/invoices/${i.id}" target="_blank" rel="noopener">${i.status === 'paid' ? 'Receipt' : 'View'}</a></span></div>`;
const paymentLine = (p) => `<div class="line small"><span>${fmtDate(p.date)} · ${esc(payMethod(p.method))}${p.tip ? ` · includes ${money(p.tip)} tip` : ''}</span><b>${money(p.amount + (p.tip || 0))}</b></div>`;

// Everything the customer has with us, not just the latest: services, invoices, payments and each year's
// pesticide records. Opens over the page; Back returns to it.
async function fullHistory(tab = 'services') {
  if (D.preview) return toast('Preview only');
  let H;
  try { H = await api(`/nuvolve/app/api/portal/${token}/history`); } catch (e) { return toast(e.message, true); }
  const TABS = [['services', 'Services', H.visits.length], ['invoices', 'Invoices', H.invoices.length], ['payments', 'Payments', H.payments.length], ['records', 'Pesticide records', H.years.length]];
  const draw = (t) => {
    const body = {
      services: () => (H.visits.length ? H.visits.map(visitLine).join('') : '<p class="muted">No finished services yet.</p>'),
      invoices: () => (H.invoices.length ? H.invoices.map(invoiceLine).join('') : '<p class="muted">No invoices yet.</p>'),
      payments: () => (H.payments.length ? H.payments.map(paymentLine).join('') : '<p class="muted">No payments yet.</p>'),
      records: () => `<p class="small muted">Each record lists every product applied at your property that year, with EPA registration numbers, amounts and the licensed applicator.</p>
        ${H.years.length ? H.years.map((y) => `<div class="line"><span><b>${esc(y)}</b></span><a class="btn sm" href="/nuvolve/app/api/portal/${token}/report?from=${y}-01-01&to=${y}-12-31" target="_blank" rel="noopener">View ${esc(y)} record</a></div>`).join('') : '<p class="muted">No pesticide applications on record yet.</p>'}
        ${D.hasDevices ? `<a class="btn block" style="margin-top:8px" href="/nuvolve/app/api/portal/${token}/device-report" target="_blank" rel="noopener">View station inspection report</a>` : ''}`,
    }[t]();
    app.innerHTML = `${brandCss(design())}<div class="hero" style="${heroStyle(design())};padding-bottom:60px"><div class="co">${esc(D.company.name || '')}</div><h1>Your full history</h1></div>
      <div class="wrap"><div class="card">
        <button class="btn sm" id="back">← Back to my account</button>
        <div class="pd-tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0">${TABS.map(([k, label, n]) => `<button class="btn sm ${k === t ? 'primary' : ''}" data-tab="${k}">${label} <span class="${k === t ? '' : 'muted'}">${n}</span></button>`).join('')}</div>
        ${body}
      </div></div>`;
    $('#back').onclick = () => { render(); scrollTo(0, 0); };
    $$('[data-tab]').forEach((b) => (b.onclick = () => draw(b.dataset.tab)));
    NV.emit('portal.rendered', { data: D, token, root: app, rerender: render, reload: load });
  };
  draw(tab);
  scrollTo(0, 0);
}

// The owner's design (Settings → Customer page): which boxes, in what order, the words, the color and logo.
const DESIGN_DEFAULT = { blocks: ['autopay', 'upcoming', 'request', 'sightings', 'history', 'records', 'invoices', 'agreements', 'payments', 'referral'].map((key) => ({ key, on: true })),
  words: {}, options: { tech_names: true, photos: true, reschedule: true, save_card: true, full_history: true }, color: '', hero: 'gradient', logo: true, logoUrl: null };
const WORD = {
  headline: 'Hi {first}!', due_label: 'Amount due', pay_button: 'Pay {amount}', tip_label: 'Add a tip for your technician? (100% goes to them)',
  paid_title: "You're all paid up", paid_text: 'Thank you!', request_title: 'Need us sooner?',
  request_text: "Seeing activity between visits? Re-treats are on us. Tell us what's going on.", footer_note: '',
};
const design = () => ({ ...DESIGN_DEFAULT, ...(D.design || {}), options: { ...DESIGN_DEFAULT.options, ...(D.design?.options || {}) } });
// One of the page's words, as safe HTML: the owner's own if they wrote one, else the built-in, with {first},
// {amount} and {company} filled in (vars are already escaped).
function word(key, vars = {}) {
  const own = D.design?.words?.[key];
  const text = own != null && own !== '' ? own : WORD[key];
  return esc(String(text)).replace(/\{(first|amount|company)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
}
const isHex = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ''));
// A darker shade of the brand color for the gradient's far end.
const shade = (hex, f = 0.55) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * f).toString(16).padStart(2, '0')).join('');
// The owner's color on buttons and links.
const brandCss = (d) => (isHex(d.color) ? `<style>:root{--brand:${d.color}} .btn.primary{background:${d.color};border-color:${d.color}} .tips button.on{background:${d.color};border-color:${d.color}} #app a:not(.btn){color:${d.color}}</style>` : '');
function heroStyle(d) {
  const col = isHex(d.color) ? d.color : '#2f855a';
  if (d.hero === 'solid') return `background:${col};color:#fff`;
  if (d.hero === 'light') return `background:var(--panel);color:var(--ink);border-bottom:4px solid ${col}`;
  return `background:linear-gradient(160deg, ${shade(col)}, ${col});color:#fff`;
}

function render() {
  const c = D.company;
  const d = design();
  const vars = { first: esc((D.customer.name || '').split(' ')[0]), company: esc(c.name || ''), amount: money(D.balance + tipAmount()) };
  // Each box the owner can show, hide or move. They draw nothing when there is nothing to show.
  const BOX = {
    autopay: () => `<div class="card">
        <h2>Autopay</h2>
        ${D.customer.card ? `<p>${esc(D.customer.card)} is saved.</p>
          <label class="check"><input type="checkbox" id="autopay" ${D.customer.autopay ? 'checked' : ''}> Charge this card automatically after each service</label>`
          : '<p class="muted">Tick "Save my card" next time you pay and you never have to think about a bill again.</p>'}
      </div>`,
    upcoming: () => (D.upcoming.length ? `<div class="card"><h2>Upcoming service</h2>${D.upcoming.map((u) => `<div class="line"><span><b>${fmtDate(u.date, { weekday: 'long', month: 'long', day: 'numeric' })}</b>${u.time_window ? ` · ${esc(u.time_window)}` : ''}<br><span class="small muted">${esc(u.service_name || '')} at ${esc(u.address)}</span></span>
        ${u.move_requested ? '<span class="pill yellow">Move requested</span>' : d.options.reschedule ? `<button class="btn sm" data-move="${u.id}">Change day</button>` : ''}</div>`).join('')}</div>` : ''),
    request: () => `<div class="card">
        <h2>${word('request_title', vars)}</h2>
        <p class="small muted">${word('request_text', vars)}</p>
        <div class="field"><textarea id="req" placeholder="Ants in the kitchen by the sink..."></textarea></div>
        <div class="field"><label>Best day for you (optional)</label><input id="req-date" type="date" min="${todayStr()}"></div>
        <label class="check" style="margin-bottom:8px"><input type="checkbox" id="req-urgent"> ${esc(NV.t('Today, please: it can\'t wait'))}</label>
        <button class="btn primary block" id="send">Request service</button>
        ${c.phone ? `<p class="small" style="text-align:center;margin-top:10px">Or call us: <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></p>` : ''}
      </div>`,
    sightings: () => '<div id="sightings-card"></div>',
    history: () => (D.history.length ? `<div class="card"><h2>Service history</h2>${D.history.map(visitLine).join('')}
        ${d.options.full_history ? '<button class="btn block" data-full="services" style="margin-top:8px">See full history</button>' : ''}</div>` : ''),
    records: () => (D.history.length ? `<div class="card"><h2>Pesticide records</h2><p class="small muted">Every product applied at your home in the last 12 months, with EPA numbers and the licensed applicator. Handy for landlords, HOAs, and anyone with kids, pets or allergies.</p>
        <a class="btn block" href="/nuvolve/app/api/portal/${token}/report" target="_blank" rel="noopener">View pesticide application record</a>
        ${D.hasDevices ? `<a class="btn block" style="margin-top:8px" href="/nuvolve/app/api/portal/${token}/device-report" target="_blank" rel="noopener">View station inspection report</a>` : ''}
        ${d.options.full_history ? '<button class="btn block" data-full="records" style="margin-top:8px">Records from other years</button>' : ''}</div>` : ''),
    invoices: () => (D.invoices?.length ? `<div class="card"><h2>Invoices</h2>${D.invoices.map(invoiceLine).join('')}
        ${d.options.full_history ? '<button class="btn block" data-full="invoices" style="margin-top:8px">See all invoices</button>' : ''}</div>` : ''),
    agreements: () => `${D.agreements?.length ? `<div class="card"><h2>Estimates and agreements</h2>${D.agreements.map((a) => `<div class="line"><span>${esc(a.title || 'Service agreement')} <span class="small muted">${a.status === 'accepted' ? `signed ${fmtDate(a.accepted_at)}` : 'waiting for your signature'}</span></span>
        <a class="btn sm ${a.status === 'accepted' ? '' : 'primary'}" href="/nuvolve/app/sign/${esc(a.token)}">${a.status === 'accepted' ? 'View' : 'Review and sign'}</a></div>`).join('')}</div>` : ''}
      ${D.contracts?.length ? `<div class="card"><h2>Contracts</h2>${D.contracts.map((k) => `<div class="line"><span>${esc(k.title)} <span class="small muted">${k.status === 'awaiting' ? 'waiting for your signature'
        : k.status === 'cancelled' ? 'cancelled' : `signed ${fmtDate(String(k.signed_at || '').slice(0, 10))}${k.cancel_open ? `. You can cancel until ${fmtDate(k.cancel_by)}` : ''}`}</span></span>
        ${k.url ? `<a class="btn sm ${k.status === 'awaiting' ? 'primary' : ''}" href="${esc(k.url)}">${k.status === 'awaiting' ? 'Review and sign' : 'View'}</a>` : ''}</div>`).join('')}</div>` : ''}`,
    payments: () => (D.payments.length ? `<div class="card"><h2>Payments</h2>${D.payments.map(paymentLine).join('')}
        ${d.options.full_history ? '<button class="btn block" data-full="payments" style="margin-top:8px">See all payments</button>' : ''}</div>` : ''),
    referral: () => (D.referral?.enabled ? `<div class="card"><h2>🎁 Give ${money(D.referral.friendReward)}, get ${money(D.referral.reward)}</h2>
        <p class="small">Know someone with bugs? ${D.referral.friendReward ? `They get ${money(D.referral.friendReward)} off` : 'Send them our way'} and you get a ${money(D.referral.reward)} credit after their first service.</p>
        ${D.referral.link ? `<div class="field"><input id="ref-link" readonly value="${esc(D.referral.link)}"></div>
          <div class="row"><button class="btn primary" id="ref-share">Share my link</button><a class="btn" href="sms:?&body=${encodeURIComponent(`I use ${c.name || 'these guys'} for pest control. Book with my link and get ${money(D.referral.friendReward)} off: ${D.referral.link}`)}">Text it</a></div>`
          : `<p>Or have them mention your code: <b>${esc(D.referral.code)}</b></p>`}
        ${D.referral.referred ? `<p class="small muted" style="margin-top:8px">You've referred ${D.referral.referred} ${D.referral.referred === 1 ? 'person' : 'people'} ${D.referral.earned ? ` and earned ${money(D.referral.earned)}` : ''}. Thank you!</p>` : ''}</div>` : ''),
  };
  app.innerHTML = `
    ${brandCss(d)}
    <div class="hero" style="${heroStyle(d)}">
      ${d.logoUrl ? `<img class="portal-logo" src="${esc(d.logoUrl)}" alt="${esc(c.name || '')}" style="max-height:52px;max-width:200px;margin:0 auto 8px;display:block;${d.hero === 'light' ? '' : 'background:#fff;padding:6px 10px;border-radius:10px'}">` : ''}
      <div class="co">${esc(c.name || '')}</div>
      <h1>${word('headline', vars)}</h1>
      ${c.message ? `<div style="opacity:.9;font-size:14px;max-width:440px;margin:0 auto">${esc(c.message)}</div>` : ''}
    </div>
    <div class="wrap">
      ${D.preview ? '<div class="alert info small" style="margin-bottom:8px">Preview with a sample customer. Buttons are turned off.</div>' : ''}
      <div class="card due">
        ${D.balance > 0 ? `
          <div class="muted">${word('due_label', vars)}</div>
          <div class="amt">${money(D.balance)}</div>
          ${D.openInvoices.map((i) => `<div class="line small"><span>${esc(i.description || 'Service')} <span class="muted">· due ${fmtDate(i.due_date)}</span> <a href="/nuvolve/app/api/portal/${token}/invoices/${i.id}" target="_blank" rel="noopener">View invoice</a></span><b>${money(i.amount - i.amount_paid)}</b></div>`).join('')}
          ${D.tipsEnabled !== false ? `<div style="text-align:left;margin-top:14px">
            <label>${word('tip_label', vars)}</label>
            <div class="tips">${[0, 10, 15, 20].map((p) => `<button data-tip="${p}" class="${tipCustom == null && tipPct === p ? 'on' : ''}">${p ? p + '%' : 'No tip'}</button>`).join('')}</div>
            <div style="margin-top:6px"><input id="tip-custom" type="number" step="1" min="0" inputmode="decimal" placeholder="Or enter a tip amount" value="${tipCustom ?? ''}"></div>
          </div>` : ''}
          ${d.options.save_card ? `<label class="check" style="margin:14px 0 4px;justify-content:center"><input type="checkbox" id="save" ${D.customer.autopay ? 'checked' : ''}> Save my card and pay automatically after each service</label>` : ''}
          <button class="btn primary big block" id="pay" style="margin-top:10px">${word('pay_button', vars)}</button>
          <div class="small muted" style="margin-top:8px">🔒 Secure card payment${D.stripeEnabled ? ' by Stripe' : ' (demo mode, no real charge)'}</div>`
        : `<div style="font-size:40px">✅</div><h2>${word('paid_title', vars)}</h2><p class="muted">${word('paid_text', vars)}</p>`}
      </div>
      ${NV.slots('portal.top', { data: D, token })}

      ${d.blocks.filter((b) => b.on && BOX[b.key]).map((b) => BOX[b.key]()).join('\n')}

      ${NV.slots('portal.cards', { data: D, token })}

      ${D.referral ? `<label class="check small" style="justify-content:center;margin-bottom:8px"><input type="checkbox" id="offers" ${D.referral.optedOut ? '' : 'checked'}> Send me seasonal offers</label>` : ''}

      ${window.NVTheme ? `<div class="small muted" style="text-align:center;margin-bottom:10px">Screen: ${NVTheme.picker()}</div>` : ''}

      ${word('footer_note', vars) ? `<p class="small" style="text-align:center">${word('footer_note', vars)}</p>` : ''}
      <p class="small muted" style="text-align:center">${esc(c.name || '')}${c.phone ? ' · ' + esc(c.phone) : ''}${c.email ? ' · ' + esc(c.email) : ''}</p>
    </div>`;
  if (D.preview) {
    // Nothing on the preview reaches the server: every button just says so.
    $$('button, a[href], input, textarea', app).forEach((el) => { if (el.closest('.tips') || el.id === 'tip-custom') return; el.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); toast('Preview only'); }, true); });
  }
  $$('[data-full]').forEach((b) => (b.onclick = () => fullHistory(b.dataset.full)));
  if ($('#ref-share')) $('#ref-share').onclick = async () => {
    const link = D.referral.link;
    try {
      if (navigator.share) await navigator.share({ title: c.name || 'Pest control', text: `Book with my link and get ${money(D.referral.friendReward)} off`, url: link });
      else { await navigator.clipboard.writeText(link); toast('Link copied'); }
    } catch { $('#ref-link').select(); }
  };
  if ($('#offers')) $('#offers').onchange = async (e) => {
    try { await api(`/nuvolve/app/api/portal/${token}/marketing`, { body: { optOut: !e.target.checked } }); D.referral.optedOut = !e.target.checked; toast(e.target.checked ? "You'll get our seasonal offers" : 'Offers turned off'); } catch (err) { toast(err.message, true); }
  };
  $$('[data-tip]').forEach((b) => (b.onclick = () => { tipPct = Number(b.dataset.tip); tipCustom = null; render(); }));
  const tc = $('#tip-custom');
  if (tc) tc.onchange = () => { tipCustom = tc.value === '' ? null : Math.max(0, Number(tc.value)); render(); };
  if ($('#pay')) $('#pay').onclick = pay;
  if ($('#autopay')) $('#autopay').onchange = async (e) => {
    try { await api(`/nuvolve/app/api/portal/${token}/autopay`, { body: { on: e.target.checked } }); toast(e.target.checked ? 'Autopay is on' : 'Autopay is off'); } catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; }
  };
  // Changing the day can be taken over by a feature (pick a real open slot): NV.override('portal.move').
  $$('[data-move]').forEach((b) => (b.onclick = () => NV.run('portal.move', { visit: D.upcoming.find((x) => x.id === Number(b.dataset.move)), data: D, token, reload: load }, () => {
    const u = D.upcoming.find((x) => x.id === Number(b.dataset.move));
    modal('Change your service day', `<p>Your visit is on <b>${fmtDate(u.date, { weekday: 'long', month: 'long', day: 'numeric' })}</b>. Tell us a better day and we'll confirm it.</p>
      <div class="field"><label>Better day</label><input name="preferred_date" type="date" min="${todayStr()}"></div>
      <div class="field"><label>Anything else? (optional)</label><input name="note" placeholder="Mornings work best, gate will be open..."></div>`,
    [{ label: 'Cancel' }, { label: 'Send request', cls: 'primary', onClick: async (m) => {
      await api(`/nuvolve/app/api/portal/${token}/reschedule`, { body: { visit_id: u.id, ...formData(m) } });
      toast("Got it. We'll confirm your new day.");
      await load();
    } }]);
  })));
  portalSightings();
  NV.emit('portal.rendered', { data: D, token, root: app, rerender: render, reload: load });
  if ($('#send')) $('#send').onclick = async () => {
    try {
      await api(`/nuvolve/app/api/portal/${token}/request`, { body: { message: $('#req').value, preferred_date: $('#req-date').value, urgent: Boolean($('#req-urgent')?.checked) } });
      $('#req').value = '';
      if ($('#req-urgent')) $('#req-urgent').checked = false;
      toast("Got it! We'll reach out to schedule.");
    } catch (err) { toast(err.message, true); }
  };
}

async function pay(e) {
  const btn = e.currentTarget;
  const body = { save_card: Boolean($('#save')?.checked), tip: tipAmount() };
  btn.disabled = true;
  try {
    const r = await api(`/nuvolve/app/api/portal/${token}/pay`, { body });
    if (r.url) return (location.href = r.url);
    // Demo mode: a pretend card form.
    modal('Pay by card', `
      <div class="alert info">Demo mode: use any test number. No real money moves.</div>
      <div class="field"><label>Card number</label><input name="card_number" value="4242 4242 4242 4242" inputmode="numeric"></div>
      <div class="row"><div class="field"><label>Expires</label><input name="exp" value="12/30"></div><div class="field"><label>CVC</label><input value="123"></div></div>
      <p><b>Total: ${money(r.amount + body.tip)}</b>${body.tip ? ` <span class="muted small">(includes ${money(body.tip)} tip)</span>` : ''}</p>`,
    [{ label: 'Cancel' }, { label: `Pay ${money(r.amount + body.tip)}`, cls: 'primary', onClick: async (m) => {
      await api(`/nuvolve/app/api/portal/${token}/demo-pay`, { body: { ...formData(m), ...body } });
      tipPct = 0; tipCustom = null;
      toast('Payment received. Thank you!');
      await load();
    } }]);
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

// Commercial accounts: the site's staff keep the pest sighting log here, and print the audit binder.
async function portalSightings() {
  const box = $('#sightings-card');
  if (!box) return;
  let S;
  if (D.preview) S = D.sightings;
  else try { S = await api(`/nuvolve/app/api/portal/${token}/sightings`); } catch { return; }
  if (!S.sightings) return;
  box.innerHTML = `<div class="card"><h2>Pest sighting log</h2>
    <p class="small muted">Saw a pest between visits? Log it here. Your technician checks every open sighting on the next service, and it all goes in your audit binder.</p>
    <button class="btn primary block" id="log-sighting">+ Log a sighting</button>
    ${S.sightings.length ? `<div style="margin-top:10px">${S.sightings.map((x) => `<div class="sighting ${x.status === 'open' ? '' : 'done'}"><div><b>${esc(x.pest)}</b>${x.count ? ` (${x.count})` : ''}${x.location ? ` · ${esc(x.location)}` : ''}
      <div class="small muted">${fmtDate(x.seen_at)}${S.sites.length > 1 ? ` · ${esc(x.site)}` : ''}${x.reported_by ? ` · ${esc(x.reported_by)}` : ''}</div>
      ${x.action_taken ? `<div class="small">✓ ${esc(x.action_taken)}</div>` : ''}</div>
      ${x.status === 'open' ? '<span class="pill yellow">Open</span>' : '<span class="pill green">Handled</span>'}</div>`).join('')}</div>` : ''}
    <a class="btn block" style="margin-top:10px" href="/nuvolve/app/api/portal/${token}/audit-binder" target="_blank" rel="noopener">📁 Open audit binder</a></div>`;
  if (D.preview) return;
  $('#log-sighting', box).onclick = () => sightingModal(S.pests, async (body) => {
    await api(`/nuvolve/app/api/portal/${token}/sightings`, { body });
    toast('Thanks. Your technician will check it.');
    portalSightings();
  }, S.sites.length > 1 ? `<div class="field"><label>Which site</label><select name="property_id">${S.sites.map((x) => `<option value="${x.id}">${esc(x.site_name || x.address)}</option>`).join('')}</select></div>` : '');
}

load();
