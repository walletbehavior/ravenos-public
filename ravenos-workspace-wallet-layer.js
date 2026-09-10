import { openIntelligenceLayer } from './ravenos-intelligence-layers.js';
const views = new Map();
let active = null;
// Reuse the existing account surfaces and entitlement checks. These paths and
// modules are fixed first-party resources; no remote scripts or iframe access.
const templates = {
  '/account/copy/': { title: 'Wallet intelligence', selector: '.copy-page', styles: ['/ravenos-wallet-copy.css','/ravenos-trading-settings.css'], load: () => import('./ravenos-wallet-copy.js') },
  '/account/intelligence/': { title: 'Pro intelligence', selector: '.pro-intelligence-page', styles: ['/ravenos-pro-intelligence.css'], load: () => import('./ravenos-pro-intelligence.js') },
};
const styles = new Map();
function loadStyles(parsed, spec) {
  return Promise.all(spec.styles.map(logical=>{
    const base=logical.slice(1,-4), links=[...parsed.querySelectorAll('head link[rel="stylesheet"]')];
    const href=links.map(link=>new URL(link.getAttribute('href'),location.origin)).find(url=>url.origin===location.origin
      && (url.pathname===logical || new RegExp(`^/assets/${base}\\.[a-f0-9]{16,64}\\.css$`).test(url.pathname)));
    if (!href) throw Error('view_styles_unavailable');
    const url=href.href;
    const existing=[...document.querySelectorAll('link[rel="stylesheet"]')].find(link=>link.href===url);
    if (existing?.sheet) return Promise.resolve();
    if (styles.has(url)) return styles.get(url);
    const promise=new Promise((resolve,reject)=>{
      const link=existing || document.createElement('link');
      const finish=error=>{clearTimeout(timer);link.removeEventListener('load',loaded);link.removeEventListener('error',failed);
        if(error){link.remove();reject(Error('view_styles_unavailable'));}else resolve();};
      const loaded=()=>finish(false),failed=()=>finish(true),timer=setTimeout(failed,8000);
      link.addEventListener('load',loaded,{once:true});link.addEventListener('error',failed,{once:true});
      if(!existing){link.rel='stylesheet';link.href=url;document.head.append(link);}
    }).catch(error=>{styles.delete(url);throw error;});
    styles.set(url,promise);return promise;
  }));
}
async function loadView(path, url) {
  const spec = templates[path];
  if (!views.has(path)) views.set(path, (async () => {
    const response = await fetch(path, { credentials: 'same-origin', headers: { accept: 'text/html' } });
    if (!response.ok || (response.url && new URL(response.url).origin !== location.origin)) throw new Error('view_unavailable');
    const html = await response.text();
    if (html.length > 600_000) throw new Error('view_unavailable');
    const parsed = new DOMParser().parseFromString(html, 'text/html'), main = parsed.querySelector(spec.selector);
    if (!main) throw new Error('view_unavailable');
    main.querySelectorAll('script, iframe, object, embed').forEach(node => node.remove());
    for (const node of [main, ...main.querySelectorAll('*')]) for (const attr of [...node.attributes]) if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
    const holder = document.createElement('div'); holder.hidden = true; holder.dataset.workspaceIntelligenceCache = path;
    main.dataset.embedded = 'true'; main.dataset.embeddedUrl = url.href;
    holder.append(main); document.body.append(holder);
    // Use the stylesheet URLs from this release's HTML. Logical CSS paths are
    // absent in production, which serves only fingerprinted asset names.
    try { await loadStyles(parsed,spec); return { main, module: await spec.load() }; }
    catch (error) { holder.remove(); throw error; }
  })().catch(error => { views.delete(path); throw error; }));
  return views.get(path);
}
export async function openWorkspaceWallet(href) {
  const url = new URL(href, location.origin), spec = templates[url.pathname];
  if (!spec || ![location.origin, 'https://app.ravenos.xyz', 'https://ravenos.xyz'].includes(url.origin)) return;
  if (active) active.close();
  const loading = document.createElement('p'); loading.textContent = 'Opening saved research…'; loading.setAttribute('role', 'status');
  const pending = openIntelligenceLayer({ title: spec.title, kind: 'wallet-intelligence', content: loading }); active = pending;
  try {
    const view = await loadView(url.pathname, url);
    if (!pending.dialog.isConnected) return;
    // Resolve current session/entitlements while the cached surface is hidden.
    // A prior account's retained rendering must not flash during a re-open.
    await view.module.openEmbeddedIntelligence(url.href);
    if (!pending.dialog.isConnected) { view.module.suspendEmbeddedIntelligence?.(); return; }
    view.main.dataset.embeddedView = url.searchParams.has('wallet') && url.searchParams.get('intent') !== 'copy' && view.main.querySelector('#copyProfile:not([hidden])') ? 'profile' : 'workspace';
    pending.close();
    const layer = openIntelligenceLayer({ title: spec.title, kind: 'wallet-intelligence', nodes: [view.main], onClose: () => { view.module.suspendEmbeddedIntelligence?.(); if (active === layer) active = null; } }); active = layer;
    if (url.pathname === '/account/copy/') {
      const browse = document.createElement('button'); browse.type = 'button'; browse.className = 'ros-layer-browse'; browse.textContent = 'Wallets & Copy';
      browse.onclick = () => { view.main.dataset.embeddedView = 'workspace'; layer.body.scrollTo({ top: 0 }); };
      layer.dialog.querySelector('.ros-layer-close').before(browse);
    }
  } catch {
    if (!pending.dialog.isConnected) return;
    loading.textContent = 'This workspace could not load. Your current market is still open.';
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Try again'; retry.onclick = () => openWorkspaceWallet(href);
    pending.body.append(retry);
  }
}
