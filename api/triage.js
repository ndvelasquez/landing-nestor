// POST /api/triage: live version of the n8n triage demo.
// The decision logic lives in ./_triage-core.js (a faithful port of the
// workflow's Code nodes). This file only adds the HTTP hardening a public
// endpoint needs: method, content type, origin, size and rate limits, time
// budgets for the request body and the model call, and responses that never
// carry provider text or exception messages.
//
// Privacy: this function never logs the ticket, the model response or the key.
// The only log line is a generic error tag with no user data.

import { buildRequest, validateAndRoute, sanitizeForPublic, toPublic, LIVE_LIMITS } from './_triage-core.js';

const MAX_BODY_BYTES = 8 * 1024;
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

// Time budgets. vercel.json sets maxDuration 20 s; the whole request must end
// before ~19 s. Reading the incoming body (including cancelling the reader) is
// capped at 3 s so a slow stream can't hold the function; the model call gets
// min(15 s, whatever is left).
export const DEFAULT_DEADLINES = { totalMs: 19_000, bodyMs: 3_000, cancelMs: 500, modelMs: 15_000, marginMs: 250 };

// Rate limits: BEST-EFFORT, PER INSTANCE. Vercel can run several instances and
// recycles them, so these in-memory counters are neither shared nor durable,
// and they are not a quota boundary. They only stop one client from hammering
// a warm instance. The real controls are (1) Vercel Firewall rate-limit rules
// on /api/triage, configured after deploy, and (2) a low quota on the Gemini
// API key in Google AI Studio.
const IP_LIMIT = 8;
const IP_WINDOW_MS = 10 * 60 * 1000;
const GLOBAL_LIMIT = 300;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;

const PROD_HOST = 'nestorvelasquez.vercel.app';
// Preview deployments of the same Vercel project: nestorvelasquez-<hash>-<team>.vercel.app
// and nestorvelasquez-git-<branch>-<team>.vercel.app.
const PREVIEW_HOST = /^nestorvelasquez-[a-z0-9-]+\.vercel\.app$/;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extra,
    },
  });

function hostAllowed(host, requestHost) {
  if (!host) return false;
  return host === PROD_HOST || PREVIEW_HOST.test(host) || LOCAL_HOST.test(host) || (requestHost && host === requestHost);
}

// Hygiene, not strong security: any non-browser client can forge these headers.
export function originAllowed(headers) {
  const sfs = headers.get('sec-fetch-site');
  if (sfs && sfs !== 'same-origin' && sfs !== 'same-site') return false;
  const origin = headers.get('origin');
  if (!origin) return sfs === 'same-origin';
  let host;
  try { host = new URL(origin).host; } catch { return false; }
  return hostAllowed(host, headers.get('host'));
}

// Client IP. Source: https://vercel.com/docs/headers/request-headers (read
// 2026-10-10): "x-forwarded-for: The public IP address of the client ... we
// currently overwrite the X-Forwarded-For header and do not forward external
// IPs. This restriction is in place to prevent IP spoofing." and
// "x-vercel-forwarded-for: identical to x-forwarded-for. However,
// x-forwarded-for could be overwritten if you're using a proxy on top of
// Vercel." So x-vercel-forwarded-for is preferred, then x-forwarded-for
// (first value), then x-real-ip. Off Vercel (local dev) these are client-set.
export function clientIp(headers) {
  for (const name of ['x-vercel-forwarded-for', 'x-forwarded-for', 'x-real-ip']) {
    const v = headers.get(name);
    const first = v ? v.split(',')[0].trim() : '';
    if (first) return first.slice(0, 64);
  }
  return 'unknown';
}

// Resolves with the promise's value, or with `onTimeout` after `ms`. Never rejects
// unless the promise rejects.
function within(promise, ms, onTimeout) {
  let timer;
  const t = new Promise((resolve) => { timer = setTimeout(() => resolve(onTimeout), Math.max(0, ms)); });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}
const TIMED_OUT = Symbol('timed out');

// Reads at most `cap` bytes within `ms`. Every stream operation is guarded:
// the result is always one of { text } | { tooLarge } | { timeout } | { streamError } | { badEncoding }.
async function readCapped(request, cap, ms, cancelMs) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) return { tooLarge: true };
  if (!request.body) return { text: '' };
  const deadline = Date.now() + ms;
  let reader;
  const cancel = async () => {
    if (!reader) return;
    try { await within(reader.cancel().catch(() => {}), cancelMs, null); } catch { /* ignore */ }
  };
  try {
    reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const step = await within(reader.read(), deadline - Date.now(), TIMED_OUT);
      if (step === TIMED_OUT) { await cancel(); return { timeout: true }; }
      const { done, value } = step;
      if (done) break;
      size += value.byteLength;
      if (size > cap) { await cancel(); return { tooLarge: true }; }
      chunks.push(value);
    }
    const buf = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf) };
    } catch {
      return { badEncoding: true };
    }
  } catch {
    await cancel();
    return { streamError: true };
  }
}

