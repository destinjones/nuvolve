// Retention: who is likely to cancel and why, save offers, win-backs, and the autopilot settings.

const RISK_COLOR = { high: 'var(--danger, #c53030)', medium: 'var(--warn, #b7791f)', low: 'var(--brand, #2f855a)' };
const OFFER_STATUS = { sent: ['Sent', 'blue'], accepted: ['Claimed', 'green'], declined: ['Said no', 'red'], expired: ['Expired', ''] };
const offerPill = (o) => { const [l, c] = OFFER_STATUS[o.status] || [o.status, '']; return `<span class="pill ${c}">${esc(l)}</span>`; };
const riskMeter = (r) => `<div title="Risk score ${r.score} of 100" style="display:flex;align-items:center;gap:8px;min-width:110px">
  <div style="flex:1;height:8px;border-radius:4px;background:var(--line)"><div style="width:${r.score}%;height:8px;border-radius:4px;background:${RISK_COLOR[r.level]}"></div></div>
  <b style="color:${RISK_COLOR[r.level]}">${r.score}</b></div>`;
const NOTE_LABEL = { saved: '✅ Saved', called: '📞 No answer', cancelling: '🚪 Still cancelling', note: '📝 Note' };
const lastTouch = (r) => {
  const bits = [];
  if (r.lastOffer) bits.push(`${r.lastOffer.kind === 'save' ? 'Save' : 'Win-back'} ${r.lastOffer.percent}% ${offerPill(r.lastOffer)} <span class="muted">${fmtDate(r.lastOffer.sent_at)}</span>`);
  if (r.lastNote) bits.push(`${NOTE_LABEL[r.lastNote.outcome] || ''} <span class="muted">${fmtDate(r.lastNote.created_at)}</span>`);
  return bits.join('<br>') || '<span class="muted">Nothing yet</span>';
};

