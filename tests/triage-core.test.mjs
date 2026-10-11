// Offline tests for the live triage endpoint. No network, no API key, no deps.
// Run from the repo root: node tests/triage-core.test.mjs
//
// 1. Differential test: loads the real Code nodes from the demo's workflow.json
//    and checks that api/_triage-core.js makes exactly the same decision for
//    every fixture ticket and a set of simulated Gemini responses.
// 2. Handler tests for api/triage.js with a simulated fetch.
//
// The demo repo (github.com/ndvelasquez/n8n-ai-ticket-triage) is read from
// TRIAGE_DEMO_DIR, or by default from ../freelancer_project/demos/ai-ticket-triage
// next to this repo.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { deepStrictEqual } from 'node:assert';
import { buildRequest, validateAndRoute, toPublic, sanitizeForPublic, publicReason, CATEGORIES, PUBLIC_KEYS, WORKFLOW_LIMITS, LIVE_LIMITS } from '../api/_triage-core.js';
import { createHandler, originAllowed, clientIp } from '../api/triage.js';

const here = dirname(fileURLToPath(import.meta.url));
const demoDir = resolve(process.env.TRIAGE_DEMO_DIR ?? join(here, '..', '..', 'freelancer_project', 'demos', 'ai-ticket-triage'));
if (!existsSync(join(demoDir, 'workflow.json'))) {
  console.error(`Demo repo not found at ${demoDir}. Clone github.com/ndvelasquez/n8n-ai-ticket-triage and set TRIAGE_DEMO_DIR.`);
  process.exit(1);
}
const readJson = (f) => JSON.parse(readFileSync(join(demoDir, f), 'utf8'));
const wf = readJson('workflow.json');
const nodeCode = (name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;

// Same technique as the demo's test-logic.mjs.
function runNode(js, { input, named = {} }) {
  const fn = new Function('$input', '$', `return (function(){ ${js} })();`);
  return fn({ first: () => ({ json: input }) }, (n) => ({ first: () => ({ json: named[n] }) }))[0].json;
}
const nodeBuild = (payload) => runNode(nodeCode('Build prompt'), { input: { body: payload } });
const nodeValidate = (ctx, raw) => runNode(nodeCode('Validate and route'), { input: raw, named: { 'Build prompt': ctx } });
// The "Respond" node's own expression, executed (not re-implemented).
const respondExpr = wf.nodes.find((n) => n.name === 'Respond').parameters.responseBody.replace(/^=\{\{/, '').replace(/\}\}$/, '');
const nodeRespond = (validated) => JSON.parse(new Function('$', `return (${respondExpr});`)((n) => ({ first: () => ({ json: validated }) })));
const strip = (o, ...keys) => { const c = { ...o }; for (const k of keys) delete c[k]; return c; };

let passed = 0; let failed = 0;
const failures = [];
function check(label, cond) {
  if (cond) passed++;
  else { failed++; failures.push(label); console.log(`FAIL  ${label}`); }
}
function same(label, a, b) {
  try { deepStrictEqual(a, b); passed++; } catch { failed++; failures.push(label); console.log(`FAIL  ${label}\n  core: ${JSON.stringify(a)}\n  node: ${JSON.stringify(b)}`); }
}

// ---------- fixtures ----------
const expand = (p) => (p && typeof p.body === 'string' && p.body.startsWith('@repeat:')
  ? (() => { const [txt, n] = p.body.slice(8).split(':'); return { ...p, body: txt.repeat(Number(n)) }; })()
  : p);
const fixtures = ['tickets.sample.json', 'tickets.heldout.json', 'tickets.adversarial.json'].flatMap((f) =>
  readJson(f).map((t) => ({ file: f, id: t.id, expected: t.expected, payload: expand(t.payload ?? { id: t.id, subject: t.subject, body: t.body }) })));

// ---------- simulated Gemini responses ----------
const gem = (obj, finish = 'STOP') => ({
  usageMetadata: { promptTokenCount: 310, candidatesTokenCount: 80 },
  candidates: [{ finishReason: finish, content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] } }],
});
function mocks(t, expected) {
  const category = CATEGORIES.includes(expected?.category) ? expected.category : 'other';
  const other = category === 'billing' ? 'account_access' : 'billing';
  const evidence = t.body.trim().slice(0, 40).trim();
  const good = { category, priority: expected?.priority ?? 'normal', language: 'en', confidence: 0.95, reason: 'simulated', evidence, runner_up: 'none' };
  return {
    valid: gem(good),
    invented_evidence: gem({ ...good, evidence: 'a phrase that is nowhere in this ticket' }),
    runner_up_differs: gem({ ...good, runner_up: other }),
    runner_up_same: gem({ ...good, runner_up: category }),
    low_confidence: gem({ ...good, confidence: 0.5 }),
    just_below_threshold: gem({ ...good, confidence: 0.69 }),
    at_threshold: gem({ ...good, confidence: 0.7 }),
    curly_quotes_evidence: gem({ ...good, evidence: `“${evidence.toUpperCase()}”` }),
    broken_json: gem('{"category": "billing", "priority":'),
    max_tokens: gem(good, 'MAX_TOKENS'),
    two_parts: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(good) }, { text: '{}' }] } }] },
    no_candidates: { candidates: [] },
    empty: {},
    error_429: { error: { status: 429 } },
    error_500: { error: { status: 500 } },
    timeout: { error: { code: 'timeout' } },
  };
}