export function createHandler({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), deadlines = {} } = {}) {
  const D = { ...DEFAULT_DEADLINES, ...deadlines };
  const perIp = new Map(); // ip -> timestamps within the window
  let globalHits = [];

  function rateLimit(ip) {
    const t = now();
    globalHits = globalHits.filter((x) => t - x < GLOBAL_WINDOW_MS);
    if (globalHits.length >= GLOBAL_LIMIT) {
      return Math.max(1, Math.ceil((globalHits[0] + GLOBAL_WINDOW_MS - t) / 1000));
    }
    const hits = (perIp.get(ip) ?? []).filter((x) => t - x < IP_WINDOW_MS);
    if (hits.length >= IP_LIMIT) {
      perIp.set(ip, hits);
      return Math.max(1, Math.ceil((hits[0] + IP_WINDOW_MS - t) / 1000));
    }
    hits.push(t);
    perIp.set(ip, hits);
    globalHits.push(t);
    if (perIp.size > 5000) {
      for (const [k, v] of perIp) if (!v.length || t - v[v.length - 1] >= IP_WINDOW_MS) perIp.delete(k);
    }
    return 0;
  }

  // Returns the Gemini JSON, or { error: { status | code } } in the shape the
  // workflow's "Validate and route" node expects. Never throws.
  async function callModel(geminiBody, timeoutMs) {
    if (timeoutMs <= 0) return { error: { code: 'timeout' } };
    const model = /^[a-z0-9.-]{1,64}$/.test(env.GEMINI_MODEL ?? '') ? env.GEMINI_MODEL : DEFAULT_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    // Rejects when the timer fires, so a fetch or body read that ignores the
    // signal still ends on time.
    const aborted = new Promise((_, reject) => ctrl.signal.addEventListener('abort', () => {
      const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
    }, { once: true }));
    aborted.catch(() => {});
    const isAbort = (e) => ctrl.signal.aborted || e?.name === 'AbortError';
    try {
      let res;
      try {
        res = await Promise.race([fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
          body: JSON.stringify(geminiBody),
          signal: ctrl.signal,
        }), aborted]);
      } catch (e) {
        const code = isAbort(e) ? 'timeout' : 'network';
        console.error('triage: model call failed', code);
        return { error: { code } };
      }
      if (!res.ok) {
        // Never read or forward the provider's error text: only the status.
        try { res.body?.cancel().catch(() => {}); } catch { /* ignore */ }
        return { error: { status: res.status } };
      }
      try {
        return await Promise.race([res.json(), aborted]);
      } catch (e) {
        if (isAbort(e)) {
          console.error('triage: model call failed', 'timeout');
          return { error: { code: 'timeout' } };
        }
        return {}; // malformed JSON from the provider: "no candidate returned"
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async function handle(request) {
    const started = Date.now();
    const left = () => D.totalMs - (Date.now() - started);

    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' }, { allow: 'POST' });

    const ctype = (request.headers.get('content-type') ?? '').toLowerCase();
    if (!/^application\/json\s*(;|$)/.test(ctype)) return json(415, { error: 'unsupported_media_type' });

    if (!originAllowed(request.headers)) return json(403, { error: 'forbidden' });

    if (!env.GEMINI_API_KEY) return json(503, { error: 'demo_not_configured' });

    const wait = rateLimit(clientIp(request.headers));
    if (wait) return json(429, { error: 'rate_limited', message: 'demo busy' }, { 'retry-after': String(wait) });

    const body = await readCapped(request, MAX_BODY_BYTES, Math.min(D.bodyMs, left()), D.cancelMs);
    if (body.tooLarge) return json(413, { error: 'payload_too_large' });
    if (body.timeout) return json(408, { error: 'request_timeout' });
    if (body.streamError) return json(400, { error: 'invalid_request' });
    if (body.badEncoding) return json(400, { error: 'invalid_json' });

    let ticket;
    try { ticket = JSON.parse(body.text); } catch { return json(400, { error: 'invalid_json' }); }

    const ctx = buildRequest(ticket, LIVE_LIMITS);
    if (!ctx.valid) return json(400, { error: 'invalid_request', details: ctx.errors });

    const raw = await callModel(ctx.geminiBody, Math.min(D.modelMs, left() - D.marginMs));
    const result = toPublic(sanitizeForPublic(validateAndRoute(ctx, raw)));

    if (raw?.error?.status === 429) {
      // Same routing as the workflow (human review), surfaced as 429 so the page can say "busy".
      return json(429, { error: 'demo_busy', message: 'demo busy', ...result }, { 'retry-after': '60' });
    }
    return json(200, result);
  }

  // The handler never rejects: anything unexpected becomes a stable 500.
  return async function safeHandle(request) {
    try {
      return await handle(request);
    } catch {
      console.error('triage: unexpected error');
      return json(500, { error: 'internal_error' });
    }
  };
}

const handler = createHandler();
export const POST = (request) => handler(request);
export const GET = POST;
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
export const OPTIONS = POST;
export const HEAD = POST;
