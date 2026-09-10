import { buildPublicOnchainTradeProjection, normalizeOnchainTradeIdentity } from './onchain_trade_projection.mjs';

const CHAINS = Object.freeze({ solana: 'solana:solana', base: 'evm:8453', ethereum: 'evm:1' });
const same = (chain, a, b) => typeof a === 'string' && typeof b === 'string'
  && (chain === 'solana' ? a === b : a.toLowerCase() === b.toLowerCase());
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

export function mobulaTradeIdentity(input) {
  const identity = normalizeOnchainTradeIdentity(input);
  return identity && CHAINS[identity.chain] ? identity : null;
}

export function mobulaTradeUrl(input) {
  const identity = mobulaTradeIdentity(input);
  if (!identity) throw Error('onchain_trade_identity_invalid');
  return 'https://api.mobula.io/api/2/token/trades?' + new URLSearchParams({
    chainId: CHAINS[identity.chain], address: identity.pool_address,
    mode: 'pair', sortOrder: 'desc', limit: '120', swapTypes: 'REGULAR',
  });
}

// Validate each swap's actual pool and both assets. A requested address, a
// ticker, or a route's list of intermediate pools cannot establish identity.
export function projectMobulaTrades(payload, input, { now = Date.now(), observedAt = now } = {}) {
  const identity = mobulaTradeIdentity(input);
  if (!identity || !Number.isFinite(now) || !Number.isFinite(observedAt)) throw Error('onchain_trade_identity_invalid');
  if (!Array.isArray(payload?.data)) throw Error('mobula_payload_invalid');
  const rows = [];
  for (const row of payload.data.slice(0, 300)) {
    if (String(row?.blockchain || '').toLowerCase() !== identity.chain
      || !same(identity.chain, row.marketAddress, identity.pool_address)
      || row.operation !== 'regular' || !['buy', 'sell'].includes(row.type)) continue;
    const base = row.baseToken?.address, quote = row.quoteToken?.address;
    const normal = same(identity.chain, base, identity.token_address) && same(identity.chain, quote, identity.quote_token_address);
    const inverse = same(identity.chain, quote, identity.token_address) && same(identity.chain, base, identity.quote_token_address);
    if ((!normal && !inverse) || !positive(row.baseTokenAmount) || !positive(row.quoteTokenAmount)
      || !positive(normal ? row.baseTokenPriceUSD : row.quoteTokenPriceUSD)
      || !positive(normal ? row.baseTokenAmountUSD : row.quoteTokenAmountUSD)
      || !Number.isFinite(row.date) || !Number.isSafeInteger(row.date)
      || row.date > now + 300000 || row.date < now - 26 * 3600000
      || typeof row.id !== 'string' || !/^[A-Za-z0-9:._-]{1,150}$/.test(row.id)) continue;
    const buy = row.type === 'buy';
    rows.push({ id: `mobula:${row.id}`, attributes: {
      from_token_address: buy ? quote : base, to_token_address: buy ? base : quote,
      from_token_amount: buy ? row.quoteTokenAmount : row.baseTokenAmount,
      to_token_amount: buy ? row.baseTokenAmount : row.quoteTokenAmount,
      price_from_in_usd: buy ? row.quoteTokenPriceUSD : row.baseTokenPriceUSD,
      price_to_in_usd: buy ? row.baseTokenPriceUSD : row.quoteTokenPriceUSD,
      volume_in_usd: normal ? row.baseTokenAmountUSD : row.quoteTokenAmountUSD,
      block_timestamp: new Date(row.date).toISOString(), tx_hash: row.transactionHash,
      // The tape ranks transaction senders, consistently with other sources.
      // A recipient can be a router or an intermediate pool; never infer its
      // beneficial owner or assign this swap to a customer's trading wallet.
      tx_from_address: row.transactionSenderAddress,
    } });
  }
  return buildPublicOnchainTradeProjection({ identity, provider_payload: { data: rows },
    observed_at: new Date(observedAt).toISOString(), source_label: 'Mobula',
    attribution_url: 'https://mobula.io', now: () => new Date(now) });
}

// Redirects must never carry a provider credential to another host. Bound the
// streamed body as well as Content-Length, and expose only stable error codes.
export async function fetchMobulaTrades(identity, apiKey, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const url = mobulaTradeUrl(identity);
  if (!String(apiKey || '').trim()) throw Error('mobula_key_unavailable');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { redirect: 'manual', signal: controller.signal,
      headers: { Authorization: apiKey, accept: 'application/json' } });
    if (!response.ok) throw Error(`mobula_http_${response.status}`);
    const maximum = 1024 * 1024;
    if (Number(response.headers.get('content-length') || 0) > maximum) throw Error('mobula_payload_too_large');
    const reader = response.body?.getReader();
    if (!reader) throw Error('mobula_payload_invalid');
    const decoder = new TextDecoder(); let body = '', bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > maximum) throw Error('mobula_payload_too_large');
        body += decoder.decode(part.value, { stream: true });
      }
      body += decoder.decode();
    } finally { await reader.cancel().catch(() => {}); }
    const payload = JSON.parse(body);
    if (!Array.isArray(payload?.data)) throw Error('mobula_payload_invalid');
    return payload;
  } catch (error) {
    if (controller.signal.aborted) throw Error('mobula_timeout');
    if (error instanceof SyntaxError) throw Error('mobula_payload_invalid');
    if (/^mobula_[a-z0-9_]+$/.test(String(error?.message))) throw error;
    throw Error('mobula_transport_unavailable');
  } finally { clearTimeout(timer); }
}
