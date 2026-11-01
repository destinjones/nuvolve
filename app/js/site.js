// The public site's small helpers (the landing page and the pages in src/pages/): conversion events, the lead and
// waitlist forms, the ROI calculator and the status page. Nothing here is needed to read a page.
(function () {
  'use strict';
  // ---------- events ----------
  // Plausible counts them when the site has PLAUSIBLE_DOMAIN set; anything listening on dataLayer (Google Tag
  // Manager) hears them too. With neither, they go nowhere.
  window.plausible = window.plausible || function () { (window.plausible.q = window.plausible.q || []).push(arguments); };
  window.dataLayer = window.dataLayer || [];
  function track(name, props) {
    try {
      window.plausible(name, props ? { props: props } : undefined);
      window.dataLayer.push(Object.assign({ event: name }, props || {}));
    } catch (e) { /* never break a click */ }
  }
  window.nvTrack = track;
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-event]');
    if (!a) return;
    track(a.getAttribute('data-event'), { where: a.getAttribute('data-where') || document.body.getAttribute('data-page') || 'home' });
  });

  // ---------- lead forms ----------
  // <form data-lead="waitlist|beta|newsletter|call"> posts to the body's data-lead-url (the server's /nuvolve/app/api/site/lead,
  // or a form service like Formspree on the static site). With no address set, it opens an email instead, and says so.
  function leadUrl() { return document.body.getAttribute('data-lead-url') || ''; }
  function supportEmail() { return document.body.getAttribute('data-support-email') || 'support@nuvolvecrm.com'; }
  function say(form, text, ok) {
    var out = form.querySelector('.form-msg');
    if (!out) { out = document.createElement('p'); out.className = 'form-msg small'; out.setAttribute('role', 'status'); form.appendChild(out); }
    out.textContent = text;
    out.className = 'form-msg small ' + (ok ? 'ok' : 'err');
  }
  document.querySelectorAll('form[data-lead]').forEach(function (form) {
    var from = new URLSearchParams(location.search).get('from');
    if (from && form.elements.source) form.elements.source.value = from;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = String(v).trim(); });
      data.kind = form.getAttribute('data-lead');
      data.page = location.pathname;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email || '')) { say(form, 'Please check the email address.', false); return; }
      if (data.website) return; // the hidden field only robots fill in
      var url = leadUrl();
      var done = function () {
        track('Lead', { kind: data.kind, source: data.source || '' });
        form.reset();
        say(form, form.getAttribute('data-thanks') || "Thanks. You're on the list, and we'll be in touch.", true);
      };
      if (!url) {
        var lines = Object.keys(data).filter(function (k) { return data[k] && k !== 'website'; }).map(function (k) { return k + ': ' + data[k]; });
        location.href = 'mailto:' + supportEmail() + '?subject=' + encodeURIComponent('Nuvolve ' + data.kind) + '&body=' + encodeURIComponent(lines.join('\n'));
        say(form, 'Your email app should open with this filled in. Press send there to finish.', true);
        track('Lead', { kind: data.kind, via: 'email' });
        return;
      }
      var btn = form.querySelector('button[type=submit]');
      if (btn) btn.disabled = true;
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { if (!r.ok) throw new Error(r.status); done(); })
        .catch(function () { say(form, "That didn't go through. Please email " + supportEmail() + ' instead.', false); })
        .then(function () { if (btn) btn.disabled = false; });
    });
  });

  // ---------- ROI calculator ----------
  var roi = document.getElementById('roi');
  if (roi) {
    var money = function (n) { return (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US'); };
    var num = function (id) { var v = parseFloat((document.getElementById(id) || {}).value); return isFinite(v) ? v : 0; };
    var put = function (id, text) { var el = document.getElementById(id); if (el) el.textContent = text; };
    var used = false;
    var calc = function () {
      var price = Number(roi.getAttribute('data-price-cents')) / 100;
      var routes = Math.max(1, Math.round(num('r-routes')));
      var nuvolve = routes * price;
      var software = num('r-software');
      var officeHours = num('r-office-hours') * (num('r-office-saved') / 100) * 4.33;
      var officeDollars = officeHours * num('r-wage');
      var pastDue = num('r-pastdue');
      var collected = pastDue * (num('r-collect') / 100);
      var cancels = num('r-cancels') * (num('r-saved') / 100) * num('r-plan-value');
      var monthly = (software - nuvolve) + officeDollars + cancels;
      put('o-nuvolve', money(nuvolve));
      put('o-software', money(software - nuvolve));
      put('o-office', money(officeDollars) + ' (' + Math.round(officeHours) + ' hours)');
      put('o-cancels', money(cancels));
      put('o-cash', money(collected));
      put('o-total', money(monthly));
      put('o-year', money(monthly * 12));
      if (!used) { used = true; track('ROI calculator used'); }
    };
    roi.addEventListener('input', calc);
    roi.addEventListener('submit', function (e) { e.preventDefault(); });
    used = true; calc(); used = false;
  }

  // ---------- status ----------
  var st = document.getElementById('status-live');
  if (st) {
    var api = st.getAttribute('data-api');
    var NAMES = { database: 'Database', data_dir: 'Saving files', disk: 'Disk space', backup: 'Nightly backup', backup_offsite: 'Off-site backup copy' };
    var WORDS = { ok: 'Working', error: 'Down', low: 'Running low', unknown: 'Unknown', none: 'None yet', stale: 'Late', off: 'Not set up', failed: 'Failed' };
    var show = function (overall, rows) {
      st.querySelector('.overall').textContent = overall;
      st.querySelector('tbody').innerHTML = rows.map(function (r) {
        return '<tr><td>' + r[0] + '</td><td class="state-' + r[2] + '">' + r[1] + '</td></tr>';
      }).join('');
    };
    if (!api) {
      show('The hosted service has not launched yet, so there is nothing to check. The demo on this site runs in your browser and is always up.', []);
    } else {
      fetch(api, { cache: 'no-store' }).then(function (r) { return r.json().then(function (j) { return { up: r.ok, j: j }; }); })
        .then(function (x) {
          var rows = Object.keys(NAMES).filter(function (k) { return k in x.j.checks; }).map(function (k) {
            var s = x.j.checks[k];
            var good = s === 'ok' ? 'ok' : (s === 'error' || s === 'failed') ? 'bad' : 'warn';
            return [NAMES[k], WORDS[s] || s, good];
          });
          show(x.up ? 'Nuvolve is up. Checked ' + new Date().toLocaleTimeString() + '.' : 'Nuvolve is having trouble right now. We are on it.', rows);
        })
        .catch(function () { show("We couldn't reach Nuvolve from your browser. If the app won't load for you either, it's down and we are on it.", []); });
    }
  }
})();
