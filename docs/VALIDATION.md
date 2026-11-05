# Validation

## 0.13.1 installed Chrome verification — 2026-11-05

The unified extension was activated in the normal Chrome profile. Its native menus offered video/audio/photo downloads and full-page screenshots under one extension. A full-page PNG and original photo appeared in Chrome's download panel. A tagged H.264/AAC test clip finished in Downloads after immediate navigation away. Chrome's ordinary image-save flow removed author/comment/GPS fields while preserving a 1200×720 JPEG, rotation and color profile.

YouTube played and sought forward. WatchLuna passed its automatic site check, loaded its embedded video, played at 1724×720, sought forward without resetting, and exposed the native download menu despite the site's right-click restrictions. The extension's Pop out button entered and exited native picture-in-picture. These are playback/control checks, not proof that every source on those sites can be downloaded.

Controlled pages in the same Chrome profile verified actual CookieYes rejection with a form preserved, surprise-window blocking, and Open once recovery. Existing isolated suites cover the ad engine, other consent providers, unsupported consent fallback, OCR, settings and message boundaries.

A live YouTube MP3 attempt exposed a real false rejection: FFprobe reports the valid stereo Xing header's encoder marker as a stream tag. The regression failed before the fix. Output now explicitly normalizes that field to the fixed `Lavf` gapless marker and accepts only that exact technical value. Source encoder identity, ID3, APE, artwork, chapters and descriptive tags remain disallowed. Real surround conversion and stereo-copy checks cover 44.1/48 kHz and 128/320 kbps, source-identity removal, full decoding and equal decoded samples after MP3 copying. The same live YouTube source converted successfully after the fix.

Technical basis: [FFmpeg MP3 demuxer](https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/mp3dec.c) uses a recognized marker to apply delay/padding and exposes its encoder tag when the header CRC validates; [MP3 muxer](https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/mp3enc.c) writes that header independently of ID3.

## 0.13.0 one extension — 2026-11-05

The complete toolset was tested under one extension ID: downloads and metadata cleanup, full ad engine, cookies, popups, video controls, OCR and screenshots. Shared menu/message/offscreen conflicts were resolved. Local suites and the bounded signed-update checks passed; live YouTube playback passed. WatchLuna/Reddit player verification was limited by anti-bot gates. See the [full review](validation/0.13.0/REVIEW.md) for evidence and installation limits.


## 0.12.0 browsing tools — 2026-11-05

56 extension tests and 177 helper tests pass, with production browser suites for consent rejection, popup recovery, local image text recognition, sender isolation and all existing download/protection/screenshot workflows. Live media controls were verified on YouTube, B98, Twitch and Pluto. Nine other sampled sites reached access gates, unavailable content or no loaded player and are not counted as playback passes. The live Pluto test exposed immediate picture-in-picture closure; restoring the player's disabled flag only after PiP exits fixed it. Known consent-library cosmetic fallback hiding is disabled so a banner is never hidden as a substitute for rejection.

See the [detailed review and limitations](validation/0.12.0/REVIEW.md) and [technical live-site observations](validation/0.12.0/live-sites.json). No new Chrome permissions or OCR uploads. No all-sites or exploit-free guarantee is made. Main-profile installation remains distinct from isolated browser verification.

## 0.11.0 full Ad Protection — 2026-11-04

- TypeScript/build and 51 extension unit tests pass. The existing 167 helper cases pass; the expanded updater suite passes 88 cases, including 10 new companion boundary/removal cases.
- Production full-engine browser test uses actual HTTPS requests, not intercepted Playwright routes. Complete mode starts with six default lists (19,102 network rules and 26,771 cosmetic entries reported by upstream metadata). Main EasyList/Pluto registrations and old Still YouTube protection stand down. Existing per-site pauses migrate once.
- Real ad requests are redirected/blocked and ad elements hidden. A generated harmless clip plays, seeks, and remains alongside working text fields. A matching Google IMA SDK request receives the packaged substitute, dispatches content-resume events and starts content without waiting for an ad.
- Main global off/on and per-site pause/resume work after reload, retain exclusions and survive a real browser restart. Parent UI/invalid messages are rejected by the background-only bridge. A version replacement defers while companion settings are open, then activates with saved modes intact in an isolated developer-mode Chrome profile.
- Existing basic-filter/Pluto Shaka playback checks, YouTube companion boundary/paired-update tests, real pointer/native seek-bar interactions, main automatic activation, and MP4/MP3 format/download tests pass. No user Chrome permissions or extension settings were changed by these test profiles.
- The installer has 877 entries and expands to approximately 56 MB, within the older updater’s 1,000-entry/128 MiB bounds. Corresponding source is included as a standard nested ZIP; all country flags are retained in a packed image module. Archive extraction validates as well as bundle identity/permissions. The included source reproduces all full-companion files byte for byte offline; bundle identity/permission validation passes. The full engine and its corresponding source retain GPL-3.0-or-later notices.
- Live forced-preroll example: no-blocker/basic/full isolated sessions played program content, but the reported five-second ad was not served. That specific preroll is **not a verified fix**. Live ad inventory, anti-block changes and stitched/protected ads limit coverage. This is not an all-sites guarantee; Windows installation remains unverified.


