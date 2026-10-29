// The API documentation page. Drawn from /nuvolve/app/api/v1/openapi.json so it always matches the server.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Just enough Markdown for the spec's descriptions: paragraphs, **bold** and `code`.
const md = (t) => String(t || '').split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`).join('');
const typeOf = (s) => (s.$ref ? s.$ref.split('/').pop() : s.const ? JSON.stringify(s.const) : [].concat(s.type || 'object').filter((t) => t !== 'null').join(' | ') + (s.items ? ` of ${typeOf(s.items)}` : ''));

function fieldTable(schema, spec) {
  const s = schema.$ref ? spec.components.schemas[schema.$ref.split('/').pop()] : schema;
  if (!s?.properties) return '';
  return `<table class="fields">${Object.entries(s.properties).map(([k, v]) => `<tr><td>${esc(k)}${s.required?.includes(k) ? ' <b>*</b>' : ''}</td><td class="muted">${esc(typeOf(v))}</td><td>${esc(v.description || '')}</td></tr>`).join('')}</table>`;
}

const VERIFY = `// Node.js: check that a webhook really came from Nuvolve.
const crypto = require('crypto');

function fromNuvolve(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false; // older than 5 minutes
  const want = Buffer.from(crypto.createHmac('sha256', secret).update(parts.t + '.' + rawBody).digest('hex'));
  const got = Buffer.from(parts.v1 || '');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}`;

async function load() {
  const spec = await (await fetch('/nuvolve/app/api/v1/openapi.json')).json();
  const base = spec.servers[0].url;
  const byTag = {};
  for (const [path, ops] of Object.entries(spec.paths)) for (const [verb, op] of Object.entries(ops)) (byTag[op.tags[0]] ||= []).push({ path, verb, op });
  document.getElementById('root').innerHTML = `
    <h1>${esc(spec.info.title)}</h1><div class="muted">Version ${esc(spec.info.version)} · <a href="/nuvolve/app/api/v1/openapi.json">OpenAPI file</a> (import it into Postman, Insomnia or any code generator)</div>
    <div class="card" style="margin-top:16px"><h2>Quick start</h2>
      <p>Make a key in <b>Settings → API & integrations</b>, then:</p>
      <pre>curl ${esc(base)}/customers?limit=5 \\\n  -H "Authorization: Bearer nvk_..."</pre>
      <pre>curl -X POST ${esc(base)}/leads \\\n  -H "Authorization: Bearer nvk_..." -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: form-8841" \\\n  -d '{"first_name":"Dana","phone":"214-555-0100","address":"12 Oak St","message":"Ants in the kitchen","source":"Website"}'</pre>
      <div class="desc">${md(spec.info.description)}</div></div>
    <div class="card"><h2>Permissions</h2><table class="fields">${Object.entries(spec['x-scopes']).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></div>
    <div class="card"><h2>Webhook events</h2><table class="fields">${Object.entries(spec['x-events']).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v.description)}</td><td class="muted">${esc(v.scope)}</td></tr>`).join('')}</table>
      <p>Check the signature on every delivery:</p><pre>${esc(VERIFY)}</pre></div>
    <nav class="toc card">${Object.keys(byTag).map((t) => `<a href="#${esc(t.replace(/\W+/g, '-'))}">${esc(t)}</a>`).join('')}</nav>
    ${Object.entries(byTag).map(([tag, ops]) => `<div class="card" id="${esc(tag.replace(/\W+/g, '-'))}"><h2>${esc(tag)}</h2>
      ${ops.map(({ path, verb, op }) => {
        const body = op.requestBody?.content['application/json'].schema;
        const okRes = Object.entries(op.responses).find(([c]) => c < 300);
        const res = okRes?.[1].content?.['application/json'].schema;
        return `<details class="ep"><summary><span class="verb ${verb}">${verb.toUpperCase()}</span><code>${esc(path)}</code><span>${esc(op.summary)}</span></summary>
          <div class="desc">${md(op.description)}</div>
          ${op.parameters?.length ? `<h3>Parameters</h3><table class="fields">${op.parameters.map((p) => `<tr><td>${esc(p.name)}</td><td class="muted">${esc(p.in)} · ${esc(typeOf(p.schema))}</td><td>${esc(p.description || '')}</td></tr>`).join('')}</table>` : ''}
          ${body ? `<h3>Body</h3>${fieldTable(body, spec)}` : ''}
          ${res ? `<h3>Returns ${esc(okRes[0])}</h3>${res.properties?.data ? `<p class="small muted">A list of ${esc(typeOf(res.properties.data.items))}</p>${fieldTable(res.properties.data.items, spec)}` : fieldTable(res, spec)}` : ''}
        </details>`;
      }).join('')}</div>`).join('')}`;
}
load().catch(() => { document.getElementById('root').innerHTML = '<p>Could not load the API description. Try again.</p>'; });
