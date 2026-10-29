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
  const list = async () => ask((await store('readonly')).getAll());
  const put = async (item) => ask((await store('readwrite')).put(item));
  const remove = async (id) => { await ask((await store('readwrite')).delete(id)); changed(); };

  // Other tabs and the service worker hear about changes on the channel; this page hears the event.
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('nv-outbox') : null;
  const listeners = new Set();
  function changed(msg = 'changed') { channel?.postMessage(msg); listeners.forEach((fn) => fn(msg)); }
  if (channel) channel.onmessage = (e) => listeners.forEach((fn) => fn(e.data));

  const newKey = () => (scope.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  // The server already has it: the office finished the stop, or an earlier send got through before the signal dropped.
  const alreadyDone = (status, data) => status === 400 && /already (completed|finished)/i.test(data?.error || '');

  // Sends waiting saves oldest first. Stops at the first sign of no signal and leaves the rest for next time.
  // Returns { done: { [id]: outcome }, left } where left counts saves still waiting to go.
  async function flushNow() {
    const done = {};
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
      if (res.ok || alreadyDone(res.status, data)) {
        await remove(it.id);
        done[it.id] = { ok: true, data };
        continue;
      }
      // Logged out, billing paused, a send already in flight, or the server is down: try again later.
      if ([401, 402, 409].includes(res.status) || res.status >= 500) {
        done[it.id] = { retry: true, status: res.status, error: data.error };
        if (res.status === 401) changed('login');
        break;
      }
      // The server said no (a company rule, not their stop anymore). The tech has to look at it.
      await put({ ...it, status: 'failed', error: data.error || `Error ${res.status}`, failed_at: Date.now() });
      done[it.id] = { failed: true, status: res.status, error: data.error, data };
      changed();
    }
    return { done, left: (await list()).filter((i) => i.status === 'pending').length };
  }
  // One sender at a time across the page and the service worker.
  const flush = () => (scope.navigator?.locks ? navigator.locks.request('nv-outbox', flushNow) : flushNow());

  // Save now if there's signal, otherwise keep it on the phone. Resolves with the server's answer,
  // or { queued: true } when it is waiting for signal.
  async function send(path, body, { kind = 'save', visitId = null } = {}) {
    // Saving a stop again replaces an earlier try the server turned down.
    if (kind !== 'photo') for (const old of await list()) if (old.status === 'failed' && old.kind === kind && old.visitId === visitId) await remove(old.id);
    const id = await put({ path, body, kind, visitId, key: newKey(), at: Date.now(), status: 'pending' });
    changed();
    const r = (await flush()).done[id];
    if (r?.ok) return r.data;
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
    return { pending: all.filter((i) => i.status === 'pending').length, failed: all.filter((i) => i.status === 'failed').length };
  }
  const forVisit = async (visitId) => (await list()).filter((i) => i.visitId === Number(visitId));
  async function clear() { await ask((await store('readwrite')).clear()); changed(); }

  // Send whenever the phone gets signal back, the app comes back to the front, and every 30 seconds while saves wait.
  function autoSync() {
    const go = () => { if (navigator.onLine) flush().catch(() => {}); };
    scope.addEventListener('online', go);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') go(); });
    setInterval(async () => { if ((await counts()).pending) go(); }, 30000);
    go();
  }

  scope.Outbox = { send, flush, list, forVisit, counts, remove, clear, autoSync, onChange: (fn) => listeners.add(fn) };
})(self);