## 0.10.0 website ad blocking — 2026-11-04

Passed: type checking, production build, 51 TypeScript tests, all 167 helper tests, download/image/copy integration, format-picker/MP3 integration, player interaction checks, companion menu and update checks, nine YouTube scenarios and seven screenshot scenarios. The new real-Chrome ad suite covers production startup before optional permission, native request blocking and exceptions using a real HTTPS fixture server, CSP-safe cosmetics, site pause/resume, the actual toolbar reload control, the global-off UI, content-script rejection, YouTube isolation, persistent browser restart and disabling existing filters when packaged filter data is damaged.

The pinned EasyList snapshot contains 78,011 source lines. Compilation produces 3,823 packed native rules and 23,868 cosmetic records including the narrow Pluto pause-ad selector, with no quota truncation. Unsupported network modifiers account for 742 skipped source filters; extended/scriptlet selectors are omitted. Chrome 156 accepts 3,809 native rules after its own regex-memory validation omits 14 unsupported blocking expressions. No unsupported exception is silently dropped. Compiled rule content, rather than only the upstream source hash, controls refreshes after updates.

Pluto tests exercise actual MAIN-world fetch and XHR response consumption for JSON, text, ArrayBuffer and XML. Known on-demand ad periods are removed; malformed, all-ad, dynamic, unrelated and live manifests remain unchanged. ContentProtection descriptors are retained. A real Shaka 4.16 player decodes video and audio across a synthetic multi-period DASH stream, shows both content periods, plays no ad frames, recomputes duration and remains seekable. This does not certify all audio/video timing or every live provider format.

An anonymous live Pluto Chrome test played the supplied Star Trek episode. Its current HLS manifests had no recognized ad markers and its session reported five scheduled breaks with zero ad duration. After seeking to 318 seconds, playback advanced through the first scheduled break at 320 to 332.9 seconds with 907 decoded frames and no media error. No broad HLS pruning is shipped, and removal of nonzero live or stitched ads is not established by this check. The user's actual DisplayLink display was not changed or retested.

Required Chrome and host permissions remain unchanged. Optional `declarativeNetRequestWithHostAccess` starts ungranted; Chrome's DNR namespace is unavailable until approval. The signed updater accepts the optional addition without granting it. Tests of filtering use a separate disposable copy with that permission already declared as granted. The native optional-permission prompt requires human approval; its acceptance was not automated or claimed for the user's browser. Every normal user enables general filtering once, then reloads existing pages. Windows installation remains unverified.

The real Off control also completes while a website holds a JavaScript alert open; frame-policy replies have a two-second bound. The packaged ZIP passes integrity and actual installed-version update validation. Its included ad-filter source rebuilds offline after dependencies are cached, with all four generated files byte-identical to the extension build.

## 0.9.2 tool design — 2026-11-04

Replaced the installed tool's ghoul/eye artwork with an original SVG download mark and checked-in PNG sizes. The main popup, settings, audio, YouTube and screenshot screens share green/black colors, system typography and visible @abomination81 links. The main popup retains download/format/history controls and lists every included tool with companion availability. A disposable profile with all companions and an isolated real helper rendered a 380 × 600 popup; its footer ends at 587 pixels with no horizontal overflow. Screenshots were visually inspected. Native context-menu labels remain unbranded; the screenshot command is Save full-page screenshot. Chrome controls native menu styling and its extension icon.

