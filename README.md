# Video Downloader

[![Release](https://img.shields.io/github/v/release/Abomination81/video-downloader?color=39ff14&labelColor=000000)](https://github.com/Abomination81/video-downloader/releases/latest)
[![Checks](https://github.com/Abomination81/video-downloader/actions/workflows/checks.yml/badge.svg)](https://github.com/Abomination81/video-downloader/actions/workflows/checks.yml)
[![MIT license](https://img.shields.io/badge/license-MIT-39ff14?labelColor=000000)](LICENSE)

**Built by [Abomination81](https://abomination81.com)** · [X @Abomination81](https://x.com/Abomination81) · [GitHub](https://github.com/Abomination81)

![Video Downloader by Abomination81. Keep the video. Highest source quality, identifying metadata removed.](docs/assets/video-downloader-hero.svg)

**Right-click. Download video. Get a clean, compatible MP4.** A Chrome extension and silent local helper find the highest-resolution source, save H.264 video and AAC audio by default, and remove identifying metadata. Compatible tracks are copied; other tracks are converted when needed.

It also restores text selection and copying, copies links without common tracking parameters, and saves original images with identifying metadata removed. Chrome's ordinary image downloads are cleaned automatically too.

**[Download the installer ZIP](https://github.com/Abomination81/video-downloader/releases/latest/download/Video-Downloader.zip)** · [Visual install guide](https://abomination81.com/video-downloader/) · [Release notes and checksums](https://github.com/Abomination81/video-downloader/releases/latest)

Use **Video-Downloader.zip** from Releases for installation. GitHub's automatic **Source code** ZIP does not contain the built extension and helper wheel.

## What you get

| Action | Result |
| --- | --- |
| **Download video** | Highest available resolution and frame rate in a compatible H.264/AAC MP4; native Chrome download entry |
| **Save original image** | Largest exposed image source, original format and quality, identifying metadata removed |
| Chrome's **Save image as** | Automatic cleanup of newly saved images, preserving your filename |
| **Copy clean link** | Recognizable tracking fields removed; functional, signed and login links preserved |
| Browse normally | Right-click, text selection and copying restored by default; settings can disable restoration |

Downloads continue after you navigate away or close the source tab. Everything runs locally; no developer-operated upload service or account is required.

<details>
<summary>See the extension</summary>

<img src="docs/assets/downloads.png" width="380" alt="The real black and neon green extension showing completed image and video downloads, metadata removal status, and Show file controls.">

</details>

## Install on Mac

1. Unzip **Video-Downloader.zip**, then open **Install.command**. It installs the helper and any missing tools for your account. Internet access is required. If Homebrew is missing, setup installs it and macOS may ask for your password.
2. The installer opens an extension folder and Chrome's extensions page. Turn on **Developer mode**, click **Load unpacked**, and select that extension folder.
3. Reload any video pages that were already open.

The installed extension folder is `~/Library/Application Support/Video Downloader/extension`. The original ZIP can be deleted after setup.

## Install on Windows

Unzip the bundle and open **Install-Windows.cmd**. Setup uses Microsoft's WinGet to install missing FFmpeg, Deno, and ExifTool, and installs a private Python runtime automatically. Then enable Developer mode at `chrome://extensions`, click **Load unpacked**, and choose the extension folder opened by setup. Windows installation scripts are supplied; check `docs/VALIDATION.md` for platforms actually tested.

Chrome requires these manual steps for an unpacked extension. Setup does not change Chrome policies, bypass security controls, or require a Chrome Web Store account.

## Download

- Play the video, then right-click and select **Download video**.
- **Restore right-click menus** is enabled by default, including on sites that disable the menu. You can disable it in Settings to use a site's custom context menu.
- Transparent overlays, cross-origin frames, and closed shadow roots are included in discovery.
- If the menu still cannot open, click the extension's toolbar button or press **Alt+Shift+V**. Pin the extension to make the button easy to reach.
- If multiple videos match, choose the correct one from the list.
- Files appear in **Chrome's native download panel**, accessible from its down arrow and Downloads page. The entry appears after the MP4 has passed its metadata checks. The extension shows progress while the helper downloads and prepares the file.
- Downloads normally save directly in each person's own `Downloads` folder (`~/Downloads` on Mac, `%USERPROFILE%\Downloads` on Windows). A different location deliberately configured in Chrome is respected. The shared bundle contains no personal save location.
- You can navigate to another video, change pages, or close the video tab and popup after starting. The source and scoped session are captured at selection time; a detached helper continues the work. The browser handoff is tracked independently of the tab.
- A popup opening another tab does not discard an unfinished video selection. Choose the original video from the extension's list. Frame probes have a time limit, so a stuck player or script dialog can fall back to already-observed media addresses.

## Quality

The extension downloads the site's source files. There is no screen or tab recording fallback.

**Compatible MP4 (H.264 + AAC)** is enabled by default. It keeps the highest available resolution and frame rate. At equal resolution/frame rate, it prefers SDR and original H.264/AAC tracks to avoid needless re-encoding. When necessary, FFmpeg converts incompatible tracks to H.264 High Profile, 8-bit YUV 4:2:0 and AAC-LC mono/stereo. Compatible video or audio tracks are copied without re-encoding, even when the other track needs conversion. Conversion is lossy, takes additional time and can produce a larger file. Silent videos remain silent. Odd dimensions may receive a one-pixel border to fit H.264 chroma requirements.

Turn off **Compatible MP4** in Settings for **Original source mode**. That preserves the original AV1, VP9, HEVC, H.264 and audio codecs without lossy conversion when they can be copied safely into MP4. It retains the original HDR handling. HDR sources requiring tone mapping fail explicitly in compatible mode; they are never silently saved with washed-out colors.

There is no resolution cap or automatic truncation. A known extractor or master playlist is preferred over the low-quality rendition currently playing. Conversion is checked for dimensions, frame rate, frame count where available, track timing, color and rotation before metadata sanitizing. A site can expose only some formats to your session; the helper cannot download renditions it does not expose.

MP4 is a container, not a codec. An AV1/Opus MP4 can play locally yet be rejected by an upload service. The default addresses this codec mismatch. Platform-specific duration, resolution, file-size and account restrictions still apply; codec compatibility alone cannot guarantee acceptance by every service. See [X's technical upload recommendations](https://docs.x.com/x-api/media/quickstart/best-practices) and [web upload guidance](https://help.x.com/en/using-x/x-videos).

## Browsing and images

- **Enable copying and text selection** is on by default. It restores selection CSS and stops common copy/selection blockers. Editable fields and editors retain their own behavior. Turn it off in Settings if a site's custom interface needs it.
- **Copy clean link** copies the clicked link, or the current page when there is no clicked link. It removes known tracking parameters such as `utm_*`, `fbclid` and `gclid`, while retaining timestamps, functional parameters and fragments. Signed, session and login links are left intact. The extension writes only the requested link; it does not read your clipboard.
- **Save original image** appears when you right-click an image. It uses the largest source explicitly exposed by the page's `srcset`, matching `picture` source or original-image attributes. It does not guess hidden CDN URLs or invent a higher-resolution image. The verified image appears in Chrome's download panel and normal download folder. Small inline/data/blob images are supported without canvas conversion; for large inline images, use Chrome's ordinary **Save image as**.
- **Automatically clean saved images** is on by default. Chrome's **Save image as** and other newly completed image downloads are cleaned locally in place, preserving the chosen filename. It does not scan previously downloaded images. With Chrome's own command, cleanup starts after the download completes, so the original metadata can briefly exist on disk. Our command removes metadata before handing the file to Chrome. Open the extension to see cleanup progress or any failure.

Images retain their original format and encoded picture data; they are never recompressed into JPEG. Cleanup handles JPEG, PNG/APNG, WebP, GIF, TIFF and AVIF, with additional HEIC/HEIF/JXL support when their structure can be verified. Animation frames, timing and loops remain intact. EXIF/GPS, author, comment, timestamps, XMP, thumbnails and source-URL file attributes are removed. Necessary orientation, color calibration, transparency and animation data remain. Color profile descriptions, device identity and creation dates are neutralized while preserving numerical calibration.

Simple static SVGs retain their drawing markup while descriptive/editor metadata is removed. Dynamic SVGs, external/embedded resources, unknown color profiles and unverified structures fail explicitly. Automatic cleanup leaves the original file untouched on failure. There is no claim that an unsupported image has been cleaned.

## Metadata

The helper creates a fresh MP4 containing the selected audio/video tracks. It removes descriptive container/track tags, source timestamps, GPS, chapters, cover art, extra data tracks, user-data boxes, and H.264/HEVC unregistered SEI user data. Packet remuxing uses PyAV to remove private SEI messages selectively, retaining HDR, captions, timing, and orientation. FFmpeg performs the final container cleanup. FFprobe and ExifTool check the result before it is published in Downloads.

FFmpeg prepares missing decode timestamps before packet editing so the opening keyframe is retained. Track start times and available frame counts are checked to prevent a blank opening or lost frames. After Chrome saves the file, the helper checks its SHA-256 against the verified private MP4 and clears source-URL file attributes Chrome may add. macOS quarantine and Windows ZoneId security markings are retained.

Technical playback information (codecs, dimensions, timing, HDR and rotation) remains necessary. Metadata removal does not erase visible watermarks or information contained in the picture or sound. Unknown metadata causes verification to fail rather than producing a falsely labeled clean file.

Cookies, including applicable partitioned cookies on supported Chrome versions, are scoped to relevant site/media URLs, sent only to the local helper, and held in memory for the job. Source URLs, cookies and authorization headers are not stored in download history. Chrome records a temporary localhost transfer address instead of the website's video address. Neutral file names avoid embedding the source title or URL. Extension history contains the display title, status, and output filename; **Clear history** removes finished extension entries without deleting finished videos or Chrome's separate history. Finished history expires after 30 days.

The prepared file stays in a private local directory until Chrome has saved and verified it. The transfer listens only on `127.0.0.1`, uses an unguessable one-file capability, rejects website-origin requests, supports range requests, and expires after one hour. The private copy is removed on success or cancellation. A failed save retains the prepared copy for **Save file again**, for up to seven days. Browser safety checks remain active; the extension never auto-accepts a blocked or dangerous download.

Image processing and clipboard copying stay on your computer. Completed-image cleanup uses Chrome's local download filename; a private receipt records the final path so **Show file** can find it. Cookies are not saved for later retries. Filesystem quarantine/ZoneId security markings are retained while source-URL attributes are cleared.

## Update and share

Share **Video-Downloader.zip** with friends. Each person runs setup on their own computer. The embedded public key gives everyone the same extension ID, keeping the native connection stable.

Run **Update-engine.command** (Mac) or **Update-engine-Windows.cmd** to update yt-dlp independently when a website changes. For extension/helper updates, download a new bundle, rerun its installer, and click **Reload** at `chrome://extensions`. Wait for active downloads before updating.

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
