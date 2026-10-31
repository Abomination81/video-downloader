**Built by [Abomination81](https://abomination81.com)** · [X @Abomination81](https://x.com/Abomination81)

Right-click. Keep the video—or just the audio.

- **Choose video format…** shows available source quality, frame rate, codecs and size estimates. Save compatible MP4, original-codec MP4, or MP3. Choices apply only to that download.
- **Download audio as MP3** joins the right-click menu and toolbar popup. Best available source audio; up to 320 kbps by default, with smaller bitrate options in the picker. Existing MP3 audio is preserved without re-encoding when possible.
- MP3 tags, artwork and chapters are removed and independently checked. Full-file decoding and duration checks run before publication; copied MP3 audio must retain its decoded-audio hash. Functional playback headers remain.
- One-click **Download video** still chooses the highest-quality compatible H.264/AAC MP4. Downloads appear in Chrome's down arrow and continue after you leave or close the source page.
- The picker survives closing/reopening. Explicit selections expire after 15 minutes and never silently fall back to another rendition.

Existing 0.5.1+ installations receive this signed update automatically after active jobs finish. Settings → Check for updates can request it sooner. Older installations need the installer once to enable automatic updates. Keep Chrome Developer mode enabled.

For a fresh installation, download **Video-Downloader.zip**, unzip it and run **Install.command** on Mac. Use Chrome's Developer mode → Load unpacked to select the installed extension folder. Windows scripts are supplied; Windows installation remains unverified.

MP3 conversion is lossy and cannot improve the source. DRM and recording fallbacks are unsupported. See [validation](https://github.com/Abomination81/video-downloader/blob/main/docs/VALIDATION.md) for checked behavior and platform coverage.
