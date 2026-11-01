// The browser side of feature modules (public/js/features/*.js, served joined together as /nuvolve/app/js/features.js).
// Loaded on every page right after common.js and before the page's own script, so a feature can register
// before the first screen draws. Each feature file runs in its own scope; one that breaks can't stop the rest.
//
//   NV.slot(name, fn)        fn(data) returns HTML for a named place in a core screen. Core calls NV.slots(name, data).
//   NV.on(event, fn)         fn(data) runs after a core screen draws (wire your buttons here) or when something happens.
//   NV.page(name, fn)        an office page at #/name, drawn like the core pages: fn(view, id, params).
//   NV.nav(item)             a sidebar link: { href: '#/name', icon: '📞', label, role: 'admin' | 'manager', after: '#/billing' }.
//   NV.settingsTab(tab)      a Settings tab: { key, label, render(el) }.
//   NV.collector(form, fn)   fn(root, data) returns extra fields to send with a core form ('ticket'; 'photo' {visitId,
//                            kind, file} for each picture from a stop's photo strip, whose figures carry data-kind).
//   NV.check(form, fn)       fn(body, data) returns an error message to stop a save, or nothing.
//   NV.override(name, fn)    replaces a core action ('plan.stop', 'customer.new'); core calls NV.run(name, data, fallback).
//   NV.t(text, vars)         the text in the current language (NV.lang: 'en' or 'es'). English text is the key.
//   NV.useLang(lang, {remember})  switches language and loads its translations (from the phone first, then the
//                            server). remember: true keeps the choice on this device (NV.preferredLang reads it).
//
// Slots in the core screens (data passed in brackets):
//   office    today.alerts {d}, customer.tags {c, home}, customer.actions {c}, customer.alerts {c}, customer.left {c},
//             customer.right {c}, visit.left {v}, visit.right {v}, dispatch.side {d} (the dispatch board, under the tech cards)
//             today.request {r} (the buttons under a service request on Today)
//             account.cards {sec} (My account), team.badges {u} (Settings → Team list), team.member {u} (edit team member),
//             settings.security {s} (Company → Login security; named inputs are saved with it)
//   forms     customer.new {params} and customer.new.property {params} (new customer page; send extra fields with
//             NV.collector('customer.new')), customer.form {c} (edit customer), property.form {c, p}, plan.form {c, p, editing}.
//             The edit modals send every named input, so a slot's <input name="..."> goes with the save by itself.
//             inventory.receive {products} (the Received an order modal; its named inputs go with the stock POST).
//   ticket    ticket.fields {visit}  (the stop ticket in the tech app and the office)
//   settings  product.form {p} (the product modal), stock.receive {p} (receiving stock: the product modal, and the
//             Inventory page with no p); both modals send every named input, like the edit modals above
//   tech app  tech.top {r}, tech.stop {v}, tech.stopActions {v}
//             tech.routeStop {s, i} (under each stop on the route list)
//   portal    portal.top {data, token}, portal.cards {data, token}
//   booking   book.form {d} (inside the website booking form, before the button; named inputs are sent with it)
//   settings  settings.payments {d}  (more cards in Settings → Payments & plan, after the Stripe key)
//             settings.data {d} (Import & export: inside the "Take your data with you" card)
//   locked    locked.actions {c, me} (the trial-ended or canceled screen, under Subscribe)
// Overrides: plan.stop {c, plan, done}, portal.move {visit, data, token, reload}, prices.raise {} (Billing's Raise prices),
//            settings.activity {box} (the Activity log tab)
// Events: boot {boot}, page {name, id, params, view}, customer.rendered {c, view}, visit.rendered {v, view},
//         customer.new.rendered {form}, customer.form.rendered {c, el}, property.form.rendered {c, p, el},
//         plan.form.rendered {c, p, editing, el},
//         ticket.rendered {root, visit}, ticket.draft {root, visit, draft}, ticket.saved {visit, result},
//         tech.route.rendered {r, root}, tech.stop.rendered {v, root}, portal.rendered {data, token, root},
//         tech.conflicts {} (the tech tapped "See it" on a ticket that needs them, in the sync bar),
//         book.rendered {d, form}, book.done {d, body, result, root}, book.failed {d, err, form},
//         settings.payments.rendered {d, box}, settings.data.rendered {box, d},
//         account.rendered {view, sec}, team.member.rendered {u, el}
(function () {
  const lists = new Map();
  const list = (k) => lists.get(k) || [];
  const add = (k, v) => { lists.set(k, [...list(k), v]); return () => lists.set(k, list(k).filter((x) => x !== v)); };
  const quiet = (what, fn) => { try { return fn(); } catch (e) { console.error(`feature ${what} failed`, e); return undefined; } };

  const NV = {
    slot: (name, fn) => add(`slot:${name}`, fn),
    slots: (name, data = {}) => list(`slot:${name}`).map((fn) => quiet(`slot ${name}`, () => fn(data)) || '').join(''),
    on: (event, fn) => add(`on:${event}`, fn),
    emit(event, data = {}) {
      for (const fn of list(`on:${event}`)) {
        const r = quiet(`event ${event}`, () => fn(data));
        if (r && typeof r.catch === 'function') r.catch((e) => console.error(`feature event ${event} failed`, e));
      }
    },
    page: (name, fn) => add(`page:${name}`, fn),
    pageFor: (name) => list(`page:${name}`).slice(-1)[0] || null,
    nav: (item) => add('nav', item),
    // The core sidebar plus feature links, each placed after the link it names (or at the end of the list).
    navList(core) {
      const out = [...core];
      for (const n of list('nav')) {
        const row = [n.href, n.icon || '•', n.label, n.role];
        const at = n.after ? out.findIndex((x) => x[0] === n.after) : -1;
        if (at >= 0) out.splice(at + 1, 0, row); else out.push(row);
      }
      return out;
    },
    settingsTab: (tab) => add('settings', tab),
    settingsTabs: () => list('settings'),
    collector: (form, fn) => add(`collect:${form}`, fn),
    collect: (form, root, data) => Object.assign({}, ...list(`collect:${form}`).map((fn) => quiet(`collector ${form}`, () => fn(root, data)) || {})),
    check: (form, fn) => add(`check:${form}`, fn),
    // The first message a check returns, or null when every check is happy.
    problem(form, body, data) {
      for (const fn of list(`check:${form}`)) {
        const msg = quiet(`check ${form}`, () => fn(body, data));
        if (msg) return String(msg);
      }
      return null;
    },
    override: (name, fn) => add(`override:${name}`, fn),
    run(name, data, fallback) {
      const fn = list(`override:${name}`).slice(-1)[0];
      return fn ? fn(data, fallback) : fallback && fallback(data);
    },

    // ---------- language ----------
    lang: 'en',
    strings: {},
    t(text, vars) {
      const tpl = (NV.lang !== 'en' && NV.strings[text]) || text;
      return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
    },
    // The language picked on this phone wins over the account's: pages call NV.useLang(NV.preferredLang(me.lang)).
    preferredLang(fallback) { try { return localStorage.getItem('nv_lang') || fallback || 'en'; } catch { return fallback || 'en'; } },
    async useLang(lang, { remember = false } = {}) {
      const l = String(lang || '').toLowerCase().startsWith('es') ? 'es' : 'en';
      if (remember) { try { localStorage.setItem('nv_lang', l); } catch { /* private mode */ } }
      NV.lang = l;
      document.documentElement.lang = l;
      if (l === 'en') { NV.strings = {}; return l; }
      const key = `nv_i18n_${l}`;
      try { NV.strings = JSON.parse(localStorage.getItem(key) || '{}'); } catch { NV.strings = {}; }
      try {
        const r = await fetch(`/nuvolve/app/api/i18n/${l}`, { credentials: 'same-origin' });
        if (r.ok) {
          NV.strings = (await r.json()).strings || {};
          try { localStorage.setItem(key, JSON.stringify(NV.strings)); } catch { /* storage full or private mode */ }
        }
      } catch { /* offline: the copy on the phone will do */ }
      return l;
    },
  };
  // Until the page picks, use what this device last used, so a Spanish phone draws in Spanish from the first screen.
  try {
    const saved = localStorage.getItem('nv_lang');
    if (saved === 'es') { NV.lang = 'es'; NV.strings = JSON.parse(localStorage.getItem('nv_i18n_es') || '{}'); }
  } catch { /* private mode */ }
  window.NV = NV;
})();
