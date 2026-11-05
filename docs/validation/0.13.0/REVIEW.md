# Unified extension verification — 2026-11-05

The runtime contains exactly one `manifest.json` and one service worker under the original downloader ID. Audio, screenshots and full uBlock Origin Lite no longer require separate installs. The native helper remains a separate silent local process.

## Local checks

- TypeScript typecheck, 56 unit tests and production build passed.
- Helper suite: 177 tests passed; six additional tests exercised the actual unified artifact’s permission, external-message, private-page and single-manifest update policy.
- Interaction tests: custom and native seek bars, pointer-captured dragging, shadow/frame players, right-click restoration, copy/selection and ordinary input controls passed.
- Downloader integration: direct media, overlay, disabled menu, shadow roots, cross-origin/sandbox frames, MediaSource/revoked blobs, disabled download controls, hidden/canvas video, restrictive CSP, authentication, dialogs and popup-focus recovery passed. Real HLS download selected the highest rendition, retried a fragment, survived navigation/tab closure/worker restart, verified metadata and produced one Chrome download.
- Image integration: largest exposed source, authenticated original fetch, inline image cleanup, rotation/color retention and Chrome’s ordinary image save cleanup passed. Filename and quarantine were preserved.
- Audio/format integration: actual unified menu handler downloaded MP3 from video and authenticated audio after leaving the page. Tags/artwork were absent. Highest compatible MP4, explicit lower rendition, default 320 and selected 128 kbps and native Chrome entries passed.
- Protection integration: real HTTPS DNR requests, cosmetics, nuisance-list changes, IMA SDK replacement/content resume, global/site pause persistence, real custom-filter compilation concurrent with clipboard copying, and Chrome restart passed.
- Browsing integration: supported CookieYes/Quantcast rejection, no Accept-all fallback, usable unsupported consent, blocked-window recovery, explicit link/login behavior, speed/seek/PiP, local English OCR, image limits and cookieless/referrerless cross-origin fetch passed.
- Screenshot integration: actual activeTab gesture, one menu owner, 1000×3100 PNG, restored source scroll, preview CSP, rejected preview-to-helper calls, direct context save, automatic preview close and navigation cancellation passed. Offscreen leases serialize correctly.
- Security integration: unrelated extension/native-host access rejected; content scripts cannot start jobs, read OCR inputs or change privileged settings; unsafe destinations, forged messages and synthetic clicks cannot open windows/grant exceptions; repeated navigation preserves one controller and normal fields.
- Update integration: Chrome activates committed files automatically, reconnects content scripts, retires prior handlers and preserves preferences/form/page/seek state without a page refresh.
- Production dependency audit: zero known vulnerabilities reported.

## Live sample

See `live-sites.json`. One disposable Chromium profile loaded only this extension. YouTube’s Big Buck Bunny video played with readyState 4, the browsing controller present, native menu available and source discovery working. WatchLuna and Reddit returned anti-bot challenges; their right-click restoration worked on those pages, but player/download behavior behind the gates was not certified. No user media was downloaded for this sample.

## Install and release boundary

The local 0.13 helper and complete extension were installed with `--no-open`; the installer preserved the local Downloads default. Activating the extension in the owner’s real Chrome profile remains a user-controlled step. Browser automation policy prohibits operating its extension manager; the test profiles do not replace that activation.

The consolidation adds main-extension permissions and removes the old companions. The 0.12 updater must refuse silent migration. One installer run plus one parent-folder Load unpacked step is required; subsequent 0.13 updates retain the signed, bounded update path. The combined pages share extension-level permissions. Message guards and preview CSP reduce exposed entry points but are not separate extension permission sandboxes.

Windows and universal site coverage are not certified. Live services, DRM, authentication and changing ad systems remain practical limits. Do not interpret these tests as proof that no exploit or incompatibility can exist.
