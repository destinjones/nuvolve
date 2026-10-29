// Inbox: two-way texts and missed calls, with the AI receptionist answering around the clock.

const INBOX_TABS = [['open', 'Open'], ['human', 'Needs a person'], ['closed', 'Closed']];
let inboxTimer = null;
let tryPhone = '(555) 010-0199'; // the "try it" box keeps its number between plays

function fmtWhen(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
const prettyPhone = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p || ''; };
const convoName = (cv) => cv.customer_name || cv.name || prettyPhone(cv.phone);

async function pageInbox(view, id, params) {
  clearInterval(inboxTimer);
  const tab = INBOX_TABS.some(([k]) => k === params.tab) ? params.tab : 'open';
  const [setup, list] = await Promise.all([api('/nuvolve/app/api/inbox-setup'), api(`/nuvolve/app/api/inbox?status=${tab}${params.q ? `&q=${encodeURIComponent(params.q)}` : ''}`)]);
  const selected = Number(id) || null;
  for (const cv of list.conversations) if (cv.id === selected) cv.unread = 0; // opening it marks it read
  const href = (o) => `#/inbox${o.id ? `/${o.id}` : ''}?${new URLSearchParams({ tab: o.tab ?? tab, ...(params.q ? { q: params.q } : {}) })}`;

  view.innerHTML = `
    <div class="page-head"><div><h1>Inbox</h1><div class="muted">Texts and missed calls in one place. The AI receptionist answers 24/7, quotes from your price book and books jobs on your techs' calendars.</div></div>
      <div class="actions"><button class="btn" id="ib-new">+ New text</button><button class="btn" id="ib-setup">🤖 Receptionist setup</button></div></div>
    ${setup.enabled ? '' : `<div class="alert warn"><span>The AI receptionist is off. Texts still land here, but nobody answers them until someone on the team does.</span>${BOOT.me.isAdmin ? '<button class="btn sm primary" id="ib-on">Turn it on</button>' : ''}</div>`}
    <div class="ib-modes small muted">
      <span>${setup.aiLive ? `🧠 Replies written by Claude (${esc(setup.model)})` : '🧠 Demo receptionist (add ANTHROPIC_API_KEY for Claude)'}</span>
      <span>${setup.smsLive ? '📱 Texts go out through Twilio' : '📱 Texts are saved here until Twilio is connected'}</span>
      <span>${setup.autoBook ? '📅 Books straight onto the calendar' : '📅 Sends times to the office to confirm'}</span>
    </div>
    <div class="inbox">
      <div class="card flush ib-list">
        <div class="ib-tabs">${INBOX_TABS.map(([k, label]) => `<a href="${href({ tab: k, id: null })}" class="${k === tab ? 'on' : ''}">${label}${k === 'open' && list.counts.open ? ` <span class="pill">${list.counts.open}</span>` : k === 'human' && list.counts.human ? ` <span class="pill red">${list.counts.human}</span>` : ''}</a>`).join('')}</div>
        <div class="ib-search"><input id="ib-q" placeholder="Search name or phone" value="${esc(params.q || '')}"></div>
        <div id="ib-rows">${list.conversations.length ? list.conversations.map((cv) => `
          <a class="ib-row ${cv.id === selected ? 'on' : ''} ${cv.unread ? 'unread' : ''}" href="${href({ id: cv.id })}">
            <div class="ib-top"><b>${esc(convoName(cv))}</b><span class="small muted">${fmtWhen(cv.last_at)}</span></div>
            <div class="ib-prev small muted">${esc(cv.last_preview || '')}</div>
            <div class="ib-tags">${cv.unread ? `<span class="pill blue">${cv.unread} new</span>` : ''}${cv.needs_human ? '<span class="pill red">🙋 Needs a person</span>' : ''}${cv.ai_on && !cv.opted_out ? '<span class="pill green">🤖 AI</span>' : ''}${cv.opted_out ? '<span class="pill">Opted out</span>' : ''}${!cv.customer_id ? '<span class="pill yellow">New lead</span>' : ''}</div>
          </a>`).join('') : `<div class="empty"><div class="big">💬</div><h3>${tab === 'human' ? 'Nothing waiting on you' : 'No conversations yet'}</h3><p>${tab === 'open' ? 'Texts and missed calls show up here.' : ''}</p></div>`}</div>
      </div>
      <div class="card ib-thread" id="ib-thread">${selected ? '<p class="muted">Loading...</p>' : `<div class="empty"><div class="big">👈</div><h3>Pick a conversation</h3><p>Or try the receptionist below.</p></div>`}</div>
    </div>
    ${setup.smsLive ? '' : `<div class="card"><div class="card-head"><h2>Try the receptionist</h2><span class="small muted">Plays a text or missed call as if it came from this number. Nothing is really sent.</span></div>
      <div class="ib-try">
        <div class="field"><label>From</label><input id="try-phone" value="${esc(tryPhone)}" inputmode="tel"></div>
        <div class="field"><label>Their text</label><input id="try-body" placeholder="How much to get rid of ants?"></div>
        <div class="field"><button class="btn primary" id="try-text">Send as customer</button></div>
        <div class="field"><button class="btn" id="try-call">📞 Missed call</button></div>
      </div></div>`}`;

  $('#ib-q').onkeydown = (e) => { if (e.key === 'Enter') location.hash = `#/inbox?${new URLSearchParams({ tab, ...(e.target.value.trim() ? { q: e.target.value.trim() } : {}) })}`; };
  $('#ib-setup').onclick = () => receptionistSetup(setup);
  $('#ib-new').onclick = newTextModal;
  if ($('#ib-on')) $('#ib-on').onclick = async () => { await api('/nuvolve/app/api/inbox-setup', { method: 'PUT', body: { enabled: true } }); toast('The AI receptionist is on'); route(); };
  if ($('#try-text')) {
    const play = async (kind) => {
      const body = $('#try-body').value.trim();
      if (kind === 'text' && !body) return toast('Type what the customer texts', true);
      const btn = kind === 'call' ? $('#try-call') : $('#try-text');
      btn.disabled = true;
      try {
        tryPhone = $('#try-phone').value;
        const r = await api('/nuvolve/app/api/inbox/simulate', { body: { kind, phone: tryPhone, body } });
        $('#try-body').value = '';
        location.hash = href({ id: r.conversation_id, tab: 'open' });
        if (selected === r.conversation_id) route(true);
      } catch (e) { toast(e.message, true); } finally { btn.disabled = false; }
    };
    $('#try-text').onclick = () => play('text');
    $('#try-body').onkeydown = (e) => { if (e.key === 'Enter') play('text'); };
    $('#try-call').onclick = () => play('call');
  }
  if (selected) await renderThread($('#ib-thread'), selected);

  // New texts come in while the page is open.
  const here = location.hash;
  inboxTimer = setInterval(async () => {
    if (location.hash !== here) return clearInterval(inboxTimer);
    if (document.activeElement && ['TEXTAREA', 'INPUT'].includes(document.activeElement.tagName) && document.activeElement.value) return;
    try {
      const fresh = await api(`/nuvolve/app/api/inbox?status=${tab}${params.q ? `&q=${encodeURIComponent(params.q)}` : ''}`);
      const sig = (l) => l.conversations.map((c) => `${c.id}:${c.last_at}:${c.unread}`).join(',');
      if (sig(fresh) !== sig(list)) route(true);
    } catch { /* offline for a moment */ }
  }, 8000);
}

