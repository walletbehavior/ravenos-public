// The pinned Privy SDK references Node's Buffer when encoding Solana signatures.
// esbuild injects this browser implementation into those modules only. Never add
// a global Buffer or broaden the page's script execution policy.
export { Buffer } from 'buffer/';
