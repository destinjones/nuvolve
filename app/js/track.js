// Customer tracking page from the on-my-way text: who's coming, when, and where they are now.
const token = location.pathname.split('/').pop();
const app = document.getElementById('app');
let map = null;
let techMarker = null;

const HEADLINE = {
  on_the_way: (n) => `${n} is on the way`,
  on_site: (n) => `${n} has arrived`,
  completed: (n) => `${n} finished your service`,
  scheduled: (n) => `${n} is your technician`,
  closed: () => 'This visit is closed',
};

async function load() {
  let T;
  try { T = await api(`/nuvolve/app/api/track/${token}`); } catch (e) {
    app.innerHTML = `<h2>Link not found</h2><p class="muted">${esc(e.message)}</p>`;
    return;
  }
  const name = T.tech_name || 'Your technician';
  if (!$('#head')) {
    app.innerHTML = `
      <div class="muted" id="co"></div>
      <div style="margin:14px 0">${T.has_photo ? `<img class="face" src="/nuvolve/app/api/track/${encodeURIComponent(token)}/photo" alt="Photo of ${esc(name)}">` : '<div class="face">🧑‍🔧</div>'}</div>
      <h1 id="head" style="margin:0"></h1>
      <div id="eta"></div>
      <p class="small muted" id="what"></p>
      <div id="tmap" hidden></div>
      <div id="foot" style="margin-top:14px"></div>`;
  }
  $('#co').textContent = T.company;
  $('#head').textContent = (HEADLINE[T.status] || HEADLINE.scheduled)(name);
  $('#eta').innerHTML = T.status === 'on_the_way' && T.eta_text
    ? `<div class="eta">${esc(T.eta_text)}</div><div class="muted">${T.minutes ? `about ${T.minutes} min away` : 'estimated arrival'}</div>`
    : T.status === 'completed' ? '<p>Thanks for having us out. Your service report is in your account.</p>' : '';
  $('#what').textContent = [T.service_name, T.address].filter(Boolean).join(' at ');
  $('#foot').innerHTML = `${T.tech ? '<span class="live">Live location</span><br>' : ''}${T.company_phone ? `<a class="btn" href="tel:${esc(T.company_phone)}" style="margin-top:10px">📞 Call ${esc(T.company)}</a>` : ''}`;
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