async function renderThread(box, id) {
  const d = await api(`/nuvolve/app/api/inbox/${id}`);
  const cv = d.conversation;
  const c = d.customer;
  const bubble = (m) => {
    if (m.channel === 'call') return `<div class="ib-event">📞 ${esc(m.body)} · ${fmtWhen(m.created_at)}</div>`;
    if (m.channel === 'note' || m.author === 'system') return `<div class="ib-event">${esc(m.body)} · ${fmtWhen(m.created_at)}</div>`;
    const who = m.direction === 'in' ? '' : m.author === 'ai' ? '🤖 AI receptionist' : esc(m.user_name || 'Office');
    const status = m.status === 'failed' ? ` · <span class="danger" title="${esc(m.error || '')}">not delivered</span>` : m.status === 'logged' ? ' · saved' : '';
    return `<div class="ib-msg ${m.direction} ${m.author}"><div class="ib-bubble">${esc(m.body)}</div><div class="ib-meta small muted">${who ? `${who} · ` : ''}${fmtWhen(m.created_at)}${status}</div></div>`;
  };
  box.innerHTML = `
    <div class="ib-head">
      <div><h2>${esc(c ? custName(c) : cv.name || prettyPhone(cv.phone))}</h2>
        <div class="small muted">${esc(prettyPhone(cv.phone))}${c ? ` · <a href="#/customers/${c.id}">Open account</a>${c.status === 'lead' ? ' <span class="pill yellow">Lead</span>' : ''}` : ' · not a customer yet'}${d.notes.service ? ` · wants ${esc(d.notes.service)}` : ''}</div></div>
      <div class="actions">
        ${cv.opted_out ? '<span class="pill">Texted STOP</span>' : `<button class="btn sm ${cv.ai_on ? 'primary' : ''}" id="ib-ai" title="${cv.ai_on ? 'The AI answers new texts in this thread' : 'Let the AI answer this thread again'}">🤖 AI ${cv.ai_on ? 'on' : 'off'}</button>`}
        <button class="btn sm" id="ib-close">${cv.status === 'closed' ? 'Reopen' : '✓ Done'}</button>
      </div>
    </div>
    ${cv.needs_human ? '<div class="alert warn small">🙋 The receptionist handed this one to the office. Reply below, then mark it done.</div>' : ''}
    ${d.visits.length ? `<div class="ib-visits small">${d.visits.map((v) => `<a href="#/visits/${v.id}">📅 ${fmtDay(v.date)}${v.time_window ? `, ${esc(v.time_window)}` : ''} · ${esc(v.service_name || 'Visit')}${v.tech_name ? ` · ${esc(v.tech_name.split(' ')[0])}` : ''}</a>`).join('')}</div>` : ''}
    <div class="ib-msgs" id="ib-msgs">${d.messages.map(bubble).join('')}</div>
    ${cv.opted_out ? '<p class="small muted">This number opted out of texts. They can text START to opt back in.</p>' : `
    <div class="ib-compose">
      <textarea id="ib-body" rows="2" maxlength="1600" placeholder="Text ${esc(c?.first_name || 'them')}..."></textarea>
      <button class="btn primary" id="ib-send">Send</button>
    </div>
    <div class="small muted">${cv.ai_on ? 'Sending a reply turns the AI off for this thread so you two don\'t talk over each other.' : 'The AI is off here. Turn it back on to let it answer the next text.'}</div>`}`;
  const msgs = $('#ib-msgs', box);
  msgs.scrollTop = msgs.scrollHeight;
  if ($('#ib-ai', box)) $('#ib-ai', box).onclick = async (e) => {
    e.target.disabled = true;
    try { await api(`/nuvolve/app/api/inbox/${id}`, { method: 'PUT', body: { ai_on: !cv.ai_on } }); route(true); } catch (err) { toast(err.message, true); e.target.disabled = false; }
  };
  $('#ib-close', box).onclick = async () => {
    await api(`/nuvolve/app/api/inbox/${id}`, { method: 'PUT', body: { status: cv.status === 'closed' ? 'open' : 'closed' } });
    toast(cv.status === 'closed' ? 'Reopened' : 'Marked done');
    route(true);
  };
  if ($('#ib-send', box)) {
    const send = async () => {
      const body = $('#ib-body', box).value.trim();
      if (!body) return;
      $('#ib-send', box).disabled = true;
      try {
        const r = await api(`/nuvolve/app/api/inbox/${id}/send`, { body: { body } });
        $('#ib-body', box).value = '';
        if (r.status === 'failed') toast('The text did not go through. Check the number.', true);
        route(true);
      } catch (e) { toast(e.message, true); } finally { if ($('#ib-send', box)) $('#ib-send', box).disabled = false; }
    };
    $('#ib-send', box).onclick = send;
    $('#ib-body', box).onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  }
}

