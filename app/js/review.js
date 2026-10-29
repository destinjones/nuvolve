// Customer rating page: stars, then a Google review link (5 stars) or anonymous feedback.
const token = location.pathname.split('/').pop();
const app = document.getElementById('app');
let R = null;

async function load() {
  try { R = await api(`/nuvolve/app/api/review/${token}`); } catch (e) { app.innerHTML = `<h2>Link not found</h2><p class="muted">${esc(e.message)}</p>`; return; }
  if (R.rating) return R.rating === 5 ? showFive() : showImprove(true);
  app.innerHTML = `
    <div class="muted">${esc(R.company || '')}</div>
    <h1 style="margin-top:6px">How did ${esc(R.tech_name)} do?</h1>
    <p class="muted">${esc(R.service_name || 'Your service')} on ${fmtDate(R.date, { month: 'long', day: 'numeric' })}</p>
    <div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-n="${n}" aria-label="${n} stars">⭐</button>`).join('')}</div>
    <p class="small muted">Tap a star</p>`;
  const btns = [...app.querySelectorAll('.stars button')];
  btns.forEach((b) => {
    b.onmouseenter = () => btns.forEach((x) => x.classList.toggle('on', Number(x.dataset.n) <= Number(b.dataset.n)));
    b.onclick = async () => {
      btns.forEach((x) => x.classList.toggle('on', Number(x.dataset.n) <= Number(b.dataset.n)));
      const r = await api(`/nuvolve/app/api/review/${token}/rate`, { body: { rating: Number(b.dataset.n) } });
      R.rating = r.rating;
      setTimeout(() => (r.rating === 5 ? showFive() : showImprove()), 250);
    };
  });
}

function showFive() {
  app.innerHTML = `
    <div style="font-size:48px">🎉</div>
    <h1>Thank you!</h1>
    <p>We'll let ${esc(R.tech_name)} know. It makes their day.</p>
    ${R.hasGoogle ? `<p><b>Would you share that on Google?</b> It takes 30 seconds and helps a small local business more than anything.</p>
      <a class="btn primary big block" href="/nuvolve/app/r/${token}/google">⭐ Leave a Google review</a>` : ''}`;
}

function showImprove(already) {
  app.innerHTML = `
    <h1>${already ? 'Thanks for your rating' : 'Thanks for telling us'}</h1>
    <p>What could we do better next time? <b>This is anonymous.</b> Your name is never attached, so be honest.</p>
    <div class="field"><textarea id="c" placeholder="Showed up late, missed the garage, still seeing ants..."></textarea></div>
    <button class="btn primary big block" id="send">Send anonymously</button>`;
  document.getElementById('send').onclick = async () => {
    try {
      await api(`/nuvolve/app/api/review/${token}/feedback`, { body: { comment: document.getElementById('c').value } });
      app.innerHTML = '<div style="font-size:44px">🙏</div><h1>Thank you</h1><p>The owner reads every one of these.</p>';
    } catch (e) { toast(e.message, true); }
  };
}

load();