// ---------- 1. differential ----------
let diffCases = 0;
const decision = (r) => ({ suggested_queue: r.suggested_queue, needs_human: r.needs_human, review_reasons: r.review_reasons });
const publicDecision = (r) => ({ ...decision(r), review_reasons: r.review_reasons.map(publicReason) });
for (const fx of fixtures) {
  const nb = nodeBuild(fx.payload);
  const cb = buildRequest(fx.payload, WORKFLOW_LIMITS);
  same(`build ${fx.id}: same validation and request as the workflow node`, cb, strip(nb, 'slackUrl'));
  if (!nb.valid) continue;
  for (const [name, raw] of Object.entries(mocks(fx.payload, fx.expected))) {
    const nv = nodeValidate(nb, raw);
    const cv = validateAndRoute(cb, raw);
    same(`route ${fx.id} / ${name}: same decision`, decision(cv), decision(nv));
    same(`route ${fx.id} / ${name}: same full output`, cv, strip(nv, 'slackUrl'));
    same(`route ${fx.id} / ${name}: public shape = executed Respond node`, toPublic(cv), nodeRespond(nv));
    // HTTP boundary: same decision; failure reasons normalised, every other reason identical to n8n.
    const pub = toPublic(sanitizeForPublic(cv));
    same(`public ${fx.id} / ${name}: decision preserved after sanitising`, { q: pub.suggested_queue, h: pub.needs_human, n: pub.review_reasons.length }, { q: nv.suggested_queue, h: nv.needs_human, n: nv.review_reasons.length });
    same(`public ${fx.id} / ${name}: non-failure reasons identical to n8n`, pub.review_reasons.filter((x) => !x.startsWith('classification failed')), nv.review_reasons.filter((x) => !x.startsWith('classification failed')));
    same(`public ${fx.id} / ${name}: failure reasons = normalised n8n reasons`, pub.review_reasons, nv.review_reasons.map(publicReason));
    diffCases++;
  }
}
check('differential covered every fixture file', new Set(fixtures.map((f) => f.file)).size === 3 && diffCases > 400);
const invalidFixtures = fixtures.filter((f) => !nodeBuild(f.payload).valid).map((f) => f.id);
check('the 3 malformed adversarial payloads are rejected by both', invalidFixtures.join() === 'A-2006,A-2007,A-2008');

