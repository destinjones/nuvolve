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

async function load() {
  if (!token || token === 'portal') return emailLogin();
  try {
    D = await api(`/nuvolve/app/api/portal/${token}`);
  } catch (e) {
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
  render();
  if (q.get('paid')) {
    toast('Payment received. Thank you!');
    history.replaceState(null, '', location.pathname);
  }
}

const tipAmount = () => (tipCustom != null ? tipCustom : Math.round(D.balance * tipPct) / 100);

function render() {
  const c = D.company;
  app.innerHTML = `
    <div class="hero">
      <div class="co">${esc(c.name || '')}</div>
      <h1>Hi ${esc((D.customer.name || '').split(' ')[0])}!</h1>
      ${c.message ? `<div style="opacity:.9;font-size:14px;max-width:440px;margin:0 auto">${esc(c.message)}</div>` : ''}
    </div>
    <div class="wrap">
      <div class="card due">
        ${D.balance > 0 ? `
          <div class="muted">Amount due</div>
          <div class="amt">${money(D.balance)}</div>
          ${D.openInvoices.map((i) => `<div class="line small"><span>${esc(i.description || 'Service')} <span class="muted">· due ${fmtDate(i.due_date)}</span> <a href="/nuvolve/app/api/portal/${token}/invoices/${i.id}" target="_blank" rel="noopener">View invoice</a></span><b>${money(i.amount - i.amount_paid)}</b></div>`).join('')}
          ${D.tipsEnabled !== false ? `<div style="text-align:left;margin-top:14px">
            <label>Add a tip for your technician? (100% goes to them)</label>
            <div class="tips">${[0, 10, 15, 20].map((p) => `<button data-tip="${p}" class="${tipCustom == null && tipPct === p ? 'on' : ''}">${p ? p + '%' : 'No tip'}</button>`).join('')}</div>
            <div style="margin-top:6px"><input id="tip-custom" type="number" step="1" min="0" inputmode="decimal" placeholder="Or enter a tip amount" value="${tipCustom ?? ''}"></div>
          </div>` : ''}
          <label class="check" style="margin:14px 0 4px;justify-content:center"><input type="checkbox" id="save" ${D.customer.autopay ? 'checked' : ''}> Save my card and pay automatically after each service</label>
          <button class="btn primary big block" id="pay" style="margin-top:10px">Pay ${money(D.balance + tipAmount())}</button>
          <div class="small muted" style="margin-top:8px">🔒 Secure card payment${D.stripeEnabled ? ' by Stripe' : ' (demo mode, no real charge)'}</div>`
        : `<div style="font-size:40px">✅</div><h2>You're all paid up</h2><p class="muted">Thank you!</p>`}
      </div>

      <div class="card">
        <h2>Autopay</h2>
        ${D.customer.card ? `<p>${esc(D.customer.card)} is saved.</p>
          <label class="check"><input type="checkbox" id="autopay" ${D.customer.autopay ? 'checked' : ''}> Charge this card automatically after each service</label>`
          : '<p class="muted">Tick "Save my card" next time you pay and you never have to think about a bill again.</p>'}
      </div>

      ${D.upcoming.length ? `<div class="card"><h2>Upcoming service</h2>${D.upcoming.map((u) => `<div class="line"><span><b>${fmtDate(u.date, { weekday: 'long', month: 'long', day: 'numeric' })}</b>${u.time_window ? ` · ${esc(u.time_window)}` : ''}<br><span class="small muted">${esc(u.service_name || '')} at ${esc(u.address)}</span></span>
        ${u.move_requested ? '<span class="pill yellow">Move requested</span>' : `<button class="btn sm" data-move="${u.id}">Change day</button>`}</div>`).join('')}</div>` : ''}

      <div class="card">
        <h2>Need us sooner?</h2>
        <p class="small muted">Seeing activity between visits? Re-treats are on us. Tell us what's going on.</p>
        <div class="field"><textarea id="req" placeholder="Ants in the kitchen by the sink..."></textarea></div>
        <div class="field"><label>Best day for you (optional)</label><input id="req-date" type="date" min="${todayStr()}"></div>
        <button class="btn primary block" id="send">Request service</button>
        ${c.phone ? `<p class="small" style="text-align:center;margin-top:10px">Or call us: <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></p>` : ''}
      </div>

      <div id="sightings-card"></div>

      ${D.history.length ? `<div class="card"><h2>Service history</h2>${D.history.map((h) => `<div class="line" style="display:block">
        <div style="display:flex;justify-content:space-between"><b>${fmtDate(h.date)}</b><span class="small muted">${esc(h.tech_name || '')}</span></div>
        <div class="small muted">${esc(h.service_name || '')}${h.target_pests ? ' · ' + esc(h.target_pests) : ''}</div>
        ${h.tech_notes ? `<div class="small">${esc(h.tech_notes)}</div>` : ''}
        ${h.products?.length ? `<div class="small" style="margin-top:4px">🧪 ${h.products.map((p) => `${esc(p.name)}${p.epa_reg ? ` <span class="muted">(EPA ${esc(p.epa_reg)})</span>` : ''}`).join(', ')}</div>` : ''}
        <div class="small" style="margin-top:4px"><a href="/nuvolve/app/api/portal/${token}/report?visit=${h.id}" target="_blank" rel="noopener">Service report</a></div>
        ${h.photos?.length ? `<div class="photos">${h.photos.map((p) => `<figure class="ph"><a href="/nuvolve/app/api/portal/${token}/photos/${p.id}" target="_blank" rel="noopener"><img src="/nuvolve/app/api/portal/${token}/photos/${p.id}" alt="Service photo" loading="lazy"></a>
          <figcaption>${p.kind === 'issue' ? '<span class="pill yellow">Found</span> ' : ''}${esc(p.caption || '')}</figcaption></figure>`).join('')}</div>` : ''}</div>`).join('')}</div>` : ''}

      ${D.history.length ? `<div class="card"><h2>Pesticide records</h2><p class="small muted">Every product applied at your home in the last 12 months, with EPA numbers and the licensed applicator. Handy for landlords, HOAs, and anyone with kids, pets or allergies.</p>
        <a class="btn block" href="/nuvolve/app/api/portal/${token}/report" target="_blank" rel="noopener">View pesticide application record</a>
        ${D.hasDevices ? `<a class="btn block" style="margin-top:8px" href="/nuvolve/app/api/portal/${token}/device-report" target="_blank" rel="noopener">View station inspection report</a>` : ''}</div>` : ''}

      ${D.invoices?.length ? `<div class="card"><h2>Invoices</h2>${D.invoices.map((i) => `<div class="line small"><span>#${i.id} · ${fmtDate(i.date)}<br><span class="muted">${esc(i.description || 'Service')}</span></span>
        <span style="text-align:right">${money(i.amount)}<br><a href="/nuvolve/app/api/portal/${token}/invoices/${i.id}" target="_blank" rel="noopener">${i.status === 'paid' ? 'Receipt' : 'View'}</a></span></div>`).join('')}</div>` : ''}

      ${D.agreements?.length ? `<div class="card"><h2>Estimates and agreements</h2>${D.agreements.map((a) => `<div class="line"><span>${esc(a.title || 'Service agreement')} <span class="small muted">${a.status === 'accepted' ? `signed ${fmtDate(a.accepted_at)}` : 'waiting for your signature'}</span></span>
        <a class="btn sm ${a.status === 'accepted' ? '' : 'primary'}" href="/nuvolve/app/sign/${esc(a.token)}">${a.status === 'accepted' ? 'View' : 'Review and sign'}</a></div>`).join('')}</div>` : ''}

      ${D.contracts?.length ? `<div class="card"><h2>Contracts</h2>${D.contracts.map((k) => `<div class="line"><span>${esc(k.title)} <span class="small muted">${k.status === 'awaiting' ? 'waiting for your signature'
        : k.status === 'cancelled' ? 'cancelled' : `signed ${fmtDate(String(k.signed_at || '').slice(0, 10))}${k.cancel_open ? `. You can cancel until ${fmtDate(k.cancel_by)}` : ''}`}</span></span>
        ${k.url ? `<a class="btn sm ${k.status === 'awaiting' ? 'primary' : ''}" href="${esc(k.url)}">${k.status === 'awaiting' ? 'Review and sign' : 'View'}</a>` : ''}</div>`).join('')}</div>` : ''}

      ${D.payments.length ? `<div class="card"><h2>Payments</h2>${D.payments.map((p) => `<div class="line small"><span>${fmtDate(p.date)} · ${esc(p.method)}${p.tip ? ` · includes ${money(p.tip)} tip` : ''}</span><b>${money(p.amount + (p.tip || 0))}</b></div>`).join('')}</div>` : ''}

      ${D.referral?.enabled ? `<div class="card"><h2>🎁 Give ${money(D.referral.friendReward)}, get ${money(D.referral.reward)}</h2>
        <p class="small">Know someone with bugs? ${D.referral.friendReward ? `They get ${money(D.referral.friendReward)} off` : 'Send them our way'} and you get a ${money(D.referral.reward)} credit after their first service.</p>
        ${D.referral.link ? `<div class="field"><input id="ref-link" readonly value="${esc(D.referral.link)}"></div>
          <div class="row"><button class="btn primary" id="ref-share">Share my link</button><a class="btn" href="sms:?&body=${encodeURIComponent(`I use ${c.name || 'these guys'} for pest control. Book with my link and get ${money(D.referral.friendReward)} off: ${D.referral.link}`)}">Text it</a></div>`
          : `<p>Or have them mention your code: <b>${esc(D.referral.code)}</b></p>`}
        ${D.referral.referred ? `<p class="small muted" style="margin-top:8px">You've referred ${D.referral.referred} ${D.referral.referred === 1 ? 'person' : 'people'} ${D.referral.earned ? ` and earned ${money(D.referral.earned)}` : ''}. Thank you!</p>` : ''}</div>` : ''}

      ${D.referral ? `<label class="check small" style="justify-content:center;margin-bottom:8px"><input type="checkbox" id="offers" ${D.referral.optedOut ? '' : 'checked'}> Send me seasonal offers</label>` : ''}

      <p class="small muted" style="text-align:center">${esc(c.name || '')}${c.phone ? ' · ' + esc(c.phone) : ''}${c.email ? ' · ' + esc(c.email) : ''}</p>
    </div>`;

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
  $$('[data-move]').forEach((b) => (b.onclick = () => {
    const u = D.upcoming.find((x) => x.id === Number(b.dataset.move));
    modal('Change your service day', `<p>Your visit is on <b>${fmtDate(u.date, { weekday: 'long', month: 'long', day: 'numeric' })}</b>. Tell us a better day and we'll confirm it.</p>
      <div class="field"><label>Better day</label><input name="preferred_date" type="date" min="${todayStr()}"></div>
      <div class="field"><label>Anything else? (optional)</label><input name="note" placeholder="Mornings work best, gate will be open..."></div>`,
    [{ label: 'Cancel' }, { label: 'Send request', cls: 'primary', onClick: async (m) => {
      await api(`/nuvolve/app/api/portal/${token}/reschedule`, { body: { visit_id: u.id, ...formData(m) } });
      toast("Got it. We'll confirm your new day.");
      await load();
    } }]);
  }));
  portalSightings();
  $('#send').onclick = async () => {
    try {
      await api(`/nuvolve/app/api/portal/${token}/request`, { body: { message: $('#req').value, preferred_date: $('#req-date').value } });
      $('#req').value = '';
      toast("Got it! We'll reach out to schedule.");
    } catch (err) { toast(err.message, true); }
  };
}

async function pay(e) {
  const btn = e.currentTarget;
  const body = { save_card: $('#save').checked, tip: tipAmount() };
  btn.disabled = true;
  try {
    const r = await api(`/nuvolve/app/api/portal/${token}/pay`, { body });
    if (r.url) return (location.href = r.url);
    // Demo mode: a pretend card form.
    modal('Pay by card', `
      <div class="alert info">Demo mode: use any test number. No real money moves.</div>
      <div class="field"><label>Card number</label><input name="card_number" value="4242 4242 4242 4242" inputmode="numeric"></div>
      <div class="row"><div class="field"><label>Expires</label><input value="12/30"></div><div class="field"><label>CVC</label><input value="123"></div></div>
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
  let S;
  try { S = await api(`/nuvolve/app/api/portal/${token}/sightings`); } catch { return; }
  if (!S.sightings) return;
  box.innerHTML = `<div class="card"><h2>Pest sighting log</h2>
    <p class="small muted">Saw a pest between visits? Log it here. Your technician checks every open sighting on the next service, and it all goes in your audit binder.</p>
    <button class="btn primary block" id="log-sighting">+ Log a sighting</button>
    ${S.sightings.length ? `<div style="margin-top:10px">${S.sightings.map((x) => `<div class="sighting ${x.status === 'open' ? '' : 'done'}"><div><b>${esc(x.pest)}</b>${x.count ? ` (${x.count})` : ''}${x.location ? ` · ${esc(x.location)}` : ''}
      <div class="small muted">${fmtDate(x.seen_at)}${S.sites.length > 1 ? ` · ${esc(x.site)}` : ''}${x.reported_by ? ` · ${esc(x.reported_by)}` : ''}</div>
      ${x.action_taken ? `<div class="small">✓ ${esc(x.action_taken)}</div>` : ''}</div>
      ${x.status === 'open' ? '<span class="pill yellow">Open</span>' : '<span class="pill green">Handled</span>'}</div>`).join('')}</div>` : ''}
    <a class="btn block" style="margin-top:10px" href="/nuvolve/app/api/portal/${token}/audit-binder" target="_blank" rel="noopener">📁 Open audit binder</a></div>`;
  $('#log-sighting', box).onclick = () => sightingModal(S.pests, async (body) => {
    await api(`/nuvolve/app/api/portal/${token}/sightings`, { body });
    toast('Thanks. Your technician will check it.');
    portalSightings();
  }, S.sites.length > 1 ? `<div class="field"><label>Which site</label><select name="property_id">${S.sites.map((x) => `<option value="${x.id}">${esc(x.site_name || x.address)}</option>`).join('')}</select></div>` : '');
}

load();
