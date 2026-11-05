// Serialized by scripting.executeScript. All state stays in Chrome's ISOLATED world.
export async function pageOperation(op, token, input = {}) {
  const key = '__still_private_capture_v1__';
  if (op === 'start') {
    globalThis[key]?.restore();
    const root = document.scrollingElement;
    if (!root || document.contentType !== 'text/html') throw new Error('Open a regular HTML webpage to capture.');
    const state = { token, originalX: scrollX, originalY: scrollY, edits: [], fixed: [], ended: false, reason: '', started: Date.now() };
    const edit = (el, prop, value) => {
      const old = el.style.getPropertyValue(prop), priority = el.style.getPropertyPriority(prop);
      el.style.setProperty(prop, value, 'important');
      state.edits.push({ el, prop, old, priority, value });
    };
    state.restore = (reason = '') => {
      if (state.ended) return;
      state.ended = true; state.reason = reason;
      clearTimeout(state.timer);
      for (const [name, fn] of state.listeners || []) window.removeEventListener(name, fn, true);
      for (const { el, prop, old, priority, value } of state.edits.reverse()) {
        if (el.style.getPropertyValue(prop) === value && el.style.getPropertyPriority(prop) === 'important') {
          if (old) el.style.setProperty(prop, old, priority); else el.style.removeProperty(prop);
        }
      }
      // Keep smooth scrolling disabled until the original position is restored.
      window.scrollTo({ left: state.originalX, top: state.originalY, behavior: 'instant' });
      if (state.sheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s => s !== state.sheet);
      // Leave only a small tombstone so an in-flight worker learns why we stopped.
      state.fixed = []; state.edits = []; state.listeners = [];
    };
    globalThis[key] = state;
    try {
      state.sheet = new CSSStyleSheet();
      state.sheet.replaceSync('*{scroll-behavior:auto!important;scroll-snap-type:none!important;animation-play-state:paused!important;transition-property:none!important;caret-color:transparent!important;scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important}');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, state.sheet];
      const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
      let node, count = 0, nested = false;
      while ((node = walker.nextNode())) {
        if (++count > 15000) throw new Error('This page is too complex to capture safely (15,000 elements).');
        const style = getComputedStyle(node);
        if (style.position === 'sticky') edit(node, 'position', 'static');
        if (style.position === 'fixed') {
          const rect = node.getBoundingClientRect();
          // Computed top/bottom can both resolve to pixels even when one was authored as auto.
          if (rect.width && rect.height) state.fixed.push({ el: node, bottom: rect.top >= innerHeight / 2 && rect.bottom >= innerHeight - 2, old: node.style.getPropertyValue('visibility'), priority: node.style.getPropertyPriority('visibility') });
        }
        if (node !== root && node !== document.body && /auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 32 && node.clientHeight > 100) nested = true;
      }
      state.nested = nested;
      const stop = e => {
        if (!e.isTrusted) return;
        if (e.type === 'keydown' && !['Escape', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key)) return;
        state.restore(e.type === 'pagehide' ? 'The page navigated.' : 'Capture cancelled by user input.');
      };
      state.listeners = ['keydown', 'wheel', 'pointerdown', 'touchstart', 'pagehide'].map(name => [name, stop]);
      for (const [name, fn] of state.listeners) window.addEventListener(name, fn, { capture: true, passive: true });
      state.renew = () => { clearTimeout(state.timer); state.timer = setTimeout(() => state.restore('Capture timed out.'), 10000); };
      state.renew();
      await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 1200))]);
    } catch (err) { state.restore(); throw err; }
  }
  const s = globalThis[key];
  if (!s || s.token !== token) throw new Error('Capture session expired. Click Still again.');
  if (op === 'cleanup') { s.restore(); delete globalThis[key]; return { cleaned: true }; }
  if (s.ended) throw new Error(s.reason || 'Capture stopped.');
  if (Date.now() - s.started > 120000) { s.restore('Capture timed out.'); throw new Error('Capture timed out.'); }
  s.renew();
  const measure = () => ({ width: Math.max(document.documentElement.clientWidth, document.scrollingElement.scrollWidth), height: Math.max(document.documentElement.clientHeight, document.scrollingElement.scrollHeight), vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, x: scrollX, y: scrollY, nested: s.nested });
  if (op === 'start' || op === 'measure') return measure();
  if (op === 'scroll') {
    if (![input.x, input.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1000000)) throw new Error('Invalid scroll position.');
    // Visibility edits are journaled once per change and restored in reverse order.
    for (const item of s.fixed) {
      const show = input.capture && input.x === 0 && (item.bottom ? input.lastRow : input.y === 0);
      const value = show ? item.old : 'hidden';
      const priority = show ? item.priority : 'important';
      const old = item.el.style.getPropertyValue('visibility'), oldPriority = item.el.style.getPropertyPriority('visibility');
      if (old !== value || oldPriority !== priority) {
        if (value) item.el.style.setProperty('visibility', value, priority); else item.el.style.removeProperty('visibility');
        // Fixed visibility has its own exact restoration below, independent of its toggle count.
      }
    }
    if (!s.fixedRestoreAdded) {
      const restore = s.restore;
      s.restore = reason => {
        if (!s.ended) for (const item of s.fixed) {
          if (item.old) item.el.style.setProperty('visibility', item.old, item.priority); else item.el.style.removeProperty('visibility');
        }
        restore(reason);
      };
      s.fixedRestoreAdded = true;
    }
    window.scrollTo({ left: input.x, top: input.y, behavior: 'instant' });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const visibleImages = [...document.images].filter(img => {
      const r = img.getBoundingClientRect();
      return !img.complete && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    }).slice(0, 50);
    await Promise.race([Promise.all(visibleImages.map(img => img.decode().catch(() => {}))), new Promise(resolve => setTimeout(resolve, input.capture ? 800 : 180))]);
    if (s.ended) throw new Error(s.reason || 'Capture stopped.');
    return measure();
  }
  throw new Error('Unknown page operation.');
}
