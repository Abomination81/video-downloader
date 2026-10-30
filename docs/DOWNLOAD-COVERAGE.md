# Download coverage and restrictions

Researched and implemented on 2026-10-30. “Verified” below means a controlled local fixture or real Chrome integration, not certification against every live service.

| Restriction or failure | Approach | Verification |
| --- | --- | --- |
| Site cancels right-click | Early capture listeners restore the native menu; toolbar/shortcut remains available | Chrome: blocked menu and a page with no video |
| Ordinary HTTP page lacks secure-context UUID support | Cryptographic UUID fallback keeps the content script and menu restoration working | Real Chrome fixture on a non-secure HTTP hostname |
| Modal dialog, popover or JavaScript alert interferes with selection | Bound frame probes; use the recent selected video or observed stream when page scripts cannot answer | Chrome: modal, popover and held script dialog |
| Site opens another tab during an unfinished selection | Retain the original video choices and require an explicit choice instead of switching to the popup's content | Chrome: actual popup plus the extension's choice UI |
| Site prompts before navigation | A started download is detached from the document and is not cancelled by its unload prompt | Chrome: actual beforeunload dialog during navigation |
| Invisible overlay or iframe intercepts the click | Probe frames and map pointer geometry into the underlying player | Chrome: transparent overlay, cross-origin player and invisible iframe |
| Closed shadow root, sandboxed player or restrictive page CSP | Isolated extension scripts inspect reachable media and captured network responses | Chrome fixtures for all three |
| `controlsList=nodownload`, hidden video or canvas presentation | Selection uses sources/network captures rather than the player's download button | Chrome: disabled controls and canvas with hidden video |
| `blob:`/MSE URL, including revocation | Use observed HLS/DASH source manifests; never treat blob URLs as files readable by the helper | Chrome: active and revoked MSE URLs |
| Adaptive quality and separate audio | Prefer a master manifest/known extractor; yt-dlp selects the highest available rendition and merges without re-encoding | HLS/DASH fixtures and real Chrome download |
| Temporary segment failure | Bounded yt-dlp retries; missing fragments are fatal instead of silently omitted | Chrome: injected 503 on the highest rendition |
| Hotlink checks and signed-in media | Retain observed Referer/Origin/User-Agent/Accept and relevant site/media cookies | Chrome: a video requiring both cookie and Referer |
| Third-party partitioned cookie | Query the selected frame's partition key on Chrome 132+, then export only matching relevant cookies | API path exercised in Chrome; no live authenticated service certified |
| Expired signed direct URL | Retain query parameters and try fresh single-video page extraction as a final source | Real local HTTP 404 followed by fresh page extraction |
| Browser fingerprint refusal | One curl-cffi Chrome impersonation retry after 403, keeping scoped cookies and certificate checks | Local HTTP fixture requires browser client-hint headers |
| Ordinary AES-128 HLS with an accessible key | Use yt-dlp's supported stream decryption; the key must be available to the request | Helper codec/stream fixture |
| Navigation, tab closure or popup closure | Capture sources/session before detaching the worker; browser handoff is separate from the source page | Chrome native download completes without source/UI tabs |
| Extension service worker stops | Persist job and Chrome download IDs; native worker continues and alarm wakes the handoff | Explicit worker-stop integration check |
| Chrome save collision | `conflictAction=uniquify`; verify Chrome's saved bytes and remember its actual path | Helper collision-suffix and exact-byte checks |
| Interrupted or blocked Chrome save | Bounded network retry; retain the verified MP4 and show Save MP4 again; never auto-accept a browser safety warning | Explicit handling and private-transfer tests |

DRM licenses, inaccessible paid/private content, server-enforced account/IP/geographic restrictions, client certificates, unavailable stream keys, live recording and WebRTC-only streams remain limits. A JavaScript restriction can often be worked around; an unavailable source or a required server authorization cannot be made universal by an extension. Updates to yt-dlp remain part of ongoing compatibility.

## Chrome integration

Chrome has no supported API to import an arbitrary helper-created file as a completed download. The implementation uses the supported `chrome.downloads.download()` API with a temporary one-file loopback URL. The file is already sanitized before Chrome receives it. The helper rechecks the saved SHA-256 and removes Chrome-added origin file attributes afterward. Chrome's native download entry appears during this final local transfer, while the extension shows progress for the preceding source download.

The filename parameter is relative to Chrome's download location; absolute paths are rejected by the API. Normal installations use the user's Downloads folder. An intentionally changed Chrome download location is respected, rather than modifying browser preferences. Existing native-only clients can still publish directly to the helper's configured Downloads path.

Pending state contains job IDs, Chrome download IDs and expiring local transfer capabilities. Site URLs and cookies are excluded. A handoff is reconciled by its unique URL if the extension stops between the download API call and persisting its returned ID, preventing a duplicate completed entry.

## Primary sources

- [Chrome downloads API: native downloads, relative filenames, states and interruptions](https://developer.chrome.com/docs/extensions/reference/api/downloads)
- [Chrome service-worker lifecycle: native messaging and persistent state](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome alarms: wakeups and persistence](https://developer.chrome.com/docs/extensions/reference/api/alarms)
- [Chrome cookies API: partition keys and matching cookie queries](https://developer.chrome.com/docs/extensions/reference/api/cookies)
- [yt-dlp README: formats, retries and impersonation](https://github.com/yt-dlp/yt-dlp)
- [yt-dlp FAQ: sessions, IP matching and anti-bot fingerprinting](https://github.com/yt-dlp/yt-dlp/wiki/FAQ)