// Live limits are stricter, never looser.
check('live limits are stricter than the workflow', LIVE_LIMITS.subject < WORKFLOW_LIMITS.subject && LIVE_LIMITS.body < WORKFLOW_LIMITS.body && LIVE_LIMITS.id <= WORKFLOW_LIMITS.id);
check('live: body of 1001 chars rejected', !buildRequest({ id: 'x', subject: '', body: 'a'.repeat(1001) }, LIVE_LIMITS).valid);
check('live: subject of 121 chars rejected', !buildRequest({ id: 'x', subject: 's'.repeat(121), body: 'hello there' }, LIVE_LIMITS).valid);
check('live: numeric body rejected, not coerced', !buildRequest({ id: 'x', subject: '', body: 12345678 }, LIVE_LIMITS).valid);
check('live: null ticket rejected without throwing', !buildRequest(null, LIVE_LIMITS).valid);

// ---------- widget examples are literal fixture text ----------
const examples = JSON.parse(readFileSync(join(here, '..', 'src', 'data', 'try-examples.json'), 'utf8'));
for (const ex of examples) {
  const src = readJson(ex.source).find((t) => t.id === ex.id);
  check(`example ${ex.id} is literal from ${ex.source}`, src && src.subject === ex.subject && src.body === ex.body);
  check(`example ${ex.id} fits the live limits`, buildRequest(ex, LIVE_LIMITS).valid);
}

// ---------- 2. handler ----------
const SECRET = 'TEST_KEY_NOT_REAL';
const PROVIDER_SECRET = 'provider internal detail xyz';
const okTicket = { id: 'LIVE-1', subject: 'Charged twice for my order', body: 'I was billed twice for order #48213 this morning. Please refund one of the charges today.' };
const geminiOk = gem({ category: 'billing', priority: 'high', language: 'en', confidence: 0.97, reason: 'double charge', evidence: 'billed twice for order #48213', runner_up: 'none' });

function fakeFetch(responder) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return responder(url, init); };
  f.calls = calls;
  return f;
}
const okFetch = () => fakeFetch(() => new Response(JSON.stringify(geminiOk), { status: 200, headers: { 'content-type': 'application/json' } }));

function req({ method = 'POST', body = okTicket, headers = {}, raw } = {}) {
  const h = { 'content-type': 'application/json', origin: 'https://nestorvelasquez.vercel.app', 'sec-fetch-site': 'same-origin', host: 'nestorvelasquez.vercel.app', 'x-forwarded-for': '203.0.113.7', ...headers };
  for (const k of Object.keys(h)) if (h[k] === null) delete h[k];
  const init = { method, headers: h };
  if (method !== 'GET' && method !== 'HEAD') init.body = raw ?? JSON.stringify(body);
  return new Request('https://nestorvelasquez.vercel.app/api/triage', init);
}
const env = (extra = {}) => ({ GEMINI_API_KEY: SECRET, ...extra });

// Capture every console call to prove no ticket text or key is logged.
const logged = [];
for (const m of ['log', 'info', 'warn', 'error', 'debug']) {
  const orig = console[m];
  console[m] = (...a) => { logged.push(a.map(String).join(' ')); if (m === 'log' && String(a[0]).startsWith('FAIL')) orig(...a); };
}

let h = createHandler({ env: env(), fetchImpl: okFetch() });
let r = await h(req({ method: 'GET' }));
check('GET -> 405', r.status === 405);
r = await h(req({ method: 'PUT' }));
check('PUT -> 405', r.status === 405);
r = await h(req({ headers: { 'content-type': 'text/plain' } }));
check('text/plain -> 415', r.status === 415);
r = await h(req({ headers: { 'content-type': 'application/json; charset=utf-8' } }));
check('application/json; charset=utf-8 accepted', r.status === 200);

