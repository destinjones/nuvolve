// Customer rating page: stars, then a thank-you (4 or 5 stars) or a private feedback box (lower), with the Google
// review link on either one whenever the server says to ask. By default it asks everyone who rates, as Google's
// rules require; the feedback box for low ratings is extra, never instead of the link.
const token = location.pathname.split('/').pop();
const app = document.getElementById('app');
let R = null;
const t = (text, vars) => NV.t(text, vars);
const happy = (n) => n >= 4;
const googleLink = (soft) => (soft
  ? `<p class="small muted" style="margin-top:18px">${esc(t("If you'd like to share your experience publicly, you can post a review on Google."))}</p>
    <a class="btn block" href="/nuvolve/app/r/${esc(token)}/google">${esc(t('Review us on Google'))}</a>`
  : `<p><b>${esc(t('Would you share that on Google?'))}</b> ${esc(t('It takes 30 seconds and helps a small local business more than anything.'))}</p>
    <a class="btn primary big block" href="/nuvolve/app/r/${esc(token)}/google">${esc(t('⭐ Leave a Google review'))}</a>`);

async function load() {
  try { R = await api(`/nuvolve/app/api/review/${token}`); } catch (e) {
    app.innerHTML = `<h2>${esc(t('Link not found'))}</h2><p class="muted">${esc(t(e.message))}</p>`;
    return;
  }
  await NV.useLang(NV.preferredLang(R.lang));
  document.title = t('How did we do?');
  if (R.rating) return happy(R.rating) ? showThanks(R.google) : showImprove(true, R.google);
  const day = parseYmd(R.date).toLocaleDateString(NV.lang === 'es' ? 'es-US' : 'en-US', { month: 'long', day: 'numeric' });
  app.innerHTML = `
    <div class="muted">${esc(R.company || '')}</div>
    <h1 style="margin-top:6px">${esc(t('How did {tech} do?', { tech: R.tech_name }))}</h1>
    <p class="muted">${esc(t('{service} on {date}', { service: R.service_name || t('Your service'), date: day }))}</p>
    <div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-n="${n}" aria-label="${esc(t('{n} stars', { n }))}">⭐</button>`).join('')}</div>
    <p class="small muted">${esc(t('Tap a star'))}</p>`;
  const btns = [...app.querySelectorAll('.stars button')];
  btns.forEach((b) => {
    b.onmouseenter = () => btns.forEach((x) => x.classList.toggle('on', Number(x.dataset.n) <= Number(b.dataset.n)));
    b.onclick = async () => {
      btns.forEach((x) => x.classList.toggle('on', Number(x.dataset.n) <= Number(b.dataset.n)));
      let r;
      try { r = await api(`/nuvolve/app/api/review/${token}/rate`, { body: { rating: Number(b.dataset.n) } }); } catch (e) { return toast(t(e.message), true); }
      R.rating = r.rating;
      setTimeout(() => (happy(r.rating) ? showThanks(r.google) : showImprove(false, r.google)), 250);
    };
  });
}

function showThanks(askGoogle) {
  app.innerHTML = `
    <div style="font-size:48px">🎉</div>
    <h1>${esc(t('Thank you!'))}</h1>
    <p>${esc(t("We'll let {tech} know. It makes their day.", { tech: R.tech_name }))}</p>
    ${askGoogle ? googleLink(false) : ''}
    ${R.rating < 5 ? `<div style="text-align:left;margin-top:18px"><label>${esc(t('Anything we could do better? (optional, anonymous)'))}</label>
      <div class="field"><textarea id="c" placeholder="${esc(t('Showed up late, missed the garage, still seeing ants...'))}"></textarea></div>
      <button class="btn block" id="send">${esc(t('Send anonymously'))}</button></div>` : ''}`;
  if (document.getElementById('send')) wireFeedback(false);
}

function showImprove(already, askGoogle) {
  app.innerHTML = `
    <h1>${esc(t(already ? 'Thanks for your rating' : 'Thanks for telling us'))}</h1>
    <p>${esc(t('What could we do better next time?'))} <b>${esc(t('This is anonymous.'))}</b> ${esc(t('Your name is never attached, so be honest.'))}</p>
    <div class="field"><textarea id="c" placeholder="${esc(t('Showed up late, missed the garage, still seeing ants...'))}"></textarea></div>
    <button class="btn primary big block" id="send">${esc(t('Send anonymously'))}</button>
    ${askGoogle ? googleLink(true) : ''}`;
  wireFeedback(askGoogle);
}

function wireFeedback(askGoogle) {
  document.getElementById('send').onclick = async () => {
    try {
      await api(`/nuvolve/app/api/review/${token}/feedback`, { body: { comment: document.getElementById('c').value } });
      app.innerHTML = `<div style="font-size:44px">🙏</div><h1>${esc(t('Thank you'))}</h1><p>${esc(t('The owner reads every one of these.'))}</p>${askGoogle ? googleLink(true) : ''}`;
    } catch (e) { toast(t(e.message), true); }
  };
}

load();