async function pageRetention(view, _id, params) {
  const tab = params.tab || 'risk';
  const d = await api('/nuvolve/app/api/retention');
  const sm = d.summary, cfg = d.config;
  const list = tab === 'risk' ? d.atRisk.filter((r) => params.level !== 'high' || r.level === 'high') : d.atRisk;
  view.innerHTML = `
    <div class="page-head"><div><h1>Retention</h1><div class="muted">Customers likely to cancel, and why. The autopilot sends save offers before they leave and win-back offers after.</div></div>
      <div class="actions">${BOOT.me.isAdmin ? `<button class="btn" id="rt-settings">⚙️ Autopilot settings</button><button class="btn" id="rt-run">▶️ Send due offers now</button>` : ''}</div></div>
    <div class="alert ${cfg.on ? 'info' : 'warn'}"><span>${cfg.on
      ? `🤖 <b>Autopilot is on.</b> Customers scoring ${cfg.threshold}+ get ${cfg.savePercent}% off their next ${cfg.saveVisits === 1 ? 'visit' : cfg.saveVisits + ' visits'}, at most once every ${cfg.cooldown} days. Customers who cancel get ${cfg.winbackPercent}% off to come back at ${cfg.winbackDays.join(', ')} days.`
      : '🤖 <b>Autopilot is off.</b> You can still send offers one at a time below. Turn it on and offers go out by themselves.'}</span>
      ${BOOT.me.isAdmin && !cfg.on ? '<button class="btn sm primary" id="rt-on">Turn on autopilot</button>' : ''}</div>
    <div class="stats">
      <div class="stat ${sm.high ? 'warn' : ''}"><div class="label">High risk</div><div class="value">${sm.high}</div><div class="sub">${sm.medium} more worth watching</div></div>
      <div class="stat"><div class="label">Yearly revenue at risk</div><div class="value">${money(sm.valueAtRisk)}</div><div class="sub">from high-risk accounts</div></div>
      <div class="stat"><div class="label">Saved and won back (90 days)</div><div class="value">${sm.savesWon + sm.winbacksWon}</div><div class="sub">${money(sm.revenueKept)}/yr kept · ${sm.savesSent + sm.winbacksSent} offers sent</div></div>
      <div class="stat"><div class="label">Cancel rate (90 days)</div><div class="value">${sm.churn90}%</div><div class="sub">${sm.lost90} lost of ${sm.active + sm.lost90}</div></div>
    </div>
    <div class="actions" style="margin-bottom:12px">${[['risk', `🚨 At risk (${d.atRisk.length})`], ['lapsed', `👋 Win back (${d.lapsed.length})`], ['offers', `🎁 Offers (${d.offers.length})`]]
      .map(([k, l]) => `<a class="btn sm ${k === tab ? 'primary' : ''}" href="#/retention?tab=${k}">${l}</a>`).join('')}</div>
    <div class="card flush"><div class="table-wrap" id="rt-table"></div></div>`;

  const table = $('#rt-table');
  if (tab === 'risk') {
    table.innerHTML = list.length ? `<div style="padding:12px 16px 0" class="small"><label class="check"><input type="checkbox" id="rt-high" ${params.level === 'high' ? 'checked' : ''}> Only high risk</label></div>
      <table class="list"><thead><tr><th>Customer</th><th>Risk</th><th>Why</th><th class="right">Per year</th><th>Last touch</th><th></th></tr></thead><tbody>
      ${list.map((r) => `<tr><td><a href="#/customers/${r.id}"><b>${esc(r.name)}</b></a>${r.type === 'commercial' ? ' <span class="pill">🏢</span>' : ''}
          <div class="small muted">${r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : esc(r.email || 'No phone or email')}${multiBranch() && r.location_id ? ' · ' + esc(branchName(r.location_id)) : ''}</div></td>
        <td>${riskMeter(r)}</td>
        <td class="small">${r.reasons.map((x) => `<span class="pill yellow" style="margin:1px">${esc(x)}</span>`).join(' ')}${r.protects.length ? `<div class="muted" style="margin-top:2px">Helping: ${esc(r.protects.join(', '))}</div>` : ''}</td>
        <td class="right">${money(r.yearly)}</td>
        <td class="small">${lastTouch(r)}</td>
        <td class="nowrap"><button class="btn sm primary" data-offer="${r.id}">🎁 Offer</button> <button class="btn sm" data-note="${r.id}">📞 Log call</button></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty"><div class="big">🎉</div><h3>Nobody looks at risk right now</h3><p>Skipped visits, declined cards, low ratings and call-backs raise a customer\'s score. They show up here when it climbs.</p></div>';
    if ($('#rt-high')) $('#rt-high').onchange = (e) => { location.hash = `#/retention?tab=risk${e.target.checked ? '&level=high' : ''}`; };
  } else if (tab === 'lapsed') {
    table.innerHTML = d.lapsed.length ? `<table class="list"><thead><tr><th>Customer</th><th>Stopped</th><th>Why they left</th><th class="right">Was worth</th><th>Win-back</th><th></th></tr></thead><tbody>
      ${d.lapsed.map((r) => `<tr><td><a href="#/customers/${r.id}"><b>${esc(r.name)}</b></a><div class="small muted">${esc(r.service_name || '')} · ${FREQ[r.frequency] || ''} · ${money(r.price)}</div></td>
        <td class="nowrap">${fmtDate(r.cancelled_at)}<div class="small muted">${r.days} day${r.days === 1 ? '' : 's'} ago</div></td>
        <td>${esc(r.cancel_reason || '—')}${r.skip ? '<div class="small muted">Not contacted for this reason</div>' : ''}</td>
        <td class="right">${money(r.yearly)}/yr</td>
        <td class="small">${r.won ? '<span class="pill green">Came back</span>' : r.lastOffer ? `Step ${r.sentSteps} of ${cfg.winbackDays.length} ${offerPill(r.lastOffer)}` : '<span class="muted">Not sent</span>'}
          ${!r.won && !r.skip && r.due ? '<div><span class="pill blue">Due now</span></div>' : !r.won && !r.skip && r.nextInDays != null ? `<div class="muted">Next in ${r.nextInDays} days</div>` : ''}</td>
        <td>${r.won ? '' : `<button class="btn sm primary" data-winback="${r.id}">🎁 Send offer</button>`}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty"><div class="big">👋</div><h3>No one to win back</h3><p>Customers who stop every plan show up here so you can invite them back.</p></div>';
  } else {
    table.innerHTML = d.offers.length ? `<table class="list"><thead><tr><th>Sent</th><th>Customer</th><th>Offer</th><th>Status</th><th>By</th></tr></thead><tbody>
      ${d.offers.map((o) => `<tr><td class="nowrap small">${fmtDate(o.sent_at)}</td><td><a href="#/customers/${o.customer_id}">${esc(o.customer_name)}</a></td>
        <td>${o.kind === 'save' ? '🛟 Save' : '👋 Win-back'} · ${o.percent}% off<div class="small muted">${money(o.yearly_value)}/yr account${o.channels && o.channels.includes('logged') ? ' · saved to outbox' : ''}</div></td>
        <td>${offerPill(o)}${o.opened_at && o.status === 'sent' ? ' <span class="small muted">opened</span>' : ''}${o.declined_reason ? `<div class="small muted">"${esc(o.declined_reason)}"</div>` : ''}</td>
        <td class="small">${o.auto ? '🤖 Autopilot' : esc(o.sent_by || '')}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty"><div class="big">🎁</div><h3>No offers yet</h3><p>Offers you or the autopilot send show up here with whether the customer claimed them.</p></div>';
  }

  const byId = (rows, id) => rows.find((r) => r.id === Number(id));
  $$('[data-offer]', view).forEach((b) => (b.onclick = () => offerModal(byId(d.atRisk, b.dataset.offer), 'save', cfg)));
  $$('[data-winback]', view).forEach((b) => (b.onclick = () => offerModal(byId(d.lapsed, b.dataset.winback), 'winback', cfg)));
  $$('[data-note]', view).forEach((b) => (b.onclick = () => noteModal(byId(d.atRisk, b.dataset.note))));
  if ($('#rt-settings')) $('#rt-settings').onclick = () => autopilotModal(cfg);
  if ($('#rt-on')) $('#rt-on').onclick = () => autopilotModal({ ...cfg, on: true });
  if ($('#rt-run')) $('#rt-run').onclick = async (e) => {
    e.target.disabled = true;
    try {
      const r = await api('/nuvolve/app/api/retention/run', { method: 'POST' });
      toast(r.saves + r.winbacks ? `Sent ${r.saves} save and ${r.winbacks} win-back offer${r.saves + r.winbacks === 1 ? '' : 's'}` : 'Nobody is due an offer right now');
      route();
    } catch (err) { toast(err.message, true); e.target.disabled = false; }
  };
}

