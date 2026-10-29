// Customer offer page: claim a save discount, or restart service from a win-back offer. No login; the link is the key.
const token = location.pathname.split('/').pop();
const app = document.getElementById('app');
let O = null;

const callUs = () => (O.phone ? `<p>Questions? Call <a href="tel:${esc(O.phone)}">${esc(O.phone)}</a>.</p>` : '');

async function load() {
  try { O = await api(`/nuvolve/app/api/offer/${token}`); } catch (e) { app.innerHTML = `<h2>Link not found</h2><p class="muted">${esc(e.message)}</p>`; return; }
  if (O.status === 'accepted') return showDone();
  if (O.status === 'declined') { app.innerHTML = `<h1>Thanks for letting us know</h1><p>We appreciate you.</p>${callUs()}`; return; }
  if (O.status === 'expired') { app.innerHTML = `<h1>This offer has expired</h1><p>Give us a call and we will still take care of you.</p>${callUs()}`; return; }
  const save = O.kind === 'save';
  const until = fmtDate(O.expires_at, { month: 'long', day: 'numeric' });
  app.innerHTML = `
    <div class="muted">${esc(O.company)}</div>
    <h1 style="margin-top:6px">${save ? `Thank you${O.first_name ? ', ' + esc(O.first_name) : ''}!` : `We miss you${O.first_name ? ', ' + esc(O.first_name) : ''}`}</h1>
    <div class="deal">${O.percent}% off</div>
    <p><b>${save ? (O.visits === 1 ? 'your next service' : `your next ${O.visits} services`) : 'your first visit back'}</b></p>
    ${save && O.next_visit ? `<p class="muted">Your next visit is ${fmtDay(O.next_visit)}. It will be ${money(O.next_price)}.</p>` : ''}
    ${!save && O.service_name ? `<p class="muted">Restart your ${esc(O.service_name)}${O.frequency ? ` (${esc(FREQ[O.frequency] || O.frequency)})` : ''}. Your first visit is scheduled a few days from now, and we'll confirm the day.</p>` : ''}
    <button class="btn primary big block" id="yes">${save ? '🎁 Claim my discount' : '🏠 Restart my service'}</button>
    <p class="small muted">Good until ${until}.</p>
    <button class="linkish" id="no">No thanks</button>`;
  document.getElementById('yes').onclick = async (e) => {
    e.target.disabled = true;
    try { O = await api(`/nuvolve/app/api/offer/${token}/accept`, { method: 'POST' }); showDone(); } catch (err) { toast(err.message, true); e.target.disabled = false; }
  };
  document.getElementById('no').onclick = showNo;
}

function showDone() {
  const save = O.kind === 'save';
  app.innerHTML = `
    <div style="font-size:48px">${save ? '🎉' : '🏠'}</div>
    <h1>${save ? 'Your discount is on!' : 'Welcome back!'}</h1>
    <p>${save
      ? `${O.percent}% off is applied to ${O.visits === 1 ? 'your next service' : `your next ${O.visits} services`}${O.next_visit ? `, starting ${fmtDay(O.next_visit)}` : ''}. Nothing else to do.`
      : `Your service is back on. We'll reach out to confirm your first visit, and it's ${O.percent}% off.`}</p>
    ${callUs()}`;
}

function showNo() {
  app.innerHTML = `
    <h1>No problem</h1>
    <p>Would you tell us why? It helps a small local business get better.</p>
    <div class="field"><textarea id="why" placeholder="Price, still seeing bugs, moved..."></textarea></div>
    <button class="btn primary big block" id="send">Send</button>
    <button class="linkish" id="back">Actually, I'll take the offer</button>`;
  document.getElementById('send').onclick = async () => {
    try {
      await api(`/nuvolve/app/api/offer/${token}/decline`, { body: { reason: document.getElementById('why').value } });
      app.innerHTML = `<div style="font-size:44px">🙏</div><h1>Thank you</h1><p>We read every one of these.</p>${callUs()}`;
    } catch (e) { toast(e.message, true); }
  };
  document.getElementById('back').onclick = load;
}

load();
