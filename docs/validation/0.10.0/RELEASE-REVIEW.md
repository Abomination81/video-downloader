# Website filtering release review

## Permissions and boundaries

- PASS — existing required/host permissions and extension identities are unchanged. The new DNR permission is optional and requested from the Enable button's user gesture.
- PASS — web content cannot change ad preferences. The existing extension-page RPC boundary and strict schemas cover the new status/site/global commands; actual content-script senders are rejected in Chrome.
- PASS — the Pluto MAIN-world adapter has no extension API or arbitrary page-message bridge. URL, response-size and XML boundaries limit it to known metadata; media keys and license requests are untouched.

## Reliability and recovery

- PASS — native filtering, domain/party/resource exceptions and per-site allowances are verified through a real HTTPS server, without Playwright response interception bypassing network filtering.
- PASS — global Off removes existing rules even if packaged filter metadata is damaged. Site controls, explicit reload, browser restart and YouTube isolation pass. Filtering errors do not prevent downloader RPCs.
- PASS — safe-rule quotas are reserved; domain compaction prevents quota truncation in this snapshot. Chrome checks regex compatibility before activation. Unsupported exception compilation fails closed for activation instead of removing the exception.
- PASS — malformed/unrecognized Pluto streams fail open. A real Shaka fixture verifies decoded video/audio, period transitions and seeking. Live Pluto advances through its first scheduled zero-duration break.
- UNKNOWN — universal live/stitched-ad removal, nonzero ads in Pluto's current HLS variant, every provider and every anti-blocking system. These are excluded from product claims. No generic HLS edits ship.

## Data, dependencies and updates

- PASS — no new runtime external filter service, telemetry, account, secret or paid API. Only global preference and paused hostnames are stored locally. Existing download history/configuration paths are unchanged.
- PASS — EasyList provenance, SHA-256, attribution, selected license and corresponding data/compiler are included. Ghostery parsing is build-only; no downloaded executable filters run in the browser.
- PASS — signed-update permission validation accepts this optional addition. Existing native download, cleanup, MP3, image, screenshot and update regressions pass; off/permission gating provide a local rollout control.
- PENDING AT REVIEW — public CI, signed release bytes and installation verification are recorded after publication.
- NOT APPLICABLE — hosted authentication, user accounts, server endpoints, databases, payments, LLM quotas and cloud operational alerts. This feature runs in the user's browser.

Evidence and exact limitations are recorded in `docs/VALIDATION.md`; machine-local test logs live under ignored `output/`.
