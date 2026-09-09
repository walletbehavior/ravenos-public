// Shared top-layer dialogs keep the underlying workspace mounted. No iframes,
// navigation, selection changes, or trade state copies are involved.
const stack = [];
export function intelligenceLayerOpen(kind) { return stack.some(layer => !kind || layer.kind === kind); }
export function closeIntelligenceLayers() { while (stack.length) stack.at(-1).close(); }
export function openIntelligenceLayer({ title, kind = 'intelligence', nodes = [], content, parent = document.body, onClose } = {}) {
  const focus = document.activeElement, scroll = { x: window.scrollX, y: window.scrollY };
  const dialog = document.createElement('dialog'); dialog.className = 'ros-intelligence-layer'; dialog.dataset.layerKind = kind;
  const header = document.createElement('header'); header.className = 'ros-layer-header';
  const heading = document.createElement('h2'); heading.textContent = title || 'Raven intelligence'; heading.id = `ros-layer-title-${stack.length}`;
  dialog.setAttribute('aria-labelledby', heading.id);
  const close = document.createElement('button'); close.type = 'button'; close.textContent = stack.length ? 'Back' : 'Close'; close.className = 'ros-layer-close'; close.setAttribute('autofocus', '');
  const body = document.createElement('div'); body.className = 'ros-layer-body';
  header.append(heading, close); dialog.append(header, body);
  const restored = nodes.filter(Boolean).map(node => {
    const marker = document.createComment('intelligence-layer-return'); node.before(marker);
    const hidden = node.hidden; node.hidden = false; body.append(node);
    return () => { marker.replaceWith(node); node.hidden = hidden; };
  });
  if (content) body.append(content);
  parent.append(dialog);
  let closed = false;
  const layer = { dialog, body, kind, close() {
    if (closed) return; closed = true;
    while (stack.length && stack.at(-1) !== layer) stack.at(-1).close();
    stack.pop(); restored.forEach(restore => restore()); dialog.close(); dialog.remove();
    if (!stack.length) document.documentElement.classList.remove('ros-layer-active');
    onClose?.();
    if (focus?.isConnected) focus.focus({ preventScroll: true });
    window.scrollTo(scroll.x, scroll.y);
    document.dispatchEvent(new CustomEvent('ravenos:intelligence-layer', { detail: { kind, open: false } }));
  } };
  close.addEventListener('click', layer.close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); layer.close(); });
  stack.push(layer); document.documentElement.classList.add('ros-layer-active'); dialog.showModal();
  document.dispatchEvent(new CustomEvent('ravenos:intelligence-layer', { detail: { kind, open: true } }));
  return layer;
}