r = await h(req({ headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } }));
check('foreign origin -> 403', r.status === 403);
r = await h(req({ headers: { origin: 'https://evil.example', 'sec-fetch-site': null } }));
check('foreign origin without Sec-Fetch-Site -> 403', r.status === 403);
r = await h(req({ headers: { origin: null, 'sec-fetch-site': null } }));
check('no Origin and no Sec-Fetch-Site (curl) -> 403', r.status === 403);
r = await h(req({ headers: { origin: 'https://nestorvelasquez.vercel.app', 'sec-fetch-site': 'cross-site' } }));
check('cross-site fetch with a spoofed Origin -> 403', r.status === 403);
check('preview host allowed', originAllowed(new Headers({ origin: 'https://nestorvelasquez-git-main-nestors-projects.vercel.app', 'sec-fetch-site': 'same-origin' })));
check('other vercel.app project rejected', !originAllowed(new Headers({ origin: 'https://someoneelse.vercel.app' })));
check('lookalike host rejected', !originAllowed(new Headers({ origin: 'https://nestorvelasquez.vercel.app.evil.example' })));
check('localhost dev allowed', originAllowed(new Headers({ origin: 'http://localhost:4321', 'sec-fetch-site': 'same-origin' })));

let bodyTouched = false;
const declaredBig = {
  method: 'POST',
  headers: new Headers({ 'content-type': 'application/json', 'content-length': '9000', origin: 'https://nestorvelasquez.vercel.app', 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '198.51.100.9' }),
  get body() { bodyTouched = true; return null; },
};
check('declared Content-Length header really set in the test', declaredBig.headers.get('content-length') === '9000');
r = await h(declaredBig);
check('Content-Length 9000 -> 413 before reading the body', r.status === 413 && !bodyTouched);
const big = new TextEncoder().encode(JSON.stringify({ ...okTicket, body: 'x'.repeat(20000) }));
const stream = new ReadableStream({ start(c) { for (let i = 0; i < big.length; i += 1024) c.enqueue(big.slice(i, i + 1024)); c.close(); } });
r = await h(new Request('https://nestorvelasquez.vercel.app/api/triage', { method: 'POST', duplex: 'half', body: stream, headers: { 'content-type': 'application/json', origin: 'https://nestorvelasquez.vercel.app', 'x-forwarded-for': '198.51.100.1' } }));
check('20 KB streamed body without Content-Length -> 413', r.status === 413);

let text, took, t0, f;
const streamReq = (body, ip = '198.51.100.20') => new Request('https://nestorvelasquez.vercel.app/api/triage', { method: 'POST', duplex: 'half', body, headers: { 'content-type': 'application/json', origin: 'https://nestorvelasquez.vercel.app', 'x-forwarded-for': ip } });
f = okFetch();
const enc = new TextEncoder();
r = await createHandler({ env: env(), fetchImpl: f })(streamReq(new ReadableStream({ start(c) { c.enqueue(enc.encode('{"id":"x",')); c.error(new Error('SECRET_STREAM_DETAIL')); } })));
text = await r.text();
check('stream that fails halfway -> 400 invalid_request, no exception text', r.status === 400 && text === '{"error":"invalid_request"}' && f.calls.length === 0);

t0 = Date.now();
f = okFetch();
const drip = new ReadableStream({ async pull(c) { await new Promise((ok) => setTimeout(ok, 20)); c.enqueue(enc.encode(' ')); } });
r = await createHandler({ env: env(), fetchImpl: f, deadlines: { bodyMs: 150, cancelMs: 50 } })(streamReq(drip));
took = Date.now() - t0;
check('stream dripping 1 byte at a time -> 408 when the body deadline passes', r.status === 408 && (await r.json()).error === 'request_timeout' && f.calls.length === 0);
check(`body deadline holds (${took} ms for a 150 ms budget)`, took < 600);

t0 = Date.now();
const stuck = new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { return new Promise(() => {}); } });
r = await createHandler({ env: env(), fetchImpl: okFetch(), deadlines: { bodyMs: 100, cancelMs: 50 } })(streamReq(stuck));
took = Date.now() - t0;
check(`silent stream whose cancel() never settles still ends (${took} ms)`, r.status === 408 && took < 600);

t0 = Date.now();
r = await createHandler({ env: env(), fetchImpl: okFetch(), deadlines: { totalMs: 120, bodyMs: 3000, cancelMs: 50 } })(streamReq(new ReadableStream({ pull() { return new Promise(() => {}); } })));
took = Date.now() - t0;
check(`total deadline caps the body read below bodyMs (${took} ms)`, r.status === 408 && took < 600);