Passed: production build/type checking, 43 TypeScript tests, all 166 helper tests (including 83 installer/updater checks), the full media/image/copying browser integration, format-picker/MP3 integration, nine YouTube companion scenarios and seven screenshot companion scenarios. The version fixture now advances from the actual helper version so update tests continue to test upgrades after release bumps. The update checks also cover automatic audio-companion activation and refusing to reload a mismatched unpacked folder. Existing source identities, permissions and pinned upstream engine files are preserved. Publication checks and the signed-release upgrade are recorded separately.

## 0.9.1 right-click restoration — 2026-11-04

Reproduced the reported class of failure in the real Chrome update harness: an existing page's earlier window-capture `contextmenu` handler still canceled the native menu after the extension reconnected. The new enabled-state check failed before the fix and passed afterward. A local MAIN-world policy now ignores `preventDefault()` and legacy `returnValue = false` only for context menus while restoration is enabled. It uses no page messages or extension APIs. Installation reconnects already-open tabs as well as updates.

Passed: type checking, production build, 42 TypeScript tests, update/reconnection regression including both restoration states and legacy cancellation, and real player click/drag checks in ordinary, shadow-root and cross-origin-frame players plus Chrome's native timeline. Normal mouse event cancellation remains unchanged. Live user Chrome inspection was interrupted; the supplied screenshot establishes the YouTube custom-menu symptom, while the controlled browser fixture establishes the reproduced cause and fix. This is a local build, not a published release.

## 0.9.0 screenshot companion — 2026-11-04

Locally integrated Full Page Screenshot by Abomination81, using the pinned Still 1.1.0 engine. Screenshot access stays in a separate extension with only `activeTab`, `scripting` and `contextMenus`. Main downloader permissions are unchanged. Its version-only connection rejects foreign extensions, parent tabs/content scripts, malformed commands and capture requests. The companion cannot access the native helper or parent download jobs, and its CSP blocks external HTTP requests.

Passed: TypeScript checking and production build; 42 TypeScript tests; 166 Python tests; all 55 screenshot browser/edge scenarios (23 at 1×, 23 at 2×, nine edge cases); seven combined screenshot integration scenarios; nine YouTube integration scenarios; video/copying/selection interaction checks; automatic update activation; authenticated native audio/menu checks. Captures retain complete rows, fixed/sticky elements, lazy loading, cancellation and document restoration. Combined tests verify repeated captures without navigation, automatic PNG download, temporary-preview closure, capture/preview update deferral and eventual version activation. The isolated screenshot harness uses native window dimensions: forced viewport emulation had reported 700 pixels while Chrome captured 613 after closing a tab. The update harness now allows worker startup beyond Chrome's 30-second alarm boundary.

The packaged archive passes the actual update-policy validator and ZIP integrity checks. Its included screenshot source rebuilds offline with all 16 output files byte-identical. No test capture bridge ships. The macOS packaged installer upgraded the local helper to 0.9.0; native ping reports ready and native registration still permits only the main extension. Installed extension files match the build.

In normal Chrome, the main downloader and screenshot companion are loaded from the stable Application Support directory. Settings shows **Extension 0.9.0 · Helper 0.9.0** and screenshot **Ready · v0.9.0**. The screenshot companion is enabled/pinned with file access off; standalone Still Screenshot is disabled to avoid duplicate commands. The actual root right-click menu showed **Take full page screenshot** beside **Download video**. One click saved a 2100 × 4100 PNG to Downloads while keeping the source selected; all 4100 rows were verified, including one header/footer and restored sticky placement. Its temporary preview closed. The separately installed standalone YouTube protection was left intact; the optional audio/YouTube bundle companions are tested in disposable profiles but were not enabled by this screenshot task.

Machine-readable evidence is in `docs/validation/0.9.0/`. Remaining capture limits are documented in `companion/screenshot/README.md`. Windows installation was not exercised. This is a local build; no release was pushed, signed or published.

Verified on 2026-10-30 on macOS arm64. Browser/site support claims are limited to the scenarios exercised; these checks do not certify every live website.

## Passed

