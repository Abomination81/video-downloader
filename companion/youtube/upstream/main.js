/*
 * Still — YouTube-only response filtering. GPL-3.0-or-later.
 * The own-property pruning and native-call wrapper approach is adapted from
 * uBlock Origin, Copyright (C) 2019-present Raymond Hill (GPL-3.0-or-later).
 * See THIRD_PARTY_NOTICES.md for pinned sources and changes.
 * This MAIN-world script has no extension privileges or communication bridge.
 */
(() => {
  'use strict';
  if (location.protocol !== 'https:' || !(
    location.hostname === 'www.youtube.com' ||
    (location.hostname === 'www.youtube-nocookie.com' && location.pathname.startsWith('/embed/'))
  )) return;

  const apply = Reflect.apply;
  const descriptor = Object.getOwnPropertyDescriptor;
  const define = Object.defineProperty;
  const remove = Reflect.deleteProperty;
  const parse = JSON.parse;
  const stringify = JSON.stringify;
  const MAX_TEXT = 8 * 1024 * 1024;
  const AD_FIELDS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];
  const data = (obj, key) => {
    if (obj === null || typeof obj !== 'object') return undefined;
    const d = descriptor(obj, key);
    return d && 'value' in d ? d.value : undefined;
  };
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const isPlayer = obj => isObject(obj) && (
    isObject(data(obj, 'playabilityStatus')) || isObject(data(obj, 'streamingData')) || isObject(data(obj, 'videoDetails'))
  );

  function cleanPlayer(obj, trusted = false) {
    if (!isObject(obj) || (!trusted && !isPlayer(obj))) return false;
    let changed = false;
    for (const field of AD_FIELDS) {
      const d = descriptor(obj, field);
      // Never invoke a getter or write through a prototype. Frozen objects remain intact.
      if (d && 'value' in d && d.configurable && remove(obj, field)) changed = true;
    }
    return changed;
  }

  function cleanEnvelope(root, trusted = false, shorts = false) {
    let changed = false;
    const visit = (obj, trust) => {
      if (!isObject(obj)) return;
      changed = cleanPlayer(obj, trust) || changed;
      const player = data(obj, 'playerResponse');
      changed = cleanPlayer(player, trust) || changed;
      const response = data(obj, 'response');
      changed = cleanPlayer(data(response, 'playerResponse'), trust) || changed;
      if (shorts) {
        for (const owner of [obj, data(obj, 'reelWatchSequenceResponse')]) {
          const entries = data(owner, 'entries');
          if (!Array.isArray(entries) || entries.length > 5000) continue;
          // Only the documented ad marker on this endpoint; no generic recursive deletion.
          for (let i = entries.length - 1; i >= 0; i--) {
            const command = data(data(entries, String(i)), 'command');
            const params = data(data(command, 'reelWatchEndpoint'), 'adClientParams');
            if (data(params, 'isAd') === true) { entries.splice(i, 1); changed = true; }
          }
        }
      }
    };
    if (Array.isArray(root)) {
      // YouTube's navigation envelope is a small array, not an arbitrary tree.
      for (let i = 0; i < Math.min(root.length, 16); i++) visit(data(root, String(i)), false);
    } else visit(root, trusted);
    return changed;
  }

  function endpoint(raw) {
    if (typeof raw !== 'string') return null;
    try {
      const u = new URL(raw, location.href);
      if (u.protocol !== 'https:' || u.username || u.password || u.port ||
          !['www.youtube.com', 'www.youtube-nocookie.com'].includes(u.hostname)) return null;
      const path = u.pathname;
      if (!['/youtubei/v1/player', '/youtubei/v1/next', '/youtubei/v1/get_watch', '/youtubei/v1/reel/reel_watch_sequence'].includes(path)) return null;
      return {trusted: path === '/youtubei/v1/player', shorts: path.endsWith('/reel_watch_sequence')};
    } catch { return null; }
  }

  function cleanText(text, kind) {
    if (typeof text !== 'string' || text.length > MAX_TEXT || !kind) return text;
    const prefix = text.startsWith(")]}'\n") ? ")]}'\n" : '';
    try {
      const obj = parse(text.slice(prefix.length));
      return cleanEnvelope(obj, kind.trusted, kind.shorts) ? prefix + stringify(obj) : text;
    } catch { return text; } // Preserve malformed/non-JSON responses exactly; never break playback.
  }

  JSON.parse = new Proxy(parse, {
    apply(target, thisArg, args) {
      const obj = apply(target, thisArg, args); // Preserve native errors and reviver semantics.
      if (typeof args[0] !== 'string' || args[0].length > MAX_TEXT || typeof args[1] === 'function') return obj;
      try { cleanEnvelope(obj); } catch { /* A hostile/frozen value cannot break native parsing. */ }
      return obj;
    }
  });

  for (const key of ['ytInitialPlayerResponse', 'playerResponse']) {
    const prior = descriptor(window, key);
    if (prior && (!prior.configurable || !('value' in prior) || !prior.writable)) continue;
    let value = prior?.value;
    const clean = () => { try { cleanPlayer(value, true); } catch { /* Page-owned data: fail open. */ } return value; };
    define(window, key, {configurable: true, enumerable: prior?.enumerable ?? true,
      get: clean, set(next) { value = next; clean(); }});
    clean();
  }

  // Keep the original Response object, stream, headers, URL, clone and bodyUsed behavior.
  // Only consumption through json()/text() changes; binary streams are never inspected.
  for (const method of ['json', 'text']) {
    const original = Response.prototype[method];
    define(Response.prototype, method, {...descriptor(Response.prototype, method), value: new Proxy(original, {
      apply(target, thisArg, args) {
        const result = apply(target, thisArg, args);
        const kind = endpoint(thisArg.url);
        if (!kind) return result;
        return result.then(value => {
          if (method === 'text') return cleanText(value, kind);
          try { cleanEnvelope(value, kind.trusted, kind.shorts); } catch { /* Preserve response on failure. */ }
          return value;
        });
      }
    })});
  }

  const NativeXHR = window.XMLHttpRequest;
  const states = new WeakMap();
  window.XMLHttpRequest = class extends NativeXHR {
    open(method, url, ...rest) {
      states.delete(this);
      const result = super.open(method, url, ...rest);
      // responseURL is checked again after redirects; request URL alone is not trusted.
      states.set(this, {kind: endpoint(typeof url === 'string' ? url : url instanceof URL ? url.href : '')});
      return result;
    }
    get response() {
      const raw = super.response;
      const state = states.get(this);
      const kind = state?.kind && this.readyState === 4 && endpoint(this.responseURL);
      if (!kind) return raw;
      if (state.raw === raw && state.done) return state.value;
      let value = raw;
      if (typeof raw === 'string') value = cleanText(raw, kind);
      else if (this.responseType === 'json') {
        try { cleanEnvelope(value, kind.trusted, kind.shorts); } catch { /* Preserve native object. */ }
      }
      Object.assign(state, {raw, value, done: true});
      return value;
    }
    get responseText() {
      const nativeText = super.responseText; // Preserve InvalidStateError for non-text response types.
      if (this.readyState !== 4) return nativeText;
      const result = this.response;
      return typeof result === 'string' ? result : nativeText;
    }
  };
})();
