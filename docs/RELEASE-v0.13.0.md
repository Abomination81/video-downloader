# One extension. Every tool.

**Video Downloader v0.13.0** · Built by [abomination81](https://abomination81.com) · [X @abomination81](https://x.com/Abomination81)

Video, MP3, photos, full-page screenshots, full uBlock Origin Lite ad protection, cookie rejection, popup recovery, video controls, clean links and local image text recognition now live in **one Chrome extension**. No companion extensions are needed.

Highest-quality compatible H.264/AAC MP4 remains the default. Downloads keep running after you leave the page, appear in Chrome’s download panel, and have identifying metadata removed. MP3s and photos are cleaned too.

## Upgrade once

Download **Video-Downloader.zip**, unzip it, and run **Install.command** (Mac) or **Install-Windows.cmd** (Windows). In Chrome → Extensions, use **Load unpacked** for the parent folder opened by setup. Disable or remove the old Audio, Ad Protection, YouTube Protection and Full Page Screenshot companions. On Mac the folder is `~/Library/Application Support/Video Downloader/extension`.

This consolidation changes permissions, so the older updater correctly requires a manual installation. Future signed updates remain automatic. Chrome groups the right-click commands under the single extension’s name. The silent local helper is still required for downloads and metadata removal.

## Verified

One extension ID and one menu owner; real ad requests and ad-SDK replacement; cookie rejection and popup recovery; video seeking/PiP; local OCR; clean MP4/MP3/photo downloads after navigation; complete-page screenshots and safe cancellation; hostile-message rejection; update activation with open-page state preserved. Full test evidence and live-site limits are in [validation](https://github.com/Abomination81/video-downloader/blob/main/docs/validation/0.13.0/REVIEW.md).

Live YouTube playback passed. WatchLuna and Reddit presented anti-bot gates in the disposable test browser; playback there was not certified. DRM-protected originals and every possible site/ad system are not supported. Windows installer scripts are supplied; Windows has not been certified on a real machine.

The combined extension is GPL-3.0-or-later and includes complete corresponding source. Original helper/downloader and screenshot MIT notices remain included. The installer ZIP contains no accounts, credentials or personal download paths.
