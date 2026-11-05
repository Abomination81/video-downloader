# Browsing tools review — 2026-11-05

Tested on macOS arm64 with disposable Chromium 156.0.8078.4 profiles, the production build and actual native messaging where relevant. No personal browser cookies were used. Windows installation is not certified by these tests.

## Automated checks

- 56 TypeScript tests and 177 Python helper tests pass. Type checking, production build and `npm audit --omit=dev` pass (zero reported vulnerabilities; this is not proof of absence of vulnerabilities).
- Consent: Cookiebot actual API refusal; CookieYes rejection; Quantcast's initially disabled reject button; unsupported accept-only dialogs; known-vendor cosmetic-only fallback refusal; no Accept all; existing form contents preserved.
- Popup protection: media/background launches blocked; Open once; per-site allowance; explicit links; login with a real WindowProxy and subsequent navigation; blank-window recovery; same-origin bounce; forged page messages and synthetic action clicks rejected.
- Video: real seek-bar clicks/dragging remain usable, including shadow roots, cross-origin frames and native controls. New controls seek actual ranges, retain per-site speed and enter real native picture-in-picture. A transparent overlay that stops bubbling does not prevent the hover controls. The player's disablePictureInPicture flag is restored after exit, not immediately; this fixes Pluto's immediate PiP closure.
- OCR: selected inline image recognizes `COPY TEXT 12345` with no HTTP network requests from the OCR page. A cross-origin image fallback recognizes the same text without image-host cookies or source-page referrer. Oversized raster dimensions and SVG disguised as PNG are rejected before decoding. Recognition uses packaged English data and WebAssembly, never a remote recognition service.
- Security: an unrelated extension cannot read jobs, browsing settings or image data, change companion settings, or access a registered main-only native host. Own content-world messages cannot invoke privileged UI/helper/OCR actions or supply arbitrary evaluated code. Unsafe URL schemes/credentials, 300 forged messages, synthetic footer clicks, extension-resource reads and repeated navigation are covered. A private fixture input is unchanged and absent from extension storage.
- Existing integration: background MP4/MP3 downloads after source/popup closure; highest-resolution compatible default; metadata verification and native Chrome entries; exact format choice; cookie/referrer-scoped authenticated downloads; image cleaning and copy tools; native companion menus; screenshot isolation, capture and restoration; basic/Pluto/full-engine blocking; real IMA substitute completion; site/global controls; restart persistence; automatic main/companion update activation.
- Installer verification: 890 archive entries and approximately 100 MB expanded, below the oldest updater's 1,000-entry/128 MiB bounds. The actual updater validates the bundle. Included source reproduces all 679 Ad Protection runtime files byte for byte offline. Required main permissions, host grants and external callers are unchanged from 0.11.0.

The general browser suite was updated to recover its deliberately launched popup through **Open once**, because the new guard correctly blocked the old fixture's background launch. Its settings screenshot now selects the original controls section explicitly.

## Live public sites

This is compatibility sampling, not a ranking of the “most abusive” sites or proof of every ad being removed. Representative video-click popup cases were selected from upstream reports: [Miruro issue 33138](https://github.com/uBlockOrigin/uAssets/issues/33138) (closed as fixed in June 2026) and [B98 issue 31722](https://github.com/uBlockOrigin/uAssets/issues/31722) (closed as unable to reproduce in February 2026). Current ad inventory was not forced and challenge pages were not bypassed.

| Site | Observed result |
| --- | --- |
| YouTube | Public Blender video played; +10-second seek, 1.25× speed and actual PiP succeeded; no popup appeared |
| B98 | Reported player page played; seek, speed and PiP succeeded; no popup appeared |
| Twitch | NASA player media played; seek, speed and PiP succeeded; one site getLayoutMap warning remained |
| Pluto | On-demand media played; seek, speed and PiP succeeded after the restoration fix |
| Vimeo | Page reached, but embedded access challenge prevented player verification |
| Reddit | Humanity challenge; playback unverified |
| Putlocker / WatchLuna / AccuWeather | Access gates; playback unverified |
| Miruro | Report's exact content URL returned 404; playback unverified |
| Dailymotion / Tubi | Pages loaded, but no playable media was reached during this sample |
| CNN | Player element existed without loaded media; site JSON error; playback unverified |

Raw technical observations are in [live-sites.json](live-sites.json). Failed-network counts are request-blocking observations, not counts of video ads. No popup in a session does not prove the same ad would otherwise have appeared. Test outputs contain public page addresses and technical media state, not response bodies, session cookies, tokens or downloaded program content.

## Boundaries and remaining work

No new Chrome permissions. Main/background, content, OCR and companion messages are independently validated. Cookie rules and OCR assets are pinned and local; custom filter subscriptions remain an optional connection to user-selected sources. The signed publisher, installed files, browser and OS account remain trusted boundaries. Same-user malware, browser exploits and publisher compromise are outside what an extension can prevent.

Unknown cookie flows stay visible. Ordinary login/payment popups are intentionally permitted; popup intent is heuristic. Frame Permissions Policy, unready/protected players and native fullscreen can limit pop-out UI. Live website/ad changes remain ongoing compatibility work.

Main-profile loading and inspection require a manual step: the browser-control security policy permits only HTTP(S) pages and rejected extension settings access. Disposable-profile tests are not evidence that the user's normal Chrome has loaded the new build. Signed publication, installed-file activation and user-browser confirmation are recorded separately when observed.