const throwing = { method: 'POST', headers: { get() { throw new Error('SECRET_HEADER_BUG'); } } };
let threw = false;
try { r = await createHandler({ env: env(), fetchImpl: okFetch() })(throwing); } catch { threw = true; }
text = threw ? '' : await r.text();
check('handler never rejects: unexpected error -> stable 500', !threw && r.status === 500 && text === '{"error":"internal_error"}');

check('IP: x-vercel-forwarded-for preferred over x-forwarded-for', clientIp(new Headers({ 'x-vercel-forwarded-for': '203.0.113.5', 'x-forwarded-for': 'fabricated-1, 203.0.113.5' })) === '203.0.113.5');
check('IP: falls back to the first x-forwarded-for value', clientIp(new Headers({ 'x-forwarded-for': '203.0.113.6, 10.0.0.1' })) === '203.0.113.6');
h = createHandler({ env: env(), fetchImpl: okFetch() });
const spoof = [];
for (let i = 0; i < 9; i++) spoof.push((await h(req({ headers: { 'x-vercel-forwarded-for': '203.0.113.77', 'x-forwarded-for': `fabricated-${i}, 203.0.113.77` } }))).status);
check('rotating fake x-forwarded-for does not dodge the limit when Vercel sets x-vercel-forwarded-for', spoof[8] === 429);

h = createHandler({ env: env(), fetchImpl: okFetch() });
for (const [label, body, rawText] of [
  ['object id', { ...okTicket, id: { x: 1 } }],
  ['missing body', { id: 'a', subject: 's' }],
  ['whitespace body', { ...okTicket, body: '   ' }],
  ['subject over 120', { ...okTicket, subject: 's'.repeat(121) }],
  ['body over 1000', { ...okTicket, body: 'b'.repeat(1001) }],
  ['numeric subject', { ...okTicket, subject: 5 }],
  ['array', [okTicket]],
  ['broken JSON', null, '{"id": "a",'],
]) {
  r = await createHandler({ env: env(), fetchImpl: okFetch() })(req({ body, raw: rawText }));
  const b = await r.json();
  check(`invalid input (${label}) -> 400`, r.status === 400 && typeof b.error === 'string');
}

f = okFetch();
r = await createHandler({ env: {}, fetchImpl: f })(req());
let b = await r.json();
check('missing GEMINI_API_KEY -> 503 demo_not_configured, nothing else', r.status === 503 && JSON.stringify(b) === '{"error":"demo_not_configured"}' && f.calls.length === 0);

f = okFetch();
h = createHandler({ env: env(), fetchImpl: f });
const statuses = [];
for (let i = 0; i < 9; i++) statuses.push((await h(req())).status);
r = await h(req());
check('9th request from one IP in 10 min -> 429', statuses.slice(0, 8).every((s) => s === 200) && statuses[8] === 429);
check('429 carries Retry-After', Number(r.headers.get('retry-after')) > 0);
check('rate-limited requests never reach the model', f.calls.length === 8);
r = await h(req({ headers: { 'x-forwarded-for': '192.0.2.50, 10.0.0.1' } }));
check('another IP is not blocked', r.status === 200);
let clock = 0;
h = createHandler({ env: env(), fetchImpl: okFetch(), now: () => clock });
for (let i = 0; i < 8; i++) await h(req());
clock += 10 * 60 * 1000 + 1;
check('IP window resets after 10 min', (await h(req())).status === 200);
clock = 0;
h = createHandler({ env: env(), fetchImpl: okFetch(), now: () => clock });
let globalStatuses = [];
for (let i = 0; i < 301; i++) globalStatuses.push((await h(req({ headers: { 'x-forwarded-for': `10.1.${i >> 8}.${i & 255}` } }))).status);
check('global cap: 300 per hour per instance, 301st -> 429', globalStatuses.slice(0, 300).every((s) => s === 200) && globalStatuses[300] === 429);

