// The animated Nuvolve logo shown once when the app opens (login, the office app, the tech app, the portal).
// It only plays when the connection can carry it: no Data Saver, no reduced motion, online, a connection
// the browser rates fast, and the video actually ready inside a short wait. Otherwise the page opens
// at once with the still logo, so nobody on one bar of signal waits for an animation.
(function () {
  const KEY = 'nv-splash-shown';
  const WAIT_MS = 900;       // longest we hold the page while the video loads
  const STILL_MS = 450;      // how long the still logo shows when the video is skipped mid-wait
  try { if (sessionStorage.getItem(KEY)) return; } catch (e) { /* storage blocked: show it anyway */ }

  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const slowType = conn && /(^|-)(slow-2g|2g|3g)$/.test(conn.effectiveType || '');
  const slowLink = conn && typeof conn.downlink === 'number' && conn.downlink > 0 && conn.downlink < 1.5;
  if (reduceMotion || navigator.onLine === false || (conn && (conn.saveData || slowType || slowLink))) return;

  const here = (document.currentScript && document.currentScript.src) || location.href;
  const asset = (name) => new URL(`../brand/${name}`, here).href;

  const MARK = '<svg viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="nvsplash" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#38a169"/><stop offset="1" stop-color="#22543d"/></linearGradient></defs><path d="M256 36 L436 98 V238 C436 356 360 434 256 476 C152 434 76 356 76 238 V98 Z" fill="url(#nvsplash)"/><path d="M178 344 V172 L334 336 V164" fill="none" stroke="#fff" stroke-width="42" stroke-linecap="round" stroke-linejoin="round"/><circle cx="178" cy="344" r="30" fill="#7ee2a8" stroke="#1f2d27" stroke-width="12"/><circle cx="334" cy="164" r="30" fill="#7ee2a8" stroke="#1f2d27" stroke-width="12"/></svg>';

  const css = document.createElement('style');
  css.textContent = `
#nv-splash{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:#0f1a16;transition:opacity .35s ease;cursor:pointer}
#nv-splash.out{opacity:0;pointer-events:none}
#nv-splash .nv-box{position:relative;width:min(360px,70vmin);aspect-ratio:1}
#nv-splash svg,#nv-splash video{position:absolute;inset:0;width:100%;height:100%}
#nv-splash svg{padding:21%;opacity:0;animation:nvIn .3s ease .05s forwards}
#nv-splash video{opacity:0;transition:opacity .15s;-webkit-mask-image:radial-gradient(circle,#000 60%,transparent 71%);mask-image:radial-gradient(circle,#000 60%,transparent 71%)}
#nv-splash.playing video{opacity:1} #nv-splash.playing svg{display:none}
#nv-splash .nv-word{position:absolute;left:0;right:0;bottom:-6%;text-align:center;font:600 13px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.5em;text-indent:.5em;color:#a8e8c4;opacity:0;transform:translateY(6px)}
#nv-splash.playing .nv-word{animation:nvWord .5s cubic-bezier(.2,.8,.2,1) 1.2s forwards}
@keyframes nvWord{to{opacity:1;transform:none}}
@keyframes nvIn{to{opacity:1}}`;
  document.head.appendChild(css);

  const el = document.createElement('div');
  el.id = 'nv-splash';
  el.setAttribute('role', 'presentation');
  el.innerHTML = `<div class="nv-box">${MARK}<div class="nv-word">NUVOLVE</div></div>`;
  const mount = () => (document.body ? document.body.appendChild(el) : document.addEventListener('DOMContentLoaded', () => document.body.appendChild(el)));
  mount();

  let done = false;
  const finish = () => {
    if (done) return; done = true;
    try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* fine */ } // only once it has really shown, not when the page moved on first
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  };
  el.addEventListener('click', finish);
  document.addEventListener('keydown', finish, { once: true });

  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
  const webm = document.createElement('source'); webm.src = asset('nuvolve-splash.webm'); webm.type = 'video/webm';
  const mp4 = document.createElement('source'); mp4.src = asset('nuvolve-splash.mp4'); mp4.type = 'video/mp4';
  v.append(webm, mp4);

  const giveUp = setTimeout(() => { v.removeAttribute('src'); v.innerHTML = ''; v.load(); setTimeout(finish, STILL_MS); }, WAIT_MS);
  v.addEventListener('canplaythrough', () => {
    if (done) return;
    clearTimeout(giveUp);
    v.play().then(() => el.classList.add('playing')).catch(() => setTimeout(finish, STILL_MS));
  }, { once: true });
  v.addEventListener('ended', () => setTimeout(finish, 250));
  mp4.addEventListener('error', () => { clearTimeout(giveUp); setTimeout(finish, STILL_MS); }); // the last source failing means none can play
  setTimeout(finish, 4500); // never hold the page longer than this, whatever happens
  el.querySelector('.nv-box').appendChild(v);
})();
