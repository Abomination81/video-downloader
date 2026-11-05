**Built by [abomination81](https://abomination81.com)** · [X @abomination81](https://x.com/Abomination81)

Video downloads, MP3 audio, original images, full-page screenshots and useful browsing tools, with a cleaner green-and-black interface and a new download logo.

### Included

- **Download video:** highest available quality in compatible H.264/AAC MP4 by default. Choose another source format in the toolbar popup.
- **Download audio:** best available audio as MP3, up to 320 kbps by default.
- **Download photo:** the largest exposed original image. Identifying metadata is removed from media downloads; ordinary Chrome image saves are cleaned automatically too.
- **Save full-page screenshot:** a full-page PNG, or one ZIP of PNG parts for very large pages.
- **YouTube ad blocking:** local filtering for videos, Shorts and embedded players, powered by Still. YouTube changes can affect filtering.
- **Better browsing:** restore right-click, copying and text selection; copy links without common tracking parameters.

Video and audio jobs keep running after you leave the source page. Finished media appears in Chrome's download panel. Screenshot capture needs the source page and Chrome window to stay active until it finishes.

### Automatic updates

Existing installations with automatic updates enabled receive this signed bundle automatically. Updates wait for active jobs, verify the release signature and archive hash, preserve settings and download history, and activate the extensions when idle. Close extension popups/previews to finish activation.

**One-time Chrome setup:** load the installed extension folder, rather than an extracted ZIP or a project's `dist` folder. On Mac, the installed folder is:

```text
~/Library/Application Support/Video Downloader/extension
```

In **Chrome → Extensions → Load unpacked**, select that folder, then load its **audio-companion**, **youtube-companion** and **screenshot-companion** subfolders once for the extra tools. Chrome requires this initial activation; future signed updates replace their files together. Windows setup opens the equivalent installed folder.

Disable standalone Still copies before enabling their bundled companions. Reload existing YouTube tabs to activate updated ad filtering. Copies older than 0.5.1 need the installer once to enable the updater.

Use **Video-Downloader.zip** below, rather than GitHub's automatic source archives. No Terminal commands are needed for normal installation or updates. [Installation guide](https://abomination81.com/video-downloader/) · [Validation and limits](https://github.com/Abomination81/video-downloader/blob/main/docs/VALIDATION.md) · [Bundle licenses](https://github.com/Abomination81/video-downloader/blob/main/BUNDLE-LICENSES.md)
