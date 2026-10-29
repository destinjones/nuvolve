// Signing a contract from its link (/nuvolve/app/d/:token): agree to sign electronically, adopt a signature (draw or type),
// tap each "Sign here" flag, fill in the blanks, and finish. Signed contracts get a Download PDF button and, inside
// the right-to-cancel window, a way to cancel. The page is the contract itself; this adds the bar and the sheets.
(function () {
  const body = document.body;
  const status = body.dataset.sign;
  const token = location.pathname.split('/').filter(Boolean)[1] || '';
  const base = `/nuvolve/app/d/${encodeURIComponent(token)}`;
  const fromSell = new URLSearchParams(location.search).get('from') === 'sell';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  let info = null;

  async function call(path, data) {
    const r = await fetch(`${base}${path}`, data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {});
    let j = {};
    try { j = await r.json(); } catch { /* not JSON */ }
    if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
    return j;
  }
  const reload = () => location.replace(location.pathname + location.search);

  // ---------- sheets ----------
  let openSheet = null;
  function sheet(html, { onClose, wide } = {}) {
    closeSheet();
    const cover = el(`<div class="ds-ui ds-cover" role="dialog" aria-modal="true"><div class="ds-sheet"${wide ? ' style="max-width:640px"' : ''}>${html}</div></div>`);
    document.body.appendChild(cover);
    const prev = document.activeElement;
    const close = () => { cover.remove(); openSheet = null; if (prev && prev.focus) prev.focus(); if (onClose) onClose(); };
    cover.addEventListener('click', (e) => { if (e.target === cover) close(); });
    cover.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    openSheet = { cover, close };
    setTimeout(() => { const f = cover.querySelector('input[type=text], textarea, button.primary, button'); if (f) f.focus(); }, 30);
    return { root: cover, close };
  }
  function closeSheet() { if (openSheet) openSheet.close(); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openSheet) openSheet.close(); });

  // ---------- the bottom bar ----------
  const bar = el('<div class="ds-ui ds-bar nv-noprint"><div class="ds-bar-in"></div></div>');
  const barIn = bar.firstElementChild;
  function setBar(html) { barIn.innerHTML = html; if (!bar.isConnected) document.body.appendChild(bar); }
  function banner(cls, html) {
    const sheetEl = document.querySelector('.nv-sheet');
    const b = el(`<div class="ds-ui ds-banner ${cls} nv-noprint" role="status">${html}</div>`);
    sheetEl.parentNode.insertBefore(b, sheetEl);
  }
  const contact = () => {
    const c = info?.company || {};
    return [c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : '', c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''].filter(Boolean).join(' or ');
  };
  const nextDoor = () => (fromSell ? '<a class="ds-btn primary" href="/nuvolve/app/sell">Next door →</a>' : '');

  // ---------- signature pad ----------
  function pad(canvas) {
    const ctx = canvas.getContext('2d');
    let drawing = false, last = null, dirty = false;
    const strokes = [];
    function size() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#14213d'; ctx.lineWidth = 2.4;
      for (const s of strokes) { ctx.beginPath(); s.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); if (s.length === 1) ctx.lineTo(s[0].x + 0.1, s[0].y); ctx.stroke(); }
    }
    const at = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); canvas.setPointerCapture(e.pointerId); drawing = true; last = at(e); strokes.push([last]); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(last.x + 0.1, last.y); ctx.stroke(); dirty = true; canvas.dispatchEvent(new Event('change')); });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = at(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      strokes[strokes.length - 1].push(p); last = p;
    });
    const end = () => { drawing = false; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end); canvas.addEventListener('pointerleave', end);
    size();
    window.addEventListener('resize', size);
    return {
      clear() { strokes.length = 0; dirty = false; ctx.clearRect(0, 0, canvas.width, canvas.height); canvas.dispatchEvent(new Event('change')); },
      empty: () => !dirty || strokes.reduce((n, s) => n + s.length, 0) < 4,
      png: () => trim(canvas),
      dispose: () => window.removeEventListener('resize', size),
    };
  }
  // Crops the empty space around a drawing so the signature fills its spot.
  function trim(src) {
    const c = src.getContext('2d');
    const { width: w, height: h } = src;
    const d = c.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return '';
    const m = 8;
    x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }
  const SCRIPTS = [
    '"Segoe Script","Snell Roundhand","Apple Chancery","URW Chancery L","Brush Script MT",cursive',
    '"Brush Script MT","Bradley Hand","Segoe Print","Comic Sans MS",cursive',
    'italic 600 1em Georgia,"Times New Roman",serif',
  ];
  function typed(text, styleIndex, big) {
    const c = document.createElement('canvas');
    const fs = big ? 64 : 52;
    c.width = 900; c.height = 180;
    const x = c.getContext('2d');
    const f = SCRIPTS[styleIndex] || SCRIPTS[0];
    x.font = f.startsWith('italic') ? f.replace('1em', `${fs}px`) : `${fs}px ${f}`;
    x.fillStyle = '#14213d'; x.textBaseline = 'middle';
    let size = fs;
    while (x.measureText(text).width > c.width - 40 && size > 18) { size -= 4; x.font = f.startsWith('italic') ? f.replace('1em', `${size}px`) : `${size}px ${f}`; }
    x.fillText(text, 20, c.height / 2);
    return trim(c);
  }
  const initialsOf = (name) => String(name || '').trim().split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).filter((ch) => /[A-Z]/.test(ch)).slice(0, 3).join('') || '';

  // ---------- awaiting: sign ----------
  const S = { name: '', consent: false, signature: '', initials: '', values: {}, applied: new Set(), started: false };
  let spots = [];
  function spotEls() {
    return [...document.querySelectorAll('[data-spot]')].filter((n) => !n.closest('.ds-ui'));
  }
  function done(n) {
    if (n.dataset.mark) return S.applied.has(n.dataset.spot);
    const v = S.values[n.dataset.spot];
    return n.dataset.kind === 'check' ? v === true : v != null && String(v).trim() !== '';
  }
  function progress() {
    const req = spots.filter((n) => n.dataset.req);
    const left = req.filter((n) => !done(n));
    return { total: req.length, left: left.length, first: left[0] || spots.find((n) => !done(n)) || null };
  }
  function refreshBar() {
    const p = progress();
    const n = p.total - p.left;
    const finish = p.left === 0;
    setBar(`<div class="ds-msg"><b>${finish ? 'All done. Press Finish to sign.' : `${p.left} ${p.left === 1 ? 'step' : 'steps'} left`}</b>
      <small>${esc(info.title)}</small><div class="ds-prog" aria-hidden="true"><i style="width:${p.total ? Math.round((n / p.total) * 100) : 100}%"></i></div></div>
      <button type="button" class="ds-btn link" data-act="decline">Decline</button>
      <button type="button" class="ds-btn ${finish ? 'primary' : 'warn'}" data-act="${finish ? 'finish' : 'next'}">${finish ? 'Finish' : (S.started ? 'Next ↓' : 'Start ↓')}</button>`);
    barIn.querySelector('[data-act="decline"]').onclick = declineSheet;
    const go = barIn.querySelector('[data-act="next"], [data-act="finish"]');
    go.onclick = () => (finish ? finishSheet() : next());
  }
  function next() {
    S.started = true;
    const p = progress();
    if (!p.first) return refreshBar();
    focusSpot(p.first);
    refreshBar();
  }
  function focusSpot(n) {
    n.scrollIntoView({ behavior: 'smooth', block: 'center' });
    n.classList.remove('ds-pulse'); void n.offsetWidth; n.classList.add('ds-pulse');
    const f = n.querySelector('input, textarea');
    if (f) setTimeout(() => f.focus({ preventScroll: true }), 350);
  }

  // A signature spot: the first tap adopts a signature; later taps place the same one.
  function wireSign(n) {
    n.setAttribute('role', 'button');
    n.setAttribute('tabindex', '0');
    n.classList.add('ds-spot-focus');
    n.setAttribute('aria-label', n.dataset.mark === 'initials' ? 'Add your initials here' : 'Sign here');
    const act = () => {
      const mark = n.dataset.mark;
      if (S.applied.has(n.dataset.spot)) return adoptSheet(mark, n);
      if (mark === 'signature' ? S.signature : S.initials) return place(n);
      adoptSheet(mark, n);
    };
    n.addEventListener('click', act);
    n.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
  }
  function place(n) {
    const img = n.dataset.mark === 'signature' ? S.signature : S.initials;
    const box = n.querySelector('.nv-sg-box');
    box.innerHTML = `<img src="${img}" alt="${n.dataset.mark === 'initials' ? 'Your initials' : 'Your signature'}">`;
    const name = n.querySelector('.nv-sg-n');
    if (name) name.innerHTML = `${esc(S.name)}<span class="nv-sg-e"> · signs electronically</span>`;
    const d = n.querySelector('.nv-sg-d');
    if (d) d.textContent = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    n.classList.add('ds-done');
    S.applied.add(n.dataset.spot);
    // Every spot of the same kind uses the same signature, so a change shows everywhere it was already placed.
    spots.filter((m) => m !== n && m.dataset.mark === n.dataset.mark && S.applied.has(m.dataset.spot)).forEach((m) => { m.querySelector('.nv-sg-box').innerHTML = box.innerHTML; });
    refreshBar();
    const p = progress();
    if (p.first && p.left) setTimeout(() => focusSpot(p.first), 250);
  }

  function adoptSheet(mark, spot) {
    const ini = mark === 'initials';
    let tab = 'draw', style = 0;
    const { root, close } = sheet(`<h2>${ini ? 'Add your initials' : 'Adopt your signature'}</h2>
      <p class="ds-sub">${ini ? 'Your initials go in every initials spot.' : 'Your signature goes in every place you are asked to sign.'}</p>
      <label class="ds-l" for="ds-nm">Full name</label><input type="text" id="ds-nm" autocomplete="name" value="${esc(S.name)}">
      <div class="ds-tabs" role="tablist"><button type="button" class="ds-tab" role="tab" data-tab="draw" aria-selected="true">Draw</button><button type="button" class="ds-tab" role="tab" data-tab="type" aria-selected="false">Type</button></div>
      <div data-pane="draw"><div class="ds-pad-wrap"><canvas class="ds-pad${ini ? ' ini' : ''}" aria-label="Draw your ${ini ? 'initials' : 'signature'} here"></canvas><div class="ds-pad-line"></div><div class="ds-pad-x">×</div><div class="ds-pad-hint">${ini ? 'Draw your initials' : 'Sign with your finger or mouse'}</div></div>
        <div class="ds-pad-tools"><span>${ini ? '' : 'Tip: turn your phone sideways for more room.'}</span><button type="button" class="ds-btn link" data-clear>Clear</button></div></div>
      <div data-pane="type" hidden>${ini ? '<label class="ds-l" for="ds-ini">Initials</label><input type="text" id="ds-ini" maxlength="4" autocapitalize="characters">' : ''}<div class="ds-typed"></div></div>
      <p class="ds-legal">By pressing ${ini ? 'Use these initials' : 'Adopt and sign'}, you agree this is your electronic ${ini ? 'initials' : 'signature'}, with the same effect as signing by hand.</p>
      <div class="ds-err" role="alert"></div>
      <div class="ds-acts"><button type="button" class="ds-btn" data-close>Cancel</button><button type="button" class="ds-btn primary" data-ok>${ini ? 'Use these initials' : 'Adopt and sign'}</button></div>`);
    const canvas = root.querySelector('canvas');
    const hint = root.querySelector('.ds-pad-hint');
    const p = pad(canvas);
    canvas.addEventListener('change', () => { hint.hidden = !p.empty(); });
    root.querySelector('[data-clear]').onclick = () => p.clear();
    const nm = root.querySelector('#ds-nm');
    const iniIn = root.querySelector('#ds-ini');
    if (iniIn) iniIn.value = initialsOf(S.name);
    const typedText = () => (ini ? (iniIn.value || initialsOf(nm.value)).toUpperCase() : nm.value.trim());
    function drawStyles() {
      const t = typedText();
      root.querySelector('.ds-typed').innerHTML = t ? SCRIPTS.map((_, i) => `<button type="button" class="ds-style" data-style="${i}" aria-pressed="${i === style}"><img alt="Style ${i + 1}" src="${typed(t, i, ini)}"></button>`).join('') : '<p class="ds-sub">Type your name above.</p>';
      root.querySelectorAll('[data-style]').forEach((b) => { b.onclick = () => { style = Number(b.dataset.style); drawStyles(); }; });
    }
    nm.addEventListener('input', () => { if (iniIn && !iniIn.dataset.touched) iniIn.value = initialsOf(nm.value); if (tab === 'type') drawStyles(); });
    if (iniIn) iniIn.addEventListener('input', () => { iniIn.dataset.touched = '1'; drawStyles(); });
    root.querySelectorAll('[data-tab]').forEach((b) => {
      b.onclick = () => {
        tab = b.dataset.tab;
        root.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
        root.querySelector('[data-pane="draw"]').hidden = tab !== 'draw';
        root.querySelector('[data-pane="type"]').hidden = tab !== 'type';
        if (tab === 'type') drawStyles();
      };
    });
    root.querySelector('[data-ok]').onclick = () => {
      const err = root.querySelector('.ds-err');
      const name = nm.value.replace(/\s+/g, ' ').trim();
      if (name.length < 2) { err.textContent = 'Type your full name.'; return nm.focus(); }
      let img = '';
      if (tab === 'draw') { if (p.empty()) { err.textContent = ini ? 'Draw your initials in the box, or switch to Type.' : 'Sign in the box, or switch to Type.'; return; } img = p.png(); }
      else { const t = typedText(); if (!t) { err.textContent = 'Type your name first.'; return; } img = typed(t, style, ini); }
      S.name = name;
      if (ini) S.initials = img; else S.signature = img;
      p.dispose();
      close();
      place(spot);
    };
  }

  // A fill-in spot becomes a real field on the page.
  function wireInput(n) {
    const id = n.dataset.spot;
    const kind = n.dataset.kind;
    const label = n.querySelector('.nv-in-l, .nv-in-ct');
    if (label && n.dataset.req && !label.querySelector('.ds-req-mark')) label.insertAdjacentHTML('beforeend', '<span class="ds-req-mark" aria-hidden="true">*</span>');
    const mark = () => { n.classList.toggle('ds-done', done(n)); refreshBar(); };
    if (kind === 'check') {
      const cb = n.querySelector('.nv-cb');
      n.setAttribute('role', 'checkbox'); n.setAttribute('tabindex', '0'); n.setAttribute('aria-checked', 'false'); n.classList.add('ds-spot-focus');
      const toggle = () => { S.values[id] = !S.values[id]; cb.classList.toggle('on', S.values[id]); n.setAttribute('aria-checked', String(S.values[id])); mark(); };
      n.addEventListener('click', toggle);
      n.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } });
      return;
    }
    if (kind === 'choice') {
      n.setAttribute('role', 'radiogroup');
      n.querySelectorAll('.nv-in-opt').forEach((o) => {
        o.setAttribute('role', 'radio'); o.setAttribute('tabindex', '0'); o.setAttribute('aria-checked', 'false'); o.classList.add('ds-spot-focus');
        const pick = () => {
          S.values[id] = o.dataset.opt;
          n.querySelectorAll('.nv-in-opt').forEach((x) => { x.classList.toggle('on', x === o); x.setAttribute('aria-checked', String(x === o)); });
          mark();
        };
        o.addEventListener('click', pick);
        o.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pick(); } });
      });
      return;
    }
    const v = n.querySelector('.nv-in-v');
    const lines = Number(n.dataset.lines) || 1;
    const lab = label ? label.textContent.replace(/\*$/, '').trim() : 'Fill in';
    const f = kind === 'date' ? el('<input type="date" class="ds-field">') : lines > 1 ? el(`<textarea class="ds-field" rows="${lines}"></textarea>`) : el('<input type="text" class="ds-field">');
    f.setAttribute('aria-label', lab);
    if (n.dataset.ph) f.placeholder = n.dataset.ph;
    if (n.dataset.req) f.required = true;
    f.maxLength = lines > 1 ? 1500 : 300;
    v.innerHTML = '';
    v.style.minHeight = '0';
    v.appendChild(f);
    f.addEventListener('input', () => { S.values[id] = f.value; mark(); });
    f.addEventListener('click', (e) => e.stopPropagation());
  }

  function startSheet() {
    const c = info.company || {};
    const consent = info.consent;
    const { root, close } = sheet(`<h2>${esc(c.name || 'We')} sent you a document to sign</h2>
      <p class="ds-sub">${esc(info.title)}</p>
      <p>${info.in_person ? 'Read it through, then sign right here on this device.' : 'Read it through, then tap each yellow <b>Sign here</b> flag. It takes about a minute.'}</p>
      <label class="ds-l" for="ds-start-nm">Your full name</label><input type="text" id="ds-start-nm" autocomplete="name" value="${esc(S.name || info.signer.name || '')}">
      ${consent ? `<details class="ds-disc"><summary>Read the electronic signature disclosure</summary><div>${consent.map((x) => `<p>${esc(x)}</p>`).join('')}</div></details>
      <label class="ds-check"><input type="checkbox" id="ds-consent"${S.consent ? ' checked' : ''}> <span>I agree to use electronic records and signatures.</span></label>` : ''}
      <div class="ds-err" role="alert"></div>
      <div class="ds-acts"><button type="button" class="ds-btn" data-close>Read first</button><button type="button" class="ds-btn primary" data-ok>Continue</button></div>`);
    root.querySelector('[data-ok]').onclick = () => {
      const name = root.querySelector('#ds-start-nm').value.replace(/\s+/g, ' ').trim();
      const err = root.querySelector('.ds-err');
      if (name.length < 2) { err.textContent = 'Type your full name.'; return; }
      if (consent && !root.querySelector('#ds-consent').checked) { err.textContent = 'Tick the box to agree to sign electronically, or contact us to sign on paper.'; return; }
      S.name = name;
      S.consent = true;
      close();
      next();
    };
  }

  function finishSheet() {
    if (info.consent && !S.consent) return startSheet();
    const p = progress();
    if (p.left) return next();
    const { root, close } = sheet(`<h2>Ready to sign?</h2>
      <p>You are signing <b>${esc(info.title)}</b> as <b>${esc(S.name)}</b>.</p>
      ${info.cancel?.days ? `<p class="ds-sub">You can cancel within ${esc(info.cancel.days)} business days after signing. You will get the exact last day, and a copy, right after you sign.</p>` : ''}
      <p class="ds-legal">By pressing Sign, you agree that your electronic signature is the legal equivalent of your handwritten signature on this document.</p>
      <div class="ds-err" role="alert"></div>
      <div class="ds-acts"><button type="button" class="ds-btn" data-close>Back</button><button type="button" class="ds-btn primary" data-ok>Sign</button></div>`);
    const ok = root.querySelector('[data-ok]');
    ok.onclick = async () => {
      ok.disabled = true;
      ok.textContent = 'Signing…';
      try {
        await call('/nuvolve/app/sign', { name: S.name, consent: S.consent, signature: S.signature || undefined, initials: S.initials || undefined, values: S.values, applied: [...S.applied] });
        close();
        reload();
      } catch (e) {
        root.querySelector('.ds-err').textContent = e.message;
        ok.disabled = false;
        ok.textContent = 'Sign';
      }
    };
  }

  function declineSheet() {
    const { root } = sheet(`<h2>Decline to sign?</h2>
      <p>${esc(info.company?.name || 'The company')} will be told you declined. You can still call them if you change your mind.</p>
      <label class="ds-l" for="ds-why">Mind telling us why? (optional)</label><textarea id="ds-why" maxlength="300" placeholder="Price, timing, questions about the terms..."></textarea>
      <div class="ds-err" role="alert"></div>
      <div class="ds-acts"><button type="button" class="ds-btn" data-close>Back</button><button type="button" class="ds-btn danger" data-ok>Decline</button></div>`);
    root.querySelector('[data-ok]').onclick = async (e) => {
      e.target.disabled = true;
      try { await call('/decline', { reason: root.querySelector('#ds-why').value }); reload(); } catch (err) { root.querySelector('.ds-err').textContent = err.message; e.target.disabled = false; }
    };
  }

  function cancelSheet() {
    const { root } = sheet(`<h2>Cancel this agreement</h2>
      <p>You can cancel without any penalty until midnight on <b>${esc(info.cancel.by_long)}</b>. Anything you paid will be returned within 10 business days.</p>
      <label class="ds-l" for="ds-cn">Type your full name to cancel</label><input type="text" id="ds-cn" autocomplete="name" value="">
      <label class="ds-l" for="ds-cr">Reason (optional)</label><textarea id="ds-cr" maxlength="300"></textarea>
      <div class="ds-err" role="alert"></div>
      <div class="ds-acts"><button type="button" class="ds-btn" data-close>Keep my agreement</button><button type="button" class="ds-btn danger" data-ok>I hereby cancel this transaction</button></div>`);
    root.querySelector('[data-ok]').onclick = async (e) => {
      const name = root.querySelector('#ds-cn').value.trim();
      if (name.length < 2) { root.querySelector('.ds-err').textContent = 'Type your full name to cancel.'; return; }
      e.target.disabled = true;
      try { await call('/cancel', { name, reason: root.querySelector('#ds-cr').value }); reload(); } catch (err) { root.querySelector('.ds-err').textContent = err.message; e.target.disabled = false; }
    };
  }

  // ---------- each state ----------
  function awaiting() {
    S.name = info.signer.name || '';
    spots = spotEls();
    spots.forEach((n) => (n.dataset.mark ? wireSign(n) : wireInput(n)));
    refreshBar();
    startSheet();
  }
  function signed() {
    const cancel = info.cancel || {};
    if (info.in_person && fromSell) {
      sheet(`<div class="ds-done-big"><div class="ds-tick">✓</div><h2>Signed. Thank you!</h2><p>A copy is on its way to ${esc(info.signer.email || 'your email')}. Please hand the device back.</p></div>
        <div class="ds-acts"><button type="button" class="ds-btn" data-close>View the signed copy</button>${nextDoor()}</div>`);
    }
    banner('ok', `<b>Signed</b> by ${esc(info.signed?.name || '')} on ${esc(info.signed?.at || '')}.${cancel.open ? ` You can cancel until midnight on <b>${esc(cancel.by_long)}</b>.` : ''}`);
    setBar(`<div class="ds-msg"><b>✓ Signed</b><small>${esc(info.title)}</small></div>
      ${cancel.open ? '<button type="button" class="ds-btn link" data-act="cancel">Cancel this agreement</button>' : ''}
      ${document.querySelector('a[href$="/pdf"]') ? `<a class="ds-btn${fromSell ? '' : ' primary'}" href="${base}/pdf">Download PDF</a>` : '<button type="button" class="ds-btn primary" data-act="print">Print</button>'}${nextDoor()}`);
    const c = barIn.querySelector('[data-act="cancel"]');
    if (c) c.onclick = cancelSheet;
    const pr = barIn.querySelector('[data-act="print"]');
    if (pr) pr.onclick = () => window.print();
  }
  function closed(st) {
    const msg = {
      cancelled: `<b>Cancelled</b>${info.cancelled ? ` on ${esc(info.cancelled.at)}${info.cancelled.by ? ` by ${esc(info.cancelled.by)}` : ''}` : ''}. Nothing more is owed under this agreement.`,
      declined: `You declined to sign this. Changed your mind? Contact ${esc(info.company?.name || 'us')}${contact() ? ` at ${contact()}` : ''} for a new copy.`,
      expired: `This signing link has expired. Contact ${esc(info.company?.name || 'us')}${contact() ? ` at ${contact()}` : ''} for a new one.`,
      void: `This document was withdrawn by ${esc(info.company?.name || 'the company')}. Nothing needs to be signed.`,
    }[st];
    banner(st === 'cancelled' ? 'info' : 'stop', msg || esc(info.status_label || ''));
    if (fromSell) setBar(`<div class="ds-msg"><b>${esc(info.status_label || '')}</b><small>${esc(info.title)}</small></div>${nextDoor()}`);
  }

  call('/info').then((j) => {
    info = j;
    if (j.status === 'awaiting') awaiting();
    else if (j.status === 'signed') signed();
    else closed(j.status);
  }).catch((e) => { banner('stop', esc(e.message)); });
  if (status && status !== 'awaiting') body.dataset.sign = status;
}());