f = fakeFetch(() => new Response(JSON.stringify({ error: { message: PROVIDER_SECRET, key: SECRET } }), { status: 500 }));
r = await createHandler({ env: env(), fetchImpl: f })(req());
text = await r.text();
b = JSON.parse(text);
check('provider 500 -> 200 with human review (same as workflow)', r.status === 200 && b.needs_human === true && b.suggested_queue === 'Human review' && b.review_reasons[0] === 'classification failed: model call failed (HTTP 500)');
check('provider error text never leaks', !text.includes(PROVIDER_SECRET) && !text.includes(SECRET));

f = fakeFetch(() => new Response('quota exceeded for key ' + SECRET, { status: 429 }));
r = await createHandler({ env: env(), fetchImpl: f })(req());
text = await r.text();
b = JSON.parse(text);
check('provider 429 -> HTTP 429 "demo busy"', r.status === 429 && b.message === 'demo busy' && Number(r.headers.get('retry-after')) > 0);
check('provider 429 still routed to human review like the workflow', b.needs_human === true && b.review_reasons.includes('classification failed: model call failed (HTTP 429)'));
check('provider 429 text never leaks', !text.includes('quota exceeded') && !text.includes(SECRET));

// Fetch that hangs until its signal aborts: passes only if the timer really fires.
const hangUntilAbort = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }));
f = fakeFetch(hangUntilAbort);
t0 = Date.now();
r = await createHandler({ env: env(), fetchImpl: f, deadlines: { modelMs: 80 } })(req());
took = Date.now() - t0;
b = await r.json();
check(`model timeout fires (${took} ms for 80 ms) -> human review, reason timeout`, r.status === 200 && b.needs_human && b.review_reasons[0] === 'classification failed: model call failed (HTTP timeout)' && took < 1000);
check('model call carries an abort signal', f.calls[0].init.signal instanceof AbortSignal);

f = fakeFetch(() => new Promise(() => {})); // ignores the signal entirely
t0 = Date.now();
r = await createHandler({ env: env(), fetchImpl: f, deadlines: { modelMs: 80 } })(req());
took = Date.now() - t0;
b = await r.json();
check(`fetch that ignores the signal still ends on time (${took} ms)`, b.review_reasons[0] === 'classification failed: model call failed (HTTP timeout)' && took < 1000);

