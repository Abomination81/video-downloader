# Full Page Screenshot by Abomination81

This is the first-party Still 1.1.0 screenshot engine bundled as a separate extension. Its source files are pinned by SHA-256 in `provenance.json`. The bundle uses the repository's MIT license, included here as `LICENSE`.

Right-click an ordinary webpage and choose **Save full-page screenshot**. It saves a PNG directly to Chrome's configured Downloads destination. Large captures save one ZIP of PNG parts. Keep the source page and Chrome window active; Escape cancels. The toolbar opens an optional preview. The original capture limits, restoration, sender checks and cancellation behavior are retained.

Only `activeTab`, `scripting` and `contextMenus` are granted. No host permissions, automatic content scripts, cookies, native messaging, download-history access, persistent screenshot store or uploads. The main downloader is separately privileged for its media features; it cannot use this companion to capture or retrieve pixels.

The integration wrapper permits exactly one external extension ID: Abomination's background worker. It accepts only strict version-status and matching-installed-version activation messages. CSP permits reads of packaged resources (`connect-src 'self'`) solely so the update shim can verify the fixed local manifest; remote connections remain blocked. Captures and previews postpone activation. Update acquisition/signature verification remains in Abomination's existing updater. Unlike the standalone installation, this companion follows the user's signed bundle update policy.

## Installation

Run the Abomination bundle installer. In Chrome → Extensions → Load unpacked, select `screenshot-companion` inside the installed Video Downloader extension directory. Disable standalone Still Screenshot to avoid duplicate entries. The parent Settings page shows the folder and connection/version status. Friends do this once; subsequent signed bundle updates preserve the same identity and permissions.

## Offline build

From the root of the included `screenshot-companion-source` directory, run:

```sh
node scripts/build-screenshot-companion.mjs
```

Node 24 suffices; the script needs no npm dependencies or network. Output is `.output/chrome-mv3/screenshot-companion`. It copies the pinned engine, adds a local update shim and stable public extension identity, and brands the preview. The worker adaptation exports an internal read-only busy flag and changes the native menu label. A separate branding stylesheet, shared download mark, and creator links replace the standalone appearance; no test bridge ships. A changed upstream file or unexpected file makes the build fail.

## Limits

Infinite feeds, virtualized content, hidden portions of independent scroll panels, protected Chrome pages, local files, incognito and expanded cross-origin frame contents are not guaranteed or supported. Chrome controls download prompts and completion reporting. A temporary automatic-save preview clears itself after about 30 seconds; background throttling can delay that timer. Browser/OS memory and saved files are outside the extension's in-memory cleanup guarantee.
