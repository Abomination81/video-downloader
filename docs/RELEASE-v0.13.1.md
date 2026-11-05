# Clean audio. One extension.

**Video Downloader v0.13.1** · Built by [abomination81](https://abomination81.com) · [X @abomination81](https://x.com/Abomination81)

Fixes an MP3 download failure found while testing the unified extension in Chrome. Stereo and surround sources could be rejected because FFprobe exposed a technical gapless-playback header as metadata. The helper now writes a fixed, versionless marker and verifies it explicitly. Titles, artwork, chapters and source encoder identity are still removed, and copied MP3 audio keeps its exact decoded samples.

All tools stay in one extension: compatible MP4, MP3, original photos, full-page screenshots, ad protection, optional-cookie rejection, popup controls, video controls and local image text recognition.

**Already on v0.13.0?** This signed update installs automatically. No new permissions or reinstall. Older companion installations need the one-time unified setup described in the [install guide](https://abomination81.com/video-downloader/).

Windows installation remains unverified on Windows. Site restrictions, DRM and changing ad systems still limit coverage.
