// The customer's estimate: read it, sign it on the phone, and keep the signed copy. The link is the login.
const app = document.getElementById('app');
const token = location.pathname.replace(/\/$/, '').split('/').pop();
let D = null;
// A rep who opened this on their tablet at the door gets a way back to the door map.
const fromSell = new URLSearchParams(location.search).get('from') === 'sell';

async function load() {
  try { D = await api(`/nuvolve/app/api/sign/${token}`); } catch (e) {
    app.innerHTML = `<div class="wrap" style="margin-top:40px"><div class="card"><h2>Link not found</h2><p>${esc(e.message)}</p></div></div>`;
    return;
  }
  render();
}

function render() {
  const { company: co, customer: cu, property: pr, estimate: e } = D;
  const addr = pr ? [pr.address, pr.city, [pr.state, pr.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';
  const signed = e.status === 'accepted';
  document.title = signed ? `Signed agreement · ${co.name || ''}` : `Estimate from ${co.name || 'us'}`;
  app.innerHTML = `
    <div class="hero"><div class="co">${esc(co.name || '')}</div>
      <h1>${signed ? 'Your signed service agreement' : e.status === 'declined' ? 'Estimate declined' : `Your estimate${e.title ? `: ${esc(e.title)}` : ''}`}</h1></div>
    <div class="wrap">
      <div class="card">
        <div class="line" style="display:block"><b>${esc(cu.name || '')}</b>${addr ? `<div class="small muted">${esc(addr)}</div>` : ''}</div>
        ${e.notes ? `<p style="margin-top:10px">${esc(e.notes)}</p>` : ''}
        ${e.items.map((i) => `<div class="line"><span><b>${esc(i.name)}</b><div class="small muted">${FREQ[i.frequency] || ''}${i.description ? ` · ${esc(i.description)}` : ''}</div></span><b class="nowrap">${money(i.price)}${i.frequency === 'one_time' ? '' : '<span class="small muted">/visit</span>'}</b></div>`).join('')}
        <div class="totals"><span>Per visit <b>${money(e.perVisit)}</b></span><span>First year <b>${money(e.firstYear)}</b></span></div>
        ${!signed && e.valid_until ? `<p class="small muted" style="margin-top:8px">${e.status === 'expired' ? 'This estimate expired' : 'Good until'} ${fmtDate(e.valid_until)}.</p>` : ''}
      </div>
      <div class="card"><h2>Service agreement</h2><div class="terms">${esc(e.terms)}</div></div>
      <div class="card" id="act"></div>
      ${fromSell ? `<p class="no-print" style="text-align:center"><a class="btn ${signed ? 'primary big' : ''}" href="/nuvolve/app/sell">${signed ? '🚪 Next door' : '← Back to the door map'}</a></p>` : ''}
      <p class="small muted" style="text-align:center">${esc(co.name || '')}${co.phone ? ` · <a href="tel:${esc(co.phone)}">${esc(co.phone)}</a>` : ''}${co.email ? ` · ${esc(co.email)}` : ''}${co.license_no ? ` · License ${esc(co.license_no)}` : ''}</p>
    </div>`;
  const act = $('#act');
  if (signed) {
    act.innerHTML = `<h2>✅ Signed</h2>
      <img class="signed-sig" src="${e.signature}" alt="Signature of ${esc(e.signer_name)}">
      <p><b>${esc(e.signer_name)}</b><br><span class="small">${new Date(e.accepted_at.replace(' ', 'T') + 'Z').toLocaleString()}</span></p>
      <p class="meta">Agreement #${e.id}${e.signer_ip ? ` · signed from ${esc(e.signer_ip)}` : ''}<br>Tamper check (SHA-256): ${esc(e.signed_hash || '')}</p>
      <button class="btn no-print" data-print>Print or save as PDF</button>`;
  } else if (e.status === 'declined') {
    act.innerHTML = `<p>You declined this estimate${e.decline_reason ? `: "${esc(e.decline_reason)}"` : ''}. Changed your mind? Call us${co.phone ? ` at <a href="tel:${esc(co.phone)}">${esc(co.phone)}</a>` : ''} and we'll send a fresh one.</p>`;
  } else if (e.status === 'expired') {
    act.innerHTML = `<p>This estimate has expired. Call us${co.phone ? ` at <a href="tel:${esc(co.phone)}">${esc(co.phone)}</a>` : ''} and we'll send an updated one.</p>`;
  } else {
    act.innerHTML = `<h2>Accept and sign</h2>
      <div class="field"><label for="nm">Your full name</label><input id="nm" autocomplete="name" value="${esc(cu.name || '')}"></div>
      <div class="field"><label>Sign here with your finger or mouse</label><canvas class="sig" id="sig"></canvas><button type="button" class="link-btn small" id="clr">Clear</button></div>
      <label class="check"><input type="checkbox" id="agree"> I agree to the service agreement above and authorize ${esc(co.name || 'the company')} to provide these services.</label>
      <button class="btn primary big block" id="ok" style="margin-top:12px">Sign and accept</button>
      <p style="text-align:center;margin-top:12px"><button class="link-btn small" id="no">No thanks</button></p>`;
    const pad = signaturePad($('#sig'));
    $('#clr').onclick = () => pad.clear();
    $('#ok').onclick = async (ev) => {
      const sig = pad.value();
      if (!sig) return toast('Please sign in the box', true);
      if (!$('#agree').checked) return toast('Tick the box to agree to the terms', true);
      ev.target.disabled = true;
      try {
        await api(`/nuvolve/app/api/sign/${token}/accept`, { body: { name: $('#nm').value, signature: sig, agree: true } });
        toast('Signed. Thank you!');
        await load();
        window.scrollTo(0, document.body.scrollHeight);
      } catch (err) { toast(err.message, true); ev.target.disabled = false; }
    };
    $('#no').onclick = () => modal('Not right for you?', '<div class="field"><label>Mind telling us why? (optional)</label><textarea name="reason" placeholder="Price, timing, went with someone else..."></textarea></div>', [
      { label: 'Back' }, { label: 'Decline estimate', cls: 'danger', onClick: async (m) => { await api(`/nuvolve/app/api/sign/${token}/decline`, { body: formData(m) }); await load(); } }]);
  }
}

load();