function newTextModal() {
  modal('New text', `
    <div class="field"><label>Phone number</label><input name="phone" inputmode="tel" placeholder="(214) 555-0123"></div>
    <div class="field"><label>Message</label><textarea name="body" rows="3" maxlength="1600"></textarea></div>
    <p class="small muted">If this number is already a customer, the thread links to their account.</p>`,
  [{ label: 'Cancel' }, { label: 'Send', cls: 'primary', onClick: async (el) => {
    const r = await api('/nuvolve/app/api/inbox', { body: formData(el) });
    location.hash = `#/inbox/${r.id}`;
  } }]);
}

function receptionistSetup(s) {
  const admin = BOOT.me.isAdmin;
  const dis = admin ? '' : 'disabled';
  const m = modal('AI receptionist', `
    ${admin ? '' : '<div class="alert info small">Only the owner or an admin can change these.</div>'}
    <label class="check"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''} ${dis}> <b>Answer texts automatically, 24/7</b></label>
    <label class="check"><input type="checkbox" name="textBack" ${s.textBack ? 'checked' : ''} ${dis}> Text back every missed call right away</label>
    <label class="check"><input type="checkbox" name="autoBook" ${s.autoBook ? 'checked' : ''} ${dis}> Book straight onto a tech's calendar (off: the office confirms each time first)</label>
    <div class="row">
      <div class="field"><label>Ring this phone first (optional)</label><input name="forwardTo" value="${esc(s.forwardTo)}" placeholder="Office or cell number" ${dis}><div class="small muted">Calls ring here for 20 seconds. If nobody picks up, the receptionist texts them.</div></div>
      <div class="field"><label>Most stops per tech per day</label><input name="dailyCap" type="number" min="1" max="40" value="${s.dailyCap}" ${dis}><div class="small muted">The receptionist only offers times under this, and at most 2 stops per 2-hour window.</div></div>
    </div>
    <div class="field"><label>Missed-call text (optional)</label><textarea name="greeting" rows="2" maxlength="320" placeholder="Hi, this is {company}. Sorry we missed your call! I can give you a price or get you on the schedule right here by text. What's going on?" ${dis}>${esc(s.greeting)}</textarea><div class="small muted">{company} and {name} fill in automatically.</div></div>
    <div class="field"><label>Notes for the receptionist (optional)</label><textarea name="instructions" rows="3" maxlength="2000" placeholder="We don't do wildlife. Mention the $50 off first visit special. Commercial jobs always go to Sam." ${dis}>${esc(s.instructions)}</textarea><div class="small muted">${s.aiLive ? 'Claude follows these when it answers.' : 'Used once Claude is connected (ANTHROPIC_API_KEY).'} Prices always come from your services in Settings.</div></div>
    ${s.techs ? '' : '<div class="alert warn small">Add a tech who runs routes so the receptionist has a calendar to book on.</div>'}
    <h3>Connect your phone number</h3>
    <p class="small muted">${s.smsLive ? 'Twilio is connected.' : 'Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM on the server. Until then, texts are saved here and you can try it with the box on the Inbox page.'} In Twilio, open your number and paste these:</p>
    <div class="field"><label>A message comes in (webhook, POST)</label><div class="copy-row"><input readonly value="${esc(s.smsUrl)}"><button type="button" class="btn sm" data-copy="${esc(s.smsUrl)}">Copy</button></div></div>
    <div class="field"><label>A call comes in (webhook, POST)</label><div class="copy-row"><input readonly value="${esc(s.voiceUrl)}"><button type="button" class="btn sm" data-copy="${esc(s.voiceUrl)}">Copy</button></div></div>`,
  admin ? [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async (el) => {
    await api('/nuvolve/app/api/inbox-setup', { method: 'PUT', body: formData(el) });
    toast('Receptionist saved');
    route();
  } }] : [{ label: 'Close' }]);
  $$('[data-copy]', m.el).forEach((b) => (b.onclick = () => copyText(b.dataset.copy, 'Copied')));
}
