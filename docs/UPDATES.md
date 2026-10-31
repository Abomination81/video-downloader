# Automatic updates

The current distribution is a personal unpacked extension with an installed local helper. Chrome’s ordinary externally hosted extension update mechanism is not available for this distribution on macOS/Windows. The helper updates files in the already-authorized installation; `chrome.runtime.reload()` activates them. No Chrome policy changes or additional extension permissions are used. A Chrome Web Store distribution would need its own browser-managed extension update path rather than this personal-install mechanism.

## User behavior

0.4.x users run the 0.5.x installer once, reload the extension and refresh existing pages. The installer keeps a private copy of uv and a small native bootstrap. Future helper/extension releases install silently. Chrome alarms survive worker suspension and restore checks on startup. The helper checks stable GitHub releases at most every six hours; transient failures retry later. Settings has a manual check and an opt-out. Initial setup and separately managed FFmpeg/Deno/ExifTool upgrades still use their normal tools.

The updater checks an Ed25519 signature against its embedded public key, then the full ZIP length and SHA-256. Release URLs, redirects, versions, package identity, Chrome requirements, archive paths and permissions are validated before activation. Runtime dependencies use exported lockfile hashes. The helper is installed into a new versioned environment and imported successfully before use. Existing downloads and cleanup jobs take precedence. A shared maintenance lock prevents a new job from racing the commit. A journal lets the bootstrap restore the previous extension and runtime pointer after an interrupted commit.

The extension reloads only when its UI and active jobs are idle. Its content script uses disposable listeners, and the update handler reconnects open HTTP/HTTPS pages. Website documents are not navigated. Restricted Chrome pages remain subject to Chrome’s normal extension limits.

## Release workflow

1. Update versions in package.json/package-lock.json, wxt.config.ts, helper/pyproject.toml, helper/uv.lock and helper/video_downloader/__init__.py. Update relevant fixtures, changelog and release notes.
2. Push to main. Checks run TypeScript, helper, real browser interaction and update-activation tests.
3. A successful main-branch push triggers Signed release. It builds the package, signs exact manifest bytes using the repository’s UPDATE_SIGNING_KEY secret, uploads all assets to a draft and publishes the complete release.
4. Published versions are immutable to this workflow; reruns leave an existing published release untouched. Bump the version for another fix.

The private Ed25519 signing key is stored only as an Actions secret. `helper/video_downloader/update-key.json` contains its public key. No signing secret is included in source, installer bundles or user machines. A fork must establish its own signing identity and distribution rather than reusing this repository’s updater configuration.

## Yoinks comparison

[Yoinks](https://github.com/pablostanley/yoinks) provides an Ink/React terminal UI around yt-dlp and FFmpeg. Its source calls yt-dlp for probing and downloads; it does not supply a separate extraction engine. Its advertised 1,800+ site coverage comes from the same engine used here. Adding its terminal wrapper would not add 1,800 new sites. Its resolution picker, audio-only MP3 mode and size estimates are optional UI features rather than broader extraction coverage.

The [yt-dlp supported-site list](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) explicitly cautions that listed sites can break as websites change. Keeping the engine current and testing the actual site matters more than a headline count. This extension already adds browser source observation, scoped session access, embedded-player detection, metadata cleanup and Chrome download entries around that engine.

Sources: [Chrome runtime reload behavior](https://developer.chrome.com/docs/extensions/reference/api/runtime), [Chrome alternative installation methods](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions), [Yoinks implementation](https://github.com/pablostanley/yoinks/blob/main/src/lib/ytdlp.ts).
