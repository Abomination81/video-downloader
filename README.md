# Video Downloader

[![Release](https://img.shields.io/github/v/release/Abomination81/video-downloader?color=39ff14&labelColor=000000)](https://github.com/Abomination81/video-downloader/releases/latest)
[![Checks](https://github.com/Abomination81/video-downloader/actions/workflows/checks.yml/badge.svg)](https://github.com/Abomination81/video-downloader/actions/workflows/checks.yml)
[![MIT license](https://img.shields.io/badge/license-MIT-39ff14?labelColor=000000)](LICENSE)

**Built by [Abomination81](https://abomination81.com)** · [X @Abomination81](https://x.com/Abomination81) · [GitHub](https://github.com/Abomination81)

![Video Downloader by Abomination81. Video, audio, images, screenshots and browsing tools.](docs/assets/video-downloader-hero.svg)

**Right-click. Download video. Get a clean, compatible MP4.** A Chrome extension and silent local helper find the highest-resolution source, save H.264 video and AAC audio by default, and remove identifying metadata. Compatible tracks are copied; other tracks are converted when needed.

It also restores text selection and copying, copies links without common tracking parameters, and saves original images with identifying metadata removed. Chrome's ordinary image downloads are cleaned automatically too.

**[Download the installer ZIP](https://github.com/Abomination81/video-downloader/releases/latest/download/Video-Downloader.zip)** · [Visual install guide](https://abomination81.com/video-downloader/) · [Release notes and checksums](https://github.com/Abomination81/video-downloader/releases/latest)

Use **Video-Downloader.zip** from Releases for installation. GitHub's automatic **Source code** ZIP does not contain the built extension and helper wheel.

## What you get

| Action | Result |
| --- | --- |
| **Download video** | Highest available resolution and frame rate in a compatible H.264/AAC MP4; native Chrome download entry |
| **Choose format** (toolbar) | Inspect available source resolutions, frame rates, codecs and size estimates; choose a format for this download |
| **Download audio** | Best available audio, up to 320 kbps by default; tags, artwork and chapters removed; native Chrome download entry |
| **Download photo** | Largest exposed image source, original format and quality, identifying metadata removed |
| **Save full-page screenshot** | A full-page PNG, or one ZIP of PNG parts for large pages; separate screenshot companion |
| YouTube ad blocking | Local filtering for videos, Shorts and embedded players; separate YouTube companion |
| Website ad blocking | Bundled EasyList network and cosmetic filters, per-site pause, and a narrow Pluto on-demand adapter; enable once in the toolbar or Settings |
| Chrome's **Save image as** | Automatic cleanup of newly saved images, preserving your filename |
| **Copy clean link** | Recognizable tracking fields removed; functional, signed and login links preserved |
| Browse normally | Right-click, text selection and copying restored by default; settings can disable restoration |

Downloads continue after you navigate away or close the source tab. Everything runs locally; no developer-operated upload service or account is required.

<details>
<summary>See the extension</summary>

<img src="docs/assets/downloads.png" width="380" alt="The green and black downloader with video, audio, images, screenshots, ad blocking and browsing tools.">

</details>

## Install on Mac

1. Unzip **Video-Downloader.zip**, then open **Install.command**. It installs the helper and any missing tools for your account. Internet access is required. If Homebrew is missing, setup installs it and macOS may ask for your password.
2. The installer opens an extension folder and Chrome's extensions page. Turn on **Developer mode**, click **Load unpacked**, and select that extension folder.
3. Load the **audio-companion** subfolder as a second extension to get the separate audio command.
4. Load the **youtube-companion** subfolder for YouTube Protection. Disable standalone Still first if installed.
5. Load the **screenshot-companion** subfolder for full-page screenshots. Disable standalone Still Screenshot if installed.
6. Reload any video pages that were already open.

The installed main extension folder is `~/Library/Application Support/Video Downloader/extension`; its companions are the `audio-companion`, `youtube-companion` and `screenshot-companion` subfolders. The main and audio extensions share one helper and download history. YouTube protection and screenshots keep separate, limited permissions. All four update together after their one-time Chrome setup. [Chrome groups multiple commands from one extension](https://developer.chrome.com/docs/extensions/reference/api/contextMenus), so companions keep the commands directly in the menu. The original ZIP can be deleted after setup.

## Install on Windows

Unzip the bundle and open **Install-Windows.cmd**. Setup uses Microsoft's WinGet to install missing FFmpeg, Deno, and ExifTool, and installs a private Python runtime automatically. Then enable Developer mode at `chrome://extensions`, click **Load unpacked**, and choose the extension folder opened by setup. Load its **audio-companion** subfolder as a second extension , **youtube-companion** for YouTube Protection, and **screenshot-companion** for full-page screenshots. Disable standalone Still if installed, then reload YouTube. Windows installation scripts are supplied; check `docs/VALIDATION.md` for platforms actually tested.

Chrome requires these manual steps for an unpacked extension. Setup does not change Chrome policies, bypass security controls, or require a Chrome Web Store account.

## Website ad blocking (0.10.0)

Open the main toolbar popup or Settings and click **Enable ad blocking**, then approve Chrome's filtering permission. This is optional and requires no extra extension. Reload open pages after enabling it. Existing download permissions and automatic updates stay unchanged; updates cannot silently approve the new optional permission for you.

EasyList network and cosmetic filters run locally using Chrome's native request-filtering API and bundled CSS. **Pause here** restores a site's requests and appearance; **Reload page** applies changes to its player. The global switch in Settings disables general filtering. YouTube continues to use its separate companion. Filter data updates arrive in signed releases, with no browsing telemetry or remotely downloaded executable code.

Pluto includes pause-ad hiding and a narrow on-demand adapter for known session metadata and DASH ad periods. Unknown or live stream formats remain unchanged. Ads stitched into HLS/content, first-party ads and anti-blocking changes can still get through. This is not a promise of ad-free playback on every service. Protected playback over DisplayLink is a separate display limitation.

EasyList data retains its CC BY-SA 3.0 license and attribution; see [bundle licenses](BUNDLE-LICENSES.md) and [filter provenance](filters/README.md).

## Download

- Play the video, then right-click and select **Download video**. This still defaults to the highest available compatible MP4.
- Choose **Download audio** for MP3 audio, or **Choose format** in the toolbar popup to inspect source formats. Both are available in the toolbar popup too. The picker can save compatible MP4, original-codec MP4, or MP3, with optional 128/192/256/320 kbps MP3 quality. Choices apply only to that download.
- The picker resumes if you close and reopen the popup. Its source format choices expire after 15 minutes; use **Refresh formats** if needed. An explicit format that disappears fails with a refresh prompt instead of silently substituting another rendition.
- **Restore right-click menus** is enabled by default, including on sites that disable the menu. You can disable it in Settings to use a site's custom context menu.
- Transparent overlays, cross-origin frames, and closed shadow roots are included in discovery.
- If the menu still cannot open, click the extension's toolbar button or press **Alt+Shift+V**. Pin the extension to make the button easy to reach.
- If multiple videos match, choose the correct one from the list.
- Video targets show **Download video** and **Download audio** as separate native entries. Audio targets show **Download audio**; image targets show **Download photo**. The audio companion is needed for the separate audio entry. **Choose format** and **Copy clean link** are in the toolbar popup.
- Files appear in **Chrome's native download panel**, accessible from its down arrow and Downloads page. The entry appears after the file has passed its metadata checks. The extension shows progress while the helper downloads and prepares the file.
- Downloads normally save directly in each person's own `Downloads` folder (`~/Downloads` on Mac, `%USERPROFILE%\Downloads` on Windows). A different location deliberately configured in Chrome is respected. The shared bundle contains no personal save location.
- You can navigate to another video, change pages, or close the video tab and popup after starting. The source and scoped session are captured at selection time; a detached helper continues the work. The browser handoff is tracked independently of the tab.
- A popup opening another tab does not discard an unfinished video selection. Choose the original video from the extension's list. Frame probes have a time limit, so a stuck player or script dialog can fall back to already-observed media addresses.

## Quality

The extension downloads the site's source files. There is no screen or tab recording fallback.

**Compatible MP4 (H.264 + AAC)** is enabled by default. It keeps the highest available resolution and frame rate. At equal resolution/frame rate, it prefers SDR and original H.264/AAC tracks to avoid needless re-encoding. When necessary, FFmpeg converts incompatible tracks to H.264 High Profile, 8-bit YUV 4:2:0 and AAC-LC mono/stereo. Compatible video or audio tracks are copied without re-encoding, even when the other track needs conversion. Conversion is lossy, takes additional time and can produce a larger file. Silent videos remain silent. Odd dimensions may receive a one-pixel border to fit H.264 chroma requirements.

Turn off **Compatible MP4** in Settings for **Original source mode**. That preserves the original AV1, VP9, HEVC, H.264 and audio codecs without lossy conversion when they can be copied safely into MP4. It retains the original HDR handling. HDR sources requiring tone mapping fail explicitly in compatible mode; they are never silently saved with washed-out colors.

There is no resolution cap or automatic truncation. A known extractor or master playlist is preferred over the low-quality rendition currently playing. Conversion is checked for dimensions, frame rate, frame count where available, track timing, color and rotation before metadata sanitizing. A site can expose only some formats to your session; the helper cannot download renditions it does not expose.

MP4 is a container, not a codec. An AV1/Opus MP4 can play locally yet be rejected by an upload service. The default addresses this codec mismatch. Platform-specific duration, resolution, file-size and account restrictions still apply; codec compatibility alone cannot guarantee acceptance by every service. See [X's technical upload recommendations](https://docs.x.com/x-api/media/quickstart/best-practices) and [web upload guidance](https://help.x.com/en/using-x/x-videos).

MP3 downloads select the best available audio-only source when the site exposes one, avoiding a video download just to discard the picture. Otherwise the helper extracts audio from the available combined source. AAC, Opus and other audio are converted locally using FFmpeg's LAME encoder; conversion is lossy and does not improve the source. Default output is up to 320 kbps, preserving existing MP3 audio without re-encoding when possible. Explicit lower bitrate limits can require conversion. MP3 supports mono/stereo; multichannel sources are mixed to stereo. Source sizes shown by the picker are estimates where supplied and can differ from the converted output.

The format picker lists the formats the first usable preferred source exposes. It does not invent resolutions or guarantee a site's complete catalogue. Selected video-only tracks are paired with the best available audio from that source. See [yt-dlp format selection](https://github.com/yt-dlp/yt-dlp#format-selection).

## Browsing and images

- **Enable copying and text selection** is on by default. It restores selection CSS and common copy/selectstart/keyboard blockers. Left clicks and drags always reach the page so video seek bars and other controls keep working. Editors and marked interactive controls retain their selection behavior. Sites that cancel mouse presses themselves can still prevent mouse selection.
- **Copy clean link** is in the toolbar popup. After right-clicking a link, open the popup within 15 seconds to copy that link; otherwise it copies the current page. It removes known tracking parameters such as `utm_*`, `fbclid` and `gclid`, while retaining timestamps, functional parameters and fragments. Signed, session and login links are left intact. The extension writes only the requested link; it does not read your clipboard.
- **Download photo** appears when you right-click an image. It uses the largest source explicitly exposed by the page's `srcset`, matching `picture` source or original-image attributes. It does not guess hidden CDN URLs or invent a higher-resolution image. The verified image appears in Chrome's download panel and normal download folder. Small inline/data/blob images are supported without canvas conversion; for large inline images, use Chrome's ordinary **Save image as**.
- **Automatically clean saved images** is on by default. Chrome's **Save image as** and other newly completed image downloads are cleaned locally in place, preserving the chosen filename. It does not scan previously downloaded images. With Chrome's own command, cleanup starts after the download completes, so the original metadata can briefly exist on disk. Our command removes metadata before handing the file to Chrome. Open the extension to see cleanup progress or any failure.

Images retain their original format and encoded picture data; they are never recompressed into JPEG. Cleanup handles JPEG, PNG/APNG, WebP, GIF, TIFF and AVIF, with additional HEIC/HEIF/JXL support when their structure can be verified. Animation frames, timing and loops remain intact. EXIF/GPS, author, comment, timestamps, XMP, thumbnails and source-URL file attributes are removed. Necessary orientation, color calibration, transparency and animation data remain. Color profile descriptions, device identity and creation dates are neutralized while preserving numerical calibration.

Simple static SVGs retain their drawing markup while descriptive/editor metadata is removed. Dynamic SVGs, external/embedded resources, unknown color profiles and unverified structures fail explicitly. Automatic cleanup leaves the original file untouched on failure. There is no claim that an unsupported image has been cleaned.

## Metadata

MP3 output contains one audio track. The helper disables ID3v1/ID3v2 writing, removes cover images and chapters, requires a complete MPEG frame stream without trailing APE or other tag blocks, and checks both FFprobe and ExifTool for remaining descriptive tags. It decodes the entire output to catch damage and verifies duration. When copying MP3, it also compares decoded-audio hashes before and after cleanup. Functional Xing/gapless headers and necessary codec/sample-rate/duration data remain; see [FFmpeg's MP3 muxer documentation](https://ffmpeg.org/ffmpeg-formats.html#mp3). Source-URL file attributes are removed after Chrome saves; quarantine markings remain.

The helper creates a fresh MP4 containing the selected audio/video tracks. It removes descriptive container/track tags, source timestamps, GPS, chapters, cover art, extra data tracks, user-data boxes, and H.264/HEVC unregistered SEI user data. Packet remuxing uses PyAV to remove private SEI messages selectively, retaining HDR, captions, timing, and orientation. FFmpeg performs the final container cleanup. FFprobe and ExifTool check the result before it is published in Downloads.

FFmpeg prepares missing decode timestamps before packet editing so the opening keyframe is retained. Track start times and available frame counts are checked to prevent a blank opening or lost frames. After Chrome saves the file, the helper checks its SHA-256 against the verified private MP4 and clears source-URL file attributes Chrome may add. macOS quarantine and Windows ZoneId security markings are retained.

Technical playback information (codecs, dimensions, timing, HDR and rotation) remains necessary. Metadata removal does not erase visible watermarks or information contained in the picture or sound. Unknown metadata causes verification to fail rather than producing a falsely labeled clean file.

Cookies, including applicable partitioned cookies on supported Chrome versions, are scoped to relevant site/media URLs, sent only to the local helper, and held in memory for the job. Source URLs, cookies and authorization headers are not stored in download history. Chrome records a temporary localhost transfer address instead of the website's video address. Neutral file names avoid embedding the source title or URL. Extension history contains the display title, status, and output filename; **Clear history** removes finished extension entries without deleting finished videos or Chrome's separate history. Finished history expires after 30 days.

The prepared file stays in a private local directory until Chrome has saved and verified it. The transfer listens only on `127.0.0.1`, uses an unguessable one-file capability, rejects website-origin requests, supports range requests, and expires after one hour. The private copy is removed on success or cancellation. A failed save retains the prepared copy for **Save file again**, for up to seven days. Browser safety checks remain active; the extension never auto-accepts a blocked or dangerous download.

Image processing and clipboard copying stay on your computer. Completed-image cleanup uses Chrome's local download filename; a private receipt records the final path so **Show file** can find it. Cookies are not saved for later retries. Filesystem quarantine/ZoneId security markings are retained while source-URL attributes are cleared.

## Update and share

Share **Video-Downloader.zip** with friends. Each person runs setup on their own computer. The embedded public key gives everyone the same extension ID, keeping the native connection stable.

**Automatic updates are enabled by default.** On Mac, a per-user background agent checks on demand or every six hours, even while Chrome is closed; it exits after checking. Other platforms check while Chrome is running. It verifies the release signature and exact package hash, prepares a separate helper runtime, waits for active downloads/image cleanups, then updates the installed files. Chrome activates the extension while its UI is closed and reconnects open pages without refreshing them. Downloads, preferences and unsent forms are kept. No Terminal or repeated installer is needed for these updates.

**Upgrading from 0.4.x or the initial 0.5.0 build:** run this bundle’s installer once, reload the extension at `chrome://extensions`, and refresh pages that were already open. This installs the updater; future releases update automatically. Each friend must do this one-time migration too.

Settings includes **Check for updates**, status/version information and an automatic-update switch. Failed checks retry later while the working version remains usable. Updates requiring additional Chrome permissions or a newer Chrome version stop with an explanation. Initial installation and upgrades to separately installed system tools can still require their normal installers. The manual **Update-engine** scripts remain available for emergency extractor updates; normal releases carry pinned, tested engine dependencies.

For maintainers, a version bump pushed to `main` runs the checks and publishes a signed GitHub release automatically. Only published stable releases are installed; an unversioned source change does not update anyone. See [automatic update design](docs/UPDATES.md).

Use **Uninstall.command** or **Uninstall-Windows.cmd** to remove the helper, then remove the extension in Chrome. Finished videos and shared package-manager tools are retained.

## Coverage limits

DRM-protected media, WebRTC streams without downloadable files, live recording, browser-internal pages, and some proprietary/custom players are not supported. Videos already cached before extension installation may require a page reload. A site can refuse downloads because of missing account access, IP restrictions, expiring links, server checks, client certificates or extractor breakage. The helper tries fresh page extraction after an expired direct link and one maintained Chrome-compatible transport retry after a 403 response; neither guarantees access to a blocked service. The toolbar offers a fallback when a site's event handling prevents the native menu. There is no guarantee of every video on every website. The restriction matrix and primary sources are in `docs/DOWNLOAD-COVERAGE.md`.

## Development

```sh
npm ci
uv sync --project helper --extra dev
npm run typecheck
npm test
npm run test:helper
npm run build
uv run --python 3.13 scripts/install.py --no-open
npm run test:browser
npm run package
```

No cloud service or permanent local server is required. SQLite stores job state, native messaging carries control messages, and a short-lived loopback endpoint transfers only already-clean files to Chrome. Independent workers continue if a popup or tab closes. Pending handoffs and image-cleanup work survive extension worker suspension through persisted IDs and alarms. Interrupted source jobs are marked as such; site credentials are not persisted for retries after a crash.

Research decisions and primary sources are in `docs/RESEARCH.md`. Dependency licenses remain their respective licenses; this repository's original source is MIT licensed.

## YouTube protection (0.8.0)

The installer now includes **YouTube Protection by Abomination81**, powered by Still 0.1.2. Run the installer, then Load unpacked the `youtube-companion` folder inside the installed extension folder. Disable standalone Still before enabling the companion and reload YouTube. Settings shows the companion folder and status. Pin its toolbar button to pause/enable protection.

It filters YouTube desktop videos, Shorts and embeds using bundled local code. It has only YouTube host permissions and cannot access downloader cookies, history, jobs or the helper. It has no telemetry or remote filters. Your protection preference stays local and survives bundle updates. Existing YouTube tabs need reloading after protection changes or updates. YouTube changes and ads stitched into content can limit filtering.

This companion is GPL-3.0-or-later; see [bundle licenses](BUNDLE-LICENSES.md); offline source/build notes are included under `youtube-companion-source/companion/youtube/README.md` in the installer ZIP. It is installed separately to preserve permissions and licensing. Friends load it once; subsequent signed bundle updates coordinate its version automatically.

## Full page screenshots (0.9.0)

The installer includes **Full Page Screenshot by Abomination81**, powered by Still 1.1.0. Load `screenshot-companion` once from inside the installed extension folder and disable standalone Still Screenshot. Right-click a webpage → **Save full-page screenshot** to save directly to Downloads. Keep the page and Chrome window active until it finishes. Large captures arrive as one ZIP containing PNG parts; the toolbar retains an optional preview.

It keeps its own three permissions (`activeTab`, `scripting`, `contextMenus`), with no all-sites, cookie, native-helper, download-history or persistent screenshot access. Abomination Settings shows its version and installation folder. The local connection shares version information only; it cannot start captures or transfer screenshot pixels. Updates travel in the existing signed bundle and wait until captures and previews close. Chrome's save-location preferences still apply. [Companion design, source and limits](companion/screenshot/README.md).
