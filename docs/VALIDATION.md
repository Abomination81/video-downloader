# Validation

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
