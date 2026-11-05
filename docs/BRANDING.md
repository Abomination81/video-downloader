# Abomination81 tool branding

The downloader and its audio, YouTube and screenshot companions use black, neon green `#39ff14`, and native system fonts. The toolbar and menu icons use a simple download symbol; the earlier ghoul and eye artwork is removed from the installed tool.

The editable mark is `extension/public/brand/mark.svg`. Its checked-in PNG sizes are rebuilt with `node scripts/render-tool-icons.mjs`. The mark is original SVG source in this repository, not a remote image. All tool screens link to https://x.com/Abomination81 with the visible handle **@abomination81** and carry **Built by abomination81**.

Right-click commands use Chrome's native contextMenus API with short, unbranded labels. Chrome and the operating system control their font, spacing, placement and extension icon; the tool does not draw an imitation context menu. Separate companions preserve direct menu entries.

Assets are bundled locally. Appearance makes no requests to websites, font services or X. Creator links open only when clicked. Companion source/build instructions include the shared assets so they rebuild offline. Stable extension identities and native-host registration remain unchanged.
