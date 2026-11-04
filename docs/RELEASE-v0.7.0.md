**Built by [Abomination81](https://abomination81.com)** · [X @Abomination81](https://x.com/Abomination81)

Download commands directly in Chrome's right-click menu:

- Video: **Download video** and **Download audio**, as separate entries.
- Audio player/file: **Download audio**.
- Image: **Download photo**, using our original-image download and metadata cleanup.

Chrome groups multiple commands from one extension. A small audio companion gives audio its own native entry. After updating, open **chrome://extensions**, choose **Load unpacked** and select **audio-companion** inside your installed extension folder. On Mac: `~/Library/Application Support/Video Downloader/extension/audio-companion`. Fresh installs load the main extension folder and this subfolder once each. No additional local helper is needed.

Both extensions update together through the existing signed updater. They share your settings and download history. **Choose format** and **Copy clean link** are in the main toolbar popup. Right-click a link, then use Copy clean link within 15 seconds to copy it without common tracking fields.

Highest-quality compatible H.264/AAC MP4 remains the video default. Audio is MP3 up to 320 kbps by default, with descriptive metadata and artwork removed and verified. Chrome's built-in Save image as command remains available and receives the existing automatic image metadata cleanup.

Source detection, overlay/frame recovery, tab-independent downloads and the native Chrome download panel are retained. The companion has no site, cookie, or native-messaging permissions; the main extension handles downloads through its existing helper. See [validation](https://github.com/Abomination81/video-downloader/blob/main/docs/VALIDATION.md) for tested coverage.
