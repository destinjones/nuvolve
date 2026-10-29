// Website booking form. Companies share this link or put it on their own site in a frame.
const app = document.getElementById('app');
const key = location.pathname.replace(/\/$/, '').split('/').pop();
const ref = (new URLSearchParams(location.search).get('ref') || '').slice(0, 40);

async function load() {
  let d;
  try { d = await api(`/nuvolve/app/api/book/${key}`); } catch (e) {
    app.innerHTML = `<h2>Online booking is closed</h2><p>Please call us to schedule. ${esc(e.message)}</p>`;
    return;
  }
  document.title = `Book with ${d.company.name || 'us'}`;
  const referral = ref ? await api(`/nuvolve/app/api/book/${key}/ref/${encodeURIComponent(ref)}`).catch(() => null) : null;
  app.innerHTML = `
    <h1 style="margin-top:0">${esc(d.company.name || 'Book a service')}</h1>
    <p class="muted">${esc(d.company.message || "Tell us what's going on and we'll call you to confirm a time.")}</p>
    ${referral?.referrer ? `<div class="alert info">🎁 ${esc(referral.referrer)} sent you${referral.friendReward ? `. You'll get ${money(referral.friendReward)} off after your first service` : ''}.</div>` : ''}
    <form id="f">
      <div class="field"><label>What do you need?</label><div class="svc">
        ${d.services.map((s, i) => `<label><input type="radio" name="service_type_id" value="${s.id}" ${i === 0 ? 'checked' : ''}>
          <span><b>${esc(s.name)}</b>${s.price > 0 ? ` <span class="muted">from ${money(s.price)}</span>` : ''}${s.description ? `<div class="small muted">${esc(s.description)}</div>` : ''}</span></label>`).join('')}
        <label><input type="radio" name="service_type_id" value=""><span><b>Not sure</b><div class="small muted">Tell us below and we'll recommend something.</div></span></label>
      </div></div>
      <div class="row"><div class="field"><label>First name</label><input name="first_name" autocomplete="given-name" required></div>
      <div class="field"><label>Last name</label><input name="last_name" autocomplete="family-name"></div></div>
      <div class="row"><div class="field"><label>Phone</label><input name="phone" type="tel" autocomplete="tel" inputmode="tel"></div>
      <div class="field"><label>Email</label><input name="email" type="email" autocomplete="email"></div></div>
      <div class="field"><label>Service address</label><input name="address" autocomplete="street-address" required></div>
      <div class="row"><div class="field"><label>City</label><input name="city" autocomplete="address-level2"></div>
      <div class="field"><label>Zip</label><input name="zip" autocomplete="postal-code" inputmode="numeric"></div></div>
      <div class="row"><div class="field"><label>Home or business?</label><select name="type"><option value="residential">Home</option><option value="commercial">Business</option></select></div>
      <div class="field"><label>Best day (optional)</label><input name="preferred_date" type="date" min="${todayStr()}"></div></div>
      <div class="field"><label>What are you seeing?</label><textarea name="message" placeholder="Ants in the kitchen, scorpions in the garage..."></textarea></div>
      <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
      <button class="btn primary big block">Request service</button>
      ${d.company.phone ? `<p class="small muted" style="text-align:center;margin-top:10px">Prefer to talk? Call <a href="tel:${esc(d.company.phone)}">${esc(d.company.phone)}</a></p>` : ''}
    </form>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button.primary', e.target);
    const body = formData(e.target);
    body.service_type_id = $('input[name=service_type_id]:checked', e.target)?.value || '';
    if (referral?.referrer) body.ref = ref;
    if (!body.phone && !body.email) return toast('Add a phone number or email so we can reach you', true);
    btn.disabled = true;
    try {
      await api(`/nuvolve/app/api/book/${key}`, { body });
      app.innerHTML = `<div style="text-align:center;padding:20px 0"><div style="font-size:44px">✅</div><h2>Thanks, ${esc(body.first_name)}!</h2>
        <p>We got your request and will reach out shortly to confirm a time.</p>${d.company.phone ? `<p class="small muted">Need us sooner? Call <a href="tel:${esc(d.company.phone)}">${esc(d.company.phone)}</a></p>` : ''}</div>`;
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  };
}

load();
