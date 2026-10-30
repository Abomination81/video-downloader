const tracking = /^(utm_.+|fbclid|gclid|dclid|msclkid|ttclid|twclid|igshid|yclid|mc_cid|mc_eid|_ga|_gl|srsltid)$/i;
const protectedKey = /^(x-amz-.+|x-goog-.+|signature|sig|token|access_token|auth|authorization|expires|policy|key-pair-id|hdnts|hmac|__gda__|samlrequest|samlresponse|relaystate|code|state|nonce|session|sessionid)$/i;

/** Keep untouched query bytes, ordering and fragments intact. Never rewrite media URLs. */
export function cleanLink(input: string): string {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[\x00-\x1f\x7f]/.test(input)) throw new Error('Expected a web link');
  const hash = input.indexOf('#');
  const fragment = hash < 0 ? '' : input.slice(hash);
  const base = hash < 0 ? input : input.slice(0, hash);
  const question = base.indexOf('?');
  if (question < 0) return input;
  const pairs = base.slice(question + 1).split('&').map((raw) => {
    let key = raw.split('=', 1)[0]!;
    try { key = decodeURIComponent(key.replace(/\+/g, ' ')); } catch { /* Preserve malformed keys verbatim. */ }
    return { raw, key };
  });
  if (pairs.some(({ key }) => protectedKey.test(key))) return input;
  const youtube = /(^|\.)(youtube\.com|youtu\.be)$/.test(url.hostname);
  const spotify = /(^|\.)spotify\.com$/.test(url.hostname);
  const kept = pairs.filter(({ key }) => !tracking.test(key) && !((youtube || spotify) && key.toLowerCase() === 'si'));
  if (kept.length === pairs.length) return input;
  return base.slice(0, question) + (kept.length ? '?' + kept.map(({ raw }) => raw).join('&') : '') + fragment;
}
