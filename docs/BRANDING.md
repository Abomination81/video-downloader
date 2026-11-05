# Abomination81 tool branding

**Abomination81 Toolkit** is the public product name. The unified extension uses black, neon green `#39ff14`, and native system fonts. The toolbar and menu icons use a simple download symbol; the earlier ghoul and eye artwork is removed from the installed tool.

The editable mark is `extension/public/brand/mark.svg`. Its checked-in PNG sizes are rebuilt with `node scripts/render-tool-icons.mjs`. The mark is original SVG source in this repository, not a remote image. All tool screens link to https://x.com/Abomination81 with the visible handle **@abomination81** and carry **Built by abomination81**.

Right-click commands use Chrome's native contextMenus API with short, unbranded labels. Chrome and the operating system control their font, spacing, placement and extension icon. Chrome groups matching commands under **Abomination81 Toolkit**. All tools are part of one extension; separate companions are retired.

Assets are bundled locally. Appearance makes no requests to websites, font services or X. Creator links open only when clicked. Source/build instructions include the shared assets so they rebuild offline. The stable extension identity, native-host registration, `Video Downloader` installation directory, repository URL and `Video-Downloader.zip` update asset retain their existing names for upgrade compatibility.
