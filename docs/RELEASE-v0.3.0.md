# Video Downloader v0.3.0

**Keep the video.** Right-click a video, choose **Download video**, and get an MP4 at the highest available source quality with identifying metadata removed. Built by [Abomination81](https://abomination81.com) · [X @Abomination81](https://x.com/Abomination81).

The Chrome extension finds the source; a silent local helper downloads and checks it. Finished files appear in Chrome's own download panel and use your normal download folder. You can leave the page or close the source tab after starting.

- Highest available source quality, without re-encoding or a silent quality downgrade.
- Metadata cleanup with playback, HDR and rotation information retained.
- Original-image downloads and automatic cleanup of Chrome's normal image saves, preserving format and animation.
- Restored right-click, copying and text selection, plus **Copy clean link**.
- Local processing, no developer-operated upload service and no account required.

## Install

Download **Video-Downloader.zip** below and unzip it. On Mac, open **Install.command**. On Windows, open **Install-Windows.cmd**. Setup installs the local helper; then enable Developer mode at `chrome://extensions`, choose **Load unpacked**, and select the extension folder opened by setup. Refresh already-open webpages.

Use the installer ZIP, not GitHub's automatic **Source code** archives. File hashes are in **SHA256SUMS.txt**.

## Verified and limited

60 Python tests, 20 TypeScript tests, production build/type checks, and real Chrome integration on macOS arm64. Browser checks include overlays, embedded frames, blocked menus, blob/MSE sources, highest-rendition HLS, session/Referer requirements, navigation, tab closure, extension-worker restart, copying, and both image-save routes. Windows installation scripts are supplied but have not been run on Windows.

Original-file downloads only. DRM, recording, WebRTC-only sources and some custom players remain unsupported. Necessary technical information stays in the files. For ordinary Chrome image saves, automatic cleanup runs just after download completion; our image command cleans before saving. Unsupported image structures fail safely and automatic cleanup keeps the original file on failure.

[Install guide](https://abomination81.com/video-downloader/) · [Source and documentation](https://github.com/Abomination81/video-downloader) · [Validation detail](https://github.com/Abomination81/video-downloader/blob/main/docs/VALIDATION.md)