f = fakeFetch(() => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"candidates":')); } }), { status: 200 }));
r = await createHandler({ env: env(), fetchImpl: f, deadlines: { modelMs: 80 } })(req());
b = await r.json();
check('timeout while reading the provider body is classified as timeout', b.review_reasons[0] === 'classification failed: model call failed (HTTP timeout)');

t0 = Date.now();
await createHandler({ env: env(), fetchImpl: fakeFetch(hangUntilAbort), deadlines: { totalMs: 150, modelMs: 15000, marginMs: 20 } })(req());
took = Date.now() - t0;
check(`model timeout = min(modelMs, time left) (${took} ms for a 150 ms total)`, took < 1000);

// Parser text never reaches the public response.
f = fakeFetch(() => new Response(JSON.stringify(gem('DO_NOT_EXPOSE_PROVIDER_DETAIL_123')), { status: 200 }));
r = await createHandler({ env: env(), fetchImpl: f })(req());
text = await r.text();
b = JSON.parse(text);
check('parser message with provider text is not disclosed', !text.includes('DO_NOT_EXPOSE') && !text.includes('Unexpected token'));
check('...and the decision is unchanged (human review, stable reason)', b.needs_human && b.suggested_queue === 'Human review' && b.review_reasons[0] === 'classification failed: unusable model response' && b.reason === 'classification failed: unusable model response');
f = fakeFetch(() => new Response(JSON.stringify(gem({}, 'DO_NOT_EXPOSE <b>x</b>')), { status: 200 }));
text = await (await createHandler({ env: env(), fetchImpl: f })(req())).text();
check('odd finishReason from the provider is not echoed', !text.includes('DO_NOT_EXPOSE') && JSON.parse(text).review_reasons[0] === 'classification failed: response not complete');
check('uppercase unknown finishReason is not echoed', publicReason('classification failed: response not complete: PROVIDER_INTERNAL_DETAIL') === 'classification failed: response not complete');
check('known finishReason is kept', publicReason('classification failed: response not complete: MAX_TOKENS') === 'classification failed: response not complete: MAX_TOKENS');

f = fakeFetch(() => new Response('not json at all', { status: 200 }));
r = await createHandler({ env: env(), fetchImpl: f })(req());
b = await r.json();
check('non-JSON 200 from provider -> human review', r.status === 200 && b.needs_human);

f = okFetch();
r = await createHandler({ env: env(), fetchImpl: f })(req());
text = await r.text();
b = JSON.parse(text);
check('success -> 200 routed to Billing', r.status === 200 && b.suggested_queue === 'Billing' && b.needs_human === false && b.review_reasons.length === 0);
check('success shape = Respond node keys, no slackUrl/alert', JSON.stringify(Object.keys(b)) === JSON.stringify(PUBLIC_KEYS));
check('Cache-Control: no-store', r.headers.get('cache-control') === 'no-store');
check('key never in the response', !text.includes(SECRET));
const call = f.calls[0];
check('default model URL, key not in the query string', call.url === 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent' && !call.url.includes('key='));
check('key sent only in x-goog-api-key header', call.init.headers['x-goog-api-key'] === SECRET);
check('model receives the same request body as the workflow node', JSON.stringify(JSON.parse(call.init.body)) === JSON.stringify(nodeBuild(okTicket).geminiBody));
f = okFetch();
await createHandler({ env: env({ GEMINI_MODEL: 'gemini-test-model' }), fetchImpl: f })(req());
check('GEMINI_MODEL override is used', f.calls[0].url.includes('/models/gemini-test-model:generateContent'));
f = okFetch();
await createHandler({ env: env({ GEMINI_MODEL: '../../evil?x=' }), fetchImpl: f })(req());
check('malformed GEMINI_MODEL falls back to the default', f.calls[0].url.includes('/models/gemini-3.5-flash-lite:generateContent'));

// End-to-end differential through the handler for every fixture that fits the live limits.
let e2e = 0;
for (const fx of fixtures) {
  const nb = nodeBuild(fx.payload);
  if (!nb.valid || !buildRequest(fx.payload, LIVE_LIMITS).valid) continue;
  for (const [name, raw] of Object.entries(mocks(fx.payload, fx.expected))) {
    const fetchImpl = fakeFetch(() => (raw.error
      ? new Response('provider says no', { status: raw.error.status ?? 500 })
      : new Response(JSON.stringify(raw), { status: 200 })));
    if (raw.error?.code === 'timeout') continue; // covered above
    const res = await createHandler({ env: env(), fetchImpl })(req({ body: fx.payload }));
    const got = await res.json();
    same(`handler ${fx.id} / ${name}: same decision as the workflow (failure reasons normalised)`, decision(got), publicDecision(nodeValidate(nb, raw)));
    e2e++;
  }
}
check('end-to-end differential ran', e2e > 300);

const leaked = logged.filter((l) => !l.startsWith('FAIL') && (l.includes(SECRET) || l.includes('billed twice') || l.includes('Charged twice') || l.includes(PROVIDER_SECRET) || l.includes('SECRET_')));
check('no log line contains the key, ticket text or provider text', leaked.length === 0);
check('only generic error tags are logged', logged.filter((l) => !l.startsWith('FAIL')).every((l) => /^triage: (model call failed (timeout|network)|unexpected error)$/.test(l)));

process.stdout.write(`\n${passed} passed, ${failed} failed (differential cases: ${diffCases}, end-to-end handler cases: ${e2e})\n`);
if (failed) process.stdout.write('Failures:\n' + failures.map((x) => '  - ' + x).join('\n') + '\n');
process.exit(failed ? 1 : 0);
