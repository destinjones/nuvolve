// Customer offer page: claim a save discount, or restart service from a win-back offer. No login; the link is the key.
const token = location.pathname.split('/').pop();
const app = document.getElementById('app');
let O = null;

// In the customer's language (src/lang/es/pages.js).
const t = (text, vars) => NV.t(text, vars);
const callUs = () => (O.phone ? `<p>${esc(t('Questions? Call {phone}.')).replace('{phone}', `<a href="tel:${esc(O.phone)}">${esc(O.phone)}</a>`)}</p>` : '');

async function load() {
  try { O = await api(`/nuvolve/app/api/offer/${token}`); } catch (e) { app.innerHTML = `<h2>${esc(t('Link not found'))}</h2><p class="muted">${esc(t(e.message))}</p>`; return; }
  await NV.useLang(NV.preferredLang(O.lang));
  document.title = t('Your offer');
  if (O.status === 'accepted') return showDone();
  if (O.status === 'declined') { app.innerHTML = `<h1>${esc(t('Thanks for letting us know'))}</h1><p>${esc(t('We appreciate you.'))}</p>${callUs()}`; return; }
  if (O.status === 'expired') { app.innerHTML = `<h1>${esc(t('This offer has expired'))}</h1><p>${esc(t('Give us a call and we will still take care of you.'))}</p>${callUs()}`; return; }
  const save = O.kind === 'save';
  const until = fmtDate(O.expires_at, { month: 'long', day: 'numeric' });
  app.innerHTML = `
    <div class="muted">${esc(O.company)}</div>
    <h1 style="margin-top:6px">${esc(save ? (O.first_name ? t('Thank you, {name}!', { name: O.first_name }) : t('Thank you!')) : O.first_name ? t('We miss you, {name}', { name: O.first_name }) : t('We miss you'))}</h1>
    <div class="deal">${esc(t('{percent}% off', { percent: O.percent }))}</div>
    <p><b>${esc(save ? what() : t('your first visit back'))}</b></p>
    ${save && O.next_visit ? `<p class="muted">${esc(t('Your next visit is {day}. It will be {price}.', { day: fmtDay(O.next_visit), price: money(O.next_price) }))}</p>` : ''}
    ${!save && O.service_name ? `<p class="muted">${esc(O.frequency ? t("Restart your {service} ({often}). Your first visit is scheduled a few days from now, and we'll confirm the day.", { service: O.service_name, often: t(FREQ[O.frequency] || O.frequency) })
    : t("Restart your {service}. Your first visit is scheduled a few days from now, and we'll confirm the day.", { service: O.service_name }))}</p>` : ''}
    <button class="btn primary big block" id="yes">${esc(save ? t('🎁 Claim my discount') : t('🏠 Restart my service'))}</button>
    <p class="small muted">${esc(t('Good until {date}.', { date: until }))}</p>
    <button class="linkish" id="no">${esc(t('No thanks'))}</button>`;
  document.getElementById('yes').onclick = async (e) => {
    e.target.disabled = true;
    try { O = await api(`/nuvolve/app/api/offer/${token}/accept`, { method: 'POST' }); showDone(); } catch (err) { toast(t(err.message), true); e.target.disabled = false; }
  };
  document.getElementById('no').onclick = showNo;
}

const what = () => (O.visits === 1 ? t('your next service') : t('your next {n} services', { n: O.visits }));

function showDone() {
  const save = O.kind === 'save';
  app.innerHTML = `
    <div style="font-size:48px">${save ? '🎉' : '🏠'}</div>
    <h1>${esc(save ? t('Your discount is on!') : t('Welcome back!'))}</h1>
    <p>${esc(save
    ? (O.next_visit ? t('{percent}% off is applied to {what}, starting {day}. Nothing else to do.', { percent: O.percent, what: what(), day: fmtDay(O.next_visit) })
      : t('{percent}% off is applied to {what}. Nothing else to do.', { percent: O.percent, what: what() }))
    : t("Your service is back on. We'll reach out to confirm your first visit, and it's {percent}% off.", { percent: O.percent }))}</p>
    ${callUs()}`;
}

function showNo() {
  app.innerHTML = `
    <h1>${esc(t('No problem'))}</h1>
    <p>${esc(t('Would you tell us why? It helps a small local business get better.'))}</p>
    <div class="field"><textarea id="why" placeholder="${esc(t('Price, still seeing bugs, moved...'))}"></textarea></div>
    <button class="btn primary big block" id="send">${esc(t('Send'))}</button>
    <button class="linkish" id="back">${esc(t("Actually, I'll take the offer"))}</button>`;
  document.getElementById('send').onclick = async () => {
    try {
      await api(`/nuvolve/app/api/offer/${token}/decline`, { body: { reason: document.getElementById('why').value } });
      app.innerHTML = `<div style="font-size:44px">🙏</div><h1>${esc(t('Thank you'))}</h1><p>${esc(t('We read every one of these.'))}</p>${callUs()}`;
    } catch (e) { toast(t(e.message), true); }
  };
  document.getElementById('back').onclick = load;
}

load();
