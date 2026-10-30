# Video Downloader v0.4.0

**Clean MP4s that are easier to upload.** Built by [Abomination81](https://abomination81.com) · [X @Abomination81](https://x.com/Abomination81).

Compatible **H.264 video + AAC audio** is now the default. This fixes the codec mismatch where a YouTube AV1/Opus MP4 plays locally but X reports no supported video or audio.

- Keep the highest available resolution and frame rate. Prefer original compatible tracks at the same resolution/frame rate.
- Copy H.264/AAC tracks without re-encoding; convert incompatible tracks when needed.
- Verify picture dimensions, frame rate, frame count where available, timing, color and orientation, then remove identifying metadata as before.
- Turn off **Compatible MP4** in Settings for **Original source mode**, including HDR and codec-preserving downloads.
- Keep image downloads, copying, clean links, Chrome download history and background jobs.

Conversion is lossy and can take more time or disk space. HDR sources requiring tone mapping fail clearly in compatible mode; Original source mode preserves them. Platform account, duration, resolution and size limits still apply.

Download **Video-Downloader.zip**, unzip it, and rerun **Install.command** (Mac) or **Install-Windows.cmd** (Windows). Reload the extension at `chrome://extensions`, then refresh open webpages. New helper defaults also make requests from the previous extension version compatible until it is reloaded. Checksums are in **SHA256SUMS.txt**.

Mac installation and local media/browser checks are verified. Windows installation remains unverified. No screen recording or DRM fallback is added.

[Install guide](https://abomination81.com/video-downloader/) · [Validation](https://github.com/Abomination81/video-downloader/blob/main/docs/VALIDATION.md) · [X upload recommendations](https://docs.x.com/x-api/media/quickstart/best-practices)
