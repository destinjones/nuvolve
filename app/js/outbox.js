// Saves made on the tech's phone wait here until there is signal: start, complete, skip and photos.
// Runs in the page and in the service worker, so saved tickets can go out even with the app closed.
// Each save carries an Idempotency-Key, so sending one twice never completes a stop (or charges a card) twice.
(function (scope) {
  const STORE = 'outbox';
  let opening;
  const db = () => (opening ||= new Promise((resolve, reject) => {
    const r = indexedDB.open('nuvolve-tech', 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { opening = null; reject(r.error); };
  }));
  const ask = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const store = async (mode) => (await db()).transaction(STORE, mode).objectStore(STORE);
  // Saves have number ids. Notes kept beside them (this phone's id, the last answer from the office, the version of
  // each stop the tech last saw) have text ids like "meta:device", so they never show up as saves.
  const list = async () => (await ask((await store('readonly')).getAll())).filter((i) => typeof i.id === 'number');
  const put = async (item) => ask((await store('readwrite')).put(item));
  const remove = async (id) => { await ask((await store('readwrite')).delete(id)); changed(); };
  const getMeta = async (k) => (await ask((await store('readonly')).get(`meta:${k}`)))?.value;
  const setMeta = async (k, value) => ask((await store('readwrite')).put({ id: `meta:${k}`, value }));

  // Other tabs and the service worker hear about changes on the channel; this page hears the event.
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('nv-outbox') : null;
  const listeners = new Set();
  function changed(msg = 'changed') { channel?.postMessage(msg); listeners.forEach((fn) => fn(msg)); }
  if (channel) channel.onmessage = (e) => listeners.forEach((fn) => fn(e.data));

  const newKey = () => (scope.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  // The server already has it: the office finished the stop, or an earlier send got through before the signal dropped.
  const alreadyDone = (status, data) => status === 400 && /already (completed|finished)/i.test(data?.error || '');

  // Which phone a save came from, so the server can tell "sent twice" from "done on two phones".
  async function device() {
    let d = await getMeta('device');
    if (!d) { d = newKey().replace(/[^\w-]/g, '').slice(0, 40); await setMeta('device', d); }
    return d;
  }
  // The version of each stop the tech last saw (signed by the server). Saves carry it, so the server can tell what the
  // office changed while the phone had no signal. A newer copy is never replaced by an older one.
  async function saw(stops) {
    const st = await store('readwrite');
    const seen = (await ask(st.get('meta:seen')))?.value || {};
    for (const s of stops || []) if (s?.id && s.sync?.sig && !(seen[s.id]?.at > s.sync.at)) seen[s.id] = s.sync;
    const old = new Date(Date.now() - 3 * 86400000).toISOString();
    for (const [id, v] of Object.entries(seen)) if (!(v.at > old)) delete seen[id];
    await ask(st.put({ id: 'meta:seen', value: seen }));
  }
  // What the server said about a save that went out by itself (the office moved the stop, a price changed).
  async function note(it, notes) {
    await setMeta('notes', [...((await getMeta('notes')) || []), { visitId: it.visitId, kind: it.kind, notes, at: Date.now() }].slice(-20));
    changed('notes');
  }

  // Sends waiting saves oldest first. Stops at the first sign of no signal and leaves the rest for next time.
  // Returns { done: { [id]: outcome }, left } where left counts saves still waiting to go.
  async function flushNow() {
    const done = {};
    let heard = false;
    for (const it of (await list()).filter((i) => i.status === 'pending')) {
      let res;
      try {
        res = await fetch(it.path, {
          method: 'POST', credentials: 'same-origin', body: JSON.stringify(it.body),
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': it.key },
          signal: AbortSignal.timeout ? AbortSignal.timeout(45000) : undefined,
        });
      } catch { break; }
      const data = await res.json().catch(() => ({}));
      if (res.status < 500) heard = true;
      if (res.ok || alreadyDone(res.status, data)) {
        await remove(it.id);
        done[it.id] = { ok: true, data };
        if (data?.sync?.notes?.length) await note(it, data.sync.notes);
        continue;
      }
      // Someone already completed this stop. The ticket stays on this phone until the tech decides what to do.
      if (res.status === 409 && data.conflict) {
        await put({ ...it, status: 'conflict', error: data.error, conflict: data.conflict, conflict_at: Date.now() });
        done[it.id] = { conflict: true, status: 409, error: data.error, data };
        changed('conflict');
        continue;
      }
      // Logged out, billing paused, a send already in flight, too many at once, or the server is down: try again later.
      if ([401, 402, 409, 429].includes(res.status) || res.status >= 500) {
        done[it.id] = { retry: true, status: res.status, error: data.error };
        if (res.status === 401) changed('login');
        break;
      }
      // The server said no (a company rule, not their stop anymore). The tech has to look at it.
      await put({ ...it, status: 'failed', error: data.error || `Error ${res.status}`, failed_at: Date.now() });
      done[it.id] = { failed: true, status: res.status, error: data.error, data };
      changed();
    }
    if (heard) await setMeta('last_sync', Date.now());
    return { done, left: (await list()).filter((i) => i.status === 'pending').length };
  }
  // One sender at a time across the page and the service worker.
  const flush = () => (scope.navigator?.locks ? navigator.locks.request('nv-outbox', flushNow) : flushNow());

  // Save now if there's signal, otherwise keep it on the phone. Resolves with the server's answer,
  // or { queued: true } when it is waiting for signal.
  async function send(path, body, { kind = 'save', visitId = null } = {}) {
    // Saving a stop again replaces an earlier try the server turned down.
    if (kind !== 'photo') for (const old of await list()) if (['failed', 'conflict'].includes(old.status) && old.kind === kind && old.visitId === visitId) await remove(old.id);
    // Stop saves say which phone sent them and which version of the stop the tech was looking at.
    if (/^\/nuvolve\/app\/api\/visits\/\d+\/(start|complete|skip|photos)$/.test(path)) {
      const seen = visitId ? (await getMeta('seen'))?.[visitId] : null;
      body = { ...body, device: await device(), ...(seen ? { seen } : {}) };
    }
    const id = await put({ path, body, kind, visitId, key: newKey(), at: Date.now(), status: 'pending' });
    changed();
    const r = (await flush()).done[id];
    if (r?.ok) return r.data;
    // Kept on the phone as a conflict: the tech app shows what happened and lets the tech decide.
    if (r?.conflict) throw Object.assign(new Error(r.error || 'This stop was already completed'), { status: 409, conflict: r.data.conflict, outboxId: id });
    if (!r?.failed) {
      // Android can send it later even if the app is closed. Elsewhere it goes the next time the app is open.
      scope.navigator?.serviceWorker?.ready.then((reg) => reg.sync?.register('nv-outbox')).catch(() => {});
      return { queued: true, outboxId: id };
    }
    // Turned down while the tech is looking at it: show it the way the rest of the app does, not as a stuck save.
    await remove(id);
    if (r.status === 422 && r.data?.rules && typeof scope.ruleBlocked === 'function') return scope.ruleBlocked(path, { body }, r.data);
    throw Object.assign(new Error(r.error || 'Something went wrong'), { status: r.status });
  }

  async function counts() {
    const all = await list();
    const n = (s) => all.filter((i) => i.status === s).length;
    return { pending: n('pending'), failed: n('failed'), conflicts: n('conflict') };
  }
  const forVisit = async (visitId) => (await list()).filter((i) => i.visitId === Number(visitId));
  async function clear() { await ask((await store('readwrite')).clear()); changed(); }

  // The tech's answer to a ticket the server turned down: 'mine' (send it anyway, the office picks which ticket stays)
  // or 'drop' (take it off the phone). The answer goes out like any other save.
  async function choose(id, choice) {
    const it = (await list()).find((i) => i.id === Number(id));
    if (!it || it.status !== 'conflict') return null;
    if (choice === 'drop') await remove(it.id); else { await put({ ...it, choice, chosen_at: Date.now() }); changed(); }
    return it.conflict?.id ? send(`/nuvolve/app/api/sync/conflicts/${it.conflict.id}/choice`, { choice }, { kind: 'choice', visitId: it.visitId }) : null;
  }
  // Tickets the office has settled since. The server keeps them, so they can leave the phone.
  async function reconcile() {
    const open = (await list()).filter((i) => i.status === 'conflict' && i.conflict?.id);
    if (!open.length) return;
    const res = await fetch(`/nuvolve/app/api/sync/mine?ids=${open.map((i) => i.conflict.id).join(',')}`, { credentials: 'same-origin' });
    if (!res.ok) return;
    for (const c of (await res.json()).conflicts || []) {
      const it = open.find((i) => i.conflict.id === c.id);
      if (it && c.status === 'resolved') await remove(it.id);
    }
  }
  const lastSync = () => getMeta('last_sync');
  const synced = async () => { await setMeta('last_sync', Date.now()); changed('synced'); };
  const notes = async () => (await getMeta('notes')) || [];
  const clearNotes = async () => { await setMeta('notes', []); changed('notes'); };

  // Send whenever the phone gets signal back, the app comes back to the front, and every 30 seconds while saves wait.
  function autoSync() {
    const go = () => { if (navigator.onLine) flush().then(reconcile).catch(() => {}); };
    scope.addEventListener('online', go);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') go(); });
    setInterval(async () => { if ((await counts()).pending) go(); }, 30000);
    go();
  }

  scope.Outbox = { send, flush, list, forVisit, counts, remove, clear, autoSync, onChange: (fn) => listeners.add(fn),
    saw, choose, reconcile, lastSync, synced, notes, clearNotes };
})(self);