function offerModal(r, kind, cfg) {
  if (!r) return;
  const pct = kind === 'save' ? cfg.savePercent : cfg.winbackPercent;
  modal(kind === 'save' ? `Save offer for ${r.name}` : `Win back ${r.name}`, `
    ${kind === 'save' ? `<p>They get a thank-you note and a one-tap link to claim a discount on their next ${cfg.saveVisits === 1 ? 'visit' : cfg.saveVisits + ' visits'}. When they claim it, the price on the schedule drops by itself.</p>
      ${r.reasons.length ? `<p class="small muted">At risk because: ${esc(r.reasons.join(', '))}</p>` : ''}`
    : `<p>They get a "we miss you" note with a one-tap link to restart their old plan (${esc(r.service_name || 'service')}, ${FREQ[r.frequency] || ''}). When they tap it, visits go back on the schedule with the discount on the first one.</p>`}
    <div class="field"><label>Discount (%)</label><input name="percent" type="number" min="1" max="50" value="${pct}"></div>
    ${!r.email && !r.phone ? '<div class="alert warn">This customer has no email or phone on file.</div>' : ''}`, [
    { label: 'Cancel' },
    { label: 'Send offer', cls: 'primary', onClick: async (m) => {
      const o = await api('/nuvolve/app/api/retention/offers', { body: { customer_id: r.id, kind, percent: formData(m).percent } });
      toast(o.channels?.includes?.('logged') ? 'Offer saved to the outbox (email not connected yet)' : 'Offer sent');
      route();
    } },
  ]);
}

