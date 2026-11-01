// The customer's estimate: read it, sign it on the phone, and keep the signed copy. The link is the login.
const app = document.getElementById('app');
const token = location.pathname.replace(/\/$/, '').split('/').pop();
let D = null;
// A rep who opened this on their tablet at the door gets a way back to the door map.
const fromSell = new URLSearchParams(location.search).get('from') === 'sell';
// In the customer's language (src/lang/es/pages.js). A sentence with the office phone in it gets the number as a link.
const t = (text, vars) => NV.t(text, vars);
const withPhone = (text, phone) => esc(text).replace('{phone}', `<a href="tel:${esc(phone)}">${esc(phone)}</a>`);

async function load() {
  try { D = await api(`/nuvolve/app/api/sign/${token}`); } catch (e) {
    app.innerHTML = `<div class="wrap" style="margin-top:40px"><div class="card"><h2>${esc(t('Link not found'))}</h2><p>${esc(t(e.message))}</p></div></div>`;
    return;
  }
  await NV.useLang(NV.preferredLang(D.lang));
  render();
}

function render() {
  const { company: co, customer: cu, property: pr, estimate: e } = D;
  const addr = pr ? [pr.address, pr.city, [pr.state, pr.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';
  const signed = e.status === 'accepted';
  document.title = signed ? t('Signed agreement · {company}', { company: co.name || '' }) : t('Estimate from {company}', { company: co.name || t('us') });
  app.innerHTML = `
    <div class="hero"><div class="co">${esc(co.name || '')}</div>
      <h1>${esc(signed ? t('Your signed service agreement') : e.status === 'declined' ? t('Estimate declined') : e.title ? t('Your estimate: {title}', { title: e.title }) : t('Your estimate'))}</h1></div>
    <div class="wrap">
      <div class="card">
        <div class="line" style="display:block"><b>${esc(cu.name || '')}</b>${addr ? `<div class="small muted">${esc(addr)}</div>` : ''}</div>
        ${e.notes ? `<p style="margin-top:10px">${esc(e.notes)}</p>` : ''}
        ${e.items.map((i) => `<div class="line"><span><b>${esc(i.name)}</b><div class="small muted">${FREQ[i.frequency] ? esc(t(FREQ[i.frequency])) : ''}${i.description ? ` · ${esc(i.description)}` : ''}</div></span><b class="nowrap">${money(i.price)}${i.frequency === 'one_time' ? '' : `<span class="small muted">${esc(t('/visit'))}</span>`}</b></div>`).join('')}
        <div class="totals"><span>${esc(t('Per visit'))} <b>${money(e.perVisit)}</b></span><span>${esc(t('First year'))} <b>${money(e.firstYear)}</b></span></div>
        ${!signed && e.valid_until ? `<p class="small muted" style="margin-top:8px">${esc(t(e.status === 'expired' ? 'This estimate expired {date}.' : 'Good until {date}.', { date: fmtDate(e.valid_until) }))}</p>` : ''}
      </div>
      <div class="card"><h2>${esc(t('Service agreement'))}</h2><div class="terms">${esc(e.terms)}</div></div>
      <div class="card" id="act"></div>
      ${fromSell ? `<p class="no-print" style="text-align:center"><a class="btn ${signed ? 'primary big' : ''}" href="/nuvolve/app/sell">${signed ? '🚪 Next door' : '← Back to the door map'}</a></p>` : ''}
      <p class="small muted" style="text-align:center">${esc(co.name || '')}${co.phone ? ` · <a href="tel:${esc(co.phone)}">${esc(co.phone)}</a>` : ''}${co.email ? ` · ${esc(co.email)}` : ''}${co.license_no ? ` · ${esc(t('License {number}', { number: co.license_no }))}` : ''}</p>
    </div>`;
  const act = $('#act');
  if (signed) {
    act.innerHTML = `<h2>${esc(t('✅ Signed'))}</h2>
      <img class="signed-sig" src="${e.signature}" alt="${esc(t('Signature of {name}', { name: e.signer_name }))}">
      <p><b>${esc(e.signer_name)}</b><br><span class="small">${new Date(e.accepted_at.replace(' ', 'T') + 'Z').toLocaleString(NV.lang === 'es' ? 'es-US' : undefined)}</span></p>
      <p class="meta">${esc(t('Agreement #{id}', { id: e.id }))}${e.signer_ip ? ` · ${esc(t('signed from {ip}', { ip: e.signer_ip }))}` : ''}<br>${esc(t('Tamper check (SHA-256): {hash}', { hash: e.signed_hash || '' }))}</p>
      <button class="btn no-print" data-print>${esc(t('Print or save as PDF'))}</button>`;
  } else if (e.status === 'declined') {
    act.innerHTML = `<p>${esc(e.decline_reason ? t('You declined this estimate: "{reason}".', { reason: e.decline_reason }) : t('You declined this estimate.'))}
      ${co.phone ? withPhone(t("Changed your mind? Call us at {phone} and we'll send a fresh one."), co.phone) : esc(t("Changed your mind? Call us and we'll send a fresh one."))}</p>`;
  } else if (e.status === 'expired') {
    act.innerHTML = `<p>${co.phone ? withPhone(t("This estimate has expired. Call us at {phone} and we'll send an updated one."), co.phone) : esc(t("This estimate has expired. Call us and we'll send an updated one."))}</p>`;
  } else {
    act.innerHTML = `<h2>${esc(t('Accept and sign'))}</h2>
      <div class="field"><label for="nm">${esc(t('Your full name'))}</label><input id="nm" autocomplete="name" value="${esc(cu.name || '')}"></div>
      <div class="field"><label>${esc(t('Sign here with your finger or mouse'))}</label><canvas class="sig" id="sig"></canvas><button type="button" class="link-btn small" id="clr">${esc(t('Clear'))}</button></div>
      <label class="check"><input type="checkbox" id="agree"> ${esc(t('I agree to the service agreement above and authorize {company} to provide these services.', { company: co.name || t('the company') }))}</label>
      ${D.autorenew ? `<div class="alert warn" id="ar-box" style="display:block;margin-top:12px;white-space:pre-line"><b>${esc(t('Automatic renewal'))}</b>\n${esc(D.autorenew.text)}</div>
      <label class="check"><input type="checkbox" id="agree-ar"> ${esc(t('I understand this plan renews automatically and I will be charged until I cancel.'))}</label>` : ''}
      <button class="btn primary big block" id="ok" style="margin-top:12px">${esc(t('Sign and accept'))}</button>
      <p style="text-align:center;margin-top:12px"><button class="link-btn small" id="no">${esc(t('No thanks'))}</button></p>`;
    const pad = signaturePad($('#sig'));
    $('#clr').onclick = () => pad.clear();
    $('#ok').onclick = async (ev) => {
      const sig = pad.value();
      if (!sig) return toast(t('Please sign in the box'), true);
      if (!$('#agree').checked) return toast(t('Tick the box to agree to the terms'), true);
      if (D.autorenew && !$('#agree-ar').checked) return toast(t('Tick the box to agree to the automatic renewal'), true);
      ev.target.disabled = true;
      try {
        await api(`/nuvolve/app/api/sign/${token}/accept`, { body: { name: $('#nm').value, signature: sig, agree: true, agree_autorenew: Boolean(D.autorenew) } });
        toast(t('Signed. Thank you!'));
        await load();
        window.scrollTo(0, document.body.scrollHeight);
      } catch (err) { toast(t(err.message), true); ev.target.disabled = false; }
    };
    $('#no').onclick = () => modal(t('Not right for you?'), `<div class="field"><label>${esc(t('Mind telling us why? (optional)'))}</label><textarea name="reason" placeholder="${esc(t('Price, timing, went with someone else...'))}"></textarea></div>`, [
      { label: t('Back') }, { label: t('Decline estimate'), cls: 'danger', onClick: async (m) => { await api(`/nuvolve/app/api/sign/${token}/decline`, { body: formData(m) }); await load(); } }]);
  }
}

load();