- TypeScript type checking and WXT production build
- Twenty TypeScript tests: source discovery, overlay/frame geometry, master-playlist preference, ambiguity handling, bounded frame recovery, clean-link behavior and image source parsing
- Sixty Python tests: native protocol, installer behavior, background jobs, source download compatibility, private Chrome handoff, video/image metadata cleanup and picture/audio preservation
- Codec fixtures: H.264/AAC, HEVC 10-bit HDR, VP9 and AV1
- HDR mastering display and content light level information preserved; private unregistered SEI removed; display rotation preserved
- Browser integration in a real isolated Chrome for Testing profile: restoring right-click on a page without video, blocked page handlers, transparent overlay, closed shadow DOM, cross-origin player beneath an invisible iframe, and a MediaSource blob player
- Native download from that blob player: master HLS stream downloaded at 320 × 180 while the player rendered its 160 × 90 variant; output metadata verified; job completed after the video tab closed
- Public-network smoke test: W3Schools' public `mov_bbb.mp4` downloaded as a verified clean 320 × 176 H.264 MP4 at 25 fps; the native messaging broker had already exited before the independent worker finished
- Actual per-user macOS helper installation, native host registration, and framed ping from the installed executable
- Packaged Mac installer executed with uv absent from PATH: official uv bootstrap completed, a managed Python download completed, and the bundled wheel installed successfully into the existing per-user helper environment
- Installed extension files matched the production build; archive contents, executable Mac installer bits, stable identity, and absence of local account paths checked
- Mac installer shell syntax and Python installer parsing
- npm audit: zero reported vulnerabilities, including development dependencies
- UI static/render sweep: zero failures, reflex findings or warnings; real browser screenshots inspected for settings and completed downloads

## Not certified

Windows scripts are included but have not been executed on Windows. No authenticated user account was used in testing, so site-session handling has not been certified against individual live services. Chrome Web Store distribution, DRM, live recording and WebRTC capture are outside this version's scope. The extension must be loaded through Chrome's normal Developer mode / Load unpacked workflow.

No lossy fallback or resolution cap is applied. Unknown metadata, malformed streams, unsupported MP4 codecs or quality changes cause a failed job instead of a success label.

## 0.1.1 opening-frame fix and metadata audit

The previous Matroska-to-MP4 packet pass skipped non-empty packets whose DTS was missing. In reordered H.264, the first keyframe can be one of those packets. A reproduced eight-second clip lost its first 72 frames and started video at three seconds while its audio started at zero. Whole-file duration did not detect this because audio covered the missing interval.

The helper now reconstructs decode timestamps through a lossless FFmpeg remux before editing private SEI. Only zero-sized flush packets are skipped; a non-empty packet with unresolved DTS fails explicitly. Verification checks each track's start offset and available frame counts. The regression fixture verifies all 192 video frames, the complete decoded picture sequence, unchanged encoded audio, and the opening audio/video alignment. Matroska's millisecond timebase can introduce sub-millisecond rounding of AAC decoder priming in MP4 edit lists.

The reported 576 × 1024 clip was audited with FFprobe, ExifTool's extended embedded-data scan, and a scan of every H.264 packet. Its 647 remaining video packets had no unregistered private SEI, and no descriptive, author, GPS, source-URL or chapter tags were found. Playback information and macOS filesystem/security attributes remain separate from descriptive embedded metadata. The original source was recovered to restore the 72 missing frames; all 719 video frames and 1,293 encoded audio packets are present in the corrected copy.

Downloads now default directly to the user's Downloads folder. The old app subfolder setting is migrated; custom destinations are preserved; existing download-history entries can still find files in the old subfolder. Accessing an existing Downloads folder does not change its permissions.

The 0.1.1 suite contains 24 Python tests and six TypeScript tests. A macOS test verifies that source-URL extended attributes are removed without deleting the quarantine security marking. The real Chrome integration checks also pass against the updated helper.

## 0.1.2 branding and shared installation

The suite now contains 30 Python tests and six TypeScript tests. Six installer cases exercise fresh installation, migration of the former app subfolder, and preservation of custom destinations across two separate account homes, including a home path with spaces. Fresh installations always choose that account's own Downloads folder. The bundle ships no config or download history.

The packaged macOS installer was executed successfully using Homebrew's older uv 0.9.28, from a bundle path containing spaces. Both the wheel and pinned requirements use file URIs to avoid older uv parsing paths as multiple filenames. The installed helper reports version 0.1.2 and the main Downloads destination. Its new source-attribute cleanup is present; the repaired real clip was verified again with both tracks starting at zero and all 719 video frames present.

The real Chrome integration passes against the installed 0.1.2 helper. Additional checks confirm the exact black/neon-green palette, locally loaded Anton font and ghoul graphic, creator website and X links, and no horizontal overflow or clipped path text at narrow widths. Settings, completed-download and empty-download screenshots were inspected. The opening-frame regression and metadata checks remain in the suite.

