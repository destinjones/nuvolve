// The demo's stand-in for the Nuvolve server. GitHub Pages only serves files, so this service worker
// answers the app's API calls from answers the real server gave for a seeded demo company
// (see demo/record.js). Logins pick which role's answers to use. Changes aren't saved.
const APP = new URL('./', self.location).pathname.replace(/\/$/, ''); // e.g. /nuvolve/app
const VERSION = 'mvto1yh6';
const SESSION = 'nv-demo-session';
const EMAILS = { 'owner@demo.com': 'owner', 'office@demo.com': 'office', 'manager@demo.com': 'manager', 'mike@demo.com': 'tech', 'sales@demo.com': 'sales' };
const PASSWORD = 'demo1234';
const SHELLS = [[/^\/portal(\/|$)/, 'portal.html'], [/^\/review\//, 'review.html'], [/^\/tech\/?$/, 'tech.html'], [/^\/sell\/?$/, 'sell.html'],
  [/^\/developers\/?$/, 'developers.html'], [/^\/sign\//, 'sign.html'], [/^\/offer\//, 'offer.html'], [/^\/track\//, 'track.html'], [/^\/book\//, 'book.html']];
// Anyone can open these without logging in, the way customers do.
const PUBLIC = /^\/api\/(portal|sign|review|book|offer|track|setup-status|v1\/openapi\.json)/;
const SAVED_MSG = "This is the demo, so changes aren't saved. Everything you can look at is real demo data.";
// Background saves the app makes on its own; answering OK keeps the demo quiet.
const QUIET_OK = [/^\/api\/notifications\/read$/, /^\/api\/visits\/\d+\/start$/];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('nv-demo-data-') && k !== `nv-demo-data-${VERSION}`) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('message', (e) => {
  if (e.data?.type === 'as') e.waitUntil(setRole(e.data.role).then(() => e.source?.postMessage({ type: 'as-done' })));
});

let role; // undefined: not read yet
const maps = {};
async function getRole() {
  if (role !== undefined) return role;
  const r = await (await caches.open(SESSION)).match('/session');
  role = r ? (await r.json()).role : null;
  return role;
}
async function setRole(r) {
  role = r || null;
  const c = await caches.open(SESSION);
  if (role) await c.put('/session', json({ role }));
  else await c.delete('/session');
}
async function data(name) {
  if (!maps[name]) {
    maps[name] = (async () => {
      const cache = await caches.open(`nv-demo-data-${VERSION}`);
      const url = `${APP}/demo-data/${name}.json?v=${VERSION}`;
      let res = await cache.match(url);
      if (!res) { res = await fetch(url); if (res.ok) await cache.put(url, res.clone()); }
      return res.ok ? res.json() : {};
    })();
  }
  return maps[name];
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function replay(a) {
  const body = a.enc === 'base64' ? Uint8Array.from(atob(a.b), (c) => c.charCodeAt(0)) : a.b;
  return new Response(body, { status: a.s, headers: { 'Content-Type': a.t || 'application/json', 'Cache-Control': 'no-store' } });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(APP + '/')) return;
  const p = url.pathname.slice(APP.length);
  if (p.startsWith('/api/')) return e.respondWith(api(e.request, url, p));
  if (e.request.mode === 'navigate') {
    const shell = SHELLS.find(([re]) => re.test(p));
    if (shell) return e.respondWith(fetch(`${APP}/${shell[1]}`));
  }
});

async function api(req, url, p) {
  const method = req.method;
  if (method === 'POST' && p === '/api/login') {
    const b = await req.json().catch(() => ({}));
    const r = EMAILS[String(b.email || '').trim().toLowerCase()];
    if (!r || b.password !== PASSWORD) return json({ error: 'That email and password don\'t match a demo login. The logins are on the Nuvolve home page.' }, 401);
    await setRole(r);
    const rec = (await data(r))['POST /api/login'];
    return rec ? replay(rec) : json({ ok: true, role: r === 'sales' ? 'sales' : r === 'tech' ? 'tech' : r });
  }
  if (method === 'POST' && p === '/api/logout') { await setRole(null); return json({ ok: true }); }
  if (method !== 'GET' && method !== 'HEAD') {
    if (QUIET_OK.some((re) => re.test(p))) return json({ ok: true });
    return json({ error: SAVED_MSG, demo: true }, 400);
  }

  const who = await getRole();
  const loc = req.headers.get('X-Location') || '';
  const key = `GET ${p}${url.search}`;
  const sources = [];
  if (who) sources.push(await data(who));
  if (PUBLIC.test(p) || !who) sources.push(await data('public'));
  for (const m of sources) {
    const hit = (loc && m[`${key} @${loc}`]) || m[key];
    if (hit) return replay(hit);
  }
  if (!who && !PUBLIC.test(p)) return json({ error: 'Please log in' }, 401);
  const m = sources[0];
  const search = customerSearch(m, p, url);
  if (search) return json(search);
  const near = closest(m, p, url, loc);
  if (near) return replay(near);
  // Printable documents look the same for every office role.
  if (who !== 'owner' && /\/view$|\/print$/.test(p)) {
    const o = await data('owner');
    if (o[key]) return replay(o[key]);
  }
  return json({ error: "That part isn't in the demo yet. Everything on the main pages is." }, 404);
}

// The customer search box: filter a recorded customer list the way the server would.
function customerSearch(m, p, url) {
  if (p !== '/api/customers' || !url.searchParams.get('q')) return null;
  const q = url.searchParams.get('q').trim().toLowerCase();
  const status = url.searchParams.get('status') || 'active';
  const base = ['all', status, 'active'].map((st) => Object.keys(m).find((k) => k.startsWith('GET /api/customers?') && new URLSearchParams(k.split('?')[1].split(' @')[0]).get('q') === '' &&
    (new URLSearchParams(k.split('?')[1].split(' @')[0]).get('status') || 'active') === st)).find(Boolean);
  if (!base) return null;
  let list;
  try { list = JSON.parse(m[base].b); } catch { return null; }
  const rows = Array.isArray(list) ? list : list.customers || list.rows || [];
  const digits = q.replace(/\D/g, '');
  const hit = rows.filter((r) => {
    const s = JSON.stringify(r).toLowerCase();
    return s.includes(q) || (digits.length >= 3 && s.replace(/\D/g, '').includes(digits));
  });
  return Array.isArray(list) ? hit : { ...list, [list.customers ? 'customers' : 'rows']: hit };
}

// Same page, different filter or date: answer with the recorded one that differs the least.
function closest(m, p, url, loc) {
  const want = new URLSearchParams(url.search);
  let best = null, bestScore = -1;
  for (const k of Object.keys(m)) {
    if (!k.startsWith(`GET ${p}?`) && k !== `GET ${p}` && !k.startsWith(`GET ${p} @`)) continue;
    const [pathq, at] = k.slice(4).split(' @');
    if (pathq.split('?')[0] !== p) continue;
    const have = new URLSearchParams(pathq.split('?')[1] || '');
    let score = (at || '') === loc ? 0.5 : 0;
    for (const [n, v] of want) if (have.get(n) === v) score += 1;
    if (score > bestScore) { best = m[k]; bestScore = score; }
  }
  return best;
}
