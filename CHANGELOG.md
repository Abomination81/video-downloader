# Changelog

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