Brand sources and bundled-asset provenance are recorded in `BRANDING.md`. Windows installation remains untested on Windows.

## 0.2.0 native Chrome downloads and background recovery

The suite contains 43 Python tests and eight TypeScript tests. Added checks cover the private loopback endpoint (wrong token, foreign Origin, rebinding Host, method rejection, expiry and byte ranges), exact-byte validation, collision filenames, rejection of altered/unrelated/symlink destinations, cancellation, recovery after an interrupted final check, and removal of Windows Zone.Identifier origin URLs while retaining ZoneId. The Windows attribute parser is tested with a fixture; Windows installation itself remains untested.

Stream tests now include ordinary AES-128 HLS with an accessible key, fresh page extraction after an expired direct URL, and a 403/header-fingerprint fixture recovered through curl-cffi Chrome impersonation. These are controlled compatibility cases, not certification against all anti-bot services. Existing codec, HDR, orientation and opening-frame regressions remain in the suite.

Real Chrome integration verifies 11 player scenarios: transparent overlay, blocked menu, closed shadow root, cross-origin invisible iframe, MSE/blob, revoked MSE URL, disabled player download controls, canvas presentation with hidden video, sandboxed iframe, restrictive page CSP, and a session/Referer-gated source. Right-click restoration also passes on a page without video.

The source tab was navigated to another page immediately after starting, then closed; all extension UI pages were closed as well. Without those pages polling, the detached job selected the highest HLS rendition, recovered from an injected 503 segment response, sanitized the MP4, and completed the native Chrome download handoff. Exactly one complete Chrome DownloadItem matched the output path and extension ID. The private transfer copy was removed, and macOS source-URL attributes were absent afterward.

A second source required both the browser's session cookie and its observed Referer. Its video/UI tabs were closed, and the extension service worker was explicitly stopped through CDP. A persistent alarm restarted it; CDP observed the actual stopped/running transitions, and exactly one native Chrome entry completed. Playwright preserves the same Worker object when Chrome reuses the target, so the harness observes lifecycle state instead of incorrectly expecting a second serviceworker event.

The UI was checked again at narrow width, including local font/artwork loading, creator links, and no clipped text. The shared bundle preserves its stable identity and contains no personal configuration or account paths. The packaged macOS installer updates the per-user helper and extension in place.

## 0.2.1 popup, dialog and HTTP recovery

The app remains original-file-only; no screen/tab recording permission or fallback was added. The suite contains 43 Python tests and 14 TypeScript tests.

Frame probes and partition-key queries have 1.5-second bounds. A stuck renderer cannot keep all source detection waiting indefinitely. A recent matching video snapshot or already-observed stream can supply the source when a frame cannot respond. Redirected documents do not inherit stale clicked-video snapshots; a known protected-video flag is retained when a cached selection is recovered.

An unfinished video-choice list survives active-tab changes. Opening the extension from a popup retains the original explicit choices instead of silently selecting content from the new page. Browser integration creates an actual popup, checks the retained list, and starts the original streaming video through its real choice button.

A non-secure HTTP fixture exposed that content-script UUID generation required crypto.randomUUID(), which is unavailable there. The content script now falls back to cryptographic getRandomValues with proper UUID version/variant bits. The browser check uses a non-localhost HTTP hostname, not localhost's secure-context exemption.

The expanded real Chrome checks include HTML modal dialogs, popovers, a held JavaScript alert that prevents page replies, popup focus changes, and a beforeunload confirmation during navigation. Existing highest-quality selection, metadata cleanup, native Chrome entry, tab/UI closure and explicit extension-worker stop/restart checks still pass. Windows installation remains untested on Windows.

## 0.3.0 copying, clean links and images

The suite contains 60 Python tests and 20 TypeScript tests. Type checking and the production build pass. The expanded real Chrome harness passes all 15 video scenarios, existing native download/recovery checks, and the new browsing/image cases, with no page errors.

Copy checks verify USER-origin selection CSS on a page using `user-select: none !important`, common copy/selectstart/keyboard/pointer blockers, real mouse text selection, editable/interactive-control exclusion, and toggling restoration off and on. A link with tracking fields is copied through the real offscreen clipboard document, then compared to the expected clean URL. The test never prints pre-existing clipboard contents. The installed extension requests clipboard writing only.

