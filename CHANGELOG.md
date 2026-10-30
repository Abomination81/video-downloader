# Changelog

## 0.4.0 — 2026-10-30

- Compatible H.264/AAC MP4 is now the default, fixing source-codec mismatches such as YouTube AV1/Opus downloads rejected by X.
- Prefer original H.264/AAC tracks at the best available resolution/frame rate; convert incompatible tracks when needed. Compatible tracks are copied without re-encoding.
- Keep resolution, frame rate and audio/video alignment; verify conversion before removing metadata. Show conversion progress state and actual audio/video codecs.
- Add an Original source option for codec-preserving downloads, including HDR. HDR requiring tone mapping fails safely in compatible mode.
- Preserve existing browsing/image settings while upgrading old installations to the new video default.

## 0.3.0 — 2026-10-30

First public release. Built by [Abomination81](https://abomination81.com).

- Right-click video downloads with the highest available source quality, copied into MP4 without re-encoding.
- Identifying metadata removal with independent output checks; necessary playback, HDR and orientation data retained.
- Native Chrome download entries, each person's Downloads folder, and background jobs that continue after the source tab closes.
- Source detection across overlays, embedded frames, shadow roots, HLS/DASH and MediaSource players where a downloadable source exists.
- Default right-click, copying and text-selection restoration, plus a conservative **Copy clean link** command.
- **Save original image** and automatic cleanup of newly completed ordinary Chrome image downloads. Original picture quality, rotation and animation are verified.
- Black/neon-green interface, original ghoul artwork, local Anton font and creator links.
- Per-user Mac installer and supplied Windows installer, update and uninstall scripts.

Validated on macOS arm64: 60 Python tests, 20 TypeScript tests and real Chrome integration checks. Windows installation is not yet certified. DRM, recording and sources the site does not expose are outside this release's coverage. Unsupported or unverified metadata structures fail explicitly.
