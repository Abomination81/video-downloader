/* Still — isolated, local player fallback. GPL-3.0-or-later. */
(() => {
  'use strict';
  if (location.protocol !== 'https:' || !(
    location.hostname === 'www.youtube.com' ||
    (location.hostname === 'www.youtube-nocookie.com' && location.pathname.startsWith('/embed/'))
  )) return;

  const SKIP = 'button.ytp-skip-ad-button, button.ytp-ad-skip-button, button.ytp-ad-skip-button-modern';
  const RETRY_MS = 1000;
  const MAX_SKIPS_PER_SOURCE = 3;
  const MAX_SKIPS_PER_BREAK = 9;
  const MEDIA_EVENTS = ['loadedmetadata', 'durationchange', 'timeupdate', 'emptied'];
  let player = null;
  let video = null;
  let observer = null;
  let scheduled = false;
  let session = null;
  let suspended = false;
  let timer = null;

  function writeMuted(state, value) {
    state.expectedMuted = value;
    if (state.video.muted !== value) state.video.muted = value;
  }

  function writeRate(state, value) {
    state.expectedRate = value;
    if (state.video.playbackRate !== value) state.video.playbackRate = value;
  }

  function preferences() {
    if (!session) return;
    const state = session;
    // Media events are asynchronous. Compare values too, so an external change
    // noticed before its event is delivered is never overwritten by the next tick.
    if (state.muteOverride || state.video.muted !== state.expectedMuted) {
      state.muteOverride = true; state.muteOwned = false;
      state.muted = state.video.muted; state.expectedMuted = state.video.muted;
    }
    if (state.rateOverride || state.video.playbackRate !== state.expectedRate) {
      state.rateOverride = true; state.rateOwned = false;
      state.rate = state.video.playbackRate; state.expectedRate = state.video.playbackRate;
    }
  }

  function releaseChanges() {
    if (!session) return;
    preferences();
    if (session.muteOwned && session.video.muted === session.expectedMuted) writeMuted(session, session.muted);
    if (session.rateOwned && session.video.playbackRate === session.expectedRate) writeRate(session, session.rate);
    session.muteOwned = false; session.rateOwned = false;
  }

  function restore() {
    releaseChanges();
    session = null;
  }

  function userMute(event) {
    if (!event.isTrusted || !session || !(event.target instanceof Element)) return;
    const muteButton = event.type === 'click' && event.target.closest('button.ytp-mute-button, button.ytp-volume-icon');
    const muteKey = event.type === 'keydown' && event.key?.toLowerCase() === 'm' &&
      !event.ctrlKey && !event.metaKey && !event.altKey &&
      !event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
    if (!(muteButton && player.contains(muteButton)) && !muteKey) return;
    // Capture intent before the site's handler runs. This also preserves a rapid
    // unmute/mute pair whose queued volumechange events see only the final value.
    session.muteOverride = true; session.muteOwned = false;
    queueMicrotask(preferences);
  }

  function visible(button) {
    return button instanceof HTMLButtonElement && !button.disabled && !button.form && !button.closest('a, form') &&
      button.getClientRects().length > 0 && getComputedStyle(button).visibility === 'visible' &&
      getComputedStyle(button).display !== 'none';
  }

  function separateAd() {
    try {
      const source = new URL(video.currentSrc);
      return source.protocol === 'https:' && !source.username && !source.password && !source.port &&
        /(^|\.)googlevideo\.com$/.test(source.hostname) && ['SA', 'SR'].includes(source.searchParams.get('ctier'));
    } catch { return false; }
  }

  function sourceTransition() {
    if (!session || session.source === video.currentSrc) return false;
    releaseChanges();
    session.source = video.currentSrc;
    session.seekAttempts = 0; session.skipAttempts = 0;
    session.awaitingEvidence = true;
    return true;
  }

  function tick() {
    scheduled = false;
    if (suspended) return;
    if (!player?.isConnected || !video?.isConnected) { discover(); return; }
    const ad = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
    if (!ad) { restore(); return; }
    const marker = player.querySelector('.ytp-ad-player-overlay, .ytp-ad-text, .ytp-ad-preview-container');
    const buttons = [...player.querySelectorAll(SKIP)].filter(visible);
    const hasMarker = marker && marker.getClientRects().length > 0 && getComputedStyle(marker).visibility === 'visible';
    if (!hasMarker && !buttons.length) { releaseChanges(); return; }
    if (!session) {
      session = {video, muted: video.muted, rate: video.playbackRate,
        expectedMuted: video.muted, expectedRate: video.playbackRate,
        muteOwned: false, rateOwned: false, muteOverride: false, rateOverride: false,
        source: video.currentSrc, awaitingEvidence: false, seekAttempts: 0,
        skipAttempts: 0, totalSkips: 0, nextSkipAt: 0};
    }
    preferences();
    sourceTransition();
    const adMedia = separateAd();
    // An unchanged ad flag alone cannot classify a new source. A visible native
    // skip control permits only muting/skipping; seeking needs separate ad media.
    if (session.awaitingEvidence) {
      if (!buttons.length && !(adMedia && hasMarker)) return;
      session.awaitingEvidence = false;
    }
    if (!session.muteOverride) { writeMuted(session, true); session.muteOwned = true; }
    const button = buttons.find(candidate => player.contains(candidate) && visible(candidate));
    if (button && session.skipAttempts < MAX_SKIPS_PER_SOURCE && session.totalSkips < MAX_SKIPS_PER_BREAK &&
        performance.now() >= session.nextSkipAt) {
      session.skipAttempts++; session.totalSkips++;
      session.nextSkipAt = performance.now() + RETRY_MS;
      button.click();
      // Handlers can synchronously replace media, move controls or finish an ad.
      if (!player.isConnected || !video.isConnected ||
          !(player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) { restore(); return; }
      sourceTransition();
      schedule();
      return;
    }
    // Seeking a stitched or blob-backed stream risks skipping real content. Acceleration
    // is allowed only for a separately identified ad media URL, never from CSS state alone.
    if (!adMedia || !hasMarker || !Number.isFinite(video.duration) ||
        video.duration <= 0 || video.duration > 180 || video.currentSrc !== session.source ||
        session.seekAttempts >= 3) return;
    try {
      if (!session.rateOverride) { writeRate(session, 16); session.rateOwned = true; }
      if (video.readyState >= 1 && video.seekable.length && video.seekable.end(video.seekable.length - 1) >= video.duration - 0.25) {
        session.seekAttempts++;
        video.currentTime = Math.max(0, video.duration - 0.05);
      }
    } catch { /* Some live/MSE players reject seeking. Leave their skip control usable. */ }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(tick);
  }

  function discover() {
    if (suspended) return;
    const next = document.querySelector('#movie_player, #player .html5-video-player');
    const media = next?.querySelector('video.html5-main-video, video');
    if (next === player && media === video) return;
    restore();
    observer?.disconnect();
    detach();
    player = next; video = media;
    if (!player || !video) return;
    for (const event of MEDIA_EVENTS) video.addEventListener(event, schedule);
    video.addEventListener('volumechange', preferences);
    video.addEventListener('ratechange', preferences);
    player.addEventListener('click', userMute, true);
    player.addEventListener('keydown', userMute, true);
    observer = new MutationObserver(schedule);
    observer.observe(player, {subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'disabled']});
    schedule();
  }

  function detach() {
    for (const event of MEDIA_EVENTS) video?.removeEventListener(event, schedule);
    video?.removeEventListener('volumechange', preferences);
    video?.removeEventListener('ratechange', preferences);
    player?.removeEventListener('click', userMute, true);
    player?.removeEventListener('keydown', userMute, true);
  }

  document.addEventListener('yt-navigate-finish', discover);
  document.addEventListener('DOMContentLoaded', discover, {once: true});
  // Bounded discovery rather than a site-wide MutationObserver on YouTube's busy feed.
  function start() {
    suspended = false;
    if (timer === null) timer = setInterval(() => { discover(); if (session) schedule(); }, 750);
    discover();
  }
  window.addEventListener('pagehide', () => {
    suspended = true;
    restore(); observer?.disconnect(); clearInterval(timer); timer = null;
    detach();
    player = null; video = null;
  });
  window.addEventListener('pageshow', start);
  start();
})();
