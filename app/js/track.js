// Customer tracking page from the on-my-way text: who's coming, when, and where they are now.
const token = location.pathname.split('/').pop();
const app = document.getElementById('app');
let map = null;
let techMarker = null;
// In the customer's language (src/lang/es/pages.js).
const t = (text, vars) => NV.t(text, vars);

const HEADLINE = {
  on_the_way: (n) => t('{name} is on the way', { name: n }),
  on_site: (n) => t('{name} has arrived', { name: n }),
  completed: (n) => t('{name} finished your service', { name: n }),
  scheduled: (n) => t('{name} is your technician', { name: n }),
  closed: () => t('This visit is closed'),
};

async function load() {
  let T;
  try { T = await api(`/nuvolve/app/api/track/${token}`); } catch (e) {
    app.innerHTML = `<h2>${esc(t('Link not found'))}</h2><p class="muted">${esc(t(e.message))}</p>`;
    return;
  }
  if (!$('#head')) {
    await NV.useLang(NV.preferredLang(T.lang));
    document.title = t('Your technician');
  }
  const name = T.tech_name || t('Your technician');
  if (!$('#head')) {
    app.innerHTML = `
      <div class="muted" id="co"></div>
      <div style="margin:14px 0">${T.has_photo ? `<img class="face" src="/nuvolve/app/api/track/${encodeURIComponent(token)}/photo" alt="${esc(t('Photo of {name}', { name }))}">` : '<div class="face">🧑‍🔧</div>'}</div>
      <h1 id="head" style="margin:0"></h1>
      <div id="eta"></div>
      <p class="small muted" id="what"></p>
      <div id="tmap" hidden></div>
      <div id="foot" style="margin-top:14px"></div>`;
  }
  $('#co').textContent = T.company;
  $('#head').textContent = (HEADLINE[T.status] || HEADLINE.scheduled)(name);
  $('#eta').innerHTML = T.status === 'on_the_way' && T.eta_text
    ? `<div class="eta">${esc(T.eta_text)}</div><div class="muted">${esc(T.minutes ? t('about {minutes} min away', { minutes: T.minutes }) : t('estimated arrival'))}</div>`
    : T.status === 'completed' ? `<p>${esc(t('Thanks for having us out. Your service report is in your account.'))}</p>` : '';
  $('#what').textContent = T.service_name && T.address ? t('{service} at {address}', { service: T.service_name, address: T.address }) : T.service_name || T.address || '';
  $('#foot').innerHTML = `${T.tech ? `<span class="live">${esc(t('Live location'))}</span><br>` : ''}${T.company_phone ? `<a class="btn" href="tel:${esc(T.company_phone)}" style="margin-top:10px">${esc(t('📞 Call {company}', { company: T.company }))}</a>` : ''}`;
  drawMap(T);
  if (['on_the_way', 'scheduled'].includes(T.status)) setTimeout(load, 30000);
}

function drawMap(T) {
  const el = $('#tmap');
  if (!T.tech || !T.home || !window.L) { el.hidden = true; return; }
  el.hidden = false;
  if (!map) {
    map = L.map(el, { zoomControl: false, attributionControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    L.marker([T.home.lat, T.home.lng], { icon: L.divIcon({ className: '', html: '<div style="font-size:26px">🏠</div>', iconSize: [28, 28] }) }).addTo(map);
  }
  const pos = [T.tech.lat, T.tech.lng];
  if (techMarker) techMarker.setLatLng(pos);
  else techMarker = L.marker(pos, { icon: L.divIcon({ className: '', html: '<div style="font-size:26px">🚚</div>', iconSize: [28, 28] }) }).addTo(map);
  map.fitBounds([pos, [T.home.lat, T.home.lng]], { padding: [40, 40], maxZoom: 15 });
}

// Leaflet loads with defer; the first draw may come before it's ready.
window.addEventListener('load', load);