A 160-pixel preview exposes a 1200-pixel original through srcset. The native helper downloads the original using the required cookie and Referer, sanitizes it, and completes exactly one Chrome download after the page navigates away. A data-URL image passes the same native pipeline without canvas conversion. An ordinary website-created Chrome image download is cleaned after its source tab closes, keeps its chosen filename, and creates no duplicate download entry. macOS source-URL attributes are absent while Chrome's quarantine marking remains. The pending cleanup entry is removed after completion.

Image fixtures cover JPEG, PNG, WebP, TIFF and AVIF with author/comment/GPS/date fields, rotation and an ICC profile containing private device identity. Encoded picture hashes, decoded pixels and color transforms remain unchanged. Animated GIF, WebP and APNG retain every frame, frame timing and loop count. Static SVG drawing markup survives removal of descriptive/editor metadata. Active SVG, entities, external styling and SMIL animation are rejected; a failed automatic cleanup leaves the original file byte-for-byte unchanged. The cleanup pool remains available during three video downloads, and duplicate cleanup requests remain idempotent.

Pillow verifies raster/animation content and never saves the output picture. ExifTool performs lossless metadata edits. HEIC/HEIF/JXL paths are implemented but do not have representative fixtures in this suite; unknown structures or unsupported color profiles fail verification. Automatic cleanup of Chrome's own saves starts after completion, so there is a brief period when original metadata may exist on disk. Our image command cleans before handing the file to Chrome.

The packaged macOS installer updates the per-user helper and verifies Pillow/lxml imports. Settings and download-history screenshots were inspected again at narrow widths, preserving the existing black/green branding. Windows installation remains untested on Windows.

The public install guide was checked at 375, 1280, 1440 and 1920 pixels with loaded local fonts, real extension captures, working in-page navigation and visible download/setup actions. Independent layout reviews were applied. The design sweep has no blocking findings; the exact black brand palette is intentional, and one 87-word setup window is accepted for clear instructions. The homepage's Code & tools listing was checked on desktop and phone. GitHub CI also passed the 60 helper tests, 20 extension tests, type check and production build from a fresh checkout.

## 0.4.0 compatible H.264/AAC default

73 Python tests and 22 TypeScript tests pass. New checks cover actual AV1/Opus-to-H.264/AAC conversion, copying already compatible files, copying H.264 video when only Opus audio needs conversion, silent video, cancellation, HDR rejection before unverified tone mapping, both output modes through real download jobs, and original-track preference without lowering resolution. Legacy requests and saved preferences migrate to compatible output; explicit Original source choices are preserved. Conversion counts as an active job for capacity limits and installer protection.

The reported AV1/Opus file was converted to a separate H.264 High / AAC-LC stereo MP4 at 854 × 480 and 30000/1001 fps. All 30,643 video frames remain. Video and audio both start at zero, their complete durations are retained, the original file is unchanged, and the converted file passed metadata inspection and a complete video/audio decode. This is local format verification; no upload or post was made to X as part of the check.

The real Chrome checks pass with the updated helper and the compatible default, including explicit Original source preference persistence, native download completion after page/tab closure, worker restart, image saves, and browsing tools. Images keep their original-format pipeline. HDR requiring tone mapping remains an explicit compatible-mode limit; Original source retains HDR. Windows installation remains unverified.

## 0.4.1 player interaction fix

The previous installed build reproduces the seek-bar failure with an ordinary div-based player: neither its pointerdown nor mousedown handler receives the click, and currentTime stays at zero. Copy restoration had treated the control's descendant label as ordinary text and stopped both events at window capture. Left-button presses are no longer intercepted. Selection overrides also exclude marked controls and their descendants, and selectstart handlers on controls remain available to the site.

The new isolated Chrome interaction harness passes on macOS arm64: actual seek-bar clicks and pointer-captured drags against real video playback in ordinary documents, open shadow roots and a cross-origin embedded player. Native Chrome video timeline clicking/dragging, a range input, right-click restoration, copy/selection blockers and real mouse text selection pass too. No user browser profile or native helper is needed. The check is included in GitHub CI. The existing full browser integration, 22 TypeScript tests, six installer tests, type check and production build also pass. The packaged macOS installer updated the installed helper and extension to 0.4.1; installed extension files match the production build.

Reddit was identified as the affected site. Its public page presented an anti-bot challenge to the isolated browser, so no live Reddit playback check is claimed. The regression is reproduced and fixed locally. Sites that cancel left-button presses themselves can still prevent mouse text selection; preserving page controls takes precedence over suppressing those presses.