function noteModal(r) {
  if (!r) return;
  modal(`Save call: ${r.name}`, `
    ${r.phone ? `<p><a class="btn" href="tel:${esc(r.phone)}">📞 Call ${esc(r.phone)}</a></p>` : ''}
    <p class="small muted">Try: "We noticed ${esc((r.reasons[0] || 'it has been a while').toLowerCase())}. We want to make it right." Offer a free re-service before a discount.</p>
    <div class="field"><label>What happened?</label><select name="outcome"><option value="saved">They're staying</option><option value="called">No answer, left a message</option><option value="cancelling">Still want to cancel</option><option value="note">Just a note</option></select></div>
    <div class="field"><label>Note (optional)</label><textarea name="note" placeholder="Coming back out Friday for the ants by the sink"></textarea></div>
    <p class="small muted">"They're staying" pauses autopilot offers to this customer.</p>`, [
    { label: 'Cancel' },
    { label: 'Save', cls: 'primary', onClick: async (m) => { await api(`/nuvolve/app/api/retention/customers/${r.id}/note`, { body: formData(m) }); toast('Logged'); route(); } },
  ]);
}

function autopilotModal(cfg) {
  modal('Retention autopilot', `
    <label class="check" style="margin-bottom:12px"><input type="checkbox" name="retention_autopilot" ${cfg.on ? 'checked' : ''}> <b>Send offers automatically</b></label>
    <h3>Save offers (before they cancel)</h3>
    <div class="row">
      <div class="field"><label>Send at risk score</label><input name="retention_save_threshold" type="number" min="35" max="100" value="${cfg.threshold}"></div>
      <div class="field"><label>Discount (%)</label><input name="retention_save_percent" type="number" min="1" max="50" value="${cfg.savePercent}"></div>
      <div class="field"><label>On how many visits</label><input name="retention_save_visits" type="number" min="1" max="12" value="${cfg.saveVisits}"></div>
    </div>
    <div class="field"><label>At most one save offer per customer every (days)</label><input name="retention_cooldown_days" type="number" min="7" max="365" value="${cfg.cooldown}"></div>
    <h3>Win-back offers (after they cancel)</h3>
    <div class="row">
      <div class="field"><label>Discount on first visit back (%)</label><input name="retention_winback_percent" type="number" min="1" max="50" value="${cfg.winbackPercent}"></div>
      <div class="field"><label>Send this many days after they stop</label><input name="retention_winback_days" value="${esc(cfg.winbackDays.join(', '))}" placeholder="30, 90, 180"></div>
    </div>
    <div class="row">
      <div class="field"><label>Offers can be claimed for (days)</label><input name="retention_offer_days" type="number" min="1" max="90" value="${cfg.offerDays}"></div>
      <div class="field"><label>Never contact people who left because</label><input name="retention_skip_reasons" value="${esc(cfg.skipReasons.map((x) => x[0].toUpperCase() + x.slice(1)).join(', '))}" placeholder="Moving"></div>
    </div>
    <p class="small muted">The score adds points for skipped or overdue visits, a declined card, a rating of 3 stars or lower, call-backs, late bills, a recent price increase and being a new customer. Autopay, a recent 5-star rating and years with you lower it.</p>`, [
    { label: 'Cancel' },
    { label: 'Save', cls: 'primary', onClick: async (m) => {
      const f = formData(m);
      await api('/nuvolve/app/api/retention/settings', { method: 'PUT', body: { ...f, retention_autopilot: Boolean(f.retention_autopilot) } });
      toast(f.retention_autopilot ? 'Autopilot on. Offers go out with the next background run.' : 'Autopilot settings saved');
      route();
    } },
  ]);
}

// Risk badge on a customer's account, so whoever picks up the phone knows to be extra nice.
async function riskBadge(el, customerId) {
  if (!el) return;
  try {
    const { risk } = await api(`/nuvolve/app/api/retention/customers/${customerId}`);
    if (!risk || risk.level === 'low') return;
    el.innerHTML = `<a class="pill ${risk.level === 'high' ? 'red' : 'yellow'}" href="#/retention" title="${esc(risk.reasons.join(' · '))}">🚨 ${risk.level === 'high' ? 'High' : 'Some'} cancel risk (${risk.score})</a>`;
  } catch { /* badge is a nice-to-have */ }
}
