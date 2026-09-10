// Share only an in-flight account read, never a durable authentication cache.
// Account/session failures do not mean the user signed out. Only this GET is
// retried; orders, signing requests and other mutations never enter this path.
const retryable = status => status === 429 || status >= 500;
const aborted = () => new DOMException('Account check canceled', 'AbortError');
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(aborted()); return; }
    const stop = () => { clearTimeout(timer); reject(aborted()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, ms);
    signal.addEventListener('abort', stop, { once: true });
  });
}
function retryDelay(response, now) {
  const header = response?.headers?.get('retry-after');
  if (!header) return 750;
  const ms = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - now;
  return Number.isFinite(ms) ? Math.max(0, ms) : 750;
}
export function createAccountSessionReader({ fetchImpl = (...args) => fetch(...args), wait = delay, now = () => Date.now(), onResult = () => {} } = {}) {
  let current = null;
  async function run(flight) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let response, payload, temporary = true, reason = 'invalid_response';
      const requestSignal = AbortSignal.any([flight.controller.signal, AbortSignal.timeout(8000)]);
      try {
        response = await fetchImpl('/api/v1/auth/session', {
          credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { accept: 'application/json' },
          signal: requestSignal,
        });
        payload = await response.json();
        if (flight.controller.signal.aborted) throw aborted();
        if (response.ok && payload?.ok === true && payload.authenticated === true && typeof payload.csrf_token === 'string' && payload.csrf_token.length > 0) {
          return { response, payload, state: 'authenticated' };
        }
        if ((response.ok && payload?.ok === true && payload.authenticated === false)
          || (response.status === 401 && payload?.error === 'authentication_required')) {
          return { response, payload: { ...payload, authenticated: false }, state: 'signed_out' };
        }
        temporary = retryable(response.status) || response.ok;
        reason = response.ok ? 'invalid_response' : retryable(response.status) ? 'service_error' : 'request_rejected';
      } catch (error) {
        if (flight.controller.signal.aborted) throw aborted();
        reason = requestSignal.aborted || error?.name === 'TimeoutError' ? 'timeout' : response ? 'invalid_response' : 'network_error';
      }
      const ms = retryDelay(response, now());
      if (attempt === 0 && temporary && ms <= 60000) {
        flight.retryAt = now() + ms;
        for (const notify of flight.listeners) { try { notify({ retryAt: flight.retryAt }); } catch {} }
        await wait(ms, flight.controller.signal);
        flight.retryAt = null;
        continue;
      }
      return { response: response || new Response(null, { status: 503 }), payload: null, state: 'unavailable',
        diagnostic: { reason, attempts: attempt + 1, http_status: response?.status ?? null, retry_after_ms: ms } };
    }
  }
  function read({ signal, onRetry } = {}) {
    if (signal?.aborted) return Promise.reject(aborted());
    if (!current) {
      const flight = { controller: new AbortController(), listeners: new Set(), retryAt: null };
      current = flight;
      flight.promise = run(flight).then(result => {
        if (!flight.controller.signal.aborted) { try { onResult(result); } catch {} }
        return result;
      }).finally(() => { if (current === flight) current = null; });
    }
    const flight = current;
    if (onRetry) { flight.listeners.add(onRetry); if (flight.retryAt !== null) { try { onRetry({ retryAt: flight.retryAt }); } catch {} } }
    return new Promise((resolve, reject) => {
      const cleanup = () => { signal?.removeEventListener('abort', stop); flight.listeners.delete(onRetry); };
      const stop = () => { cleanup(); reject(aborted()); };
      signal?.addEventListener('abort', stop, { once: true });
      if (signal?.aborted) stop();
      flight.promise.then(value => {
        cleanup();
        if (flight.controller.signal.aborted) reject(aborted());
        else if (!signal?.aborted) resolve(value);
      }, error => { cleanup(); reject(error); });
    });
  }
  function invalidate() { current?.controller.abort(); current = null; }
  return { read, invalidate };
}
// Subscribers receive presentation state only, never credentials or a cached
// authentication result. A later read still checks the server.
const subscribers = new Set();
const sessionReader = createAccountSessionReader({ onResult: result => {
  const summary = { state: result.state, username: result.payload?.account?.username || '' };
  for (const listener of subscribers) { try { listener(summary); } catch {} }
  if (result.state === 'unavailable') console.warn('ravenos.account_check_unavailable', result.diagnostic);
} });
export function subscribeAccountSession(listener) { subscribers.add(listener); return () => subscribers.delete(listener); }
export const readAccountSession = options => sessionReader.read(options);
export const invalidateAccountSession = () => sessionReader.invalidate();
if (typeof window !== 'undefined') window.addEventListener('ravenos:accountstate', event => {
  if (event.detail?.authenticated === false) invalidateAccountSession();
});
