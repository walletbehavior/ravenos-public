// Bulk distributions routinely have thousands of Transfer logs. Read the
// complete receipt within explicit memory limits; never clip accounting legs.
export const EvmWalletReceiptPolicy = Object.freeze({
  maximum_logs: 4096,
  maximum_lookup_logs: 8192,
  maximum_receipt_bytes: 4 * 1024 * 1024,
  maximum_rpc_bytes: 1024 * 1024,
});

export async function readEvmWalletRpcResponse(response, method, fail, prefix) {
  if (!response.ok) fail(`${prefix}_provider_unavailable`);
  const maximum = method === 'eth_getTransactionReceipt'
    ? EvmWalletReceiptPolicy.maximum_receipt_bytes : EvmWalletReceiptPolicy.maximum_rpc_bytes;
  if (Number(response.headers.get('content-length')) > maximum) {
    await response.body?.cancel();
    fail(`${prefix}_response_too_large`);
  }
  const reader = response.body?.getReader(), decoder = new TextDecoder();
  let size = 0, text = '';
  if (!reader) fail(`${prefix}_response_invalid`);
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        fail(`${prefix}_response_too_large`);
      }
      text += decoder.decode(value, {stream:true});
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  let body;
  try { body = JSON.parse(text); } catch { fail(`${prefix}_response_invalid`); }
  if (body?.id !== 1 || body.error || !Object.hasOwn(body, 'result')) fail(`${prefix}_method_unavailable`);
  return body.result;
}