## 0.5.0 signed automatic updates

The update tests verify Ed25519 signatures using a generated test key, reject altered bytes and another publisher, reject signed invalid manifests and foreign update URLs, and block archive traversal, symlinks and case collisions. Real installation tests build a higher-version helper wheel, install actual hash-locked runtime dependencies into a private environment, commit an update and send a framed native ping through the bootstrap. The selected helper version and download destination are verified. Busy jobs defer the commit; settings are retained; injected rename failure and an interrupted journal restore the former extension and runtime pointer. Old runtime pruning retains the active and rollback versions. The test key never signs a production release.

The isolated Chrome update test simulates an already-committed helper update through a small native status fixture. It verifies actual automatic `runtime.reload`, a version change, deferral while Settings is open, fresh content scripts on an existing page, removal of old listeners and selection CSS, retained preferences/unsent form/page state, and working video seeking. The page is requested only once. Developer mode is enabled through Chrome's normal UI in this test; command-line loading alone does not model an unpacked reload correctly. No user browser profile is changed.

23 TypeScript tests, type checking and the production build pass. The existing full browser checks also pass: all video discovery scenarios, highest-source HLS, native Chrome saves after tab closure/worker restart, metadata cleanup, ordinary image saves, copying and branding. Targeted update/installer tests pass, including the real runtime installation. The installed 0.5.0 bootstrap responds successfully through native messaging, and installed extension files match the production build. The updated public guide passes 375/1280px overflow and interaction checks. Windows remains unverified on Windows.

Production update signatures use the repository's Actions-only private key, with its public key included in the helper wheel. The release workflow waits for successful main-branch checks and uploads all assets to a draft before publication. A pre-updater installation still needs one final installer run and extension reload; future update activation is covered by the browser test above. Shared system tools and new Chrome permission requirements retain their normal manual setup paths.

## 0.5.1 Mac background agent

A live package check exposed macOS rejecting a freshly installed native CFFI module when the update worker ran as a Chrome descendant. The previous version remained intact. Update preparation now runs through a standard per-user launchd agent, kicked off by the native broker or its six-hour schedule. No Gatekeeper or quarantine setting was changed.

An isolated Mac test drives a real Chrome native-message request, a real temporary launchd agent, the actual signed release package, hash-locked dependency installation, a new helper runtime, the bootstrap pointer switch and automatic Chrome activation. The release bytes use deterministic local transport for this regression; the production signature remains verified with the real embedded public key. Preferences, form/page state, content-script replacement, selection cleanup and seeking survive the update. The temporary job is removed afterward. Agent tests also cover the registered kickstart target, opt-out, manual request consumption and interval throttling; installer cases check each account's own agent path and runtime.

## 0.5.2 foreground-action protection

26 TypeScript tests pass, including activation while idle, deferral during a foreground action and a new action starting while the helper idle query is pending. Foreground commands hold the update guard until their asynchronous selection, session collection and native handoff finish. This complements the helper's job/commit lock and the UI-open check.

## 0.6.0 format picker and MP3

The format picker and MP3 downloads were exercised in an isolated real Chrome profile against the source helper over native messaging. The picker was closed during inspection and reopened, then explicitly selected 160×90 while the automatic default still downloaded 320×180. Both the source tab and popup were closed after starting; downloads completed through Chrome's actual download manager. Separate MP3 downloads used default 320 kbps and explicitly selected 128 kbps audio. Each produced one `audio/mpeg` Chrome entry in the profile's normal download folder, one MP3 audio stream, and no descriptive FFprobe tags. Source-URL file attributes were absent and macOS quarantine remained. The 360/380-pixel picker views were checked for overflow and visually inspected with the established black/green branding.

Python checks cover all four MP3 bitrates, full decoding and duration, ID3v1/ID3v2/APEv2/cover-art removal, decoded-audio hash equality for copied MP3, silent sources and cancellation. Format checks cover exact lower HLS/DASH renditions, pairing video-only DASH with audio, explicit audio-only selection, expiry/source binding/kind/changed-format rejection, hidden bounded inspection capacity, update deferral, detached native inspection, idempotency and cancellation. Native validation rejects arbitrary format selector text and unsupported bitrates. No source URLs or cookies are written to the private format cache.

