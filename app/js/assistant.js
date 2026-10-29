// Ask Nuvolve: owners and managers ask questions of their own data and get answers and drafts.
let ASK_HISTORY = []; // kept for this browser tab only

// Small, safe markdown: escape everything first, then bold, italics, bullets, rules and line breaks.
function askMarkdown(text) {
  const lines = esc(text).split('\n');
  let html = '', inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\s)_(.+?)_(?=\s|$|[.,])/g, '$1<i>$2</i>');
    const item = line.match(/^\s*[-*•]\s+(.*)$/) || line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (item) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${item[1]}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (/^\s*-{3,}\s*$/.test(line)) html += '<hr>';
    else if (/^#{1,3}\s/.test(line)) html += `<div class="ask-h">${line.replace(/^#{1,3}\s/, '')}</div>`;
    else html += line.trim() ? `<p>${line}</p>` : '';
  }
  return html + (inList ? '</ul>' : '');
}

async function pageAssistant(view) {
  const info = await api('/nuvolve/app/api/assistant');
  view.innerHTML = `
    <div class="page-head"><div><h1>Ask Nuvolve</h1><div class="muted">Ask about your customers, routes, money and team, or have it draft a letter. Answers come only from your company's data${BOOT.me.location_id || currentBranch() ? ' for ' + esc(branchName(BOOT.me.location_id || currentBranch())) : ''}.</div></div>
      <div class="actions"><button class="btn sm" id="ask-clear">New chat</button></div></div>
    ${info.enabled ? '' : '<div class="alert info">Demo mode: the assistant answers a few common questions from your real numbers. Add an Anthropic API key on the server to ask anything.</div>'}
    <div class="card ask-card">
      <div id="ask-log" class="ask-log"></div>
      <div id="ask-suggest" class="ask-suggest">${info.suggestions.map((s) => `<button class="btn sm" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <form id="ask-form" class="ask-form">
        <textarea id="ask-q" rows="2" maxlength="4000" placeholder="e.g. Which zip codes make me the least per stop?"></textarea>
        <button class="btn primary" id="ask-send">Ask</button>
      </form>
      <div class="small muted" style="margin-top:6px">It can read and draft, but never sends anything or changes your records. Check important numbers before acting on them.</div>
    </div>`;
  const log = $('#ask-log'), input = $('#ask-q'), send = $('#ask-send');
  const bubble = (role, text, extra = '') => {
    const el = document.createElement('div');
    el.className = `ask-msg ${role}`;
    el.innerHTML = role === 'user' ? `<p>${esc(text)}</p>` : askMarkdown(text) + extra;
    log.appendChild(el);
    el.scrollIntoView({ block: 'end', behavior: 'smooth' });
    return el;
  };
  const render = () => {
    log.innerHTML = '';
    ASK_HISTORY.forEach((m) => bubble(m.role, m.content));
    $('#ask-suggest').classList.toggle('hidden', ASK_HISTORY.length > 0);
  };
  render();
  const ask = async (q) => {
    q = q.trim();
    if (!q || send.disabled) return;
    $('#ask-suggest').classList.add('hidden');
    bubble('user', q);
    input.value = '';
    send.disabled = true;
    const wait = bubble('assistant', 'Looking through your data...');
    wait.classList.add('muted');
    try {
      const r = await api('/nuvolve/app/api/assistant', { method: 'POST', body: { question: q, history: ASK_HISTORY } });
      wait.remove();
      ASK_HISTORY.push({ role: 'user', content: q }, { role: 'assistant', content: r.answer });
      const el = bubble('assistant', r.answer, '<div class="ask-tools"><button class="btn sm ask-copy">Copy</button></div>');
      $('.ask-copy', el).onclick = async () => {
        try { await navigator.clipboard.writeText(r.answer.replace(/\n\n_Demo mode:[\s\S]*$/, '')); toast('Copied'); } catch { toast('Could not copy', true); }
      };
    } catch (e) {
      wait.remove();
      bubble('assistant', e.message).classList.add('err');
    } finally {
      send.disabled = false;
      input.focus();
    }
  };
  $('#ask-form').onsubmit = (e) => { e.preventDefault(); ask(input.value); };
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); } };
  $$('#ask-suggest [data-q]').forEach((b) => (b.onclick = () => ask(b.dataset.q)));
  $('#ask-clear').onclick = () => { ASK_HISTORY = []; render(); input.focus(); };
  input.focus();
}
