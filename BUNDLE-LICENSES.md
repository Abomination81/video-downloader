# Bundle licenses

Video Downloader and its audio companion retain their MIT license (`LICENSE`). This distribution also includes a separately installed YouTube protection program, licensed GPL-3.0-or-later. Its full license and attribution notices are in `extension/youtube-companion/LICENSE` and `extension/youtube-companion/THIRD_PARTY_NOTICES.md` in installer bundles, and `companion/youtube/upstream/` in the repository.

Complete corresponding source for the YouTube companion, including the local update shim and build/branding script, is supplied in `youtube-companion-source/` in every installer ZIP. See `companion/youtube/README.md` inside that source directory for offline build instructions. The extensions run separately, retain separate permissions and storage, and exchange only limited local version/protection status and update activation messages.

Vendored Still notices and licenses must accompany redistributions. The root MIT license does not replace the YouTube companion's GPL license. Other dependency/font notices retain their respective terms.

The separate Full Page Screenshot by Abomination81 companion contains first-party Still 1.1.0 code and uses the root MIT license, also included in `extension/screenshot-companion/LICENSE`. Its pinned source, wrapper and offline build script are included in `screenshot-companion-source/`. This is separate from the GPL YouTube protection program.