The existing full browser checks also passed: highest-source MP4, authentication/Referer recovery, overlays/frames/blocked menus, navigation/tab closure and service-worker restart, original/inline/ordinary-Chrome image cleanup and branding. Separate real seek-bar/scrubbing and automatic-update activation checks passed. No user browser profile was changed by these tests. Site-specific format availability remains dependent on the exposed source and session; no DRM or recording fallback was added.


## 0.7.0 direct menus and audio companion

The actual native Chrome menus were inspected on macOS using accessibility snapshots in an isolated Chrome for Testing profile. Video showed Download audio and Download video as sibling menu items, with no extension parent menu. Audio showed only Download audio from this tool. A linked image showed only Download photo. Each download command was a leaf at the root menu level; no Abomination81 menu tree appeared. Chrome's own built-in items remained available.

The two-extension browser check uses real native messaging, the actual companion sender and real media processing. It rejects a third extension and invalid RPC operations, downloads audio from video and an authenticated audio-only source requiring its cookie and Referer, and verifies clean MP3 output and exactly one Chrome download entry. It navigates/closes source tabs immediately during handoff, and repeated request IDs reuse the same job. The toolbar clean-link action uses the last right-clicked link. A simulated atomic folder/runtime version change verifies actual automatic reload of both extensions and reconnection of the companion, with Developer mode enabled in the isolated profile. No user Chrome profile is changed by those checks.

Helper checks also validate the companion's pinned identity, shared version and minimal permissions during signed updates. Existing MP4/MP3 format, metadata, image, seek-bar, clipboard and update-activation checks remain in the verification suite. The companion is packaged inside the main extension folder, so existing 0.6.0 updaters deliver both sets of files atomically. Chrome still requires loading the companion folder once; subsequent updates use the existing signed updater.

## 0.8.0 YouTube companion — 2026-11-04

Tested locally on macOS arm64 with Chrome for Testing 156.0.8078.4. The main downloader, audio companion and YouTube companion are separate extensions. The main permission list is unchanged. The YouTube companion keeps Still 0.1.2's three permissions and two YouTube hosts; the ad/player engine files are byte-identical to the recorded upstream source.

Passed:

- TypeScript type checking, production build and 35 TypeScript tests.
- Full helper suite: 148 passing tests, including 22 new YouTube update-policy cases and per-user installer/native-host isolation.
- Nine real integrated-browser scenarios: three extensions coexist; only the pinned parent worker can request status; hostile extension/tab/content-script senders and surplus commands are rejected; the companion cannot call parent download jobs; CSP blocks outbound requests; YouTube bootstrap/Shorts/network filtering and downloader discovery coexist; fixture mid-roll skip restores mute/speed; pause works without disabling downloads; unrelated sites remain unchanged; open companion UI defers upgrades; the parent's persistent retry activates the matching new version and preserves paused rules/scripts.
- Still's installed-extension checks against the built companion: 22 browser checks and 23 player scenarios, including malformed responses, nocookie embeds, forged page commands, unsafe skip controls, muted-state ownership, source churn, retries and player replacement.
- Continuous five-minute fixture soak: 200 ad cycles over 300.73 seconds. This was a synthetic session, not live YouTube.
- Downloader browser, interaction, update, format-picker and audio-menu suites pass. Includes native authenticated video/audio downloads, closed source tabs, worker recovery, clipboard actions, image cleanup, MP3 metadata verification, seeking and preserved form/page state across upgrades. The audio-menu suite runs with the YouTube companion loaded too.
- The actual 0.8.0 archive passes identity, permission, CSP and DNR scope validation against the previously installed 0.7.0 permissions. Companion source in the ZIP rebuilds offline with Node, matching every packaged byte. ZIP integrity and absence of private signing keys/configuration artifacts checked.
- Packaged installer applied to the existing local macOS installation. All three manifests are 0.8.0; framed ping from the installed native host reports helper 0.8.0 and tools ready. Native registration allows only the main downloader identity.

Machine-readable fixture evidence is in `docs/validation/0.8.0/`. Browser screenshots were inspected for the new companion popup and settings section.

Remaining limits: the new companion still requires one-time manual Load unpacked in the normal Chrome profile; disable standalone Still to avoid double filtering. Reload existing YouTube pages after protection changes or updates. This integration does not add new live-ad efficacy evidence: prior Still testing observed real pre-roll and Shorts filtering, while a controlled, actually served mid-roll comparison remains incomplete. Windows scripts are included but Windows installation was not exercised. Local packages are prepared; no release was pushed, signed or published by this integration task.
